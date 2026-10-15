//! Each place gets its own hand-drawn frame of `icons/icon.ico` (whitelabel.md §10.6).
//!
//! Tauri gives a window ONE picture, the first frame of the `.ico`, and Windows scales it to
//! every size it needs. That blurs pixel art: the 16 grew to 24 on the taskbar (2026-10-15).
//! So the window gets two icons from the exe's own icon resource, each loaded at the size it
//! is drawn at (Windows picks the matching frame), and the tray gets the frame for its size.
//!
//! A scale change while the app is open: the window hears it as `ScaleFactorChanged` (tray.rs
//! calls `set_window`). The tray has no window of its own that hears it, so the main window is
//! subclassed for the broadcasts a scale change sends (`watch_scale`), and the tray frame is
//! set again when the taskbar's icon size changed. Windows fixes the SYSTEM scale for the
//! life of the process, so the tray size is read from the taskbar's own window instead.
//!
//! No new download: `ico` is already in the tree (Tauri's build), the Win32 calls are features
//! of the `windows` crate the app already has.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::OnceLock;

use tauri::{image::Image, AppHandle, Manager, Runtime, WebviewWindow, Window};
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::HiDpi::{GetDpiForSystem, GetDpiForWindow, GetSystemMetricsForDpi};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowW, LoadImageW, SendMessageW, ICON_BIG, ICON_SMALL, IMAGE_ICON, LR_DEFAULTCOLOR, SM_CXSMICON,
    WM_DISPLAYCHANGE, WM_DPICHANGED, WM_SETICON, WM_SETTINGCHANGE,
};

/// The id tauri-build gives the app icon in the exe's resources.
const RESOURCE_ID: u16 = 32512;
/// The taskbar button's icon at 100 % scale. Windows draws the window's big icon at this size,
/// so the big icon is loaded at it (not at SM_CXICON = 32, which the taskbar would shrink).
const TASKBAR_AT_96: u32 = 24;
/// The tray's id (tray.rs builds it).
const TRAY_ID: &str = "main";

static ICO: &[u8] = include_bytes!("../icons/icon.ico");
/// The tray frame's size now, so a broadcast that changed nothing does nothing.
static TRAY_SIZE: AtomicU32 = AtomicU32::new(0);
static APP: OnceLock<AppHandle> = OnceLock::new();

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

/// The tray's icon size now: the small-icon size at the taskbar's scale. The taskbar window
/// follows its monitor's scale live; `GetDpiForSystem` is the fallback (fixed at launch).
fn tray_size() -> u32 {
    let dpi = match unsafe { FindWindowW(w!("Shell_TrayWnd"), PCWSTR::null()) } {
        Ok(bar) => unsafe { GetDpiForWindow(bar) },
        Err(_) => 0,
    };
    let dpi = if dpi == 0 { unsafe { GetDpiForSystem() } } else { dpi }.max(96);
    unsafe { GetSystemMetricsForDpi(SM_CXSMICON, dpi) }.max(16) as u32
}

/// The `.ico` frame of `size`; a missing size takes the next larger frame.
fn frame(size: u32) -> Option<Image<'static>> {
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

/// The tray's frame at launch.
pub fn tray_image() -> Option<Image<'static>> {
    let size = tray_size();
    TRAY_SIZE.store(size, Ordering::Relaxed);
    frame(size)
}

/// Set the tray frame again if the taskbar's icon size changed.
fn refresh_tray(app: &AppHandle) {
    let size = tray_size();
    let was = TRAY_SIZE.swap(size, Ordering::Relaxed);
    if was == size {
        return;
    }
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    match frame(size) {
        Some(img) => {
            tray.set_icon(Some(img)).ok();
            crate::log::info(&format!("app_icon: tray {was}px → {size}px (scale change)"));
        }
        None => crate::log::warn(&format!("app_icon: no {size}px frame for the tray")),
    }
    // A window hidden in the tray may not hear its own WM_DPICHANGED: set its frames too.
    set_all(app);
}

unsafe extern "system" fn on_message(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    // A scale change resizes the taskbar, so Windows broadcasts a work-area change; a move of
    // the window's own monitor sends WM_DPICHANGED. Any of them: check the tray after this
    // message returns (the sender may be the taskbar itself, waiting on our reply).
    if matches!(msg, WM_SETTINGCHANGE | WM_DISPLAYCHANGE | WM_DPICHANGED) {
        if let Some(app) = APP.get() {
            let handle = app.clone();
            app.run_on_main_thread(move || refresh_tray(&handle)).ok();
        }
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

/// Hear a scale change for the tray through the main window, which lives as long as the app
/// (hidden in the tray too: the broadcasts reach hidden top-level windows).
pub fn watch_scale(app: &AppHandle) {
    APP.set(app.clone()).ok();
    let Some(main) = app.get_webview_window("main") else { return };
    let Ok(hwnd) = main.hwnd() else { return };
    if !unsafe { SetWindowSubclass(hwnd, Some(on_message), 0xD1C0, 0) }.as_bool() {
        crate::log::warn("app_icon: could not watch for scale changes; the tray keeps its launch size");
    }
}
