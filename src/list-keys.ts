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
  // Tab into the list: the focus goes to the first row, so the ring shows a row, not the box.
  // `focusin` bubbles, so a tab stop inside the container (a rebuilt rows box) is seen too.
  const onFocus = (e: FocusEvent): void => {
    if (!isStop(e.target)) return;
    const from = e.relatedTarget as Node | null;
    const stop = e.target as HTMLElement;
    if (from && stop.contains(from)) return; // a row lost its element in a re-render: stay
    const first = rows()[0];
    if (first) focusRow(first);
  };
  container.addEventListener("keydown", onKey);
  container.addEventListener("focusin", onFocus);
  return () => {
    container.removeEventListener("keydown", onKey);
    container.removeEventListener("focusin", onFocus);
    delete container.dataset.listKeys;
  };
}
