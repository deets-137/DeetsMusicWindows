//! The tray (TRAY.md): icon, right-click menu, the panel window, and the
//! "× hides to tray" behaviour of the main window. DeetsRGB / DeetsAirplay lineage.
//!
//! Left-click pops the *app itself* at the cursor (DA/DR model): the main window
//! is asked to switch to the mini surface, then `tray_place_main` anchors its
//! bottom-right corner at the click and shows it. A window popped this way is a
//! flyout — it hides again on focus loss — until the user pins it (opens it from
//! the menu / taskbar, or picks another surface). Right-click is the menu, which
//! also reaches the Now Playing panel (`tray`, `tray.html`): a second, always-alive
//! webview that mirrors the Now Playing card and never touches MusicKit — it reads
//! the hub in `bridge.rs` and sends transport back through it.

use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{
    menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, WindowEvent,
};

#[derive(Default)]
struct Inner {
    /// A window that hides on blur must not be re-opened by the very tray click
    /// that caused the blur.
    panel_hidden_at: Option<Instant>,
    main_hidden_at: Option<Instant>,
    /// Main is currently shown as a tray flyout (hide on blur).
    popped: bool,
    /// Where the pending pop should anchor (set on click, consumed by `tray_place_main`).
    pop_at: Option<PhysicalPosition<f64>>,
    /// Last tray click of either button — the menu's "Now Playing panel" anchors here.
    last_click: Option<PhysicalPosition<f64>>,
    /// Where the real app window sat before a pop moved it to the tray; "Open" puts it back.
    restore_pos: Option<PhysicalPosition<i32>>,
    /// A blur that arrives right after we showed a window is the menu/tray click
    /// itself resolving, not the user clicking away — ignore it.
    shown_at: Option<Instant>,
}
pub struct TrayState(Mutex<Inner>);

pub const PANEL: &str = "tray";
pub const MAIN: &str = "main";

const REPOP_GUARD: Duration = Duration::from_millis(300);
#[cfg(not(debug_assertions))]
const BLUR_GUARD: Duration = Duration::from_millis(500);

fn state(app: &AppHandle) -> std::sync::MutexGuard<'_, Inner> {
    app.state::<TrayState>().inner().0.lock().unwrap()
}

/// Bottom-right corner of `w` at `p`, kept inside the monitor under `p`.
fn anchor(app: &AppHandle, w: &tauri::WebviewWindow, p: PhysicalPosition<f64>) {
    let size = w.outer_size().unwrap_or_default();
    let (mut x, mut y) = (p.x - size.width as f64, p.y - size.height as f64 - 8.0);
    if let Ok(Some(mon)) = app.monitor_from_point(p.x, p.y) {
        let (mp, ms) = (mon.position(), mon.size());
        x = x.max(mp.x as f64).min((mp.x + ms.width as i32) as f64 - size.width as f64);
        y = y.max(mp.y as f64);
    }
    w.set_position(PhysicalPosition::new(x, y)).ok();
}

// ── the panel ─────────────────────────────────────────────────────────────────

pub fn hide_panel(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(PANEL) {
        w.hide().ok();
        state(app).panel_hidden_at = Some(Instant::now());
    }
}

/// Show the panel with its bottom-right corner at `at` (or where it last was).
pub fn show_panel(app: &AppHandle, at: Option<PhysicalPosition<f64>>) {
    let Some(w) = app.get_webview_window(PANEL) else { return };
    if let Some(p) = at {
        anchor(app, &w, p);
    }
    w.show().ok();
    w.set_focus().ok();
    let _ = tauri::Emitter::emit_to(app, PANEL, "panel-shown", ());
}

// ── the main window ───────────────────────────────────────────────────────────

/// Open the *real app* (menu "Open DeetsMusic", the panel's "Open"): pinned, on its
/// full surface (midi/max), back where it was before any pop. The page does the
/// surface switch (`tray-open`) and answers with `tray_place_main`, which restores
/// the position and shows. A visible, already-pinned window just gets focus.
pub fn show_main(app: &AppHandle) {
    let Some(w) = app.get_webview_window(MAIN) else { return };
    let visible = w.is_visible().unwrap_or(false);
    let mut s = state(app);
    if visible && !s.popped {
        drop(s);
        w.unminimize().ok();
        w.set_focus().ok();
        return;
    }
    s.popped = false;
    s.pop_at = None;
    s.shown_at = Some(Instant::now());
    drop(s);
    let _ = tauri::Emitter::emit_to(app, MAIN, "tray-open", ());
}

fn hide_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        w.hide().ok();
    }
    let mut s = state(app);
    s.popped = false;
    s.main_hidden_at = Some(Instant::now());
}

/// Left-click: a popped, visible window hides; otherwise ask the page to go mini
/// (it answers with `tray_place_main`, which anchors + shows).
fn toggle_main(app: &AppHandle, at: PhysicalPosition<f64>) {
    let visible = app.get_webview_window(MAIN).and_then(|w| w.is_visible().ok()).unwrap_or(false);
    let mut s = state(app);
    if visible && s.popped {
        drop(s);
        hide_main(app);
        return;
    }
    let just_hid = s.main_hidden_at.map(|t| t.elapsed() < REPOP_GUARD).unwrap_or(false);
    if just_hid {
        return;
    }
    if visible && !s.popped {
        // The real window is about to be moved to the tray — remember where it was.
        s.restore_pos = app.get_webview_window(MAIN).and_then(|w| w.outer_position().ok());
    }
    s.pop_at = Some(at);
    s.popped = true;
    s.shown_at = Some(Instant::now());
    drop(s);
    let _ = tauri::Emitter::emit_to(app, MAIN, "tray-pop", ());
}

/// Rebuild the menu so the check item mirrors settings.json.
pub fn sync_menu(app: &AppHandle) {
    let Some(tray) = app.tray_by_id("main") else { return };
    let read_windows = app.state::<crate::settings::Settings>().get().read_windows_media;
    let open = MenuItemBuilder::with_id("open", "Open DeetsMusic").build(app);
    let panel = MenuItemBuilder::with_id("panel", "Now Playing panel").build(app);
    let win = CheckMenuItemBuilder::with_id("read-windows", "Read Windows media").checked(read_windows).build(app);
    let quit = MenuItemBuilder::with_id("quit", "Quit DeetsMusic").build(app);
    let (Ok(open), Ok(panel), Ok(win), Ok(quit)) = (open, panel, win, quit) else { return };
    #[cfg_attr(not(debug_assertions), allow(unused_mut))]
    let mut menu = MenuBuilder::new(app).item(&open).item(&panel).separator().item(&win);
    #[cfg(debug_assertions)]
    {
        if let Ok(dev) = MenuItemBuilder::with_id("devtools", "Panel devtools").build(app) {
            menu = menu.item(&dev);
        }
    }
    if let Ok(m) = menu.separator().item(&quit).build() {
        tray.set_menu(Some(m)).ok();
    }
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    app.manage(TrayState(Mutex::new(Inner::default())));
    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().expect("window icon").clone())
        .tooltip("DeetsMusic")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "quit" => app.exit(0),
            "open" => show_main(app),
            "panel" => {
                let at = state(app).last_click;
                show_panel(app, at);
            }
            "read-windows" => {
                let settings = app.state::<crate::settings::Settings>();
                let now = settings.get().read_windows_media;
                settings.update(|d| d.read_windows_media = !now).ok();
                sync_menu(app);
                let _ = tauri::Emitter::emit_to(app, PANEL, "settings", settings.get());
            }
            #[cfg(debug_assertions)]
            "devtools" => {
                if let Some(w) = app.get_webview_window(PANEL) {
                    w.open_devtools();
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button, button_state, position, .. } = ev {
                let app = tray.app_handle();
                state(app).last_click = Some(position);
                if button == MouseButton::Left && button_state == MouseButtonState::Up {
                    toggle_main(app, position);
                }
            }
        })
        .build(app)?;
    sync_menu(app);
    Ok(())
}

/// Window-event policy for both windows. Main: × hides to the tray when the
/// setting is on (playback keeps running — a hidden webview still plays); a
/// tray-popped main also hides on focus loss. Panel: × and focus-loss hide it.
pub fn on_window_event(win: &tauri::Window, ev: &WindowEvent) {
    let app = win.app_handle();
    match (win.label(), ev) {
        (PANEL, WindowEvent::CloseRequested { api, .. }) => {
            api.prevent_close();
            hide_panel(app);
        }
        #[cfg(not(debug_assertions))]
        (PANEL, WindowEvent::Focused(false)) => hide_panel(app),
        #[cfg(not(debug_assertions))]
        (MAIN, WindowEvent::Focused(false)) => {
            let s = state(app);
            let fresh = s.shown_at.map(|t| t.elapsed() < BLUR_GUARD).unwrap_or(false);
            if s.popped && !fresh {
                drop(s);
                hide_main(app);
            }
        }
        (MAIN, WindowEvent::CloseRequested { api, .. }) => {
            if app.state::<crate::settings::Settings>().get().minimize_to_tray {
                api.prevent_close();
                hide_main(app);
            } else {
                app.exit(0);
            }
        }
        _ => {}
    }
}

// ── commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn tray_panel_hide(app: AppHandle) {
    hide_panel(&app);
}

#[tauri::command]
pub fn tray_open_main(app: AppHandle) {
    show_main(&app);
    hide_panel(&app);
}

/// Second half of a pop (`tray-pop`) or an open (`tray-open`): the page has switched
/// surface and resized. A pop anchors at the click; an open puts the window back
/// where it was before the pop (or leaves it be). Then show + focus.
#[tauri::command]
pub fn tray_place_main(app: AppHandle) {
    let (at, restore) = {
        let mut s = state(&app);
        s.shown_at = Some(Instant::now());
        (s.pop_at.take(), if s.popped { None } else { s.restore_pos.take() })
    };
    let Some(w) = app.get_webview_window(MAIN) else { return };
    let popped = state(&app).popped;
    // The flyout lives off the taskbar (DA/DR); the real app is always on it.
    w.set_skip_taskbar(popped).ok();
    if let Some(p) = at {
        anchor(&app, &w, p);
    } else if let Some(p) = restore {
        w.set_position(p).ok();
    }
    w.show().ok();
    w.unminimize().ok();
    w.set_focus().ok();
}

/// The user made the popped window theirs (picked a surface, …): stop hiding on blur.
#[tauri::command]
pub fn tray_pin_main(app: AppHandle) {
    state(&app).popped = false;
    if let Some(w) = app.get_webview_window(MAIN) {
        w.set_skip_taskbar(false).ok();
    }
}

/// The panel sizes itself to its content (the card height depends on the skin).
#[tauri::command]
pub fn tray_panel_resize(width: f64, height: f64, app: AppHandle) {
    if let Some(w) = app.get_webview_window(PANEL) {
        let _ = w.set_size(tauri::LogicalSize::new(width.max(200.0), height.max(80.0)));
    }
}

#[tauri::command]
pub fn app_quit(app: AppHandle) {
    app.exit(0);
}
