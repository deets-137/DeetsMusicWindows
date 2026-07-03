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
const PLAY_LOG_CAP = 200;

/** Play-target id for an entry — catalog preferred, library as fallback (mirrors player.ts). */
const idOf = (h: TrackHandle): string | undefined => h.catalogId ?? h.libraryId;

const state: { history: QueueEntry[]; current: QueueEntry | null; upcoming: QueueEntry[] } = {
  history: [],
  current: null,
  upcoming: [],
};

// Session play log (see getPlayLog). Copies, so later flag flips on the live entries
// can't retroactively rewrite the log.
const playLog: QueueEntry[] = [];
function logPlay(entry: QueueEntry): void {
  playLog.push({ ...entry });
  if (playLog.length > PLAY_LOG_CAP) playLog.shift();
}

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
/**
 * The session play log, oldest first — what the History card renders. Unlike
 * `history[]` (the Previous back-chain, which setContext dedupes for window
 * correctness), this is APPEND-ONLY: a song heard three times appears three times,
 * and nothing is ever pulled back out. An entry is logged the moment it stops being
 * current and joins the heard trail. Session-scoped; entries are copies.
 */
export const getPlayLog = (): readonly QueueEntry[] => playLog;
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
 * Start an ordered context from `startIndex`. Returns the new current.
 *
 * History has two kinds of entry, treated very differently here:
 *  - **Heard trail** (`played: true`) — songs actually listened to. DURABLE: it
 *    survives across contexts (capped), so Previous and recently-played keep working
 *    when you hop from an album to the library to a playlist.
 *  - **Parked lookback** (`played: false`) — the songs that sit *before* the one you
 *    clicked, so Previous can walk back into them even though you jumped into the
 *    middle. EPHEMERAL: it belongs only to the current context and is REBUILT here,
 *    never appended. (Appending it every click is what stacked duplicate ids into the
 *    fed window and desynced playback — see docs/QUEUE.md.)
 *
 * Layout after this call: `history = [lookback…, heard…]`, so Previous pops the most
 * recently *heard* song first, then descends into the lookback. The clicked song's id
 * is excluded from both so it can never appear twice in the window.
 */
export function setContext(handles: TrackHandle[], startIndex: number): QueueEntry | null {
  const manualKept = state.upcoming.filter((e) => e.origin === "manual");
  const startHandle = handles[startIndex];
  const startId = startHandle ? idOf(startHandle) : undefined;

  // Durable heard trail: prior heard songs + the song that was playing (it counts as
  // heard). Drop any copy of the song we're about to play — it becomes `current`.
  const heard = state.history.filter((e) => e.played && idOf(e) !== startId);
  if (state.current) logPlay(state.current); // the outgoing song played — log it
  if (state.current && idOf(state.current) !== startId) heard.push(state.current);
  while (heard.length > HISTORY_CAP) heard.shift();

  // Ephemeral lookback: the pre-click tracks, minus anything already reachable via the
  // heard trail (or the clicked song itself) — keeps the back-chain duplicate-free.
  const exclude = new Set<string>();
  for (const e of heard) {
    const id = idOf(e);
    if (id) exclude.add(id);
  }
  if (startId) exclude.add(startId);
  const seedFrom = Math.max(0, startIndex - HISTORY_CAP);
  const lookback: QueueEntry[] = [];
  for (let i = seedFrom; i < startIndex; i++) {
    const id = idOf(handles[i]);
    if (id && exclude.has(id)) continue;
    if (id) exclude.add(id); // also de-dup within the lookback itself
    lookback.push({ ...handles[i], origin: "auto", played: false });
  }

  state.history = [...lookback, ...heard];
  while (state.history.length > HISTORY_CAP) state.history.shift();

  setCurrent(startHandle ? { ...startHandle, origin: "auto" } : null);
  const autoTail: QueueEntry[] = handles
    .slice(startIndex + 1)
    .map((h) => ({ ...h, origin: "auto" }));
  state.upcoming = [...manualKept, ...autoTail];
  emit();
  return state.current;
}

// ── Manual edits ─────────────────────────────────────────────────────────────
/** Stack a block on top of upcoming, in order (plays right after the current song). */
export function playNextMany(handles: TrackHandle[]): void {
  if (!handles.length) return;
  state.upcoming.unshift(...handles.map((h) => ({ ...h, origin: "manual" as const })));
  emit();
}
/** Append a block to the end of upcoming, in order. */
export function addToQueueMany(handles: TrackHandle[]): void {
  if (!handles.length) return;
  state.upcoming.push(...handles.map((h) => ({ ...h, origin: "manual" as const })));
  emit();
}
/** Stack on top of upcoming (plays after the current song). */
export function playNext(handle: TrackHandle): void {
  playNextMany([handle]);
}
/** Append to the end of upcoming. */
export function addToQueue(handle: TrackHandle): void {
  addToQueueMany([handle]);
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

// ── Shuffle (one-shot; behavior knobs live in docs/FUTURE-SETTINGS.md §5) ─────
/** In-place Fisher–Yates. Exported so player.ts can shuffle handle lists too. */
export function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * One-shot shuffle of upcoming: every `manual` pick rises to the TOP (relative order
 * kept — they're explicit promises, wherever Play-Next/Add-to-Queue originally put
 * them), and the `auto` tail shuffles below. The manual-placement rule is a future
 * setting (FUTURE-SETTINGS §5).
 */
export function shuffleUpcoming(): void {
  if (state.upcoming.length < 2) return;
  const manual = state.upcoming.filter((e) => e.origin === "manual");
  const auto = shuffleInPlace(state.upcoming.filter((e) => e.origin === "auto"));
  state.upcoming = [...manual, ...auto];
  emit();
}

// ── Radio mode (STATIONS.md §1–2) ────────────────────────────────────────────
/**
 * Radio-mode model-follow: the station fed a new song. Previous `current` joins the
 * heard trail (so Previous/stats/History keep working — radio never touches the
 * durable trail); the new song becomes `current`; `upcoming` is left alone (a station
 * has no visible plan — anything present is a pending break-out block).
 */
export function appendCurrent(handle: TrackHandle): QueueEntry | null {
  if (state.current) pushHistory(state.current);
  setCurrent({ ...handle, origin: "auto" });
  emit();
  return state.current;
}

/**
 * Entering radio disposes the WHOLE plan — auto tail AND manual picks. A station is
 * an explicit departure; keeping manual picks would instantly trigger the break-out
 * the moment the first station song ends. The heard trail + current stay put
 * (current joins the trail via the first appendCurrent).
 */
export function disposePlan(): void {
  if (!state.upcoming.length) return;
  state.upcoming = [];
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
  logPlay(entry); // joining the heard trail = it played
  state.history.push(entry);
  if (state.history.length > HISTORY_CAP) state.history.shift();
}
