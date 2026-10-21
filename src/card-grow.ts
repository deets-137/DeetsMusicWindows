// Card grow (docs/cards/CARD-GROW.md) — a content card takes more space for a while. It opens over
// its neighbor (Grow: wide or tall) or over all four content cards in Max (Fill; four-card Max
// only — with two cards the grow over the other card is the whole area, MAX-CARDS.md). The bento
// grid does not change: the grown panel gets a span and a higher z-index and the covered
// panels stay mounted under it, so a Collapse shows exactly what was there.
//
// Ways in: the edge zones (four strips per card, children of its host, placed by CSS in the
// grid's gaps), the Grow button (enters a card's header on hover — it is NOT in the DOM at
// rest, §0), the title's right-click menu, and `growByRule` (the rules engine's grow action:
// an album or artist opens, a Diary entry opens, the cog — RULES.md §10). Ways out: the same button, its zones, Esc, an outside click
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

import { setting, effective, onSettingsChange } from "./settings-store";
import { currentSurface, onSurfaceChange } from "./surface";
import { enterRows } from "./pop";
import { openContextMenu, type MenuItem } from "./context-menu";
import { tokenMs } from "./boot-cover";
import { whenSwapSettled } from "./card-swap";
import * as frames from "./frames";
import * as diag from "./diag";
import { TELEMETRY } from "./telemetry-on";
import { cancelled, registerAction, registerEvent, registerFact } from "./rules";
import { maxBeyond, maxCanFill, maxNeighbors, type MaxCards, type MaxSlot } from "./layout-rules";
import { motionReduced } from "./motion";
import { readyIn } from "./reveal";

/** The four content slots, plus the two anchored hosts of the max stage column. `np` is a
 *  COVER TARGET only: it has no `.panel__head`, so it never gets the button or the zones
 *  (docs/cards/STAGE-COLUMN.md §7). */
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
  /** Max's layout now (Settings › Window › Layout for Max, MAX-CARDS.md). */
  maxCards?: () => MaxCards;
  bento: HTMLElement;
  body: HTMLElement;
}

// Which slot lies in each direction in max: the content slots from the layout's own table
// (Layout for Max: 4, 2 or 1 cards, MAX-CARDS.md §4.4), the stage column by hand.
const maxNeighborMap = (n: MaxCards): Record<Slot, Partial<Record<SideDir, Slot>>> => ({
  left: maxNeighbors(n, "left"),
  right: maxNeighbors(n, "right"),
  c: maxNeighbors(n, "c"),
  d: maxNeighbors(n, "d"),
  // The stage column: the Queue grows UP over Now Playing, and nowhere else (the owner's
  // call, 2026-09-17). Now Playing itself never grows — it has no header to grow from.
  queue: { up: "np" },
  np: {},
});
const MAX_NEIGHBOR: Record<MaxCards, Record<Slot, Partial<Record<SideDir, Slot>>>> = {
  "4": maxNeighborMap("4"),
  "2cols": maxNeighborMap("2cols"),
  "2rows": maxNeighborMap("2rows"),
  "1": maxNeighborMap("1"),
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

const reduced = () => motionReduced();

let opts: Opts | null = null;
let state: GrowState | null = null;
let animating = false;
/** Resolves when the motion on screen ends (at once when none runs). */
let settled: Promise<void> = Promise.resolve();
let settle: () => void = () => {};

/** One card's motion on screen: an open (rest → grown, or one grown shape → another) or a close
 *  (grown → rest). Two can run at once: the hand-off from one grown card to another (§21,
 *  fork 3A). `finish` puts the motion's end state at once and is safe to call twice; `abort`
 *  stops it where it is, for a reverse (Escape during an open). */
interface Run {
  slot: Slot;
  kind: "open" | "close";
  shell: HTMLElement;
  /** Covered cards this motion is bringing back (they fade in under it). */
  returning: Slot[];
  finish: () => void;
  abort: () => void;
}
const runs = new Set<Run>();
const addRun = (r: Run) => {
  runs.add(r);
  if (runs.size === 1) {
    animating = true;
    settled = new Promise<void>((res) => (settle = res));
  }
};
const dropRun = (r: Run) => {
  if (!runs.delete(r) || runs.size) return;
  animating = false;
  settle();
};
const subs = new Set<(s: GrowState | null) => void>();
/** Run `cb` once the grow's motion has ended, just after a paint: work that reads the page's
 *  sizes (the rules' facts, the Grow button's place) must not run inside the motion. In the
 *  click it laid the grown card out twice more (15 ms); in a `requestAnimationFrame` it forced
 *  the first frame's layout early (12 ms); in a task after that paint it was a 14 ms gap in
 *  the motion (2026-10-20). The microtask lets the click start its motion first. */
const afterMotion = (cb: () => void): void =>
  queueMicrotask(() => void settled.then(() => requestAnimationFrame(() => void setTimeout(cb, 0))));

/** The grow now, or null. */
export const grownState = (): GrowState | null => state;
/** The content slot whose card holds `el`, or null (presentation mode, present.ts). */
export function slotHolding(el: Element): Slot | null {
  if (!opts) return null;
  for (const [slot, host] of Object.entries(opts.hosts) as [Slot, HTMLElement | null][]) {
    if (host?.contains(el) && !isStage(slot)) return slot;
  }
  return null;
}
/** The card host of `slot` (its `.panel`), or null. */
export const hostOf = (slot: Slot): HTMLElement | null => opts?.hosts[slot] ?? null;
/** True while `slot` sits under a grown card. */
export const isCovered = (slot: Slot): boolean => !!state && state.covered.includes(slot);
/** Be told when a grow starts or ends (the layout and the cards re-read their state). */
export function onGrowChange(cb: (s: GrowState | null) => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}
const emit = () => {
  // Any grow change but the rule's own (a Pin, a hand grow, a collapse) ends the rule's claim.
  if (!ruleGrowing) ruleMark = null;
  subs.forEach((cb) => cb(state));
};

// The full player (full-player.ts, features/fullscreen-player.md §10, §12.3) sets these: while it
// is full no card grows and every strip hides; while Now Playing's strips are live (Max, at
// rest) the Fill strips beside it take only their half of the gap (§10.3, split at the middle),
// and so does the Queue's top strip under it (its bottom strip, 2026-10-11).
// Hooks, not an import: the full player imports this module for its motion parts.
let playerFull: () => boolean = () => false;
let npRightLive: () => boolean = () => false;
export function setPlayerHooks(h: { full: () => boolean; npRightLive: () => boolean }): void {
  playerFull = h.full;
  npRightLive = h.npRightLive;
}

const enabled = (): boolean => !!opts && setting("cardGrow") && currentSurface() !== "mini" && !playerFull();
/** Every slot that can BE grown now: the composition's content slots, plus the anchored Queue
 *  in max. Fill still reads opts.slots(), so it covers the bento only. */
const growSlots = (): Slot[] => {
  if (!opts) return [];
  const live = opts.slots();
  return currentSurface() === "max" ? [...live, "queue" as Slot] : live;
};
const isLive = (s: Slot): boolean => growSlots().includes(s);
/** Max's layout now (Layout for Max); today's 2×2 when the layout gives none. */
const maxNow = (): MaxCards => opts?.maxCards?.() ?? "4";
const neighbors = (): Record<Slot, Partial<Record<SideDir, Slot>>> => (currentSurface() === "max" ? MAX_NEIGHBOR[maxNow()] : MIDI_NEIGHBOR);
/** Fill is its own grow in four-card Max only (MAX-CARDS.md §4.4). Exported for the full
 *  player: with no Fill strip beside the stage, Now Playing's strip takes the whole gap. */
export const canFill = (): boolean => currentSurface() === "max" && maxCanFill(maxNow());
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
type Edges = Pick<DOMRect, "left" | "top" | "right" | "bottom">;
export const clipPad = (): number => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--grow-clip-pad")) || 0;
/** `inset(…)` that shows the `from` box inside the `to` box, opened past it by `pad`. */
export const clipBetween = (from: Edges, to: Edges, pad: number, radius: string): string =>
  `inset(${from.top - to.top - pad}px ${to.right - from.right - pad}px ${to.bottom - from.bottom - pad}px ${from.left - to.left - pad}px round ${radius})`;
export const clipOpen = (pad: number, radius: string): string => `inset(${-pad}px round ${radius})`;

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
 *  a filled card shows ~30 rows, and a row that does not enter reads as "already there".
 *  `within` (ms) caps the whole entry, so the last row lands as the edge stops: 25 Queue rows
 *  at the full stagger ran ~290 ms past the open (the review, CARD-GROW.md §20). */
const rowsTimers = new WeakMap<HTMLElement, number>();
function enterAll(panel: HTMLElement, within = 0, measured?: HTMLElement[]): void {
  const rows = measured ?? visibleRows(panel);
  // One entry at a time per card: an earlier entry's timer must not end this one's stagger.
  window.clearTimeout(rowsTimers.get(panel));
  const popIn = tokenMs("--pop-in");
  let stagger = tokenMs("--grow-rows-stagger");
  if (within > 0 && rows.length > 1) stagger = Math.min(stagger, Math.max(0, within - popIn) / (rows.length - 1));
  panel.style.setProperty("--grow-rows-stagger", `${stagger}ms`);
  panel.classList.add("is-grow-rows"); // scopes --pop-stagger to --grow-rows-stagger
  enterRows(rows, rows.length);
  const ms = popIn + rows.length * stagger + 60;
  rowsTimers.set(
    panel,
    window.setTimeout(() => {
      panel.classList.remove("is-grow-rows");
      panel.style.removeProperty("--grow-rows-stagger");
    }, ms),
  );
}

interface Motion {
  dur: number;
  ease: string;
  /** ms into the open when the rows come in: the clip looks open long before its soft stop. */
  rowsAt: number;
  /** The collapse's own length: the same curve, shorter (his call, 2026-09-28). */
  collapseDur: number;
}
const motion = (): Motion | null => {
  if (reduced()) return null;
  const dur = tokenMs("--grow-dur");
  if (dur <= 0) return null;
  const cs = getComputedStyle(document.documentElement);
  const ease = cs.getPropertyValue("--grow-ease").trim() || "ease";
  const at = parseFloat(cs.getPropertyValue("--grow-rows-at"));
  const rowsAt = Number.isFinite(at) ? Math.min(1, Math.max(0, at)) * dur : dur;
  const collapseDur = tokenMs("--grow-collapse-dur") || dur;
  return { dur, ease, rowsAt, collapseDur };
};

// ── the motion (§21: the shell, his calls 1A / 2A / 3A, 2026-10-20) ────────────
// The card's SURFACE (its fill, border, rounded corners and shadow) moves as its own layer, the
// shell, from the old box to the new one, while the card's own paint is off (`is-shelled`) and
// only its CONTENT is clipped. So every frame shows a whole card: no shadow cut at the clip, no
// square corner, no jump when a clip pad comes off (the review, §20). The content rides the
// moving top and left edges, so the title is never cut or revealed last (fork 2A).

/** Box `r` (viewport edges) in the coordinates of a box whose top left is `inside`. */
const boxAt = (r: Edges, inside: Pick<Edges, "left" | "top">): Keyframe => ({
  left: `${r.left - inside.left}px`,
  top: `${r.top - inside.top}px`,
  width: `${r.right - r.left}px`,
  height: `${r.bottom - r.top}px`,
});
/** The clip that shows box `from` inside box `to`. Never past `to`: the shell's edge layer
 *  carries the border and the shadow, so no clip needs a pad. */
const clipIn = (from: Edges, to: Edges, radius: string): string =>
  `inset(${Math.max(0, from.top - to.top)}px ${Math.max(0, to.right - from.right)}px ${Math.max(0, to.bottom - from.bottom)}px ${Math.max(0, from.left - to.left)}px round ${radius})`;
const union = (a: Edges, b: Edges): Edges => ({
  left: Math.min(a.left, b.left),
  top: Math.min(a.top, b.top),
  right: Math.max(a.right, b.right),
  bottom: Math.max(a.bottom, b.bottom),
});

/** What the motion reads from the page, read ONCE while the layout is clean: the shell's offset
 *  parent's top left (the bento, for every slot) and the card's corner radius. A read after a
 *  write lays the page out again: the first build of the shell laid the grown card out four
 *  times in one click (38 ms, 2026-10-20). */
interface Place {
  origin: Pick<Edges, "left" | "top">;
  radius: string;
}
function placeOf(panel: HTMLElement): Place {
  const op = panel.offsetParent as HTMLElement | null;
  const o = op ? rect(op) : { left: 0, top: 0 };
  return {
    origin: { left: o.left + (op?.clientLeft ?? 0) - (op?.scrollLeft ?? 0), top: o.top + (op?.clientTop ?? 0) - (op?.scrollTop ?? 0) },
    radius: getComputedStyle(panel).borderRadius || "0px",
  };
}

/** A card's box and its rows on screen, read from one layout. */
interface Measured {
  box: Edges;
  rows: HTMLElement[];
}
const measure = (panel: HTMLElement): Measured => ({ box: rect(panel), rows: visibleRows(panel) });

interface Shell {
  el: HTMLElement;
  /** The layer whose box is the card's box at each frame (read for a reverse). */
  edge: HTMLElement;
  anims: Animation[];
}
/** Put the card's surface on its own layer just under the card, moving from `from` to `to`
 *  (§21). Nothing that is costly to paint is painted again during the motion: the FILL (the
 *  textured paint: Metal's grain, Glass's frost, Ocean's sand) is painted once at the larger
 *  box, and a CLIP box (overflow hidden, the card's radius) moves over it while the fill moves
 *  the other way inside it, so it stays still on screen; the GPU only moves and clips layers.
 *  The EDGE (border and shadow, no fill) changes size, which is cheap to paint.
 *  Three earlier forms, all measured on 2026-10-20: one box with no layer of its own painted the
 *  bento again each frame (206 ms of raster in one Max open); a fill moved by a clip-path, which
 *  WebView2 paints, sometimes kept a stale fill over the covered card (the final review, Midi
 *  R1); a whole surface moved by its box was painted again every frame, and on Glass the
 *  painting fell behind, so the surface trailed the content by ~85 px in a Queue up grow (the
 *  final review, F2). `front`: an opening card, above a closing one, so in a hand-off the card
 *  that arrives is on top. */
function makeShell(panel: HTMLElement, from: Edges, to: Edges, t: KeyframeAnimationOptions, front: boolean, at: Place): Shell {
  // Writes only: every size was read before (Place), so making the shell lays nothing out.
  const el = document.createElement("div");
  el.className = front ? "grow-shell is-front" : "grow-shell";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `<div class="grow-shell__clip"><div class="grow-shell__fill"></div></div><div class="grow-shell__edge"></div>`;
  const u = union(from, to);
  Object.assign(el.style, boxAt(u, at.origin));
  panel.before(el);
  panel.classList.add("is-shelled");
  panel.classList.toggle("is-front", front);
  const clip = el.firstElementChild as HTMLElement;
  const fill = clip.firstElementChild as HTMLElement;
  const edge = el.lastElementChild as HTMLElement;
  // The fill keeps the larger box and stays still on screen: it moves against its clip.
  const still = (r: Edges): Keyframe => ({ left: `${u.left - r.left}px`, top: `${u.top - r.top}px` });
  Object.assign(fill.style, { width: `${u.right - u.left}px`, height: `${u.bottom - u.top}px` });
  const anims = [
    clip.animate([boxAt(from, u), boxAt(to, u)], t),
    fill.animate([still(from), still(to)], t),
    edge.animate([boxAt(from, u), boxAt(to, u)], t),
  ];
  return { el, edge, anims };
}

/** Covered cards that come back fade in over the motion (`t`). A card still fading OUT (a
 *  reverse) turns back from where its fade is; a hidden one fades from 0 by its own animation,
 *  with no reflow to commit a start value (the old way laid the page out once more). */
function fadeBack(slots: Slot[], t: KeyframeAnimationOptions): void {
  slots.forEach((s) => {
    const h = opts?.hosts[s];
    if (!h) return;
    h.inert = false;
    if (h.classList.contains("is-uncovering")) return; // already on its way back
    if (h.classList.contains("is-covering")) {
      h.classList.replace("is-covering", "is-uncovering");
      return;
    }
    h.classList.replace("is-covered", "is-uncovering");
    h.animate([{ opacity: 0 }, { opacity: 1 }], { ...t, fill: "none" });
  });
}

/** The open: the card is at its final box already (its span is set, its rows rebuilt), the
 *  shell moves from `from` to that box, and the content is clipped to the shell. */
function openRun(slot: Slot, panel: HTMLElement, from: Edges, fresh: Slot[], returning: Slot[], m: Motion, label: string, at: Place): Run {
  // The one layout of the click: the card at its final size. Everything else reads before it
  // (`at`, `from`) or from it (the rows), and writes after it.
  const to = rect(panel);
  const rows = m.rowsAt > 0 ? null : visibleRows(panel);
  // Fork 2A: the content rides the moving top and left edges (an up, a left or a Fill grow).
  // The riders are the card's children, not its edge zones.
  const dx = Math.max(0, from.left - to.left);
  const dy = Math.max(0, from.top - to.top);
  const riders = dx || dy ? [...panel.children].filter((el): el is HTMLElement => el instanceof HTMLElement && !el.classList.contains("grow-zone")) : [];
  const t: KeyframeAnimationOptions = { duration: m.dur, easing: m.ease, fill: "both" };
  const shell = makeShell(panel, from, to, t, true, at);
  const radius = at.radius;
  // The content's clip moves only on the sides the content does not ride. On a riding side
  // the content itself follows the edge and nothing lies beyond it, so the clip stays at the
  // card's box there. WebView2 applies a clip-path while painting, so a moving one trailed the
  // riding content by a frame and cut the title (the final review, F2).
  const start: Edges = { top: dy ? to.top : from.top, left: dx ? to.left : from.left, right: from.right, bottom: from.bottom };
  const anims: Animation[] = [
    ...shell.anims,
    panel.animate([{ clipPath: clipIn(start, to, radius) }, { clipPath: `inset(0 round ${radius})` }], t),
  ];
  // On the MAIN thread, in the same frame as the shell's box and the clip. A plain `translate`
  // animation runs on the compositor and went ahead of the edge whenever the main thread missed
  // a frame: the title cut for 1–3 frames in an up grow (the final review, F2). An animation
  // with one property the compositor cannot run stays on the main thread: `outline-offset`,
  // the same at both ends, so it changes nothing. A `top` / `left` offset also kept them in step
  // but laid the card out every frame and woke the lazy-load observers (44 → 21 frames).
  // Each rider is its own layer while it moves, so its picture moves and is not painted again.
  const placed = riders.map((el) => [el, el.style.willChange] as const);
  riders.forEach((el) => {
    el.style.willChange = "transform";
    anims.push(
      el.animate(
        [
          { translate: `${dx}px ${dy}px`, outlineOffset: "0px" },
          { translate: "0 0", outlineOffset: "0px" },
        ],
        t,
      ),
    );
  });
  // The rows come in once, at --grow-rows-at of the open (0: from its first frame, §21), as a
  // wave at the full --grow-rows-stagger, as live did. Squeezing the stagger so every row landed
  // with the edge (~5 ms a row for 30) made the rows drop out and come back almost together: a
  // flash, not a wave (his report, 2026-10-20).
  let rowsIn = false;
  let rowsTimer = 0;
  const showRows = () => {
    window.clearTimeout(rowsTimer);
    if (rowsIn) return;
    rowsIn = true;
    panel.classList.remove("is-grow-rebuild");
    enterAll(panel, 0, rows ?? undefined);
  };
  if (m.rowsAt > 0) {
    panel.classList.add("is-grow-rebuild");
    rowsTimer = window.setTimeout(showRows, m.rowsAt);
  } else showRows();
  const endFrames = frames.begin("grow", label);
  let over = false;
  const stop = () => {
    over = true;
    window.clearTimeout(rowsTimer);
    anims.forEach((a) => {
      a.onfinish = null;
      a.cancel();
    });
    shell.el.remove();
    placed.forEach(([el, wc]) => (el.style.willChange = wc));
    panel.classList.remove("is-shelled", "is-front");
    endFrames();
    dropRun(run);
  };
  const run: Run = {
    slot,
    kind: "open",
    shell: shell.edge,
    returning,
    finish: () => {
      if (over) return;
      stop();
      fresh.forEach((s) => cover(opts!.hosts[s]));
      returning.forEach((s) => uncover(opts!.hosts[s]));
      showRows();
      paintZones();
    },
    abort: () => {
      if (!over) stop();
    },
  };
  // The open ends ONCE, on its own flag: the old `oncancel` check of `animating` ran the end a
  // second time when a collapse had started in between, and hid the cards it was bringing back
  // (the break-it pass, §20, A1).
  anims[0].onfinish = run.finish;
  addRun(run);
  return run;
}

/** The close: the card is back in its resting box already, with its rows at that width coming
 *  in; the shell closes over it from `from`, and the covered cards fade back in under the edge.
 *  The card is never empty and its title never leaves (§20). */
function closeRun(
  slot: Slot,
  panel: HTMLElement,
  from: Edges,
  returning: Slot[],
  m: Motion,
  cause: string,
  at: Place,
  measured: Measured = measure(panel),
  done?: () => void,
): Run {
  const rest = measured.box;
  const t: KeyframeAnimationOptions = { duration: m.collapseDur, easing: m.ease, fill: "both" };
  const shell = makeShell(panel, from, rest, t, false, at);
  const anims = shell.anims;
  fadeBack(returning, t);
  // As live (his call, 2026-10-20: "defer to live if you can make it look great"): the body is
  // quiet while the shell starts to close, then the rows at the resting width wave in. Live
  // waved them after the shell had landed; here the wave starts at the open's own point
  // (--grow-rows-at of the collapse), so the card is quiet under 100 ms, the rows are already
  // in their final places, and the wave settles with the card. (Showing them at once, §21.5,
  // swapped wide rows for narrow ones in one frame.)
  let rowsIn = false;
  const showRows = () => {
    window.clearTimeout(rowsTimer);
    if (rowsIn) return;
    rowsIn = true;
    panel.classList.remove("is-grow-rebuild");
    enterAll(panel, 0, measured.rows);
  };
  const rowsAt = m.dur > 0 ? (m.rowsAt / m.dur) * m.collapseDur : 0;
  let rowsTimer = 0;
  if (rowsAt > 0) {
    panel.classList.add("is-grow-rebuild");
    rowsTimer = window.setTimeout(showRows, rowsAt);
  } else showRows();
  const endFrames = frames.begin("grow", `${slot} collapse`);
  let over = false;
  const run: Run = {
    slot,
    kind: "close",
    shell: shell.edge,
    returning,
    finish: () => {
      if (over) return;
      over = true;
      anims.forEach((a) => {
        a.onfinish = null;
        a.cancel();
      });
      shell.el.remove();
      panel.classList.remove("is-shelled", "is-front");
      showRows(); // a collapse cut short (a surface change) still brings its rows back
      endFrames();
      returning.forEach((s) => uncover(opts!.hosts[s])); // they faded back in as the shell closed
      diag.log("grow:collapse", { slot, cause, motion: true });
      dropRun(run);
      paintZones();
      done?.();
    },
    abort: () => run.finish(),
  };
  anims[0].onfinish = run.finish;
  addRun(run);
  return run;
}

/** Grow `slot` in `dir`. Another card grown hands over to this one: it closes while this one
 *  opens, as one motion (fork 3A). The same card in a new shape moves from its shape now. */
export function growCard(slot: Slot, dir: GrowDir, cause: string): void {
  if (!enabled() || animating || !opts) return;
  const panel = opts.hosts[slot];
  if (!panel || !isLive(slot)) return;
  if (dir === "full" && (!canFill() || isStage(slot))) return; // the stage column never fills
  if (dir !== "full" && !growDirs(slot).includes(dir)) return;
  if (state && state.slot === slot && state.dir === dir) return;
  const m = motion();
  if (state && state.slot !== slot && !m) collapseNow("other");
  const covered = coveredFor(slot, dir);
  if (!covered.length) return;
  const mode = modeOf(dir);
  const prev = state;
  const other = prev && prev.slot !== slot ? prev : null;
  const leaving = other ? opts.hosts[other.slot] : null;
  // Read before any write: both boxes now, and where the shell goes (the layout is clean).
  const leaveFrom = leaving ? rect(leaving) : null;
  const from = rect(panel);
  const at = placeOf(panel);
  const hidden = prev?.covered ?? [];
  // Pin holds through a new shape of the same card (the break-it pass, §20, B1).
  state = { slot, mode, dir, covered, pinned: prev?.slot === slot ? prev.pinned : false };
  // Newly covered cards fade out under the opening edge; cards the last grow covered and this
  // one does not come back. Cards covered by both stay hidden.
  const fresh = covered.filter((s) => !hidden.includes(s));
  const returning = hidden.filter((s) => !covered.includes(s) && s !== slot);
  if (leaving) {
    delete leaving.dataset.grow;
    delete leaving.dataset.growDir;
    leaving.classList.remove("is-grown");
  }
  panel.dataset.grow = mode;
  panel.dataset.growDir = dir;
  panel.classList.add("is-grown");
  diag.log("grow", { slot, dir, mode, cause, covered: covered.join("+"), from: other ? `${other.slot} ${other.dir}` : prev ? prev.dir : "" });
  emit(); // the cards re-read their state (the Library rebuilds its rows with columns)
  if (!m) {
    fresh.forEach((s) => cover(opts!.hosts[s]));
    returning.forEach((s) => uncover(opts!.hosts[s]));
    panel.classList.remove("is-grow-rebuild");
    enterAll(panel);
    paintZones();
    return;
  }
  // The hand-off: the card that was grown closes to its place as this one opens. When this grow
  // covers it, it fades out with the others instead (it is in `fresh`). Its resting box and rows
  // are read now, from the same layout as the opening card's.
  // `is-covering` BEFORE the layout is read: in Midi it is what keeps the covered card in its own
  // grid cell (§19). After the read, the covered card had dropped into a new row and squeezed the
  // grown card (448 → 374 px), so the shell ended 75 px short and the card jumped (2026-10-20).
  fresh.forEach((s) => opts!.hosts[s]?.classList.add("is-covering"));
  const handOff = leaving && leaveFrom && other && !covered.includes(other.slot) ? { slot: other.slot, panel: leaving, from: leaveFrom, measured: measure(leaving) } : null;
  openRun(slot, panel, from, fresh, returning, m, `${slot} ${dir}`, at);
  fadeBack(returning, { duration: m.dur, easing: m.ease });
  if (handOff) closeRun(handOff.slot, handOff.panel, handOff.from, [], m, "other", at, handOff.measured);
}

export const cover = (h: HTMLElement | null | undefined) => {
  if (!h) return;
  h.classList.remove("is-covering", "is-uncovering");
  h.classList.add("is-covered");
  h.inert = true;
};
export const uncover = (h: HTMLElement | null | undefined) => {
  if (!h) return;
  h.classList.remove("is-covered", "is-covering", "is-uncovering");
  h.inert = false;
};

/** End the grow at once, no motion (a surface change, a recompose, reduced motion). A motion
 *  on screen jumps to its end first. */
function collapseNow(cause: string): void {
  [...runs].forEach((r) => r.finish());
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

// ── the grow rule (RULES.md §10: the rules engine's `grow` action) ─────────────
/** The level a rule grow opened: Back off it ends the grow (CARD-GROW.md §18, fork 6A).
 *  `depth` is the card's level count at the grow (a collection frame, a Search pane, a Diary
 *  entry = 1). A hand change clears it (fork 7A), and Back then leaves the grow alone. */
let ruleMark: { card: string; slot: Slot; depth: number } | null = null;
let ruleGrowing = false;

/**
 * A rule asks `card` to grow on one axis: `vertical` = over the neighbour above or below,
 * `horizontal` = beside it, `full` = Fill (Max only). It obeys "Grow cards from edges", does
 * nothing in Mini or the player view, waits for the swap and for a grow's motion, and never
 * changes a grow already on screen (fork 7A) — except `replace`, the cog's press, which keeps
 * what the cog always did: the other grow ends and Settings opens. Resolves true when it grew.
 */
export async function growByRule(card: string, axis: "horizontal" | "vertical" | "full", depth: number, why: string, replace = false): Promise<boolean> {
  const no = (reason: string): false => {
    diag.log("grow:rule", { card, axis, why, applied: false, reason });
    return false;
  };
  if (!enabled()) return no(setting("cardGrow") ? "surface" : "setting");
  // The same checks now, before any wait: when they pass, the grow is on its way, and the
  // drill that asked places its level with no slide (`ruleGrowComing`). The body blanks at
  // once, so the new level never shows at the small size (his call, 2026-09-26). Only a drill
  // does this: the cog, the Diary and a new playlist keep the motion they had.
  const drill = why === "album.open" || why === "artist.open";
  const early = drill ? opts?.slotOf(card) ?? null : null;
  const blank = early && !animating && ruleDir(early, axis, replace) ? opts!.hosts[early] : null;
  if (blank) {
    coming = card;
    if (motion()) blank.classList.add("is-grow-rebuild");
  }
  try {
    await whenSwapSettled();
    await settled;
    // The page waits as a slide's does (his call 3A, 2026-10-21): the old page stays until the
    // new one is drawn, at most --drill-wait, so the grow opens on the album, not a ♪ square.
    if (blank && drill && motion()) await readyIn(blank, tokenMs("--drill-wait"));
    const slot = opts?.slotOf(card) ?? null;
    if (!slot) return no("not on screen");
    if (state?.slot === slot) return no("already grown");
    if (state && !replace) return no("a grow is on screen");
    const dir = ruleDir(slot, axis, replace);
    if (!dir) return no("no-axis");
    ruleGrowing = true;
    startNow(card); // the old page leaves on the grow's first frame
    try {
      growCard(slot, dir, `rule:${why}`);
    } finally {
      ruleGrowing = false;
    }
    // Marked as it starts, not as it lands: a Back during the open ends it as its one motion,
    // turning back from where the edge is (§22.6, his call 4A; 2026-10-21 a Back 150 ms in
    // slid first, then shrank).
    if (state?.slot === slot) ruleMark = { card, slot, depth };
    await settled;
    const grew = state?.slot === slot && ruleMark?.card === card;
    if (!grew && ruleMark?.card === card && ruleMark.slot === slot && state?.slot !== slot) ruleMark = null;
    diag.log("grow:rule", { card, axis, dir, why, applied: grew, depth, placed: !!blank });
    return grew;
  } finally {
    startNow(card); // a grow that did not run: the new page shows now, in place
    if (coming === card) coming = null;
    // A grow that did not run after all: the blanked body comes back, its rows enter.
    if (blank && !(state && opts?.hosts[state.slot] === blank)) {
      blank.classList.remove("is-grow-rebuild");
      enterAll(blank);
    }
  }
}

/** Fill with `card` once its swap has landed (Rulez opens at Fill, RULES.md §20.6). Any other
 *  grow ends first. Obeys "Grow cards from edges" and Max, as every grow does. */
export async function fillCard(card: string, why: string): Promise<void> {
  await whenSwapSettled();
  await settled;
  const slot = opts?.slotOf(card) ?? null;
  if (!slot || state?.slot === slot) return;
  if (canFill()) return growCard(slot, "full", why);
  // Two-card Max: the grow over the other card is the whole content area (MAX-CARDS.md §4.5).
  // One card: nothing to cover, so the card stays as it is.
  const dir = growDirs(slot)[0];
  if (dir && !isStage(slot)) growCard(slot, dir, why);
}

/** The way a rule grow on `axis` goes from `slot`, or null when it cannot (or must not) grow. */
function ruleDir(slot: Slot, axis: "horizontal" | "vertical" | "full", replace: boolean): GrowDir | null {
  if (state?.slot === slot || (state && !replace)) return null;
  if (axis === "full") {
    if (isStage(slot)) return null;
    if (canFill()) return "full";
    // Two-card Max: the grow over the other card is the whole area (MAX-CARDS.md §4.4).
    return currentSurface() === "max" ? growDirs(slot)[0] ?? null : null;
  }
  const want: SideDir[] = axis === "vertical" ? ["up", "down"] : ["left", "right"];
  return growDirs(slot).find((d) => want.includes(d)) ?? null;
}

/** A rule grow of `card` has passed its checks and is on its way. The drill that emitted the
 *  event places its new level with no slide: the grow is the one motion (RULES.md §18). */
let coming: string | null = null;
export const ruleGrowComing = (card: string): boolean => coming === card;
/** What runs on the coming grow's first frame, or at once when it does not run (§22.6): the
 *  drill keeps the old page up until then. Each runs once. */
const onStart = new Map<string, (() => void)[]>();
export function onRuleGrowStart(card: string, cb: () => void): void {
  if (coming !== card) return cb();
  onStart.set(card, [...(onStart.get(card) ?? []), cb]);
}
function startNow(card: string): void {
  const cbs = onStart.get(card);
  onStart.delete(card);
  cbs?.forEach((cb) => cb());
}

/** Would `levelLeft(card, depth)` end a rule grow? A Back that swaps cards asks first: then the
 *  shrink is its one motion and the swap plays no slide (CARD-GROW.md §22.6, his call 4A). It
 *  does not ask the cancel event (a rule with Keep): that one fires once, in `levelLeft`. */
export const ruleGrowEndsAt = (card: string, depth: number): boolean =>
  !!ruleMark && ruleMark.card === card && depth < ruleMark.depth && state?.slot === ruleMark.slot && motion() !== null;

/** A Back path: `card` now has `depth` levels open. Back past the level a rule grow opened
 *  collapses it, when the grow on screen is still that rule grow. */
export function levelLeft(card: string, depth: number): void {
  if (!ruleMark || ruleMark.card !== card || depth >= ruleMark.depth) return;
  const mark = ruleMark;
  ruleMark = null;
  if (state?.slot !== mark.slot) return;
  // A cancel event (RULEZ.md §4, route 7): a rule with Keep leaves the card grown on Back.
  if (cancelled("grow.back", { card })) return diag.log("grow:kept", { slot: mark.slot, on: "back" });
  void collapseGrow("rule-back");
}

export function collapseGrow(cause: string, withMotion = true): Promise<void> {
  if (!state || !opts) return Promise.resolve();
  const m = withMotion ? motion() : null;
  // A collapse during this card's open turns it back from where the edge is (Escape, the menu's
  // Collapse, a Compass request for a covered card: §21). Any other motion is waited out.
  const opening = m ? [...runs].find((r) => r.kind === "open" && r.slot === state!.slot) : undefined;
  if (animating && !opening) return settled.then(() => collapseGrow(cause, withMotion));
  if (!m) {
    collapseNow(cause);
    return Promise.resolve();
  }
  const { slot, covered } = state;
  const panel = opts.hosts[slot];
  if (!panel) {
    collapseNow(cause);
    return Promise.resolve();
  }
  // The shell's box now: the grown box, or where a reversed open had got to.
  const from = opening ? rect(opening.shell) : rect(panel);
  const at = placeOf(panel);
  opening?.abort();
  state = null;
  delete panel.dataset.grow;
  delete panel.dataset.growDir;
  panel.classList.remove("is-grown");
  emit(); // the card rebuilds its rows at the old width, before the close starts
  // A reversed open brings back what it covered, and what it was bringing back already.
  const back = [...covered, ...(opening?.returning ?? [])];
  return new Promise<void>((resolve) => closeRun(slot, panel, from, back, m, cause, at, undefined, resolve));
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
    if (effective("cardGrowOutside")) items.push({ label: state.pinned ? "Unpin" : "Pin", run: () => setPinned(!state?.pinned) });
    items.push({ label: "Collapse", run: () => void collapseGrow("menu") });
  }
  return items;
}

// ── the Grow button (hover-only, out of flow) ─────────────────────────────────
const ICON_GROW = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/></svg>`;
export const ICON_SHRINK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10h-6V4M14 10l7-7M4 14h6v6M10 14l-7 7"/></svg>`;
import { ICON_PIN } from "./pins"; // one pin glyph for the app (PINS.md)

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
    const showPin = !!state && state.slot === slot && effective("cardGrowOutside");
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
  // Once the motion has ended (afterMotion), not in the grow's own task: placing the button
  // reads the header's sizes, and a read there laid the grown card out once more inside the
  // click (8 ms, 2026-10-20). Its press reads the grow live, so a press during the motion still
  // does the right thing (a collapse turns the open back).
  let queued = false;
  const unsub = onGrowChange(() => {
    if (queued) return;
    queued = true;
    afterMotion(() => {
      if (!queued) return; // destroyed meanwhile
      queued = false;
      if (state?.slot === slot) show();
      paint();
      if (!hovered) hide();
    });
  });
  if (state?.slot === slot) show(); // a card mounted into a grown slot (a pick while grown)
  paintZones();
  return {
    destroy() {
      unsub();
      queued = false;
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
    // The max map: content columns 2.., rows 1.. of the layout (layout-rules.ts); a grown card
    // spans more of them.
    const g = state?.slot === slot ? state : null;
    return maxBeyond(maxNow(), slot as MaxSlot, side, g?.mode ?? null);
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
    // Another card grown does not stop it: growCard ends that grow first, with no motion (his
    // ask, 2026-10-14, as for Now Playing's strips). The WHOLE gap when nothing else claims it (a 6 px target would be needlessly hard to
    // hit); half of it while Now Playing's own bottom strip (the full player) takes the other
    // half (2026-10-11).
    return { dir: "up", act: "grow", reach: npRightLive() ? "half" : "full" };
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
  // The outer sides: the one-click Fill zones (four-card max only); on the grown card they
  // collapse it (two-card max too: there the grow over the other card is the whole area).
  // Two-card Max, at rest: the right and the far outer strip (the top card's top, the bottom
  // card's bottom; the right card's right...) grow the card over the other one, as the strip
  // toward it does (his ask, 2026-10-20: only the top strip grew the bottom card). The left
  // strip beside the stage stays Now Playing's.
  if (!canFill() && !mine && currentSurface() === "max" && !state && side !== "left") {
    const dirs = growDirs(slot);
    if (dirs.length !== 1) return null;
    return { dir: dirs[0], act: "grow", reach: b === "edge" ? "edge" : "full" };
  }
  if (!canFill() && !(mine && currentSurface() === "max")) return null;
  if (state && !mine) return null; // while one card is grown, only its own outer zones act
  // The gap beside the stage is shared with Now Playing's full-player strip: split at its
  // middle line, as a gap between two cards is (features/fullscreen-player.md §10.3). A grown
  // card's collapse strip shares it too: Now Playing's strip acts while a card is grown.
  const shared = side === "left" && npRightLive();
  return { dir: "full", act: mine ? "collapse" : "grow", reach: b === "edge" ? "edge" : shared ? "half" : "full" };
}

/** Is a content card's strip live in the gap beside the stage (Max)? Now Playing's right
 *  strip then takes only its half of the gap (full-player.ts). */
export function stageGapShared(): boolean {
  if (!opts || currentSurface() !== "max") return false;
  return opts.slots().some((s) => !isStage(s) && isLive(s) && beyond(s, "left") === "outer" && !!zoneAction(s, "left"));
}

// A second click on an edge bar lands on the grown card's rows: the bar's place is inside the
// card once it grows (the break-it pass, §20, B2: a History row under the pointer at +150 ms).
// For the length of a double click after a bar's click, a press at that place does nothing.
// Windows' default double-click time; a user's own setting is not readable from the page.
const DOUBLE_CLICK_MS = 500;
const GUARD_PX = 24;
let guard: { x: number; y: number; until: number } | null = null;
const guardPoint = (x: number, y: number) => (guard = { x, y, until: performance.now() + DOUBLE_CLICK_MS });
function guarded(e: MouseEvent): boolean {
  if (!guard || performance.now() > guard.until) return (guard = null), false;
  if (Math.hypot(e.clientX - guard.x, e.clientY - guard.y) > GUARD_PX) return false;
  return !(e.target instanceof Element && e.target.closest(".grow-zone"));
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
      guardPoint(e.clientX, e.clientY);
      if (a.act === "collapse") void collapseGrow("zone");
      else growCard(slot, a.dir, "zone");
    });
    host.appendChild(el);
    return el;
  });
}

/** Re-decide every strip: what it does, how far it reaches, what its hint says. */
function paintZones(): void {
  // [data-slot]: the full player's strips on Now Playing are .grow-zone too, painted by it.
  document.querySelectorAll<HTMLElement>(".grow-zone[data-slot]").forEach((el) => {
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
/** The card a slot shows (the layout marks each host), for the rules' `card` and `grown`. */
function cardIn(slot: Slot): string {
  if (slot === "np") return "now-playing";
  if (slot === "queue") return "queue";
  return opts?.hosts[slot]?.dataset.mounted ?? slot;
}

declare global {
  interface Window {
    /** A measuring handle on the TELEMETRY gate (DEBUGGING.md). */
    __grow?: {
      grow: typeof growCard;
      collapse: typeof collapseGrow;
      state: typeof grownState;
      zones: () => Record<string, string | undefined>[];
      dirs: typeof growDirs;
    };
  }
}

export function initCardGrow(o: Opts): void {
  opts = o;
  // The rules engine (RULES.md §10): the grow action and the events that can grow a card.
  registerEvent("album.open", { facts: ["surface", "cause"] });
  registerEvent("artist.open", { facts: ["surface", "cause"] });
  registerEvent("diary.open", { facts: ["surface", "entry.new"] });
  registerEvent("cog", { facts: ["surface"] });
  // Rulez (RULES.md §20.7): a press outside the grown card is a cancel event. In = the card you
  // pressed; a rule whose Do is Keep leaves the grow open. `grown` = the card that is grown.
  registerEvent("grow.outside", { facts: [] });
  registerEvent("grow.back", { facts: [] });
  // The check runs once the motion has ended (afterMotion): reading the facts lays the page out
  // (`soloCard` asks each card for its boxes), and inside the grow's task that was a second
  // layout of the grown card (7 ms, 2026-10-20). A rule on `grown` acts as the card lands.
  registerFact("grown", () => (state ? cardIn(state.slot) : "none"), { seam: (cb) => onGrowChange(() => afterMotion(cb)) });
  registerAction("grow", {
    cost: "free",
    run: (axis, ctx, rule) =>
      growByRule(ctx.card, axis as "horizontal" | "vertical" | "full", ctx.depth ?? 1, rule.kind === "moment" ? rule.when : "rule", ctx.card === "settings" && rule.kind === "moment" && rule.when === "cog"),
  });
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
    // Layout for Max changed: collapse with no motion, as on a surface change, before the
    // layout remounts the slots (this listener is wired first).
    // Only in Max: a Midi grow has nothing to do with Max's layout (the break-it pass, §20, A3).
    if (k === "maxCards" && currentSurface() === "max") {
      collapseNow("layout");
      paintZones();
    }
  });
  // Esc collapses, unless a menu, a popover or a text field takes it first.
  document.addEventListener("keydown", (e) => {
    // A key that a list already spent on its own Back step (list-keys.ts) is one step, not two:
    // Escape in Rulez folded the open rule AND left Fill (2026-10-06).
    // During the card's own open, Escape turns it back (§21); during any other motion it waits.
    if (e.key !== "Escape" || !state || e.defaultPrevented) return;
    if (animating && ![...runs].some((r) => r.kind === "open" && r.slot === state!.slot)) return;
    const t = e.target;
    if (t instanceof Element && t.closest("input, textarea, [contenteditable]")) return;
    if (document.querySelector(".ctx-menu, .lib-pop:not([hidden]), .slot-picker__menu:not([hidden]), .pop:not([hidden])")) return;
    void collapseGrow("esc");
  });
  // The edge bar's double click (guardPoint): the second press stops here, before any card.
  for (const type of ["pointerdown", "mousedown", "click", "dblclick", "contextmenu"] as const)
    document.addEventListener(
      type,
      (e) => {
        if (!guarded(e)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      { capture: true },
    );
  // A click outside the grown card (inside the body: another card, the stage) collapses it.
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!state || animating || state.pinned || !effective("cardGrowOutside")) return;
      const t = e.target as HTMLElement | null;
      if (!t || !opts) return;
      if (!opts.body.contains(t)) return; // the title bar and the fixed overlays do not count
      if (t.closest(".grow-zone, .ctx-menu, .lib-pop")) return;
      const panel = opts.hosts[state.slot];
      if (panel && panel.contains(t)) return;
      const pressed = (Object.keys(opts.hosts) as Slot[]).find((s) => opts!.hosts[s]?.contains(t));
      if (cancelled("grow.outside", { card: pressed ? cardIn(pressed) : "*" })) {
        diag.log("grow:kept", { slot: state.slot, pressed: pressed ?? "" });
        return;
      }
      void collapseGrow("outside");
    },
    { capture: true },
  );
  paintZones();
  // A measuring handle: drive a grow from the console or scripts/webview-eval.mjs
  // (DEBUGGING.md). On the TELEMETRY gate, not DEV, so `npm run dev:built` — the honest
  // graphics build — still answers it. The installed bundle carries none of it.
  if (TELEMETRY) {
    window.__grow = {
      grow: growCard,
      collapse: collapseGrow,
      state: grownState,
      zones: () => [...document.querySelectorAll<HTMLElement>(".grow-zone:not([hidden])")].map((z) => ({ ...z.dataset })),
      dirs: growDirs,
    };
  }
}
