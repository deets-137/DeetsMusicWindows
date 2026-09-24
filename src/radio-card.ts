// Radio card (STATIONS.md §3a) — the stations BROWSER: Apple's stations laid out
// as shelves; activating one enters radio mode (player.ts playStation — which also
// carries the MusicKit station-descriptor probe on its first real click).
//
// Rides the collection-card engine with ONE root grouping over a heterogeneous
// "shelf list" — header / station / genre rows in a fixed featured order:
//
//   Recents         (local, hidden when empty)
//   For You         (My Station + Discovery Station — either row hides if absent)
//   Live            (Apple Music 1 / Hits / Country / Música Uno / Club / Chill)
//   Genres          (station-genres → drill into that genre's stations)
//
// The engine gives pane-slide drill, the toolbar, and the shared musicCell for
// free. Headers never match search, so a query flattens the pane to plain
// station/genre hits; the single "Featured" sort keeps shelf order (the Sort pill
// auto-hides on one-sort groupings). Data is session-cached in radio.ts — a slot
// remount costs zero Apple calls; ⟳ drops the cache and refetches.

import {
  radioLive,
  radioMyStation,
  radioDiscovery,
  radioGenres,
  radioGenreStations,
  radioGenreStationsPeek,
  radioDropCaches,
  radioRecents,
  type Station,
  type StationGenre,
} from "./radio";
import { initCollectionCard, esc, type Context, type Density, type Grouping, type ViewState } from "./collection-card";
import type { DragPayload } from "./row-drag";
import { musicCell } from "./library-card";
import { playStation } from "./player";
import { stationMenu as stationMenuFor } from "./media-menu";
import { pinActivate, pinnedShelfHTML, pinShelfItem, onPinsChange, pinDragRow } from "./pins";
import type { MenuItem } from "./context-menu";
import { enterRows, rowsAfter } from "./pop";
import type { CardDef } from "./cards";
import { sortByOrder, moveTo, onRowOrderChange, sectionsMovable, holdMs, sectionAt } from "./row-order";

/** The hover hint that teaches the gesture (ONBOARDING.md ledger); nothing while the
 *  Move sections row is off, because then there is no move. */
const moveHint = (): string =>
  sectionsMovable() ? ' title="Click to open or close. Hold to move this section. New sections appear at the end"' : "";

type ShelfItem = { pos: number } & (
  | { kind: "header"; label: string; count: number }
  | { kind: "station"; station: Station }
  | { kind: "genre"; genre: StationGenre }
);

// Collapse state, persisted across remounts/restarts (section labels, not indices —
// the labels are fixed + unique, so they're a stable key). Mirrors the Playlists
// card's fold store; only bites in the shelved (Featured↑) view where headers exist.
const COLLAPSE_KEY = "deets.radio.collapsed";
const loadCollapsed = (): Set<string> => {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
};

// No LIVE chip: the Live shelf header already says it (your call, 2026-07-03) —
// live-ness resurfaces in radio mode as the transport's LIVE state instead.
const stationSub = (s: Station) => s.tagline ?? (s.isLive ? "Apple Music live radio" : "Apple Music station");

const stationCell = (s: Station, density: Density, idx: number) =>
  musicCell(density, idx, s.artwork, s.name, stationSub(s));

// Genres have no artwork — round initial thumbs (the artist treatment) keep their
// rows/tiles the same shape as everything else at every density.
const genreCell = (g: StationGenre, density: Density, idx: number) =>
  musicCell(density, idx, undefined, g.name, "Stations", { round: true });


const HEAD = `
  <header class="panel__head">
    <button class="panel__back" id="radio-back" type="button" aria-label="Back" title="Goes back one step" hidden>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
    <h2 class="panel__title">Radio</h2>
    <button class="panel__action" id="radio-refresh" type="button" aria-label="Refresh stations" title="Reads the stations from Apple Music again">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="23 4 23 10 17 10"></polyline>
        <polyline points="1 20 1 14 7 14"></polyline>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
      </svg>
    </button>
  </header>
  <div class="coll-body"></div>`;

export const radioCard: CardDef = {
  id: "radio",
  title: "Radio",
  mount(host, mountOpts) {
    host.innerHTML = HEAD;
    const refreshBtn = host.querySelector<HTMLElement>("#radio-refresh");

    let live: Station[] = [];
    let myStation: Station | null = null;
    let discovery: Station | null = null;
    let genres: StationGenre[] = [];
    let loading = true;
    let failed = false;
    const pendingGenres = new Set<string>();
    const collapsed = loadCollapsed();

    // Fold/unfold a shelf, persist, re-render the root pane.
    const saveCollapsed = () => {
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
      } catch {
        /* storage unavailable — collapse still works for the session */
      }
    };
    const toggleSection = (label: string) => {
      const opening = collapsed.has(label);
      if (opening) collapsed.delete(label);
      else collapsed.add(label);
      saveCollapsed();
      card.reload(); // synchronous: the shelf's rows exist after this
      // The opened shelf's rows slide in under their header (src/pop.ts); a close stays instant.
      if (opening) enterRows(rowsAfter(host.querySelector(`[data-section="${CSS.escape(label)}"]`)));
    };

    // Start a station (radio mode — player.ts owns the probe + guards). On success
    // the Recents shelf just gained a row — re-render the root pane.
    const startStation = (s: Station) =>
      void playStation(s)
        .then(() => card.reload())
        .catch((e) => console.error("[radio] play station", e));

    // A station's right-click: the station menu (CONTEXT-MENUS.md §3.5). Play Now redraws
    // the root after it starts (the Recents shelf gained a row).
    const stationMenu = (s: Station): MenuItem[] =>
      stationMenuFor(s, { context: `station:${s.id}`, play: () => startStation(s) });
    // A station drags (DRAG-DROP.md §2, 2026-09-15): to the Queue card it plays after the
    // queue, to Now Playing it plays now. No songs — the playlist and library targets refuse it.
    const stationDrag = (s: Station): DragPayload => ({
      source: "radio", kind: "station", station: s, tracks: () => [], play: () => playStation(s),
    });

    // The heterogeneous root list, rebuilt fresh per render (recents can change
    // under us). `pos` pins the featured order through the engine's sort. Shelf
    // headers exist only in featured(↑) order — any other sort flattens the list
    // to plain rows (headers out, cross-shelf duplicates deduped by station id).
    const shelf = (view?: ViewState): ShelfItem[] => {
      const shelved = !view || (view.sortKey === "featured" && view.sortDir === "asc");
      const items: ShelfItem[] = [];
      let pos = 0;
      const seen = new Set<string>();
      const station = (s: Station) => {
        if (!shelved && seen.has(s.id)) return;
        seen.add(s.id);
        items.push({ pos: pos++, kind: "station", station: s });
      };
      // A featured section: its header (with member count) then its rows, unless the
      // header is folded. Any non-featured view drops headers and emits the rows flat
      // regardless of collapse (so search reaches into folded shelves).
      // The sections are gathered first and emitted after, so the user's own order can
      // decide which comes first (MOVABLE-ROWS.md §4). The gather order below is the
      // BUILT-IN order: a section the rank list does not name falls to the end (fork 3A).
      const blocks: { label: string; count: number; emit: () => void }[] = [];
      const section = (label: string, count: number, emit: () => void) => {
        if (!shelved) return void emit();
        blocks.push({ label, count, emit });
      };

      const recents = radioRecents();
      if (recents.length) section("Recents", recents.length, () => recents.forEach(station));
      // Apple's own ordering: My Station (known taste) above Discovery (new music).
      const forYou = [myStation, discovery].filter((s): s is Station => !!s);
      if (forYou.length) section("For You", forYou.length, () => forYou.forEach(station));
      if (live.length) section("Live", live.length, () => live.forEach(station));
      if (genres.length)
        section("Genres", genres.length, () => {
          for (const g of genres) items.push({ pos: pos++, kind: "genre", genre: g });
        });
      for (const b of sortByOrder("radio.sections", blocks, (x) => x.label)) {
        items.push({ pos: pos++, kind: "header", label: b.label, count: b.count });
        if (!collapsed.has(b.label)) b.emit();
      }
      return items;
    };

    /** Every section drawn now, in the order drawn — what a drop position means. */
    const sectionIds = (items: ShelfItem[]): string[] =>
      items.flatMap((x) => (x.kind === "header" ? [x.label] : []));

    // ── genre detail: that genre's stations, fetched lazily on first drill ──
    const genreCtx = (g: StationGenre): Context => {
      if (!radioGenreStationsPeek(g.id) && !pendingGenres.has(g.id)) {
        pendingGenres.add(g.id);
        radioGenreStations(g)
          .catch((e) => console.error("[radio] genre stations", e))
          .finally(() => {
            pendingGenres.delete(g.id);
            card.reload();
          });
      }
      return {
        title: g.name,
        key: `genre:${g.id}`, // card memory (CARD-MEMORY.md §5)
        density: true,
        groupings: [
          {
            key: "stations",
            label: "Stations",
            sorts: [{ key: "az", label: "A–Z", type: "str", get: (s) => s.name }],
            list: () => radioGenreStationsPeek(g.id) ?? [],
            name: (s) => s.name,
            match: (s, q) =>
              s.name.toLowerCase().includes(q) || (s.tagline?.toLowerCase().includes(q) ?? false),
            render: (s, density, idx) => stationCell(s, density, idx),
            activate: (s) => startStation(s),
            menu: (s) => stationMenu(s),
            drag: (s) => stationDrag(s),
          } satisfies Grouping<Station>,
        ],
        defaults: { density: "lines", sortKey: "az" },
        // Live getter: the pane re-renders on reload, and "still fetching" vs
        // "genuinely empty" is only knowable then.
        get emptyText() {
          return pendingGenres.has(g.id) ? "Tuning in…" : "No stations in this genre.";
        },
      };
    };

    // ── root: the shelves ──
    // The Pinned shelf (PINS.md): pinned stations above the sections. A tile plays, as its
    // row does; its menu is the row's menu.
    const rootContext = (): Context => ({
      title: "Radio",
      density: true, // lines / small / large all work; headers span the grid rows
      shelves: () => pinnedShelfHTML(["station"]),
      shelfDrag: pinDragRow, // the grip moves a pinned tile along the shelf (MOVABLE-ROWS.md §5.2)
      shelvesFirst: true,
      // A station is a stream Apple shuffles: it plays, and it is never asked for a verb
      // (PINS.md §8.2 fork 5). It goes through the shared activator all the same, so the
      // click trail reads the same on all four shelves.
      onShelf: (el) => {
        const it = pinShelfItem(el);
        if (it) pinActivate(it, "radio");
      },
      shelfMenu: (el) => {
        const it = pinShelfItem(el);
        return it?.station ? stationMenu(it.station) : [];
      },
      groupings: [
        {
          key: "shelves",
          label: "Stations",
          sorts: [
            { key: "featured", label: "Featured", type: "num", get: (x) => x.pos },
            // Headers are already flattened out by shelf() for any non-featured view.
            { key: "az", label: "A–Z", type: "str", get: (x) => (x.kind === "header" ? undefined : x.kind === "station" ? x.station.name : x.genre.name) },
          ],
          list: shelf,
          mixed: true, // shelf headers among rows — never windowed (collection-window.ts)
          name: (x) => (x.kind === "header" ? x.label : x.kind === "station" ? x.station.name : x.genre.name),
          // Headers never match — a search query flattens to plain hits.
          match: (x, q) =>
            x.kind === "station"
              ? x.station.name.toLowerCase().includes(q) ||
                (x.station.tagline?.toLowerCase().includes(q) ?? false)
              : x.kind === "genre"
                ? x.genre.name.toLowerCase().includes(q)
                : false,
          render: (x, density, idx) =>
            x.kind === "header"
              ? `<div class="lib-shelf lib-shelf--toggle${collapsed.has(x.label) ? " is-collapsed" : ""}" data-idx="${idx}" data-section="${esc(x.label)}"${moveHint()}>` +
                `<svg class="lib-shelf__chev" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>` +
                `<span>${esc(x.label)}</span><span class="lib-shelf__count">${x.count}</span></div>`
              : x.kind === "station"
                ? stationCell(x.station, density, idx)
                : genreCell(x.genre, density, idx),
          menu: (x) => (x.kind === "station" ? stationMenu(x.station) : []),
          drag: (x) => (x.kind === "station" ? stationDrag(x.station) : null),
          activate: (x) => {
            if (x.kind === "header") toggleSection(x.label);
            else if (x.kind === "station") startStation(x.station);
            else if (x.kind === "genre") card.drill(genreCtx(x.genre));
          },
        } satisfies Grouping<ShelfItem>,
      ],
      // Hold a section header to move the section (MOVABLE-ROWS.md §4.2). Only in the
      // Featured view with no query: any other sort flattens the headers out, so there is
      // nothing to hold and the rank list is simply not read (§4.3). A station row is never
      // movable — Recents is a log that reorders itself on the next play (§0a).
      holdDrag: (row, index, list, view, rerender) => {
        if (!sectionsMovable()) return null;
        if (view.sortKey !== "featured" || view.sortDir !== "asc" || view.query.trim()) return null;
        const items = view.items as ShelfItem[];
        const x = items[index];
        if (!x || x.kind !== "header") return null;
        const label = x.label;
        const ids = sectionIds(items);
        const wasOpen = !collapsed.has(label);
        return {
          row, index, list, count: items.length, measure: true, hold: holdMs(),
          // Fork 5A: the section shuts as it lifts, so one row travels.
          begin: () => {
            if (wasOpen) {
              collapsed.add(label);
              saveCollapsed();
              rerender();
            }
          },
          done: (to) => {
            const back = () => {
              if (!wasOpen) return void card.reload();
              collapsed.delete(label);
              saveCollapsed();
              card.reload();
              enterRows(rowsAfter(host.querySelector(`[data-section="${CSS.escape(label)}"]`)));
            };
            if (to == null) return back();
            // The LIVE list, not the one read at the press: fork 5A folded this section
            // shut as it lifted, so its members left the list and every row index after
            // it moved. `to` counts rows in the list as it is NOW.
            const live = view.items as ShelfItem[];
            const at = sectionAt(live.length, (i) => live[i].kind === "header", index, to);
            void moveTo("radio.sections", ids, label, at).then(back);
          },
        };
      },
      defaults: { grouping: "shelves", density: "lines", sortKey: "featured", sortDir: "asc" },
      get emptyText() {
        return loading
          ? "Tuning in…"
          : failed
            ? "Connect to Apple Music to browse radio."
            : "Nothing on the air.";
      },
    });

    // Header state for the slot picker (the shared collection-card pattern).
    let lastHeader = { title: "Radio", atRoot: true };
    const headerSubs = new Set<(h: { title: string; atRoot: boolean }) => void>();
    // Card memory (CARD-MEMORY.md §5): a genre level's key back into its context.
    const resolve = (key: string): Context | null => {
      if (!key.startsWith("genre:")) return null;
      const g = genres.find((x) => x.id === key.slice("genre:".length));
      return g ? genreCtx(g) : null;
    };
    const card = initCollectionCard({
      root: host,
      storeKey: "deets.radio.view",
      rootContext,
      resolve,
      onReturn: mountOpts?.onReturn,
      returnTitle: mountOpts?.returnTitle,
      onHeader: (h) => {
        lastHeader = h;
        headerSubs.forEach((cb) => cb(h));
      },
    });

    const unsubPins = onPinsChange(() => card.reload());
    // A section moved, or a Reset dropped the order: the list is rebuilt from `shelf()`.
    const unsubOrder = onRowOrderChange(() => card.reload());

    // ── load (session-cached in radio.ts — a remount costs zero Apple calls) ──
    const load = () => {
      loading = true;
      failed = false;
      refreshBtn?.classList.add("is-busy");
      Promise.all([
        radioLive(),
        // Either personalized station missing (or a per-user endpoint hiccup) is
        // not a card failure — its For You row just hides.
        radioMyStation().catch((e) => {
          console.warn("[radio] my station", e);
          return null;
        }),
        radioDiscovery().catch((e) => {
          console.warn("[radio] discovery", e);
          return null;
        }),
        radioGenres(),
      ])
        .then(([l, m, d, g]) => {
          live = l;
          myStation = m;
          discovery = d;
          genres = g;
        })
        .catch((e) => {
          failed = true;
          console.error("[radio] load", e);
        })
        .finally(() => {
          loading = false;
          refreshBtn?.classList.remove("is-busy");
          card.reload();
          // Card memory (CARD-MEMORY.md §4): a genre key resolves only once the genres are here.
          if (mountOpts?.memory && card.depth() === 1) card.restore(mountOpts.memory);
        });
    };

    // The body waits (hidden) for that first load, so the root does not flash first.
    if (mountOpts?.memory) card.hold();
    load();
    refreshBtn?.addEventListener("click", () => {
      radioDropCaches();
      load();
    });

    return {
      snapshot: () => card.snapshot(),
      destroy() {
        unsubPins();
        unsubOrder();
        card.destroy();
        host.innerHTML = "";
      },
      onHeaderChange(cb) {
        headerSubs.add(cb);
        cb(lastHeader);
        return () => headerSubs.delete(cb);
      },
    };
  },
};
