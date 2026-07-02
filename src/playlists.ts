// Playlists data access (PLAYLISTS.md). Thin wrappers over the Rust store: the
// unified cached list (local + Apple mirror), the mirror sync, and per-playlist
// tracks. The frontend only ever sees the normalized model.

import { invoke } from "@tauri-apps/api/core";
import type { Track } from "./library";
import type { Playlist } from "./search";

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

/** The local-vs-mirror id seam: local playlists ride a synthetic `local:{rowid}`. */
const localId = (p: Playlist): number | null => {
  const m = /^local:(\d+)$/.exec(p.libraryId ?? "");
  return m ? Number(m[1]) : null;
};

/** A playlist's tracks in authored order — local store or mirror cache/fetch. */
export function playlistTracks(p: Playlist): Promise<Track[]> {
  const local = localId(p);
  if (local != null) return invoke<Track[]>("local_playlist_tracks", { id: local });
  if (!p.libraryId) return Promise.reject(new Error(`playlist "${p.name}" has no library id`));
  return invoke<Track[]>("apple_playlist_tracks", { id: p.libraryId });
}
