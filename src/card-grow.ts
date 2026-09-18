// Card grow (docs/CARD-GROW.md) — a content card takes more space for a while. It opens over
// its neighbor (Grow: wide or tall) or over all four content cards in Max (Fill). The bento
// grid does not change: the grown panel gets a span and a higher z-index and the covered
// panels stay mounted under it, so a Collapse shows exactly what was there.
//
// Ways in: the edge zones (four strips per card, children of its host, placed by CSS in the
// grid's gaps), the Grow button (enters a card's header on hover — it is NOT in the DOM at
// rest, §0), the title's right-click menu, and `expandCard` (the title bar's cog opens
// Settings as wide as the window allows, §17). Ways out: the same button, its zones, Esc, an outside click
// (a setting; Pin holds the card against it), a card request for a covered card, a surface
// change (no motion).
//
// The motion (fork 3A): the final layout is set ONCE, then a clip-path opens from the old
// box to the new one while the body's content fades and rebuilds; the rows come in through
// enterRows at the new width. Never width/height per frame — each frame would run layout
// and the list pass on a 3,895-row Library.
//
// Nothing here changes the resting layout: every rule is scoped under data-grow / is-covered,
// the zones are out of flow and paint nothing until hovered, and the button is hover-only.

import { setting, onSettingsChange } from "./settings-store";
import { currentSurface, onSurfaceChange } from "./surface";
import { enterRows } from "./pop";
import { openContextMenu, type MenuItem } from "./context-menu";
import { tokenMs } from "./boot-cover";
import { whenSwapSettled } from "./card-swap";
import * as frames from "./frames";
import * as diag from "./diag";
import { TELEMETRY } from "./telemetry-on";

/** The four content slots, plus the two anchored hosts of the max stage column. `np` is a
 *  COVER TARGET only: it has no `.panel__head`, so it never gets the button or the zones
 *  (docs/STAGE-COLUMN.md §7). */
export type Slot = "left" | "right" | "c" | "d" | "np" | "queue";
/** The stage column's slots: they grow inside their own column and never offer Fill. */
const STAGE: Slot[] = ["np", "queue"];
const isStage = (s: Slot): boolean => STAGE.includes(s);
export type GrowMode = "wide" | "tall" | "full";
export type GrowDir = "left" | "right" | "up" | "down" | "full";
type SideDir = Exclude<GrowDir, "full">;

export interface GrowState {
  slot: Slot;
  mode: GrowMode;
  dir: GrowDir;
  covered: Slot[];
  pinned: boolean;
}

interface Opts {
  hosts: Record<Slot, HTMLElement | null>;
  /** The content slots of the live composition. */
  slots: () => Slot[];
  /** The title of the card a slot shows ("Search"), for the hints. */
  titleOf: (slot: Slot) => string;
  /** The slot that shows a card, by card id or title ("library" / "Library") or by slot name. */
  slotOf: (name: string) => Slot | null;
  bento: HTMLElement;
  body: HTMLElement;
}

// Which slot lies in each direction (the max map: "np left right / queue c d").
const MAX_NEIGHBOR: Record<Slot, Partial<Record<SideDir, Slot>>> = {
  left: { right: "right", down: "c" },
  right: { left: "left", down: "d" },
  c: { right: "d", up: "left" },
  d: { left: "c", up: "right" },
  // The stage column: the Queue grows UP over Now Playing, and nowhere else (the owner's
  // call, 2026-09-17). Now Playing itself never grows — it has no header to grow from.
  queue: { up: "np" },
  np: {},
};
const MIDI_NEIGHBOR: Record<Slot, Partial<Record<SideDir, Slot>>> = {
  left: { right: "right" },
  right: { left: "left" },
  c: {},
  d: {},
  queue: {},
  np: {},
};
const DIR_WORD: Record<SideDir, string> = { left: "left", right: "right", up: "up", down: "down" };

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let opts: Opts | null = null;
let state: GrowState | null = null;
let animating = false;
/** Resolves when the motion on screen ends (at once when none runs). */
let settled: Promise<void> = Promise.resolve();
let settle: () => void = () => {};
const startMotion = () => {
  animating = true;
  settled = new Promise<void>((res) => (settle = res));
};
const endMotion = () => {
  animating = false;
  settle();
};
const subs = new Set<(s: GrowState | null) => void>();

/** The grow now, or null. */
export const grownState = (): GrowState | null => state;
/** True while `slot` sits under a grown card. */
export const isCovered = (slot: Slot): boolean => !!state && state.covered.includes(slot);
/** Be told when a grow starts or ends (the layout and the cards re-read their state). */
export function onGrowChange(cb: (s: GrowState | null) => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}
const emit = () => subs.forEach((cb) => cb(state));

const enabled = (): boolean => !!opts && setting("cardGrow") && currentSurface() !== "mini";
/** Every slot that can BE grown now: the composition's content slots, plus the anchored Queue
 *  in max. Fill still reads opts.slots(), so it covers the bento only. */
const growSlots = (): Slot[] => {
  if (!opts) return [];
  const live = opts.slots();
  return currentSurface() === "max" ? [...live, "queue" as Slot] : live;
};
const isLive = (s: Slot): boolean => growSlots().includes(s);
const neighbors = (): Record<Slot, Partial<Record<SideDir, Slot>>> => (currentSurface() === "max" ? MAX_NEIGHBOR : MIDI_NEIGHBOR);
const canFill = (): boolean => currentSurface() === "max";
/** The directions a slot can grow in now (those with a neighbor in this composition). */
export function growDirs(slot: Slot): SideDir[] {
  if (!opts) return [];
  const live = growSlots();
  // A stage neighbour (np) is anchored: it is on screen whenever the surface has it.
  const here = (n: Slot) => (isStage(n) ? currentSurface() === "max" : live.includes(n));
  return (Object.entries(neighbors()[slot]) as [SideDir, Slot][]).filter(([, n]) => here(n)).map(([d]) => d);
}
const modeOf = (dir: GrowDir): GrowMode => (dir === "full" ? "full" : dir === "left" || dir === "right" ? "wide" : "tall");
const coveredFor = (slot: Slot, dir: GrowDir): Slot[] => {
  if (!opts) return [];
  if (dir === "full") return opts.slots().filter((s) => s !== slot);
  const n = neighbors()[slot][dir];
  return n ? [n] : [];
};

// ── hints ─────────────────────────────────────────────────────────────────────
const growHint = (slot: Slot, dir: GrowDir): string => {
  if (!opts) return "";
  const me = opts.titleOf(slot);
  if (dir === "full") return `Fill the window with ${me}`;
  const over = coveredFor(slot, dir).map((s) => opts!.titleOf(s)).join(" and ");
  return dir === "left" || dir === "right" ? `Widen ${me} over ${over}` : `Make ${me} taller, over ${over}`;
};
const collapseHint = (slot: Slot): string => `Collapse ${opts?.titleOf(slot) ?? "this card"} back to its place`;

// ── the grow itself ───────────────────────────────────────────────────────────
const rect = (el: Element) => el.getBoundingClientRect();
const clipPad = (): number => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--grow-clip-pad")) || 0;
/** `inset(…)` that shows the `from` box inside the `to` box, opened past it by `pad`. */
const clipBetween = (from: DOMRect, to: DOMRect, pad: number, radius: string): string =>
  `inset(${from.top - to.top - pad}px ${to.right - from.right - pad}px ${to.bottom - from.bottom - pad}px ${from.left - to.left - pad}px round ${radius})`;
const clipOpen = (pad: number, radius: string): string => `inset(${-pad}px round ${radius})`;

/** The rows the grown card's body shows now: the shapes the cards build, on screen. */
function visibleRows(panel: HTMLElement): HTMLElement[] {
  const box = rect(panel);
  const all = panel.querySelectorAll<HTMLElement>(
    ".lib-hero, .lib-actions, .lib-shelf, .lib-view-bar, .lib-cols, .lib-row, .lib-tile, .qnow, .qrow, .search__song, .search__tile, .search__artist, .search__label, .set__section, .lib-rail__letter",
  );
  const rows: HTMLElement[] = [];
  const onScreen = (el: HTMLElement) => {
    const r = rect(el);
    return r.height > 0 && r.bottom >= box.top && r.top <= box.bottom;
  };
  for (const el of all) {
    if (el.classList.contains("lib-rail__letter") || onScreen(el)) rows.push(el);
  }
  if (rows.length) return rows;
  // A card whose body builds other shapes (Search's panes, Home's shelves): the children of
  // its first scroller that has any.
  for (const sel of [".lib-view", "[data-view]", ".spane", ".panel__body"]) {
    const scroller = panel.querySelector<HTMLElement>(sel);
    if (!scroller?.children.length) continue;
    return [...scroller.children].filter((el): el is HTMLElement => el instanceof HTMLElement && !el.classList.contains("lib-spacer") && onScreen(el));
  }
  return rows;
}

/** Every row on screen comes in, one after the next, at the grow's own (shorter) stagger:
 *  a filled card shows ~30 rows, and a row that does not enter reads as "already there". */
function enterAll(panel: HTMLElement): void {
  const rows = visibleRows(panel);
  panel.classList.add("is-grow-rows"); // scopes --pop-stagger to --grow-rows-stagger
  enterRows(rows, rows.length);
  const ms = tokenMs("--pop-in") + rows.length * tokenMs("--grow-rows-stagger") + 60;
  window.setTimeout(() => panel.classList.remove("is-grow-rows"), ms);
}

interface Motion {
  dur: number;
  ease: string;
}
const motion = (): Motion | null => {
  if (reduced()) return null;
  const dur = tokenMs("--grow-dur");
  if (dur <= 0) return null;
  const ease = getComputedStyle(document.documentElement).getPropertyValue("--grow-ease").trim() || "ease";
  return { dur, ease };
};

/** Grow `slot` in `dir`. A grow on another slot ends the one on screen first (no motion). */
export function growCard(slot: Slot, dir: GrowDir, cause: string): void {
  if (!enabled() || animating || !opts) return;
  const panel = opts.hosts[slot];
  if (!panel || !isLive(slot)) return;
  if (dir === "full" && (!canFill() || isStage(slot))) return; // the stage column never fills
  if (dir !== "full" && !growDirs(slot).includes(dir)) return;
  if (state && state.slot !== slot) collapseNow("other");
  if (state && state.slot === slot && state.dir === dir) return;
  const covered = coveredFor(slot, dir);
  if (!covered.length) return;
  const mode = modeOf(dir);
  const m = motion();
  const from = rect(panel);
  const prevCovered = state?.covered ?? [];
  state = { slot, mode, dir, covered, pinned: false };
  // Cards that were covered by a smaller grow of this card stay hidden; new ones fade.
  const fresh = covered.filter((s) => !prevCovered.includes(s));
  prevCovered.filter((s) => !covered.includes(s)).forEach((s) => uncover(opts!.hosts[s]));
  if (m) panel.classList.add("is-grow-rebuild");
  panel.dataset.grow = mode;
  panel.dataset.growDir = dir;
  panel.classList.add("is-grown");
  fresh.forEach((s) => {
    const h = opts!.hosts[s];
    if (!h) return;
    if (m) h.classList.add("is-covering");
    else cover(h);
  });
  diag.log("grow", { slot, dir, mode, cause, covered: covered.join("+") });
  emit(); // the card re-reads its state (the Library rebuilds its rows with columns)
  const finish = () => {
    fresh.forEach((s) => cover(opts!.hosts[s]));
    panel.classList.remove("is-grow-rebuild");
    endMotion();
    paintZones();
    enterAll(panel);
  };
  if (!m) {
    finish();
    return;
  }
  startMotion();
  const to = rect(panel); // forces the layout at the final size, once
  const pad = clipPad();
  const radius = getComputedStyle(panel).borderRadius || "0px";
  const endFrames = frames.begin("grow", `${slot} ${dir}`);
  const anim = panel.animate([{ clipPath: clipBetween(from, to, pad, radius) }, { clipPath: clipOpen(pad, radius) }], {
    duration: m.dur,
    easing: m.ease,
    fill: "both",
  });
  const done = () => {
    anim.cancel();
    endFrames();
    finish();
  };
  anim.onfinish = done;
  anim.oncancel = () => {
    if (animating) done();
  };
}

const cover = (h: HTMLElement | null | undefined) => {
  if (!h) return;
  h.classList.remove("is-covering", "is-uncovering");
  h.classList.add("is-covered");
  h.inert = true;
};
const uncover = (h: HTMLElement | null | undefined) => {
  if (!h) return;
  h.classList.remove("is-covered", "is-covering", "is-uncovering");
  h.inert = false;
};

/** End the grow at once, no motion (a surface change, a recompose, another slot's grow). */
function collapseNow(cause: string): void {
  if (!state || !opts) return;
  const { slot, covered } = state;
  const panel = opts.hosts[slot];
  covered.forEach((s) => uncover(opts!.hosts[s]));
  if (panel) {
    delete panel.dataset.grow;
    delete panel.dataset.growDir;
    panel.classList.remove("is-grown", "is-grow-rebuild");
    panel.getAnimations().forEach((a) => a.cancel());
  }
  diag.log("grow:collapse", { slot, cause, motion: false });
  state = null;
  endMotion();
  emit();
  paintZones();
}

/** End the grow. Resolves when the card is back in its place (after the motion). A collapse
 *  asked for during a motion waits for it, then runs. */
/** Is `card` the grown one right now? (The cog's second click, SETTINGS.md.) */
export function isGrownCard(card: string): boolean {
  const slot = opts?.slotOf(card) ?? null;
  return !!slot && state?.slot === slot;
}

/**
 * Open `card` as wide as this window allows: Fill over all four in Max, over its one
 * neighbor in Midi. The cog's way in (SETTINGS.md) — a button, not an edge, but it still
 * obeys "Grow cards from edges" (the owner's call, 2026-09-18), so one flag governs every
 * grow. In Mini nothing can grow and it does nothing.
 *
 * It waits for the summon's card swap first: the card has to be IN its slot before the
 * clip-path can open from that slot's box.
 *
 * Returns true when the card grew.
 */
export async function expandCard(card: string, cause: string): Promise<boolean> {
  if (!enabled()) return false; // Mini, or "Grow cards from edges" is off
  await whenSwapSettled();
  const slot = opts?.slotOf(card) ?? null;
  if (!slot) return false;
  if (state?.slot === slot) return true; // already the grown card
  const dir: GrowDir | null = canFill() && !isStage(slot) ? "full" : growDirs(slot)[0] ?? null;
  if (!dir) return false;
  growCard(slot, dir, cause);
  await settled;
  return true;
}

export function collapseGrow(cause: string, withMotion = true): Promise<void> {
  if (!state || !opts) return Promise.resolve();
  if (animating) return settled.then(() => collapseGrow(cause, withMotion));
  const m = withMotion ? motion() : null;
  if (!m) {
    collapseNow(cause);
    return Promise.resolve();
  }
  const { slot, mode, covered } = state;
  const panel = opts.hosts[slot];
  if (!panel) {
    collapseNow(cause);
    return Promise.resolve();
  }
  startMotion();
  const to = rect(panel);
  // The box the card returns to: measured with the span off for one layout.
  delete panel.dataset.grow;
  const rest = rect(panel);
  panel.dataset.grow = mode;
  panel.classList.add("is-grow-rebuild");
  covered.forEach((s) => {
    const h = opts!.hosts[s];
    if (!h) return;
    h.classList.remove("is-covered");
    h.inert = false;
    h.classList.add("is-covering"); // opacity 0, no transition yet
  });
  void panel.offsetWidth; // commit the covering state before the fade in
  covered.forEach((s) => {
    const h = opts!.hosts[s];
    if (!h) return;
    h.classList.remove("is-covering");
    h.classList.add("is-uncovering"); // fades to 1 over the grow duration
  });
  const pad = clipPad();
  const radius = getComputedStyle(panel).borderRadius || "0px";
  const endFrames = frames.begin("grow", `${slot} collapse`);
  const anim = panel.animate([{ clipPath: clipOpen(pad, radius) }, { clipPath: clipBetween(rest, to, pad, radius) }], {
    duration: m.dur,
    easing: m.ease,
    fill: "both",
  });
  return new Promise<void>((resolve) => {
    let ended = false;
    const done = () => {
      if (ended) return;
      ended = true;
      anim.cancel();
      endFrames();
      covered.forEach((s) => uncover(opts!.hosts[s])); // they faded back in as the clip closed; their rows stay put
      delete panel.dataset.grow;
      delete panel.dataset.growDir;
      panel.classList.remove("is-grown");
      diag.log("grow:collapse", { slot, cause, motion: true });
      state = null;
      endMotion();
      emit(); // the card rebuilds its rows at the old width
      panel.classList.remove("is-grow-rebuild");
      paintZones();
      enterAll(panel);
      resolve();
    };
    anim.onfinish = done;
    anim.oncancel = done;
  });
}

/** Pin or unpin the grown card (it then ignores outside clicks). */
export function setPinned(on: boolean): void {
  if (!state) return;
  state.pinned = on;
  diag.log(on ? "grow:pin" : "grow:unpin", { slot: state.slot });
  emit();
}

// ── the button's action (rest → wide → full → rest) ───────────────────────────
/** What the Grow button does for `slot` now: the direction, or "collapse". */
export function buttonAction(slot: Slot): GrowDir | "collapse" | null {
  if (!enabled()) return null;
  if (state?.slot === slot) {
    if (state.mode !== "full" && canFill() && !isStage(slot)) return "full";
    return "collapse";
  }
  const dirs = growDirs(slot);
  if (!dirs.length) return null;
  // The neighbor with the most room: the other card in the same row first.
  return dirs.find((d) => d === "right" || d === "left") ?? dirs[0];
}

/** The Grow ▸ / Fill / Collapse / Pin items for a slot's title menu. */
export function growMenu(slot: Slot): MenuItem[] {
  if (!enabled()) return [];
  const items: MenuItem[] = [];
  const dirs = growDirs(slot).filter((d) => !(state?.slot === slot && state.dir === d));
  if (dirs.length && state?.mode !== "full")
    items.push({
      label: "Grow",
      sub: () => dirs.map((d) => ({ label: `${DIR_WORD[d][0].toUpperCase()}${DIR_WORD[d].slice(1)}, over ${coveredFor(slot, d).map(opts!.titleOf).join(" and ")}`, run: () => growCard(slot, d, "menu") })),
    });
  if (canFill() && !isStage(slot) && state?.slot !== slot) items.push({ label: "Fill", run: () => growCard(slot, "full", "menu") });
  if (canFill() && !isStage(slot) && state?.slot === slot && state.mode !== "full") items.push({ label: "Fill", run: () => growCard(slot, "full", "menu") });
  if (state?.slot === slot) {
    if (setting("cardGrowOutside")) items.push({ label: state.pinned ? "Unpin" : "Pin", run: () => setPinned(!state?.pinned) });
    items.push({ label: "Collapse", run: () => void collapseGrow("menu") });
  }
  return items;
}

// ── the Grow button (hover-only, out of flow) ─────────────────────────────────
const ICON_GROW = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/></svg>`;
const ICON_SHRINK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10h-6V4M14 10l7-7M4 14h6v6M10 14l-7 7"/></svg>`;
const ICON_PIN = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3zM12 15v6"/></svg>`;

export interface GrowButton {
  destroy(): void;
}

/** Give a mounted card's header the Grow button: it enters on hover and stays while grown. */
export function attachGrowButton(slot: Slot, host: HTMLElement): GrowButton {
  const head = host.querySelector<HTMLElement>(".panel__head");
  const title = host.querySelector<HTMLElement>(".panel__title");
  if (!head || !title) return { destroy() {} };
  const zones = makeZones(slot, host); // the card's four edge strips (after its markup)
  let box: HTMLElement | null = null;
  let hovered = false;

  const place = () => {
    if (!box) return;
    // Just right of the title's TEXT (not its box, which runs to the action squares): the
    // text's width comes from a range over it, capped at the box when the title is cut off.
    // The buttons are out of flow, so nothing reserves room for them. While they show, the
    // title takes a max width that leaves exactly that room: a long title then ends in an
    // ellipsis and the buttons sit right after it, instead of on the words (desk report,
    // 2026-09-17). The buttons are placed again whenever the title text changes.
    // Only a VISIBLE action square bounds the title: a hidden one (Playlists hides New and Web
    // while drilled) reports offsetLeft 0, which would squeeze the title to nothing.
    const actions = [...(box.parentElement?.querySelectorAll<HTMLElement>(".panel__action") ?? [])].filter(
      (el) => !el.hidden && el.offsetParent !== null,
    );
    const first = actions.length ? actions.reduce((a, b) => (a.offsetLeft <= b.offsetLeft ? a : b)) : null;
    const gap = parseFloat(getComputedStyle(box).getPropertyValue("--grow-btn-gap")) || 0;
    const room = first && box.offsetWidth ? first.offsetLeft - title.offsetLeft - box.offsetWidth - gap * 2 : 0;
    title.style.maxWidth = room > 0 ? `${Math.round(room)}px` : "";
    const range = document.createRange();
    range.selectNodeContents(title);
    const text = Math.min(range.getBoundingClientRect().width, title.offsetWidth);
    box.style.setProperty("--grow-btn-left", `${Math.round(title.offsetLeft + text)}px`);
  };
  const paint = () => {
    if (!box) return;
    const act = buttonAction(slot);
    const grow = box.querySelector<HTMLButtonElement>("[data-grow-btn]");
    const pin = box.querySelector<HTMLButtonElement>("[data-grow-pin]");
    if (grow) {
      grow.innerHTML = act === "collapse" ? ICON_SHRINK : ICON_GROW;
      grow.title = act === null ? "" : act === "collapse" ? collapseHint(slot) : growHint(slot, act);
      grow.setAttribute("aria-label", grow.title);
      grow.disabled = act === null;
    }
    const showPin = !!state && state.slot === slot && setting("cardGrowOutside");
    if (pin) {
      pin.hidden = !showPin;
      pin.setAttribute("aria-pressed", String(!!state?.pinned));
      pin.classList.toggle("is-on", !!state?.pinned);
      pin.title = state?.pinned ? "Lets a click outside collapse this card again" : "Keeps this card open when you click outside it";
      pin.setAttribute("aria-label", pin.title);
    }
    place();
  };
  const show = () => {
    if (box || !enabled() || buttonAction(slot) === null) return;
    box = document.createElement("div");
    box.className = "grow-btns";
    box.innerHTML =
      `<button class="grow-btn" type="button" data-grow-btn>${ICON_GROW}</button>` +
      `<button class="grow-btn grow-btn--pin" type="button" data-grow-pin hidden>${ICON_PIN}</button>`;
    head.appendChild(box);
    paint();
    enterRows(box.querySelectorAll(".grow-btn:not([hidden])"), 2);
  };
  const hide = () => {
    if (!box) return;
    if (state?.slot === slot) return; // stays while grown
    box.remove();
    box = null;
    title.style.maxWidth = ""; // the title gets its full room back
  };
  const onEnter = () => {
    hovered = true;
    show();
  };
  const onLeave = () => {
    hovered = false;
    hide();
  };
  const onClick = (e: Event) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-grow-pin]")) {
      e.stopPropagation();
      setPinned(!state?.pinned);
      return;
    }
    if (!t.closest("[data-grow-btn]")) return;
    e.stopPropagation();
    const act = buttonAction(slot);
    if (act === "collapse") void collapseGrow("button");
    else if (act) growCard(slot, act, "button");
  };
  const onMenu = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (!t.closest("[data-grow-btn], .panel__title")) return;
    const items = growMenu(slot);
    if (!items.length) return;
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e.clientX, e.clientY, items);
  };
  head.addEventListener("pointerenter", onEnter);
  head.addEventListener("pointerleave", onLeave);
  head.addEventListener("click", onClick);
  head.addEventListener("contextmenu", onMenu);
  // The title text changes under the buttons: a drill in or out ("Library" → "Album"), and a
  // Search drill that opens on a fallback name and relabels when the id lands. The buttons are
  // placed from that text, so they must be placed again, or they sit on the words or far from
  // them (desk report, 2026-09-17).
  const watchTitle = new MutationObserver(() => place());
  watchTitle.observe(title, { characterData: true, childList: true, subtree: true });
  const unsub = onGrowChange(() => {
    if (state?.slot === slot) show();
    paint();
    if (!hovered) hide();
  });
  if (state?.slot === slot) show(); // a card mounted into a grown slot (a pick while grown)
  paintZones();
  return {
    destroy() {
      unsub();
      watchTitle.disconnect();
      zones.forEach((z) => z.remove());
      head.removeEventListener("pointerenter", onEnter);
      head.removeEventListener("pointerleave", onLeave);
      head.removeEventListener("click", onClick);
      head.removeEventListener("contextmenu", onMenu);
      box?.remove();
      box = null;
    },
  };
}

// ── the edge zones ────────────────────────────────────────────────────────────
// Four strips per content card, CHILDREN of the card's host, placed by CSS from the card's
// own box (styles.css §Card grow): the half gap toward a neighbor, the full gap toward the
// stage or the top padding, the padding inside the resize band on a window edge. Nothing
// is measured, so they ride the launch lift, a swap and a grow with the card (the first
// build measured them from on-screen boxes during the lift and left them low, 2026-09-17).
// JS decides what each strip does now (`paintZones`) and hides the ones that do nothing.
type Side = "left" | "right" | "up" | "down";
const SIDES: Side[] = ["left", "right", "up", "down"];
type Reach = "half" | "full" | "edge";
/** The card side the zone touches, for the bar (a zone on the card's right has the card on its left). */
const BAR_SIDE: Record<Side, string> = { right: "left", left: "right", down: "top", up: "bottom" };

/** What lies past a card's side now: another content card, the stage or the top padding
 *  ("outer"), the window edge, or nothing that matters (midi's outer sides). */
function beyond(slot: Slot, side: Side): "card" | "outer" | "edge" | null {
  if (!opts) return null;
  // The stage column has its own rule in zoneAction: only the Queue's top edge acts.
  if (isStage(slot)) return null;
  if (currentSurface() === "max") {
    // The max map: content columns 2–3, rows 1–2; a grown card spans more of them.
    const g = state?.slot === slot ? state : null;
    const cols = g?.mode === "wide" || g?.mode === "full" ? [2, 3] : slot === "left" || slot === "c" ? [2] : [3];
    const rows = g?.mode === "tall" || g?.mode === "full" ? [1, 2] : slot === "left" || slot === "right" ? [1] : [2];
    switch (side) {
      case "right": return Math.max(...cols) < 3 ? "card" : "edge";
      case "left": return Math.min(...cols) > 2 ? "card" : "outer";
      case "up": return Math.min(...rows) > 1 ? "card" : "outer";
      case "down": return Math.max(...rows) < 2 ? "card" : "edge";
    }
  }
  const n = neighbors()[slot][side];
  return n && opts.slots().includes(n) ? "card" : null;
}

interface ZoneAct {
  dir: GrowDir;
  act: "grow" | "collapse";
  reach: Reach;
}
/** What a strip does now, or null (hidden). */
function zoneAction(slot: Slot, side: Side): ZoneAct | null {
  if (!enabled() || !isLive(slot)) return null;
  // The stage column (STAGE-COLUMN.md §7): ONE strip acts, the Queue's top edge. It grows the
  // Queue up over Now Playing, and while the Queue is grown the same strip — now at the top of
  // the window — collapses it. The other three sides are dead: the column is the Queue's home,
  // and a sideways grow would put it where the bento lives.
  if (isStage(slot)) {
    if (slot !== "queue" || side !== "up" || currentSurface() !== "max") return null;
    if (state?.slot === "queue") return { dir: "up", act: "collapse", reach: "full" };
    if (state) return null; // another card is grown: its own zones are the only live ones
    // The WHOLE gap, not half of it: Now Playing has no zones, so nothing else claims the
    // other half and a 6 px target would be needlessly hard to hit.
    return { dir: "up", act: "grow", reach: "full" };
  }
  const b = beyond(slot, side);
  if (!b) return null;
  const mine = state?.slot === slot;
  if (b === "card") {
    // A grown card's remaining inner gap gives Fill; a resting card's gives Grow that way,
    // unless the neighbor sits under a grown card, or a card fills the window.
    if (mine) return state!.mode === "full" || !canFill() || isStage(slot) ? null : { dir: "full", act: "grow", reach: "half" };
    const n = neighbors()[slot][side];
    if (!n || isCovered(n) || state?.mode === "full") return null;
    return { dir: side, act: "grow", reach: "half" };
  }
  // The outer sides: the one-click Fill zones (max only); on the grown card they collapse it.
  if (!canFill()) return null;
  if (state && !mine) return null; // while one card is grown, only its own outer zones act
  return { dir: "full", act: mine ? "collapse" : "grow", reach: b === "edge" ? "edge" : "full" };
}

/** Give a host its four strips (called with the Grow button, after the card's markup lands). */
function makeZones(slot: Slot, host: HTMLElement): HTMLElement[] {
  return SIDES.map((side) => {
    const el = document.createElement("div");
    el.className = "grow-zone";
    el.dataset.slot = slot;
    el.dataset.side = side;
    el.hidden = true;
    el.setAttribute("role", "button");
    el.innerHTML = `<span class="grow-zone__bar" aria-hidden="true"></span>`;
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const a = zoneAction(slot, side);
      if (!a || animating) return;
      if (a.act === "collapse") void collapseGrow("zone");
      else growCard(slot, a.dir, "zone");
    });
    host.appendChild(el);
    return el;
  });
}

/** Re-decide every strip: what it does, how far it reaches, what its hint says. */
function paintZones(): void {
  document.querySelectorAll<HTMLElement>(".grow-zone").forEach((el) => {
    const slot = el.dataset.slot as Slot;
    const side = el.dataset.side as Side;
    const a = zoneAction(slot, side);
    if (!a) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.dataset.dir = a.dir;
    el.dataset.act = a.act;
    el.dataset.reach = a.reach;
    el.className = `grow-zone grow-zone--${BAR_SIDE[side]}`;
    const hint = a.act === "collapse" ? collapseHint(slot) : growHint(slot, a.dir);
    el.title = hint;
    el.setAttribute("aria-label", hint);
  });
}

/** Re-decide the zones (a layout assignment changed, so the hints name other cards). */
export function refreshGrowZones(): void {
  paintZones();
}

// ── the agent route (AGENT.md §3, `/grow`) — a test handle more than an agent verb ─────
type Reply = Record<string, unknown>;
const MODE_WORD: Record<GrowMode, string> = { wide: "wide", tall: "tall", full: "filling the window" };
function describe(): string {
  if (!state || !opts) return "No card is grown.";
  const over = state.covered.map(opts.titleOf).join(" and ");
  return `${opts.titleOf(state.slot)} is ${MODE_WORD[state.mode]}, over ${over}${state.pinned ? ", pinned" : ""}.`;
}
const stateReply = (message: string): Reply => ({ ok: true, message, state: state ? { ...state } : null });

/** `{action: grow | collapse | pin | unpin | state, card?, dir?}` → `{ok, message, state}`.
 *  `blocked:` → 403, `unknown:` → 400 (bridge.rs). A grow resolves after its motion. */
export async function agentGrow(payload: { action?: string; card?: string; dir?: string } | null): Promise<Reply> {
  const action = String(payload?.action ?? "state").toLowerCase();
  if (!opts) throw new Error("blocked: the layout is not up yet");
  switch (action) {
    case "state":
      return stateReply(describe());
    case "collapse":
      if (!state) return stateReply("No card is grown.");
      await collapseGrow("agent");
      return stateReply("Collapsed.");
    case "pin":
    case "unpin":
      if (!state) throw new Error("blocked: no card is grown");
      setPinned(action === "pin");
      return stateReply(describe());
    case "grow": {
      if (!enabled()) throw new Error("blocked: Grow cards from edges is off in Settings › Window, or the window is Mini");
      const card = String(payload?.card ?? "");
      const slot = opts.slotOf(card);
      if (!slot) throw new Error(`unknown: no card ${JSON.stringify(card)} on screen — a card name (Library, Search…) or a slot (left, right, c, d, queue)`);
      const dirs: GrowDir[] = [...growDirs(slot), ...(canFill() && !isStage(slot) ? (["full"] as GrowDir[]) : [])];
      const want = payload?.dir ? String(payload.dir).toLowerCase() : null;
      const dir = want ?? buttonAction(slot);
      if (dir === "collapse") {
        await collapseGrow("agent");
        return stateReply("Collapsed.");
      }
      if (!dir || !dirs.includes(dir as GrowDir)) throw new Error(`unknown: ${opts.titleOf(slot)} can grow ${dirs.join(", ")}`);
      growCard(slot, dir as GrowDir, "agent");
      await settled;
      return stateReply(describe());
    }
    default:
      throw new Error(`unknown: grow action ${JSON.stringify(action)} — grow, collapse, pin, unpin or state`);
  }
}

// ── init ──────────────────────────────────────────────────────────────────────
export function initCardGrow(o: Opts): void {
  opts = o;
  // The zones are children of each card (makeZones, with the Grow button): CSS places them
  // from the card's own box, so nothing here measures or watches sizes.
  // A surface change collapses with no motion, before the layout tears the slots down.
  onSurfaceChange(() => {
    collapseNow("surface");
    paintZones();
  });
  onSettingsChange((k) => {
    if (k === "cardGrow") {
      if (!setting("cardGrow")) collapseNow("setting");
      paintZones();
      emit();
    }
    if (k === "cardGrowOutside") emit();
  });
  // Esc collapses, unless a menu, a popover or a text field takes it first.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !state || animating) return;
    const t = e.target;
    if (t instanceof Element && t.closest("input, textarea, [contenteditable]")) return;
    if (document.querySelector(".ctx-menu, .lib-pop, .slot-picker__menu:not([hidden]), .pop:not([hidden])")) return;
    void collapseGrow("esc");
  });
  // A click outside the grown card (inside the body: another card, the stage) collapses it.
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!state || animating || state.pinned || !setting("cardGrowOutside")) return;
      const t = e.target as HTMLElement | null;
      if (!t || !opts) return;
      if (!opts.body.contains(t)) return; // the title bar and the fixed overlays do not count
      if (t.closest(".grow-zone, .ctx-menu, .lib-pop")) return;
      const panel = opts.hosts[state.slot];
      if (panel && panel.contains(t)) return;
      void collapseGrow("outside");
    },
    { capture: true },
  );
  paintZones();
  // A measuring handle: drive a grow from the console or scripts/webview-eval.mjs
  // (DEBUGGING.md). On the TELEMETRY gate, not DEV, so `npm run dev:built` — the honest
  // graphics build — still answers it. The installed bundle carries none of it.
  if (TELEMETRY) {
    (window as unknown as { __grow: unknown }).__grow = {
      grow: growCard,
      collapse: collapseGrow,
      state: grownState,
      zones: () => [...document.querySelectorAll<HTMLElement>(".grow-zone:not([hidden])")].map((z) => ({ ...z.dataset })),
      dirs: growDirs,
    };
  }
}
