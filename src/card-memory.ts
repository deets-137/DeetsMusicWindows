// Card memory (CARD-MEMORY.md) — a remounted card comes back where it was. A card hands the
// layout a snapshot on destroy (keys and view state, never data or DOM); the layout hands it
// back on the next mount. Memory only by default; the "Keep card places on restart" row
// (`cardMemoryDisk`) also writes the map to localStorage.

import type { CardId } from "./cards";
import { setting, onSettingsChange } from "./settings-store";
import * as diag from "./diag";

const KEY = "deets.cardMemory";

const mem = new Map<CardId, unknown>();
// The mounted cards' live snapshots (the layout installs it): a quit saves what is on screen too.
let live: () => [CardId, unknown][] = () => [];

/** The snapshot this card left, or undefined. */
export const cardMemory = (id: CardId): unknown => mem.get(id);

/** Keep what a destroyed card handed over (null/undefined: forget it). */
export function rememberCard(id: CardId, snap: unknown): void {
  if (snap == null) mem.delete(id);
  else mem.set(id, snap);
  persist();
}

/** Layout-side: how to read the snapshots of the cards on screen. */
export function setLiveSnapshots(fn: () => [CardId, unknown][]): void {
  live = fn;
}

function persist(withLive = false): void {
  if (!setting("cardMemoryDisk")) return;
  const all = new Map(mem);
  if (withLive) for (const [id, s] of live()) if (s != null) all.set(id, s);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(all)));
  } catch {
    /* storage unavailable: memory still holds it for the session */
  }
}

/** Read the saved places once, at launch, before the layout mounts its cards. */
export function initCardMemory(): void {
  if (setting("cardMemoryDisk")) {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;
      for (const [id, s] of Object.entries(raw)) if (s != null) mem.set(id as CardId, s);
      diag.log("memory", { cause: "load", cards: mem.size });
    } catch {
      /* a corrupt entry: start clean */
    }
  }
  onSettingsChange((k) => {
    if (k !== "cardMemoryDisk") return;
    if (setting("cardMemoryDisk")) persist(true);
    else {
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* nothing stored */
      }
    }
  });
  // A quit or a hide writes the cards on screen as well. Never on scroll.
  window.addEventListener("pagehide", () => persist(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persist(true);
  });
}

// ── the simple cards (CARD-MEMORY.md §5): a scroll place, and a shelf's sideways place ──
export interface ScrollSnapshot {
  v: 1;
  scroll: number;
  /** Each sideways scroller's place, in order (Home's shelves). */
  shelves?: number[];
}
const isScrollSnapshot = (s: unknown): s is ScrollSnapshot =>
  !!s && typeof s === "object" && (s as ScrollSnapshot).v === 1 && typeof (s as ScrollSnapshot).scroll === "number";

/** Where a plain card is: its body's scroll, plus any sideways scrollers inside it. */
export const scrollSnapshot = (body: HTMLElement, shelfSel?: string): ScrollSnapshot => ({
  v: 1,
  scroll: body.scrollTop,
  shelves: shelfSel ? [...body.querySelectorAll<HTMLElement>(shelfSel)].map((el) => el.scrollLeft) : undefined,
});

/** Put a plain card back where it was, once its rows exist. A press in the card cancels it. */
export function applyScrollSnapshot(body: HTMLElement, s: unknown, shelfSel?: string): void {
  if (!isScrollSnapshot(s)) return;
  let cancelled = false;
  const stop = () => { cancelled = true; };
  body.addEventListener("pointerdown", stop, { once: true, capture: true });
  const apply = (last = false) => {
    if (last) body.removeEventListener("pointerdown", stop, { capture: true });
    if (cancelled) return;
    body.scrollTop = s.scroll;
    if (shelfSel && s.shelves) {
      [...body.querySelectorAll<HTMLElement>(shelfSel)].forEach((el, i) => {
        if (s.shelves![i]) el.scrollLeft = s.shelves![i];
      });
    }
  };
  // The rows land in a later task (a local read): try now, then once more after them.
  apply();
  window.setTimeout(() => apply(), 0);
  window.setTimeout(() => apply(true), 120);
}
