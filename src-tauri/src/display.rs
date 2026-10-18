//! The refresh rate of the monitor each window is on (VINYL.md §12, the Spin FPS row).
//!
//! The Press record redraws at most at the row's FPS, and only at a rate that divides the
//! display's rate evenly, or some frames would show longer than others. So the page must know
//! the display's rate exactly: Windows' own display mode gives a whole number (240), where the
//! page's rAF sample (frames.ts, dev only) reads 244.
//!
//! `display_hz` answers for the window that asks. `display-hz` tells a window when its rate
//! changes: it moved to another monitor, or it got focus after a display mode change.

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{Emitter, WindowEvent};
use windows::core::PCWSTR;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{
    EnumDisplaySettingsW, GetMonitorInfoW, MonitorFromWindow, DEVMODEW, ENUM_CURRENT_SETTINGS, MONITORINFO,
    MONITORINFOEXW, MONITOR_DEFAULTTONEAREST,
};

use crate::log;

#[derive(Clone, serde::Serialize)]
struct Changed {
    label: String,
    hz: u32,
}

/// Per window label: the monitor it was last on and that monitor's rate.
static LAST: Mutex<Option<HashMap<String, (isize, u32)>>> = Mutex::new(None);

fn monitor_of(hwnd: HWND) -> isize {
    unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) }.0 as isize
}

/// The current display mode's rate of the monitor that holds most of the window. None when
/// Windows does not say (0 and 1 mean "the hardware's default rate").
fn hz_of(hwnd: HWND) -> Option<u32> {
    unsafe {
        let mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        if !GetMonitorInfoW(mon, &mut info as *mut MONITORINFOEXW as *mut MONITORINFO).as_bool() {
            return None;
        }
        let mut mode = DEVMODEW { dmSize: std::mem::size_of::<DEVMODEW>() as u16, ..Default::default() };
        if !EnumDisplaySettingsW(PCWSTR(info.szDevice.as_ptr()), ENUM_CURRENT_SETTINGS, &mut mode).as_bool() {
            return None;
        }
        let hz = mode.dmDisplayFrequency;
        (hz > 1).then_some(hz)
    }
}

/// The rate of the monitor the calling window is on, in Hz. No I/O: two Win32 calls.
#[tauri::command]
pub fn display_hz(window: tauri::WebviewWindow) -> Option<u32> {
    let hwnd = window.hwnd().ok()?;
    let hz = hz_of(hwnd)?;
    remember(window.label(), monitor_of(hwnd), hz);
    Some(hz)
}

/// Store the pair; true when the rate differs from the one stored before.
fn remember(label: &str, mon: isize, hz: u32) -> bool {
    let mut g = LAST.lock().unwrap_or_else(|p| p.into_inner());
    let map = g.get_or_insert_with(HashMap::new);
    let before = map.insert(label.to_string(), (mon, hz));
    before.map(|(_, h)| h != hz).unwrap_or(true)
}

/// Called from tray.rs's window-event policy. A move reads the rate only when the window's
/// monitor changed (a drag fires a move per pixel); a focus reads it again always, which
/// catches a display mode changed in Windows' settings.
pub fn on_window_event(win: &tauri::Window, ev: &WindowEvent) {
    let focus = matches!(ev, WindowEvent::Focused(true));
    if !focus && !matches!(ev, WindowEvent::Moved(_) | WindowEvent::ScaleFactorChanged { .. }) {
        return;
    }
    let Ok(hwnd) = win.hwnd() else { return };
    let mon = monitor_of(hwnd);
    if !focus {
        let g = LAST.lock().unwrap_or_else(|p| p.into_inner());
        if g.as_ref().and_then(|m| m.get(win.label())).map(|(m, _)| *m == mon).unwrap_or(false) {
            return;
        }
    }
    let Some(hz) = hz_of(hwnd) else { return };
    if remember(win.label(), mon, hz) {
        log::info(&format!("display: {} on {hz} Hz", win.label()));
        let _ = win.emit("display-hz", Changed { label: win.label().to_string(), hz });
    }
}
