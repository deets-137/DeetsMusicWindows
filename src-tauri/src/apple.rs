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
use tauri::Emitter;
use tauri_plugin_opener::OpenerExt;

use crate::model::{
    Album, Artist, ArtistDetail, Artwork, NamedRef, Page, PlayParams, Playlist, RecentAdded,
    SearchResults, Station, StationGenre, Track,
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
    /// The browser sign-in in progress. `connect()` polls this rather than "is a token
    /// present", so a re-sign-in over an expired token waits for the NEW capture, and a
    /// failure the page reports reaches the app at once instead of after the timeout.
    pub auth: Arc<Mutex<AuthStatus>>,
    /// The hosted sign-in waiting for its deep link (DATA-ARCHITECTURE §2a). `None`
    /// when no hosted sign-in is in progress: a link that arrives then is ignored.
    pub link: Arc<Mutex<Option<PendingLink>>>,
    /// The sign-in in progress can be stopped: a second click on the Account button
    /// (`apple_cancel_auth`) or a newer sign-in raises this flag, the loopback server
    /// thread sees it within a second and frees its port.
    pub abort: Arc<Mutex<Option<Arc<std::sync::atomic::AtomicBool>>>>,
}

/// A new sign-in starts: stop the previous one (its loopback server frees the port,
/// its link is forgotten) and hand back the flag for this one.
fn arm_abort(state: &AppleState) -> Arc<std::sync::atomic::AtomicBool> {
    let flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
    if let Some(old) = state.abort.lock().unwrap().replace(flag.clone()) {
        old.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    *state.link.lock().unwrap() = None;
    flag
}

/// Stop the sign-in in progress: the Account button clicked again while it waits
/// (main.ts), or nothing to stop. The loopback server exits within a second; a later
/// hosted link finds no pending sign-in. `connect()` sees `Failed { "cancelled" }` and
/// paints the row back without a toast — the user asked for this one.
#[tauri::command]
pub fn apple_cancel_auth(state: tauri::State<'_, AppleState>) {
    if let Some(flag) = state.abort.lock().unwrap().take() {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    *state.link.lock().unwrap() = None;
    let mut auth = state.auth.lock().unwrap();
    if matches!(*auth, AuthStatus::Pending) {
        *auth = AuthStatus::Failed { reason: "cancelled".into() };
        crate::log::info("sign-in: cancelled from the Account row");
    }
}

#[derive(Clone, Default, Serialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum AuthStatus {
    #[default]
    Idle,
    Pending,
    Captured,
    Failed { reason: String },
}

/// One hosted sign-in: its nonce and when it started. Taken (single use) by the first
/// matching link; dropped by the local sign-in and by the 5-minute expiry.
pub struct PendingLink {
    nonce: String,
    started: Instant,
}

// ── Hosted sign-in page + deep link (DATA-ARCHITECTURE §2a) ─────────────────

/// The hosted sign-in page's origin: the mint host, so the page reads its developer
/// token from the same Worker with no CORS. Debug builds may point it elsewhere with
/// `DEETS_SIGNIN_BASE` (a `wrangler dev` session); the release build has no override.
const SIGNIN_BASE: &str = "https://music-api.deets.solutions";
/// A hosted sign-in waits this long for its link, like the loopback page's 5 minutes.
const LINK_TTL: Duration = Duration::from_secs(300);

/// The deep-link scheme this build answers to. A debug build owns its own scheme, so
/// `dev:app` never takes `deetsmusic://` from the installed app (§2a fork 4). Windows
/// keeps one exe per scheme (HKCU\Software\Classes\<scheme>): the release installer
/// writes `deetsmusic`, and `lib.rs` registers `deetsmusic-dev` at every debug launch.
/// DeetsMusic Beta owns `deetsmusic-beta` the same way; its installer writes it (BETA.md §5).
pub fn link_scheme() -> &'static str {
    if cfg!(debug_assertions) {
        "deetsmusic-dev"
    } else if crate::beta::is_beta() {
        "deetsmusic-beta"
    } else {
        "deetsmusic"
    }
}

fn signin_base() -> String {
    #[cfg(debug_assertions)]
    if let Ok(v) = std::env::var("DEETS_SIGNIN_BASE") {
        let v = v.trim().trim_end_matches('/');
        if !v.is_empty() {
            return v.to_string();
        }
    }
    SIGNIN_BASE.to_string()
}

/// The first `<scheme>://…` argument, if any — how a link reaches a launch.
pub fn link_in_args<'a>(args: impl IntoIterator<Item = &'a String>) -> Option<&'a String> {
    let prefix = format!("{}://", link_scheme());
    args.into_iter().find(|a| a.to_ascii_lowercase().starts_with(&prefix))
}

/// A `<scheme>://auth?n=<nonce>&mut=<token>` or `…&error=<reason>` link from the
/// browser, forwarded by the single-instance plugin (`lib.rs`). Any web page can open
/// such a link, so nothing is accepted without a pending sign-in whose nonce matches,
/// within its 5 minutes, once. A mismatch is ignored (the real link may still come);
/// no pending sign-in is ignored (a cold start, or a stray page). The Apple check on
/// the token runs off the caller's thread — it is the main thread.
pub fn handle_link(app: &tauri::AppHandle, raw: &str) {
    use tauri::Manager;
    let Ok(url) = url::Url::parse(raw) else {
        crate::log::warn("sign-in: link did not parse; ignored");
        return;
    };
    let route = url.host_str().unwrap_or("").to_string() + url.path().trim_end_matches('/');
    if !url.scheme().eq_ignore_ascii_case(link_scheme()) || route != "auth" {
        crate::log::warn(&format!("sign-in: link to an unknown route ({}); ignored", url.scheme()));
        return;
    }
    let mut nonce = None;
    let mut token = None;
    let mut error = None;
    for (k, v) in url.query_pairs() {
        match &*k {
            "n" => nonce = Some(v.into_owned()),
            "mut" => token = Some(v.into_owned()),
            "error" => error = Some(v.chars().take(120).collect::<String>()),
            _ => {}
        }
    }
    if let Some(t) = token.as_deref() {
        crate::log::register_secret(t);
    }

    let state = app.state::<AppleState>();
    {
        let mut pending = state.link.lock().unwrap();
        let Some(p) = pending.as_ref() else {
            crate::log::warn("sign-in: link arrived with no sign-in in progress; ignored (start the sign-in from DeetsMusic)");
            return;
        };
        if nonce.as_deref() != Some(p.nonce.as_str()) {
            crate::log::warn("sign-in: link nonce does not match the sign-in in progress; ignored");
            return;
        }
        let expired = p.started.elapsed() > LINK_TTL;
        *pending = None; // single use, matched or expired
        if expired {
            crate::log::warn("sign-in: link arrived after 5 min; sign-in abandoned");
            *state.auth.lock().unwrap() = AuthStatus::Failed { reason: "timeout".into() };
            return;
        }
    }

    if let Some(reason) = error {
        crate::log::warn(&format!("sign-in: the hosted page reported a failure: {reason}"));
        *state.auth.lock().unwrap() = AuthStatus::Failed { reason };
        return;
    }
    let Some(tok) = token.filter(|t| !t.is_empty()) else {
        crate::log::warn("sign-in: link carried no token; sign-in abandoned");
        *state.auth.lock().unwrap() = AuthStatus::Failed { reason: "link carried no token".into() };
        return;
    };
    let store = state.user_token.clone();
    let auth = state.auth.clone();
    std::thread::spawn(move || {
        accept_token(&tok, &store, &auth);
    });
}

/// Start a hosted sign-in: remember the nonce, open the page, arm the expiry.
fn begin_hosted(app: &tauri::AppHandle, state: &AppleState, theme: &str, skin: &str) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let nonce = random_nonce();
    arm_abort(state);
    *state.link.lock().unwrap() = Some(PendingLink { nonce: nonce.clone(), started: Instant::now() });
    *state.auth.lock().unwrap() = AuthStatus::Pending;

    let link = state.link.clone();
    let auth = state.auth.clone();
    let armed = nonce.clone();
    std::thread::spawn(move || {
        std::thread::sleep(LINK_TTL);
        let mut pending = link.lock().unwrap();
        if pending.as_ref().map(|p| p.nonce == armed).unwrap_or(false) {
            *pending = None;
            crate::log::warn("sign-in: no link within 5 min; browser sign-in abandoned");
            *auth.lock().unwrap() = AuthStatus::Failed { reason: "timeout".into() };
        }
    });

    let url = format!(
        "{}/signin?n={nonce}&s={}&theme={}&skin={}&v={}",
        signin_base(),
        link_scheme(),
        if theme.is_empty() { "lilac" } else { theme },
        if skin.is_empty() { "press" } else { skin },
        env!("CARGO_PKG_VERSION")
    );
    // The address is logged whole: the nonce is worth nothing after 5 minutes or one
    // use, and a support log that shows WHICH page opened is the point of the line.
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| format!("could not open browser: {e}"))?;
    crate::log::info(&format!("sign-in: hosted page opened in the browser: {url}"));
    Ok(())
}

/// Is the hosted page there? One GET of `/signin` with no query — that renders the
/// "start from DeetsMusic" page, no mint work — bounded by the check client's timeout.
/// The page itself, not `/health`: a Worker that is up without the page (deployed
/// before the page existed) must fall back too. A miss uses the loopback page (§2a
/// fork 5) and is logged.
async fn hosted_reachable(client: &reqwest::Client) -> bool {
    let url = format!("{}/signin", signin_base());
    // Shorter than the client's 8 s: this wait sits between the click and the browser.
    match client.get(&url).timeout(Duration::from_secs(4)).send().await {
        Ok(r) if r.status().is_success()
            && r.headers().get("content-type").and_then(|v| v.to_str().ok()).map(|v| v.starts_with("text/html")).unwrap_or(false) =>
        {
            true
        }
        Ok(r) => {
            crate::log::warn(&format!("sign-in: hosted page answered {}; using the local page", r.status().as_u16()));
            false
        }
        Err(e) => {
            crate::log::warn(&format!("sign-in: hosted page unreachable ({e}); using the local page"));
            false
        }
    }
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

/// Where a LOCAL MusicKit key may live (`apple.json` + the `.p8`) — **debug builds only**.
///
/// A release build never signs its own token: it always takes one from the mint, exactly
/// like a stranger's install. Found 2026-09-13: the installed app on the dev PC read the
/// repo's key through the compile-time path below, skipped the Worker and its 401 heal, and
/// broke when that key was rotated — so the live app was testing a path no user runs.
/// In a debug build the app data dir wins when it holds an `apple.json`, else the repo.
fn secrets_dir() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    if let Some(dir) = APP_DATA_DIR.get() {
        let local = dir.join("secrets");
        if local.join("apple.json").is_file() {
            return Some(local);
        }
    }
    repo_secrets_dir()
}

/// The compile-time source-tree path, debug builds only. In a release build it would
/// point at wherever the machine that COMPILED it kept the repo — so it is compiled OUT
/// (`#[cfg]`, not a runtime check): the release exe must not even contain the string.
/// `scripts/release-check.mjs` fails `npm run release` if it does (RELEASE.md §1a).
#[cfg(debug_assertions)]
fn repo_secrets_dir() -> Option<PathBuf> {
    Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("secrets"))
}
#[cfg(not(debug_assertions))]
fn repo_secrets_dir() -> Option<PathBuf> {
    None
}

/// Where the captured user token is WRITTEN. Always app data when we have it:
/// the token is runtime state, not something you authored, and an installed
/// app writing back into the source tree is exactly what we're fixing. Falls
/// back to the repo only when Tauri never handed us a data dir.
fn user_token_path() -> PathBuf {
    match APP_DATA_DIR.get() {
        Some(dir) => dir.join("user-token.txt"),
        // Only before setup() seeds the data dir; nothing reads the token that early.
        None => repo_secrets_dir().unwrap_or_default().join("user-token.txt"),
    }
}

fn load_config() -> Result<AppleConfig, String> {
    let path = secrets_dir().ok_or("a release build uses no local MusicKit key")?.join("apple.json");
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("could not read {}: {e}", path.display()))?;
    serde_json::from_str(&raw).map_err(|e| format!("invalid apple.json: {e}"))
}

// ── Developer token: the cache, the dev seam and the mint ──────────────────
//
// `developer_token()` is sync and called from ~25 places, so the token lives in
// a `static` and is resolved ONCE at startup by `ensure_developer_token()`
// (`lib.rs` setup). RELEASE.md §7 is the design; the order there is:
//
//   1. a local `apple.json` + `.p8` → sign here, exactly as before (the dev seam;
//      a contributor with their own MusicKit key never touches the network)
//   2. else `<app_data>/developer-token.json` with > 3 days left → use it
//   3. else one fetch from the mint, ~8 s budget, and persist the answer
//
// A fetch failure (offline, 429, 503) keeps any still-valid cached token, so
// neither can block startup or sign the user out. On a 401 from Apple, the
// request helpers below refetch ONCE per process and retry — the way a rotated
// key heals an install without a release.
//
// The token is a bearer credential: it reaches Rust and, via
// `apple_developer_token`, the webview. Never the bridge or the agent routes.

/// Compiled in. Never the `support.` host (support.md: a future split of the mint
/// must stay a route move, not an app release).
const TOKEN_URL: &str = "https://music-api.deets.solutions/token";
/// The build key (RELEASE.md §7a): built in by `build.rs` from Deets' Secrets, sent as this
/// header on the mint and on report intake. `None` in a build without the key file — such a
/// build still runs on a local `.p8`, and the worker answers it 403 `build` once its check is on.
/// A ledge, not a wall: it can be read out of the exe. It stops a clone build from using
/// Deets' workers by accident, and nothing more is claimed for it.
const BUILD_KEY: Option<&str> = option_env!("DEETS_BUILD_KEY");
pub const BUILD_HEADER: &str = "X-Deets-Build";

/// The build key to send, if this build has one.
pub fn build_key() -> Option<&'static str> {
    BUILD_KEY.map(str::trim).filter(|k| !k.is_empty())
}
/// The Origin every Rust call to Apple sends: the release webview's own origin. A
/// token with an `origin` claim gets a 401 for a missing or unlisted Origin (probed
/// 2026-09-13), and reqwest sends none, so this keeps Rust calls valid once the
/// Worker turns the claim on (`TOKEN_ORIGINS`, RELEASE.md §7). Harmless before that.
const APPLE_ORIGIN: &str = "http://tauri.localhost";
/// The sign-in page's loopback ports, tried in order. Fixed, not ephemeral: Apple
/// matches the `origin` claim by exact host AND port (no wildcards), so the Worker
/// lists these three. All busy → sign-in reports it instead of using another port.
const AUTH_PORTS: [u16; 3] = [47831, 47832, 47833];
/// Refetch at startup once fewer than this many seconds remain. Must stay below the
/// Worker's rotation window (7 days): a shared token is handed out with 7–14 days left,
/// so a larger margin would refetch on every launch.
const REFRESH_MARGIN_SECS: u64 = 3 * 24 * 60 * 60;
/// The startup fetch runs inside `setup()`; it must not stall the window.
const MINT_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Serialize, Deserialize, Clone)]
struct DevToken {
    token: String,
    exp: u64,
    /// "local" (signed here from the `.p8`) or "worker" (minted).
    source: String,
    /// Remote config that rode the `/token` response (support.md). Null for local.
    #[serde(default)]
    config: serde_json::Value,
}

/// The worker's `/token` body.
#[derive(Deserialize)]
struct MintResponse {
    token: String,
    exp: u64,
    #[serde(default)]
    config: serde_json::Value,
}

/// The one HTTP client for every Apple Music call (and the other plain fetches). A
/// `reqwest::Client` is a connection pool: built once, it keeps the TLS session to
/// api.music.apple.com open between commands, so an album open or an artist view
/// after the first pays no new handshake. Before 2026-09-18 each command built its
/// own client, used it once, and dropped the pool with it. Callers that need their
/// own timeout (the mint, the health check, the updater, reports) keep a builder.
static HTTP_CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();

/// A handle to the shared client. Cloning a `Client` is an `Arc` bump, not a new pool.
pub fn http_client() -> reqwest::Client {
    HTTP_CLIENT.get_or_init(reqwest::Client::new).clone()
}

static DEV_TOKEN: Mutex<Option<DevToken>> = Mutex::new(None);
/// Why there is no token, when there is none — so `developer_token()` can name
/// the real cause ("no local key and no network") instead of a file path.
static DEV_TOKEN_ERROR: Mutex<Option<String>> = Mutex::new(None);
/// The 401 refetch is the only path that can hit the mint in a loop, and failures can
/// arrive without bound (every Apple call, every MusicKit error, every retry). So it is
/// bounded here, not at the call sites: at most one mint fetch per cooldown per process,
/// and none when the token that failed is no longer the live one (someone already healed).
static LAST_REFETCH: Mutex<Option<Instant>> = Mutex::new(None);
const REFETCH_COOLDOWN: Duration = Duration::from_secs(10 * 60);
/// For the `developer-token-changed` event after a 401 refetch.
static APP_HANDLE: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

/// Called once from `lib.rs` `setup()`.
pub fn set_app_handle(app: tauri::AppHandle) {
    let _ = APP_HANDLE.set(app);
}

/// The handle, for code that must reach the app from outside a command
/// (`dbhealth::tell_once`). None before `setup()` has run.
pub(crate) fn app_handle() -> Option<&'static tauri::AppHandle> {
    APP_HANDLE.get()
}


fn unix_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn dev_token_path() -> Option<PathBuf> {
    APP_DATA_DIR.get().map(|d| d.join("developer-token.json"))
}

fn local_key_present() -> bool {
    secrets_dir().is_some_and(|d| d.join("apple.json").is_file())
}

/// The dev seam: sign an ES256 JWT from the local `.p8` (150-day expiry).
fn sign_local() -> Result<DevToken, String> {
    let cfg = load_config()?;

    let key_path = secrets_dir().unwrap_or_default().join(&cfg.private_key_file);
    let pem = std::fs::read(&key_path)
        .map_err(|e| format!("could not read private key {}: {e}", key_path.display()))?;
    let encoding_key =
        EncodingKey::from_ec_pem(&pem).map_err(|e| format!("invalid .p8 EC key: {e}"))?;

    let now = unix_now();
    let exp = now + 150 * 24 * 60 * 60;
    let claims = Claims { iss: cfg.team_id, iat: now, exp };

    let mut header = Header::new(Algorithm::ES256);
    header.kid = Some(cfg.key_id);

    let token = encode(&header, &claims, &encoding_key)
        .map_err(|e| format!("failed to sign token: {e}"))?;
    Ok(DevToken { token, exp, source: "local".into(), config: serde_json::Value::Null })
}

fn read_cached() -> Option<DevToken> {
    let raw = std::fs::read_to_string(dev_token_path()?).ok()?;
    let t: DevToken = serde_json::from_str(&raw).ok()?;
    if t.token.is_empty() || t.exp <= unix_now() {
        return None;
    }
    Some(t)
}

fn persist(t: &DevToken) {
    if let Some(path) = dev_token_path() {
        if let Ok(raw) = serde_json::to_string(t) {
            let _ = std::fs::write(path, raw);
        }
    }
}

/// One request to the mint. Errors name the HTTP status or the transport
/// failure; the caller decides whether a cached token can stand in.
async fn fetch_from_mint() -> Result<DevToken, String> {
    let client = reqwest::Client::builder()
        .timeout(MINT_TIMEOUT)
        .user_agent(format!("DeetsMusic/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.get(TOKEN_URL);
    if let Some(key) = build_key() {
        req = req.header(BUILD_HEADER, key);
    }
    let resp = req.send().await.map_err(|e| {
        if e.is_timeout() { "mint timed out".to_string() } else { format!("no network: {e}") }
    })?;
    let status = resp.status().as_u16();
    if status != 200 {
        return Err(match status {
            403 if build_key().is_none() => "mint refused: this build has no build key (403)".into(),
            403 => "mint refused this build (403)".into(),
            429 => "mint rate-limited (429)".into(),
            503 => "mint switched off (503)".into(),
            s => format!("mint answered {s}"),
        });
    }
    let body: MintResponse = resp.json().await.map_err(|e| format!("bad mint response: {e}"))?;
    Ok(DevToken { token: body.token, exp: body.exp, source: "worker".into(), config: body.config })
}

/// Make `t` the live token. Logs the source and the expiry date — never the token.
fn install(t: DevToken) {
    crate::log::info(&format!(
        "token: source={} expires={}",
        t.source,
        chrono::DateTime::from_timestamp(t.exp as i64, 0)
            .map(|d| d.format("%Y-%m-%d").to_string())
            .unwrap_or_default()
    ));
    *DEV_TOKEN.lock().unwrap() = Some(t);
    *DEV_TOKEN_ERROR.lock().unwrap() = None;
}

/// Resolve the developer token once, before the webview asks for it. Runs in
/// `setup()` after `set_app_data_dir`. An `Err` means there is NO token at all;
/// startup still continues (Apple calls fail with that message until a restart).
pub fn ensure_developer_token() -> Result<(), String> {
    // 0. Test seam (debug builds only): `DEETS_DEV_NO_TOKEN=1 npm run dev:app` behaves as if
    //    every source failed, to exercise the launch-time "no token" toast (DEBUGGING.md §Toasts).
    if cfg!(debug_assertions) && std::env::var_os("DEETS_DEV_NO_TOKEN").is_some() {
        let msg = "no developer token: forced by DEETS_DEV_NO_TOKEN".to_string();
        crate::log::warn(&format!("token: {msg}"));
        *DEV_TOKEN_ERROR.lock().unwrap() = Some(msg.clone());
        return Err(msg);
    }

    // 1. The dev seam.
    if local_key_present() {
        return match sign_local() {
            Ok(t) => {
                install(t);
                Ok(())
            }
            Err(e) => {
                *DEV_TOKEN_ERROR.lock().unwrap() = Some(e.clone());
                Err(e)
            }
        };
    }

    // 2. The cache, when comfortably inside its lifetime.
    let cached = read_cached();
    if let Some(t) = &cached {
        if t.exp.saturating_sub(unix_now()) > REFRESH_MARGIN_SECS {
            install(t.clone());
            return Ok(());
        }
    }

    // 3. The mint. `reqwest` is async-only; setup() is sync and off the runtime.
    match tauri::async_runtime::block_on(fetch_from_mint()) {
        Ok(t) => {
            persist(&t);
            install(t);
            Ok(())
        }
        Err(e) => match cached {
            // Still valid, just inside the margin: keep it, retry next launch.
            Some(t) => {
                crate::log::warn(&format!("token: refresh failed ({e}); using cached token"));
                install(t);
                Ok(())
            }
            None => {
                let msg = format!("no developer token: no local MusicKit key and {e}");
                crate::log::warn(&format!("token: {msg}"));
                *DEV_TOKEN_ERROR.lock().unwrap() = Some(msg.clone());
                Err(msg)
            }
        },
    }
}

/// The Apple Music developer token. A sync cache read; resolved at startup by
/// `ensure_developer_token()`. Signature unchanged from the local-signing days,
/// so every caller stays as it was.
pub fn developer_token() -> Result<String, String> {
    if let Some(t) = DEV_TOKEN.lock().unwrap().as_ref() {
        return Ok(t.token.clone());
    }
    Err(DEV_TOKEN_ERROR
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_else(|| "no developer token: startup resolution has not run".into()))
}

/// Remote config that rode the token response (`{}` when signing locally).
pub fn remote_config() -> serde_json::Value {
    match DEV_TOKEN.lock().unwrap().as_ref() {
        Some(t) if t.config.is_object() => t.config.clone(),
        _ => serde_json::json!({}),
    }
}

/// A 401 from Apple with a worker-minted token means the key was rotated (or the
/// token revoked). `failed` is the token Apple rejected. Returns the token to retry
/// with, or `None` when there is nothing better to try:
/// - the live token already differs from `failed` → return it (no fetch);
/// - a fetch ran within `REFETCH_COOLDOWN` → `None`;
/// - the mint hands back the same token (its shared token is the rejected one) → `None`.
/// On a real swap: persist, install, and tell the webview so MusicKit re-configures.
/// Local-key installs skip this: a re-sign from the same key changes nothing.
async fn refetch_after_401(failed: &str) -> Option<String> {
    let (minted, current) = match DEV_TOKEN.lock().unwrap().as_ref() {
        Some(t) => (t.source == "worker", t.token.clone()),
        None => (false, String::new()),
    };
    if !minted {
        return None;
    }
    if current != failed {
        return Some(current);
    }
    {
        let mut last = LAST_REFETCH.lock().unwrap();
        if last.is_some_and(|at| at.elapsed() < REFETCH_COOLDOWN) {
            return None;
        }
        *last = Some(Instant::now());
    }
    crate::log::warn("token: 401 from Apple; refetching (at most once per 10 min)");
    match fetch_from_mint().await {
        Ok(t) if t.token == failed => {
            crate::log::warn("token: the mint still serves the rejected token");
            None
        }
        Ok(t) => {
            let tok = t.token.clone();
            persist(&t);
            install(t);
            if let Some(app) = APP_HANDLE.get() {
                let _ = app.emit("developer-token-changed", ());
            }
            Some(tok)
        }
        Err(e) => {
            crate::log::error(&format!("token: refetch after 401 failed: {e}"));
            None
        }
    }
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
        crate::log::register_secret(&tok);
        return Some(tok);
    }
    let legacy = read(repo_secrets_dir()?.join("user-token.txt"))?;
    crate::log::register_secret(&legacy);
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
<script>
// Never reuse a sign-in: MusicKit keeps the user token in THIS page's storage
// ("media-user-token"), and the page's address is fixed (47831–47833), so a token from an
// earlier sign-in survives and authorize() returns it without asking Apple — even after
// Apple has logged it out (2026-09-13). This page stores nothing of its own, so clear all
// of it before MusicKit loads.
try{localStorage.clear();sessionStorage.clear();}catch(e){}
</script>
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
// The tab closed (or left) before the app took a token: tell the app now, so the
// Account row does not wait five minutes for the timeout. A beacon survives unload.
let settled=false;
addEventListener("pagehide",()=>{
  if(settled) return;
  try{ navigator.sendBeacon("/callback-error", new Blob([JSON.stringify({state:NONCE,error:"page closed"})],{type:"application/json"})); }catch(e){}
});
async function ready(){
  if(!window.MusicKit){ await new Promise(r=>document.addEventListener("musickitloaded",r,{once:true})); }
  await MusicKit.configure({developerToken:DEV_TOKEN, app:{name:"DeetsMusic",build:"__VERSION__"}});
  return MusicKit.getInstance();
}
document.getElementById("go").onclick=async()=>{
  try{
    status.textContent="Opening Apple sign-in…";
    const music=await ready();
    const mut=await music.authorize();
    status.textContent="Authorized — returning to DeetsMusic…";
    // An old tab (a sign-in that already ended) holds a stale nonce: the app answers 400
    // or nothing at all. Never say "Done" unless the app actually took the token.
    const r=await fetch("/callback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({state:NONCE,mut})});
    if(!r.ok) throw new Error("stale sign-in page");
    settled=true;
    status.textContent="Done! You can close this tab and return to DeetsMusic.";
    status.className="done";
  }catch(e){
    // Plain words here; the raw reason goes back to the app, which says what happened.
    settled=true;
    status.textContent="Sign-in didn't finish. Close this tab and try again from DeetsMusic.";
    const reason=String((e&&(e.errorCode||e.message))||e);
    fetch("/callback-error",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({state:NONCE,error:reason})}).catch(()=>{});
  }
};
</script>
</body></html>"#;

const DONE_RESPONSE: &str = "ok";

/// One-shot loopback server: serves the themed page + assets, captures the MUT.
fn serve(
    server: tiny_http::Server,
    page: String,
    nonce: String,
    store: Arc<Mutex<Option<String>>>,
    auth: Arc<Mutex<AuthStatus>>,
    abort: Arc<std::sync::atomic::AtomicBool>,
) {
    let deadline = Instant::now() + Duration::from_secs(300);
    loop {
        // Stopped from the app (a cancel, or a newer sign-in): leave quietly — whoever
        // raised the flag has already set the status. One-second ticks keep it prompt.
        if abort.load(std::sync::atomic::Ordering::Relaxed) {
            break;
        }
        let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
            crate::log::warn("sign-in: no callback within 5 min; browser sign-in abandoned");
            *auth.lock().unwrap() = AuthStatus::Failed { reason: "timeout".into() };
            break;
        };
        match server.recv_timeout(remaining.min(Duration::from_secs(1))) {
            Ok(Some(mut req)) => {
                let path = req.url().split('?').next().unwrap_or("/").to_string();
                let is_post = *req.method() == tiny_http::Method::Post;

                if is_post && path == "/callback-error" {
                    // The page's own failure (Apple said Unauthorized, the user closed
                    // Apple's window, …). Record it for `connect()` and free the port.
                    let mut body = String::new();
                    let _ = std::io::Read::read_to_string(&mut std::io::Read::take(req.as_reader(), 4096), &mut body);
                    let reason = serde_json::from_str::<serde_json::Value>(&body).ok().and_then(|v| {
                        (v.get("state")?.as_str()? == nonce).then(|| {
                            v.get("error").and_then(|e| e.as_str()).unwrap_or("unknown").chars().take(120).collect::<String>()
                        })
                    });
                    if let Some(reason) = reason {
                        crate::log::warn(&format!("sign-in: the page reported a failure: {reason}"));
                        *auth.lock().unwrap() = AuthStatus::Failed { reason };
                        let _ = req.respond(tiny_http::Response::from_string(DONE_RESPONSE));
                        break;
                    }
                    let _ = req.respond(tiny_http::Response::from_string("bad request").with_status_code(400));
                } else if is_post && path == "/callback" {
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
                        if accept_token(&tok, &store, &auth) {
                            let _ = req.respond(tiny_http::Response::from_string(DONE_RESPONSE));
                        } else {
                            let _ = req.respond(tiny_http::Response::from_string("rejected").with_status_code(400));
                        }
                        break; // captured or refused — shut down
                    }
                    crate::log::warn("sign-in: callback rejected (nonce mismatch or empty token)");
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

/// The delivered token, from either page (loopback callback or deep link). Checks it
/// with Apple, then stores, persists and announces it. False when Apple refuses it.
fn accept_token(tok: &str, store: &Arc<Mutex<Option<String>>>, auth: &Arc<Mutex<AuthStatus>>) -> bool {
    crate::log::register_secret(tok);
    // Never save a token Apple already refuses (a stale page, a token logged out at
    // Apple). 403 on /v1/me = the sign-in token itself; a 401 or no answer is about
    // the developer token or the network and does not block the sign-in.
    if capture_rejected_by_apple(tok) {
        crate::log::warn("sign-in: Apple refused the delivered token (403); not saved");
        *auth.lock().unwrap() = AuthStatus::Failed { reason: "forbidden: Apple refused the new sign-in".into() };
        return false;
    }
    *store.lock().unwrap() = Some(tok.to_string());
    *auth.lock().unwrap() = AuthStatus::Captured;
    // A new sign-in: forget the cached health answer (it may still say "expired") and
    // hand the token to MusicKit in the running page — MusicKit otherwise only reads it
    // when the player first starts (found 2026-09-13: signed in, MusicKit still unauthorized).
    *LAST_CHECK.lock().unwrap() = None;
    if let Some(app) = APP_HANDLE.get() {
        let _ = app.emit("user-token-changed", ());
    }
    if let Err(e) = persist_user_token(tok) {
        crate::log::warn(&format!("sign-in: token captured but not persisted: {e}"));
    }
    crate::log::info("sign-in: user token captured");
    true
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

/// Remote config from the mint (support.md): flags, numbers, a notice, a
/// minimum version. A config channel, never a code channel.
#[tauri::command]
pub fn apple_remote_config() -> serde_json::Value {
    remote_config()
}

/// Start the browser sign-in: the hosted page (§2a) when its Worker answers, else the
/// loopback page; `local` asks for the loopback page outright (the fallback link in the
/// Account row). `theme`/`skin` mirror the app's active selection so the page matches.
///
/// Checks the developer token first (one catalog call, with the same bounded heal as
/// every Rust call): a page configured with a dead token can only say "Unauthorized".
/// Errors the front end maps to plain words: `apple-unavailable`, `offline`.
#[tauri::command]
pub async fn apple_begin_auth(
    app: tauri::AppHandle,
    theme: String,
    skin: String,
    local: Option<bool>,
    state: tauri::State<'_, AppleState>,
) -> Result<(), String> {
    let client = check_client()?;
    match app_status(&client).await.0 {
        "ok" => {}
        "unreachable" => return Err("offline".into()),
        _ => return Err("apple-unavailable".into()),
    }
    let theme = sanitize_ident(&theme);
    let skin = sanitize_ident(&skin);

    if !local.unwrap_or(false) && hosted_reachable(&client).await {
        return begin_hosted(&app, &state, &theme, &skin);
    }
    // The local page: a hosted sign-in still waiting for its link is dropped (a late
    // link cannot land on top of this one) and an older loopback server is stopped.
    let abort = arm_abort(&state);
    let dev = developer_token()?;
    let nonce = random_nonce();

    let server = AUTH_PORTS
        .iter()
        .find_map(|p| tiny_http::Server::http(("127.0.0.1", *p)).ok())
        .ok_or("sign-in ports 47831–47833 are all in use; close the other app and try again")?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|addr| addr.port())
        .ok_or("could not determine loopback port")?;

    let page = AUTH_PAGE
        .replace("__DEV_TOKEN__", &dev)
        .replace("__NONCE__", &nonce)
        .replace("__VERSION__", env!("CARGO_PKG_VERSION"))
        .replace("__THEME__", if theme.is_empty() { "lilac" } else { &theme })
        .replace("__SKIN__", if skin.is_empty() { "press" } else { &skin });

    let store = state.user_token.clone();
    let auth = state.auth.clone();
    *auth.lock().unwrap() = AuthStatus::Pending;
    std::thread::spawn(move || serve(server, page, nonce, store, auth, abort));

    let url = format!("http://127.0.0.1:{port}/");
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| format!("could not open browser: {e}"))?;
    crate::log::info(&format!("sign-in: local page opened in the browser: {url}"));
    Ok(())
}

/// The browser sign-in's progress, polled by `connect()`.
#[tauri::command]
pub fn apple_auth_status(state: tauri::State<'_, AppleState>) -> AuthStatus {
    state.auth.lock().unwrap().clone()
}

// ── Health check: which token is Apple rejecting? ─────────────────────────────
//
// Called only after something failed (a play, MusicKit's own error, a sign-in) and by
// the front end's slow recheck while a problem lasts — never on a timer while healthy.
// Failures arrive without bound, so the check is bounded here: a cached answer for
// CHECK_TTL, forced checks at most every CHECK_FRESH_MIN, and the heal inside is
// `refetch_after_401`'s own cooldown. Two cheap GETs at most.

const STOREFRONT_URL: &str = "https://api.music.apple.com/v1/storefronts/us";
const ME_STOREFRONT_URL: &str = "https://api.music.apple.com/v1/me/storefront";
const CHECK_TIMEOUT: Duration = Duration::from_secs(8);
const CHECK_TTL: Duration = Duration::from_secs(60);
const CHECK_FRESH_MIN: Duration = Duration::from_secs(10);

#[derive(Clone, Serialize)]
pub struct AppleHealth {
    /// The developer token: "ok" | "rejected" (Apple refuses it, even after a heal) |
    /// "unreachable" (no answer) | "missing" (none resolved at startup).
    app: &'static str,
    /// The Music User Token: "ok" | "expired" | "none" (signed out) | "unknown".
    signin: &'static str,
    /// This call swapped in a new developer token (MusicKit must re-configure).
    healed: bool,
}

static LAST_CHECK: Mutex<Option<(Instant, AppleHealth)>> = Mutex::new(None);

fn check_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(CHECK_TIMEOUT).build().map_err(|e| e.to_string())
}

async fn status_only(client: &reqwest::Client, dev: &str, mut_tok: Option<&str>, url: &str) -> Result<u16, String> {
    let mut req = client.get(url).header("Authorization", format!("Bearer {dev}")).header("Origin", APPLE_ORIGIN);
    if let Some(m) = mut_tok {
        req = req.header("Music-User-Token", m);
    }
    let status = req.send().await.map_err(|e| e.to_string())?.status().as_u16();
    log_failure(status, url);
    Ok(status)
}

/// The developer token's state after at most one (bounded) heal, and whether it healed.
async fn app_status(client: &reqwest::Client) -> (&'static str, bool) {
    let Ok(dev) = developer_token() else { return ("missing", false) };
    match status_only(client, &dev, None, STOREFRONT_URL).await {
        Ok(200) => ("ok", false),
        Err(_) => ("unreachable", false),
        Ok(401) => match refetch_after_401(&dev).await {
            Some(fresh) if fresh != dev => match status_only(client, &fresh, None, STOREFRONT_URL).await {
                Ok(200) => ("ok", true),
                Err(_) => ("unreachable", true),
                Ok(_) => ("rejected", true),
            },
            _ => ("rejected", false),
        },
        Ok(_) => ("rejected", false),
    }
}

#[tauri::command]
pub async fn apple_check(fresh: Option<bool>, state: tauri::State<'_, AppleState>) -> Result<AppleHealth, String> {
    {
        let last = LAST_CHECK.lock().unwrap();
        if let Some((at, h)) = last.as_ref() {
            let ttl = if fresh.unwrap_or(false) { CHECK_FRESH_MIN } else { CHECK_TTL };
            if at.elapsed() < ttl {
                return Ok(AppleHealth { healed: false, ..h.clone() });
            }
        }
    }
    let mut_tok = state.user_token.lock().unwrap().clone();
    let client = check_client()?;
    let (app, healed) = app_status(&client).await;
    let signin = match (mut_tok.as_deref(), app) {
        (None, _) => "none",
        (Some(_), a) if a != "ok" => "unknown",
        (Some(m), _) => {
            let dev = developer_token().unwrap_or_default();
            match status_only(&client, &dev, Some(m), ME_STOREFRONT_URL).await {
                Ok(200) => "ok",
                Ok(401) | Ok(403) => "expired",
                _ => "unknown",
            }
        }
    };
    crate::log::info(&format!("apple check: app={app} signin={signin} healed={healed}"));
    let h = AppleHealth { app, signin, healed };
    *LAST_CHECK.lock().unwrap() = Some((Instant::now(), h.clone()));
    Ok(h)
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
    if let Some(dir) = repo_secrets_dir() {
        let _ = std::fs::remove_file(dir.join("user-token.txt"));
    }
}

// ── Phase 2: raw data dump (for designing the model) ─────────────────────────

/// The repo's `dev-dumps/` in a debug build; the app data dir in a release build, which
/// carries no path into the source tree (RELEASE.md §1a).
#[cfg(debug_assertions)]
fn dump_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("dev-dumps"))
        .unwrap_or_else(|| PathBuf::from("dev-dumps"))
}
#[cfg(not(debug_assertions))]
fn dump_dir() -> PathBuf {
    APP_DATA_DIR.get().map(|d| d.join("dev-dumps")).unwrap_or_else(|| PathBuf::from("dev-dumps"))
}

fn write_dump(name: &str, value: &serde_json::Value) -> Result<(), String> {
    let dir = dump_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let pretty = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(name), pretty).map_err(|e| e.to_string())
}

/// GET an Apple Music API URL, returning (http_status, parsed_body).
///
/// A 401 here is the DEVELOPER token (a bad user token is a 403): refetch once per
/// process and retry, so a rotated key heals the install (RELEASE.md §7).
pub(crate) async fn api_get(
    client: &reqwest::Client,
    dev: &str,
    mut_tok: &str,
    url: &str,
) -> Result<(u16, serde_json::Value), String> {
    let r = api_get_once(client, dev, mut_tok, url).await?;
    if r.0 != 401 {
        return Ok(r);
    }
    match refetch_after_401(dev).await {
        Some(fresh) => api_get_once(client, &fresh, mut_tok, url).await,
        None => Ok(r),
    }
}

async fn api_get_once(
    client: &reqwest::Client,
    dev: &str,
    mut_tok: &str,
    url: &str,
) -> Result<(u16, serde_json::Value), String> {
    let resp = client
        .get(url)
        .header("Authorization", format!("Bearer {dev}"))
        .header("Origin", APPLE_ORIGIN)
        .header("Music-User-Token", mut_tok)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    log_failure(status, url);
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let body = serde_json::from_str::<serde_json::Value>(&text)
        .unwrap_or_else(|_| serde_json::json!({ "_nonjson": text }));
    Ok((status, body))
}

/// Apple failures only, status + path (LOGGING.md): the host is always the same
/// and the query holds nothing but ids and limits.
///
/// A 403 on a `/v1/me` path means Apple refuses the user's sign-in token. Tell the front
/// end (`apple-signin-rejected`), so the launch-time library sync says "signed you out"
/// instead of failing quietly. At most once per SIGNIN_REJECTED_GAP: every `/me` call can
/// fail the same way, and the front end's check is cached anyway.
fn log_failure(status: u16, url: &str) {
    if status < 400 {
        return;
    }
    let path = url.split_once("api.music.apple.com").map(|(_, p)| p).unwrap_or(url);
    crate::log::warn(&format!("apple: {status} {path}"));
    if status == 403 && path.starts_with("/v1/me") {
        let mut last = SIGNIN_REJECTED_AT.lock().unwrap();
        if !last.is_some_and(|at| at.elapsed() < SIGNIN_REJECTED_GAP) {
            *last = Some(Instant::now());
            if let Some(app) = APP_HANDLE.get() {
                let _ = app.emit("apple-signin-rejected", ());
            }
        }
    }
}

static SIGNIN_REJECTED_AT: Mutex<Option<Instant>> = Mutex::new(None);
const SIGNIN_REJECTED_GAP: Duration = Duration::from_secs(60);

/// Fix 2 (2026-09-13): does Apple refuse a token the sign-in page just delivered?
/// True only on a 403 from `/v1/me/storefront`, seen twice a second apart (Apple's answers
/// were unreliable for a while after a key revoke). Runs on the loopback server thread.
fn capture_rejected_by_apple(mut_tok: &str) -> bool {
    let Ok(dev) = developer_token() else { return false };
    let Ok(client) = check_client() else { return false };
    tauri::async_runtime::block_on(async {
        for attempt in 0..2 {
            if attempt > 0 {
                tokio_sleep_1s().await;
            }
            match status_only(&client, &dev, Some(mut_tok), ME_STOREFRONT_URL).await {
                Ok(403) => continue,
                _ => return false,
            }
        }
        true
    })
}

async fn tokio_sleep_1s() {
    let (tx, rx) = futures::channel::oneshot::channel::<()>();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(1));
        let _ = tx.send(());
    });
    let _ = rx.await;
}

/// POST an Apple Music API URL with no body, returning (http_status, parsed_body).
/// Same auth headers as `api_get`; used for library writes (add-to-library).
pub(crate) async fn api_post(
    client: &reqwest::Client,
    dev: &str,
    mut_tok: &str,
    url: &str,
) -> Result<(u16, serde_json::Value), String> {
    let r = api_post_once(client, dev, mut_tok, url).await?;
    if r.0 != 401 {
        return Ok(r);
    }
    match refetch_after_401(dev).await {
        Some(fresh) => api_post_once(client, &fresh, mut_tok, url).await,
        None => Ok(r),
    }
}

async fn api_post_once(
    client: &reqwest::Client,
    dev: &str,
    mut_tok: &str,
    url: &str,
) -> Result<(u16, serde_json::Value), String> {
    let resp = client
        .post(url)
        .header("Authorization", format!("Bearer {dev}"))
        .header("Origin", APPLE_ORIGIN)
        .header("Music-User-Token", mut_tok)
        .header("Content-Length", "0")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    log_failure(status, url);
    let text = resp.text().await.unwrap_or_default();
    let body = serde_json::from_str::<serde_json::Value>(&text)
        .unwrap_or_else(|_| serde_json::json!({ "_nonjson": text }));
    Ok((status, body))
}

/// PUT (with a JSON body) or DELETE an Apple Music API URL, returning
/// (http_status, parsed_body). Same auth + 401 heal as `api_get`; used by the ♥
/// ratings writes (favorites.rs). `body: None` sends no body (DELETE).
pub(crate) async fn api_send(
    client: &reqwest::Client,
    method: reqwest::Method,
    dev: &str,
    mut_tok: &str,
    url: &str,
    body: Option<&serde_json::Value>,
) -> Result<(u16, serde_json::Value), String> {
    let r = api_send_once(client, method.clone(), dev, mut_tok, url, body).await?;
    if r.0 != 401 {
        return Ok(r);
    }
    match refetch_after_401(dev).await {
        Some(fresh) => api_send_once(client, method, &fresh, mut_tok, url, body).await,
        None => Ok(r),
    }
}

async fn api_send_once(
    client: &reqwest::Client,
    method: reqwest::Method,
    dev: &str,
    mut_tok: &str,
    url: &str,
    body: Option<&serde_json::Value>,
) -> Result<(u16, serde_json::Value), String> {
    let mut req = client
        .request(method, url)
        .header("Authorization", format!("Bearer {dev}"))
        .header("Origin", APPLE_ORIGIN)
        .header("Music-User-Token", mut_tok);
    req = match body {
        Some(b) => req.json(b),
        None => req.header("Content-Length", "0"),
    };
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    log_failure(status, url);
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

    let client = http_client();
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
            client: http_client(),
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
        // Library payloads usually omit composerName; the catalog read fills it in (CREDITS.md §3).
        composer: a["composerName"].as_str().map(String::from),
        release_date: a["releaseDate"].as_str().map(String::from),
        preview_url: None, // catalog-only; library payloads never carry previews
        added_rank: None,  // set during sync from the dateAdded-sorted page position
        unreleased: false, // a library song is one Apple already plays
        play_params: PlayParams {
            id: pp["id"].as_str().map(String::from),
            catalog_id: pp["catalogId"].as_str().map(String::from),
            kind: pp["kind"].as_str().map(String::from),
            is_library: pp["isLibrary"].as_bool().unwrap_or(false),
        },
    }
}

// ── Catalog normalizers (search results — the rich shapes) ───────────────────

pub(crate) fn track_from_catalog_song(v: &serde_json::Value) -> Track {
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
        composer: a["composerName"].as_str().map(String::from),
        preview_url: a["previews"][0]["url"].as_str().map(String::from),
        release_date: a["releaseDate"].as_str().map(String::from),
        added_rank: None,
        // No playParams = Apple will not play it yet (model.rs `Track::unreleased`).
        unreleased: pp.is_null(),
        play_params: PlayParams {
            id: pp["id"].as_str().map(String::from).or(id),
            catalog_id: pp["id"].as_str().map(String::from),
            kind: pp["kind"].as_str().map(String::from),
            is_library: false,
        },
    }
}

pub(crate) fn album_from_catalog(v: &serde_json::Value) -> Album {
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

pub(crate) fn artist_from_catalog(v: &serde_json::Value) -> Artist {
    let a = &v["attributes"];
    Artist {
        library_id: None,
        catalog_id: v["id"].as_str().map(String::from),
        name: a["name"].as_str().unwrap_or_default().to_string(),
        artwork: artwork_from(&a["artwork"]),
        genres: a["genreNames"]
            .as_array()
            .map(|arr| arr.iter().filter_map(|g| g.as_str().map(String::from)).collect())
            .unwrap_or_default(),
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
        cover_urls: None,
        exported_apple_id: None, // export stamps are local playlists only
        exported_at: None,
        role: None,
        expire_days: None, // temporary web playlists are local only
        expires_at: None,
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
pub(crate) fn playlist_from_library(v: &serde_json::Value) -> Playlist {
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
        cover_urls: None,
        exported_apple_id: None, // export stamps are local playlists only
        exported_at: None,
        role: None,
        expire_days: None, // temporary web playlists are local only
        expires_at: None,
    }
}

impl MusicProvider for AppleProvider {
    async fn songs_page(&self, offset: u32, limit: u32, newest_first: bool) -> Result<Page<Track>, String> {
        // Sort by dateAdded so each row's global position is its "added rank"
        // (songs carry no per-song dateAdded; this is how we order by it). The UI
        // re-sorts client-side, so this fetch order doesn't affect other views.
        // Newest-first (the incremental sync) maps the position back onto the same
        // ascending rank via the total, so a song added today still sorts newest.
        let sort = if newest_first { "-dateAdded" } else { "dateAdded" };
        let url = format!(
            "https://api.music.apple.com/v1/me/library/songs?limit={limit}&offset={offset}&sort={sort}"
        );
        let (status, body) = api_get(&self.client, &self.dev, &self.user, &url).await?;
        if status != 200 {
            return Err(format!("library/songs HTTP {status}"));
        }
        let total = body["meta"]["total"].as_u64().unwrap_or(0) as u32;
        let items: Vec<Track> = body["data"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .enumerate()
                    .map(|(i, v)| {
                        let mut t = track_from_library_song(v);
                        let pos = offset + i as u32;
                        t.added_rank = Some(if newest_first { total.saturating_sub(pos + 1) } else { pos });
                        t
                    })
                    .collect()
            })
            .unwrap_or_default();
        let total = if total == 0 { items.len() as u32 } else { total };
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
        // Only the five shippable categories; music-videos are never requested
        // (SEARCH.md). Stations normalize through the Radio card's `Station`.
        const ALLOWED: [&str; 5] = ["songs", "albums", "artists", "playlists", "stations"];
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
            stations: bucket("stations").iter().map(station_from_catalog).collect(),
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
    let client = http_client();
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

    // A pre-release album: Apple dates no unreleased song, so each one carries the album's
    // date, the only date Apple gives (SEARCH.md §Unreleased songs).
    let album_date = (kind == "albums")
        .then(|| body["data"][0]["attributes"]["releaseDate"].as_str().map(String::from))
        .flatten();
    let tracks: Vec<Track> = items
        .iter()
        .filter(|v| v["type"].as_str() == Some("songs")) // skip music-videos
        .map(|v| {
            let mut t = track_from_catalog_song(v);
            if t.unreleased && t.release_date.is_none() {
                t.release_date = album_date.clone();
            }
            t
        })
        .collect();
    {
        // An unreleased song is not cached: the cache row would keep the flag past release day.
        let out: Vec<Track> = tracks.iter().filter(|t| !t.unreleased).cloned().collect();
        let conn = db.lock();
        crate::enrich::cache_tracks(&conn, &out)?;
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
    let client = http_client();
    // `ids[songs]=a,b` — reqwest percent-encodes the brackets, which Apple accepts.
    let url = format!(
        "https://api.music.apple.com/v1/me/library?ids[{kind}]={}",
        ids.join(",")
    );
    let (status, body) = api_post(&client, &dev, &user, &url).await?;
    if !(200..300).contains(&status) {
        return Err(format!("add-to-library HTTP {status}: {body}"));
    }
    // A pre-release album's unreleased songs are not in the library until Apple releases
    // them; the next library_sync brings each one in on its day.
    let tracks: Vec<Track> = tracks.into_iter().filter(|t| !t.unreleased).collect();
    let conn = db.lock();
    crate::library::graduate_tracks(&conn, &tracks)?;
    Ok(())
}

/// A catalog artist's detail: albums + top songs + featured playlists, one fetch (`views=`).
/// A refused request (not 200, not 404) retries once with the two original views, so a
/// view Apple doesn't know can't break the Search artist view (ARTIST-VIEW.md §4).
#[tauri::command]
pub async fn catalog_artist(
    id: String,
    state: tauri::State<'_, AppleState>,
    db: tauri::State<'_, crate::library::Db>,
) -> Result<ArtistDetail, String> {
    let dev = developer_token()?;
    let user = state.user_token.lock().unwrap().clone().ok_or("not connected to Apple Music")?;
    let client = http_client();
    let sf = crate::enrich::storefront(&client, &dev, &user, &db).await?;

    let base = format!("https://api.music.apple.com/v1/catalog/{sf}/artists/{id}?views=top-songs,full-albums");
    let (mut status, mut body) = api_get(&client, &dev, &user, &format!("{base},featured-playlists")).await?;
    if status != 200 && status != 404 {
        crate::log::warn(&format!("catalog_artist: featured-playlists view refused (HTTP {status}), retrying without it"));
        (status, body) = api_get(&client, &dev, &user, &base).await?;
    }
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
    let featured_playlists: Vec<Playlist> = views["featured-playlists"]["data"]
        .as_array()
        .map(|arr| arr.iter().map(playlist_from_catalog).collect())
        .unwrap_or_default();
    {
        let conn = db.lock();
        crate::enrich::cache_tracks(&conn, &top_songs)?;
    }
    Ok(ArtistDetail {
        artist: artist_from_catalog(a),
        albums,
        top_songs,
        featured_playlists,
    })
}

/// Featured playlists older than this are fetched again on the next open (ARTIST-VIEW.md §2.4).
const FEATURED_TTL_MS: i64 = 7 * 24 * 60 * 60 * 1000;

fn epoch_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Every artist photo already in `artist_catalog`: `[name, artwork]` pairs. Read-only and
/// network-free — the Home card's artist tiles use it, and Home never calls Apple
/// (HOME.md §2). An artist not opened in the Library artist view yet has no row here, and
/// the tile falls back to one of that artist's album covers.
#[tauri::command]
pub fn artist_photos(db: tauri::State<'_, crate::library::Db>) -> Result<Vec<(String, Artwork)>, String> {
    let conn = db.lock();
    let mut stmt = conn
        .prepare_cached("SELECT name, artwork FROM artist_catalog WHERE artwork IS NOT NULL")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let (name, json) = row.map_err(|e| e.to_string())?;
        if let Ok(a) = serde_json::from_str::<Artwork>(&json) {
            out.push((name, a));
        }
    }
    Ok(out)
}

/// The Library artist view's catalog facts for a library artist NAME (ARTIST-VIEW.md §4).
/// Cache-first from `artist_catalog`:
///  - no row → `songs/{song_id}?include=artists` gives the id and the photo (1 call);
///  - `featured` and the saved list is missing or older than 7 days (or expired by the
///    Library ⟳) → `artists/{id}?views=featured-playlists` (1 call), which also refreshes
///    the photo link.
/// `featured: false` (Start Station) needs only the id. None when Apple has no match.
#[tauri::command]
pub async fn library_artist_info(
    name: String,
    song_id: Option<String>,
    featured: bool,
    state: tauri::State<'_, AppleState>,
    db: tauri::State<'_, crate::library::Db>,
) -> Result<Option<crate::model::LibraryArtistInfo>, String> {
    type Row = (String, Option<String>, Option<String>, i64, Option<String>);
    let row: Option<Row> = {
        let conn = db.lock();
        conn.query_row(
            "SELECT catalog_id, artwork, featured, featured_at, top_songs FROM artist_catalog WHERE name = ?1",
            [name.as_str()],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .ok()
    };
    let parse_art = |s: Option<String>| s.and_then(|j| serde_json::from_str::<Artwork>(&j).ok());
    let parse_featured = |s: Option<String>| s.and_then(|j| serde_json::from_str::<Vec<Playlist>>(&j).ok());
    let parse_top = |s: Option<String>| s.and_then(|j| serde_json::from_str::<Vec<Track>>(&j).ok());

    // Resolved before with no Apple match: never ask again.
    if matches!(&row, Some((id, ..)) if id.is_empty()) {
        return Ok(None);
    }
    // A row saved before top_songs existed is not fresh: call 2 runs once to fill it.
    let fresh = |r: &Row| r.2.is_some() && r.4.is_some() && epoch_ms() - r.3 < FEATURED_TTL_MS;
    if let Some(r) = &row {
        if !featured || fresh(r) {
            return Ok(Some(crate::model::LibraryArtistInfo {
                catalog_id: Some(r.0.clone()),
                artwork: parse_art(r.1.clone()),
                featured_playlists: parse_featured(r.2.clone()),
                top_songs: parse_top(r.4.clone()),
            }));
        }
    }

    let dev = developer_token()?;
    let user = state.user_token.lock().unwrap().clone().ok_or("not connected to Apple Music")?;
    let client = http_client();
    let sf = crate::enrich::storefront(&client, &dev, &user, &db).await?;

    // Call 1 (first open only): a song → its primary artist's id + photo.
    let (catalog_id, mut artwork) = match &row {
        Some(r) => (r.0.clone(), parse_art(r.1.clone())),
        None => {
            let Some(song) = song_id.filter(|s| !s.is_empty()) else { return Ok(None) };
            let url = format!("https://api.music.apple.com/v1/catalog/{sf}/songs/{song}?include=artists");
            let (status, body) = api_get(&client, &dev, &user, &url).await?;
            if status != 200 && status != 404 {
                return Err(format!("songs/{song} include=artists HTTP {status}"));
            }
            let node = &body["data"][0]["relationships"]["artists"]["data"][0];
            let id = node["id"].as_str().unwrap_or_default().to_string();
            let art = artwork_from(&node["attributes"]["artwork"]);
            let conn = db.lock();
            conn.execute(
                "INSERT OR REPLACE INTO artist_catalog(name, catalog_id, artwork, featured, featured_at) VALUES(?1, ?2, ?3, NULL, 0)",
                rusqlite::params![name, id, art.as_ref().and_then(|a| serde_json::to_string(a).ok())],
            )
            .map_err(|e| e.to_string())?;
            if id.is_empty() {
                return Ok(None);
            }
            (id, art)
        }
    };
    if !featured {
        return Ok(Some(crate::model::LibraryArtistInfo {
            catalog_id: Some(catalog_id),
            artwork,
            featured_playlists: None,
            top_songs: None,
        }));
    }

    // Call 2: the featured playlists and the top songs, one fetch (and a current photo link).
    let url = format!("https://api.music.apple.com/v1/catalog/{sf}/artists/{catalog_id}?views=featured-playlists,top-songs");
    let (status, body) = api_get(&client, &dev, &user, &url).await?;
    if status != 200 {
        // Keep what is saved; the next open tries again.
        crate::log::warn(&format!("library_artist_info: artists/{catalog_id} featured-playlists HTTP {status}"));
        let (featured_playlists, top_songs) = row.map(|r| (parse_featured(r.2), parse_top(r.4))).unwrap_or((None, None));
        return Ok(Some(crate::model::LibraryArtistInfo { catalog_id: Some(catalog_id), artwork, featured_playlists, top_songs }));
    }
    let a = &body["data"][0];
    if let Some(art) = artwork_from(&a["attributes"]["artwork"]) {
        artwork = Some(art);
    }
    let list: Vec<Playlist> = a["views"]["featured-playlists"]["data"]
        .as_array()
        .map(|arr| arr.iter().map(playlist_from_catalog).collect())
        .unwrap_or_default();
    let top: Vec<Track> = a["views"]["top-songs"]["data"]
        .as_array()
        .map(|arr| arr.iter().filter(|v| v["type"].as_str() == Some("songs")).map(track_from_catalog_song).collect())
        .unwrap_or_default();
    {
        let conn = db.lock();
        conn.execute(
            "UPDATE artist_catalog SET artwork = ?2, featured = ?3, featured_at = ?4, top_songs = ?5 WHERE name = ?1",
            rusqlite::params![
                name,
                artwork.as_ref().and_then(|a| serde_json::to_string(a).ok()),
                serde_json::to_string(&list).map_err(|e| e.to_string())?,
                epoch_ms(),
                serde_json::to_string(&top).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(Some(crate::model::LibraryArtistInfo {
        catalog_id: Some(catalog_id),
        artwork,
        featured_playlists: Some(list),
        top_songs: Some(top),
    }))
}

/// The Library ⟳: every saved featured-playlist list counts as old, so the next open of
/// each artist fetches it again. Ids and photo links stay. Zero Apple calls.
#[tauri::command]
pub fn library_artists_expire(db: tauri::State<'_, crate::library::Db>) -> Result<(), String> {
    let conn = db.lock();
    conn.execute("UPDATE artist_catalog SET featured_at = 0", []).map_err(|e| e.to_string())?;
    Ok(())
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
        let conn = db.lock();
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
    let client = http_client();
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
    let client = http_client();
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
    let client = http_client();
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
    let client = http_client();
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
    let client = http_client();
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
    let client = http_client();
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
    let client = http_client();
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
    let client = http_client();
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

// ── Home's Apple reads (HOME.md §9) ───────────────────────────────────────────
// Two calls, one per shelf, both on `/v1/me`. They exist for CONTINUITY: a play or an
// add made on another device never reaches this machine otherwise. Neither one writes a
// play — we did not observe those plays, and invented rows would corrupt Rewind's
// minutes and Home's own bucket score. What they do write is catalog: a song we have
// never held becomes a `seen` row, and its `composerName` joins the writer collection
// at no extra call (CREDITS.md §3). Both fetch here, in Rust, for exactly that reason.

/// Rows per `recent/played/tracks` call. Apple's ceiling: `limit=100` is a 400.
const RECENT_PAGE: u32 = 30;
/// The deepest the "New" shelf reads — 90 songs (HOME.md §10.2).
const RECENT_PAGES_MAX: u32 = 3;

/// The songs this Apple Music account played last, newest first, across every device.
/// Apple sends **order, never time** — 30 catalog song rows with no timestamp — so the
/// front end dates them by bracketing against our own log (HOME.md §9.1).
///
/// Side effects, both local: the rows we do not hold are materialized as `seen` tracks,
/// and every row's writers are noted. A row we DO hold is left alone (`DO NOTHING`).
#[tauri::command]
pub async fn recent_played_tracks(
    pages: Option<u32>,
    state: tauri::State<'_, AppleState>,
    db: tauri::State<'_, crate::library::Db>,
) -> Result<Vec<Track>, String> {
    let dev = developer_token()?;
    let user = state.user_token.lock().unwrap().clone().ok_or("not connected to Apple Music")?;
    let client = http_client();
    // Apple caps `limit` at 30 — `limit=100` is a 400 — but `offset` pages, so depth is
    // bought a call at a time. Recently Played needs one page; the "New" shelf reads
    // three, for the artists you play elsewhere (HOME.md §10.2).
    let pages = pages.unwrap_or(1).clamp(1, RECENT_PAGES_MAX);
    let mut tracks: Vec<Track> = Vec::new();
    for page in 0..pages {
        let url = format!(
            "https://api.music.apple.com/v1/me/recent/played/tracks?limit={RECENT_PAGE}&offset={}",
            page * RECENT_PAGE
        );
        let (status, body) = api_get(&client, &dev, &user, &url).await?;
        if status != 200 {
            // A later page failing keeps the pages already in hand: the list is ordered,
            // so a short answer is a shallower list, not a wrong one.
            if page == 0 {
                return Err(format!("me/recent/played/tracks HTTP {status}"));
            }
            crate::log::warn(&format!("recent_played_tracks: page {page} HTTP {status}"));
            break;
        }
        let rows = body["data"].as_array().cloned().unwrap_or_default();
        let empty = rows.is_empty();
        tracks.extend(
            rows.iter()
                .filter(|v| v["type"].as_str() == Some("songs"))
                .map(track_from_catalog_song),
        );
        if empty {
            break;
        }
    }
    {
        let conn = db.lock();
        crate::credits::note_tracks(&conn, &tracks);
        crate::library::materialize_many(&conn, &tracks)?;
    }
    Ok(tracks)
}

/// What this Apple Music account added last, newest first, across every device.
/// Unlike the song list this one carries a REAL `dateAdded`, and Apple has already
/// grouped the songs into albums — the two things our own added shelf could never
/// know (HOME.md §3 called both open). Albums and playlists arrive on one date scale,
/// so the shelf can order them truthfully. It still prints no dates (his call).
///
/// One call, no side effects: an added album is already in the library sync's path.
#[tauri::command]
pub async fn recent_added(
    state: tauri::State<'_, AppleState>,
) -> Result<RecentAdded, String> {
    let dev = developer_token()?;
    let user = state.user_token.lock().unwrap().clone().ok_or("not connected to Apple Music")?;
    let client = http_client();
    let url = "https://api.music.apple.com/v1/me/library/recently-added?limit=25";
    let (status, body) = api_get(&client, &dev, &user, url).await?;
    if status != 200 {
        return Err(format!("me/library/recently-added HTTP {status}"));
    }
    let mut out = RecentAdded { albums: vec![], playlists: vec![] };
    for v in body["data"].as_array().into_iter().flatten() {
        match v["type"].as_str() {
            Some("library-albums") => out.albums.push(album_from_library(v)),
            Some("library-playlists") => out.playlists.push(playlist_from_library(v)),
            _ => {}
        }
    }
    Ok(out)
}

// ── the "New" shelf (HOME.md §10) ─────────────────────────────────────────────
// Releases by the artists you listen to. Two reads, both here in Rust so every song
// and album row feeds the writer collection for free (CREDITS.md §3).

/// The `meta` key holding Apple's own count of library artists, so the pass below can
/// tell in ONE call whether anything changed.
const META_ARTISTS_TOTAL: &str = "library_artists_total";
/// Library artists per page. Apple's ceiling for this endpoint.
const ARTIST_PAGE: u32 = 100;
/// Catalog artists per `ids=` read. The shape `web.rs` already uses.
const ARTIST_IDS_BATCH: usize = 25;

/// Fill `artist_catalog` in bulk from `me/library/artists?include=catalog`, which
/// carries the catalog id, the artist PHOTO and the genres for every library artist at
/// once — the three things §2 pays one call per artist for today (HOME.md §10.3).
///
/// Incremental by count. The endpoint **rejects `sort`** (a 400 on `sort=-dateAdded`),
/// so there is no newest-first page to stop early on. Instead one `limit=1` call reads
/// `meta.total`: unchanged against the stored count, the pass ends there at ONE call.
/// Changed, it re-pages everything. A full sync re-pages regardless, so a same-count
/// swap (one artist in, one out) heals within the six-hour window.
///
/// Never fatal: the library sync's own result does not depend on it.
pub(crate) async fn sync_artist_catalog(
    client: &reqwest::Client,
    dev: &str,
    user: &str,
    db: &crate::library::Db,
    force: bool,
) -> Result<u32, String> {
    let url = "https://api.music.apple.com/v1/me/library/artists?limit=1";
    let (status, body) = api_get(client, dev, user, url).await?;
    if status != 200 {
        return Err(format!("me/library/artists HTTP {status}"));
    }
    let total = body["meta"]["total"].as_u64().unwrap_or(0) as u32;
    let known: Option<u32> = {
        let conn = db.lock();
        crate::library::meta_get(&conn, META_ARTISTS_TOTAL).and_then(|v| v.parse().ok())
    };
    if !force && known == Some(total) {
        return Ok(0);
    }

    let mut written = 0u32;
    let mut offset = 0u32;
    while offset < total {
        let url = format!(
            "https://api.music.apple.com/v1/me/library/artists?limit={ARTIST_PAGE}&offset={offset}&include=catalog"
        );
        let (status, body) = api_get(client, dev, user, &url).await?;
        if status != 200 {
            return Err(format!("me/library/artists offset {offset} HTTP {status}"));
        }
        {
            let conn = db.lock();
            for v in body["data"].as_array().into_iter().flatten() {
                // The LIBRARY name is the key, because that is the name our tracks carry.
                // It can be longer than the catalog artist's ("adam&steve & Maty Noyes"
                // resolves to "adam&steve"): the row is still the right join, and the
                // photo is the primary artist's.
                let Some(name) = v["attributes"]["name"].as_str().filter(|n| !n.is_empty()) else { continue };
                let cat = &v["relationships"]["catalog"]["data"][0];
                let Some(id) = cat["id"].as_str() else { continue };
                let art = artwork_from(&cat["attributes"]["artwork"])
                    .and_then(|a| serde_json::to_string(&a).ok());
                // Keep `featured`, `featured_at` and `top_songs`: this pass knows nothing
                // about them, and a NULL photo from Apple must not erase a good one.
                conn.execute(
                    "INSERT INTO artist_catalog(name, catalog_id, artwork, featured, featured_at, top_songs)
                     VALUES(?1, ?2, ?3, NULL, 0, NULL)
                     ON CONFLICT(name) DO UPDATE SET
                       catalog_id = excluded.catalog_id,
                       artwork    = COALESCE(excluded.artwork, artist_catalog.artwork)",
                    rusqlite::params![name, id, art],
                )
                .map_err(|e| e.to_string())?;
                written += 1;
            }
        }
        offset += ARTIST_PAGE;
    }
    {
        let conn = db.lock();
        crate::library::meta_set(&conn, META_ARTISTS_TOTAL, &total.to_string())?;
    }
    crate::log::info(&format!("library: artist catalog filled, {written} of {total} artist(s)"));
    Ok(written)
}

/// The newest release by each of the given LIBRARY artist names, through
/// `artists?ids=…&views=latest-release` (HOME.md §10.4). One call per 25 names; the
/// shelf asks about ten, so in practice one call.
///
/// `latest-release` alone is enough: measured 2026-09-18, it equalled the newest row of
/// `singles` and `full-albums` for every artist tested, and asking for those two as well
/// multiplied the payload five times. It returns ONE release, so an artist with both a
/// release last week and one coming next week shows the coming one.
///
/// Names with no `artist_catalog` row are skipped — the sync pass above fills that table,
/// and a name it has never seen simply contributes nothing. Apple answering fewer artists
/// than asked (22 of 25, measured) is a gap, never an error. The rows are deduplicated by
/// catalog id, so one collaboration does not draw twice.
#[tauri::command]
pub async fn artist_new_releases(
    names: Vec<String>,
    state: tauri::State<'_, AppleState>,
    db: tauri::State<'_, crate::library::Db>,
) -> Result<Vec<Album>, String> {
    let dev = developer_token()?;
    let user = state.user_token.lock().unwrap().clone().ok_or("not connected to Apple Music")?;
    let client = http_client();
    let sf = crate::enrich::storefront(&client, &dev, &user, &db).await?;

    let ids: Vec<String> = {
        let conn = db.lock();
        let mut st = conn
            .prepare_cached("SELECT catalog_id FROM artist_catalog WHERE name = ?1 AND catalog_id <> ''")
            .map_err(|e| e.to_string())?;
        names
            .iter()
            .filter_map(|n| st.query_row([n], |r| r.get::<_, String>(0)).ok())
            .collect()
    };
    if ids.is_empty() {
        return Ok(vec![]);
    }

    let mut out: Vec<Album> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for batch in ids.chunks(ARTIST_IDS_BATCH) {
        let url = format!(
            "https://api.music.apple.com/v1/catalog/{sf}/artists?ids={}&views=latest-release",
            batch.join(",")
        );
        let (status, body) = api_get(&client, &dev, &user, &url).await?;
        if status != 200 {
            return Err(format!("catalog/artists latest-release HTTP {status}"));
        }
        for a in body["data"].as_array().into_iter().flatten() {
            for r in a["views"]["latest-release"]["data"].as_array().into_iter().flatten() {
                if r["type"].as_str() != Some("albums") {
                    continue;
                }
                let album = album_from_catalog(r);
                if let Some(id) = album.catalog_id.clone() {
                    if !seen.insert(id) {
                        continue;
                    }
                }
                out.push(album);
            }
        }
    }
    Ok(out)
}

/// A library album row from `recently-added`. It carries no catalog id (only the
/// `l.` library one), so the front end joins it to our library by name + artist.
/// `trackCount` is NOT kept: Apple's count disagrees with ours (it said 1 for an EP
/// we hold four songs from, measured 2026-09-18), and the real count is local anyway.
fn album_from_library(v: &serde_json::Value) -> Album {
    let a = &v["attributes"];
    Album {
        library_id: v["id"].as_str().map(String::from),
        catalog_id: a["playParams"]["catalogId"].as_str().map(String::from),
        title: a["name"].as_str().unwrap_or_default().to_string(),
        artist_name: a["artistName"].as_str().unwrap_or_default().to_string(),
        artwork: artwork_from(&a["artwork"]),
        genres: a["genreNames"]
            .as_array()
            .map(|arr| arr.iter().filter_map(|g| g.as_str().map(String::from)).collect())
            .unwrap_or_default(),
        release_date: a["releaseDate"].as_str().map(String::from),
        track_count: None,
        date_added: a["dateAdded"].as_str().map(String::from),
    }
}
