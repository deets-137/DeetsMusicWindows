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

/** Subscribe to playback state. Fires on play/pause and track change. */
export function onPlayerState(cb: Listener): void {
  listeners.add(cb);
}

export interface PlayerProgress {
  progress: number; // 0..1
  currentTime: number; // seconds
  duration: number; // seconds
}

type ProgressListener = (p: PlayerProgress) => void;
const progressListeners = new Set<ProgressListener>();

/** Subscribe to playback position. Fires several times a second while playing. */
export function onPlayerProgress(cb: ProgressListener): void {
  progressListeners.add(cb);
}

function emitProgress(): void {
  const duration = music?.currentPlaybackDuration ?? 0;
  const currentTime = music?.currentPlaybackTime ?? 0;
  const progress = duration > 0 ? currentTime / duration : 0;
  progressListeners.forEach((cb) => cb({ progress, currentTime, duration }));
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
  if (!loadingContext) syncModelToMusicKit();
  emit();
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

/** Best play target for a handle — catalog id preferred, library id as fallback. */
const playId = (h: TrackHandle): string | undefined => h.catalogId ?? h.libraryId;

/**
 * (Re)feed MusicKit a bounded window centered on the model's current entry: up to
 * WINDOW_BACK behind it (so Previous works) + WINDOW_FWD ahead. Used for a fresh
 * context and for any jump that lands outside the live window — the latter buffers
 * (the documented latency; `loading` is surfaced for the cover-up).
 */
async function loadFromModel(m: any, autoplay = true): Promise<void> {
  const current = queue.getCurrent();
  if (!current) return;
  const back = queue.getHistory().slice(-WINDOW_BACK);
  const fwd = queue.getUpcoming().slice(0, WINDOW_FWD);
  const windowEntries = [...back, current, ...fwd];
  const ids = windowEntries.map(playId).filter((x): x is string => !!x);
  if (!ids.length) {
    console.warn("[player] nothing playable in window");
    return;
  }

  // Fallback watch: library-only songs (no catalogId) ride along as library ids. Whether
  // MusicKit plays those — and accepts a mixed list — is the thing to confirm on first run.
  const fallbacks = windowEntries.filter((h) => !h.catalogId && h.libraryId).length;
  if (fallbacks) console.log(`[player] window includes ${fallbacks} library-only song(s) via id fallback`);

  isLoading = true;
  loadingContext = true; // suppress model-follow while we (re)build MusicKit's queue
  emit(); // surface the loading state for the cover-up
  // Pause first so the queue swap starts from a clean transport. MusicKit refuses a
  // play() "without a previous stop()/pause()" while already playing — that error was
  // leaving the old song playing on every click. From paused, play() reliably enacts
  // the switch to the new index.
  if (m.isPlaying && typeof m.pause === "function") await m.pause();
  await m.setQueue({ songs: ids });
  // Current's index in the fed window = count of id-bearing handles behind it.
  const pos = back.filter((h) => playId(h)).length;
  windowPos = pos; // the model's `current` is aligned to this MusicKit index
  if (pos > 0 && typeof m.changeToMediaAtIndex === "function") {
    await m.changeToMediaAtIndex(pos); // move to the clicked song within the window
  }
  if (autoplay && !m.isPlaying) await m.play(); // no-op if changeToMediaAtIndex already started
  loadingContext = false;
  isLoading = false;
  emit();
}

/**
 * Play an ordered context (already in the desired sort order) from `startIndex`.
 * `handles` is the full list; the queue model keeps all of it, MusicKit gets a window.
 */
export async function playContext(handles: TrackHandle[], startIndex: number): Promise<void> {
  const m = await initPlayer();
  queue.setContext(handles, startIndex);
  await loadFromModel(m);
}

/** Jump to an Up Next entry by index (skipped songs are dropped). Re-windows → buffers. */
export async function jumpToUpcoming(index: number): Promise<void> {
  const m = await initPlayer();
  if (!queue.jumpTo(index)) return;
  await loadFromModel(m);
}

/** Play library Tracks already in display/sort order, starting at `startIndex`. */
export function playTracks(tracks: Track[], startIndex: number, context = "library"): Promise<void> {
  return playContext(tracks.map((t) => toHandle(t, context)), startIndex);
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
  if (typeof m.skipToNextItem === "function") await m.skipToNextItem();
}

/** Restart the song if we're past the intro, otherwise skip back. */
export async function prevTrack(): Promise<void> {
  const m = await initPlayer();
  if ((m.currentPlaybackTime ?? 0) > 3) {
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
