//! Non-interactive metadata only. Never request kSecReturnData or migrate secrets.
use core_foundation::{
    array::CFArray,
    base::{CFType, TCFType},
    boolean::CFBoolean,
    dictionary::CFDictionary,
    string::{CFString, CFStringRef},
};
use security_framework::os::macos::keychain::{SecKeychain, SecPreferencesDomain};
use security_framework_sys::{
    item::*,
    keychain_item::{SecItemCopyMatching, SecItemUpdate},
};

extern "C" {
    static kSecUseAuthenticationUIFail: CFStringRef;
}
const CLEARED: &str = "glossa-cleared-v1";
const SAVED: &str = "glossa-saved-v1";

#[derive(Debug, PartialEq)]
pub(crate) enum Presence {
    Absent,
    Cleared,
    Present,
}

fn key(value: CFStringRef) -> CFString {
    // Security framework constants have process lifetime.
    unsafe { CFString::wrap_under_get_rule(value) }
}

fn exact_query(service: &str, account: &str) -> Vec<(CFString, CFType)> {
    unsafe {
        vec![
            (key(kSecClass), key(kSecClassGenericPassword).into_CFType()),
            (key(kSecAttrService), CFString::new(service).into_CFType()),
            (key(kSecAttrAccount), CFString::new(account).into_CFType()),
            (
                key(kSecUseAuthenticationUI),
                key(kSecUseAuthenticationUIFail).into_CFType(),
            ),
        ]
    }
}

fn scoped_query(service: &str, account: &str) -> Result<Vec<(CFString, CFType)>, i32> {
    let keychain =
        SecKeychain::default_for_domain(SecPreferencesDomain::User).map_err(|e| e.code())?;
    let mut pairs = exact_query(service, account);
    pairs.push((
        unsafe { key(kSecMatchSearchList) },
        CFArray::from_CFTypes(&[keychain]).into_CFType(),
    ));
    Ok(pairs)
}

pub(crate) fn query(service: &str, account: &str) -> Result<Presence, i32> {
    let mut pairs = scoped_query(service, account)?;
    unsafe {
        pairs.push((
            key(kSecReturnAttributes),
            CFBoolean::true_value().into_CFType(),
        ));
    }
    let query = CFDictionary::from_CFType_pairs(&pairs);
    let mut result = std::ptr::null();
    let status = unsafe { SecItemCopyMatching(query.as_concrete_TypeRef(), &mut result) };
    if status == -25300 {
        return Ok(Presence::Absent);
    }
    if status != 0 {
        return Err(status);
    }
    if result.is_null() {
        return Err(-50);
    }
    let attributes: CFType = unsafe { CFType::wrap_under_create_rule(result) };
    let dictionary = attributes.downcast::<CFDictionary>().ok_or(-50)?;
    let attributes: CFDictionary<CFString, CFType> =
        unsafe { CFDictionary::wrap_under_get_rule(dictionary.as_concrete_TypeRef()) };
    let cleared = attributes
        .find(unsafe { key(kSecAttrComment) })
        .and_then(|v| v.downcast::<CFString>())
        .is_some_and(|v| v.to_string() == CLEARED);
    Ok(if cleared {
        Presence::Cleared
    } else {
        Presence::Present
    })
}

/// Public, non-secret UI metadata. It never substitutes for secret access checks.
pub(crate) fn mark(service: &str, account: &str, cleared: bool) -> keyring_core::Result<()> {
    let pairs = scoped_query(service, account).map_err(|status| {
        keyring_core::Error::PlatformFailure(Box::new(std::io::Error::other(format!(
            "Secure storage metadata unavailable ({status})"
        ))))
    })?;
    let query = CFDictionary::from_CFType_pairs(&pairs);
    let changes = CFDictionary::from_CFType_pairs(&[(
        unsafe { key(kSecAttrComment) },
        CFString::new(if cleared { CLEARED } else { SAVED }),
    )]);
    let status =
        unsafe { SecItemUpdate(query.as_concrete_TypeRef(), changes.as_concrete_TypeRef()) };
    if status == 0 {
        Ok(())
    } else {
        Err(keyring_core::Error::PlatformFailure(Box::new(
            std::io::Error::other(format!("Secure storage metadata update failed ({status})")),
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Explicit acceptance lane only: creates and removes one synthetic record.
    #[test]
    #[ignore = "requires an unlocked user keychain; uses only a new synthetic service"]
    fn native_metadata_lifecycle() {
        use security_framework_sys::keychain_item::SecItemDelete;
        let service = format!("Glossa Metadata Acceptance {}", std::process::id());
        let account = "synthetic-only";
        struct Cleanup(String);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                if let Ok(pairs) = scoped_query(&self.0, "synthetic-only") {
                    let query = CFDictionary::from_CFType_pairs(&pairs);
                    unsafe {
                        SecItemDelete(query.as_concrete_TypeRef());
                    }
                }
            }
        }
        let _cleanup = Cleanup(service.clone());
        assert_eq!(query(&service, account), Ok(Presence::Absent));
        let keychain = SecKeychain::default_for_domain(SecPreferencesDomain::User).unwrap();
        keychain
            .set_generic_password(&service, account, b"synthetic-not-a-real-key")
            .unwrap();
        mark(&service, account, false).unwrap();
        assert_eq!(query(&service, account), Ok(Presence::Present));
        assert_eq!(
            query(&format!("{service} Dev"), account),
            Ok(Presence::Absent)
        );
        mark(&service, account, true).unwrap();
        assert_eq!(query(&service, account), Ok(Presence::Cleared));
        mark(&service, account, false).unwrap();
        assert_eq!(query(&service, account), Ok(Presence::Present));
    }

    #[test]
    fn query_has_no_secret_return_and_forbids_ui() {
        let pairs = exact_query("fixture-service", "fixture-account");
        let dict = CFDictionary::from_CFType_pairs(&pairs);
        assert!(dict.find(unsafe { key(kSecReturnData) }).is_none());
        assert_eq!(
            dict.find(unsafe { key(kSecUseAuthenticationUI) })
                .unwrap()
                .downcast::<CFString>()
                .unwrap(),
            unsafe { key(kSecUseAuthenticationUIFail) }
        );
        assert_eq!(
            dict.find(unsafe { key(kSecAttrAccount) })
                .unwrap()
                .downcast::<CFString>()
                .unwrap()
                .to_string(),
            "fixture-account"
        );
    }
}
