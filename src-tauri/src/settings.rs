//! Back-end settings (TRAY.md / EXTENSION.md): the handful of choices the Rust
//! side has to know BEFORE the webview is up — whether × hides to the tray, whether
//! the tray panel may read the Windows media session, and the extension pairing
//! token. Front-end-only preferences (theme, skin, menu mode, Library Add …) stay in
//! localStorage as before; this file is deliberately tiny.
//!
//! Persisted as JSON at `<app_data>/settings.json`. Every field has a default so a
//! missing or stale file never blocks startup.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

/// What the speaker receives (AIRPLAY.md §7).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AirplayCapture {
    /// Only DeetsMusic: the in-page tap (AIRPLAY.md §12); the PC goes silent.
    App,
    /// Everything the PC plays (loopback of the default output).
    System,
}

/// When a marked Song of the Day goes out (docs/integrations/DeetsOTD.md §8.4). One mode for every
/// outlet: the Ask toast names them all at once.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PostMode {
    /// A sticky toast asks before anything leaves. The default: the first post never goes
    /// out unseen.
    Ask,
    /// Sent as soon as it is marked.
    Now,
    /// Sent at "Post at", inside the pick's own journal day.
    Time,
}

/// A speaker as the dropdown remembers it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AirplaySpeaker {
    pub name: String,
    pub ip: String,
    pub port: u16,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsData {
    // ── AirPlay (AIRPLAY.md) — read in Rust at connect time ──
    pub airplay_capture: AirplayCapture,
    /// Last speaker connected to; the dropdown offers it before a scan finds it.
    pub airplay_last_speaker: Option<AirplaySpeaker>,
    /// The exe the one-shot Windows Firewall prompt (inbound UDP for the speaker's
    /// replies) was answered for. By path, not yes/no: the dev build and the installed
    /// build share this file (same identifier), and a rule is per exe — 0.2.0 shipped
    /// with a bool, the dev run set it, and the installed build never prompted.
    pub airplay_firewall_exe: Option<String>,
    /// The volume (0–100) a speaker was last left at, by speaker name. A speaker never
    /// used before starts at `AIRPLAY_FIRST_VOLUME` so nobody gets blasted.
    pub airplay_speaker_volumes: std::collections::HashMap<String, f64>,
    /// × hides the main window to the tray instead of quitting (default on).
    pub minimize_to_tray: bool,
    /// The CLI / MCP routes on the bridge answer (AGENT-SETUP.md). Off → 403 with a
    /// plain sentence; the browser extension's routes are untouched.
    pub agent_control: bool,
    /// Agents may read play history: `plays` / `play_counts` in `deetsmusic sql`, the history
    /// sorts of `list what=library`, and `/history` (LOCAL-DATA.md §9). On by default: Agent
    /// control is already the consent to reach the app; this row lets a user keep control and
    /// still hide their listening habits.
    pub agent_history: bool,
    /// First installed run enrolled the app in Launch-at-startup (once, like
    /// DeetsAirplay); the Settings toggle owns it from then on.
    pub autostart_seeded: bool,
    /// The tray panel falls back to Windows' media session when DeetsMusic is idle.
    pub read_windows_media: bool,
    /// Shared secret the browser extension presents on every bridge call.
    pub bridge_token: String,
    /// Where the real app window last sat, as [x, y] outer position. A tray pop moves
    /// the window to the tray, so "Open DeetsMusic" and the pinned taskbar button need
    /// a position to put it back at — and that must survive a × close and a restart,
    /// not just live in `tray::Inner`. `None` until the window has been placed once.
    pub window_pos: Option<[i32; 2]>,
    /// Send plays to Last.fm while an account is connected (LASTFM.md §6). On: connecting is
    /// the consent; this row pauses it without losing the account.
    pub lastfm_scrobble: bool,
    /// Tell Last.fm what plays now, for the profile's "listening now" line. Separate from
    /// scrobbling: it changes only the profile, never the charts.
    pub lastfm_now_playing: bool,
    // ── Song of the Day (docs/integrations/DeetsOTD.md §8.4) ──
    // Rust owns these five because Rust is what enforces them: the per-day limit must hold
    // for an agent too, and the day rule is read by a timer that fires with no window up.
    // "Suggest today's pick" is the one row Rust never needs, so it stays in the front-end
    // store beside the other view preferences.
    /// The whole feature. Off hides the menu items, the shelf and Rewind's Picks, stops the
    /// outbox timer, and refuses an agent mark. It keeps every pick and every connection.
    pub sotd: bool,
    /// "Day starts at", as the hour taken off the clock before the date is read: 0 =
    /// midnight, 5 = 5 AM. The owner's journal (DeetsOTD) uses 5, and so does the default.
    pub sotd_day_start: u8,
    /// How many picks one journal day holds. 0 = no limit.
    pub sotd_picks_per_day: u8,
    pub sotd_post_mode: PostMode,
    /// "Post at", `HH:MM` in the system time zone. Every clock time falls inside exactly one
    /// journal day, so this needs no error state.
    pub sotd_post_at: String,
    /// The name a post shows under. Empty = the webhook's own name.
    pub sotd_post_as: String,
}

impl Default for SettingsData {
    fn default() -> Self {
        Self {
            airplay_capture: AirplayCapture::App,
            airplay_last_speaker: None,
            airplay_firewall_exe: None,
            airplay_speaker_volumes: std::collections::HashMap::new(),
            minimize_to_tray: true,
            agent_control: true,
            agent_history: true,
            autostart_seeded: false,
            read_windows_media: true,
            bridge_token: String::new(),
            window_pos: None,
            lastfm_scrobble: true,
            lastfm_now_playing: true,
            // On: with no outlet set up the feature is local only — one right-click item and
            // a shelf that appears after your first pick. It posts nothing (owner, 2026-09-18).
            sotd: true,
            sotd_day_start: 5, // owner, 2026-09-18: the rule his journal already uses
            sotd_picks_per_day: 1,
            sotd_post_mode: PostMode::Ask,
            sotd_post_at: "20:00".into(),
            sotd_post_as: String::new(),
        }
    }
}

pub struct Settings {
    pub data: Mutex<SettingsData>,
    path: PathBuf,
}

/// 24 random bytes → 32-char base32-ish pairing code. Grouped for humans by the UI.
fn random_token() -> String {
    const ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
    let mut buf = [0u8; 24];
    getrandom::getrandom(&mut buf).expect("os rng");
    buf.iter().map(|b| ALPHABET[(*b as usize) % ALPHABET.len()] as char).collect()
}

impl Settings {
    pub fn load(dir: PathBuf) -> Self {
        let path = dir.join("settings.json");
        let mut data: SettingsData = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let mut dirty = false;
        if data.bridge_token.is_empty() {
            data.bridge_token = random_token();
            dirty = true;
        }
        let s = Self { data: Mutex::new(data), path };
        if dirty {
            s.save().ok();
        }
        s
    }

    pub fn save(&self) -> Result<(), String> {
        let json = serde_json::to_string_pretty(&*self.data.lock().unwrap()).map_err(|e| e.to_string())?;
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::write(&self.path, json).map_err(|e| format!("settings.json: {e}"))
    }

    pub fn get(&self) -> SettingsData {
        self.data.lock().unwrap().clone()
    }

    pub fn update(&self, f: impl FnOnce(&mut SettingsData)) -> Result<SettingsData, String> {
        let out = {
            let mut d = self.data.lock().unwrap();
            f(&mut d);
            d.clone()
        };
        self.save()?;
        Ok(out)
    }
}

// ── commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn settings_get(settings: tauri::State<'_, Settings>) -> SettingsData {
    settings.get()
}

#[tauri::command]
pub fn settings_set_minimize_to_tray(on: bool, settings: tauri::State<'_, Settings>) -> Result<SettingsData, String> {
    settings.update(|d| d.minimize_to_tray = on)
}

#[tauri::command]
pub fn settings_set_read_windows_media(
    on: bool,
    app: tauri::AppHandle,
    settings: tauri::State<'_, Settings>,
) -> Result<SettingsData, String> {
    let out = settings.update(|d| d.read_windows_media = on)?;
    crate::tray::sync_menu(&app);
    Ok(out)
}

#[tauri::command]
pub fn settings_set_agent_control(on: bool, settings: tauri::State<'_, Settings>) -> Result<SettingsData, String> {
    settings.update(|d| d.agent_control = on)
}

#[tauri::command]
pub fn settings_set_agent_history(on: bool, settings: tauri::State<'_, Settings>) -> Result<SettingsData, String> {
    settings.update(|d| d.agent_history = on)
}

#[tauri::command]
pub fn settings_set_lastfm_scrobble(on: bool, settings: tauri::State<'_, Settings>) -> Result<SettingsData, String> {
    settings.update(|d| d.lastfm_scrobble = on)
}

// ── Song of the Day (docs/integrations/DeetsOTD.md §8.4) ───────────────────────────────────

#[tauri::command]
pub fn settings_set_sotd(on: bool, app: tauri::AppHandle, settings: tauri::State<'_, Settings>) -> Result<SettingsData, String> {
    let out = settings.update(|d| d.sotd = on)?;
    crate::sotd::switched(&app, on);
    Ok(out)
}

/// 0 (midnight) or 5 (5 AM). Anything else is refused: the two are the row's only choices,
/// and a stray hour would move every later pick to a day nobody picked.
#[tauri::command]
pub fn settings_set_sotd_day_start(hour: u8, app: tauri::AppHandle, settings: tauri::State<'_, Settings>) -> Result<SettingsData, String> {
    if hour != 0 && hour != 5 {
        return Err("day start must be 0 or 5".into());
    }
    let out = settings.update(|d| d.sotd_day_start = hour)?;
    // A waiting post's due time was read under the old rule.
    crate::sotd::outbox::rearm(&app);
    Ok(out)
}

#[tauri::command]
pub fn settings_set_sotd_picks_per_day(n: u8, settings: tauri::State<'_, Settings>) -> Result<SettingsData, String> {
    if n > 2 {
        return Err("picks per day must be 0 (no limit), 1 or 2".into());
    }
    settings.update(|d| d.sotd_picks_per_day = n)
}

#[tauri::command]
pub fn settings_set_sotd_post_mode(mode: PostMode, settings: tauri::State<'_, Settings>) -> Result<SettingsData, String> {
    settings.update(|d| d.sotd_post_mode = mode)
}

#[tauri::command]
pub fn settings_set_sotd_post_at(at: String, app: tauri::AppHandle, settings: tauri::State<'_, Settings>) -> Result<SettingsData, String> {
    let ok = at.len() == 5
        && at.as_bytes()[2] == b':'
        && at[..2].parse::<u32>().map(|h| h < 24).unwrap_or(false)
        && at[3..].parse::<u32>().map(|m| m < 60).unwrap_or(false);
    if !ok {
        return Err("post at must be HH:MM".into());
    }
    let out = settings.update(|d| d.sotd_post_at = at)?;
    crate::sotd::outbox::rearm(&app);
    Ok(out)
}

#[tauri::command]
pub fn settings_set_sotd_post_as(name: String, settings: tauri::State<'_, Settings>) -> Result<SettingsData, String> {
    // Discord caps a webhook username at 80 characters.
    settings.update(|d| d.sotd_post_as = name.chars().take(80).collect())
}

#[tauri::command]
pub fn settings_set_lastfm_now_playing(on: bool, settings: tauri::State<'_, Settings>) -> Result<SettingsData, String> {
    settings.update(|d| d.lastfm_now_playing = on)
}

// ── start with Windows (HKCU Run key via reg.exe; DeetsAirplay / DeetsRGB pattern) ──

const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "DeetsMusic";

pub(crate) fn reg(args: &[&str]) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new("reg").args(args).creation_flags(CREATE_NO_WINDOW).output().map_err(|e| format!("reg.exe: {e}"))?;
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

pub fn autostart_enabled() -> bool {
    reg(&["query", RUN_KEY, "/v", RUN_VALUE]).map(|s| s.contains(RUN_VALUE)).unwrap_or(false)
}

/// Registers `"<exe>" --tray`: a login launch starts in the tray, not on screen.
pub fn autostart_write(on: bool) -> Result<(), String> {
    if on {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let cmd = format!("\"{}\" --tray", exe.display());
        reg(&["add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", &cmd, "/f"])?;
    } else {
        reg(&["delete", RUN_KEY, "/v", RUN_VALUE, "/f"])?;
    }
    Ok(())
}

// Both of these SPAWN `reg.exe` and wait for it to exit. A sync command runs on the UI
// thread, so that wait is a wait the window cannot paint through (FRIENDS.md §8.11 is what
// this rule cost us). `reg.exe` always exits, usually in tens of milliseconds — but process
// creation is not ours to bound: antivirus inspects it, and a loaded machine queues it.

#[tauri::command]
pub async fn autostart_get() -> bool {
    tauri::async_runtime::spawn_blocking(autostart_enabled).await.unwrap_or(false)
}

#[tauri::command]
pub async fn autostart_set(on: bool) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        autostart_write(on)?;
        Ok(autostart_enabled())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── the agent setup text (AGENT-SETUP.md §2) ──

/// Where the shipped `deetsmusic.exe` is: the install's resource folder, else the
/// per-user install path (what a config written on another build should point at).
/// Tauri's `resource_dir` can carry the `\\?\` extended-length prefix; some MCP clients
/// fail to launch a command written that way, so the copied text drops it.
fn cli_path(app: &tauri::AppHandle) -> String {
    use tauri::Manager;
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join("cli").join("deetsmusic.exe");
        if p.is_file() {
            return p.display().to_string().trim_start_matches(r"\\?\").to_string();
        }
    }
    let local = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| r"C:\Users\you\AppData\Local".into());
    format!(r"{local}\DeetsMusic\cli\deetsmusic.exe")
}

/// The text the Settings card copies for one client: `claude-desktop`, `claude-code`,
/// `cursor`, `other-full`, or `other-small` (AGENT.md §4: `mcp` serves every tool, `mcp
/// --small` the ten a small local model handles well).
#[tauri::command]
pub fn agent_setup_text(client: String, app: tauri::AppHandle) -> String {
    let path = cli_path(&app);
    let small = client == "other-small";
    let json = format!(
        "{{\n  \"mcpServers\": {{\n    \"deetsmusic\": {{\n      \"command\": \"{}\",\n      \"args\": [{}]\n    }}\n  }}\n}}",
        path.replace('\\', "\\\\"),
        if small { "\"mcp\", \"--small\"" } else { "\"mcp\"" }
    );
    match client.as_str() {
        "claude-code" => format!("claude mcp add deetsmusic -- \"{path}\" mcp"),
        "claude-desktop" | "cursor" => json,
        _ if small => format!("Command: {path}\nArguments: mcp --small\n\nAs JSON for an MCP config file:\n{json}"),
        _ => format!("Command: {path}\nArgument: mcp\n\nAs JSON for an MCP config file:\n{json}"),
    }
}

/// The plain-words guide, in the browser.
#[tauri::command]
pub fn agent_open_guide(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        // Moved from docs/AGENT-SETUP.md on 2026-09-21; a stub there still serves installs up to 0.12.2.
        .open_url("https://github.com/deets-137/DeetsMusicWindows/blob/main/docs/integrations/AGENT-SETUP.md", None::<String>)
        .map_err(|e| e.to_string())
}

/// Regenerate the pairing token (the old one stops working immediately).
#[tauri::command]
pub fn settings_rotate_bridge_token(settings: tauri::State<'_, Settings>) -> Result<SettingsData, String> {
    settings.update(|d| d.bridge_token = random_token())
}

#[tauri::command]
pub fn settings_set_airplay_capture(v: AirplayCapture, app: tauri::AppHandle, settings: tauri::State<'_, Settings>) -> Result<SettingsData, String> {
    let out = settings.update(|d| d.airplay_capture = v)?;
    crate::airplay::prefs_changed(&app);
    Ok(out)
}
