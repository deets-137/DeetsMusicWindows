// Playback engine (frontend). Drives MusicKit JS inside the webview.
//
// MusicKit JS is the only DRM-sanctioned full-song path on Windows. It must run in
// the renderer and hold the Music User Token itself, so this module pulls both the
// signed developer token and the captured MUT from Rust and configures MusicKit.
//
// One step here is empirically uncertain on first run: injecting a *known* MUT
// without calling `authorize()` (whose OAuth popup can't open in WebView2 — the
// reason auth runs through the loopback browser flow). See `injectUserToken`.

import { setting, setSetting, onSettingsChange } from "./settings-store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { isConnected } from "./apple";
import * as health from "./apple-health";
import { libraryTracks, type Track } from "./library";
import * as queue from "./queue";
import type { TrackHandle } from "./queue";
import { trackById, tracks, addTransientTracks, inLibrary } from "./track-store";
import { stageArtPx } from "./queue-rows";
import { materializeTrack } from "./search";
import { recordStationPlay, type Station } from "./radio";
import * as diag from "./diag";
import { outputKind } from "./sound";
import { nearSongEnd, isSongEnd, stallCanHappen } from "./pause-rules";
import { roomDriftTick } from "./room";
import * as stats from "./stats";
import * as perf from "./perf";
import { toast } from "./toast";
import { unreleasedToast } from "./release";
import { expectedIds, suffixPlan } from "./queue-sync";

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
type PlayerMode = "queue" | "radio" | "room";
let mode: PlayerMode = "queue";
let radioStation: Station | null = null;
// A manual insert during radio waits for the CURRENT song to end (your call,
// 2026-07-03), then the block takes over as a finite queue (see onNowPlayingChange).
let pendingBreakout = false;
// The station a break-out interrupted. It re-enters when the finite queue runs dry
// (radio UX pass, 2026-09-10 — FUTURE-SETTINGS §17 option (b) is now the default).
// Cleared by any explicit departure: a new context, another station, Stop Station,
// or the Qcard's "Don't resume".
let resumeStation: Station | null = null;

function exitRadio(): void {
  if (mode === "radio") mode = "queue"; // room mode stays: its loads come through here too
  radioStation = null;
  pendingBreakout = false;
}

/**
 * A station's "Add to Queue" (Radio / Search right-click, 2026-09-15): a station is a
 * stream, so it cannot sit among the songs — it plays once the finite queue runs dry,
 * the same return path a break-out uses (maybeResumeStation). With nothing to wait for
 * (idle, or already on a station) it simply starts now.
 */
export function queueStationAfter(s: Station): Promise<void> {
  if (roomBridge && !roomBridge.station()) return Promise.resolve();
  if (mode === "radio" || (!queue.getCurrent() && !queue.getUpcoming().length)) return playStation(s);
  diag.log("player:queueStation", { id: s.id });
  resumeStation = s;
  emit(); // the Qcard's station row: "Will resume after"
  return Promise.resolve();
}

/** Drop the queued station return (the Qcard's "Don't resume"). */
export function dropResumeStation(): void {
  if (!resumeStation) return;
  diag.log("player:dropResume", { id: resumeStation.id });
  resumeStation = null;
  emit();
}

/** A 72px station cover URL for the Qcard's station row (null when the station has none). */
function stationArt(s: Station): string | undefined {
  const t = s.artwork?.urlTemplate;
  return t ? t.replace("{w}", "72").replace("{h}", "72").replace("{f}", "jpg") : undefined;
}

function stationInfo(s: Station): NonNullable<PlayerState["station"]> {
  return { id: s.id, name: s.name, live: s.isLive, artworkUrl: stationArt(s) };
}

// ── MusicKit's script failed to load (2026-09-25) ────────────────────────────
// A launch with no network (autostart before Wi-Fi, a PC wake) fails index.html's
// <script>, whose onerror sets `__musicKitFailed`. `musickitloaded` then never fires,
// initPlayer waits forever, and every click did nothing. Load it again when Windows
// reports the network back, every MUSICKIT_RETRY_MS, and on a play click; the click
// itself shows the offline toast (his call: tell, do not replay the click).
const MUSICKIT_SRC = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
const MUSICKIT_RETRY_MS = 30_000;
const NO_MUSICKIT = "MusicKit did not load";
let musicKitRetries = 0;

const musicKitMissing = (): boolean => !window.MusicKit && !!(window as any).__musicKitFailed;

function reloadMusicKit(why: string): void {
  if (!musicKitMissing()) return; // loaded, or the last try is still in flight
  (window as any).__musicKitFailed = false;
  diag.warn("player:musicKitRetry", { why, n: ++musicKitRetries });
  const s = document.createElement("script");
  s.src = MUSICKIT_SRC;
  s.async = true;
  s.onerror = () => ((window as any).__musicKitFailed = true);
  document.head.append(s);
}

const musicKitTimer = window.setInterval(() => {
  if (window.MusicKit) return window.clearInterval(musicKitTimer);
  reloadMusicKit("timer");
}, MUSICKIT_RETRY_MS);
window.addEventListener("online", () => reloadMusicKit("online"));

/** Resolve once the async MusicKit CDN script has registered `window.MusicKit`. */
async function whenMusicKitLoaded(): Promise<void> {
  if (window.MusicKit) return;
  await new Promise<void>((resolve) =>
    document.addEventListener("musickitloaded", () => resolve(), { once: true }),
  );
}

/**
 * After Rust swaps the developer token (a 401 heal, RELEASE.md §7) MusicKit still holds
 * the old one from `configure()`. Re-configure — once per new token, however many
 * callers ask (the `developer-token-changed` event AND a playback recovery both do);
 * before the first configure there is nothing to do: `initPlayer` reads the new token.
 */
let configuredToken = "";
let reconfiguring: Promise<void> | null = null;
function syncDeveloperToken(): Promise<void> {
  if (!initPromise) return Promise.resolve();
  reconfiguring ??= (async () => {
    try {
      await initPromise;
      const developerToken = await invoke<string>("apple_developer_token");
      if (developerToken === configuredToken) return;
      await window.MusicKit.configure({ developerToken, app: { name: "DeetsMusic", build: await getVersion() }, suppressErrorDialog: true });
      configuredToken = developerToken;
      music = window.MusicKit.getInstance();
      await injectUserToken();
      applyStreamQuality("reconfigure");
      diag.log("player:reconfigured", { authorized: !!music.isAuthorized });
    } catch (e) {
      diag.error("player:reconfigureFailed", { err: String(e) });
    } finally {
      reconfiguring = null;
    }
  })();
  return reconfiguring;
}
void listen("developer-token-changed", () => void syncDeveloperToken());

/** A new sign-in was captured (Rust emits `user-token-changed`): give MusicKit the new token
 *  now. Before 2026-09-13 only `initPlayer` injected it, so a sign-in after MusicKit had
 *  dropped its token left the player unauthorized until a restart. */
void listen("user-token-changed", () => void applyNewUserToken());
async function applyNewUserToken(): Promise<void> {
  if (!initPromise) return; // not started yet: initPlayer injects the token itself
  await initPromise;
  reauthAt = []; // a fresh sign-in resets the restore limit
  await injectUserToken();
  diag.log("player:userTokenApplied", { authorized: !!music?.isAuthorized });
}

/** A play with no Apple sign-in: say so (one toast, a Sign in button) instead of letting
 *  MusicKit fail with "Unable to prepare for playback." */
const SIGNED_OUT = "signed out of Apple Music";
async function requireSignIn(): Promise<void> {
  if (musicKitMissing()) {
    reloadMusicKit("click");
    health.show("offline", true, "play");
    throw new Error(NO_MUSICKIT);
  }
  if (await isConnected()) {
    // Signed in, but MusicKit may have dropped its copy of the token. That raises no play
    // error we can see (MusicKit shows only its own dialog), so restore BEFORE the load.
    if (music && !music.isAuthorized) await restoreAuthorization("play", true);
    return;
  }
  health.show("signedOut", true, "play");
  throw new Error(SIGNED_OUT);
}

/** Configure MusicKit once (lazy — only when the user first hits play). */
export function initPlayer(): Promise<any> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    void loadDeadIds(); // a click before the idle warm-up still gets the saved denylist
    await whenMusicKitLoaded();
    const developerToken = await invoke<string>("apple_developer_token");
    await window.MusicKit.configure({
      developerToken,
      app: { name: "DeetsMusic", build: await getVersion() },
      // MusicKit's own error box (#musickit-dialog, e.g. "loadSegmentError" on a network
      // drop) never shows: every playback error already reaches onPlaybackError and one of
      // our toasts (TOASTS.md §Apple health). A configure option, not a MusicKit change.
      suppressErrorDialog: true,
    });
    configuredToken = developerToken;
    music = window.MusicKit.getInstance();
    perf.bind(() => music?.nowPlayingItem?.id);
    await injectUserToken();
    installMusicKitRejectionFilter();
    wireEvents();
    applyVolumeToMusic(); // push the persisted level onto the fresh instance
    applyStreamQuality("configure"); // configure made a new bitrate pick (AUDIO-QUALITY.md §4.1)
    (window as any).__music = music; // introspect the opaque instance (dev + bug reports)
    (window as any).__player = { snap, queue: queueDump };
    diag.log("player:configured", { authorized: !!music.isAuthorized });
    console.log("[player] configured — authorized:", music.isAuthorized);
    return music;
  })();
  return initPromise;
}

// Probed and rejected 2026-09-12 (UX-COVERUPS.md §4): pre-feeding the restored song to
// MusicKit at idle. `setQueue` alone fetches nothing — no lookup, license or bytes — and
// this MusicKit build has no `prepareToPlay`. The only preload is a muted play-then-pause,
// which reports a play to Apple and flickers the transport; not built without a decision.

/**
 * Warm the playback engine off the click path (main.ts calls this at idle after launch;
 * perf.ts, 2026-09-12). Two costs used to sit on the session's first click: MusicKit's
 * configure + token injection (~1 s) and the spawn of the browser's DRM module
 * (~0.6–1.3 s inside the first stream). Neither needs a play to happen. No Apple calls
 * beyond what the first play would have made anyway.
 */
export function warmPlayer(): void {
  observeEme();
  void loadDeadIds();
  initPlayer().catch((e) => console.warn("[player] warm-up:", e));
  void warmDrm();
}

// Keep the MediaKeys alive: the CDM process lives as long as something holds it.
let warmKeys: MediaKeys | null = null;
async function warmDrm(): Promise<void> {
  if (warmKeys || typeof navigator.requestMediaKeySystemAccess !== "function") return;
  const config: MediaKeySystemConfiguration[] = [
    // SW_SECURE_CRYPTO is Widevine's lowest (software) tier — what an unset level already
    // meant; naming it silences Chromium's "robustness level be specified" warning for this call.
    // MusicKit's own request still omits it — that warning is MusicKit's and stays.
    {
      initDataTypes: ["cenc"],
      audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"', robustness: "SW_SECURE_CRYPTO" }],
    },
  ];
  try {
    const access = await navigator.requestMediaKeySystemAccess("com.widevine.alpha", config);
    warmKeys = await access.createMediaKeys();
    diag.log("player:drmWarm", { keySystem: access.keySystem });
    perf.note("drm", "warm");
  } catch (e) {
    diag.log("player:drmWarmFailed", { e: String(e) });
    perf.note("drm", `failed: ${String(e)}`);
  }
}

// Dev-only: record which key system MusicKit actually asks for, so warmDrm targets the
// right one (Widevine is the assumption; WebView2 also offers PlayReady).
let emeObserved = false;
function observeEme(): void {
  if (!import.meta.env.DEV || emeObserved || typeof navigator.requestMediaKeySystemAccess !== "function") return;
  emeObserved = true;
  const original = navigator.requestMediaKeySystemAccess.bind(navigator);
  navigator.requestMediaKeySystemAccess = (keySystem, configs) => {
    diag.log("player:eme", { keySystem });
    perf.note("eme", keySystem);
    return original(keySystem, configs);
  };
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

// ── Keep MusicKit authorized (root cause found 2026-09-13) ───────────────────────
// MusicKit throws away ITS copy of the user token after one authorization failure while
// preparing a song (musickit.js `prepareForEncryptedPlayback` → `storekit.revokeUserToken`)
// and then fails every later play with "Unable to prepare for playback." until a restart
// re-injects the token. Seen on the installed 0.3.1 during Apple's post-rotation 401s, while
// the saved token still got 200 from /v1/me/storefront. Rust still holds the token, so give
// it back. Bounded, because a token Apple really rejects would be revoked again at once:
// at most once per REAUTH_GAP_MS and REAUTH_MAX per REAUTH_WINDOW_MS; past that, the health
// check names the cause ("Apple Music signed you out").
const REAUTH_GAP_MS = 30_000;
const REAUTH_USER_GAP_MS = 3_000; // a play click may retry sooner; still bounded by clicks
const REAUTH_MAX = 3;
const REAUTH_WINDOW_MS = 10 * 60_000;
let reauthAt: number[] = [];

async function restoreAuthorization(via: string, userAction = false): Promise<boolean> {
  if (!music) return false;
  if (music.isAuthorized) return true;
  if (!(await isConnected())) return false; // signed out in the app: nothing to restore
  // MusicKit's revoke may have logged the token out AT APPLE (its _webPlayerLogout does,
  // when it succeeds). Giving a dead token back only fails the next play, so ask first:
  // the check is cached (60 s) and shows the "signed you out" toast when that is the cause.
  const { trouble } = await health.check(false, false, via);
  if (trouble !== "none") {
    diag.warn("player:reauthSkipped", { via, trouble });
    return false;
  }
  const now = performance.now();
  reauthAt = reauthAt.filter((t) => now - t < REAUTH_WINDOW_MS);
  const last = reauthAt[reauthAt.length - 1] ?? -Infinity;
  if ((!userAction && reauthAt.length >= REAUTH_MAX) || now - last < (userAction ? REAUTH_USER_GAP_MS : REAUTH_GAP_MS)) {
    diag.warn("player:reauthLimited", { via, recent: reauthAt.length });
    return false;
  }
  reauthAt.push(now);
  await injectUserToken();
  const ok = !!music.isAuthorized;
  diag.warn("player:reauth", { via, ok });
  return ok;
}

function onAuthorizationChange(): void {
  const authorized = !!music?.isAuthorized;
  (authorized ? diag.log : diag.warn)("player:authorization", { authorized, status: music?.authorizationStatus });
  if (authorized) return;
  void (async () => {
    // A sign-out in the app (clearMusicKitSignIn) also lands here: nothing to do, and no
    // toast — the next play asks the user to sign in.
    if (!(await isConnected())) return;
    if (!(await restoreAuthorization("revoked"))) return; // the check inside said why
    // The revoke happens inside a load: when one just ended, finish what the user asked for.
    const now = performance.now();
    if (music && mode === "queue" && queue.getCurrent() && !music.isPlaying && now - lastLoadEndAt < 3000 && now - lastRetryAt > RETRY_GAP_MS) {
      lastRetryAt = now;
      try {
        await loadFromModel(music);
      } catch (e) {
        diag.warn("player:reauthRetryFailed", { err: String(e) });
      }
    }
  })();
}

/** Account › sign out: drop MusicKit's in-memory copy of the user token too, so MusicKit is
 *  no longer authorized after a sign-out (found 2026-09-13). Assigning `musicUserToken`
 *  only sets the token; it does NOT call MusicKit's `unauthorize()`, whose web-player logout
 *  would also log the token out at Apple. */
export function clearMusicKitSignIn(): void {
  if (!music) return;
  try {
    music.musicUserToken = "";
    diag.log("player:signInCleared", { authorized: !!music.isAuthorized });
  } catch (e) {
    diag.warn("player:signInClearFailed", { err: String(e) });
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

const LOAD_SERVER_ERROR = /^SERVER_ERROR: An unknown error has occurred/i;
const LOAD_ERROR_GRACE_MS = 3000;
let lastLoadEndAt = -Infinity; // stamped by doLoadFromModel's finally (a load in flight counts too)

let rejectionFilterInstalled = false;
function installMusicKitRejectionFilter(): void {
  if (rejectionFilterInstalled) return;
  rejectionFilterInstalled = true;
  window.addEventListener("unhandledrejection", (e) => {
    // MusicKit's MKError carries `message` without always being an Error instance —
    // read the field directly (an instanceof check let a benign race through, 2026-09-12).
    const reason: any = e.reason;
    const msg = String(reason?.message ?? reason ?? "");
    if (BENIGN_PLAYBACK.test(msg)) {
      diag.log("player:mkRaceSwallowed", { via: "rejection", msg });
      e.preventDefault(); // benign MusicKit transport race — keep it out of the console
    } else if (LOAD_SERVER_ERROR.test(msg) && performance.now() - lastLoadEndAt < LOAD_ERROR_GRACE_MS) {
      // The abandoned first setQueue of a dead-id retry rejects late with a generic
      // SERVER_ERROR (observed 2026-09-12: "7 unresolvable ids dropped; retrying" →
      // the retry played fine → this surfaced anyway). Only swallowed around a load;
      // the same message at any other time propagates.
      diag.log("player:mkRaceSwallowed", { via: "rejection", msg, during: "load" });
      e.preventDefault();
    }
  });
}

// ── State broadcast (UI subscribes; we read straight off the live instance) ──────

export interface PlayerState {
  playing: boolean;
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  /** True while a (re)window is buffering — a jump/seek out of the gapless window.
   *  The UX cover-up hook (see docs/architecture/UX-COVERUPS.md); natural play never sets it. */
  loading?: boolean;
  /** Set while an Apple station owns the queue (radio mode). `live` drives the
   *  transport caps: no seek, no skip, LIVE indicator (STATIONS.md §1). */
  station?: { id: string; name: string; live: boolean; artworkUrl?: string };
  /** The station that resumes once the finite queue runs dry (after a break-out).
   *  The Qcard shows it as the last Up Next row. */
  resume?: { id: string; name: string; live: boolean; artworkUrl?: string };
  /** The two modes (NEXT-VERSION §12, §14) — the Now Playing squares draw from these. */
  repeat: RepeatMode;
  shuffle: boolean;
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

const intentSubs = new Set<() => void>();
/** Fires when a gesture asks for a song to start (a play, a jump, a station, next, previous),
 *  at the ask, before the song loads. The Ocean ripple rides it (ocean.ts). */
export function onPlayIntent(cb: () => void): () => void {
  intentSubs.add(cb);
  return () => intentSubs.delete(cb);
}
const playIntent = () => intentSubs.forEach((cb) => cb());

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

let lastProgressTick = 0;
function emitProgress(): void {
  const duration = music?.currentPlaybackDuration ?? 0;
  const currentTime = music?.currentPlaybackTime ?? 0;
  const progress = duration > 0 ? currentTime / duration : 0;
  // Audio really played since the sign-in, so a later playback error is not the
  // subscription (TOASTS.md). Not at the song-start: MusicKit sets now-playing first.
  if (freshSignIn && currentTime > 0.5) freshSignIn = false;
  if (currentTime > 0) lastHeardAt = currentTime; // MusicKit's clock resets when its player dies
  // While a (re)window loads, the outgoing song still ticks through the teardown. The
  // scrubber already shows the incoming song at 0 (emitLoadingProgress, UX-COVERUPS.md §1);
  // an old-song tick here would drag it back under the new title.
  if (!isLoading) progressListeners.forEach((cb) => cb({ progress, currentTime, duration }));
  if (mode === "room") roomDriftTick(); // the room's clock against ours (ROOMS.md §9.3)
  // Repeat one (NEXT-VERSION §12c): MusicKit loops the song with no item change, so the
  // play-event log would never see the second listen. A clock that jumps from the last
  // second and a half back to the start IS that loop — count it as a fresh listen (the
  // re-click path's rule). A scrub back to 0 from mid-song does not match.
  const prevTick = lastProgressTick;
  lastProgressTick = currentTime;
  if (getRepeat() === "one" && !loadingContext && duration > 0 && prevTick >= duration - 1.5 && currentTime < 1) {
    const c = queue.getCurrent();
    const id = music?.nowPlayingItem?.id;
    if (c && id && (id === c.catalogId || id === c.libraryId)) {
      diag.log("player:repeatLoop", { id });
      stats.recordRestart(c);
    }
  }
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

/** Re-broadcast the player state (queue-persist.ts: Now Playing reads the model's
 *  current when MusicKit holds no item, so a restore must trigger a paint). */
export function refreshPlayerState(): void {
  emit();
  emitRestoredProgress();
}

/** Now Playing's scrubber while MusicKit holds no song (a restore): the song's length, and
 *  the saved position when an update restart left one (resumeAt). MusicKit's own ticks
 *  take over from the first Play. */
function emitRestoredProgress(): void {
  if (music?.nowPlayingItem) return;
  emitModelProgress();
}

/** The model's current song as one progress report: its length from the store, and the
 *  saved position when an update restart left one for this very song (resumeAt), else 0.
 *  Nothing is sent when the length is unknown — a station, or a catalog song the store
 *  has not seen — because a zero-length report is not just cosmetic: the sleep timer reads
 *  "0 s left" from it and would take the next song change for the song's own end. */
function emitModelProgress(): void {
  const cur = mode === "radio" ? null : queue.getCurrent();
  const id = cur?.catalogId ?? cur?.libraryId;
  const durationMs = (trackById(cur?.catalogId) ?? trackById(cur?.libraryId))?.durationMs;
  if (!id || !durationMs) return;
  const duration = durationMs / 1000;
  const currentTime = resumeAt?.id === id ? Math.min(resumeAt.sec, duration) : 0;
  progressListeners.forEach((cb) => cb({ progress: currentTime / duration, currentTime, duration }));
}

/** The scrubber the moment a (re)window starts loading (UX-COVERUPS.md §1, 1A): the
 *  incoming song at 0:00 (or its resume position) with its own length, under the title the
 *  card already shows from the model. Without this the old song's clock ran on under the
 *  new title for up to 1.6 s. MusicKit's own ticks take over when the new song reports. */
const emitLoadingProgress = emitModelProgress;

/** Where the song is, in seconds (queue-persist's update restart). */
export function playbackPosition(): number {
  return music?.currentPlaybackTime || 0;
}

// The update restart's saved position (queue-persist.ts): applied once, by the first Play of
// the restored song (playPause), and only while that song is still the model's current.
let resumeAt: { sec: number; id: string } | null = null;
export function setResumeAt(sec: number, id: string): void {
  resumeAt = { sec, id };
}

function emit(): void {
  const item = music?.nowPlayingItem;
  const s: PlayerState = {
    playing: !!music?.isPlaying,
    title: item?.title ?? item?.attributes?.name,
    artist: item?.artistName ?? item?.attributes?.artistName,
    album: item?.albumName ?? item?.attributes?.albumName,
    artworkUrl: artworkUrlOf(item, stageArtPx()),
    loading: isLoading,
    station: mode === "radio" && radioStation ? stationInfo(radioStation) : undefined,
    resume: resumeStation ? stationInfo(resumeStation) : undefined,
    repeat: getRepeat(),
    shuffle: isShuffleOn(),
  };
  listeners.forEach((cb) => cb(s));
}

// ── Repeat + shuffle modes (NEXT-VERSION §12, §14; user's calls 2026-09-15) ─────────────
// Both live in the settings store (persisted, no Settings row for the state itself), so the
// agent `settings` tool and Settings › Reset reach them; the listener below re-applies.
export type RepeatMode = "off" | "all" | "one";
export const getRepeat = (): RepeatMode => setting("repeatMode");
/** Shuffle mode is on: the button is a mode (`shuffleStays`) AND it is switched on. */
export const isShuffleOn = (): boolean => setting("shuffleStays") && setting("shuffleMode");

/**
 * Repeat ONE is MusicKit's own (`repeatMode`): the fed window collapses repeated ids, so
 * the model cannot feed the same song twice. Repeat ALL is the model's (a lap refilled at
 * the queue's end, maybeFinishQueue), so MusicKit never sees "all". A station owns its
 * queue: no repeat while in radio mode.
 */
function applyRepeatToMusicKit(): void {
  const MK = window.MusicKit;
  if (!music || !MK) return;
  const modes = MK.PlayerRepeatMode ?? { none: 0, one: 1 };
  const want = mode === "queue" && getRepeat() === "one" ? modes.one : modes.none;
  try {
    if (music.repeatMode !== want) music.repeatMode = want;
  } catch (e) {
    diag.warn("player:repeatApply", { e: String(e) });
  }
}
export function setRepeat(m: RepeatMode): void {
  if (roomBridge) return; // repeat is off in a room (§10)
  diag.log("player:repeat", { mode: m });
  setSetting("repeatMode", m); // the settings listener applies + emits
  applyRepeatToMusicKit(); // unchanged value: no notification — still make sure
}
/** The Now Playing square: off → all → one → off. */
export function cycleRepeat(): RepeatMode {
  const next: Record<RepeatMode, RepeatMode> = { off: "all", all: "one", one: "off" };
  const m = next[getRepeat()];
  setRepeat(m);
  return m;
}
/** Turn the shuffle mode on or off (the toolbar Shuffle, the agent). No-op while the button
 *  is one-shot (`shuffleStays` off) — there is no mode to set then. */
export function setShuffleMode(on: boolean): void {
  if (!setting("shuffleStays")) return;
  diag.log("player:shuffleMode", { on });
  setSetting("shuffleMode", on);
}
onSettingsChange((k) => {
  if (k === "repeatMode") applyRepeatToMusicKit();
  if (k === "repeatMode" || k === "shuffleMode" || k === "shuffleStays") emit();
});

/**
 * Station return: once the break-out block has played out (model upcoming empty and
 * MusicKit reports the queue finished), re-enter the interrupted station. Runs on
 * every playback-state change; cheap no-op otherwise.
 */
function maybeResumeStation(): void {
  if (!music || mode !== "queue" || !resumeStation || loadingContext || isLoading) return;
  const S = window.MusicKit?.PlaybackStates;
  const st = music.playbackState;
  const finished = !!S && (st === S.completed || st === S.ended);
  if (!finished || queue.getUpcoming().length) return;
  const s = resumeStation;
  resumeStation = null;
  diag.log("player:resumeStation", { id: s.id });
  playStation(s).catch((e) => console.warn("[player] resume station:", e));
}

/**
 * Queue end: when MusicKit finishes the last song, it reports no now-playing index, so
 * model-follow (syncModelToMusicKit) bails and the finished song stayed `current` — the
 * Qcard kept showing it under "Not playing". Move it to the heard trail instead. Only when
 * the model has nothing upcoming: a window that ran out early is a top-up problem, not an end.
 */
function maybeFinishQueue(): void {
  if (!music || mode !== "queue" || loadingContext || isLoading) return;
  const S = window.MusicKit?.PlaybackStates;
  const st = music.playbackState;
  const finished = !!S && (st === S.completed || st === S.ended);
  if (!finished || music.nowPlayingItem || queue.getUpcoming().length || !queue.getCurrent()) return;
  // Repeat (NEXT-VERSION §12d): ALL refills Up Next with the whole list and plays on — one
  // buffering gap per lap (no pre-wrap: a list shorter than the window would dedup away).
  // ONE normally never gets here (MusicKit loops the song itself); if a build ignores
  // `repeatMode`, replay the current song from the model instead.
  const r = getRepeat();
  if (r === "all" && queue.refillFromPlan(isShuffleOn())) {
    diag.log("player:repeatLap", snap());
    queue.advance();
    loadFromModel(music).catch((e) => console.warn("[player] repeat lap:", e));
    return;
  }
  if (r === "one") {
    diag.log("player:repeatOne", snap());
    loadFromModel(music).catch((e) => console.warn("[player] repeat one:", e));
    return;
  }
  diag.log("player:queueEnd", snap());
  songChangeSeen();
  queue.advance();
}

// ── Pause source ─────────────────────────────────────────────────────────────
// Every pause we cause names itself first (notePause); when MusicKit then leaves
// `playing` for paused/stopped, one `player:pause` line says who did it. A pause
// with no fresh note came from outside our code: MusicKit itself, or WebView2's own
// media-key handling. DEBUGGING.md §Why did it pause.
const PAUSE_NOTE_MS = 5000;
let pauseNote: { why: string; at: number } | null = null;
let wasPlaying = false;

function notePause(why: string): void {
  pauseNote = { why, at: performance.now() };
}

// ── A song change is not a pause (DEBUGGING.md §Why did it pause, fixes 1 and 3; 2026-09-25) ──
// MusicKit reports `paused` at the end of every station song and at a queue's end, and a user's
// Next passes through it too: 86 of 93 `outside` lines were song changes. So a pause with no
// note waits SONG_END_WAIT_MS: a `stationFollow`, a `queueEnd` or a new song in that time, or
// a pause within SONG_END_TAIL_S of the end, makes it `songEnd`. A song end that plays nothing
// for STALL_AFTER_MS, while there is a next song, writes `player:stall` (the 17.5 s AirPlay gap
// of 2026-09-23), and `player:stall-end` when music plays again.
const SONG_END_WAIT_MS = 1000;
const STALL_AFTER_MS = 3000;
let pendingPause: { fields: Record<string, unknown>; id: string | null; nearEnd: boolean; evidence: boolean; at: number } | null = null;
let stallTimer = 0;
let stall: { after: string | null; since: number } | null = null;

/** stationFollow / queueEnd: a song change the pending pause belongs to. */
function songChangeSeen(): void {
  if (pendingPause) pendingPause.evidence = true;
}

function settlePause(): void {
  const p = pendingPause;
  pendingPause = null;
  if (!p) return;
  const songEnd = isSongEnd({ evidence: p.evidence, idBefore: p.id, idNow: music?.nowPlayingItem?.id ?? null, nearEnd: p.nearEnd });
  diag.log("player:pause", { why: songEnd ? "songEnd" : "outside", ...p.fields });
  if (!songEnd || music?.isPlaying) return;
  if (!stallCanHappen(mode, queue.getUpcoming().length)) return;
  window.clearTimeout(stallTimer);
  stallTimer = window.setTimeout(() => {
    if (music?.isPlaying) return;
    stall = { after: p.id, since: p.at };
    diag.warn("player:stall", { after: p.id, s: Math.round((performance.now() - p.at) / 1000), mode, output: outputKind() });
  }, Math.max(0, STALL_AFTER_MS - (performance.now() - p.at)));
}

function logPauseSource(): void {
  const S = window.MusicKit?.PlaybackStates;
  if (!S || !music) return;
  const st = music.playbackState;
  const playing = st === S.playing;
  if (wasPlaying && (st === S.paused || st === S.stopped)) {
    const fresh = pauseNote && performance.now() - pauseNote.at < PAUSE_NOTE_MS;
    const at = music.currentPlaybackTime ?? 0;
    const fields = { state: S[st], id: music.nowPlayingItem?.id ?? null, at: Math.round(at), mode };
    if (fresh) {
      diag.log("player:pause", { why: pauseNote!.why, ...fields });
    } else {
      const nearEnd = nearSongEnd(at, music.currentPlaybackDuration ?? 0);
      pendingPause = { fields, id: music.nowPlayingItem?.id ?? null, nearEnd, evidence: false, at: performance.now() };
      window.setTimeout(settlePause, SONG_END_WAIT_MS);
    }
    pauseNote = null;
  }
  if (playing) {
    window.clearTimeout(stallTimer);
    if (stall) {
      diag.log("player:stall-end", { s: Math.round((performance.now() - stall.since) / 1000), after: stall.after });
      stall = null;
    }
  }
  if (st !== S.waiting && st !== S.loading) wasPlaying = playing;
}

window.addEventListener("pagehide", () => {
  if (!music?.isPlaying) return;
  diag.log("player:exit", { id: music.nowPlayingItem?.id ?? null, at: Math.round(music.currentPlaybackTime ?? 0) });
  void diag.flush();
});

function onPlaybackStateChange(): void {
  logPauseSource();
  // Dev telemetry: the clicked song is audible once MusicKit reports `playing` for it.
  const S = window.MusicKit?.PlaybackStates;
  if (S && music?.playbackState === S.playing) perf.sound(music.nowPlayingItem?.id);
  // Dev telemetry: a state change with NO now-playing item outside a load is the shape of
  // a failed auto-advance (a dead id) — log what MusicKit reports so the heal can key on it.
  if (!loadingContext && music && !music.nowPlayingItem && S)
    perf.event("stateNoItem", { state: S[music.playbackState], up: queue.getUpcoming().length, cur: playId(queue.getCurrent() ?? {}) });
  onEndedWithoutItem();
  maybeFinishQueue();
  emit();
  maybeResumeStation();
}

let wired = false;
function wireEvents(): void {
  if (wired || !music) return;
  wired = true;
  const E = window.MusicKit.Events;
  music.addEventListener(E.playbackStateDidChange, onPlaybackStateChange);
  music.addEventListener(E.nowPlayingItemDidChange, onNowPlayingChange);
  music.addEventListener(E.playbackTimeDidChange, emitProgress);
  if (E.mediaPlaybackError) music.addEventListener(E.mediaPlaybackError, onPlaybackError);
  if (E.authorizationStatusDidChange) music.addEventListener(E.authorizationStatusDidChange, onAuthorizationChange);
  perf.note("mkErrorEvent", E.mediaPlaybackError ?? null);
}

function onNowPlayingChange(): void {
  if (!loadingContext) {
    if (mode === "radio") {
      // Break-out boundary: a manual insert waited for the current song to end —
      // the block takes over as a finite queue now. The station's next song may
      // sound for a beat while the rebuild buffers (`loading` covers it).
      // The station is remembered and returns when that queue ends (maybeResumeStation).
      if (pendingBreakout && queue.getUpcoming().length) {
        diag.log("player:breakout", { n: queue.getUpcoming().length });
        const interrupted = radioStation;
        exitRadio();
        resumeStation = interrupted;
        queue.advance(); // finished station song → trail; block's first song → current
        // Defer the rebuild OUT of this nowPlayingItemDidChange handler (a macrotask lets
        // MusicKit settle its in-flight station advance first), and load with `stopFirst`:
        // fully stop the station controller, then start the block at index 0. This
        // is what stops MusicKit's next station song from continuing to play under a model
        // that has already moved to the block. Model-follow stays suppressed across the gap.
        loadingContext = true;
        const m = music;
        setTimeout(() => {
          loadFromModel(m, true, { stopFirst: true }).catch((e) => {
            loadingContext = false; // never leave follow wedged if the load bailed
            console.warn("[player] breakout load:", e);
          });
        }, 0);
      } else {
        pendingBreakout = false; // an emptied block (rows removed) — stay in radio
        stationFollow();
        diag.log("player:np", snap());
      }
    } else if (mode === "room") {
      // The room wrote the model already (room.ts); only count the play.
      stats.recordStart(queue.getCurrent());
      diag.log("player:npRoom", snap());
    } else {
      const short = syncModelToMusicKit();
      diag.log("player:np", snap());
      // The model is the master: MusicKit started a song the model did not expect → re-window
      // onto the model's song. That load records the start and grows the window itself.
      if (correctDrift(short)) {
        emit();
        return;
      }
      stats.recordStart(queue.getCurrent()); // a settled song-start counts as a partial play
      void ensureAligned("np");
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
  songChangeSeen();
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
// The in-flight top-up (reconcile is async): never stack a second one on it, and a fresh
// load awaits it (doLoadFromModel) so its playLater can't land in the replaced queue.
let topUp: Promise<void> | null = null;

function maybeTopUpWindow(cap = WINDOW_FWD): void {
  if (topUp || !music || mode !== "queue") return; // stations refill themselves; a room feeds one song
  const items: any[] = music.queue?.items ?? [];
  const np = typeof music.nowPlayingItemIndex === "number" ? music.nowPlayingItemIndex : -1;
  if (np < 0) return;
  const mkRemaining = items.length - np - 1;
  if (mkRemaining >= REWINDOW_LOW) return;
  // Model has nothing beyond what MusicKit already holds → natural end of the plan.
  // (Extras that dedup/dead-drop to nothing make reconcile a cheap early return.)
  if (queue.getUpcoming().length <= mkRemaining) return;
  diag.log("player:topUp", { mkRemaining, modelUp: queue.getUpcoming().length, mkLen: items.length });
  const t0 = performance.now();
  topUp = reconcileUpcoming(cap)
    .then(
      () => perf.event("grow", { ms: Math.round(performance.now() - t0), from: items.length, to: music?.queue?.items?.length }),
      (e) => console.warn("[player] window top-up failed:", e),
    )
    .finally(() => {
      topUp = null;
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

/** MusicKit's item id is the id we fed it: the catalog id, or the library-id fallback. */
const isEntry = (e: TrackHandle, id: string): boolean => id === e.catalogId || id === e.libraryId || id === playId(e);

// ── The model is the master (QUEUE.md §The model is the master, 2026-09-24) ────────
//
// What the Queue card shows is what plays. When MusicKit disagrees at a song change, the
// app corrects MusicKit — it does not follow it. Two layers:
//  1. After every queue edit (and every song change), `ensureAligned` compares MusicKit's
//     upcoming with the model's and repairs it at once through `reconcileUpcoming`
//     (gapless: `current` never moves). Drift is fixed before anyone hears it.
//  2. If drift still reaches a song change (MusicKit starts X, the model expected Y),
//     `correctDrift` re-windows onto Y (`loadFromModel`, the same ~1 s buffer as any jump).
// Found 2026-09-24: a dragged song that had already played once was left out of MusicKit's
// queue, and the old index-only follow then showed one song while another played.

let lastDriftFixAt = -Infinity;
/** Two corrections this close together means the fix itself is failing: stop and follow. */
const DRIFT_GAP_MS = 5000;

/**
 * The song change landed on a song the model did not expect. Re-window onto the model's
 * song and return true, or return false and follow MusicKit when there is nothing to
 * correct toward (the model ran out, its song cannot play, or a correction just failed).
 */
function correctDrift(short: number): boolean {
  const m = music;
  const cur = queue.getCurrent();
  const npId: string | undefined = m?.nowPlayingItem?.id;
  if (!m || !cur || !npId || isEntry(cur, npId)) return false;
  const want = playId(cur);
  const data = { npId, want: want ?? null, npIndex: m.nowPlayingItemIndex, windowPos, short };
  const now = performance.now();
  // `short`: MusicKit moved further than the model has songs; it holds songs the model does not.
  const fix = !want || short > 0 ? "followed" : now - lastDriftFixAt < DRIFT_GAP_MS ? "held" : "jumped";
  diag.warn("player:desync", { ...data, fix });
  perf.event("desync", { ...data, fix });
  if (fix !== "jumped") return false;
  lastDriftFixAt = now;
  loadFromModel(m).catch((e) => console.warn("[player] drift re-window:", e));
  return true;
}

// ── Upcoming alignment (model.upcoming ⟷ MusicKit's live window) ──────────────
//
// The invariant: MusicKit's upcoming is a PREFIX of the model's upcoming live ids (an entry
// with no play id is dead and never fed). Prefix, not equality: MusicKit holds a bounded
// window (grown to WINDOW_FWD), so the model legitimately has more. Before 2026-09-24 this
// was a subsequence test, which let a model-only song pass as aligned — the drag bug.

function alignmentReport() {
  const items: any[] = music?.queue?.items ?? [];
  const np = typeof music?.nowPlayingItemIndex === "number" ? music.nowPlayingItemIndex : -1;
  const mkUp: string[] = np >= 0 ? items.slice(np + 1).map((it) => it?.id).filter(Boolean) : [];
  const modelUp = queue.getUpcoming().filter((e) => !!playId(e));
  let firstMismatch: { mkPos: number; mkId: string; want: string | null } | null = null;
  for (let j = 0; j < mkUp.length; j++) {
    const e = modelUp[j];
    if (!e || !isEntry(e, mkUp[j])) {
      firstMismatch = { mkPos: j, mkId: mkUp[j], want: e ? playId(e) ?? null : null };
      break;
    }
  }
  return { aligned: !firstMismatch, firstMismatch, mkUpLen: mkUp.length, modelUpLen: modelUp.length };
}

/** Log `player:misalign` when the upcoming lists diverge. True = aligned. */
function checkAlignment(where: string): boolean {
  if (loadingContext) return true; // mid-(re)build — expected to differ
  const r = alignmentReport();
  if (!r.aligned) {
    diag.log("player:misalign", { where, ...r.firstMismatch, mkUpLen: r.mkUpLen, modelUpLen: r.modelUpLen });
    perf.event("misalign", { where, ...r.firstMismatch, mkUpLen: r.mkUpLen, modelUpLen: r.modelUpLen });
  }
  return r.aligned;
}

/** Check, and repair MusicKit from the model when they diverge — once per call, never a loop. */
async function ensureAligned(where: string): Promise<void> {
  if (checkAlignment(where) || mode !== "queue") return;
  await reconcileUpcoming();
  const ok = alignmentReport().aligned;
  diag.log("player:repair", { where, ok });
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
 * Walk the queue model to match MusicKit's live position (natural advance + skips).
 * A forward step lands on the next LIVE entry: an entry with no play id was never fed to
 * MusicKit, so it is dropped (as a jump drops it), not counted as a step. Returns how many
 * forward steps the model could not take because it ran out of songs.
 */
function syncModelToMusicKit(): number {
  // `nowPlayingItemIndex` is the documented v3 index of the current item; `queue.position`
  // is a fallback (not populated in every build — relying on it left the model frozen,
  // so the now-playing song lingered at the top of Up Next).
  const idx = music?.nowPlayingItemIndex;
  const qp = music?.queue?.position;
  const p = typeof idx === "number" && idx >= 0 ? idx : typeof qp === "number" && qp >= 0 ? qp : -1;
  if (p < 0) {
    console.warn("[player] model-follow: MusicKit gave no queue position");
    return 0;
  }
  let diff = p - windowPos;
  let short = 0;
  while (diff > 0) {
    const k = queue.getUpcoming().findIndex((h) => !!playId(h));
    if (k < 0) short++;
    else queue.jumpTo(k);
    diff--;
  }
  while (diff < 0) {
    queue.previous();
    diff++;
  }
  windowPos = p;
  return short;
}

// ── Context playback ───────────────────────────────────────────────────────────

// We feed MusicKit a bounded window around the start point rather than the whole
// context. The full plan lives in the queue model; the window gives native gapless +
// Previous-into-backlog around the click.
//
// The window is fed in three steps (2026-09-12, the click-to-sound pass — perf.ts):
//  1. The CLICK feed is the clicked song ALONE, as a MediaItem descriptor (`describe`),
//     so setQueue costs ~5 ms instead of a network resolve (8 ids ≈ 130–250 ms, 200 ids
//     ≈ 500–1300 ms measured). No back window: Previous re-windows instead, which costs
//     the same ~1 s as MusicKit's own native skip (it preloads no license or bytes).
//  2. The moment play resolves, growNow() appends the next GROW_NOW ids BY ID (one
//     playLater, ~130 ms, off the click path). This is what natural song-to-song advance
//     needs: MusicKit's auto-advance cannot load a descriptor-fed item (measured: it ends
//     with no item), but it advances fine from a descriptor current into an id-resolved
//     next. Dead ids are caught here by the NOT_FOUND retry, so none enter the queue.
//  3. GROW_DELAY_MS later, scheduleGrow() tops the forward side up to WINDOW_FWD (the
//     same low-water top-up, one batched playLater).
// A second click inside the delay cancels the pending grow; one that lands mid-grow
// awaits it (≤ ~130 ms for stage 2), so a stale playLater can never append into a queue
// that setQueue has since replaced. The id-form fallback feeds ID_FALLBACK_FWD ahead so
// a dead clicked song still yields something to play.
const GROW_NOW = 8;
const WINDOW_FWD = 200;
const GROW_DELAY_MS = 1500;
const ID_FALLBACK_FWD = 5;

let growTimer: number | undefined;
function growNow(): void {
  maybeTopUpWindow(GROW_NOW);
}
function scheduleGrow(): void {
  cancelGrow();
  growTimer = window.setTimeout(() => {
    growTimer = undefined;
    maybeTopUpWindow();
  }, GROW_DELAY_MS);
}
function cancelGrow(): void {
  if (growTimer !== undefined) window.clearTimeout(growTimer);
  growTimer = undefined;
}

// Descriptor-fed windows (2026-09-12): every cached Track carries what MusicKit needs to
// play it, so `setQueue({ items })` with MediaItem descriptors skips the network resolve
// that `setQueue({ songs: ids })` performs first. The id form stays as the fallback — for
// a window with an id the store can't describe, when this MusicKit build rejects the
// descriptor form (remembered for the session), and for a descriptor-fed play that fails
// (a dead id surfaces at play time in this form, at resolve time in the id form — the
// id re-feed then banks it in deadIds as before).
let itemsMode: "try" | "off" = "try";

function describe(id: string): any | undefined {
  const t = trackById(id);
  if (!t) return undefined;
  const byLibrary = t.catalogId !== id; // the fallback path: a library id (dead catalog id)
  const playParams = byLibrary
    ? { id, kind: "song", isLibrary: true, catalogId: t.catalogId }
    : { id, kind: "song" };
  const artwork = t.artwork ? { url: t.artwork.urlTemplate, width: t.artwork.width, height: t.artwork.height } : undefined;
  const descriptor = {
    id,
    type: byLibrary ? "library-songs" : "songs",
    attributes: {
      playParams,
      name: t.title,
      artistName: t.artistName,
      albumName: t.albumName ?? "",
      durationInMillis: t.durationMs,
      artwork,
      contentRating: t.contentRating,
    },
  };
  const MediaItem = window.MusicKit?.MediaItem;
  return typeof MediaItem === "function" ? new MediaItem(descriptor) : descriptor;
}

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
const handlesFrom = (all: Track[], context: string): TrackHandle[] => {
  // A pre-release album's unreleased songs never reach the queue or the store: Apple will
  // not play them, and a 'seen' row would keep the flag past release day (release.ts).
  const list = all.some((t) => t.unreleased) ? all.filter((t) => !t.unreleased) : all;
  addTransientTracks(list);
  // The DURABLE twin of the transient ingest: persist catalog-only tracks as 'seen'
  // rows so plays logged against them (play_events / play_stats) still resolve to
  // metadata in FUTURE sessions — the Rewind card reads history across restarts.
  // Synced library tracks skip (the sync owns their rows); materialize_track is a
  // local DO-NOTHING-on-conflict upsert, so re-plays are cheap and idempotent.
  perf.span("materialize", () => {
    for (const t of list) if (!inLibrary(t.catalogId ?? t.libraryId)) materializeTrack(t);
  });
  return list.map((t) => toHandle(t, context));
};

// Denylist of ids MusicKit refused (NOT_FOUND from a feed, or "currently unavailable" on
// a skip — catalog ids gone stale since the library cached them: region pulls, takedowns).
// A dead catalog id makes the handle fall back to its LIBRARY id (the user's copy usually
// still plays); a handle with no live id left is skipped by the window builders entirely.
// Persisted in the cache db (`dead_ids`, 7-day expiry — QUEUE.md §Dead ids) and loaded at
// launch, so a known dead id never costs a failed MusicKit request again.
const deadIds = new Set<string>();

let deadLoad: Promise<void> | null = null;
function loadDeadIds(): Promise<void> {
  deadLoad ??= invoke<string[]>("dead_ids_cached")
    .then((ids) => {
      ids.forEach((id) => deadIds.add(id));
      diag.log("player:deadLoaded", { n: ids.length });
    })
    .catch((e) => console.warn("[player] dead ids load:", e));
  return deadLoad;
}

/** Bank ids in the session denylist and on disk. `fresh` = first found dead on this
 *  install — the dead-song toast's trigger (TOASTS.md). */
function markDead(ids: string[], reason: "not-found" | "unavailable"): void {
  ids.forEach((id) => deadIds.add(id));
  invoke<string[]>("dead_ids_mark", { ids, reason })
    .then((fresh) => {
      if (!fresh.length) return;
      diag.log("player:deadFresh", { reason, fresh: fresh.slice(0, 10) });
      noteDeadSongs(fresh);
    })
    .catch((e) => console.warn("[player] dead ids save:", e));
}

// The dead-song toast (TOASTS.md): one timed warn per burst, naming SONGS, not ids.
// A feed rejection marks a batch in one call, but the retry and healDeadNext can mark
// more within a second, so fresh names collect for DEAD_TOAST_GAP_MS and raise once.
// A dead catalog id whose library id still plays is not skipped (playId falls back),
// so it must not be named: only handles with no play target left count.
const DEAD_TOAST_GAP_MS = 1000;
const deadNames = new Set<string>();
/** Titles the dead-song toast has named, read once by playTracks' failure toast so a
 *  dead song is not reported twice ("Couldn't play" + "Skipped"). */
const deadToasted = new Set<string>();
let deadToastTimer: number | undefined;
function noteDeadSongs(fresh: string[]): void {
  for (const id of fresh) {
    const t = trackById(id);
    if (!t) continue; // an id the store can't name (a transient that never resolved) — no toast
    if (playId({ catalogId: t.catalogId, libraryId: t.libraryId })) continue; // still plays via the other id
    deadNames.add(t.title);
  }
  if (!deadNames.size) return;
  window.clearTimeout(deadToastTimer);
  deadToastTimer = window.setTimeout(() => {
    const names = [...deadNames];
    deadNames.clear();
    names.forEach((n) => deadToasted.add(n));
    const text =
      names.length === 1
        ? `Skipped “${names[0]}” — Apple Music no longer offers it.`
        : `Skipped ${names.length} songs Apple Music no longer offers: ${names.slice(0, 2).map((n) => `“${n}”`).join(", ")}${names.length > 2 ? ` and ${names.length - 2} more` : ""}.`;
    toast({ kind: "warn", text, timeout: 6000 });
  }, DEAD_TOAST_GAP_MS);
}

// A sign-in that completed THIS session (main.ts tells us). The first playback failure
// after it that is not a dead-song rejection gets the "no subscription?" hint
// (TOASTS.md): MusicKit reports a missing Apple Music subscription only as a
// playback error, never at sign-in, and this is the one moment the cause is likely.
let freshSignIn = false;
export function noteSignedIn(): void {
  freshSignIn = true;
}

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
 * keeps its entries; the window builders skip dead ones. See docs/features/QUEUE.md.
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
      markDead(bad, "not-found");
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
 * the song alone at index 0, grown by id right after it starts (growNow) and to
 * WINDOW_FWD shortly after (scheduleGrow). Used for a fresh
 * context and for any jump that lands outside the live window — the latter buffers
 * (the documented latency; `loading` is surfaced for the cover-up).
 */
// Load options. Break-out from a station sets `stopFirst`: fully stop MusicKit's
// continuous (station) controller before the swap — a mere pause() leaves it primed to
// advance, and its next-track load then interrupts our setQueue/play (AbortError).
// (Every load now feeds `current` at index 0 — the former `noBack` is the only shape.)
interface LoadOpts {
  stopFirst?: boolean;
  /** Start the fed song here, in ms — a late join or a seek in a room (ROOMS.md §9.3). */
  seekMs?: number;
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
  // A pending grow is moot (this load re-windows); an in-flight one must finish first.
  cancelGrow();
  if (topUp) {
    perf.mark("waitTopUp");
    await topUp;
  }
  // Build a DUPLICATE-FREE window: `current` at index 0 (pos is always 0 now), then up to
  // `fwdN` upcoming ids. MusicKit's setQueue collapses repeated song ids, which would
  // throw off the index changeToMediaAtIndex jumps to — so dedupe (first id wins). The
  // descriptor feed asks for fwdN = 0 (the song alone; growNow appends the rest by id);
  // the id-form fallback asks for ID_FALLBACK_FWD so a dead current still yields a song.
  //
  // Re-runnable because playId is deadIds-aware: after a NOT_FOUND rejection banks the
  // unresolvable ids, a rebuild swaps them for library-id fallbacks (or drops them).
  const buildWindow = (fwdN: number): { ids: string[]; pos: number } => {
    const curId = playId(current);
    const seen = new Set<string>();
    const ids: string[] = [];
    if (curId) {
      seen.add(curId);
      ids.push(curId);
    }
    for (const h of queue.getUpcoming().slice(0, fwdN)) {
      const id = playId(h);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return { ids, pos: 0 };
  };
  let { ids, pos } = buildWindow(ID_FALLBACK_FWD);
  if (!ids.length) {
    console.warn("[player] nothing playable in window");
    return;
  }
  if (!current.catalogId && current.libraryId) console.log("[player] current is library-only — playing via library id");

  isLoading = true;
  loadingContext = true; // suppress model-follow while we (re)build MusicKit's queue
  perf.span("emit.loading", emit); // surface the loading state for the cover-up
  emitLoadingProgress(); // the scrubber at 0:00 of the incoming song (UX-COVERUPS.md §1)
  try {
    // Clean the transport before the swap. MusicKit refuses a play() "without a previous
    // stop()/pause()" while already playing. Normally pause() is enough; leaving a STATION
    // needs a full stop() (`stopFirst`) — pausing a continuous controller leaves it primed
    // to advance, and that advance interrupts our setQueue/play (AbortError).
    notePause("load");
    if (opts.stopFirst && typeof m.stop === "function") await m.stop();
    else if (m.isPlaying && typeof m.pause === "function") await m.pause();
    perf.mark("quiet");
    // Feed the window. Descriptors first (no resolve round trip — see `describe`), the id
    // form as the fallback. The id form's setQueue is all-or-nothing: ONE unresolvable id
    // rejects the whole window (NOT_FOUND — stale catalog ids). The rejection names the
    // offenders, so bank them in deadIds, rebuild the window (library-id fallback /
    // drop), and retry. Returns the form that took.
    const feed = async (allowItems: boolean): Promise<"items" | "ids"> => {
      if (allowItems && itemsMode === "try" && playId(current)) {
        ({ ids, pos } = buildWindow(0)); // the clicked song alone
        const items = perf.span("describe", () => ids.map(describe));
        if (items.every(Boolean)) {
          try {
            await m.setQueue({ items });
            const got: number = m.queue?.items?.length ?? 0;
            if (got === ids.length) return "items";
            throw new Error(`descriptor form fed ${got} of ${ids.length}`);
          } catch (e) {
            itemsMode = "off"; // this MusicKit build doesn't take descriptors — ids for the session
            diag.log("player:itemsOff", { e: String(e) });
            perf.note("itemsOff", String(e));
            console.warn("[player] setQueue({items}) rejected — id form for the rest of the session:", e);
          }
        } else {
          diag.log("player:itemsSkip", { missing: items.filter((x) => !x).length, of: ids.length });
        }
      }
      ({ ids, pos } = buildWindow(ID_FALLBACK_FWD));
      if (!ids.length) throw new Error("nothing playable in window");
      for (let attempt = 0; ; attempt++) {
        try {
          await m.setQueue({ songs: ids });
          return "ids";
        } catch (e) {
          const bad = unresolvedIds(e);
          if (!bad.length || attempt >= 2) throw e; // not a resolve failure, or persistently bad
          markDead(bad, "not-found");
          diag.log("player:deadIds", { n: bad.length, attempt, bad: bad.slice(0, 10) });
          console.warn(`[player] ${bad.length} unresolvable id(s) dropped from window; retrying`);
          ({ ids, pos } = buildWindow(ID_FALLBACK_FWD));
          if (!ids.length) throw e; // everything in the window was dead
        }
      }
    };
    // pos=0 deliberately SKIPS changeToMediaAtIndex: setQueue already leaves the queue
    // at index 0, and changeToMediaAtIndex(0) races MusicKit's internal play (its event
    // handler fires play() on top of the in-flight one → the uncaught "play() without a
    // previous stop()/pause()" rejection). Plain play() is sufficient there — the
    // historical "pos=0 doesn't start" symptom was really the dead-id NOT_FOUND
    // rejection (see the retry loop above), not a selection problem.
    const start = async (): Promise<void> => {
      if (pos > 0 && typeof m.changeToMediaAtIndex === "function") {
        await m.changeToMediaAtIndex(pos); // move to the clicked song within the window
      }
      // A room's song is joined where the room is: seek before the first sound, so a
      // late join never plays the opening bars everyone else passed a minute ago.
      if (opts.seekMs && opts.seekMs > 500 && typeof m.seekToTime === "function") {
        await m.seekToTime(opts.seekMs / 1000);
      }
      if (autoplay && !m.isPlaying) await m.play(); // no-op if changeToMediaAtIndex already started
    };
    let fed = await feed(true);
    applyRepeatToMusicKit(); // queue mode again (exitRadio above): repeat one is MusicKit's
    windowPos = pos; // the model's `current` is aligned to this MusicKit index (computed above)
    diag.log("player:loadWindow", { ids: ids.length, pos, fed });
    perf.mark("window", { ids: ids.length, pos, fed });
    try {
      await start();
    } catch (e) {
      if (fed !== "items") throw e;
      // A descriptor-fed play failed — most likely a dead id, which the id form catches
      // at resolve time. Re-feed the same window by ids (dead-id retry included) once.
      diag.log("player:itemsPlayFailed", { e: String(e) });
      perf.event("itemsPlayFailed", { e: String(e) });
      console.warn("[player] descriptor-fed play failed; re-feeding by ids:", e);
      notePause("load");
      if (m.isPlaying && typeof m.pause === "function") await m.pause();
      fed = await feed(false);
      windowPos = pos;
      diag.log("player:loadWindow", { ids: ids.length, pos, fed });
      await start();
    }
    stats.recordStart(queue.getCurrent()); // settled start (intermediate rebuild changes were suppressed)
    perf.mark("resolve");
    if (mode !== "room") {
      growNow(); // the next few songs, by id, at once — what natural advance needs
      scheduleGrow(); // the rest of the plan grows in gaplessly once the song is under way
    }
  } catch (e) {
    // Surface and rethrow — but NEVER leave `loadingContext` stuck (the finally): a
    // rejection here used to suppress model-follow for the rest of the session.
    diag.log("player:loadError", { e: String(e) });
    perf.abandon("loadError");
    console.warn("[player] load failed:", e);
    throw e;
  } finally {
    loadingContext = false;
    isLoading = false;
    lastLoadEndAt = performance.now();
    emit();
  }
}

/**
 * Play an ordered context (already in the desired sort order) from `startIndex`.
 * `handles` is the full list; the queue model keeps all of it, MusicKit gets a window.
 */
export async function playContext(handles: TrackHandle[], startIndex: number): Promise<void> {
  if (roomBridge) return roomBridge.playHandles(handles, startIndex); // the room's queue (§10)
  perf.mark("model"); // ingest + re-renders done; what follows up to `context` is MusicKit init
  await requireSignIn();
  const m = await initPlayer();
  diag.log("player:playContext", { startIndex, len: handles.length, ctx: handles[startIndex]?.context });
  perf.mark("context", { len: handles.length });

  // Idempotent re-click: clicking the song that's already current shouldn't tear down
  // and rebuild MusicKit's queue (a needless buffer/gap, and the path that used to
  // accumulate). Just restart it from the top — what people expect from re-clicking.
  //
  // It is a re-click only when the SAME LIST is clicked again (2026-09-18, the owner's
  // fork 1A). The song id alone is not enough: a Home song tile queues one song, and the
  // album that song opens starts with it — so Play on the album read as a re-click, and
  // the album never reached the queue. `sameContext` compares the click's list against
  // the loaded plan, position by position. An empty plan (a restored session, or a
  // station) fails it, which is the safe way round: rebuild.
  const target = handles[startIndex];
  const cur = queue.getCurrent();
  const sameContext = (): boolean => {
    const plan = queue.getPlan();
    return plan.length === handles.length && handles.every((h, i) => playId(h) === playId(plan[i]));
  };
  if (target && cur && playId(target) && playId(target) === playId(cur) && m.nowPlayingItem && sameContext()) {
    diag.log("player:reclick", { id: playId(target), ctx: target.context, len: handles.length });
    perf.abandon("reclick"); // no rebuild, no `playing` transition to time
    await m.seekToTime(0);
    if (!m.isPlaying) await m.play();
    stats.recordRestart(cur); // a deliberate restart is a fresh play (no np-change fires here)
    return;
  }

  // Every song from the start is already known dead: loadFromModel would find an empty
  // window and return quietly, leaving a dead song as `current` with nothing playing and
  // the click reported as a success. Refuse before the model changes (TOASTS.md).
  if (!handles.slice(startIndex).some((h) => playId(h))) {
    perf.abandon("nothingPlayable");
    throw new Error("nothing to play: Apple Music no longer offers these songs");
  }

  resumeStation = null; // a deliberate new context ends any queued station return
  perf.span("setContext", () => queue.setContext(handles, startIndex, isShuffleOn())); // shuffle mode: the rest shuffled
  perf.target(playId(queue.getCurrent() ?? {}));
  await loadFromModel(m);
}

/** Jump to an Up Next entry by index (skipped songs are dropped). Re-windows → buffers. */
export async function jumpToUpcoming(index: number): Promise<void> {
  if (roomBridge) return roomBridge.jumpTo(index);
  playIntent();
  perf.click("jump", index + 1);
  await requireSignIn();
  const m = await initPlayer();
  diag.log("player:jump", { index });
  if (!queue.jumpTo(index)) return perf.abandon("noJump");
  perf.mark("context");
  perf.target(playId(queue.getCurrent() ?? {}));
  await loadFromModel(m);
}

/** Play library Tracks already in display/sort order, starting at `startIndex`. */
export function playTracks(tracks: Track[], startIndex: number, context = "library"): Promise<void> {
  // handlesFrom drops unreleased songs, so the start moves to the first released song at or
  // after the click. None left: say so here, not the "no longer offers" toast below.
  if (tracks.some((t) => t.unreleased)) {
    const rest = tracks.slice(startIndex).filter((t) => !t.unreleased);
    if (!rest.length) {
      diag.log("player:unreleased", { context, n: tracks.length - startIndex });
      // warn: the click did nothing, here is why (TOASTS.md §2) — it shows under every tier.
      toast({ kind: "warn", text: unreleasedToast(tracks[startIndex], tracks.length - startIndex > 1) });
      return Promise.resolve();
    }
    startIndex = tracks.slice(0, startIndex).filter((t) => !t.unreleased).length;
  }
  playIntent();
  perf.click(context, tracks.length); // BEFORE the ingest — stage A includes it
  const handles = handlesFrom(tracks, context);
  const play = () => playContext(handles, startIndex);
  return play().catch(async (e) => {
    // Every play click (every card, the agent) lands here; the callers only log (TOASTS.md).
    const msg = String(e instanceof Error ? e.message : e);
    if (msg === SIGNED_OUT || msg === NO_MUSICKIT) throw e; // requireSignIn's toast already says why
    diag.warn("player:playFailed", { msg, context });
    const gone = msg.startsWith("nothing to play");
    if (!gone) {
      // Maybe Apple rejected a token: find the cause, heal, retry once (bounded in
      // recoverFromFailure). A named cause has its own toast, so no "Couldn't play" too.
      const r = await recoverFromFailure("play");
      if (r.retry) {
        try {
          await play();
          return;
        } catch (e2) {
          e = e2;
        }
      }
      // The authorization listener may already have restored MusicKit and re-run this load.
      if (!r.retry && performance.now() - lastRetryAt < 5000) return;
      if (r.trouble !== "none" || performance.now() - lastTroubleAt < 5000) throw e;
    }
    // A dead song gets the named dead-song toast about a second later (the feed rejects,
    // dead_ids_mark answers, the names collect for DEAD_TOAST_GAP_MS): wait past that and
    // stay quiet if it named this song.
    const title = tracks[startIndex]?.title;
    window.setTimeout(() => {
      if (title && deadToasted.delete(title)) return;
      const text = gone
        ? tracks.length - startIndex > 1 || !title
          ? "Apple Music no longer offers these songs."
          : `Apple Music no longer offers “${title}”.`
        : title
          ? `Couldn't play “${title}”.`
          : "Couldn't play that.";
      toast({ kind: "warn", text });
    }, DEAD_TOAST_GAP_MS + 400);
    throw e;
  });
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
  if (roomBridge && !roomBridge.station()) return;
  playIntent();
  await requireSignIn();
  const m = await initPlayer();
  diag.log("player:playStation", { id: s.id, live: s.isLive });
  queue.disposePlan();
  mode = "radio";
  radioStation = s;
  resumeStation = null;
  pendingBreakout = false;
  applyRepeatToMusicKit(); // a station never repeats
  isLoading = true;
  loadingContext = true; // suppress model-follow while the station queue builds
  emit();
  // No loading report here: a station has no length, and emitProgress holds the old song's
  // ticks back while `loading` is true, so its clock stops rather than runs on.
  try {
    notePause("station");
    if (m.isPlaying && typeof m.pause === "function") await m.pause();
    await setStationQueue(m, s);
    if (!m.isPlaying) await m.play();
    recordStationPlay(s); // recents — an actual play, not a browse
  } catch (e) {
    exitRadio();
    diag.log("player:stationError", { id: s.id, e: String(e) });
    console.warn("[player] station failed:", e);
    // Every station play (Radio, Search, Start Station, the agent, the launch resume) lands here (TOASTS.md).
    toast({ kind: "warn", text: `Couldn't start “${s.name}”.` });
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
 * Stop Station (Qcard station row / Now Playing menu). Leaves radio mode with the
 * last station song still on screen, PAUSED (your call, 2026-09-10): the song stays
 * `current` in the model and MusicKit's queue is rebuilt as a finite window around it
 * (stopFirst halts the station controller, so a later Play plays that song under
 * queue mode instead of resurrecting the stream). The heard trail stays, so Previous
 * and History are unaffected. A pending break-out block stays queued behind it.
 */
export async function stopStation(): Promise<void> {
  if (mode !== "radio") return;
  const m = await initPlayer();
  diag.log("player:stopStation", { id: radioStation?.id });
  exitRadio();
  resumeStation = null;
  try {
    notePause("station-stop");
    if (m.isPlaying && typeof m.pause === "function") await m.pause();
  } catch (e) {
    console.warn("[player] stop station:", e);
  }
  if (queue.getCurrent()) {
    await loadFromModel(m, false, { stopFirst: true }).catch((e) =>
      console.warn("[player] stop station reload:", e),
    );
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
// block as a fresh context. See docs/features/QUEUE.md.

/** Shared core: filter to playable handles, bootstrap if idle, else mutate model + MusicKit. */
async function enqueue(handles: TrackHandle[], where: "next" | "later"): Promise<void> {
  if (roomBridge) return roomBridge.enqueue(handles, where);
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
    // The station is the row after the block and returns when it ends (maybeResumeStation).
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
  await ensureAligned(`enqueue:${where}`);
}

/** Insert handles right after the current song (gapless). */
export const enqueueNext = (handles: TrackHandle[]): Promise<void> => enqueue(handles, "next");
/** Append handles to the end of the queue (gapless). */
export const enqueueLater = (handles: TrackHandle[]): Promise<void> => enqueue(handles, "later");

/** Play-Next a list of library Tracks (e.g. a song, or an album in track order). */
export const queueTracksNext = (tracks: Track[], context = "library"): Promise<void> =>
  enqueueNext(handlesFrom(tracks, context)).catch(queueFailed);
/** Add-to-Queue a list of library Tracks. */
export const queueTracksLater = (tracks: Track[], context = "library"): Promise<void> =>
  enqueueLater(handlesFrom(tracks, context)).catch(queueFailed);
/**
 * Insert handles into Up Next at model index `at` — a drop on the Queue card (DRAG-DROP.md
 * §3). The model takes the block, then `reconcileUpcoming()` mirrors the new order into
 * MusicKit gaplessly (current never moves). Radio: model only, the break-out rule. Nothing
 * playing: start the block.
 */
export async function insertInQueue(at: number, handles: TrackHandle[]): Promise<void> {
  if (roomBridge) return roomBridge.insertAt(at, handles);
  const playable = handles.filter((h) => playId(h));
  if (!playable.length) return;
  await initPlayer();
  diag.log("player:insert", { at, n: playable.length });
  if (!queue.getCurrent()) {
    await playContext(playable, 0);
    return;
  }
  queue.insertManyAt(at, playable);
  if (mode === "radio") {
    pendingBreakout = true;
    return;
  }
  await reconcileUpcoming();
}
/**
 * Play Tracks at once and keep Up Next after them — a drop on Now Playing with Settings ›
 * Playback › Drop on Now Playing = Keep Up Next. The block goes to the top of Up Next and
 * the player jumps to its first song: the song that was playing joins History, and the
 * rest of Up Next is untouched. Nothing playing: an ordinary play.
 */
export async function playTracksKeepQueue(tracks: Track[], context = "library"): Promise<void> {
  if (!queue.getCurrent()) return playTracks(tracks, 0, context);
  const playable = handlesFrom(tracks, context).filter((h) => playId(h));
  if (!playable.length) return;
  queue.insertManyAt(0, playable);
  await jumpToUpcoming(0).catch((e) => {
    toast({ kind: "warn", text: tracks[0]?.title ? `Couldn't play “${tracks[0].title}”.` : "Couldn't play that." });
    throw e;
  });
}
/** Insert library Tracks into Up Next at `at`. */
export const queueTracksAt = (at: number, tracks: Track[], context = "library"): Promise<void> =>
  insertInQueue(at, handlesFrom(tracks, context)).catch(queueFailed);
function queueFailed(e: unknown): never {
  toast({ kind: "warn", text: "Couldn't add to the queue." });
  throw e;
}

// ── Queue editing (Up Next context menu: Remove / Move to Top / Move to Bottom) ──
//
// All three act on UPCOMING items (after current), so `current`'s MusicKit index never
// moves — `windowPos` + model-follow stay valid. `music.queue.splice(index, count)` is a
// gapless live mutation that fires only `queueItemsDidChange` (NOT
// `nowPlayingItemDidChange`), so model-follow isn't disturbed. (It's MusicKit's supported
// queue mutator — the old `queue.remove` was deprecated in v3 and just forwarded to
// `splice(i, 1)` anyway.) Remove splices the item out; Move composes a splice-out + the
// documented `playNext`/`playLater` inserts. We update the model first (instant Qcard
// re-render), then mirror into MusicKit. See docs/features/QUEUE.md.

/**
 * MusicKit-queue index of the upcoming entry at model index `k`. The window feeds
 * `upcoming` in order after `current`, so it's `nowPlayingItemIndex + 1 + k` — but we
 * id-verify and fall back to a forward search, in case `setQueue`'s dedup drifted the
 * indices. Returns -1 if the entry isn't in MusicKit's window (then it's model-only).
 */
function mkUpcomingIndex(m: any, k: number, id: string): number {
  const items: any[] = m.queue?.items ?? [];
  const np = typeof m.nowPlayingItemIndex === "number" && m.nowPlayingItemIndex >= 0 ? m.nowPlayingItemIndex : windowPos;
  // MusicKit holds only the live entries (a dead one is never fed), so count those. Since
  // 2026-09-24 a song can sit in the window twice, which makes the exact slot matter.
  const live = queue.getUpcoming().slice(0, k).filter((h) => !!playId(h)).length;
  const guess = np + 1 + live;
  if (items[guess]?.id === id) return guess;
  for (let i = np + 1; i < items.length; i++) if (items[i]?.id === id) return i; // dedup drift
  return -1;
}

/** Remove an Up Next entry (gapless). */
export async function removeFromQueue(index: number): Promise<void> {
  if (roomBridge) return roomBridge.removeAt(index);
  const entry = queue.getUpcoming()[index];
  if (!entry) return;
  const m = await initPlayer();
  const id = playId(entry);
  const mk = id ? mkUpcomingIndex(m, index, id) : -1;
  diag.log("player:queueEdit", { op: "remove", index, mk, id });
  queue.removeAt(index); // model first → Qcard updates instantly
  if (mk >= 0 && typeof m.queue?.splice === "function") m.queue.splice(mk, 1);
  await ensureAligned("remove");
}

/** Move an Up Next entry to the front (top) or back (bottom) of upcoming (gapless). */
export async function moveInQueue(index: number, to: "top" | "bottom"): Promise<void> {
  if (roomBridge) return roomBridge.moveTo(index, to);
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
  await ensureAligned(`move-${to}`);
}

/**
 * Reflect an arbitrary model reorder into MusicKit's live window — GAPLESSLY. The model is
 * the source of truth; this rebuilds only the **divergent suffix** of MusicKit's upcoming
 * (`remove` everything from the first mismatch to the end, then `playLater` the model's
 * upcoming from there). Both ops leave `current` untouched, so no `setQueue`, no buffer.
 * Bounded by `WINDOW_FWD` (MusicKit only ever holds the forward window). This is the general
 * sync primitive — drag-reorder uses it, and re-windowing (roadmap) will too. See docs/features/QUEUE.md.
 */
// Reconciles are SERIALIZED: a song change repairs (ensureAligned) and tops up
// (maybeTopUpWindow) in the same tick, and two reconciles reading `items` before either
// splices would each cut and append the same suffix.
let reconcileChain: Promise<void> = Promise.resolve();

export function reconcileUpcoming(cap = WINDOW_FWD): Promise<void> {
  const run = reconcileChain.then(() => doReconcileUpcoming(cap));
  reconcileChain = run.catch(() => {}); // keep the chain alive past a failed reconcile
  return run;
}

async function doReconcileUpcoming(cap: number): Promise<void> {
  // Radio: MusicKit's queue is station-owned; a break-out block edit is model-only.
  // Room: the room owns the queue, and MusicKit holds only the song being heard.
  if (!music || mode !== "queue") return;
  const m = music;
  const items: any[] = m.queue?.items ?? [];
  const np = typeof m.nowPlayingItemIndex === "number" ? m.nowPlayingItemIndex : -1;
  if (np < 0) return;

  // Expected MK upcoming = the model's upcoming live ids, in order, capped to the window.
  // No dedup: `playLater` keeps a repeated id (only `setQueue` collapses them, which is why
  // loadFromModel's window still dedups). The rules live in queue-sync.ts, under test.
  // A closure so the NOT_FOUND retry can rebuild it after a dead-id bank (playId is deadIds-aware).
  const computeExpected = (): string[] => expectedIds(queue.getUpcoming(), cap, playId);
  const expected = computeExpected();

  const mkUp: string[] = items.slice(np + 1).map((it) => it?.id);
  const plan = suffixPlan(mkUp, expected);
  if (!plan) return; // already in sync
  const { keep: d, drop } = plan; // MK's divergent suffix is contiguous: [np+1+d .. end]

  diag.log("player:reconcile", { d, mk: mkUp.length, expected: expected.length });
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
  if (roomBridge) return; // the room decides the order (§10)
  await initPlayer();
  if (!queue.getCurrent()) {
    if (setting("shuffleIdle") === "noop") return; // FUTURE-SETTINGS §5b: idle press does nothing
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

/**
 * The Shuffle square (NEXT-VERSION §14 A). With "Shuffle stays on" (the default) it is a
 * mode: press = on (and Up Next shuffles now, the one-shot above), press again = off (Up
 * Next stays as it is; the next list plays in order). With the row off it is the one-shot.
 */
export async function toggleShuffle(): Promise<void> {
  if (roomBridge) return;
  if (!setting("shuffleStays")) return shuffleQueue();
  const on = !setting("shuffleMode");
  setShuffleMode(on);
  if (on) await shuffleQueue();
}

// ── Listening rooms (docs/integrations/ROOMS.md) ──────────────────────────────────────────
//
// In a room the transport, the queue edits and every play are the ROOM's, not this
// app's (§10). Rather than teach each of the dozens of call sites about rooms, the
// funnels below ask the bridge first: room.ts installs one while a room is on, and
// every click becomes a room command.
//
// Follower mode is the other half: the room says WHEN a song starts, and `roomShow` /
// `roomResumeAt` / `roomHold` make MusicKit agree. MusicKit is fed ONE song, so at its
// end it goes quiet and waits for the room instead of advancing on its own (§5.5).

export interface RoomBridge {
  playPause(): void;
  next(): void;
  previous(): void;
  seekSeconds(seconds: number): void;
  playHandles(handles: readonly TrackHandle[], startIndex: number): void;
  enqueue(handles: readonly TrackHandle[], where: "next" | "later"): void;
  insertAt(at: number, handles: readonly TrackHandle[]): void;
  jumpTo(index: number): void;
  removeAt(index: number): void;
  moveTo(index: number, to: "top" | "bottom"): void;
  /** A station cannot play in a room (§10). Returns false: the caller stops. */
  station(): boolean;
}

let roomBridge: RoomBridge | null = null;
/** room.ts installs the bridge on join and clears it on leave. */
export function setRoomBridge(b: RoomBridge | null): void {
  roomBridge = b;
  diag.log("player:roomBridge", { on: !!b });
}

/** Enter room mode: MusicKit holds one song, and the window machinery stands down. */
export async function roomEnter(): Promise<void> {
  await initPlayer();
  cancelGrow();
  mode = "room";
  resumeStation = null;
  diag.log("player:roomEnter", {});
  emit();
}

/** Back to the app's own player. */
export function roomExit(): void {
  if (mode === "room") mode = "queue";
  diag.log("player:roomExit", {});
  emit();
}

/**
 * Put `handle` in MusicKit alone, at `positionMs`, and play or hold. The room's own
 * state message is what decides; nothing here starts a song the room did not start.
 */
export async function roomShow(handle: TrackHandle, positionMs: number, play: boolean): Promise<void> {
  const m = await initPlayer();
  const id = playId(handle);
  if (!id) return;
  // MusicKit ALREADY HOLDS this exact song: seek, do not rebuild. A rebuild pauses before
  // setQueue, and a paused descriptor-fed queue leaves `nowPlayingItem` null — which
  // stranded the room in silence, because every later step reads that same null
  // (2026-09-18, room W1THF05N: `player:loadWindow` with no sound after it). The host's
  // seed hits this every time: it puts the host's own current song first (ROOMS.md §7).
  const npId = m.nowPlayingItem?.id;
  if (npId && (npId === handle.catalogId || npId === handle.libraryId)) {
    diag.log("player:roomSameSong", { id, play, playing: !!m.isPlaying, at: Math.round(positionMs) });
    const off = Math.abs((m.currentPlaybackTime ?? 0) * 1000 - positionMs);
    if (off > 400 && typeof m.seekToTime === "function") await m.seekToTime(Math.max(0, positionMs) / 1000);
    // Match the room, whichever way it points: a seeded room that has not started yet
    // must HOLD this song, not leave it playing from before the room existed.
    if (play && !m.isPlaying) await m.play();
    else if (!play && m.isPlaying && typeof m.pause === "function") { if (!pauseNote) notePause("room"); await m.pause(); } // keep "room:<source>" when we sent it
    return;
  }
  // The model already holds the room's queue (room.ts wrote it); play its head.
  await loadFromModel(m, play, { seekMs: positionMs });
}

/** Pause without leaving the room: the room's clock runs on. */
export async function roomHold(): Promise<void> {
  const m = music;
  notePause("room-hold");
  if (m?.isPlaying && typeof m.pause === "function") await m.pause();
}

/**
 * Play at the room's position. `correcting` = a drift fix from the progress tick, where
 * the song is playing by definition: seek only, never start. Every other caller leaves it
 * false, so a held player starts again when the room says the song is playing.
 */
export async function roomResumeAt(positionMs: number, correcting = false): Promise<void> {
  const m = music;
  if (!m) return;
  const had = !!m.nowPlayingItem;
  diag.log("room:resume", { had, at: Math.round(positionMs), correcting, playing: !!m.isPlaying });
  if (!had) {
    // MusicKit holds NOTHING. This used to be a bare `return` — no log, no toast, and
    // nothing that could ever recover it: the drift check runs off the progress tick,
    // and a silent player emits none. A room that landed here stayed silent for ever
    // (2026-09-18). Re-feed the room's song from the model and START it.
    if (correcting) return; // the drift tick's song is playing by definition
    // The re-feed plays with autoplay on, and it reads the model's CURRENT queue. A
    // `teardown()` landing during an await above restores the user's own queue first, so
    // without this the room you just left starts your own music (ROOMS.md §18.1). The
    // log is deliberate: a silent early return here is what caused §17.9.
    if (mode !== "room") {
      diag.log("room:resumeStale", { mode, at: Math.round(positionMs) });
      return;
    }
    await loadFromModel(m, true, { seekMs: positionMs });
    return;
  }
  const duration = (m.currentPlaybackDuration ?? 0) * 1000;
  const want = duration > 0 ? Math.min(positionMs, Math.max(0, duration - 500)) : positionMs;
  const off = Math.abs((m.currentPlaybackTime ?? 0) * 1000 - want);
  if (off > 400 && typeof m.seekToTime === "function") await m.seekToTime(want / 1000);
  if (!correcting && !m.isPlaying) await m.play();
}

/** Where the local player is, in ms — what the room's drift check compares. */
export function roomPositionMs(): number {
  return (music?.currentPlaybackTime ?? 0) * 1000;
}

/** False once MusicKit's one-song queue has played out and gone quiet (§5.5). */
export function roomHasSong(): boolean {
  return !!music?.nowPlayingItem;
}

// ── Transport ────────────────────────────────────────────────────────────────

/** Toggle play/pause. With nothing queued, starts the cached library from the top. */
export async function playPause(why = "button"): Promise<void> {
  if (music?.isPlaying) notePause(roomBridge ? `room:${why}` : why);
  if (roomBridge) return roomBridge.playPause(); // a room command (ROOMS.md §10)
  if (!music?.isPlaying) await requireSignIn(); // pausing never needs a sign-in
  const m = await initPlayer();
  if (m.isPlaying) {
    await m.pause();
    return;
  }
  if (m.nowPlayingItem) {
    // Dev telemetry: a resume is timed like a click (a preloaded restore lands here).
    perf.click("resume", 1);
    perf.target(m.nowPlayingItem?.id);
    perf.mark("model");
    perf.mark("context");
    perf.mark("window");
    await m.play();
    scheduleGrow(); // a preloaded window is the small click window — grow it like any click
    return;
  }
  // Nothing loaded in MusicKit but the model has a plan — a restored session
  // (queue-persist.ts): Play resumes where you left off.
  if (queue.getCurrent()) {
    await loadFromModel(m);
    // An update restart saved the position (queue-persist.ts): resume there, once, and only
    // while the restored song is still the model's current.
    const r = resumeAt;
    resumeAt = null;
    const cur = queue.getCurrent();
    if (r && cur && (cur.catalogId ?? cur.libraryId) === r.id) await m.seekToTime(r.sec);
    return;
  }
  if (queue.getUpcoming().length) {
    await jumpToUpcoming(0);
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
  if (roomBridge) return roomBridge.next();
  playIntent();
  const m = await initPlayer();
  diag.log("player:next", snap());
  // Dev telemetry: a native skip is the preloaded path — time it like a click so the
  // two can be compared (no model/setQueue stages; those marks are stamped at once).
  const nx = queue.peekNext();
  perf.click("next", 1);
  perf.target(nx ? playId(nx) : undefined);
  perf.mark("model");
  perf.mark("context");
  perf.mark("window");
  if (typeof m.skipToNextItem !== "function") return;
  try {
    await m.skipToNextItem();
  } catch (e) {
    if (!isUnavailable(e) || !(await healDeadNext(m, String(e), true))) throw e;
  }
}

const isUnavailable = (e: unknown): boolean =>
  /unavailable/i.test(e instanceof Error ? e.message : String((e as any)?.message ?? e ?? ""));

/**
 * The song MusicKit was asked to advance into is dead (a stale catalog id). The
 * descriptor-fed window doesn't resolve ids up front, so this is where a dead one now
 * surfaces: MusicKit refuses the skip ("This song is currently unavailable.") or errors
 * the auto-advance, and stays put on the old song. Bank the id, jump the model to the
 * first upcoming entry that still has a live id (playId offers a library-id fallback
 * for the banked one, else the entries in between are discarded, as any jump does) and
 * re-window from there — the same load every click takes, so windowPos and model-follow
 * stay exact. (Reconciling MusicKit's upcoming in place and skipping again was tried
 * first and left the index-based follow one song off.) False = nothing left to play.
 */
async function healDeadNext(m: any, why: string, bank: boolean): Promise<boolean> {
  const nx = queue.peekNext();
  const id = nx ? playId(nx) : undefined;
  if (!id) return false;
  // Bank only on MusicKit's own word (the skip rejection). The end-of-song shape also
  // follows a transient failure (a MEDIA_LICENSE hiccup), and banking there skipped
  // LIVE songs for the session (observed 2026-09-12); an unbanked re-window onto a truly
  // dead song fails into the id re-feed, whose NOT_FOUND retry banks it properly.
  if (bank) markDead([id], "unavailable");
  diag.log("player:deadNext", { id, why, bank });
  perf.event("deadNext", { id, why, bank });
  console.warn(`[player] next song ${bank ? "unavailable" : "failed to start"} (${id}); ${bank ? "moving on" : "re-windowing onto it"}`);
  const k = queue.getUpcoming().findIndex((h) => !!playId(h));
  if (k < 0 || !queue.jumpTo(k)) return false;
  await loadFromModel(m);
  return true;
}

/**
 * The auto-advance twin of the skip rejection: when a song ends and the NEXT item in
 * MusicKit's queue is unplayable, MusicKit emits no error at all — it just goes to
 * `ended` with no now-playing item while the model still holds upcoming songs
 * (observed 2026-09-12; `mediaPlaybackError` never fired). Two causes share that shape:
 *  - MusicKit still had items ahead → the one it tried is dead → healDeadNext.
 *  - MusicKit's window ran dry (the song ended inside GROW_DELAY_MS, before the grow) →
 *    nothing is dead; advance the model and re-window.
 * A true queue end (model has nothing upcoming) is maybeFinishQueue's, not ours.
 */
let endHealing = false;
function onEndedWithoutItem(): void {
  const m = music;
  const S = window.MusicKit?.PlaybackStates;
  if (!m || !S || endHealing || loadingContext || isLoading || mode !== "queue") return;
  const st = m.playbackState;
  if ((st !== S.ended && st !== S.completed) || m.nowPlayingItem || !queue.getUpcoming().length) return;
  const items: any[] = m.queue?.items ?? [];
  const np = typeof m.nowPlayingItemIndex === "number" ? m.nowPlayingItemIndex : -1;
  const mkRemaining = np >= 0 ? items.length - np - 1 : 0;
  endHealing = true;
  const run = mkRemaining > 0
    ? healDeadNext(m, `ended: next item did not start (mk ${np}/${items.length})`, false)
    : (async () => {
        diag.log("player:windowDry", { np, mkLen: items.length, up: queue.getUpcoming().length });
        perf.event("windowDry", { np, mkLen: items.length, up: queue.getUpcoming().length });
        if (!queue.advance()) return false;
        await loadFromModel(m);
        return true;
      })();
  run.catch((e) => console.warn("[player] end-of-song heal:", e)).finally(() => {
    endHealing = false;
  });
}

/** MusicKit's own playback error — the auto-advance twin of the skip rejection above. */
function onPlaybackError(e: any): void {
  if (loadingContext || mode !== "queue" || !music) return;
  const msg = String(e?.message ?? e?.error?.message ?? e ?? "");
  diag.warn("player:playbackError", { msg });
  perf.event("playbackError", { msg, keys: e && typeof e === "object" ? Object.keys(e).slice(0, 8) : typeof e });
  if (!isUnavailable(msg)) {
    if (freshSignIn) {
      freshSignIn = false;
      toast({
        kind: "warn",
        text: "Playback failed after sign-in. DeetsMusic needs an Apple Music subscription on this Apple ID.",
        timeout: 8000,
      });
      return;
    }
    onMusicKitTrouble(msg, "playbackError");
    return;
  }
  healDeadNext(music, msg, true).catch((err) => console.warn("[player] dead-next heal:", err));
}

// ── Apple trouble recovery (TOASTS.md §Apple health) ─────────────────────────────
// Failures arrive without bound — every click, every MusicKit dialog, every auto-advance.
// The bounds: Rust caches the health check (60 s) and refetches the developer token at
// most once per 10 min; concurrent failures here share ONE check; a retry after a heal
// happens at most once per RETRY_GAP_MS; MusicKit trouble starts at most one recovery per
// RETRY_GAP_MS however many dialogs it raises. Nothing here loops or schedules itself.

const RETRY_GAP_MS = 30_000;
let lastRetryAt = -Infinity;
let lastTroubleAt = -Infinity;
let recovering: Promise<{ trouble: health.Trouble; healed: boolean }> | null = null;

/** Find the cause (health.check shows its toast) and re-configure MusicKit when the
 *  developer token was swapped. `retry` is true for the first caller only, once per gap. */
async function recoverFromFailure(source: string): Promise<{ trouble: health.Trouble; retry: boolean }> {
  if (recovering) {
    const r = await recovering;
    return { trouble: r.trouble, retry: false };
  }
  recovering = (async () => {
    // MusicKit revoked its own copy of the user token (see restoreAuthorization): giving it
    // back IS the fix, with no Apple call. `healed` here means "worth one retry".
    if (music && !music.isAuthorized && (await restoreAuthorization(source))) {
      return { trouble: "none" as health.Trouble, healed: true };
    }
    const r = await health.check(false, true, source);
    if (r.healed) await syncDeveloperToken();
    return r;
  })();
  try {
    const r = await recovering;
    const retry = r.healed && performance.now() - lastRetryAt > RETRY_GAP_MS;
    if (retry) lastRetryAt = performance.now();
    return { trouble: r.trouble, retry };
  } finally {
    recovering = null;
  }
}

/** MusicKit failed on its own (its alert dialog, or a playback error that is not a dead
 *  song): no native dialog, find the cause, retry the current song once after a heal. */
function onMusicKitTrouble(msg: string, via: string): void {
  diag.warn("player:mkTrouble", { msg, via });
  const now = performance.now();
  if (now - lastTroubleAt < RETRY_GAP_MS) return;
  lastTroubleAt = now;
  // The song and spot this failure stopped, read before any await (the clock is ours).
  const stopped = mode === "queue" ? queue.getCurrent() : undefined;
  const stoppedAt = lastHeardAt;
  void (async () => {
    if (!(await isConnected())) return health.show("signedOut", true, via);
    const r = await recoverFromFailure(via);
    if (r.trouble === "offline" && stopped) {
      resumeAfterReconnect = { entry: stopped, at: stoppedAt };
      diag.log("player:resumeArmed", { at: Math.round(stoppedAt), via });
    }
    if (r.retry && music && mode === "queue" && queue.getCurrent()) {
      try {
        await loadFromModel(music);
        return;
      } catch (e) {
        console.warn("[player] retry after heal:", e);
      }
    }
    if (r.trouble === "none") toast({ kind: "warn", text: "Playback stopped. Try the song again." });
  })();
}

// A network drop stopped the song (MusicKit's audio player destroys itself on a
// loadSegmentError). When Apple health sees the network back — its 5-min recheck, Try
// again, or any other check — pick the song up where it stopped: once, queue mode only,
// and only if nothing has played or changed since (2026-09-14).
let lastHeardAt = 0;
let resumeAfterReconnect: { entry: ReturnType<typeof queue.getCurrent>; at: number } | null = null;
health.onTrouble((t) => {
  if (t !== "none" || !resumeAfterReconnect) return;
  const { entry, at } = resumeAfterReconnect;
  resumeAfterReconnect = null;
  const m = music;
  if (!m || mode !== "queue" || m.isPlaying || queue.getCurrent() !== entry) {
    diag.log("player:resumeSkip", { mode, playing: !!m?.isPlaying, same: queue.getCurrent() === entry });
    return;
  }
  diag.log("player:resumeAfterReconnect", { at: Math.round(at) });
  void loadFromModel(m)
    .then(() => (at > 3 ? m.seekToTime(at) : undefined))
    .catch((e) => console.warn("[player] resume after reconnect:", e));
});

// index.html routes every non-benign MusicKit alert() here; drain what arrived first.
(window as any).__deetsMkAlert = (msg: string) => onMusicKitTrouble(String(msg), "alert");
for (const msg of ((window as any).__deetsMkAlerts ?? []).splice(0)) onMusicKitTrouble(String(msg), "alert");

// Dev-only: the no-subscription hint (DEBUGGING.md §Toasts). `armNoSub` marks a fresh
// sign-in and waits for a real playback error; `noSub` also feeds onPlaybackError a
// synthetic one. Both go through the real guards, so a song must be playing from a queue.
if (import.meta.env.DEV) {
  (window as any).__toast.sim = {
    ...(window as any).__toast.sim,
    armNoSub: noteSignedIn,
    noSub: () => {
      if (loadingContext || mode !== "queue" || !music) {
        console.warn("[toast sim] play a song from a list first — onPlaybackError ignores this state");
        return;
      }
      noteSignedIn();
      onPlaybackError(new Error("sim: playback failed (no subscription)"));
    },
  };
}

/** Restart the song if we're past the intro, otherwise skip back. */
export async function prevTrack(): Promise<void> {
  if (roomBridge) return roomBridge.previous();
  playIntent();
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
  if (roomBridge) return roomBridge.seekSeconds(clamped * duration);
  await music.seekToTime(clamped * duration);
}

/** Seek to an absolute position in seconds (the OS media session scrubs in seconds). */
export async function seekToSeconds(seconds: number): Promise<void> {
  if (roomBridge) return roomBridge.seekSeconds(seconds);
  if (!music) return;
  const duration = music.currentPlaybackDuration ?? 0;
  if (duration <= 0) return;
  await music.seekToTime(Math.max(0, Math.min(duration, seconds)));
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
const volumeListeners = new Set<() => void>();
/** Fires after any level/mute change, whoever made it (pill, stage row, tray, agent). */
export function onVolumeChange(cb: () => void): () => void {
  volumeListeners.add(cb);
  return () => volumeListeners.delete(cb);
}

// AirPlay takeover (AIRPLAY.md decision 4): while a speaker plays, the app's one
// slider drives the SPEAKER's volume. MusicKit's own gain pins to 100 % (the
// speaker applies its gain to the stream), every slider change goes to the sink,
// nothing persists, and the app level from before comes back on release.
let volumeSink: ((v: number) => void) | null = null;
let levelBeforeSink: { level: number; muted: boolean } | null = null;

/** Hand the slider to a speaker (`initial` = the speaker's current 0..1), or `null` to take it back. */
export function setVolumeSink(sink: ((v: number) => void) | null, initial?: number): void {
  if (sink) {
    if (!volumeSink) levelBeforeSink = { level, muted };
    volumeSink = sink;
    if (initial !== undefined) {
      level = Math.max(0, Math.min(1, initial));
      muted = level === 0;
    }
  } else {
    volumeSink = null;
    if (levelBeforeSink) {
      ({ level, muted } = levelBeforeSink);
      levelBeforeSink = null;
    }
  }
  applyVolumeToMusic();
}

/** The speaker moved on its own (Siri, its touch surface): show it, send nothing. */
export function reflectExternalVolume(v: number): void {
  if (!volumeSink) return;
  const next = Math.max(0, Math.min(1, v));
  if (Math.abs(next - (muted ? 0 : level * duck)) < 0.01) return; // the echo of our own write
  if (duck < 0.05) return; // the wind-down's last seconds: nothing to read back from
  level = Math.min(1, next / duck); // the speaker moved under a wind-down: keep the set level's frame
  muted = level === 0;
  if (level > 0) preMuteLevel = level;
  applyVolumeToMusic();
}

// The sleep timer's wind-down (NEXT-VERSION §17, sleep.ts): a gain factor multiplied into
// the level on its way out. The stored level never moves — `setVolume` persists on every
// call, so a fade through it would write the user's level down to 0. The factor snaps back
// to 1 after the pause, so the next Play is at the set level.
let duck = 1;

function applyVolumeToMusic(): void {
  volumeListeners.forEach((cb) => cb());
  if (!music) return;
  try {
    music.volume = volumeSink ? 1 : muted ? 0 : level * duck;
  } catch (e) {
    console.warn("[player] volume not settable:", e);
  }
}

/** The wind-down's gain factor (0..1). Sent to a speaker too, so the caller keeps it to
 *  about one write a second while AirPlay holds the volume. */
export function setDuck(f: number): void {
  const next = Math.max(0, Math.min(1, f));
  if (next === duck) return;
  duck = next;
  applyVolumeToMusic();
  if (volumeSink) volumeSink(muted ? 0 : level * duck);
}

export function getDuck(): number {
  return duck;
}

// ── Stream quality ───────────────────────────────────────────────────────────
//
// MusicKit picks its bitrate ONCE, in configure(), from Chromium's network estimate
// (`navigator.connection.downlink` × 100 > 64 → HIGH 256 kbps, else STANDARD 64), and never
// looks again: a low estimate at start kept the whole session at 64 kbps. `music.bitrate` is a
// plain setter that MusicKit reads when it prepares each song, so a write here changes the next
// song and never reloads the one playing (AUDIO-QUALITY.md §4.1). No Apple calls.
//
// Settings › Playback › Stream quality: High / Low pin it. Auto follows the same estimate
// live — Chromium keeps it up to date anyway; we only listen for its `change` event. Two
// thresholds with a gap between them, so an estimate near one line does not flip it each song.

const AUTO_LOW_BELOW_MBPS = 0.5;
const AUTO_HIGH_ABOVE_MBPS = 1;

function networkDownlink(): number | undefined {
  const d = (navigator as any).connection?.downlink;
  return typeof d === "number" ? d : undefined;
}

function applyStreamQuality(reason: "configure" | "reconfigure" | "setting" | "network"): void {
  const B = window.MusicKit?.PlaybackBitrate;
  if (!music || !B) return;
  const choice = setting("streamQuality");
  const from: number = music.bitrate;
  const downlink = networkDownlink();
  let to = from;
  if (choice === "high") to = B.HIGH;
  else if (choice === "low") to = B.STANDARD;
  else if (downlink !== undefined && downlink < AUTO_LOW_BELOW_MBPS) to = B.STANDARD;
  else if (downlink !== undefined && downlink > AUTO_HIGH_ABOVE_MBPS) to = B.HIGH;
  else if (to !== B.HIGH && to !== B.STANDARD) to = B.HIGH; // no pick and no estimate: the better stream
  if (to !== from) music.bitrate = to;
  // Arm (configure) always logs; a later check logs only when it switched.
  if (to !== from || reason === "configure" || reason === "reconfigure") {
    diag.log("player:bitrate", { reason, choice, kbps: to, from, downlink });
  }
}

(navigator as any).connection?.addEventListener?.("change", () => {
  if (setting("streamQuality") === "auto") applyStreamQuality("network");
});
onSettingsChange((k) => {
  if (k === "streamQuality") applyStreamQuality("setting");
});

/** The gain MusicKit applies to the audio right now (0..1), before the Sound graph: 1 while a
 *  speaker holds the volume. sound.ts reads it to know how far below full scale a song arrives. */
export function getAppliedGain(): number {
  return volumeSink ? 1 : muted ? 0 : level * duck;
}

/** Pause, if anything plays. No sign-in check: pausing never needs one. */
export async function pausePlayback(why = "sleep"): Promise<void> {
  if (!music?.isPlaying) return;
  notePause(why);
  await music.pause();
}

/** Whether MusicKit is playing right now (the state broadcast's `playing`, read live). */
export function isPlayingNow(): boolean {
  return !!music?.isPlaying;
}

function persistVolume(): void {
  if (volumeSink) {
    volumeSink(muted ? 0 : level * duck); // the speaker's volume is the speaker's to keep
    return;
  }
  try {
    localStorage.setItem(VOLUME_KEY, String(level));
    localStorage.setItem(MUTE_KEY, String(muted));
  } catch {
    /* storage disabled — still applies for the session */
  }
}

/** Effective output level (0..1) — 0 while muted, sinking during a wind-down. Drives the
 *  pill + slider UI, so the fade shows. */
export function getVolume(): number {
  return muted ? 0 : level * duck;
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
