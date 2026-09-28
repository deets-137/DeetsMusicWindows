// Ambient pause. The skins' endless decorative loops (Ocean swell, Glass aurora,
// Cyber storm, the Now Playing aurora) hold still while the main window
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
//
// It also applies the "Animate backgrounds" setting (`backgroundMotion`) as
// `data-bg-motion` on <html>: reduced lowers --ambient-fps (skin.css), off holds the
// loops still and hides the storm (styles.css).
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { effective, onSettingsChange } from "./settings-store";
import { onSkinChange } from "./skin";
import { parseBezier, parseSeconds, steppedEase } from "./stepped-ease";

// The fancy scrubbers' float (styles.css): while music plays, each skin's handle moves on every
// progress bar — Ocean's bob and ripple, Glass's sheen, Cyber's breathing glow. At the display
// rate that alone kept the window compositing (and Cyber's glow is a filter: a repaint per
// frame). So each is stepped at --ambient-fps like the loops, with its ease kept
// (stepped-ease.ts). A keyframe's timing function eases ONE segment, so the steps are counted
// per segment. [token, the duration token, the ease in styles.css, the segment's share of it]
const SCRUB_EASES: [string, string, string, number][] = [
  ["--scrub-bob-ease-stepped", "--scrub-bob-dur", "ease-in-out", 0.5], // 0 → 50 % → 100 %
  ["--scrub-ripple-ease-stepped", "--scrub-bob-dur", "ease-out", 0.7], // the spread, 0 → 70 %
  ["--scrub-sheen-ease-stepped", "--scrub-sheen-dur", "ease-in-out", 1], // alternate, one way
  ["--scrub-breathe-ease-stepped", "--scrub-breathe-dur", "ease-in-out", 1],
];

function stepScrubEases(root: HTMLElement): void {
  const css = getComputedStyle(root);
  const fps = Number(css.getPropertyValue("--ambient-fps"));
  for (const [token, durToken, ease, share] of SCRUB_EASES) {
    const secs = parseSeconds(css.getPropertyValue(durToken));
    const curve = parseBezier(ease);
    if (secs && curve && fps > 0) root.style.setProperty(token, steppedEase(curve, secs * share, fps));
    else root.style.removeProperty(token); // the smooth ease (the CSS fallback)
  }
}

export function initAmbient(): void {
  const win = getCurrentWindow();
  const root = document.documentElement;

  const applyMotion = () => {
    root.dataset.bgMotion = effective("backgroundMotion");
    requestAnimationFrame(() => stepScrubEases(root)); // Reduced lowers --ambient-fps
  };
  applyMotion();
  onSkinChange(() => requestAnimationFrame(() => stepScrubEases(root))); // a skin may set its own durations
  onSettingsChange((k) => {
    if (k === "backgroundMotion") applyMotion();
  });
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
