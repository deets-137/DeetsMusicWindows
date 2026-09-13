// Appearance transition (NEXT-VERSION §6) — a theme or skin switch animates from the
// old look to the new one instead of snapping.
//
// Mechanism: a View Transition. The browser snapshots the old page, `fn` applies the
// switch (one attribute on <html>), then the snapshot animates into the live new state.
// While it runs, <html> carries `data-appearance="theme" | "skin"` so the CSS can tell
// a color crossfade (theme) from a skin's own entrance (skin.css: --appearance-*
// tokens; the INCOMING skin's tokens drive it, since <html> already wears the new skin).
//
// Snaps (calls `fn` directly) when the Animate-look-changes setting is off, the OS asks
// for reduced motion, or the API is missing. Startup never comes through here.

import { setting } from "./settings-store";
import * as frames from "./frames";
import type { SkinName } from "./skin";

type Kind = "theme" | "skin";

interface ViewTransitionLike {
  finished: Promise<void>;
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition(): void;
}
type StartVT = (update: () => void | Promise<void>) => ViewTransitionLike;

// Bundled faces per skin (fonts.css). Loaded INSIDE the update callback so the new
// snapshot is taken with the real faces, not a fallback that swaps a beat later.
const SKIN_FONTS: Record<SkinName, string[]> = {
  vanilla: ['12px "Liberation Serif"', '12px "Liberation Sans"'],
  press: ['12px "Anton"', '12px "IBM Plex Mono"'],
  ocean: ['12px "Cinzel"', '12px "Spectral"'],
  glass: ['12px "Liberation Sans"'],
  "retro-future": ['12px "Orbitron"', '12px "Rajdhani"'],
};

let running: ViewTransitionLike | null = null;

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/**
 * Run `fn` (which flips the theme/skin attribute) inside a View Transition. `after`
 * runs inside the same update callback, so e.g. the settings menu closes in the new
 * snapshot rather than being caught half-closed in the old one.
 */
export function withAppearanceTransition(kind: Kind, fn: () => void, opts: { skin?: SkinName; after?: () => void } = {}): void {
  const start = (document as unknown as { startViewTransition?: StartVT }).startViewTransition;
  if (!setting("appearanceMotion") || reducedMotion() || typeof start !== "function") {
    fn();
    opts.after?.();
    return;
  }
  // A second switch mid-animation: finish the first one instantly, then start fresh.
  running?.skipTransition();

  const root = document.documentElement;
  root.dataset.appearance = kind;
  const endFrames = frames.begin("appearance", kind);
  const vt = start.call(document, async () => {
    fn();
    if (opts.skin) {
      const faces = SKIN_FONTS[opts.skin] ?? [];
      await Promise.all(faces.map((f) => document.fonts.load(f).catch(() => undefined)));
    }
    opts.after?.();
  });
  running = vt;
  const done = () => {
    endFrames();
    if (running === vt) running = null;
    if (root.dataset.appearance === kind) delete root.dataset.appearance;
  };
  vt.finished.then(done, done);
}
