// Shared in-memory library store. One load, one Track[] + one id→Track index,
// refreshed whenever a sync completes. Both the Library card (browsing) and the Queue
// card (handle resolution) read from here, so the library isn't loaded or held twice —
// and neither goes stale after a background sync.

import { libraryTracks, librarySync, onSyncEvent, type Track } from "./library";
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
    const page = await libraryTracks(0, 100000);
    all = page.items;
    index();
    listeners.forEach((cb) => cb());
  } catch (e) {
    console.error("[track-store] load", e);
  }
}

/** Live track list (for browsing). */
export const tracks = (): Track[] => all;

/** Resolve a queue handle id (catalog or library) → Track, for display. */
export const trackById = (id?: string): Track | undefined => (id ? byId.get(id) : undefined);

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
    if (e.phase === "done") loadTracks();
  });
  // Stale-while-revalidate, ONCE per session (not per card mount): kick a background
  // re-sync at startup if signed in. Lives here — not in the Library card — so swapping
  // the card in and out of a slot doesn't re-trigger a full Apple sync each time.
  isConnected().then((c) => {
    if (c) librarySync().catch((e) => console.error("[track-store] sync", e));
  });
}
