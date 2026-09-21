//! The local bridge (EXTENSION.md): a loopback HTTP server the browser extension
//! talks to, plus the now-playing hub the tray panel reads.
//!
//! Why here and not in the extension: every Apple call needs the developer token
//! (signed from your private key) and the Music User Token. Neither should ever
//! ship inside an extension, so the extension only ever says "I'm looking at this
//! song" and DeetsMusic does the search + the add with the plumbing it already has.
//!
//! Trust model (2026-09-09: no pairing code): loopback only (`127.0.0.1`), and a
//! request counts as the extension when its `Origin` is `chrome-extension://` /
//! `moz-extension://` — a header the browser sets and a web page can't forge. CORS
//! only ever echoes that origin. The settings.json token is kept purely so `curl`
//! (no Origin) can hit the debug routes; anything else on the machine gets a 401.
//!
//! Routes (JSON unless noted):
//!   OPTIONS *            CORS preflight
//!   GET  /health         unauthenticated liveness + `paired` (is *your* token right)
//!   POST /resolve        {title, artist?, album?, source?, url?} → top candidates
//!   POST /add            {track} | {album} → add to library, refresh the app's Library card
//!   POST /search         {term} → {songs:[candidate], albums:[{album, artworkUrl}]}
//!                        (the popup's mini search card — songs + albums only)
//!   GET  /now-playing    the hub snapshot (what the tray panel sees)
//!   GET  /airplay        which speaker this app is streaming to, or nulls
//!   POST /airplay        {action:"disconnect"} — let the speaker go, so the other
//!                        sender on this PC (DeetsAirplay) can take it over
//!   GET  /log            text/plain — the app log ring (debug)
//!
//! Agent / CLI control (AGENT.md) — the same loopback + token, routed to the main
//! window (which owns MusicKit + the queue model) through `ask()` and answered by
//! `agent_reply`:
//!   POST /command        {kind, value?} — play-pause | play | pause | next | previous |
//!                        seek (0..1) | volume (0..1) | mute | shuffle | shuffle-on | shuffle-off
//!                        repeat (cycle) | repeat-off | repeat-all | repeat-one
//!   POST /play           {id} | {term} | {track} | {tracks:[…]} → play now. `id` is PREFIXED:
//!                        song:… album:… playlist:… station:… (a term searches songs, top hit)
//!   POST /queue          same body + {mode:"next"|"later"} → enqueue (stations can't queue)
//!   GET  /queue          {current, upcoming:[…], history:[…]} as Tracks
//!   GET  /history?limit= the session play log, newest first, as Tracks
//!   GET  /stations?group=featured|genres|genre:<id>  → {stations:[…], genres:[…]}
//!   GET  /playlists      the user's playlists (Apple mirror + local), zero Apple calls
//!   POST /search         {term, types?:[…]} — with `types`, the raw catalog results
//!                        (song hits are materialized so a later play-by-id is local)
//!   POST /queue/edit     {action: remove|move|jump, index, to?} → the fresh queue
//!   POST /library        {action: add|favorite|unfavorite, id} — the app's consent rules
//!   POST /playlist       {action, playlist?, id?, index?, to?, value?} — show · create · add ·
//!                        remove · move · rename · delete · cover · export · new_copy · get_songs ·
//!                        import · folder
//!   POST /folder         {action: list|create|rename|delete, name, value?}
//!   GET|POST /update     status · {action: check|install|rollback|mode|skip, value?}
//! The writes (AGENT.md §5) run in the window (agent-writes.ts). A write that needs the user's
//! answer replies at once with `{pending: "user", message}`.
//!
//! Debug: `log()` is an alias onto the app log (log.rs, LOGGING.md): the 400-line ring
//! served at `/log` plus the rolling `<app_data>/deetsmusic.log`.

use crate::model::{Album, Station, Track};
use futures::channel::oneshot;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tiny_http::{Header, Method, Request, Response, Server};

/// Fixed candidates, tried in order; the extension probes the same list.
pub const PORTS: [u16; 4] = [47825, 47826, 47827, 47828];

// ── ring log ──────────────────────────────────────────────────────────────────

/// Thin alias onto the app log (`log.rs`, LOGGING.md): the ring + the rolling file
/// live there now; `bridge.log` was adopted as `deetsmusic.1.log` on first run.
pub fn log(msg: &str) {
    crate::log::info(&format!("bridge: {msg}"));
}

pub fn log_text() -> String {
    crate::log::ring_text()
}

// ── now-playing hub ───────────────────────────────────────────────────────────
//
// The main window publishes its player state here (np-bus.ts); the tray panel
// subscribes to the `np` event and can also ask for the snapshot. Commands from the
// tray go the other way as an `np-command` event the main window executes. Rust is
// the hub so a debug route (`/now-playing`) sees exactly what the tray sees.

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NpState {
    /// True while DeetsMusic has a current item (playing OR paused).
    pub active: bool,
    pub playing: bool,
    /// The station's name while one plays (radio mode).
    pub station: Option<String>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub artwork_url: Option<String>,
    pub artwork_template: Option<String>,
    /// "Show cover: Playlist": the playlist's saved cover, for the tray panel only. The
    /// Windows media overlay and AirPlay keep `artwork_url` / `artwork_template`.
    pub cover_url: Option<String>,
    pub catalog_id: Option<String>,
    pub in_library: bool,
    /// ♥ state for the tray panel's right-click: None = not offered (no consent / no
    /// catalog id), Some(true) = loved (2026-09-15).
    pub loved: Option<bool>,
    pub live: bool,
    pub progress: f64,
    pub current_time: f64,
    pub duration: f64,
    pub volume: f64,
    pub muted: bool,
    /// "off" | "all" | "one" (NEXT-VERSION §12); the tray panel ignores both.
    pub repeat: String,
    pub shuffle: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Appearance {
    pub theme: String,
    pub skin: String,
    /// The rest is context for `/health`, which the heaviness sampler reads so a heavy
    /// row says what the app was DOING (DEBUGGING.md §2026-09-17 review, item 1). The
    /// tray panel ignores these fields.
    pub surface: String,
    /// Advanced EQ / DeetsAdaptiveSound is routing audio (SOUND.md).
    pub sound: bool,
    /// Press "Record player": "off" | "spin" | "plate" — whatever `data-press-vinyl` holds.
    pub vinyl: String,
}

#[derive(Default)]
pub struct Hub {
    pub np: Mutex<NpState>,
    pub appearance: Mutex<Appearance>,
    pub port: Mutex<Option<u16>>,
}

#[tauri::command]
pub fn np_publish(state: NpState, app: AppHandle, hub: tauri::State<'_, Hub>) {
    *hub.np.lock().unwrap() = state.clone();
    crate::smtc::update(&state);
    crate::airplay::on_np_state(&app, &state);
    let _ = app.emit_to("tray", "np", state);
}

#[tauri::command]
pub fn np_snapshot(hub: tauri::State<'_, Hub>) -> NpState {
    hub.np.lock().unwrap().clone()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NpCommand {
    /// play-pause | next | previous | seek (value = fraction) | volume (value = 0..1) | mute
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    /// Who sent it: tray | windows (media keys, headset, flyout) | airplay. The main
    /// window logs it on a pause, so a pause names its source (DEBUGGING.md).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
}

/// Tray → main window transport. Emitted to the main window, which owns MusicKit.
#[tauri::command]
pub fn np_command(mut cmd: NpCommand, app: AppHandle) {
    cmd.from.get_or_insert_with(|| "tray".into());
    log(&format!("np-command {} {:?}", cmd.kind, cmd.value));
    let _ = app.emit_to("main", "np-command", cmd);
}

#[tauri::command]
pub fn appearance_publish(
    theme: String,
    skin: String,
    surface: Option<String>,
    sound: Option<bool>,
    vinyl: Option<String>,
    app: AppHandle,
    hub: tauri::State<'_, Hub>,
) {
    let a = Appearance {
        theme,
        skin,
        surface: surface.unwrap_or_default(),
        sound: sound.unwrap_or(false),
        vinyl: vinyl.unwrap_or_default(),
    };
    *hub.appearance.lock().unwrap() = a.clone();
    let _ = app.emit_to("tray", "appearance", a);
}

// ── agent request/reply (AGENT.md) ────────────────────────────────────────────
//
// An HTTP route that needs the player asks the MAIN window: Rust emits
// `agent-request` {id, kind, payload}, np-bus.ts runs it and invokes `agent_reply`
// with the result, which resolves the oneshot the route is awaiting. A watchdog
// thread fails the request if the window never answers (hidden-to-tray windows
// still run JS, so this only fires on a real fault).

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentRequest {
    id: u64,
    kind: String,
    payload: serde_json::Value,
}

type Pending = Mutex<HashMap<u64, oneshot::Sender<Result<serde_json::Value, String>>>>;
static PENDING: std::sync::LazyLock<Pending> = std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));
static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
const AGENT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
/// An export, Get New Songs, or an import makes one Apple call per 100 songs.
const AGENT_LONG_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(90);

async fn ask(app: &AppHandle, kind: &str, payload: serde_json::Value) -> Result<serde_json::Value, String> {
    ask_for(app, kind, payload, AGENT_TIMEOUT).await
}

async fn ask_for(
    app: &AppHandle,
    kind: &str,
    payload: serde_json::Value,
    timeout: std::time::Duration,
) -> Result<serde_json::Value, String> {
    let id = NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    PENDING.lock().unwrap().insert(id, tx);
    log(&format!("agent #{id} {kind} ({}b)", payload.to_string().len()));
    app.emit_to("main", "agent-request", AgentRequest { id, kind: kind.into(), payload: payload.clone() })
        .map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        std::thread::sleep(timeout);
        if let Some(tx) = PENDING.lock().unwrap().remove(&id) {
            let _ = tx.send(Err("the app window did not answer".into()));
        }
    });
    match rx.await {
        Ok(r) => r,
        Err(_) => Err("request dropped".into()),
    }
}

/// The main window's answer to an `agent-request`.
#[tauri::command]
pub fn agent_reply(id: u64, ok: bool, result: Option<serde_json::Value>, error: Option<String>) {
    if let Some(tx) = PENDING.lock().unwrap().remove(&id) {
        let _ = tx.send(if ok {
            Ok(result.unwrap_or(serde_json::Value::Null))
        } else {
            Err(error.unwrap_or_else(|| "failed".into()))
        });
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeInfo {
    pub port: Option<u16>,
    pub token: String,
    pub ports: Vec<u16>,
}

/// What the settings menu shows: the live port + the pairing token.
#[tauri::command]
pub fn bridge_info(hub: tauri::State<'_, Hub>, settings: tauri::State<'_, crate::settings::Settings>) -> BridgeInfo {
    BridgeInfo { port: *hub.port.lock().unwrap(), token: settings.get().bridge_token, ports: PORTS.to_vec() }
}

#[tauri::command]
pub fn bridge_log() -> String {
    log_text()
}

/// Where the unpacked extension lives: the bundled resource dir in an installed
/// build, the repo checkout in dev (resources aren't staged for `tauri dev`). The repo
/// fallback is compiled out of release builds (RELEASE.md §1a: a release exe carries no
/// path into the source tree).
pub fn extension_dir(app: &AppHandle) -> std::path::PathBuf {
    let bundled = app.path().resource_dir().map(|res| res.join("extension")).unwrap_or_default();
    #[cfg(debug_assertions)]
    if !bundled.join("manifest.json").is_file() {
        return std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("extension");
    }
    bundled
}

/// Open the load-unpacked walkthrough (extension/install.html) in the default browser.
#[tauri::command]
pub fn bridge_open_install_page(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let page = extension_dir(&app).join("install.html");
    let page = page.canonicalize().unwrap_or(page);
    log(&format!("open install page {}", page.display()));
    app.opener().open_path(page.to_string_lossy().to_string(), None::<&str>).map_err(|e| e.to_string())
}

// ── the server ────────────────────────────────────────────────────────────────

pub fn start(app: AppHandle) {
    let mut bound: Option<(Server, u16)> = None;
    for port in PORTS {
        match Server::http(("127.0.0.1", port)) {
            Ok(s) => {
                bound = Some((s, port));
                break;
            }
            Err(e) => log(&format!("port {port} busy: {e}")),
        }
    }
    let Some((server, port)) = bound else {
        crate::log::error("bridge: no port free — extension bridge OFF");
        return;
    };
    *app.state::<Hub>().port.lock().unwrap() = Some(port);
    log(&format!("listening on 127.0.0.1:{port}"));
    std::thread::Builder::new()
        .name("deets-bridge".into())
        .spawn(move || {
            for req in server.incoming_requests() {
                let app = app.clone();
                tauri::async_runtime::spawn(async move { handle(app, req).await });
            }
        })
        .expect("spawn bridge thread");
}

fn header(k: &str, v: &str) -> Header {
    Header::from_bytes(k.as_bytes(), v.as_bytes()).expect("static header")
}

fn find_header(req: &Request, name: &str) -> Option<String> {
    req.headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str().to_string())
}

/// Only an extension origin is ever echoed; a web page gets no CORS header at all.
fn cors_origin(origin: Option<&str>) -> Option<String> {
    origin.filter(|o| o.starts_with("chrome-extension://") || o.starts_with("moz-extension://")).map(String::from)
}

fn respond(req: Request, status: u16, body: String, mime: &str, origin: Option<String>) {
    let mut r = Response::from_string(body).with_status_code(status).with_header(header("Content-Type", mime));
    if let Some(o) = origin {
        r = r
            .with_header(header("Access-Control-Allow-Origin", &o))
            .with_header(header("Access-Control-Allow-Methods", "GET, POST, OPTIONS"))
            .with_header(header("Access-Control-Allow-Headers", "Authorization, Content-Type"))
            .with_header(header("Access-Control-Allow-Private-Network", "true"))
            .with_header(header("Access-Control-Max-Age", "600"))
            .with_header(header("Vary", "Origin"));
    }
    let _ = req.respond(r);
}

fn json(req: Request, status: u16, v: serde_json::Value, origin: Option<String>) {
    respond(req, status, v.to_string(), "application/json", origin)
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ResolveReq {
    title: String,
    artist: Option<String>,
    album: Option<String>,
    source: Option<String>,
    url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddReq {
    track: Option<Track>,
    album: Option<Album>,
}

#[derive(Deserialize)]
struct SearchReq {
    term: String,
    /// Agent form: any of songs | albums | artists | playlists → the raw catalog results.
    #[serde(default)]
    types: Option<Vec<String>>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct CommandReq {
    kind: String,
    value: Option<f64>,
}

/// /play and /queue: a prefixed id, a search term, one track, or a list.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct TracksReq {
    /// `song:<catalog id>` · `album:<id>` · `playlist:<pl.…|p.…|local:N>` · `station:<ra.…>`
    id: Option<String>,
    term: Option<String>,
    track: Option<Track>,
    tracks: Option<Vec<Track>>,
    /// /queue only: "next" (default) | "later"
    mode: Option<String>,
    /// /queue only: a row of Up Next to insert at (1 = the top); wins over `mode`.
    at: Option<u32>,
    /// /play only: play at once and keep Up Next after it (playTracksKeepQueue).
    keep_queue: Option<bool>,
}

/// The write routes (AGENT.md §5): /library, /playlist, /folder, /queue/edit, /update.
/// Flat on purpose — each route reads the fields its action needs.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct WriteReq {
    action: String,
    /// song:… album:… playlist:… or `current` (the playing song).
    id: Option<String>,
    /// playlist:… — the playlist acted on.
    playlist: Option<String>,
    /// 1-based rows, as the listings number them.
    index: Option<u32>,
    to: Option<u32>,
    /// A name, a folder, a cover source, an update mode or version.
    value: Option<String>,
    /// /folder: the folder's name.
    name: Option<String>,
}

/// The songs an `id` names, as the window's payload: `{tracks}`, `{tracks, albumId}` for an
/// album, or `{current: true}` (the window reads its own queue).
async fn tracks_payload(app: &AppHandle, id: Option<&str>) -> Result<serde_json::Value, String> {
    let id = id.map(str::trim).filter(|s| !s.is_empty()).ok_or("unknown: give id: song:… album:… playlist:… or current")?;
    if id == "current" {
        return Ok(serde_json::json!({ "current": true }));
    }
    match resolve_id(app, id).await? {
        Target::Tracks(t) if t.is_empty() => Err("unknown: that has no songs".into()),
        Target::Tracks(t) => {
            let album = id.strip_prefix("album:").map(str::trim);
            Ok(serde_json::json!({ "tracks": t, "albumId": album }))
        }
        Target::Station(_) => Err("unknown: a station has no songs to add".into()),
    }
}

/// A cover source → an image data URL (the window crops and shrinks it), or None to remove the
/// cover. `value`: an image file path, `song:…` / `album:…` / `current` (that artwork), or `none`.
async fn cover_image(app: &AppHandle, value: &str) -> Result<Option<String>, String> {
    use base64::Engine;
    let v = value.trim().trim_matches('"');
    if v.is_empty() {
        return Err("unknown: give value: an image file path, song:…, album:…, current, or none".into());
    }
    if v.eq_ignore_ascii_case("none") {
        return Ok(None);
    }
    let (bytes, mime) = if v == "current" || v.starts_with("song:") || v.starts_with("album:") {
        let template = if v == "current" {
            app.state::<Hub>().np.lock().unwrap().artwork_template.clone()
        } else {
            match resolve_id(app, v).await? {
                Target::Tracks(ts) => ts.iter().find_map(|t| t.artwork.as_ref().map(|a| a.url_template.clone())),
                Target::Station(_) => None,
            }
        };
        let url = template
            .ok_or("unknown: no artwork for that")?
            .replace("{w}", "1024")
            .replace("{h}", "1024")
            .replace("{f}", "jpg");
        let resp = reqwest::get(&url).await.map_err(|e| format!("artwork fetch: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("artwork fetch: HTTP {}", resp.status()));
        }
        (resp.bytes().await.map_err(|e| format!("artwork fetch: {e}"))?.to_vec(), "image/jpeg")
    } else {
        let path = std::path::Path::new(v);
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        let mime = match ext.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "webp" => "image/webp",
            "gif" => "image/gif",
            "bmp" => "image/bmp",
            _ => return Err("unknown: the cover must be a .png, .jpg, .webp, .gif, or .bmp file".into()),
        };
        let len = std::fs::metadata(path).map_err(|e| format!("unknown: can't read {v:?}: {e}"))?.len();
        if len > 10_000_000 {
            return Err("unknown: the image is over 10 MB".into());
        }
        (std::fs::read(path).map_err(|e| format!("unknown: can't read {v:?}: {e}"))?, mime)
    };
    Ok(Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))))
}

enum Target {
    Tracks(Vec<Track>),
    Station(Station),
}

/// Every station the bridge has handed out, by id — `play station:…` needs the whole
/// Station (MusicKit's descriptor probe wants the url) and Apple has no by-id lookup
/// we use elsewhere. Session-scoped, like radio.ts's caches.
static STATIONS: std::sync::LazyLock<Mutex<HashMap<String, Station>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

fn remember_stations(list: &[Station]) {
    let mut m = STATIONS.lock().unwrap();
    for s in list {
        m.insert(s.id.clone(), s.clone());
    }
}

/// A prefixed id → what to play. Songs resolve from the local store first (search
/// materializes its hits), then fall back to one catalog fetch.
async fn resolve_id(app: &AppHandle, id: &str) -> Result<Target, String> {
    let (kind, rest) = id.split_once(':').ok_or_else(|| {
        format!("unknown id {id:?}: expected song:… album:… playlist:… or station:… (search first)")
    })?;
    let rest = rest.trim();
    if rest.is_empty() {
        return Err(format!("unknown id {id:?}: empty"));
    }
    let apple = app.state::<crate::apple::AppleState>();
    let db = app.state::<crate::library::Db>();
    match kind {
        "song" => {
            let local = { crate::library::track_by_id(&db.lock(), rest) };
            if let Some(t) = local {
                return Ok(Target::Tracks(vec![t]));
            }
            // Unseen id: ask the catalog for its album, then pick the song out of it —
            // one call, and it reuses the collection fetch we already have.
            let hit = crate::apple::catalog_related("songs".into(), rest.to_string(), "albums".into(), apple, db)
                .await
                .ok()
                .flatten();
            let Some(album_id) = hit.map(|r| r.id) else {
                return Err(format!("no song found for {id:?} — search first"));
            };
            let tracks = crate::apple::catalog_collection_tracks(
                "albums".into(),
                album_id,
                app.state::<crate::apple::AppleState>(),
                app.state::<crate::library::Db>(),
            )
            .await?;
            tracks
                .into_iter()
                .find(|t| t.catalog_id.as_deref() == Some(rest))
                .map(|t| Target::Tracks(vec![t]))
                .ok_or_else(|| format!("no song found for {id:?}"))
        }
        "album" => Ok(Target::Tracks(
            crate::apple::catalog_collection_tracks("albums".into(), rest.to_string(), apple, db).await?,
        )),
        "playlist" => {
            let tracks = if let Some(n) = rest.strip_prefix("local:") {
                let n: i64 = n.parse().map_err(|_| format!("bad local playlist id {id:?}"))?;
                crate::playlists::local_playlist_tracks(n, db)?
            } else if rest.starts_with("p.") {
                crate::playlists::apple_playlist_tracks(rest.to_string(), apple, db).await?
            } else {
                crate::apple::catalog_collection_tracks("playlists".into(), rest.to_string(), apple, db).await?
            };
            Ok(Target::Tracks(tracks))
        }
        "station" => {
            let cached = STATIONS.lock().unwrap().get(rest).cloned();
            match cached {
                Some(s) => Ok(Target::Station(s)),
                None => Err(format!("unknown station {id:?} — list stations first")),
            }
        }
        _ => Err(format!("unknown id {id:?}: prefix must be song, album, playlist, or station")),
    }
}

async fn resolve_target(app: &AppHandle, r: TracksReq) -> Result<Target, String> {
    if let Some(id) = r.id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        return resolve_id(app, id).await;
    }
    if let Some(ts) = r.tracks.filter(|t| !t.is_empty()) {
        return Ok(Target::Tracks(ts));
    }
    if let Some(t) = r.track {
        return Ok(Target::Tracks(vec![t]));
    }
    let term = r.term.as_deref().map(str::trim).filter(|s| !s.is_empty()).ok_or("nothing to play: give id, term, track, or tracks")?;
    let hits = search_songs(app, term).await?;
    hits.into_iter().next().map(|t| Target::Tracks(vec![t])).ok_or_else(|| format!("no song found for {term:?}"))
}

/// /stations: `featured` (live + My Station + Discovery) · `genres` · `genre:<id>`.
async fn stations(app: &AppHandle, group: &str) -> Result<serde_json::Value, String> {
    let apple = app.state::<crate::apple::AppleState>();
    let db = app.state::<crate::library::Db>();
    match group {
        "genres" => {
            let genres = crate::apple::radio_genres(apple, db).await?;
            Ok(serde_json::json!({ "stations": [], "genres": genres }))
        }
        g if g.starts_with("genre:") => {
            let list = crate::apple::radio_genre_stations(g["genre:".len()..].to_string(), apple, db).await?;
            remember_stations(&list);
            Ok(serde_json::json!({ "stations": list, "genres": [] }))
        }
        _ => {
            let mut list = crate::apple::radio_live(apple, db).await?;
            if let Ok(Some(s)) =
                crate::apple::radio_my_station(app.state::<crate::apple::AppleState>(), app.state::<crate::library::Db>()).await
            {
                list.insert(0, s);
            }
            if let Ok(Some(s)) = crate::apple::radio_discovery(app.state::<crate::apple::AppleState>()).await {
                list.insert(1.min(list.len()), s);
            }
            remember_stations(&list);
            Ok(serde_json::json!({ "stations": list, "genres": [] }))
        }
    }
}

fn query_param(url: &str, key: &str) -> Option<String> {
    url.split_once('?')?
        .1
        .split('&')
        .find_map(|kv| kv.split_once('=').filter(|(k, _)| *k == key).map(|(_, v)| v.to_string()))
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumHit {
    pub album: Album,
    pub artwork_url: Option<String>,
}

fn art_url(a: &Option<crate::model::Artwork>, px: u32) -> Option<String> {
    a.as_ref().map(|a| {
        a.url_template
            .replace("{w}", &px.to_string())
            .replace("{h}", &px.to_string())
            .replace("{f}", "jpg")
    })
}

/// The installer asks about the extension only until the extension has reached this app once
/// (src-tauri/nsis/hooks.nsh reads this file). Written once per run, and only when missing.
fn mark_extension_connected(app: &AppHandle) {
    static MARKED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if MARKED.swap(true, std::sync::atomic::Ordering::Relaxed) {
        return;
    }
    let Ok(dir) = app.path().app_data_dir() else { return };
    let file = dir.join("extension-connected");
    if !file.exists() {
        if let Err(e) = std::fs::write(&file, "The browser extension reached the bridge. The installer reads this (hooks.nsh).") {
            log(&format!("extension mark: {e}"));
        }
    }
}

async fn handle(app: AppHandle, mut req: Request) {
    let method = req.method().clone();
    let url = req.url().to_string();
    let path = url.split('?').next().unwrap_or("/").to_string();
    let origin = cors_origin(find_header(&req, "Origin").as_deref());
    let auth = find_header(&req, "Authorization").unwrap_or_default();
    let settings = app.state::<crate::settings::Settings>().get();
    let token = settings.bridge_token;
    let paired = origin.is_some() || auth.strip_prefix("Bearer ").map(|t| t.trim() == token).unwrap_or(false);
    // The agent routes (AGENT.md §3) obey the Settings › Connections › Agent control switch. The browser
    // extension (an Origin) is a different feature and is never gated by it.
    const AGENT_ROUTES: &[&str] = &[
        "/command", "/play", "/queue", "/queue/edit", "/history", "/stations", "/playlists",
        "/playlist", "/library", "/folder", "/update", "/settings", "/tracks", "/query", "/songs", "/grow", "/go",
        "/picks", "/diag",
    ];
    // `POST /airplay` hands a speaker to another app, which is control, not a
    // read; `GET /airplay` only says which speaker we hold, like /now-playing.
    let agent_route = AGENT_ROUTES.contains(&path.as_str()) || (method == Method::Post && path == "/airplay");
    let agent_off = !settings.agent_control && origin.is_none() && agent_route;

    if method == Method::Options {
        return respond(req, 204, String::new(), "text/plain", origin);
    }

    let mut body = String::new();
    if method == Method::Post {
        let _ = req.as_reader().take(64 * 1024).read_to_string(&mut body);
    }
    // The polled reads are not logged: DeetsAirplay's panel asks for the
    // now-playing card and the held speaker once a second while it is open,
    // and at that rate the log ring is nothing but our own chatter within
    // minutes. Everything that changes something still logs.
    const POLLED: &[&str] = &["/health", "/now-playing", "/airplay"];
    if !(method == Method::Get && POLLED.contains(&path.as_str())) {
        log(&format!("{method} {path} paired={paired} body={}b", body.len()));
    }
    if origin.is_some() {
        mark_extension_connected(&app);
    }

    match (method, path.as_str()) {
        (Method::Get, "/health") => {
            let connected = app.state::<crate::apple::AppleState>().user_token.lock().unwrap().is_some();
            let a = app.state::<Hub>().appearance.lock().unwrap().clone();
            // Context, not content: what the app is DOING, never what it is playing. The
            // heaviness sampler reads this line without a token so a heavy sample can be
            // attributed (DEBUGGING.md §2026-09-17 review, item 1); a title or an artist
            // would make an unauthenticated route leak the listening, so none is here.
            let playing = app.state::<Hub>().np.lock().unwrap().playing;
            let air = match crate::airplay::held_speaker(&app) {
                None => "off",
                Some(_) => match settings.airplay_capture {
                    crate::settings::AirplayCapture::App => "tap",
                    crate::settings::AirplayCapture::System => "loopback",
                },
            };
            let hidden = app
                .get_webview_window("main")
                .and_then(|w| w.is_visible().ok())
                .map(|v| !v)
                .unwrap_or(false);
            json(
                req,
                200,
                serde_json::json!({
                    "ok": true, "app": "DeetsMusic", "version": env!("CARGO_PKG_VERSION"),
                    "connected": connected, "paired": paired, "theme": a.theme, "skin": a.skin,
                    "agent": settings.agent_control,
                    "surface": a.surface, "sound": a.sound, "vinyl": a.vinyl,
                    "playing": playing, "airplay": air, "tray": hidden,
                }),
                origin,
            )
        }
        (_, "/health") => json(req, 405, serde_json::json!({ "error": "method" }), origin),
        _ if !paired => json(req, 401, serde_json::json!({ "error": "unpaired" }), origin),
        _ if agent_off => json(req, 403, serde_json::json!({ "error": "Agent control is off. Turn it on in DeetsMusic › Settings › Connections." }), origin),

        (Method::Get, "/now-playing") => {
            let np = app.state::<Hub>().np.lock().unwrap().clone();
            json(req, 200, serde_json::to_value(np).unwrap_or_default(), origin)
        }
        // AIRPLAY.md §11. Read: which speaker we are holding, so the other
        // sender on this PC can say "DeetsMusic is playing on Living Room"
        // instead of failing a handshake against a receiver we already own.
        // Write: let it go, so its panel can offer a hand-over. Both are inert
        // when nothing else is installed, which is the usual case.
        (Method::Get, "/airplay") => {
            let held = crate::airplay::held_speaker(&app);
            json(
                req,
                200,
                serde_json::json!({
                    "speaker": held.as_ref().map(|s| s.name.clone()),
                    "ip": held.as_ref().map(|s| s.ip.clone()),
                    "port": held.as_ref().map(|s| s.port),
                    "sends": "what DeetsMusic plays",
                }),
                origin,
            )
        }
        (Method::Post, "/airplay") => {
            let action = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| v.get("action").and_then(|a| a.as_str().map(String::from)))
                .unwrap_or_default();
            if action != "disconnect" {
                return json(req, 400, serde_json::json!({ "error": "action must be \"disconnect\"" }), origin);
            }
            // A TEARDOWN plus a thread join; never on the runtime's thread.
            let handle = app.clone();
            tauri::async_runtime::spawn_blocking(move || crate::airplay::release(&handle)).await.ok();
            json(req, 200, serde_json::json!({ "ok": true }), origin)
        }
        (Method::Get, "/log") => respond(req, 200, log_text(), "text/plain; charset=utf-8", origin),

        (Method::Post, "/resolve") => {
            let r: ResolveReq = match serde_json::from_str(&body) {
                Ok(r) => r,
                Err(e) => return json(req, 400, serde_json::json!({ "error": format!("bad json: {e}") }), origin),
            };
            match resolve(&app, &r).await {
                Ok(c) => json(req, 200, serde_json::json!({ "candidates": c }), origin),
                Err(e) => {
                    log(&format!("resolve failed: {e}"));
                    let status = if e.contains("not connected") { 409 } else { 502 };
                    json(req, status, serde_json::json!({ "error": e }), origin)
                }
            }
        }
        // /add is the extension's. A token caller uses /library, which obeys Agent control and the
        // app's Add to Library consent (AGENT.md §5).
        (Method::Post, "/add") if origin.is_none() => json(
            req,
            403,
            serde_json::json!({ "error": "Use POST /library {action: \"add\", id} (AGENT.md §5)." }),
            origin,
        ),
        (Method::Post, "/add") => {
            let r: AddReq = match serde_json::from_str(&body) {
                Ok(r) => r,
                Err(e) => return json(req, 400, serde_json::json!({ "error": format!("bad json: {e}") }), origin),
            };
            let res = match (r.track, r.album) {
                (Some(t), _) => add(&app, t).await,
                (None, Some(a)) => add_album(&app, a).await,
                (None, None) => Err("nothing to add".into()),
            };
            match res {
                Ok(()) => json(req, 200, serde_json::json!({ "ok": true }), origin),
                Err(e) => {
                    log(&format!("add failed: {e}"));
                    let status = if e.contains("not connected") { 409 } else { 502 };
                    json(req, status, serde_json::json!({ "error": e }), origin)
                }
            }
        }
        (Method::Post, "/search") => {
            let r: SearchReq = match serde_json::from_str(&body) {
                Ok(r) => r,
                Err(e) => return json(req, 400, serde_json::json!({ "error": format!("bad json: {e}") }), origin),
            };
            if let Some(types) = r.types.filter(|t| !t.is_empty()) {
                // Agent form: the app's own normalized catalog results, untouched.
                let res = crate::apple::catalog_search(
                    r.term.clone(),
                    Some(types),
                    app.state::<crate::apple::AppleState>(),
                    app.state::<crate::library::Db>(),
                )
                .await;
                return match res {
                    Ok(results) => {
                        // Park the song hits locally so `play song:<id>` right after resolves
                        // with no Apple call (a local upsert; never touches library rows).
                        if !results.songs.is_empty() {
                            let db = app.state::<crate::library::Db>();
                            let conn = db.lock();
                            if let Err(e) = crate::library::materialize_many(&conn, &results.songs) {
                                log(&format!("materialize after search failed: {e}"));
                            }
                        }
                        // Station hits go into the same by-id table the /stations
                        // listing feeds, so `play station:<id>` resolves after a search.
                        remember_stations(&results.stations);
                        json(req, 200, serde_json::to_value(results).unwrap_or_default(), origin)
                    }
                    Err(e) => {
                        log(&format!("search failed: {e}"));
                        let status = if e.contains("not connected") { 409 } else { 502 };
                        json(req, status, serde_json::json!({ "error": e }), origin)
                    }
                };
            }
            match search(&app, &r.term).await {
                Ok((songs, albums)) => json(req, 200, serde_json::json!({ "songs": songs, "albums": albums }), origin),
                Err(e) => {
                    log(&format!("search failed: {e}"));
                    let status = if e.contains("not connected") { 409 } else { 502 };
                    json(req, status, serde_json::json!({ "error": e }), origin)
                }
            }
        }
        // ── agent / CLI control (AGENT.md) ──
        (Method::Post, "/command") => {
            let r: CommandReq = match serde_json::from_str(&body) {
                Ok(r) => r,
                Err(e) => return json(req, 400, serde_json::json!({ "error": format!("bad json: {e}") }), origin),
            };
            let res = ask(&app, "command", serde_json::json!({ "kind": r.kind, "value": r.value })).await;
            agent_json(req, res, origin)
        }
        (Method::Post, "/play") | (Method::Post, "/queue") => {
            let r: TracksReq = match serde_json::from_str(&body) {
                Ok(r) => r,
                Err(e) => return json(req, 400, serde_json::json!({ "error": format!("bad json: {e}") }), origin),
            };
            let mode = r.mode.clone().unwrap_or_else(|| "next".into());
            let (at, keep_queue) = (r.at, r.keep_queue.unwrap_or(false));
            let kind = if path == "/play" { "play" } else { "queue" };
            let res = match resolve_target(&app, r).await {
                Ok(Target::Tracks(tracks)) if tracks.is_empty() => Err("nothing to play: empty collection".into()),
                Ok(Target::Tracks(tracks)) => {
                    ask(&app, kind, serde_json::json!({ "tracks": tracks, "mode": mode, "at": at, "keepQueue": keep_queue })).await
                }
                Ok(Target::Station(s)) if kind == "play" => ask(&app, "play-station", serde_json::json!({ "station": s })).await,
                Ok(Target::Station(_)) => Err("unknown: a station can't be queued, only played".into()),
                Err(e) => Err(e),
            };
            agent_json(req, res, origin)
        }
        // Read the songs inside a collection without touching playback (AGENT.md §3). Until
        // this existed an agent could only see into an album by pouring it into a playlist,
        // which made a write out of a read — and left the user a playlist to delete
        // (2026-09-16). Same resolver as /play, so it takes song: album: playlist: alike.
        (Method::Post, "/tracks") => {
            let r: TracksReq = match serde_json::from_str(&body) {
                Ok(r) => r,
                Err(e) => return json(req, 400, serde_json::json!({ "error": format!("bad json: {e}") }), origin),
            };
            let res = match resolve_target(&app, r).await {
                Ok(Target::Tracks(tracks)) => Ok(serde_json::json!({ "tracks": tracks })),
                Ok(Target::Station(_)) => Err("unknown: a station has no fixed list of songs".to_string()),
                Err(e) => Err(e),
            };
            agent_json(req, res, origin)
        }
        (Method::Get, "/queue") => agent_json(req, ask(&app, "queue-get", serde_json::Value::Null).await, origin),
        (Method::Get, "/stations") => {
            let group = query_param(&url, "group").unwrap_or_else(|| "featured".into());
            match stations(&app, &group).await {
                Ok(v) => json(req, 200, v, origin),
                Err(e) => {
                    log(&format!("stations failed: {e}"));
                    let status = if e.contains("not connected") { 409 } else { 502 };
                    json(req, status, serde_json::json!({ "error": e }), origin)
                }
            }
        }
        (Method::Get, "/playlists") => match crate::playlists::playlists_cached(app.state::<crate::library::Db>()) {
            Ok(list) => json(req, 200, serde_json::json!({ "playlists": list }), origin),
            Err(e) => json(req, 502, serde_json::json!({ "error": e }), origin),
        },
        // ── local data (LOCAL-DATA.md) — read-only, zero Apple calls ──
        // The bearer token only: a browser extension (an Origin) has no business reading the
        // library or the play history, so it is refused even though it counts as paired.
        (Method::Post, "/query") | (Method::Post, "/songs") if origin.is_some() => {
            json(req, 403, serde_json::json!({ "error": "This route is for agents with the bridge token, not extensions." }), origin)
        }
        (Method::Post, "/query") => {
            let sql = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| v.get("sql").and_then(|s| s.as_str()).map(String::from))
                .unwrap_or_default();
            let history = settings.agent_history;
            // SQLite work off the runtime's threads; its own 2 s limit bounds the wait.
            let res = tauri::async_runtime::spawn_blocking(move || crate::query::query(&sql, history))
                .await
                .unwrap_or_else(|e| Err(e.to_string()));
            match res {
                Ok(v) => json(req, 200, v, origin),
                // A setting blocks it (403, like the other gates); anything else is the request (400).
                Err(e) => json(req, if e == crate::query::HISTORY_OFF { 403 } else { 400 }, serde_json::json!({ "error": e }), origin),
            }
        }
        (Method::Post, "/songs") => {
            let r: crate::query::SongsReq = match serde_json::from_str(&body) {
                Ok(r) => r,
                Err(e) => return json(req, 400, serde_json::json!({ "error": format!("bad json: {e}") }), origin),
            };
            let history = settings.agent_history;
            let res = tauri::async_runtime::spawn_blocking(move || crate::query::songs(r, history))
                .await
                .unwrap_or_else(|e| Err(e.to_string()));
            match res {
                Ok(v) => json(req, 200, v, origin),
                Err(e) => json(req, if e == crate::query::HISTORY_OFF { 403 } else { 400 }, serde_json::json!({ "error": e }), origin),
            }
        }
        (Method::Get, "/history") if origin.is_none() && !settings.agent_history => json(
            req,
            403,
            serde_json::json!({ "error": "Play history is off. Turn on Agents read play history in DeetsMusic › Settings › Connections." }),
            origin,
        ),
        (Method::Get, "/history") => {
            let limit = query_param(&url, "limit").and_then(|v| v.parse::<u32>().ok()).unwrap_or(50);
            agent_json(req, ask(&app, "history-get", serde_json::json!({ "limit": limit })).await, origin)
        }
        // ── agent writes (AGENT.md §5) — the window runs them (agent-writes.ts) ──
        (Method::Post, "/library") | (Method::Post, "/playlist") | (Method::Post, "/folder")
        | (Method::Post, "/queue/edit") | (Method::Post, "/update") | (Method::Post, "/picks") => {
            let r: WriteReq = match serde_json::from_str(&body) {
                Ok(r) => r,
                Err(e) => return json(req, 400, serde_json::json!({ "error": format!("bad json: {e}") }), origin),
            };
            let res = write(&app, path.as_str(), r).await;
            agent_json(req, res, origin)
        }
        (Method::Get, "/update") => agent_json(req, ask(&app, "update-get", serde_json::Value::Null).await, origin),
        // ── the live diag ring (LOGGING.md §Reading it from outside) ──
        // The log FILE only holds what a flush has written; this reads the window's own
        // buffer as it is, which is what a session being debugged needs. It carries song
        // ids, so it sits behind the Agent control switch like every other agent read.
        (Method::Get, "/diag") => {
            let limit = query_param(&url, "limit").and_then(|v| v.parse::<u32>().ok()).unwrap_or(100);
            let since = query_param(&url, "since").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
            let tag = query_param(&url, "tag").unwrap_or_default();
            agent_json(
                req,
                ask(&app, "diag-get", serde_json::json!({ "limit": limit, "since": since, "tag": tag })).await,
                origin,
            )
        }
        // ── Song of the Day (docs/integrations/DeetsOTD.md §8.8; sotd.ts, agent-writes.ts) ──
        // The reads are free; a mark asks the user once, and is refused while the feature
        // is off. The window runs both, so the shelf, Rewind and the outbox all follow.
        (Method::Get, "/picks") => {
            let window = query_param(&url, "window").unwrap_or_default();
            agent_json(req, ask(&app, "picks-get", serde_json::json!({ "window": window })).await, origin)
        }
        // ── agent settings (AGENT.md §6) — the window lists and sets them (agent-settings.ts) ──
        (Method::Get, "/settings") => {
            // `section` is a card section name ("Look and feel"): undo the CLI's small encoding.
            let section = query_param(&url, "section")
                .map(|s| s.replace('+', " ").replace("%20", " ").replace("%26", "&").replace("%25", "%"))
                .unwrap_or_default();
            agent_json(req, ask(&app, "settings-get", serde_json::json!({ "section": section })).await, origin)
        }
        (Method::Post, "/settings") => {
            let v: serde_json::Value = match serde_json::from_str(&body) {
                Ok(v) => v,
                Err(e) => return json(req, 400, serde_json::json!({ "error": format!("bad json: {e}") }), origin),
            };
            agent_json(req, ask(&app, "settings", v).await, origin)
        }
        // ── go (COMPASS.md §10; compass.ts `agentGo`) — the CLI's way to a place ──
        // Navigation only: the Compass's Places minus theme, skin and surface, which are
        // stored settings and keep their own consent on `/settings`.
        (Method::Get, "/go") => agent_json(req, ask(&app, "go-get", serde_json::Value::Null).await, origin),
        (Method::Post, "/go") => {
            let v: serde_json::Value = match serde_json::from_str(&body) {
                Ok(v) => v,
                Err(e) => return json(req, 400, serde_json::json!({ "error": format!("bad json: {e}") }), origin),
            };
            agent_json(req, ask(&app, "go", v).await, origin)
        }
        // ── card grow (CARD-GROW.md; card-grow.ts `agentGrow`) — a test handle more than a verb ──
        (Method::Get, "/grow") => agent_json(req, ask(&app, "grow-get", serde_json::Value::Null).await, origin),
        (Method::Post, "/grow") => {
            let v: serde_json::Value = match serde_json::from_str(&body) {
                Ok(v) => v,
                Err(e) => return json(req, 400, serde_json::json!({ "error": format!("bad json: {e}") }), origin),
            };
            agent_json(req, ask(&app, "grow", v).await, origin)
        }
        _ => json(req, 404, serde_json::json!({ "error": "no such route" }), origin),
    }
}

/// One write route → the window. `show` is a read the bridge answers itself; `add` and
/// `cover` resolve their songs or image here first.
async fn write(app: &AppHandle, path: &str, r: WriteReq) -> Result<serde_json::Value, String> {
    let merge = |mut base: serde_json::Value, extra: serde_json::Value| {
        if let (Some(b), Some(e)) = (base.as_object_mut(), extra.as_object()) {
            b.extend(e.iter().map(|(k, v)| (k.clone(), v.clone())));
        }
        base
    };
    match path {
        "/library" => {
            let tracks = tracks_payload(app, r.id.as_deref()).await?;
            ask(app, "library", merge(serde_json::json!({ "action": r.action }), tracks)).await
        }
        "/playlist" if r.action == "show" => {
            let id = r.playlist.as_deref().map(str::trim).unwrap_or("");
            if !id.starts_with("playlist:") {
                return Err("unknown: give playlist: a playlist:… id (list playlists first)".into());
            }
            match resolve_id(app, id).await? {
                Target::Tracks(t) => Ok(serde_json::json!({ "tracks": t })),
                Target::Station(_) => Err("unknown: not a playlist".into()),
            }
        }
        "/playlist" => {
            let mut payload = serde_json::json!({
                "action": r.action, "playlist": r.playlist, "index": r.index, "to": r.to, "value": r.value,
            });
            if r.action == "add" {
                payload = merge(payload, tracks_payload(app, r.id.as_deref()).await?);
            }
            if r.action == "cover" {
                payload["image"] = cover_image(app, r.value.as_deref().unwrap_or("")).await?.into();
            }
            let long = matches!(r.action.as_str(), "export" | "new_copy" | "get_songs" | "import");
            ask_for(app, "playlist", payload, if long { AGENT_LONG_TIMEOUT } else { AGENT_TIMEOUT }).await
        }
        "/folder" => ask(app, "folder", serde_json::json!({ "action": r.action, "name": r.name, "value": r.value })).await,
        "/picks" => {
            let mut payload = serde_json::json!({ "action": r.action, "index": r.index, "value": r.value });
            if r.action == "mark" {
                payload = merge(payload, tracks_payload(app, r.id.as_deref()).await?);
            }
            ask(app, "picks", payload).await
        }
        "/queue/edit" => ask(app, "queue-edit", serde_json::json!({ "action": r.action, "index": r.index, "to": r.to })).await,
        _ => ask(app, "update", serde_json::json!({ "action": r.action, "value": r.value })).await,
    }
}

/// Reply for an agent route: the window's result, or the error with a status that
/// mirrors the other routes (403 a setting blocks it · 409 not connected · 504 no answer ·
/// 400 bad input · 502 anything else).
fn agent_json(req: Request, res: Result<serde_json::Value, String>, origin: Option<String>) {
    match res {
        Ok(v) => json(req, 200, if v.is_null() { serde_json::json!({ "ok": true }) } else { v }, origin),
        Err(e) => {
            log(&format!("agent failed: {e}"));
            if let Some(why) = e.strip_prefix("blocked: ") {
                return json(req, 403, serde_json::json!({ "error": why }), origin);
            }
            let status = if e.contains("not connected") {
                409
            } else if e.contains("did not answer") {
                504
            } else if e.starts_with("no song found") || e.starts_with("nothing to play") || e.starts_with("unknown") {
                400
            } else {
                502
            };
            json(req, status, serde_json::json!({ "error": e }), origin)
        }
    }
}

// ── resolve + add (shared with the tray's Windows-source add) ─────────────────

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub track: Track,
    pub in_library: bool,
    pub score: f32,
    pub artwork_url: Option<String>,
}

/// Lower-cased, punctuation-stripped, noise-word-free text for fuzzy compare.
fn norm(s: &str) -> String {
    let lower = s.to_lowercase();
    let mut out = String::with_capacity(lower.len());
    for ch in lower.chars() {
        if ch.is_alphanumeric() || ch.is_whitespace() {
            out.push(ch);
        } else if ch == '&' {
            out.push_str(" and ");
        } else {
            out.push(' ');
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Token overlap in 0..1 (Dice on word sets) — good enough to rank Apple's own top hits.
fn similarity(a: &str, b: &str) -> f32 {
    let a: std::collections::HashSet<&str> = a.split(' ').filter(|w| !w.is_empty()).collect();
    let b: std::collections::HashSet<&str> = b.split(' ').filter(|w| !w.is_empty()).collect();
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let inter = a.intersection(&b).count() as f32;
    2.0 * inter / (a.len() + b.len()) as f32
}

fn score(t: &Track, title: &str, artist: Option<&str>) -> f32 {
    let ts = similarity(&norm(&t.title), &norm(title));
    match artist {
        Some(a) if !a.trim().is_empty() => 0.65 * ts + 0.35 * similarity(&norm(&t.artist_name), &norm(a)),
        _ => ts,
    }
}

/// Drop every bracketed segment: "Speaking in Tongues (official visualiser w/ )"
/// → "Speaking in Tongues". The extension cleans YouTube titles before it gets
/// here, but that heuristic can never be airtight against arbitrary uploads —
/// this is the resolver's own fallback so a bad parse degrades into a usable
/// search term instead of zero hits.
fn strip_brackets(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut depth = 0usize;
    for ch in s.chars() {
        match ch {
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Search Apple for the best song matches. One catalog call; further rungs of the
/// term ladder are tried only while the previous one came back empty (artist
/// strings off YouTube are often channel names, and titles carry upload noise).
pub async fn resolve(app: &AppHandle, r: &ResolveReq) -> Result<Vec<Candidate>, String> {
    let title = r.title.trim();
    if title.is_empty() {
        return Err("empty title".into());
    }
    let artist = r.artist.as_deref().map(str::trim).filter(|s| !s.is_empty());
    log(&format!(
        "resolve title={title:?} artist={artist:?} album={:?} source={:?} url={:?}",
        r.album, r.source, r.url
    ));

    // Each rung pairs the term to search with the title to score the hits against,
    // so a rung that dropped the brackets is also judged without them.
    let bare = strip_brackets(title);
    let bare = if bare.is_empty() { title } else { bare.as_str() };
    let mut ladder: Vec<(String, &str)> = match artist {
        Some(a) => vec![
            (format!("{a} {title}"), title),
            (format!("{a} {bare}"), bare),
            (bare.to_string(), bare),
        ],
        None => vec![(title.to_string(), title), (bare.to_string(), bare)],
    };
    // Identical rungs (a title with no brackets) must not cost a second call.
    let mut seen = std::collections::HashSet::new();
    ladder.retain(|(term, _)| seen.insert(norm(term)));

    let mut songs = Vec::new();
    let mut scored_against = title;
    for (i, (term, against)) in ladder.iter().enumerate() {
        if i > 0 {
            log(&format!("no hits — retrying {term:?}"));
        }
        songs = search_songs(app, term).await?;
        scored_against = against;
        if !songs.is_empty() {
            break;
        }
    }
    let mut cands: Vec<Candidate> = {
        let db = app.state::<crate::library::Db>();
        let conn = db.lock();
        songs
            .into_iter()
            .map(|t| {
                let in_library = t
                    .catalog_id
                    .as_deref()
                    .map(|id| crate::library::in_library(&conn, id))
                    .unwrap_or(false);
                let artwork_url = t.artwork.as_ref().map(|a| {
                    a.url_template.replace("{w}", "240").replace("{h}", "240").replace("{f}", "jpg")
                });
                Candidate { score: score(&t, scored_against, artist), in_library, artwork_url, track: t }
            })
            .collect()
    };
    cands.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    cands.truncate(3);
    log(&format!(
        "resolve → {}",
        cands
            .iter()
            .map(|c| format!("[{:.2}] {} — {}{}", c.score, c.track.title, c.track.artist_name, if c.in_library { " (in library)" } else { "" }))
            .collect::<Vec<_>>()
            .join(" | ")
    ));
    Ok(cands)
}

async fn search_songs(app: &AppHandle, term: &str) -> Result<Vec<Track>, String> {
    let results = crate::apple::catalog_search(
        term.to_string(),
        Some(vec!["songs".into()]),
        app.state::<crate::apple::AppleState>(),
        app.state::<crate::library::Db>(),
    )
    .await?;
    Ok(results.songs)
}

/// The popup's search card: songs (as candidates, unscored, in-library flagged) +
/// albums, one catalog search.
pub async fn search(app: &AppHandle, term: &str) -> Result<(Vec<Candidate>, Vec<AlbumHit>), String> {
    let term = term.trim();
    if term.is_empty() {
        return Ok((Vec::new(), Vec::new()));
    }
    log(&format!("search {term:?}"));
    let results = crate::apple::catalog_search(
        term.to_string(),
        Some(vec!["songs".into(), "albums".into()]),
        app.state::<crate::apple::AppleState>(),
        app.state::<crate::library::Db>(),
    )
    .await?;
    let songs = {
        let db = app.state::<crate::library::Db>();
        let conn = db.lock();
        results
            .songs
            .into_iter()
            .map(|t| Candidate {
                in_library: t.catalog_id.as_deref().map(|id| crate::library::in_library(&conn, id)).unwrap_or(false),
                artwork_url: art_url(&t.artwork, 240),
                score: 0.0,
                track: t,
            })
            .collect()
    };
    let albums = results
        .albums
        .into_iter()
        .map(|a| AlbumHit { artwork_url: art_url(&a.artwork, 240), album: a })
        .collect();
    Ok((songs, albums))
}

/// Add a whole catalog album (fork A, same as the app's context menu): fetch its
/// tracks so they graduate locally, then POST the album resource.
pub async fn add_album(app: &AppHandle, album: Album) -> Result<(), String> {
    let id = album.catalog_id.clone().filter(|s| !s.is_empty()).ok_or("album has no catalog id")?;
    log(&format!("add album {id}")); // ids, never titles (LOGGING.md)
    let tracks = crate::apple::catalog_collection_tracks(
        "albums".into(),
        id.clone(),
        app.state::<crate::apple::AppleState>(),
        app.state::<crate::library::Db>(),
    )
    .await?;
    crate::apple::apple_add_to_library(
        "albums".into(),
        vec![id],
        tracks,
        app.state::<crate::apple::AppleState>(),
        app.state::<crate::library::Db>(),
    )
    .await?;
    let _ = app.emit("library-changed", ());
    Ok(())
}

/// Add one catalog song and tell the main window so its Library card refreshes.
pub async fn add(app: &AppHandle, track: Track) -> Result<(), String> {
    let id = track.catalog_id.clone().filter(|s| !s.is_empty()).ok_or("track has no catalog id")?;
    log(&format!("add song {id}")); // ids, never titles (LOGGING.md)
    crate::apple::apple_add_to_library(
        "songs".into(),
        vec![id],
        vec![track],
        app.state::<crate::apple::AppleState>(),
        app.state::<crate::library::Db>(),
    )
    .await?;
    let _ = app.emit("library-changed", ());
    Ok(())
}

// ── the same resolve/add for the tray's Windows-media source ──────────────────

#[tauri::command]
pub async fn bridge_resolve(
    title: String,
    artist: Option<String>,
    album: Option<String>,
    app: AppHandle,
) -> Result<Vec<Candidate>, String> {
    resolve(&app, &ResolveReq { title, artist, album, source: Some("tray".into()), url: None }).await
}

#[tauri::command]
pub async fn bridge_add(track: Track, app: AppHandle) -> Result<(), String> {
    add(&app, track).await
}
