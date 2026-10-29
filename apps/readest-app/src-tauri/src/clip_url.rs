//! Native webpage capture. JavaScript results return through Tauri's native
//! evaluation callback; page HTML never enters a navigation URL or HTTP listener.

use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::AppHandle;
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;
use tauri::WebviewWindow;
#[cfg(desktop)]
use tauri::{Manager, Url, WebviewUrl, WebviewWindowBuilder};

/// Localised strings and theme colours supplied by the JS caller. Defaults
/// are English / Readest's dark palette so a caller that omits a field
/// (tests, future Rust-only callers) still gets readable text and chrome.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ClipOptions {
    pub window_title: Option<String>,
    pub overlay_title: Option<String>,
    pub loading_status: Option<String>,
    pub capturing_status: Option<String>,
    pub saved_title: Option<String>,
    /// `#rrggbb` — matches `themeCode.bg` (base-100) in the renderer.
    pub background: Option<String>,
    /// `#rrggbb` — matches `themeCode.fg` (base-content) in the renderer.
    pub foreground: Option<String>,
    /// Show the original page with explicit save/cancel controls.
    pub interactive: Option<bool>,
    pub sign_in_hint: Option<String>,
    pub capture_label: Option<String>,
    pub cancel_label: Option<String>,
}

#[cfg(desktop)]
impl ClipOptions {
    fn window_title(&self) -> &str {
        self.window_title
            .as_deref()
            .unwrap_or("Saving to your Glossa library…")
    }
    fn background(&self) -> &str {
        self.background.as_deref().unwrap_or("#1f2024")
    }
    fn foreground(&self) -> &str {
        self.foreground.as_deref().unwrap_or("#f5f5f7")
    }
}

const MAX_HTML_BYTES: usize = 16 * 1024 * 1024;

#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CapturedPage {
    html: String,
    final_url: String,
    base_url: String,
    #[serde(default)]
    selection: bool,
}

fn validate_web_url(value: &str) -> Result<(), String> {
    let url = tauri::Url::parse(value).map_err(|_| "Invalid page URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Page URL must use http or https without embedded credentials".into());
    }
    Ok(())
}

fn validate_task_id(task_id: &str) -> Result<(), String> {
    if task_id.is_empty()
        || task_id.len() > 128
        || !task_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
    {
        return Err("Invalid capture task".into());
    }
    Ok(())
}

fn decode_snapshot(value: &str) -> Result<CapturedPage, String> {
    // Check before deserializing so an oversized callback cannot allocate a second
    // unbounded copy. Escaped Unicode can expand JSON relative to the final HTML.
    if value.len() > MAX_HTML_BYTES * 6 + 4096 {
        return Err("Page is too large to capture".into());
    }
    let page: CapturedPage =
        serde_json::from_str(value).map_err(|_| "Could not capture page content".to_string())?;
    validate_web_url(&page.final_url)?;
    validate_web_url(&page.base_url)?;
    if page.html.trim().is_empty() || page.html.len() > MAX_HTML_BYTES {
        return Err("Page content is empty or too large to capture".into());
    }
    Ok(page)
}

#[cfg(any(desktop, test))]
#[derive(Default)]
struct Readiness {
    signature: String,
    changed_at: u128,
}

#[cfg(any(desktop, test))]
impl Readiness {
    fn observe(&mut self, signature: &str, loaded: bool, elapsed: u128) -> bool {
        if signature != self.signature {
            self.signature = signature.to_owned();
            self.changed_at = elapsed;
        }
        loaded && !signature.trim().is_empty() && elapsed.saturating_sub(self.changed_at) >= 1000
    }
}

#[derive(Clone)]
struct CaptureTask {
    owner: String,
    #[cfg(desktop)]
    label: String,
    cancelled: Arc<AtomicBool>,
}

#[derive(Default)]
struct CaptureRegistry {
    active: HashMap<String, CaptureTask>,
    // Cancellation can arrive before the async capture command is scheduled.
    // Keep short-lived, bounded tombstones so that race cannot open a late window.
    cancelled: HashMap<(String, String), Instant>,
}

impl CaptureRegistry {
    fn prune(&mut self) {
        self.cancelled
            .retain(|_, at| at.elapsed() < Duration::from_secs(60));
    }

    fn register(&mut self, task_id: String, task: CaptureTask) -> Result<(), String> {
        self.prune();
        if self
            .cancelled
            .contains_key(&(task.owner.clone(), task_id.clone()))
        {
            return Err("Capture cancelled".into());
        }
        if self.active.contains_key(&task_id) {
            return Err("Capture task already active".into());
        }
        if self.active.len() >= 4 {
            return Err("Too many active capture windows".into());
        }
        self.active.insert(task_id, task);
        Ok(())
    }

    fn cancel(&mut self, task_id: &str, owner: &str) -> Result<Option<CaptureTask>, String> {
        self.prune();
        if let Some(task) = self.active.get(task_id) {
            if task.owner != owner {
                return Err("Capture belongs to another window".into());
            }
            task.cancelled.store(true, Ordering::Release);
            return Ok(Some(task.clone()));
        }
        if self.cancelled.len() >= 64 {
            if let Some(oldest) = self
                .cancelled
                .iter()
                .min_by_key(|(_, at)| *at)
                .map(|(key, _)| key.clone())
            {
                self.cancelled.remove(&oldest);
            }
        }
        self.cancelled
            .insert((owner.to_owned(), task_id.to_owned()), Instant::now());
        Ok(None)
    }
}

fn tasks() -> &'static Mutex<CaptureRegistry> {
    static TASKS: OnceLock<Mutex<CaptureRegistry>> = OnceLock::new();
    TASKS.get_or_init(|| Mutex::new(CaptureRegistry::default()))
}

#[cfg(desktop)]
struct CaptureGuard {
    app: AppHandle,
    task_id: String,
    label: String,
}

#[cfg(desktop)]
impl Drop for CaptureGuard {
    fn drop(&mut self) {
        if let Some(window) = self.app.get_webview_window(&self.label) {
            let _ = window.close();
        }
        if let Ok(mut tasks) = tasks().lock() {
            tasks.active.remove(&self.task_id);
        }
    }
}

fn next_id() -> String {
    use std::sync::atomic::AtomicU64;
    static NEXT: AtomicU64 = AtomicU64::new(0);
    format!(
        "{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}

#[cfg(desktop)]
fn capture_script(options: &ClipOptions, capture: bool) -> String {
    let config = serde_json::json!({
        "interactive": options.interactive.unwrap_or(false),
        "capture": capture,
        "maxChars": MAX_HTML_BYTES / 2,
        "captureLabel": options.capture_label.as_deref().unwrap_or("Save current content"),
        "cancelLabel": options.cancel_label.as_deref().unwrap_or("Cancel"),
        "hint": options.sign_in_hint.as_deref().unwrap_or("Open the article, then save its content."),
        "background": options.background(),
        "foreground": options.foreground(),
    });
    include_str!("clip_capture.js").replace("__GLOSSA_CONFIG__", &config.to_string())
}

#[cfg(desktop)]
async fn evaluate(window: &WebviewWindow, script: String) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx = Mutex::new(Some(tx));
    window
        .eval_with_callback(script, move |value| {
            if let Some(tx) = tx.lock().ok().and_then(|mut slot| slot.take()) {
                let _ = tx.send(value);
            }
        })
        .map_err(|_| "Could not read the capture window".to_string())?;
    tokio::time::timeout(Duration::from_secs(3), rx)
        .await
        .map_err(|_| "Page evaluation timed out".to_string())?
        .map_err(|_| "Capture window closed".to_string())
}

/// Capture only the currently loaded main document. The page has no command or
/// filesystem access; the callback belongs to the window created for this task.
#[cfg(desktop)]
#[tauri::command]
pub async fn clip_page(
    app: AppHandle,
    window: WebviewWindow,
    url: String,
    options: Option<ClipOptions>,
    task_id: Option<String>,
) -> Result<CapturedPage, String> {
    validate_web_url(&url)?;
    let task_id = task_id.unwrap_or_else(next_id);
    validate_task_id(&task_id)?;
    let label = format!("clip-{}", next_id());
    let owner = window.label().to_owned();
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut tasks = tasks()
            .lock()
            .map_err(|_| "Capture registry unavailable".to_string())?;
        tasks.register(
            task_id.clone(),
            CaptureTask {
                owner: window.label().to_string(),
                label: label.clone(),
                cancelled: cancelled.clone(),
            },
        )?;
    }
    let _guard = CaptureGuard {
        app: app.clone(),
        task_id,
        label: label.clone(),
    };
    let options = options.unwrap_or_default();
    let interactive = options.interactive.unwrap_or(false);
    let builder = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::External(Url::parse(&url).map_err(|_| "Invalid page URL")?),
    )
    .title(options.window_title())
    .visible(true)
    .incognito(true)
    .center()
    .resizable(true)
    .inner_size(880.0, 680.0)
    .on_navigation(|url| matches!(url.scheme(), "http" | "https"));
    #[cfg(target_os = "macos")]
    let builder = builder
        .decorations(true)
        .title_bar_style(TitleBarStyle::Visible);
    let webview = builder
        .build()
        .map_err(|_| "Could not create capture window".to_string())?;
    let closed = cancelled.clone();
    webview.on_window_event(move |event| {
        if matches!(
            event,
            tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
        ) {
            closed.store(true, Ordering::Release);
        }
    });
    let started = Instant::now();
    let deadline = Duration::from_secs(if interactive { 300 } else { 30 });
    let mut readiness = Readiness::default();
    let script = capture_script(&options, false);
    let mut last_evaluation_error = None;
    while started.elapsed() < deadline {
        if cancelled.load(Ordering::Acquire) || app.get_webview_window(&owner).is_none() {
            return Err("Capture cancelled".into());
        }
        let value = match evaluate(&webview, script.clone()).await {
            Ok(value) => value,
            Err(error) => {
                last_evaluation_error = Some(error);
                tokio::time::sleep(Duration::from_millis(250)).await;
                continue;
            }
        };
        if cancelled.load(Ordering::Acquire) || app.get_webview_window(&owner).is_none() {
            return Err("Capture cancelled".into());
        }
        let observation: serde_json::Value = serde_json::from_str(&value).unwrap_or_default();
        if observation.get("cancelled").and_then(|v| v.as_bool()) == Some(true) {
            return Err("Capture cancelled".into());
        }
        if let Some(error) = observation.get("error").and_then(|v| v.as_str()) {
            return Err(error.to_string());
        }
        if observation.get("html").is_some() {
            return decode_snapshot(&value);
        }
        let signature = observation
            .get("signature")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let loaded = observation
            .get("loaded")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if !interactive && readiness.observe(signature, loaded, started.elapsed().as_millis()) {
            let page = evaluate(&webview, capture_script(&options, true)).await?;
            if cancelled.load(Ordering::Acquire) {
                return Err("Capture cancelled".into());
            }
            return decode_snapshot(&page);
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Err(last_evaluation_error.unwrap_or_else(|| {
        if interactive {
            "Capture timed out".into()
        } else {
            "Page took too long to load readable content".into()
        }
    }))
}

#[cfg(desktop)]
#[tauri::command]
pub async fn cancel_clip(
    app: AppHandle,
    window: WebviewWindow,
    task_id: String,
) -> Result<(), String> {
    if task_id.is_empty()
        || task_id.len() > 128
        || !task_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
    {
        return Err("Invalid capture task".into());
    }
    let task = tasks()
        .lock()
        .map_err(|_| "Capture registry unavailable".to_string())?
        .cancel(&task_id, window.label())?;
    if let Some(task) = task {
        if let Some(capture) = app.get_webview_window(&task.label) {
            let _ = capture.close();
        }
    }
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
pub async fn clip_url(
    app: AppHandle,
    window: WebviewWindow,
    url: String,
    options: Option<ClipOptions>,
) -> Result<String, String> {
    clip_page(app, window, url, options, None)
        .await
        .map(|page| page.html)
}

#[cfg(mobile)]
#[tauri::command]
pub async fn clip_url(
    app: AppHandle,
    window: WebviewWindow,
    url: String,
    options: Option<ClipOptions>,
) -> Result<String, String> {
    clip_page(app, window, url, options, None)
        .await
        .map(|page| page.html)
}

#[cfg(mobile)]
struct MobileCaptureGuard {
    app: AppHandle,
    task_id: String,
    native_task_id: String,
    finished: bool,
}

#[cfg(mobile)]
impl Drop for MobileCaptureGuard {
    fn drop(&mut self) {
        if let Ok(mut registry) = tasks().lock() {
            registry.active.remove(&self.task_id);
        }
        if !self.finished {
            use tauri_plugin_native_bridge::{ClipCancelRequest, NativeBridgeExt};
            let app = self.app.clone();
            let task_id = self.native_task_id.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let _ = app
                    .native_bridge()
                    .cancel_clip(ClipCancelRequest { task_id });
            });
        }
    }
}

#[cfg(mobile)]
async fn capture_mobile(
    app: AppHandle,
    url: String,
    options: Option<ClipOptions>,
    task_id: String,
) -> Result<tauri_plugin_native_bridge::ClipUrlResponse, String> {
    use tauri_plugin_native_bridge::{ClipUrlRequest, NativeBridgeExt};
    let options = options.unwrap_or_default();
    let request = ClipUrlRequest {
        url,
        task_id: Some(task_id),
        window_title: options.window_title,
        overlay_title: options.overlay_title,
        loading_status: options.loading_status,
        capturing_status: options.capturing_status,
        saved_title: options.saved_title,
        background: options.background,
        foreground: options.foreground,
        interactive: options.interactive,
        sign_in_hint: options.sign_in_hint,
        capture_label: options.capture_label,
        cancel_label: options.cancel_label,
    };
    tauri::async_runtime::spawn_blocking(move || {
        app.native_bridge()
            .clip_url(request)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "Capture bridge stopped".to_string())?
}

#[cfg(mobile)]
#[tauri::command]
pub async fn clip_page(
    app: AppHandle,
    window: WebviewWindow,
    url: String,
    options: Option<ClipOptions>,
    task_id: Option<String>,
) -> Result<CapturedPage, String> {
    validate_web_url(&url)?;
    let task_id = task_id.unwrap_or_else(next_id);
    validate_task_id(&task_id)?;
    let cancelled = Arc::new(AtomicBool::new(false));
    tasks()
        .lock()
        .map_err(|_| "Capture registry unavailable".to_string())?
        .register(
            task_id.clone(),
            CaptureTask {
                owner: window.label().to_owned(),
                cancelled: cancelled.clone(),
            },
        )?;
    let native_task_id = format!("{}:{}", window.label(), task_id);
    let mut guard = MobileCaptureGuard {
        app: app.clone(),
        task_id: task_id.clone(),
        native_task_id: native_task_id.clone(),
        finished: false,
    };
    let result = capture_mobile(app, url, options, native_task_id).await;
    guard.finished = true;
    if cancelled.load(Ordering::Acquire) {
        return Err("Capture cancelled".into());
    }
    let page = result?;
    // Never substitute the originally requested URL for unknown redirect metadata.
    decode_snapshot(&serde_json::json!({ "html": page.html, "finalUrl": page.final_url, "baseUrl": page.base_url, "selection": false }).to_string())
}

#[cfg(mobile)]
#[tauri::command]
pub async fn cancel_clip(
    app: AppHandle,
    window: WebviewWindow,
    task_id: String,
) -> Result<(), String> {
    use tauri_plugin_native_bridge::{ClipCancelRequest, NativeBridgeExt};
    validate_task_id(&task_id)?;
    tasks()
        .lock()
        .map_err(|_| "Capture registry unavailable".to_string())?
        .cancel(&task_id, window.label())?;
    let task_id = format!("{}:{}", window.label(), task_id);
    tauri::async_runtime::spawn_blocking(move || {
        app.native_bridge()
            .cancel_clip(ClipCancelRequest { task_id })
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "Capture bridge stopped".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_requires_current_http_document_and_bounded_html() {
        let snapshot = r#"{"html":"<p>正文</p>","finalUrl":"https://example.org/redirected","baseUrl":"https://example.org/assets/","selection":false}"#;
        let result = decode_snapshot(snapshot).unwrap();
        assert_eq!(result.final_url, "https://example.org/redirected");
        assert_eq!(result.base_url, "https://example.org/assets/");
        assert!(decode_snapshot(
            &snapshot.replace("https://example.org/redirected", "file:///etc/passwd")
        )
        .is_err());
        assert!(decode_snapshot(
            &snapshot.replace("https://example.org/assets/", "javascript:alert(1)")
        )
        .is_err());
        assert!(decode_snapshot(
            r#"{"html":"","finalUrl":"https://example.org/","baseUrl":"https://example.org/"}"#
        )
        .is_err());
    }

    #[test]
    fn snapshot_preserves_excerpt_and_rejects_oversized_html() {
        let snapshot = serde_json::json!({ "html": "<article><em>Selected</em></article>", "finalUrl": "https://example.org/", "baseUrl": "https://example.org/", "selection": true });
        assert!(decode_snapshot(&snapshot.to_string()).unwrap().selection);
        let oversized = serde_json::json!({ "html": "x".repeat(MAX_HTML_BYTES + 1), "finalUrl": "https://example.org/", "baseUrl": "https://example.org/" });
        assert!(decode_snapshot(&oversized.to_string()).is_err());
    }

    #[cfg(desktop)]
    #[test]
    fn cancellation_is_owner_scoped_and_covers_pre_registration_race() {
        let make_task = |owner: &str| CaptureTask {
            owner: owner.to_owned(),
            label: "clip-test".into(),
            cancelled: Arc::new(AtomicBool::new(false)),
        };
        let mut registry = CaptureRegistry::default();
        registry
            .register("active".into(), make_task("main"))
            .unwrap();
        assert!(registry.cancel("active", "reader-other").is_err());
        assert!(!registry.active["active"].cancelled.load(Ordering::Acquire));
        registry.cancel("active", "main").unwrap();
        assert!(registry.active["active"].cancelled.load(Ordering::Acquire));
        registry.cancel("late", "main").unwrap();
        assert_eq!(
            registry
                .register("late".into(), make_task("main"))
                .unwrap_err(),
            "Capture cancelled"
        );
        registry
            .register("late".into(), make_task("reader-other"))
            .unwrap();
    }

    #[test]
    fn readiness_waits_for_stability_but_accepts_short_articles() {
        let mut state = Readiness::default();
        assert!(!state.observe("A short complete article", true, 0));
        assert!(!state.observe("A short complete article", true, 500));
        assert!(state.observe("A short complete article", true, 1250));
        assert!(!state.observe("A changed article", true, 1500));
        assert!(!state.observe("", true, 3000));
    }
}
