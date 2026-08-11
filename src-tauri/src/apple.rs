//! Apple Music integration.
//!
//! Auth uses a **loopback browser flow** (the in-app webview can't open OAuth
//! popups — a known Tauri/WebView2 limitation). Rust signs the developer token,
//! serves a one-shot sign-in page on `127.0.0.1:<ephemeral>`, opens it in the
//! user's default browser, and captures the Music User Token the page POSTs back.
//! The page is themed with the app's own token CSS + bundled fonts (served here)
//! so it matches the app exactly. The `.p8` and MUT never reach the app renderer.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use tauri_plugin_opener::OpenerExt;

use crate::model::{
    Album, Artist, ArtistDetail, Artwork, NamedRef, Page, PlayParams, Playlist, SearchResults,
    Station, StationGenre, Track,
};
use crate::provider::MusicProvider;

/// Contents of `secrets/apple.json`.
#[derive(Deserialize)]
struct AppleConfig {
    #[serde(rename = "teamId")]
    team_id: String,
    #[serde(rename = "keyId")]
    key_id: String,
    #[serde(rename = "privateKeyFile")]
    private_key_file: String,
}

/// JWT claims for an Apple Music developer token.
#[derive(Serialize)]
struct Claims {
    iss: String,
    iat: u64,
    exp: u64,
}

/// Music User Token store: in memory, mirrored to a gitignored file for persistence.
#[derive(Clone, Default)]
pub struct AppleState {
    pub user_token: Arc<Mutex<Option<String>>>,
}

// The app's real token sheets + fonts, embedded so the auth page matches exactly.
const PALETTE_CSS: &str = include_str!("../../src/styles/palette.css");
const THEMES_CSS: &str = include_str!("../../src/styles/themes.css");
const SKIN_CSS: &str = include_str!("../../src/styles/skin.css");
const FONTS_CSS: &str = include_str!("../../src/styles/fonts.css");
const FONT_REGULAR: &[u8] = include_bytes!("../../src/styles/fonts/LiberationSerif-Regular.ttf");
const FONT_BOLD: &[u8] = include_bytes!("../../src/styles/fonts/LiberationSerif-Bold.ttf");

/// The installed app's data dir, seeded once from Tauri at startup (`lib.rs`).
/// A `OnceLock` rather than threading an `AppHandle` through: the secrets
/// helpers below are plain functions called from a dozen places, including the
/// loopback server thread, which has no handle.
static APP_DATA_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// Called once from `lib.rs`'s `setup()`, before anything reads a secret.
pub fn set_app_data_dir(dir: PathBuf) {
    let _ = APP_DATA_DIR.set(dir);
}

/// Where the credentials you authored live: `apple.json` + the `.p8` key.
///
/// An INSTALLED build must not depend on the source tree, so the app data dir
/// wins — but only if it actually holds an `apple.json`, so a dev run with an
/// empty app data dir keeps working off the repo exactly as before. Copy
/// `src-tauri/secrets/` into the app data dir to make an install self-contained
/// (see `secrets/README.md`).
fn secrets_dir() -> PathBuf {
    if let Some(dir) = APP_DATA_DIR.get() {
        let installed = dir.join("secrets");
        if installed.join("apple.json").is_file() {
            return installed;
        }
    }
    repo_secrets_dir()
}

/// The compile-time source-tree path. Dev fallback only — in an installed
/// build this points at wherever the machine that COMPILED it kept the repo.
fn repo_secrets_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("secrets")
}

/// Where the captured user token is WRITTEN. Always app data when we have it:
/// the token is runtime state, not something you authored, and an installed
/// app writing back into the source tree is exactly what we're fixing. Falls
/// back to the repo only when Tauri never handed us a data dir.
fn user_token_path() -> PathBuf {
    match APP_DATA_DIR.get() {
        Some(dir) => dir.join("user-token.txt"),
        None => repo_secrets_dir().join("user-token.txt"),
    }
}

fn load_config() -> Result<AppleConfig, String> {
    let path = secrets_dir().join("apple.json");
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("could not read {}: {e}", path.display()))?;
    serde_json::from_str(&raw).map_err(|e| format!("invalid apple.json: {e}"))
}

/// Build and sign an Apple Music developer token (ES256 JWT, ~150-day expiry).
pub fn developer_token() -> Result<String, String> {
    let cfg = load_config()?;

    let key_path = secrets_dir().join(&cfg.private_key_file);
    let pem = std::fs::read(&key_path)
        .map_err(|e| format!("could not read private key {}: {e}", key_path.display()))?;
    let encoding_key =
        EncodingKey::from_ec_pem(&pem).map_err(|e| format!("invalid .p8 EC key: {e}"))?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let claims = Claims {
        iss: cfg.team_id,
        iat: now,
        exp: now + 150 * 24 * 60 * 60,
    };

    let mut header = Header::new(Algorithm::ES256);
    header.kid = Some(cfg.key_id);

    encode(&header, &claims, &encoding_key).map_err(|e| format!("failed to sign token: {e}"))
}

// ── User token persistence ───────────────────────────────────────────────────

fn persist_user_token(tok: &str) -> std::io::Result<()> {
    std::fs::write(user_token_path(), tok)
}

/// Read a previously captured MUT from disk (called on startup).
///
/// Falls back to the pre-app-data location in the repo, so an existing dev
/// sign-in isn't silently dropped the first time this runs — and re-persists
/// it to the new path so the fallback is needed exactly once.
pub fn load_persisted_user_token() -> Option<String> {
    let read = |p: PathBuf| {
        std::fs::read_to_string(p)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };
    if let Some(tok) = read(user_token_path()) {
        return Some(tok);
    }
    let legacy = read(repo_secrets_dir().join("user-token.txt"))?;
    let _ = persist_user_token(&legacy);
    Some(legacy)
}

// ── Loopback auth flow ───────────────────────────────────────────────────────

fn random_nonce() -> String {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).expect("system RNG unavailable");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Keep only chars valid in our theme/skin identifiers (defends the injected attr).
fn sanitize_ident(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(32)
        .collect()
}

fn content_type(value: &str) -> tiny_http::Header {
    tiny_http::Header::from_bytes(&b"Content-Type"[..], value.as_bytes()).unwrap()
}

/// Sign-in page, themed with the app's tokens. `__*__` markers are filled in.
const AUTH_PAGE: &str = r#"<!doctype html>
<html lang="en" data-theme="__THEME__" data-skin="__SKIN__">
<head>
<meta charset="utf-8">
<title>DeetsMusic — Apple Music sign-in</title>
<link rel="stylesheet" href="/styles/fonts.css">
<link rel="stylesheet" href="/styles/palette.css">
<link rel="stylesheet" href="/styles/themes.css">
<link rel="stylesheet" href="/styles/skin.css">
<script src="https://js-cdn.music.apple.com/musickit/v3/musickit.js" async></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:var(--canvas);color:var(--text);font-family:var(--font-body);display:grid;place-items:center;padding:var(--space-4)}
.card{background:var(--surface);border:1px solid var(--panel-border);border-radius:var(--radius-panel);box-shadow:var(--shadow-panel);padding:var(--space-5);max-width:420px;width:100%}
h1{font-family:var(--font-title);font-weight:var(--fw-title);color:var(--title);font-size:24px;margin-bottom:var(--space-3)}
p{font-size:var(--fs-text);line-height:var(--lh-text);color:var(--text);margin-bottom:var(--space-4)}
button{font-family:var(--font-body);font-size:var(--fs-text);color:var(--title);background:var(--surface-hover);border:1px solid var(--border);border-radius:var(--radius-control);padding:var(--space-3) var(--space-4);cursor:pointer}
button:hover{filter:brightness(0.98)}
#status{margin-top:var(--space-3);color:var(--subtext);font-size:var(--fs-subtext);min-height:1.2em}
#status.done{color:var(--go)}
</style>
</head>
<body>
<div class="card">
<h1>Connect to Apple Music</h1>
<p>Sign in to let DeetsMusic read your library. When it's done you can close this tab.</p>
<button id="go">Sign in to Apple Music</button>
<p id="status"></p>
</div>
<script>
const DEV_TOKEN="__DEV_TOKEN__", NONCE="__NONCE__";
const status=document.getElementById("status");
async function ready(){
  if(!window.MusicKit){ await new Promise(r=>document.addEventListener("musickitloaded",r,{once:true})); }
  await MusicKit.configure({developerToken:DEV_TOKEN, app:{name:"DeetsMusic",build:"0.1.0"}});
  return MusicKit.getInstance();
}
document.getElementById("go").onclick=async()=>{
  try{
    status.textContent="Opening Apple sign-in…";
    const music=await ready();
    const mut=await music.authorize();
    status.textContent="Authorized — returning to DeetsMusic…";
    await fetch("/callback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({state:NONCE,mut})});
    status.textContent="Done! You can close this tab and return to DeetsMusic.";
    status.className="done";
  }catch(e){ status.textContent="Error: "+((e&&e.message)||e); }
};
</script>
</body></html>"#;

const DONE_RESPONSE: &str = "ok";

/// One-shot loopback server: serves the themed page + assets, captures the MUT.
fn serve(server: tiny_http::Server, page: String, nonce: String, store: Arc<Mutex<Option<String>>>) {
    let deadline = Instant::now() + Duration::from_secs(300);
    loop {
        let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
            break;
        };
        match server.recv_timeout(remaining) {
            Ok(Some(mut req)) => {
                let path = req.url().split('?').next().unwrap_or("/").to_string();
                let is_post = *req.method() == tiny_http::Method::Post;

                if is_post && path == "/callback" {
                    let mut body = String::new();
                    let _ = req.as_reader().read_to_string(&mut body);
                    let token = serde_json::from_str::<serde_json::Value>(&body)
                        .ok()
                        .and_then(|v| {
                            let state = v.get("state").and_then(|x| x.as_str())?;
                            let mut_tok = v.get("mut").and_then(|x| x.as_str())?;
                            (state == nonce && !mut_tok.is_empty()).then(|| mut_tok.to_string())
                        });
                    if let Some(tok) = token {
                        *store.lock().unwrap() = Some(tok.clone());
                        let _ = persist_user_token(&tok);
                        let _ = req.respond(tiny_http::Response::from_string(DONE_RESPONSE));
                        break; // captured — shut down
                    }
                    let _ = req
                        .respond(tiny_http::Response::from_string("bad request").with_status_code(400));
                } else if !is_post {
                    match path.as_str() {
                        "/" => {
                            let _ = req.respond(
                                tiny_http::Response::from_string(page.clone())
                                    .with_header(content_type("text/html; charset=utf-8")),
                            );
                        }
                        "/styles/palette.css" => respond_css(req, PALETTE_CSS),
                        "/styles/themes.css" => respond_css(req, THEMES_CSS),
                        "/styles/skin.css" => respond_css(req, SKIN_CSS),
                        "/styles/fonts.css" => respond_css(req, FONTS_CSS),
                        "/styles/fonts/LiberationSerif-Regular.ttf" => respond_ttf(req, FONT_REGULAR),
                        "/styles/fonts/LiberationSerif-Bold.ttf" => respond_ttf(req, FONT_BOLD),
                        _ => {
                            let _ = req.respond(
                                tiny_http::Response::from_string("not found").with_status_code(404),
                            );
                        }
                    }
                } else {
                    let _ = req
                        .respond(tiny_http::Response::from_string("not found").with_status_code(404));
                }
            }
            Ok(None) => {} // timeout tick — re-check deadline
            Err(_) => break,
        }
    }
}

fn respond_css(req: tiny_http::Request, body: &'static str) {
    let _ = req.respond(
        tiny_http::Response::from_string(body).with_header(content_type("text/css; charset=utf-8")),
    );
}

fn respond_ttf(req: tiny_http::Request, bytes: &'static [u8]) {
    let _ = req
        .respond(tiny_http::Response::from_data(bytes.to_vec()).with_header(content_type("font/ttf")));
}

// ── Tauri commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn apple_developer_token() -> Result<String, String> {
    developer_token()
}

/// Start the loopback sign-in: serve the themed page, open the default browser.
/// `theme`/`skin` mirror the app's active selection so the page matches.
#[tauri::command]
pub fn apple_begin_auth(
    app: tauri::AppHandle,
    theme: String,
    skin: String,
    state: tauri::State<'_, AppleState>,
) -> Result<(), String> {
    let dev = developer_token()?;
    let nonce = random_nonce();

    let theme = sanitize_ident(&theme);
    let skin = sanitize_ident(&skin);

    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|addr| addr.port())
        .ok_or("could not determine loopback port")?;

    let page = AUTH_PAGE
        .replace("__DEV_TOKEN__", &dev)
        .replace("__NONCE__", &nonce)
        .replace("__THEME__", if theme.is_empty() { "lilac" } else { &theme })
        .replace("__SKIN__", if skin.is_empty() { "press" } else { &skin });

    let store = state.user_token.clone();
    std::thread::spawn(move || serve(server, page, nonce, store));

    app.opener()
        .open_url(format!("http://127.0.0.1:{port}/"), None::<&str>)
        .map_err(|e| format!("could not open browser: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn apple_connection_status(state: tauri::State<'_, AppleState>) -> bool {
    state.user_token.lock().unwrap().is_some()
}

/// Hand the captured Music User Token to the renderer.
///
/// Auth deliberately keeps the MUT in Rust, but **playback runs MusicKit JS inside
/// the webview**, which must hold the user token itself — there is no way to play
/// DRM audio without it reaching the renderer. So playback necessarily relaxes the
/// "MUT never enters the renderer" rule for this one path. Returns `None` if not
/// signed in.
#[tauri::command]
pub fn apple_user_token(state: tauri::State<'_, AppleState>) -> Option<String> {
    state.user_token.lock().unwrap().clone()
}

#[tauri::command]
pub fn apple_disconnect(state: tauri::State<'_, AppleState>) {
    *state.user_token.lock().unwrap() = None;
    let _ = std::fs::remove_file(user_token_path());
    // Also clear the pre-app-data copy, or the next launch's fallback in
    // load_persisted_user_token() would quietly sign you back in.
    let _ = std::fs::remove_file(repo_secrets_dir().join("user-token.txt"));
}

// ── Phase 2: raw data dump (for designing the model) ─────────────────────────

fn dump_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("dev-dumps"))
        .unwrap_or_else(|| PathBuf::from("dev-dumps"))
}

fn write_dump(name: &str, value: &serde_json::Value) -> Result<(), String> {
    let dir = dump_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let pretty = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(name), pretty).map_err(|e| e.to_string())
}

/// GET an Apple Music API URL, returning (http_status, parsed_body).
pub(crate) async fn api_get(
    client: &reqwest::Client,
    dev: &str,
    mut_tok: &str,
    url: &str,
) -> Result<(u16, serde_json::Value), String> {
    let resp = client
        .get(url)
        .header("Authorization", format!("Bearer {dev}"))
        .header("Music-User-Token", mut_tok)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let body = serde_json::from_str::<serde_json::Value>(&text)
        .unwrap_or_else(|_| serde_json::json!({ "_nonjson": text }));
    Ok((status, body))
}

/// POST an Apple Music API URL with no body, returning (http_status, parsed_body).
/// Same auth headers as `api_get`; used for library writes (add-to-library).
pub(crate) async fn api_post(
    client: &reqwest::Client,
    dev: &str,
    mut_tok: &str,
    url: &str,
) -> Result<(u16, serde_json::Value), String> {
    let resp = client
        .post(url)
        .header("Authorization", format!("Bearer {dev}"))
        .header("Music-User-Token", mut_tok)
        .header("Content-Length", "0")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();
    let body = serde_json::from_str::<serde_json::Value>(&text)
        .unwrap_or_else(|_| serde_json::json!({ "_nonjson": text }));
    Ok((status, body))
}

/// Pull a representative sample of the user's library + a catalog lookup and
/// write the raw JSON to `dev-dumps/`. Returns a human-readable summary.
#[tauri::command]
pub async fn apple_dump_library(state: tauri::State<'_, AppleState>) -> Result<String, String> {
    let dev = developer_token()?;
    let mut_tok = state
        .user_token
        .lock()
        .unwrap()
        .clone()
        .ok_or("not connected to Apple Music")?;

    let client = reqwest::Client::new();
    let base = "https://api.music.apple.com/v1";
    let mut summary: Vec<String> = Vec::new();

    let count = |v: &serde_json::Value| v["data"].as_array().map(|a| a.len()).unwrap_or(0);
    let total = |v: &serde_json::Value| {
        v["meta"]["total"]
            .as_i64()
            .map(|n| n.to_string())
            .unwrap_or_else(|| "?".into())
    };

    // Storefront (needed for catalog lookups).
    let (st, storefront) = api_get(&client, &dev, &mut_tok, &format!("{base}/me/storefront")).await?;
    write_dump("storefront.json", &storefront)?;
    let sf = storefront["data"][0]["id"].as_str().unwrap_or("us").to_string();
    summary.push(format!("storefront: HTTP {st} → {sf}"));

    // Library resources.
    for (name, file, limit) in [
        ("songs", "library-songs.json", 50),
        ("albums", "library-albums.json", 25),
        ("artists", "library-artists.json", 25),
        ("playlists", "library-playlists.json", 25),
    ] {
        let url = format!("{base}/me/library/{name}?limit={limit}");
        let (st, body) = api_get(&client, &dev, &mut_tok, &url).await?;
        summary.push(format!(
            "library/{name}: HTTP {st}, {} shown (total {})",
            count(&body),
            total(&body)
        ));
        write_dump(file, &body)?;

        // First playlist → its tracks (shows track shape in a playlist).
        if name == "playlists" {
            if let Some(pid) = body["data"][0]["id"].as_str() {
                let url = format!("{base}/me/library/playlists/{pid}/tracks?limit=50");
                let (st, tracks) = api_get(&client, &dev, &mut_tok, &url).await?;
                summary.push(format!("  playlist tracks: HTTP {st}, {} shown", count(&tracks)));
                write_dump("library-playlist-tracks.json", &tracks)?;
            }
        }

        // First library song → catalog lookup (the rich shape).
        if name == "songs" {
            let cat_id = body["data"][0]["attributes"]["playParams"]["catalogId"].as_str();
            match cat_id {
                Some(cid) => {
                    let url = format!("{base}/catalog/{sf}/songs/{cid}");
                    let (st, cat) = api_get(&client, &dev, &mut_tok, &url).await?;
                    summary.push(format!("  catalog song {cid}: HTTP {st}"));
                    write_dump("catalog-song.json", &cat)?;
                }
                None => summary.push("  catalog song: no catalogId on first library song".into()),
            }
        }
    }

    summary.push(format!("→ wrote raw JSON to {}", dump_dir().display()));
    Ok(summary.join("\n"))
}

// ── Provider implementation (normalizes Apple shapes → our model) ─────────────

#[derive(Clone)]
pub struct AppleProvider {
    dev: String,
    user: String,
    client: reqwest::Client,
}

impl AppleProvider {
    pub fn new(dev: String, user: String) -> Self {
        Self {
            dev,
            user,
            client: reqwest::Client::new(),
        }
    }
}

fn artwork_from(v: &serde_json::Value) -> Option<Artwork> {
    let url = v.get("url")?.as_str()?.to_string();
    let text_colors: Vec<String> = ["textColor1", "textColor2", "textColor3", "textColor4"]
        .iter()
        .filter_map(|k| v.get(*k).and_then(|c| c.as_str()).map(String::from))
        .collect();
    Some(Artwork {
        url_template: url,
        width: v.get("width").and_then(|x| x.as_u64()).unwrap_or(0) as u32,
        height: v.get("height").and_then(|x| x.as_u64()).unwrap_or(0) as u32,
        bg_color: v.get("bgColor").and_then(|c| c.as_str()).map(String::from),
        text_colors: (!text_colors.is_empty()).then_some(text_colors),
    })
}

/// Normalize an Apple `library-songs` (or playlist track) resource → `Track`.
fn track_from_library_song(v: &serde_json::Value) -> Track {
    let a = &v["attributes"];
    let pp = &a["playParams"];
    Track {
        library_id: v["id"].as_str().map(String::from),
        catalog_id: pp["catalogId"].as_str().map(String::from),
        title: a["name"].as_str().unwrap_or_default().to_string(),
        artist_name: a["artistName"].as_str().unwrap_or_default().to_string(),
        album_name: a["albumName"].as_str().map(String::from),
        artwork: artwork_from(&a["artwork"]),
        duration_ms: a["durationInMillis"].as_u64(),
        track_number: a["trackNumber"].as_u64().map(|n| n as u32),
        disc_number: a["discNumber"].as_u64().map(|n| n as u32),
        genres: a["genreNames"]
            .as_array()
            .map(|arr| arr.iter().filter_map(|g| g.as_str().map(String::from)).collect())
            .unwrap_or_default(),
        content_rating: a["contentRating"].as_str().map(String::from),
        has_lyrics: a["hasLyrics"].as_bool().unwrap_or(false),
        isrc: a["isrc"].as_str().map(String::from),
        release_date: a["releaseDate"].as_str().map(String::from),
        preview_url: None, // catalog-only; library payloads never carry previews
        added_rank: None,  // set during sync from the dateAdded-sorted page position
        play_params: PlayParams {
            id: pp["id"].as_str().map(String::from),
            catalog_id: pp["catalogId"].as_str().map(String::from),
            kind: pp["kind"].as_str().map(String::from),
            is_library: pp["isLibrary"].as_bool().unwrap_or(false),
        },
    }
}

// ── Catalog normalizers (search results — the rich shapes) ───────────────────

fn track_from_catalog_song(v: &serde_json::Value) -> Track {
    let a = &v["attributes"];
    let pp = &a["playParams"];
    let id = v["id"].as_str().map(String::from);
    Track {
        library_id: None,
        catalog_id: id.clone(),
        title: a["name"].as_str().unwrap_or_default().to_string(),
        artist_name: a["artistName"].as_str().unwrap_or_default().to_string(),
        album_name: a["albumName"].as_str().map(String::from),
        artwork: artwork_from(&a["artwork"]),
        duration_ms: a["durationInMillis"].as_u64(),
        track_number: a["trackNumber"].as_u64().map(|n| n as u32),
        disc_number: a["discNumber"].as_u64().map(|n| n as u32),
        genres: a["genreNames"]
            .as_array()
            .map(|arr| arr.iter().filter_map(|g| g.as_str().map(String::from)).collect())
            .unwrap_or_default(),
        content_rating: a["contentRating"].as_str().map(String::from),
        has_lyrics: a["hasLyrics"].as_bool().unwrap_or(false),
        isrc: a["isrc"].as_str().map(String::from),
        preview_url: a["previews"][0]["url"].as_str().map(String::from),
        release_date: a["releaseDate"].as_str().map(String::from),
        added_rank: None,
        play_params: PlayParams {
            id: pp["id"].as_str().map(String::from).or(id),
            catalog_id: pp["id"].as_str().map(String::from),
            kind: pp["kind"].as_str().map(String::from),
            is_library: false,
        },
    }
}

fn album_from_catalog(v: &serde_json::Value) -> Album {
    let a = &v["attributes"];
    Album {
        library_id: None,
        catalog_id: v["id"].as_str().map(String::from),
        title: a["name"].as_str().unwrap_or_default().to_string(),
        artist_name: a["artistName"].as_str().unwrap_or_default().to_string(),
        artwork: artwork_from(&a["artwork"]),
        genres: a["genreNames"]
            .as_array()
            .map(|arr| arr.iter().filter_map(|g| g.as_str().map(String::from)).collect())
            .unwrap_or_default(),
        release_date: a["releaseDate"].as_str().map(String::from),
        track_count: a["trackCount"].as_u64().map(|n| n as u32),
        date_added: None,
    }
}

fn artist_from_catalog(v: &serde_json::Value) -> Artist {
    let a = &v["attributes"];
    Artist {
        library_id: None,
        catalog_id: v["id"].as_str().map(String::from),
        name: a["name"].as_str().unwrap_or_default().to_string(),
        artwork: artwork_from(&a["artwork"]),
    }
}

fn playlist_from_catalog(v: &serde_json::Value) -> Playlist {
    let a = &v["attributes"];
    Playlist {
        library_id: None,
        catalog_id: v["id"].as_str().map(String::from),
        global_id: a["playParams"]["globalId"].as_str().map(String::from),
        name: a["name"].as_str().unwrap_or_default().to_string(),
        // Catalog playlists nest description as { standard, short }.
        description: a["description"]["standard"].as_str().map(String::from),
        curator_name: a["curatorName"].as_str().map(String::from),
        artwork: artwork_from(&a["artwork"]),
        can_edit: false,
        is_public: true,
        date_added: None,
        last_modified: a["lastModifiedDate"].as_str().map(String::from),
        track_count: None, // not on the search result; the detail fetch carries tracks
        source: None,      // a catalog search hit is neither local nor a library mirror
        kind: None,
        folder_id: None, // folders are local metadata, stamped by playlists_cached
    }
}

fn station_from_catalog(v: &serde_json::Value) -> Station {
    let a = &v["attributes"];
    let pp = &a["playParams"];
    let id = v["id"].as_str().unwrap_or_default().to_string();
    let notes = &a["editorialNotes"];
    Station {
        name: a["name"].as_str().unwrap_or_default().to_string(),
        artwork: artwork_from(&a["artwork"]),
        is_live: a["isLive"].as_bool().unwrap_or(false),
        tagline: notes["short"]
            .as_str()
            .or_else(|| notes["standard"].as_str())
            .map(String::from),
        content_rating: a["contentRating"].as_str().map(String::from),
        url: a["url"].as_str().map(String::from),
        play_params: PlayParams {
            id: pp["id"].as_str().map(String::from).or_else(|| Some(id.clone())),
            catalog_id: None,
            kind: pp["kind"].as_str().map(String::from),
            is_library: false,
        },
        id,
    }
}

/// Normalize an Apple `library-playlists` resource → `Playlist` (the mirror rows —
/// PLAYLISTS.md §2). Apple sends every kind with the same shape; the kind is inferred:
/// `canEdit` → user-authored; else a `globalId` → catalog list added to the library;
/// else a smart playlist (rule-based — the API only ever returns materialized tracks).
fn playlist_from_library(v: &serde_json::Value) -> Playlist {
    let a = &v["attributes"];
    let pp = &a["playParams"];
    let can_edit = a["canEdit"].as_bool().unwrap_or(false);
    let global_id = pp["globalId"].as_str().map(String::from);
    let kind = if can_edit {
        "user"
    } else if global_id.is_some() {
        "catalog"
    } else {
        "smart"
    };
    Playlist {
        library_id: v["id"].as_str().map(String::from),
        catalog_id: pp["catalogId"].as_str().map(String::from),
        global_id,
        name: a["name"].as_str().unwrap_or_default().to_string(),
        description: a["description"]["standard"].as_str().map(String::from),
        curator_name: a["curatorName"].as_str().map(String::from),
        artwork: artwork_from(&a["artwork"]),
        can_edit,
        is_public: a["isPublic"].as_bool().unwrap_or(false),
        date_added: a["dateAdded"].as_str().map(String::from),
        last_modified: a["lastModifiedDate"].as_str().map(String::from),
        track_count: a["trackCount"].as_u64().map(|n| n as u32), // usually absent on the flat list
        source: Some("apple".into()),
        kind: Some(kind.into()),
        folder_id: None, // folders are local metadata, stamped by playlists_cached
    }
}

impl MusicProvider for AppleProvider {
    async fn songs_page(&self, offset: u32, limit: u32) -> Result<Page<Track>, String> {
        // Sort by dateAdded so each row's global position is its "added rank"
        // (songs carry no per-song dateAdded; this is how we order by it). The UI
        // re-sorts client-side, so this fetch order doesn't affect other views.
        let url = format!(
            "https://api.music.apple.com/v1/me/library/songs?limit={limit}&offset={offset}&sort=dateAdded"
        );
        let (status, body) = api_get(&self.client, &self.dev, &self.user, &url).await?;
        if status != 200 {
            return Err(format!("library/songs HTTP {status}"));
        }
        let items: Vec<Track> = body["data"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .enumerate()
                    .map(|(i, v)| {
                        let mut t = track_from_library_song(v);
                        t.added_rank = Some(offset + i as u32);
                        t
                    })
                    .collect()
            })
            .unwrap_or_default();
        let total = body["meta"]["total"].as_u64().unwrap_or(items.len() as u64) as u32;
        let next_offset = body["next"].as_str().map(|_| offset + limit);
        Ok(Page {
            items,
            total,
            next_offset,
        })
    }

    async fn playlists_page(&self, offset: u32, limit: u32) -> Result<Page<Playlist>, String> {
        let url = format!(
            "https://api.music.apple.com/v1/me/library/playlists?limit={limit}&offset={offset}"
        );
        let (status, body) = api_get(&self.client, &self.dev, &self.user, &url).await?;
        if status != 200 {
            return Err(format!("library/playlists HTTP {status}"));
        }
        let items: Vec<Playlist> = body["data"]
            .as_array()
            .map(|arr| arr.iter().map(playlist_from_library).collect())
            .unwrap_or_default();
        let total = body["meta"]["total"].as_u64().unwrap_or(items.len() as u64) as u32;
        let next_offset = body["next"].as_str().map(|_| offset + limit);
        Ok(Page {
            items,
            total,
            next_offset,
        })
    }

    async fn playlist_tracks_page(
        &self,
        id: &str,
        offset: u32,
        limit: u32,
    ) -> Result<Page<Track>, String> {
        let url = format!(
            "https://api.music.apple.com/v1/me/library/playlists/{id}/tracks?limit={limit}&offset={offset}"
        );
        let (status, body) = api_get(&self.client, &self.dev, &self.user, &url).await?;
        // Apple quirk: an EMPTY playlist's tracks endpoint 404s instead of returning [].
        if status == 404 {
            return Ok(Page {
                items: vec![],
                total: 0,
                next_offset: None,
            });
        }
        if status != 200 {
            return Err(format!("library/playlists/{id}/tracks HTTP {status}"));
        }
        // The relationship resolves library-songs AND library-music-videos; Track is
        // song-only, so videos are skipped (PLAYLISTS.md — skipped-with-count later).
        let items: Vec<Track> = body["data"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter(|v| v["type"].as_str() == Some("library-songs"))
                    .map(track_from_library_song)
                    .collect()
            })
            .unwrap_or_default();
        let total = body["meta"]["total"].as_u64().unwrap_or(items.len() as u64) as u32;
        let next_offset = body["next"].as_str().map(|_| offset + limit);
        Ok(Page {
            items,
            total,
            next_offset,
        })
    }

    async fn search(
        &self,
        sf: &str,
        term: &str,
        types: &[String],
        limit: u32,
    ) -> Result<SearchResults, String> {
        // Only the four shippable categories; music-videos are never requested,
        // stations wait on the playback probe (SEARCH.md).
        const ALLOWED: [&str; 4] = ["songs", "albums", "artists", "playlists"];
        let types: Vec<&str> = if types.is_empty() {
            ALLOWED.to_vec()
        } else {
            ALLOWED
                .iter()
                .copied()
                .filter(|t| types.iter().any(|x| x == t))
                .collect()
        };
        if types.is_empty() {
            return Ok(SearchResults::default());
        }

        let mut url = reqwest::Url::parse(&format!(
            "https://api.music.apple.com/v1/catalog/{sf}/search"
        ))
        .map_err(|e| e.to_string())?;
        url.query_pairs_mut()
            .append_pair("term", term)
            .append_pair("types", &types.join(","))
            .append_pair("limit", &limit.to_string());

        let (status, body) = api_get(&self.client, &self.dev, &self.user, url.as_str()).await?;
        if status != 200 {
            return Err(format!("catalog/search HTTP {status}"));
        }
        let r = &body["results"];
        let bucket = |key: &str| -> Vec<serde_json::Value> {
            r[key]["data"].as_array().cloned().unwrap_or_default()
        };
        Ok(SearchResults {
            songs: bucket("songs").iter().map(track_from_catalog_song).collect(),
            albums: bucket("albums").iter().map(album_from_catalog).collect(),
            artists: bucket("artists").iter().map(artist_from_catalog).collect(),
            playlists: bucket("playlists").iter().map(playlist_from_catalog).collect(),
        })
    }
}

/// A catalog album's or playlist's tracks, in authored order. Follows the tracks
/// relationship's `next` links (capped) so long playlists don't truncate silently.
/// Music videos are skipped (`Track` is song-only — PLAYLISTS.md). Results piggyback
/// into the enrichment caches like search results do.
#[tauri::command]
pub async fn catalog_collection_tracks(
    kind: String,
    id: String,
    state: tauri::State<'_, AppleState>,
    db: tauri::State<'_, crate::library::Db>,
) -> Result<Vec<Track>, String> {
    if kind != "albums" && kind != "playlists" {
        return Err(format!("catalog_collection_tracks: bad kind '{kind}'"));
    }
    let dev = developer_token()?;
    let user = state.user_token.lock().unwrap().clone().ok_or("not connected to Apple Music")?;
    let client = reqwest::Client::new();
    let sf = crate::enrich::storefront(&client, &dev, &user, &db).await?;

    let url = format!("https://api.music.apple.com/v1/catalog/{sf}/{kind}/{id}?include=tracks");
    let (status, body) = api_get(&client, &dev, &user, &url).await?;
    if status != 200 {
        return Err(format!("catalog/{kind}/{id} HTTP {status}"));
    }
    let rel = &body["data"][0]["relationships"]["tracks"];
    let mut items: Vec<serde_json::Value> = rel["data"].as_array().cloned().unwrap_or_default();

    // Follow pagination (playlists page at 100). Cap defends against a runaway loop.
    let mut next = rel["next"].as_str().map(String::from);
    for _ in 0..10 {
        let Some(path) = next.take() else { break };
        let (st, page) = api_get(&client, &dev, &user, &format!("https://api.music.apple.com{path}")).await?;
        if st != 200 {
            break; // partial is better than an error mid-drill; the UI shows what loaded
        }
        items.extend(page["data"].as_array().cloned().unwrap_or_default());
        next = page["next"].as_str().map(String::from);
    }

    let tracks: Vec<Track> = items
        .iter()
        .filter(|v| v["type"].as_str() == Some("songs")) // skip music-videos
        .map(track_from_catalog_song)
        .collect();
    {
        let conn = db.0.lock().unwrap();
        crate::enrich::cache_tracks(&conn, &tracks)?;
    }
    Ok(tracks)
}

/// Add catalog resources to the user's iCloud Music Library (FAVORITES.md), then
/// graduate the provided tracks to `source='library'` locally so the Library card
/// reflects them immediately — no full re-sync. `kind` ∈ {"songs","albums"}; `ids` are
/// CATALOG ids to POST; `tracks` are the already-normalized rows to reflect (the one
/// song, or an album's fetched tracks — fork A). Apple is add-only: there is no remove
/// counterpart. The add is async on Apple's side (202 Accepted); we mirror it now and
/// let the next `library_sync` reconcile the real `added_rank`/`library_id`.
#[tauri::command]
pub async fn apple_add_to_library(
    kind: String,
    ids: Vec<String>,
    tracks: Vec<Track>,
    state: tauri::State<'_, AppleState>,
    db: tauri::State<'_, crate::library::Db>,
) -> Result<(), String> {
    if kind != "songs" && kind != "albums" {
        return Err(format!("apple_add_to_library: bad kind '{kind}'"));
    }
    if ids.is_empty() {
        return Ok(());
    }
    let dev = developer_token()?;
    let user = state.user_token.lock().unwrap().clone().ok_or("not connected to Apple Music")?;
    let client = reqwest::Client::new();
    // `ids[songs]=a,b` — reqwest percent-encodes the brackets, which Apple accepts.
    let url = format!(
        "https://api.music.apple.com/v1/me/library?ids[{kind}]={}",
        ids.join(",")
    );
    let (status, body) = api_post(&client, &dev, &user, &url).await?;
    if !(200..300).contains(&status) {
        return Err(format!("add-to-library HTTP {status}: {body}"));
    }
    let conn = db.0.lock().unwrap();
    crate::library::graduate_tracks(&conn, &tracks)?;
    Ok(())
}

/// A catalog artist's detail: albums + top songs, one fetch (`views=`).
#[tauri::command]
pub async fn catalog_artist(
    id: String,
    state: tauri::State<'_, AppleState>,
    db: tauri::State<'_, crate::library::Db>,
) -> Result<ArtistDetail, String> {
    let dev = developer_token()?;
    let user = state.user_token.lock().unwrap().clone().ok_or("not connected to Apple Music")?;
    let client = reqwest::Client::new();
    let sf = crate::enrich::storefront(&client, &dev, &user, &db).await?;

    let url =
        format!("https://api.music.apple.com/v1/catalog/{sf}/artists/{id}?views=top-songs,full-albums");
    let (status, body) = api_get(&client, &dev, &user, &url).await?;
    if status != 200 {
        return Err(format!("catalog/artists/{id} HTTP {status}"));
    }
    let a = &body["data"][0];
    let views = &a["views"];
    let top_songs: Vec<Track> = views["top-songs"]["data"]
        .as_array()
        .map(|arr| arr.iter().filter(|v| v["type"].as_str() == Some("songs")).map(track_from_catalog_song).collect())
        .unwrap_or_default();
    let albums: Vec<Album> = views["full-albums"]["data"]
        .as_array()
        .map(|arr| arr.iter().map(album_from_catalog).collect())
        .unwrap_or_default();
    {
        let conn = db.0.lock().unwrap();
        crate::enrich::cache_tracks(&conn, &top_songs)?;
    }
    Ok(ArtistDetail {
        artist: artist_from_catalog(a),
        albums,
        top_songs,
    })
}

/// Catalog search command. Normalizes per category and — since catalog songs carry
/// ISRC / preview / palette for free — piggybacks the results into the enrichment
/// caches (SEARCH.md: "Search doubles as a lazy-enrichment source").
#[tauri::command]
pub async fn catalog_search(
    term: String,
    types: Option<Vec<String>>,
    state: tauri::State<'_, AppleState>,
    db: tauri::State<'_, crate::library::Db>,
) -> Result<SearchResults, String> {
    let dev = developer_token()?;
    let user = state
        .user_token
        .lock()
        .unwrap()
        .clone()
        .ok_or("not connected to Apple Music")?;
    let provider = AppleProvider::new(dev.clone(), user.clone());
    let sf = crate::enrich::storefront(&provider.client, &dev, &user, &db).await?;

    let results = provider
        .search(&sf, &term, &types.unwrap_or_default(), 25)
        .await?;

    {
        let conn = db.0.lock().unwrap();
        crate::enrich::cache_tracks(&conn, &results.songs)?;
    }
    Ok(results)
}

// ── Radio (STATIONS.md §2–3) ─────────────────────────────────────────────────
// Metadata-only: the catalog API browses stations but never lists their tracks —
// playback is the MusicKit wiring batch. All four are cheap single fetches; the
// front-end session-caches them, so a card remount costs zero Apple calls.

/// GET a catalog listing and collect its `data` array, following `next` links
/// (capped — same partial-over-error doctrine as `catalog_collection_tracks`).
async fn paged_data(
    client: &reqwest::Client,
    dev: &str,
    user: &str,
    url: &str,
    what: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let (status, body) = api_get(client, dev, user, url).await?;
    if status != 200 {
        return Err(format!("{what} HTTP {status}"));
    }
    let mut items: Vec<serde_json::Value> = body["data"].as_array().cloned().unwrap_or_default();
    let mut next = body["next"].as_str().map(String::from);
    for _ in 0..10 {
        let Some(path) = next.take() else { break };
        let (st, page) =
            api_get(client, dev, user, &format!("https://api.music.apple.com{path}")).await?;
        if st != 200 {
            break; // partial is better than an error; the UI shows what loaded
        }
        items.extend(page["data"].as_array().cloned().unwrap_or_default());
        next = page["next"].as_str().map(String::from);
    }
    Ok(items)
}

/// The Apple Music live-radio lineup (Apple Music 1 / Hits / Country / Música Uno /
/// Club / Chill) — storefront-static, so effectively cache-forever.
#[tauri::command]
pub async fn radio_live(
    state: tauri::State<'_, AppleState>,
    db: tauri::State<'_, crate::library::Db>,
) -> Result<Vec<Station>, String> {
    let dev = developer_token()?;
    let user = state.user_token.lock().unwrap().clone().ok_or("not connected to Apple Music")?;
    let client = reqwest::Client::new();
    let sf = crate::enrich::storefront(&client, &dev, &user, &db).await?;
    let url = format!(
        "https://api.music.apple.com/v1/catalog/{sf}/stations?filter[featured]=apple-music-live-radio"
    );
    let items = paged_data(&client, &dev, &user, &url, "stations/live").await?;
    Ok(items.iter().map(station_from_catalog).collect())
}

/// The user's My Station ("<Name>'s Station" — heavy rotation of known taste).
/// The cleanly documented personalized station: `filter[identity]=personal`
/// (needs the Music User Token). Absence just hides its For You row.
#[tauri::command]
pub async fn radio_my_station(
    state: tauri::State<'_, AppleState>,
    db: tauri::State<'_, crate::library::Db>,
) -> Result<Option<Station>, String> {
    let dev = developer_token()?;
    let user = state.user_token.lock().unwrap().clone().ok_or("not connected to Apple Music")?;
    let client = reqwest::Client::new();
    let sf = crate::enrich::storefront(&client, &dev, &user, &db).await?;
    let url = format!(
        "https://api.music.apple.com/v1/catalog/{sf}/stations?filter[identity]=personal"
    );
    let (status, body) = api_get(&client, &dev, &user, &url).await?;
    if status != 200 {
        return Err(format!("stations/personal HTTP {status}"));
    }
    Ok(body["data"].as_array().and_then(|a| a.first()).map(station_from_catalog))
}

/// The user's Discovery Station (new-music counterpart to My Station). No
/// documented filter exists — it surfaces inside `/v1/me/recommendations`, so we
/// scan every recommendation's contents for station resources and pick the
/// `ra.q-` one (name-match fallback). Absence is not an error: the row hides.
#[tauri::command]
pub async fn radio_discovery(
    state: tauri::State<'_, AppleState>,
) -> Result<Option<Station>, String> {
    let dev = developer_token()?;
    let user = state.user_token.lock().unwrap().clone().ok_or("not connected to Apple Music")?;
    let client = reqwest::Client::new();
    let url = "https://api.music.apple.com/v1/me/recommendations";
    let (status, body) = api_get(&client, &dev, &user, url).await?;
    if status != 200 {
        return Err(format!("me/recommendations HTTP {status}"));
    }
    let mut stations: Vec<&serde_json::Value> = Vec::new();
    if let Some(recs) = body["data"].as_array() {
        for rec in recs {
            if let Some(contents) = rec["relationships"]["contents"]["data"].as_array() {
                stations.extend(contents.iter().filter(|v| v["type"].as_str() == Some("stations")));
            }
        }
    }
    let found = stations
        .iter()
        .find(|v| v["id"].as_str().is_some_and(|id| id.starts_with("ra.q-")))
        .or_else(|| {
            stations.iter().find(|v| {
                v["attributes"]["name"].as_str().is_some_and(|n| n.contains("Discovery"))
            })
        });
    Ok(found.map(|v| station_from_catalog(v)))
}

/// All station genres for the storefront (name-only rows; a genre's stations are
/// fetched lazily on drill via `radio_genre_stations`).
#[tauri::command]
pub async fn radio_genres(
    state: tauri::State<'_, AppleState>,
    db: tauri::State<'_, crate::library::Db>,
) -> Result<Vec<StationGenre>, String> {
    let dev = developer_token()?;
    let user = state.user_token.lock().unwrap().clone().ok_or("not connected to Apple Music")?;
    let client = reqwest::Client::new();
    let sf = crate::enrich::storefront(&client, &dev, &user, &db).await?;
    let url = format!("https://api.music.apple.com/v1/catalog/{sf}/station-genres");
    let items = paged_data(&client, &dev, &user, &url, "station-genres").await?;
    Ok(items
        .iter()
        .filter_map(|v| {
            Some(StationGenre {
                id: v["id"].as_str()?.to_string(),
                name: v["attributes"]["name"].as_str()?.to_string(),
            })
        })
        .collect())
}

/// A genre's curated stations (the `stations` relationship on `station-genres`).
#[tauri::command]
pub async fn radio_genre_stations(
    id: String,
    state: tauri::State<'_, AppleState>,
    db: tauri::State<'_, crate::library::Db>,
) -> Result<Vec<Station>, String> {
    let dev = developer_token()?;
    let user = state.user_token.lock().unwrap().clone().ok_or("not connected to Apple Music")?;
    let client = reqwest::Client::new();
    let sf = crate::enrich::storefront(&client, &dev, &user, &db).await?;
    let url = format!("https://api.music.apple.com/v1/catalog/{sf}/station-genres/{id}/stations");
    let items = paged_data(&client, &dev, &user, &url, "station-genres/stations").await?;
    Ok(items.iter().map(station_from_catalog).collect())
}

/// The Apple station seeded from a song or artist ("Start Station" — STATIONS.md §2).
/// Direct relationship fetch: `GET /v1/catalog/{sf}/{kind}/{id}/station`.
/// 404 / empty data = no station exists for the seed (`None`, not an error).
#[tauri::command]
pub async fn radio_seed_station(
    kind: String, // "songs" | "artists"
    id: String,
    state: tauri::State<'_, AppleState>,
    db: tauri::State<'_, crate::library::Db>,
) -> Result<Option<Station>, String> {
    if kind != "songs" && kind != "artists" {
        return Err(format!("unsupported seed kind: {kind}"));
    }
    let dev = developer_token()?;
    let user = state.user_token.lock().unwrap().clone().ok_or("not connected to Apple Music")?;
    let client = reqwest::Client::new();
    let sf = crate::enrich::storefront(&client, &dev, &user, &db).await?;
    let url = format!("https://api.music.apple.com/v1/catalog/{sf}/{kind}/{id}/station");
    let (status, body) = api_get(&client, &dev, &user, &url).await?;
    if status == 404 {
        return Ok(None);
    }
    if status != 200 {
        return Err(format!("{kind}/station HTTP {status}"));
    }
    Ok(body["data"].as_array().and_then(|a| a.first()).map(station_from_catalog))
}

/// A catalog song's primary artist catalog id — the song→artist hop behind "Start
/// Station" on a derived library artist (STATIONS.md §2). Library rows carry only an
/// artist NAME, so the seed rides one of the artist's songs' catalog ids instead.
#[tauri::command]
pub async fn catalog_song_artist(
    id: String,
    state: tauri::State<'_, AppleState>,
    db: tauri::State<'_, crate::library::Db>,
) -> Result<Option<String>, String> {
    let dev = developer_token()?;
    let user = state.user_token.lock().unwrap().clone().ok_or("not connected to Apple Music")?;
    let client = reqwest::Client::new();
    let sf = crate::enrich::storefront(&client, &dev, &user, &db).await?;
    let url = format!("https://api.music.apple.com/v1/catalog/{sf}/songs/{id}?include=artists");
    let (status, body) = api_get(&client, &dev, &user, &url).await?;
    if status == 404 {
        return Ok(None);
    }
    if status != 200 {
        return Err(format!("songs/{id} HTTP {status}"));
    }
    Ok(body["data"][0]["relationships"]["artists"]["data"][0]["id"]
        .as_str()
        .map(String::from))
}

/// Resolve a catalog entity's first related resource as `{id, name}` — the generic
/// hop behind the search card's drill-in verbs. `kind`/`id` name the SOURCE
/// (`songs`/`albums`), `rel` the relationship to follow (`artists`/`albums`). One
/// `include=` fetch; both artists and albums expose `attributes.name`, so the same
/// read serves every hop. The front-end session-caches per (kind, id, rel), so a
/// repeat "Go to …" on the same row is free.
#[tauri::command]
pub async fn catalog_related(
    kind: String,
    id: String,
    rel: String,
    state: tauri::State<'_, AppleState>,
    db: tauri::State<'_, crate::library::Db>,
) -> Result<Option<NamedRef>, String> {
    let dev = developer_token()?;
    let user = state.user_token.lock().unwrap().clone().ok_or("not connected to Apple Music")?;
    let client = reqwest::Client::new();
    let sf = crate::enrich::storefront(&client, &dev, &user, &db).await?;
    let url = format!("https://api.music.apple.com/v1/catalog/{sf}/{kind}/{id}?include={rel}");
    let (status, body) = api_get(&client, &dev, &user, &url).await?;
    if status == 404 {
        return Ok(None);
    }
    if status != 200 {
        return Err(format!("{kind}/{id} include={rel} HTTP {status}"));
    }
    let node = &body["data"][0]["relationships"][rel.as_str()]["data"][0];
    Ok(node["id"].as_str().map(|id| NamedRef {
        id: id.to_string(),
        name: node["attributes"]["name"].as_str().unwrap_or_default().to_string(),
    }))
}
