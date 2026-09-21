//! Is the database still writable? (docs/ops/DB-HEALTH.md)
//!
//! The app had no answer to that question. A failed write was warned about in 73 places,
//! swallowed in 4, and handed to the front end in 14 — where it was mostly logged and
//! dropped. Nothing counted. So "should we queue failed writes?" could not be answered:
//! we had never observed a write fail.
//!
//! This module measures instead of guessing. It does NOT retry, and it does not queue.
//! SQLite already retries the one failure that is common — contention — through the
//! `busy_timeout` set in `lib.rs`. What is left (a full disk, an I/O error, a read-only
//! file, corruption) is a **state**, not a blip: a queue would have to be written to the
//! disk that just refused a write. So we watch for the state, name it, and say so.
//!
//! Two things are recorded:
//!   - the **canary** — a write, a read back and a compare, on a timer. It proves the
//!     whole path works, not one statement.
//!   - **counted failures** — `note_fail` from the write paths that swallow their errors,
//!     and `note_poisoned` from `Db::lock`.

use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::Mutex;

use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::library::Db;

/// How often the canary runs. Long enough to cost nothing, short enough that a session
/// which goes bad is caught while the user is still in it.
const CANARY_EVERY: std::time::Duration = std::time::Duration::from_secs(10 * 60);

static WRITES_FAILED: AtomicU64 = AtomicU64::new(0);
static CANARY_RUNS: AtomicU64 = AtomicU64::new(0);
static CANARY_FAILS: AtomicU64 = AtomicU64::new(0);
static POISONED: AtomicU64 = AtomicU64::new(0);
static LAST_FAIL_AT: AtomicI64 = AtomicI64::new(0);
/// The user is told once a session, not once a failure.
static TOLD: AtomicBool = AtomicBool::new(false);
static LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);

pub fn init_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS db_canary (
            id       INTEGER PRIMARY KEY CHECK (id = 1),
            wrote_at INTEGER NOT NULL
        );",
    )
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// A write path that cannot return its error calls this instead of dropping it.
/// `area` is the write, in one or two words ("play", "scrobble", "credits").
pub fn note_fail(area: &str, err: &str) {
    WRITES_FAILED.fetch_add(1, Ordering::Relaxed);
    LAST_FAIL_AT.store(now_ms(), Ordering::Relaxed);
    if let Ok(mut last) = LAST_ERROR.lock() {
        *last = Some(format!("{area}: {err}"));
    }
    crate::log::warn(&format!("db: write failed ({area}): {err}"));
    tell_once();
}

/// `Db::lock` recovered a poisoned mutex: a thread panicked while it held the lock.
/// The data is sound (see `Db::lock`), but a panic happened and nobody saw it.
pub fn note_poisoned() {
    // Only the first is loud: after one poisoning, every later lock reports it too.
    if POISONED.fetch_add(1, Ordering::Relaxed) == 0 {
        crate::log::warn(
            "db: the connection lock was poisoned - a thread panicked while holding it; recovered",
        );
    }
}

/// `res` passed straight through, with a failure counted. Wrap a write that would
/// otherwise be dropped: `dbhealth::watch("play", conn.execute(...))`.
pub fn watch<T>(area: &str, res: rusqlite::Result<T>) -> rusqlite::Result<T> {
    if let Err(e) = &res {
        note_fail(area, &e.to_string());
    }
    res
}

/// Tell the user once a session that the app has stopped saving. Silence here is the
/// worst outcome: the app looks fine and forgets everything it is told.
fn tell_once() {
    if TOLD.swap(true, Ordering::Relaxed) {
        return;
    }
    if let Some(app) = crate::apple::app_handle() {
        use tauri::Emitter;
        let _ = app.emit("db-unwritable", ());
    }
}

// -- The canary --------------------------------------------------------------

/// Write, read back, compare. Returns the error when any step fails.
fn run_canary(conn: &Connection) -> Result<(), String> {
    let stamp = now_ms();
    conn.execute(
        "INSERT INTO db_canary(id, wrote_at) VALUES(1, ?1)
         ON CONFLICT(id) DO UPDATE SET wrote_at = excluded.wrote_at",
        [stamp],
    )
    .map_err(|e| format!("write: {e}"))?;
    let back: i64 = conn
        .query_row("SELECT wrote_at FROM db_canary WHERE id = 1", [], |r| r.get(0))
        .map_err(|e| format!("read back: {e}"))?;
    if back != stamp {
        return Err(format!("read back {back}, wrote {stamp}"));
    }
    Ok(())
}

/// One canary run against the live connection.
pub fn check(db: &Db) -> Result<(), String> {
    CANARY_RUNS.fetch_add(1, Ordering::Relaxed);
    let result = {
        let conn = db.lock();
        run_canary(&conn)
    };
    if let Err(e) = &result {
        CANARY_FAILS.fetch_add(1, Ordering::Relaxed);
        note_fail("canary", e);
    }
    result
}

/// Start the timer. Called once from `lib.rs` `setup()`, after the DB is managed.
/// The first run is immediate: a database that is already unwritable at startup is
/// exactly the case the user must hear about before an hour of listening goes missing.
pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        {
            use tauri::Manager;
            let db = app.state::<Db>();
            let _ = check(&db);
        }
        std::thread::sleep(CANARY_EVERY);
    });
}

// -- Reading it back ---------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbHealth {
    /// The canary passed just now.
    pub writable: bool,
    /// Why not, when it did not.
    pub error: Option<String>,
    pub canary_runs: u64,
    pub canary_fails: u64,
    /// Writes that failed and had no other way to report it.
    pub writes_failed: u64,
    /// Times `Db::lock` found the mutex poisoned (a panic while holding it).
    pub poisoned: u64,
    /// Epoch-ms of the newest failure of any kind; 0 when there has been none.
    pub last_fail_at: i64,
    pub last_error: Option<String>,
}

/// Run the canary now and report everything counted this session. No Apple call.
#[tauri::command]
pub fn db_health(db: State<'_, Db>) -> Result<DbHealth, String> {
    let result = check(&db);
    Ok(DbHealth {
        writable: result.is_ok(),
        error: result.err(),
        canary_runs: CANARY_RUNS.load(Ordering::Relaxed),
        canary_fails: CANARY_FAILS.load(Ordering::Relaxed),
        writes_failed: WRITES_FAILED.load(Ordering::Relaxed),
        poisoned: POISONED.load(Ordering::Relaxed),
        last_fail_at: LAST_FAIL_AT.load(Ordering::Relaxed),
        last_error: LAST_ERROR.lock().ok().and_then(|l| l.clone()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canary_round_trips() {
        let conn = Connection::open_in_memory().unwrap();
        init_tables(&conn).unwrap();
        assert!(run_canary(&conn).is_ok());
        assert!(run_canary(&conn).is_ok()); // the upsert arm, not only the insert
    }

    #[test]
    fn canary_reports_a_read_only_database() {
        let conn = Connection::open_in_memory().unwrap();
        init_tables(&conn).unwrap();
        conn.execute_batch("PRAGMA query_only = 1").unwrap();
        let err = run_canary(&conn).unwrap_err();
        assert!(err.starts_with("write:"), "unexpected error: {err}");
    }
}
