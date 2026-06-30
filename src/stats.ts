// Listening stats — per-track play tallies, recorded for a future data-vis.
//
// Two events, a funnel: a song *starts* (becomes now-playing) → "partial"; playback
// crosses the listened-through threshold → "full". Every full is also a partial, so
// full_count ⊆ partial_count. The counts live in SQLite (Rust `record_play`, keyed by
// `library_id ?? catalog_id` to join the tracks cache); this module is just the
// renderer-side trigger + dedup, driven from player.ts.
//
// Tracking only for now — no read-out UI. Each record echoes to the `__diag` log
// (`stats:partial` / `stats:full`) so you can confirm events fire via __diag.dump().

import { invoke } from "@tauri-apps/api/core";
import type { TrackHandle } from "./queue";
import * as diag from "./diag";

/** Fraction of a track that must play for it to count as a "full" listen.
 *  Hardcoded for now; slated to become a user preference — see FUTURE-SETTINGS §7. */
const FULL_THRESHOLD = 0.9;

/** Stable per-song key for the dedup latches (mirrors player.ts's playId). */
const playId = (h: TrackHandle): string | undefined => h.catalogId ?? h.libraryId;

// One logical play = one partial + at most one full. These latches collapse the
// repeated signals each event arrives on (a fresh context fires nowPlayingItemDidChange
// several times mid-rebuild; progress ticks several times a second) down to one count.
let lastStartedId: string | undefined; // most recent song credited a "partial"
let fullCountedId: string | undefined; // song already credited a "full" this play

function record(cur: TrackHandle, kind: "partial" | "full"): void {
  invoke("record_play", { catalogId: cur.catalogId, libraryId: cur.libraryId, kind })
    .then((s) => diag.log(`stats:${kind}`, s as Record<string, unknown>))
    .catch((e) => diag.log("stats:err", { kind, e: String(e) }));
}

/** A song became now-playing (it started). Counted once per distinct song-start, so
 *  re-clicks, seeks, and window rebuilds (which re-fire the change event) don't inflate
 *  the tally. Resets the full latch so the new song can earn its own "full". */
export function recordStart(cur: TrackHandle | null): void {
  if (!cur) return;
  const id = playId(cur);
  if (!id || id === lastStartedId) return;
  lastStartedId = id;
  fullCountedId = undefined;
  record(cur, "partial");
}

/** Progress tick (0..1). Credits a "full" once the track crosses the threshold —
 *  once per play (latched), robust to seeking past/back over the mark. */
export function recordProgress(cur: TrackHandle | null, progress: number): void {
  if (!cur) return;
  const id = playId(cur);
  if (!id || progress < FULL_THRESHOLD || id === fullCountedId) return;
  fullCountedId = id;
  record(cur, "full");
}
