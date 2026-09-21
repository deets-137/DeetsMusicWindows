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
//! Opcode 0 = handshake, 1 = a command frame. Discord answers every frame, so every reply
//! is read and dropped — unread replies would fill the pipe's buffer and block a later write.
//!
//! ## Why this file is shaped the way it is (§8.11, after the 0.12.0 freeze)
//!
//! 0.12.0 hung the whole app the first time a song changed with sharing on. Three faults,
//! and all three are answered here:
//!
//! 1. **The commands were synchronous.** A synchronous Tauri command runs on the UI thread,
//!    because WebView2 delivers the IPC message there. Every blocking pipe call was made on
//!    the thread that paints. Windows reported `AppHangB1`. The commands are now `async` and
//!    hand their work to `spawn_blocking`, the rule `media.rs` already wrote down.
//! 2. **The I/O had no deadline.** A named pipe opened through `OpenOptions` is in blocking
//!    mode: if Discord stops reading, `write_all` never returns. Every call here is
//!    **overlapped** and waits with a timeout, then cancels what it started.
//! 3. **A lock was held across the I/O.** The old `CONN` mutex was held for the whole write,
//!    and the reader thread needed that same lock to report the pipe was gone — so once the
//!    write wedged, nothing could ever free it. One thread now OWNS the pipe and no lock is
//!    held across any I/O at all.

use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, ERROR_IO_PENDING, HANDLE, WAIT_OBJECT_0};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, ReadFile, WriteFile, FILE_FLAG_OVERLAPPED, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
    FILE_SHARE_MODE, OPEN_EXISTING,
};
use windows::Win32::System::Pipes::WaitNamedPipeW;
use windows::Win32::System::Threading::{CreateEventW, ResetEvent, WaitForSingleObject};
use windows::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};

/// The owner's Discord application. Its NAME is what the card's headline reads
/// ("Listening to DeetsMusic", §8.4a), so it is not interchangeable with any other id.
const APP_ID: &str = "1551307746115059883";

const OP_HANDSHAKE: i32 = 0;
const OP_FRAME: i32 = 1;
/// Discord hanging up, with a reason in the body.
const OP_CLOSE: i32 = 2;

/// How long a busy pipe may take to free an instance before we try the next number.
const CONNECT_WAIT_MS: u32 = 200;
/// The deadline on any one read or write. Discord answers a local pipe in microseconds, so
/// two seconds is not a performance budget — it is the point where we call Discord broken.
const IO_TIMEOUT_MS: u32 = 2_000;
/// How long a drain waits for a reply that may not be there. One frame gets one reply, so
/// the first timeout means the buffer is empty and the drain is done.
const DRAIN_MS: u32 = 100;
/// How long a command waits for the pipe thread. Longer than `IO_TIMEOUT_MS`, so a single
/// slow frame answers honestly instead of being reported as "no Discord".
const ANSWER_TIMEOUT: Duration = Duration::from_secs(5);

fn frame(op: i32, payload: &Value) -> Vec<u8> {
    let body = payload.to_string();
    let mut out = Vec::with_capacity(8 + body.len());
    out.extend_from_slice(&op.to_le_bytes());
    out.extend_from_slice(&(body.len() as i32).to_le_bytes());
    out.extend_from_slice(body.as_bytes());
    out
}

// ── the pipe: overlapped, and every call has a deadline ───────────────────────

/// An overlapped handle on `\\.\pipe\discord-ipc-N`, plus the event its calls wait on.
/// Both handles close with the struct, so a dropped `Pipe` leaves nothing behind — and
/// dropping it is exactly what takes the card off Discord.
///
/// It never crosses a thread. One thread makes it, uses it and drops it (§8.11 fault 3).
struct Pipe {
    file: HANDLE,
    event: HANDLE,
}

impl Drop for Pipe {
    fn drop(&mut self) {
        unsafe {
            // Anything still in flight is cancelled before the handle goes, or the kernel
            // could write into an OVERLAPPED whose stack frame has gone.
            let _ = CancelIoEx(self.file, None);
            let _ = CloseHandle(self.file);
            let _ = CloseHandle(self.event);
        }
    }
}

impl Pipe {
    /// Wait for one overlapped operation. `Ok(None)` = it ran out of time and was cancelled.
    ///
    /// The cancel is then WAITED FOR. `CancelIoEx` only asks; until the kernel answers, the
    /// operation may still write into `ov`, which lives on the caller's stack.
    fn finish(&self, ov: *mut OVERLAPPED, started: windows::core::Result<()>, ms: u32) -> Result<Option<u32>, String> {
        if let Err(e) = started {
            if e.code() != ERROR_IO_PENDING.to_hresult() {
                return Err(e.message());
            }
        }
        if unsafe { WaitForSingleObject(self.event, ms) } != WAIT_OBJECT_0 {
            unsafe {
                let _ = CancelIoEx(self.file, Some(ov));
                let mut n = 0u32;
                let _ = GetOverlappedResult(self.file, ov, &mut n, true);
            }
            return Ok(None);
        }
        let mut n = 0u32;
        unsafe { GetOverlappedResult(self.file, ov, &mut n, false) }.map_err(|e| e.message())?;
        Ok(Some(n))
    }

    fn write(&self, bytes: &[u8]) -> Result<(), String> {
        let mut ov = OVERLAPPED { hEvent: self.event, ..Default::default() };
        unsafe { ResetEvent(self.event) }.map_err(|e| e.message())?;
        let started = unsafe { WriteFile(self.file, Some(bytes), None, Some(&mut ov)) };
        match self.finish(&mut ov, started, IO_TIMEOUT_MS)? {
            None => Err(format!("discord did not take the frame in {IO_TIMEOUT_MS} ms")),
            Some(n) if n as usize != bytes.len() => Err(format!("short write, {n} of {}", bytes.len())),
            Some(_) => Ok(()),
        }
    }

    /// Fill `buf` completely. `Ok(None)` means nothing at all was waiting, which is the
    /// ordinary end of a drain. Stopping part way through is not: Discord does not send
    /// half a frame, so that means the client is in trouble and the pipe is dropped.
    fn fill(&self, buf: &mut [u8], first_ms: u32) -> Result<Option<()>, String> {
        let mut got = 0usize;
        while got < buf.len() {
            let ms = if got == 0 { first_ms } else { IO_TIMEOUT_MS };
            let mut ov = OVERLAPPED { hEvent: self.event, ..Default::default() };
            unsafe { ResetEvent(self.event) }.map_err(|e| e.message())?;
            let started = unsafe { ReadFile(self.file, Some(&mut buf[got..]), None, Some(&mut ov)) };
            match self.finish(&mut ov, started, ms)? {
                None if got == 0 => return Ok(None),
                None => return Err("discord stopped part way through a reply".into()),
                Some(0) => return Err("discord closed the pipe".into()),
                Some(n) => got += n as usize,
            }
        }
        Ok(Some(()))
    }

    /// Read every reply that is waiting. Discord answers every frame, and an unread reply is
    /// what fills the buffer and blocks the NEXT write — so this is not tidying up, it is
    /// what keeps the pipe writable.
    ///
    /// **A refusal is READ, not dropped.** Discord answers a frame it dislikes with
    /// `evt: "ERROR"` and carries on, so a card that never appears looks exactly like a card
    /// that was sent — which is what made "Discord doesn't seem to be picking up my activity"
    /// take a probe to answer. Opcode 2 is Discord closing us, and it says why.
    fn drain(&self) -> Result<(), String> {
        loop {
            let mut head = [0u8; 8];
            if self.fill(&mut head, DRAIN_MS)?.is_none() {
                return Ok(());
            }
            let op = i32::from_le_bytes([head[0], head[1], head[2], head[3]]);
            let len = i32::from_le_bytes([head[4], head[5], head[6], head[7]]).max(0) as usize;
            let mut body = vec![0u8; len];
            if len > 0 && self.fill(&mut body, IO_TIMEOUT_MS)?.is_none() {
                return Err("discord stopped part way through a reply".into());
            }
            let text = String::from_utf8_lossy(&body);
            if op == OP_CLOSE {
                return Err(format!("discord closed us: {}", text.trim()));
            }
            if let Ok(v) = serde_json::from_str::<Value>(&text) {
                if v.get("evt").and_then(Value::as_str) == Some("ERROR") {
                    let d = &v["data"];
                    crate::log::warn(&format!(
                        "presence: discord refused the frame — {} (code {})",
                        d["message"].as_str().unwrap_or("no message"),
                        d["code"]
                    ));
                }
            }
        }
    }
}

/// Open the pipe and shake hands. Discord takes the first free number, so a second client
/// — or one left over from a crash — moves it along; nine is Discord's own ceiling.
///
/// `WaitNamedPipeW` runs first so a BUSY pipe waits here, with a deadline, instead of
/// inside `CreateFileW`, which would wait for as long as it took.
fn connect() -> Result<Pipe, String> {
    let mut last = String::from("no discord-ipc pipe answered");
    for n in 0..10 {
        let wide: Vec<u16> = format!(r"\\.\pipe\discord-ipc-{n}").encode_utf16().chain(std::iter::once(0)).collect();
        let name = PCWSTR(wide.as_ptr());
        unsafe { let _ = WaitNamedPipeW(name, CONNECT_WAIT_MS); }
        let file = match unsafe {
            CreateFileW(
                name,
                (FILE_GENERIC_READ | FILE_GENERIC_WRITE).0,
                FILE_SHARE_MODE(0),
                None,
                OPEN_EXISTING,
                FILE_FLAG_OVERLAPPED,
                None,
            )
        } {
            Ok(h) => h,
            Err(e) => {
                last = format!("discord-ipc-{n}: {}", e.message());
                continue;
            }
        };
        let event = match unsafe { CreateEventW(None, true, false, PCWSTR::null()) } {
            Ok(h) => h,
            Err(e) => {
                unsafe { let _ = CloseHandle(file); }
                return Err(format!("event: {}", e.message()));
            }
        };
        let pipe = Pipe { file, event };
        let hello = frame(OP_HANDSHAKE, &json!({ "v": 1, "client_id": APP_ID }));
        if let Err(e) = pipe.write(&hello).and_then(|()| pipe.drain()) {
            last = format!("handshake on discord-ipc-{n}: {e}");
            continue; // `pipe` drops here, closing both handles
        }
        crate::log::info("presence: connected to Discord");
        return Ok(pipe);
    }
    Err(last)
}

// ── the one thread that owns the pipe ─────────────────────────────────────────

/// `Set(None)` clears the card and KEEPS the pipe, so the next song needs no reconnect.
/// `Close` clears it and drops the pipe, which is the one thing Discord always obeys.
enum Job {
    Set(Option<Value>),
    Close,
}

/// The only shared state left. It is locked to clone the sender and for nothing else, so
/// no lock is ever held across I/O (§8.11 fault 3). Poison is stepped over the way
/// `Db::lock` steps over it (docs/DB-HEALTH.md): a panic elsewhere must not take the card
/// down with it.
static TX: Mutex<Option<SyncSender<(Job, SyncSender<bool>)>>> = Mutex::new(None);

fn owner(rx: Receiver<(Job, SyncSender<bool>)>) {
    let mut pipe: Option<Pipe> = None;
    while let Ok((job, reply)) = rx.recv() {
        let done = match job {
            Job::Close => {
                if pipe.is_some() {
                    let _ = set_activity(&mut pipe, None);
                    pipe = None;
                    crate::log::info("presence: closed");
                }
                false
            }
            Job::Set(activity) => set_activity(&mut pipe, activity),
        };
        // The caller may already have given up; its end of the channel is then gone.
        let _ = reply.try_send(done);
    }
}

/// Write one SET_ACTIVITY, opening the pipe if it is not open. `false` = Discord is not
/// there, which is not an error: it is the ordinary state of a PC with Discord closed
/// (§8.9), and it gets no toast and no retry loop.
fn set_activity(pipe: &mut Option<Pipe>, activity: Option<Value>) -> bool {
    if pipe.is_none() {
        match connect() {
            Ok(p) => *pipe = Some(p),
            Err(e) => {
                crate::log::info(&format!("presence: no Discord ({e})"));
                return false;
            }
        }
    }
    let mut args = json!({ "pid": std::process::id() });
    if let Some(a) = activity {
        args["activity"] = a;
    }
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|_| "0".into());
    let bytes = frame(OP_FRAME, &json!({ "cmd": "SET_ACTIVITY", "args": args, "nonce": nonce }));
    let p = pipe.as_ref().expect("just connected");
    match p.write(&bytes).and_then(|()| p.drain()) {
        Ok(()) => true,
        Err(e) => {
            // Discord went away, or stopped answering. Drop the handle — that both clears
            // the card and makes the next call reconnect.
            *pipe = None;
            crate::log::info(&format!("presence: dropped the pipe ({e})"));
            false
        }
    }
}

/// Hand one job to the pipe thread and wait for its answer, starting the thread on first
/// use. Runs on the blocking pool, never on the UI thread.
///
/// Both waits have a deadline. A full queue means the thread is wedged on something Windows
/// would not cancel; the answer is then "no Discord", which is a stale card — never a
/// frozen app.
fn request(job: Job) -> bool {
    let tx = {
        let mut guard = TX.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_none() {
            let (tx, rx) = sync_channel::<(Job, SyncSender<bool>)>(8);
            match std::thread::Builder::new().name("presence".into()).spawn(move || owner(rx)) {
                Ok(_) => *guard = Some(tx),
                Err(e) => {
                    crate::log::info(&format!("presence: no thread ({e})"));
                    return false;
                }
            }
        }
        guard.as_ref().cloned()
    };
    // The lock is released ABOVE, before a single byte moves.
    let Some(tx) = tx else { return false };
    let (done, answer) = sync_channel::<bool>(1);
    if tx.try_send((job, done)).is_err() {
        crate::log::info("presence: the pipe thread is busy, skipped this one");
        return false;
    }
    answer.recv_timeout(ANSWER_TIMEOUT).unwrap_or(false)
}

// ── commands (all of them blocking pipe work → spawn_blocking) ────────────────

/// Show this activity. The front end builds it whole (§8.7.1) — this never edits it, so a
/// field Discord adds later needs no change here.
#[tauri::command]
pub async fn presence_set(activity: Value) -> Result<bool, String> {
    Ok(tauri::async_runtime::spawn_blocking(move || request(Job::Set(Some(activity)))).await.unwrap_or(false))
}

/// Take the card down now. An activity-less SET_ACTIVITY is Discord's own way to clear,
/// and it keeps the connection — the next song sets it again with no reconnect.
#[tauri::command]
pub async fn presence_clear() -> Result<bool, String> {
    Ok(tauri::async_runtime::spawn_blocking(|| request(Job::Set(None))).await.unwrap_or(false))
}

/// Close the pipe outright (the app is quitting, or sharing was switched off). Dropping the
/// handle is what Discord watches, so this is the one call that cannot leave a card behind.
#[tauri::command]
pub async fn presence_close() -> Result<(), String> {
    let _ = tauri::async_runtime::spawn_blocking(|| request(Job::Close)).await;
    Ok(())
}
