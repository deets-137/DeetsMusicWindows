//! The monitor a window is on and its refresh rate (OS-LAYER.md §11.1, from display.rs).

use windows::core::PCWSTR;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{
    EnumDisplaySettingsW, GetMonitorInfoW, MonitorFromWindow, DEVMODEW, ENUM_CURRENT_SETTINGS, MONITORINFO,
    MONITORINFOEXW, MONITOR_DEFAULTTONEAREST,
};

fn hwnd(win: &tauri::Window) -> Option<HWND> {
    win.hwnd().ok().map(|h| HWND(h.0 as _))
}

/// An id for the monitor that holds most of the window. Only compared with itself.
pub fn monitor(win: &tauri::Window) -> Option<isize> {
    let h = hwnd(win)?;
    Some(unsafe { MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST) }.0 as isize)
}

/// The current display mode's rate of that monitor, in Hz. None when Windows does not say
/// (0 and 1 mean "the hardware's default rate"). No I/O: two Win32 calls.
pub fn hz(win: &tauri::Window) -> Option<u32> {
    let h = hwnd(win)?;
    unsafe {
        let mon = MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST);
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
