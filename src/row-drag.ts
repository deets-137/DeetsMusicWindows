// Row drag-to-reorder — one primitive for the Queue card's Up Next and a local playlist's
// detail (PLAYLISTS.md §10.1; moved out of qcard.ts).
//
// Whole-row press-and-drag: a quick click still acts; hold and move past DRAG_THRESHOLD px
// to drag. An insertion LINE shows where the row lands (no neighbour reflow, cheap for long
// lists). The pressed row follows the pointer 1:1 and the list auto-scrolls near its edges.
// Rows are uniform height and flush, so the drop index is row math on the list's scroll
// position — it holds when the list is windowed (collection-window.ts) and most rows don't
// exist. The caller suspends its re-renders between onStart and onEnd.

import * as frames from "./frames";

const DRAG_THRESHOLD = 6;
const EDGE = 28; // px from the list's top/bottom edge where auto-scroll starts
const STEP = 9; // px scrolled per frame

export interface DragRow {
  row: HTMLElement;
  /** The row's position in the list (its data-idx). */
  index: number;
  /** The scrolling element that holds the rows; the insertion line is placed in it. */
  list: HTMLElement;
  /** How many rows the list has in all (rendered or not). */
  count: number;
}

export interface RowDragOptions {
  /** Where pointerdown is heard (delegated, so it survives re-renders). */
  root: HTMLElement;
  /** The draggable row under a press, or null when a drag is not allowed there now. */
  rowAt: (target: HTMLElement) => DragRow | null;
  /** The drag crossed the threshold: suspend re-renders. */
  onStart?: (from: number) => void;
  /** The drag is over and the row styles are cleared. `to` is splice semantics (remove
   *  at `from`, insert at `to`); null for a cancel or a drop in place. */
  onEnd: (from: number, to: number | null) => void;
  /** The frame-telemetry label (frames.ts "drag"). */
  label: string;
}

export interface RowDrag {
  /** A drag is in progress (past the threshold). */
  active(): boolean;
  /** True once for the click that trails a drag's pointerup — the caller swallows it. */
  consumeClick(): boolean;
  destroy(): void;
}

export function rowDrag(opts: RowDragOptions): RowDrag {
  type Drag = DragRow & { line: HTMLElement; startY: number; lastY: number; startScroll: number; firstTop: number; rowH: number; to: number; raf: number };
  let drag: Drag | null = null;
  let pending: (DragRow & { startY: number }) | null = null;
  let suppressClick = false;
  let endFrames = () => {};

  // Pin the row under the pointer; compensate for auto-scroll (the row's slot scrolls, the
  // pointer doesn't). A windowed list can drop the row's element and render a new one when
  // it scrolls back — take that one over.
  const paintRow = () => {
    if (!drag) return;
    if (!drag.row.isConnected) {
      const again = drag.list.querySelector<HTMLElement>(`[data-idx="${drag.index}"]`);
      if (!again) return;
      again.classList.add("is-dragging");
      drag.row = again;
    }
    const ty = drag.lastY - drag.startY + (drag.list.scrollTop - drag.startScroll);
    drag.row.style.setProperty("--drag-dy", `${ty}px`);
  };

  const computeTarget = () => {
    if (!drag) return;
    const lr = drag.list.getBoundingClientRect();
    const contentY = drag.lastY - lr.top + drag.list.scrollTop;
    const ins = Math.max(0, Math.min(drag.count, Math.round((contentY - drag.firstTop) / drag.rowH)));
    drag.to = ins <= drag.index ? ins : ins - 1;
    // The line is an absolute child of the scrolling list, so it scrolls WITH the content:
    // plain content coordinates, no scrollTop term.
    drag.line.style.top = `${drag.firstTop + ins * drag.rowH}px`;
  };

  const autoScroll = () => {
    if (!drag) return;
    const r = drag.list.getBoundingClientRect();
    const dy = drag.lastY < r.top + EDGE ? -STEP : drag.lastY > r.bottom - EDGE ? STEP : 0;
    if (dy) {
      drag.list.scrollTop += dy;
      paintRow();
      computeTarget();
    }
    drag.raf = requestAnimationFrame(autoScroll);
  };

  const begin = () => {
    if (!pending) return;
    const p = pending;
    p.list.classList.add("is-reordering"); // positioned: the line's and offsetTop's reference
    const line = document.createElement("div");
    line.className = "drop-line";
    p.list.appendChild(line);
    p.row.classList.add("is-dragging");
    endFrames = frames.begin("drag", opts.label);
    // offsetTop ignores the hover lift (a transform); rows are flush, so row 0's top is
    // the pressed row's top less its index — row 0 need not be rendered.
    const rowH = p.row.offsetHeight || 1;
    drag = { ...p, line, lastY: p.startY, startScroll: p.list.scrollTop, firstTop: p.row.offsetTop - p.index * rowH, rowH, to: p.index, raf: 0 };
    opts.onStart?.(p.index);
    computeTarget();
    drag.raf = requestAnimationFrame(autoScroll);
  };

  const onMove = (e: PointerEvent) => {
    if (drag) {
      drag.lastY = e.clientY;
      paintRow();
      computeTarget();
      e.preventDefault(); // no text selection while dragging
    } else if (pending && Math.abs(e.clientY - pending.startY) > DRAG_THRESHOLD) {
      begin();
    }
  };
  const onUp = () => end(true);
  const onCancel = () => end(false);

  const unlisten = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onCancel);
  };

  function end(commit: boolean) {
    unlisten();
    pending = null;
    if (!drag) return; // never crossed the threshold → it was a click
    const d = drag;
    drag = null;
    cancelAnimationFrame(d.raf);
    endFrames();
    d.row.classList.remove("is-dragging");
    d.row.style.removeProperty("--drag-dy");
    d.line.remove();
    d.list.classList.remove("is-reordering");
    suppressClick = true; // swallow the click that trails this pointerup
    opts.onEnd(d.index, commit && d.to !== d.index ? d.to : null);
  }

  const onDown = (e: PointerEvent) => {
    suppressClick = false;
    if (e.button !== 0 || drag) return; // left button only
    const hit = opts.rowAt(e.target as HTMLElement);
    if (!hit) return;
    pending = { ...hit, startY: e.clientY };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
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
      // destroyed mid-drag: the document listeners would outlive the card
      if (drag) cancelAnimationFrame(drag.raf);
      unlisten();
      opts.root.removeEventListener("pointerdown", onDown);
    },
  };
}
