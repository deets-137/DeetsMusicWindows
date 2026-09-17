// Collection windower — renders only the rows near the viewport of a long collection
// pane (LIBRARY-VIRTUALIZATION.md, option A). The engine (collection-card.ts) hands a
// pane's view here when its item list is above WINDOW_MIN; smaller panes keep the plain
// full render.
//
// Shape of the view while windowed:
//   [hero?] [top spacer] item… item [bottom spacer]
// The spacers hold the scroll height at the full list's size so the scrollbar is true.
// The rendered slice always starts and ends on a whole grid ROW (start = row * cols), so
// CSS Grid's auto-placement lines up under the spacer. Geometry is MEASURED from the page
// after a mount (item pitch, column count, hero height) — never derived from tokens — so
// a skin switch or a column-count change is picked up on the next pass.
//
// A pass never re-creates a visible node: rows that left the range are removed, the
// missing edge is inserted as one HTML string (edge patch). Hover, the right-click
// highlight and loaded covers survive; an <img> is never reused for another item.
//
// Every finder searches the model and calls reveal(index) — nothing queries rows by text.

import * as frames from "./frames";

/** Panes with more items than this are windowed (a `mixed` grouping never is). */
export const WINDOW_MIN = 200;

export interface WindowSpec {
  count: number;
  /** HTML for item i — the root element carries data-idx="i" (the engine's contract). */
  render: (i: number) => string;
  /** HTML mounted once above the top spacer (the detail hero), or "". */
  hero: string;
}

export interface Windower {
  /** New items (a sort, a search, a sync): rebuild the slice; scrollTop is kept (clamped). */
  update(spec: WindowSpec): void;
  /** Make item `index` exist, then scroll it into view. */
  reveal(index: number, block: "center" | "nearest" | "start"): void;
  /** Set scrollTop (a saved place) and window around it. */
  scrollTo(top: number): void;
  /** The first visible item's index — the place to keep across a rebuild. */
  anchorIndex(): number;
  destroy(): void;
}

const SPACER = "lib-spacer";
/** Rendered beyond each edge of the viewport: one viewport, but never less than this
 *  many pixels (the midi window is ~400 px tall; a flick outruns a one-viewport buffer).
 *  In pixels, not rows, so a grid of 150 px rows buffers ~8 rows and a 49 px list ~25. */
const MIN_BUFFER_PX = 1200;
/** Log a pass to the frame telemetry only when it cost this much (ms). */
const LOG_PASS_MS = 4;
/** Rows beyond the viewport that must exist in the same frame as a scroll. */
const URGENT_ROWS = 2;
/** The buffer fills this long after the last scroll frame that left it short. */
const FILL_PAUSE_MS = 80;

export function windowView(view: HTMLElement, spec: WindowSpec): Windower {
  let count = spec.count;
  let render = spec.render;
  let hero = spec.hero;

  // rendered item range [a, b) — b exclusive; a and b are row-aligned
  let a = 0;
  let b = 0;
  // measured geometry (0 = unknown → the next pass measures)
  let pitch = 0; // row height incl. the grid's row gap (or the list row's height)
  let gap = 0;
  let cols = 1;
  let heroH = 0;
  let rows = 0;
  // the place, as a row + fraction, so a geometry change can restore it
  let anchorRow = 0;
  let anchorFrac = 0;
  // While the scroll is still inside the head block (hero, Play / Shuffle, shelves), the
  // place to keep is that offset in px, NOT a row: a row anchor reads as "row 0" and the
  // restore below then scrolls the whole head away (seen on a skin switch, 2026-09-15).
  let anchorHead: number | null = 0;

  let top: HTMLElement;
  let bot: HTMLElement;
  let dead = false;

  const isGrid = () => view.classList.contains("lib-grid");
  const rowOf = (i: number) => Math.floor(i / cols);

  const mountShell = () => {
    view.classList.add("lib-view--windowed");
    view.innerHTML = `${hero}<div class="${SPACER}" data-spacer="top"></div><div class="${SPACER}" data-spacer="bot"></div>`;
    top = view.querySelector<HTMLElement>('[data-spacer="top"]')!;
    bot = view.querySelector<HTMLElement>('[data-spacer="bot"]')!;
    a = b = 0;
    pitch = 0;
  };

  const html = (from: number, to: number) => {
    let s = "";
    for (let i = from; i < to; i++) s += render(i);
    return s;
  };

  /** Read the geometry from the rendered slice. Needs ≥1 item in the DOM. */
  const measure = (): boolean => {
    const first = top.nextElementSibling as HTMLElement | null;
    if (!first || first === bot) return false;
    const vr = view.getBoundingClientRect();
    if (isGrid()) {
      const cs = getComputedStyle(view);
      cols = Math.max(1, cs.gridTemplateColumns.split(" ").length);
      gap = parseFloat(cs.rowGap) || 0;
    } else {
      cols = 1;
      gap = 0;
    }
    const fr = first.getBoundingClientRect();
    // the hero's extent (incl. margins and the grid gap after it) is the first item's
    // offset when the slice starts at 0 — which every rebuild's seed slice does. (The
    // top spacer can't be measured: it is display:none at 0 so a grid adds no gap for it.)
    if (a === 0) heroH = fr.top - vr.top + view.scrollTop;
    // the pitch is the distance to the next ROW when one is rendered (exact), else the
    // item's own height plus the gap
    let p = fr.height + gap;
    const next = view.querySelector<HTMLElement>(`[data-idx="${a + cols}"]`);
    if (next && a + cols < b) {
      const d = next.getBoundingClientRect().top - fr.top;
      if (d > 0) p = d;
    }
    if (p <= 0) return false;
    pitch = p;
    rows = Math.ceil(count / cols);
    view.dataset.win = `${cols}x${Math.round(pitch)}+${Math.round(heroH)}`; // debug readout (cols × pitch + hero)
    return true;
  };

  const setSpacers = () => {
    const above = rowOf(a);
    const below = rows - rowOf(b); // b is row-aligned (or == count)
    const h = (n: number) => Math.max(0, n * pitch - gap);
    top.style.display = above > 0 ? "" : "none";
    top.style.height = `${h(above)}px`;
    bot.style.display = below > 0 ? "" : "none";
    bot.style.height = `${h(below)}px`;
  };

  /** Edge-patch the slice to [a2, b2). */
  const patch = (a2: number, b2: number) => {
    a2 = Math.max(0, Math.min(a2, count));
    b2 = Math.max(a2, Math.min(b2, count));
    if (a2 === a && b2 === b) return;
    const t0 = performance.now();
    if (b2 <= a || a2 >= b || a === b) {
      // disjoint (a big jump) → replace the slice outright
      for (let el = top.nextElementSibling; el && el !== bot; ) {
        const n = el.nextElementSibling;
        el.remove();
        el = n;
      }
      top.insertAdjacentHTML("afterend", html(a2, b2));
    } else {
      for (let el = top.nextElementSibling as HTMLElement | null; el && el !== bot; ) {
        const n = el.nextElementSibling as HTMLElement | null;
        const i = Number(el.dataset.idx);
        if (i < a2 || i >= b2) el.remove();
        el = n;
      }
      if (a2 < a) top.insertAdjacentHTML("afterend", html(a2, a));
      if (b2 > b) bot.insertAdjacentHTML("beforebegin", html(b, b2));
    }
    a = a2;
    b = b2;
    if (pitch) setSpacers(); // geometry unknown (a seed slice) → the pass sizes them after measure()
    const ms = performance.now() - t0;
    if (ms >= LOG_PASS_MS) frames.during("window", ms, `${a}-${b}`);
  };

  /**
   * The pass. `force` re-measures (a rebuild, a geometry event, a reveal) and renders the
   * full buffer at once. A plain scroll frame measures nothing (no forced layout) and
   * renders only what the frame needs: the visible rows plus a small margin exist NOW,
   * and the wide buffer is filled once the scroll pauses (a fast flick would otherwise
   * render ~60 rows a frame just to discard them on the next).
   */
  /** Seed, measure and size the spacers — the full scroll height exists after this, so a
   *  programmatic scrollTop is not clamped by a short, freshly built pane. */
  const prime = (): boolean => {
    // a seed slice so measure() has two rows to read (cols is unknown before it runs)
    if (a === b) patch(0, Math.min(count, 2 * Math.max(cols, 8)));
    const wasPitch = pitch;
    const wasCols = cols;
    const wasHeroH = heroH;
    if (!measure()) return false;
    setSpacers();
    if (wasPitch && (wasPitch !== pitch || wasCols !== cols || wasHeroH !== heroH)) {
      // geometry changed under a fixed scrollTop (skin switch, column count) → restore
      // the remembered place, then re-align the slice to the new rows
      if (anchorHead !== null) {
        // inside the head: keep the same px offset into it (0 stays 0), clamped to its
        // new height, so a taller or shorter head never pushes it off the top
        view.scrollTop = Math.max(0, Math.min(anchorHead, heroH));
      } else {
        const idx = anchorRow * wasCols;
        view.scrollTop = heroH + rowOf(idx) * pitch + anchorFrac * pitch;
      }
    }
    return true;
  };

  const pass = (force = false, fill = false) => {
    if (dead || !count) return;
    if ((force || !pitch) && !prime()) return;
    const st = view.scrollTop;
    const vh = view.clientHeight || 1;
    const firstRow = Math.max(0, Math.floor((st - heroH) / pitch));
    const viewRows = Math.ceil(vh / pitch) + 1;
    const bufRows = Math.max(viewRows, Math.ceil(MIN_BUFFER_PX / pitch));
    anchorRow = firstRow;
    anchorFrac = Math.max(0, Math.min(1, (st - heroH - firstRow * pitch) / pitch));
    anchorHead = st < heroH ? st : null; // in the head, or on a row
    const lastRow = Math.min(rows, firstRow + viewRows);

    const clampB = (r: number) => Math.min(count, r * cols);
    const uA = Math.max(0, firstRow - URGENT_ROWS) * cols; // must exist this frame
    const uB = clampB(lastRow + URGENT_ROWS);
    const wA = Math.max(0, firstRow - bufRows) * cols; // the buffered window
    const wB = clampB(lastRow + bufRows);
    const covers = (x: number, y: number) => a <= x && b >= y;

    if (force || fill) {
      patch(wA, wB);
      return;
    }
    if (!covers(uA, uB)) {
      // the visible rows are missing: render them now — keep an overlapping slice (it is
      // contiguous), replace a disjoint one outright — then fill the buffer at the pause
      const overlap = b > uA && a < uB;
      patch(overlap ? Math.min(a, uA) : uA, overlap ? Math.max(b, uB) : uB);
      scheduleFill();
      return;
    }
    // visible rows exist; extend to the full buffer at the pause when an edge is near
    const slack = Math.ceil(bufRows / 2) * cols;
    if (a > Math.max(0, wA + slack) || b < Math.min(count, wB - slack)) scheduleFill();
  };

  let fillTimer = 0;
  const scheduleFill = () => {
    clearTimeout(fillTimer);
    fillTimer = window.setTimeout(() => {
      fillTimer = 0;
      pass(false, true);
    }, FILL_PAUSE_MS);
  };

  // scroll events are one per frame and fire before paint, so patching here lands in the
  // same frame — no rAF hop (a big jump, e.g. End, never shows a blank frame)
  const onScroll = () => pass();
  view.addEventListener("scroll", onScroll, { passive: true });

  // width changes (surface flips, column count) and skin/theme switches change the
  // geometry without a scroll — re-measure on the next frame
  let queued = 0;
  const later = () => {
    if (queued) return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      pass(true);
    });
  };
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(later) : null;
  ro?.observe(view);
  const mo = new MutationObserver(later);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-skin", "data-theme", "data-surface", "data-mini"] });

  mountShell();
  pass(true);

  return {
    update(s) {
      // The same hero HTML keeps its nodes (the engine's head block: live pills, a focused
      // search field, loaded covers); a changed one is replaced below.
      const keepHero = !!s.hero && s.hero === hero;
      count = s.count;
      render = s.render;
      hero = s.hero;
      // The engine resets className per render — put the windowed class (overflow-anchor:
      // none) back BEFORE any mutation: a layout forced below with anchoring on would let
      // Chromium move scrollTop to follow a row that just left (seen: +2.7k px, pop closed).
      view.classList.add("lib-view--windowed");
      // Fold the whole current height into the bottom spacer FIRST (read before anything
      // is removed — a shrunken height would clamp scrollTop at the list's end), so the
      // scroll height and scrollTop hold through the rebuild and no scroll event fires
      // (one would dismiss an open Sort/View pop mid-tweak; the full render never fired
      // one either). The seed slice then sits right under the hero, whose extent is the
      // first item's offset. The pass re-sizes both spacers after it measures.
      bot.style.display = "";
      bot.style.height = `${view.scrollHeight}px`;
      top.style.display = "none";
      top.style.height = "0px";
      if (!keepHero) {
        for (let el = view.firstElementChild; el && el !== top; ) {
          const n = el.nextElementSibling;
          el.remove();
          el = n;
        }
      }
      for (let el = top.nextElementSibling; el && el !== bot; ) {
        const n = el.nextElementSibling;
        el.remove();
        el = n;
      }
      if (hero && !keepHero) top.insertAdjacentHTML("beforebegin", hero);
      a = b = 0;
      pitch = 0;
      pass(true);
    },
    reveal(index, block) {
      if (index < 0 || index >= count) return;
      if (!prime()) return;
      const row = rowOf(index);
      const vh = view.clientHeight || 1;
      let t = heroH + row * pitch;
      if (block === "center") t -= (vh - pitch) / 2;
      view.scrollTop = Math.max(0, t);
      pass(true); // the element exists now
      view.querySelector(`[data-idx="${index}"]`)?.scrollIntoView({ block });
    },
    scrollTo(t) {
      if (!prime()) return;
      view.scrollTop = t;
      pass(true);
    },
    anchorIndex: () => Math.min(count - 1, Math.max(0, anchorRow * cols)),
    destroy() {
      dead = true;
      view.removeEventListener("scroll", onScroll);
      ro?.disconnect();
      mo.disconnect();
      if (queued) cancelAnimationFrame(queued);
      clearTimeout(fillTimer);
      view.classList.remove("lib-view--windowed");
    },
  };
}
