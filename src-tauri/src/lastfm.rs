//! Last.fm scrobbling (docs/integrations/LASTFM.md).
//!
//! Three jobs, all in Rust, none of them an Apple call:
//! - **Connect** — Last.fm's desktop auth: `auth.getToken`, the browser at `last.fm/api/auth`,
//!   then `auth.getSession` every few seconds until the user clicks Allow. The `cb` link back to
//!   `<scheme>://lastfm` only makes the next check happen at once (§4).
//! - **Now playing** — `record_event_start` (library.rs) calls `now_playing` as a song starts.
//! - **Scrobble** — `stats.ts` calls `lastfm_heard` once per play, when the play passes
//!   Last.fm's rule (a song over 30 s, heard for half its length or 4 minutes). That marks the
//!   `play_events` row `queued`; `flush` sends queued rows oldest first, 50 at a time, and marks
//!   each one `sent`, `ignored` or `failed`. A queued row survives a restart and an offline
//!   spell, which is what Last.fm asks of a client.
//!
//! The API key and shared secret are built into the exe (build.rs, §2). The session key lives
//! in `<app_data>/lastfm-session.json` and never reaches the renderer or the log.

use crate::lock::LockExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

const API_URL: &str = "https://ws.audioscrobbler.com/2.0/";
const AUTH_URL: &str = "https://www.last.fm/api/auth/";
const API_KEY: Option<&str> = option_env!("DEETS_LASTFM_KEY");
const API_SECRET: Option<&str> = option_env!("DEETS_LASTFM_SECRET");
/// Ask Last.fm to send the browser back through `<scheme>://lastfm` after Allow (§4). Off
/// since 2026-09-17: the desktop auth (a token from `auth.getToken`) ignores `cb`, so the
/// 0.8.0 test never came back. The checks alone finish the connect; the user returns by hand.
const LINK_BACK: bool = false;
/// A Last.fm auth token lives 60 minutes; the Apple sign-in waits 5, and so does this.
const AUTH_TTL: Duration = Duration::from_secs(300);
const AUTH_POLL: Duration = Duration::from_secs(3);
const CALL_TIMEOUT: Duration = Duration::from_secs(15);
/// Last.fm's own limits: 50 scrobbles in one call, and it filters timestamps "too far in the past"
/// (about two weeks). An older queued row is marked `ignored` here without a call.
const BATCH: usize = 50;
const MAX_AGE_MS: i64 = 14 * 24 * 60 * 60 * 1000;
/// After a network failure or a Last.fm outage (errors 11, 16, 29): one retry timer at a time.
const RETRY: Duration = Duration::from_secs(300);
/// The first send after launch waits for the app to settle.
const BOOT_DELAY: Duration = Duration::from_secs(20);
/// Last.fm's scrobble rule (last.fm/api/scrobbling).
const MIN_TRACK_MS: u64 = 30_000;
const LISTEN_CAP_MS: u64 = 240_000;

static APP: OnceLock<AppHandle> = OnceLock::new();
static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();
static SESSION: Mutex<Option<Session>> = Mutex::new(None);
static AUTH: Mutex<AuthStatus> = Mutex::new(AuthStatus::Idle);
static PENDING: Mutex<Option<Pending>> = Mutex::new(None);
static FLUSHING: AtomicBool = AtomicBool::new(false);
static RETRY_ARMED: AtomicBool = AtomicBool::new(false);
/// Last.fm answered error 9 (the session key was revoked). The session stays so queued rows
/// keep waiting; the Account row says "Connect again", and a new connect replaces it.
static NEEDS_RECONNECT: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize, Deserialize)]
struct Session {
    name: String,
    key: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum AuthStatus {
    Idle,
    Pending,
    Connected { name: String },
    Failed { reason: String },
}

/// One connect in progress: its token (single use, 60 min at Last.fm, 5 min here), when it
/// started, the stop flag a cancel raises, and the flag a link back raises to check at once.
struct Pending {
    token: String,
    abort: Arc<AtomicBool>,
    poke: Arc<AtomicBool>,
}

enum CallError {
    /// No answer, or an answer that is not Last.fm's JSON.
    Net(String),
    /// Last.fm's own error code and message.
    Api(i64, String),
}

impl std::fmt::Display for CallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CallError::Net(e) => write!(f, "{e}"),
            CallError::Api(c, m) => write!(f, "error {c}: {m}"),
        }
    }
}

fn available() -> bool {
    API_KEY.is_some() && API_SECRET.is_some()
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn session_path() -> Option<PathBuf> {
    DATA_DIR.get().map(|d| d.join("lastfm-session.json"))
}

fn changed() {
    if let Some(app) = APP.get() {
        let _ = app.emit("lastfm-changed", ());
    }
}

/// From `lib.rs` setup, after the db is managed: load the session and send what waits.
pub fn setup(app: &AppHandle, dir: PathBuf) {
    let _ = APP.set(app.clone());
    let _ = DATA_DIR.set(dir);
    if !available() {
        crate::log::info("lastfm: no API key in this build; scrobbling is off");
        return;
    }
    let session = session_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Session>(&s).ok());
    if let Some(s) = session {
        crate::log::register_secret(&s.key);
        crate::log::info("lastfm: connected at launch");
        *SESSION.lock_or_recover() = Some(s);
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio_sleep(BOOT_DELAY).await;
            flush(&app);
        });
    }
}

async fn tokio_sleep(d: Duration) {
    // No tokio feature of our own: a blocking sleep on the blocking pool is enough here.
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}

// ── the call ────────────────────────────────────────────────────────────────

/// `api_sig`: every parameter but `format`, sorted by name, name then value, then the secret.
fn sign(params: &[(String, String)]) -> String {
    let mut sorted: Vec<&(String, String)> = params.iter().filter(|(k, _)| k != "format").collect();
    sorted.sort_by(|a, b| a.0.cmp(&b.0));
    let mut h = Md5::new();
    for (k, v) in sorted {
        h.update(k.as_bytes());
        h.update(v.as_bytes());
    }
    h.update(API_SECRET.unwrap_or_default().as_bytes());
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// One signed POST. Every method we use is signed (auth, now playing, scrobble).
async fn call(method: &str, mut params: Vec<(String, String)>) -> Result<serde_json::Value, CallError> {
    let Some(key) = API_KEY else { return Err(CallError::Net("no API key in this build".into())) };
    params.push(("method".into(), method.into()));
    params.push(("api_key".into(), key.into()));
    let sig = sign(&params);
    params.push(("api_sig".into(), sig));
    params.push(("format".into(), "json".into()));
    let body = url::form_urlencoded::Serializer::new(String::new()).extend_pairs(params.iter()).finish();

    let client = reqwest::Client::builder()
        .timeout(CALL_TIMEOUT)
        .user_agent(format!("DeetsMusic/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| CallError::Net(e.to_string()))?;
    let resp = client
        .post(API_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| CallError::Net(if e.is_timeout() { "timed out".into() } else { e.to_string() }))?;
    let status = resp.status().as_u16();
    let json: serde_json::Value = resp.json().await.map_err(|_| CallError::Net(format!("HTTP {status}, not JSON")))?;
    if let Some(code) = json.get("error").and_then(as_int) {
        let msg = json.get("message").and_then(|m| m.as_str()).unwrap_or("").to_string();
        return Err(CallError::Api(code, msg));
    }
    if status != 200 {
        return Err(CallError::Net(format!("HTTP {status}")));
    }
    Ok(json)
}

/// Last.fm sends some numbers as strings ("code": "0").
fn as_int(v: &serde_json::Value) -> Option<i64> {
    v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

// ── connect ─────────────────────────────────────────────────────────────────

/// Start a connect: a token, the browser, and the checks. `lastfm_auth_status` reports it.
#[tauri::command]
pub async fn lastfm_begin_auth(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if !available() {
        return Err("lastfm-unavailable".into());
    }
    stop_pending();
    *AUTH.lock_or_recover() = AuthStatus::Pending;
    let token = match call("auth.getToken", vec![]).await {
        Ok(v) => v.get("token").and_then(|t| t.as_str()).map(str::to_string),
        Err(CallError::Net(e)) => {
            crate::log::warn(&format!("lastfm: connect could not reach Last.fm ({e})"));
            *AUTH.lock_or_recover() = AuthStatus::Failed { reason: "offline".into() };
            return Err("offline".into());
        }
        Err(e) => {
            crate::log::warn(&format!("lastfm: auth.getToken refused ({e})"));
            *AUTH.lock_or_recover() = AuthStatus::Failed { reason: e.to_string() };
            return Err(e.to_string());
        }
    };
    let Some(token) = token else {
        *AUTH.lock_or_recover() = AuthStatus::Failed { reason: "no token".into() };
        return Err("no token".into());
    };
    let abort = Arc::new(AtomicBool::new(false));
    let poke = Arc::new(AtomicBool::new(false));
    *PENDING.lock_or_recover() = Some(Pending { token: token.clone(), abort: abort.clone(), poke: poke.clone() });

    let mut url = format!("{AUTH_URL}?api_key={}&token={token}", API_KEY.unwrap_or_default());
    if LINK_BACK {
        let cb = format!("{}://lastfm", crate::apple::link_scheme());
        url.push_str("&cb=");
        url.push_str(&url::form_urlencoded::byte_serialize(cb.as_bytes()).collect::<String>());
    }
    if let Err(e) = app.opener().open_url(&url, None::<&str>) {
        stop_pending();
        *AUTH.lock_or_recover() = AuthStatus::Failed { reason: "browser".into() };
        return Err(format!("could not open browser: {e}"));
    }
    // The token is single use and worth nothing without the secret; the address is not logged
    // anyway, so the log line names only the step.
    crate::log::info("lastfm: connect page opened in the browser");

    tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        loop {
            // Wait AUTH_POLL, or less when the link back pokes.
            let mut waited = Duration::ZERO;
            while waited < AUTH_POLL && !poke.swap(false, Ordering::Relaxed) {
                if abort.load(Ordering::Relaxed) {
                    return;
                }
                tokio_sleep(Duration::from_millis(250)).await;
                waited += Duration::from_millis(250);
            }
            if abort.load(Ordering::Relaxed) {
                return;
            }
            if started.elapsed() > AUTH_TTL {
                crate::log::warn("lastfm: no Allow within 5 min; connect abandoned");
                end_pending(AuthStatus::Failed { reason: "timeout".into() });
                return;
            }
            match call("auth.getSession", vec![("token".into(), token.clone())]).await {
                Ok(v) => {
                    let s = v.get("session");
                    let name = s.and_then(|s| s.get("name")).and_then(|n| n.as_str()).unwrap_or("").to_string();
                    let key = s.and_then(|s| s.get("key")).and_then(|n| n.as_str()).unwrap_or("").to_string();
                    if key.is_empty() {
                        end_pending(AuthStatus::Failed { reason: "no session".into() });
                        return;
                    }
                    if abort.load(Ordering::Relaxed) {
                        return; // cancelled while the call was out
                    }
                    finish_connect(&app, Session { name, key });
                    return;
                }
                // 14: the user has not clicked Allow yet. A network miss: try again next round.
                Err(CallError::Api(14, _)) | Err(CallError::Net(_)) => continue,
                Err(e) => {
                    crate::log::warn(&format!("lastfm: auth.getSession refused ({e})"));
                    let reason = match e {
                        CallError::Api(15, _) | CallError::Api(4, _) => "expired".to_string(),
                        e => e.to_string(),
                    };
                    end_pending(AuthStatus::Failed { reason });
                    return;
                }
            }
        }
    });
    Ok(())
}

fn stop_pending() {
    if let Some(p) = PENDING.lock_or_recover().take() {
        p.abort.store(true, Ordering::Relaxed);
    }
}

fn end_pending(status: AuthStatus) {
    PENDING.lock_or_recover().take();
    *AUTH.lock_or_recover() = status;
    changed();
}

fn finish_connect(app: &AppHandle, s: Session) {
    crate::log::register_secret(&s.key);
    if let Some(p) = session_path() {
        match serde_json::to_string(&s) {
            Ok(json) => {
                // Write beside, then rename over (safe_file.rs): never half a session.
                if let Err(e) = crate::safe_file::write_atomic(&p, json.as_bytes()) {
                    crate::log::warn(&format!("lastfm: could not save the session: {e}"));
                }
            }
            Err(e) => crate::log::warn(&format!("lastfm: could not save the session: {e}")),
        }
    }
    crate::log::info("lastfm: connected");
    let name = s.name.clone();
    *SESSION.lock_or_recover() = Some(s);
    NEEDS_RECONNECT.store(false, Ordering::Relaxed);
    end_pending(AuthStatus::Connected { name });
    flush(app); // rows that waited through a reconnect
}

#[tauri::command]
pub fn lastfm_auth_status() -> AuthStatus {
    AUTH.lock_or_recover().clone()
}

/// The Last.fm button clicked again while a connect waits.
#[tauri::command]
pub fn lastfm_cancel_auth() {
    stop_pending();
    let mut auth = AUTH.lock_or_recover();
    if matches!(*auth, AuthStatus::Pending) {
        *auth = AuthStatus::Failed { reason: "cancelled".into() };
        crate::log::info("lastfm: connect cancelled from the Account row");
    }
}

/// Is this `<scheme>://lastfm…` link ours? (`lib.rs` routes links by host.)
pub fn is_link(raw: &str) -> bool {
    url::Url::parse(raw).ok().and_then(|u| u.host_str().map(|h| h.eq_ignore_ascii_case("lastfm"))).unwrap_or(false)
}

/// Last.fm's link back after Allow: `<scheme>://lastfm?token=…`. Any page can open such a link,
/// so it carries no power: a token that matches the connect in progress only makes the next
/// `auth.getSession` check happen now. Anything else is ignored.
pub fn handle_link(raw: &str) {
    let token = url::Url::parse(raw)
        .ok()
        .and_then(|u| u.query_pairs().find(|(k, _)| k == "token").map(|(_, v)| v.into_owned()));
    let pending = PENDING.lock_or_recover();
    match (pending.as_ref(), token) {
        (Some(p), Some(t)) if p.token == t => {
            p.poke.store(true, Ordering::Relaxed);
            crate::log::info("lastfm: link back arrived; checking now");
        }
        (None, _) => crate::log::warn("lastfm: link arrived with no connect in progress; ignored"),
        _ => crate::log::warn("lastfm: link token does not match the connect in progress; ignored"),
    }
}

/// Forget the account: the session file, and the rows still waiting (they would go to the
/// next account connected). Sent rows stay `sent`.
#[tauri::command]
pub async fn lastfm_disconnect(app: AppHandle) -> Result<(), String> {
    stop_pending();
    *SESSION.lock_or_recover() = None;
    NEEDS_RECONNECT.store(false, Ordering::Relaxed);
    *AUTH.lock_or_recover() = AuthStatus::Idle;
    if let Some(p) = session_path() {
        let _ = std::fs::remove_file(p);
    }
    // On the database thread (db_thread.rs): dropping the queue takes the lock.
    let dropped = crate::db_thread::run(&app, |db| {
        let conn = db.lock();
        conn.execute("UPDATE play_events SET lastfm = NULL WHERE lastfm = 'queued'", [])
            .map_err(|e| e.to_string())
    })
    .await?;
    crate::log::info(&format!("lastfm: disconnected; {dropped} waiting scrobble(s) dropped"));
    changed();
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastfmStatus {
    /// The build carries an API key.
    available: bool,
    connected: bool,
    name: Option<String>,
    /// Last.fm refused the session (error 9): connect again; the queue waits.
    reconnect: bool,
    /// Rows marked `queued`.
    waiting: i64,
}

#[tauri::command]
pub async fn lastfm_status(app: AppHandle) -> Result<LastfmStatus, String> {
    // On the database thread (db_thread.rs): the count takes the lock.
    crate::db_thread::run(&app, move |db| {
        let name = SESSION.lock_or_recover().as_ref().map(|s| s.name.clone());
        let waiting = {
            let conn = db.lock();
            conn.query_row("SELECT COUNT(*) FROM play_events WHERE lastfm = 'queued'", [], |r| r.get(0)).unwrap_or(0)
        };
        Ok(LastfmStatus {
            available: available(),
            connected: name.is_some(),
            name,
            reconnect: NEEDS_RECONNECT.load(Ordering::Relaxed),
            waiting,
        })
    })
    .await
}

/// The user's profile page (the Account row's name).
#[tauri::command]
pub fn lastfm_open_profile(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let Some(name) = SESSION.lock_or_recover().as_ref().map(|s| s.name.clone()) else { return Ok(()) };
    let path: String = url::form_urlencoded::byte_serialize(name.as_bytes()).collect();
    app.opener()
        .open_url(format!("https://www.last.fm/user/{path}"), None::<&str>)
        .map_err(|e| e.to_string())
}

fn mark_reconnect(e: &CallError) {
    if !NEEDS_RECONNECT.swap(true, Ordering::Relaxed) {
        crate::log::warn(&format!("lastfm: Last.fm refused the session ({e}); scrobbles wait for a new connect"));
        if let Some(app) = APP.get() {
            let _ = app.emit("lastfm-reconnect", ());
        }
        changed();
    }
}

// ── now playing + scrobble ──────────────────────────────────────────────────

struct Meta {
    artist: String,
    title: String,
    album: Option<String>,
    duration_ms: Option<u64>,
}

fn meta_of(json: &str) -> Option<Meta> {
    let t: crate::model::Track = serde_json::from_str(json).ok()?;
    if t.artist_name.trim().is_empty() || t.title.trim().is_empty() {
        return None;
    }
    Some(Meta {
        artist: t.artist_name,
        title: t.title,
        album: t.album_name.filter(|a| !a.trim().is_empty()),
        duration_ms: t.duration_ms,
    })
}

fn track_meta(app: &AppHandle, track_id: &str) -> Option<Meta> {
    let db = app.state::<crate::library::Db>();
    let conn = db.lock();
    let json: String = conn.query_row("SELECT json FROM tracks WHERE track_id = ?1", [track_id], |r| r.get(0)).ok()?;
    meta_of(&json)
}

fn settings(app: &AppHandle) -> crate::settings::SettingsData {
    app.state::<crate::settings::Settings>().get()
}

/// A song started (library.rs `record_event_start`). Fire and forget: a miss costs only the
/// "listening now" line on the profile, so nothing retries.
pub fn now_playing(app: &AppHandle, track_id: String) {
    if SESSION.lock_or_recover().is_none() || NEEDS_RECONNECT.load(Ordering::Relaxed) || !settings(app).lastfm_now_playing {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // A catalog song played for the first time is saved to `tracks` by the same click
        // (materialize_track); give that write a moment if it has not landed.
        let meta = match track_meta(&app, &track_id) {
            Some(m) => Some(m),
            None => {
                tokio_sleep(Duration::from_millis(1500)).await;
                track_meta(&app, &track_id)
            }
        };
        let Some(m) = meta else { return };
        // Live radio has no length, and Last.fm scrobbles nothing under 30 s: say nothing.
        let Some(dur) = m.duration_ms.filter(|d| *d > MIN_TRACK_MS) else { return };
        let Some(sk) = SESSION.lock_or_recover().as_ref().map(|s| s.key.clone()) else { return };
        let mut p = vec![
            ("artist".to_string(), m.artist),
            ("track".to_string(), m.title),
            ("duration".to_string(), (dur / 1000).to_string()),
            ("sk".to_string(), sk),
        ];
        if let Some(a) = m.album {
            p.push(("album".into(), a));
        }
        match call("track.updateNowPlaying", p).await {
            Ok(_) => {}
            Err(e @ CallError::Api(9, _)) => mark_reconnect(&e),
            Err(e) => crate::log::warn(&format!("lastfm: now playing not sent ({e})")),
        }
    });
}

/// A play passed Last.fm's rule in the renderer's count (stats.ts). Rust checks it again with
/// the stored length (the renderer's is a fallback for a song with none stored), marks the row
/// `queued` once, and sends. Returns whether the row was queued.
#[tauri::command]
pub async fn lastfm_heard(event_id: i64, ms_listened: i64, duration_ms: Option<u64>, app: AppHandle) -> Result<bool, String> {
    // On the database thread (db_thread.rs): the queue mark takes the lock. `flush` starts
    // its own task, so no network call runs on that thread.
    let handle = app.clone();
    crate::db_thread::run(&handle, move |db| heard_on_db(event_id, ms_listened, duration_ms, &app, db)).await
}

fn heard_on_db(event_id: i64, ms_listened: i64, duration_ms: Option<u64>, app: &AppHandle, db: &crate::library::Db) -> Result<bool, String> {
    if SESSION.lock_or_recover().is_none() || !settings(app).lastfm_scrobble {
        return Ok(false);
    }
    let queued = {
        let conn = db.lock();
        let json: Option<String> = conn
            .query_row(
                "SELECT t.json FROM play_events e LEFT JOIN tracks t ON t.track_id = e.track_id
                 WHERE e.id = ?1 AND e.lastfm IS NULL",
                [event_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let dur = json.as_deref().and_then(meta_of).and_then(|m| m.duration_ms).or(duration_ms).unwrap_or(0);
        let heard = ms_listened.max(0) as u64;
        if dur <= MIN_TRACK_MS || heard < (dur / 2).min(LISTEN_CAP_MS) {
            return Ok(false);
        }
        conn.execute("UPDATE play_events SET lastfm = 'queued' WHERE id = ?1 AND lastfm IS NULL", [event_id])
            .map_err(|e| e.to_string())?
            > 0
    };
    if queued {
        crate::log::info(&format!("lastfm: play {event_id} queued"));
        flush(app);
    }
    Ok(queued)
}

fn arm_retry(app: &AppHandle, why: &CallError) {
    crate::log::warn(&format!("lastfm: send failed ({why}); retrying in 5 min"));
    if RETRY_ARMED.swap(true, Ordering::Relaxed) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio_sleep(RETRY).await;
        RETRY_ARMED.store(false, Ordering::Relaxed);
        flush(&app);
    });
}

fn set_status(app: &AppHandle, ids: &[i64], status: &str) {
    let db = app.state::<crate::library::Db>();
    let conn = db.lock();
    for id in ids {
        // A lost status write means a scrobble is sent twice or waits forever: count it.
        let _ = crate::dbhealth::watch(
            "scrobble status",
            conn.execute("UPDATE play_events SET lastfm = ?1 WHERE id = ?2", rusqlite::params![status, id]),
        );
    }
}

struct Row {
    id: i64,
    started_ts: i64,
    context: Option<String>,
    meta: Option<Meta>,
}

/// Send every queued row, oldest first. One flush at a time; a flush that finds a newer row
/// queued while it ran picks it up on its next round.
pub fn flush(app: &AppHandle) {
    if FLUSHING.swap(true, Ordering::Relaxed) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        run_flush(&app).await;
        FLUSHING.store(false, Ordering::Relaxed);
        changed();
    });
}

async fn run_flush(app: &AppHandle) {
    // After Last.fm refuses a batch for one bad row (error 6), send one row per call so the
    // good rows still go.
    let mut single = false;
    loop {
        if NEEDS_RECONNECT.load(Ordering::Relaxed) {
            return;
        }
        let Some(sk) = SESSION.lock_or_recover().as_ref().map(|s| s.key.clone()) else { return };
        let rows: Vec<Row> = {
            let db = app.state::<crate::library::Db>();
            let conn = db.lock();
            let old = conn
                .execute(
                    "UPDATE play_events SET lastfm = 'ignored' WHERE lastfm = 'queued' AND started_ts < ?1",
                    [now_ms() - MAX_AGE_MS],
                )
                .unwrap_or(0);
            if old > 0 {
                crate::log::warn(&format!("lastfm: {old} waiting scrobble(s) older than 14 days; Last.fm would refuse them"));
            }
            let Ok(mut stmt) = conn.prepare_cached(
                "SELECT e.id, e.started_ts, e.context, t.json FROM play_events e
                 LEFT JOIN tracks t ON t.track_id = e.track_id
                 WHERE e.lastfm = 'queued' ORDER BY e.started_ts LIMIT ?1",
            ) else {
                return;
            };
            let limit = if single { 1 } else { BATCH as i64 };
            let mapped = stmt.query_map([limit], |r| {
                let json: Option<String> = r.get(3)?;
                Ok(Row { id: r.get(0)?, started_ts: r.get(1)?, context: r.get(2)?, meta: json.as_deref().and_then(meta_of) })
            });
            match mapped {
                Ok(it) => it.filter_map(Result::ok).collect(),
                Err(_) => return,
            }
        };
        if rows.is_empty() {
            return;
        }
        let (rows, blank): (Vec<Row>, Vec<Row>) = rows.into_iter().partition(|r| r.meta.is_some());
        if !blank.is_empty() {
            crate::log::warn(&format!("lastfm: {} waiting scrobble(s) have no song details; marked failed", blank.len()));
            set_status(app, &blank.iter().map(|r| r.id).collect::<Vec<_>>(), "failed");
        }
        if rows.is_empty() {
            continue;
        }

        let mut p: Vec<(String, String)> = vec![("sk".into(), sk)];
        for (i, r) in rows.iter().enumerate() {
            let m = r.meta.as_ref().unwrap();
            p.push((format!("artist[{i}]"), m.artist.clone()));
            p.push((format!("track[{i}]"), m.title.clone()));
            p.push((format!("timestamp[{i}]"), (r.started_ts / 1000).to_string()));
            if let Some(a) = &m.album {
                p.push((format!("album[{i}]"), a.clone()));
            }
            if let Some(d) = m.duration_ms {
                p.push((format!("duration[{i}]"), (d / 1000).to_string()));
            }
            // A station picked the song, not the user (Last.fm's chosenByUser).
            let chosen = !r.context.as_deref().unwrap_or("").starts_with("station");
            p.push((format!("chosenByUser[{i}]"), if chosen { "1" } else { "0" }.into()));
        }
        let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();

        match call("track.scrobble", p).await {
            Ok(v) => {
                let list = v.pointer("/scrobbles/scrobble");
                let items: Vec<&serde_json::Value> = match list {
                    Some(serde_json::Value::Array(a)) => a.iter().collect(),
                    Some(one) => vec![one],
                    None => vec![],
                };
                let mut sent = vec![];
                let mut ignored = vec![];
                for (i, id) in ids.iter().enumerate() {
                    let msg = items.get(i).and_then(|s| s.get("ignoredMessage"));
                    let code = msg.and_then(|m| m.get("code")).and_then(as_int).unwrap_or(0);
                    if code == 0 {
                        sent.push(*id);
                    } else {
                        let text = msg.and_then(|m| m.get("#text")).and_then(|t| t.as_str()).unwrap_or("");
                        crate::log::warn(&format!("lastfm: play {id} ignored by Last.fm (code {code}: {text})"));
                        ignored.push(*id);
                    }
                }
                set_status(app, &sent, "sent");
                set_status(app, &ignored, "ignored");
                crate::log::info(&format!("lastfm: sent {} scrobble(s), {} ignored", sent.len(), ignored.len()));
                changed();
            }
            Err(e @ CallError::Api(9, _)) => {
                mark_reconnect(&e);
                return;
            }
            // Last.fm down (11, 16), rate limit (29), or no network: the rows keep waiting.
            Err(e @ (CallError::Net(_) | CallError::Api(11 | 16 | 29, _))) => {
                arm_retry(app, &e);
                return;
            }
            // One bad row spoils a batch: go one by one.
            Err(CallError::Api(6, _)) if ids.len() > 1 => {
                single = true;
            }
            Err(e @ CallError::Api(6, _)) => {
                crate::log::warn(&format!("lastfm: play {} refused ({e}); marked failed", ids[0]));
                set_status(app, &ids, "failed");
            }
            // A key or signature problem (10, 13, 26 …) is ours, not the row's: keep the rows and
            // stop until the next launch, so a fixed build still sends them.
            Err(e) => {
                crate::log::error(&format!("lastfm: Last.fm refused the call ({e}); scrobbles wait for the next launch"));
                return;
            }
        }
    }
}

// ── listener counts (LASTFM.md §10) ─────────────────────────────────────────
//
// How many people on Last.fm have heard a song, and how many times: the "rarity" of a song
// for a user who cares. `track.getInfo` needs the API key only, no session, so it works
// before the user connects an account. The answer is cached in `listen_counts` for
// `LISTENERS_TTL`, so a song pane opened twice makes one call. A song Last.fm does not know
// (error 6) is cached as `state = none` for the same time, so it is not asked again on every
// open. The read side is built 2026-10-12; the UI is not (§10).

/// How long a cached count stands before the next read asks Last.fm again. Listener counts
/// move slowly; a month keeps a library of a few thousand songs at a few calls a day.
const LISTENERS_TTL_MS: i64 = 30 * 24 * 60 * 60 * 1000;

pub fn init_tables(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS listen_counts (
            track_id    TEXT PRIMARY KEY,
            state       TEXT NOT NULL,
            listeners   INTEGER,
            playcount   INTEGER,
            url         TEXT,
            fetched_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS artist_info (
            artist      TEXT PRIMARY KEY,
            state       TEXT NOT NULL,
            listeners   INTEGER,
            playcount   INTEGER,
            tags        TEXT,
            on_tour     INTEGER,
            url         TEXT,
            fetched_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS album_info (
            album       TEXT PRIMARY KEY,
            state       TEXT NOT NULL,
            listeners   INTEGER,
            playcount   INTEGER,
            tags        TEXT,
            wiki        TEXT,
            url         TEXT,
            fetched_at  INTEGER NOT NULL
        );",
    )
}

/// One song's Last.fm counts, as the renderer sees them.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenCount {
    /// "have" — Last.fm knows the song. "none" — it does not (error 6, or no artist / title).
    pub state: &'static str,
    /// Distinct Last.fm users who scrobbled it at least once.
    pub listeners: i64,
    /// Every scrobble of it, all users.
    pub playcount: i64,
    /// The song's page on last.fm, for a link.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// When Last.fm answered (ms since the epoch). The UI can say how fresh the number is.
    pub fetched_at: i64,
}

fn cached_count(conn: &rusqlite::Connection, track_id: &str) -> Option<ListenCount> {
    conn.query_row(
        "SELECT state, listeners, playcount, url, fetched_at FROM listen_counts WHERE track_id = ?1",
        [track_id],
        |r| {
            let state: String = r.get(0)?;
            Ok(ListenCount {
                state: if state == "have" { "have" } else { "none" },
                listeners: r.get::<_, Option<i64>>(1)?.unwrap_or(0),
                playcount: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                url: r.get(3)?,
                fetched_at: r.get(4)?,
            })
        },
    )
    .ok()
}

fn store_count(conn: &rusqlite::Connection, track_id: &str, c: &ListenCount) {
    let _ = conn.execute(
        "INSERT OR REPLACE INTO listen_counts(track_id, state, listeners, playcount, url, fetched_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![track_id, c.state, c.listeners, c.playcount, c.url, c.fetched_at],
    );
}

/// `track.getInfo` with `autocorrect=1`, so "Beyoncé" and "Beyonce" land on one page. The
/// signed POST `call` is reused: Last.fm ignores `api_sig` on a method that needs none.
async fn fetch_count(artist: &str, title: &str) -> Result<ListenCount, CallError> {
    let json = call(
        "track.getInfo",
        vec![("artist".into(), artist.into()), ("track".into(), title.into()), ("autocorrect".into(), "1".into())],
    )
    .await?;
    let t = &json["track"];
    Ok(ListenCount {
        state: "have",
        listeners: t.get("listeners").and_then(as_int).unwrap_or(0),
        playcount: t.get("playcount").and_then(as_int).unwrap_or(0),
        url: t.get("url").and_then(|u| u.as_str()).map(str::to_string),
        fetched_at: now_ms(),
    })
}

/// The Last.fm counts for one song. Cache first; one call when the row is missing or older
/// than a month. `Ok(None)` means this build has no key, or the song has no artist or title
/// to ask with. A network failure is an `Err` and caches nothing, so the next open tries again.
#[tauri::command]
pub async fn lastfm_listeners(track_id: String, artist: String, title: String, app: AppHandle) -> Result<Option<ListenCount>, String> {
    if API_KEY.is_none() || track_id.is_empty() {
        return Ok(None);
    }
    let artist = artist.trim().to_string();
    let title = title.trim().to_string();
    if artist.is_empty() || title.is_empty() {
        return Ok(None);
    }
    let id = track_id.clone();
    let hit = crate::db_thread::run(&app, move |db| Ok(cached_count(&db.lock(), &id))).await?;
    if let Some(c) = hit {
        if now_ms() - c.fetched_at < LISTENERS_TTL_MS {
            return Ok(Some(c));
        }
    }
    let count = match fetch_count(&artist, &title).await {
        Ok(c) => c,
        // Track not found: an answer, cached like one.
        Err(CallError::Api(6, _)) => ListenCount { state: "none", listeners: 0, playcount: 0, url: None, fetched_at: now_ms() },
        Err(e) => {
            crate::log::warn(&format!("lastfm: listeners for {track_id} failed ({e})"));
            return Err(e.to_string());
        }
    };
    crate::log::info(&format!(
        "lastfm: listeners for {track_id}: {} ({} listeners, {} plays)",
        count.state, count.listeners, count.playcount
    ));
    let stored = count.clone();
    let id = track_id;
    crate::db_thread::run(&app, move |db| {
        store_count(&db.lock(), &id, &stored);
        Ok(())
    })
    .await?;
    Ok(Some(count))
}

// ── artist facts (LISTENERS.md §6) ──────────────────────────────────────────
//
// `artist.getInfo`: the artist's all-time listeners and plays, Last.fm's tags for them, and
// whether they are on tour. One call per artist, cached in `artist_info` for the same month
// as a song's counts; keyed by the name in lower case, so "Beyoncé" asked from two songs is
// one row. The artist view's facts box (his design, 2026-10-12) reads it.

/// One artist's Last.fm facts, as the renderer sees them.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistInfo {
    /// "have" — Last.fm knows the artist. "none" — it does not (error 6, or no name).
    pub state: &'static str,
    /// Distinct Last.fm users who scrobbled the artist at least once.
    pub listeners: i64,
    /// Every scrobble of the artist, all users.
    pub playcount: i64,
    /// Last.fm's top tags for the artist, most applied first (five at most from the call).
    pub tags: Vec<String>,
    /// Last.fm's `ontour` flag.
    pub on_tour: bool,
    /// The artist's page on last.fm.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// When Last.fm answered (ms since the epoch).
    pub fetched_at: i64,
}

fn artist_key(name: &str) -> String {
    name.trim().to_lowercase()
}

fn cached_artist(conn: &rusqlite::Connection, key: &str) -> Option<ArtistInfo> {
    conn.query_row(
        "SELECT state, listeners, playcount, tags, on_tour, url, fetched_at FROM artist_info WHERE artist = ?1",
        [key],
        |r| {
            let state: String = r.get(0)?;
            let tags: Option<String> = r.get(3)?;
            Ok(ArtistInfo {
                state: if state == "have" { "have" } else { "none" },
                listeners: r.get::<_, Option<i64>>(1)?.unwrap_or(0),
                playcount: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                tags: tags.and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default(),
                on_tour: r.get::<_, Option<i64>>(4)?.unwrap_or(0) != 0,
                url: r.get(5)?,
                fetched_at: r.get(6)?,
            })
        },
    )
    .ok()
}

fn store_artist(conn: &rusqlite::Connection, key: &str, a: &ArtistInfo) {
    let tags = serde_json::to_string(&a.tags).unwrap_or_else(|_| "[]".into());
    let _ = conn.execute(
        "INSERT OR REPLACE INTO artist_info(artist, state, listeners, playcount, tags, on_tour, url, fetched_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![key, a.state, a.listeners, a.playcount, tags, a.on_tour as i64, a.url, a.fetched_at],
    );
}

/// Last.fm's `tags.tag` on an artist or an album: an array, or one object when there is a
/// single tag; both are read.
fn tags_of(v: &serde_json::Value) -> Vec<String> {
    let tag_name = |t: &serde_json::Value| t.get("name").and_then(|n| n.as_str()).map(str::to_string);
    match v.get("tags").and_then(|t| t.get("tag")) {
        Some(serde_json::Value::Array(list)) => list.iter().filter_map(tag_name).collect(),
        Some(one @ serde_json::Value::Object(_)) => tag_name(one).into_iter().collect(),
        _ => Vec::new(),
    }
}

/// `artist.getInfo` with `autocorrect=1`.
async fn fetch_artist(name: &str) -> Result<ArtistInfo, CallError> {
    let json = call("artist.getInfo", vec![("artist".into(), name.into()), ("autocorrect".into(), "1".into())]).await?;
    let a = &json["artist"];
    let stats = &a["stats"];
    Ok(ArtistInfo {
        state: "have",
        listeners: stats.get("listeners").and_then(as_int).unwrap_or(0),
        playcount: stats.get("playcount").and_then(as_int).unwrap_or(0),
        tags: tags_of(a),
        on_tour: a.get("ontour").and_then(as_int).unwrap_or(0) != 0,
        url: a.get("url").and_then(|u| u.as_str()).map(str::to_string),
        fetched_at: now_ms(),
    })
}

/// The Last.fm facts for one artist. Cache first; one call when the row is missing or older
/// than a month. `Ok(None)`: no key in this build, or no name. A network failure is an `Err`
/// and caches nothing.
#[tauri::command]
pub async fn lastfm_artist_info(name: String, app: AppHandle) -> Result<Option<ArtistInfo>, String> {
    let key = artist_key(&name);
    if API_KEY.is_none() || key.is_empty() {
        return Ok(None);
    }
    let k = key.clone();
    let hit = crate::db_thread::run(&app, move |db| Ok(cached_artist(&db.lock(), &k))).await?;
    if let Some(a) = hit {
        if now_ms() - a.fetched_at < LISTENERS_TTL_MS {
            return Ok(Some(a));
        }
    }
    let info = match fetch_artist(name.trim()).await {
        Ok(a) => a,
        Err(CallError::Api(6, _)) => ArtistInfo { state: "none", listeners: 0, playcount: 0, tags: Vec::new(), on_tour: false, url: None, fetched_at: now_ms() },
        Err(e) => {
            crate::log::warn(&format!("lastfm: artist info for {key} failed ({e})"));
            return Err(e.to_string());
        }
    };
    crate::log::info(&format!(
        "lastfm: artist info for {key}: {} ({} listeners, {} plays, {} tags{})",
        info.state,
        info.listeners,
        info.playcount,
        info.tags.len(),
        if info.on_tour { ", on tour" } else { "" }
    ));
    let stored = info.clone();
    crate::db_thread::run(&app, move |db| {
        store_artist(&db.lock(), &key, &stored);
        Ok(())
    })
    .await?;
    Ok(Some(info))
}

// ── album facts (LISTENERS.md §7) ───────────────────────────────────────────
//
// `album.getInfo`: the album's listeners and plays, its tags, its page and Last.fm's wiki
// summary. Last.fm keeps one page per exact (artist, album) text and merges none, so the
// renderer hands over the name FORMS to try in order (listeners.ts `albumForms`: Spotify's
// form first, the main artist and no " - EP", then Apple's exact names; his call 2026-10-13).
// The first form Last.fm knows wins. Cached a month in `album_info`, keyed by Apple's own
// pair in lower case, so the forms are asked once per album.

/// One album's Last.fm facts, as the renderer sees them.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumInfo {
    /// "have" — Last.fm knows the album under one of the forms. "none" — under none of them.
    pub state: &'static str,
    pub listeners: i64,
    pub playcount: i64,
    /// Last.fm's top tags for the album, as given (the year tags kept, his call).
    pub tags: Vec<String>,
    /// The wiki summary as Last.fm sends it (HTML, with its "Read more" link); the renderer
    /// takes the first two sentences of its text. None when the album has no wiki.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wiki: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub fetched_at: i64,
}

fn album_key(artist: &str, album: &str) -> String {
    format!("{}\u{1f}{}", artist.trim().to_lowercase(), album.trim().to_lowercase())
}

fn cached_album(conn: &rusqlite::Connection, key: &str) -> Option<AlbumInfo> {
    conn.query_row(
        "SELECT state, listeners, playcount, tags, wiki, url, fetched_at FROM album_info WHERE album = ?1",
        [key],
        |r| {
            let state: String = r.get(0)?;
            let tags: Option<String> = r.get(3)?;
            Ok(AlbumInfo {
                state: if state == "have" { "have" } else { "none" },
                listeners: r.get::<_, Option<i64>>(1)?.unwrap_or(0),
                playcount: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                tags: tags.and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default(),
                wiki: r.get(4)?,
                url: r.get(5)?,
                fetched_at: r.get(6)?,
            })
        },
    )
    .ok()
}

fn store_album(conn: &rusqlite::Connection, key: &str, a: &AlbumInfo) {
    let tags = serde_json::to_string(&a.tags).unwrap_or_else(|_| "[]".into());
    let _ = conn.execute(
        "INSERT OR REPLACE INTO album_info(album, state, listeners, playcount, tags, wiki, url, fetched_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![key, a.state, a.listeners, a.playcount, tags, a.wiki, a.url, a.fetched_at],
    );
}

/// `album.getInfo` for one (artist, album) form. `autocorrect` fixes artist spellings only.
async fn fetch_album(artist: &str, album: &str) -> Result<AlbumInfo, CallError> {
    let json = call(
        "album.getInfo",
        vec![("artist".into(), artist.into()), ("album".into(), album.into()), ("autocorrect".into(), "1".into())],
    )
    .await?;
    let a = &json["album"];
    let wiki = a
        .get("wiki")
        .and_then(|w| w.get("summary"))
        .and_then(|s| s.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    Ok(AlbumInfo {
        state: "have",
        listeners: a.get("listeners").and_then(as_int).unwrap_or(0),
        playcount: a.get("playcount").and_then(as_int).unwrap_or(0),
        tags: tags_of(a),
        wiki,
        url: a.get("url").and_then(|u| u.as_str()).map(str::to_string),
        fetched_at: now_ms(),
    })
}

/// The Last.fm facts for one album. `artist` / `album` are Apple's names (the cache key);
/// `forms` are the (artist, album) pairs to ask, in order. Cache first; then one call per
/// form until Last.fm knows one (usually the first). `Ok(None)`: no key, or nothing to ask.
/// A network failure is an `Err` and caches nothing.
#[tauri::command]
pub async fn lastfm_album_info(artist: String, album: String, forms: Vec<(String, String)>, app: AppHandle) -> Result<Option<AlbumInfo>, String> {
    let key = album_key(&artist, &album);
    let forms: Vec<(String, String)> = forms
        .into_iter()
        .map(|(a, b)| (a.trim().to_string(), b.trim().to_string()))
        .filter(|(a, b)| !a.is_empty() && !b.is_empty())
        .collect();
    if API_KEY.is_none() || forms.is_empty() {
        return Ok(None);
    }
    let k = key.clone();
    let hit = crate::db_thread::run(&app, move |db| Ok(cached_album(&db.lock(), &k))).await?;
    if let Some(a) = hit {
        if now_ms() - a.fetched_at < LISTENERS_TTL_MS {
            return Ok(Some(a));
        }
    }
    let mut info = AlbumInfo { state: "none", listeners: 0, playcount: 0, tags: Vec::new(), wiki: None, url: None, fetched_at: now_ms() };
    let mut matched = String::new();
    for (a, b) in &forms {
        match fetch_album(a, b).await {
            Ok(found) => {
                info = found;
                matched = format!("{a} / {b}");
                break;
            }
            // Album not found under this form: try the next.
            Err(CallError::Api(6, _)) => continue,
            Err(e) => {
                crate::log::warn(&format!("lastfm: album info for {key} failed ({e})"));
                return Err(e.to_string());
            }
        }
    }
    crate::log::info(&format!(
        "lastfm: album info for {}: {} ({} listeners, {} plays, {} tags{}{})",
        key.replace('\u{1f}', " / "),
        info.state,
        info.listeners,
        info.playcount,
        info.tags.len(),
        if info.wiki.is_some() { ", wiki" } else { "" },
        if matched.is_empty() { String::new() } else { format!(", as {matched}") }
    ));
    let stored = info.clone();
    crate::db_thread::run(&app, move |db| {
        store_album(&db.lock(), &key, &stored);
        Ok(())
    })
    .await?;
    Ok(Some(info))
}
