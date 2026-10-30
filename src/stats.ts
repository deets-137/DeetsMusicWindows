// Listening stats — per-track play tallies, recorded for a future data-vis.
//
// Two events, a funnel: a song *starts* (becomes now-playing) → "partial"; playback
// crosses the listened-through threshold → "full". Every full is also a partial, so
// full_count ⊆ partial_count. The counts live in SQLite (Rust `record_play`, keyed by
// `catalog_id ?? library_id` to join the tracks cache); this module is just the
// renderer-side trigger + dedup, driven from player.ts.
//
// Tracking only for now — no read-out UI. Each record echoes to the `__diag` log
// (`stats:partial` / `stats:full`) so you can confirm events fire via __diag.dump().

import { setting, setSetting, onSettingsChange } from "./settings-store";
import { invoke } from "@tauri-apps/api/core";
import type { TrackHandle } from "./queue";
import * as diag from "./diag";
import { toast } from "./toast";
import { songStarted, songListened } from "./page-counts";

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
let unlocking = false;
function maybeUnlockRewind(): void {
  if (startCount === null || startCount < REWIND_UNLOCK_STARTS || setting("rewindAutoShown")) return;
  unlocking = true;
  setSetting("rewindAutoShown", true, "app");
  setSetting("hiddenCards", setting("hiddenCards").filter((c) => c !== "rewind"), "app"); // Settings › Cards (HIDE-CARDS.md §4)
  unlocking = false;
  diag.log("stats:rewind-unlock", { starts: startCount });
  toast({ kind: "info", text: "Rewind unlocked: your listening, ranked. Pick it from any slot's title." });
}

// A hand choice wins over the unlock (his call K2, 2026-10-18, DEETS-REWIND.md §8.1). Rewind
// shown or hidden by hand before 50 plays (Settings › Cards, the card picker's Hide, its Undo,
// the agent) marks the unlock as done, so it never shows a card the user hid, or toasts about
// one the user already has. Watched here, at the setting, so every path that changes it counts.
let rewindHidden = setting("hiddenCards").includes("rewind");
onSettingsChange((k) => {
  if (k !== "hiddenCards") return;
  const now = setting("hiddenCards").includes("rewind");
  if (now !== rewindHidden && !unlocking && !setting("rewindAutoShown")) {
    setSetting("rewindAutoShown", true, "app");
    diag.log("stats:rewind-hand", { hidden: now });
  }
  rewindHidden = now;
});
void invoke<number>("play_event_count")
  .then((n) => {
    startCount = n;
    maybeUnlockRewind();
  })
  .catch((e) => diag.log("stats:err", { kind: "event-count", e: String(e) }));

// Dev-only: replay the one-shot unlock (DEBUGGING.md §Toasts). Clears the "already fired"
// flag and lifts the in-memory start count to the gate; the real count on disk is untouched.
declare global {
  interface DeetsToastSim {
    rewind?: () => void;
  }
}
if (import.meta.env.DEV) {
  window.__toast.sim = {
    ...window.__toast.sim,
    rewind: () => {
      setSetting("rewindAutoShown", false, "app");
      startCount = Math.max(startCount ?? 0, REWIND_UNLOCK_STARTS);
      maybeUnlockRewind();
    },
  };
}

/** Stable per-song key for the dedup latches (mirrors player.ts's playId). */
const playId = (h: TrackHandle): string | undefined => h.catalogId ?? h.libraryId;

// One logical play = one partial + at most one full. These latches collapse the
// repeated signals each event arrives on (a fresh context fires nowPlayingItemDidChange
// several times mid-rebuild; progress ticks several times a second) down to one count.
let lastStartedId: string | undefined; // most recent song credited a "partial"
let fullCountedId: string | undefined; // song already credited a "full" this play
// A start of the song that is already playing, waiting for the next tick to say what it was
// (DEETS-REWIND.md §8, F3). A queue rebuild re-fires the start for the song that plays on;
// the same song played again from a new list starts at 0. The tick tells the two apart.
let sameStart: string | undefined;

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
  lastfm: boolean; // already handed to Last.fm (once per play)
  savedMs: number; // the minutes the row holds now (a checkpoint, below)
  savedAt: number; // when they were written (performance.now)
}

// ── Checkpoints (DEETS-REWIND.md §8, F4; his call 2026-10-18: every 30 s) ──
// The row's minutes are written while the song plays, not only when it ends: a close or a
// crash used to leave the whole listen at 0 (92 plays on live). Every 30 s of playing, and
// 2 s after the progress ticks stop (a pause, a stall), the open row gets its minutes so far.
// The end-of-play write still sets the final value. A checkpoint does not notify onPlayEvent:
// the cards that read the log re-read at the start and the end of a play, as before.
const CHECKPOINT_MS = 30_000;
const QUIET_MS = 2_000;
let quietTimer = 0;

function checkpoint(ev: OpenEvent): void {
  if (ev !== openEvent) return; // finalized meanwhile: the end write has the last word
  const ms = Math.round(ev.msListened);
  if (ms === ev.savedMs) return;
  ev.savedMs = ms;
  ev.savedAt = performance.now();
  const completed = ev.completed;
  void ev.id.then((id) => {
    if (id === null || ev !== openEvent) return;
    invoke("record_event_end", { eventId: id, msListened: ms, completed })
      .catch((e) => diag.log("stats:err", { kind: "event-checkpoint", e: String(e) }));
  });
}

/** Last.fm's own rule (LASTFM.md §5), whatever "Count a play at" says: a song over 30 s,
 *  heard for half its length or 4 minutes. Rust checks it again with the stored length. */
const LASTFM_MIN_MS = 30 * 1000;
function lastfmHeard(ev: OpenEvent, progress: number, currentTime: number): void {
  if (ev.lastfm || progress <= 0) return;
  const durationMs = (currentTime / progress) * 1000;
  if (!(durationMs > LASTFM_MIN_MS) || ev.msListened < Math.min(durationMs / 2, SCROBBLE_MS)) return;
  ev.lastfm = true;
  void ev.id.then((eventId) => {
    if (eventId === null) return;
    invoke<boolean>("lastfm_heard", { eventId, msListened: Math.round(ev.msListened), durationMs: Math.round(durationMs) })
      .then((queued) => { if (queued) diag.log("lastfm:queued", { id: eventId }); })
      .catch((e) => diag.log("stats:err", { kind: "lastfm-heard", e: String(e) }));
  });
}
let openEvent: OpenEvent | null = null;

// The durable log changed: a row was appended (a song started) or finalized (it ended).
// The History card reads `play_events` directly, so it listens here instead of guessing
// from the queue — by the time this fires, the row is in the table.
const logSubs = new Set<() => void>();
/** Called after every `play_events` write lands. Returns the unsubscribe. */
export function onPlayEvent(cb: () => void): () => void {
  logSubs.add(cb);
  return () => logSubs.delete(cb);
}
const emitLog = () => logSubs.forEach((cb) => cb());

// One listen's start and its settled progress ticks, for other listeners (sound-loudness.ts
// measures a song over the same play this log counts). Same guards as the log: a restart is a
// new listen; a tick arrives only while the model's current is the song MusicKit plays.
type ListenStart = (cur: TrackHandle) => void;
type ListenTick = (cur: TrackHandle, progress: number, currentTime: number) => void;
const listenStarts = new Set<ListenStart>();
const listenTicks = new Set<ListenTick>();
export function onListen(start: ListenStart, tick: ListenTick): () => void {
  listenStarts.add(start);
  listenTicks.add(tick);
  return () => {
    listenStarts.delete(start);
    listenTicks.delete(tick);
  };
}

function startEvent(cur: TrackHandle): void {
  finalizeEvent(); // the outgoing song's row, if any
  listenStarts.forEach((cb) => cb(cur));
  const id = invoke<number>("record_event_start", {
    catalogId: cur.catalogId,
    libraryId: cur.libraryId,
    context: cur.context ?? null,
  })
    .then((n) => {
      diag.log("stats:event-start", { id: n, trackId: playId(cur), context: cur.context });
      emitLog();
      return n;
    })
    .catch((e) => {
      diag.log("stats:err", { kind: "event-start", e: String(e) });
      return null;
    });
  openEvent = { id, msListened: 0, completed: false, lastfm: false, savedMs: 0, savedAt: performance.now() };
  songStarted(); // the page sample, in telemetry builds (page-sample.ts)
}

/** Finalize the open event row (next-song-starts / app-close). Safe to call bare. */
export function finalizeEvent(): void {
  const ev = openEvent;
  openEvent = null;
  window.clearTimeout(quietTimer);
  if (!ev) return;
  const msListened = Math.round(ev.msListened);
  songListened(msListened);
  const completed = ev.completed;
  void ev.id.then((id) => {
    if (id === null) return; // the start write failed — nothing to finalize
    invoke("record_event_end", { eventId: id, msListened, completed })
      .then(() => {
        diag.log("stats:event-end", { id, msListened, completed });
        emitLog();
      })
      .catch((e) => diag.log("stats:err", { kind: "event-end", e: String(e) }));
  });
}

// Best-effort finalize for the session's last song (fire-and-forget on close). The 30 s
// checkpoints above are what keep its minutes when this write does not land.
window.addEventListener("beforeunload", finalizeEvent);
// The window hides (minimize, tray): save now, since a close often follows.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && openEvent) checkpoint(openEvent);
});

/** A song became now-playing (it started). Counted once per distinct song-start, so
 *  re-clicks, seeks, and window rebuilds (which re-fire the change event) don't inflate
 *  the tally. Resets the full latch so the new song can earn its own "full". */
export function recordStart(cur: TrackHandle | null): void {
  if (!cur) return;
  const id = playId(cur);
  if (!id) return;
  if (id === lastStartedId) {
    sameStart = id; // a rebuild, or a new listen: the next tick decides (recordProgress)
    return;
  }
  sameStart = undefined;
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

  // A start of the song already playing (F3): a jump back to near the start is a new listen,
  // with its own play; a rebuild carries on from where it was, and the listen goes on.
  if (sameStart && sameStart === id && openEvent && typeof currentTime === "number") {
    sameStart = undefined;
    const last = openEvent.lastTickSec ?? 0;
    if (currentTime < 3 && last - currentTime > 1.5) {
      diag.log("stats:replay", { id, from: Math.round(last) });
      recordRestart(cur);
    }
  }

  if (typeof currentTime === "number") listenTicks.forEach((cb) => cb(cur, progress, currentTime));
  if (openEvent && typeof currentTime === "number") {
    const ev = openEvent;
    if (performance.now() - ev.savedAt >= CHECKPOINT_MS) checkpoint(ev);
    window.clearTimeout(quietTimer);
    quietTimer = window.setTimeout(() => checkpoint(ev), QUIET_MS);
    const last = openEvent.lastTickSec;
    if (last !== undefined) {
      const d = currentTime - last;
      if (d > 0 && d < 2) openEvent.msListened += d * 1000;
    }
    openEvent.lastTickSec = currentTime;
    if (listenedThrough(progress, openEvent.msListened)) openEvent.completed = true;
    lastfmHeard(openEvent, progress, currentTime);
  }

  if (!listenedThrough(progress, openEvent?.msListened ?? 0) || id === fullCountedId) return;
  fullCountedId = id;
  record(cur, "full");
}
