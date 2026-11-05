//! A persistent signed executable owns Keychain access across application rebuilds.
//! Authenticate the running child before sending any credential through its stdin.
use base64::{engine::general_purpose::STANDARD, Engine};
use core_foundation::url::CFURL;
use keyring_core::{Error, Result};
use security_framework::os::macos::code_signing::{
    Flags, GuestAttributes, SecCode, SecRequirement, SecStaticCode,
};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::os::unix::fs::MetadataExt;
use std::process::{Command, Stdio};
use std::time::Duration;

const LIMIT: usize = 65_536;
const HELPER_ID: &str = "app.glossa.credential-helper";
const FINGERPRINT: Option<&str> = option_env!("GLOSSA_SIGNING_FINGERPRINT");
const HELPER_CDHASH: Option<&str> = option_env!("GLOSSA_CREDENTIAL_HELPER_CDHASH");

pub(crate) fn configured() -> bool {
    FINGERPRINT.is_some_and(|value| !value.is_empty())
}

fn unavailable() -> Error {
    Error::NoStorageAccess(Box::new(std::io::Error::other(
        "The Glossa credential helper is unavailable or could not be authenticated",
    )))
}

fn requirement(identifier: &str, fingerprint: &str) -> Result<SecRequirement> {
    if !matches!(
        identifier,
        HELPER_ID | "app.glossa.reader" | "app.glossa.reader.dev"
    ) || fingerprint.len() != 40
        || !fingerprint.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(unavailable());
    }
    format!("identifier \"{identifier}\" and certificate leaf = H\"{fingerprint}\"")
        .parse()
        .map_err(|_| unavailable())
}

fn helper_requirement(fingerprint: &str) -> Result<SecRequirement> {
    let cdhash = HELPER_CDHASH.ok_or_else(unavailable)?;
    if cdhash.len() != 40 || !cdhash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(unavailable());
    }
    // Pin the reviewed executable, including its hardened-runtime settings.
    // A previously signed helper must not become a downgrade path.
    format!("identifier \"{HELPER_ID}\" and certificate leaf = H\"{fingerprint}\" and cdhash H\"{cdhash}\"")
        .parse().map_err(|_| unavailable())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Request<'a> {
    operation: &'a str,
    account: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    value_base64: Option<String>,
    legacy: bool,
    previous: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    noninteractive: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Response {
    data_base64: Option<String>,
    status: Option<String>,
    success: Option<bool>,
    // The helper's diagnostic is never included in logs or propagated to the UI.
    #[serde(rename = "error")]
    _error: Option<String>,
}

fn decode_response(output: &[u8], operation: &str) -> Result<Vec<u8>> {
    if output.len() > LIMIT {
        return Err(unavailable());
    }
    let response: Response = serde_json::from_slice(output).map_err(|_| unavailable())?;
    if operation == "get" {
        if response.status.as_deref() == Some("missing") && response.data_base64.is_none() {
            return Err(Error::NoEntry);
        }
        if response.status.as_deref() != Some("present") {
            return Err(unavailable());
        }
        STANDARD
            .decode(response.data_base64.ok_or_else(unavailable)?)
            .map_err(|_| unavailable())
    } else if response.success == Some(true) && response.data_base64.is_none() {
        Ok(Vec::new())
    } else {
        Err(unavailable())
    }
}

fn call(identifier: &str, request: Request<'_>) -> Result<Vec<u8>> {
    let fingerprint = FINGERPRINT.ok_or_else(unavailable)?;
    let own_requirement = requirement(identifier, fingerprint)?;
    SecCode::for_self(Flags::NONE)
        .and_then(|code| code.check_validity(Flags::NONE, &own_requirement))
        .map_err(|_| unavailable())?;
    let input = serde_json::to_vec(&request).map_err(|_| unavailable())?;
    if input.len() > LIMIT
        || request.account.is_empty()
        || request.account.len() > 512
        || request.account.contains('\0')
    {
        return Err(unavailable());
    }
    let helper_path = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .ok_or_else(unavailable)?
        .join("Library/Application Support/Glossa Signing/credential-helper");
    for path in [
        helper_path.as_path(),
        helper_path.parent().ok_or_else(unavailable)?,
    ] {
        let metadata = std::fs::symlink_metadata(path).map_err(|_| unavailable())?;
        if metadata.file_type().is_symlink()
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.mode() & 0o022 != 0
        {
            return Err(unavailable());
        }
    }
    let helper_requirement = helper_requirement(fingerprint)?;
    let helper_url = CFURL::from_path(&helper_path, false).ok_or_else(unavailable)?;
    SecStaticCode::from_path(&helper_url, Flags::NONE)
        .and_then(|code| code.check_validity(Flags::STRICT_VALIDATE, &helper_requirement))
        .map_err(|_| unavailable())?;
    let mut child = Command::new(helper_path)
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| unavailable())?;
    let result = (|| {
        let mut attributes = GuestAttributes::new();
        attributes.set_pid(i32::try_from(child.id()).map_err(|_| unavailable())?);
        SecCode::copy_guest_with_attribues(None, &attributes, Flags::NONE)
            .and_then(|code| code.check_validity(Flags::NONE, &helper_requirement))
            .map_err(|_| unavailable())?;
        // The child waits for EOF. No secret leaves this process until dynamic
        // verification succeeds, including when its on-disk path was replaced.
        let mut stdin = child.stdin.take().ok_or_else(unavailable)?;
        let stdout = child.stdout.take().ok_or_else(unavailable)?;
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let result = (|| {
                stdin.write_all(&input)?;
                drop(stdin);
                let mut output = Vec::new();
                stdout.take((LIMIT + 1) as u64).read_to_end(&mut output)?;
                Ok::<_, std::io::Error>(output)
            })();
            let _ = sender.send(result);
        });
        // Leave time for one deliberate system authorization, then release the
        // storage transaction and allow a fresh explicit retry.
        let output = receiver
            .recv_timeout(Duration::from_secs(180))
            .map_err(|_| unavailable())?
            .map_err(|_| unavailable())?;
        if output.len() > LIMIT {
            return Err(unavailable());
        }
        if !child.wait().map_err(|_| unavailable())?.success() {
            return Err(unavailable());
        }
        decode_response(&output, request.operation)
    })();
    if result.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    }
    result
}

pub(crate) fn read(
    identifier: &str,
    legacy: bool,
    previous: bool,
    account: &str,
) -> Result<Vec<u8>> {
    call(
        identifier,
        Request {
            operation: "get",
            account,
            value_base64: None,
            legacy,
            previous,
            noninteractive: None,
        },
    )
}

pub(crate) fn write(identifier: &str, account: &str, value: &[u8]) -> Result<()> {
    call(
        identifier,
        Request {
            operation: "set",
            account,
            value_base64: Some(STANDARD.encode(value)),
            legacy: false,
            previous: false,
            noninteractive: None,
        },
    )
    .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires a signed test executable and provisioned helper; synthetic account only"]
    fn native_broker_lifecycle() {
        let account = format!("glossa-signing-acceptance.rust.{}", std::process::id());
        struct Cleanup<'a>(&'a str);
        impl Drop for Cleanup<'_> {
            fn drop(&mut self) {
                let _ = call(
                    "app.glossa.reader",
                    Request {
                        operation: "deleteFixture",
                        account: self.0,
                        value_base64: None,
                        legacy: false,
                        previous: false,
                        noninteractive: Some(true),
                    },
                );
            }
        }
        let _cleanup = Cleanup(&account);
        assert!(matches!(
            read("app.glossa.reader", false, false, &account),
            Err(Error::NoEntry)
        ));
        write("app.glossa.reader", &account, b"\x01synthetic-rust-only").unwrap();
        assert_eq!(
            read("app.glossa.reader", false, false, &account).unwrap(),
            b"\x01synthetic-rust-only"
        );
        assert!(matches!(
            crate::secure_status::query("Glossa Credentials v2", &account).unwrap(),
            crate::secure_status::Presence::Present
        ));
        write("app.glossa.reader", &account, &[0]).unwrap();
        assert!(matches!(
            crate::secure_status::query("Glossa Credentials v2", &account).unwrap(),
            crate::secure_status::Presence::Cleared
        ));
    }

    #[test]
    fn broker_responses_fail_closed_and_preserve_missing() {
        assert_eq!(
            decode_response(br#"{"status":"present","dataBase64":"AXRlc3Q="}"#, "get").unwrap(),
            b"\x01test"
        );
        assert!(matches!(
            decode_response(br#"{"status":"missing"}"#, "get"),
            Err(Error::NoEntry)
        ));
        for input in [
            br#"{"status":"unavailable"}"#.as_slice(),
            br#"{"status":"present","dataBase64":"!"}"#,
            br#"{"status":"missing","dataBase64":""}"#,
            br#"{"status":"other"}"#,
            br#"{"status":"present","dataBase64":"","extra":true}"#,
        ] {
            assert!(matches!(
                decode_response(input, "get"),
                Err(Error::NoStorageAccess(_))
            ));
        }
        assert!(decode_response(br#"{"success":true}"#, "set").is_ok());
        assert!(decode_response(br#"{"success":false}"#, "set").is_err());
        assert!(decode_response(&vec![b' '; LIMIT + 1], "get").is_err());
    }

    #[test]
    fn only_glossa_identities_and_exact_certificate_are_accepted() {
        assert!(requirement(
            "app.glossa.reader",
            "ABCDEF0123456789ABCDEF0123456789ABCDEF01"
        )
        .is_ok());
        assert!(requirement("other.app", "ABCDEF0123456789ABCDEF0123456789ABCDEF01").is_err());
        assert!(requirement(HELPER_ID, "-").is_err());
    }
}
