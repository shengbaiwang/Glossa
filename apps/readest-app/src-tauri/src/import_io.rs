use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Manager};
use tauri_plugin_fs::FsExt;

const BUFFER_SIZE: usize = 256 * 1024;
static OPERATIONS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

fn operations() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    OPERATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

struct Operation {
    id: String,
    cancelled: Arc<AtomicBool>,
}

impl Operation {
    fn start(id: &str) -> Result<Self, String> {
        if id.is_empty() || id.len() > 128 {
            return Err("import_io_invalid_operation".into());
        }
        let mut operations = operations().lock().map_err(|_| "import_io_lock_failed")?;
        if operations.contains_key(id) {
            return Err("import_io_duplicate_operation".into());
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        operations.insert(id.to_string(), cancelled.clone());
        Ok(Self {
            id: id.to_string(),
            cancelled,
        })
    }

    fn check(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::Relaxed) {
            Err("import_io_cancelled".into())
        } else {
            Ok(())
        }
    }
}

impl Drop for Operation {
    fn drop(&mut self) {
        if let Ok(mut operations) = operations().lock() {
            operations.remove(&self.id);
        }
    }
}

#[tauri::command]
pub fn cancel_import_io(operation_id: String) {
    if let Ok(operations) = operations().lock() {
        if let Some(cancelled) = operations.get(&operation_id) {
            cancelled.store(true, Ordering::Relaxed);
        }
    }
}

fn has_disallowed_components(path: &Path) -> bool {
    !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
}

fn ensure_allowed(app: &AppHandle, path: &Path) -> Result<(), String> {
    if has_disallowed_components(path) {
        return Err("import_io_invalid_path".into());
    }
    #[cfg(feature = "webdriver")]
    {
        let _ = app;
        return Ok(());
    }
    #[cfg(not(feature = "webdriver"))]
    {
        let text = path.to_string_lossy();
        let app_storage = text.contains("Readest") || text.contains(&app.config().identifier);
        if app_storage
            || app.fs_scope().is_allowed(path)
            || app.asset_protocol_scope().is_allowed(path)
        {
            Ok(())
        } else {
            Err("import_io_access_denied".into())
        }
    }
}

fn source_path(app: &AppHandle, source: &str) -> Result<PathBuf, String> {
    let requested = PathBuf::from(source);
    ensure_allowed(app, &requested)?;
    let canonical = requested
        .canonicalize()
        .map_err(|_| "import_io_read_failed")?;
    ensure_allowed(app, &canonical).map_err(|_| "import_io_canonical_denied")?;
    if !canonical.is_file() {
        return Err("import_io_read_failed".into());
    }
    Ok(canonical)
}

fn destination_path(app: &AppHandle, destination: &str) -> Result<PathBuf, String> {
    let requested = PathBuf::from(destination);
    ensure_allowed(app, &requested)?;
    let parent = requested.parent().ok_or("import_io_invalid_destination")?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| "import_io_invalid_destination")?;
    ensure_allowed(app, &canonical_parent)?;
    let filename = requested
        .file_name()
        .ok_or("import_io_invalid_destination")?;
    Ok(canonical_parent.join(filename))
}

fn fingerprint(path: &Path, operation: &Operation) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|_| "import_io_read_failed")?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; BUFFER_SIZE];
    loop {
        operation.check()?;
        let read = file
            .read(&mut buffer)
            .map_err(|_| "import_io_read_failed")?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

fn copy_verified(
    source: &Path,
    destination: &Path,
    expected: &str,
    operation: &Operation,
) -> Result<String, String> {
    let mut input = fs::File::open(source).map_err(|_| "import_io_read_failed")?;
    let temporary = destination.with_extension(format!("importing-{}", operation.id));
    if temporary.exists() {
        return Err("import_io_invalid_destination".into());
    }
    let result = (|| {
        let mut output = fs::File::create_new(&temporary).map_err(|_| "import_io_write_failed")?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0_u8; BUFFER_SIZE];
        loop {
            operation.check()?;
            let read = input
                .read(&mut buffer)
                .map_err(|_| "import_io_read_failed")?;
            if read == 0 {
                break;
            }
            output
                .write_all(&buffer[..read])
                .map_err(|_| "import_io_write_failed")?;
            hasher.update(&buffer[..read]);
        }
        output.flush().map_err(|_| "import_io_write_failed")?;
        drop(output);
        let actual = format!("sha256:{:x}", hasher.finalize());
        if actual != expected {
            return Err("import_io_source_changed".into());
        }
        fs::rename(&temporary, destination).map_err(|_| "import_io_write_failed")?;
        Ok(actual)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[tauri::command]
pub async fn import_fingerprint(
    app: AppHandle,
    source: String,
    operation_id: String,
) -> Result<String, String> {
    let operation = Operation::start(&operation_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let source = source_path(&app, &source)?;
        fingerprint(&source, &operation)
    })
    .await
    .map_err(|_| "import_io_join_failed")?
}

#[tauri::command]
pub async fn import_copy_verified(
    app: AppHandle,
    source: String,
    destination: String,
    expected: String,
    operation_id: String,
) -> Result<String, String> {
    let operation = Operation::start(&operation_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let source = source_path(&app, &source)?;
        let destination = destination_path(&app, &destination)?;
        copy_verified(&source, &destination, &expected, &operation)
    })
    .await
    .map_err(|_| "import_io_join_failed")?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir()
                .join(format!("glossa-import-io-{}-{nonce}", std::process::id()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn operation(id: &str) -> Operation {
        Operation::start(id).unwrap()
    }

    #[test]
    fn hashes_every_byte_with_a_bounded_buffer() {
        let dir = TestDir::new();
        let source = dir.0.join("source.bin");
        fs::write(&source, b"abc").unwrap();
        let operation = operation("hash-test");
        assert_eq!(
            fingerprint(&source, &operation).unwrap(),
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn copies_and_hashes_in_one_pass_and_rejects_changed_bytes() {
        let dir = TestDir::new();
        let source = dir.0.join("source.bin");
        let destination = dir.0.join("destination.bin");
        fs::write(&source, b"expected").unwrap();
        let expected = fingerprint(&source, &operation("expected-hash")).unwrap();
        let actual =
            copy_verified(&source, &destination, &expected, &operation("copy-ok")).unwrap();
        assert_eq!(actual, expected);
        assert_eq!(fs::read(&destination).unwrap(), b"expected");

        let second = dir.0.join("second.bin");
        let error = copy_verified(
            &source,
            &second,
            "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            &operation("copy-mismatch"),
        )
        .unwrap_err();
        assert_eq!(error, "import_io_source_changed");
        assert!(!second.exists());
        assert!(!dir.0.join("second.importing-copy-mismatch").exists());
    }

    #[test]
    fn cancellation_does_not_publish_a_partial_copy() {
        let dir = TestDir::new();
        let source = dir.0.join("source.bin");
        let destination = dir.0.join("destination.bin");
        fs::write(&source, vec![1_u8; BUFFER_SIZE * 2]).unwrap();
        let operation = operation("copy-cancel");
        operation.cancelled.store(true, Ordering::Relaxed);
        assert_eq!(
            copy_verified(&source, &destination, "sha256:any", &operation).unwrap_err(),
            "import_io_cancelled"
        );
        assert!(!destination.exists());
    }
}
