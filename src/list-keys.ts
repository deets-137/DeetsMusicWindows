// List keys (COMPASS.md §5) — the keyboard inside a list of rows or tiles: the Library and
// every collection card, the Queue, History, Home, the Search card. One helper, adopted by
// each card with its own row selector; the card's own click and right-click handlers do the
// work, so a key does exactly what the pointer does.
//
//   Tab            reaches the list (the container is a tab stop); the first row takes the focus
//   ↓ ↑ ← →        move between rows; in a grid of tiles ↓ ↑ move by a row of tiles
//   Home End       the first and the last row (a windowed list reveals them first)
//   PageDown/Up    ten rows
//   Enter Space    what a click does (a real button inside a row keeps its own keys)
//   Menu, Shift+F10  what a right-click does, at the row
//   Escape         back one step (the card's Back button), when there is one
//
// Rows carry `tabindex="-1"` only once they take the focus, so a re-render costs nothing and
// the tab order stays one stop per list. The focus ring is the theme's (styles.css §List keys).

export interface ListKeysOptions {
  /** The rows, as a selector inside `container` (or inside `within()` when given). */
  rows: string;
  /** The live pane the rows are read from (a drilling card's top pane); default: the container. */
  within?: () => HTMLElement | null;
  /** The element that is the list's tab stop, as a selector, when it is not the container: a
   *  rows box that comes AFTER a hero and its buttons in the DOM (the collection card's
   *  `[data-view]`, which the card marks `tabindex="0"` itself, since it rebuilds it). The
   *  container then gets no tabindex. */
  tabStop?: string;
  /** Enter / Space click the row. Off for a card whose rows handle those keys themselves. */
  activate?: boolean;
  /** Back one step. Return true when a step was taken (Escape is then consumed). */
  back?: () => boolean;
  /** A windowed list: make the row at `index` exist and return it (the Library). */
  revealIndex?: (index: number) => HTMLElement | null;
  /** A windowed list: how many rows there are (for End). */
  count?: () => number;
}

const KEYS = new Set(["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "PageDown", "PageUp", "Enter", " ", "ContextMenu", "F10", "Escape"]);

export function wireListKeys(container: HTMLElement, o: ListKeysOptions): () => void {
  const activate = o.activate ?? true;
  container.dataset.listKeys = "";
  if (!o.tabStop && !container.hasAttribute("tabindex")) container.tabIndex = 0;
  const isStop = (el: EventTarget | null): boolean =>
    el instanceof HTMLElement && (o.tabStop ? el.matches(o.tabStop) && scope().contains(el) : el === container);

  const scope = (): HTMLElement => o.within?.() ?? container;
  const rows = (): HTMLElement[] => Array.from(scope().querySelectorAll<HTMLElement>(o.rows));
  const focusRow = (el: HTMLElement | null | undefined): void => {
    if (!el) return;
    el.tabIndex = -1;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest" });
  };
  /** Tiles in a grid: how many share the first row's top. 1 for a list. */
  const columns = (list: HTMLElement[]): number => {
    if (list.length < 2) return 1;
    const top = list[0].offsetTop;
    let n = 0;
    for (const el of list) {
      if (el.offsetTop !== top) break;
      n++;
    }
    return Math.max(1, n);
  };
  const indexOf = (el: HTMLElement): number | null => {
    const v = el.dataset.idx;
    return v === undefined ? null : Number(v);
  };
  /** The row `step` rows on from `row`; a windowed list reveals it. */
  const step = (row: HTMLElement, step: number): HTMLElement | null => {
    const list = rows();
    const at = list.indexOf(row);
    const next = at + step;
    if (next >= 0 && next < list.length) return list[next];
    const i = indexOf(row);
    if (i !== null && o.revealIndex) return o.revealIndex(Math.max(0, i + step));
    return list[Math.max(0, Math.min(list.length - 1, next))] ?? null;
  };

  const onKey = (e: KeyboardEvent): void => {
    if (!KEYS.has(e.key) || e.altKey || e.metaKey || e.ctrlKey) return;
    if (e.key === "F10" && !e.shiftKey) return;
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, [contenteditable]")) return;
    const row = t.closest<HTMLElement>(o.rows);
    if (row && !scope().contains(row)) return;
    // Inside a row, a real control keeps its own keys (the Add square, a pill).
    const inControl = !!t.closest("button, a, [role='slider'], [role='switch']") && t !== row;

    if (e.key === "Escape") {
      if (o.back?.()) e.preventDefault();
      return;
    }
    if (!row) {
      // The list's own box: the first key goes to the first row.
      if (!isStop(t) || !["ArrowDown", "ArrowRight", "Home", "ArrowUp", "ArrowLeft", "End"].includes(e.key)) return;
      const list = rows();
      if (!list.length) return; // no rows (Rulez › Logs): the key is the scroller's, not ours (desk test 2026-09-27)
      const last = e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "End";
      focusRow(last ? (o.count && o.revealIndex ? o.revealIndex(o.count() - 1) : list[list.length - 1]) : list[0]);
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case "ArrowDown": focusRow(step(row, columns(rows()))); break;
      case "ArrowUp": focusRow(step(row, -columns(rows()))); break;
      case "ArrowRight": focusRow(step(row, 1)); break;
      case "ArrowLeft": focusRow(step(row, -1)); break;
      case "PageDown": focusRow(step(row, 10)); break;
      case "PageUp": focusRow(step(row, -10)); break;
      case "Home": focusRow(o.revealIndex ? o.revealIndex(0) : rows()[0]); break;
      case "End": {
        const list = rows();
        focusRow(o.count && o.revealIndex ? o.revealIndex(o.count() - 1) : list[list.length - 1]);
        break;
      }
      case "Enter":
      case " ":
        if (!activate || inControl) return;
        row.click();
        break;
      case "ContextMenu":
      case "F10": {
        const r = row.getBoundingClientRect();
        row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + Math.min(r.width / 2, 24), clientY: r.top + r.height / 2 }));
        break;
      }
      default: return;
    }
    e.preventDefault();
  };
  // A press, not a Tab (2026-09-17). A row carries no tabindex until it takes the focus, so
  // Chromium sends the focus of ANY press inside the list — a right-click, a Ctrl+click — to
  // the list's own box, which is the tab stop. Moving to the first row there scrolled a
  // scrolled-down list back to the top on every right-click. The flag holds for the press's
  // own task only; the focus lands in it.
  let byPointer = false;
  const onDown = (): void => {
    byPointer = true;
    setTimeout(() => {
      byPointer = false;
    }, 0);
  };

  // Tab into the list: the focus goes to the first row, so the ring shows a row, not the box.
  // `focusin` bubbles, so a tab stop inside the container (a rebuilt rows box) is seen too.
  const onFocus = (e: FocusEvent): void => {
    if (byPointer) return; // a press puts the focus where the pointer is, not on row one
    if (!isStop(e.target)) return;
    const from = e.relatedTarget as Node | null;
    const stop = e.target as HTMLElement;
    if (from && stop.contains(from)) return; // a row lost its element in a re-render: stay
    const first = rows()[0];
    if (first) focusRow(first);
  };
  // A redraw that removes the focused row dropped the focus to <body>, and the next key did
  // nothing (the desk test of 2026-09-27: Rulez open / fold, a Diary entry, Rewind after its
  // menu). A key inside the list arms a watch; when a redraw leaves the focus on <body>, the
  // ring goes back to the row (`pickRefocus`). Only after a key: a pointer press disarms it, so
  // a click that redraws a list never grows a ring where nothing was pressed.
  //
  // Not `focusout`: WebView2 (like Chromium) fires no focusout and no blur when it REMOVES the
  // focused element. The first fix listened for exactly that and never ran (desk test A1b,
  // 2026-09-27 night). A MutationObserver on the page sees every redraw, the card's own and a
  // context menu's that closes; it lives only while armed.
  let last: RowMark | null = null; // the row the keys were on
  let from: RowMark | null = null; // the row a key drilled away from (a Diary tile → its entry)
  let watch: MutationObserver | null = null;
  let checkRaf = 0;
  const disarm = (): void => {
    watch?.disconnect();
    watch = null;
    cancelAnimationFrame(checkRaf);
    checkRaf = 0;
  };
  const check = (): void => {
    checkRaf = 0;
    if (!container.isConnected || !last) return disarm();
    if (document.activeElement !== document.body) return; // the focus is somewhere real (a menu, a row)
    if (last.el.isConnected && scope().contains(last.el)) return focusRow(last.el); // a menu closed over it
    const list = rows();
    const at = pickRefocus(last, from, list.map((r) => r.dataset));
    if (at < 0) return;
    if (!list.some((r) => last && last.key && r.dataset[last.key] === last.value)) from = last; // it drilled
    focusRow(list[at]);
  };
  const arm = (): void => {
    if (watch) return;
    watch = new MutationObserver(() => {
      if (!checkRaf) checkRaf = requestAnimationFrame(check);
    });
    watch.observe(document.body, { childList: true, subtree: true });
  };
  const onAnyKey = (e: KeyboardEvent): void => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(o.rows);
    if (row) last = markRow(row, rows().indexOf(row));
    arm();
  };
  const onRowFocus = (e: FocusEvent): void => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(o.rows);
    if (row) last = markRow(row, rows().indexOf(row));
  };
  // The focus or the keys went somewhere else (another list, a field): stop watching, or this
  // list would take the ring back when THAT list redraws. A context menu the keys opened keeps
  // the watch, so its Escape brings the ring back to the row. The key counts as well as the
  // focus: a window without the system focus sends no focusin (desk test A1b: Rulez took the
  // ring from a Diary Enter, 2026-09-27 night).
  const onElsewhere = (e: Event): void => {
    const t = e.target as HTMLElement;
    if (!watch || container.contains(t) || t.closest?.(".ctx-menu")) return;
    disarm();
  };
  container.addEventListener("keydown", onKey);
  container.addEventListener("keydown", onAnyKey, true);
  container.addEventListener("focusin", onFocus);
  container.addEventListener("focusin", onRowFocus);
  container.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointerdown", disarm, true);
  document.addEventListener("focusin", onElsewhere, true);
  document.addEventListener("keydown", onElsewhere, true);
  return () => {
    disarm();
    container.removeEventListener("keydown", onKey);
    container.removeEventListener("keydown", onAnyKey, true);
    container.removeEventListener("focusin", onFocus);
    container.removeEventListener("focusin", onRowFocus);
    container.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("pointerdown", disarm, true);
    document.removeEventListener("focusin", onElsewhere, true);
    document.removeEventListener("keydown", onElsewhere, true);
    delete container.dataset.listKeys;
  };
}

/** The keys the cards' rows carry, in the order a row is known by. */
const KEYS_OF_ROW = ["id", "idx", "entry", "songI", "pick"] as const;
type RowKey = (typeof KEYS_OF_ROW)[number];
export interface RowMark {
  el: HTMLElement;
  key: RowKey | null;
  value: string | undefined;
  index: number;
}
function markRow(el: HTMLElement, index: number): RowMark {
  const key = KEYS_OF_ROW.find((k) => el.dataset[k] !== undefined) ?? null;
  return { el, key, value: key ? el.dataset[key] : undefined, index };
}

/**
 * Which row takes the focus back after a redraw removed the focused one (a pure rule, tested in
 * tests/list-keys.test.ts). `list` is the new rows' datasets, in order. In turn:
 * 1. the row with the same key (Rulez: the rule that opened or folded);
 * 2. the row the keys drilled away from (Escape out of a Diary entry: its tile);
 * 3. a list of another kind (no row carries the old key's name — a tile became an entry's song
 *    rows): the first row;
 * 4. the same kind of list, the row gone: the row now at its place.
 * -1 when the list is empty.
 */
export function pickRefocus(
  last: Pick<RowMark, "key" | "value" | "index">,
  from: Pick<RowMark, "key" | "value"> | null,
  list: ReadonlyArray<Record<string, string | undefined>>,
): number {
  if (!list.length) return -1;
  const find = (m: Pick<RowMark, "key" | "value"> | null): number =>
    m?.key ? list.findIndex((d) => d[m.key!] === m.value) : -1;
  const same = find(last);
  if (same >= 0) return same;
  const back = find(from);
  if (back >= 0) return back;
  if (!last.key || !list.some((d) => d[last.key!] !== undefined)) return 0;
  return Math.max(0, Math.min(last.index, list.length - 1));
}
