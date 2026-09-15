// Surface system (mini | midi | max) — the Phase 3 seam (SURFACES-AND-CARDS §4).
//
// `data-surface` on <html> is the same lever as `data-theme` / `data-skin`: CSS gates
// layout off the attribute. Surface is a DELIBERATE USER CHOICE with a resize
// allowance (FUTURE-SETTINGS §8): the user picks a surface (settings menu; mini via
// minimize, later), each surface remembers its own window size, and free resizing
// within a surface's band stays put — only crossing a band threshold (plus a
// hysteresis dead-band) flips to the adjacent surface.
//
// This build is the seam only: midi is fully implemented; max/mini fall back to the
// midi layout until their compositions are designed.

import { setting } from "./settings-store";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

export type SurfaceName = "mini" | "midi" | "max";
/** What mini shows (2026-09-14): Now Playing + one card, or the player — the Now Playing
 *  card alone, styled as max's stage. `data-mini` on <html>; the flyout's "Mini | NP" row. */
export type MiniView = "cards" | "player";

const STORAGE_KEY = "deets.surface";
const FULL_KEY = "deets.surface.full"; // last non-mini surface — what "Open DeetsMusic" restores
const MINI_VIEW_KEY = "deets.surface.mini";
/** A window size is remembered per surface, and the player has its own. */
type SizeSlot = SurfaceName | "player";
const sizeKey = (k: SizeSlot) => (k === "player" ? "deets.surface.size.mini-player" : `deets.surface.size.${k}`);
const DEFAULT_SURFACE: SurfaceName = "midi";

// ── Band table (hardcoded this build; the editor UI is a future setting) ──
// Width-driven: ≤ MINI_CEIL → mini · ≤ MIDI_CEIL → midi · above → max. Narrowing the
// app window below 340 px flips it to mini in place, widening past 350 flips it back (the
// window's minWidth in tauri.conf is 320 so that point is reachable); the tray flyout is
// the other entrance (TRAY.md §1). Being evaluated by the user, 2026-09-09.
const MINI_CEIL = 360;
const MIDI_CEIL = 820;
const HYST = 40; // must drag this far past the midi/max threshold before the surface flips
const MINI_HYST = 5; // the mini edge is tight on purpose: in below 355, out above 365; the window minimum is 340

// Fallback sizes until a surface has a remembered one. midi = today's window.
const DEFAULT_SIZES: Record<SizeSlot, { w: number; h: number }> = {
  mini: { w: 360, h: 560 },
  player: { w: 360, h: 600 },
  midi: { w: 480, h: 864 },
  max: { w: 1100, h: 820 },
};
// The window's minimum, set per view. tauri.conf holds 340 × 560 for the first paint; the
// player drops the height so it can sit near a square (its cover shrinks with the window).
const MIN_SIZES: Record<SizeSlot, { w: number; h: number }> = {
  mini: { w: 340, h: 560 },
  player: { w: 340, h: 420 },
  midi: { w: 340, h: 560 },
  max: { w: 340, h: 560 },
};

const appWindow = getCurrentWindow();

let active: SurfaceName = DEFAULT_SURFACE;
let miniView: MiniView = (() => {
  try { return localStorage.getItem(MINI_VIEW_KEY) === "player" ? "player" : "cards"; } catch { return "cards"; }
})();
const slotOf = (s: SurfaceName): SizeSlot => (s === "mini" && miniView === "player" ? "player" : s);
let minKey = "";
let applyingSize = false; // suppress auto-flip while we programmatically resize
let saveTimer: number | undefined;

/** The surface a width lands in, ignoring hysteresis (pure band lookup). */
function bandFor(width: number): SurfaceName {
  return width <= MINI_CEIL ? "mini" : width <= MIDI_CEIL ? "midi" : "max";
}

/** Where a resize takes the CURRENT surface — flips only past threshold + hysteresis. */
function flipFor(width: number, cur: SurfaceName): SurfaceName {
  switch (cur) {
    case "mini":
      return width > MINI_CEIL + MINI_HYST ? bandFor(width) : "mini";
    case "midi":
      if (width > MIDI_CEIL + HYST) return "max";
      if (width < MINI_CEIL - MINI_HYST) return "mini";
      return "midi";
    case "max":
      return width < MIDI_CEIL - HYST ? bandFor(width) : "max";
  }
}

function setAttribute(s: SurfaceName): void {
  document.documentElement.dataset.surface = s;
  document.documentElement.dataset.mini = miniView;
}

function persistChoice(s: SurfaceName): void {
  try {
    localStorage.setItem(STORAGE_KEY, s);
    localStorage.setItem(MINI_VIEW_KEY, miniView);
  } catch {
    /* storage disabled — surface still applies for the session */
  }
}

/** Remember the active surface's current window size (debounced off resize). */
function saveSize(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(
        sizeKey(slotOf(active)),
        JSON.stringify({ w: window.innerWidth, h: window.innerHeight }),
      );
    } catch {
      /* storage disabled */
    }
  }, 250);
}

function rememberedSize(k: SizeSlot): { w: number; h: number } {
  try {
    const raw = localStorage.getItem(sizeKey(k));
    if (raw) {
      const v = JSON.parse(raw);
      if (typeof v?.w === "number" && typeof v?.h === "number") return v;
    }
  } catch {
    /* fall through to default */
  }
  return DEFAULT_SIZES[k];
}

/** Set the window's minimum for the active view (only when it changes). */
async function applyMinSize(): Promise<void> {
  const k = slotOf(active);
  if (k === minKey) return;
  minKey = k;
  const { w, h } = MIN_SIZES[k];
  try {
    await appWindow.setMinSize(new LogicalSize(w, h));
  } catch (e) {
    console.error("[surface] setMinSize failed", e);
  }
}

/** Resize the OS window to a surface's remembered (or default) size, without triggering a flip. */
async function applySize(s: SurfaceName, useDefault = false): Promise<void> {
  const k = slotOf(s);
  const { w, h } = useDefault ? DEFAULT_SIZES[k] : rememberedSize(k);
  applyingSize = true;
  try {
    await applyMinSize(); // first: a smaller player size would be refused under the old minimum
    await appWindow.setSize(new LogicalSize(w, h));
  } catch (e) {
    console.error("[surface] setSize failed", e);
  } finally {
    // Let the resize events from our own setSize drain before re-enabling auto-flip.
    window.setTimeout(() => {
      applyingSize = false;
    }, 100);
  }
}


// Reflect the active surface onto the settings flyout's radio items. The "Mini | NP" halves
// also carry data-mini-choice; only the half for the current view is checked.
function markActive(s: SurfaceName): void {
  document.querySelectorAll<HTMLElement>("[data-surface-choice]").forEach((el) => {
    const view = el.dataset.miniChoice;
    const on = el.dataset.surfaceChoice === s && (!view || view === miniView);
    el.setAttribute("aria-checked", String(on));
  });
}

// Surface-change subscribers (the layout manager recomposes its slots on a flip).
type SurfaceListener = (s: SurfaceName, prev: SurfaceName) => void;
const listeners = new Set<SurfaceListener>();
/** Subscribe to surface flips (deliberate picks AND band crossings) and to mini's view
 *  changing (then `s === prev`). Returns an unsubscribe fn. */
export function onSurfaceChange(cb: SurfaceListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function activate(s: SurfaceName, view: MiniView = miniView): void {
  const prev = active;
  const prevView = miniView;
  active = s;
  miniView = view;
  setAttribute(s);
  persistChoice(s);
  markActive(s);
  if (s !== "mini") {
    try { localStorage.setItem(FULL_KEY, s); } catch { /* session-only */ }
  }
  if (prev !== s || prevView !== view) listeners.forEach((cb) => cb(s, prev));
}

/** True while the window shows the player (mini, NP only). */
export function isPlayerView(): boolean {
  return active === "mini" && miniView === "player";
}

/** The surface the real app window uses (midi unless the user chose max). */
export function fullSurface(): SurfaceName {
  const v = localStorage.getItem(FULL_KEY);
  return v === "max" ? "max" : "midi";
}

/** Deliberate selection (settings row / tray). Restores the surface's remembered size —
 *  or, with `fixed`, its default (the tray flyout is a fixed panel, DA/DR style, so a
 *  stray remembered mini size can't make it tall). Resolves once the OS window has that
 *  size (the tray anchors after it). `view` picks what mini shows; omitted, mini keeps
 *  the last one. The switch itself is synchronous — only the resize is awaited. */
export async function applySurface(s: SurfaceName, fixed = false, view?: MiniView): Promise<void> {
  const nextView = s === "mini" && view ? view : miniView;
  if (s === active && nextView === miniView && !fixed) return;
  activate(s, nextView);
  await applySize(s, fixed);
}

export function currentSurface(): SurfaceName {
  return active;
}

// The launch resize (initSurface): the launch cover (boot-cover.ts) waits for it, so the
// window shows already at its size.
let sized: Promise<void> = Promise.resolve();
export const surfaceSized = (): Promise<void> => sized;

export function initSurface(): void {
  const saved = (localStorage.getItem(STORAGE_KEY) as SurfaceName | null) ?? DEFAULT_SURFACE;
  activate(saved);
  // Honor the deliberate choice across restarts: the window opens at tauri.conf's size,
  // so restore the chosen surface's remembered size (no-op when they already match).
  sized = applySize(saved);

  // The resize allowance: free within the band, flip past threshold + hysteresis.
  const observer = new ResizeObserver(() => {
    if (applyingSize) return;
    // "Resize flips the surface" off (SETTINGS.md / FUTURE-SETTINGS §8): the window
    // resizes freely and the surface only changes by a deliberate pick.
    if (setting("surfaceAutoFlip")) {
      const next = flipFor(window.innerWidth, active);
      if (next !== active) {
        activate(next);
        void applyMinSize(); // player → midi raises the minimum height again
      }
    }
    saveSize();
  });
  observer.observe(document.documentElement);
}
