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

/// Remember where the REAL app window sits, in `Inner` and in settings.json. Called
/// before anything moves it to the tray (a pop) or hides it (× to tray), so "Open
/// DeetsMusic" and the pinned taskbar button can put it back — after a × close and
/// after a restart, which an in-memory field alone cannot do.
fn remember_pos(app: &AppHandle, s: &mut Inner) {
    let Some(w) = app.get_webview_window(MAIN) else { return };
    let Ok(p) = w.outer_position() else { return };
    s.restore_pos = Some(p);
    // Only touch the disk when it actually moved — this runs on every tray pop.
    let settings = app.state::<crate::settings::Settings>();
    if settings.get().window_pos != Some([p.x, p.y]) {
        let _ = settings.update(|d| d.window_pos = Some([p.x, p.y]));
    }
}

/// The position to restore to: this session's, else the one from settings.json.
fn recall_pos(app: &AppHandle, s: &mut Inner) -> Option<PhysicalPosition<i32>> {
    s.restore_pos.take().or_else(|| {
        app.state::<crate::settings::Settings>()
            .get()
            .window_pos
            .map(|[x, y]| PhysicalPosition::new(x, y))
    })
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
    // Hide first: the page is about to resize the window from the mini flyout to the
    // full surface, and `tray_place_main` then moves it. Doing that while it is visible
    // makes the window visibly grow and travel. Hidden, it is one clean cut — the
    // flyout goes, the full window appears already at its size and place. `hide` here
    // deliberately skips `hide_main`, which would set `main_hidden_at` and make the
    // re-show look like a fresh hide to the re-pop guard.
    if visible {
        w.hide().ok();
    }
    let _ = tauri::Emitter::emit_to(app, MAIN, "tray-open", ());
}

/// A `--tray` launch: the window never shows; the tray icon opens it.
pub fn start_hidden(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        w.hide().ok();
    }
    state(app).main_hidden_at = Some(Instant::now());
    note_main_visibility(app);
}

/// A hide gives the page no window event (and WebView2 keeps the page "visible", drawing
/// at full rate), so the page is told to re-check: src/ambient.ts pauses the decorative
/// loops while the window cannot be seen.
fn note_main_visibility(app: &AppHandle) {
    let _ = tauri::Emitter::emit_to(app, MAIN, "main-visibility", ());
}

// ── the launch show (UX-COVERUPS.md §6) ──────────────────────────────────────
// The main window starts hidden (tauri.conf.json `visible: false`). The page paints behind
// its launch cover (src/boot-cover.ts), then calls `main_ready`. A tray pop or Open that
// shows the window first wins; a `--tray` launch never shows it here.

static MAIN_SHOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
const READY_FALLBACK: Duration = Duration::from_secs(3);

fn tray_launch() -> bool {
    std::env::args().any(|a| a == "--tray")
}

/// The first show of a normal launch, in place (setup applied `windowPos`) and focused.
/// `color` is the page's canvas: the window's own background, so the first shown frame
/// is never WebView2's white.
fn reveal_main(app: &AppHandle, color: Option<[u8; 3]>) {
    if tray_launch() || MAIN_SHOWN.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let Some(w) = app.get_webview_window(MAIN) else { return };
    if let Some([r, g, b]) = color {
        w.set_background_color(Some(tauri::window::Color(r, g, b, 255))).ok();
    }
    state(app).shown_at = Some(Instant::now());
    w.show().ok();
    w.set_focus().ok();
    note_main_visibility(app);
}

/// The page has painted behind its cover (boot-cover.ts): show the window.
#[tauri::command]
pub fn main_ready(app: AppHandle, color: Option<[u8; 3]>) {
    reveal_main(&app, color);
}

/// Setup: show the window after READY_FALLBACK if the page never reported ready, so a
/// page error cannot leave the app running with no window.
pub fn reveal_fallback(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(READY_FALLBACK);
        if !tray_launch() && !MAIN_SHOWN.load(std::sync::atomic::Ordering::SeqCst) {
            crate::log::warn("launch: the page did not report ready; showing the window");
        }
        reveal_main(&app, None);
    });
}

fn hide_main(app: &AppHandle) {
    let mut s = state(app);
    // A × close of the real window is the other way its position is lost. Capture it
    // now, while the window still has one. A POPPED window sits at the tray anchor,
    // which must never overwrite the real position.
    if !s.popped {
        remember_pos(app, &mut s);
    }
    s.popped = false;
    s.main_hidden_at = Some(Instant::now());
    drop(s);
    if let Some(w) = app.get_webview_window(MAIN) {
        w.hide().ok();
    }
    note_main_visibility(app);
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
        remember_pos(app, &mut s);
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

/// Put the window back where the last session left it (`settings.json` → `windowPos`).
/// Guarded on the monitor layout: a position from a monitor that is now unplugged would
/// park the window off-screen, so an unmatched position is discarded and Windows places
/// the window as it normally would.
fn restore_window_pos(app: &AppHandle) {
    let Some([x, y]) = app.state::<crate::settings::Settings>().get().window_pos else { return };
    let Some(w) = app.get_webview_window(MAIN) else { return };
    let on_a_monitor = app.available_monitors().is_ok_and(|mons| {
        mons.iter().any(|m| {
            let (p, sz) = (m.position(), m.size());
            x >= p.x && y >= p.y && x < p.x + sz.width as i32 && y < p.y + sz.height as i32
        })
    });
    if on_a_monitor {
        w.set_position(PhysicalPosition::new(x, y)).ok();
    }
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    app.manage(TrayState(Mutex::new(Inner::default())));
    restore_window_pos(app);
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
        let at = s.pop_at.take();
        let restore = if s.popped { None } else { recall_pos(&app, &mut s) };
        (at, restore)
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
    MAIN_SHOWN.store(true, std::sync::atomic::Ordering::SeqCst); // the launch show is moot now
    w.show().ok();
    w.unminimize().ok();
    w.set_focus().ok();
    note_main_visibility(&app);
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
    crate::airplay::shutdown(&app);
    app.exit(0);
}
