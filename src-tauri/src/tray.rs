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

use crate::lock::LockExt;
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
    app.state::<TrayState>().inner().0.lock_or_recover()
}

/// Remember where the REAL app window sits, in `Inner` and in settings.json. Called
/// before anything moves it to the tray (a pop) or hides it (× to tray), so "Open
/// DeetsMusic" and the pinned taskbar button can put it back — after a × close and
/// after a restart, which an in-memory field alone cannot do.
fn remember_pos(app: &AppHandle, s: &mut Inner) {
    let Some(w) = app.get_webview_window(MAIN) else { return };
    // A minimized window reports -32000, Windows' parking place, not where it sits.
    if w.is_minimized().unwrap_or(false) {
        return;
    }
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
        // The panel stops rendering the once-a-second `np` while hidden (tray.ts). It keys
        // on this, not on blur: a debug build does not hide on blur, and a panel that is on
        // screen but unfocused must keep its clock moving.
        let _ = tauri::Emitter::emit_to(app, PANEL, "panel-hidden", ());
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
    if !visible {
        restore_hidden(&w);
    }
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

/// The page sizes the window before it shows. A minimized window takes no size or place:
/// Windows keeps them for its restore, so the window came back at the old ones and the
/// surface flipped to match (2026-10-23: a popped flyout was minimized, then "Open DeetsMusic"
/// showed Mini). Restore it first, then hide it again before the page resizes it.
fn restore_hidden(w: &tauri::WebviewWindow) {
    if w.is_minimized().unwrap_or(false) {
        w.unminimize().ok();
        w.hide().ok();
    }
}

/// The title bar's − (the page's `tl-min`). A tray-popped window has no taskbar button, so a
/// minimize would leave it nowhere: it goes back to the tray, as a click away does.
#[tauri::command]
pub fn main_minimize(app: AppHandle) {
    let Some(w) = app.get_webview_window(MAIN) else { return };
    if state(&app).popped {
        hide_main(&app);
    } else {
        w.minimize().ok();
    }
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

/// How this start shows its window: "tray" (never here), "min" (minimized, not focused), or
/// unset (in place, focused). Set once in setup, from `--tray` or a quiet graphics restart's
/// intent (gpu.rs `take_intent`, GRAPHICS-FALLBACK.md §10.5).
static LAUNCH: std::sync::OnceLock<String> = std::sync::OnceLock::new();

pub fn set_launch(kind: &str) {
    let _ = LAUNCH.set(kind.to_string());
}

pub fn tray_launch() -> bool {
    LAUNCH.get().is_some_and(|k| k == "tray") || std::env::args().any(|a| a == "--tray")
}

/// Show the window minimized, without taking the focus: the quiet restart of a window that was
/// minimized comes back on the taskbar only.
fn show_minimized(w: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWMINNOACTIVE};
    if let Ok(h) = w.hwnd() {
        unsafe {
            let _ = ShowWindow(HWND(h.0 as _), SW_SHOWMINNOACTIVE);
        }
    }
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
    if LAUNCH.get().is_some_and(|k| k == "min") {
        show_minimized(&w);
    } else {
        w.show().ok();
        w.set_focus().ok();
    }
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
    if let Some(w) = app.get_webview_window(MAIN) {
        if w.is_minimized().unwrap_or(false) {
            // A minimized window takes no size or place (`restore_hidden`). The real window
            // minimized to the taskbar: restore it hidden; `remember_pos` below then reads
            // where it really sits.
            drop(s);
            restore_hidden(&w);
            s = state(app);
        }
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

/// A remembered position, checked against the monitors plugged in now. A window that
/// overlaps no monitor (one since unplugged) is `None`, so Windows places the window as it
/// normally would. Otherwise the window goes to the monitor it overlaps most and is pulled
/// in so it stays on it (a lower resolution would otherwise leave most of the window off
/// the edge). 2026-09-29: this ran only at launch, so a tray-started app still opened on an
/// undocked monitor.
///
/// 2026-10-10: the monitor was found by the top-left corner alone. Windows 11 counts the
/// invisible resize border in the outer position, so a window snapped to a monitor's edge
/// has its corner ~8 px OFF that monitor (`-1088,-255` on a monitor at `-1080,-247`). No
/// monitor matched, the restore was skipped, and Open left the full app at the tray
/// anchor. Overlap finds the monitor; the clamp leaves the invisible border its slack.
fn fit_on_monitor(
    app: &AppHandle,
    w: &tauri::WebviewWindow,
    p: PhysicalPosition<i32>,
) -> Option<PhysicalPosition<i32>> {
    let mons = app.available_monitors().ok()?;
    let size = w.outer_size().unwrap_or_default();
    let (ww, wh) = (size.width as i64, size.height as i64);
    let overlap = |m: &tauri::Monitor| {
        let (mp, ms) = (m.position(), m.size());
        let (mx, my) = (mp.x as i64, mp.y as i64);
        let ox = ((p.x as i64 + ww).min(mx + ms.width as i64) - (p.x as i64).max(mx)).max(0);
        let oy = ((p.y as i64 + wh).min(my + ms.height as i64) - (p.y as i64).max(my)).max(0);
        ox * oy
    };
    let m = mons.iter().filter(|m| overlap(m) > 0).max_by_key(|m| overlap(m))?;
    let (mp, ms) = (m.position(), m.size());
    // The DWM invisible border: ~8 px at 100 %, scaled with the monitor.
    let slack = (8.0 * m.scale_factor()).round() as i32;
    let x = p.x.min(mp.x + ms.width as i32 - size.width as i32 + slack).max(mp.x - slack);
    let y = p.y.min(mp.y + ms.height as i32 - size.height as i32 + slack).max(mp.y - slack);
    Some(PhysicalPosition::new(x, y))
}

// ── The icon's hover text (TRAY.md §7, his calls T1 B and T2 A, 2026-10-15) ──────────

/// Windows' tray tooltip holds 127 UTF-16 units (`NOTIFYICONDATA.szTip`, 128 with the null).
const TIP_MAX: usize = 127;

fn units(s: &str) -> usize {
    s.encode_utf16().count()
}

/// `s` in at most `n` UTF-16 units, its end replaced by "…" when it is cut.
fn cut(s: &str, n: usize) -> String {
    if units(s) <= n {
        return s.to_string();
    }
    if n == 0 {
        return String::new();
    }
    let mut out = String::new();
    let mut used = 0;
    for c in s.chars() {
        let w = c.len_utf16();
        if used + w > n - 1 {
            break;
        }
        out.push(c);
        used += w;
    }
    format!("{}…", out.trim_end())
}

/// "2:14", or "1:02:14" past an hour.
fn clock(secs: f64) -> String {
    let s = secs.max(0.0).round() as u64;
    if s >= 3600 {
        format!("{}:{:02}:{:02}", s / 3600, (s / 60) % 60, s % 60)
    } else {
        format!("{}:{:02}", s / 60, s % 60)
    }
}

/// The tray icon's hover text (TRAY.md §7). Three lines at most:
/// `Song — Artist` · `Album · 2:14 left` · `Next: Song — Artist` (or `Station: name`).
/// No play or pause mark (his call). Nothing plays: `DeetsMusic`.
///
/// **The cut (his call, 2026-10-15): the lines share the room evenly.** The 127 UTF-16 units,
/// less the line breaks and each line's fixed words (`Next: `, ` · 2:14 left`), are shared
/// among the three lines' own text; a line shorter than its share gives the rest to the others
/// (`even_shares`). Each line is cut at its end, so line 1 loses the artist before the song,
/// line 2 loses the album and keeps the time whole, and line 3 keeps `Next: ` and the start of
/// the next song. So the time, part of the song playing, and part of the next song always show.
pub(crate) fn tooltip_text(s: &crate::bridge::NpState) -> String {
    let nz = |o: &Option<String>| o.as_deref().map(str::trim).filter(|v| !v.is_empty()).map(String::from);
    let Some(title) = nz(&s.title).filter(|_| s.active) else { return "DeetsMusic".into() };
    // The time left, while it can be known (a live station has no end).
    let left = (s.duration > 0.0 && !s.live).then(|| format!("{} left", clock(s.duration - s.current_time)));
    // Each line: (fixed words before, its own text, fixed words after).
    let mut lines: Vec<(String, String, String)> = Vec::new();
    let line1 = match nz(&s.artist) {
        Some(a) => format!("{title} — {a}"),
        None => title,
    };
    lines.push((String::new(), line1, String::new()));
    match (nz(&s.album), &left) {
        (Some(al), Some(l)) => lines.push((String::new(), al, format!(" · {l}"))),
        (Some(al), None) => lines.push((String::new(), al, String::new())),
        (None, Some(l)) => lines.push((String::new(), String::new(), l.clone())),
        (None, None) => {}
    }
    match nz(&s.station) {
        Some(st) => lines.push(("Station: ".into(), st, String::new())),
        None => {
            if let Some(t) = nz(&s.next_title) {
                let own = match nz(&s.next_artist) {
                    Some(a) => format!("{t} — {a}"),
                    None => t,
                };
                lines.push(("Next: ".into(), own, String::new()));
            }
        }
    }
    let fixed: usize = lines.iter().map(|(b, _, a)| units(b) + units(a)).sum::<usize>() + lines.len() - 1;
    let room = TIP_MAX.saturating_sub(fixed);
    let shares = even_shares(&lines.iter().map(|(_, own, _)| units(own)).collect::<Vec<_>>(), room);
    let text = lines
        .iter()
        .zip(shares)
        .map(|((before, own, after), n)| format!("{before}{}{after}", cut(own, n)))
        .collect::<Vec<_>>()
        .join("\n");
    cut(&text, TIP_MAX) // a guard only: the shares already fit
}

/// Share `room` among parts of these lengths as evenly as it goes: a part shorter than its
/// share keeps its length and leaves the rest to the others ("water filling"). The shares
/// never add up to more than `room`.
fn even_shares(lens: &[usize], room: usize) -> Vec<usize> {
    let mut out = vec![0; lens.len()];
    let mut order: Vec<usize> = (0..lens.len()).collect();
    order.sort_by_key(|&i| lens[i]);
    let mut left = room;
    for (k, &i) in order.iter().enumerate() {
        let share = left / (lens.len() - k);
        out[i] = lens[i].min(share);
        left -= out[i];
    }
    out
}

/// Set the icon's hover text from the hub (each `np_publish`, at most about once a second);
/// a call only when the text changed. An open tooltip shows the new text at once (the probe,
/// TRAY.md §7), so the time left counts down while the pointer rests on the icon.
pub fn update_tooltip(app: &AppHandle, s: &crate::bridge::NpState) {
    static LAST: Mutex<String> = Mutex::new(String::new());
    let text = tooltip_text(s);
    {
        let mut last = LAST.lock_or_recover();
        if *last == text {
            return;
        }
        *last = text.clone();
    }
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_tooltip(Some(text)).ok();
    }
}

/// Put the window back where the last session left it (`settings.json` → `windowPos`),
/// guarded on the monitor layout by `fit_on_monitor`.
fn restore_window_pos(app: &AppHandle) {
    let Some([x, y]) = app.state::<crate::settings::Settings>().get().window_pos else { return };
    let Some(w) = app.get_webview_window(MAIN) else { return };
    if let Some(p) = fit_on_monitor(app, &w, PhysicalPosition::new(x, y)) {
        w.set_position(p).ok();
    }
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    app.manage(TrayState(Mutex::new(Inner::default())));
    restore_window_pos(app);
    TrayIconBuilder::with_id("main")
        .icon(crate::app_icon::tray_image().unwrap_or_else(|| app.default_window_icon().expect("window icon").clone()))
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
    crate::display::on_window_event(win, ev);
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
        // A move to a monitor at another scale: reload the icon frames for it.
        (_, WindowEvent::ScaleFactorChanged { .. }) => crate::app_icon::set_window(win),
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
    } else if let Some(p) = restore.and_then(|p| fit_on_monitor(&app, &w, p)) {
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

/// Off the UI thread: the AirPlay TEARDOWN waits on the speaker, and a lost one waits for
/// its timeouts. Bounded as the update install does it.
#[tauri::command]
pub async fn app_quit(app: AppHandle) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        crate::update::airplay_shutdown_bounded(&app);
        app.exit(0);
    })
    .await;
}

#[cfg(test)]
mod tooltip_tests {
    use super::*;
    use crate::bridge::NpState;

    fn playing() -> NpState {
        NpState {
            active: true,
            playing: true,
            title: Some("Mentirasmentiras".into()),
            artist: Some("Girl Ultra, Buscabulla & Chromeo".into()),
            album: Some("Rrromeo".into()),
            duration: 200.0,
            current_time: 66.0,
            next_title: Some("Denisse".into()),
            next_artist: Some("Girl Ultra & Chromeo".into()),
            ..Default::default()
        }
    }

    /// 2026-10-15 (TRAY.md §7): his three lines; no play or pause mark.
    #[test]
    fn tray_text_has_his_three_lines_2026_10_15() {
        assert_eq!(
            tooltip_text(&playing()),
            "Mentirasmentiras — Girl Ultra, Buscabulla & Chromeo\nRrromeo · 2:14 left\nNext: Denisse — Girl Ultra & Chromeo"
        );
        // Paused: the same text (no mark).
        let paused = NpState { playing: false, ..playing() };
        assert_eq!(tooltip_text(&paused), tooltip_text(&playing()));
        // The last song in the queue: no third line.
        let last = NpState { next_title: None, next_artist: None, ..playing() };
        assert_eq!(tooltip_text(&last), "Mentirasmentiras — Girl Ultra, Buscabulla & Chromeo\nRrromeo · 2:14 left");
        // A live station: its name on line 3, and no time left.
        let st = NpState { station: Some("Chill Radio".into()), live: true, ..playing() };
        assert_eq!(tooltip_text(&st), "Mentirasmentiras — Girl Ultra, Buscabulla & Chromeo\nRrromeo\nStation: Chill Radio");
        // Nothing plays.
        assert_eq!(tooltip_text(&NpState::default()), "DeetsMusic");
        assert_eq!(clock(3734.0), "1:02:14");
    }

    /// 2026-10-15 (his call): too long, the three lines share the room evenly; the time, part
    /// of the song playing and part of the next song always show.
    #[test]
    fn tray_text_shares_the_room_evenly_2026_10_15() {
        // A long album: the next line (under its share) keeps all of it; the song line and the
        // album share the rest evenly, so the song line loses the end of its artist.
        let long = NpState {
            album: Some("A Very Long Deluxe Edition Album Name With Bonus Tracks And Live Recordings (Remastered 2026)".into()),
            ..playing()
        };
        let t = tooltip_text(&long);
        assert!(units(&t) <= TIP_MAX, "{t}");
        let lines: Vec<&str> = t.split('\n').collect();
        assert_eq!(lines[0], "Mentirasmentiras — Girl Ultra, Buscab…");
        assert_eq!(lines[1], "A Very Long Deluxe Edition Album Name… · 2:14 left");
        assert_eq!(lines[2], "Next: Denisse — Girl Ultra & Chromeo");
        // Everything long: three lines of about the same length, each with its start kept.
        let all = NpState {
            title: Some(format!("Song{}", "s".repeat(200))),
            artist: Some("a".repeat(200)),
            album: Some("b".repeat(200)),
            next_title: Some(format!("Later{}", "n".repeat(200))),
            ..playing()
        };
        let t = tooltip_text(&all);
        assert!(units(&t) <= TIP_MAX, "{} units", units(&t));
        let lines: Vec<&str> = t.split('\n').collect();
        assert_eq!(lines.len(), 3);
        assert!(lines[0].starts_with("Song") && lines[0].ends_with('…'));
        assert!(lines[1].ends_with("… · 2:14 left"), "{}", lines[1]);
        assert!(lines[2].starts_with("Next: Later") && lines[2].ends_with('…'));
        let own = [units(lines[0]), units(lines[1]) - units(" · 2:14 left"), units(lines[2]) - units("Next: ")];
        assert!(own.iter().max().unwrap() - own.iter().min().unwrap() <= 1, "{own:?}");
        assert_eq!(even_shares(&[10, 100, 100], 110), vec![10, 50, 50]);
        assert_eq!(even_shares(&[10, 20, 30], 200), vec![10, 20, 30]);
    }
}
