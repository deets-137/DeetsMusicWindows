// Multi-select over rows — one store, three cards (NEXT-VERSION §19, 2026-09-15).
//
// Ctrl+click adds or removes a row. Shift+click takes the run from the last row you
// touched to this one. A plain click still plays, and drops the picks. What you have
// picked can then be dragged as ONE payload, or right-clicked to act on all of it —
// including Add to Playlist ▸ New Playlist…, which is how a playlist gets built from a
// hand-picked set.
//
// The picks are held as IDENTITIES, not row positions (the user's call, 2026-09-15):
// a sort, a filter, a search, a background sync or a queue advance keeps what you
// picked. Positions are read only to work out a shift+click run, and only against the
// list as it stands at that moment.
//
// Mini never picks (the user's call): mini shows one narrow card, so there is no second
// card to drop a selection into.
//
// Users: the collection engine (collection-card.ts → the Library and Playlists cards),
// the Queue card's Up Next (qcard.ts) and the History card (history-card.ts). The mark
// is the `data-picked` attribute on the row's root element; styles.css draws it.

import { currentSurface } from "./surface";

/** Object identity for hosts whose items carry no id of their own (queue entries: the
 *  same song can sit in the queue twice, so the SONG is not the row). */
const auto = new WeakMap<object, string>();
let autoN = 0;
export const objectId = (x: unknown): string => {
  if (x === null || typeof x !== "object") return String(x);
  let s = auto.get(x as object);
  if (!s) {
    s = `#${++autoN}`;
    auto.set(x as object, s);
  }
  return s;
};

export interface PickHost<T> {
  /** Stable identity for an item. Omit to key by object identity. */
  id?: (x: T) => string;
  /** The list in view order — read only for a shift+click run. */
  items: () => T[];
  /** Which items take a pick. A heterogeneous list (shelf headers among playlist rows)
   *  says no to the rest, so a shift run steps over them. Default: everything. */
  can?: (x: T) => boolean;
  /** The set changed: redraw the rows and the count row. */
  onChange: () => void;
}

export interface RowPick<T> {
  size(): number;
  isPicked(x: T): boolean;
  /** The picked items, in the list's current view order. */
  picked(): T[];
  /**
   * Handle a left click on `x`. Returns true when the click was a pick, so the caller
   * must NOT play the row. A plain click returns false — and clears any picks first.
   */
  click(e: MouseEvent, x: T): boolean;
  /** Take every row in the list as it stands (Ctrl+A). */
  all(): void;
  clear(): void;
  /** Mark rendered rows in the DOM. For a list that re-renders whole (Queue, History). */
  mark(root: ParentNode, sel: string, at: (el: HTMLElement) => T | undefined): void;
  /** Add the mark to a row's HTML. For a windowed list, whose rows are built on scroll. */
  markHTML(html: string, x: T, idx: number): string;
}

/** Picking is off in mini (one narrow slot, nothing to drop into). */
export const canPick = (): boolean => currentSurface() !== "mini";

export function rowPick<T>(host: PickHost<T>): RowPick<T> {
  const idOf = (x: T) => (host.id ? host.id(x) : objectId(x));
  const can = (x: T) => host.can?.(x) !== false;
  const set = new Set<string>();
  let anchor: string | null = null; // the last row touched, for a shift run

  const clear = () => {
    if (!set.size) return;
    set.clear();
    anchor = null;
    host.onChange();
  };

  return {
    size: () => set.size,
    isPicked: (x) => set.has(idOf(x)),
    picked: () => host.items().filter((x) => set.has(idOf(x))),
    click(e, x) {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!can(x)) return false; // not a pickable row (a shelf header)
      if (!canPick() || (!ctrl && !e.shiftKey)) {
        clear(); // a plain click plays the row, and drops what was picked
        return false;
      }
      e.preventDefault();
      const list = host.items();
      const id = idOf(x);
      if (e.shiftKey && anchor != null) {
        // The run between the anchor and this row, in the order now on screen. A
        // shift+click never removes: it only widens the block (Explorer's rule).
        const from = list.findIndex((y) => idOf(y) === anchor);
        const to = list.findIndex((y) => idOf(y) === id);
        if (from >= 0 && to >= 0) {
          const [a, b] = from <= to ? [from, to] : [to, from];
          for (let i = a; i <= b; i++) if (can(list[i])) set.add(idOf(list[i]));
        } else set.add(id); // the anchor has left the list — start again here
      } else {
        if (set.has(id)) set.delete(id);
        else set.add(id);
        anchor = id;
      }
      if (!set.size) anchor = null;
      host.onChange();
      return true;
    },
    all() {
      if (!canPick()) return;
      const list = host.items();
      if (!list.length) return;
      const take = list.filter(can);
      if (!take.length) return;
      take.forEach((x) => set.add(idOf(x)));
      anchor = idOf(take[take.length - 1]);
      host.onChange();
    },
    clear,
    mark(root, sel, at) {
      root.querySelectorAll<HTMLElement>(sel).forEach((el) => {
        const x = at(el);
        if (x !== undefined && set.has(idOf(x))) el.setAttribute("data-picked", "");
        else el.removeAttribute("data-picked");
      });
    },
    markHTML(html, x, idx) {
      if (!set.has(idOf(x))) return html;
      // The contract for a row's HTML is that its ROOT element carries data-idx, so the
      // first match is that element and nothing nested can be hit by mistake.
      return html.replace(`data-idx="${idx}"`, `data-idx="${idx}" data-picked`);
    },
  };
}

/** "12 songs" / "1 song" / "3 albums" — the count row's label. Tiles name their own kind. */
export const picksText = (n: number, noun = "song"): string => `${n} ${noun}${n === 1 ? "" : "s"}`;
