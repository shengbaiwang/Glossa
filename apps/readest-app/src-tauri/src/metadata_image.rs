//! Bounded local OCR for an embedded EPUB image. No caller-supplied file paths.
#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::AppHandle;

#[cfg(target_os = "macos")]
static ACTIVE: AtomicBool = AtomicBool::new(false);
static CANCELLED: Mutex<Vec<String>> = Mutex::new(Vec::new());
#[cfg(target_os = "macos")]
pub(crate) fn is_busy() -> bool {
    ACTIVE.load(Ordering::SeqCst)
}
fn valid_job(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}
#[cfg(any(target_os = "macos", test))]
fn cancelled(id: &str) -> bool {
    CANCELLED
        .lock()
        .map(|jobs| jobs.iter().any(|job| job == id))
        .unwrap_or(true)
}
#[tauri::command]
pub fn metadata_cancel_image_ocr(job_id: String) -> Result<(), String> {
    if !valid_job(&job_id) {
        return Err("metadata_image_invalid".into());
    }
    let mut jobs = CANCELLED.lock().map_err(|_| "metadata_image_failed")?;
    if !jobs.contains(&job_id) {
        if jobs.len() >= 64 {
            jobs.remove(0);
        }
        jobs.push(job_id);
    }
    Ok(())
}
#[tauri::command]
pub async fn metadata_recognize_image(
    app: AppHandle,
    job_id: String,
    data: Vec<u8>,
) -> Result<String, String> {
    if !valid_job(&job_id) || data.is_empty() || data.len() > 8 * 1024 * 1024 {
        return Err("metadata_image_limit".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app, job_id, data);
            Err("metadata_ocr_unavailable".into())
        }
        #[cfg(target_os = "macos")]
        {
            use std::os::unix::fs::PermissionsExt;
            use std::{
                fs,
                process::{Command, Stdio},
                time::{Duration, Instant},
            };
            use tauri::Manager;
            struct ActiveGuard;
            impl Drop for ActiveGuard {
                fn drop(&mut self) {
                    ACTIVE.store(false, Ordering::SeqCst);
                }
            }
            let lock = crate::pdf_enhancement::CACHE_LOCK
                .lock()
                .map_err(|_| "metadata_image_failed")?;
            if cancelled(&job_id) {
                return Err("metadata_image_cancelled".into());
            }
            if crate::pdf_enhancement::local_pdf_ocr_busy()? || ACTIVE.swap(true, Ordering::SeqCst)
            {
                return Err("pdf_ocr_busy".into());
            }
            let _active = ActiveGuard;
            drop(lock);
            let parent = app
                .path()
                .app_cache_dir()
                .map_err(|_| "metadata_image_failed")?
                .join("metadata-images");
            fs::create_dir_all(&parent).map_err(|_| "metadata_image_failed")?;
            let work = parent.join(format!("{}-{job_id}", std::process::id()));
            fs::create_dir(&work).map_err(|_| "metadata_image_failed")?;
            let result = (|| {
                fs::set_permissions(&work, fs::Permissions::from_mode(0o700))
                    .map_err(|_| "metadata_image_failed")?;
                let source = work.join("image");
                let output = work.join("text");
                fs::write(&source, data).map_err(|_| "metadata_image_failed")?;
                if cancelled(&job_id) {
                    return Err("metadata_image_cancelled".into());
                }
                let mut child = Command::new(crate::pdf_enhancement::helper(&app)?)
                    .arg("--image")
                    .arg(&source)
                    .arg(&output)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .map_err(|_| "metadata_image_failed")?;
                let start = Instant::now();
                loop {
                    if cancelled(&job_id) || start.elapsed() >= Duration::from_secs(30) {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err("metadata_image_cancelled".into());
                    }
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            if !status.success() {
                                return Err("metadata_image_failed".into());
                            }
                            break;
                        }
                        Ok(None) => std::thread::sleep(Duration::from_millis(50)),
                        Err(_) => {
                            let _ = child.kill();
                            let _ = child.wait();
                            return Err("metadata_image_failed".into());
                        }
                    }
                }
                if cancelled(&job_id) {
                    return Err("metadata_image_cancelled".into());
                }
                if fs::metadata(&output)
                    .map_err(|_| "metadata_image_failed")?
                    .len()
                    > 96000
                {
                    return Err("metadata_image_limit".into());
                }
                fs::read_to_string(output).map_err(|_| "metadata_image_failed".into())
            })();
            let _ = fs::remove_dir_all(work);
            result
        }
    })
    .await
    .map_err(|_| "metadata_image_failed")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ids_cannot_supply_paths() {
        assert!(valid_job("8b04af30-f6fa-4ef4-94ec-5015d951c195"));
        for id in ["", "../source", "a/b", "a\\b", "a\0b"] {
            assert!(!valid_job(id));
        }
        assert!(!valid_job(&"x".repeat(81)));
    }
    #[test]
    fn cancellation_before_start_is_remembered() {
        let id = "metadata-test-cancel-before-start";
        metadata_cancel_image_ocr(id.into()).unwrap();
        assert!(cancelled(id));
    }
}
