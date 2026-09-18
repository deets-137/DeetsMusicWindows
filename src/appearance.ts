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
// Agent changes (§6b): a surface change is a third kind. Its job is async (the window resize)
// and runs in the wait stage, so the resize and the card recompose are never seen. A change
// marked `by: "agent"` sets <html data-boot-by="agent">: every cover time scales by the skin's
// --agent-motion (styles.css reads --motion-scale; tokenMs() applies the same scale).
//
// A second change during the veil or the wait joins the same cover (an agent's theme, skin and
// surface sent back to back share one). A change during the lift fades the cover back in.
// Snaps (calls `fn` directly) when Animate look changes is off, the OS asks for reduced motion,
// or the launch cover is still up.

import { setting } from "./settings-store";
import * as frames from "./frames";
import { tokenMs, nextFrame } from "./boot-cover";
import type { SkinName } from "./skin";

type Kind = "theme" | "skin" | "surface";

// Bundled faces per skin (fonts.css). Loaded under the opaque cover so the rise shows the
// real faces, not a fallback that swaps a beat later.
const SKIN_FONTS: Record<SkinName, string[]> = {
  vanilla: ['12px "Liberation Serif"', '12px "Liberation Sans"'],
  press: ['12px "Anton"', '12px "IBM Plex Mono"'],
  ocean: ['12px "Cinzel"', '12px "Spectral"'],
  glass: ['12px "Liberation Sans"'],
  "cyber": ['12px "Orbitron"', '12px "Rajdhani"'],
};

interface Job {
  fn: () => void | Promise<void>;
  after?: () => void;
  skin?: SkinName;
}

let phase: "veil" | "wait" | "lift" | null = null;
let jobs: Job[] = [];
let timer = 0;
let endFrames: (() => void) | null = null;
let frameDetail = ""; // the open window's detail, repeated on its lift-only line

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/**
 * Run `fn` (which flips the theme/skin attribute, or switches the surface) under the launch
 * cover. `after` runs once the change is made, while the cover is still opaque (e.g. the
 * settings menu closes unseen, and a publish reads the NEW attributes). Returns at once.
 */
export function withAppearanceTransition(
  kind: Kind,
  fn: () => void | Promise<void>,
  opts: { skin?: SkinName; after?: () => void; by?: "agent" } = {},
): void {
  const root = document.documentElement;
  if (!setting("appearanceMotion") || reducedMotion() || (phase === null && root.dataset.boot !== undefined)) {
    const r = fn();
    if (r) void r.then(() => opts.after?.(), (e) => console.error("[appearance]", e));
    else opts.after?.();
    return;
  }
  jobs.push({ fn, after: opts.after, skin: opts.skin });
  const joining = phase === "veil" || phase === "wait";
  if (!joining) delete root.dataset.bootBy; // a new cover runs at the user's speed…
  if (opts.by === "agent") root.dataset.bootBy = "agent"; // …unless an agent change is in it
  if (joining) return; // joins the cover already coming in
  window.clearTimeout(timer);
  // Name the skin that TIMES the lift: the incoming one on a skin change, else the one
  // already on (a theme or surface change rises on the current skin's --boot-* tokens).
  // Without it every line read "skin" and a slow switch could not be pinned on a skin.
  // Set on EVERY new cover, not only the first: a change that lands during the lift starts
  // a fresh cover while the old whole-cover window is still open, and keeping the old
  // detail labelled the new rise with the old skin's name (an interrupted Ocean rise was
  // followed by a 704 ms line — Press's length — still reading skin=ocean, 2026-09-16).
  const liftSkin = opts.skin ?? root.dataset.skin ?? "?";
  frameDetail = `${kind} skin=${liftSkin}${opts.by ? ` by=${opts.by}` : ""}`;
  if (!endFrames) endFrames = frames.begin("appearance", frameDetail);
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
  // In order (theme, then skin, then surface); a failed job must not hold the cover up.
  for (const j of batch) {
    try {
      await j.fn();
    } catch (e) {
      console.error("[appearance]", e);
    }
  }
  const faces = batch.flatMap((j) => (j.skin ? SKIN_FONTS[j.skin] ?? [] : []));
  await Promise.all(faces.map((f) => document.fonts.load(f).catch(() => undefined)));
  batch.forEach((j) => j.after?.());
  // The new look's first frames paint under the cover, not during the rise.
  await nextFrame();
  await nextFrame();
  if (jobs.length) return swap(); // a change arrived while the fonts loaded or the window resized

  phase = "lift";
  root.dataset.boot = "lift";
  const slots = document.querySelectorAll(".bento .panel").length;
  const total = tokenMs("--boot-dur") + tokenMs("--boot-stagger") * Math.max(0, slots - 1);
  // The whole-cover line counts the opaque wait stage too (the recompose, fonts, resize);
  // this one is only the rise the user sees.
  frames.during("appearance-lift", total, `${frameDetail} slots=${slots}`);
  timer = window.setTimeout(() => {
    phase = null;
    if (root.dataset.boot === "lift") {
      delete root.dataset.boot;
      delete root.dataset.bootBy;
    }
    endFrames?.();
    endFrames = null;
  }, total + 50);
}
