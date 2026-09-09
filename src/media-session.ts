// Windows media-key / SMTC bridge (probe path — no native dependency).
//
// Chromium's Media Session API is the zero-dependency route to the Windows media
// flyout: when the renderer declares metadata + action handlers on a page that is
// actually playing audio, Chromium registers a System Media Transport Controls
// session for the process, which is what puts artwork/title/artist on the Win11
// volume-key overlay AND routes the hardware media keys back to the page.
//
// Whether WebView2 honours that is the open question this module exists to answer:
// the SMTC hook-up lives behind the `HardwareMediaKeyHandling` / `MediaSessionService`
// Chromium features, which WebView2 does not enable by default. We ask for them via
// `additionalBrowserArgs` in tauri.conf.json. If the runtime declines, everything
// here degrades to a no-op — the metadata is simply never surfaced — and the
// fallback is a native SMTC session on the Rust side.
//
// This module is a pure consumer of the player's existing broadcasts: it never
// reaches into MusicKit, only `onPlayerState` / `onPlayerProgress` and the exported
// transport functions. Radio mirrors the transport caps — a live station gets no
// skip and no scrub, exactly as the in-app controls behave.

import {
  onPlayerState,
  onPlayerProgress,
  playPause,
  nextTrack,
  prevTrack,
  seekToSeconds,
  type PlayerState,
  type PlayerProgress,
} from "./player";

/** Artwork sizes the flyout picks from (Windows uses the largest it can). */
const ART_SIZES = [96, 256, 512];

/** Seconds a seekforward/seekbackward step moves when the OS sends no offset. */
const SEEK_STEP = 10;

let last: PlayerState = { playing: false };
let live = false; // an Apple *live* station owns the queue → no skip, no scrub

/** Re-derive one artwork template into the sizes the session wants. */
function artworkFor(url: string | undefined): MediaImage[] {
  if (!url) return [];
  // Player hands us a concrete 240px URL built from Apple's {w}x{h} template;
  // swap the baked dimensions back out so the flyout can ask for a bigger one.
  const DIMS = /\/\d+x\d+([a-z-]*\.)/;
  if (!DIMS.test(url)) return [{ src: url }]; // not an Apple-shaped URL — offer it as-is
  return ART_SIZES.map((px) => ({
    src: url.replace(DIMS, `/${px}x${px}$1`),
    sizes: `${px}x${px}`,
    type: "image/jpeg",
  }));
}

function pushMetadata(s: PlayerState): void {
  const ms = navigator.mediaSession;
  if (!ms) return;
  if (!s.title) {
    ms.metadata = null;
    return;
  }
  ms.metadata = new MediaMetadata({
    title: s.title,
    artist: s.artist ?? "",
    // A live station reads better as the "album" line than a blank one.
    album: s.station?.name ?? s.album ?? "",
    artwork: artworkFor(s.artworkUrl),
  });
}

// ── Position state ───────────────────────────────────────────────────────────
//
// Chromium interpolates position from the last report, so pushing on every
// progress tick is waste. We report only when reality has drifted from what the
// flyout would be extrapolating (a seek, a track change, a stall) — which keeps
// the scrubber honest at roughly one call per seek instead of ~4/second.

let reported = { position: 0, at: 0, duration: 0 };
const DRIFT_TOLERANCE = 1; // seconds

function pushPosition(p: PlayerProgress): void {
  const ms = navigator.mediaSession;
  if (!ms || typeof ms.setPositionState !== "function") return;

  // Live radio has no meaningful duration — clear the scrubber rather than lie.
  if (live || !Number.isFinite(p.duration) || p.duration <= 0) {
    try {
      ms.setPositionState();
    } catch {
      /* not supported — the flyout just goes without a scrubber */
    }
    reported = { position: 0, at: 0, duration: 0 };
    return;
  }

  const now = Date.now();
  const drift = last.playing ? (now - reported.at) / 1000 : 0;
  const expected = reported.position + drift;
  if (p.duration === reported.duration && Math.abs(p.currentTime - expected) < DRIFT_TOLERANCE) return;

  try {
    ms.setPositionState({
      duration: p.duration,
      position: Math.max(0, Math.min(p.duration, p.currentTime)),
      playbackRate: 1,
    });
    reported = { position: p.currentTime, at: now, duration: p.duration };
  } catch {
    /* out-of-range or unsupported — skip this report, the next tick retries */
  }
}

/** Install a handler, tolerating runtimes that reject the action outright. */
function setHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    /* action unsupported by this runtime — nothing to install */
  }
}

/** Skip/scrub availability follows the in-app transport caps (live station = neither). */
function applyCaps(): void {
  setHandler("nexttrack", live ? null : () => void nextTrack());
  setHandler("previoustrack", live ? null : () => void prevTrack());
  setHandler("seekto", live ? null : (d) => {
    if (typeof d.seekTime === "number") void seekToSeconds(d.seekTime);
  });
  setHandler("seekforward", live ? null : (d) => {
    void seekToSeconds(reported.position + (d.seekOffset ?? SEEK_STEP));
  });
  setHandler("seekbackward", live ? null : (d) => {
    void seekToSeconds(reported.position - (d.seekOffset ?? SEEK_STEP));
  });
}

/**
 * Wire the OS media session to the player. Safe to call unconditionally — on a
 * runtime without the API it returns having done nothing.
 */
export function initMediaSession(): void {
  if (!("mediaSession" in navigator)) {
    console.info("[media-session] unavailable in this runtime — media keys will not work");
    return;
  }

  // play/pause are always offered; both route to the same toggle, since MusicKit
  // owns which way the transport is currently pointing.
  setHandler("play", () => void playPause());
  setHandler("pause", () => void playPause());
  setHandler("stop", () => void playPause());
  applyCaps();

  onPlayerState((s) => {
    const wasLive = live;
    live = !!s.station?.live;
    const trackChanged = s.title !== last.title || s.artist !== last.artist;
    last = s;

    navigator.mediaSession.playbackState = s.playing ? "playing" : "paused";
    if (trackChanged || s.artworkUrl !== undefined) pushMetadata(s);
    if (live !== wasLive) applyCaps();
    // A play/pause flip stops or restarts the flyout's own interpolation clock;
    // force the next tick to re-report rather than extrapolate across the gap.
    reported.at = 0;
    reported.duration = 0;
  });

  onPlayerProgress(pushPosition);
}
