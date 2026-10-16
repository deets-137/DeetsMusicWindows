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
  /** Apple's `composerName`: the writers as one flat string, no roles (docs/features/CREDITS.md). */
  composer?: string;
  /** Catalog-only: 30s preview stream URL (rides search results). */
  previewUrl?: string;
  releaseDate?: string;
  addedRank?: number;
  artwork?: Artwork;
  /** A song Apple lists but does not play yet (a pre-release album). Its `releaseDate` is
   *  then the album's. Never queued; dimmed on the album page (src/release.ts). */
  unreleased?: boolean;
  /** A library song's one library artist (the sync's `include=artists`); its catalog twin is
   *  the song's primary artist (primary-artist.ts, ideas/apple-calls.md §5). */
  libraryArtist?: string;
  /** The library album's own artist: names the album over its songs' guest credits. */
  albumArtist?: string;
  /** The library album's id (`l.…`). */
  libraryAlbumId?: string;
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
  /** `idle`: the sync lock is released. It comes after `done` / `error`, once the artist
   *  pass and the heal have ended too; a ⟳ click is refused until then. */
  phase: "start" | "progress" | "done" | "error" | "idle";
  fetched?: number;
  count?: number;
  total?: number;
  /** Set on `error`: which pages failed after a retry. The cache holds what DID fetch. */
  message?: string;
  /** Set on `error`: Apple's 429 back-off holds — Apple is busy, not the network (2026-09-29). */
  busy?: boolean;
  /** Set on `error`: the app started this pass itself (a background job, APPLE-CALLS.md §3). */
  background?: boolean;
  /** Set on `done`: how many cached rows really changed. 0 = nothing to reload. */
  changed?: number;
}

/** Read cached tracks (ordered by title/artist). */
export function libraryTracks(offset = 0, limit = 200): Promise<Page<Track>> {
  return invoke<Page<Track>>("library_tracks", { offset, limit });
}

/** Read the materialized ('seen') catalog-only tracks — the durable metadata for
 *  plays that aren't in the library. The track store ingests them as transients. */
export function seenTracks(): Promise<Track[]> {
  return invoke<Track[]>("seen_tracks");
}

/** Trigger a background sync of library songs into the cache. `full: true` (the
 *  refresh button) is the complete pass; `false` (startup) lets Rust pick — the cheap
 *  newest-first pass when Apple's song count is unchanged and the last full pass is under
 *  seven days old (DATA-ARCHITECTURE.md §5a). `signin` (after a sign-in) also checks whether
 *  another Apple account signed in, and forgets the old library if so (§5b). */
export function librarySync(full = true, signin = false): Promise<number> {
  return invoke<number>("library_sync", { full, signin });
}

/** Subscribe to sync progress. Returns an unlisten fn. */
export function onSyncEvent(cb: (e: SyncEvent) => void): Promise<UnlistenFn> {
  return listen<SyncEvent>("library-sync", (event) => cb(event.payload));
}

// ── Is a sync running? (the Library ⟳'s spin, 2026-10-15) ──
// Busy from `start` (or any `progress`) to `idle`, the lock's release. The first subscriber
// asks Rust once, so a card that mounts during a sync (the launch sync often starts before
// the Library card is on screen) spins at once instead of standing still.
let busy = false;
let lastProgress: { fetched?: number; total?: number } = {};
const busyCbs = new Set<(busy: boolean) => void>();
let busyWired = false;

function setBusy(b: boolean): void {
  if (b === busy) return;
  busy = b;
  if (!b) lastProgress = {};
  for (const cb of busyCbs) cb(b);
}

function wireBusy(): void {
  if (busyWired) return;
  busyWired = true;
  let heard = false; // an event after the ask is newer than the ask's answer
  void onSyncEvent((e) => {
    heard = true;
    if (e.phase === "progress") lastProgress = { fetched: e.fetched, total: e.total };
    if (e.phase === "start" || e.phase === "progress") setBusy(true);
    else if (e.phase === "idle") setBusy(false);
  });
  invoke<boolean>("library_sync_busy")
    .then((b) => !heard && setBusy(b))
    .catch(() => {});
}

/** A sync holds the lock now: a ⟳ click would be refused. */
export const syncBusy = (): boolean => busy;
/** The last progress of the running sync (empty before the first page). */
export const syncProgress = (): { fetched?: number; total?: number } => lastProgress;

/** Follow the busy state. Calls `cb` at once with the current state. Returns an unsubscribe fn. */
export function onSyncBusy(cb: (busy: boolean) => void): () => void {
  wireBusy();
  busyCbs.add(cb);
  cb(busy);
  return () => busyCbs.delete(cb);
}
