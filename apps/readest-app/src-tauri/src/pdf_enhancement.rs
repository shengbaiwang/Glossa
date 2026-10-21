//! Local PDF sidecars. The source file and the book's identity/CFIs never change.
use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    process::Child,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
};
#[cfg(target_os = "macos")]
use std::{
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

const VERSION: &str = "vision-pdf-1";
const DETECTION_VERSION: &str = "vision-detect-1";
const CONTENTS_VERSION: &str = "vision-contents-1";
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
    #[serde(default)]
    generator: Option<String>,
}
#[derive(Serialize)]
pub struct CacheInfo {
    id: String,
    pages: Vec<usize>,
    outline: Option<Vec<OutlineEntry>>,
    revision: u64,
    generator: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobStatus {
    cache_id: String,
    job_id: String,
    state: String,
    completed: usize,
    total: usize,
    error: Option<String>,
}
impl JobStatus {
    fn owned_by(&self, cache_id: &str, job_id: Option<&str>) -> bool {
        self.cache_id == cache_id && job_id == Some(self.job_id.as_str())
    }
}
struct Job {
    status: JobStatus,
    child: Arc<Mutex<Child>>,
}
static JOB: OnceLock<Mutex<Option<Job>>> = OnceLock::new();
static NEXT_JOB: AtomicU64 = AtomicU64::new(1);
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
    read_page_version(dir, index, VERSION)
}
fn read_page_version(dir: &Path, index: usize, version: &str) -> Option<serde_json::Value> {
    let path = if version == VERSION {
        page_path(dir, index)
    } else {
        dir.join(version).join(format!("page-{index}.json"))
    };
    let value = read_json(&path, PAGE_LIMIT)?;
    valid_page(&value, index).then_some(value)
}
fn ocr_version(detect: bool, contents: bool) -> Result<&'static str, String> {
    match (detect, contents) {
        (true, true) => Err("invalid_pdf_ocr_mode".into()),
        (true, false) => Ok(DETECTION_VERSION),
        (false, true) => Ok(CONTENTS_VERSION),
        (false, false) => Ok(VERSION),
    }
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
        generator: outline.generator,
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
    detect: Option<bool>,
    contents: Option<bool>,
) -> Result<Option<serde_json::Value>, String> {
    if index >= 5000 {
        return Err("invalid_pdf_page".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let version = ocr_version(detect.unwrap_or(false), contents.unwrap_or(false))?;
        Ok(read_page_version(
            &cache_dir(&app, &cache_id)?,
            index,
            version,
        ))
    })
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
    detect: Option<bool>,
    contents: Option<bool>,
) -> Result<JobStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app, source, cache_id, pages, detect, contents);
            Err("pdf_ocr_unsupported".into())
        }
        #[cfg(target_os = "macos")]
        {
            let mut pages = pages;
            let detect = detect.unwrap_or(false);
            let contents = contents.unwrap_or(false);
            let version = ocr_version(detect, contents)?;
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
            fs::create_dir_all(dir.join(version)).map_err(error)?;
            if cache_size(&root(&app)?) >= 1024 * 1024 * 1024 || cache_size(&dir) >= CACHE_LIMIT {
                return Err("pdf_cache_limit".into());
            }
            for index in &pages {
                if read_page_version(&dir, *index, version).is_none() {
                    let _ = fs::remove_file(dir.join(version).join(format!("page-{index}.json")));
                }
            }
            let _ = fs::remove_file(dir.join(version).join("progress.json"));
            let mut command = Command::new(helper(&app)?);
            if detect {
                command.arg("--detect");
            } else if contents {
                command.arg("--contents");
            }
            let child = command
                .arg(&path)
                .arg(dir.join(version))
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
                job_id: format!(
                    "{}-{}",
                    std::process::id(),
                    NEXT_JOB.fetch_add(1, Ordering::Relaxed)
                ),
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
                    let progress = read_json(&dir.join(version).join("progress.json"), 256);
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
                            let _ = fs::remove_dir_all(dir.join(version));
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
pub fn pdf_cancel_ocr(cache_id: String, job_id: Option<String>) -> Result<(), String> {
    if let Some(job) =
        jobs().lock().map_err(error)?.as_mut().filter(|j| {
            j.status.owned_by(&cache_id, job_id.as_deref()) && j.status.state == "running"
        })
    {
        let mut child = job.child.lock().map_err(error)?;
        child.kill().map_err(error)?;
        child.wait().map_err(error)?;
        job.status.state = "cancelled".into();
    }
    Ok(())
}
pub fn stop() {
    if let Ok(active) = EXPORT_JOB.lock() {
        if let Some(job) = active.as_ref() {
            job.cancelled
                .store(true, std::sync::atomic::Ordering::SeqCst);
            if let Some(child) = &job.child {
                if let Ok(mut child) = child.lock() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    }
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
    generator: Option<String>,
) -> Result<CacheInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if generator.as_deref().is_some_and(|value| {
            value != "glossa-contents-2"
                && value != "glossa-contents-3"
                && value != "glossa-pages-1"
        }) {
            return Err("invalid_pdf_outline".into());
        }
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
            generator,
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
    fn contents_evidence_and_detection_are_separate_from_reading_text() {
        assert_eq!(ocr_version(false, false).unwrap(), VERSION);
        assert_eq!(ocr_version(true, false).unwrap(), DETECTION_VERSION);
        assert_eq!(ocr_version(false, true).unwrap(), CONTENTS_VERSION);
        assert_eq!(ocr_version(true, true).unwrap_err(), "invalid_pdf_ocr_mode");
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn empty_ocr_recovery_is_bounded_and_preserves_existing_layers() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("glossa-ocr-recovery-test-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("main.swift");
        let mut script = include_bytes!("macos/pdf_ocr.swift").to_vec();
        script.push(b'\n');
        script.extend_from_slice(include_bytes!("macos/pdf_ocr_test.swift"));
        fs::write(&source, script).unwrap();
        let executable = dir.join("checks");
        assert!(Command::new("xcrun")
            .args(["swiftc", "-D", "PDF_OCR_TEST"])
            .arg(&source)
            .arg("-o")
            .arg(&executable)
            .status()
            .unwrap()
            .success());
        assert!(Command::new(&executable).status().unwrap().success());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn a_late_cancel_cannot_stop_a_new_job_for_the_same_book() {
        let status = JobStatus {
            cache_id: "book".into(),
            job_id: "second".into(),
            state: "running".into(),
            completed: 0,
            total: 1,
            error: None,
        };
        assert!(!status.owned_by("book", Some("first")));
        assert!(!status.owned_by("book", None));
        assert!(!status.owned_by("other", Some("second")));
        assert!(status.owned_by("book", Some("second")));
    }
    #[test]
    fn legacy_outlines_remain_personal_and_automatic_provenance_round_trips() {
        let old: OutlineFile = serde_json::from_str(r#"{"revision":3,"outline":[]}"#).unwrap();
        assert!(old.generator.is_none());
        let generated: OutlineFile =
            serde_json::from_str(r#"{"revision":1,"outline":null,"generator":"glossa-pages-1"}"#)
                .unwrap();
        let reopened: OutlineFile =
            serde_json::from_slice(&serde_json::to_vec(&generated).unwrap()).unwrap();
        assert_eq!(reopened.generator.as_deref(), Some("glossa-pages-1"));
        assert!(reopened.outline.is_none());
    }
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

    #[test]
    fn rejects_unsafe_export_geometry_and_styles() {
        let mut note = ExportAnnotation {
            index: 0,
            rects: vec![ExportRect {
                x: 0.1,
                y: 0.2,
                width: 0.3,
                height: 0.1,
            }],
            text: "Original".into(),
            style: "highlight".into(),
            color: "yellow".into(),
        };
        assert!(valid_annotations(&[note]));
        note = ExportAnnotation {
            index: 0,
            rects: vec![ExportRect {
                x: 0.9,
                y: 0.2,
                width: 0.3,
                height: 0.1,
            }],
            text: "Original".into(),
            style: "highlight".into(),
            color: "yellow".into(),
        };
        assert!(!valid_annotations(&[note]));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn real_portable_pdf_preserves_source_and_exports_standard_data() {
        use std::os::unix::fs::PermissionsExt;
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("glossa-pdf-export-test-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let worker = dir.join("worker");
        fs::write(
            &worker,
            include_bytes!(concat!(env!("OUT_DIR"), "/glossa-pdf-ocr")),
        )
        .unwrap();
        fs::set_permissions(&worker, fs::Permissions::from_mode(0o700)).unwrap();
        let pages: Vec<serde_json::Value> = serde_json::from_str(include_str!(
            "../../src/__tests__/fixtures/data/glossa-ocr-pages.json"
        ))
        .unwrap();
        for page in &pages {
            let i = page["index"].as_u64().unwrap() as usize;
            assert!(valid_page(page, i));
            fs::write(
                dir.join(format!("page-{i}.json")),
                serde_json::to_vec(page).unwrap(),
            )
            .unwrap();
        }
        let inspector = dir.join("check.swift");
        fs::write(&inspector, include_bytes!("macos/pdf_export_test.swift")).unwrap();
        for native in [false, true] {
            let source = dir.join("original.pdf");
            let output = dir.join("copy.pdf");
            let fixture: &[u8] = if native {
                include_bytes!("../../src/__tests__/fixtures/data/glossa-reading-sample.pdf")
            } else {
                include_bytes!("../../src/__tests__/fixtures/data/glossa-ocr-sample.pdf")
            };
            fs::write(&source, fixture).unwrap();
            let request = if native {
                serde_json::json!({"annotations":[],"outline":null,"pages":[]})
            } else {
                let word = pages[1]["lines"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|w| w["text"] == "Copper ")
                    .unwrap();
                serde_json::json!({"annotations":[{"index":1,"rects":[{"x":word["x"],"y":word["y"],"width":word["width"],"height":word["height"]}],"text":"Portable original note","style":"highlight","color":"yellow"}],"outline":[{"title":"Reading","pageIndex":1,"level":0},{"title":"Rotated","pageIndex":2,"level":1}],"pages":[0,1,2,3]})
            };
            let manifest = dir.join("request.json");
            fs::write(&manifest, serde_json::to_vec(&request).unwrap()).unwrap();
            assert!(Command::new(&worker)
                .arg("--export")
                .arg(&source)
                .arg(&dir)
                .arg(&manifest)
                .arg(&output)
                .status()
                .unwrap()
                .success());
            let mut check = Command::new("xcrun");
            check.arg("swift").arg(&inspector).arg(&source).arg(&output);
            if native {
                check.arg("native");
            }
            assert!(check.status().unwrap().success());
            assert_eq!(fs::read(&source).unwrap(), fixture);
        }
        fs::remove_dir_all(dir).unwrap();
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
        // Low-resolution detection has its own resumable sidecar. It must
        // neither replace precise reading coordinates nor appear in CacheInfo.pages.
        fs::create_dir_all(dir.join(DETECTION_VERSION)).unwrap();
        let detect = || {
            Command::new(&executable)
                .arg("--detect")
                .arg(&source)
                .arg(dir.join(DETECTION_VERSION))
                .arg("0,1,2,3")
                .status()
                .unwrap()
        };
        assert!(detect().success());
        let detected = read_page_version(&dir, 1, DETECTION_VERSION).unwrap();
        assert!(detected["lines"]
            .as_array()
            .unwrap()
            .iter()
            .any(|line| line["text"].as_str().unwrap().contains("Copper")));
        let before = fs::metadata(dir.join(DETECTION_VERSION).join("page-1.json"))
            .unwrap()
            .modified()
            .unwrap();
        assert!(detect().success());
        assert_eq!(
            before,
            fs::metadata(dir.join(DETECTION_VERSION).join("page-1.json"))
                .unwrap()
                .modified()
                .unwrap()
        );
        assert_eq!(fs::read(page_path(&dir, 0)).unwrap(), saved);
        assert_eq!(fs::read(&source).unwrap(), fixture);
        // Do not demand newer optional word fields to preserve older layers.
        let mut legacy = read_page(&dir, 1).unwrap();
        legacy.as_object_mut().unwrap().remove("recognizer");
        for word in legacy["lines"].as_array_mut().unwrap() {
            word.as_object_mut().unwrap().remove("endLine");
        }
        let legacy_bytes = serde_json::to_vec(&legacy).unwrap();
        fs::write(page_path(&dir, 1), &legacy_bytes).unwrap();
        assert!(launch().wait().unwrap().success());
        assert_eq!(fs::read(page_path(&dir, 1)).unwrap(), legacy_bytes);
        // An older empty result must not permanently poison a page which has
        // readable text. Recover it once, then preserve the new byte offsets.
        fs::write(
            page_path(&dir, 1),
            br#"{"index":1,"native":false,"lines":[]}"#,
        )
        .unwrap();
        assert!(launch().wait().unwrap().success());
        let recovered = read_page(&dir, 1).unwrap();
        assert_eq!(recovered["recognizer"], "vision-multiscale-1");
        assert!(recovered["lines"].as_array().unwrap().len() > 1);
        let recovered_bytes = fs::read(page_path(&dir, 1)).unwrap();
        let recovered_time = fs::metadata(page_path(&dir, 1))
            .unwrap()
            .modified()
            .unwrap();
        assert!(launch().wait().unwrap().success());
        assert_eq!(fs::read(page_path(&dir, 1)).unwrap(), recovered_bytes);
        assert_eq!(
            fs::metadata(page_path(&dir, 1))
                .unwrap()
                .modified()
                .unwrap(),
            recovered_time
        );
        assert_eq!(fs::read(page_path(&dir, 0)).unwrap(), saved);
        assert_eq!(fs::read(&source).unwrap(), fixture);
        // Alternate exact-title evidence is a separate character-box sidecar.
        // It must never replace the reading layer or its historical text offsets.
        let reading = (0..4)
            .map(|i| fs::read(page_path(&dir, i)).unwrap())
            .collect::<Vec<_>>();
        fs::create_dir_all(dir.join(CONTENTS_VERSION)).unwrap();
        let contents = || {
            Command::new(&executable)
                .arg("--contents")
                .arg(&source)
                .arg(dir.join(CONTENTS_VERSION))
                .arg("0,1,2,3")
                .status()
                .unwrap()
        };
        assert!(contents().success());
        let evidence = read_page_version(&dir, 1, CONTENTS_VERSION).unwrap();
        assert_eq!(evidence["recognizer"], "vision-contents-1");
        let evidence_words = evidence["lines"].as_array().unwrap();
        assert!(evidence_words.len() > 2);
        assert!(evidence_words.iter().any(|word| word["text"] == "本"));
        assert!(evidence_words
            .iter()
            .any(|word| word["text"].as_str().unwrap().contains("Copper")));
        let evidence_path = dir.join(CONTENTS_VERSION).join("page-1.json");
        let evidence_bytes = fs::read(&evidence_path).unwrap();
        let evidence_modified = fs::metadata(&evidence_path).unwrap().modified().unwrap();
        assert!(contents().success());
        assert_eq!(fs::read(&evidence_path).unwrap(), evidence_bytes);
        assert_eq!(
            fs::metadata(&evidence_path).unwrap().modified().unwrap(),
            evidence_modified
        );
        assert_eq!(
            info(&dir, "local-test".into()).unwrap().pages,
            vec![0, 1, 2, 3]
        );
        for (i, bytes) in reading.iter().enumerate() {
            assert_eq!(&fs::read(page_path(&dir, i)).unwrap(), bytes);
        }
        assert_eq!(fs::read(&source).unwrap(), fixture);
        fs::remove_dir_all(&dir).unwrap();
    }
}

struct ExportJob {
    id: String,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    child: Option<Arc<Mutex<Child>>>,
}
static EXPORT_JOB: Mutex<Option<ExportJob>> = Mutex::new(None);

#[derive(Deserialize, Serialize)]
pub struct ExportRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
#[derive(Deserialize, Serialize)]
pub struct ExportAnnotation {
    index: usize,
    rects: Vec<ExportRect>,
    text: String,
    style: String,
    color: String,
}
fn valid_annotations(notes: &[ExportAnnotation]) -> bool {
    notes.len() <= 2000
        && notes.iter().all(|n| {
            n.index < 5000
                && n.text.len() <= 40000
                && n.color.len() <= 32
                && ["highlight", "underline", "squiggly", "text"].contains(&n.style.as_str())
                && !n.rects.is_empty()
                && n.rects.len() <= 400
                && n.rects.iter().all(|r| {
                    [r.x, r.y, r.width, r.height].iter().all(|v| v.is_finite())
                        && r.x >= 0.0
                        && r.y >= 0.0
                        && r.width > 0.0
                        && r.height > 0.0
                        && r.x + r.width <= 1.001
                        && r.y + r.height <= 1.001
                })
        })
}

#[tauri::command]
pub fn pdf_cancel_export(cache_id: String) -> Result<(), String> {
    if let Some(job) = EXPORT_JOB.lock().map_err(error)?.as_ref() {
        if job.id == cache_id {
            job.cancelled
                .store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn pdf_export_copy(
    app: AppHandle,
    source: String,
    cache_id: String,
    destination: String,
    annotations: Vec<ExportAnnotation>,
) -> Result<(), String> {
    if !valid_annotations(&annotations) {
        return Err("invalid_pdf_annotations".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(not(target_os = "macos"))]
        { let _ = (app, source, cache_id, destination, annotations); Err("pdf_export_unsupported".into()) }
        #[cfg(target_os = "macos")]
        {
            use std::sync::atomic::{AtomicBool, Ordering};
            use tauri_plugin_fs::FsExt;
            let cancelled = Arc::new(AtomicBool::new(false));
            {
                let mut active = EXPORT_JOB.lock().map_err(error)?;
                if active.is_some() { return Err("pdf_export_busy".into()); }
                *active = Some(ExportJob { id: cache_id.clone(), cancelled: cancelled.clone(), child: None });
            }
            let result = (|| {
                let (source_path, id) = fingerprint(&app, &source)?;
                if id != cache_id { return Err("pdf_source_changed".into()); }
                let requested = PathBuf::from(&destination);
                if !app.fs_scope().is_allowed(&requested) { return Err("pdf_access_denied".into()); }
                let parent = requested.parent().ok_or("pdf_access_denied")?.canonicalize().map_err(error)?;
                let target = parent.join(requested.file_name().ok_or("pdf_access_denied")?);
                // Export only to a new file. Never truncate the source or a previous copy.
                if target.exists() || target.symlink_metadata().is_ok() || target == source_path { return Err("pdf_export_exists".into()); }
                let dir = cache_dir(&app, &id)?;
                let saved = info(&dir, id.clone())?;
                let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(error)?.as_nanos();
                let work = dir.join(format!("export-{unique}"));
                fs::create_dir(&work).map_err(error)?;
                let exported = work.join("copy.pdf");
                let outcome = (|| {
                    let request = serde_json::json!({"annotations": annotations, "outline": saved.outline, "pages": saved.pages});
                    let bytes = serde_json::to_vec(&request).map_err(error)?;
                    if bytes.len() > 4 * 1024 * 1024 { return Err("pdf_export_limit".into()); }
                    let manifest = work.join("request.json"); fs::write(&manifest, bytes).map_err(error)?;
                    let child = Command::new(helper(&app)?).arg("--export").arg(&source_path).arg(dir.join(VERSION)).arg(&manifest).arg(&exported)
                        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|_| "pdf_worker_unavailable")?;
                    let child = Arc::new(Mutex::new(child));
                    if let Some(job) = EXPORT_JOB.lock().map_err(error)?.as_mut() { job.child = Some(child.clone()); }
                    let start = Instant::now();
                    loop {
                        let mut child = child.lock().map_err(error)?;
                        if cancelled.load(Ordering::SeqCst) || start.elapsed() > Duration::from_secs(120) {
                            let _ = child.kill(); let _ = child.wait(); return Err("pdf_export_cancelled".into());
                        }
                        match child.try_wait() {
                            Ok(Some(status)) => { if !status.success() { return Err("pdf_export_failed".into()); } break; }
                            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
                            Err(_) => { let _ = child.kill(); let _ = child.wait(); return Err("pdf_worker_unavailable".into()); }
                        }
                    }
                    if fingerprint(&app, &source)?.1 != id { return Err("pdf_source_changed".into()); }
                    if cancelled.load(Ordering::SeqCst) { return Err("pdf_export_cancelled".into()); }
                    if fs::metadata(&exported).map_err(error)?.len() > 512 * 1024 * 1024 { return Err("pdf_export_limit".into()); }
                    let mut input = File::open(&exported).map_err(error)?;
                    let mut output = fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(|_| "pdf_export_exists")?;
                    if std::io::copy(&mut input, &mut output).and_then(|_| output.sync_all()).is_err() {
                        drop(output); let _ = fs::remove_file(&target); return Err("pdf_storage_error".into());
                    }
                    Ok(())
                })();
                let _ = fs::remove_dir_all(&work);
                outcome
            })();
            *EXPORT_JOB.lock().map_err(error)? = None;
            result
        }
    }).await.map_err(error)?
}
