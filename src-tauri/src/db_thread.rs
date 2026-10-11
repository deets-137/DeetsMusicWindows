//! The database thread: every command that takes the database lock runs here, one at a
//! time, in the order its call arrived (his call, 2026-09-25; RELEASE.md §1 check 9).
//!
//! **Why off the UI thread.** A synchronous `#[tauri::command]` runs on the thread that
//! paints. The library sync and the playlist refresh hold `Db::lock` for whole write
//! batches, so a click that needed the lock during one froze the window for seconds.
//!
//! **Why one thread, not `spawn_blocking`.** A pool gives each call its own thread, and all
//! of them then wait on the same lock. Windows does not hand a waiting lock out in arrival
//! order, so two quick writes to one row during a sync could land in the wrong order: a
//! Diary score tapped 7 then 8 could be stored as 7. One thread takes the jobs from one
//! queue, first in, first out. The commands already ran one at a time behind the lock, so
//! nothing that was parallel before is serial now.
//!
//! **What it does not change.** A call made during a sync still waits for the sync to let
//! the lock go. The window no longer freezes while it waits.
//!
//! **The slow-job line (2026-10-10, ideas/WORKERS.md §5.1).** A job that waited in the
//! queue or ran for `SLOW_MS` or more writes `db: slow {name} waited N ms, ran N ms`.
//! `waited` is the time behind other jobs; `ran` includes any wait for a lock that a sync
//! holds outside this thread. If `waited` never prints, reads do not need their own
//! connection.
//!
//! **The limit.** One command prints at most one line per `WINDOW`. The first slow job
//! prints at once; the slow jobs after it in that minute are held, and when the minute
//! closes one line gives their count and the worst of each time:
//! `db: slow {name} ×N more in 60 s, worst waited N ms, ran N ms`. A command that is slow
//! on every call cannot flood the 400-line ring or rotate the file early. The summary is
//! written by the first database job after the minute closes, so it can come late on an
//! idle app; it is never lost while the app runs.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use futures::channel::oneshot;
use tauri::{AppHandle, Manager};

use crate::library::Db;
use crate::lock::LockExt;

type Job = Box<dyn FnOnce(&Db) + Send>;

/// A job at or over this, waiting or running, writes the slow-job line.
const SLOW_MS: u128 = 50;
/// One line per command per window; the rest are counted into its summary.
const WINDOW: Duration = Duration::from_secs(60);

/// The command a job came from, read off its closure's type:
/// `deetsmusic_lib::diary::diary_list::{{closure}}::{{closure}}` → `diary::diary_list`.
fn short_name(type_name: &str) -> String {
    type_name
        .split("::")
        .filter(|part| !part.starts_with('{'))
        .skip(1)
        .collect::<Vec<_>>()
        .join("::")
}

/// The slow jobs one command had since its line printed.
struct Held {
    opened: Instant,
    count: u32,
    worst_wait: u128,
    worst_ran: u128,
}

/// The limit on the slow-job line. Keyed by the closure's type name, so the map holds at
/// most one entry per command (about 80) and a closed window leaves it on the next sweep.
#[derive(Default)]
struct SlowGate {
    open: HashMap<&'static str, Held>,
    /// The earliest close of a window that holds jobs; `sweep` does nothing before it.
    due: Option<Instant>,
}

impl SlowGate {
    /// A slow job. The line to write now, or `None` when its window holds it.
    fn note(&mut self, key: &'static str, now: Instant, waited: u128, ran: u128) -> Option<String> {
        match self.open.get_mut(key) {
            Some(h) if now.duration_since(h.opened) < WINDOW => {
                h.count += 1;
                h.worst_wait = h.worst_wait.max(waited);
                h.worst_ran = h.worst_ran.max(ran);
                let close = h.opened + WINDOW;
                self.due = Some(self.due.map_or(close, |d| d.min(close)));
                None
            }
            _ => {
                self.open.insert(key, Held { opened: now, count: 0, worst_wait: 0, worst_ran: 0 });
                Some(format!("db: slow {} waited {waited} ms, ran {ran} ms", short_name(key)))
            }
        }
    }

    /// The summaries of the windows that closed with jobs held. Closed windows leave the map.
    fn sweep(&mut self, now: Instant) -> Vec<String> {
        if self.due.map_or(true, |d| now < d) {
            return Vec::new();
        }
        let mut lines = Vec::new();
        let mut next: Option<Instant> = None;
        self.open.retain(|key, h| {
            let close = h.opened + WINDOW;
            if now < close {
                if h.count > 0 {
                    next = Some(next.map_or(close, |n| n.min(close)));
                }
                return true;
            }
            if h.count > 0 {
                lines.push(format!(
                    "db: slow {} ×{} more in {} s, worst waited {} ms, ran {} ms",
                    short_name(key),
                    h.count,
                    WINDOW.as_secs(),
                    h.worst_wait,
                    h.worst_ran
                ));
            }
            false
        });
        self.due = next;
        lines
    }
}

thread_local! {
    /// Only the `db` thread runs jobs, so the gate needs no lock.
    static GATE: RefCell<SlowGate> = RefCell::new(SlowGate::default());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_name_drops_the_crate_and_the_closures_2026_10_10() {
        assert_eq!(
            short_name("deetsmusic_lib::diary::diary_list::{{closure}}::{{closure}}"),
            "diary::diary_list"
        );
        fn name_of<F>(_: &F) -> String {
            short_name(std::any::type_name::<F>())
        }
        let f = || ();
        assert!(name_of(&f).ends_with("short_name_drops_the_crate_and_the_closures_2026_10_10"));
    }

    #[test]
    fn slow_gate_prints_once_a_minute_then_sums_up_2026_10_10() {
        let t0 = Instant::now();
        let at = |s: u64| t0 + Duration::from_secs(s);
        let mut g = SlowGate::default();
        let key = "deetsmusic_lib::library::library_tracks::{{closure}}";

        assert_eq!(
            g.note(key, at(0), 10, 120).as_deref(),
            Some("db: slow library::library_tracks waited 10 ms, ran 120 ms")
        );
        assert_eq!(g.note(key, at(5), 300, 90), None);
        assert_eq!(g.note(key, at(30), 40, 200), None);
        assert!(g.sweep(at(59)).is_empty(), "the window is still open");

        assert_eq!(
            g.sweep(at(61)),
            vec!["db: slow library::library_tracks ×2 more in 60 s, worst waited 300 ms, ran 200 ms"]
        );
        assert!(g.open.is_empty() && g.due.is_none(), "the closed window left the map");
        assert!(g.note(key, at(62), 60, 0).is_some(), "a new window prints at once");
    }

    #[test]
    fn slow_gate_a_quiet_window_writes_no_summary_2026_10_10() {
        let t0 = Instant::now();
        let mut g = SlowGate::default();
        assert!(g.note("a::b::c", t0, 70, 0).is_some());
        assert!(g.sweep(t0 + Duration::from_secs(120)).is_empty());
        assert!(g.note("a::b::c", t0 + Duration::from_secs(121), 70, 0).is_some());
    }
}

/// The queue's sending end, in Tauri's state. `Sender` is not `Sync`, hence the mutex; it
/// is held only for the `send`.
pub struct DbThread(Mutex<Sender<Job>>);

/// Start the thread. Call once, after `Db` is managed.
pub fn start(app: &AppHandle) {
    let (tx, rx) = channel::<Job>();
    let handle = app.clone();
    std::thread::Builder::new()
        .name("db".into())
        .spawn(move || {
            let db = handle.state::<Db>();
            // A job that panics is caught here, so one bad call cannot end the thread and
            // leave every later command waiting for ever. Its caller sees an error.
            for job in rx {
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| job(&db)));
            }
        })
        .expect("start the database thread");
    app.manage(DbThread(Mutex::new(tx)));
}

/// Run `f` on the database thread and wait for its answer without holding the UI thread.
pub async fn run<T, F>(app: &AppHandle, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&Db) -> Result<T, String> + Send + 'static,
{
    let (tx, rx) = oneshot::channel();
    let queued = Instant::now();
    let job: Job = Box::new(move |db| {
        let started = Instant::now();
        let out = f(db);
        let now = Instant::now();
        let waited = started.duration_since(queued).as_millis();
        let ran = now.duration_since(started).as_millis();
        GATE.with(|gate| {
            let mut gate = gate.borrow_mut();
            let mut lines = gate.sweep(now);
            if waited >= SLOW_MS || ran >= SLOW_MS {
                lines.extend(gate.note(std::any::type_name::<F>(), now, waited, ran));
            }
            for line in lines {
                crate::log::info(&line);
            }
        });
        let _ = tx.send(out);
    });
    app.state::<DbThread>()
        .0
        .lock_or_recover()
        .send(job)
        .map_err(|_| "the database thread has stopped".to_string())?;
    rx.await.map_err(|_| "a database call failed on its thread".to_string())?
}
