use std::{
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use block::ConcreteBlock;
use objc::{class, msg_send, runtime::Object, sel, sel_impl};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

const IDLE: Duration = Duration::from_secs(120);
const CHECKPOINT: Duration = Duration::from_secs(15);
const MAX_UNOBSERVED: Duration = Duration::from_secs(25);
const VISIBLE: usize = 1 << 1;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookSession {
    session_id: String,
    book_hash: String,
}

struct Span {
    window: String,
    native_window_id: usize,
    session: BookSession,
    cursor: Instant,
    wall_ms: u64,
    deadline: Instant,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Interval {
    id: String,
    session_id: String,
    book_hash: String,
    start_ms: u64,
    duration_ms: u64,
}

#[derive(Default)]
struct Tracker {
    active: Option<Span>,
    pending: Vec<Interval>,
    sequence: u64,
    unavailable: u8,
    enabled: bool,
    timer_running: bool,
    exiting: bool,
}

impl Tracker {
    fn advance(&mut self, now: Instant, wall: u64, stop: bool) {
        let Some(span) = self.active.as_mut() else {
            return;
        };
        let end = now.min(span.deadline);
        let elapsed = end.saturating_duration_since(span.cursor);
        if now.saturating_duration_since(span.cursor) > MAX_UNOBSERVED {
            // A missed sleep or stalled application must never backfill the gap.
            self.active = None;
            return;
        }
        if stop || now >= span.deadline || elapsed >= CHECKPOINT {
            let duration_ms = elapsed.as_millis() as u64;
            if duration_ms > 0 {
                self.sequence += 1;
                self.pending.push(Interval {
                    id: format!("{}:{}", span.session.session_id, self.sequence),
                    session_id: span.session.session_id.clone(),
                    book_hash: span.session.book_hash.clone(),
                    start_ms: span.wall_ms,
                    duration_ms,
                });
                span.cursor = end;
                // Reanchor the next slice to the current calendar clock. A manual
                // clock change cannot expand or shrink the monotonic duration.
                span.wall_ms = wall;
            }
        }
        if stop || now >= span.deadline {
            self.active = None;
        }
    }

    fn signal(
        &mut self,
        window: &str,
        native_window_id: usize,
        session: BookSession,
        now: Instant,
        wall_ms: u64,
    ) {
        let switching = self.active.as_ref().is_some_and(|span| {
            span.native_window_id != native_window_id
                || span.window != window
                || span.session.session_id != session.session_id
        });
        self.advance(now, wall_ms, switching);
        if self.unavailable != 0 {
            return;
        }
        if let Some(span) = self.active.as_mut() {
            span.deadline = now + IDLE;
        } else {
            self.active = Some(Span {
                window: window.into(),
                native_window_id,
                session,
                cursor: now,
                wall_ms,
                deadline: now + IDLE,
            });
        }
    }
    fn pause_window(&mut self, id: Option<usize>, now: Instant, wall: u64) -> bool {
        if !self
            .active
            .as_ref()
            .is_some_and(|span| id.map_or(true, |id| id == span.native_window_id))
        {
            return false;
        }
        self.advance(now, wall, true);
        true
    }
}

static TRACKER: Mutex<Tracker> = Mutex::new(Tracker {
    active: None,
    pending: Vec::new(),
    sequence: 0,
    unavailable: 0,
    enabled: true,
    timer_running: false,
    exiting: false,
});
// AppKit owns these observer tokens until they are removed on the main thread.
static OBSERVERS: Mutex<Vec<(usize, usize)>> = Mutex::new(Vec::new());

fn wall_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn window_visible(ns_window: *mut Object) -> bool {
    if ns_window.is_null() {
        return false;
    }
    unsafe {
        let occlusion: usize = msg_send![ns_window, occlusionState];
        let minimized: objc::runtime::BOOL = msg_send![ns_window, isMiniaturized];
        let app: *mut Object = msg_send![class!(NSApplication), sharedApplication];
        let hidden: objc::runtime::BOOL = msg_send![app, isHidden];
        occlusion & VISIBLE != 0 && minimized == objc::runtime::NO && hidden == objc::runtime::NO
    }
}

// AppKit may send these notifications synchronously inside Tao's window teardown.
// Never look up a Tauri window or dispatch into WebKit on that callback stack.
fn notify_writer(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = app.emit("reading-time-flush", ());
    });
}

fn pause_from_notification(app: &AppHandle, id: Option<usize>) {
    if TRACKER
        .lock()
        .unwrap()
        .pause_window(id, Instant::now(), wall_ms())
    {
        notify_writer(app);
    }
}

unsafe fn observe(
    center: *mut Object,
    name: &str,
    callback: impl Fn(*mut Object) + 'static,
) -> (usize, usize) {
    let utf8 = std::ffi::CString::new(name).expect("static notification name");
    let name: *mut Object = msg_send![class!(NSString), stringWithUTF8String: utf8.as_ptr()];
    let block = ConcreteBlock::new(callback).copy();
    let queue: *mut Object = msg_send![class!(NSOperationQueue), mainQueue];
    let token: *mut Object = msg_send![center,
        addObserverForName: name object: std::ptr::null_mut::<Object>()
        queue: queue usingBlock: &*block
    ];
    (center as usize, token as usize)
}

fn install_observers(app: &AppHandle) {
    let mut observers = OBSERVERS.lock().unwrap();
    if !observers.is_empty() {
        return;
    }
    unsafe {
        let center: *mut Object = msg_send![class!(NSNotificationCenter), defaultCenter];
        for name in [
            "NSWindowDidChangeOcclusionStateNotification",
            "NSWindowDidMiniaturizeNotification",
            "NSWindowWillCloseNotification",
        ] {
            let app = app.clone();
            observers.push(observe(center, name, move |notification| {
                let window: *mut Object = msg_send![notification, object];
                if !window.is_null()
                    && (name != "NSWindowDidChangeOcclusionStateNotification"
                        || !window_visible(window))
                {
                    pause_from_notification(&app, Some(window as usize));
                }
            }));
        }
        let handle = app.clone();
        observers.push(observe(
            center,
            "NSApplicationDidHideNotification",
            move |_| {
                pause_from_notification(&handle, None);
            },
        ));

        let workspace: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
        let center: *mut Object = msg_send![workspace, notificationCenter];
        let distributed: *mut Object =
            msg_send![class!(NSDistributedNotificationCenter), defaultCenter];
        for (center, pause, resume, bit) in [
            (
                center,
                "NSWorkspaceWillSleepNotification",
                "NSWorkspaceDidWakeNotification",
                1,
            ),
            (
                center,
                "NSWorkspaceScreensDidSleepNotification",
                "NSWorkspaceScreensDidWakeNotification",
                2,
            ),
            (
                center,
                "NSWorkspaceSessionDidResignActiveNotification",
                "NSWorkspaceSessionDidBecomeActiveNotification",
                4,
            ),
            (
                distributed,
                "com.apple.screenIsLocked",
                "com.apple.screenIsUnlocked",
                8,
            ),
        ] {
            let app = app.clone();
            observers.push(observe(center, pause, move |_| {
                {
                    let mut tracker = TRACKER.lock().unwrap();
                    tracker.unavailable |= bit;
                    tracker.advance(Instant::now(), wall_ms(), true);
                }
                notify_writer(&app);
            }));
            observers.push(observe(center, resume, move |_| {
                TRACKER.lock().unwrap().unavailable &= !bit
            }));
        }
    }
}

fn uninstall_observers() {
    for (center, token) in OBSERVERS.lock().unwrap().drain(..) {
        let center = center as *mut Object;
        let token = token as *mut Object;
        unsafe {
            let _: () = msg_send![center, removeObserver: token];
        }
    }
}

// The OS timer stays independent of WebKit's background timer throttling.
// Each completed interval stays in the process until a database writer acks it.
fn run_checkpoint_timer(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let wake = {
                let mut tracker = TRACKER.lock().unwrap();
                let Some(span) = tracker.active.as_ref() else {
                    tracker.timer_running = false;
                    break;
                };
                (span.cursor + CHECKPOINT).min(span.deadline)
            };
            tokio::time::sleep_until(wake.into()).await;
            let should_flush = {
                let mut tracker = TRACKER.lock().unwrap();
                let sequence = tracker.sequence;
                tracker.advance(Instant::now(), wall_ms(), false);
                tracker.sequence != sequence || tracker.active.is_none()
            };
            if should_flush {
                let _ = app.emit("reading-time-flush", ());
            }
        }
    });
}

// The final slice can belong to a different window than the one that initiated
// Quit. Give the existing database writer a bounded opportunity to commit it.
pub fn finish_before_exit(app: &AppHandle, api: &tauri::ExitRequestApi, code: Option<i32>) {
    {
        let mut tracker = TRACKER.lock().unwrap();
        if tracker.exiting {
            return;
        }
        tracker.advance(Instant::now(), wall_ms(), true);
        if tracker.pending.is_empty() {
            return;
        }
        tracker.exiting = true;
    }
    api.prevent_exit();
    let _ = app.emit("reading-time-flush", ());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let deadline = Instant::now() + Duration::from_millis(1500);
        while Instant::now() < deadline && !TRACKER.lock().unwrap().pending.is_empty() {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        app.exit(code.unwrap_or(0));
    });
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReadingInput {
    Turn,
    Scroll,
    Selection,
    Lookup,
    Highlight,
    Note,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Activity {
    Signal {
        session: BookSession,
        #[serde(rename = "kind")]
        _kind: ReadingInput,
    },
    Pause {
        session: Option<BookSession>,
    },
    Disable,
    Enable,
    Status,
    Ack {
        ids: Vec<String>,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    active_session_id: Option<String>,
    intervals: Vec<Interval>,
}

#[tauri::command]
pub async fn reading_time(window: WebviewWindow, activity: Activity) -> Result<Snapshot, String> {
    let (tx, rx) = tauri::async_runtime::channel(1);
    let reader = window.clone();
    window
        .run_on_main_thread(move || {
            if matches!(activity, Activity::Signal { .. }) && TRACKER.lock().unwrap().enabled {
                install_observers(reader.app_handle());
            }
            if matches!(activity, Activity::Disable) {
                uninstall_observers();
            }
            let native_window = reader
                .ns_window()
                .unwrap_or(std::ptr::null_mut())
                .cast::<Object>();
            let visible = window_visible(native_window);
            let label = reader.label();
            let is_reader = label == "main" || label.starts_with("reader-");
            let mut tracker = TRACKER.lock().unwrap();
            let now = Instant::now();
            match activity {
                Activity::Signal { session, .. }
                    if is_reader
                        && tracker.enabled
                        && !tracker.exiting
                        && visible
                        && session.session_id.len() == 36
                        && !session.book_hash.is_empty()
                        && session.book_hash.len() <= 128 =>
                {
                    tracker.signal(label, native_window as usize, session, now, wall_ms());
                }
                Activity::Pause { session } => {
                    let owns = tracker.active.as_ref().is_some_and(|span| {
                        span.window == label
                            && session
                                .as_ref()
                                .map_or(true, |book| book.session_id == span.session.session_id)
                    });
                    tracker.advance(now, wall_ms(), owns);
                }
                Activity::Disable => {
                    tracker.advance(now, wall_ms(), true);
                    tracker.enabled = false;
                    tracker.unavailable = 0;
                }
                Activity::Enable => tracker.enabled = true,
                Activity::Ack { ids } => tracker.pending.retain(|row| !ids.contains(&row.id)),
                _ => {
                    let hidden_owner = !visible
                        && tracker
                            .active
                            .as_ref()
                            .is_some_and(|span| span.window == label);
                    tracker.advance(now, wall_ms(), hidden_owner);
                }
            }
            if tracker.active.is_some() && !tracker.timer_running {
                tracker.timer_running = true;
                run_checkpoint_timer(reader.app_handle().clone());
            }
            let active = tracker.active.as_ref().filter(|span| span.window == label);
            let _ = tx.try_send(Snapshot {
                active_session_id: active.map(|span| span.session.session_id.clone()),
                intervals: tracker.pending.iter().take(128).cloned().collect(),
            });
        })
        .map_err(|err| err.to_string())?;
    let mut rx = rx;
    rx.recv()
        .await
        .ok_or_else(|| "Reading time state unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(id: &str) -> BookSession {
        BookSession {
            session_id: id.into(),
            book_hash: id.into(),
        }
    }

    fn elapsed(tracker: &Tracker) -> u64 {
        tracker.pending.iter().map(|row| row.duration_ms).sum()
    }

    #[test]
    fn closing_a_library_does_not_stop_the_reader_and_duplicate_close_is_harmless() {
        let mut tracker = Tracker::default();
        let now = Instant::now();
        tracker.signal("reader-a", 11, session("a"), now, 1000);
        let later = now + Duration::from_secs(3);
        assert!(!tracker.pause_window(Some(22), later, 4000));
        assert!(tracker.active.is_some());
        assert!(tracker.pause_window(Some(11), later, 4000));
        assert!(!tracker.pause_window(Some(11), later, 4000));
        assert_eq!(elapsed(&tracker), 3000);
    }

    #[test]
    fn expires_at_two_minutes_and_does_not_backfill() {
        let mut tracker = Tracker::default();
        let start = Instant::now();
        tracker.signal("reader-a", 1, session("a"), start, 10_000);
        for second in [15, 30, 45, 60, 75, 90, 105, 119] {
            tracker.advance(
                start + Duration::from_secs(second),
                10_000 + second * 1_000,
                false,
            );
        }
        assert!(tracker.active.is_some());
        tracker.advance(start + Duration::from_secs(120), 120 * 1_000, false);
        assert!(tracker.active.is_none());
        assert_eq!(elapsed(&tracker), 120_000);

        let resumed = start + Duration::from_secs(600);
        tracker.signal("reader-a", 1, session("a"), resumed, 610_000);
        tracker.advance(resumed + Duration::from_secs(4), 4 * 1_000, true);
        assert_eq!(elapsed(&tracker), 124_000);
    }

    #[test]
    fn switching_owner_and_blocking_the_screen_cut_off_at_the_boundary() {
        let mut tracker = Tracker::default();
        let start = Instant::now();
        tracker.signal("reader-a", 1, session("a"), start, 10_000);
        tracker.signal(
            "reader-b",
            2,
            session("b"),
            start + Duration::from_secs(7),
            17_000,
        );
        tracker.unavailable = 1;
        tracker.advance(start + Duration::from_secs(12), 12 * 1_000, true);
        tracker.signal(
            "reader-a",
            1,
            session("a"),
            start + Duration::from_secs(13),
            23_000,
        );
        assert!(tracker.active.is_none());
        assert_eq!(tracker.pending[0].book_hash, "a");
        assert_eq!(tracker.pending[0].duration_ms, 7_000);
        assert_eq!(tracker.pending[1].book_hash, "b");
        assert_eq!(tracker.pending[1].duration_ms, 5_000);
        tracker.unavailable = 0;
        tracker.advance(start + Duration::from_secs(17), 17 * 1_000, false);
        assert!(tracker.active.is_none());
    }

    #[test]
    fn wall_clock_change_reanchors_future_intervals_without_changing_duration() {
        let mut tracker = Tracker::default();
        let start = Instant::now();
        tracker.signal("reader-a", 1, session("a"), start, 3_000_000);
        tracker.advance(start + Duration::from_secs(15), 40_000, false);
        tracker.advance(start + Duration::from_secs(30), 55_000, false);
        assert_eq!(elapsed(&tracker), 30_000);
        assert_eq!(tracker.pending[0].start_ms, 3_000_000);
        assert_eq!(tracker.pending[1].start_ms, 40_000);
    }

    #[test]
    fn observation_gap_is_not_backfilled_and_wall_clock_cannot_change_duration() {
        let mut tracker = Tracker::default();
        let start = Instant::now();
        tracker.signal("reader-a", 1, session("a"), start, 3_000_000);
        tracker.advance(start + Duration::from_secs(15), 15 * 1_000, false);
        tracker.signal(
            "reader-a",
            1,
            session("a"),
            start + Duration::from_secs(18),
            10_000,
        );
        tracker.advance(start + Duration::from_secs(60), 60 * 1_000, false);
        assert!(tracker.active.is_none());
        assert_eq!(elapsed(&tracker), 15_000);
        assert_eq!(tracker.pending[0].start_ms, 3_000_000);
    }
}
