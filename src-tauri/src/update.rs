//! The updater (RELEASE.md §6). `tauri-plugin-updater` does the transport, the signature
//! check and the install; this module adds the rules the plugin does not have:
//! - one download at a time (`downloading`), one verified installer held at a time (`bytes`);
//! - a size cap from the manifest, enforced while the bytes arrive (the plugin buffers the
//!   whole file in memory before it verifies it);
//! - rollback: a `target` version, which the Worker answers only inside the running
//!   version's channel group (§6.5);
//! - a dev build checks and downloads, but never installs: the installer would replace the
//!   INSTALLED app, not this exe.
//!
//! The verified bytes stay in memory, not on disk: a staged file read back later would skip
//! the signature check the plugin runs at download time. ~6 MB, and the cap bounds it.
//! The front end (`src/updater.ts`) decides when to call these, from Settings › Updates.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use futures::future::{AbortHandle, Abortable};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

const BASE: &str = "https://music-api.deets.solutions/update";
/// Refuse a manifest that states a bigger installer, and stop a download that grows past it.
const SIZE_CAP: u64 = 50 * 1024 * 1024;
const CHECK_TIMEOUT: Duration = Duration::from_secs(20);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(600);
const PROGRESS_EVERY: Duration = Duration::from_millis(250);

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
    pending: Option<Update>,
    bytes: Option<Vec<u8>>,
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
                pending: None,
                bytes: None,
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
        let mut g = state.inner.lock().unwrap();
        f(&mut g);
        g.status.current = current_version(app);
        g.status.clone()
    };
    let _ = app.emit("update-state", &s);
    s
}

/// Log and show a failure. A verified installer already held stays offered.
fn fail(app: &AppHandle, what: &str, e: impl std::fmt::Display) -> Status {
    let msg = format!("{what}: {e}");
    crate::log::warn(&format!("update: {msg}"));
    change(app, |g| {
        g.status.state = if g.bytes.is_some() { "ready" } else { "error" };
        g.status.error = Some(msg);
    })
}

#[tauri::command]
pub fn update_status(app: AppHandle) -> Status {
    change(&app, |_| {})
}

/// Ask the Worker for a newer version, or for `target` (a rollback).
#[tauri::command]
pub async fn update_check(app: AppHandle, target: Option<String>) -> Status {
    if app.state::<UpdateState>().downloading.load(Ordering::SeqCst) {
        return change(&app, |_| {}); // one at a time: the running download keeps its place
    }
    let cur = current_version(&app);
    let rollback = target.is_some();
    let mut url = format!("{BASE}/{}?v={{{{current_version}}}}", channel());
    if let Some(t) = &target {
        if t.is_empty() || !t.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+')) {
            return fail(&app, "rollback", format!("not a version: {t:?}"));
        }
        url.push_str("&target=");
        url.push_str(t);
    }
    change(&app, |g| {
        g.status.state = "checking";
        g.status.error = None;
    });

    let built = (|| -> Result<_, String> {
        let endpoint: url::Url = url.parse().map_err(|e| format!("{e}"))?;
        let mut b = app
            .updater_builder()
            .endpoints(vec![endpoint])
            .map_err(|e| e.to_string())?
            .timeout(CHECK_TIMEOUT)
            .header("User-Agent", format!("DeetsMusic/{cur}"))
            .map_err(|e| e.to_string())?;
        if rollback {
            // The Worker answers a target only inside this version's group; "older" is the point.
            b = b.version_comparator(|current, release| release.version != current);
        }
        b.build().map_err(|e| e.to_string())
    })();
    let updater = match built {
        Ok(u) => u,
        Err(e) => return fail(&app, "check", e),
    };

    match updater.check().await {
        Ok(Some(mut update)) => {
            let size = update.raw_json.get("size").and_then(|v| v.as_u64());
            if !matches!(size, Some(s) if s <= SIZE_CAP) {
                return fail(
                    &app,
                    "check",
                    format!("refused {}: size {size:?} is missing or over {SIZE_CAP} bytes", update.version),
                );
            }
            update.timeout = Some(DOWNLOAD_TIMEOUT);
            let version = update.version.clone();
            let notes = update.body.clone();
            crate::log::info(&format!(
                "update: {} {version} offered ({} bytes, channel {})",
                if rollback { "rollback to" } else { "version" },
                size.unwrap_or(0),
                channel()
            ));
            change(&app, move |g| {
                let same = g.status.version.as_deref() == Some(version.as_str()) && g.status.rollback == rollback;
                if !same {
                    g.bytes = None;
                }
                let ready = g.bytes.is_some();
                g.status.state = if ready { "ready" } else { "available" };
                g.status.version = Some(version);
                g.status.notes = notes;
                g.status.size = size;
                g.status.got = if ready { size.unwrap_or(0) } else { 0 };
                g.status.rollback = rollback;
                g.status.error = None;
                g.pending = Some(update);
            })
        }
        Ok(None) => change(&app, |g| {
            g.status.state = "idle";
            g.status.version = None;
            g.status.notes = None;
            g.status.size = None;
            g.status.got = 0;
            g.status.rollback = false;
            g.status.error = None;
            g.pending = None;
            g.bytes = None;
        }),
        Err(e) => fail(&app, if rollback { "rollback" } else { "check" }, e),
    }
}

/// Download and verify the offered installer. A second call while one runs returns at once.
#[tauri::command]
pub async fn update_download(app: AppHandle) -> Status {
    let state = app.state::<UpdateState>();
    let update = {
        let g = state.inner.lock().unwrap();
        if g.bytes.is_some() {
            drop(g);
            return change(&app, |_| {});
        }
        g.pending.clone()
    };
    let Some(update) = update else {
        return fail(&app, "download", "nothing to download; check first");
    };
    if state.downloading.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return change(&app, |_| {});
    }
    let result = fetch(&app, &update).await;
    state.downloading.store(false, Ordering::SeqCst);
    match result {
        Ok(bytes) => {
            crate::log::info(&format!("update: {} downloaded and verified ({} bytes)", update.version, bytes.len()));
            let version = update.version.clone();
            change(&app, move |g| {
                // Keep the bytes only for the offer they belong to.
                if g.status.version.as_deref() == Some(version.as_str()) {
                    g.status.got = bytes.len() as u64;
                    g.status.state = "ready";
                    g.bytes = Some(bytes);
                }
            })
        }
        Err(e) => fail(&app, "download", e),
    }
}

async fn fetch(app: &AppHandle, update: &Update) -> Result<Vec<u8>, String> {
    let limit = update.raw_json.get("size").and_then(|v| v.as_u64()).unwrap_or(SIZE_CAP).min(SIZE_CAP);
    change(app, |g| {
        g.status.state = "downloading";
        g.status.got = 0;
        g.status.error = None;
    });
    let (handle, registration) = AbortHandle::new_pair();
    let mut got: u64 = 0;
    let mut last = Instant::now();
    let on_chunk = |len: usize, _total: Option<u64>| {
        got += len as u64;
        if got > limit {
            handle.abort();
            return;
        }
        if last.elapsed() >= PROGRESS_EVERY {
            last = Instant::now();
            let at = got;
            change(app, |g| g.status.got = at);
        }
    };
    match Abortable::new(update.download(on_chunk, || {}), registration).await {
        Ok(Ok(bytes)) => Ok(bytes),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err(format!("stopped: the download grew past {limit} bytes")),
    }
}

/// Run the verified installer. On Windows the plugin starts NSIS with `/P /UPDATE /R`
/// (passive, relaunch after) and exits this process, so the caller saves its state first.
#[tauri::command]
pub fn update_install(app: AppHandle) -> Result<(), String> {
    let state = app.state::<UpdateState>();
    let (update, bytes) = {
        let mut g = state.inner.lock().unwrap();
        match (g.pending.clone(), g.bytes.take()) {
            (Some(u), Some(b)) => (u, b),
            (_, b) => {
                g.bytes = b;
                return Err("no update is ready to install".into());
            }
        }
    };
    if cfg!(debug_assertions) {
        crate::log::info(&format!("update: dev build, install of {} skipped", update.version));
        state.inner.lock().unwrap().bytes = Some(bytes);
        return Err("A dev build doesn't install updates.".into());
    }
    crate::log::info(&format!("update: installing {} over {}; the app exits now", update.version, current_version(&app)));
    crate::airplay::shutdown(&app);
    update.install(bytes).map_err(|e| {
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
