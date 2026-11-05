// The now mark (docs/features/NOW-MARK.md): the playing song's mark in a song list. A chevron in
// the list the song plays from, sliding to the next song; a line in any other list that holds it.
//
// A mark is a child of the list's scroller, so it scrolls with the rows on the compositor and
// moves with a pane's slide. It sits in the row's left padding, because `.coll-viewport` clips the
// card's margin. It is placed by row, not put in a row: above 200 rows the playing row may not
// exist. The outer element holds the place (a transform); the glyph holds the fades and the
// reveal wave, so neither ever touches the other's property.

import { getCurrent, onQueueChange, type QueueEntry } from "./queue";
import { markMove, planMarks, type MarkShape, type MarkSpot } from "./now-mark-rules";
import { tokenMs } from "./boot-cover";
import { motionReduced } from "./motion";
import { mark } from "./marks";

const CHEVRON =
  '<svg class="now-mark__glyph" viewBox="0 0 6 12" aria-hidden="true"><path d="M1 1.5 5 6 1 10.5z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg>';
const LINE = '<span class="now-mark__glyph"></span>';

interface Mark extends MarkSpot {
  el: HTMLElement;
  y: number;
  slide?: Animation;
}

interface ViewMarks {
  marks: Mark[];
  place: (row: number) => number | null;
  /** Paint this list again from its own data. */
  again: () => void;
  watch: ResizeObserver;
  winWatch: MutationObserver;
  watched: Element[];
  last: number | null;
}

const views = new WeakMap<HTMLElement, ViewMarks>();
/** The row a press just played: it says which copy of a song listed twice. */
const pressed = new WeakMap<HTMLElement, number>();

const songKey = (e: QueueEntry | null): string => (e ? `${e.catalogId ?? ""}|${e.libraryId ?? ""}|${e.context ?? ""}|${e.origin}` : "");

/** A press on this row is about to play it. */
export const noteRow = (view: HTMLElement, row: number): void => void pressed.set(view, row);

/** Fires when the current song or its source changes, not on an edit of Up Next. */
export function onNowSong(cb: () => void): () => void {
  let was = songKey(getCurrent());
  return onQueueChange(() => {
    const now = songKey(getCurrent());
    if (now === was) return;
    was = now;
    cb();
  });
}

const at = (y: number): string => `translate3d(0, ${y}px, 0)`;
const token = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function put(m: Mark, y: number): void {
  m.slide?.cancel();
  m.slide = undefined;
  m.y = y;
  m.el.style.transform = at(y);
}

function make(view: HTMLElement, spot: MarkSpot, y: number): Mark {
  const el = document.createElement("span");
  el.className = `now-mark now-mark--${spot.shape}`;
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("data-patch-keep", ""); // a redraw of the list leaves it, and its motion, alone
  el.innerHTML = spot.shape === "chevron" ? CHEVRON : LINE;
  el.style.transform = at(y);
  view.appendChild(el);
  return { ...spot, el, y };
}

const glyph = (m: Mark): Element => m.el.firstElementChild!;

function fadeIn(m: Mark): void {
  if (motionReduced()) return;
  glyph(m).animate([{ opacity: 0 }, { opacity: 1 }], { duration: tokenMs("--now-mark-fade"), easing: token("--now-mark-ease") });
}

function fadeOut(m: Mark): void {
  if (motionReduced()) return m.el.remove();
  // It fades where it is now: a slide cut short must not jump to its target first.
  if (m.slide) put(m, new DOMMatrixReadOnly(getComputedStyle(m.el).transform).m42);
  const a = glyph(m).animate([{ opacity: 1 }, { opacity: 0 }], { duration: tokenMs("--now-mark-fade"), easing: token("--now-mark-ease"), fill: "forwards" });
  const gone = () => m.el.remove();
  a.onfinish = gone;
  a.oncancel = gone;
}

function slide(m: Mark, y: number): void {
  // From where it is now: a press during a slide turns it, it never jumps.
  const from = m.slide ? new DOMMatrixReadOnly(getComputedStyle(m.el).transform).m42 : m.y;
  put(m, y);
  if (motionReduced()) return;
  m.slide = m.el.animate([{ transform: at(from) }, { transform: at(y) }], { duration: tokenMs("--now-mark-slide"), easing: token("--now-mark-ease") });
  m.slide.onfinish = () => (m.slide = undefined);
}

/** The rows above and the head moved: every mark goes to its row's new place, with no motion. */
function settle(s: ViewMarks): void {
  for (const m of s.marks) {
    const y = s.place(m.row);
    if (y != null && Math.abs(y - m.y) > 0.5) put(m, y);
  }
}

function stateOf(view: HTMLElement, list: MarkList): ViewMarks {
  let s = views.get(view);
  if (!s) {
    // A pane is drawn before it is in the page, so its rows have no place yet. The list getting
    // its size says they do. The windower's next frame may measure again, so look again after it.
    const look = () => {
      made.again();
      requestAnimationFrame(() => made.again());
    };
    const made: ViewMarks = { marks: [], place: list.place, again: list.again, last: null, watched: [], watch: new ResizeObserver(look), winWatch: new MutationObserver(look) };
    made.winWatch.observe(view, { attributes: true, attributeFilter: ["data-win"] }); // the windower measured
    s = made;
    views.set(view, s);
  }
  s.place = list.place;
  s.again = list.again;
  return s;
}

/** Watch the list and what sits above its rows: a hero that grows (a notes box, a wrap) moves
 *  every row. Only a changed set is observed again: a new observe fires at once. */
function watchHead(view: HTMLElement, s: ViewMarks): void {
  const now: Element[] = [view];
  for (let el = view.firstElementChild; el && !el.matches("[data-idx], .lib-spacer, .now-mark"); el = el.nextElementSibling) now.push(el);
  if (now.length === s.watched.length && now.every((el, i) => el === s.watched[i])) return;
  s.watch.disconnect();
  now.forEach((el) => s.watch.observe(el));
  s.watched = now;
}

export interface MarkList {
  /** The rows that hold the current song. */
  hits: number[];
  /** The song plays from this list. */
  source: boolean;
  /** The center of a row in the scroller's own coordinates; null when it cannot be known yet. */
  place: (row: number) => number | null;
  /** Paint this list again, with no motion: its rows may have a place now. */
  again: () => void;
}

/** Bring a list's marks to `list`. `move`: the song changed, so the marks travel. `still`: the
 *  list was drawn or sorted, so they go straight to their rows. */
export function syncMarks(view: HTMLElement, list: MarkList, how: "move" | "still"): void {
  if (!list.hits.length && !views.has(view)) return;
  view.dataset.nowMark = "";
  const s = stateOf(view, list);
  s.marks = s.marks.filter((m) => m.el.parentElement === view); // the windower's first mount empties the view
  const plan = planMarks(list.hits, list.source, pressed.get(view) ?? s.last);
  pressed.delete(view);
  const placed = plan.map((p) => ({ ...p, y: list.place(p.row) })).filter((p): p is MarkSpot & { y: number } => p.y != null);
  const kind = markMove(s.marks, placed, Number(token("--now-mark-reach")) || 0);
  if (plan[0]?.shape === "chevron") s.last = plan[0].row;

  if (kind === "none" || how === "still") {
    if (kind !== "none") {
      s.marks.forEach((m) => m.el.remove());
      s.marks = placed.map((p) => make(view, p, p.y));
    } else settle(s);
  } else if (kind === "slide") {
    const m = s.marks[0];
    m.row = placed[0].row;
    slide(m, placed[0].y);
  } else {
    // A mark that keeps its row and shape stays as it is; the rest fade.
    const kept = s.marks.filter((m) => placed.some((p) => p.row === m.row && p.shape === m.shape));
    s.marks.filter((m) => !kept.includes(m)).forEach(fadeOut);
    const fresh = placed.filter((p) => !kept.some((m) => m.row === p.row && m.shape === p.shape)).map((p) => make(view, p, p.y));
    fresh.forEach(fadeIn);
    s.marks = [...kept, ...fresh].sort((a, b) => a.row - b.row);
  }
  if (kind !== "none") mark("now:move", `${how} ${kind} ${placed.map((p) => `${p.shape}@${p.row}`).join(",")}`);
  watchHead(view, s);
}

/** The list shows no marks at all (tiles, or no song list). */
export function clearMarks(view: HTMLElement): void {
  const s = views.get(view);
  if (!s) return;
  s.watch.disconnect();
  s.winWatch.disconnect();
  s.marks.forEach((m) => m.el.remove());
  views.delete(view);
  delete view.dataset.nowMark;
}

export type { MarkShape };
