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
import { trackById, tracks, addTransientTracks, inLibrary } from "./track-store";
import { materializeTrack } from "./search";
import { recordStationPlay, type Station } from "./radio";
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

// ── Radio mode (STATIONS.md §1–2) ────────────────────────────────────────────
// While an Apple station plays, MusicKit OWNS the queue and its refill — the model
// keeps only the heard trail (stationFollow). Every window-machinery path
// (model-follow walk, top-up, reconcile, alignment canaries) is guarded on `mode`.
type PlayerMode = "queue" | "radio";
let mode: PlayerMode = "queue";
let radioStation: Station | null = null;
// A manual insert during radio waits for the CURRENT song to end (your call,
// 2026-07-03), then the block takes over as a finite queue (see onNowPlayingChange).
let pendingBreakout = false;

function exitRadio(): void {
  mode = "queue";
  radioStation = null;
  pendingBreakout = false;
}

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
    installMusicKitRejectionFilter();
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

// During a queue transition MusicKit's own event handlers re-issue play() on their
// INTERNAL promise chains — chains we don't await, so a throw there surfaces as an
// "Uncaught (in promise)" we can't try/catch. Three are benign transport races that do
// NOT affect the song that actually plays (verified with the station break-out swap):
//  - "play() … without a previous stop() or pause()" — an internal re-play mid-swap.
//  - "play() request was interrupted by a new load request" (AbortError) — a load
//    superseded by a newer one (our own coalescing does this by design).
//  - "play() request was interrupted by a call to pause()" — setQueue's implicit
//    item-0 buffering cut off by our changeToMediaAtIndex() jump (fires whenever you
//    play a song that ISN'T first in its context, so pos>0). The clicked song still
//    plays; the abandoned item-0 play() promise is what rejects.
// The first two arrive as unhandled rejections (console noise) — swallowed here. The
// third, MusicKit ALSO pops as a BLOCKING window.alert() (its own catch calls alert — the
// minified-musickit dialog setStationQueue hit), which FREEZES the transport mid-transition
// (the real cause of the "Not playing" stall behind the dialog). preventDefault on the
// rejection event can't reach an alert(), and MusicKit can own its alert reference from
// load — so that surface is guarded by an inline script in index.html that runs BEFORE
// musickit.js (keep its regex in sync with BENIGN_PLAYBACK below). This handler covers only
// the console/rejection surface. Swallow EXACTLY these; everything else propagates untouched
// (our own awaited play()/setQueue still surface through their normal try/catch).
const BENIGN_PLAYBACK =
  /play\(\) (?:method was called without a previous stop\(\) or pause\(\)|request was interrupted by (?:a new load request|a call to pause\(\)))/i;

let rejectionFilterInstalled = false;
function installMusicKitRejectionFilter(): void {
  if (rejectionFilterInstalled) return;
  rejectionFilterInstalled = true;
  window.addEventListener("unhandledrejection", (e) => {
    const msg = e.reason instanceof Error ? e.reason.message : String(e.reason ?? "");
    if (BENIGN_PLAYBACK.test(msg)) {
      diag.log("player:mkRaceSwallowed", { via: "rejection", msg });
      e.preventDefault(); // benign MusicKit transport race — keep it out of the console
    }
  });
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
  /** Set while an Apple station owns the queue (radio mode). `live` drives the
   *  transport caps: no seek, no skip, LIVE indicator (STATIONS.md §1). */
  station?: { name: string; live: boolean };
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
    station:
      mode === "radio" && radioStation
        ? { name: radioStation.name, live: radioStation.isLive }
        : undefined,
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
    if (mode === "radio") {
      // Break-out boundary: a manual insert waited for the current song to end —
      // the block takes over as a finite queue now. The station's next song may
      // sound for a beat while the rebuild buffers (`loading` covers it).
      // FUTURE-SETTINGS §17: optionally resume the station when that queue ends.
      if (pendingBreakout && queue.getUpcoming().length) {
        diag.log("player:breakout", { n: queue.getUpcoming().length });
        exitRadio();
        queue.advance(); // finished station song → trail; block's first song → current
        // Defer the rebuild OUT of this nowPlayingItemDidChange handler (a macrotask lets
        // MusicKit settle its in-flight station advance first), and load with stopFirst +
        // noBack: fully stop the station controller, then start the block at index 0. This
        // is what stops MusicKit's next station song from continuing to play under a model
        // that has already moved to the block. Model-follow stays suppressed across the gap.
        loadingContext = true;
        const m = music;
        setTimeout(() => {
          loadFromModel(m, true, { stopFirst: true, noBack: true }).catch((e) => {
            loadingContext = false; // never leave follow wedged if the load bailed
            console.warn("[player] breakout load:", e);
          });
        }, 0);
      } else {
        pendingBreakout = false; // an emptied block (rows removed) — stay in radio
        stationFollow();
        diag.log("player:np", snap());
      }
    } else {
      syncModelToMusicKit();
      stats.recordStart(queue.getCurrent()); // a settled song-start counts as a partial play
      diag.log("player:np", snap());
      checkDesync();
      checkAlignment("np");
      maybeTopUpWindow();
    }
  }
  emit();
}

/**
 * Radio model-follow (STATIONS.md §2): mirror MusicKit's now-playing item into the
 * model — previous `current` joins the heard trail, the new song becomes `current` —
 * after ingesting it through the same funnel every play passes (transient + durable
 * 'seen' row), so the trail resolves in the Qcard/History/Rewind and durable plays are
 * logged (record_play / play_events, keyed by catalog id).
 *
 * Gate: skip only the station CONTAINER item (`ra.…`), which MusicKit sometimes surfaces
 * as now-playing between tracks. We deliberately do NOT gate on the item's kind/type —
 * station-fed song items don't always report `kind:"song"` the way library songs do, and
 * that check was silently dropping every station play from history. A real song has a
 * non-`ra.` id; that's the only reliable discriminator. (`snap`/diag logs type+kind so a
 * genuinely non-song item — a live DJ segment without an id — can be spotted if needed.)
 */
function stationFollow(): void {
  const item = music?.nowPlayingItem;
  const id: string | undefined = item?.id;
  if (!item || !id) return;
  diag.log("player:stationFollow", { id, type: item?.type, kind: item?.playParams?.kind });
  if (id.startsWith("ra.")) return; // the station container itself, not a track
  const cur = queue.getCurrent();
  if (cur && (cur.catalogId === id || cur.libraryId === id)) return; // duplicate event
  const a = item.attributes ?? {};
  const tmpl: unknown = item?.artwork?.url ?? a?.artwork?.url;
  const t: Track = {
    catalogId: id,
    title: item.title ?? a.name ?? "",
    artistName: item.artistName ?? a.artistName ?? "",
    albumName: item.albumName ?? a.albumName,
    durationMs: a.durationInMillis,
    genres: [],
    hasLyrics: false,
    artwork:
      typeof tmpl === "string"
        ? {
            urlTemplate: tmpl,
            width: item?.artwork?.width ?? 0,
            height: item?.artwork?.height ?? 0,
          }
        : undefined,
  };
  addTransientTracks([t]);
  if (!inLibrary(id)) materializeTrack(t);
  queue.appendCurrent({
    catalogId: id,
    context: radioStation ? `station:${radioStation.id}` : "station",
  });
  stats.recordStart(queue.getCurrent());
}

// ── Re-windowing: forward top-up (roadmap #3) ─────────────────────────────────
//
// MusicKit only holds a bounded window (WINDOW_FWD ahead), so a long context would
// dead-end at the window edge. As playback advances and MusicKit's remaining upcoming
// drains below the low-water mark, reconcileUpcoming() refills it back up to WINDOW_FWD
// from the model — one batched playLater, GAPLESS (current never moves, no setQueue).
// Hysteresis: one refill every ~(WINDOW_FWD − REWINDOW_LOW) songs, not one per track.
// The backward edge (Previous past the fed window) can't be gapless — no "play-earlier"
// insert exists — so prevTrack re-windows with the documented buffer instead.

const REWINDOW_LOW = 50;
let toppingUp = false; // reconcile is async — don't stack a second top-up on an in-flight one

function maybeTopUpWindow(): void {
  if (toppingUp || !music || mode === "radio") return; // stations refill themselves
  const items: any[] = music.queue?.items ?? [];
  const np = typeof music.nowPlayingItemIndex === "number" ? music.nowPlayingItemIndex : -1;
  if (np < 0) return;
  const mkRemaining = items.length - np - 1;
  if (mkRemaining >= REWINDOW_LOW) return;
  // Model has nothing beyond what MusicKit already holds → natural end of the plan.
  // (Extras that dedup/dead-drop to nothing make reconcile a cheap early return.)
  if (queue.getUpcoming().length <= mkRemaining) return;
  toppingUp = true;
  diag.log("player:topUp", { mkRemaining, modelUp: queue.getUpcoming().length, mkLen: items.length });
  reconcileUpcoming()
    .catch((e) => console.warn("[player] window top-up failed:", e))
    .finally(() => {
      toppingUp = false;
    });
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

// Play/queue callers hand us full Tracks, but the queue model keeps only id handles —
// so the Qcard later resolves those ids back to Tracks via the store. Library songs are
// already in the store; catalog-only songs (playlists, albums, stations not in the
// user's library) are NOT, and would render as "Unknown" until they became current.
// Ingest them as transients here, at the one funnel every Track[]-play passes through,
// so every collection resolves — no per-card ingest needed (Search still does its own
// alongside materializeTrack; that's idempotent). Library copies still win in trackById
// (byId is checked before transients), so ingesting library songs here is a harmless no-op.
const handlesFrom = (list: Track[], context: string): TrackHandle[] => {
  addTransientTracks(list);
  // The DURABLE twin of the transient ingest: persist catalog-only tracks as 'seen'
  // rows so plays logged against them (play_events / play_stats) still resolve to
  // metadata in FUTURE sessions — the Rewind card reads history across restarts.
  // Synced library tracks skip (the sync owns their rows); materialize_track is a
  // local DO-NOTHING-on-conflict upsert, so re-plays are cheap and idempotent.
  for (const t of list) if (!inLibrary(t.catalogId ?? t.libraryId)) materializeTrack(t);
  return list.map((t) => toHandle(t, context));
};

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
// Load options. Break-out from a station sets both: `stopFirst` fully stops MusicKit's
// continuous (station) controller before the swap — a mere pause() leaves it primed to
// advance, and its next-track load then interrupts our setQueue/play (AbortError);
// `noBack` omits the history back-chain so `current` sits at index 0, taking the plain
// pos=0 play path and skipping the changeToMediaAtIndex that races the station transition.
interface LoadOpts {
  stopFirst?: boolean;
  noBack?: boolean;
}

function loadFromModel(m: any, autoplay = true, opts: LoadOpts = {}): Promise<void> {
  const gen = ++loadGen;
  const run = loadChain.then(() => {
    if (gen !== loadGen) {
      diag.log("player:loadSkip", { gen, superseded: loadGen });
      return; // a newer load was requested while this one waited — it covers the model's state
    }
    return doLoadFromModel(m, autoplay, opts);
  });
  loadChain = run.then(
    () => {},
    () => {}, // keep the chain alive past a failed load
  );
  return run;
}

async function doLoadFromModel(m: any, autoplay = true, opts: LoadOpts = {}): Promise<void> {
  // Any finite-window load IS queue-mode playback — jumps, Play Now, the break-out,
  // Previous re-window all land here, so radio exits in one place.
  exitRadio();
  const current = queue.getCurrent();
  if (!current) return;
  const back = opts.noBack ? [] : queue.getHistory().slice(-WINDOW_BACK);
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
    // Clean the transport before the swap. MusicKit refuses a play() "without a previous
    // stop()/pause()" while already playing. Normally pause() is enough; leaving a STATION
    // needs a full stop() (`stopFirst`) — pausing a continuous controller leaves it primed
    // to advance, and that advance interrupts our setQueue/play (AbortError).
    if (opts.stopFirst && typeof m.stop === "function") await m.stop();
    else if (m.isPlaying && typeof m.pause === "function") await m.pause();
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
  return playContext(handlesFrom(tracks, context), startIndex);
}

// ── Radio playback (STATIONS.md §2) ──────────────────────────────────────────

/**
 * Feed MusicKit the station queue. WHICH descriptor MusicKit JS v3 accepts for a
 * station is the spec's load-bearing unknown — so the first real click IS the probe:
 * try the plausible shapes in order and diag-log which one took (watch the console).
 */
async function setStationQueue(m: any, s: Station): Promise<void> {
  // Only the two id-based descriptor shapes — both are real MusicKit-JS queue
  // descriptors. The earlier {url} probe is dropped: passing a URL descriptor made
  // MusicKit try to build a media item from a shape it only half-supports and throw
  // internally ("s is not a constructor" — a minified musickit.js error surfaced as a
  // dialog). If BOTH id shapes ever fail on a real station, that's the news to chase.
  const candidates: Array<[string, unknown]> = [
    ["station", { station: s.id }],
    ["stations", { stations: [s.id] }],
  ];
  let lastErr: unknown = null;
  for (const [shape, desc] of candidates) {
    try {
      await m.setQueue(desc);
      diag.log("player:stationQueue", { shape, id: s.id, mkLen: m.queue?.items?.length });
      console.log(`[player] station queued via {${shape}} — MusicKit holds ${m.queue?.items?.length ?? "?"} item(s)`);
      return;
    } catch (e) {
      lastErr = e;
      diag.log("player:stationQueueFail", { shape, id: s.id, e: String(e) });
      console.warn(`[player] station descriptor {${shape}} rejected:`, e);
    }
  }
  throw lastErr ?? new Error("no station descriptor accepted");
}

/**
 * Play an Apple station (radio mode). MusicKit owns the queue + refill; our model
 * keeps only the heard trail via stationFollow, so Previous-history, stats, and
 * Rewind stay whole. Entering disposes the finite plan — manual picks included (an
 * explicit departure). Exit = Stop Station, any finite-context play, or a break-out.
 */
export async function playStation(s: Station): Promise<void> {
  const m = await initPlayer();
  diag.log("player:playStation", { id: s.id, live: s.isLive });
  queue.disposePlan();
  mode = "radio";
  radioStation = s;
  pendingBreakout = false;
  isLoading = true;
  loadingContext = true; // suppress model-follow while the station queue builds
  emit();
  try {
    if (m.isPlaying && typeof m.pause === "function") await m.pause();
    await setStationQueue(m, s);
    if (!m.isPlaying) await m.play();
    recordStationPlay(s); // recents — an actual play, not a browse
  } catch (e) {
    exitRadio();
    diag.log("player:stationError", { id: s.id, e: String(e) });
    console.warn("[player] station failed:", e);
    throw e;
  } finally {
    loadingContext = false;
    isLoading = false;
    // The first track may have landed while model-follow was suppressed — settle it
    // now; if MusicKit is still fetching, the coming np-change event handles it.
    if (mode === "radio") stationFollow();
    emit();
  }
}

/**
 * Stop Station (the Qcard affordance). The plan was disposed on entry, so this lands
 * on an idle transport; the heard trail stays (Previous/History unaffected). Clears
 * MusicKit's station queue where possible so a later Play can't resurrect the stream
 * behind queue-mode's back.
 */
export async function stopStation(): Promise<void> {
  if (mode !== "radio") return;
  const m = await initPlayer();
  diag.log("player:stopStation", { id: radioStation?.id });
  exitRadio();
  try {
    if (typeof m.stop === "function") await m.stop();
    else if (typeof m.pause === "function") await m.pause();
  } catch (e) {
    console.warn("[player] stop station:", e);
  }
  // clearQueue is UNSUPPORTED for continuous/station playback — best-effort, quiet.
  // (stop() already halts the stream; this only tidies the queue when allowed.)
  try {
    if (typeof m.clearQueue === "function") await m.clearQueue();
  } catch {
    /* unsupported for station playback — expected */
  }
  emit();
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
  if (mode === "radio") {
    // Radio break-out, deferred to the song boundary (your call, 2026-07-03): the
    // block lands in the MODEL only — MusicKit's station queue is left alone until
    // the current song ends, where onNowPlayingChange swaps engines. The Qcard shows
    // the block as Up Next meanwhile (editable, model-only).
    // FUTURE-SETTINGS §17: optionally resume the station when the block ends.
    if (where === "next") queue.playNextMany(playable);
    else queue.addToQueueMany(playable);
    pendingBreakout = true;
    diag.log("player:enqueueRadio", { where, n: playable.length });
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
  enqueueNext(handlesFrom(tracks, context));
/** Add-to-Queue a list of library Tracks. */
export const queueTracksLater = (tracks: Track[], context = "library"): Promise<void> =>
  enqueueLater(handlesFrom(tracks, context));

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
  // Radio: MusicKit's queue is station-owned; a break-out block edit is model-only.
  if (!music || mode === "radio") return;
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
  // Radio: no backward walk in v1 — re-windowing into an Apple station's trail means
  // requesting songs Apple may refuse to replay (STATIONS.md risk). Restart-only above.
  if (mode === "radio") return;
  // Backward window edge: MusicKit holds nothing before current (index 0), but the
  // model still has history — skipToPreviousItem would silently no-op. Re-window
  // around the previous entry instead (a fresh setQueue → the documented buffer;
  // `loading` covers it). No gapless path exists backwards.
  const np = typeof m.nowPlayingItemIndex === "number" ? m.nowPlayingItemIndex : -1;
  if (np === 0 && queue.getHistory().length) {
    diag.log("player:prevRewindow", { hist: queue.getHistory().length });
    queue.previous();
    await loadFromModel(m);
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
