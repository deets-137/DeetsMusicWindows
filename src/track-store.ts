// Shared in-memory library store. One load, one Track[] + one id→Track index,
// refreshed whenever a sync completes. Both the Library card (browsing) and the Queue
// card (handle resolution) read from here, so the library isn't loaded or held twice —
// and neither goes stale after a background sync.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { libraryTracks, librarySync, onSyncEvent, seenTracks, type Track } from "./library";
import { isConnected } from "./apple";
import * as perf from "./perf";
import { toast } from "./toast";
import * as health from "./apple-health";
import * as diag from "./diag";
import { launchMark } from "./launch-perf";
import { takeBootRead } from "./boot-prefetch";

let all: Track[] = [];
let byId = new Map<string, Track>();
/** Why subscribers are being told: the synced library reloaded, or catalog-only
 *  tracks were ingested as transients (a first play/queue from Search, a playlist…). */
export type TracksChange = "library" | "transient";
// cb → label; the label names the subscriber in the dev perf spans (perf.ts).
const listeners = new Map<(why: TracksChange) => void, string>();
function notify(why: TracksChange): void {
  listeners.forEach((label, cb) => perf.span(label, () => cb(why)));
}

// The catalog heal (heal.rs, QUEUE.md §A library song Apple sends with no play id): Apple
// sent some library songs with no play id. `healed` maps such a song's library id to the
// catalog copy to PLAY; the song keeps its library id as its key. `noCopy` holds the ones
// with no catalog copy (checked in the last 7 days): not playable.
let healed = new Map<string, string>();
let noCopy = new Set<string>();

interface Heals {
  healed: [string, string][];
  none: string[];
}
async function loadHeals(): Promise<void> {
  try {
    const h = await (takeBootRead("heals") ?? invoke<Heals>("catalog_heals"));
    healed = new Map(h.healed);
    noCopy = new Set(h.none);
  } catch (e) {
    console.warn("[track-store] heals", e);
  }
}

/** Re-read the heal map and re-index (the heal's event, and the player's backstop). */
export async function refreshHeals(): Promise<void> {
  await loadHeals();
  index();
  notify("library");
}

/** The catalog id to play for a library song Apple sent with no play id, if one was found. */
export const healedId = (libraryId?: string): string | undefined => (libraryId ? healed.get(libraryId) : undefined);
/** A library song Apple sent with no play id, and with no catalog copy: it cannot play. */
export const noCatalogCopy = (t: { catalogId?: string; libraryId?: string }): boolean =>
  !t.catalogId && !!t.libraryId && noCopy.has(t.libraryId);

function index(): void {
  const m = new Map<string, Track>();
  for (const t of all) {
    if (t.libraryId) m.set(t.libraryId, t);
    if (t.catalogId) m.set(t.catalogId, t);
    // The healed copy answers as this song: "in your library" in Search and on an artist
    // page, and a queue entry fed by the healed id resolves to the library row.
    const h = !t.catalogId && t.libraryId ? healed.get(t.libraryId) : undefined;
    if (h && !m.has(h)) m.set(h, t);
  }
  byId = m;
}

/** Reload the full library from the cache and notify subscribers. */
export async function loadTracks(): Promise<void> {
  try {
    // The durable 'seen' rows (materialized catalog-only tracks) ride along into the
    // TRANSIENT map, so historical feedback (Rewind, play stats) resolves to metadata
    // across sessions — while the browsable library stays synced rows only.
    // The first load takes the reads main.ts asked for at module load (boot-prefetch.ts).
    const [page, seen] = await Promise.all([
      takeBootRead("library") ?? libraryTracks(0, 100000),
      takeBootRead("seen") ?? seenTracks(),
      loadHeals(),
    ]);
    all = page.items;
    index();
    for (const t of seen) {
      if (t.libraryId) transient.set(t.libraryId, t);
      if (t.catalogId) transient.set(t.catalogId, t);
    }
    notify("library");
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
  let added = 0;
  perf.span("ingest", () => {
    for (const t of list) {
      // A synced library song resolves through byId (which wins) — nothing to ingest.
      if ((t.catalogId && byId.has(t.catalogId)) || (t.libraryId && byId.has(t.libraryId))) continue;
      const known = (t.catalogId && transient.has(t.catalogId)) || (t.libraryId && transient.has(t.libraryId));
      if (t.libraryId) transient.set(t.libraryId, t);
      if (t.catalogId) transient.set(t.catalogId, t);
      if (!known) added++;
    }
  });
  // Only a genuinely new track can change what a subscriber shows. A library click (or
  // a re-play of an already-ingested playlist) used to fan out a full re-render of
  // every mounted card for nothing — 100–330 ms on the click-to-sound path (perf.ts).
  if (added) notify("transient");
}

/** Resolve a queue handle id (catalog or library) → Track, for display.
 *  The library copy wins (richer: addedRank); transients cover catalog-only plays. */
export const trackById = (id?: string): Track | undefined =>
  id ? byId.get(id) ?? transient.get(id) : undefined;

/** Is this id a SYNCED library track? (Transients don't count — the player uses this
 *  to decide which played tracks need durable materialization.) */
export const inLibrary = (id?: string): boolean => (id ? byId.has(id) : false);

/** Subscribe to load/reload. Returns an unsubscribe fn. */
export function onTracksChange(cb: (why: TracksChange) => void, label = "tracks-listener"): () => void {
  listeners.set(cb, label);
  return () => listeners.delete(cb);
}

let started = false;
let firstLoad: Promise<void> = Promise.resolve();
/** The startup load (the launch cover waits for it; boot-cover.ts). */
export const tracksLoaded = (): Promise<void> => firstLoad;

/** Load once at startup and reload whenever a sync completes. Idempotent. */
export function initTrackStore(): void {
  if (started) return;
  started = true;
  firstLoad = loadTracks();
  void firstLoad.then(() => launchMark("library"));
  // A heal pass (after a sync) or the player's backstop found catalog copies: re-index, so
  // the rows and "in your library" follow at once.
  void listen("catalog-heal", () => void refreshHeals());
  onSyncEvent((e) => {
    // Reload on error too: an incomplete sync still upserted the pages that DID fetch. A pass
    // that changed no row (`changed: 0`, 2026-09-29) skips the reload and the fan-out to every
    // card: the cache is what the store already holds.
    if (e.phase === "done" && e.changed === 0) diag.log("library:syncNoChange", { count: e.count, total: e.total });
    else if (e.phase === "done" || e.phase === "error") loadTracks();
    // Apple said "too many requests" (APPLE-CALLS.md §6a): not the connection, and not a new
    // toast. The user's own pass gets the busy toast (usually already on screen from the 429
    // itself); a pass the app started stays quiet, as every background job does.
    if (e.phase === "error" && e.busy) {
      diag.warn("library:syncBusy", { background: !!e.background, count: e.count, total: e.total });
      if (!e.background) health.tellBusy();
      return;
    }
    // One listener for every sync (startup, the Library ⟳), so one toast per failed pass.
    // The spinner alone just stops, which reads as done (TOASTS.md).
    if (e.phase === "error") {
      // A named cause (signed out at Apple, Apple refusing the app, offline) has its own
      // toast with the button that fixes it; a sync toast on top would blame the connection.
      void health.check(false, false, "sync").then(({ trouble }) => {
        if (trouble !== "none") return;
        const n = (x: number) => x.toLocaleString();
        toast({
          kind: "warn",
          text: e.total
            ? `Library sync stopped at ${n(e.count ?? 0)} of ${n(e.total)} songs. Try Refresh in Library.`
            : "Couldn't sync your library. Check your connection.",
          timeout: 6000,
        });
      });
    }
  });
  // Stale-while-revalidate, ONCE per session (not per card mount): kick a background
  // re-sync at startup if signed in. Lives here — not in the Library card — so swapping
  // the card in and out of a slot doesn't re-trigger a full Apple sync each time.
  // `false` = Rust picks the pass: the one-call count check, then the incremental pass or
  // the full one (DATA-ARCHITECTURE.md §5a).
  isConnected().then((c) => {
    if (c) void backgroundSync("launch");
  });
  // A sign-in syncs at once (2026-09-29): before, the library waited for the next launch.
  // The sign-in pass also checks whether another Apple account signed in, and forgets the
  // old library if so (§5b). It must run: a pass already in flight (a launch sync) makes it
  // wait for that one's end and go once more.
  window.addEventListener("deets:signed-in", () => void signInSync());
  // The developer token arrived late (an offline first run, main.ts): the launch sync
  // failed without it, so it runs now.
  window.addEventListener("deets:dev-token-ready", () => {
    void isConnected().then((c) => {
      if (c) void backgroundSync("devToken");
    });
  });
}

const inFlight = (e: unknown): boolean => String(e instanceof Error ? e.message : e).includes("already in progress");

async function backgroundSync(why: string): Promise<void> {
  try {
    await librarySync(false);
  } catch (e) {
    // A concurrent sync (the Library ⟳) is deduped by the Rust SYNC_IN_FLIGHT guard —
    // expected, not a failure. Only surface real errors.
    if (!inFlight(e)) console.error(`[track-store] sync (${why})`, e);
  }
}

/** A pass in flight holds the Rust guard until its catalog heal ends too, after `done`. */
const SIGNIN_RETRY_MS = 3000;
const SIGNIN_TRIES = 40; // two minutes, then the next launch's sync catches up

async function signInSync(): Promise<void> {
  diag.log("library:signInSync");
  for (let attempt = 1; attempt <= SIGNIN_TRIES; attempt++) {
    try {
      await librarySync(false, true);
      return;
    } catch (e) {
      if (!inFlight(e)) return void console.error("[track-store] sign-in sync", e);
      if (attempt === SIGNIN_TRIES) return void diag.warn("library:signInSyncGaveUp", { attempt });
      await new Promise((r) => window.setTimeout(r, SIGNIN_RETRY_MS));
    }
  }
}
