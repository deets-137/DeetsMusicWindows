// Collection card — a navigable, context-aware browser shared by the Library and
// Playlists cards. The card shows a stack of "contexts" (Library → Artist → Album,
// or Playlists → Playlist). Each context declares its own groupings, each grouping
// its own sort keys + how to render and (optionally) drill into a child context.
//
// Navigation is a horizontal PUSH stack: drilling in slides the current pane out to
// the left while the child slides in from the right to fill the card; backing out
// reverses it. The card header (back chevron + title) is fixed chrome; only the
// body (toolbar + list) slides. The transition's feel is skin-tokened
// (--nav-dur / --nav-ease) and honours prefers-reduced-motion.
//
// Everything is client-side over data the card already holds in memory.

import * as frames from "./frames";
import { openContextMenu, openContextMenuUnder, type MenuItem } from "./context-menu";
import { windowView, WINDOW_MIN, type Windower } from "./collection-window";
import { rowDrag, registerDropTarget, isDragging, onDragEnd, type DragPayload } from "./row-drag";
import { rowPick, canPick, picksText, objectId } from "./row-pick";
import { shuffleInPlace } from "./queue";
import { isShuffleOn, setShuffleMode } from "./player";
import { setting } from "./settings-store";

export type Density = "lines" | "small" | "large";
export type SortDir = "asc" | "desc";

export interface SortSpec<T = any> {
  key: string;
  label: string;
  get: (x: T) => string | number | undefined; // undefined sinks to the bottom
  type: "str" | "num";
}

/** The frame state a `list()` accessor may shape itself around (e.g. Radio's shelf
 *  headers exist only in featured order — an A–Z sort flattens the list). */
export interface ViewState {
  sortKey: string;
  sortDir: SortDir;
  density: Density;
  query: string;
}

export interface Grouping<T = any> {
  key: string;
  label: string;
  sorts: SortSpec<T>[];
  // live accessor — recomputed each render so syncs flow through; the optional view
  // state lets a heterogeneous list restructure per sort/density (most cards ignore it)
  list: (view?: ViewState) => T[];
  name: (x: T) => string; // search tiebreak + (for details) the drilled title
  match: (x: T, q: string) => boolean;
  render: (x: T, density: Density, idx: number) => string; // root el must carry data-idx="${idx}"
  open?: (x: T) => Context | null; // drill target, or null for a leaf (e.g. a song)
  // Leaf action on click (e.g. play a song). Takes precedence over `open`, and gets the
  // current sorted view + index so it can act on "everything from here onward".
  activate?: (x: T, index: number, items: T[]) => void;
  /** The rows are songs: a Play / Shuffle row under the hero (NEXT-VERSION §13) runs
   *  `activate` on the first row of the current sort + filter (Shuffle: of a shuffled copy).
   *  An object carries the hover text for each button (what exactly the list is). */
  playAll?: boolean | ActionTitles;
  // Right-click actions for an item (Play Now / Play Next / Add to Queue …). Omit for
  // groupings with no menu (e.g. Artists for now). Gets the sorted view + index too.
  menu?: (x: T, index: number, items: T[]) => MenuItem[];
  /** The highlighted item (a drilled-in song). Lets the engine find its index and reveal
   *  it when the pane is windowed and the element may not exist yet. */
  isSelected?: (x: T) => boolean;
  /** Items of unequal height (shelf headers among rows): never windowed. */
  mixed?: boolean;
  /** Drag-to-reorder (row-drag.ts), offered only in lines density, in THIS sort ascending,
   *  with no search — a drop position means nothing in another order or a filtered list.
   *  `move` gets splice indexes (remove at `from`, insert at `to`) into that order. */
  reorder?: { sortKey: string; move: (from: number, to: number) => void };
  /** Drag source (DRAG-DROP.md §2): the songs a press-and-drag on this item carries, or null
   *  when it carries none (a shelf header). */
  drag?: (x: T, index: number, items: T[]) => DragPayload | null;
  /** Drop target on an item (a playlist row, §3): the drop's action, or null when this item
   *  doesn't take the payload. */
  dropOn?: (x: T, p: DragPayload) => (() => void) | null;
  /**
   * Multi-select (row-pick.ts, NEXT-VERSION §19). Present = these rows take Ctrl+click,
   * Shift+click and Ctrl+A. Song rows only for now (the user's call 2026-09-15).
   *  - `id`: stable identity, so a sort, a filter or a sync keeps the picks. Omit it
   *    where the same song can sit in the list twice (a playlist): then each ROW is its
   *    own pick, by object identity.
   *  - `menu`: the right-click menu for the whole picked set.
   *  - `drag`: one payload carrying every picked song.
   *  - `play`: run the count row's Play / Shuffle on the picked set.
   */
  pick?: {
    id?: (x: T) => string;
    menu: (xs: T[]) => MenuItem[];
    drag: (xs: T[]) => DragPayload;
    play: (xs: T[]) => void;
  };
}

/**
 * The detail hero (UI-ARCHITECTURE.md §Detail hero): a big cover, the bold title, an
 * optional subtitle (tappable when it carries `run` — an album's artist drills to the
 * artist) and a muted meta line ("2016 · 17 songs · 1 hr 2 min"). Rendered as the first
 * block INSIDE the scrolling view, so it scrolls away with the list. Built by a function
 * so async facts (a playlist's tracks landing) fill in on the next render.
 */
export interface Hero {
  cover: string; // HTML for the cover slot — heroCover() in library-card.ts
  title: string;
  sub?: { text: string; run?: () => void };
  meta?: string;
  /** Makes the cover a button that opens this menu (a local playlist: image, remove, export). */
  coverMenu?: () => MenuItem[];
  /** Makes the cover a file drop target (needs `coverMenu`, which renders the button). */
  coverDrop?: (file: File) => void;
}

export interface Context {
  title: string;
  /** What the card header shows while drilled ("Album", "Playlist") when a hero owns
   *  the title itself. Absent → the header shows `title`, as before. */
  headerLabel?: string;
  hero?: () => Hero;
  /** Shelves under the hero (ARTIST-VIEW.md §2.2): HTML drawn right after the hero, inside
   *  the block the windower measures. A function, so async facts fill in on `reload()`.
   *  Items carry `data-shelf-item`: a click goes to `onShelf`, a right-click to `shelfMenu`. */
  shelves?: () => string;
  onShelf?: (item: HTMLElement) => void;
  shelfMenu?: (item: HTMLElement) => MenuItem[];
  /** Draw the Sort / View / Search toolbar inside the scroll, under the hero and shelves,
   *  with this section label — for a context whose toolbar acts only on its rows (the Library
   *  artist view's Songs). Absent → the toolbar stays at the top of the pane. */
  toolbarBelow?: string;
  groupings: Grouping[]; // >= 1; >1 → View shows a grouping column
  density: boolean; // whether the density column applies
  /** An optional icon toggle between View and Search (Library: ♥ favorites only). The
   *  card owns the state and narrows its own lists; the engine draws the pill, flips
   *  it, and re-renders. */
  filter?: { label: string; icon: string; active: () => boolean; toggle: () => void };
  defaults?: { grouping?: string; density?: Density; sortKey?: string; sortDir?: SortDir };
  emptyText?: string; // shown when the (unfiltered) list is empty, e.g. a fresh playlist's invite
  /** The pane takes dropped songs (an open playlist, DRAG-DROP.md §3). The action gets the
   *  insertion index while the grouping's reorder order shows, else null (the end). Null
   *  when the pane doesn't take the payload. */
  dropInto?: (p: DragPayload) => ((at: number | null) => void) | null;
}

/** "1 hr 2 min" / "48 min" for a summed duration; "" below a minute or unknown. */
export function formatTotal(ms: number | undefined): string {
  if (!ms || ms < 60_000) return "";
  const min = Math.round(ms / 60_000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} hr${m ? ` ${m} min` : ""}` : `${m} min`;
}

/** Hover text for the Play / Shuffle row: say what the list is. */
export interface ActionTitles {
  play?: string;
  shuffle?: string;
}
const DEFAULT_TITLES: Required<ActionTitles> = { play: "Play these songs in this order", shuffle: "Shuffle these songs" };

/** The Play / Shuffle row (NEXT-VERSION §13): two half-width buttons, `data-act` = play | shuffle.
 *  Shared with the Search card's panes, which are not on this engine. */
export function actionsRowHTML(titles: ActionTitles = {}, disabled = false): string {
  const t = { ...DEFAULT_TITLES, ...titles };
  const off = disabled ? " disabled" : "";
  // A disabled button shows no tooltip, so the hint moves to the row while it waits for songs.
  const wait = disabled ? ` title="Add a song to play this list"` : "";
  return `<div class="lib-actions"${wait}>
    <button class="lib-action lib-action--play" data-act="play" type="button"${off} title="${esc(t.play)}">
      <svg class="lib-action__icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5v11l9-5.5z"/></svg><span>Play</span>
    </button>
    <button class="lib-action" data-act="shuffle" type="button"${off} title="${esc(t.shuffle)}">
      <svg class="lib-action__icon lib-action__icon--stroke" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h2.5l6 8H14M14 4h-3.5l-1.5 2M2 12h2.5l1.5-2"/><path d="M12 2l2 2-2 2M12 10l2 2-2 2"/></svg><span>Shuffle</span>
    </button>
  </div>`;
}
/** The count row (NEXT-VERSION §19): while rows are picked, the Play / Shuffle row makes
 *  room for how many. Same two buttons, same `data-act`, so one handler serves both. No
 *  Clear button — a click on any row (or Escape) already drops the picks.
 *  `enter` is set only on the FIRST pick, so the count slides in and the two buttons
 *  shrink to make room once, not on every pick after it. */
export function picksRowHTML(n: number, enter: boolean): string {
  return `<div class="lib-actions lib-actions--picked">
    <span class="lib-picked${enter ? " is-entering" : ""}"><span class="lib-picked__text">${picksText(n)}</span></span>
    <button class="lib-action lib-action--play" data-act="play" type="button" title="Play the songs you picked">
      <svg class="lib-action__icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5v11l9-5.5z"/></svg><span>Play</span>
    </button>
    <button class="lib-action" data-act="shuffle" type="button" title="Shuffle the songs you picked">
      <svg class="lib-action__icon lib-action__icon--stroke" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h2.5l6 8H14M14 4h-3.5l-1.5 2M2 12h2.5l1.5-2"/><path d="M12 2l2 2-2 2M12 10l2 2-2 2"/></svg><span>Shuffle</span>
    </button>
  </div>`;
}

/** The row for a song list (`Grouping.playAll`); "" for anything else. With no rows (a new
 *  playlist, an empty library, a filter that matches nothing) the row still draws, **disabled**:
 *  the pane keeps one shape, so the first song to arrive moves nothing on screen. */
function actionsHTML(g: Grouping, count: number, picked: number, enter: boolean): string {
  if (!g.playAll) return "";
  // Rows picked → the same slot carries the count, then Play and Shuffle (§19).
  if (picked) return picksRowHTML(picked, enter);
  return actionsRowHTML(g.playAll === true ? {} : g.playAll, count === 0);
}

/**
 * What a press on the row does: `run` gets the list to play from its first item — the
 * rows as they are for Play, a shuffled copy for Shuffle (and for Play while the shuffle
 * mode is on, as Apple does). With "Button is perma-shuffle", Shuffle turns the mode on.
 */
export function runListAction<T>(act: string, items: T[], run: (list: T[]) => void): void {
  if (!items.length) return;
  const shuffle = act === "shuffle";
  if (shuffle && setting("shuffleStays")) setShuffleMode(true);
  run(shuffle || isShuffleOn() ? shuffleInPlace(items.slice()) : items);
}

function heroHTML(h: Hero | undefined): string {
  if (!h) return "";
  const sub = h.sub
    ? h.sub.run
      ? `<button class="lib-hero__sub lib-hero__sub--link" type="button" data-hero-sub>${esc(h.sub.text)}<span class="lib-hero__chev" aria-hidden="true">›</span></button>`
      : `<span class="lib-hero__sub">${esc(h.sub.text)}</span>`
    : "";
  const meta = h.meta ? `<span class="lib-hero__meta">${esc(h.meta)}</span>` : "";
  const cover = h.coverMenu
    ? `<button class="lib-hero__cover-btn" type="button" data-hero-cover${h.coverDrop ? " data-hero-drop" : ""} aria-haspopup="menu" aria-label="Cover options" title="Opens the menu for this cover">${h.cover}</button>`
    : h.cover;
  return `<div class="lib-hero">${cover}<span class="lib-hero__title">${esc(h.title)}</span>${sub}${meta}</div>`;
}

export interface CardOptions {
  root: HTMLElement; // the .panel element (must hold .panel__title, .panel__back, .coll-body)
  storeKey: string; // localStorage key for the top-level prefs
  rootContext: () => Context; // built fresh from current data
  // Fires on every header change (drill in / back out). `atRoot` is true at the top level —
  // the slot picker uses it to be live only when the card shows its base title.
  onHeader?: (h: { title: string; atRoot: boolean }) => void;
}

interface Frame {
  ctx: Context;
  grouping: string;
  density: Density;
  sortKey: string;
  sortDir: SortDir;
  query: string;
  searchOpen: boolean;
  items: any[]; // current view order, for tile-click index → item
  scroll: number; // remembered scroll position, restored on back
}

// ── helpers ───────────────────────────────────────────────────────────────────
export const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }) as Record<string, string>)[c]);

const cmpStr = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

function sortItems<T>(items: T[], spec: SortSpec<T>, dir: SortDir, nameOf: (x: T) => string): T[] {
  const sign = dir === "asc" ? 1 : -1;
  const byName = (a: T, b: T) => cmpStr(nameOf(a), nameOf(b));
  return [...items].sort((a, b) => {
    const va = spec.get(a);
    const vb = spec.get(b);
    if (va == null && vb == null) return byName(a, b);
    if (va == null) return 1; // missing always last, either direction
    if (vb == null) return -1;
    const c = spec.type === "num" ? (va as number) - (vb as number) : cmpStr(String(va), String(vb));
    return sign * c || byName(a, b);
  });
}

// ── controller ──────────────────────────────────────────────────────────────────
export function initCollectionCard(opts: CardOptions) {
  const titleEl = opts.root.querySelector<HTMLElement>(".panel__title");
  const backEl = opts.root.querySelector<HTMLButtonElement>(".panel__back");
  const bodyHost = opts.root.querySelector<HTMLElement>(".coll-body");
  if (!bodyHost) return { reload: () => {}, drill: (_ctx: Context) => {}, destroy: () => {} };

  const baseTitle = titleEl?.textContent ?? "";
  bodyHost.innerHTML = `<div class="coll-viewport" data-viewport></div>`;
  const viewport = bodyHost.querySelector<HTMLElement>("[data-viewport]")!;

  const stack: Frame[] = [];
  let curPane: HTMLElement | null = null;
  // one windower per pane view while its list is above WINDOW_MIN (collection-window.ts)
  const windowers = new WeakMap<HTMLElement, Windower>();
  // per view: the last head block (toolbarBelow) — `top` is its hero + shelves markup, `html`
  // the whole block as mounted — so a render that changes neither keeps the live head
  const heads = new WeakMap<HTMLElement, { top: string; html: string }>();
  const dropWindower = (pane: HTMLElement | null) => {
    const v = pane?.querySelector<HTMLElement>("[data-view]");
    if (!v) return;
    windowers.get(v)?.destroy();
    windowers.delete(v);
  };
  let animating = false;

  const cur = () => stack[stack.length - 1];
  const groupingOf = (f: Frame) => f.ctx.groupings.find((g) => g.key === f.grouping)!;

  const frameFor = (ctx: Context, isTop: boolean): Frame => {
    const d = ctx.defaults ?? {};
    const g = ctx.groupings.find((x) => x.key === d.grouping) ?? ctx.groupings[0];
    const f: Frame = {
      ctx,
      grouping: g.key,
      density: d.density ?? "lines",
      sortKey: d.sortKey ?? g.sorts[0].key,
      sortDir: d.sortDir ?? "asc",
      query: "",
      searchOpen: false,
      items: [],
      scroll: 0,
    };
    if (isTop) {
      try {
        const raw = localStorage.getItem(opts.storeKey);
        if (raw) {
          const s = JSON.parse(raw);
          if (ctx.groupings.some((x) => x.key === s.grouping)) f.grouping = s.grouping;
          const ag = ctx.groupings.find((x) => x.key === f.grouping)!;
          if (ag.sorts.some((x) => x.key === s.sortKey)) f.sortKey = s.sortKey;
          if (s.sortDir === "asc" || s.sortDir === "desc") f.sortDir = s.sortDir;
          if (["lines", "small", "large"].includes(s.density)) f.density = s.density;
        }
      } catch {
        /* ignore corrupt prefs */
      }
    }
    return f;
  };

  const persist = () => {
    if (stack.length !== 1) return; // only the top level persists
    const { grouping, density, sortKey, sortDir } = cur();
    try {
      localStorage.setItem(opts.storeKey, JSON.stringify({ grouping, density, sortKey, sortDir }));
    } catch {
      /* storage unavailable */
    }
  };

  // ── markup builders (pure; take a frame) ──
  const sortPopBody = (f: Frame) => {
    const g = groupingOf(f);
    const keys = g.sorts
      .map(
        (s) =>
          `<button class="lib-pop__opt${s.key === f.sortKey ? " is-active" : ""}" type="button" data-sort-key="${s.key}">${esc(
            s.label,
          )}</button>`,
      )
      .join("");
    const dirs = (["asc", "desc"] as SortDir[])
      .map(
        (d) =>
          `<button class="lib-pop__dir${d === f.sortDir ? " is-active" : ""}" type="button" data-sort-dir="${d}" aria-label="${
            d === "asc" ? "Ascending" : "Descending"
          }" title="${d === "asc" ? "First to last: A to Z, newest first" : "Last to first: Z to A, oldest first"}"><svg viewBox="0 0 12 12" aria-hidden="true">${
            d === "asc" ? '<path d="M6 10V2M3 5l3-3 3 3" />' : '<path d="M6 2v8M3 7l3 3 3-3" />'
          }</svg></button>`,
      )
      .join("");
    return `<div class="lib-pop__cols"><div class="lib-pop__col" role="group" aria-label="Sort by">${keys}</div><div class="lib-pop__col lib-pop__col--dir" role="group" aria-label="Direction">${dirs}</div></div>`;
  };

  const viewPopBody = (f: Frame) => {
    const ctx = f.ctx;
    const groupCol =
      ctx.groupings.length > 1
        ? `<div class="lib-pop__col" role="group" aria-label="Group by">${ctx.groupings
            .map(
              (g) =>
                `<button class="lib-pop__opt${g.key === f.grouping ? " is-active" : ""}" type="button" data-group="${g.key}">${esc(
                  g.label,
                )}</button>`,
            )
            .join("")}</div>`
        : "";
    const dIcon: Record<Density, string> = {
      lines: '<path d="M2 4h12M2 8h12M2 12h12" />',
      small:
        '<g fill="currentColor" stroke="none"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></g>',
      large: '<rect x="2" y="2" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/>',
    };
    const densCol = ctx.density
      ? `<div class="lib-pop__col lib-pop__col--dir" role="group" aria-label="Density">${(["lines", "small", "large"] as Density[])
          .map(
            (d) =>
              `<button class="lib-pop__dir${d === f.density ? " is-active" : ""}" type="button" data-density="${d}" aria-label="${d}" title="${
                d === "lines" ? "Rows: one line each" : d === "small" ? "Small tiles" : "Large tiles"
              }"><svg viewBox="0 0 16 16" aria-hidden="true">${dIcon[d]}</svg></button>`,
          )
          .join("")}</div>`
      : "";
    return `<div class="lib-pop__cols">${groupCol}${densCol}</div>`;
  };

  const toolbarHTML = (f: Frame) => {
    const showView = f.ctx.groupings.length > 1 || f.ctx.density;
    // Auto-hide, same doctrine as View: a context whose every grouping has a single
    // fixed order (e.g. Radio's featured shelves) gets no one-option Sort pill.
    const showSort = f.ctx.groupings.some((g) => g.sorts.length > 1);
    return `
      <div class="lib-toolbar">
        <div class="lib-pills">
          ${
            showSort
              ? `<div class="lib-ctrl" data-ctrl="sort">
            <button class="lib-pill" data-pop="sort" type="button" aria-haspopup="true" aria-expanded="false" title="Changes the order of this list">
              <span class="lib-pill__label">Sort</span>
              <svg class="lib-pill__caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>
            </button>
          </div>`
              : ""
          }
          ${
            showView
              ? `<div class="lib-ctrl" data-ctrl="view">
            <button class="lib-pill" data-pop="view" type="button" aria-haspopup="true" aria-expanded="false" title="Changes what the list groups by and how big the rows are">
              <span class="lib-pill__label">View</span>
              <svg class="lib-pill__caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>
            </button>
          </div>`
              : ""
          }
          ${
            f.ctx.filter
              ? `<div class="lib-ctrl" data-ctrl="filter">
            <button class="lib-pill lib-pill--icon${f.ctx.filter.active() ? " is-active" : ""}" data-pop="filter" type="button" aria-pressed="${f.ctx.filter.active()}" aria-label="${esc(f.ctx.filter.label)}" title="${esc(f.ctx.filter.label)}">${f.ctx.filter.icon}</button>
          </div>`
              : ""
          }
          <div class="lib-ctrl" data-ctrl="search">
            <button class="lib-pill lib-pill--icon${f.query ? " is-active" : ""}" data-pop="search" type="button" aria-expanded="${f.searchOpen}" aria-label="Search" title="Finds a name in this list">
              <svg class="lib-pill__icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M11 11l3 3"/></svg>
            </button>
          </div>
        </div>
        <div class="lib-searchbar${f.searchOpen ? " is-open" : ""}">
          <div class="lib-searchbar__inner">
            <label class="lib-search">
              <svg class="lib-search__icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M11 11l3 3"/></svg>
              <input class="lib-search__input" data-search type="search" placeholder="Search…" autocomplete="off" spellcheck="false" />
            </label>
          </div>
        </div>
      </div>`;
  };

  // ── multi-select (row-pick.ts, NEXT-VERSION §19) ─────────────────────────────
  // One store per card. It keys on the grouping's own `pick.id`, so the picks survive a
  // sort, a filter, a search and a background sync; only a drill (in or out) drops them,
  // because the rows you picked are no longer the rows on screen.
  const pick = rowPick<any>({
    id: (x) => {
      const p = groupingOf(cur()).pick;
      return p?.id ? p.id(x) : objectId(x);
    },
    items: () => (groupingOf(cur()).pick ? cur().items : []),
    onChange: () => {
      if (curPane) renderViewInto(curPane, cur());
    },
  });
  // Which card Ctrl+A acts on. A row carries no tabindex, so a click leaves the focus on
  // <body> and `contains(document.activeElement)` would almost never be true — the last
  // press inside this card is the honest signal instead.
  let touched = false;
  viewport.addEventListener("pointerdown", () => {
    touched = true;
  });
  const onDocDown = (e: PointerEvent) => {
    if (!opts.root.contains(e.target as Node)) touched = false;
  };
  document.addEventListener("pointerdown", onDocDown);

  let lastPicked = 0; // picks at the last render — tells a first pick from a later one

  /** A row's HTML, with the pick mark added when it is one of the picked (§19). */
  const renderRow = (g: Grouping, x: any, density: Density, i: number): string =>
    g.pick ? pick.markHTML(g.render(x, density, i), x, i) : g.render(x, density, i);

  const buildPane = (f: Frame): HTMLElement => {
    const pane = document.createElement("div");
    pane.className = "coll-pane";
    pane.dataset.pos = "center";
    pane.innerHTML = `${f.ctx.toolbarBelow != null ? "" : toolbarHTML(f)}<div class="lib-view" data-view></div>`;
    const input = pane.querySelector<HTMLInputElement>("[data-search]");
    if (input) input.value = f.query;
    renderViewInto(pane, f);
    return pane;
  };

  const renderViewInto = (pane: HTMLElement, f: Frame) => {
    const view = pane.querySelector<HTMLElement>("[data-view]");
    if (!view) return;
    const g = groupingOf(f);
    const q = f.query.trim().toLowerCase();
    let items = g.list({ sortKey: f.sortKey, sortDir: f.sortDir, density: f.density, query: f.query });
    if (q) items = items.filter((x) => g.match(x, q));
    const spec = g.sorts.find((s) => s.key === f.sortKey) ?? g.sorts[0];
    items = sortItems(items, spec, f.sortDir, g.name);
    f.items = items;

    view.dataset.grid = f.density; // CSS hook for column sizing (NOT data-density —
    // that collides with the density buttons). Openable = pointer-cursor affordance:
    // rows that drill OR activate (play a song, toggle a section) are clickable.
    view.dataset.openable = g.open || g.activate ? "1" : "";
    // The hero and its shelves ride inside the scroll, above the rows (1A; ARTIST-VIEW.md §2.2).
    // Play / Shuffle (NEXT-VERSION §13, user's call 2026-09-15): a row of two half-width
    // buttons under the hero — or at the top of a song list with no hero — inside the head
    // block, so the windower measures it and a View switch to a non-song grouping drops it.
    // The count slides in on the FIRST pick only — a later pick just retypes the number,
    // and re-running the animation on every Ctrl+click would jitter the row.
    const nPicked = g.pick ? pick.size() : 0;
    const entering = nPicked > 0 && lastPicked === 0;
    lastPicked = nPicked;
    const top = heroHTML(f.ctx.hero?.()) + actionsHTML(g, items.length, nPicked, entering) + (f.ctx.shelves?.() ?? "");
    // toolbarBelow: after them comes a bar — the section label + the toolbar — right above the
    // rows it acts on. The bar is its own child of the scroll view (not inside the head), so
    // it can stick to the top once the hero and shelves scroll away (a sticky box stops at
    // its parent's edge). Both are rebuilt only when the hero or shelves change, so a sort, a
    // filter or a keystroke keeps the live pills (an open pop's anchor) and the search focus.
    const focused = document.activeElement;
    const searchHadFocus = focused instanceof HTMLInputElement && focused.matches("[data-search]") && view.contains(focused);
    let hero = top;
    let keepHead = false;
    if (f.ctx.toolbarBelow != null) {
      const prev = heads.get(view);
      keepHead = !!prev && prev.top === top && !!view.querySelector(":scope > [data-view-bar]");
      hero =
        keepHead && prev
          ? prev.html
          : `<div class="lib-view-head" data-view-head>${top}</div>` +
            `<div class="lib-view-bar" data-view-bar><div class="search__label">${esc(f.ctx.toolbarBelow)}</div>${toolbarHTML(f)}</div>`;
      heads.set(view, { top, html: hero });
    }
    // Put `rows` in the view: after a kept bar, else under a fresh hero.
    const fill = (rows: string) => {
      const bar = keepHead ? view.querySelector<HTMLElement>(":scope > [data-view-bar]") : null;
      if (!bar) {
        view.innerHTML = hero + rows;
        return;
      }
      while (bar.nextSibling) bar.nextSibling.remove();
      bar.insertAdjacentHTML("afterend", rows);
    };
    // A rebuilt head block has a new search field: give it the query, and the focus it had.
    const restoreSearch = () => {
      const input = view.querySelector<HTMLInputElement>("[data-search]");
      if (!input) return;
      if (input.value !== f.query) input.value = f.query;
      if (searchHadFocus && document.activeElement !== input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    };
    if (!items.length) {
      dropWindower(pane);
      view.className = "lib-view lib-empty";
      // A pane that takes a drop (an open playlist) draws the invite as one row-shaped slot
      // with a dashed rim, where the first row will land — the pane is already a drop target
      // (`dropInto` below), and now it says so. A filter with no matches is a plain line.
      const msg = f.query ? "No matches." : esc(f.ctx.emptyText ?? "Nothing here yet.");
      fill(
        !f.query && f.ctx.dropInto
          ? `<div class="lib-empty__slot"><span class="lib-empty__art" aria-hidden="true">♪</span><span class="lib-empty__msg">${msg}</span></div>`
          : `<p class="lib-empty__msg">${msg}</p>`,
      );
      restoreSearch();
      return;
    }
    view.className = f.density === "lines" ? "lib-view lib-list" : "lib-view lib-grid";
    // Long homogeneous lists are windowed (only the rows near the viewport exist); the
    // rest render whole, exactly as before. The gate keeps every small pane untouched.
    if (items.length > WINDOW_MIN && !g.mixed) {
      const spec = { count: items.length, render: (i: number) => renderRow(g, items[i], f.density, i), hero };
      const w = windowers.get(view);
      if (w) w.update(spec);
      else windowers.set(view, windowView(view, spec));
      restoreSearch();
      return;
    }
    dropWindower(pane);
    fill(items.map((x, i) => renderRow(g, x, f.density, i)).join(""));
    restoreSearch();
    // scroll restore / highlight scrolling is done post-mount in applyScroll()
  };

  const setHeader = (isTop: boolean, title: string) => {
    const shown = isTop ? baseTitle : title;
    if (titleEl) titleEl.textContent = shown;
    if (backEl) backEl.hidden = isTop;
    opts.onHeader?.({ title: shown, atRoot: isTop });
  };

  // ── transition (push / pop) ──
  // Restore scroll once the pane is in the DOM and laid out (doing it while the
  // pane is detached silently no-ops). A highlighted item wins over saved scroll.
  const applyScroll = (pane: HTMLElement, f: Frame) => {
    const v = pane.querySelector<HTMLElement>("[data-view]");
    if (!v) return;
    const w = windowers.get(v);
    if (w) {
      // windowed: the selected element may not exist — find its index in the model
      const g = groupingOf(f);
      const i = g.isSelected ? f.items.findIndex(g.isSelected) : -1;
      if (i >= 0) w.reveal(i, "center");
      else w.scrollTo(f.scroll);
      return;
    }
    const sel = v.querySelector(".is-selected");
    if (sel) sel.scrollIntoView({ block: "center" });
    else v.scrollTop = f.scroll;
  };

  const slide = (incoming: HTMLElement, dir: "push" | "pop", frame: Frame, onDone?: () => void) => {
    animating = true;
    const endFrames = frames.begin("slide", dir);
    const outgoing = curPane;
    incoming.dataset.pos = dir === "push" ? "right" : "left";
    incoming.style.transition = "none"; // place off-screen without animating
    viewport.appendChild(incoming);
    void incoming.offsetWidth; // force reflow so the start position is committed
    applyScroll(incoming, frame); // now laid out → scroll sticks
    incoming.style.transition = "";
    incoming.dataset.pos = "center";
    if (outgoing) outgoing.dataset.pos = dir === "push" ? "left" : "right";
    curPane = incoming;

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      incoming.removeEventListener("transitionend", finish);
      if (outgoing) {
        dropWindower(outgoing);
        outgoing.remove();
      }
      animating = false;
      endFrames();
      onDone?.();
    };
    const durStr = getComputedStyle(incoming).transitionDuration;
    const durMs = (parseFloat(durStr) || 0) * (durStr.includes("ms") ? 1 : 1000);
    if (durMs <= 0) finish();
    else {
      incoming.addEventListener("transitionend", finish);
      setTimeout(finish, durMs + 80); // safety net if transitionend is missed
    }
  };

  const drill = (childCtx: Context) => {
    if (animating) return;
    pick.clear(); // a drill changes which rows are on screen — the picks go with them (§19)
    // remember where we were so back restores scroll
    const v = curPane?.querySelector<HTMLElement>("[data-view]");
    if (v) cur().scroll = v.scrollTop;
    const f = frameFor(childCtx, false);
    stack.push(f);
    setHeader(false, f.ctx.headerLabel ?? f.ctx.title);
    slide(buildPane(f), "push", f);
  };

  const back = () => {
    if (animating || stack.length <= 1) return;
    pick.clear();
    const prev = stack[stack.length - 2];
    setHeader(stack.length - 1 === 1, prev.ctx.headerLabel ?? prev.ctx.title);
    slide(buildPane(prev), "pop", prev, () => stack.pop());
  };

  backEl?.addEventListener("click", back);

  // ── Sort/View popover (portaled to <body>) ──
  // Anchored under its pill but mounted on <body> so it can overflow the card: the
  // pane's transform + the viewport's overflow:hidden would otherwise clip an in-pane
  // popover. Mirrors context-menu.ts. One at a time; controls act on it directly since
  // it lives outside the viewport's delegated-click subtree.
  let popEl: HTMLElement | null = null;
  let popAnchor: HTMLElement | null = null; // the pill, for aria + re-click toggling
  let popCleanup: (() => void) | null = null;

  const closePop = () => {
    popCleanup?.();
    popCleanup = null;
    popAnchor?.setAttribute("aria-expanded", "false");
    popAnchor = null;
    popEl?.remove();
    popEl = null;
  };

  // Apply a control click within the open pop; keep it open so tweaks can continue.
  const onPopClick = (e: MouseEvent, pop: HTMLElement) => {
    const t = e.target as HTMLElement;
    const pane = curPane;
    if (!pane) return;
    const setActive = (attr: string, val: string) =>
      pop.querySelectorAll<HTMLElement>(`[${attr}]`).forEach((el) => el.classList.toggle("is-active", el.getAttribute(attr) === val));

    const sk = t.closest<HTMLElement>("[data-sort-key]");
    if (sk) {
      cur().sortKey = sk.dataset.sortKey!;
      persist();
      setActive("data-sort-key", sk.dataset.sortKey!);
      renderViewInto(pane, cur());
      return;
    }
    const sd = t.closest<HTMLElement>("[data-sort-dir]");
    if (sd) {
      cur().sortDir = sd.dataset.sortDir as SortDir;
      persist();
      setActive("data-sort-dir", sd.dataset.sortDir!);
      renderViewInto(pane, cur());
      return;
    }
    const dn = t.closest<HTMLElement>("[data-density]");
    if (dn) {
      cur().density = dn.dataset.density as Density;
      persist();
      setActive("data-density", dn.dataset.density!);
      renderViewInto(pane, cur());
      return;
    }
    const gr = t.closest<HTMLElement>("[data-group]");
    if (gr) {
      const f = cur();
      f.grouping = gr.dataset.group!;
      const g = groupingOf(f);
      if (!g.sorts.some((s) => s.key === f.sortKey)) f.sortKey = g.sorts[0].key; // sorts differ per grouping
      f.scroll = 0;
      persist();
      setActive("data-group", f.grouping);
      renderViewInto(pane, f);
    }
  };

  const openPop = (which: "sort" | "view", pill: HTMLElement, f: Frame) => {
    const reopen = popAnchor === pill;
    closePop();
    if (reopen) return; // clicking the open pill again just closes it

    const pop = document.createElement("div");
    pop.className = "lib-pop";
    pop.dataset.popbody = which; // marks clicks as "inside a pop" for onDocClick
    pop.setAttribute("role", "menu");
    pop.setAttribute("aria-label", which === "sort" ? "Sort" : "View");
    pop.innerHTML = which === "sort" ? sortPopBody(f) : viewPopBody(f);
    pop.addEventListener("click", (e) => onPopClick(e, pop));

    // Measure hidden, then anchor under the pill and clamp to the live viewport.
    pop.style.visibility = "hidden";
    document.body.appendChild(pop);
    const r = pill.getBoundingClientRect();
    const pad = 6;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const left = Math.max(pad, Math.min(r.left, vw - w - pad)); // align to pill's left, stay on-screen
    let top = r.bottom + 4;
    if (top + h + pad > vh) top = Math.max(pad, r.top - h - 4); // flip above the pill if no room below
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.style.visibility = "";

    popEl = pop;
    popAnchor = pill;
    pill.setAttribute("aria-expanded", "true");

    // Fixed-positioned, so a scroll/resize would leave it mis-anchored — dismiss instead.
    // (Outside-click and Escape are handled by the card's onDocClick/onDocKey.)
    const onAway = () => closePop();
    document.addEventListener("scroll", onAway, true);
    window.addEventListener("resize", onAway);
    popCleanup = () => {
      document.removeEventListener("scroll", onAway, true);
      window.removeEventListener("resize", onAway);
    };
  };

  const closePops = () => {
    closePop();
    curPane?.querySelectorAll<HTMLElement>("[data-pop]").forEach((b) => b.setAttribute("aria-expanded", "false"));
  };
  const markSearchPill = () => {
    curPane?.querySelector('[data-pop="search"]')?.classList.toggle("is-active", !!cur().query);
  };

  // Row drag (row-drag.ts, DRAG-DROP.md §4): a reorder where the grouping offers one
  // (`reorder`, in lines density, its sort ascending, no search — a drop position means
  // nothing in another order or a filtered list), else a copy of the item's songs (`drag`).
  // A data reload that arrives during ANY card's drag waits for its end, so no row or
  // insertion line is rebuilt under the pointer.
  let reloadPending = false;
  const reorderable = (f: Frame) => {
    const r = groupingOf(f).reorder;
    return !!r && f.sortKey === r.sortKey && f.sortDir === "asc" && !f.query.trim() && f.density === "lines";
  };
  const drag = rowDrag({
    root: viewport,
    label: "collection",
    rowAt: (target) => {
      if (animating) return null;
      const pane = target.closest<HTMLElement>(".coll-pane");
      if (!pane || pane !== curPane) return null;
      const row = target.closest<HTMLElement>("[data-idx]");
      const list = pane.querySelector<HTMLElement>("[data-view]");
      if (!row || !list) return null;
      const f = cur();
      const index = Number(row.dataset.idx);
      const x = f.items[index];
      if (x === undefined) return null;
      const g0 = groupingOf(f);
      // A drag that starts on a picked row carries every picked song as ONE payload, and
      // is a copy, never a reorder — a block of rows has no single new position (§19).
      if (g0.pick && pick.size() > 1 && pick.isPicked(x)) return { row, index, payload: g0.pick.drag(pick.picked()) };
      const payload = g0.drag?.(x, index, f.items) ?? undefined;
      if (reorderable(f)) return { row, index, list, count: f.items.length, payload };
      return payload ? { row, index, payload } : null;
    },
    onEnd: (from, to) => {
      if (to != null) groupingOf(cur()).reorder?.move(from, to); // the card reloads with its new order
    },
  });
  const unsubDragEnd = onDragEnd(() => {
    if (reloadPending) reload();
  });

  // Drops (DRAG-DROP.md §3): an item that takes songs (`dropOn`, a playlist row), or the
  // whole pane (`dropInto`, an open playlist) — at the insertion line while the reorder
  // order shows, else at the end. A card with neither lets an outer target answer (the
  // Library card's own).
  const unregisterDrop = registerDropTarget({
    el: viewport,
    over: (under, _x, _y, p) => {
      if (animating || !curPane || under.closest(".coll-pane") !== curPane) return null;
      const f = cur();
      const g = groupingOf(f);
      const view = curPane.querySelector<HTMLElement>("[data-view]") ?? undefined;
      const item = under.closest<HTMLElement>("[data-idx]");
      if (g.dropOn && item) {
        const x = f.items[Number(item.dataset.idx)];
        const run = x === undefined ? null : g.dropOn(x, p);
        if (run) return { highlight: item, scroll: view, drop: run };
      }
      const into = f.ctx.dropInto?.(p);
      if (into) {
        if (view && reorderable(f) && f.items.length)
          return { slots: { list: view, count: f.items.length }, scroll: view, drop: into };
        // Empty: light the invite slot itself, not the whole pane.
        const slot = view?.querySelector<HTMLElement>(".lib-empty__slot");
        return { highlight: slot ?? view ?? curPane, scroll: view, drop: () => into(null) };
      }
      return g.dropOn || f.ctx.dropInto ? { scroll: view } : null; // no drop here, but the list still scrolls
    },
  });

  viewport.addEventListener("click", (e) => {
    if (drag.consumeClick()) return; // the tail of a drag, not a play
    const t = e.target as HTMLElement;
    const pane = t.closest<HTMLElement>(".coll-pane");
    if (!pane || pane !== curPane || animating) return; // ignore off-screen / mid-transition panes

    // Play / Shuffle (NEXT-VERSION §13): the rows in the current sort and filter, from the
    // first — through the grouping's own row click, so Play Now scope and the queue rules hold.
    // Shuffle (or Play while the shuffle mode is on) starts a shuffled copy; with "Shuffle
    // stays on" the toolbar Shuffle also turns the mode on, as Apple does.
    const act = t.closest<HTMLElement>("[data-act]");
    if (act) {
      e.stopPropagation();
      closePops();
      const f = cur();
      const g = groupingOf(f);
      const what = act.dataset.act ?? "";
      // The count row (§19): Clear drops the picks; Play / Shuffle act on them alone.
      if (g.pick && pick.size()) {
        const picked = pick.picked();
        runListAction(what, picked, (list) => g.pick!.play(list));
        return;
      }
      if (!g.activate) return;
      runListAction(what, f.items, (list) => g.activate!(list[0], 0, list));
      return;
    }

    const pop = t.closest<HTMLElement>("[data-pop]");
    if (pop) {
      e.stopPropagation();
      const which = pop.dataset.pop!;
      if (which === "filter") {
        const filter = cur().ctx.filter;
        if (!filter) return;
        closePops();
        filter.toggle();
        const on = filter.active();
        pop.classList.toggle("is-active", on);
        pop.setAttribute("aria-pressed", String(on));
        renderViewInto(pane, cur());
        return;
      }
      if (which === "search") {
        const open = !cur().searchOpen;
        closePops();
        cur().searchOpen = open;
        pane.querySelector(".lib-searchbar")?.classList.toggle("is-open", open);
        pop.setAttribute("aria-expanded", String(open));
        if (open) pane.querySelector<HTMLInputElement>("[data-search]")?.focus();
        return;
      }
      // Sort/View → portaled popover (overflows the card); toggles on re-click.
      openPop(which as "sort" | "view", pop, cur());
      return;
    }

    // Sort/View popover controls are handled in onPopClick (the pop lives on <body>).

    // the hero's tappable subtitle (an album's artist) → its own drill
    if (t.closest("[data-hero-sub]")) {
      cur().ctx.hero?.()?.sub?.run?.();
      return;
    }

    // the hero's cover button (a local playlist) → its cover menu, under the cover
    const coverBtn = t.closest<HTMLElement>("[data-hero-cover]");
    if (coverBtn) {
      const items = cur().ctx.hero?.()?.coverMenu?.();
      if (items?.length) openContextMenuUnder(coverBtn, items);
      return;
    }

    // a shelf tile under the hero → the context's own handler
    const shelfItem = t.closest<HTMLElement>("[data-shelf-item]");
    if (shelfItem) {
      cur().ctx.onShelf?.(shelfItem);
      return;
    }

    // a tile/row → activate the leaf (play) if it offers one, else drill in
    const item = t.closest<HTMLElement>("[data-idx]");
    if (item) {
      const g = groupingOf(cur());
      const idx = Number(item.dataset.idx);
      const x = cur().items[idx];
      if (!x) return;
      // Ctrl / Shift → a pick, not a play. A plain click falls through and also drops
      // whatever was picked, so the list always returns to its normal state (§19).
      if (g.pick && pick.click(e, x)) return;
      if (g.activate) {
        g.activate(x, idx, cur().items);
        return;
      }
      if (g.open) {
        const child = g.open(x);
        if (child) drill(child);
      }
    }
  });

  // An image file dragged onto a hero cover that takes drops (`data-hero-drop`). The cover's
  // children ignore the pointer (styles.css), so the target is always the button itself.
  const dropTarget = (e: DragEvent): HTMLElement | null => {
    if (!e.dataTransfer?.types.includes("Files") || animating) return null;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-hero-drop]");
    return el && el.closest(".coll-pane") === curPane ? el : null;
  };
  viewport.addEventListener("dragover", (e) => {
    const el = dropTarget(e);
    if (!el) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "copy";
    el.classList.add("is-drop");
  });
  viewport.addEventListener("dragleave", (e) => {
    (e.target as HTMLElement).closest?.("[data-hero-drop]")?.classList.remove("is-drop");
  });
  viewport.addEventListener("drop", (e) => {
    const el = dropTarget(e);
    if (!el) return;
    e.preventDefault();
    el.classList.remove("is-drop");
    const file = e.dataTransfer!.files[0];
    if (file) cur().ctx.hero?.()?.coverDrop?.(file);
  });

  viewport.addEventListener("input", (e) => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>("[data-search]");
    if (!input) return;
    const pane = input.closest<HTMLElement>(".coll-pane");
    if (pane !== curPane) return;
    cur().query = input.value;
    cur().scroll = 0;
    markSearchPill();
    renderViewInto(pane!, cur());
  });

  // Right-click a tile/row → open its grouping's context menu (cursor-anchored). Only
  // groupings that declare `menu` participate; others fall through to the native menu.
  viewport.addEventListener("contextmenu", (e) => {
    const t = e.target as HTMLElement;
    const pane = t.closest<HTMLElement>(".coll-pane");
    if (!pane || pane !== curPane || animating) return;
    // The hero cover button: right-click opens the same cover menu as a left-click, at the cursor.
    if (t.closest("[data-hero-cover]")) {
      const items = cur().ctx.hero?.()?.coverMenu?.();
      if (!items?.length) return;
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, items);
      return;
    }
    const shelfItem = t.closest<HTMLElement>("[data-shelf-item]");
    if (shelfItem) {
      const items = cur().ctx.shelfMenu?.(shelfItem);
      if (!items?.length) return;
      e.preventDefault();
      shelfItem.classList.add("is-context");
      openContextMenu(e.clientX, e.clientY, items, () => shelfItem.classList.remove("is-context"));
      return;
    }
    const el = t.closest<HTMLElement>("[data-idx]");
    if (!el) return;
    const g = groupingOf(cur());
    const x = cur().items[Number(el.dataset.idx)];
    if (!x) return;
    // Right-click one of the picked rows → one menu for the whole set (§19). Right-click
    // anywhere else → the single-row menu, and the picks stay as they were.
    const items =
      g.pick && pick.size() && pick.isPicked(x)
        ? g.pick.menu(pick.picked())
        : g.menu
          ? g.menu(x, Number(el.dataset.idx), cur().items)
          : [];
    if (!items.length) return;
    e.preventDefault();
    el.classList.add("is-context");
    openContextMenu(e.clientX, e.clientY, items, () => el.classList.remove("is-context"));
  });

  // Named (not inline) so destroy() can remove them — these are the only listeners the
  // engine attaches outside its own DOM subtree, so they're what would leak on remount.
  const onDocClick = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest("[data-popbody], [data-pop]")) closePops();
  };
  const onDocKey = (e: KeyboardEvent) => {
    // Ctrl+A takes every row in the current sort and filter — only while this card holds
    // the focus, and never in a text field (the search box keeps its own select-all).
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a") {
      const t = e.target as HTMLElement | null;
      if (!canPick() || !touched || t?.closest("input, textarea, [contenteditable]")) return;
      if (!groupingOf(cur()).pick) return;
      e.preventDefault();
      pick.all();
      return;
    }
    if (e.key !== "Escape") return;
    pick.clear();
    closePops();
    if (cur()?.searchOpen) {
      cur().searchOpen = false;
      curPane?.querySelector(".lib-searchbar")?.classList.remove("is-open");
    }
  };
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onDocKey);

  // ── start ──
  const f0 = frameFor(opts.rootContext(), true);
  stack.push(f0);
  setHeader(true, "");
  curPane = buildPane(f0);
  curPane.dataset.pos = "center";
  viewport.appendChild(curPane);

  // Refresh data without losing the user's place. Live grouping closures pick up
  // new data; we just re-render the visible pane (deeper frames re-render on back).
  function reload() {
    if (isDragging()) {
      reloadPending = true; // after the drag (onDragEnd above)
      return;
    }
    reloadPending = false;
    if (stack.length === 1) {
      stack[0].ctx = opts.rootContext();
      if (!groupingOf(stack[0])) stack[0].grouping = stack[0].ctx.groupings[0].key;
    }
    if (!curPane) return;
    // a background sync shouldn't yank the user to the top
    const v = curPane.querySelector<HTMLElement>("[data-view]");
    const keep = v ? v.scrollTop : 0;
    renderViewInto(curPane, cur());
    const v2 = curPane.querySelector<HTMLElement>("[data-view]");
    if (!v2) return;
    const w = windowers.get(v2);
    if (w) w.scrollTo(keep);
    else v2.scrollTop = keep;
  }

  return {
    // Push a child context programmatically — same slide/header path as clicking a
    // tile (e.g. Playlists drills straight into a just-created playlist).
    drill(ctx: Context) {
      drill(ctx);
    },
    reload,
    // Remove the engine's document-level listeners. The viewport/back listeners live on
    // the host subtree, so they're discarded when the card clears its host on unmount.
    destroy() {
      drag.destroy(); // a drag's document listeners would outlive the card
      unsubDragEnd();
      unregisterDrop();
      dropWindower(curPane); // its observers outlive the subtree otherwise
      closePop(); // the pop lives on <body>, not the host subtree — remove it explicitly
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onDocKey);
      document.removeEventListener("pointerdown", onDocDown);
    },
  };
}
