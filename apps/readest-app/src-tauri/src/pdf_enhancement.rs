//! Local PDF sidecars. The source file and the book's identity/CFIs never change.
use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    process::Child,
    sync::{Arc, Mutex, OnceLock},
};
#[cfg(target_os = "macos")]
use std::{
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

const VERSION: &str = "vision-pdf-1";
const PAGE_LIMIT: u64 = 4 * 1024 * 1024;
#[cfg(target_os = "macos")]
const CACHE_LIMIT: u64 = 512 * 1024 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineEntry {
    title: String,
    page_index: usize,
    level: usize,
}
#[derive(Default, Deserialize, Serialize)]
struct OutlineFile {
    revision: u64,
    outline: Option<Vec<OutlineEntry>>,
}
#[derive(Serialize)]
pub struct CacheInfo {
    id: String,
    pages: Vec<usize>,
    outline: Option<Vec<OutlineEntry>>,
    revision: u64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobStatus {
    cache_id: String,
    state: String,
    completed: usize,
    total: usize,
    error: Option<String>,
}
struct Job {
    status: JobStatus,
    child: Arc<Mutex<Child>>,
}
static JOB: OnceLock<Mutex<Option<Job>>> = OnceLock::new();
static OUTLINE_LOCK: Mutex<()> = Mutex::new(());
fn jobs() -> &'static Mutex<Option<Job>> {
    JOB.get_or_init(|| Mutex::new(None))
}
fn error(_: impl std::fmt::Debug) -> String {
    "pdf_storage_error".into()
}
fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(error)?
        .join("pdf-local-v1"))
}
fn cache_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if id.len() != 32
        || !id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err("invalid_pdf_cache".into());
    }
    Ok(root(app)?.join(id))
}
fn fingerprint(app: &AppHandle, source: &str) -> Result<(PathBuf, String), String> {
    let path = PathBuf::from(source).canonicalize().map_err(error)?;
    if !app.asset_protocol_scope().is_allowed(&path) {
        return Err("pdf_access_denied".into());
    }
    let mut file = File::open(&path).map_err(error)?;
    let meta = file.metadata().map_err(error)?;
    if !meta.is_file() || meta.len() > 2 * 1024 * 1024 * 1024 {
        return Err("pdf_size_limit".into());
    }
    let mut hasher = Md5::new();
    let mut buffer = [0_u8; 65536];
    let mut first = true;
    loop {
        let n = file.read(&mut buffer).map_err(error)?;
        if n == 0 {
            break;
        }
        if first && !buffer[..n].starts_with(b"%PDF-") {
            return Err("invalid_pdf".into());
        }
        first = false;
        hasher.update(&buffer[..n]);
    }
    if first {
        return Err("invalid_pdf".into());
    }
    Ok((path, format!("{:x}", hasher.finalize())))
}
fn read_json(path: &Path, limit: u64) -> Option<serde_json::Value> {
    let file = File::open(path).ok()?;
    if file.metadata().ok()?.len() > limit {
        return None;
    }
    serde_json::from_reader(file.take(limit)).ok()
}
fn valid_page(value: &serde_json::Value, index: usize) -> bool {
    if value["index"].as_u64() != Some(index as u64) || !value["native"].is_boolean() {
        return false;
    }
    let Some(lines) = value["lines"].as_array() else {
        return false;
    };
    if lines.len() > 10000 {
        return false;
    }
    let mut chars = 0;
    for line in lines {
        let Some(text) = line["text"].as_str() else {
            return false;
        };
        let len = text.chars().count();
        chars += len;
        if len == 0 || len > 10000 || chars > 100000 {
            return false;
        }
        let (Some(x), Some(y), Some(w), Some(h)) = (
            line["x"].as_f64(),
            line["y"].as_f64(),
            line["width"].as_f64(),
            line["height"].as_f64(),
        ) else {
            return false;
        };
        if x < 0.0 || y < 0.0 || w <= 0.0 || h <= 0.0 || x + w > 1.001 || y + h > 1.001 {
            return false;
        }
    }
    true
}
fn page_path(dir: &Path, index: usize) -> PathBuf {
    dir.join(VERSION).join(format!("page-{index}.json"))
}
fn read_page(dir: &Path, index: usize) -> Option<serde_json::Value> {
    let value = read_json(&page_path(dir, index), PAGE_LIMIT)?;
    valid_page(&value, index).then_some(value)
}
fn info(dir: &Path, id: String) -> Result<CacheInfo, String> {
    let mut pages = Vec::new();
    for entry in fs::read_dir(dir.join(VERSION)).into_iter().flatten() {
        let name = entry
            .map_err(error)?
            .file_name()
            .to_string_lossy()
            .into_owned();
        if let Some(index) = name
            .strip_prefix("page-")
            .and_then(|n| n.strip_suffix(".json"))
            .and_then(|n| n.parse::<usize>().ok())
        {
            if index < 5000 && read_page(dir, index).is_some() {
                pages.push(index);
            }
        }
    }
    pages.sort_unstable();
    let outline = if dir.join("outline.json").exists() {
        serde_json::from_value::<OutlineFile>(
            read_json(&dir.join("outline.json"), 1024 * 1024).ok_or("invalid_pdf_outline")?,
        )
        .map_err(error)?
    } else {
        OutlineFile::default()
    };
    Ok(CacheInfo {
        id,
        pages,
        outline: outline.outline,
        revision: outline.revision,
    })
}
#[cfg(target_os = "macos")]
fn cache_size(path: &Path) -> u64 {
    fs::read_dir(path)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| {
            entry
                .metadata()
                .map(|m| {
                    if m.is_dir() {
                        cache_size(&entry.path())
                    } else {
                        m.len()
                    }
                })
                .unwrap_or(0)
        })
        .sum()
}

#[tauri::command]
pub async fn pdf_open_cache(
    app: AppHandle,
    source: String,
    create: bool,
) -> Result<Option<CacheInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (_, id) = fingerprint(&app, &source)?;
        let dir = cache_dir(&app, &id)?;
        if !dir.exists() && !create {
            return Ok(None);
        }
        fs::create_dir_all(&dir).map_err(error)?;
        info(&dir, id).map(Some)
    })
    .await
    .map_err(error)?
}
#[tauri::command]
pub async fn pdf_read_ocr_page(
    app: AppHandle,
    cache_id: String,
    index: usize,
) -> Result<Option<serde_json::Value>, String> {
    if index >= 5000 {
        return Err("invalid_pdf_page".into());
    }
    tauri::async_runtime::spawn_blocking(move || Ok(read_page(&cache_dir(&app, &cache_id)?, index)))
        .await
        .map_err(error)?
}

#[cfg(target_os = "macos")]
fn helper(app: &AppHandle) -> Result<PathBuf, String> {
    use std::os::unix::fs::PermissionsExt;
    let bytes = include_bytes!(concat!(env!("OUT_DIR"), "/glossa-pdf-ocr"));
    let digest = format!("{:x}", Md5::digest(bytes));
    let dir = app.path().app_cache_dir().map_err(error)?.join("pdf-tools");
    fs::create_dir_all(&dir).map_err(error)?;
    let path = dir.join(format!("ocr-{digest}"));
    // Verify even an existing worker; a writable cache must not supply executable code.
    let existing = fs::read(&path).ok();
    if existing.as_deref() != Some(bytes.as_slice()) {
        let tmp = dir.join(format!("ocr-{digest}.tmp"));
        fs::write(&tmp, bytes).map_err(error)?;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o700)).map_err(error)?;
        fs::rename(tmp, &path).map_err(error)?;
    }
    Ok(path)
}

#[tauri::command]
pub async fn pdf_start_ocr(
    app: AppHandle,
    source: String,
    cache_id: String,
    pages: Vec<usize>,
) -> Result<JobStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app, source, cache_id, pages);
            Err("pdf_ocr_unsupported".into())
        }
        #[cfg(target_os = "macos")]
        {
            let mut pages = pages;
            let mut guard = jobs().lock().map_err(error)?;
            if guard.as_ref().is_some_and(|j| j.status.state == "running") {
                return Err("pdf_ocr_busy".into());
            }
            pages.sort_unstable();
            pages.dedup();
            if pages.is_empty() || pages.len() > 5000 || pages.iter().any(|i| *i >= 5000) {
                return Err("pdf_page_limit".into());
            }
            let (path, id) = fingerprint(&app, &source)?;
            if id != cache_id {
                return Err("pdf_source_changed".into());
            }
            let dir = cache_dir(&app, &id)?;
            fs::create_dir_all(dir.join(VERSION)).map_err(error)?;
            if cache_size(&root(&app)?) >= 1024 * 1024 * 1024 || cache_size(&dir) >= CACHE_LIMIT {
                return Err("pdf_cache_limit".into());
            }
            for index in &pages {
                if read_page(&dir, *index).is_none() {
                    let _ = fs::remove_file(page_path(&dir, *index));
                }
            }
            let _ = fs::remove_file(dir.join(VERSION).join("progress.json"));
            let child = Command::new(helper(&app)?)
                .arg(&path)
                .arg(dir.join(VERSION))
                .arg(
                    pages
                        .iter()
                        .map(usize::to_string)
                        .collect::<Vec<_>>()
                        .join(","),
                )
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|_| "pdf_worker_unavailable")?;
            let child = Arc::new(Mutex::new(child));
            let status = JobStatus {
                cache_id: id.clone(),
                state: "running".into(),
                completed: 0,
                total: pages.len(),
                error: None,
            };
            *guard = Some(Job {
                status: status.clone(),
                child: child.clone(),
            });
            drop(guard);
            std::thread::spawn(move || {
                let started = Instant::now();
                let outcome = loop {
                    std::thread::sleep(Duration::from_millis(300));
                    let progress = read_json(&dir.join(VERSION).join("progress.json"), 256);
                    if let Ok(mut guard) = jobs().lock() {
                        if let Some(job) = guard.as_mut().filter(|j| Arc::ptr_eq(&j.child, &child))
                        {
                            job.status.completed = progress
                                .as_ref()
                                .and_then(|p| p["completed"].as_u64())
                                .unwrap_or(0)
                                .min(job.status.total as u64)
                                as usize;
                        }
                    }
                    if started.elapsed() > Duration::from_secs(1800)
                        || cache_size(&dir) > CACHE_LIMIT
                    {
                        if let Ok(mut c) = child.lock() {
                            let _ = c.kill();
                            let _ = c.wait();
                        }
                        break Err("pdf_processing_limit");
                    }
                    match child
                        .lock()
                        .map_err(error)
                        .and_then(|mut c| c.try_wait().map_err(error))
                    {
                        Ok(Some(exit)) => {
                            break if exit.success() {
                                Ok(())
                            } else {
                                Err("pdf_recognition_failed")
                            }
                        }
                        Ok(None) => {}
                        Err(_) => break Err("pdf_worker_unavailable"),
                    }
                };
                let unchanged = fingerprint(&app, &source)
                    .map(|(_, hash)| hash == id)
                    .unwrap_or(false);
                if let Ok(mut guard) = jobs().lock() {
                    if let Some(job) = guard.as_mut().filter(|j| Arc::ptr_eq(&j.child, &child)) {
                        if !unchanged {
                            // A changed source cannot leave resumable text under the old hash.
                            let _ = fs::remove_dir_all(dir.join(VERSION));
                        }
                        if job.status.state == "running" {
                            match outcome {
                                Ok(()) if unchanged => {
                                    job.status.state = "completed".into();
                                    job.status.completed = job.status.total;
                                }
                                _ => {
                                    job.status.state = "failed".into();
                                    job.status.error = Some(
                                        if unchanged {
                                            outcome.err().unwrap_or("pdf_recognition_failed")
                                        } else {
                                            "pdf_source_changed"
                                        }
                                        .into(),
                                    );
                                }
                            }
                        }
                    }
                }
            });
            Ok(status)
        }
    })
    .await
    .map_err(error)?
}
#[tauri::command]
pub fn pdf_ocr_status(cache_id: String) -> Result<Option<JobStatus>, String> {
    Ok(jobs()
        .lock()
        .map_err(error)?
        .as_ref()
        .filter(|j| j.status.cache_id == cache_id)
        .map(|j| j.status.clone()))
}
#[tauri::command]
pub fn pdf_cancel_ocr(cache_id: String) -> Result<(), String> {
    if let Some(job) = jobs()
        .lock()
        .map_err(error)?
        .as_mut()
        .filter(|j| j.status.cache_id == cache_id && j.status.state == "running")
    {
        let mut child = job.child.lock().map_err(error)?;
        child.kill().map_err(error)?;
        child.wait().map_err(error)?;
        job.status.state = "cancelled".into();
    }
    Ok(())
}
pub fn stop() {
    if let Ok(mut guard) = jobs().lock() {
        if let Some(job) = guard.as_mut() {
            if job.status.state == "running" {
                if let Ok(mut child) = job.child.lock() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                job.status.state = "cancelled".into();
            }
        }
    }
}
fn validate_outline(entries: &[OutlineEntry], page_count: usize) -> bool {
    if entries.len() > 1000 || page_count == 0 || page_count > 5000 {
        return false;
    }
    let mut previous = 0;
    for (i, entry) in entries.iter().enumerate() {
        if entry.title.trim().is_empty()
            || entry.title.chars().count() > 500
            || entry.page_index >= page_count
            || entry.level > 5
            || entry.level > if i == 0 { 0 } else { previous + 1 }
        {
            return false;
        }
        previous = entry.level;
    }
    true
}
#[tauri::command]
pub async fn pdf_save_outline(
    app: AppHandle,
    source: String,
    cache_id: String,
    revision: u64,
    outline: Option<Vec<OutlineEntry>>,
    page_count: usize,
) -> Result<CacheInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if outline
            .as_ref()
            .is_some_and(|e| !validate_outline(e, page_count))
        {
            return Err("invalid_pdf_outline".into());
        }
        let (_, id) = fingerprint(&app, &source)?;
        if id != cache_id {
            return Err("pdf_source_changed".into());
        }
        let _lock = OUTLINE_LOCK.lock().map_err(error)?;
        let dir = cache_dir(&app, &id)?;
        let current = info(&dir, id.clone())?;
        if current.revision != revision {
            return Err("pdf_outline_conflict".into());
        }
        let content = serde_json::to_vec(&OutlineFile {
            revision: revision + 1,
            outline,
        })
        .map_err(error)?;
        fs::write(dir.join("outline.tmp"), content).map_err(error)?;
        fs::rename(dir.join("outline.tmp"), dir.join("outline.json")).map_err(error)?;
        info(&dir, id)
    })
    .await
    .map_err(error)?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_page_mismatch_and_invalid_geometry() {
        let page = serde_json::json!({"index":0,"native":false,"lines":[{"text":"original","x":0.1,"y":0.2,"width":0.3,"height":0.04}]});
        assert!(valid_page(&page, 0));
        assert!(!valid_page(&page, 1));
        let mut bad = page.clone();
        bad["lines"][0]["width"] = 2.into();
        assert!(!valid_page(&bad, 0));
    }
    #[test]
    fn rejects_out_of_range_and_broken_hierarchies() {
        let entry = |page_index, level| OutlineEntry {
            title: "Original".into(),
            page_index,
            level,
        };
        assert!(validate_outline(&[entry(0, 0), entry(1, 1)], 2));
        assert!(!validate_outline(&[entry(2, 0)], 2));
        assert!(!validate_outline(&[entry(0, 1)], 2));
        assert!(!validate_outline(&[entry(0, 0), entry(1, 2)], 2));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn real_local_worker_resumes_original_scan_and_preserves_source() {
        use std::os::unix::fs::PermissionsExt;
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("glossa-ocr-test-{unique}"));
        fs::create_dir_all(dir.join(VERSION)).unwrap();
        let fixture = include_bytes!("../../src/__tests__/fixtures/data/glossa-ocr-sample.pdf");
        let source = dir.join("original.pdf");
        fs::write(&source, fixture).unwrap();
        let executable = dir.join("worker");
        fs::write(
            &executable,
            include_bytes!(concat!(env!("OUT_DIR"), "/glossa-pdf-ocr")),
        )
        .unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
        let launch = || {
            Command::new(&executable)
                .arg(&source)
                .arg(dir.join(VERSION))
                .arg("0,1,2,3")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap()
        };
        let mut first = launch();
        let started = Instant::now();
        while read_page(&dir, 0).is_none() && started.elapsed() < Duration::from_secs(30) {
            std::thread::sleep(Duration::from_millis(10));
        }
        let _ = first.kill();
        let _ = first.wait();
        let saved = fs::read(page_path(&dir, 0)).expect("first page checkpoint");
        let modified = fs::metadata(page_path(&dir, 0))
            .unwrap()
            .modified()
            .unwrap();
        assert!(launch().wait().unwrap().success());
        assert_eq!(fs::read(page_path(&dir, 0)).unwrap(), saved);
        assert_eq!(
            fs::metadata(page_path(&dir, 0))
                .unwrap()
                .modified()
                .unwrap(),
            modified
        );
        assert_eq!(fs::read(&source).unwrap(), fixture);
        let page = read_page(&dir, 1).unwrap();
        let text = page["lines"]
            .as_array()
            .unwrap()
            .iter()
            .map(|w| w["text"].as_str().unwrap())
            .collect::<String>();
        assert!(text.contains("Copper marker"));
        assert!(text.contains("本地阅读与文字识别"));
        assert!(read_page(&dir, 2).is_some(), "rotated page geometry");
        assert_eq!(read_page(&dir, 3).unwrap()["native"], true);
        fs::remove_dir_all(&dir).unwrap();
    }
}
