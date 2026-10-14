//! Back-end settings (TRAY.md / EXTENSION.md): the handful of choices the Rust
//! side has to know BEFORE the webview is up — whether × hides to the tray, whether
//! the tray panel may read the Windows media session, and the extension pairing
//! token. Front-end-only preferences (theme, skin, menu mode, Library Add …) stay in
//! localStorage as before; this file is deliberately tiny.
//!
//! Persisted as JSON at `<app_data>/settings.json`. Every field has a default so a
//! missing or stale file never blocks startup.

use crate::lock::LockExt;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

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
    /// The delay (ms) the Auto retune settled on for a speaker, by speaker name. The next
    /// connect starts there, so the mid-song retune reconnect is rare (AIRPLAY.md §13.5).
    pub airplay_speaker_latency_ms: std::collections::HashMap<String, u32>,
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
    /// Agents may read and write the Diary (DIARY.md §10): `/diary`, `deetsmusic diary`, the
    /// MCP `diary` tool. OFF by default — a diary is private writing — and only the user can
    /// turn it on (the agent's own settings route may only turn it off).
    pub agent_diary: bool,
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
            airplay_speaker_latency_ms: std::collections::HashMap::new(),
            minimize_to_tray: true,
            agent_control: true,
            agent_history: true,
            agent_diary: false, // his call 2026-09-24: behind a switch the user turns on
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
    /// What the launch read could not keep, for the one toast (`settings_load_problems`).
    problems: Mutex<Option<LoadProblems>>,
    /// One save at a time: the setters run on the blocking pool, and two writes to the same
    /// `.tmp` beside the file would collide. The snapshot is taken inside, so the last save
    /// writes the newest data.
    save_lock: Mutex<()>,
}

/// settings.json did not read whole at launch (safe_file.rs): the fields back to their default.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadProblems {
    /// The file was not JSON at all: every value is back to its default.
    pub unreadable: bool,
    /// The fields whose stored value this build could not read, by their JSON (camelCase) name.
    pub fields: Vec<String>,
}

/// 24 random bytes → 32-char base32-ish pairing code. Grouped for humans by the UI.
fn random_token() -> String {
    const ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
    let mut buf = [0u8; 24];
    getrandom::getrandom(&mut buf).expect("os rng");
    buf.iter().map(|b| ALPHABET[(*b as usize) % ALPHABET.len()] as char).collect()
}

impl Settings {
    /// Read settings.json, keeping every value this build can read (safe_file.rs). Before
    /// 2026-10-11 one unreadable value — a cut-off write, or a choice from a newer build after
    /// a Roll back — reset EVERY value here and the pairing token, with no log line. Now only
    /// that field resets; the old file is kept as settings.json.bad, the log names the fields,
    /// and the front-end shows one toast (main.ts). The repaired file is saved at once, so the
    /// toast shows once, not on every launch.
    pub fn load(dir: PathBuf) -> Self {
        let path = dir.join("settings.json");
        let (mut data, problems) = match std::fs::read_to_string(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (SettingsData::default(), None), // a first run
            Err(e) => {
                crate::log::warn(&format!("settings: settings.json could not be opened ({e}); every value is back to its default"));
                (SettingsData::default(), Some(LoadProblems { unreadable: true, fields: Vec::new() }))
            }
            Ok(text) => {
                let r = crate::safe_file::parse_lenient::<SettingsData>(&text);
                if r.clean() {
                    (r.value, None)
                } else {
                    let kept = crate::safe_file::keep_bad_copy(&path).is_some();
                    let copy = if kept { "; the old file is settings.json.bad" } else { "" };
                    if r.unreadable {
                        crate::log::warn(&format!("settings: settings.json could not be read; every value is back to its default{copy}"));
                    } else {
                        crate::log::warn(&format!("settings: these values could not be read and are back to their defaults: {}{copy}", r.bad_fields.join(", ")));
                    }
                    (r.value, Some(LoadProblems { unreadable: r.unreadable, fields: r.bad_fields }))
                }
            }
        };
        let mut dirty = problems.is_some();
        if data.bridge_token.is_empty() {
            data.bridge_token = random_token();
            dirty = true;
        }
        let s = Self { data: Mutex::new(data), path, problems: Mutex::new(problems), save_lock: Mutex::new(()) };
        if dirty {
            if let Err(e) = s.save() {
                crate::log::warn(&format!("settings: {e}"));
            }
        }
        s
    }

    pub fn save(&self) -> Result<(), String> {
        let _one = self.save_lock.lock_or_recover();
        let json = serde_json::to_string_pretty(&*self.data.lock_or_recover()).map_err(|e| e.to_string())?;
        crate::safe_file::write_atomic(&self.path, json.as_bytes()).map_err(|e| format!("settings.json: {e}"))
    }

    /// The launch read's problems, once (the toast takes them; a reload does not repeat it).
    pub fn take_problems(&self) -> Option<LoadProblems> {
        self.problems.lock_or_recover().take()
    }

    pub fn get(&self) -> SettingsData {
        self.data.lock_or_recover().clone()
    }

    pub fn update(&self, f: impl FnOnce(&mut SettingsData)) -> Result<SettingsData, String> {
        let out = {
            let mut d = self.data.lock_or_recover();
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

/// What settings.json could not keep at launch, once (main.ts shows one toast). Memory only.
#[tauri::command]
pub fn settings_load_problems(settings: tauri::State<'_, Settings>) -> Option<LoadProblems> {
    settings.take_problems()
}

// Every setter below writes settings.json. A sync command runs on the UI thread (CLAUDE.md,
// FRIENDS.md §8.11), and a file write can wait on the disk or on antivirus, so each setter is
// `async` and does its write — and anything after it — on the blocking pool (2026-10-11).
async fn off_ui<T: Send + 'static>(app: tauri::AppHandle, job: impl FnOnce(&tauri::AppHandle) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || job(&app)).await.map_err(|e| e.to_string())?
}

/// The common setter: change one value and save.
async fn set(app: tauri::AppHandle, f: impl FnOnce(&mut SettingsData) + Send + 'static) -> Result<SettingsData, String> {
    off_ui(app, move |app| app.state::<Settings>().update(f)).await
}

#[tauri::command]
pub async fn settings_set_minimize_to_tray(on: bool, app: tauri::AppHandle) -> Result<SettingsData, String> {
    set(app, move |d| d.minimize_to_tray = on).await
}

#[tauri::command]
pub async fn settings_set_read_windows_media(on: bool, app: tauri::AppHandle) -> Result<SettingsData, String> {
    off_ui(app, move |app| {
        let out = app.state::<Settings>().update(|d| d.read_windows_media = on)?;
        // The tray menu is built on the main thread, as it was when this command ran there.
        let a = app.clone();
        let _ = app.run_on_main_thread(move || crate::tray::sync_menu(&a));
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn settings_set_agent_control(on: bool, app: tauri::AppHandle) -> Result<SettingsData, String> {
    set(app, move |d| d.agent_control = on).await
}

#[tauri::command]
pub async fn settings_set_agent_history(on: bool, app: tauri::AppHandle) -> Result<SettingsData, String> {
    set(app, move |d| d.agent_history = on).await
}

#[tauri::command]
pub async fn settings_set_agent_diary(on: bool, app: tauri::AppHandle) -> Result<SettingsData, String> {
    set(app, move |d| d.agent_diary = on).await
}

#[tauri::command]
pub async fn settings_set_lastfm_scrobble(on: bool, app: tauri::AppHandle) -> Result<SettingsData, String> {
    set(app, move |d| d.lastfm_scrobble = on).await
}

// ── Song of the Day (docs/integrations/DeetsOTD.md §8.4) ───────────────────────────────────

#[tauri::command]
pub async fn settings_set_sotd(on: bool, app: tauri::AppHandle) -> Result<SettingsData, String> {
    off_ui(app, move |app| {
        let out = app.state::<Settings>().update(|d| d.sotd = on)?;
        crate::sotd::switched(app, on);
        Ok(out)
    })
    .await
}

/// 0 (midnight) or 5 (5 AM). Anything else is refused: the two are the row's only choices,
/// and a stray hour would move every later pick to a day nobody picked.
#[tauri::command]
pub async fn settings_set_sotd_day_start(hour: u8, app: tauri::AppHandle) -> Result<SettingsData, String> {
    if hour != 0 && hour != 5 {
        return Err("day start must be 0 or 5".into());
    }
    off_ui(app, move |app| {
        let out = app.state::<Settings>().update(|d| d.sotd_day_start = hour)?;
        // A waiting post's due time was read under the old rule.
        crate::sotd::outbox::rearm(app);
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn settings_set_sotd_picks_per_day(n: u8, app: tauri::AppHandle) -> Result<SettingsData, String> {
    if n > 2 {
        return Err("picks per day must be 0 (no limit), 1 or 2".into());
    }
    set(app, move |d| d.sotd_picks_per_day = n).await
}

#[tauri::command]
pub async fn settings_set_sotd_post_mode(mode: PostMode, app: tauri::AppHandle) -> Result<SettingsData, String> {
    set(app, move |d| d.sotd_post_mode = mode).await
}

#[tauri::command]
pub async fn settings_set_sotd_post_at(at: String, app: tauri::AppHandle) -> Result<SettingsData, String> {
    let ok = at.len() == 5
        && at.as_bytes()[2] == b':'
        && at[..2].parse::<u32>().map(|h| h < 24).unwrap_or(false)
        && at[3..].parse::<u32>().map(|m| m < 60).unwrap_or(false);
    if !ok {
        return Err("post at must be HH:MM".into());
    }
    off_ui(app, move |app| {
        let out = app.state::<Settings>().update(|d| d.sotd_post_at = at)?;
        crate::sotd::outbox::rearm(app);
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn settings_set_sotd_post_as(name: String, app: tauri::AppHandle) -> Result<SettingsData, String> {
    // Discord caps a webhook username at 80 characters.
    set(app, move |d| d.sotd_post_as = name.chars().take(80).collect()).await
}

#[tauri::command]
pub async fn settings_set_lastfm_now_playing(on: bool, app: tauri::AppHandle) -> Result<SettingsData, String> {
    set(app, move |d| d.lastfm_now_playing = on).await
}

// ── start with Windows (HKCU Run key via reg.exe; DeetsAirplay / DeetsRGB pattern) ──

const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
/// The Run value's name: "DeetsMusic", or "DeetsMusic Beta" so the two apps never share one (BETA.md).
fn run_value() -> &'static str {
    crate::beta::app_name()
}

pub(crate) fn reg(args: &[&str]) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new("reg").args(args).creation_flags(CREATE_NO_WINDOW).output().map_err(|e| format!("reg.exe: {e}"))?;
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

pub fn autostart_enabled() -> bool {
    reg(&["query", RUN_KEY, "/v", run_value()]).map(|s| s.contains(run_value())).unwrap_or(false)
}

/// Registers `"<exe>" --tray`: a login launch starts in the tray, not on screen.
pub fn autostart_write(on: bool) -> Result<(), String> {
    if on {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let cmd = format!("\"{}\" --tray", exe.display());
        reg(&["add", RUN_KEY, "/v", run_value(), "/t", "REG_SZ", "/d", &cmd, "/f"])?;
    } else {
        reg(&["delete", RUN_KEY, "/v", run_value(), "/f"])?;
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
pub(crate) fn cli_path(app: &tauri::AppHandle) -> String {
    let exe = format!("{}.exe", cli_name());
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join("cli").join(&exe);
        if p.is_file() {
            return p.display().to_string().trim_start_matches(r"\\?\").to_string();
        }
    }
    let local = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| r"C:\Users\you\AppData\Local".into());
    format!(r"{local}\{}\cli\{exe}", crate::beta::app_name())
}

/// The CLI's name, which is also the MCP entry's name: DeetsMusic Beta ships its own
/// `deetsmusic-beta`, which reaches only the beta, so an AI app can hold both (BETA.md §6).
pub(crate) fn cli_name() -> &'static str {
    if crate::beta::is_beta() {
        "deetsmusic-beta"
    } else {
        "deetsmusic"
    }
}

/// The text the Settings card copies for one client: `claude-desktop`, `claude-code`,
/// `cursor`, `other-full`, or `other-small` (AGENT.md §4: `mcp` serves every tool, `mcp
/// --small` the ten a small local model handles well).
#[tauri::command]
pub fn agent_setup_text(client: String, app: tauri::AppHandle) -> String {
    // The text lives with the install logic now (crates/mcp-install, MCP-INSTALL.md §8b).
    mcp_install::setup_text(&client, &mcp_install::Server { name: cli_name().into(), exe: cli_path(&app).into() })
}

/// The plain-words guide, in the browser.
#[tauri::command]
pub fn agent_open_guide(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        // Moved from the top of docs/ on 2026-09-21. The stub for installs up to 0.12.2 was deleted
        // on 2026-10-14 (none in use).
        .open_url("https://github.com/deets-137/DeetsMusicWindows/blob/main/docs/integrations/AGENT-SETUP.md", None::<String>)
        .map_err(|e| e.to_string())
}

/// Regenerate the pairing token (the old one stops working immediately).
#[tauri::command]
pub async fn settings_rotate_bridge_token(app: tauri::AppHandle) -> Result<SettingsData, String> {
    set(app, |d| d.bridge_token = random_token()).await
}

#[tauri::command]
pub async fn settings_set_airplay_capture(v: AirplayCapture, app: tauri::AppHandle) -> Result<SettingsData, String> {
    off_ui(app, move |app| {
        let out = app.state::<Settings>().update(|d| d.airplay_capture = v)?;
        crate::airplay::prefs_changed(app);
        Ok(out)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("deets-settings-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn one_unreadable_value_resets_only_that_value_2026_10_11() {
        // A choice from a newer build (read after a Roll back) and a value of the wrong type.
        let dir = temp_dir("field");
        std::fs::write(
            dir.join("settings.json"),
            r#"{"minimizeToTray":false,"sotdPostMode":"weekly","lastfmScrobble":"yes","bridgeToken":"keepme","sotdPostAt":"21:15"}"#,
        )
        .unwrap();
        let s = Settings::load(dir.clone());
        let d = s.get();
        assert!(!d.minimize_to_tray, "a readable value is kept");
        assert_eq!(d.bridge_token, "keepme", "the pairing token is kept");
        assert_eq!(d.sotd_post_at, "21:15");
        assert_eq!(d.sotd_post_mode, PostMode::Ask, "back to its default");
        assert!(d.lastfm_scrobble, "back to its default");
        let mut p = s.take_problems().expect("problems reported");
        p.fields.sort();
        assert_eq!(p, LoadProblems { unreadable: false, fields: vec!["lastfmScrobble".into(), "sotdPostMode".into()] });
        assert!(s.take_problems().is_none(), "the toast takes them once");
        assert!(dir.join("settings.json.bad").exists(), "the old file is kept");
        // The repaired file is saved at once: the next launch reads it clean.
        let again = Settings::load(dir.clone());
        assert!(again.take_problems().is_none());
        assert!(!again.get().minimize_to_tray);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_cut_off_file_resets_everything_but_says_so() {
        let dir = temp_dir("cut");
        std::fs::write(dir.join("settings.json"), r#"{"minimizeToTray":false,"bridgeTo"#).unwrap();
        let s = Settings::load(dir.clone());
        assert_eq!(s.take_problems(), Some(LoadProblems { unreadable: true, fields: vec![] }));
        assert!(s.get().minimize_to_tray);
        assert!(!s.get().bridge_token.is_empty(), "a new pairing token");
        assert!(dir.join("settings.json.bad").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_first_run_has_no_problems() {
        let dir = temp_dir("first");
        let s = Settings::load(dir.clone());
        assert!(s.take_problems().is_none());
        assert!(dir.join("settings.json").exists());
        assert!(!dir.join("settings.json.bad").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
