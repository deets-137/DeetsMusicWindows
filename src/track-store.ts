// Shared in-memory library store. One load, one Track[] + one id→Track index,
// refreshed whenever a sync completes. Both the Library card (browsing) and the Queue
// card (handle resolution) read from here, so the library isn't loaded or held twice —
// and neither goes stale after a background sync.

import { libraryTracks, librarySync, onSyncEvent, seenTracks, type Track } from "./library";
import { isConnected } from "./apple";

let all: Track[] = [];
let byId = new Map<string, Track>();
const listeners = new Set<() => void>();

function index(): void {
  const m = new Map<string, Track>();
  for (const t of all) {
    if (t.libraryId) m.set(t.libraryId, t);
    if (t.catalogId) m.set(t.catalogId, t);
  }
  byId = m;
}

/** Reload the full library from the cache and notify subscribers. */
export async function loadTracks(): Promise<void> {
  try {
    // The durable 'seen' rows (materialized catalog-only tracks) ride along into the
    // TRANSIENT map, so historical feedback (Rewind, play stats) resolves to metadata
    // across sessions — while the browsable library stays synced rows only.
    const [page, seen] = await Promise.all([libraryTracks(0, 100000), seenTracks()]);
    all = page.items;
    index();
    for (const t of seen) {
      if (t.libraryId) transient.set(t.libraryId, t);
      if (t.catalogId) transient.set(t.catalogId, t);
    }
    listeners.forEach((cb) => cb());
  } catch (e) {
    console.error("[track-store] load", e);
  }
}

/** Live track list (for browsing). Library only — transients don't browse. */
export const tracks = (): Track[] => all;

// Transient catalog tracks (played/queued from Search) — resolvable for display
// (Qcard rows, album color) without being part of the browsable library. Kept in a
// separate map so a library reload can't drop them; session-only (the durable copy
// is Rust's materialize_track).
const transient = new Map<string, Track>();

/** Ingest catalog tracks so queue handles pointing at them resolve. */
export function addTransientTracks(list: Track[]): void {
  for (const t of list) {
    if (t.libraryId) transient.set(t.libraryId, t);
    if (t.catalogId) transient.set(t.catalogId, t);
  }
  listeners.forEach((cb) => cb());
}

/** Resolve a queue handle id (catalog or library) → Track, for display.
 *  The library copy wins (richer: addedRank); transients cover catalog-only plays. */
export const trackById = (id?: string): Track | undefined =>
  id ? byId.get(id) ?? transient.get(id) : undefined;

/** Is this id a SYNCED library track? (Transients don't count — the player uses this
 *  to decide which played tracks need durable materialization.) */
export const inLibrary = (id?: string): boolean => (id ? byId.has(id) : false);

/** Subscribe to load/reload. Returns an unsubscribe fn. */
export function onTracksChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

let started = false;
/** Load once at startup and reload whenever a sync completes. Idempotent. */
export function initTrackStore(): void {
  if (started) return;
  started = true;
  loadTracks();
  onSyncEvent((e) => {
    // Reload on error too: an incomplete sync still upserted the pages that DID fetch.
    if (e.phase === "done" || e.phase === "error") loadTracks();
  });
  // Stale-while-revalidate, ONCE per session (not per card mount): kick a background
  // re-sync at startup if signed in. Lives here — not in the Library card — so swapping
  // the card in and out of a slot doesn't re-trigger a full Apple sync each time.
  isConnected().then((c) => {
    if (c)
      librarySync().catch((e) => {
        // A concurrent sync (the Library card auto-syncs on open too) is deduped by
        // the Rust SYNC_IN_FLIGHT guard — expected, not a failure. Only surface real errors.
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("already in progress")) console.error("[track-store] sync", e);
      });
  });
}
