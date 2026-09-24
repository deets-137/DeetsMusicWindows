//! DeetsMusic Beta (docs/ops/BETA.md): a second installed app that sits beside the full one.
//!
//! A beta build is a release build made with `npm run release -- --beta`, which sets
//! `DEETSMUSIC_FLAVOR=beta` and merges `tauri.beta.conf.json` (its own identifier, name,
//! icon and link scheme). Everything the two apps must not share is keyed off `is_beta()`:
//! the update channel, the link scheme, the Launch-at-startup value, the MCP entry name.
//!
//! **The copy (§2).** The beta starts with the full app's data: the library cache, the Apple
//! sign-in, the settings (settings.json AND the WebView's localStorage) and the Last.fm login.
//! Not `friends.json` — a friend code is one identity, and two apps holding it would take
//! each other's presence. It copies once, on the first start, and again whenever
//! `deetsmusic-beta pull` asks (the bridge's `POST /beta/pull`: a mark file, then a restart).
//!
//! It runs at the very top of `run()`, before `tauri::Builder`: Tauri creates the config
//! windows BEFORE the setup hook, and a window's WebView opens its localStorage as it is
//! created, so a copy inside setup would land under a live WebView. The log is not open yet
//! either, so the lines wait in `NOTES` until `log_notes()`.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

/// The full app's identifier: where the copy comes FROM. Only ever read.
const FULL_ID: &str = "com.deetsmusic.app";
/// This app's identifier (tauri.beta.conf.json). The copy never writes anywhere else.
const BETA_ID: &str = "com.deetsmusic.beta";
/// The pull mark: `POST /beta/pull` writes it (holding the old process id) and restarts.
const PULL_MARK: &str = "pull-requested";
/// Plain files taken as they are. `friends.json` is left out on purpose (module doc).
const FILES: [&str; 3] = ["user-token.txt", "developer-token.json", "lastfm-session.json"];
/// settings.json keys the beta keeps as its own: the bridge token (so `deetsmusic` and
/// `deetsmusic-beta` each reach only their app), the firewall rule's exe path (it names the
/// full app's exe) and the window position (two windows on one spot hide each other).
const OWN_KEYS: [&str; 3] = ["bridgeToken", "airplayFirewallExe", "windowPos"];

static NOTES: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// True in a beta release build. A debug build is never the beta: `dev:app` has its own
/// identifier, and `is_beta()` must never point a dev run at the beta's data.
pub fn is_beta() -> bool {
    !cfg!(debug_assertions) && option_env!("DEETSMUSIC_FLAVOR") == Some("beta")
}

/// The name people see: the health route, the MCP entry, the Launch-at-startup value.
pub fn app_name() -> &'static str {
    if is_beta() {
        "DeetsMusic Beta"
    } else {
        "DeetsMusic"
    }
}

fn note(line: String) {
    NOTES.lock().unwrap_or_else(|e| e.into_inner()).push(line);
}

/// Write the lines `before_start` kept, once the log is open.
pub fn log_notes() {
    for line in NOTES.lock().unwrap_or_else(|e| e.into_inner()).drain(..) {
        crate::log::info(&line);
    }
}

fn dirs() -> Option<(PathBuf, PathBuf)> {
    let roaming = PathBuf::from(std::env::var_os("APPDATA")?);
    let local = PathBuf::from(std::env::var_os("LOCALAPPDATA")?);
    Some((roaming, local))
}

/// The copy, when one is due: the first start, or a pull mark. Never writes outside the
/// beta's own two folders, and never writes the full app's.
pub fn before_start() {
    if !is_beta() {
        return;
    }
    let Some((roaming, local)) = dirs() else { return };
    let me = roaming.join(BETA_ID);
    let full = roaming.join(FULL_ID);
    let mark = me.join(PULL_MARK);
    let pull = mark.is_file();
    if !pull && me.join("deetsmusic.db").exists() {
        return;
    }
    if pull {
        // The old process wrote its id, then asked Tauri to restart. Tauri starts this one
        // first and exits the old one after, so wait for it: until it is gone, its db is open
        // and its single-instance lock would turn this process away.
        if let Some(pid) = std::fs::read_to_string(&mark).ok().and_then(|s| s.trim().parse::<u32>().ok()) {
            wait_for_exit(pid, Duration::from_secs(10));
        }
    }
    let why = if pull { "pull" } else { "first start" };
    if !full.join("deetsmusic.db").is_file() {
        note(format!("beta: {why}: no full app data at {}; nothing copied", full.display()));
        std::fs::remove_file(&mark).ok();
        return;
    }
    if let Err(e) = std::fs::create_dir_all(&me) {
        note(format!("beta: {why}: could not make {}: {e}", me.display()));
        return;
    }
    let mut done = Vec::new();
    match copy_db(&full, &me) {
        Ok(()) => done.push("library"),
        Err(e) => note(format!("beta: {why}: library copy failed: {e}")),
    }
    for name in FILES {
        let from = full.join(name);
        if from.is_file() {
            match std::fs::copy(&from, me.join(name)) {
                Ok(_) => done.push(name),
                Err(e) => note(format!("beta: {why}: {name} copy failed: {e}")),
            }
        }
    }
    match copy_settings(&full, &me) {
        Ok(()) => done.push("settings.json"),
        Err(e) => note(format!("beta: {why}: settings.json copy failed: {e}")),
    }
    let store = |root: &Path, id: &str| root.join(id).join("EBWebView").join("Default").join("Local Storage");
    match copy_local_storage(&store(&local, FULL_ID), &store(&local, BETA_ID)) {
        Ok(true) => done.push("localStorage"),
        Ok(false) => {}
        Err(e) => note(format!("beta: {why}: localStorage copy failed: {e}")),
    }
    std::fs::remove_file(&mark).ok();
    note(format!("beta: {why}: copied {} from the full app", done.join(", ")));
}

/// The db runs in WAL mode (LOCAL-DATA.md §3), and the full app may be running: its newest
/// writes can sit in the -wal file. `VACUUM INTO` from a read-only connection writes one
/// consistent file. It goes to a side name first, so a failed copy leaves the beta's own db.
fn copy_db(full: &Path, me: &Path) -> Result<(), String> {
    let side = me.join("deetsmusic.db.pull");
    std::fs::remove_file(&side).ok();
    let src = rusqlite::Connection::open_with_flags(full.join("deetsmusic.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    src.execute("VACUUM INTO ?1", [side.to_string_lossy()]).map_err(|e| e.to_string())?;
    drop(src);
    // The old -wal / -shm belong to the old db; left beside the new one, SQLite would replay them.
    for old in ["deetsmusic.db", "deetsmusic.db-wal", "deetsmusic.db-shm"] {
        let p = me.join(old);
        if p.exists() {
            std::fs::remove_file(&p).map_err(|e| format!("{old}: {e}"))?;
        }
    }
    std::fs::rename(&side, me.join("deetsmusic.db")).map_err(|e| e.to_string())
}

/// The full app's settings.json with the beta's own keys put back (`OWN_KEYS`). On the first
/// start the beta has none, so they are dropped and the beta makes its own. Launch at startup
/// is marked as already offered: the beta never adds itself to Windows start-up.
fn copy_settings(full: &Path, me: &Path) -> Result<(), String> {
    let read = |p: &Path| -> Option<serde_json::Map<String, serde_json::Value>> {
        serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(p).ok()?).ok()?.as_object().cloned()
    };
    let mut data = read(&full.join("settings.json")).ok_or("the full app has no readable settings.json")?;
    let mine = read(&me.join("settings.json")).unwrap_or_default();
    for key in OWN_KEYS {
        match mine.get(key) {
            Some(v) => data.insert(key.to_string(), v.clone()),
            None => data.remove(key),
        };
    }
    data.insert("autostartSeeded".into(), serde_json::Value::Bool(true));
    let json = serde_json::to_string_pretty(&serde_json::Value::Object(data)).map_err(|e| e.to_string())?;
    std::fs::write(me.join("settings.json"), json).map_err(|e| e.to_string())
}

/// WebView2 keeps localStorage as a LevelDB folder. The beta's WebView is not open yet (this
/// runs before any window), so its folder is replaced whole. The full app's may be open: its
/// LOCK file is skipped (the beta's WebView makes its own), and LevelDB replays its log on open.
/// `Ok(false)` = the full app has no localStorage yet.
fn copy_local_storage(from: &Path, to: &Path) -> Result<bool, String> {
    if !from.is_dir() {
        return Ok(false);
    }
    if to.exists() {
        std::fs::remove_dir_all(to).map_err(|e| e.to_string())?;
    }
    copy_tree(from, to)?;
    Ok(true)
}

fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(from).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if name == "LOCK" {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            copy_tree(&path, &to.join(&name))?;
        } else {
            std::fs::copy(&path, to.join(&name)).map_err(|e| format!("{}: {e}", name.to_string_lossy()))?;
        }
    }
    Ok(())
}

fn wait_for_exit(pid: u32, limit: Duration) {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE};
    // SAFETY: a handle we open, wait on and close here; a gone process fails OpenProcess.
    unsafe {
        if let Ok(h) = OpenProcess(PROCESS_SYNCHRONIZE, false, pid) {
            WaitForSingleObject(h, limit.as_millis() as u32);
            CloseHandle(h).ok();
        }
    }
}

/// `POST /beta/pull` (bridge.rs): mark the pull with this process's id, then restart. The new
/// process waits for this one to exit, copies, and opens on the fresh data. The reply goes
/// out before the restart; the delay lets it leave the socket.
pub fn request_pull(app: &tauri::AppHandle) -> Result<(), String> {
    let Some((roaming, _)) = dirs() else { return Err("no APPDATA".into()) };
    let me = roaming.join(BETA_ID);
    if !roaming.join(FULL_ID).join("deetsmusic.db").is_file() {
        return Err("the full DeetsMusic has no data on this PC to pull from".into());
    }
    std::fs::write(me.join(PULL_MARK), std::process::id().to_string()).map_err(|e| e.to_string())?;
    crate::log::info("beta: pull requested; restarting to copy from the full app");
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(400));
        app.request_restart();
    });
    Ok(())
}
