//! Apple calls: the counter and the 429 back-off (docs/ops/APPLE-CALLS.md, built 2026-09-25).
//!
//! Every Apple Music API call goes through one of `apple.rs`'s four functions (`api_get`,
//! `api_post`, `api_send`, `status_only`). Each reports its reply here: `count` adds it to the
//! counter, and a 429 arms the back-off.
//!
//! **Background or user.** A job the app starts on its own (a timer, a launch sync) runs its
//! body inside `background(job, …)`, a tokio task-local scope, so every call in its tree —
//! helpers included — is known to be background. While a back-off holds, a background job
//! skips its turn (`skip`), and a 429 inside one shows no toast. A user call (a click, a key, an
//! agent request) always goes out, and its 429 tells the front end (`apple-busy`).

use std::collections::HashSet;
use std::future::Future;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use tauri::{AppHandle, Emitter};

use crate::lock::LockExt;

tokio::task_local! {
    static BACKGROUND: &'static str;
}

/// Run a background job's body in the background scope (see the module note).
pub async fn background<F: Future>(job: &'static str, f: F) -> F::Output {
    BACKGROUND.scope(job, f).await
}

/// The background job this call runs inside, if any.
fn current_job() -> Option<&'static str> {
    BACKGROUND.try_with(|j| *j).ok()
}

static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

// ── A: the counter (§2) ───────────────────────────────────────────────────────

const GROUPS: [&str; 6] = ["library", "me", "catalog", "search", "write", "probe"];
const CLASSES: [&str; 8] = ["2xx", "401", "403", "404", "429", "4xx", "5xx", "net"];
type Table = [[u32; CLASSES.len()]; GROUPS.len()];

struct Counts {
    hour: Table,
    total: Table,
}

static COUNTS: Mutex<Counts> = Mutex::new(Counts {
    hour: [[0; CLASSES.len()]; GROUPS.len()],
    total: [[0; CLASSES.len()]; GROUPS.len()],
});

/// How the four functions name what they sent.
#[derive(Clone, Copy)]
pub enum Kind {
    Read,
    Write,
    Probe,
}

fn group_of(kind: Kind, url: &str) -> usize {
    let path = url.split_once("api.music.apple.com").map(|(_, p)| p).unwrap_or(url);
    let name = match kind {
        Kind::Probe => "probe",
        Kind::Write => "write",
        Kind::Read if path.starts_with("/v1/me/library") => "library",
        Kind::Read if path.starts_with("/v1/me") => "me",
        Kind::Read if path.contains("/search") => "search",
        Kind::Read => "catalog",
    };
    GROUPS.iter().position(|g| *g == name).unwrap_or(0)
}

fn class_of(status: Option<u16>) -> usize {
    let name = match status {
        None => "net",
        Some(200..=299) => "2xx",
        Some(401) => "401",
        Some(403) => "403",
        Some(404) => "404",
        Some(429) => "429",
        Some(400..=499) => "4xx",
        Some(_) => "5xx",
    };
    CLASSES.iter().position(|c| *c == name).unwrap_or(0)
}

/// One reply (or `None`: no reply at all). The retry after a 401 heal counts again: Apple saw
/// two requests.
pub fn count(kind: Kind, url: &str, status: Option<u16>) {
    let (g, c) = (group_of(kind, url), class_of(status));
    let mut t = COUNTS.lock_or_recover();
    t.hour[g][c] += 1;
    t.total[g][c] += 1;
}

/// `library 12 · catalog 40 (404 ×1) · … · 429 0`, groups with no call left out.
fn summary(t: &Table) -> (String, u32) {
    let mut parts = Vec::new();
    let mut all = 0;
    let too_many = CLASSES.iter().position(|c| *c == "429").unwrap_or(0);
    let mut busy = 0;
    for (g, row) in t.iter().enumerate() {
        let n: u32 = row.iter().sum();
        if n == 0 {
            continue;
        }
        all += n;
        busy += row[too_many];
        let odd: Vec<String> = row
            .iter()
            .enumerate()
            .filter(|(c, v)| *c != 0 && **v > 0)
            .map(|(c, v)| format!("{} ×{v}", CLASSES[c]))
            .collect();
        parts.push(if odd.is_empty() { format!("{} {n}", GROUPS[g]) } else { format!("{} {n} ({})", GROUPS[g], odd.join(", ")) });
    }
    parts.push(format!("429 {busy}"));
    (parts.join(" · "), all)
}

/// Write the hour's line if the hour had any call, then start a new hour. `why`: "1h" or "quit".
pub fn report(why: &str) {
    let (hour, total, calls) = {
        let mut t = COUNTS.lock_or_recover();
        let (hour, calls) = summary(&t.hour);
        let (total, _) = summary(&t.total);
        t.hour = [[0; CLASSES.len()]; GROUPS.len()];
        (hour, total, calls)
    };
    if calls == 0 {
        return;
    }
    crate::log::info(&format!("[apple] calls {why}: {hour} | since launch: {total}"));
    diag(serde_json::json!({ "tag": "apple:calls", "why": why, "hour": hour, "total": total }));
}

/// The hourly line: one wake an hour (the watchdog's pattern), nothing else.
pub fn start(app: &AppHandle) {
    let _ = APP.set(app.clone());
    let _ = std::thread::Builder::new().name("apple-calls".into()).spawn(|| loop {
        std::thread::sleep(Duration::from_secs(3600));
        report("1h");
    });
}

/// A copy into the window's diag ring (CLAUDE.md checklist item 6), so `deetsmusic diag` sees it.
fn diag(payload: serde_json::Value) {
    if let Some(app) = APP.get() {
        let _ = app.emit("apple-calls-diag", payload);
    }
}

// ── B: the 429 back-off (§3) ──────────────────────────────────────────────────

const DEFAULT_WAIT: Duration = Duration::from_secs(60);
const MAX_WAIT: Duration = Duration::from_secs(600);

static BACKOFF_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);
/// The jobs that already logged a skip in this back-off (one line per job per back-off).
static SKIPPED: Mutex<Option<HashSet<&'static str>>> = Mutex::new(None);

/// `Retry-After` as seconds, or as an HTTP date. None when absent or unreadable.
fn retry_after(value: Option<&str>) -> Option<Duration> {
    let v = value?.trim();
    if let Ok(s) = v.parse::<u64>() {
        return Some(Duration::from_secs(s));
    }
    let at = httpdate::parse_http_date(v).ok()?;
    Some(at.duration_since(SystemTime::now()).unwrap_or(Duration::ZERO))
}

/// A 429 arrived. Hold the back-off at the later of the old end and this one (capped), and
/// tell the front end when the call was the user's.
pub fn on_429(url: &str, retry_after_header: Option<&str>) {
    let hinted = retry_after(retry_after_header);
    let wait = hinted.unwrap_or(DEFAULT_WAIT).min(MAX_WAIT);
    let path = url.split_once("api.music.apple.com").map(|(_, p)| p).unwrap_or(url).to_string();
    let until = Instant::now() + wait;
    let armed = {
        let mut b = BACKOFF_UNTIL.lock_or_recover();
        let fresh = b.is_none();
        if b.map(|old| until > old).unwrap_or(true) {
            *b = Some(until);
        }
        fresh
    };
    crate::log::warn(&format!("apple: back-off arm {}s ({path})", wait.as_secs()));
    diag(serde_json::json!({ "tag": "apple:backoffArm", "s": wait.as_secs(), "path": path, "job": current_job() }));
    if armed {
        *SKIPPED.lock_or_recover() = Some(HashSet::new());
        watch_for_end();
    }
    if current_job().is_none() {
        if let Some(app) = APP.get() {
            let _ = app.emit("apple-busy", serde_json::json!({ "s": wait.as_secs(), "hinted": hinted.is_some() }));
        }
    }
}

/// Log `back-off off` when the hold ends (it may be pushed later while we wait).
fn watch_for_end() {
    let _ = std::thread::Builder::new().name("apple-backoff".into()).spawn(|| loop {
        let until = *BACKOFF_UNTIL.lock_or_recover();
        let Some(until) = until else { return };
        let now = Instant::now();
        if now >= until {
            *BACKOFF_UNTIL.lock_or_recover() = None;
            *SKIPPED.lock_or_recover() = None;
            crate::log::info("apple: back-off off");
            diag(serde_json::json!({ "tag": "apple:backoffOff" }));
            return;
        }
        std::thread::sleep(until - now);
    });
}

/// How long the back-off still holds, if it does.
pub fn backing_off() -> Option<Duration> {
    let until = (*BACKOFF_UNTIL.lock_or_recover())?;
    until.checked_duration_since(Instant::now())
}

/// A background job asks before it calls: true = skip this turn (it tries at its next turn,
/// never in a loop). Logs once per job per back-off.
pub fn skip(job: &'static str) -> bool {
    let Some(left) = backing_off() else { return false };
    let first = SKIPPED.lock_or_recover().get_or_insert_with(HashSet::new).insert(job);
    if first {
        crate::log::info(&format!("apple: back-off skip {job} ({}s left)", left.as_secs()));
        diag(serde_json::json!({ "tag": "apple:backoffSkip", "job": job, "left": left.as_secs() }));
    }
    true
}

/// Inside a background job, the four functions refuse to call while the back-off holds — a
/// job that forgot its own `skip` still never adds to the load.
pub fn refuse_in_background() -> Result<(), String> {
    match current_job() {
        Some(job) if skip(job) => Err(BUSY.into()),
        _ => Ok(()),
    }
}

/// The error a background job returns when it skipped its turn. The front end matches it and
/// stays quiet (`isAppleBusy` in apple.ts): a skip is not a failure.
pub const BUSY: &str = "Apple Music is busy; this job waits for its next turn";

// ── The desk test's forced 429 (§5 step 2; dev builds only) ──────────────────────

/// (calls left, Retry-After seconds): the next calls answer 429 without going out.
static FORCED: Mutex<Option<(u32, u64)>> = Mutex::new(None);

/// Dev only: the next `n` Apple calls answer 429 with `Retry-After: secs`, sent nowhere.
/// `invoke("apple_force_429", { n: 1, secs: 30 })` from `scripts/webview-eval.mjs`.
#[tauri::command]
pub fn apple_force_429(n: u32, secs: u64) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("dev builds only".into());
    }
    *FORCED.lock_or_recover() = (n > 0).then_some((n, secs));
    crate::log::info(&format!("apple: forced 429 armed for {n} call(s), Retry-After {secs}"));
    Ok(())
}

/// A forced 429 is due: count it, arm the back-off as a real one would, and say so.
pub fn take_forced(kind: Kind, url: &str) -> bool {
    if !cfg!(debug_assertions) {
        return false;
    }
    let secs = {
        let mut f = FORCED.lock_or_recover();
        let Some((n, secs)) = *f else { return false };
        *f = (n > 1).then_some((n - 1, secs));
        secs
    };
    count(kind, url, Some(429));
    on_429(url, Some(&secs.to_string()));
    true
}

/// For the diag route and the agent: the counts and the back-off, now.
#[tauri::command]
pub fn apple_calls_status() -> serde_json::Value {
    let (hour, total) = {
        let t = COUNTS.lock_or_recover();
        (summary(&t.hour).0, summary(&t.total).0)
    };
    serde_json::json!({ "hour": hour, "total": total, "backoffS": backing_off().map(|d| d.as_secs()) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_2026_09_25() {
        assert_eq!(GROUPS[group_of(Kind::Read, "https://api.music.apple.com/v1/me/library/songs?limit=1")], "library");
        assert_eq!(GROUPS[group_of(Kind::Read, "https://api.music.apple.com/v1/me/storefront")], "me");
        assert_eq!(GROUPS[group_of(Kind::Read, "https://api.music.apple.com/v1/catalog/us/search?term=x")], "search");
        assert_eq!(GROUPS[group_of(Kind::Read, "https://api.music.apple.com/v1/catalog/us/songs/1")], "catalog");
        assert_eq!(GROUPS[group_of(Kind::Write, "https://api.music.apple.com/v1/me/library?ids[songs]=1")], "write");
        assert_eq!(GROUPS[group_of(Kind::Probe, "https://api.music.apple.com/v1/storefronts/us")], "probe");
    }

    #[test]
    fn classes_2026_09_25() {
        assert_eq!(CLASSES[class_of(Some(204))], "2xx");
        assert_eq!(CLASSES[class_of(Some(429))], "429");
        assert_eq!(CLASSES[class_of(Some(400))], "4xx");
        assert_eq!(CLASSES[class_of(Some(503))], "5xx");
        assert_eq!(CLASSES[class_of(None)], "net");
    }

    #[test]
    fn retry_after_2026_09_25() {
        assert_eq!(retry_after(Some("30")), Some(Duration::from_secs(30)));
        assert_eq!(retry_after(None), None);
        assert_eq!(retry_after(Some("soon")), None);
        // A date in the past means "now".
        assert_eq!(retry_after(Some("Wed, 21 Oct 2015 07:28:00 GMT")), Some(Duration::ZERO));
    }

    #[test]
    fn summary_2026_09_25() {
        let mut t: Table = [[0; CLASSES.len()]; GROUPS.len()];
        t[0][0] = 12; // library 2xx
        t[2][0] = 39; // catalog 2xx
        t[2][3] = 1; // catalog 404
        let (line, all) = summary(&t);
        assert_eq!(all, 52);
        assert_eq!(line, "library 12 · catalog 40 (404 ×1) · 429 0");
    }
}
