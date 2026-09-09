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

import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

export type SurfaceName = "mini" | "midi" | "max";

const STORAGE_KEY = "deets.surface";
const FULL_KEY = "deets.surface.full"; // last non-mini surface — what "Open DeetsMusic" restores
const sizeKey = (s: SurfaceName) => `deets.surface.size.${s}`;
const DEFAULT_SURFACE: SurfaceName = "midi";

// ── Band table (hardcoded this build; the editor UI is a future setting) ──
// Width-driven: ≤ MINI_CEIL → mini · ≤ MIDI_CEIL → midi · above → max. Narrowing the
// app window below 340 px flips it to mini in place, widening past 350 flips it back (the
// window's minWidth in tauri.conf is 320 so that point is reachable); the tray flyout is
// the other entrance (TRAY.md §1). Being evaluated by the user, 2026-09-09.
const MINI_CEIL = 345;
const MIDI_CEIL = 820;
const HYST = 40; // must drag this far past the midi/max threshold before the surface flips
const MINI_HYST = 5; // the mini edge is tight on purpose: in below 340, out above 350

// Fallback sizes until a surface has a remembered one. midi = today's window.
const DEFAULT_SIZES: Record<SurfaceName, { w: number; h: number }> = {
  mini: { w: 360, h: 560 },
  midi: { w: 480, h: 864 },
  max: { w: 1100, h: 820 },
};

const appWindow = getCurrentWindow();

let active: SurfaceName = DEFAULT_SURFACE;
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
}

function persistChoice(s: SurfaceName): void {
  try {
    localStorage.setItem(STORAGE_KEY, s);
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
        sizeKey(active),
        JSON.stringify({ w: window.innerWidth, h: window.innerHeight }),
      );
    } catch {
      /* storage disabled */
    }
  }, 250);
}

function rememberedSize(s: SurfaceName): { w: number; h: number } {
  try {
    const raw = localStorage.getItem(sizeKey(s));
    if (raw) {
      const v = JSON.parse(raw);
      if (typeof v?.w === "number" && typeof v?.h === "number") return v;
    }
  } catch {
    /* fall through to default */
  }
  return DEFAULT_SIZES[s];
}

/** Resize the OS window to a surface's remembered (or default) size, without triggering a flip. */
async function applySize(s: SurfaceName, useDefault = false): Promise<void> {
  const { w, h } = useDefault ? DEFAULT_SIZES[s] : rememberedSize(s);
  applyingSize = true;
  try {
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

// Reflect the active surface onto the settings flyout's radio items.
function markActive(s: SurfaceName): void {
  document.querySelectorAll<HTMLElement>("[data-surface-choice]").forEach((el) => {
    el.setAttribute("aria-checked", String(el.dataset.surfaceChoice === s));
  });
}

function activate(s: SurfaceName): void {
  active = s;
  setAttribute(s);
  persistChoice(s);
  markActive(s);
  if (s !== "mini") {
    try { localStorage.setItem(FULL_KEY, s); } catch { /* session-only */ }
  }
}

/** The surface the real app window uses (midi unless the user chose max). */
export function fullSurface(): SurfaceName {
  const v = localStorage.getItem(FULL_KEY);
  return v === "max" ? "max" : "midi";
}

/** Deliberate selection (settings row / tray). Restores the surface's remembered size —
 *  or, with `fixed`, its default (the tray flyout is a fixed panel, DA/DR style, so a
 *  stray remembered mini size can't make it tall). Resolves once the OS window has that
 *  size (the tray anchors after it). */
export async function applySurface(s: SurfaceName, fixed = false): Promise<void> {
  if (s === active && !fixed) return;
  activate(s);
  await applySize(s, fixed);
}

export function currentSurface(): SurfaceName {
  return active;
}

export function initSurface(): void {
  const saved = (localStorage.getItem(STORAGE_KEY) as SurfaceName | null) ?? DEFAULT_SURFACE;
  activate(saved);
  // Honor the deliberate choice across restarts: the window opens at tauri.conf's size,
  // so restore the chosen surface's remembered size (no-op when they already match).
  void applySize(saved);

  // The resize allowance: free within the band, flip past threshold + hysteresis.
  const observer = new ResizeObserver(() => {
    if (applyingSize) return;
    const next = flipFor(window.innerWidth, active);
    if (next !== active) activate(next);
    saveSize();
  });
  observer.observe(document.documentElement);
}
