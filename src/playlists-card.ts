// Playlists card (PLAYLISTS.md) — VIEW/PLAY-ONLY for now: the unified list shows the
// Apple mirror (read-only) plus any local playlists (none yet — the creation/editing
// UX is a dedicated later session, so there's no New Playlist / rename / reorder here).
//
// Rides the collection-card engine exactly like Library: overview (one "Playlists"
// grouping, Sort/View/Search pills) → drill into a playlist's tracks in authored
// order. Click a song → plays the playlist from there, origin-tagged `playlist:{id}`.
// Contents are cache-first (zero Apple calls to re-open); the header ⟳ is the
// explicit mirror re-sync that also drops content caches.

import { playlistsCached, applePlaylistsSync, applePlaylistCounts, playlistTracks, playlistCreate, playlistDelete, playlistRemoveTrack, addToPlaylistItem, onPlaylistsChange } from "./playlists";
import type { Playlist } from "./search";
import type { Track } from "./library";
import { playTracks, queueTracksNext, queueTracksLater } from "./player";
import { addSongToLibraryItem } from "./library-add";
import { initCollectionCard, type Context, type Grouping, type SortSpec } from "./collection-card";
import { musicCell, trackMenu } from "./library-card";
import { openContextMenuUnder, type MenuItem } from "./context-menu";
import { requestCard } from "./layout-bus";
import type { CardDef } from "./cards";

const pid = (p: Playlist) => p.libraryId ?? p.catalogId ?? p.name;

// Source sigil for playlists that live on Apple Music (`source: "apple"`), shown
// right-aligned on the count row. Filled by a theme role + sized by token in CSS
// (`.lib-src-badge`); the shape is the Apple mark. Local playlists carry no badge.
const APPLE_SIGIL =
  `<svg class="lib-src-badge" viewBox="0 0 24 24" role="img" aria-label="Apple Music">` +
  `<path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35` +
  `C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8` +
  `-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25` +
  `.29 2.58-2.34 4.5-3.74 4.25z"/></svg>`;

// Auto-sync the mirror once per session — a slot remount must not re-hit Apple.
let sessionSynced = false;

const HEAD = `
  <header class="panel__head">
    <button class="panel__back" id="playlists-back" type="button" aria-label="Back" hidden>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
    <h2 class="panel__title">Playlists</h2>
    <button class="panel__action" id="playlists-add" type="button" aria-label="New playlist">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke-linecap="round" /></svg>
    </button>
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
    const addBtn = host.querySelector<HTMLElement>("#playlists-add");

    let lists: Playlist[] = [];
    let openPlaylist: Playlist | null = null; // the drilled-into playlist, or null at overview
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

    // Stale-while-revalidate refetch for a playlist that's ALREADY cached + on-screen
    // (the fresh ⟳ while its detail pane is open). Unlike ensureTracks it force-fetches
    // over the existing entry, so the pane keeps showing the current tracks until the
    // new ones land — then reload swaps them in with no blank flash.
    const revalidate = (p: Playlist) => {
      const id = pid(p);
      if (pending.has(id)) return;
      pending.add(id);
      playlistTracks(p)
        .then((ts) => {
          ts.forEach((t, i) => posOf.set(t, i));
          trackCache.set(id, ts);
          card.reload();
        })
        .catch((e) => console.error("[playlists] revalidate", e))
        .finally(() => pending.delete(id));
    };

    // ── detail: a playlist's tracks, authored order ──
    const detail = (p: Playlist): Context => {
      openPlaylist = p; // track the open playlist so a fresh sync can revalidate it in place
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
        // Locals append Remove (destructive-last); mirrors keep the shared menu —
        // no Apple remove path. Identity is the row's AUTHORED position (duplicates
        // are legal): re-resolve it live at run time via indexOf (the qcard pattern —
        // the cached array is authored order and every row is a distinct object, so
        // indexOf pinpoints the right duplicate; -1 = the list shifted under the
        // open menu → no-op rather than remove the wrong row).
        menu: (t) => {
          // Add-to-Library rides after the shared actions (null unless the toggle is on
          // and the track is catalog-only); Remove stays destructive-last on locals.
          const base = [...trackMenu([t], ctxTag), addSongToLibraryItem(t)].filter(Boolean) as MenuItem[];
          if (p.source !== "local") return base;
          return [
            ...base,
            {
              label: "Remove from Playlist",
              run: () => {
                const i = (trackCache.get(id) ?? []).indexOf(t);
                if (i >= 0)
                  void playlistRemoveTrack(p, i).catch((e) => console.error("[playlists] remove track", e));
              },
            },
          ];
        },
      };
      return {
        title: p.name,
        density: true,
        groupings: [grouping],
        defaults: { density: "lines", sortKey: "order" },
        emptyText: "Add songs from your Library or Search.",
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
      const items: MenuItem[] = [
        { label: "Play Now", run: () => void tracksOf(p).then((ts) => { if (ts.length) return playTracks(ts, 0, ctxTag); }).catch(err("play now")) },
        { label: "Play Next", run: () => void tracksOf(p).then((ts) => { if (ts.length) return queueTracksNext(ts, ctxTag); }).catch(err("play next")) },
        { label: "Add to Queue", run: () => void tracksOf(p).then((ts) => { if (ts.length) return queueTracksLater(ts, ctxTag); }).catch(err("add to queue")) },
        // Bulk add — works from mirrors too (a partial import, snapshot semantics);
        // self-excluded so a playlist can't append to itself.
        addToPlaylistItem(() => tracksOf(p), p.libraryId),
      ];
      // Local playlists only (mirrors have no delete path — the Apple write ceiling).
      // Greyed while it has songs: the non-empty delete UX is a decided-later slice.
      // The change bus (below) handles the cache eviction + list reload.
      if (p.source === "local") {
        const n = trackCache.get(pid(p))?.length ?? p.trackCount ?? 0;
        items.push({
          label: "Delete Playlist",
          disabled: n > 0,
          run: () => void playlistDelete(p).catch(err("delete")),
        });
      }
      return items;
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
          render: (p, density, idx) =>
            musicCell(density, idx, p.artwork, p.name, subOf(p), {
              badge: p.source === "apple" ? APPLE_SIGIL : "",
            }),
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
        if (h.atRoot) openPlaylist = null; // backed out to the overview — nothing open to revalidate
        if (addBtn) addBtn.hidden = !h.atRoot; // New Playlist is a root-only action (create from the overview)
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

    // Eager count backfill: the flat mirror list carries no track count, so tiles
    // read "Playlist" until a count is learned. Fill the missing ones (one tiny
    // Apple call each, persisted, once ever) and re-render when any land. Gated so
    // the user can opt back to "Playlist-until-opened" (FUTURE-SETTINGS §14).
    const EAGER_COUNTS = localStorage.getItem("deets.playlists.eagerCounts") !== "off";
    const backfillCounts = () => {
      if (!EAGER_COUNTS) return;
      applePlaylistCounts()
        .then((filled) => {
          if (filled > 0) void load();
        })
        .catch((e) => console.error("[playlists] counts", e));
    };

    const doSync = (fresh: boolean) => {
      refreshBtn?.classList.add("is-busy");
      applePlaylistsSync(fresh)
        .then((n) => {
          console.log(`[playlists] mirror synced — ${n} playlist(s)${fresh ? " (fresh)" : ""}`);
          if (fresh) {
            // Drop every playlist's contents so each refetches on next open — EXCEPT one
            // whose detail pane is open: keep its stale entry visible and revalidate it in
            // place (below), so the open pane doesn't blank while the resync runs.
            const keep = openPlaylist ? pid(openPlaylist) : null;
            for (const id of [...trackCache.keys()]) if (id !== keep) trackCache.delete(id);
            if (openPlaylist) revalidate(openPlaylist);
          }
          return load();
        })
        .then(backfillCounts) // new playlists from the sync get their counts too
        .catch((e) => console.error("[playlists] sync", e))
        .finally(() => refreshBtn?.classList.remove("is-busy"));
    };

    void load().then(backfillCounts); // cached list renders instantly; counts fill in
    if (!sessionSynced) {
      sessionSynced = true;
      doSync(false);
    }
    refreshBtn?.addEventListener("click", () => doSync(true));

    // Local-store change bus: any create / add-tracks / delete (from ANY card —
    // Library, Search, or here) refreshes the list and, when a specific playlist
    // was touched, evicts + refetches its content cache so an open detail pane
    // live-updates instead of going stale.
    const unsubChanges = onPlaylistsChange((rowid) => {
      if (rowid != null) {
        const key = `local:${rowid}`;
        trackCache.delete(key);
        const p = lists.find((x) => x.libraryId === key);
        if (p) ensureTracks(p);
      }
      void load();
    });

    // New Playlist (+): a dropdown text field under the button (PLAYLISTS.md §5.4,
    // flow B). Enter → create local playlist → drill into its empty detail → summon
    // Search into the other slot so adding songs is one card away. Escape / click-away
    // cancels — Enter is the only commit (no accidental junk playlists).
    const createAndEnter = (name: string) =>
      playlistCreate(name)
        .then(async (rowid) => {
          await load(); // the new playlist joins the unified list
          const p = lists.find((x) => x.libraryId === `local:${rowid}`);
          if (!p) throw new Error("created playlist missing from cached list");
          card.drill(detail(p));
          requestCard("search");
        })
        .catch((e) => console.error("[playlists] create", e));

    if (addBtn)
      addBtn.addEventListener("click", () => {
        openContextMenuUnder(addBtn, [
          { input: { placeholder: "Playlist name", onSubmit: (name) => void createAndEnter(name) } },
        ]);
      });

    return {
      destroy() {
        unsubChanges();
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
