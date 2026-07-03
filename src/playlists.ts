// Playlists data access (PLAYLISTS.md). Thin wrappers over the Rust store: the
// unified cached list (local + Apple mirror), the mirror sync, and per-playlist
// tracks. The frontend only ever sees the normalized model.

import { invoke } from "@tauri-apps/api/core";
import type { Track } from "./library";
import type { Playlist } from "./search";
import type { MenuItem } from "./context-menu";

// ── change bus (same subscribe idiom as layout-bus / onPlayerState) ────────────
// Fires after any LOCAL-store mutation (create / add tracks / delete), with the
// touched playlist's rowid when there is one — mounted cards refresh counts and
// evict/refetch that playlist's content cache.
type ChangeCb = (rowid?: number) => void;
const changeSubs = new Set<ChangeCb>();
export function onPlaylistsChange(cb: ChangeCb): () => void {
  changeSubs.add(cb);
  return () => changeSubs.delete(cb);
}
const emitChange = (rowid?: number) => changeSubs.forEach((cb) => cb(rowid));

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

/** Create an empty local playlist; returns its rowid (list id = `local:{rowid}`). */
export function playlistCreate(name: string): Promise<number> {
  return invoke<number>("playlist_create", { name, description: null }).then((id) => {
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

/** Delete a LOCAL playlist. Mirrors can't be deleted — there's no Apple write path. */
export function playlistDelete(p: Playlist): Promise<void> {
  const id = localId(p);
  if (id == null) return Promise.reject(new Error(`playlist "${p.name}" is not local`));
  return invoke<void>("playlist_delete", { id }).then(() => emitChange(id));
}

/**
 * The shared "Add to Playlist ▸" menu entry (PLAYLISTS.md §4). Targets are LOCAL
 * playlists only (mirrors are read-only — the Apple write ceiling), listed most
 * recently added first (FUTURE-SETTINGS §15) under a "New Playlist…" field that
 * creates-and-adds in one gesture. `getTracks` resolves lazily on pick, so
 * fetch-heavy sources (Search collections) cost nothing until committed.
 * `excludeLibraryId` drops one target — a playlist can't bulk-add to itself.
 */
export function addToPlaylistItem(
  getTracks: () => Track[] | Promise<Track[]>,
  excludeLibraryId?: string,
): MenuItem {
  const err = (what: string) => (e: unknown) => console.error(`[playlists] ${what}`, e);
  const addTo = (id: number) =>
    Promise.resolve(getTracks())
      .then((ts) => (ts.length ? playlistAddTracks(id, ts) : undefined))
      .catch(err("add to playlist"));
  return {
    label: "Add to Playlist",
    sub: () =>
      playlistsCached().then((all) => {
        const locals = all.filter(
          (p) => localId(p) != null && p.libraryId !== excludeLibraryId,
        );
        const when = (p: Playlist) => Date.parse(p.dateAdded ?? "") || 0;
        locals.sort((a, b) => when(b) - when(a)); // recent first — FUTURE-SETTINGS §15
        const items: MenuItem[] = [
          {
            input: {
              placeholder: "New Playlist…",
              onSubmit: (name) => void playlistCreate(name).then(addTo).catch(err("create")),
            },
          },
          ...locals.map((p) => ({ label: p.name, run: () => void addTo(localId(p)!) })),
        ];
        return items;
      }),
  };
}

/** A playlist's tracks in authored order — local store or mirror cache/fetch. */
export function playlistTracks(p: Playlist): Promise<Track[]> {
  const local = localId(p);
  if (local != null) return invoke<Track[]>("local_playlist_tracks", { id: local });
  if (!p.libraryId) return Promise.reject(new Error(`playlist "${p.name}" has no library id`));
  return invoke<Track[]>("apple_playlist_tracks", { id: p.libraryId });
}
