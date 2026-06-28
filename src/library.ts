// Library data access. Talks to the Rust cache (SQLite) and the sync command.
// The frontend never sees Apple shapes — only our normalized Track.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface Track {
  libraryId?: string;
  catalogId?: string;
  title: string;
  artistName: string;
  albumName?: string;
  durationMs?: number;
  trackNumber?: number;
  discNumber?: number;
  genres: string[];
  contentRating?: string;
  hasLyrics: boolean;
  isrc?: string;
  releaseDate?: string;
  dateAdded?: string;
  artwork?: Artwork;
}

export interface Artwork {
  urlTemplate: string;
  width: number;
  height: number;
  bgColor?: string;
  textColors?: string[];
}

export interface Page<T> {
  items: T[];
  total: number;
  nextOffset: number | null;
}

export interface SyncEvent {
  phase: "start" | "progress" | "done";
  fetched?: number;
  count?: number;
  total?: number;
}

/** Read cached tracks (ordered by title/artist). */
export function libraryTracks(offset = 0, limit = 200): Promise<Page<Track>> {
  return invoke<Page<Track>>("library_tracks", { offset, limit });
}

/** Trigger a full background sync of library songs into the cache. */
export function librarySync(): Promise<number> {
  return invoke<number>("library_sync");
}

/** Subscribe to sync progress. Returns an unlisten fn. */
export function onSyncEvent(cb: (e: SyncEvent) => void): Promise<UnlistenFn> {
  return listen<SyncEvent>("library-sync", (event) => cb(event.payload));
}
