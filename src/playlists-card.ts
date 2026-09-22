// Playlists card (PLAYLISTS.md) — VIEW/PLAY-ONLY for now: the unified list shows the
// Apple mirror (read-only) plus any local playlists (none yet — the creation/editing
// UX is a dedicated later session, so there's no New Playlist / rename / reorder here).
//
// Rides the collection-card engine exactly like Library: overview (one "Playlists"
// grouping, Sort/View/Search pills) → drill into a playlist's tracks in authored
// order. Click a song → plays the playlist from there, origin-tagged `playlist:{id}`.
// Contents are cache-first (zero Apple calls to re-open); the header ⟳ is the
// explicit mirror re-sync that also drops content caches.

import * as frames from "./frames";
import { setting } from "./settings-store";
import {
  playlistsCached, applePlaylistsSync, applePlaylistCounts, playlistTracks, playlistCreate, playlistDelete, playlistKeep, expiryText,
  playlistRemoveTrack, playlistRename, playlistReorder, playlistSetCover, playlistImport, addToPlaylistItem, onPlaylistsChange,
  foldersList, folderCreate, folderRename, folderDelete, folderAssign, isReplay, ownCover, type PlaylistFolder,
  onOpenPlaylistRequest, takeOpenPlaylistRequest, type OpenPlaylistRequest, refreshSet,
} from "./playlists";
import {
  covered, choiceOf, choiceLabel, reloadRefreshRows, refreshOnOpen, WEEKDAYS, type RefreshMode,
} from "./playlist-refresh";
import type { Playlist } from "./search";
import type { Track } from "./library";
import { playTracks, queueTracksNext, queueTracksLater } from "./player";
import { addSongToLibraryItem } from "./library-add";
import { initFavorites, reconcile } from "./favorites";
import { initCollectionCard, esc, formatTotal, type Context, type Grouping, type SortSpec, type ViewState } from "./collection-card";
import { picksText } from "./row-pick";
import { playlistShelfMenu } from "./artist-view";
import { pinRows, pinActivate, pinnedShelfHTML, pinShelfItem, onPinsChange, pinDragRow } from "./pins";
import { sortByOrder, moveTo, onRowOrderChange, sectionsMovable, holdMs, sectionAt } from "./row-order";
import { musicCell, trackMenu, explicitBadge, heroCover } from "./library-card";
import { addSquareHTML } from "./add-square";
import { onGrowChange } from "./card-grow";
import { openContextMenuUnder, menuState, MENU_CHOSEN, type MenuItem } from "./context-menu";
import { appleMusicItem } from "./playlist-export";
import { APPLE_SIGIL } from "./apple-sigil";
import { enterRows, rowsAfter } from "./pop";
import { requestCard } from "./layout-bus";
import { currentSurface } from "./surface";
import { toast } from "./toast";
import * as diag from "./diag";
import type { CardDef } from "./cards";
import type { DragPayload } from "./row-drag";
import { dropToPlaylist, dropToApplePlaylist } from "./drop-actions";
import { MOSAIC_MAX } from "./mosaic";
import { drawCover, coverLetters } from "./cover-art";
import { mountWeb } from "./web";

const pid = (p: Playlist) => p.libraryId ?? p.catalogId ?? p.name;
/** A local playlist edited by hand: a Replay is made from listening (PLAYLISTS.md §10.8). */
const handMade = (p: Playlist) => p.source === "local" && !isReplay(p);

// Auto-sync the mirror once per session — a slot remount must not re-hit Apple.
let sessionSynced = false;
// Apple's generated Favorite Songs list seeds the ♥ mirror (favorites.rs) when its
// tracks are fetched — once per session, right after the mirror sync.
let favoritesSeeded = false;

/** Shrink an image file to a square JPEG data URL and set it as the cover. Resized here
 *  so the stored cover is small (≈50 KB), whatever the source file. The file picker and
 *  a file dropped on the hero cover both land here. */
/** Generate Cover (PLAYLISTS.md §11.2): draw Letters or Note in the current theme and save
 *  it as the cover — the same drawing a new playlist gets. */
function generateCover(p: Playlist, kind: "letters" | "note"): void {
  drawCover(kind, p.name)
    .then((cover) => {
      if (!cover) throw new Error("canvas unavailable");
      return playlistSetCover(p, cover);
    })
    .catch((e) => {
      console.error("[playlists] generate cover", e);
      toast({ kind: "warn", text: "Couldn't save the cover." });
    });
}

function setCoverFromFile(p: Playlist, file: File): void {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    const SIDE = 512;
    const c = document.createElement("canvas");
    c.width = SIDE;
    c.height = SIDE;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    // Center-crop to a square, like every other cover.
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, SIDE, SIDE);
    playlistSetCover(p, c.toDataURL("image/jpeg", 0.85)).catch((e) => {
      console.error("[playlists] set cover", e);
      toast({ kind: "warn", text: "Couldn't save the cover." });
    });
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    console.warn("[playlists] cover: not an image");
    toast({ kind: "warn", text: `“${file.name}” is not an image DeetsMusic can read.` });
  };
  img.src = url;
}

/** Pick an image file for the cover. */
function pickCover(p: Playlist): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) setCoverFromFile(p, file);
  });
  input.click();
}

// ── sections (PLAYLISTS.md §Folders) ────────────────────────────────────────────
// The overview is a heterogeneous pos-pinned "shelf list" (the Radio grammar):
// manual folders first (A–Z), then the unfiled playlists auto-clustered by kind.
// Headers exist only in the Folders(↑) sort with no query — any other sort or an
// active search flattens to plain playlist rows (so collapsed members still match).
type PlRow = { pos: number } & (
  | { kind: "folder"; id: number; label: string; count: number }
  | { kind: "cluster"; key: string; label: string; count: number }
  | { kind: "playlist"; p: Playlist }
);

/** The hover hint that teaches the gesture (ONBOARDING.md ledger); nothing while the
 *  Move sections row is off. A playlist row inside a section moves the same way. */
const moveHint = (): string =>
  sectionsMovable() ? ' title="Click to open or close. Hold to move this section. New sections appear at the end"' : "";

const sectionKey = (x: PlRow) => (x.kind === "folder" ? `folder:${x.id}` : x.kind === "cluster" ? x.key : "");

// One collator, not one per comparison — see collection-card.ts `cmpStr` (2026-09-17).
const collator = new Intl.Collator(undefined, { sensitivity: "base" });
const byName = <T extends { name: string }>(a: T, b: T) => collator.compare(a.name, b.name);

// Unfiled auto-clusters, fixed order. "Made Here" are made in DeetsMusic; "Your
// Apple Playlists" are the user's own on Apple Music — split so the two write paths never
// look alike (PLAYLISTS.md §10.9). "Apple Mixes" is the weeklies shelf: Apple's
// personalised mixes all end in "Mix" (New Music Mix, Favourites Mix, …); "Replays"
// collects the yearly Replay playlists ("Replay 2024", …).
type ClusterKey = "local" | "yours" | "mixes" | "replays" | "apple";
const clusterOf = (p: Playlist): ClusterKey =>
  p.source === "local"
    ? "local"
    : p.kind === "user"
      ? "yours"
      : /\bmix$/i.test(p.name)
        ? "mixes"
        : /^replay\b/i.test(p.name)
          ? "replays"
          : "apple";
const CLUSTERS: { key: ClusterKey; label: string }[] = [
  { key: "local", label: "Made Here" },
  { key: "yours", label: "Your Apple Playlists" },
  { key: "mixes", label: "Apple Mixes" },
  { key: "replays", label: "Apple Replays" },
  { key: "apple", label: "Saved from Apple Music" },
];

// Collapse state, persisted across remounts/restarts (section keys, not indices).
const COLLAPSE_KEY = "deets.playlists.collapsed";
const loadCollapsed = (): Set<string> => {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
};

// One-time pref migration: sections only show under the (new) Folders sort, so a
// pre-folders persisted sortKey would silently hide them behind the Sort pill.
const migrateSortPref = () => {
  try {
    if (localStorage.getItem("deets.playlists.foldersMigrated")) return;
    localStorage.setItem("deets.playlists.foldersMigrated", "1");
    const raw = localStorage.getItem("deets.playlists.view");
    if (!raw) return;
    const s = JSON.parse(raw);
    s.sortKey = "folders";
    s.sortDir = "asc";
    localStorage.setItem("deets.playlists.view", JSON.stringify(s));
  } catch {
    /* corrupt prefs — frameFor falls back to defaults anyway */
  }
};

const HEAD = `
  <header class="panel__head">
    <button class="panel__back" id="playlists-back" type="button" aria-label="Back" title="Goes back one step" hidden>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
    <h2 class="panel__title">Playlists</h2>
    <button class="panel__action" id="playlists-add" type="button" aria-label="New playlist" title="Makes a new playlist or a new folder">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke-linecap="round" /></svg>
    </button>
    <button class="panel__action web-btn" id="playlists-web" type="button" aria-label="Playlist web" title="Makes a playlist from an artist and the artists they make songs with"></button>
    <button class="panel__action" id="playlists-refresh" type="button" aria-label="Sync playlists" title="Reads your playlists from Apple Music again">
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
  mount(host, mountOpts) {
    host.innerHTML = HEAD;
    migrateSortPref(); // before the engine reads the persisted view prefs
    const refreshBtn = host.querySelector<HTMLElement>("#playlists-refresh");
    const addBtn = host.querySelector<HTMLElement>("#playlists-add");
    const webBtn = host.querySelector<HTMLElement>("#playlists-web");
    const unmountWeb = webBtn ? mountWeb(webBtn).destroy : null; // PLAYLIST-WEB.md

    let lists: Playlist[] = [];
    let folders: PlaylistFolder[] = [];
    const collapsed = loadCollapsed();
    let openPlaylist: Playlist | null = null; // the drilled-into playlist, or null at overview
    const trackCache = new Map<string, Track[]>(); // pid → authored-order tracks
    const posOf = new WeakMap<Track, number>(); // authored position (Playlist-Order sort)
    const pending = new Set<string>();
    const refetchAgain = new Set<string>(); // a change landed while a revalidate was in flight

    /** The songs of several picked playlist rows, each playlist's own order, back to back. */
    const pickedTracks = (xs: PlRow[]): Promise<Track[]> =>
      Promise.all(xs.map((x) => (x.kind === "playlist" ? tracksOf(x.p) : Promise.resolve([] as Track[])))).then((a) => a.flat());

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

    // The derived cover (PLAYLISTS.md §11), computed HERE from the tracks in hand: the first
    // MOSAIC_MAX distinct track-cover templates in song order — the same rule as Rust's
    // `mosaic_urls`, which only sees the content cache and so is empty on a playlist's
    // first open (and partial while a paged fetch is still landing). With the tracks
    // cached, this is the truth; the playlist row's own `coverUrls` is the fallback.
    const mosaicOf = (ts: Track[] | undefined): string[] | undefined => {
      if (!ts?.length) return undefined;
      const seen = new Set<string>();
      for (const t of ts) {
        const u = t.artwork?.urlTemplate;
        if (u) seen.add(u);
        if (seen.size === MOSAIC_MAX) break;
      }
      return seen.size ? [...seen] : undefined;
    };
    const coverOf = (p: Playlist): string[] | undefined => mosaicOf(trackCache.get(pid(p))) ?? p.coverUrls;

    // Drill-in loader: `open` is synchronous, so the detail context reads from the
    // cache and this kicks the fetch; the reload re-renders the (detail) pane when
    // the tracks land. Overview subtitles pick the count up on the way back.
    const ensureTracks = (p: Playlist) => {
      const id = pid(p);
      if (trackCache.has(id) || pending.has(id)) return;
      pending.add(id);
      // PLAYLIST-REFRESH.md trigger 1: a playlist that is DUE re-reads its songs from Apple
      // on the way in, so an opened playlist is never stale. Not due — the usual case —
      // resolves at once and costs nothing.
      refreshOnOpen(p)
        .catch(() => false)
        .then(() => tracksOf(p))
        .then((ts) => { reconcile(ts); card.reload(); }) // ♥ state for rows the mirror hasn't seen
        .catch((e) => console.error("[playlists] tracks", e))
        .finally(() => pending.delete(id));
    };

    // Stale-while-revalidate refetch for a playlist that's ALREADY cached + on-screen
    // (the fresh ⟳ while its detail pane is open). Unlike ensureTracks it force-fetches
    // over the existing entry, so the pane keeps showing the current tracks until the
    // new ones land — then reload swaps them in with no blank flash.
    // The change bus rides this too, so an edit (a drop, a rename) never blanks the pane
    // between the eviction and the refetch. A second change while one fetch is in flight
    // discards that fetch's (older) result and fetches again.
    const revalidate = (p: Playlist) => {
      const id = pid(p);
      if (pending.has(id)) {
        refetchAgain.add(id);
        return;
      }
      pending.add(id);
      playlistTracks(p)
        .then((ts) => {
          if (refetchAgain.has(id)) return;
          ts.forEach((t, i) => posOf.set(t, i));
          trackCache.set(id, ts);
          card.reload();
        })
        .catch((e) => console.error("[playlists] revalidate", e))
        .finally(() => {
          pending.delete(id);
          if (refetchAgain.delete(id)) revalidate(p);
        });
    };

    // A drop on a playlist (DRAG-DROP.md §3): a hand-made local playlist (at `at`, or the
    // end), or — while Export playlists is on — the user's own Apple playlist (the end, its
    // question first). Never a drop back on the playlist the songs came from.
    const dropFor = (p: Playlist, pay: DragPayload): ((at: number | null) => void) | null => {
      if (pay.playlistId && pay.playlistId === p.libraryId) return null;
      if (pay.kind === "station") return null; // a stream has no songs to add
      if (handMade(p)) return (at) => dropToPlaylist(p, pay, at);
      if (p.source === "apple" && p.canEdit && setting("playlistExport")) return () => dropToApplePlaylist(p, pay);
      return null;
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
        // Lines view carries the Add-to-Library square at the row's end (add-square.ts); a tile has no room.
        render: (t, density, idx) =>
          musicCell(density, idx, t.artwork, t.title, t.artistName, {
            badge: explicitBadge(t) + (density === "lines" ? addSquareHTML(t, "add-square--row") : ""),
            cid: t.catalogId ?? "",
          }),
        // Click a song → play the playlist from here, in the current sort order.
        activate: (_t, idx, items) =>
          void playTracks(items, idx, ctxTag).catch((e) => console.error("[playlists] play", e)),
        playAll: true, // the toolbar's Play / Shuffle (NEXT-VERSION §13)
        // Locals append Remove (destructive-last); mirrors keep the shared menu —
        // no Apple remove path. Identity is the row's AUTHORED position (duplicates
        // are legal): re-resolve it live at run time via indexOf (the qcard pattern —
        // the cached array is authored order and every row is a distinct object, so
        // indexOf pinpoints the right duplicate; -1 = the list shifted under the
        // open menu → no-op rather than remove the wrong row).
        // Drag a song to a new place (PLAYLISTS.md §10.1): a hand-made local playlist, in
        // Playlist Order (the engine also requires lines density and no search). The new
        // order shows at once; the store write follows, and the change bus refetches it.
        reorder: handMade(p)
          ? {
              sortKey: "order",
              move: (from, to) => {
                const ts = trackCache.get(id);
                if (!ts) return;
                ts.splice(to, 0, ...ts.splice(from, 1));
                ts.forEach((t, i) => posOf.set(t, i));
                card.reload();
                playlistReorder(p, from, to).catch((e) => {
                  console.error("[playlists] reorder", e);
                  toast({ kind: "warn", text: `Couldn't move the song in “${p.name}”.` });
                  revalidate(p); // put the stored order back
                });
              },
            }
          : undefined,
        drag: (t) => ({ source: "playlists", kind: "song", tracks: () => [t], context: ctxTag, playlistId: p.libraryId }),
        // Multi-select (NEXT-VERSION §19). No `id`: a playlist may hold the same song
        // twice, so each ROW is its own pick (object identity).
        pick: {
          menu: (ts) => {
            const base = trackMenu(ts, ctxTag);
            if (!handMade(p)) return base; // mirrors have no remove path
            // Remove a whole set: resolve every row's position FIRST, then delete from the
            // bottom up, one after the other. Each delete renumbers the rows below it, so a
            // descending walk is the only order where the positions still to go stay true.
            return [
              ...base,
              {
                label: `Remove ${picksText(ts.length)} from Playlist`,
                run: () => {
                  const live = trackCache.get(id) ?? [];
                  const idxs = ts.map((t) => live.indexOf(t)).filter((i) => i >= 0).sort((a, b) => b - a);
                  void idxs
                    .reduce((chain, i) => chain.then(() => playlistRemoveTrack(p, i)), Promise.resolve())
                    .catch((e) => {
                      console.error("[playlists] remove picked", e);
                      toast({ kind: "warn", text: `Couldn't remove the songs from “${p.name}”.` });
                      revalidate(p);
                    });
                },
              },
            ];
          },
          drag: (ts) => ({ source: "playlists", kind: "song", count: ts.length, tracks: () => ts, context: ctxTag, playlistId: p.libraryId }),
          play: (ts) => void playTracks(ts, 0, ctxTag).catch((e) => console.error("[playlists] play picked", e)),
        },
        menu: (t) => {
          // Add-to-Library rides after the shared actions (null unless the toggle is on
          // and the track is catalog-only); Remove stays destructive-last on locals.
          const base = [...trackMenu([t], ctxTag), addSongToLibraryItem(t)].filter(Boolean) as MenuItem[];
          if (!handMade(p)) return base; // mirrors have no remove path; a Replay isn't edited by hand
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
        key: ctxTag, // card memory (CARD-MEMORY.md §5): "playlist:<pid>"
        headerLabel: "Playlist",
        // The hero: the playlist's own cover (or the mosaic), its name, and songs · length ·
        // source. Tracks land async — the reload after ensureTracks re-renders the line.
        hero: () => {
          // The live row, not the drill-time snapshot: a new cover or export stamp shows at once.
          const q = lists.find((x) => x.libraryId === p.libraryId) ?? p;
          const ts = trackCache.get(id);
          const n = ts?.length ?? q.trackCount;
          const total = ts ? formatTotal(ts.reduce((acc, t) => acc + (t.durationMs ?? 0), 0)) : "";
          const source = q.source === "local" ? "Yours" : q.curatorName ?? "Apple Music";
          const local = q.source === "local";
          return {
            cover: heroCover(q.artwork, q.name, coverOf(q), id), // live: fills in when the tracks land
            title: q.name,
            meta: [
              n != null ? `${n} song${n === 1 ? "" : "s"}` : "",
              total,
              source,
              // A local playlist with a live Apple copy: when it was last written there.
              local && q.exportedAt && onApple(q)
                ? `Exported on ${new Date(q.exportedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
                : "",
              expiryText(q),
            ].filter(Boolean).join(" · "),
            // A local playlist's cover is a button (1B) and takes a dropped image file (3B).
            // An Apple playlist's cover offers Import to Edit, its one way to an editable copy.
            coverMenu: local ? () => coverItems(q, "Choose Image…") : q.source === "apple" ? () => [importItem(q)] : undefined,
            coverDrop: local ? (file: File) => setCoverFromFile(q, file) : undefined,
          };
        },
        density: true,
        groupings: [grouping],
        dropInto: (pay) => dropFor(p, pay),
        defaults: { density: "lines", sortKey: "order" },
        emptyText: "Drag songs here, or add them from your Library or Search.",
      };
    };

    // On Apple Music: a mirror, or a local playlist whose exported copy is still in the mirror
    // (PLAYLISTS.md §6) — both carry the Apple Music sigil in the list.
    const onApple = (p: Playlist) =>
      p.source === "apple" || (!!p.exportedAppleId && lists.some((m) => m.source === "apple" && m.libraryId === p.exportedAppleId));

    // ── overview: the unified list ──
    const subOf = (p: Playlist) => {
      const n = trackCache.get(pid(p))?.length ?? p.trackCount;
      // A temporary web playlist says when it goes (PLAYLIST-WEB.md §10.5).
      if (n != null) return [`${n} song${n === 1 ? "" : "s"}`, expiryText(p)].filter(Boolean).join(" · ");
      return p.curatorName ?? "Playlist";
    };

    // "Move to Folder ▸" — the Add-to-Playlist flyout grammar: a New Folder… field
    // (create-and-file in one gesture), the folders A–Z (current one excluded), and
    // Remove from Folder when filed. Works on locals AND mirrors (folder membership
    // is local metadata keyed on libraryId — no Apple writes involved).
    const moveToFolderItem = (p: Playlist): MenuItem => ({
      label: "Move to Folder",
      sub: () =>
        foldersList().then((fs) => {
          const items: MenuItem[] = [
            {
              input: {
                placeholder: "New Folder…",
                onSubmit: (name) =>
                  void folderCreate(name)
                    .then((id) => folderAssign(p, id))
                    .catch((e) => console.error("[playlists] new folder", e)),
              },
            },
            ...fs
              .sort(byName)
              .filter((f) => f.id !== p.folderId)
              .map((f) => ({
                label: f.name,
                run: () => void folderAssign(p, f.id).catch((e) => console.error("[playlists] move to folder", e)),
              })),
          ];
          if (p.folderId != null)
            items.push({
              label: "Remove from Folder",
              run: () => void folderAssign(p, null).catch((e) => console.error("[playlists] unfile", e)),
            });
          return items;
        }),
    });

    // "Refresh ▸" (PLAYLIST-REFRESH.md §2) — how often this playlist re-reads its songs
    // from Apple. A submenu, not a split pill: the menu primitive has no split, no toggle
    // and no checked state, and this is the same grammar as "Move to Folder ▸" above. The
    // current choice rides the parent row, and the chosen row inside carries the tick.
    const refreshItem = (p: Playlist): MenuItem => {
      const c = choiceOf(p);
      const set = (mode: RefreshMode, weekday?: number) =>
        void refreshSet(p, mode, weekday)
          .then(reloadRefreshRows)
          .catch((e) => console.error("[playlists] refresh set", e));
      return {
        label: "Refresh",
        badge: menuState(choiceLabel(c)),
        sub: () => [
          { label: "Daily", badge: c.mode === "daily" ? MENU_CHOSEN : "", run: () => set("daily") },
          {
            label: "Weekly",
            badge: c.mode === "weekly" ? menuState(WEEKDAYS[c.weekday]) : "",
            sub: () =>
              WEEKDAYS.map((name, i) => ({
                label: name,
                badge: c.mode === "weekly" && c.weekday === i ? MENU_CHOSEN : "",
                run: () => set("weekly", i),
              })),
          },
          { label: "Off", badge: c.mode === "off" ? MENU_CHOSEN : "", run: () => set("off") },
        ],
      };
    };

    // Folder headers: rename in place, delete unfiles the members (playlists untouched).
    const folderMenu = (id: number): MenuItem[] => [
      {
        input: {
          placeholder: "Rename folder…",
          onSubmit: (name) => void folderRename(id, name).catch((e) => console.error("[playlists] rename folder", e)),
        },
      },
      { label: "Delete Folder", run: () => void folderDelete(id).catch((e) => console.error("[playlists] delete folder", e)) },
    ];

    // The local playlist items (NEXT-VERSION §2, PLAYLISTS.md §6, §10.2), shared by the hero
    // cover button and a local row's right-click: Rename (a field holding the current
    // name), the cover, and Apple Music ▸. Covers are local only: Apple's API cannot
    // receive one, so an exported playlist keeps whatever Apple generates.
    // Rename: a field holding the current name. It heads both menus (a hand-made playlist only).
    const renameItem = (p: Playlist): MenuItem => ({
      input: {
        placeholder: "Playlist name",
        value: p.name,
        onSubmit: (name) => {
          if (name === p.name) return;
          playlistRename(p, name).catch((e) => {
            console.error("[playlists] rename", e);
            toast({ kind: "warn", text: `Couldn't rename “${p.name}”.` });
          });
        },
      },
    });

    // `withRename: false` — the row menu already put Rename at its top.
    const coverItems = (p: Playlist, pickLabel: string, withRename = true): MenuItem[] => {
      const items: MenuItem[] = [];
      if (withRename && handMade(p)) items.push(renameItem(p));
      // A temporary web playlist (PLAYLIST-WEB.md §10.5): the only way to stop its expiry.
      if (p.expireDays != null)
        items.push({
          label: "Keep Playlist",
          run: () =>
            void playlistKeep(p)
              .then(() => diag.log("web:expiry", { keep: p.libraryId }))
              .catch((e) => {
                console.error("[playlists] keep", e);
                toast({ kind: "warn", text: `Couldn't keep “${p.name}”.` });
              }),
        });
      items.push({ label: pickLabel, run: () => pickCover(p) });
      // Generate Cover (PLAYLISTS.md §11.2): draw Letters or Note now, in the current theme.
      const letters = coverLetters(p.name);
      items.push({
        label: "Generate Cover",
        sub: () => [
          ...(letters ? [{ label: `Letters (${letters})`, run: () => generateCover(p, "letters") }] : []),
          { label: "Note", run: () => generateCover(p, "note") },
          // Back to the derived cover: the saved one goes (the same write as Remove Cover).
          ...(ownCover(p)
            ? [{ label: "Mosaic", run: () => void playlistSetCover(p, null).catch((e) => console.error("[playlists] mosaic cover", e)) }]
            : []),
        ],
      });
      if (ownCover(p))
        items.push({ label: "Remove Cover", run: () => void playlistSetCover(p, null).catch((e) => console.error("[playlists] remove cover", e)) });
      const apple = appleMusicItem(p, () => lists, () => doSync(false)); // the new Apple copy joins the mirror
      if (apple) items.push(apple);
      return items;
    };

    // Import to Edit (PLAYLISTS.md §10.9): copy an Apple playlist into a new local one and
    // open it. The user's own playlist stays linked as the copy's Apple copy (one row).
    const importItem = (p: Playlist): MenuItem => ({
      label: "Import to Edit",
      run: () =>
        void playlistImport(p)
          .then(async (r) => {
            await load(); // the copy joins the list (and a linked original hides)
            const q = lists.find((x) => x.libraryId === `local:${r.id}`);
            if (q) card.drill(detail(q));
            toast({
              kind: "success",
              text: r.linked
                ? `Imported “${p.name}”. You can edit it here.` +
                  (setting("playlistExport") ? " Apple Music ▸ Send New Songs adds its new songs to the original." : "")
                : `Imported “${p.name}” as a copy you can edit. The copy doesn't change when Apple Music changes the original.`,
            });
          })
          .catch((e) => {
            console.error("[playlists] import", e);
            toast({ kind: "warn", text: `Couldn't import “${p.name}”.` });
          }),
    });

    // Delete (PLAYLISTS.md §10.3): an empty playlist goes at once; one with songs asks first
    // in a red sticky question. An exported playlist's Apple copy stays, and deleting the
    // local row un-hides it (§6 "one row"), so the question says so.
    const confirmDelete = (p: Playlist) => {
      const del = () =>
        void playlistDelete(p).catch((e) => {
          console.error("[playlists] delete", e);
          toast({ kind: "warn", text: `Couldn't delete “${p.name}”.` });
        });
      const n = trackCache.get(pid(p))?.length ?? p.trackCount ?? 0;
      if (!n) return del();
      toast({
        kind: "error",
        sticky: true,
        text:
          `Delete “${p.name}” and its ${n} song${n === 1 ? "" : "s"}? This can't be undone.` +
          (onApple(p) ? " Its copy on Apple Music stays and will show in your list." : ""),
        actions: [{ label: "Delete", run: del }, { label: "Cancel" }],
      });
    };

    // Bulk delete (PLAYLISTS.md §10.3): shift-click a run of playlists, then one question
    // for the whole set. Apple mirrors have no delete path, so a pick that holds some is
    // counted, named and left alone. The deletes run one after the other — each one emits
    // on the change bus, which reloads the list.
    const confirmDeleteMany = (ps: Playlist[], skipped: number) => {
      // The song total is what we already hold: the cached tracks, else the row's own
      // count. Nothing is fetched to ask the question.
      const songs = ps.reduce((n, p) => n + (trackCache.get(pid(p))?.length ?? p.trackCount ?? 0), 0);
      const kept = ps.filter(onApple).length;
      const del = () => {
        let failed = 0;
        void ps
          .reduce(
            (chain, p) =>
              chain.then(() =>
                playlistDelete(p).catch((e) => {
                  failed++;
                  console.error("[playlists] delete picked", e);
                }),
              ),
            Promise.resolve(),
          )
          .then(() => {
            card.dropPicks(); // the rows are gone — the count row goes with them
            if (failed) toast({ kind: "warn", text: `Couldn't delete ${picksText(failed, "playlist")}.` });
            else toast({ kind: "success", text: `Deleted ${picksText(ps.length, "playlist")}.` });
          });
      };
      toast({
        kind: "error",
        sticky: true,
        text:
          `Delete ${picksText(ps.length, "playlist")}` +
          (songs ? ` and ${ps.length === 1 ? "its" : "their"} ${songs} song${songs === 1 ? "" : "s"}?` : "?") +
          " This can't be undone." +
          (kept
            ? ` ${kept === 1 ? "One copy on Apple Music stays" : `${kept} copies on Apple Music stay`} and will show in your list.`
            : "") +
          (skipped
            ? ` ${picksText(skipped, "playlist")} you picked ${skipped === 1 ? "is" : "are"} on Apple Music, and ${skipped === 1 ? "stays" : "stay"}.`
            : ""),
        actions: [{ label: "Delete All", run: del }, { label: "Cancel" }],
      });
    };

    const listMenu = (p: Playlist): MenuItem[] => {
      const ctxTag = `playlist:${pid(p)}`;
      const err = (what: string) => (e: unknown) => console.error(`[playlists] ${what}`, e);
      const items: MenuItem[] = [
        ...(handMade(p) ? [renameItem(p)] : []), // the field first, ready to type
        { label: "Play Now", run: () => void tracksOf(p).then((ts) => { if (ts.length) return playTracks(ts, 0, ctxTag); }).catch(err("play now")) },
        { label: "Play Next", run: () => void tracksOf(p).then((ts) => { if (ts.length) return queueTracksNext(ts, ctxTag); }).catch(err("play next")) },
        { label: "Add to Queue", run: () => void tracksOf(p).then((ts) => { if (ts.length) return queueTracksLater(ts, ctxTag); }).catch(err("add to queue")) },
        // Bulk add — works from mirrors too (a partial import, snapshot semantics);
        // self-excluded so a playlist can't append to itself.
        addToPlaylistItem(() => tracksOf(p), p.libraryId),
        moveToFolderItem(p),
        ...(covered(p) ? [refreshItem(p)] : []), // no remote copy to re-read = no row (D3)
        ...pinRows(ctxTag, "playlist"),
      ];
      if (p.source === "apple") items.push(importItem(p));
      // Local playlists only (mirrors have no delete path — the Apple write ceiling).
      // The change bus (below) handles the cache eviction + list reload.
      if (p.source === "local") {
        items.push(...coverItems(p, ownCover(p) ? "Change Cover…" : "Set Cover…", false));
        items.push({ label: "Delete Playlist", run: () => confirmDelete(p) });
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

    // The heterogeneous shelf list (see PlRow above). `pos` pins the section order
    // through the engine's sort; any non-Folders(↑) view or an active query flattens
    // to plain playlist rows — name-sorted, so pos-order stays deterministic — which
    // also lets a search reach INTO collapsed sections.
    const shelf = (view?: ViewState): PlRow[] => {
      const shelved = !view || (view.sortKey === "folders" && view.sortDir === "asc" && !view.query.trim());
      const rows: PlRow[] = [];
      let pos = 0;
      // A playlist made in DeetsMusic and exported is ONE playlist: favor the local row (it
      // carries the Apple Music sigil + "Exported on") and hide its linked Apple copy. An
      // older copy (Make a New Apple Copy) is no longer linked, so it still lists (PLAYLISTS.md §6).
      const linked = new Set(lists.map((p) => p.exportedAppleId).filter(Boolean));
      const sorted = lists.filter((p) => !(p.source === "apple" && linked.has(p.libraryId))).sort(byName);
      if (!shelved) {
        for (const p of sorted) rows.push({ pos: pos++, kind: "playlist", p });
        return rows;
      }
      // The sections are gathered first and emitted after, so the user's own order can
      // decide which comes first (MOVABLE-ROWS.md §4). The gather order below — folders
      // A-Z, then the clusters — is the BUILT-IN order: a section the rank list does not
      // name keeps its place here and falls to the end (fork 3A), which is exactly what a
      // folder made after the last drag should do.
      const blocks: { header: PlRow; members: Playlist[] }[] = [];
      // Folders always render, even empty — a just-emptied folder must stay
      // reachable for rename/delete. Empty auto-clusters just hide.
      for (const f of [...folders].sort(byName)) {
        const members = sorted.filter((p) => p.folderId === f.id);
        blocks.push({ header: { pos: 0, kind: "folder", id: f.id, label: f.name, count: members.length }, members });
      }
      const unfiled = sorted.filter((p) => p.folderId == null);
      for (const c of CLUSTERS) {
        const members = unfiled.filter((p) => clusterOf(p) === c.key);
        if (!members.length) continue;
        blocks.push({ header: { pos: 0, kind: "cluster", key: c.key, label: c.label, count: members.length }, members });
      }
      for (const b of sortByOrder("playlists.sections", blocks, (x) => sectionKey(x.header))) {
        const key = sectionKey(b.header);
        rows.push({ ...b.header, pos: pos++ } as PlRow);
        if (collapsed.has(key)) continue;
        // The playlists INSIDE the section take their own hand order (§0a): A-Z is the
        // built-in order under it, so a playlist never moved keeps the place it had.
        for (const p of sortByOrder(`playlists.folder:${key}`, b.members, (x) => pid(x)))
          rows.push({ pos: pos++, kind: "playlist", p });
      }
      return rows;
    };

    const saveCollapsed = () => {
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
      } catch {
        /* storage unavailable — collapse still works for the session */
      }
    };
    const toggleSection = (key: string) => {
      const opening = collapsed.has(key);
      frames.during("fold", 250, opening ? "open" : "close");
      if (opening) collapsed.delete(key);
      else collapsed.add(key);
      saveCollapsed();
      card.reload(); // synchronous: the section's rows exist after this
      // The opened section's rows slide in under their header; a close stays instant.
      if (opening) enterRows(rowsAfter(host.querySelector(`[data-section="${CSS.escape(key)}"]`)));
    };

    // Section header cell: the Radio .lib-shelf voice + a collapse chevron and count.
    const shelfCell = (x: PlRow & { label: string; count: number }, idx: number) =>
      `<div class="lib-shelf lib-shelf--toggle${collapsed.has(sectionKey(x)) ? " is-collapsed" : ""}" data-idx="${idx}" data-section="${esc(sectionKey(x))}"${moveHint()}>` +
      `<svg class="lib-shelf__chev" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>` +
      `<span>${esc(x.label)}</span><span class="lib-shelf__count">${x.count}</span></div>`;

    // The Pinned shelf (PINS.md): pinned playlists above the sections. A tile opens the
    // playlist, as its row does; its menu is the row's menu.
    const rootContext = (): Context => ({
      title: "Playlists",
      density: true,
      shelves: () => pinnedShelfHTML(["playlist"]),
      shelfDrag: pinDragRow, // the grip moves a pinned tile along the shelf (MOVABLE-ROWS.md §5.2)
      shelvesFirst: true,
      // The pin's own verb decides (PINS.md §8.4); this card opens a playlist in place.
      onShelf: (el) => {
        const it = pinShelfItem(el);
        if (it) pinActivate(it, "playlists", { openPlaylist: (p) => card.drill(detail(p)) });
      },
      shelfMenu: (el) => {
        const it = pinShelfItem(el);
        return it?.playlist ? listMenu(it.playlist) : [];
      },
      groupings: [
        {
          key: "playlists",
          label: "Playlists",
          sorts: [
            { key: "folders", label: "Folders", type: "num", get: (x) => x.pos },
            // Headers are already flattened out by shelf() for any non-Folders view.
            { key: "az", label: "A–Z", type: "str", get: (x) => (x.kind === "playlist" ? x.p.name : undefined) },
            { key: "added", label: "Added Date", type: "num", get: (x) => (x.kind === "playlist" ? recency(x.p.dateAdded) : undefined) },
          ],
          list: shelf,
          mixed: true, // shelf headers among rows — never windowed (collection-window.ts)
          name: (x) => (x.kind === "playlist" ? x.p.name : x.label),
          // Headers never match — a query flattens to plain playlist hits.
          match: (x, q) =>
            x.kind === "playlist" &&
            (x.p.name.toLowerCase().includes(q) || (x.p.curatorName?.toLowerCase().includes(q) ?? false)),
          render: (x, density, idx) =>
            x.kind === "playlist"
              ? musicCell(density, idx, x.p.artwork, x.p.name, subOf(x.p), {
                  badge: onApple(x.p) ? APPLE_SIGIL : "",
                  mosaic: coverOf(x.p), // the derived cover when there's no artwork
                  mosaicSeed: pid(x.p),
                })
              : shelfCell(x, idx),
          activate: (x) => {
            if (x.kind === "playlist") card.drill(detail(x.p));
            else toggleSection(sectionKey(x));
          },
          menu: (x) =>
            x.kind === "playlist" ? listMenu(x.p) : x.kind === "folder" ? folderMenu(x.id) : [],
          // A playlist row carries its songs (fetched at the drop when not cached) and takes
          // dropped songs at its end. Headers do neither.
          drag: (x) =>
            x.kind === "playlist"
              ? {
                  source: "playlists",
                  kind: "playlist",
                  count: trackCache.get(pid(x.p))?.length ?? x.p.trackCount,
                  tracks: () => tracksOf(x.p),
                  context: `playlist:${pid(x.p)}`,
                  playlistId: x.p.libraryId,
                }
              : null,
          dropOn: (x, pay) => {
            const run = x.kind === "playlist" ? dropFor(x.p, pay) : null;
            return run ? () => run(null) : null;
          },
          // Multi-select over the overview (§19): pick several playlists and play, queue or
          // file all their songs at once. Shelf and folder headers never pick, so a shift
          // run steps straight over them. The songs load lazily, at the pick, not the press.
          pick: {
            noun: "playlist",
            can: (x) => x.kind === "playlist",
            id: (x) => (x.kind === "playlist" ? pid(x.p) : ""),
            menu: (xs) => {
              const base = playlistShelfMenu(() => pickedTracks(xs), "playlists:picked", false);
              // Delete the local ones in the pick, destructive-last (the single-row menu's
              // order). Mirrors cannot be deleted, so a pick of mirrors alone has no item.
              const ps = xs.flatMap((x) => (x.kind === "playlist" ? [x.p] : []));
              const locals = ps.filter((p) => p.source === "local");
              if (!locals.length) return base;
              return [
                ...base,
                {
                  label: `Delete ${picksText(locals.length, "playlist")}`,
                  run: () => confirmDeleteMany(locals, ps.length - locals.length),
                },
              ];
            },
            drag: (xs) => ({
              source: "playlists",
              kind: "playlist",
              count: xs.reduce((n, x) => n + (x.kind === "playlist" ? trackCache.get(pid(x.p))?.length ?? x.p.trackCount ?? 0 : 0), 0),
              tracks: () => pickedTracks(xs),
              context: "playlists:picked",
            }),
            play: (xs) =>
              void pickedTracks(xs)
                .then((ts) => (ts.length ? playTracks(ts, 0, "playlists:picked") : undefined))
                .catch((e) => console.error("[playlists] play picked", e)),
          },
        } satisfies Grouping<PlRow>,
      ],
      // Hold a row to move it (MOVABLE-ROWS.md fork 6, the owner 2026-09-20). A section
      // header moves its whole section; a playlist row moves inside its OWN section, and
      // never out of it — moving between folders is the menu's Move to Folder, which says
      // what it does. A plain press and drag is untouched: it still carries the playlist's
      // songs to another card, and still drops onto another playlist row (DRAG-DROP.md §2).
      // Only in the Folders view with no query: any other sort has no sections (§4.3).
      holdDrag: (row, index, list, view, rerender) => {
        if (!sectionsMovable()) return null;
        if (view.sortKey !== "folders" || view.sortDir !== "asc" || view.query.trim()) return null;
        const items = view.items as PlRow[];
        const x = items[index];
        if (!x) return null;
        const isHead = (i: number) => items[i].kind !== "playlist";
        const base = { row, index, list, count: items.length, measure: true, hold: holdMs() };

        if (x.kind !== "playlist") {
          const key = sectionKey(x);
          const ids = items.flatMap((r) => (r.kind === "playlist" ? [] : [sectionKey(r)]));
          const wasOpen = !collapsed.has(key);
          return {
            ...base,
            // Fork 5A: the section shuts as it lifts, so one row travels.
            begin: () => {
              if (wasOpen) {
                collapsed.add(key);
                saveCollapsed();
                rerender();
              }
            },
            done: (to) => {
              const back = () => {
                if (!wasOpen) return void card.reload();
                collapsed.delete(key);
                saveCollapsed();
                card.reload();
                enterRows(rowsAfter(host.querySelector(`[data-section="${CSS.escape(key)}"]`)));
              };
              if (to == null) return back();
              // The LIVE list, not the one read at the press: fork 5A folded this section
              // shut as it lifted, so its members left the list and every row index after
              // it moved. `to` counts rows in the list as it is NOW.
              const live = view.items as PlRow[];
              const at = sectionAt(live.length, (i) => live[i].kind !== "playlist", index, to);
              void moveTo("playlists.sections", ids, key, at).then(back);
            },
          };
        }

        // A playlist row: its own section's members are the list it moves in. Nothing
        // folds here, so the list does not change under the drag — but it is read at the
        // DROP all the same, so a sync that landed meanwhile cannot shift the answer.
        if (!isHead(index) && index > 0) {
          const section = (rows: PlRow[], at: number) => {
            let head = at;
            while (head >= 0 && rows[head].kind === "playlist") head--;
            if (head < 0) return null;
            const first = head + 1;
            let last = first;
            while (last < rows.length && rows[last].kind === "playlist") last++;
            return {
              key: sectionKey(rows[head]),
              first,
              members: rows.slice(first, last).flatMap((r) => (r.kind === "playlist" ? [pid(r.p)] : [])),
            };
          };
          if (!section(items, index)) return null; // a flat list has no section to stay inside
          const id = pid(x.p);
          return {
            ...base,
            done: (to) => {
              if (to == null) return;
              const live = view.items as PlRow[];
              const at = live[index] === x ? section(live, index) : null;
              if (!at) return void card.reload();
              // The drop is clamped to this section: a hold never files a playlist elsewhere.
              const pos = Math.max(at.first, Math.min(to, at.first + at.members.length - 1)) - at.first;
              void moveTo(`playlists.folder:${at.key}`, at.members, id, pos).then(() => card.reload());
            },
          };
        }
        return null;
      },
      defaults: { grouping: "playlists", density: "lines", sortKey: "folders", sortDir: "asc" },
    });

    // Header state for the slot picker (same pattern as the Library card).
    let lastHeader = { title: "Playlists", atRoot: true };
    const headerSubs = new Set<(h: { title: string; atRoot: boolean }) => void>();
    // Card memory (CARD-MEMORY.md §5): a playlist level's key back into its context. A
    // playlist that was deleted (or has not been listed yet) resolves to null.
    const resolve = (key: string): Context | null => {
      if (!key.startsWith("playlist:")) return null;
      const id = key.slice("playlist:".length);
      const p = lists.find((x) => pid(x) === id);
      return p ? detail(p) : null;
    };
    const card = initCollectionCard({
      root: host,
      storeKey: "deets.playlists.view",
      rootContext,
      resolve,
      onReturn: mountOpts?.onReturn,
      returnTitle: mountOpts?.returnTitle,
      onHeader: (h) => {
        lastHeader = h;
        if (h.atRoot) openPlaylist = null; // backed out to the overview — nothing open to revalidate
        if (addBtn) addBtn.hidden = !h.atRoot; // New Playlist is a root-only action (create from the overview)
        if (webBtn) webBtn.hidden = !h.atRoot; // so is the web: it makes a new playlist
        headerSubs.forEach((cb) => cb(h));
      },
      grown: () => (host.dataset.grow as "wide" | "tall" | "full" | undefined) ?? null,
    });
    // A grow or a collapse of this card (CARD-GROW.md): the rows build again at the new width
    // (the letter rail in or out); the place in the list is kept.
    let lastGrow = host.dataset.grow;
    const unsubGrow = onGrowChange(() => {
      if (host.dataset.grow === lastGrow) return;
      lastGrow = host.dataset.grow;
      card.reload();
    });

    const unsubPins = onPinsChange(() => card.reload());
    // A section or a folder's rows moved, or a Reset dropped the order: rebuild `shelf()`.
    const unsubOrder = onRowOrderChange(() => card.reload());

    // ── load + sync (stale-while-revalidate, like songs) ──
    const load = () =>
      Promise.all([playlistsCached(), foldersList()])
        .then(([ps, fs]) => {
          lists = ps;
          folders = fs;
          card.reload();
        })
        .catch((e) => console.error("[playlists] load", e));

    // Eager count backfill: the flat mirror list carries no track count, so tiles
    // read "Playlist" until a count is learned. Fill the missing ones (one tiny
    // Apple call each, persisted, once ever) and re-render when any land. Gated so
    // the user can opt back to "Playlist-until-opened" (FUTURE-SETTINGS §14).
    const backfillCounts = () => {
      if (!setting("playlistEagerCounts")) return;
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
        .then(() => {
          // Seed the ♥ mirror from Apple's generated Favorite Songs list (the only
          // list-all of favorites Apple offers). One fetch per session; cache-first.
          if (favoritesSeeded) return;
          const fav = lists.find((p) => p.source === "apple" && p.name === "Favorite Songs" && !p.canEdit);
          if (!fav) return;
          favoritesSeeded = true;
          return playlistTracks(fav).then(() => initFavorites());
        })
        .catch((e) => console.error("[playlists] sync", e))
        .finally(() => refreshBtn?.classList.remove("is-busy"));
    };

    // Card memory (CARD-MEMORY.md §4): the playlists must be listed before a key resolves, so
    // the body waits (hidden) until the first load lands. A held open request wins over it.
    if (mountOpts?.memory) card.hold();
    void load()
      .then(() => {
        if (mountOpts?.memory && !tookRequest && card.depth() === 1) card.restore(mountOpts.memory);
      })
      .then(backfillCounts); // cached list renders instantly; counts fill in
    if (!sessionSynced) {
      sessionSynced = true;
      doSync(false);
    }
    refreshBtn?.addEventListener("click", () => doSync(true));

    // A Your Playlists tile on an artist view opens its playlist here (ARTIST-VIEW.md §5). A
    // request made while this card mounted waits in the bus; a later one arrives live. A
    // playlist not in the list yet (the first load still running) opens once it lands.
    // Songs fetched by the chip flight seed the cache, so the view slides in full.
    let tookRequest = false; // a held request beats card memory (CARD-MEMORY.md §4 rule 1)
    const openRequested = (req: OpenPlaylistRequest | null) => {
      if (!req) return;
      tookRequest = true;
      const open = (p: Playlist) => {
        if (req.tracks) {
          req.tracks.forEach((t, i) => posOf.set(t, i));
          trackCache.set(pid(p), req.tracks);
          reconcile(req.tracks);
        }
        card.drill(detail(p));
      };
      const hit = lists.find((x) => x.libraryId === req.id);
      if (hit) return open(hit);
      void load().then(() => {
        const p = lists.find((x) => x.libraryId === req.id);
        if (p) open(p);
      });
    };
    const unsubOpen = onOpenPlaylistRequest(() => openRequested(takeOpenPlaylistRequest()));
    openRequested(takeOpenPlaylistRequest());

    // Local-store change bus: any create / add-tracks / delete (from ANY card —
    // Library, Search, or here) refreshes the list and, when a specific playlist
    // was touched, evicts + refetches its content cache so an open detail pane
    // live-updates instead of going stale.
    const unsubChanges = onPlaylistsChange((rowid, appleId) => {
      // Songs added straight to an Apple playlist (§10.9): Rust dropped its content cache.
      // Refetch only when its detail is open; otherwise the next open reads it.
      if (appleId) {
        if (openPlaylist?.libraryId === appleId) revalidate(openPlaylist);
        else trackCache.delete(appleId);
      }
      if (rowid != null) {
        const key = `local:${rowid}`;
        const p = lists.find((x) => x.libraryId === key);
        // Refetch over the cached entry (no blank pane in between); a playlist this card
        // hasn't listed yet (just created, just deleted) simply drops its entry.
        if (p) revalidate(p);
        else trackCache.delete(key);
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
          // FUTURE-SETTINGS §16. Mini shows one card, so a summon there replaces the playlist
          // you just made — "Not in mini" (the default) keeps it beside you only where there
          // is room for both.
          const summon = setting("playlistCreateSummon");
          if (summon === "always" || (summon === "notmini" && currentSurface() !== "mini")) requestCard("search");
        })
        .catch((e) => {
          console.error("[playlists] create", e);
          toast({ kind: "warn", text: "Couldn't create the playlist." });
        });

    // Two labelled create fields (playlist / folder): a new playlist drills in and
    // summons Search; a new folder just appears as an (empty, collapsible) section.
    if (addBtn)
      addBtn.addEventListener("click", () => {
        openContextMenuUnder(addBtn, [
          { input: { label: "Playlist", placeholder: "Playlist name", onSubmit: (name) => void createAndEnter(name) } },
          {
            input: {
              label: "Folder",
              placeholder: "Folder name",
              onSubmit: (name) =>
                void folderCreate(name).catch((e) => {
                  console.error("[playlists] create folder", e);
                  toast({ kind: "warn", text: "Couldn't create the folder." });
                }),
            },
          },
        ]);
      });

    return {
      snapshot: () => card.snapshot(),
      destroy() {
        unsubChanges();
        unsubOpen();
        unsubGrow();
        unsubPins();
        unsubOrder();
        unmountWeb?.();
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
