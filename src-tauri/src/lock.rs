//! `Mutex::lock_or_recover()` — the poison fix of `Db::lock` (DB-HEALTH.md), for every other
//! mutex in the app (his call, 2026-09-25).
//!
//! A `std::sync::Mutex` **poisons** when a thread panics while it holds the lock. With a
//! plain `.lock().unwrap()`, every later lock then panics too: one panic in the Apple token
//! refresh, the AirPlay session or the Last.fm queue would take that part of the app down
//! until a restart. There were ~150 such calls.
//!
//! Recovering is safe for these mutexes: each guards a small value (a token, an `Option` of
//! a session, a flag, a list) that is replaced whole, never a multi-step invariant a panic
//! could leave half-done. So the data is sound, and we take it back rather than spread
//! the panic. The first poisoning is logged with the caller's file and line.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};

static LOGGED: AtomicBool = AtomicBool::new(false);

pub trait LockExt<T> {
    /// The guard, poisoned or not. Use it in place of `.lock().unwrap()`.
    fn lock_or_recover(&self) -> MutexGuard<'_, T>;
}

impl<T> LockExt<T> for Mutex<T> {
    #[track_caller]
    fn lock_or_recover(&self) -> MutexGuard<'_, T> {
        match self.lock() {
            Ok(g) => g,
            Err(poisoned) => {
                // Only the first is loud: after one poisoning, every later lock reports it too.
                if !LOGGED.swap(true, Ordering::Relaxed) {
                    let at = std::panic::Location::caller();
                    crate::log::warn(&format!(
                        "lock: a mutex was poisoned at {}:{} - a thread panicked while holding it; recovered",
                        at.file(),
                        at.line()
                    ));
                }
                poisoned.into_inner()
            }
        }
    }
}
