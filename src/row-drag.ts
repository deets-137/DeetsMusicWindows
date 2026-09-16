// Row drag — the one drag primitive (DRAG-DROP.md §4). It reorders a row inside its own
// list (Up Next, a local playlist's detail; PLAYLISTS.md §10.1) and carries songs from any
// card to any card that takes them (the Queue, a playlist, the Library, Now Playing).
//
// Whole-row press-and-drag: a quick click still acts; hold and move past DRAG_THRESHOLD px
// in any direction to drag. A translucent COPY of the row (the ghost) follows the pointer
// 1:1 on <body>, so it can cross card edges; the pressed row stays in place and dims.
//  - Inside the source's own reorderable list: an insertion LINE shows where the row lands.
//  - Anywhere else: the registered drop target under the pointer draws its own indicator
//    (a line in its list, or a row / card outline), or the ghost shows it can't drop.
// Rows are uniform height and flush, so an insertion index is row math on the list's scroll
// position — it holds when the list is windowed (collection-window.ts). Every card holds its
// re-renders while any drag runs (`isDragging` / `onDragEnd`). Escape cancels.

import * as frames from "./frames";
import type { Track } from "./library";
import type { Station } from "./radio";

const DRAG_THRESHOLD = 6;
const EDGE = 28; // px from a list's top/bottom edge where auto-scroll starts
const STEP = 9; // px scrolled per frame

/** What a drag carries (§2). `tracks()` runs only at the drop, so a Search album costs no
 *  fetch until it lands somewhere. */
export interface DragPayload {
  /** The card it came from ("library", "playlists", "search", "queue", "queue-now",
   *  "history", "rewind", "now-playing") — a target refuses its own card's drags. */
  source: string;
  /** `station` (2026-09-15): a stream, not a song list — `tracks()` is empty, `station` is
   *  set, and only the Queue card (plays after the queue) and Now Playing (plays now) take it. */
  kind: "song" | "album" | "playlist" | "artist" | "station";
  /** Songs in a collection, when known at press time — shown on the ghost. */
  count?: number;
  tracks: () => Track[] | Promise<Track[]>;
  /** The station a `station` payload carries. */
  station?: Station;
  /** The queue-origin tag for songs played or queued from this drag. */
  context?: string;
  /** A catalog album: the Library drop adds it as the album. */
  albumId?: string;
  /** The playlist the songs come from (its libraryId): a drop back on it does nothing. */
  playlistId?: string;
  /** Overrides the Now Playing drop's play (an Up Next row jumps, as its menu's Play Now). */
  play?: () => Promise<void>;
}

export interface DragRow {
  row: HTMLElement;
  /** The row's position in the list (its data-idx). */
  index: number;
  /** A reorderable list: the scrolling element that holds the rows. Absent → a copy-only source. */
  list?: HTMLElement;
  /** How many rows the list has in all (rendered or not). */
  count?: number;
  payload?: DragPayload;
}

export interface RowDragOptions {
  /** Where pointerdown is heard (delegated, so it survives re-renders). */
  root: HTMLElement;
  /** The draggable row under a press, or null when a drag is not allowed there now. */
  rowAt: (target: HTMLElement) => DragRow | null;
  /** The drag crossed the threshold. */
  onStart?: (from: number) => void;
  /** The drag is over and the row styles are cleared. `to` is splice semantics (remove
   *  at `from`, insert at `to`); null for a cancel, a drop in place, or a copy to a target. */
  onEnd?: (from: number, to: number | null) => void;
  /** The frame-telemetry label (frames.ts "drag"); a copy logs as "cross". */
  label: string;
}

export interface RowDrag {
  /** A drag is in progress (past the threshold). */
  active(): boolean;
  /** True once for the click that trails a drag's pointerup — the caller swallows it. */
  consumeClick(): boolean;
  destroy(): void;
}

// ── drop targets (module level, so every card shares one drag) ─────────────────

export interface DropHit {
  /** Outlined while the pointer is here (a playlist row, a whole card). */
  highlight?: HTMLElement;
  /** Show an insertion line among this list's `[data-idx]` rows; `drop` gets the index. */
  slots?: { list: HTMLElement; count: number };
  /** Auto-scrolled when the pointer nears its top or bottom edge. */
  scroll?: HTMLElement;
  /** Absent → the pointer is over a target that doesn't take this payload (scroll only). */
  drop?: (at: number | null) => void;
}

export interface DropTarget {
  el: HTMLElement;
  /** The hit for a payload over `under` (the element at the pointer), or null to let an
   *  outer target answer. */
  over: (under: HTMLElement, x: number, y: number, p: DragPayload) => DropHit | null;
}

const targets = new Set<DropTarget>();
export function registerDropTarget(t: DropTarget): () => void {
  targets.add(t);
  return () => targets.delete(t);
}

let active = false;
const endSubs = new Set<() => void>();
/** A drag runs somewhere: hold re-renders (the source row and a target's line would go). */
export const isDragging = (): boolean => active;
/** Fires when a drag ends, before its drop runs — flush the renders held meanwhile. */
export function onDragEnd(cb: () => void): () => void {
  endSubs.add(cb);
  return () => endSubs.delete(cb);
}

// The click that trails a drag's pointerup lands on whatever sits under the pointer (a row
// in another card, a play). One capture listener swallows it for every card — also after an
// Escape, when the release comes later. The next press clears a flag no click consumed.
let swallowClick = false;
window.addEventListener("pointerdown", () => (swallowClick = false), true);
window.addEventListener(
  "click",
  (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  },
  true,
);

/** The insertion slot for pointer `y` among `list`'s uniform, flush `[data-idx]` rows:
 *  `ins` in 0..count and the line's top in the list's content coordinates. Null when no
 *  row is rendered to measure. */
function slotAt(list: HTMLElement, y: number, count: number): { ins: number; top: number } | null {
  const row = list.querySelector<HTMLElement>("[data-idx]");
  if (!row) return null;
  const lr = list.getBoundingClientRect();
  const rowH = row.offsetHeight || 1;
  const rowTop = row.getBoundingClientRect().top - lr.top - list.clientTop + list.scrollTop;
  const firstTop = rowTop - Number(row.dataset.idx) * rowH;
  const contentY = y - lr.top - list.clientTop + list.scrollTop;
  const ins = Math.max(0, Math.min(count, Math.round((contentY - firstTop) / rowH)));
  return { ins, top: firstTop + ins * rowH };
}

const inside = (el: HTMLElement, x: number, y: number) => {
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
};

/** The innermost registered target under the pointer that answers. */
function hitAt(x: number, y: number, p: DragPayload): DropHit | null {
  const under = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!under) return null;
  const hits = [...targets].filter((t) => t.el.contains(under));
  hits.sort((a, b) => (a.el.contains(b.el) ? 1 : b.el.contains(a.el) ? -1 : 0)); // deepest first
  for (const t of hits) {
    const h = t.over(under, x, y, p);
    if (h) return h;
  }
  return null;
}

/** The songs phrase for a ghost's count. */
const songsText = (n: number) => `${n} song${n === 1 ? "" : "s"}`;

/**
 * The ghost: a copy of the row on <body>. Card styles are scoped by ancestors (`.qcard .qrow`,
 * `.lib-view[data-grid] .lib-tile`, card tokens), so the copy sits inside shells that repeat
 * the row's ancestor chain — same tags, classes and data attributes — with `display: contents`:
 * the selectors and inherited tokens still match, and the shells draw no box.
 */
export function makeGhost(row: HTMLElement, p: DragPayload | undefined): { root: HTMLElement; ghost: HTMLElement } {
  const chain: HTMLElement[] = [];
  for (let a = row.parentElement; a && a !== document.body; a = a.parentElement) chain.unshift(a);
  let root: HTMLElement | null = null;
  let parent: HTMLElement | null = null;
  for (const a of chain) {
    const shell = document.createElement(a.tagName);
    for (const at of Array.from(a.attributes))
      if (at.name === "class" || (at.name.startsWith("data-") && at.name !== "data-tauri-drag-region")) shell.setAttribute(at.name, at.value);
    shell.classList.remove("is-reordering", "is-drop-target");
    shell.style.setProperty("display", "contents", "important");
    shell.setAttribute("aria-hidden", "true");
    if (parent) parent.appendChild(shell);
    else root = shell;
    parent = shell;
  }
  const r = row.getBoundingClientRect();
  const ghost = row.cloneNode(true) as HTMLElement;
  ghost.classList.remove("is-context", "is-selected", "is-drag-source", "is-drop-target");
  ghost.classList.add("drag-ghost");
  ghost.removeAttribute("id");
  ghost.removeAttribute("tabindex");
  ghost.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  ghost.setAttribute("aria-hidden", "true");
  // Inline, so a card's own row rule (`position: relative`) can't pull the copy back into flow.
  ghost.style.position = "fixed";
  ghost.style.pointerEvents = "none";
  ghost.style.left = `${r.left}px`;
  ghost.style.top = `${r.top}px`;
  ghost.style.width = `${r.width}px`;
  ghost.style.height = `${r.height}px`;
  // The count badge: a collection always names how many songs it carries, and a picked
  // SET of songs does too once there is more than one (NEXT-VERSION §19). One song alone
  // never wears a badge — the row itself is the whole payload.
  if (p?.count != null && (p.kind !== "song" || p.count > 1)) {
    const badge = document.createElement("span");
    badge.className = "drag-ghost__count";
    badge.textContent = songsText(p.count);
    ghost.appendChild(badge);
  }
  if (parent) parent.appendChild(ghost);
  else root = ghost;
  document.body.appendChild(root!);
  return { root: root!, ghost };
}

export function rowDrag(opts: RowDragOptions): RowDrag {
  type Drag = {
    src: DragRow;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    ghostRoot: HTMLElement;
    ghost: HTMLElement;
    line: HTMLElement; // one insertion line, moved between lists as needed
    lineList: HTMLElement | null;
    lit: HTMLElement | null; // the outlined target
    reordering: boolean; // the pointer is inside the source's own list
    to: number;
    hit: DropHit | null;
    slot: number | null;
    raf: number;
  };
  let drag: Drag | null = null;
  let pending: (DragRow & { startX: number; startY: number }) | null = null;
  let suppressClick = false;
  let endFrames = () => {};

  const placeLine = (d: Drag, list: HTMLElement | null, top = 0) => {
    if (d.lineList !== list) {
      if (d.lineList && d.lineList !== d.src.list) d.lineList.classList.remove("is-reordering");
      d.line.remove();
      d.lineList = list;
      if (list) {
        list.classList.add("is-reordering"); // positioned: the line's reference
        list.appendChild(d.line);
      }
    }
    if (list) d.line.style.top = `${top}px`;
  };
  const light = (d: Drag, el: HTMLElement | null) => {
    if (d.lit === el) return;
    d.lit?.classList.remove("is-drop-target");
    d.lit = el;
    el?.classList.add("is-drop-target");
  };

  // Re-evaluate the pointer: the ghost, the reorder line, or the target under it.
  const update = () => {
    const d = drag;
    if (!d) return;
    d.ghost.style.setProperty("--ghost-x", `${d.lastX - d.startX}px`);
    d.ghost.style.setProperty("--ghost-y", `${d.lastY - d.startY}px`);
    const { src } = d;
    // A windowed list can drop the pressed row's element and render a new one when it
    // scrolls back — dim that one.
    if (src.list && !src.row.isConnected) {
      const again = src.list.querySelector<HTMLElement>(`[data-idx="${src.index}"]`);
      if (again) {
        again.classList.add("is-drag-source");
        src.row = again;
      }
    }

    d.reordering = !!src.list && src.list.isConnected && inside(src.list, d.lastX, d.lastY);
    if (d.reordering) {
      d.hit = null;
      light(d, null);
      const s = slotAt(src.list!, d.lastY, src.count ?? 0);
      if (s) {
        d.to = s.ins <= src.index ? s.ins : s.ins - 1;
        placeLine(d, src.list!, s.top);
      }
      d.ghost.classList.remove("is-nodrop");
      document.documentElement.classList.remove("is-drag-nodrop");
      return;
    }
    d.to = src.index;
    const hit = src.payload ? hitAt(d.lastX, d.lastY, src.payload) : null;
    d.hit = hit;
    d.slot = null;
    const s = hit?.drop && hit.slots ? slotAt(hit.slots.list, d.lastY, hit.slots.count) : null;
    if (s) {
      d.slot = s.ins;
      placeLine(d, hit!.slots!.list, s.top);
      light(d, null);
    } else {
      placeLine(d, null);
      light(d, hit?.drop ? hit.highlight ?? hit.slots?.list ?? null : null);
    }
    const nodrop = !hit?.drop;
    d.ghost.classList.toggle("is-nodrop", nodrop);
    document.documentElement.classList.toggle("is-drag-nodrop", nodrop);
  };

  const autoScroll = () => {
    const d = drag;
    if (!d) return;
    const el = d.reordering ? d.src.list : d.hit?.scroll;
    if (el?.isConnected) {
      const r = el.getBoundingClientRect();
      const dy = d.lastY < r.top + EDGE ? -STEP : d.lastY > r.bottom - EDGE ? STEP : 0;
      if (dy && d.lastX >= r.left && d.lastX <= r.right) {
        el.scrollTop += dy;
        update();
      }
    }
    d.raf = requestAnimationFrame(autoScroll);
  };

  const begin = () => {
    if (!pending) return;
    const p = pending;
    pending = null;
    const { root, ghost } = makeGhost(p.row, p.payload);
    p.row.classList.add("is-drag-source");
    document.documentElement.classList.add("is-row-dragging");
    window.getSelection()?.removeAllRanges(); // a press can start a text selection before the threshold
    const line = document.createElement("div");
    line.className = "drop-line";
    endFrames = frames.begin("drag", p.list ? opts.label : "cross");
    active = true;
    drag = {
      src: p, startX: p.startX, startY: p.startY, lastX: p.startX, lastY: p.startY,
      ghostRoot: root, ghost, line, lineList: null, lit: null,
      reordering: false, to: p.index, hit: null, slot: null, raf: 0,
    };
    opts.onStart?.(p.index);
    update();
    drag.raf = requestAnimationFrame(autoScroll);
  };

  const onMove = (e: PointerEvent) => {
    if (drag) {
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      update();
      e.preventDefault(); // no text selection while dragging
    } else if (pending && Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY) > DRAG_THRESHOLD) {
      begin();
    }
  };
  const onUp = () => end(true);
  const onCancel = () => end(false);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !drag) return;
    e.preventDefault();
    e.stopPropagation(); // the Escape ends the drag, not a card's search or menu
    end(false);
  };

  const listen = () => {
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    document.addEventListener("keydown", onKey, true);
  };
  const unlisten = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onCancel);
    document.removeEventListener("keydown", onKey, true);
  };

  function end(commit: boolean) {
    unlisten();
    pending = null;
    if (!drag) return; // never crossed the threshold → it was a click
    const d = drag;
    drag = null;
    cancelAnimationFrame(d.raf);
    endFrames();
    d.src.row.classList.remove("is-drag-source");
    d.ghostRoot.remove();
    placeLine(d, null);
    light(d, null);
    d.src.list?.classList.remove("is-reordering");
    document.documentElement.classList.remove("is-row-dragging", "is-drag-nodrop");
    suppressClick = true; // swallow the click that trails this pointerup
    swallowClick = true;
    active = false;
    endSubs.forEach((cb) => cb());
    if (d.reordering) {
      opts.onEnd?.(d.src.index, commit && d.to !== d.src.index ? d.to : null);
      return;
    }
    opts.onEnd?.(d.src.index, null);
    if (commit && d.hit?.drop && d.src.payload) d.hit.drop(d.hit.slots ? d.slot : null);
  }

  const onDown = (e: PointerEvent) => {
    suppressClick = false;
    if (e.button !== 0 || drag || active) return; // left button only, one drag at a time
    const hit = opts.rowAt(e.target as HTMLElement);
    if (!hit) return;
    pending = { ...hit, startX: e.clientX, startY: e.clientY };
    listen();
  };
  opts.root.addEventListener("pointerdown", onDown);

  return {
    active: () => drag != null,
    consumeClick() {
      const s = suppressClick;
      suppressClick = false;
      return s;
    },
    destroy() {
      // destroyed mid-drag: the ghost and the document listeners would outlive the card
      if (drag) end(false);
      unlisten();
      opts.root.removeEventListener("pointerdown", onDown);
    },
  };
}
