// The playback queue model — the source of truth for what plays, decoupled from
// MusicKit (player.ts feeds MusicKit a small window of this). Three zones:
//
//   history[]  →  current  →  upcoming[]
//   (played)      (now)        (the plan)
//
// Entries are lightweight handles (ids + origin), NOT full Tracks — so a queue of a
// 10k-song library is a few hundred KB of strings and splice/reorder stay cheap.
// Full Track details are resolved from the library cache for display/playback.
//
// `origin` drives the "stacking" behaviour: starting a new context replaces trailing
// `auto` items but preserves the user's `manual` play-next picks on top.

export type QueueOrigin = "auto" | "manual";

/** What callers pass in — ids + provenance. `origin` is set by the operation. */
export interface TrackHandle {
  /** Catalog id is the preferred play target; library id is the fallback. */
  catalogId?: string;
  libraryId?: string;
  /** Where this came from, for "Playing Next from …" labels. e.g. "album:123". */
  context?: string;
}

export interface QueueEntry extends TrackHandle {
  origin: QueueOrigin;
  /**
   * Whether this entry has actually played. Pre-click context tracks are parked in
   * the back-chain with `played: false` (a "backgrounded" lookback you only reach via
   * Previous); the flag flips to `true` the moment the entry becomes `current`. The
   * recently-played view shows only `played` entries, so the backlog stays hidden
   * until you actually hear it.
   */
  played?: boolean;
}

const HISTORY_CAP = 100;

const state: { history: QueueEntry[]; current: QueueEntry | null; upcoming: QueueEntry[] } = {
  history: [],
  current: null,
  upcoming: [],
};

// ── Subscriptions (the future queue UI renders off this) ─────────────────────
type Listener = () => void;
const listeners = new Set<Listener>();
export function onQueueChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function emit(): void {
  listeners.forEach((cb) => cb());
}

// ── Reads ────────────────────────────────────────────────────────────────────
export const getCurrent = (): QueueEntry | null => state.current;
export const getUpcoming = (): readonly QueueEntry[] => state.upcoming;
/** The full back-chain (played songs + parked, unplayed backlog). Previous walks this. */
export const getHistory = (): readonly QueueEntry[] => state.history;
/** Only songs actually heard, newest last — what a "recently played" view shows. */
export const getRecentlyPlayed = (): QueueEntry[] => state.history.filter((e) => e.played);
/** The next entry without consuming it — player.ts uses this to preload (gapless). */
export const peekNext = (): QueueEntry | null => state.upcoming[0] ?? null;

/** Marking an entry current means it's now playing — so it counts as played. */
function setCurrent(entry: QueueEntry | null): QueueEntry | null {
  if (entry) entry.played = true;
  state.current = entry;
  return entry;
}

// ── Playing a context (album-from-point, library-from-point) ─────────────────
/**
 * Start an ordered context from `startIndex`. Manual play-next items are kept and
 * stay stacked on top; trailing auto items are replaced. Returns the new current.
 */
export function setContext(handles: TrackHandle[], startIndex: number): QueueEntry | null {
  const manualKept = state.upcoming.filter((e) => e.origin === "manual");
  if (state.current) pushHistory(state.current);
  // Park the pre-click tracks as a backgrounded, unplayed lookback (capped) — Previous
  // walks into them, but they stay out of the recently-played view until heard.
  const seedFrom = Math.max(0, startIndex - HISTORY_CAP);
  for (let i = seedFrom; i < startIndex; i++) {
    pushHistory({ ...handles[i], origin: "auto", played: false });
  }
  const start = handles[startIndex];
  setCurrent(start ? { ...start, origin: "auto" } : null);
  const autoTail: QueueEntry[] = handles
    .slice(startIndex + 1)
    .map((h) => ({ ...h, origin: "auto" }));
  state.upcoming = [...manualKept, ...autoTail];
  emit();
  return state.current;
}

// ── Manual edits ─────────────────────────────────────────────────────────────
/** Stack on top of upcoming (plays after the current song). */
export function playNext(handle: TrackHandle): void {
  state.upcoming.unshift({ ...handle, origin: "manual" });
  emit();
}
/** Append to the end of upcoming. */
export function addToQueue(handle: TrackHandle): void {
  state.upcoming.push({ ...handle, origin: "manual" });
  emit();
}
export function removeAt(index: number): void {
  if (index >= 0 && index < state.upcoming.length) {
    state.upcoming.splice(index, 1);
    emit();
  }
}
export function move(from: number, to: number): void {
  const [entry] = state.upcoming.splice(from, 1);
  if (entry) state.upcoming.splice(to, 0, entry);
  emit();
}

// ── Transport ────────────────────────────────────────────────────────────────
export function advance(): QueueEntry | null {
  if (state.current) pushHistory(state.current);
  setCurrent(state.upcoming.shift() ?? null);
  emit();
  return state.current;
}
export function previous(): QueueEntry | null {
  const prev = state.history.pop();
  if (!prev) return state.current;
  if (state.current) state.upcoming.unshift(state.current);
  setCurrent(prev);
  emit();
  return state.current;
}
/** Jump to an upcoming entry by index; the songs skipped over are discarded. */
export function jumpTo(index: number): QueueEntry | null {
  if (index < 0 || index >= state.upcoming.length) return state.current;
  const removed = state.upcoming.splice(0, index + 1);
  if (state.current) pushHistory(state.current); // the song you were on did play
  setCurrent(removed[removed.length - 1]);
  emit();
  return state.current;
}
export function clear(): void {
  state.history = [];
  state.current = null;
  state.upcoming = [];
  emit();
}

function pushHistory(entry: QueueEntry): void {
  state.history.push(entry);
  if (state.history.length > HISTORY_CAP) state.history.shift();
}
