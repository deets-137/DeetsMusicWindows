// Playlists data access (PLAYLISTS.md). Thin wrappers over the Rust store: the
// unified cached list (local + Apple mirror), the mirror sync, and per-playlist
// tracks. The frontend only ever sees the normalized model.

import { invoke } from "@tauri-apps/api/core";
import type { Track } from "./library";
import type { Playlist } from "./search";
import type { MenuItem } from "./context-menu";
import { toast, noticeOff } from "./toast";
import { setting } from "./settings-store";
import { APPLE_SIGIL } from "./apple-sigil";

// ── change bus (same subscribe idiom as layout-bus / onPlayerState) ────────────
// Fires after any LOCAL-store mutation (create / add tracks / delete), with the
// touched playlist's rowid when there is one — mounted cards refresh counts and
// evict/refetch that playlist's content cache. An add straight to an Apple playlist
// (§10.9) passes that playlist's Apple id instead.
type ChangeCb = (rowid?: number, appleId?: string) => void;
const changeSubs = new Set<ChangeCb>();
export function onPlaylistsChange(cb: ChangeCb): () => void {
  changeSubs.add(cb);
  return () => changeSubs.delete(cb);
}
const emitChange = (rowid?: number, appleId?: string) => changeSubs.forEach((cb) => cb(rowid, appleId));

// ── toast wording shared by the Apple writes (export, add to an Apple playlist) ──

/** “A”, “A” and “B”, “A”, “B” and 3 more. */
export function names(titles: string[]): string {
  const q = titles.slice(0, 2).map((t) => `“${t}”`);
  const more = titles.length - q.length;
  if (more > 0) return `${q.join(", ")} and ${more} more`;
  return q.join(" and ");
}

export const songs = (n: number) => `${n} song${n === 1 ? "" : "s"}`;
/** Uploads can't go to Apple: name them, the dead-song way (§10.5). */
export const skippedLine = (titles: string[]) =>
  titles.length
    ? ` ${songs(titles.length)} skipped: ${names(titles)} ${titles.length === 1 ? "isn't" : "aren't"} in the Apple Music catalog.`
    : "";

/** The unified cached list — local playlists + the Apple mirror. Zero Apple calls. */
export function playlistsCached(): Promise<Playlist[]> {
  return invoke<Playlist[]>("playlists_cached");
}

/**
 * Refresh the Apple mirror. `fresh: false` (the once-per-session auto-sync) keeps
 * unchanged playlists' content caches; `fresh: true` (the explicit ⟳) drops them all
 * so the next open of each playlist refetches current contents.
 */
export function applePlaylistsSync(fresh = false): Promise<number> {
  return invoke<number>("apple_playlists_sync", { fresh });
}

/**
 * Backfill missing "N songs" counts for Apple mirror playlists. The flat list carries
 * no count, so each uncounted playlist costs ONE tiny `tracks?limit=1` call (reads
 * `meta.total`), persisted onto the row — a playlist is counted once ever, then cached.
 * Returns how many were filled (0 if none were missing). Gated by the eager-counts
 * setting (FUTURE-SETTINGS §14); the alternative is showing "Playlist" until opened.
 */
export function applePlaylistCounts(): Promise<number> {
  return invoke<number>("apple_playlist_counts");
}

/** Create an empty local playlist; returns its rowid (list id = `local:{rowid}`).
 *  `role` "replay" marks one made from listening (replay.ts, PLAYLISTS.md §10.8). */
export function playlistCreate(name: string, role?: "replay"): Promise<number> {
  return invoke<number>("playlist_create", { name, description: null, role: role ?? null }).then((id) => {
    emitChange(id);
    return id;
  });
}

/** Append tracks to a LOCAL playlist (denormalised snapshots — zero Apple calls). */
export function playlistAddTracks(id: number, tracks: Track[]): Promise<void> {
  return invoke<void>("playlist_add_tracks", { id, tracks }).then(() => emitChange(id));
}

/** The local-vs-mirror id seam: local playlists ride a synthetic `local:{rowid}`. */
const localId = (p: Playlist): number | null => {
  const m = /^local:(\d+)$/.exec(p.libraryId ?? "");
  return m ? Number(m[1]) : null;
};

/** Made from listening (replay.ts): never an add target, and never renamed, reordered, or
 *  edited by hand (PLAYLISTS.md §10.8). */
export const isReplay = (p: Playlist): boolean => p.role === "replay";

/** The user's own cover, served at the app's cover link (PLAYLISTS.md §10.6) — not the
 *  artwork of its Apple copy, which can't be removed here. */
export const ownCover = (p: Playlist): boolean => !!p.artwork?.urlTemplate.startsWith("http://cover.localhost/");

/** Rename a LOCAL playlist. Its Apple copy keeps the old name (Apple can't rename). */
export function playlistRename(p: Playlist, name: string): Promise<void> {
  const id = localId(p);
  if (id == null) return Promise.reject(new Error(`playlist "${p.name}" is not local`));
  return invoke<void>("playlist_rename", { id, name }).then(() => emitChange(id));
}

/** Move one entry of a LOCAL playlist: remove at `from`, insert at `to` (authored positions). */
export function playlistReorder(p: Playlist, from: number, to: number): Promise<void> {
  const id = localId(p);
  if (id == null) return Promise.reject(new Error(`playlist "${p.name}" is not local`));
  return invoke<void>("playlist_reorder", { id, from, to }).then(() => emitChange(id));
}

/**
 * Remove one entry from a LOCAL playlist by its AUTHORED position (not song id —
 * duplicates are legal, so position is the row's identity). The store compacts
 * positions on rewrite, so no gaps are left behind.
 */
export function playlistRemoveTrack(p: Playlist, position: number): Promise<void> {
  const id = localId(p);
  if (id == null) return Promise.reject(new Error(`playlist "${p.name}" is not local`));
  return invoke<void>("playlist_remove_track", { id, position }).then(() => emitChange(id));
}

/**
 * Set (an image data URL, already resized by the picker) or clear a LOCAL playlist's
 * own cover (NEXT-VERSION §2). Local only — Apple's API cannot receive a cover.
 */
export function playlistSetCover(p: Playlist, cover: string | null): Promise<void> {
  const id = localId(p);
  if (id == null) return Promise.reject(new Error(`playlist "${p.name}" is not local`));
  return invoke<void>("playlist_set_cover", { id, cover }).then(() => emitChange(id));
}

/** What an export would do (PLAYLISTS.md §6), computed before any Apple write. */
export interface ExportPlan {
  /** The Apple copy compared against; null when there is none (it was deleted on Apple). */
  appleId: string | null;
  /** Catalog ids the append would send, in local order, and their titles. */
  addIds: string[];
  addTitles: string[];
  /** Songs on the Apple copy that the local playlist no longer has (Apple can't remove them). */
  removedTitles: string[];
  /** After the append, Apple's order would differ from the local order. */
  reordered: boolean;
  /** Titles of the local songs with no catalog id (uploads): Apple can't receive them. */
  skippedTitles: string[];
}

export interface ExportResult {
  appleId: string;
  added: number;
  /** Songs the append calls could not add (a partial failure after the create). */
  failed: number;
  skippedTitles: string[];
}

export interface GetSongsResult {
  /** The Apple copy read; null when it is gone (nothing was read). */
  appleId: string | null;
  /** Songs added to the end of the local playlist. */
  addedTitles: string[];
}

/** Get New Songs (PLAYLISTS.md §10.4): add the songs only the Apple copy has, at the end.
 *  One Apple read per 100 songs; the write is local. */
export function playlistGetAppleSongs(p: Playlist): Promise<GetSongsResult> {
  const id = localId(p);
  if (id == null) return Promise.reject(new Error(`playlist "${p.name}" is not local`));
  return invoke<GetSongsResult>("playlist_get_apple_songs", { id }).then((r) => {
    if (r.addedTitles.length) emitChange(id);
    return r;
  });
}

/** Compare a LOCAL playlist with its Apple copy. One Apple read per 100 songs; no writes. */
export function playlistExportPlan(p: Playlist): Promise<ExportPlan> {
  const id = localId(p);
  if (id == null) return Promise.reject(new Error(`playlist "${p.name}" is not local`));
  return invoke<ExportPlan>("playlist_export_plan", { id });
}

/** Write to Apple Music: `new` makes a fresh copy with every song; `append` sends `ids`
 *  (from a plan) to the current copy. Emits a change so the row's export stamp refreshes. */
export function playlistExportApple(p: Playlist, mode: "new" | "append", ids?: string[]): Promise<ExportResult> {
  const id = localId(p);
  if (id == null) return Promise.reject(new Error(`playlist "${p.name}" is not local`));
  return invoke<ExportResult>("playlist_export_apple", { id, mode, ids: ids ?? null }).then((r) => {
    emitChange(id);
    return r;
  });
}

export interface ImportResult {
  /** The new local playlist's rowid. */
  id: number;
  /** The copy took the original as its Apple copy (the user's own playlist): one row. */
  linked: boolean;
}

/** Import to Edit (PLAYLISTS.md §10.9): copy a mirror playlist into a new local playlist.
 *  Zero Apple calls when its songs are cached, else one read per 100 songs. */
export function playlistImport(p: Playlist): Promise<ImportResult> {
  if (p.source !== "apple" || !p.libraryId) return Promise.reject(new Error(`playlist "${p.name}" is not an Apple playlist`));
  return invoke<ImportResult>("playlist_import", { appleId: p.libraryId }).then((r) => {
    emitChange(r.id);
    return r;
  });
}

export interface AppleAddResult {
  added: number;
  failed: number;
  skippedTitles: string[];
}

/** Add songs straight to the user's own Apple playlist (§10.9). Apple appends at the end;
 *  DeetsMusic can't remove them afterwards. One write per 100 songs. */
export function applePlaylistAdd(p: Playlist, tracks: Track[]): Promise<AppleAddResult> {
  if (p.source !== "apple" || !p.canEdit || !p.libraryId)
    return Promise.reject(new Error(`playlist "${p.name}" is not an editable Apple playlist`));
  const appleId = p.libraryId;
  return invoke<AppleAddResult>("apple_playlist_add", { appleId, tracks }).then((r) => {
    emitChange(undefined, appleId);
    return r;
  });
}

/** The first add to an Apple playlist asks once (§10.9); [Add] turns the question off. */
const APPLE_ADD_KEY = "deets.notice.appleAdd";

function addToApple(p: Playlist, getTracks: () => Track[] | Promise<Track[]>): void {
  const go = () =>
    Promise.resolve(getTracks())
      .then((ts) => (ts.length ? applePlaylistAdd(p, ts) : null))
      .then((r) => {
        if (!r) return;
        const skipped = skippedLine(r.skippedTitles);
        if (!r.added) {
          toast({ kind: "warn", text: `Nothing was added to “${p.name}” on Apple Music.${skipped}` });
          return;
        }
        const failed = r.failed ? ` Couldn't add ${songs(r.failed)}.` : "";
        toast({
          kind: r.failed || r.skippedTitles.length ? "warn" : "success",
          text: `Added ${songs(r.added)} to “${p.name}” on Apple Music.${failed}${skipped}`,
        });
      })
      .catch((e) => {
        console.error("[playlists] add to Apple playlist", e);
        toast({ kind: "warn", text: `Couldn't add to “${p.name}” on Apple Music.` });
      });
  if (noticeOff(APPLE_ADD_KEY)) return void go();
  toast({
    kind: "info",
    sticky: true,
    text: `Add to “${p.name}” on Apple Music? DeetsMusic can't remove songs from it afterwards.`,
    actions: [
      {
        label: "Add",
        run: () => {
          try {
            localStorage.setItem(APPLE_ADD_KEY, "off");
          } catch {
            /* storage unavailable — it asks again next time */
          }
          void go();
        },
      },
      { label: "Cancel" },
    ],
  });
}

/** Delete a LOCAL playlist. Mirrors can't be deleted — there's no Apple write path. */
export function playlistDelete(p: Playlist): Promise<void> {
  const id = localId(p);
  if (id == null) return Promise.reject(new Error(`playlist "${p.name}" is not local`));
  return invoke<void>("playlist_delete", { id }).then(() => emitChange(id));
}

/**
 * The shared "Add to Playlist ▸" menu entry (PLAYLISTS.md §4, §10.9). Targets are the
 * hand-made LOCAL playlists and, while Settings › Apple Music › Export playlists is on,
 * the user's own Apple playlists (`canEdit`, one mixed list, each with the Apple Music
 * sigil; the first add asks once). A linked Apple copy is not listed: its local playlist
 * is. Most recently added first (FUTURE-SETTINGS §15), under a "New Playlist…" field that
 * creates-and-adds in one gesture. `getTracks` resolves lazily on pick, so
 * fetch-heavy sources (Search collections) cost nothing until committed.
 * `excludeLibraryId` drops one target — a playlist can't bulk-add to itself.
 */
export function addToPlaylistItem(
  getTracks: () => Track[] | Promise<Track[]>,
  excludeLibraryId?: string,
): MenuItem {
  const err = (what: string, text: string) => (e: unknown) => {
    console.error(`[playlists] ${what}`, e);
    toast({ kind: "warn", text });
  };
  const addTo = (id: number) =>
    Promise.resolve(getTracks())
      .then((ts) => (ts.length ? playlistAddTracks(id, ts) : undefined))
      .catch(err("add to playlist", "Couldn't add to the playlist."));
  return {
    label: "Add to Playlist",
    sub: () =>
      playlistsCached().then((all) => {
        // A Replay is made from listening, not by hand: never a target (§10.8).
        const apple = setting("playlistExport");
        const linked = new Set(all.map((p) => p.exportedAppleId).filter(Boolean));
        const targets = all.filter(
          (p) =>
            p.libraryId !== excludeLibraryId &&
            (localId(p) != null
              ? !isReplay(p)
              : apple && p.source === "apple" && p.canEdit && !linked.has(p.libraryId)),
        );
        const when = (p: Playlist) => Date.parse(p.dateAdded ?? "") || 0;
        targets.sort((a, b) => when(b) - when(a)); // recent first — FUTURE-SETTINGS §15
        const items: MenuItem[] = [
          {
            input: {
              placeholder: "New Playlist…",
              onSubmit: (name) => void playlistCreate(name).then(addTo).catch(err("create", "Couldn't create the playlist.")),
            },
          },
          ...targets.map((p): MenuItem => {
            const id = localId(p);
            return id != null
              ? { label: p.name, run: () => void addTo(id) }
              : { label: p.name, badge: APPLE_SIGIL, run: () => addToApple(p, getTracks) };
          }),
        ];
        return items;
      }),
  };
}

// ── Folders (manual grouping over the unified list — PLAYLISTS.md §Folders) ────
// All local SQLite; mutations ride the change bus so every mounted card refreshes.

export interface PlaylistFolder {
  id: number;
  name: string;
}

export function foldersList(): Promise<PlaylistFolder[]> {
  return invoke<PlaylistFolder[]>("playlist_folders_list");
}

export function folderCreate(name: string): Promise<number> {
  return invoke<number>("playlist_folder_create", { name }).then((id) => {
    emitChange();
    return id;
  });
}

export function folderRename(id: number, name: string): Promise<void> {
  return invoke<void>("playlist_folder_rename", { id, name }).then(() => emitChange());
}

/** Delete a folder; its members become unfiled (playlists untouched). */
export function folderDelete(id: number): Promise<void> {
  return invoke<void>("playlist_folder_delete", { id }).then(() => emitChange());
}

/** File a playlist (local or mirror — keyed on its libraryId) or unfile with null. */
export function folderAssign(p: Playlist, folderId: number | null): Promise<void> {
  if (!p.libraryId) return Promise.reject(new Error(`playlist "${p.name}" has no library id`));
  return invoke<void>("playlist_folder_assign", { playlistKey: p.libraryId, folderId }).then(() =>
    emitChange(),
  );
}

/** A playlist's tracks in authored order — local store or mirror cache/fetch. */
export function playlistTracks(p: Playlist): Promise<Track[]> {
  const local = localId(p);
  if (local != null) return invoke<Track[]>("local_playlist_tracks", { id: local });
  if (!p.libraryId) return Promise.reject(new Error(`playlist "${p.name}" has no library id`));
  return invoke<Track[]>("apple_playlist_tracks", { id: p.libraryId });
}
