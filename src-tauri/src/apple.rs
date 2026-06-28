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

use crate::model::{Artwork, Page, PlayParams, Track};
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

fn secrets_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("secrets")
}

fn user_token_path() -> PathBuf {
    secrets_dir().join("user-token.txt")
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
pub fn load_persisted_user_token() -> Option<String> {
    std::fs::read_to_string(user_token_path())
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
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

fn open_in_browser(url: &str) {
    #[cfg(windows)]
    let _ = std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn();
    #[cfg(not(windows))]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
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
        .replace("__THEME__", if theme.is_empty() { "fairy" } else { &theme })
        .replace("__SKIN__", if skin.is_empty() { "default" } else { &skin });

    let store = state.user_token.clone();
    std::thread::spawn(move || serve(server, page, nonce, store));

    open_in_browser(&format!("http://127.0.0.1:{port}/"));
    Ok(())
}

#[tauri::command]
pub fn apple_connection_status(state: tauri::State<'_, AppleState>) -> bool {
    state.user_token.lock().unwrap().is_some()
}

#[tauri::command]
pub fn apple_disconnect(state: tauri::State<'_, AppleState>) {
    *state.user_token.lock().unwrap() = None;
    let _ = std::fs::remove_file(user_token_path());
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
async fn api_get(
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
        date_added: a["dateAdded"].as_str().map(String::from),
        play_params: PlayParams {
            id: pp["id"].as_str().map(String::from),
            catalog_id: pp["catalogId"].as_str().map(String::from),
            kind: pp["kind"].as_str().map(String::from),
            is_library: pp["isLibrary"].as_bool().unwrap_or(false),
        },
    }
}

impl MusicProvider for AppleProvider {
    async fn songs_page(&self, offset: u32, limit: u32) -> Result<Page<Track>, String> {
        let url =
            format!("https://api.music.apple.com/v1/me/library/songs?limit={limit}&offset={offset}");
        let (status, body) = api_get(&self.client, &self.dev, &self.user, &url).await?;
        if status != 200 {
            return Err(format!("library/songs HTTP {status}"));
        }
        let items: Vec<Track> = body["data"]
            .as_array()
            .map(|arr| arr.iter().map(track_from_library_song).collect())
            .unwrap_or_default();
        let total = body["meta"]["total"].as_u64().unwrap_or(items.len() as u64) as u32;
        let next_offset = body["next"].as_str().map(|_| offset + limit);
        Ok(Page {
            items,
            total,
            next_offset,
        })
    }
}
