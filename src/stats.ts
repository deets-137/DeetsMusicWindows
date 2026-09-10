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

import { setting, setSetting } from "./settings-store";
import { invoke } from "@tauri-apps/api/core";
import type { TrackHandle } from "./queue";
import * as diag from "./diag";

/** Fraction of a track that must play for it to count as a "full" listen under the
 *  default rule. The rule itself is a setting (SETTINGS.md / FUTURE-SETTINGS §7). */
const FULL_THRESHOLD = 0.9;
/** "Reaches the end" — the last percent; a natural finish always crosses it. */
const END_THRESHOLD = 0.99;
/** Scrobble rule: half the track, or four minutes of real listening. */
const SCROBBLE_MS = 4 * 60 * 1000;

/** Has this play earned a "full" under the active rule? */
function listenedThrough(progress: number, msListened: number): boolean {
  switch (setting("fullPlayRule")) {
    case "end":
      return progress >= END_THRESHOLD;
    case "scrobble":
      return progress >= 0.5 || msListened >= SCROBBLE_MS;
    default:
      return progress >= FULL_THRESHOLD;
  }
}

// ── The Rewind gate (SETTINGS.md): the card reveals itself once, at 50 play starts.
// Seeded from the durable event count at boot, then counted here per start.
const REWIND_UNLOCK_STARTS = 50;
let startCount: number | null = null;
function maybeUnlockRewind(): void {
  if (startCount === null || startCount < REWIND_UNLOCK_STARTS || setting("rewindAutoShown")) return;
  setSetting("rewindAutoShown", true);
  setSetting("rewindCard", true);
  diag.log("stats:rewind-unlock", { starts: startCount });
}
void invoke<number>("play_event_count")
  .then((n) => {
    startCount = n;
    maybeUnlockRewind();
  })
  .catch((e) => diag.log("stats:err", { kind: "event-count", e: String(e) }));

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

// ── The play-event log (DEETS-REWIND §5a) — one row per play, two-step write ──
// Start: append immediately (crash-safe; ms_listened NULL until finalized).
// End: when the NEXT song starts (or the app closes), finalize the outgoing row
// with the REAL elapsed listen time, accumulated from progress ticks — forward
// deltas only, so seeks don't count as listening. Counters above are unchanged.

interface OpenEvent {
  id: Promise<number | null>; // the row id, once the start write lands
  msListened: number; // accumulated real listen time
  lastTickSec?: number; // previous progress tick's position
  completed: boolean; // crossed the listened-through threshold
}
let openEvent: OpenEvent | null = null;

function startEvent(cur: TrackHandle): void {
  finalizeEvent(); // the outgoing song's row, if any
  const id = invoke<number>("record_event_start", {
    catalogId: cur.catalogId,
    libraryId: cur.libraryId,
    context: cur.context ?? null,
  })
    .then((n) => {
      diag.log("stats:event-start", { id: n, trackId: playId(cur), context: cur.context });
      return n;
    })
    .catch((e) => {
      diag.log("stats:err", { kind: "event-start", e: String(e) });
      return null;
    });
  openEvent = { id, msListened: 0, completed: false };
}

/** Finalize the open event row (next-song-starts / app-close). Safe to call bare. */
export function finalizeEvent(): void {
  const ev = openEvent;
  openEvent = null;
  if (!ev) return;
  const msListened = Math.round(ev.msListened);
  const completed = ev.completed;
  void ev.id.then((id) => {
    if (id === null) return; // the start write failed — nothing to finalize
    invoke("record_event_end", { eventId: id, msListened, completed })
      .then(() => diag.log("stats:event-end", { id, msListened, completed }))
      .catch((e) => diag.log("stats:err", { kind: "event-end", e: String(e) }));
  });
}

// Best-effort finalize for the session's last song (fire-and-forget on close).
window.addEventListener("beforeunload", finalizeEvent);

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
  startEvent(cur);
  if (startCount !== null) {
    startCount++;
    maybeUnlockRewind();
  }
}

/** An explicit restart of the current song (the re-click path, which seeks to 0
 *  without a queue rebuild — so no nowPlayingItemDidChange fires). The `recordStart`
 *  latch would swallow it (same id); this counts the fresh listen and re-arms the
 *  full latch so the restarted play can earn its own "full". */
export function recordRestart(cur: TrackHandle | null): void {
  if (!cur) return;
  const id = playId(cur);
  if (!id) return;
  lastStartedId = id;
  fullCountedId = undefined;
  record(cur, "partial");
  startEvent(cur); // a restart is a fresh listen — new event row
}

/** Progress tick. Credits a "full" once the track crosses the threshold — once per
 *  play (latched), robust to seeking past/back over the mark — and accumulates the
 *  open event's real listen time from tick deltas (`currentTime` in seconds).
 *  Forward deltas under 2s count as listening; anything else is a seek. */
export function recordProgress(cur: TrackHandle | null, progress: number, currentTime?: number): void {
  if (!cur) return;
  const id = playId(cur);
  if (!id) return;

  if (openEvent && typeof currentTime === "number") {
    const last = openEvent.lastTickSec;
    if (last !== undefined) {
      const d = currentTime - last;
      if (d > 0 && d < 2) openEvent.msListened += d * 1000;
    }
    openEvent.lastTickSec = currentTime;
    if (listenedThrough(progress, openEvent.msListened)) openEvent.completed = true;
  }

  if (!listenedThrough(progress, openEvent?.msListened ?? 0) || id === fullCountedId) return;
  fullCountedId = id;
  record(cur, "full");
}
