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
//!   GET  /log            text/plain — the bridge's ring log (debug)
//!
//! Debug: everything logs to the ring buffer AND `<app_data>/bridge.log`.

use crate::model::{Album, Track};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::Read;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tiny_http::{Header, Method, Request, Response, Server};

/// Fixed candidates, tried in order; the extension probes the same list.
pub const PORTS: [u16; 4] = [47825, 47826, 47827, 47828];

// ── ring log ──────────────────────────────────────────────────────────────────

const LOG_CAP: usize = 400;
static LOG: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());
static LOG_PATH: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();

pub fn log(msg: &str) {
    let ts = chrono::Local::now().format("%H:%M:%S%.3f");
    let line = format!("{ts} {msg}");
    println!("[bridge] {msg}");
    let mut l = LOG.lock().unwrap();
    l.push_back(line.clone());
    while l.len() > LOG_CAP {
        l.pop_front();
    }
    if let Some(p) = LOG_PATH.get() {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
            let _ = writeln!(f, "{line}");
        }
    }
}

pub fn log_text() -> String {
    LOG.lock().unwrap().iter().cloned().collect::<Vec<_>>().join("\n")
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
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub artwork_url: Option<String>,
    pub artwork_template: Option<String>,
    pub catalog_id: Option<String>,
    pub in_library: bool,
    pub live: bool,
    pub progress: f64,
    pub current_time: f64,
    pub duration: f64,
    pub volume: f64,
    pub muted: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Appearance {
    pub theme: String,
    pub skin: String,
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
}

/// Tray → main window transport. Emitted to the main window, which owns MusicKit.
#[tauri::command]
pub fn np_command(cmd: NpCommand, app: AppHandle) {
    log(&format!("np-command {} {:?}", cmd.kind, cmd.value));
    let _ = app.emit_to("main", "np-command", cmd);
}

#[tauri::command]
pub fn appearance_publish(theme: String, skin: String, app: AppHandle, hub: tauri::State<'_, Hub>) {
    let a = Appearance { theme, skin };
    *hub.appearance.lock().unwrap() = a.clone();
    let _ = app.emit_to("tray", "appearance", a);
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
/// build, the repo checkout in dev (resources aren't staged for `tauri dev`).
pub fn extension_dir(app: &AppHandle) -> std::path::PathBuf {
    if let Ok(res) = app.path().resource_dir() {
        let installed = res.join("extension");
        if installed.join("manifest.json").is_file() {
            return installed;
        }
    }
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("extension")
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
    let dir = app.path().app_data_dir().expect("app data dir");
    let _ = LOG_PATH.set(dir.join("bridge.log"));
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
        log("no bridge port free — extension bridge OFF");
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

async fn handle(app: AppHandle, mut req: Request) {
    let method = req.method().clone();
    let path = req.url().split('?').next().unwrap_or("/").to_string();
    let origin = cors_origin(find_header(&req, "Origin").as_deref());
    let auth = find_header(&req, "Authorization").unwrap_or_default();
    let token = app.state::<crate::settings::Settings>().get().bridge_token;
    let paired = origin.is_some() || auth.strip_prefix("Bearer ").map(|t| t.trim() == token).unwrap_or(false);

    if method == Method::Options {
        return respond(req, 204, String::new(), "text/plain", origin);
    }

    let mut body = String::new();
    if method == Method::Post {
        let _ = req.as_reader().take(64 * 1024).read_to_string(&mut body);
    }
    log(&format!("{method} {path} paired={paired} body={}b", body.len()));

    match (method, path.as_str()) {
        (Method::Get, "/health") => {
            let connected = app.state::<crate::apple::AppleState>().user_token.lock().unwrap().is_some();
            let a = app.state::<Hub>().appearance.lock().unwrap().clone();
            json(
                req,
                200,
                serde_json::json!({
                    "ok": true, "app": "DeetsMusic", "version": env!("CARGO_PKG_VERSION"),
                    "connected": connected, "paired": paired, "theme": a.theme, "skin": a.skin,
                }),
                origin,
            )
        }
        (_, "/health") => json(req, 405, serde_json::json!({ "error": "method" }), origin),
        _ if !paired => json(req, 401, serde_json::json!({ "error": "unpaired" }), origin),

        (Method::Get, "/now-playing") => {
            let np = app.state::<Hub>().np.lock().unwrap().clone();
            json(req, 200, serde_json::to_value(np).unwrap_or_default(), origin)
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
            match search(&app, &r.term).await {
                Ok((songs, albums)) => json(req, 200, serde_json::json!({ "songs": songs, "albums": albums }), origin),
                Err(e) => {
                    log(&format!("search failed: {e}"));
                    let status = if e.contains("not connected") { 409 } else { 502 };
                    json(req, status, serde_json::json!({ "error": e }), origin)
                }
            }
        }
        _ => json(req, 404, serde_json::json!({ "error": "no such route" }), origin),
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
        let conn = db.0.lock().unwrap();
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
        let conn = db.0.lock().unwrap();
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
    log(&format!("add album {} — {} ({id})", album.title, album.artist_name));
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
    log(&format!("add {} — {} ({id})", track.title, track.artist_name));
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
