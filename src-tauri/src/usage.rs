//! Usage counts (docs/features/USAGE-COUNTS.md): the week's health counts and the one send.
//!
//! The front end (`src/usage.ts`) decides WHEN a report leaves: the off switch, the notice gate
//! and the random moments. This file holds what only Rust can see, and does every send:
//! - **The health counts** (§3.3): WARN and ERROR lines by area (`log.rs` calls `note_log`),
//!   panics (the panic hook's `panic:` line), freezes (`watchdog.rs`), database write failures
//!   (`dbhealth.rs`), Apple calls by group and status class and the 429 back-off arms
//!   (`apple_calls.rs`). Counts only: the text of a line never leaves the PC.
//! - **The week file** `usage-week.json`, beside the log: this ISO week's counts so far, and the
//!   last finished week's, waiting to be sent. Folded in at each hourly Apple calls line, at
//!   quit, and when the front end asks. A week not sent before the next one ends is dropped.
//! - **The send** (`usage_send`): from Rust, so no browser header or cookie rides along (§2
//!   rule 12). Rust sets `channel` and `v` itself. A debug build sends only to a local worker
//!   (`DEETS_USAGE_BASE`, a `wrangler dev` session) and to nothing without one (§1.7).

use crate::lock::LockExt;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

const BASE: &str = "https://support.deets.solutions";
const FILE: &str = "usage-week.json";
const SEND_TIMEOUT: Duration = Duration::from_secs(15);
/// A report body from the front end is a few kB at most (the settings report); the worker
/// takes 16 kB.
const BODY_MAX: usize = 12 * 1024;

/// The log areas sent by name: the word before the first `:` of a WARN or ERROR line, as the
/// code writes them on 2026-10-13. Any other area is counted as `other`. The worker takes any
/// short lowercase name, so a new area here needs no worker deploy.
const AREAS: &[&str] = &[
    "apple", "app", "audio-out", "autostart", "bridge", "db", "dev", "enrich", "friends",
    "gpu", "launch", "lastfm", "library", "playlists", "report", "rooms", "settings", "sign-in",
    "smtc", "sotd", "token", "ui", "update", "usage", "watchdog", "web", "webview",
];

/// A front-end line (`fe: player:stall {…}`) counts under `fe-` and its tag's family, so a week's
/// report says which part of the window failed: one `fe` bucket held every window error, MusicKit's
/// console errors and the error toasts at once (13 of 14 installs, week 2026-W43, and nothing to
/// tell them apart). A family not listed is `fe-other`. Each name is at most 16 characters, the
/// worker's limit.
const FE_FAMILIES: &[&str] = &[
    "account", "airplay", "apple", "boot", "console", "fetchwrap", "files", "filter", "friends",
    "lastfm", "library", "license", "net", "onboarding", "player", "playlist", "room", "rule",
    "settings", "sleep", "sound", "toast", "update", "usage", "web", "window",
];

/// The area of a front-end line's text after `fe:`.
fn fe_area(rest: &str) -> String {
    let family = rest.trim_start().split(|ch: char| ch == ':' || ch == ' ' || ch == '{').next().unwrap_or("");
    match FE_FAMILIES.iter().find(|f| **f == family) {
        Some(f) => format!("fe-{f}"),
        None => "fe-other".to_string(),
    }
}

const GROUPS: [&str; 6] = crate::apple_calls::GROUPS;
const CLASSES: [&str; 8] = crate::apple_calls::CLASSES;

/// One stretch of counts: since the last fold (in memory), or a whole week (in the file).
#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(default)]
struct Counts {
    error: BTreeMap<String, u64>,
    warn: BTreeMap<String, u64>,
    panics: u64,
    freezes: u64,
    db_write_fails: u64,
    backoff_arms: u64,
    /// GROUPS × CLASSES, as `apple_calls.rs` keeps them.
    apple: Vec<Vec<u64>>,
    /// ERROR lines by fingerprint (§16): the window's `fp` field, or a panic's file and line.
    errors: BTreeMap<String, u64>,
}

impl Counts {
    fn add(&mut self, o: &Counts) {
        for (k, v) in &o.error {
            *self.error.entry(k.clone()).or_default() += v;
        }
        for (k, v) in &o.warn {
            *self.warn.entry(k.clone()).or_default() += v;
        }
        for (k, v) in &o.errors {
            note_fp(&mut self.errors, k, *v);
        }
        self.panics += o.panics;
        self.freezes += o.freezes;
        self.db_write_fails += o.db_write_fails;
        self.backoff_arms += o.backoff_arms;
        self.apple_table();
        for (g, row) in o.apple.iter().enumerate().take(GROUPS.len()) {
            for (c, v) in row.iter().enumerate().take(CLASSES.len()) {
                self.apple[g][c] += v;
            }
        }
    }

    /// The table at its full size, whatever an older file held.
    fn apple_table(&mut self) {
        self.apple.resize(GROUPS.len(), Vec::new());
        for row in &mut self.apple {
            row.resize(CLASSES.len(), 0);
        }
    }

    /// The report as the worker takes it (USAGE-COUNTS.md §3.3), without `channel`.
    fn report(&self, week: &str) -> serde_json::Value {
        let mut apple = serde_json::Map::new();
        for (g, row) in self.apple.iter().enumerate().take(GROUPS.len()) {
            let mut classes = serde_json::Map::new();
            for (c, v) in row.iter().enumerate().take(CLASSES.len()) {
                if *v > 0 {
                    classes.insert(CLASSES[c].into(), (*v).into());
                }
            }
            if !classes.is_empty() {
                apple.insert(GROUPS[g].into(), classes.into());
            }
        }
        serde_json::json!({
            "v": env!("CARGO_PKG_VERSION"),
            "week": week,
            "log": { "error": self.error, "warn": self.warn },
            "panics": self.panics,
            "freezes": self.freezes,
            "dbWriteFails": self.db_write_fails,
            "apple": apple,
            "backoffArms": self.backoff_arms,
            "errors": self.errors,
        })
    }
}

/// The week file.
#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct WeekFile {
    /// The ISO week `counts` belongs to, "2026-W42".
    week: String,
    counts: Counts,
    /// The last finished week and its counts, until it is sent.
    pending: Option<(String, Counts)>,
}

/// Counts since the last fold into the file.
static NOW: Mutex<Option<Counts>> = Mutex::new(None);
/// One fold at a time: the hourly line, quit and a front-end read may meet.
static FOLD: Mutex<()> = Mutex::new(());

fn with_now(f: impl FnOnce(&mut Counts)) {
    // Not lock_or_recover: its first-poisoning line is a WARN, which comes back here.
    let mut g = match NOW.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    f(g.get_or_insert_with(Counts::default));
}

/// A WARN or ERROR line (log.rs `write`). `level` is "WARN " or "ERROR".
pub fn note_log(level: &str, msg: &str) {
    let (word, rest) = msg.split_once(':').unwrap_or(("", ""));
    with_now(|c| {
        if word == "panic" {
            c.panics += 1;
            if let Some(fp) = panic_fp(rest) {
                note_fp(&mut c.errors, &fp, 1);
            }
            return;
        }
        let area = log_area(word, rest);
        let error = level.starts_with("ERROR");
        if error && word == "fe" {
            if let Some(fp) = fe_fp(rest) {
                note_fp(&mut c.errors, fp, 1);
            }
        }
        let map = if error { &mut c.error } else { &mut c.warn };
        *map.entry(area).or_default() += 1;
    });
}

// ── Error fingerprints (§16, his call 1A, 2026-10-30) ───────────────────────────
// What broke and where in the code, never a message: `src/error-fp.ts` makes the window's
// (`window.TypeError@main.js:2:4439`), and a panic's is its source file and line. The worker
// holds them to the same characters.

/// At most this many fingerprints a week; any more count as `other`.
const MAX_FPS: usize = 30;

fn fp_ok(fp: &str) -> bool {
    let Some((head, place)) = fp.split_once('@') else { return false };
    let Some((family, name)) = head.split_once('.') else { return false };
    let part = |s: &str| !s.is_empty() && s.len() <= 48 && s.chars().all(|ch| ch.is_ascii_alphanumeric() || "_.:-".contains(ch));
    let (at, via) = place.split_once('<').map_or((place, None), |(a, v)| (a, Some(v)));
    !family.is_empty()
        && family.chars().all(|ch| ch.is_ascii_lowercase())
        && name.len() <= 24
        && name.chars().next().is_some_and(|ch| ch.is_ascii_alphabetic())
        && name.chars().all(|ch| ch.is_ascii_alphanumeric())
        && part(at)
        && via.is_none_or(part)
}

fn note_fp(map: &mut BTreeMap<String, u64>, fp: &str, n: u64) {
    let key = if map.contains_key(fp) || map.len() < MAX_FPS { fp } else { "other" };
    *map.entry(key.to_string()).or_default() += n;
}

/// The `"fp":"…"` field of a front-end ERROR line, when it passes the rule.
fn fe_fp(rest: &str) -> Option<&str> {
    let start = rest.find("\"fp\":\"")? + 6;
    let len = rest[start..].find('"')?;
    let fp = &rest[start..start + len];
    fp_ok(fp).then_some(fp)
}

/// A panic line's place (`… at src\usage.rs:140`) as `rust.panic@usage.rs:140`: the file name
/// only, so no folder of the machine that built it.
fn panic_fp(rest: &str) -> Option<String> {
    let at = rest.rsplit_once(" at ")?.1.trim();
    let (path, line) = at.rsplit_once(':')?;
    let file = path.rsplit(['/', '\\']).next()?;
    let fp = format!("rust.panic@{file}:{line}");
    fp_ok(&fp).then_some(fp)
}

/// The area a line counts under: `word` before its first `:`, `rest` after it.
fn log_area(word: &str, rest: &str) -> String {
    if word == "fe" {
        return fe_area(rest);
    }
    // A CSP block is its own area per directive, `csp-connect-src` (CSP.md §9, his call C1).
    let csp = word.strip_prefix("csp-").filter(|d| *d == "other" || crate::csp::DIRECTIVES.contains(d)).map(|_| word);
    csp.or_else(|| AREAS.iter().find(|a| **a == word).copied()).unwrap_or("other").to_string()
}

/// The window stopped answering (watchdog.rs).
pub fn note_freeze() {
    with_now(|c| c.freezes += 1);
}

/// A database write failed (dbhealth.rs).
pub fn note_db_fail() {
    with_now(|c| c.db_write_fails += 1);
}

/// The 429 back-off armed (apple_calls.rs).
pub fn note_backoff() {
    with_now(|c| c.backoff_arms += 1);
}

/// One Apple reply, by its group and status class indexes (apple_calls.rs `count`).
pub fn note_apple(group: usize, class: usize) {
    with_now(|c| {
        c.apple_table();
        if let Some(cell) = c.apple.get_mut(group).and_then(|r| r.get_mut(class)) {
            *cell += 1;
        }
    });
}

fn iso_week(at: chrono::DateTime<chrono::Utc>) -> String {
    use chrono::Datelike;
    let w = at.iso_week();
    format!("{}-W{:02}", w.year(), w.week())
}

fn path() -> Option<PathBuf> {
    crate::log::path().and_then(|p| p.parent()).map(|d| d.join(FILE))
}

fn read(path: &PathBuf) -> WeekFile {
    std::fs::read_to_string(path).map(|t| crate::safe_file::parse_lenient::<WeekFile>(&t).value).unwrap_or_default()
}

/// Fold the counts since the last fold into the week file, rolling a finished week into
/// `pending` (a pending week from before is dropped: never queued past its own week).
/// Blocking file work: call it from a background thread or `spawn_blocking`.
pub fn fold() {
    let _one = FOLD.lock_or_recover();
    let Some(path) = path() else { return };
    let fresh = {
        let mut g = match NOW.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        g.take().unwrap_or_default()
    };
    let mut file = read(&path);
    let week = iso_week(chrono::Utc::now());
    if file.week != week {
        if !file.week.is_empty() {
            file.pending = Some((std::mem::take(&mut file.week), std::mem::take(&mut file.counts)));
        }
        file.week = week;
        file.counts = Counts::default();
    }
    file.counts.add(&fresh);
    if let Ok(bytes) = serde_json::to_vec(&file) {
        if let Err(e) = crate::safe_file::write_atomic(&path, &bytes) {
            crate::log::info(&format!("usage week file not written: {e}"));
        }
    }
}

/// `live`, `beta` or `dev`, from the build itself: the page's DEV flag is false under
/// `dev:built`, and that run must never count as a live user (§2 rule 11). `owner` on the
/// owner's own PCs (§12.9 A6): the user environment variable `DEETS_USAGE_OWNER=1` (set once
/// with `setx`), so his installs and his test installs stay out of `live` and still reach the
/// admin page under their own channel. It names nothing about him.
fn channel() -> &'static str {
    if std::env::var("DEETS_USAGE_OWNER").is_ok_and(|v| v.trim() == "1") {
        "owner"
    } else if cfg!(debug_assertions) {
        "dev"
    } else if crate::beta::is_beta() {
        "beta"
    } else {
        "live"
    }
}

/// Where a report goes: the worker in a release build; in a debug build only a local worker
/// named by `DEETS_USAGE_BASE`, else nowhere.
fn base() -> Option<String> {
    if cfg!(debug_assertions) {
        let v = std::env::var("DEETS_USAGE_BASE").unwrap_or_default();
        let v = v.trim().trim_end_matches('/');
        return (!v.is_empty()).then(|| v.to_string());
    }
    Some(BASE.to_string())
}

/// What the health report holds: the last finished week (sent next), and this week so far.
/// Settings › About › *Show what is sent* shows both.
#[tauri::command]
pub async fn usage_health() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        fold();
        let file = path().map(|p| read(&p)).unwrap_or_default();
        let with_channel = |mut v: serde_json::Value| {
            v["channel"] = channel().into();
            v
        };
        serde_json::json!({
            "pending": file.pending.as_ref().map(|(w, c)| with_channel(c.report(w))),
            "current": with_channel(file.counts.report(&file.week)),
            "channel": channel(),
            "sends": base().is_some(),
        })
    })
    .await
    .map_err(|e| e.to_string())
}

/// Send one report. `day`, `settings`, `downloaded` and `applied` come from the front end
/// (Rust sets `channel`, `v` on the day count, `from` on a download and `to` on an applied
/// update: the running version is Rust's to say); `health` is the pending week from the file,
/// with the front end's `day` and `key` added, and leaves the file once the worker has it. The
/// two update kinds go to `/usage/update` (USAGE-COUNTS.md §12.2). `Ok(false)`: nothing to
/// send, or no worker for this build.
#[tauri::command]
pub async fn usage_send(kind: String, body: Option<serde_json::Value>) -> Result<bool, String> {
    let Some(base) = base() else {
        crate::log::info(&format!("usage: {kind} not sent: a dev build sends only to DEETS_USAGE_BASE"));
        return Ok(false);
    };
    let running = env!("CARGO_PKG_VERSION");
    let object = |body: Option<serde_json::Value>| match body {
        Some(serde_json::Value::Object(map)) => Ok(serde_json::Value::Object(map)),
        _ => Err(String::from("usage: the report is not an object")),
    };
    let (mut body, health_week, route) = match kind.as_str() {
        "day" | "settings" => {
            let mut v = object(body)?;
            if kind == "day" {
                v["v"] = running.into();
            }
            (v, None, kind.as_str())
        }
        "downloaded" | "applied" => {
            let mut v = object(body)?;
            v["event"] = kind.as_str().into();
            v[if kind == "downloaded" { "from" } else { "to" }] = running.into();
            (v, None, "update")
        }
        "health" => {
            let pending = tauri::async_runtime::spawn_blocking(|| {
                fold();
                path().map(|p| read(&p)).and_then(|f| f.pending)
            })
            .await
            .map_err(|e| e.to_string())?;
            let Some((week, counts)) = pending else { return Ok(false) };
            let mut report = counts.report(&week);
            // The front end's day and key (§12.9 A3, A4); nothing else of its body is taken.
            if let Some(serde_json::Value::Object(extra)) = body {
                for name in ["day", "key"] {
                    if let Some(v) = extra.get(name).filter(|v| v.is_string()) {
                        report[name] = v.clone();
                    }
                }
            }
            (report, Some(week), "health")
        }
        _ => return Err(format!("usage: no report kind {kind:?}")),
    };
    body["channel"] = channel().into();
    let text = body.to_string();
    if text.len() > BODY_MAX {
        return Err(format!("usage: the {kind} report is too large ({} bytes)", text.len()));
    }

    let client = reqwest::Client::builder()
        .timeout(SEND_TIMEOUT)
        .user_agent(format!("DeetsMusic/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.post(format!("{base}/usage/{route}")).header("Content-Type", "application/json");
    if let Some(key) = crate::apple::build_key() {
        req = req.header(crate::apple::BUILD_HEADER, key);
    }
    let status = req.body(text).send().await.map_err(|e| format!("usage: {kind} not sent: {e}"))?.status();
    if !status.is_success() {
        return Err(format!("usage: {kind} not sent: the worker answered {}", status.as_u16()));
    }
    if let Some(week) = health_week {
        tauri::async_runtime::spawn_blocking(move || {
            let _one = FOLD.lock_or_recover();
            let Some(path) = path() else { return };
            let mut file = read(&path);
            if file.pending.as_ref().is_some_and(|(w, _)| *w == week) {
                file.pending = None;
                if let Ok(bytes) = serde_json::to_vec(&file) {
                    let _ = crate::safe_file::write_atomic(&path, &bytes);
                }
            }
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    crate::log::info(&format!("usage: {kind} sent ({})", channel()));
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_week_names_the_thursday_year() {
        use chrono::TimeZone;
        assert_eq!(iso_week(chrono::Utc.with_ymd_and_hms(2026, 10, 13, 12, 0, 0).unwrap()), "2026-W42");
        assert_eq!(iso_week(chrono::Utc.with_ymd_and_hms(2027, 1, 1, 0, 0, 0).unwrap()), "2026-W53");
    }

    #[test]
    fn a_report_carries_counts_never_text() {
        let mut c = Counts::default();
        c.apple_table();
        c.apple[0][0] = 820;
        c.error.insert("lastfm".into(), 3);
        c.freezes = 1;
        let r = c.report("2026-W41");
        assert_eq!(r["apple"]["library"]["2xx"], 820);
        assert!(r["apple"].get("catalog").is_none(), "a group with no call is left out");
        assert_eq!(r["log"]["error"]["lastfm"], 3);
        assert_eq!(r["week"], "2026-W41");
        assert_eq!(r["freezes"], 1);
    }

    #[test]
    fn a_front_end_line_counts_by_its_family_2026_10_30() {
        assert_eq!(log_area("fe", " window:unhandledrejection {\"reason\":\"x\"}"), "fe-window");
        assert_eq!(log_area("fe", " toast {\"text\":\"x\"}"), "fe-toast");
        assert_eq!(log_area("fe", " sound:clockSlip {}"), "fe-sound");
        assert_eq!(log_area("fe", " rulezPlaylist:fail {}"), "fe-other", "a family not listed");
        assert_eq!(log_area("lastfm", " scrobble failed"), "lastfm");
        assert_eq!(log_area("nope", ""), "other");
        // Every name fits the worker's area rule: lowercase, at most 16 characters.
        for f in FE_FAMILIES {
            let a = format!("fe-{f}");
            assert!(a.len() <= 16 && a.chars().all(|ch| ch.is_ascii_lowercase() || ch == '-'), "{a}");
        }
    }

    #[test]
    fn an_error_counts_by_its_fingerprint_never_its_text_2026_10_30() {
        let line = r#" window:unhandledrejection {"reason":"Failed to fetch","at":"x","fp":"rejection.TypeError@main.js:2:4439<musickit.js:28:6351"}"#;
        assert_eq!(fe_fp(line), Some("rejection.TypeError@main.js:2:4439<musickit.js:28:6351"));
        assert_eq!(fe_fp(r#" toast {"text":"x"}"#), None, "no fp field");
        assert_eq!(fe_fp(r#" window:error {"fp":"window.Type Error@main.js:1:1"}"#), None, "a space fails the rule");
        assert_eq!(fe_fp(r#" window:error {"fp":"window.Error@C:\\Users\\x"}"#), None, "a path fails the rule");
        assert_eq!(
            panic_fp(r" called `Option::unwrap()` on a `None` value at src\usage.rs:140").as_deref(),
            Some("rust.panic@usage.rs:140"),
        );
        let mut m = BTreeMap::new();
        for k in 0..MAX_FPS + 5 {
            note_fp(&mut m, &format!("window.Error@main.js:{k}:1"), 1);
        }
        assert_eq!(m.len(), MAX_FPS + 1, "past the cap, one `other`");
        assert_eq!(m["other"], 5);
        let mut c = Counts::default();
        c.errors.insert("window.Error@main.js:1:1".into(), 2);
        assert_eq!(c.report("2026-W44")["errors"]["window.Error@main.js:1:1"], 2);
    }

    #[test]
    fn counts_add_up_across_folds() {
        let mut a = Counts::default();
        let mut b = Counts::default();
        b.apple_table();
        b.apple[2][4] = 2;
        b.warn.insert("sign-in".into(), 5);
        a.add(&b);
        a.add(&b);
        assert_eq!(a.apple[2][4], 4);
        assert_eq!(a.warn["sign-in"], 10);
    }

    #[test]
    fn an_old_file_with_a_short_table_still_reads() {
        let f: WeekFile = crate::safe_file::parse_lenient(r#"{"week":"2026-W41","counts":{"apple":[[1]]}}"#).value;
        let mut c = f.counts.clone();
        c.apple_table();
        assert_eq!(c.apple.len(), GROUPS.len());
        assert_eq!(c.apple[0].len(), CLASSES.len());
        assert_eq!(c.apple[0][0], 1);
    }
}
