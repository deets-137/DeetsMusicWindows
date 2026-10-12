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
                log::warn(&format!("gpu: a WebView2 process failed (kind {}, exit {:?})", kind.0, exit_code));
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
