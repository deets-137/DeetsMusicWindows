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

import { effective } from "./settings-store";
import * as frames from "./frames";
import { mark } from "./marks";
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
  if (!effective("appearanceMotion") || reducedMotion() || (phase === null && root.dataset.boot !== undefined)) {
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

/**
 * A rule's theme change (UX-COVERUPS.md §6c): no cover — the colors crossfade in place, a View
 * Transition of `--theme-morph-dur`. A theme changes only colors, so the layout under the two
 * pictures is the same and the blend reads as the colors changing. Measured 2026-09-27: on an
 * integrated-class GPU as smooth as a snap; a color morph (`@property` roles) ran at ~20 fps.
 * While it runs, <html data-theme-fade> holds the ambient loops still (so the still old picture
 * and the live new one agree) and gives the Press record its own group that skips the fade.
 * Snaps when Animate look changes is off or the OS asks for reduced motion; a cover already
 * running (§6a) or the launch cover takes the change instead.
 *
 * A hand pick (§6c.2): `close` shuts the panel that made it, and the fade starts only when every
 * panel's exit has ended, so the old picture holds no half-gone panel (the Compass showed as a
 * ghost over the cards). Its curve is `--theme-morph-hand-ease`, which moves from the first frame.
 */
let fading: ViewTransition | null = null;
export function withThemeFade(
  fn: () => void,
  after: () => void,
  opts: { hand?: boolean; close?: () => void } = {},
): void {
  const root = document.documentElement;
  const close = opts.close ?? (() => undefined);
  if (phase !== null || root.dataset.boot !== undefined) {
    withAppearanceTransition("theme", fn, { after: () => { close(); after(); } });
    return;
  }
  if (!effective("appearanceMotion") || reducedMotion() || typeof document.startViewTransition !== "function") {
    close();
    fn();
    after();
    return;
  }
  mark("fade:ask", opts.hand ? "hand" : "rule");
  close();
  void panelExits().then(() => startThemeFade(fn, after, !!opts.hand));
}

/** The exits of the `.pop` panels closing now (the Compass, a title bar menu). On the pop ease a
 *  panel looks gone well before its exit ends (Glass: ~60 of 200 ms), so the fade waits only
 *  `--theme-morph-hand-wait` of `--pop-out`, then ends the exits: the faint rest goes in the
 *  same frame the fade starts, and the old picture holds no panel. */
function panelExits(): Promise<void> {
  const leaving = document.getAnimations().filter((a) => {
    const el = (a.effect as KeyframeEffect | null)?.target;
    return a.playState === "running" && el instanceof Element && el.matches(".pop[hidden]");
  });
  if (!leaving.length) return Promise.resolve();
  const frac = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--theme-morph-hand-wait"));
  const wait = tokenMs("--pop-out") * (Number.isFinite(frac) ? frac : 1);
  const ended = Promise.all(leaving.map((a) => a.finished.catch(() => undefined))).then(() => undefined);
  return Promise.race([ended, new Promise<void>((r) => window.setTimeout(r, wait))]).then(() => {
    const cut = leaving.filter((a) => a.playState === "running");
    for (const a of cut) a.finish();
    mark("fade:exits", cut.length ? `cut ${cut.length}` : "ended");
  });
}

function startThemeFade(fn: () => void, after: () => void, hand: boolean): void {
  const root = document.documentElement;
  // A cover that started while a panel left (a skin pick right after) takes the change.
  if (phase !== null || root.dataset.boot !== undefined) {
    withAppearanceTransition("theme", fn, { after });
    return;
  }
  const endFrames = frames.begin("theme-fade", `skin=${root.dataset.skin ?? "?"}${hand ? " by=hand" : ""}`);
  root.dataset.themeFade = hand ? "hand" : "";
  // A second change during a fade starts a new one; the browser ends the first where it is.
  const vt = document.startViewTransition(() => {
    fn();
    after();
  });
  fading = vt;
  // `ready`: the old picture is taken and the blend starts (the snapshot stall ends here).
  vt.ready.then(() => mark("fade:snapshot"), () => undefined);
  vt.finished
    .catch(() => undefined)
    .finally(() => {
      endFrames();
      if (fading !== vt) return;
      fading = null;
      delete root.dataset.themeFade;
    });
}

async function swap(): Promise<void> {
  const root = document.documentElement;
  phase = "wait";
  root.dataset.boot = "wait";
  mark("cover:wait"); // the veil is opaque; the new look is painted under it
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
