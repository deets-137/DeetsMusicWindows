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
    "apple", "app", "audio-out", "autostart", "bridge", "db", "dev", "enrich", "fe", "friends",
    "gpu", "launch", "lastfm", "library", "playlists", "report", "rooms", "settings", "sign-in",
    "smtc", "sotd", "token", "ui", "update", "usage", "watchdog", "web", "webview",
];

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
}

impl Counts {
    fn add(&mut self, o: &Counts) {
        for (k, v) in &o.error {
            *self.error.entry(k.clone()).or_default() += v;
        }
        for (k, v) in &o.warn {
            *self.warn.entry(k.clone()).or_default() += v;
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
    let word = msg.split_once(':').map(|(w, _)| w).unwrap_or("");
    with_now(|c| {
        if word == "panic" {
            c.panics += 1;
            return;
        }
        let area = AREAS.iter().find(|a| **a == word).copied().unwrap_or("other");
        let map = if level.starts_with("ERROR") { &mut c.error } else { &mut c.warn };
        *map.entry(area.to_string()).or_default() += 1;
    });
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
/// `dev:built`, and that run must never count as a live user (§2 rule 11).
fn channel() -> &'static str {
    if cfg!(debug_assertions) {
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

/// Send one report. `day` and `settings` come from the front end (Rust sets `channel`, and `v`
/// on the day count); `health` is the pending week from the file, and leaves the file once the
/// worker has it. `Ok(false)`: nothing to send, or no worker for this build.
#[tauri::command]
pub async fn usage_send(kind: String, body: Option<serde_json::Value>) -> Result<bool, String> {
    let Some(base) = base() else {
        crate::log::info(&format!("usage: {kind} not sent: a dev build sends only to DEETS_USAGE_BASE"));
        return Ok(false);
    };
    let (mut body, health_week) = match kind.as_str() {
        "day" | "settings" => {
            let Some(serde_json::Value::Object(map)) = body else { return Err("usage: the report is not an object".into()) };
            let mut v = serde_json::Value::Object(map);
            if kind == "day" {
                v["v"] = env!("CARGO_PKG_VERSION").into();
            }
            (v, None)
        }
        "health" => {
            let pending = tauri::async_runtime::spawn_blocking(|| {
                fold();
                path().map(|p| read(&p)).and_then(|f| f.pending)
            })
            .await
            .map_err(|e| e.to_string())?;
            let Some((week, counts)) = pending else { return Ok(false) };
            (counts.report(&week), Some(week))
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
    let mut req = client.post(format!("{base}/usage/{kind}")).header("Content-Type", "application/json");
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
