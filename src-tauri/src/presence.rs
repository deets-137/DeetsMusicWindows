//! Discord Rich Presence — the local pipe, and nothing else (docs/FRIENDS.md §8).
//!
//! The Discord desktop client listens on a named pipe, `\\.\pipe\discord-ipc-N`. A client
//! opens it, sends a handshake carrying an **application id**, and then sends an activity
//! whenever it changes. **Nothing leaves this machine.** There is no bot, no token, no
//! OAuth and no server (§8.6 asked and closed that); the application id is public by
//! design, so it is a constant here and not a secret.
//!
//! **The pipe IS the presence.** Discord shows the activity for exactly as long as the
//! connection lives, and drops it the moment the pipe closes — so quitting the app clears
//! the profile whether or not anyone asked it to.
//!
//! This file holds NO POLICY. What to show, when to coalesce, when to clear and whether
//! the user consented at all are `src/presence.ts`'s, beside the settings that decide them.
//! The one rule kept here is the one that cannot be kept there: with sharing off the front
//! end never calls, so the pipe is never opened.
//!
//! Frame format: 4-byte little-endian opcode, 4-byte little-endian length, then JSON.
//! Opcode 0 = handshake, 1 = a command frame. Discord answers every frame, so a reader
//! thread drains the replies — unread replies would fill the pipe's buffer and block a
//! later write.

use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::sync::Mutex;

use serde_json::{json, Value};

/// The owner's Discord application. Its NAME is what the card's headline reads
/// ("Listening to DeetsMusic", §8.4a), so it is not interchangeable with any other id.
const APP_ID: &str = "1551307746115059883";

const OP_HANDSHAKE: i32 = 0;
const OP_FRAME: i32 = 1;

static CONN: Mutex<Option<File>> = Mutex::new(None);

fn frame(op: i32, payload: &Value) -> Vec<u8> {
    let body = payload.to_string();
    let mut out = Vec::with_capacity(8 + body.len());
    out.extend_from_slice(&op.to_le_bytes());
    out.extend_from_slice(&(body.len() as i32).to_le_bytes());
    out.extend_from_slice(body.as_bytes());
    out
}

/// Open the pipe and shake hands. Discord takes the first free number, so a second client
/// — or one left over from a crash — moves it along; nine is Discord's own ceiling.
fn connect() -> Result<File, String> {
    let mut last = String::from("no discord-ipc pipe answered");
    for n in 0..10 {
        let path = format!(r"\\.\pipe\discord-ipc-{n}");
        match OpenOptions::new().read(true).write(true).open(&path) {
            Ok(mut file) => {
                let hello = frame(OP_HANDSHAKE, &json!({ "v": 1, "client_id": APP_ID }));
                if let Err(e) = file.write_all(&hello) {
                    last = format!("handshake on {path}: {e}");
                    continue;
                }
                let _ = file.flush();
                // Drain Discord's replies for as long as this connection lives. It owns its
                // own handle, so a write on the other one is never blocked by a read here.
                if let Ok(mut reader) = file.try_clone() {
                    std::thread::spawn(move || {
                        let mut head = [0u8; 8];
                        loop {
                            if reader.read_exact(&mut head).is_err() {
                                break;
                            }
                            let len = i32::from_le_bytes([head[4], head[5], head[6], head[7]]).max(0) as usize;
                            if len > 0 {
                                let mut body = vec![0u8; len];
                                if reader.read_exact(&mut body).is_err() {
                                    break;
                                }
                            }
                        }
                        // Discord quit, or it closed us: the next call reconnects.
                        *CONN.lock().unwrap() = None;
                    });
                }
                crate::log::info("presence: connected to Discord");
                return Ok(file);
            }
            Err(e) => last = format!("{path}: {e}"),
        }
    }
    Err(last)
}

/// Write one command frame, opening the pipe if it is not open. `false` = Discord is not
/// there, which is not an error: it is the ordinary state of a PC with Discord closed
/// (§8.9), and it gets no toast and no retry loop.
fn send(payload: Value) -> Result<bool, String> {
    let mut guard = CONN.lock().unwrap();
    if guard.is_none() {
        match connect() {
            Ok(f) => *guard = Some(f),
            Err(e) => {
                crate::log::info(&format!("presence: no Discord ({e})"));
                return Ok(false);
            }
        }
    }
    let file = guard.as_mut().expect("just connected");
    let bytes = frame(OP_FRAME, &payload);
    match file.write_all(&bytes).and_then(|_| file.flush()) {
        Ok(()) => Ok(true),
        Err(e) => {
            // Discord went away mid-session. Drop the handle so the next call reconnects.
            *guard = None;
            crate::log::info(&format!("presence: write failed, dropped the pipe ({e})"));
            Ok(false)
        }
    }
}

fn set_activity(activity: Option<Value>) -> Result<bool, String> {
    let mut args = json!({ "pid": std::process::id() });
    if let Some(a) = activity {
        args["activity"] = a;
    }
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|_| "0".into());
    send(json!({ "cmd": "SET_ACTIVITY", "args": args, "nonce": nonce }))
}

/// Show this activity. The front end builds it whole (§8.7.1) — this never edits it, so a
/// field Discord adds later needs no change here.
#[tauri::command]
pub fn presence_set(activity: Value) -> Result<bool, String> {
    set_activity(Some(activity))
}

/// Take the card down now. An activity-less SET_ACTIVITY is Discord's own way to clear,
/// and it keeps the connection — the next song sets it again with no reconnect.
#[tauri::command]
pub fn presence_clear() -> Result<bool, String> {
    set_activity(None)
}

/// Close the pipe outright (the app is quitting, or sharing was switched off). Dropping the
/// handle is what Discord watches, so this is the one call that cannot leave a card behind.
#[tauri::command]
pub fn presence_close() -> Result<(), String> {
    let mut guard = CONN.lock().unwrap();
    if guard.is_some() {
        let _ = set_activity_locked(&mut guard);
        *guard = None;
        crate::log::info("presence: closed");
    }
    Ok(())
}

/// The clear written on the handle we are about to drop, so the card goes even on a client
/// that would otherwise keep it for a moment after the pipe closes.
fn set_activity_locked(guard: &mut Option<File>) -> std::io::Result<()> {
    if let Some(file) = guard.as_mut() {
        let payload = json!({
            "cmd": "SET_ACTIVITY",
            "args": { "pid": std::process::id() },
            "nonce": "close",
        });
        file.write_all(&frame(OP_FRAME, &payload))?;
        file.flush()?;
    }
    Ok(())
}
