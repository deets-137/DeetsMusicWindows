//! The rolling app log — `<app_data>/deetsmusic.log` (docs/LOGGING.md).
//!
//! Hand-rolled, no crate. One line per event, three levels, always on, bounded:
//! rotate at 512 KB, keep one generation (`deetsmusic.1.log`), so the file can
//! never grow past about 1 MB. Every line also goes to stdout (visible under the
//! dev runner) and into a 400-line ring the bridge serves at `GET /log`.
//!
//! Two rules live INSIDE `write`, not at the call sites, so one careless
//! `format!` a year from now cannot defeat them:
//! - **Redaction**: anything shaped like a JWT (`eyJ…`) or following `Bearer `
//!   is replaced, and so is every value passed to `register_secret` (the Music
//!   User Token is not JWT-shaped, so the pattern alone would miss it). The app
//!   holds two bearer credentials, the file is readable over loopback, and it
//!   becomes the body of a bug report.
//! - **Never panic**: a log line must never take the app down. Every I/O
//!   result is dropped.
//!
//! Call sites log **catalog ids, never track titles** — a log full of titles
//! is a listening history.

use std::collections::VecDeque;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const FILE: &str = "deetsmusic.log";
pub(crate) const PREV: &str = "deetsmusic.1.log";
const LEGACY: &str = "bridge.log";
const ROTATE_AT: u64 = 512 * 1024;
const RING_CAP: usize = 400;

static PATH: OnceLock<PathBuf> = OnceLock::new();
static RING: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());

/// The open log file and its length. Kept open across lines (2026-09-18): before, every
/// line did a stat, an open and a close. The length is counted here so the rotation
/// check needs no stat either. Each line is still one unbuffered `write`, so a crash
/// loses nothing. `None` until the first line, and again after a rotation until the
/// next line reopens the fresh file.
static SINK: Mutex<Option<(std::fs::File, u64)>> = Mutex::new(None);

/// Append `text` (which must end in its newline) to the log file, rotating first when
/// the file has passed ROTATE_AT. Every error is dropped: a log line must never take
/// the app down.
fn append(text: &str) {
    let Some(path) = PATH.get() else { return };
    let Ok(mut sink) = SINK.lock() else { return };
    if sink.as_ref().map_or(false, |(_, len)| *len > ROTATE_AT) {
        // Two files rather than a truncate: the run-up to a fault is the part
        // worth reading. Close ours first: the handle would follow the renamed file.
        *sink = None;
        let _ = std::fs::rename(path, path.with_file_name(PREV));
    }
    if sink.is_none() {
        let Ok(f) = std::fs::OpenOptions::new().create(true).append(true).open(path) else { return };
        let len = f.metadata().map(|m| m.len()).unwrap_or(0);
        *sink = Some((f, len));
    }
    if let Some((f, len)) = sink.as_mut() {
        if f.write_all(text.as_bytes()).is_ok() {
            *len += text.len() as u64;
        } else {
            *sink = None; // reopen on the next line (the file was deleted or locked)
        }
    }
}

/// Point the log at the app data dir, adopt the old `bridge.log` as the previous
/// generation (renamed, never orphaned or deleted), install the panic hook, and
/// write the startup line. Call once, first thing in `setup()`.
pub fn init(dir: &Path) {
    let legacy = dir.join(LEGACY);
    let prev = dir.join(PREV);
    if legacy.is_file() && !prev.exists() {
        let _ = std::fs::rename(&legacy, &prev);
    }
    let _ = PATH.set(dir.join(FILE));

    // A panic on a worker thread is otherwise silent in a release build. Chain to
    // the default hook so the dev runner still prints the backtrace.
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "<non-string payload>".into());
        let at = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        error(&format!("panic: {payload} at {at}"));
        default(info);
    }));

    let which = if dir.file_name().and_then(|n| n.to_str()) == Some("com.deetsmusic.dev") { "dev" } else { "release" };
    info(&format!(
        // The UTC offset: line times are local, the Worker's are UTC.
        "start: DeetsMusic {} · Windows {} · data dir {which} · UTC{}",
        env!("CARGO_PKG_VERSION"),
        windows_build(),
        chrono::Local::now().format("%:z")
    ));
}

pub fn info(msg: &str) {
    write("INFO ", msg);
}
pub fn warn(msg: &str) {
    write("WARN ", msg);
}
pub fn error(msg: &str) {
    write("ERROR", msg);
}

/// The in-memory ring, newest last — what the bridge serves at `/log`.
pub fn ring_text() -> String {
    RING.lock().map(|r| r.iter().cloned().collect::<Vec<_>>().join("\n")).unwrap_or_default()
}

/// The front-end half (`src/diag.ts`): its ring buffer, appended as one block —
/// a header line through the normal path, then the body indented, scrubbed,
/// file only (300 lines would flush the 400-line ring for nothing). Called on
/// `window:error`, on `beforeunload`, and when the report form opens.
#[tauri::command]
pub fn diag_flush(text: String) {
    let lines: Vec<&str> = text.lines().collect();
    let Some((head, body)) = lines.split_first() else { return };
    info(&format!("diag: {head}"));
    let mut block = String::new();
    for l in body {
        block.push_str("    ");
        block.push_str(&scrub(l));
        block.push('\n');
    }
    append(&block);
}

/// Front-end events arrive without bound (a broken page can call in a loop), so the file
/// takes at most FE_BURST of them per FE_WINDOW; the overflow is counted and reported.
const FE_BURST: u32 = 60;
const FE_WINDOW: Duration = Duration::from_secs(60);
/// (window start, lines written in it, lines dropped in it)
static FE_RATE: Mutex<(Option<Instant>, u32, u32)> = Mutex::new((None, 0, 0));

/// One front-end warning or error, written AS IT HAPPENS (`diag.warn` / `diag.error`),
/// unlike `diag_flush`'s buffered block — so a release log shows MusicKit failures,
/// authorization changes and failure toasts even when the window never closes or crashes.
/// Line: `WARN  fe: <tag> <json>`. Scrubbed by `write` like every other line.
#[tauri::command]
pub fn log_event(level: String, tag: String, data: Option<String>) {
    let dropped = {
        let Ok(mut rate) = FE_RATE.lock() else { return };
        let mut reported = 0;
        if rate.0.map_or(true, |start| start.elapsed() > FE_WINDOW) {
            reported = rate.2;
            *rate = (Some(Instant::now()), 0, 0);
        }
        if rate.1 >= FE_BURST {
            rate.2 += 1;
            return;
        }
        rate.1 += 1;
        reported
    };
    if dropped > 0 {
        warn(&format!("fe: {dropped} front-end event(s) dropped by the rate limit"));
    }
    let tag: String = tag
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '_' | '-' | '.'))
        .take(48)
        .collect();
    let data: String = data.unwrap_or_default().chars().take(600).collect();
    let msg = if data.is_empty() { format!("fe: {tag}") } else { format!("fe: {tag} {data}") };
    match level.as_str() {
        "error" => error(&msg),
        "warn" => warn(&msg),
        _ => info(&msg),
    }
}

/// Settings › Bugs › Open log folder: the user must be able to read the file
/// before anything is sent anywhere.
#[tauri::command]
pub fn log_open_folder(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = PATH.get().and_then(|p| p.parent()).ok_or("log not initialised")?;
    app.opener().open_path(dir.to_string_lossy().to_string(), None::<&str>).map_err(|e| e.to_string())
}

fn write(level: &str, msg: &str) {
    let msg = scrub(msg);
    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let line = format!("{ts}  {level} {msg}");

    // Not println!: it panics if stdout is a pipe whose reader went away (the dev
    // runner killed while the app lives on).
    let _ = writeln!(std::io::stdout(), "{line}");

    if let Ok(mut r) = RING.lock() {
        r.push_back(line.clone());
        while r.len() > RING_CAP {
            r.pop_front();
        }
    }

    append(&format!("{line}\n"));
}

/// Credentials that no pattern can catch, redacted by exact value.
static SECRETS: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// `C:\Users\<name>`: `scrub` writes it as `%USERPROFILE%`. None if unset or too short to be safe.
static PROFILE: OnceLock<Option<String>> = OnceLock::new();
fn profile_dir() -> Option<String> {
    std::env::var("USERPROFILE").ok().map(|p| p.trim_end_matches('\\').to_string()).filter(|p| p.len() >= 8)
}

/// Redact `secret` from every later log line. Call it wherever a non-JWT
/// credential enters the process (the MUT: loaded from disk, or captured at sign-in).
pub fn register_secret(secret: &str) {
    let secret = secret.trim();
    if secret.len() < 16 {
        return; // a short value would redact ordinary words
    }
    if let Ok(mut v) = SECRETS.lock() {
        if !v.iter().any(|s| s == secret) {
            v.push(secret.to_string());
        }
    }
}

/// The current log file (`report.rs` reads its tail).
pub fn path() -> Option<&'static PathBuf> {
    PATH.get()
}

/// Replace every registered secret, anything shaped like a JWT (`eyJ` + base64url
/// with dots), and anything following `Bearer ` up to the next whitespace.
pub(crate) fn scrub(msg: &str) -> String {
    let mut owned = msg.to_string();
    if let Ok(v) = SECRETS.lock() {
        for s in v.iter() {
            if owned.contains(s.as_str()) {
                owned = owned.replace(s.as_str(), "[redacted]");
            }
        }
    }
    // A path under the user's folder names the Windows account: keep the rest of the path.
    if let Some(home) = PROFILE.get_or_init(profile_dir) {
        for form in [home.clone(), home.replace('\\', "/")] {
            if owned.contains(form.as_str()) {
                owned = owned.replace(form.as_str(), "%USERPROFILE%");
            }
        }
    }
    let mut out = String::with_capacity(owned.len());
    let mut rest = owned.as_str();
    loop {
        let jwt = rest.find("eyJ");
        let bearer = rest.find("Bearer ");
        let (at, skip_prefix) = match (jwt, bearer) {
            (None, None) => break,
            (Some(j), None) => (j, 0),
            (None, Some(b)) => (b, "Bearer ".len()),
            (Some(j), Some(b)) => {
                if j <= b {
                    (j, 0)
                } else {
                    (b, "Bearer ".len())
                }
            }
        };
        out.push_str(&rest[..at + skip_prefix]);
        let tail = &rest[at + skip_prefix..];
        let end = tail
            .find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '=')))
            .unwrap_or(tail.len());
        out.push_str("[redacted]");
        rest = &tail[end..];
    }
    out.push_str(rest);
    out
}

/// "11 24H2 build 26200.6584" — from the registry via `reg.exe`, the same hidden
/// call the autostart code uses. Cheap, once at startup; empty on any failure.
fn windows_build() -> String {
    const KEY: &str = r"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion";
    let value = |name: &str| -> String {
        crate::settings::reg(&["query", KEY, "/v", name])
            .ok()
            .and_then(|s| s.lines().find(|l| l.trim_start().starts_with(name)).map(|l| l.split_whitespace().last().unwrap_or("").to_string()))
            .unwrap_or_default()
    };
    let build = value("CurrentBuild");
    let ubr = value("UBR");
    let display = value("DisplayVersion");
    let ubr = u64::from_str_radix(ubr.trim_start_matches("0x"), 16).map(|n| n.to_string()).unwrap_or(ubr);
    let major = if build.parse::<u32>().map(|b| b >= 22000).unwrap_or(false) { "11" } else { "10" };
    format!("{major} {display} build {build}.{ubr}")
}

#[cfg(test)]
mod tests {
    use super::scrub;

    #[test]
    fn scrubs_jwt_and_bearer() {
        assert_eq!(scrub("token eyJabc.def-ghi_jk done"), "token [redacted] done");
        assert_eq!(scrub("Authorization: Bearer abc.def; next"), "Authorization: Bearer [redacted]; next");
        assert_eq!(scrub("plain line 401 /v1/catalog"), "plain line 401 /v1/catalog");
    }

    #[test]
    fn scrubs_registered_secret() {
        super::register_secret("AgNotAJwtShapedMusicUserToken0123456789");
        assert_eq!(scrub("mut=AgNotAJwtShapedMusicUserToken0123456789 ok"), "mut=[redacted] ok");
        super::register_secret("short"); // ignored: would redact ordinary words
        assert_eq!(scrub("a short word"), "a short word");
    }
}
