//! Run with `cargo run -p Readest --example native_capture_probe` on macOS.
//! Isolated original local fixtures: no business plugins or personal data.
//! Selection and buttons are driven by JS in the real WebView; mouse/keyboard
//! interaction, external sign-in sites and full EPUB import need separate QA.
#[allow(dead_code)]
#[path = "../src/clip_url.rs"]
mod clip_url;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::Mutex,
    time::Duration,
};
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

async fn js(window: &WebviewWindow, source: &str) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx = Mutex::new(Some(tx));
    window
        .eval_with_callback(source, move |value| {
            if let Some(tx) = tx.lock().unwrap().take() {
                let _ = tx.send(value);
            }
        })
        .map_err(|e| e.to_string())?;
    tokio::time::timeout(Duration::from_secs(5), rx)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
async fn capture_window(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    for _ in 0..100 {
        if let Some(w) = app
            .webview_windows()
            .into_iter()
            .find(|(label, _)| label.starts_with("clip-"))
            .map(|(_, w)| w)
        {
            return Ok(w);
        };
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Err("capture window missing".into())
}
async fn wait_controls(window: &WebviewWindow) -> Result<(), String> {
    for _ in 0..100 {
        if matches!(js(window,"!!document.querySelector('#__glossa_capture_toolbar__ button')").await, Ok(value) if value == "true")
        {
            return Ok(());
        };
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Err("capture controls missing".into())
}
async fn probe(app: tauri::AppHandle, owner: WebviewWindow, base: String) -> Result<(), String> {
    let page = clip_url::clip_page(
        app.clone(),
        owner.clone(),
        format!("{base}/redirect"),
        None,
        Some("auto".into()),
    )
    .await?;
    let page = serde_json::to_value(page).unwrap();
    assert_eq!(page["finalUrl"], format!("{base}/article"));
    assert_eq!(page["baseUrl"], format!("{base}/assets/"));
    assert!(page["html"].as_str().unwrap().len() > 2 * 1024 * 1024);
    assert!(page["html"]
        .as_str()
        .unwrap()
        .contains("delayed native content"));
    println!("PASS native callback: redirected final/base URL, delayed DOM, 2MiB HTML");
    tokio::time::sleep(Duration::from_millis(250)).await;
    assert!(!app
        .webview_windows()
        .keys()
        .any(|label| label.starts_with("clip-")));
    let task = tauri::async_runtime::spawn(clip_url::clip_page(
        app.clone(),
        owner.clone(),
        format!("{base}/article"),
        Some(clip_url::ClipOptions {
            interactive: Some(true),
            ..Default::default()
        }),
        Some("manual".into()),
    ));
    let capture = capture_window(&app).await?;
    wait_controls(&capture).await?;
    js(&capture,"(() => { const range=document.createRange();range.selectNode(document.querySelector('em'));window.getSelection().addRange(range);document.querySelectorAll('#__glossa_capture_toolbar__ button')[1].click();return true;})()").await?;
    let page = serde_json::to_value(task.await.map_err(|e| e.to_string())??).unwrap();
    assert_eq!(page["selection"], true);
    assert!(page["html"]
        .as_str()
        .unwrap()
        .contains("<em>rich selection</em>"));
    assert!(!page["html"]
        .as_str()
        .unwrap()
        .contains("__glossa_capture_toolbar__"));
    println!("PASS native manual capture: rich Range selection, toolbar removed");
    tokio::time::sleep(Duration::from_millis(250)).await;
    let task = tauri::async_runtime::spawn(clip_url::clip_page(
        app.clone(),
        owner.clone(),
        format!("{base}/article"),
        Some(clip_url::ClipOptions {
            interactive: Some(true),
            ..Default::default()
        }),
        Some("cancel".into()),
    ));
    let capture = capture_window(&app).await?;
    wait_controls(&capture).await?;
    let other = WebviewWindowBuilder::new(
        &app,
        "probe-other",
        WebviewUrl::External(format!("{base}/owner").parse().unwrap()),
    )
    .visible(false)
    .incognito(true)
    .build()
    .map_err(|e| e.to_string())?;
    assert!(
        clip_url::cancel_clip(app.clone(), other.clone(), "cancel".into())
            .await
            .is_err()
    );
    clip_url::cancel_clip(app.clone(), owner.clone(), "cancel".into()).await?;
    assert_eq!(
        task.await.map_err(|e| e.to_string())?.unwrap_err(),
        "Capture cancelled"
    );
    println!("PASS native cancellation: other owner rejected, caller cancel closes capture");
    tokio::time::sleep(Duration::from_millis(250)).await;
    let task = tauri::async_runtime::spawn(clip_url::clip_page(
        app.clone(),
        owner.clone(),
        format!("{base}/article"),
        Some(clip_url::ClipOptions {
            interactive: Some(true),
            ..Default::default()
        }),
        Some("button-cancel".into()),
    ));
    let capture = capture_window(&app).await?;
    wait_controls(&capture).await?;
    js(
        &capture,
        "document.querySelector('#__glossa_capture_toolbar__ button').click();true",
    )
    .await?;
    assert_eq!(
        task.await.map_err(|e| e.to_string())?.unwrap_err(),
        "Capture cancelled"
    );
    tokio::time::sleep(Duration::from_millis(250)).await;
    assert!(!app
        .webview_windows()
        .keys()
        .any(|label| label.starts_with("clip-")));
    println!("PASS native cancel button and capture-window cleanup");
    clip_url::cancel_clip(app.clone(), owner.clone(), "pre-cancel".into()).await?;
    assert_eq!(
        clip_url::clip_page(
            app.clone(),
            owner.clone(),
            format!("{base}/article"),
            None,
            Some("pre-cancel".into())
        )
        .await
        .unwrap_err(),
        "Capture cancelled"
    );
    assert!(!app
        .webview_windows()
        .keys()
        .any(|label| label.starts_with("clip-")));
    println!("PASS cancellation before capture registration opens no window");
    other.close().map_err(|e| e.to_string())?;
    owner.close().map_err(|e| e.to_string())?;
    Ok(())
}
static EXIT_CODE: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(1);

fn main() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server_base = base.clone();
    std::thread::spawn(move || {
        for incoming in listener.incoming() {
            let Ok(mut stream) = incoming else { break };
            let mut request = [0u8; 8192];
            let n = stream.read(&mut request).unwrap_or(0);
            let request = String::from_utf8_lossy(&request[..n]);
            if request.starts_with("GET /redirect ") {
                let _=write!(stream,"HTTP/1.1 302 Found\r\nLocation: /article\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                continue;
            }
            let body = if request.starts_with("GET /article ") {
                format!("<!doctype html><html><head><base href='{server_base}/assets/'></head><body><article><p><em>rich selection</em></p><p>{}</p><div id='dynamic'></div></article><script>setTimeout(()=>document.getElementById('dynamic').textContent='delayed native content',800)</script></body></html>","x".repeat(2*1024*1024))
            } else {
                "<!doctype html><title>Probe owner</title>".into()
            };
            let _=write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body);
        }
    });
    tauri::Builder::default()
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let owner = WebviewWindowBuilder::new(
                &app_handle,
                "probe-owner",
                WebviewUrl::External(format!("{base}/owner").parse().unwrap()),
            )
            .visible(false)
            .incognito(true)
            .build()?;
            tauri::async_runtime::spawn(async move {
                let outcome = tokio::time::timeout(
                    Duration::from_secs(45),
                    tauri::async_runtime::spawn(probe(app_handle.clone(), owner, base)),
                )
                .await;
                if matches!(outcome, Ok(Ok(Ok(())))) {
                    println!("PASS all isolated native capture probe assertions");
                    EXIT_CODE.store(0, std::sync::atomic::Ordering::Release);
                    app_handle.exit(0);
                } else {
                    eprintln!("FAIL native probe: {outcome:?}");
                    app_handle.exit(1);
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!(
            "examples/native_capture_probe/tauri.conf.json"
        ))
        .expect("probe event loop");
    std::process::exit(EXIT_CODE.load(std::sync::atomic::Ordering::Acquire));
}
