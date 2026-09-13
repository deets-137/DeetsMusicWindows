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
//!   is replaced. The app holds two bearer credentials, the file is readable
//!   over loopback, and it becomes the body of a bug report.
//! - **Never panic**: a log line must never take the app down. Every I/O
//!   result is dropped.
//!
//! Call sites log **catalog ids, never track titles** — a log full of titles
//! is a listening history.

use std::collections::VecDeque;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const FILE: &str = "deetsmusic.log";
const PREV: &str = "deetsmusic.1.log";
const LEGACY: &str = "bridge.log";
const ROTATE_AT: u64 = 512 * 1024;
const RING_CAP: usize = 400;

static PATH: OnceLock<PathBuf> = OnceLock::new();
static RING: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());

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
        "start: DeetsMusic {} · Windows {} · data dir {which}",
        env!("CARGO_PKG_VERSION"),
        windows_build()
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
    let Some(path) = PATH.get() else { return };
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        for l in body {
            let _ = writeln!(f, "    {}", scrub(l));
        }
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

    let Some(path) = PATH.get() else { return };
    if std::fs::metadata(path).map(|m| m.len() > ROTATE_AT).unwrap_or(false) {
        // Two files rather than a truncate: the run-up to a fault is the part
        // worth reading.
        let _ = std::fs::rename(path, path.with_file_name(PREV));
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{line}");
    }
}

/// Replace anything shaped like a JWT (`eyJ` + base64url with dots) and anything
/// following `Bearer ` up to the next whitespace.
fn scrub(msg: &str) -> String {
    let mut out = String::with_capacity(msg.len());
    let mut rest = msg;
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
}
