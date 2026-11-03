//! The Windows audio output (SOUND.md §2.2, §3B, §3C — phase 4).
//!
//! Sound needs three facts about where the music goes: which device (so the EQ remembers a
//! preset per output), its form factor (so crossfeed turns on for headphones), and the Windows
//! master volume (so Fuller at low volume follows App × Windows). One thread holds the COM
//! objects and waits on a channel. Windows calls two notice objects when the default output
//! changes or its volume moves; they only send a message, and the thread does the reads and
//! emits `audio-output` to the front end. No polling: an idle output costs nothing.
//!
//! Limit: this is the default output for the console role, the one WebView2 plays to. An
//! app-specific output set in Windows' "App volume and device preferences" is not followed.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

pub use crate::os::AudioOutput;

static CURRENT: Mutex<Option<AudioOutput>> = Mutex::new(None);

/// The last output read, for a front end that loads after the first notice.
#[tauri::command]
pub fn audio_output() -> Option<AudioOutput> {
    CURRENT.lock().ok().and_then(|c| c.clone())
}

pub fn setup(app: &AppHandle) {
    let app = app.clone();
    let spawned = std::thread::Builder::new().name("audio-out".into()).spawn(move || {
        if let Err(e) = crate::os::audio_out::watch(|next| changed(&app, next)) {
            crate::log::warn(&format!("audio-out: stopped: {e}"));
        }
    });
    if let Err(e) = spawned {
        crate::log::warn(&format!("audio-out: thread failed: {e}"));
    }
}

/// One read from the OS: store it, log a change of output, and tell the front end.
fn changed(app: &AppHandle, next: Option<AudioOutput>) {
    let changed = {
        let mut cur = CURRENT.lock().unwrap_or_else(|p| p.into_inner());
        let device_changed = cur.as_ref().map(|c| (&c.key, &c.name, &c.kind)) != next.as_ref().map(|n| (&n.key, &n.name, &n.kind));
        if device_changed {
            // One line per output change; volume moves are not logged (a drag sends dozens).
            match &next {
                Some(n) => crate::log::info(&format!("audio-out: {} ({})", n.name, n.kind)),
                None => crate::log::info("audio-out: none"),
            }
        }
        let changed = *cur != next;
        *cur = next.clone();
        changed
    };
    if changed {
        let _ = app.emit("audio-output", next);
    }
}
