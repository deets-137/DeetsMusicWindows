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
  playlistsCached, applePlaylistsSync, applePlaylistCounts, playlistTracks, playlistCreate, playlistDelete,
  playlistRemoveTrack, playlistRename, playlistReorder, playlistSetCover, playlistImport, addToPlaylistItem, onPlaylistsChange,
  foldersList, folderCreate, folderRename, folderDelete, folderAssign, isReplay, ownCover, type PlaylistFolder,
} from "./playlists";
import type { Playlist } from "./search";
import type { Track } from "./library";
import { playTracks, queueTracksNext, queueTracksLater } from "./player";
import { addSongToLibraryItem } from "./library-add";
import { initFavorites, reconcile } from "./favorites";
import { initCollectionCard, esc, formatTotal, type Context, type Grouping, type SortSpec, type ViewState } from "./collection-card";
import { musicCell, trackMenu, explicitBadge, heroCover } from "./library-card";
import { openContextMenuUnder, type MenuItem } from "./context-menu";
import { appleMusicItem } from "./playlist-export";
import { APPLE_SIGIL } from "./apple-sigil";
import { enterRows, rowsAfter } from "./pop";
import { requestCard } from "./layout-bus";
import { toast } from "./toast";
import type { CardDef } from "./cards";

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

const sectionKey = (x: PlRow) => (x.kind === "folder" ? `folder:${x.id}` : x.kind === "cluster" ? x.key : "");

const byName = <T extends { name: string }>(a: T, b: T) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

// Unfiled auto-clusters, fixed order. "Local Playlists" are made in DeetsMusic; "Your
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
  { key: "local", label: "Local Playlists" },
  { key: "yours", label: "Your Apple Playlists" },
  { key: "mixes", label: "Apple Mixes" },
  { key: "replays", label: "Replays" },
  { key: "apple", label: "From Apple Music" },
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
    migrateSortPref(); // before the engine reads the persisted view prefs
    const refreshBtn = host.querySelector<HTMLElement>("#playlists-refresh");
    const addBtn = host.querySelector<HTMLElement>("#playlists-add");

    let lists: Playlist[] = [];
    let folders: PlaylistFolder[] = [];
    const collapsed = loadCollapsed();
    let openPlaylist: Playlist | null = null; // the drilled-into playlist, or null at overview
    const trackCache = new Map<string, Track[]>(); // pid → authored-order tracks
    const posOf = new WeakMap<Track, number>(); // authored position (Playlist-Order sort)
    const pending = new Set<string>();
    const refetchAgain = new Set<string>(); // a change landed while a revalidate was in flight

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

    // The derived cover (NEXT-VERSION §2), computed HERE from the tracks in hand: the first
    // four distinct track-cover templates among the first 40 rows — the same rule as Rust's
    // `mosaic_urls`, which only sees the content cache and so is empty on a playlist's
    // first open (and partial while a paged fetch is still landing). With the tracks
    // cached, this is the truth; the playlist row's own `coverUrls` is the fallback.
    const mosaicOf = (ts: Track[] | undefined): string[] | undefined => {
      if (!ts?.length) return undefined;
      const urls: string[] = [];
      for (const t of ts.slice(0, 40)) {
        const u = t.artwork?.urlTemplate;
        if (u && !urls.includes(u)) {
          urls.push(u);
          if (urls.length === 4) break;
        }
      }
      return urls.length ? urls : undefined;
    };
    const coverOf = (p: Playlist): string[] | undefined => mosaicOf(trackCache.get(pid(p))) ?? p.coverUrls;

    // Drill-in loader: `open` is synchronous, so the detail context reads from the
    // cache and this kicks the fetch; the reload re-renders the (detail) pane when
    // the tracks land. Overview subtitles pick the count up on the way back.
    const ensureTracks = (p: Playlist) => {
      const id = pid(p);
      if (trackCache.has(id) || pending.has(id)) return;
      pending.add(id);
      tracksOf(p)
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
        render: (t, density, idx) => musicCell(density, idx, t.artwork, t.title, t.artistName, { badge: explicitBadge(t) }),
        // Click a song → play the playlist from here, in the current sort order.
        activate: (_t, idx, items) =>
          void playTracks(items, idx, ctxTag).catch((e) => console.error("[playlists] play", e)),
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
            cover: heroCover(q.artwork, q.name, coverOf(q)), // live: fills in when the tracks land
            title: q.name,
            meta: [
              n != null ? `${n} song${n === 1 ? "" : "s"}` : "",
              total,
              source,
              // A local playlist with a live Apple copy: when it was last written there.
              local && q.exportedAt && onApple(q)
                ? `Exported on ${new Date(q.exportedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
                : "",
            ].filter(Boolean).join(" · "),
            // A local playlist's cover is a button (1B) and takes a dropped image file (3B).
            // An Apple playlist's cover offers Import to Edit, its one way to an editable copy.
            coverMenu: local ? () => coverItems(q, "Choose Image…") : q.source === "apple" ? () => [importItem(q)] : undefined,
            coverDrop: local ? (file: File) => setCoverFromFile(q, file) : undefined,
          };
        },
        density: true,
        groupings: [grouping],
        defaults: { density: "lines", sortKey: "order" },
        emptyText: "Add songs from your Library or Search.",
      };
    };

    // On Apple Music: a mirror, or a local playlist whose exported copy is still in the mirror
    // (PLAYLISTS.md §6) — both carry the Apple Music sigil in the list.
    const onApple = (p: Playlist) =>
      p.source === "apple" || (!!p.exportedAppleId && lists.some((m) => m.source === "apple" && m.libraryId === p.exportedAppleId));

    // ── overview: the unified list ──
    const subOf = (p: Playlist) => {
      const n = trackCache.get(pid(p))?.length ?? p.trackCount;
      if (n != null) return `${n} song${n === 1 ? "" : "s"}`;
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
      items.push({ label: pickLabel, run: () => pickCover(p) });
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
      const section = (header: PlRow, members: Playlist[]) => {
        rows.push(header);
        if (!collapsed.has(sectionKey(header))) for (const p of members) rows.push({ pos: pos++, kind: "playlist", p });
      };
      // Folders always render, even empty — a just-emptied folder must stay
      // reachable for rename/delete. Empty auto-clusters just hide.
      for (const f of [...folders].sort(byName)) {
        const members = sorted.filter((p) => p.folderId === f.id);
        section({ pos: pos++, kind: "folder", id: f.id, label: f.name, count: members.length }, members);
      }
      const unfiled = sorted.filter((p) => p.folderId == null);
      for (const c of CLUSTERS) {
        const members = unfiled.filter((p) => clusterOf(p) === c.key);
        if (!members.length) continue;
        section({ pos: pos++, kind: "cluster", key: c.key, label: c.label, count: members.length }, members);
      }
      return rows;
    };

    const toggleSection = (key: string) => {
      const opening = collapsed.has(key);
      frames.during("fold", 250, opening ? "open" : "close");
      if (opening) collapsed.delete(key);
      else collapsed.add(key);
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
      } catch {
        /* storage unavailable — collapse still works for the session */
      }
      card.reload(); // synchronous: the section's rows exist after this
      // The opened section's rows slide in under their header; a close stays instant.
      if (opening) enterRows(rowsAfter(host.querySelector(`[data-section="${CSS.escape(key)}"]`)));
    };

    // Section header cell: the Radio .lib-shelf voice + a collapse chevron and count.
    const shelfCell = (x: PlRow & { label: string; count: number }, idx: number) =>
      `<div class="lib-shelf lib-shelf--toggle${collapsed.has(sectionKey(x)) ? " is-collapsed" : ""}" data-idx="${idx}" data-section="${esc(sectionKey(x))}">` +
      `<svg class="lib-shelf__chev" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>` +
      `<span>${esc(x.label)}</span><span class="lib-shelf__count">${x.count}</span></div>`;

    const rootContext = (): Context => ({
      title: "Playlists",
      density: true,
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
                })
              : shelfCell(x, idx),
          activate: (x) => {
            if (x.kind === "playlist") card.drill(detail(x.p));
            else toggleSection(sectionKey(x));
          },
          menu: (x) =>
            x.kind === "playlist" ? listMenu(x.p) : x.kind === "folder" ? folderMenu(x.id) : [],
        } satisfies Grouping<PlRow>,
      ],
      defaults: { grouping: "playlists", density: "lines", sortKey: "folders", sortDir: "asc" },
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
          if (setting("playlistCreateSummon")) requestCard("search"); // FUTURE-SETTINGS §16
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
