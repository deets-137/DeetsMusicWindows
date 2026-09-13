// Ambient pause. The skins' endless decorative loops (Ocean swell, Glass aurora,
// Retro-Future storm, the Now Playing aurora) hold still while the main window
// cannot be seen: minimized, or hidden to the tray. CSS does the pausing
// (`:root[data-ambient="paused"]` → animation-play-state, styles.css); this module
// only sets the attribute.
//
// Why not `visibilitychange`: WebView2 keeps the page "visible" when the window is
// minimized or hidden and keeps drawing at the full frame rate (measured 2026-09-13),
// so the page never learns. The window itself is asked instead, on every event that
// can change the answer: a resize (minimize / restore), a focus change (every show
// focuses), and `main-visibility` from the Rust hide / show paths (tray.rs), because a
// hide emits no window event.
//
// Resume is one IPC round trip (a few ms) and play-state keeps each loop's position,
// so a re-opened window shows the layers already moving, from where they stopped.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

export function initAmbient(): void {
  const win = getCurrentWindow();
  const root = document.documentElement;
  let seq = 0; // only the newest check may write — events can arrive in a burst

  const check = async () => {
    const mine = ++seq;
    let seen = true; // on any failure, keep the loops running (the old behavior)
    try {
      const [visible, minimized] = await Promise.all([win.isVisible(), win.isMinimized()]);
      seen = visible && !minimized;
    } catch (e) {
      console.error("[ambient]", e);
    }
    if (mine !== seq) return;
    if (seen) delete root.dataset.ambient;
    else root.dataset.ambient = "paused";
  };

  win.onResized(check);
  win.onFocusChanged(check);
  listen("main-visibility", check);
  check();
}
