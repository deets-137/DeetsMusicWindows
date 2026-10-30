//! The GPU process watch (GRAPHICS-FALLBACK.md §4.2).
//!
//! When WebView2's GPU process exits (a driver update, a driver crash), WebView2 starts a new
//! one. That new one can come back on WARP, Windows' software rasteriser, and then stays there
//! for the session (2026-09-29: three hours of one core at 100 %). The page cannot see the exit
//! itself, so this tells it: `gpu-process-failed` with the kind and the exit code. The page then
//! reads the renderer name again (`src/gpu.ts`) and the `graphics` fact follows.
//!
//! Dev and release both: unlike the browser-keys switch in lib.rs, this is not release only,
//! because the desk test runs on the dev app.

use tauri::{AppHandle, Emitter, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2ProcessFailedEventArgs2, COREWEBVIEW2_PROCESS_FAILED_KIND,
    COREWEBVIEW2_PROCESS_FAILED_KIND_GPU_PROCESS_EXITED,
};
use webview2_com::ProcessFailedEventHandler;
use windows::core::Interface;

use crate::log;

#[derive(Clone, serde::Serialize)]
struct Failed {
    kind: i32,
    #[serde(rename = "exitCode")]
    exit_code: Option<i32>,
}

/// The log line for a WebView2 process failure, and whether it is a WARN. Every kind was one
/// `gpu:` WARN until 2026-10-30, and that area read on 12 of 14 installs (week 2026-W43). On his
/// PC 9 of 10 were kind 4, a UTILITY process, exit 0xC0000142 (a DLL failed to start), within
/// 20 s of a Windows wake, boot or sleep: Windows changing state, not a fault, and the app does
/// nothing on it. Now the GPU process keeps its `gpu:` WARN (GRAPHICS-FALLBACK.md reads it), the
/// browser and renderer processes are a `webview:` WARN (the window can go blank), and the rest
/// is a `webview:` INFO, so it is in the log but never counted.
fn process_failed_line(kind: i32, exit: Option<i32>) -> (String, bool) {
    let what = match kind {
        0 => "the browser process exited",
        1 => "the renderer exited",
        2 => "the renderer stopped answering",
        3 => "a frame's renderer exited",
        4 => "a utility process exited",
        5 => "a sandbox helper exited",
        6 => return (format!("gpu: a WebView2 process failed (kind 6, exit {exit:?})"), true),
        _ => "another process exited",
    };
    (format!("webview: {what} (kind {kind}, exit {exit:?})"), kind <= 3)
}

#[cfg(test)]
mod tests {
    use super::process_failed_line;

    #[test]
    fn only_the_processes_that_matter_warn_2026_10_30() {
        let (gpu, warn) = process_failed_line(6, Some(1));
        assert!(warn && gpu.starts_with("gpu: a WebView2 process failed (kind 6"));
        let (util, warn) = process_failed_line(4, Some(-1073741502));
        assert!(!warn && util.starts_with("webview: a utility process exited"));
        assert!(process_failed_line(1, None).1, "a renderer crash stays a warning");
        assert!(process_failed_line(0, None).1, "so does the browser process");
    }
}

/// Add the `ProcessFailed` handler to the main window's WebView. A failure to add it is one
/// log line: the page's own timer still reads the renderer every 5 minutes (§4.3).
pub fn watch(app: &AppHandle, win: &WebviewWindow) {
    let app = app.clone();
    let r = win.with_webview(move |wv| {
        let add = || -> windows::core::Result<()> {
            let core = unsafe { wv.controller().CoreWebView2()? };
            let handler = ProcessFailedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                unsafe { args.ProcessFailedKind(&mut kind)? };
                let exit_code = args.cast::<ICoreWebView2ProcessFailedEventArgs2>().ok().and_then(|a2| {
                    let mut code = 0i32;
                    unsafe { a2.ExitCode(&mut code) }.ok().map(|_| code)
                });
                let line = process_failed_line(kind.0, exit_code);
                if line.1 { log::warn(&line.0) } else { log::info(&line.0) }
                // Only the GPU process matters here; a renderer crash has its own path.
                if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_GPU_PROCESS_EXITED {
                    let _ = app.emit("gpu-process-failed", Failed { kind: kind.0, exit_code });
                }
                Ok(())
            }));
            let mut token = 0i64;
            unsafe { core.add_ProcessFailed(&handler, &mut token) }
        };
        if let Err(e) = add() {
            log::warn(&format!("gpu: no process-failed watch: {e}"));
        }
    });
    if let Err(e) = r {
        log::warn(&format!("gpu: no process-failed watch: {e}"));
    }
}

// ── Is the card ready? (GRAPHICS-FALLBACK.md §10.3) ─────────────────────────────
// A WebView2 that fell to WARP stays there for the life of its browser process (§1, §10.1):
// only a restart gets the card back. So the page needs to know when a restart WOULD get it
// back: Windows has a hardware adapter that makes a Direct3D 11 device. The page cannot ask
// that itself; this does, with one device made and freed per test.

#[derive(Clone, serde::Serialize)]
pub struct CardAnswer {
    /// A hardware adapter made a device: a restart gets the card back.
    ready: bool,
    /// The adapter that made it ("AMD Radeon RX 6700 XT"), or None.
    name: Option<String>,
    /// Adapter-change events since the last answer (0 for the first one).
    events: u32,
}

/// One test: each hardware adapter in turn (software ones skipped) until one makes a device.
fn card_test() -> (bool, Option<String>) {
    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
    use windows::Win32::Graphics::Direct3D11::{D3D11CreateDevice, ID3D11Device, D3D11_CREATE_DEVICE_FLAG, D3D11_SDK_VERSION};
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIAdapter, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE};

    // A fresh factory each time: an old one lists the adapters as they were when it was made.
    let Ok(factory) = (unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }) else { return (false, None) };
    let mut i = 0;
    while let Ok(adapter) = unsafe { factory.EnumAdapters1(i) } {
        i += 1;
        let Ok(desc) = (unsafe { adapter.GetDesc1() }) else { continue };
        let name = String::from_utf16_lossy(&desc.Description).trim_end_matches('\0').to_string();
        if desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 || name.contains("Basic Render Driver") {
            continue;
        }
        let Ok(base) = adapter.cast::<IDXGIAdapter>() else { continue };
        let mut device: Option<ID3D11Device> = None;
        let made = unsafe {
            D3D11CreateDevice(
                &base,
                D3D_DRIVER_TYPE_UNKNOWN,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_FLAG(0),
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                None,
            )
        };
        if made.is_ok() && device.is_some() {
            return (true, Some(name)); // the device drops here: made and freed
        }
    }
    (false, None)
}

fn answer(events: u32) -> CardAnswer {
    let (ready, name) = card_test();
    log::info(&format!("gpu: adapters tested: ready {ready}, {}, {events} change event(s)", name.as_deref().unwrap_or("no hardware adapter")));
    CardAnswer { ready, name, events }
}

/// The page asks once, at a software start (§10.6: a PC with no working card at all).
#[tauri::command]
pub async fn gpu_card_ready() -> CardAnswer {
    tauri::async_runtime::spawn_blocking(|| answer(0)).await.unwrap_or(CardAnswer { ready: false, name: None, events: 0 })
}

/// A driver install changes the adapters more than once; wait until it has been quiet this long.
const SETTLE: u32 = 20_000;
static WATCHING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Start the adapter watch, once per session, only after the page found software drawing
/// (most sessions never start it). The thread waits on Windows' adapter-change event
/// (`IDXGIFactory7::RegisterAdaptersChangedEvent`): no timer, no polling. It answers first
/// after SETTLE ms with no change, then again after each settled change, as `gpu-adapters`.
#[tauri::command]
pub fn gpu_watch_adapters(app: AppHandle) {
    if WATCHING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let spawned = std::thread::Builder::new().name("gpu-adapters".into()).spawn(move || {
        if let Err(e) = watch_adapters(&app) {
            log::warn(&format!("gpu: no adapter watch: {e}"));
        }
        // The page may ask again (each software read does); the 5-minute read still runs.
        WATCHING.store(false, std::sync::atomic::Ordering::SeqCst);
    });
    if let Err(e) = spawned {
        log::warn(&format!("gpu: no adapter watch thread: {e}"));
    }
}

fn watch_adapters(app: &AppHandle) -> windows::core::Result<()> {
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory7};
    use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject, INFINITE};

    let factory: IDXGIFactory7 = unsafe { CreateDXGIFactory1() }?;
    let event = unsafe { CreateEventW(None, false, false, None) }?;
    let cookie = unsafe { factory.RegisterAdaptersChangedEvent(event) };
    if let Err(e) = cookie {
        unsafe { CloseHandle(event).ok() };
        return Err(e);
    }
    log::info("gpu: adapter watch on");
    let mut events = 0u32;
    loop {
        // Settle: wait until SETTLE ms pass with no change.
        loop {
            let w = unsafe { WaitForSingleObject(event, SETTLE) };
            if w == WAIT_OBJECT_0 {
                events += 1;
            } else if w == WAIT_TIMEOUT {
                break;
            } else {
                unsafe { CloseHandle(event).ok() };
                return Ok(());
            }
        }
        let _ = app.emit("gpu-adapters", answer(events));
        // Then sleep until the next change.
        if unsafe { WaitForSingleObject(event, INFINITE) } != WAIT_OBJECT_0 {
            unsafe { CloseHandle(event).ok() };
            return Ok(());
        }
        events = 1;
    }
}

// ── The quiet restart (§10.5) ───────────────────────────────────────────────────
// The page restarts the app while its window cannot be seen. The new start must come back the
// same way: hidden in the tray, or minimized on the taskbar. The intent is a small file the
// next start reads and deletes (a start argument would be lost: Tauri's restart relaunches
// with the old arguments).

const INTENT: &str = "restart-intent.json";

#[derive(serde::Serialize, serde::Deserialize)]
struct Intent {
    /// "tray" (hidden) or "min" (minimized).
    window: String,
    /// When it was written (ms since the epoch). A file older than INTENT_TTL is a restart that
    /// never happened (the process died first): a later start ignores it and shows the window.
    #[serde(default)]
    at: u64,
}

const INTENT_TTL_MS: u64 = 60_000;

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// The page: restart now, and come back as `window` says.
#[tauri::command]
pub async fn app_restart_quiet(app: AppHandle, window: String) -> Result<(), String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec(&Intent { window: window.clone(), at: now_ms() }).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || crate::safe_file::write_atomic(&dir.join(INTENT), &bytes))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    log::warn(&format!("app: restart asked from the window (graphics card ready again, quiet, window {window})"));
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(200));
        app.request_restart();
    });
    Ok(())
}

/// Setup: the quiet restart's window state, read once and deleted. None for any other start.
pub fn take_intent(dir: &std::path::Path) -> Option<String> {
    let path = dir.join(INTENT);
    let text = std::fs::read_to_string(&path).ok()?;
    let _ = std::fs::remove_file(&path);
    let i: Intent = serde_json::from_str(&text).ok()?;
    let age = now_ms().saturating_sub(i.at);
    if age > INTENT_TTL_MS {
        log::warn(&format!("start: an old quiet-restart intent ({} s), ignored", age / 1000));
        return None;
    }
    log::info(&format!("start: a quiet graphics restart, window {}", i.window));
    Some(i.window)
}
