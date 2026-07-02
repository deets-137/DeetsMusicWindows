// Playback engine (frontend). Drives MusicKit JS inside the webview.
//
// MusicKit JS is the only DRM-sanctioned full-song path on Windows. It must run in
// the renderer and hold the Music User Token itself, so this module pulls both the
// signed developer token and the captured MUT from Rust and configures MusicKit.
//
// One step here is empirically uncertain on first run: injecting a *known* MUT
// without calling `authorize()` (whose OAuth popup can't open in WebView2 — the
// reason auth runs through the loopback browser flow). See `injectUserToken`.

import { invoke } from "@tauri-apps/api/core";
import { libraryTracks, type Track } from "./library";
import * as queue from "./queue";
import type { TrackHandle } from "./queue";
import { trackById, tracks } from "./track-store";
import * as diag from "./diag";
import * as stats from "./stats";

declare global {
  interface Window {
    MusicKit: any;
  }
}

let music: any = null;
let initPromise: Promise<any> | null = null;

// Model-follow: MusicKit owns transport within its fed window; the queue model mirrors
// it. `windowPos` is the MusicKit queue index the model's `current` is aligned to;
// `loadingContext` suppresses sync while we're (re)building the queue.
let windowPos = 0;
let loadingContext = false;
let isLoading = false; // a (re)window is buffering — surfaced in PlayerState.loading

/** Resolve once the async MusicKit CDN script has registered `window.MusicKit`. */
async function whenMusicKitLoaded(): Promise<void> {
  if (window.MusicKit) return;
  await new Promise<void>((resolve) =>
    document.addEventListener("musickitloaded", () => resolve(), { once: true }),
  );
}

/** Configure MusicKit once (lazy — only when the user first hits play). */
export function initPlayer(): Promise<any> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await whenMusicKitLoaded();
    const developerToken = await invoke<string>("apple_developer_token");
    await window.MusicKit.configure({
      developerToken,
      app: { name: "DeetsMusic", build: "0.1.0" },
    });
    music = window.MusicKit.getInstance();
    await injectUserToken();
    wireEvents();
    applyVolumeToMusic(); // push the persisted level onto the fresh instance
    (window as any).__music = music; // introspect the opaque instance (dev + bug reports)
    (window as any).__player = { snap, queue: queueDump };
    diag.log("player:configured", { authorized: !!music.isAuthorized });
    console.log("[player] configured — authorized:", music.isAuthorized);
    return music;
  })();
  return initPromise;
}

/**
 * Give MusicKit our captured MUT without `authorize()`.
 *
 * MusicKit JS exposes no public "set user token" API (you're expected to call
 * `authorize()`, which we can't). The direct property assignment below works on some
 * builds; if it doesn't take, we log MusicKit's storage namespace so we can lock onto
 * the exact key it reads. This is THE thing to watch in the console on first run.
 */
async function injectUserToken(): Promise<void> {
  const mut = await invoke<string | null>("apple_user_token");
  if (!mut) {
    console.warn("[player] no captured MUT — connect Apple Music in Settings first");
    return;
  }
  try {
    music.musicUserToken = mut;
  } catch (e) {
    console.warn("[player] musicUserToken not directly settable:", e);
  }
  if (!music.isAuthorized) {
    console.warn(
      "[player] still not authorized after token inject — MusicKit localStorage keys:",
      Object.keys(localStorage),
    );
  }
}

// ── State broadcast (UI subscribes; we read straight off the live instance) ──────

export interface PlayerState {
  playing: boolean;
  title?: string;
  artist?: string;
  artworkUrl?: string;
  /** True while a (re)window is buffering — a jump/seek out of the gapless window.
   *  The UX cover-up hook (see docs/UX-COVERUPS.md); natural play never sets it. */
  loading?: boolean;
}

/** Build a concrete artwork URL from a MusicKit item's template (mirrors the library). */
function artworkUrlOf(item: any, px: number): string | undefined {
  const tmpl: unknown = item?.artwork?.url;
  if (typeof tmpl === "string") {
    const s = String(px);
    return tmpl.replace("{w}", s).replace("{h}", s).replace("{f}", "jpg");
  }
  return typeof item?.artworkURL === "string" ? item.artworkURL : undefined;
}

type Listener = (s: PlayerState) => void;
const listeners = new Set<Listener>();

/** Subscribe to playback state. Fires on play/pause and track change. Returns an unsubscribe fn. */
export function onPlayerState(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export interface PlayerProgress {
  progress: number; // 0..1
  currentTime: number; // seconds
  duration: number; // seconds
}

type ProgressListener = (p: PlayerProgress) => void;
const progressListeners = new Set<ProgressListener>();

/** Subscribe to playback position. Fires several times a second while playing. Returns an unsubscribe fn. */
export function onPlayerProgress(cb: ProgressListener): () => void {
  progressListeners.add(cb);
  return () => progressListeners.delete(cb);
}

function emitProgress(): void {
  const duration = music?.currentPlaybackDuration ?? 0;
  const currentTime = music?.currentPlaybackTime ?? 0;
  const progress = duration > 0 ? currentTime / duration : 0;
  progressListeners.forEach((cb) => cb({ progress, currentTime, duration }));
  // Credit a "full" once past the threshold — but only when the model's current IS the
  // song MusicKit is playing. During a context switch the model flips to the new song
  // while the old one is still emitting ticks; without the id check, song A finishing
  // at 92% credits song B a "full" it never played (and burns B's own latch).
  const cur = queue.getCurrent();
  const npId = music?.nowPlayingItem?.id;
  if (!loadingContext && cur && npId && (npId === cur.catalogId || npId === cur.libraryId)) {
    stats.recordProgress(cur, progress, currentTime);
  }
}

function emit(): void {
  const item = music?.nowPlayingItem;
  const s: PlayerState = {
    playing: !!music?.isPlaying,
    title: item?.title ?? item?.attributes?.name,
    artist: item?.artistName ?? item?.attributes?.artistName,
    artworkUrl: artworkUrlOf(item, 240),
    loading: isLoading,
  };
  listeners.forEach((cb) => cb(s));
}

let wired = false;
function wireEvents(): void {
  if (wired || !music) return;
  wired = true;
  const E = window.MusicKit.Events;
  music.addEventListener(E.playbackStateDidChange, emit);
  music.addEventListener(E.nowPlayingItemDidChange, onNowPlayingChange);
  music.addEventListener(E.playbackTimeDidChange, emitProgress);
}

function onNowPlayingChange(): void {
  if (!loadingContext) {
    syncModelToMusicKit();
    stats.recordStart(queue.getCurrent()); // a settled song-start counts as a partial play
    diag.log("player:np", snap());
    checkDesync();
    checkAlignment("np");
  }
  emit();
}

/** A small JSON-able snapshot of player + model state, for the diag log. */
function snap() {
  const cur = queue.getCurrent();
  return {
    windowPos,
    curId: cur?.catalogId ?? cur?.libraryId,
    npIndex: music?.nowPlayingItemIndex,
    qPos: music?.queue?.position,
    playing: !!music?.isPlaying,
    up: queue.getUpcoming().length,
  };
}

/** Log when the model's current no longer matches MusicKit's now-playing item. */
function checkDesync(): void {
  const cur = queue.getCurrent();
  const npId = music?.nowPlayingItem?.id;
  if (!cur || !npId) return;
  if (npId !== cur.catalogId && npId !== cur.libraryId) {
    diag.log("player:desync", {
      npId,
      curCat: cur.catalogId,
      curLib: cur.libraryId,
      windowPos,
      npIndex: music?.nowPlayingItemIndex,
    });
  }
}

// ── Upcoming alignment (model.upcoming ⟷ MusicKit's live window) ──────────────
//
// The lockstep invariant the whole queue rests on. `checkDesync` only watches `current`;
// this watches the UPCOMING list, which the manual-queue ops (enqueue/remove/move) and a
// future re-windower all mutate. The invariant: MusicKit's upcoming ids are an
// ORDER-PRESERVING SUBSEQUENCE of the model's upcoming ids — *subsequence*, not equality,
// because the fed window dedups repeats and is bounded (50/200), so the model legitimately
// has MORE upcoming, but never in a different order, and MusicKit must never hold an id the
// model doesn't. A break = an edit desynced the two.

function alignmentReport() {
  const items: any[] = music?.queue?.items ?? [];
  const np = typeof music?.nowPlayingItemIndex === "number" ? music.nowPlayingItemIndex : -1;
  const mkUp: string[] = np >= 0 ? items.slice(np + 1).map((it) => it?.id).filter(Boolean) : [];
  const modelUp = queue.getUpcoming().map((e) => playId(e));
  let i = 0;
  let firstMismatch: { mkPos: number; mkId: string } | null = null;
  for (let j = 0; j < mkUp.length; j++) {
    while (i < modelUp.length && modelUp[i] !== mkUp[j]) i++; // skip model-only ids (dedup/window)
    if (i >= modelUp.length) {
      firstMismatch = { mkPos: j, mkId: mkUp[j] }; // a MusicKit id the model doesn't have (in order)
      break;
    }
    i++;
  }
  return { aligned: !firstMismatch, firstMismatch, mkUpLen: mkUp.length, modelUpLen: modelUp.length };
}

/** Best-effort canary: log `player:misalign` when the upcoming lists diverge. */
function checkAlignment(where: string): void {
  if (loadingContext) return; // mid-(re)build — expected to differ
  const r = alignmentReport();
  if (!r.aligned) diag.log("player:misalign", { where, ...r.firstMismatch, mkUpLen: r.mkUpLen, modelUpLen: r.modelUpLen });
}

/** `window.__player.queue()` — model vs MusicKit upcoming, side by side, with the verdict. */
function queueDump() {
  const items: any[] = music?.queue?.items ?? [];
  const np = typeof music?.nowPlayingItemIndex === "number" ? music.nowPlayingItemIndex : -1;
  const fmt = (id?: string) => ({ id, title: trackById(id)?.title });
  const cur = queue.getCurrent();
  const mkTitle = (it: any) => it?.title ?? it?.attributes?.name;
  return {
    aligned: alignmentReport(),
    windowPos,
    nowPlaying: {
      mkIndex: np,
      mk: { id: items[np]?.id, title: mkTitle(items[np]) },
      model: cur ? fmt(playId(cur)) : null,
    },
    model: {
      historyLen: queue.getHistory().length,
      upcomingLen: queue.getUpcoming().length,
      upcoming: queue.getUpcoming().slice(0, 20).map((e, k) => ({ k, ...fmt(playId(e)), origin: e.origin })),
    },
    musickit: {
      len: items.length,
      upcoming: np >= 0 ? items.slice(np + 1, np + 21).map((it, k) => ({ k, id: it?.id, title: mkTitle(it) })) : [],
    },
  };
}

/**
 * DEV-ONLY THROWAWAY — the STATIONS.md §2 verify-first probe. Run `__probeStation()`
 * in the devtools console. Proves (or kills) MusicKit-JS station playback in WebView2:
 * searches the catalog for a station, tries `setQueue({ station })`, and reports what
 * actually plays. Delete once STATIONS lands (the real `playStation` replaces it).
 */
async function probeStation(term = "pop"): Promise<void> {
  const step = (name: string, data: unknown) => {
    diag.log("probe:station", { step: name, data });
    console.log(`[probe:station] ${name}`, data);
  };
  try {
    const m = await initPlayer();
    step("configured", { authorized: !!m.isAuthorized });

    // 1. Find a real station id via catalog search ({{storefront}} templating is v3-native).
    const res = await m.api.music("/v1/catalog/{{storefront}}/search", {
      term,
      types: "stations",
      limit: 5,
    });
    const stations: any[] = res?.data?.results?.stations?.data ?? [];
    step("search", stations.map((s) => ({ id: s.id, name: s.attributes?.name, isLive: s.attributes?.isLive })));
    if (!stations.length) {
      step("verdict", "NO STATIONS RETURNED — search failed, probe inconclusive");
      return;
    }
    const target = stations.find((s) => !s.attributes?.isLive) ?? stations[0];

    // 2. The load-bearing call: does MusicKit JS accept a station queue descriptor?
    await m.setQueue({ station: target.id });
    step("setQueue", { ok: true, station: target.id, name: target.attributes?.name });
    await m.play();

    // 3. Give it a moment, then read back what's actually playing.
    setTimeout(() => {
      const item = m.nowPlayingItem;
      step("verdict", item
        ? { PROVEN: true, playing: item.title ?? item.attributes?.name, state: m.playbackState }
        : { PROVEN: false, note: "setQueue accepted but nothing is playing — check playbackState/errors", state: m.playbackState });
    }, 4000);
  } catch (e) {
    step("verdict", { PROVEN: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
  }
}

// Exposed at module scope (probeStation boots the player itself), so the probe is
// runnable from the console on a fresh launch with nothing playing yet.
(window as any).__probeStation = probeStation;

/** Walk the queue model to match MusicKit's live position (natural advance + skips). */
function syncModelToMusicKit(): void {
  // `nowPlayingItemIndex` is the documented v3 index of the current item; `queue.position`
  // is a fallback (not populated in every build — relying on it left the model frozen,
  // so the now-playing song lingered at the top of Up Next).
  const idx = music?.nowPlayingItemIndex;
  const qp = music?.queue?.position;
  const p = typeof idx === "number" && idx >= 0 ? idx : typeof qp === "number" && qp >= 0 ? qp : -1;
  if (p < 0) {
    console.warn("[player] model-follow: MusicKit gave no queue position");
    return;
  }
  let diff = p - windowPos;
  while (diff > 0) {
    queue.advance();
    diff--;
  }
  while (diff < 0) {
    queue.previous();
    diff++;
  }
  windowPos = p;
}

// ── Context playback ───────────────────────────────────────────────────────────

// We feed MusicKit a bounded window around the start point rather than the whole
// context, so setQueue stays cheap even on a 10k-song library. The full plan lives in
// the queue model; the window gives native gapless + Previous-into-backlog around the
// click. (Re-windowing at the edges + syncing the model to MusicKit's live position
// land with the queue UI — see queue.ts.)
const WINDOW_BACK = 50;
const WINDOW_FWD = 200;

const toHandle = (t: Track, context = "library"): TrackHandle => ({
  catalogId: t.catalogId,
  libraryId: t.libraryId,
  context,
});

// Session denylist of ids MusicKit reported as unresolvable (NOT_FOUND from setQueue —
// catalog ids gone stale since the library cached them: region pulls, takedowns). A dead
// catalog id makes the handle fall back to its LIBRARY id (the user's copy usually still
// plays); a handle with no live id left is skipped by the window builders entirely.
const deadIds = new Set<string>();

/** Best play target for a handle — catalog id preferred, library id as fallback;
 *  ids MusicKit has declared dead this session are passed over. */
const playId = (h: TrackHandle): string | undefined => {
  if (h.catalogId && !deadIds.has(h.catalogId)) return h.catalogId;
  if (h.libraryId && !deadIds.has(h.libraryId)) return h.libraryId;
  return undefined;
};

/** Extract the id list from a MusicKit "items could not be resolved" rejection. */
function unresolvedIds(e: unknown): string[] {
  const msg = e instanceof Error ? e.message : String(e);
  const m = /could not be resolved:\s*(.+)/i.exec(msg);
  return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
}

/** The still-playable ids of a handle list (deadIds-aware, unplayables dropped). */
const liveIds = (hs: TrackHandle[]): string[] =>
  hs.map(playId).filter((id): id is string => !!id);

/**
 * Run a MusicKit insert (playNext/playLater) with the same NOT_FOUND self-healing as
 * doLoadFromModel's setQueue: the insert is all-or-nothing, so bank the ids MusicKit
 * names as unresolvable, rebuild the id list (playId swaps in library-id fallbacks or
 * drops the handle), retry. Ends silently once nothing playable is left — the model
 * keeps its entries; the window builders skip dead ones. See docs/QUEUE.md.
 */
async function insertWithRetry(
  where: string,
  run: (ids: string[]) => Promise<void>,
  rebuild: () => string[],
): Promise<void> {
  let ids = rebuild();
  for (let attempt = 0; ids.length; attempt++) {
    try {
      await run(ids);
      return;
    } catch (e) {
      const bad = unresolvedIds(e);
      if (!bad.length || attempt >= 2) throw e; // not a resolve failure, or persistently bad
      bad.forEach((id) => deadIds.add(id));
      diag.log("player:deadIds", { where, n: bad.length, attempt, bad: bad.slice(0, 10) });
      console.warn(`[player] ${where}: ${bad.length} unresolvable id(s) dropped; retrying`);
      ids = rebuild();
    }
  }
}

// Loads are SERIALIZED and COALESCED. Two concurrent loadFromModel calls would
// interleave their pause/setQueue/changeToMediaAtIndex sequences and desync
// `windowPos`/`loadingContext` (rapid-click two rows to reproduce). The chain runs
// them one at a time; the generation counter skips a queued load that a newer click
// has already superseded (the model holds the newest state — only the last load matters).
let loadGen = 0;
let loadChain: Promise<void> = Promise.resolve();

/**
 * (Re)feed MusicKit a bounded window centered on the model's current entry: up to
 * WINDOW_BACK behind it (so Previous works) + WINDOW_FWD ahead. Used for a fresh
 * context and for any jump that lands outside the live window — the latter buffers
 * (the documented latency; `loading` is surfaced for the cover-up).
 */
function loadFromModel(m: any, autoplay = true): Promise<void> {
  const gen = ++loadGen;
  const run = loadChain.then(() => {
    if (gen !== loadGen) {
      diag.log("player:loadSkip", { gen, superseded: loadGen });
      return; // a newer load was requested while this one waited — it covers the model's state
    }
    return doLoadFromModel(m, autoplay);
  });
  loadChain = run.then(
    () => {},
    () => {}, // keep the chain alive past a failed load
  );
  return run;
}

async function doLoadFromModel(m: any, autoplay = true): Promise<void> {
  const current = queue.getCurrent();
  if (!current) return;
  const back = queue.getHistory().slice(-WINDOW_BACK);
  const fwd = queue.getUpcoming().slice(0, WINDOW_FWD);

  // Build a DUPLICATE-FREE window. MusicKit's setQueue collapses repeated song ids, so
  // a window with dupes makes its real queue shorter than ours and throws off the index
  // changeToMediaAtIndex jumps to — landing on the wrong song. We dedupe here (first id
  // wins) and insert `current` first-class, so its index `pos` is always exact. The
  // queue model avoids most dupes already; this is the belt-and-suspenders for the case
  // a heard song reappears later in the forward context. See docs/QUEUE.md.
  //
  // Re-runnable because playId is deadIds-aware: after a NOT_FOUND rejection banks the
  // unresolvable ids, a rebuild swaps them for library-id fallbacks (or drops them).
  const buildWindow = (): { ids: string[]; pos: number } => {
    const curId = playId(current);
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const h of back) {
      const id = playId(h);
      if (!id || id === curId || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    const pos = ids.length; // current sits immediately after the deduped back-chain
    if (curId && !seen.has(curId)) {
      seen.add(curId);
      ids.push(curId);
    }
    for (const h of fwd) {
      const id = playId(h);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return { ids, pos };
  };
  let { ids, pos } = buildWindow();
  if (!ids.length) {
    console.warn("[player] nothing playable in window");
    return;
  }

  // Fallback watch: library-only songs (no catalogId) ride along as library ids. Whether
  // MusicKit plays those — and accepts a mixed list — is the thing to confirm on first run.
  const fallbacks = [...back, current, ...fwd].filter((h) => !h.catalogId && h.libraryId).length;
  if (fallbacks) console.log(`[player] window includes ${fallbacks} library-only song(s) via id fallback`);

  isLoading = true;
  loadingContext = true; // suppress model-follow while we (re)build MusicKit's queue
  emit(); // surface the loading state for the cover-up
  try {
    // Pause first so the queue swap starts from a clean transport. MusicKit refuses a
    // play() "without a previous stop()/pause()" while already playing — that error was
    // leaving the old song playing on every click. From paused, play() reliably enacts
    // the switch to the new index.
    if (m.isPlaying && typeof m.pause === "function") await m.pause();
    // setQueue is all-or-nothing: ONE unresolvable id rejects the whole window
    // (NOT_FOUND — stale catalog ids). The rejection names the offenders, so bank
    // them in deadIds, rebuild the window (library-id fallback / drop), and retry.
    for (let attempt = 0; ; attempt++) {
      try {
        await m.setQueue({ songs: ids });
        break;
      } catch (e) {
        const bad = unresolvedIds(e);
        if (!bad.length || attempt >= 2) throw e; // not a resolve failure, or persistently bad
        bad.forEach((id) => deadIds.add(id));
        diag.log("player:deadIds", { n: bad.length, attempt, bad: bad.slice(0, 10) });
        console.warn(`[player] ${bad.length} unresolvable id(s) dropped from window; retrying`);
        ({ ids, pos } = buildWindow());
        if (!ids.length) throw e; // everything in the window was dead
      }
    }
    windowPos = pos; // the model's `current` is aligned to this MusicKit index (computed above)
    diag.log("player:loadWindow", { ids: ids.length, pos });
    // pos=0 deliberately SKIPS changeToMediaAtIndex: setQueue already leaves the queue
    // at index 0, and changeToMediaAtIndex(0) races MusicKit's internal play (its event
    // handler fires play() on top of the in-flight one → the uncaught "play() without a
    // previous stop()/pause()" rejection). Plain play() below is sufficient there —
    // the historical "pos=0 doesn't start" symptom was really the dead-id NOT_FOUND
    // rejection (see the retry loop above), not a selection problem.
    if (pos > 0 && typeof m.changeToMediaAtIndex === "function") {
      await m.changeToMediaAtIndex(pos); // move to the clicked song within the window
    }
    if (autoplay && !m.isPlaying) await m.play(); // no-op if changeToMediaAtIndex already started
    stats.recordStart(queue.getCurrent()); // settled start (intermediate rebuild changes were suppressed)
  } catch (e) {
    // Surface and rethrow — but NEVER leave `loadingContext` stuck (the finally): a
    // rejection here used to suppress model-follow for the rest of the session.
    diag.log("player:loadError", { e: String(e) });
    console.warn("[player] load failed:", e);
    throw e;
  } finally {
    loadingContext = false;
    isLoading = false;
    emit();
  }
}

/**
 * Play an ordered context (already in the desired sort order) from `startIndex`.
 * `handles` is the full list; the queue model keeps all of it, MusicKit gets a window.
 */
export async function playContext(handles: TrackHandle[], startIndex: number): Promise<void> {
  const m = await initPlayer();
  diag.log("player:playContext", { startIndex, len: handles.length });

  // Idempotent re-click: clicking the song that's already current shouldn't tear down
  // and rebuild MusicKit's queue (a needless buffer/gap, and the path that used to
  // accumulate). Just restart it from the top — what people expect from re-clicking.
  const target = handles[startIndex];
  const cur = queue.getCurrent();
  if (target && cur && playId(target) && playId(target) === playId(cur) && m.nowPlayingItem) {
    diag.log("player:reclick", { id: playId(target) });
    await m.seekToTime(0);
    if (!m.isPlaying) await m.play();
    stats.recordRestart(cur); // a deliberate restart is a fresh play (no np-change fires here)
    return;
  }

  queue.setContext(handles, startIndex);
  await loadFromModel(m);
}

/** Jump to an Up Next entry by index (skipped songs are dropped). Re-windows → buffers. */
export async function jumpToUpcoming(index: number): Promise<void> {
  const m = await initPlayer();
  diag.log("player:jump", { index });
  if (!queue.jumpTo(index)) return;
  await loadFromModel(m);
}

/** Play library Tracks already in display/sort order, starting at `startIndex`. */
export function playTracks(tracks: Track[], startIndex: number, context = "library"): Promise<void> {
  return playContext(tracks.map((t) => toHandle(t, context)), startIndex);
}

// ── Manual queueing (Play Next / Add to Queue) ───────────────────────────────
//
// These INSERT into the live queue without a setQueue rebuild, so they're gapless:
// `music.playNext`/`playLater` are documented MusicKit ops that mutate the upcoming
// queue in place. We update our model in lockstep (the source of truth) — and because
// the insert never moves `current`, `windowPos` and model-follow stay aligned (the
// inserted items just appear at windowPos+1…, mirrored in both). When nothing is
// playing yet there's no `current` to insert after, so we bootstrap by playing the
// block as a fresh context. See docs/QUEUE.md.

/** Shared core: filter to playable handles, bootstrap if idle, else mutate model + MusicKit. */
async function enqueue(handles: TrackHandle[], where: "next" | "later"): Promise<void> {
  const playable = handles.filter((h) => playId(h));
  if (!playable.length) return;
  const m = await initPlayer();
  const libOnly = playable.filter((h) => !h.catalogId && h.libraryId).length;
  diag.log("player:enqueue", { where, n: playable.length, libOnly });

  if (!queue.getCurrent()) {
    await playContext(playable, 0); // nothing playing → start the block
    return;
  }
  if (where === "next") {
    queue.playNextMany(playable);
    if (typeof m.playNext === "function")
      await insertWithRetry("enqueue:next", (ids) => m.playNext({ songs: ids }), () => liveIds(playable));
  } else {
    queue.addToQueueMany(playable);
    if (typeof m.playLater === "function")
      await insertWithRetry("enqueue:later", (ids) => m.playLater({ songs: ids }), () => liveIds(playable));
  }
  checkAlignment(`enqueue:${where}`);
}

/** Insert handles right after the current song (gapless). */
export const enqueueNext = (handles: TrackHandle[]): Promise<void> => enqueue(handles, "next");
/** Append handles to the end of the queue (gapless). */
export const enqueueLater = (handles: TrackHandle[]): Promise<void> => enqueue(handles, "later");

/** Play-Next a list of library Tracks (e.g. a song, or an album in track order). */
export const queueTracksNext = (tracks: Track[], context = "library"): Promise<void> =>
  enqueueNext(tracks.map((t) => toHandle(t, context)));
/** Add-to-Queue a list of library Tracks. */
export const queueTracksLater = (tracks: Track[], context = "library"): Promise<void> =>
  enqueueLater(tracks.map((t) => toHandle(t, context)));

// ── Queue editing (Up Next context menu: Remove / Move to Top / Move to Bottom) ──
//
// All three act on UPCOMING items (after current), so `current`'s MusicKit index never
// moves — `windowPos` + model-follow stay valid. `music.queue.splice(index, count)` is a
// gapless live mutation that fires only `queueItemsDidChange` (NOT
// `nowPlayingItemDidChange`), so model-follow isn't disturbed. (It's MusicKit's supported
// queue mutator — the old `queue.remove` was deprecated in v3 and just forwarded to
// `splice(i, 1)` anyway.) Remove splices the item out; Move composes a splice-out + the
// documented `playNext`/`playLater` inserts. We update the model first (instant Qcard
// re-render), then mirror into MusicKit. See docs/QUEUE.md.

/**
 * MusicKit-queue index of the upcoming entry at model index `k`. The window feeds
 * `upcoming` in order after `current`, so it's `nowPlayingItemIndex + 1 + k` — but we
 * id-verify and fall back to a forward search, in case `setQueue`'s dedup drifted the
 * indices. Returns -1 if the entry isn't in MusicKit's window (then it's model-only).
 */
function mkUpcomingIndex(m: any, k: number, id: string): number {
  const items: any[] = m.queue?.items ?? [];
  const np = typeof m.nowPlayingItemIndex === "number" && m.nowPlayingItemIndex >= 0 ? m.nowPlayingItemIndex : windowPos;
  const guess = np + 1 + k;
  if (items[guess]?.id === id) return guess;
  for (let i = np + 1; i < items.length; i++) if (items[i]?.id === id) return i; // dedup drift
  return -1;
}

/** Remove an Up Next entry (gapless). */
export async function removeFromQueue(index: number): Promise<void> {
  const entry = queue.getUpcoming()[index];
  if (!entry) return;
  const m = await initPlayer();
  const id = playId(entry);
  const mk = id ? mkUpcomingIndex(m, index, id) : -1;
  diag.log("player:queueEdit", { op: "remove", index, mk, id });
  queue.removeAt(index); // model first → Qcard updates instantly
  if (mk >= 0 && typeof m.queue?.splice === "function") m.queue.splice(mk, 1);
  checkAlignment("remove");
}

/** Move an Up Next entry to the front (top) or back (bottom) of upcoming (gapless). */
export async function moveInQueue(index: number, to: "top" | "bottom"): Promise<void> {
  const up = queue.getUpcoming();
  const entry = up[index];
  if (!entry) return;
  const m = await initPlayer();
  const id = playId(entry);
  const mk = id ? mkUpcomingIndex(m, index, id) : -1; // resolve before we mutate anything
  diag.log("player:queueEdit", { op: `move-${to}`, index, mk, id });
  queue.move(index, to === "top" ? 0 : up.length - 1); // model first → Qcard updates instantly
  // MusicKit: pull it from its slot, re-insert at the chosen end (both gapless inserts).
  if (mk >= 0 && typeof m.queue?.splice === "function") m.queue.splice(mk, 1);
  if (id) {
    const one = () => liveIds([entry]); // re-resolves after a dead-id bank (fallback or drop)
    if (to === "top" && typeof m.playNext === "function")
      await insertWithRetry("move-top", (ids) => m.playNext({ songs: ids }), one);
    else if (to === "bottom" && typeof m.playLater === "function")
      await insertWithRetry("move-bottom", (ids) => m.playLater({ songs: ids }), one);
  }
  checkAlignment(`move-${to}`);
}

/**
 * Reflect an arbitrary model reorder into MusicKit's live window — GAPLESSLY. The model is
 * the source of truth; this rebuilds only the **divergent suffix** of MusicKit's upcoming
 * (`remove` everything from the first mismatch to the end, then `playLater` the model's
 * upcoming from there). Both ops leave `current` untouched, so no `setQueue`, no buffer.
 * Bounded by `WINDOW_FWD` (MusicKit only ever holds the forward window). This is the general
 * sync primitive — drag-reorder uses it, and re-windowing (roadmap) will too. See docs/QUEUE.md.
 */
export async function reconcileUpcoming(): Promise<void> {
  if (!music) return;
  const m = music;
  const items: any[] = m.queue?.items ?? [];
  const np = typeof m.nowPlayingItemIndex === "number" ? m.nowPlayingItemIndex : -1;
  if (np < 0) return;

  // Expected MK upcoming = model upcoming, deduped against what MK already holds up to current,
  // capped to the window (forward-only mirror of loadFromModel's dedup — current is never touched).
  // A closure so the NOT_FOUND retry can rebuild it after a dead-id bank (playId is deadIds-aware).
  const computeExpected = (): string[] => {
    const seen = new Set<string>();
    for (let i = 0; i <= np; i++) {
      const id = items[i]?.id;
      if (id) seen.add(id);
    }
    const expected: string[] = [];
    for (const e of queue.getUpcoming()) {
      if (expected.length >= WINDOW_FWD) break;
      const id = playId(e);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      expected.push(id);
    }
    return expected;
  };
  const expected = computeExpected();

  const mkUp: string[] = items.slice(np + 1).map((it) => it?.id);
  let d = 0;
  while (d < mkUp.length && d < expected.length && mkUp[d] === expected[d]) d++;
  if (d === mkUp.length && d === expected.length) return; // already in sync

  diag.log("player:reconcile", { d, mk: mkUp.length, expected: expected.length });
  const drop = mkUp.length - d; // MK's divergent suffix is contiguous: [np+1+d .. end]
  if (drop > 0 && typeof m.queue?.splice === "function") m.queue.splice(np + 1 + d, drop); // one splice, one queueItemsDidChange
  // The matched prefix [0..d) resolved in MK already, so it can't be dead — a retry
  // rebuild only ever changes the tail.
  if (typeof m.playLater === "function")
    await insertWithRetry("reconcile", (ids) => m.playLater({ songs: ids }), () => computeExpected().slice(d));
  checkAlignment("reconcile");
}

// ── Shuffle (one-shot; the NP card's shuffle button) ─────────────────────────

/**
 * Shuffle the remaining queue once. Playing: manual picks rise to the top, the auto
 * tail shuffles (queue.shuffleUpcoming), and MusicKit's live window is reconciled
 * gaplessly — same primitive as drag-reorder, `current` never moves. Idle: plays the
 * whole cached library shuffled. Both behaviors have future-setting knobs
 * (FUTURE-SETTINGS §5); the P6 persistent shuffle MODE is a separate, later feature.
 */
export async function shuffleQueue(): Promise<void> {
  await initPlayer();
  if (!queue.getCurrent()) {
    const all = tracks();
    if (!all.length) {
      console.warn("[player] shuffle: no cached library to play");
      return;
    }
    const handles = queue.shuffleInPlace(all.map((t) => toHandle(t)));
    diag.log("player:shuffle", { idle: true, n: handles.length });
    await playContext(handles, 0);
    return;
  }
  diag.log("player:shuffle", { idle: false, up: queue.getUpcoming().length });
  queue.shuffleUpcoming();
  await reconcileUpcoming();
}

// ── Transport ────────────────────────────────────────────────────────────────

/** Toggle play/pause. With nothing queued, starts the cached library from the top. */
export async function playPause(): Promise<void> {
  const m = await initPlayer();
  if (m.isPlaying) {
    await m.pause();
    return;
  }
  if (m.nowPlayingItem) {
    await m.play();
    return;
  }
  const page = await libraryTracks(0, 200);
  const handles = page.items.map((t) => toHandle(t));
  const start = handles.findIndex((h) => playId(h));
  if (start < 0) {
    console.warn("[player] no cached track to play");
    return;
  }
  await playContext(handles, start);
}

/** Skip forward (native within the fed window). */
export async function nextTrack(): Promise<void> {
  const m = await initPlayer();
  diag.log("player:next", snap());
  if (typeof m.skipToNextItem === "function") await m.skipToNextItem();
}

/** Restart the song if we're past the intro, otherwise skip back. */
export async function prevTrack(): Promise<void> {
  const m = await initPlayer();
  const at = Math.round(m.currentPlaybackTime ?? 0);
  diag.log("player:prev", { at, ...snap() });
  if (at > 3) {
    await m.seekToTime(0);
    return;
  }
  if (typeof m.skipToPreviousItem === "function") await m.skipToPreviousItem();
}

/** Seek to a fraction (0..1) of the current track's duration. */
export async function seekToFraction(fraction: number): Promise<void> {
  if (!music) return;
  const duration = music.currentPlaybackDuration ?? 0;
  if (duration <= 0) return;
  const clamped = Math.max(0, Math.min(1, fraction));
  await music.seekToTime(clamped * duration);
}

// ── Volume ───────────────────────────────────────────────────────────────────
//
// App-side software gain on OUR MusicKit instance (`music.volume`, 0..1) — it
// scales our stream BEFORE the Windows per-app mixer, exactly like the level
// inside Spotify/Apple Music. It is not the system volume.
//
// `level` is the underlying slider position; `muted` is an overlay (mute keeps
// the level so unmute can restore it). The effective output is 0 while muted.
// Both persist to localStorage and re-apply on the next launch. Because the
// MusicKit instance only exists after first play, `setVolume` is safe to call
// early — the value is stored and pushed onto the instance in `initPlayer`.

const VOLUME_KEY = "deets.volume";
const MUTE_KEY = "deets.muted";

let level = readStoredLevel(); // 0..1
let muted = localStorage.getItem(MUTE_KEY) === "true";
let preMuteLevel = level > 0 ? level : 0.5; // restore target for unmute

function readStoredLevel(): number {
  const raw = localStorage.getItem(VOLUME_KEY);
  const n = raw == null ? 1 : Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
}

/** Push the current effective level onto the live instance (no-op pre-init). */
function applyVolumeToMusic(): void {
  if (!music) return;
  try {
    music.volume = muted ? 0 : level;
  } catch (e) {
    console.warn("[player] volume not settable:", e);
  }
}

function persistVolume(): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(level));
    localStorage.setItem(MUTE_KEY, String(muted));
  } catch {
    /* storage disabled — still applies for the session */
  }
}

/** Effective output level (0..1) — 0 while muted. Drives the pill + slider UI. */
export function getVolume(): number {
  return muted ? 0 : level;
}

/** Whether output is currently muted (distinct from level === 0). */
export function isMuted(): boolean {
  return muted;
}

/** Set the level from the slider (0..1). Dragging to 0 reads as muted. */
export function setVolume(v: number): void {
  level = Math.max(0, Math.min(1, v));
  muted = level === 0;
  if (level > 0) preMuteLevel = level;
  applyVolumeToMusic();
  persistVolume();
}

/** Toggle mute, restoring the pre-mute level on unmute. */
export function toggleMute(): void {
  if (muted) {
    muted = false;
    if (level === 0) level = preMuteLevel; // dragged-to-zero → restore something audible
  } else {
    preMuteLevel = level > 0 ? level : preMuteLevel;
    muted = true;
  }
  applyVolumeToMusic();
  persistVolume();
}
