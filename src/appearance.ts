// Appearance change (UX-COVERUPS.md §6a, 2026-09-15) — a theme or skin change plays the
// launch animation (boot-cover.ts) instead of snapping.
//
// The stages, on <html data-boot> (styles.css §Launch cover):
//   veil — the cover fades in over the old look; the cards stay in place.
//   wait — the cover is opaque: the look changes under it and the new skin's fonts load.
//   lift — the cover fades and the cards rise, exactly as at launch.
// The OUTGOING skin's --cover-in-* tokens time the veil; the INCOMING skin's --boot-* tokens
// time the rise. Clicks pass the whole time, and nothing here touches playback.
//
// A second change during the veil or the wait joins the same cover. A change during the lift
// fades the cover back in. Snaps (calls `fn` directly) when Animate look changes is off, the
// OS asks for reduced motion, or the launch cover is still up.

import { setting } from "./settings-store";
import * as frames from "./frames";
import { tokenMs, nextFrame } from "./boot-cover";
import type { SkinName } from "./skin";

type Kind = "theme" | "skin";

// Bundled faces per skin (fonts.css). Loaded under the opaque cover so the rise shows the
// real faces, not a fallback that swaps a beat later.
const SKIN_FONTS: Record<SkinName, string[]> = {
  vanilla: ['12px "Liberation Serif"', '12px "Liberation Sans"'],
  press: ['12px "Anton"', '12px "IBM Plex Mono"'],
  ocean: ['12px "Cinzel"', '12px "Spectral"'],
  glass: ['12px "Liberation Sans"'],
  "retro-future": ['12px "Orbitron"', '12px "Rajdhani"'],
};

interface Job {
  fn: () => void;
  after?: () => void;
  skin?: SkinName;
}

let phase: "veil" | "wait" | "lift" | null = null;
let jobs: Job[] = [];
let timer = 0;
let endFrames: (() => void) | null = null;

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/**
 * Run `fn` (which flips the theme/skin attribute) under the launch cover. `after` runs once
 * the look has changed, while the cover is still opaque (e.g. the settings menu closes
 * unseen, and a publish reads the NEW attributes).
 */
export function withAppearanceTransition(kind: Kind, fn: () => void, opts: { skin?: SkinName; after?: () => void } = {}): void {
  const root = document.documentElement;
  if (!setting("appearanceMotion") || reducedMotion() || (phase === null && root.dataset.boot !== undefined)) {
    fn();
    opts.after?.();
    return;
  }
  jobs.push({ fn, after: opts.after, skin: opts.skin });
  if (phase === "veil" || phase === "wait") return; // joins the cover already coming in
  window.clearTimeout(timer);
  endFrames ??= frames.begin("appearance", kind);
  phase = "veil";
  root.dataset.boot = "veil";
  timer = window.setTimeout(() => void swap(), tokenMs("--cover-in-dur") + 30);
}

async function swap(): Promise<void> {
  const root = document.documentElement;
  phase = "wait";
  root.dataset.boot = "wait";
  const batch = jobs;
  jobs = [];
  batch.forEach((j) => j.fn());
  const faces = batch.flatMap((j) => (j.skin ? SKIN_FONTS[j.skin] ?? [] : []));
  await Promise.all(faces.map((f) => document.fonts.load(f).catch(() => undefined)));
  batch.forEach((j) => j.after?.());
  // The new look's first frames paint under the cover, not during the rise.
  await nextFrame();
  await nextFrame();
  if (jobs.length) return swap(); // a change arrived while the fonts loaded

  phase = "lift";
  root.dataset.boot = "lift";
  const slots = document.querySelectorAll(".bento > .panel").length;
  const total = tokenMs("--boot-dur") + tokenMs("--boot-stagger") * Math.max(0, slots - 1);
  timer = window.setTimeout(() => {
    phase = null;
    if (root.dataset.boot === "lift") delete root.dataset.boot;
    endFrames?.();
    endFrames = null;
  }, total + 50);
}
