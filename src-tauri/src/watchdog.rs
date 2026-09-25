//! Is the window still answering? (docs/ops/LOGGING.md · FRIENDS.md §8.11)
//!
//! On 2026-09-20 the app froze on live and stayed frozen for 36 minutes. It wrote **nothing**
//! about it. The log simply stopped, and the only proof of what had happened came from the
//! Windows Application log — `AppHangB1`, hours later. A freeze is the one failure that
//! cannot report itself, because the thread that would report it is the thread that is stuck.
//!
//! So something else watches. A thread outside the event loop asks the UI thread to say it is
//! alive, every `BEAT_EVERY`. The ask does not block: it posts a closure and walks away. If
//! the closure has not run for `STALL_AFTER`, the UI thread is wedged, and **the watching
//! thread can still write to the log**, because logging never touches the event loop.
//!
//! It names the command in flight, when there is one. `lib.rs` wraps the invoke handler so
//! every command records its name on the way in and clears it on the way out — an async
//! command clears almost at once (its body runs elsewhere), so a name that is still there
//! after five seconds is a SYNCHRONOUS command blocking the thread that paints. That is
//! exactly the shape of the 0.12.0 fault, and it is the line that would have named
//! `presence_set` in one second instead of an afternoon.
//!
//! This is not dev-only telemetry. It ships. It costs one wake per `BEAT_EVERY` and two
//! atomics, and it buys a log line for the failure that is otherwise invisible.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::AppHandle;

/// How often the UI thread is asked to answer. Every wake keeps the event loop from idling,
/// so this is deliberately slow: it is a smoke alarm, not a profiler.
const BEAT_EVERY: Duration = Duration::from_secs(2);
/// How long the UI thread may stay silent before we call it a stall. Generous on purpose —
/// a slow frame, a big sort or a cold paint must never write this line.
const STALL_AFTER: Duration = Duration::from_secs(5);
/// The watcher's own `BEAT_EVERY` sleep took this long or longer: the PC was asleep. A frozen
/// UI thread never delays the watcher, so this cannot hide a real stall. Before 2026-09-25 a
/// sleep read as "the window stopped answering 1801.6 s ago" (four times in two days).
const ASLEEP_AFTER: Duration = Duration::from_secs(BEAT_EVERY.as_secs() + STALL_AFTER.as_secs());

static ORIGIN: OnceLock<Instant> = OnceLock::new();
static LAST_BEAT: AtomicU64 = AtomicU64::new(0);
/// The command the UI thread entered and has not left. `None` between commands.
static IN_FLIGHT: Mutex<Option<(String, Instant)>> = Mutex::new(None);

fn now_ms() -> u64 {
    ORIGIN.get_or_init(Instant::now).elapsed().as_millis() as u64
}

/// A command is starting on the UI thread. Called by the invoke wrapper in `lib.rs`.
pub fn entered(name: &str) {
    *IN_FLIGHT.lock().unwrap_or_else(|e| e.into_inner()) = Some((name.to_string(), Instant::now()));
}

/// That command returned. An async command reaches this almost at once, because its body
/// runs on another thread — which is the whole point of the distinction.
pub fn left() {
    *IN_FLIGHT.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

/// What to blame, if anything is still in flight.
fn blame() -> String {
    match IN_FLIGHT.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        Some((name, since)) => format!(" — inside command `{name}` for {:.1} s", since.elapsed().as_secs_f64()),
        None => String::from(" — no command was in flight, so it is not an invoke"),
    }
}

/// Start watching. Safe to call once, from `setup`.
pub fn start(app: &AppHandle) {
    ORIGIN.get_or_init(Instant::now);
    LAST_BEAT.store(now_ms(), Ordering::Relaxed);
    let app = app.clone();
    let started = std::thread::Builder::new().name("watchdog".into()).spawn(move || {
        let mut told = false;
        loop {
            // Posting is not waiting. If the UI thread is wedged this closure simply never
            // runs, and that silence is the measurement.
            let _ = app.run_on_main_thread(|| LAST_BEAT.store(now_ms(), Ordering::Relaxed));
            let slept_from = Instant::now();
            std::thread::sleep(BEAT_EVERY);
            let slept = slept_from.elapsed();
            if slept >= ASLEEP_AFTER {
                // The whole process was stopped, not the UI thread: start the count again.
                crate::log::info(&format!("ui: the PC was asleep for {} s", slept.as_secs()));
                LAST_BEAT.store(now_ms(), Ordering::Relaxed);
                continue;
            }
            let quiet = now_ms().saturating_sub(LAST_BEAT.load(Ordering::Relaxed));
            if quiet >= STALL_AFTER.as_millis() as u64 {
                if !told {
                    told = true;
                    crate::log::warn(&format!("ui: the window stopped answering {:.1} s ago{}", quiet as f64 / 1000.0, blame()));
                }
            } else if told {
                told = false;
                crate::log::info("ui: the window is answering again");
            }
        }
    });
    if let Err(e) = started {
        crate::log::warn(&format!("watchdog: not started ({e})"));
    }
}
