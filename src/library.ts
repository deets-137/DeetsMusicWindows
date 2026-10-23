// Library data access. Talks to the Rust cache (SQLite) and the sync command.
// The frontend never sees Apple shapes — only our normalized Track.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { nextSyncStatus, type SyncStatus } from "./sync-hint";

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
  phase: "start" | "progress" | "done" | "error" | "idle" | "artists";
  /** Set on `progress`: which pass sends the pages. `full` counts every song read in
   *  `fetched`; `incremental` counts only the new songs (the ⟳'s hint, sync-hint.ts). */
  kind?: "full" | "incremental";
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
  /** Set on `done`: the artist pass runs next, and ends with `{phase:"artists"}` (2026-10-23). */
  artists?: boolean;
  /** Set on `artists`: how many artist rows the pass wrote. */
  written?: number;
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
// The status (sync-hint.ts) says how far the sync is, for the ⟳'s hover hint (§4).
let busy = false;
let status: SyncStatus | null = null;
const busyCbs = new Set<(busy: boolean) => void>();
const statusCbs = new Set<(s: SyncStatus | null) => void>();
let busyWired = false;

function setStatus(s: SyncStatus | null): void {
  // Busy from `start` (or any `progress`) to `idle`; `done` and `error` only finish up.
  status = s;
  for (const cb of statusCbs) cb(s);
  const b = !!s;
  if (b === busy) return;
  busy = b;
  for (const cb of busyCbs) cb(b);
}

function wireBusy(): void {
  if (busyWired) return;
  busyWired = true;
  let heard = false; // an event after the ask is newer than the ask's answer
  void onSyncEvent((e) => {
    heard = true;
    // `done` / `error` before any `start` heard: the card mounted late; the lock still holds.
    if ((e.phase === "done" || e.phase === "error") && !busy) return setStatus({ stage: "finishing" });
    setStatus(nextSyncStatus(status, e));
  });
  invoke<boolean>("library_sync_busy")
    .then((b) => !heard && setStatus(b ? { stage: "start" } : null))
    .catch(() => {});
}

// ── The artist pass (2026-10-23): it runs after `done`, so the songs show first ──
// From a `done` that says `artists: true` to the `artists` event, the artist catalog (photos,
// catalog ids) is still being read. Home holds its artist calls until it ends (home.ts).
let artistsPending = false;
const artistCbs = new Set<() => void>();
void onSyncEvent((e) => {
  if (e.phase === "done") artistsPending = !!e.artists;
  else if (e.phase === "artists") {
    artistsPending = false;
    for (const cb of artistCbs) cb();
  } else if (e.phase === "idle" || e.phase === "error") artistsPending = false;
}).catch(() => {});

/** Resolves at the next sync's `done` or `error`, or after `capMs`, whichever is first. The
 *  sign-in toast waits for it, so "Enjoy!" comes when the songs are on screen (2026-10-23). */
export function nextSyncEnd(capMs: number): Promise<void> {
  return new Promise((resolve) => {
    let off: UnlistenFn | null = null;
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      window.clearTimeout(cap);
      off?.();
      resolve();
    };
    const cap = window.setTimeout(end, capMs);
    void onSyncEvent((e) => {
      if (e.phase === "done" || e.phase === "error") end();
    })
      .then((u) => (ended ? u() : (off = u)))
      .catch(() => {});
  });
}

/** The artist pass is still reading: an artist's photo or catalog id may be on its way. */
export const artistPassPending = (): boolean => artistsPending;

/** Hear the artist pass end. Returns an unsubscribe fn. */
export function onArtistPass(cb: () => void): () => void {
  artistCbs.add(cb);
  return () => artistCbs.delete(cb);
}

/** A sync holds the lock now: a ⟳ click would be refused. */
export const syncBusy = (): boolean => busy;
/** How far the running sync is; `null` when none runs. */
export const syncStatus = (): SyncStatus | null => status;

/** Follow the busy state. Calls `cb` at once with the current state. Returns an unsubscribe fn. */
export function onSyncBusy(cb: (busy: boolean) => void): () => void {
  wireBusy();
  busyCbs.add(cb);
  cb(busy);
  return () => busyCbs.delete(cb);
}

/** Follow the sync's status, every event. Calls `cb` at once. Returns an unsubscribe fn. */
export function onSyncStatus(cb: (s: SyncStatus | null) => void): () => void {
  wireBusy();
  statusCbs.add(cb);
  cb(status);
  return () => statusCbs.delete(cb);
}
