//! Each place gets its own hand-drawn frame of `icons/icon.ico` (whitelabel.md §10.6).
//!
//! Tauri gives a window ONE picture, the first frame of the `.ico`, and Windows scales it to
//! every size it needs. That blurs pixel art: the 16 grew to 24 on the taskbar (2026-10-15).
//! So the window gets two icons from the exe's own icon resource, each loaded at the size it
//! is drawn at (Windows picks the matching frame), and the tray gets the frame for its size.
//!
//! No new download: `ico` is already in the tree (Tauri's build), the Win32 calls are features
//! of the `windows` crate the app already has.

use tauri::{image::Image, AppHandle, Manager, Runtime, WebviewWindow, Window};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::HiDpi::{GetDpiForSystem, GetDpiForWindow, GetSystemMetricsForDpi};
use windows::Win32::UI::WindowsAndMessaging::{
    LoadImageW, SendMessageW, ICON_BIG, ICON_SMALL, IMAGE_ICON, LR_DEFAULTCOLOR, SM_CXSMICON, WM_SETICON,
};

/// The id tauri-build gives the app icon in the exe's resources.
const RESOURCE_ID: u16 = 32512;
/// The taskbar button's icon at 100 % scale. Windows draws the window's big icon at this size,
/// so the big icon is loaded at it (not at SM_CXICON = 32, which the taskbar would shrink).
const TASKBAR_AT_96: u32 = 24;

static ICO: &[u8] = include_bytes!("../icons/icon.ico");

/// Load the exe's icon at exactly `size` px; Windows picks the frame of that size.
fn load(size: u32) -> Option<isize> {
    let module = unsafe { GetModuleHandleW(PCWSTR::null()) }.ok()?;
    let handle = unsafe {
        LoadImageW(
            Some(module.into()),
            PCWSTR(RESOURCE_ID as usize as *const u16),
            IMAGE_ICON,
            size as i32,
            size as i32,
            LR_DEFAULTCOLOR,
        )
    }
    .ok()?;
    Some(handle.0 as isize)
}

fn set_for_hwnd(hwnd: HWND, label: &str) {
    let dpi = unsafe { GetDpiForWindow(hwnd) }.max(96);
    let small = unsafe { GetSystemMetricsForDpi(SM_CXSMICON, dpi) }.max(16) as u32;
    let big = (TASKBAR_AT_96 * dpi + 48) / 96;
    for (kind, size) in [(ICON_SMALL, small), (ICON_BIG, big)] {
        match load(size) {
            // The window keeps the handle; the old one (Tauri's) is still owned by Tauri.
            Some(h) => unsafe {
                SendMessageW(hwnd, WM_SETICON, Some(WPARAM(kind as usize)), Some(LPARAM(h)));
            },
            None => crate::log::warn(&format!("app_icon: no {size}px icon for {label}")),
        }
    }
}

/// Set the title bar and taskbar icons of a window, for its current scale.
pub fn set_window<R: Runtime>(win: &Window<R>) {
    if let Ok(hwnd) = win.hwnd() {
        set_for_hwnd(hwnd, win.label());
    }
}

/// Every window that exists at setup.
pub fn set_all<R: Runtime>(app: &AppHandle<R>) {
    for w in app.webview_windows().values() {
        set_webview_window(w);
    }
}

fn set_webview_window<R: Runtime>(w: &WebviewWindow<R>) {
    if let Ok(hwnd) = w.hwnd() {
        set_for_hwnd(hwnd, w.label());
    }
}

/// The tray's frame: the `.ico` entry of the small-icon size at the system scale (the tray
/// follows the system scale, not a monitor's). A missing size takes the next larger frame.
pub fn tray_image() -> Option<Image<'static>> {
    let size = unsafe { GetSystemMetricsForDpi(SM_CXSMICON, GetDpiForSystem().max(96)) }.max(16) as u32;
    let dir = ico::IconDir::read(std::io::Cursor::new(ICO)).ok()?;
    let entry = dir
        .entries()
        .iter()
        .filter(|e| e.width() >= size)
        .min_by_key(|e| e.width())
        .or_else(|| dir.entries().iter().max_by_key(|e| e.width()))?;
    let img = entry.decode().ok()?;
    Some(Image::new_owned(img.rgba_data().to_vec(), img.width(), img.height()))
}
