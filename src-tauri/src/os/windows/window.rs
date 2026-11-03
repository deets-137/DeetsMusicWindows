//! Window details Tauri does not cover (OS-LAYER.md §11.1, from tray.rs and lib.rs).

use tauri::WebviewWindow;
use windows::Win32::Foundation::HWND;

fn hwnd(w: &WebviewWindow) -> Option<HWND> {
    w.hwnd().ok().map(|h| HWND(h.0 as _))
}

/// Take a snapped ("arranged") window back to its own size, so a resize after it is the size a
/// drag keeps (PIN.md §8). True when the window was snapped.
pub fn unsnap(w: &WebviewWindow) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{IsWindowArranged, ShowWindow, SW_RESTORE};
    let Some(h) = hwnd(w) else { return false };
    unsafe {
        if !IsWindowArranged(h).as_bool() {
            return false;
        }
        let _ = ShowWindow(h, SW_RESTORE);
    }
    true
}

/// Show the window minimized, without taking the focus.
pub fn show_minimized(w: &WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWMINNOACTIVE};
    if let Some(h) = hwnd(w) {
        unsafe {
            let _ = ShowWindow(h, SW_SHOWMINNOACTIVE);
        }
    }
}

/// Turn off the web view's browser keys: Ctrl+F find, Ctrl+P print, Ctrl+R / F5 reload, zoom,
/// F7 caret browsing, Alt+Left back (DRAG-DROP.md §6). The page still gets the keydown. A
/// failure is one log line.
#[cfg_attr(debug_assertions, allow(dead_code))] // release only (lib.rs), so F12 stays in dev
pub fn browser_keys_off(w: &WebviewWindow) {
    let _ = w.with_webview(|wv| {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
        use windows::core::Interface;
        let off = || -> windows::core::Result<()> {
            unsafe {
                let settings = wv.controller().CoreWebView2()?.Settings()?;
                settings.cast::<ICoreWebView2Settings3>()?.SetAreBrowserAcceleratorKeysEnabled(false)
            }
        };
        if let Err(e) = off() {
            crate::log::warn(&format!("webview: browser keys stay on: {e}"));
        }
    });
}
