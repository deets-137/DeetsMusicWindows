// Surface system (mini | midi | max) — the Phase 3 seam (SURFACES-AND-CARDS §4).
//
// `data-surface` on <html> is the same lever as `data-theme` / `data-skin`: CSS gates
// layout off the attribute. Surface is a DELIBERATE USER CHOICE with a resize
// allowance (FUTURE-SETTINGS §8): the user picks a surface (settings menu, tray), and
// free resizing within a surface's band stays put — only crossing a band threshold (plus
// a hysteresis dead-band) flips to the adjacent surface.
//
// Open sizes (FUTURE-SETTINGS §8a, 2026-09-15): every open — a surface button, the tray,
// the launch, an agent — sets the window to the view's size from the settings store
// (sizeMini / sizePlayer / sizeMidi / sizeMax). A resize by hand is not remembered.

import { setting, onSettingsChange, DEFAULTS } from "./settings-store";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

export type SurfaceName = "mini" | "midi" | "max";
/** What mini shows (2026-09-14): Now Playing + one card, or the player — the Now Playing
 *  card alone, styled as max's stage. `data-mini` on <html>; the flyout's "Mini | NP" row. */
export type MiniView = "cards" | "player";

const STORAGE_KEY = "deets.surface";
const FULL_KEY = "deets.surface.full"; // last non-mini surface — what "Open DeetsMusic" restores
const MINI_VIEW_KEY = "deets.surface.mini";
/** A size is set per surface, and the player (NP) has its own. */
export type SizeSlot = SurfaceName | "player";
export type SizeKey = "sizeMini" | "sizePlayer" | "sizeMidi" | "sizeMax";
/** The setting that holds each view's open size (FUTURE-SETTINGS §8a). */
export const SIZE_KEYS: Record<SizeSlot, SizeKey> = { mini: "sizeMini", player: "sizePlayer", midi: "sizeMidi", max: "sizeMax" };
const DEFAULT_SURFACE: SurfaceName = "midi";

// ── Band table (hardcoded this build; the editor UI is a future setting) ──
// Width-driven: ≤ MINI_CEIL → mini · ≤ MIDI_CEIL → midi · above → max. Narrowing the
// app window below 455 px flips it to mini in place, widening past 465 flips it back; the
// tray flyout is the other entrance (TRAY.md §1). The player (NP) never flips on a resize
// (§8a): there is no smaller surface to go to, and a wide NP is not a Midi.
// The ceiling sits between mini's floor (385) and midi's (495), so each surface only ever
// draws at or above its own floor (user's numbers, 2026-09-15).
const MINI_CEIL = 460;
const MIDI_CEIL = 820;
const HYST = 40; // must drag this far past the midi/max threshold before the surface flips
const MINI_HYST = 5; // the mini edge is tight on purpose: in below 455, out above 465

// The floor of each view: the size below which its layout stops reading well (the user's
// numbers, 2026-09-15). NP's 404 px width is the measured floor for the Press record: below
// it the disc jittered. tauri.conf holds the first-paint size and a low floor for both.
export const MIN_SIZES: Record<SizeSlot, { w: number; h: number }> = {
  mini: { w: 385, h: 550 },
  player: { w: 404, h: 550 },
  midi: { w: 495, h: 670 },
  max: { w: 495, h: 670 },
};
// While "Resize changes surface" is on, a window wider than mini must still be draggable
// past the flip point, which is under midi's own floor. So midi and max take mini's floor
// as their OS minimum then: the flip fires at 455 and midi never actually draws below it.
const flipFloor = (k: SizeSlot): { w: number; h: number } =>
  (k === "midi" || k === "max") && setting("surfaceAutoFlip") ? MIN_SIZES.mini : MIN_SIZES[k];

const appWindow = getCurrentWindow();

let active: SurfaceName = DEFAULT_SURFACE;
let miniView: MiniView = (() => {
  try { return localStorage.getItem(MINI_VIEW_KEY) === "player" ? "player" : "cards"; } catch { return "cards"; }
})();
const slotOf = (s: SurfaceName): SizeSlot => (s === "mini" && miniView === "player" ? "player" : s);
let minKey = "";
let applyingSize = false; // suppress auto-flip while we programmatically resize
// The size each view had while it was on screen, this session only (never stored). The
// Settings card's Set current reads it, so the NP row can be set from another view: the
// card cannot be open while NP shows (a card request switches mini back to its cards view).
const seen: Partial<Record<SizeSlot, string>> = {};

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

/** "520x560" → `{ w: 520, h: 560 }`; anything else → null. */
export function parseSize(v: string): { w: number; h: number } | null {
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(String(v).trim());
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

/** A view's open size: the setting (or its default when the stored text is bad), kept at or
 *  above the view's minimum and inside the screen's work area. Whole logical px. */
function openSize(k: SizeSlot): { w: number; h: number } {
  const key = SIZE_KEYS[k];
  const { w, h } = parseSize(setting(key)) ?? parseSize(DEFAULTS[key])!;
  const min = MIN_SIZES[k];
  const maxW = Math.max(min.w, window.screen.availWidth);
  const maxH = Math.max(min.h, window.screen.availHeight);
  return {
    w: Math.round(Math.min(Math.max(w, min.w), maxW)),
    h: Math.round(Math.min(Math.max(h, min.h), maxH)),
  };
}

/** The view that shows now. */
export function activeSizeSlot(): SizeSlot {
  return slotOf(active);
}

/** The window's size now, as a setting value ("520x560"). `setSize` with a LogicalSize sets
 *  the inner size and the titlebar is ours, so innerWidth/innerHeight are the same unit. */
export function currentSizeText(): string {
  return `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}`;
}

/** The size a view has now, or had while it was last on screen this session; null when it
 *  has not been on screen yet (Set current then has nothing to take). */
export function sizeSeen(slot: SizeSlot): string | null {
  if (slot === slotOf(active)) return currentSizeText();
  return seen[slot] ?? null;
}

/** Set the window's minimum for the active view (only when it changes). */
async function applyMinSize(): Promise<void> {
  const k = slotOf(active);
  const id = `${k}:${setting("surfaceAutoFlip")}`; // the floor follows the toggle (flipFloor)
  if (id === minKey) return;
  minKey = id;
  const { w, h } = flipFloor(k);
  try {
    await appWindow.setMinSize(new LogicalSize(w, h));
  } catch (e) {
    console.error("[surface] setMinSize failed", e);
  }
}

/** Resize the OS window to a surface's open size, without triggering a flip. */
async function applySize(s: SurfaceName): Promise<void> {
  const { w, h } = openSize(slotOf(s));
  applyingSize = true;
  try {
    await applyMinSize(); // first: a smaller size would be refused under the old minimum
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
 *  changing (then the two arguments are equal). Returns an unsubscribe fn. */
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

/** Deliberate selection (settings row / tray / agent). Always sets the view's open size —
 *  also when that view already shows, so its own button puts a hand-resized window back
 *  (§8a, 1A). Resolves once the OS window has that size (the tray anchors after it).
 *  `view` picks what mini shows; omitted, mini keeps the last one. The switch itself is
 *  synchronous — only the resize is awaited. */
export async function applySurface(s: SurfaceName, view?: MiniView): Promise<void> {
  const nextView = s === "mini" && view ? view : miniView;
  if (s !== active || nextView !== miniView) activate(s, nextView);
  await applySize(s);
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
  // The window opens at tauri.conf's size, so set the chosen view's open size.
  sized = applySize(saved);

  // The resize allowance: free within the band, flip past threshold + hysteresis.
  const observer = new ResizeObserver(() => {
    if (applyingSize) return;
    seen[slotOf(active)] = currentSizeText(); // a hand resize: this session only
    // "Resize changes surface" off (SETTINGS.md / FUTURE-SETTINGS §8): the window resizes
    // freely and the surface only changes by a deliberate pick. The player never flips (§8a).
    if (setting("surfaceAutoFlip") && !isPlayerView()) {
      const next = flipFor(window.innerWidth, active);
      if (next !== active) {
        activate(next);
        void applyMinSize(); // player → midi raises the minimum height again
      }
    }
  });
  observer.observe(document.documentElement);

  // A new open size for the view that shows applies at once (a menu pick, an agent set, a
  // Reset). Set current writes the size the window already has, so that resize is a no-op.
  onSettingsChange((key) => {
    if (key === SIZE_KEYS[slotOf(active)]) void applySize(active);
    if (key === "surfaceAutoFlip") void applyMinSize(); // the OS floor follows it (flipFloor)
  });
}
