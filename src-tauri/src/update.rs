//! The updater (docs/ops/VELOPACK.md, RELEASE.md §6). Velopack (`velo.rs`) does the feed, the
//! signature, the download and the swap; this module keeps the status the front end reads and
//! the rules around it:
//! - one download at a time (`downloading`);
//! - rollback: a `target` version, which the Worker answers only inside the running version's
//!   channel group (§6.5);
//! - a dev build has no Velopack install, so it never checks: its Settings row says so.
//!
//! The front end (`src/updater.ts`) decides when to call these, from Settings › Updates. A
//! downloaded update that is not installed now is applied at the next start (VELOPACK.md §1, F1 A).

use crate::lock::LockExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

const BASE: &str = "https://music-api.deets.solutions/update";
const CHECK_TIMEOUT: Duration = Duration::from_secs(20);

/// The update channel, fixed at compile time. DeetsMusic Beta always reads `deetsmusic-test`
/// (BETA.md §4), so a beta can never take a full release and replace itself with the other
/// app. Any other build reads `DEETSMUSIC_UPDATE_CHANNEL`, else the real channel.
fn channel() -> &'static str {
    if crate::beta::is_beta() {
        return "deetsmusic-test";
    }
    option_env!("DEETSMUSIC_UPDATE_CHANNEL").unwrap_or("deetsmusic")
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// idle · checking · available · downloading · ready · error
    pub state: &'static str,
    pub current: String,
    pub channel: &'static str,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub size: Option<u64>,
    pub got: u64,
    pub rollback: bool,
    pub error: Option<String>,
}

struct Inner {
    status: Status,
    /// The rollback target of the current offer, for the download and the install.
    target: Option<String>,
    /// The offer's package is downloaded and checked (Velopack holds it in its packages folder).
    ready: bool,
}

pub struct UpdateState {
    inner: Mutex<Inner>,
    downloading: AtomicBool,
}

impl Default for UpdateState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner {
                status: Status {
                    state: "idle",
                    current: String::new(),
                    channel: channel(),
                    version: None,
                    notes: None,
                    size: None,
                    got: 0,
                    rollback: false,
                    error: None,
                },
                target: None,
                ready: false,
            }),
            downloading: AtomicBool::new(false),
        }
    }
}

fn current_version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Change the status under the lock, then tell the window (`update-state`).
fn change(app: &AppHandle, f: impl FnOnce(&mut Inner)) -> Status {
    let state = app.state::<UpdateState>();
    let s = {
        let mut g = state.inner.lock_or_recover();
        f(&mut g);
        g.status.current = current_version(app);
        g.status.clone()
    };
    let _ = app.emit("update-state", &s);
    s
}

/// Log and show a failure. A downloaded update stays offered.
fn fail(app: &AppHandle, what: &str, e: impl std::fmt::Display) -> Status {
    let msg = format!("{what}: {e}");
    crate::log::warn(&format!("update: {msg}"));
    change(app, |g| {
        g.status.state = if g.ready { "ready" } else { "error" };
        g.status.error = Some(msg);
    })
}

#[tauri::command]
pub fn update_status(app: AppHandle) -> Status {
    change(&app, |_| {})
}

/// Ask the feed for a newer version, or for `target` (a rollback).
#[tauri::command]
pub async fn update_check(app: AppHandle, target: Option<String>) -> Status {
    if app.state::<UpdateState>().downloading.load(Ordering::SeqCst) {
        return change(&app, |_| {}); // one at a time: the running download keeps its place
    }
    if let Some(t) = &target {
        if t.is_empty() || !t.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+')) {
            return fail(&app, "rollback", format!("not a version: {t:?}"));
        }
    }
    if !crate::velo::installed() {
        return fail(&app, "check", "A dev build doesn't update.");
    }
    let rollback = target.is_some();
    change(&app, |g| {
        g.status.state = "checking";
        g.status.error = None;
    });
    let t = target.clone();
    let found = tauri::async_runtime::spawn_blocking(move || crate::velo::check(t)).await.map_err(|e| e.to_string()).and_then(|r| r);
    match found {
        Ok(Some(offer)) => change(&app, move |g| {
            let same = g.status.version.as_deref() == Some(offer.version.as_str()) && g.status.rollback == rollback;
            if !same {
                g.ready = false;
            }
            g.status.state = if g.ready { "ready" } else { "available" };
            g.status.got = if g.ready { offer.size } else { 0 };
            g.status.version = Some(offer.version);
            g.status.notes = Some(offer.notes);
            g.status.size = Some(offer.size);
            g.status.rollback = rollback;
            g.status.error = None;
            g.target = target;
        }),
        Ok(None) => change(&app, |g| {
            g.status.state = "idle";
            g.status.version = None;
            g.status.notes = None;
            g.status.size = None;
            g.status.got = 0;
            g.status.rollback = false;
            g.status.error = None;
            g.target = None;
            g.ready = false;
        }),
        Err(e) => fail(&app, if rollback { "rollback" } else { "check" }, e),
    }
}

/// Download and check the offered version. A second call while one runs returns at once.
#[tauri::command]
pub async fn update_download(app: AppHandle) -> Status {
    let state = app.state::<UpdateState>();
    let target = {
        let g = state.inner.lock_or_recover();
        if g.ready {
            drop(g);
            return change(&app, |_| {});
        }
        if g.status.version.is_none() {
            drop(g);
            return fail(&app, "download", "nothing to download; check first");
        }
        g.target.clone()
    };
    if state.downloading.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return change(&app, |_| {});
    }
    change(&app, |g| {
        g.status.state = "downloading";
        g.status.got = 0;
        g.status.error = None;
    });
    let a = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let b = a.clone();
        crate::velo::download(target, move |p| {
            change(&b, |g| g.status.got = g.status.size.unwrap_or(0) * p.clamp(0, 100) as u64 / 100);
        })
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|r| r);
    state.downloading.store(false, Ordering::SeqCst);
    match result {
        Ok(()) => change(&app, |g| {
            g.status.state = "ready";
            g.status.got = g.status.size.unwrap_or(0);
            g.ready = true;
        }),
        Err(e) => fail(&app, "download", e),
    }
}

/// *Skip this version* after a download: delete the package, so the next start does not apply it.
#[tauri::command]
pub async fn update_discard(app: AppHandle) -> Status {
    if !crate::velo::installed() {
        return change(&app, |_| {});
    }
    match tauri::async_runtime::spawn_blocking(crate::velo::discard).await.map_err(|e| e.to_string()).and_then(|r| r) {
        Ok(_) => change(&app, |g| {
            g.ready = false;
            g.status.state = "idle";
            g.status.version = None;
            g.status.size = None;
            g.status.got = 0;
            g.status.rollback = false;
            g.target = None;
        }),
        Err(e) => fail(&app, "skip", e),
    }
}

/// The AirPlay teardown before an install waits this long at most (2026-09-29): the session's
/// disconnect joins its sender thread, and a speaker that stopped answering must not hold the
/// install. Past it, the install goes on; the process exit ends the session anyway.
const AIRPLAY_STOP_LIMIT: Duration = Duration::from_secs(3);

/// Install the downloaded update now: Update.exe swaps the app after this process exits and
/// starts the new version (~2.4 s, VELOPACK.md §8a). The caller saves its state first.
///
/// `async` + `spawn_blocking` (CLAUDE.md › Conventions, 2026-09-29): a synchronous command runs
/// on the UI thread, and this one joins the AirPlay thread and stops processes.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || install_blocking(&app))
        .await
        .map_err(|e| format!("install failed: {e}"))?
}

/// Stop AirPlay on its own thread and wait for it at most AIRPLAY_STOP_LIMIT.
pub(crate) fn airplay_shutdown_bounded(app: &AppHandle) {
    let (tx, rx) = std::sync::mpsc::channel();
    let a = app.clone();
    std::thread::spawn(move || {
        crate::airplay::shutdown(&a);
        let _ = tx.send(());
    });
    if rx.recv_timeout(AIRPLAY_STOP_LIMIT).is_err() {
        crate::log::warn(&format!("update: the AirPlay stop took over {} s; installing anyway", AIRPLAY_STOP_LIMIT.as_secs()));
    }
}

fn install_blocking(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<UpdateState>();
    let (ready, target) = {
        let g = state.inner.lock_or_recover();
        (g.ready, g.target.clone())
    };
    if !ready {
        return Err("no update is ready to install".into());
    }
    crate::log::info(&format!("update: install over {}", current_version(app)));
    airplay_shutdown_bounded(app);
    let stopped = crate::velo::stop_clis();
    crate::log::info(&format!("update: stopped {stopped} CLI process(es) before the swap"));
    crate::velo::install(target).map_err(|e| {
        let msg = format!("install failed: {e}");
        crate::log::error(&format!("update: {msg}"));
        msg
    })
}

/// The rollback list: older versions in this version's channel group, newest first.
#[tauri::command]
pub async fn update_versions(app: AppHandle) -> Result<serde_json::Value, String> {
    let cur = current_version(&app);
    let client = reqwest::Client::builder()
        .timeout(CHECK_TIMEOUT)
        .user_agent(format!("DeetsMusic/{cur}"))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("{BASE}/{}/versions?v={cur}", channel());
    let resp = client.get(&url).send().await.map_err(|e| format!("no network: {e}"))?;
    let status = resp.status().as_u16();
    if status != 200 {
        return Err(format!("versions: the server answered {status}"));
    }
    resp.json().await.map_err(|e| format!("versions: bad reply: {e}"))
}
