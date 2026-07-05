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
import { musicCell } from "./library-card";
import { playStation } from "./player";
import type { CardDef } from "./cards";

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
    <button class="panel__back" id="radio-back" type="button" aria-label="Back" hidden>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
    <h2 class="panel__title">Radio</h2>
    <button class="panel__action" id="radio-refresh" type="button" aria-label="Refresh stations">
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
  mount(host) {
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
    const toggleSection = (label: string) => {
      if (collapsed.has(label)) collapsed.delete(label);
      else collapsed.add(label);
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
      } catch {
        /* storage unavailable — collapse still works for the session */
      }
      card.reload();
    };

    // Start a station (radio mode — player.ts owns the probe + guards). On success
    // the Recents shelf just gained a row — re-render the root pane.
    const startStation = (s: Station) =>
      void playStation(s)
        .then(() => card.reload())
        .catch((e) => console.error("[radio] play station", e));

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
      const section = (label: string, count: number, emit: () => void) => {
        if (!shelved) return void emit();
        items.push({ pos: pos++, kind: "header", label, count });
        if (!collapsed.has(label)) emit();
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
      return items;
    };

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
    const rootContext = (): Context => ({
      title: "Radio",
      density: true, // lines / small / large all work; headers span the grid rows
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
              ? `<div class="lib-shelf lib-shelf--toggle${collapsed.has(x.label) ? " is-collapsed" : ""}" data-idx="${idx}">` +
                `<svg class="lib-shelf__chev" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>` +
                `<span>${esc(x.label)}</span><span class="lib-shelf__count">${x.count}</span></div>`
              : x.kind === "station"
                ? stationCell(x.station, density, idx)
                : genreCell(x.genre, density, idx),
          activate: (x) => {
            if (x.kind === "header") toggleSection(x.label);
            else if (x.kind === "station") startStation(x.station);
            else if (x.kind === "genre") card.drill(genreCtx(x.genre));
          },
        } satisfies Grouping<ShelfItem>,
      ],
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
    const card = initCollectionCard({
      root: host,
      storeKey: "deets.radio.view",
      rootContext,
      onHeader: (h) => {
        lastHeader = h;
        headerSubs.forEach((cb) => cb(h));
      },
    });

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
        });
    };

    load();
    refreshBtn?.addEventListener("click", () => {
      radioDropCaches();
      load();
    });

    return {
      destroy() {
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
