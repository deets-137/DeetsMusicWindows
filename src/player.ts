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
  };
  listeners.forEach((cb) => cb(s));
}

let wired = false;
function wireEvents(): void {
  if (wired || !music) return;
  wired = true;
  const E = window.MusicKit.Events;
  music.addEventListener(E.playbackStateDidChange, emit);
  music.addEventListener(E.nowPlayingItemDidChange, emit);
  music.addEventListener(E.playbackTimeDidChange, emitProgress);
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
 * Play an ordered context (already in the desired sort order) from `startIndex`.
 * `handles` is the full list; the queue model keeps all of it, MusicKit gets a window.
 */
export async function playContext(handles: TrackHandle[], startIndex: number): Promise<void> {
  const m = await initPlayer();
  queue.setContext(handles, startIndex);

  const from = Math.max(0, startIndex - WINDOW_BACK);
  const to = Math.min(handles.length, startIndex + WINDOW_FWD);
  const windowHandles = handles.slice(from, to);
  const ids = windowHandles.map(playId).filter((x): x is string => !!x);
  if (!ids.length) {
    console.warn("[player] context has no playable ids");
    return;
  }

  // Fallback watch: library-only songs (no catalogId) ride along as library ids. Whether
  // MusicKit plays those — and accepts a mixed list — is the thing to confirm on first run.
  const fallbacks = windowHandles.filter((h) => !h.catalogId && h.libraryId).length;
  if (fallbacks) console.log(`[player] window includes ${fallbacks} library-only song(s) via id fallback`);

  await m.setQueue({ songs: ids });
  // Count only id-bearing handles before the click, so a dropped (id-less) song earlier
  // in the window doesn't shift the jump target.
  const pos = windowHandles.slice(0, startIndex - from).filter((h) => playId(h)).length;
  if (pos > 0 && typeof m.changeToMediaAtIndex === "function") {
    await m.changeToMediaAtIndex(pos); // jump to the clicked song within the window
  }
  await m.play();
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
