// Playlists card (PLAYLISTS.md) — VIEW/PLAY-ONLY for now: the unified list shows the
// Apple mirror (read-only) plus any local playlists (none yet — the creation/editing
// UX is a dedicated later session, so there's no New Playlist / rename / reorder here).
//
// Rides the collection-card engine exactly like Library: overview (one "Playlists"
// grouping, Sort/View/Search pills) → drill into a playlist's tracks in authored
// order. Click a song → plays the playlist from there, origin-tagged `playlist:{id}`.
// Contents are cache-first (zero Apple calls to re-open); the header ⟳ is the
// explicit mirror re-sync that also drops content caches.

import { playlistsCached, applePlaylistsSync, playlistTracks } from "./playlists";
import type { Playlist } from "./search";
import type { Track } from "./library";
import { playTracks, queueTracksNext, queueTracksLater } from "./player";
import { initCollectionCard, type Context, type Grouping, type SortSpec } from "./collection-card";
import { musicCell, trackMenu } from "./library-card";
import type { MenuItem } from "./context-menu";
import type { CardDef } from "./cards";

const pid = (p: Playlist) => p.libraryId ?? p.catalogId ?? p.name;

// Auto-sync the mirror once per session — a slot remount must not re-hit Apple.
let sessionSynced = false;

const HEAD = `
  <header class="panel__head">
    <button class="panel__back" id="playlists-back" type="button" aria-label="Back" hidden>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
    <h2 class="panel__title">Playlists</h2>
    <button class="panel__action" id="playlists-refresh" type="button" aria-label="Sync playlists">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="23 4 23 10 17 10"></polyline>
        <polyline points="1 20 1 14 7 14"></polyline>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
      </svg>
    </button>
  </header>
  <div class="coll-body"></div>`;

export const playlistsCard: CardDef = {
  id: "playlists",
  title: "Playlists",
  mount(host) {
    host.innerHTML = HEAD;
    const refreshBtn = host.querySelector<HTMLElement>("#playlists-refresh");

    let lists: Playlist[] = [];
    const trackCache = new Map<string, Track[]>(); // pid → authored-order tracks
    const posOf = new WeakMap<Track, number>(); // authored position (Playlist-Order sort)
    const pending = new Set<string>();

    const tracksOf = (p: Playlist): Promise<Track[]> => {
      const id = pid(p);
      const hit = trackCache.get(id);
      if (hit) return Promise.resolve(hit);
      return playlistTracks(p).then((ts) => {
        ts.forEach((t, i) => posOf.set(t, i));
        trackCache.set(id, ts);
        return ts;
      });
    };

    // Drill-in loader: `open` is synchronous, so the detail context reads from the
    // cache and this kicks the fetch; the reload re-renders the (detail) pane when
    // the tracks land. Overview subtitles pick the count up on the way back.
    const ensureTracks = (p: Playlist) => {
      const id = pid(p);
      if (trackCache.has(id) || pending.has(id)) return;
      pending.add(id);
      tracksOf(p)
        .then(() => card.reload())
        .catch((e) => console.error("[playlists] tracks", e))
        .finally(() => pending.delete(id));
    };

    // ── detail: a playlist's tracks, authored order ──
    const detail = (p: Playlist): Context => {
      ensureTracks(p);
      const id = pid(p);
      const ctxTag = `playlist:${id}`;
      const sorts: SortSpec<Track>[] = [
        { key: "order", label: "Playlist Order", type: "num", get: (t) => posOf.get(t) },
        { key: "az", label: "A–Z", type: "str", get: (t) => t.title },
        { key: "artist", label: "Artist", type: "str", get: (t) => t.artistName },
      ];
      const grouping: Grouping<Track> = {
        key: "tracks",
        label: "Songs",
        sorts,
        list: () => trackCache.get(id) ?? [],
        name: (t) => t.title,
        match: (t, q) =>
          t.title.toLowerCase().includes(q) ||
          t.artistName.toLowerCase().includes(q) ||
          (t.albumName?.toLowerCase().includes(q) ?? false),
        render: (t, density, idx) => musicCell(density, idx, t.artwork, t.title, t.artistName),
        // Click a song → play the playlist from here, in the current sort order.
        activate: (_t, idx, items) =>
          void playTracks(items, idx, ctxTag).catch((e) => console.error("[playlists] play", e)),
        menu: (t) => trackMenu([t], ctxTag),
      };
      return {
        title: p.name,
        density: true,
        groupings: [grouping],
        defaults: { density: "lines", sortKey: "order" },
      };
    };

    // ── overview: the unified list ──
    const subOf = (p: Playlist) => {
      const n = trackCache.get(pid(p))?.length ?? p.trackCount;
      if (n != null) return `${n} song${n === 1 ? "" : "s"}`;
      return p.curatorName ?? "Playlist";
    };

    const listMenu = (p: Playlist): MenuItem[] => {
      const ctxTag = `playlist:${pid(p)}`;
      const err = (what: string) => (e: unknown) => console.error(`[playlists] ${what}`, e);
      return [
        { label: "Play Now", run: () => void tracksOf(p).then((ts) => { if (ts.length) return playTracks(ts, 0, ctxTag); }).catch(err("play now")) },
        { label: "Play Next", run: () => void tracksOf(p).then((ts) => { if (ts.length) return queueTracksNext(ts, ctxTag); }).catch(err("play next")) },
        { label: "Add to Queue", run: () => void tracksOf(p).then((ts) => { if (ts.length) return queueTracksLater(ts, ctxTag); }).catch(err("add to queue")) },
      ];
    };

    // "Added Date" mirrors Library's semantics: ascending (the default ↑) puts the
    // most recently added first, via a negated timestamp.
    const recency = (iso: string | undefined) => {
      if (!iso) return undefined;
      const t = Date.parse(iso);
      return Number.isFinite(t) ? -t : undefined;
    };

    const rootContext = (): Context => ({
      title: "Playlists",
      density: true,
      groupings: [
        {
          key: "playlists",
          label: "Playlists",
          sorts: [
            { key: "az", label: "A–Z", type: "str", get: (p) => p.name },
            { key: "added", label: "Added Date", type: "num", get: (p) => recency(p.dateAdded) },
          ],
          list: () => lists,
          name: (p) => p.name,
          match: (p, q) =>
            p.name.toLowerCase().includes(q) || (p.curatorName?.toLowerCase().includes(q) ?? false),
          render: (p, density, idx) => musicCell(density, idx, p.artwork, p.name, subOf(p)),
          open: detail,
          menu: listMenu,
        } satisfies Grouping<Playlist>,
      ],
      defaults: { grouping: "playlists", density: "lines", sortKey: "az", sortDir: "asc" },
    });

    // Header state for the slot picker (same pattern as the Library card).
    let lastHeader = { title: "Playlists", atRoot: true };
    const headerSubs = new Set<(h: { title: string; atRoot: boolean }) => void>();
    const card = initCollectionCard({
      root: host,
      storeKey: "deets.playlists.view",
      rootContext,
      onHeader: (h) => {
        lastHeader = h;
        headerSubs.forEach((cb) => cb(h));
      },
    });

    // ── load + sync (stale-while-revalidate, like songs) ──
    const load = () =>
      playlistsCached()
        .then((ps) => {
          lists = ps;
          card.reload();
        })
        .catch((e) => console.error("[playlists] load", e));

    const doSync = (fresh: boolean) => {
      refreshBtn?.classList.add("is-busy");
      applePlaylistsSync(fresh)
        .then((n) => {
          console.log(`[playlists] mirror synced — ${n} playlist(s)${fresh ? " (fresh)" : ""}`);
          if (fresh) trackCache.clear(); // contents refetch on next open
          return load();
        })
        .catch((e) => console.error("[playlists] sync", e))
        .finally(() => refreshBtn?.classList.remove("is-busy"));
    };

    void load(); // cached list renders instantly
    if (!sessionSynced) {
      sessionSynced = true;
      doSync(false);
    }
    refreshBtn?.addEventListener("click", () => doSync(true));

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
