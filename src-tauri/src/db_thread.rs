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

use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;

use futures::channel::oneshot;
use tauri::{AppHandle, Manager};

use crate::library::Db;
use crate::lock::LockExt;

type Job = Box<dyn FnOnce(&Db) + Send>;

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
    let job: Job = Box::new(move |db| {
        let _ = tx.send(f(db));
    });
    app.state::<DbThread>()
        .0
        .lock_or_recover()
        .send(job)
        .map_err(|_| "the database thread has stopped".to_string())?;
    rx.await.map_err(|_| "a database call failed on its thread".to_string())?
}
