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
import { trackById, tracks, addTransientTracks, inLibrary, healedId, noCatalogCopy, refreshHeals } from "./track-store";
import { coverArtPx } from "./queue-rows";
import { materializeTrack } from "./search";
import { recordStationPlay, type Station } from "./radio";
import * as diag from "./diag";
import { installLicenseWatch, licenseTrace, inFlightNow } from "./license-watch";
import { errorFields, compactEvent } from "./license-reply";
import { cancelled } from "./rules";
import { outputKind } from "./sound";
import { netNote } from "./net-feed";
import { nearSongEnd, isSongEnd, stallCanHappen, silentStartStep, midStallArms, midStallStep, resumeSpot, licenseStep, isLicenseError, LICENSE_BACK_S, MID_STALL_MS, endStallArms, endStallStep } from "./pause-rules";
import { roomDriftTick } from "./room";
import * as stats from "./stats";
import * as perf from "./perf";
import { toast } from "./toast";
import { unreleasedToast } from "./release";
import { expectedIds, suffixPlan, repairAtSongChange, headPart, tailPart, skipToSameId, nextFed } from "./queue-sync";
import { matchOf, onSuggestChange } from "./suggest";
import { resumePoint } from "./resume-point";
import { idleSkip } from "./idle-skip";
import { launchMark } from "./launch-perf";
import { WEB_ROOMS } from "./platform";
import { watchSet } from "./page-counts";

declare global {
  interface Window {
    MusicKit: any;
    /** The configured MusicKit instance, for the console and bug reports (as opaque as MusicKit). */
    __music?: any;
    /** The console handle: player + model state, and the queue side by side (DEBUGGING.md). */
    __player?: { snap: typeof snap; queue: typeof queueDump };
    /** Shared with index.html's inline script: the MusicKit script failed to load. */
    __musicKitFailed?: boolean;
    /** Shared with index.html: it routes a MusicKit alert() here, and holds the early ones. */
    __deetsMkAlert?: (msg: string) => void;
    __deetsMkAlerts?: string[];
  }
  interface DeetsToastSim {
    armNoSub?: () => void;
    noSub?: () => void;
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
  // A station skip's hush ends with the station (SUGGEST-LESS.md §5b): the next song is ours.
  suggestSkipping = null;
  if (hushReasons.has("suggest")) hush("suggest", false);
}

/**
 * A station's "Add to Queue" (Radio / Search right-click, 2026-09-15): a station is a
 * stream, so it cannot sit among the songs — it plays once the finite queue runs dry,
 * the same return path a break-out uses (maybeResumeStation). With nothing to wait for
 * (idle, or already on a station) it simply starts now.
 */
export function queueStationAfter(s: Station): Promise<void> {
  if (roomBridge && !roomBridge.station(s)) return Promise.resolve();
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
// <script>, and its error listener sets `__musicKitFailed` (a listener, since CSP.md §4). `musickitloaded` then never fires,
// initPlayer waits forever, and every click did nothing. Load it again when Windows
// reports the network back, every MUSICKIT_RETRY_MS, and on a play click; the click
// itself shows the offline toast (his call: tell, do not replay the click).
const MUSICKIT_SRC = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
const MUSICKIT_RETRY_MS = 30_000;
const NO_MUSICKIT = "MusicKit did not load";
let musicKitRetries = 0;

const musicKitMissing = (): boolean => !window.MusicKit && !!window.__musicKitFailed;

function reloadMusicKit(why: string): void {
  if (!musicKitMissing()) return; // loaded, or the last try is still in flight
  window.__musicKitFailed = false;
  diag.warn("player:musicKitRetry", { why, n: ++musicKitRetries });
  const s = document.createElement("script");
  s.src = MUSICKIT_SRC;
  s.async = true;
  s.onerror = () => (window.__musicKitFailed = true);
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
  installLicenseWatch(); // before MusicKit's first license request
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
    window.__music = music; // introspect the opaque instance (dev + bug reports)
    window.__player = { snap, queue: queueDump };
    diag.log("player:configured", { authorized: !!music.isAuthorized });
    launchMark("configured");
    console.log("[player] configured — authorized:", music.isAuthorized);
    return music;
  })();
  // No developer token yet (an offline first run, main.ts) fails BEFORE configure: forget the
  // failed start, so the next call configures once the token arrives — no restart
  // (2026-09-29). A failure after configure keeps the promise: its events are already wired.
  const mine = initPromise;
  mine.catch(() => {
    if (initPromise === mine && !configuredToken) {
      initPromise = null;
      diag.warn("player:configureRetryable");
    }
  });
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
  installLicenseWatch();
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
    launchMark("warm");
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
  // A browser signs in with MusicKit's own authorize() (web/listen.ts), and MusicKit keeps
  // that token itself: there is nothing to put in (WebRooms.md §9.3 D).
  if (WEB_ROOMS) return;
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
watchSet("player.state", listeners); // the page sample reads these sizes (page-counts.ts)

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

const transportSubs = new Set<(way: "next" | "prev") => void>();
/** Fires when a press asks for Next or Previous (the Now Playing card, the Compass, a media key,
 *  the agent), before the player acts. Rulez's "You skip ahead" / "You go back" (RULES.md §20). */
export function onTransport(cb: (way: "next" | "prev") => void): () => void {
  transportSubs.add(cb);
  return () => transportSubs.delete(cb);
}
const transport = (way: "next" | "prev") => transportSubs.forEach((cb) => cb(way));

/** What MusicKit knows of the song playing now (a catalog song may not be in the library). */
export function nowPlayingMeta(): { genres?: string[]; year?: number; explicit?: boolean } {
  const a = music?.nowPlayingItem?.attributes;
  if (!a) return {};
  const year = typeof a.releaseDate === "string" ? Number(a.releaseDate.slice(0, 4)) || undefined : undefined;
  return { genres: Array.isArray(a.genreNames) ? a.genreNames : undefined, year, explicit: a.contentRating === "explicit" };
}

export interface PlayerProgress {
  progress: number; // 0..1
  currentTime: number; // seconds
  duration: number; // seconds
}

type ProgressListener = (p: PlayerProgress) => void;
const progressListeners = new Set<ProgressListener>();
watchSet("player.progress", progressListeners);

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
  // MusicKit's clock resets when its player dies. A heal's hushed start before the seek is not
  // a spot the user heard: a second failure there must still know the real one.
  const holdAt = heldSpot();
  if (currentTime > 0 && (holdAt === null || currentTime >= holdAt - 1)) lastHeardAt = currentTime;
  if (!isLoading && currentTime > HEARD_S) {
    const cur = queue.getCurrent();
    const npId: string | undefined = music?.nowPlayingItem?.id;
    if (cur && npId && isEntry(cur, npId)) {
      heardEntry = cur;
      heardAt = performance.now();
    }
  }
  // While a (re)window loads, the outgoing song still ticks through the teardown. The
  // scrubber already shows the incoming song at 0 (emitLoadingProgress, UX-COVERUPS.md §1);
  // an old-song tick here would drag it back under the new title.
  // A heal hold keeps the scrubber at the spot: the hushed play from 0:00 before the seek is
  // not shown, and the first tick at the spot ends the hold.
  const held = heldSpot();
  if (held !== null) {
    if (isLoading || !music?.isPlaying || currentTime < held - 1) return;
    releaseHold("playing");
  }
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
  const held = heldSpot();
  const currentTime = held !== null ? Math.min(held, duration) : resumeAt?.id === id ? Math.min(resumeAt.sec, duration) : 0;
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
/** The song's length, in seconds (0 before MusicKit knows it). */
export function songDuration(): number {
  return music?.currentPlaybackDuration || 0;
}

// The update restart's saved position (queue-persist.ts): applied once, by the first Play of
// the restored song (playPause), and only while that song is still the model's current.
let resumeAt: { sec: number; id: string } | null = null;
export function setResumeAt(sec: number, id: string): void {
  resumeAt = { sec, id };
}

// ── The heal hold (2026-10-18, his call; QUEUE.md §License heal) ──────────────────
// While a license heal reloads the song, Now Playing (and the tray, the media keys' overlay,
// Discord) keep showing it as playing at the spot where it stopped: no paused flash, no
// scrubber jump to 0:00 and back. The hold ends when the song plays at the spot again, when
// the heal gives up or is skipped, on any transport press, or after HOLD_MAX_MS whatever fails.
let heal: { entry: unknown; at: number; timer: number } | null = null;
const HOLD_MAX_MS = 12_000;

function holdForHeal(entry: unknown, at: number): void {
  if (heal) window.clearTimeout(heal.timer);
  heal = { entry, at, timer: window.setTimeout(() => releaseHold("cap"), HOLD_MAX_MS) };
  diag.log("player:healHold", { on: true, at: Math.round(at) });
}

function releaseHold(why: string): void {
  if (!heal) return;
  window.clearTimeout(heal.timer);
  heal = null;
  diag.log("player:healHold", { on: false, why });
  emit();
}

/** The hold, when it covers the model's current song. */
function heldSpot(): number | null {
  return heal && mode === "queue" && heal.entry === queue.getCurrent() ? heal.at : null;
}

function emit(): void {
  const item = music?.nowPlayingItem;
  const held = heldSpot() !== null;
  const s: PlayerState = {
    playing: held || !!music?.isPlaying,
    title: item?.title ?? item?.attributes?.name,
    artist: item?.artistName ?? item?.attributes?.artistName,
    album: item?.albumName ?? item?.attributes?.albumName,
    artworkUrl: artworkUrlOf(item, coverArtPx()),
    loading: isLoading && !held,
    station:
      mode === "radio" && radioStation
        ? stationInfo(radioStation)
        : mode === "room" && roomStationRow
          ? stationInfo(roomStationRow)
          : undefined,
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
  if (k === "suggestSkipQueue") suggestRewindow();
});
// A mark made or taken off: MusicKit's window follows at once, gaplessly (the current song
// never moves). The Queue card greys or ungreys its rows from the same change.
onSuggestChange(() => suggestRewindow());
function suggestRewindow(): void {
  if (mode !== "queue" || !music?.nowPlayingItem || loadingContext) return;
  void ensureAligned("suggest").catch((e) => console.warn("[player] suggest re-window:", e));
}

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
  // A cancel event (RULEZ.md §4, route 7): a rule with Keep leaves the station off.
  if (cancelled("station.return", { card: "*" })) {
    diag.log("player:resumeStation", { id: s.id, kept: "rule" });
    return;
  }
  diag.log("player:resumeStation", { id: s.id });
  playStation(s).catch((e) => console.warn("[player] resume station:", e));
}

/**
 * Queue end: when MusicKit finishes the last song, it reports no now-playing index, so
 * model-follow (syncModelToMusicKit) bails and the finished song stayed `current` — the
 * Qcard kept showing it under "Not playing". Move it to the heard trail instead. Only when
 * the model has nothing upcoming: a window that ran out early is a top-up problem, not an end.
 */
/** Does Up Next hold a row MusicKit is fed? Rows Suggest Less skips do not count. */
const hasFedUpcoming = (): boolean => queue.getUpcoming().some((h) => !!feedId(h));
/** The list ended with only skipped rows after it: they go, and the toast names them. */
function dropSkippedTail(): void {
  const up = queue.getUpcoming();
  if (!up.length) return;
  noteSuggestSkips(up.filter(suggestSkipped), "queue", "end");
  for (let i = up.length - 1; i >= 0; i--) queue.removeAt(i);
}

function maybeFinishQueue(): void {
  if (!music || mode !== "queue" || loadingContext || isLoading) return;
  const S = window.MusicKit?.PlaybackStates;
  const st = music.playbackState;
  const finished = !!S && (st === S.completed || st === S.ended);
  if (!finished || music.nowPlayingItem || hasFedUpcoming() || !queue.getCurrent()) return;
  // Only rows Suggest Less steps over are left: they were passed over, so the list has ended.
  dropSkippedTail();
  // Repeat (NEXT-VERSION §12d): ALL refills Up Next with the whole list and plays on — one
  // buffering gap per lap (no pre-wrap: a list shorter than the window would dedup away).
  // ONE normally never gets here (MusicKit loops the song itself); if a build ignores
  // `repeatMode`, replay the current song from the model instead.
  const r = getRepeat();
  if (r === "all" && queue.refillFromPlan(isShuffleOn())) {
    diag.log("player:repeatLap", snap());
    queue.advance();
    // `stopFirst`: MusicKit sits in `ended` here, the state the dead-next heal needed a full
    // stop() for (a song fed from `ended` played with no index and then played twice).
    loadFromModel(music, true, { stopFirst: true }).catch((e) => console.warn("[player] repeat lap:", e));
    return;
  }
  if (r === "one") {
    diag.log("player:repeatOne", snap());
    loadFromModel(music, true, { stopFirst: true }).catch((e) => console.warn("[player] repeat one:", e));
    return;
  }
  diag.log("player:queueEnd", snap());
  songChangeSeen();
  const last = queue.getCurrent();
  const list = finishedList(last);
  queue.advance();
  afterListEnd(last, list);
}

// ── The end of a list (QUEUE.md §The end of a list, 2026-09-29) ────────────────────
// A list that plays out with Repeat off no longer leaves the model empty: Play then started
// the whole library from "A" (playPause's last branch). The finished list is loaded again at
// its first song, PAUSED (a record that has ended), and — with Settings › Playback ›
// "Play a web when a list ends" on (`listEndWeb`) — the end hook (web.ts) builds a temporary
// web from it and plays that. Never after a station break-out (the station returns) or in a
// room: maybeFinishQueue runs only in queue mode, and resumeStation is checked here.

/** What a finished list hands the end hook. */
export interface ListEnd {
  /** The song that just ended. */
  last: TrackHandle;
  /** The finished list, in list order. */
  list: TrackHandle[];
  /** True while nothing has changed since the end: the paused list is still Now Playing,
   *  nothing plays or loads. The hook plays its web only then (a Play in the meantime wins). */
  stillIdle: () => boolean;
}
type ListEndHook = (e: ListEnd) => Promise<boolean>;
let listEndHook: ListEndHook | null = null;
/** web.ts registers the web builder here (player.ts cannot import web.ts: web.ts imports it). */
export function onListEnd(fn: ListEndHook): void {
  listEndHook = fn;
}

/** The list that just finished: the context's plan, or after a restart (no plan) the heard
 *  songs that share the last song's context, oldest first. */
function finishedList(last: TrackHandle | null): TrackHandle[] {
  const plan = queue.getPlan();
  if (plan.length) return plan.slice();
  if (!last) return [];
  const ctx = last.context;
  const same = queue.getHistory().filter((e) => e.played && e.context === ctx);
  const seen = new Set<string>();
  const out: TrackHandle[] = [];
  for (const e of [...same, last]) {
    const id = e.catalogId ?? e.libraryId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ catalogId: e.catalogId, libraryId: e.libraryId, context: e.context });
  }
  return out;
}

/** True from the end of a list until its paused reload is fed: MusicKit still sits in `ended`
 *  with no song while the model has Up Next again, the exact shape onEndedWithoutItem heals. */
let cueingListEnd = false;

function afterListEnd(last: TrackHandle | null, list: TrackHandle[]): void {
  if (!music || !last || !list.length || resumeStation || roomBridge || mode !== "queue") return;
  const m = music;
  // The finished list at its first song, paused. Fed to MusicKit now (as Stop Station does),
  // so MusicKit holds a song again: the end-of-song heal (onEndedWithoutItem) never mistakes
  // the new Up Next for a failed advance, and Play or an Add to Queue take the normal path.
  cueingListEnd = true;
  queue.setContext(list, 0, isShuffleOn());
  const web = setting("listEndWeb") && !!listEndHook;
  diag.log("player:listEnd", { n: list.length, ctx: last.context ?? null, web });
  void (async () => {
    try {
      await loadFromModel(m, false, { stopFirst: true });
    } catch (e) {
      console.warn("[player] list end reload:", e);
    } finally {
      cueingListEnd = false;
    }
    if (!web || !listEndHook) return;
    const cued = queue.getCurrent();
    const gen = loadGen;
    const stillIdle = (): boolean =>
      mode === "queue" && !roomBridge && !resumeStation && !isLoading && loadGen === gen && queue.getCurrent() === cued && !music?.isPlaying;
    const played = await listEndHook({ last, list, stillIdle }).catch((e) => {
      console.warn("[player] list end web:", e);
      return false;
    });
    if (!played) diag.log("player:listEnd", { web: "none", idle: stillIdle() });
  })();
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
      netNote({ kind: "stall", s: (performance.now() - stall.since) / 1000 });
      diag.log("player:stall-end", { s: Math.round((performance.now() - stall.since) / 1000), after: stall.after });
      stall = null;
    }
    endMidStall("played");
    endEndStall("played");
  }
  const buffering = st === S.waiting || st === S.stalled;
  const shape = {
    wasPlaying,
    buffering,
    loading: isLoading || loadingContext || endHealing,
    at: music.currentPlaybackTime ?? 0,
    duration: music.currentPlaybackDuration ?? 0,
  };
  if (!midStall && midStallArms(shape)) armMidStall();
  if (!endStall && mode === "queue" && endStallArms({ ...shape, upcoming: queue.getUpcoming().length })) armEndStall();
  if (st !== S.waiting && st !== S.loading) wasPlaying = playing;
}

// ── A song that stops loading in the middle (2026-10-03, QUEUE.md §Mid-song stall) ──
// On live, "Sepulveda" went from playing to `waiting` 30 s in, with no error, and stayed
// there; the pause lines above skip `waiting`, so nothing logged it and nothing reloaded it.
// Now a buffer in the middle of a playing song arms one check MID_STALL_MS later. Still
// buffering then → in the queue, reload the song STALL_BACK_S before the stop; in a station
// or a room, log only. The rule is pure (midStallStep, pause-rules.ts). A second stall of the
// same song right after its reload is not reloaded again: the toast says so.
let midStall: { id: string | null; entry: unknown; at: number; since: number; gen: number; timer: number } | null = null;
/** The song the last stall reload was for, and when: a second stall soon after gives up. */
let midStallReloaded: { entry: unknown; at: number } | null = null;
const MID_STALL_AGAIN_MS = 30_000;

function armMidStall(): void {
  const m = music;
  if (!m) return;
  midStall = {
    id: m.nowPlayingItem?.id ?? null,
    entry: mode === "queue" ? queue.getCurrent() : null,
    at: m.currentPlaybackTime ?? 0,
    since: performance.now(),
    gen: loadGen,
    timer: window.setTimeout(checkMidStall, MID_STALL_MS),
  };
}

/** The stall is over; one `player:buffer` line says how, when it lasted a second or more
 *  (a seek's short buffer is left out). */
function endMidStall(end: string): void {
  const s = midStall;
  if (!s) return;
  window.clearTimeout(s.timer);
  midStall = null;
  const secs = (performance.now() - s.since) / 1000;
  if (secs >= 1 || end !== "played") diag.log("player:buffer", { id: s.id, at: Math.round(s.at), s: Math.round(secs), end, mode });
  if (secs >= 1) netNote({ kind: "stall", s: secs }); // a seek's short buffer is not a stall
}

function checkMidStall(): void {
  const s = midStall;
  const m = music;
  const S = window.MusicKit?.PlaybackStates;
  if (!s || !m || !S) return;
  const st = m.playbackState;
  const step = midStallStep({
    playing: !!m.isPlaying,
    userPaused: lastUserPauseAt > s.since,
    // A load, a heal or a Play check in flight owns the music now (watchForSound reloads it).
    sameSong: (m.nowPlayingItem?.id ?? null) === s.id && loadGen === s.gen && !isLoading && !endHealing && !silentArmed
      && (mode !== "queue" || queue.getCurrent() === s.entry),
    buffering: st === S.waiting || st === S.stalled || st === S.loading,
    canReload: mode === "queue" && !roomBridge && !!s.entry,
  });
  if (step === "fine") return endMidStall("moved on");
  endMidStall(step === "reload" ? "reload" : "left");
  if (step !== "reload") return;
  const last = midStallReloaded;
  const again = !!last && last.entry === s.entry && performance.now() - last.at < MID_STALL_AGAIN_MS;
  if (again) {
    midStallReloaded = null;
    diag.warn("player:midStallGaveUp", { id: s.id, at: Math.round(s.at) });
    toast({ kind: "warn", text: "Playback stopped. Try the song again." });
    return;
  }
  midStallReloaded = { entry: s.entry, at: performance.now() };
  diag.warn("player:midStall", { id: s.id, at: Math.round(s.at), s: Math.round((performance.now() - s.since) / 1000), state: S[st] ?? st, output: outputKind() });
  recoverLoad(m, "midStall", resumeSpot(s.at)).catch((e) => console.warn("[player] stall reload:", e));
}

// ── A song that sticks at its end (2026-10-18, QUEUE.md §End stall) ──────────────────
// The song buffers in its last 2 s with a song queued after it. On the dev app this was
// reproduced by holding the next song's license request: MusicKit asks for it ~15 s early and
// waits for it at the end, with no error. END_STALL_LOG_MS on: one `player:endStall` line with
// what is still out (the lookup, the license, the audio), the license events and MusicKit's
// queue, so the cause has a name. Its end is logged too: how long, and how it got out.
// END_STALL_HEAL_MS on (his call, 2026-10-18: "reload the next song after 8 s when an end stall
// has nothing out"): with no license or lookup still out, the model moves to the next song and
// it is loaded fresh (`player:endStallHeal`), the way his Next press got out of it on live. With
// one out, nothing is done (`player:endStallWait`): a reload waits for that request too
// (`m.stop()` does), and license-watch.ts cuts a hung license at 5 s.
let endStall: { id: string | null; since: number; timer: number; healTimer: number; logged: boolean } | null = null;
const END_STALL_LOG_MS = 3000;
const END_STALL_HEAL_MS = 8000;

function armEndStall(): void {
  const m = music;
  if (!m) return;
  endStall = {
    id: m.nowPlayingItem?.id ?? null,
    since: performance.now(),
    timer: window.setTimeout(checkEndStall, END_STALL_LOG_MS),
    healTimer: window.setTimeout(healEndStall, END_STALL_HEAL_MS),
    logged: false,
  };
}

/** Still stuck: the same song, not playing, still buffering. */
function endStallHolds(s: NonNullable<typeof endStall>): boolean {
  const m = music;
  const S = window.MusicKit?.PlaybackStates;
  if (!m || !S) return false;
  const st = m.playbackState;
  return !m.isPlaying && (m.nowPlayingItem?.id ?? null) === s.id && (st === S.waiting || st === S.stalled);
}

function healEndStall(): void {
  const s = endStall;
  const m = music;
  if (!s || !m) return;
  const out = inFlightNow().filter((r) => r.kind === "license" || r.kind === "lookup");
  const step = endStallStep({
    holds: endStallHolds(s),
    requestOut: out.length > 0,
    userPaused: lastUserPauseAt > s.since,
    canReload: mode === "queue" && !roomBridge && !endHealing && !isLoading && !loadingContext,
  });
  if (step === "fine") return endEndStall("moved on");
  if (step === "wait") return diag.log("player:endStallWait", { id: s.id, out: out.map((r) => `${r.kind} ${r.ageMs}ms`) });
  if (step === "leave") return;
  diag.warn("player:endStallHeal", { id: s.id, s: Math.round((performance.now() - s.since) / 1000), next: playId(queue.getUpcoming()[0] ?? {}) ?? null });
  endEndStall("heal");
  endHealing = true;
  (async () => {
    if (!jumpToNextFed("endStall")) return;
    await recoverLoad(m, "endStall");
  })()
    .catch((e) => console.warn("[player] end stall heal:", e))
    .finally(() => {
      endHealing = false;
    });
}

function endEndStall(how: string): void {
  const s = endStall;
  if (!s) return;
  window.clearTimeout(s.timer);
  window.clearTimeout(s.healTimer);
  endStall = null;
  if (s.logged) diag.warn("player:endStallEnd", { id: s.id, s: Math.round((performance.now() - s.since) / 1000), how });
}

function checkEndStall(): void {
  const s = endStall;
  const m = music;
  const S = window.MusicKit?.PlaybackStates;
  if (!s || !m || !S) return;
  const st = m.playbackState;
  if (!endStallHolds(s)) return endEndStall("moved on");
  s.logged = true;
  const now = performance.now();
  const items: any[] = m.queue?.items ?? [];
  const np = typeof m.nowPlayingItemIndex === "number" ? m.nowPlayingItemIndex : -1;
  const els = [...document.querySelectorAll("audio")].map((a) => {
    const b = a.buffered;
    const ahead = b.length ? b.end(b.length - 1) - a.currentTime : 0;
    return `${a.paused ? "p" : "P"}r${a.readyState}n${a.networkState}+${ahead.toFixed(1)}s`;
  });
  diag.warn("player:endStall", {
    id: s.id,
    s: Math.round((now - s.since) / 1000),
    state: S[st] ?? st,
    mk: `${np}/${items.length}`,
    mkNext: items[np + 1]?.id ?? null,
    next: playId(queue.getUpcoming()[0] ?? {}) ?? null,
    out: inFlightNow().map((r) => `${r.kind} ${r.ageMs}ms`),
    trace: licenseTrace()
      .slice(-4)
      .map((e) => compactEvent(now - e.t, e)),
    els,
    output: outputKind(),
    online: navigator.onLine,
  });
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
  endEndStall("songChange");
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
          loadFromModel(m, true, { stopFirst: true })
            .then(() => checkBreakout(m))
            .catch((e) => {
              loadingContext = false; // never leave follow wedged if the load bailed
              console.warn("[player] breakout load:", e);
            });
        }, 0);
      } else {
        pendingBreakout = false; // an emptied block (rows removed) — stay in radio
        // Suggest Less (SUGGEST-LESS.md §5b): a marked song is skipped before it is followed,
        // so it never reaches History, the play counts or Last.fm.
        if (!stationSuggestSkip()) {
          stationFollow();
          diag.log("player:np", snap());
        }
      }
    } else if (mode === "room") {
      // The room wrote the model already (room.ts); only count the play.
      stats.recordStart(queue.getCurrent());
      diag.log("player:npRoom", snap());
    } else {
      // Read before the follow: a song change while music was meant to play must reach sound.
      const meantToPlay = !!music?.isPlaying || wasPlaying || silentArmed;
      const short = syncModelToMusicKit();
      diag.log("player:np", snap());
      if (meantToPlay) watchForSound("songChange");
      // The model is the master: MusicKit started a song the model did not expect → re-window
      // onto the model's song. That load records the start and grows the window itself.
      if (correctDrift(short)) {
        emit();
        return;
      }
      stats.recordStart(queue.getCurrent()); // a settled song-start counts as a partial play
      void ensureAligned("np", true);
      maybeTopUpWindow();
    }
  }
  emit();
}

/**
 * The break-out load can lose to the station: MusicKit's next station song is already
 * loading when the break-out starts, and it can stay the now-playing item after our
 * stop + setQueue + play (2026-10-06: "Better Days" queued, "LOVE UR NAME" played, and the
 * model named Better Days). No song change fires after that, so `correctDrift` never runs.
 * The model is the master: compare once the load settles, and load the model's song again
 * once. A second miss is logged, never looped.
 */
async function checkBreakout(m: any, again = false): Promise<void> {
  const cur = queue.getCurrent();
  const npId: string | undefined = m?.nowPlayingItem?.id;
  if (!cur || mode !== "queue" || (npId && isEntry(cur, npId))) return;
  const data = { npId: npId ?? null, want: playId(cur) ?? null, again };
  if (again) {
    diag.warn("player:breakoutGaveUp", data);
    return;
  }
  diag.warn("player:breakoutMiss", data);
  perf.event("breakoutMiss", data);
  await loadFromModel(m, true, { stopFirst: true });
  await checkBreakout(m, true);
}

// ── Suggest Less on a station (SUGGEST-LESS.md §5b; Settings › Playback › Skip on stations) ──
// MusicKit owns a station's future, so the app first sees a song at `nowPlayingItemDidChange`.
// A song that matches a mark (song, album or artist) is hushed at once (MusicKit's gain to 0,
// which silences a speaker's stream too) and skipped; the hush ends when a song that does not
// match arrives, or at its cap. A live station has no skip and is never touched.
const SUGGEST_HUSH_MAX_MS = 8000;
/** The marked station song being skipped now: a repeated change event for it is ignored. */
let suggestSkipping: string | null = null;
/** Dev telemetry: the arrival of the song being skipped, for `[perf] suggest station`. */
let suggestNpAt = 0;
let suggestSkipAt = 0;

function stationSuggestSkip(): boolean {
  const item = music?.nowPlayingItem;
  const id: string | undefined = item?.id;
  const ends = () => {
    if (!hushReasons.has("suggest")) return;
    hush("suggest", false);
    suggestTimeLine(id);
  };
  if (!item || !id || id.startsWith("ra.")) return false; // the station container: wait for its song
  if (!setting("suggestSkipStations") || !radioStation || radioStation.isLive) {
    ends();
    return false;
  }
  if (id === suggestSkipping) return true; // the same song's second event
  const a = item.attributes ?? {};
  const song = {
    catalogId: id,
    title: item.title ?? a.name ?? "",
    artistName: item.artistName ?? a.artistName ?? "",
    albumName: item.albumName ?? a.albumName,
  };
  const match = matchOf(song);
  if (!match) {
    suggestSkipping = null;
    ends();
    return false;
  }
  hush("suggest", true, SUGGEST_HUSH_MAX_MS);
  suggestSkipping = id;
  suggestNpAt = performance.now();
  songChangeSeen();
  const station = radioStation;
  const t: Track = { ...song, genres: [], hasLyrics: false };
  addTransientTracks([t]); // the toast and its Undo name the song
  noteSuggestSkips([{ catalogId: id }], "station", match, () => {
    // Undo: a break-out with the song, and the station comes back after it.
    void playTracks([t], 0, "suggest")
      .then(() => queueStationAfter(station))
      .catch((e) => console.warn("[player] suggest station undo:", e));
  });
  suggestSkipAt = performance.now();
  void Promise.resolve(music?.skipToNextItem?.()).catch((e: unknown) => {
    // A refused skip (Apple may limit them, §5b): the song plays, with sound.
    diag.warn("suggest:skipRefused", { id, msg: String((e as Error)?.message ?? e) });
    suggestSkipping = null;
    hush("suggest", false);
  });
  return true;
}

/** `[perf] suggest station` (dev only, §7): the arrival of the skipped song → our skip call →
 *  the next song's arrival. No sound was heard when the hush covered all of it. */
function suggestTimeLine(nextId: string | undefined): void {
  const now = performance.now();
  perf.event("suggest station", { npMs: 0, skipMs: Math.round(suggestSkipAt - suggestNpAt), silentMs: Math.round(now - suggestNpAt), next: nextId ?? null });
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
  if (!music || mode !== "queue") return; // stations refill themselves; a room feeds one song
  const items: any[] = music.queue?.items ?? [];
  const np = typeof music.nowPlayingItemIndex === "number" ? music.nowPlayingItemIndex : -1;
  // The two exits that are NOT "nothing to add" are logged: a top-up that never happens is
  // otherwise invisible until the song ends on a one-song queue (the double play, 2026-09-27).
  if (topUp) {
    diag.log("player:topUpSkip", { why: "inFlight", np, mkLen: items.length, modelUp: queue.getUpcoming().length });
    return;
  }
  if (np < 0) {
    diag.log("player:topUpSkip", { why: "noIndex", np, mkLen: items.length, modelUp: queue.getUpcoming().length });
    return;
  }
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
  const modelUp = queue.getUpcoming().filter((e) => !!feedId(e));
  let firstMismatch: { mkPos: number; mkId: string; want: string | null } | null = null;
  for (let j = 0; j < mkUp.length; j++) {
    const e = modelUp[j];
    if (!e || !isEntry(e, mkUp[j])) {
      firstMismatch = { mkPos: j, mkId: mkUp[j], want: e ? feedId(e) ?? null : null };
      break;
    }
  }
  return { aligned: !firstMismatch, firstMismatch, mkUpLen: mkUp.length, modelUpLen: modelUp.length };
}

/** Log `player:misalign` when the upcoming lists diverge. Null = aligned (or mid-load). */
function checkAlignment(where: string): ReturnType<typeof alignmentReport>["firstMismatch"] {
  if (loadingContext) return null; // mid-(re)build — expected to differ
  const r = alignmentReport();
  if (!r.aligned) {
    diag.log("player:misalign", { where, ...r.firstMismatch, mkUpLen: r.mkUpLen, modelUpLen: r.modelUpLen });
    perf.event("misalign", { where, ...r.firstMismatch, mkUpLen: r.mkUpLen, modelUpLen: r.modelUpLen });
  }
  return r.firstMismatch;
}

/** Check, and repair MusicKit from the model when they diverge — once per call, never a loop.
 *  At a song change (`songChange`) only a near difference is repaired at once (queue-sync.ts,
 *  `repairAtSongChange`); a far one waits for the next top-up. */
async function ensureAligned(where: string, songChange = false): Promise<void> {
  const miss = checkAlignment(where);
  if (!miss || mode !== "queue") return;
  if (songChange && !repairAtSongChange(miss.mkPos)) {
    diag.log("player:repairLater", { where, mkPos: miss.mkPos });
    return;
  }
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
    if (!jumpToNextFed("follow")) short++;
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
  // The fallback path: a library id (dead catalog id). A healed catalog id resolves to the
  // library row too (track-store.ts), so compare with the library id, not the catalog id.
  const byLibrary = id === t.libraryId;
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
 *  ids MusicKit has declared dead this session are passed over. A library song Apple sent
 *  with no play id plays its healed catalog copy (heal.rs), and plays nothing when it has
 *  none: MusicKit would take its library id without an error and leave it out. */
const playId = (h: TrackHandle): string | undefined => {
  if (h.catalogId && !deadIds.has(h.catalogId)) return h.catalogId;
  if (!h.catalogId) {
    const healed = healedId(h.libraryId);
    if (healed) return deadIds.has(healed) ? undefined : healed;
    if (noCatalogCopy(h)) return undefined;
  }
  if (h.libraryId && !deadIds.has(h.libraryId)) return h.libraryId;
  return undefined;
};

// ── Suggest Less in a queue (SUGGEST-LESS.md §5a; Settings › Playback › Skip in queues) ──
// A marked song in Up Next is never fed to MusicKit: `feedId` answers nothing for it, as for a
// dead song, so MusicKit's window, the alignment check and the model's follow all count only
// the fed rows, and nothing is heard of the skipped song. The row stays in the model, greyed in
// the Queue card; a click on it is a pick and plays it (the current song is never asked).

/** Is this Up Next row stepped over? The row is on and the song matches a mark (§5c). */
export function suggestSkipped(h: TrackHandle): boolean {
  if (!setting("suggestSkipQueue")) return false;
  const t = trackById(h.catalogId ?? h.libraryId) ?? { catalogId: h.catalogId, libraryId: h.libraryId, title: "", artistName: "" };
  return !!matchOf(t, h.catalogId);
}
/** The id an UPCOMING row is fed to MusicKit by: its play id, unless Suggest Less skips it. */
const feedId = (h: TrackHandle): string | undefined => (suggestSkipped(h) ? undefined : playId(h));

/** Step the model to the next fed Up Next row (`queue.jumpTo`), and tell of the rows Suggest
 *  Less passed over. False when no row is fed: the list has ended. */
function jumpToNextFed(where: string): boolean {
  const { at, passed } = nextFed(queue.getUpcoming(), feedId, suggestSkipped);
  if (passed.length) noteSuggestSkips(passed, "queue", where);
  return at >= 0 && !!queue.jumpTo(at);
}

/** The songs a skip passed over, gathered for one toast (§6): "Skipped “Song”" or "Skipped 3
 *  songs". Undo plays the first one now, as a pick: in a queue it goes on top of Up Next and
 *  plays; on a station, `undo` breaks out with it and the station comes back after it. */
const SUGGEST_TOAST_GAP_MS = 800;
let suggestPassed: Track[] = [];
let suggestToastTimer = 0;
let suggestUndo: (() => void) | null = null;
function noteSuggestSkips(hs: TrackHandle[], where: "queue" | "station", why: string, undo?: () => void): void {
  for (const h of hs) {
    const t = trackById(h.catalogId ?? h.libraryId);
    diag.log("suggest:skip", { where, why, match: t ? matchOf(t, h.catalogId) : null, id: h.catalogId ?? h.libraryId ?? null });
    if (t) suggestPassed.push(t);
  }
  if (!suggestPassed.length) return;
  if (undo && suggestPassed.length === hs.length) suggestUndo = undo;
  window.clearTimeout(suggestToastTimer);
  suggestToastTimer = window.setTimeout(() => {
    const songs = suggestPassed;
    const station = suggestUndo;
    suggestPassed = [];
    suggestUndo = null;
    const first = songs[0];
    toast({
      kind: "info",
      text: songs.length === 1 ? `Skipped “${first.title}” — Suggest Less.` : `Skipped ${songs.length} songs — Suggest Less.`,
      timeout: 6000,
      actions: [
        {
          label: "Undo",
          run: () => {
            diag.log("suggest:undo", { where, id: first.catalogId ?? first.libraryId ?? null });
            if (station) station();
            else void playTracksKeepQueue([first], "suggest").catch((e) => console.warn("[player] suggest undo:", e));
          },
        },
      ],
    });
  }, SUGGEST_TOAST_GAP_MS);
}

// The heal's backstop (QUEUE.md §A library song Apple sends with no play id). MusicKit
// takes an insert of a library id it cannot play WITHOUT an error and leaves the song out.
// The heal after each sync finds these songs first; this catches one it has not seen yet
// (a song added since, a first launch): heal that song now, then repair once more.
const healAsked = new Set<string>();
function noteDropped(where: string, sent: string[]): void {
  const held = new Set<string>((music?.queue?.items ?? []).map((it: any) => it?.id));
  const dropped = sent.filter((id) => !held.has(id));
  if (!dropped.length) return;
  diag.log("player:insertDropped", { where, n: dropped.length, ids: dropped.slice(0, 10) });
  const ask = dropped.filter((id) => id.startsWith("i.") && !healAsked.has(id));
  if (!ask.length) return;
  ask.forEach((id) => healAsked.add(id));
  void (async () => {
    // `undefined` = the call failed (offline, a 429): nothing is known, so nothing is banked.
    const got = await Promise.all(ask.map((id) => invoke<string | null>("catalog_heal_one", { libraryId: id }).catch(() => undefined)));
    // No catalog copy (null): MusicKit left the id out and nothing can replace it, so bank it
    // for this session (not on disk: the heal pass looks again in 7 days). Before 2026-09-29
    // it was fed again at every repair and dropped again each time.
    const none = ask.filter((_, i) => got[i] === null);
    none.forEach((id) => deadIds.add(id));
    diag.log("player:healAsked", { n: ask.length, healed: got.filter(Boolean).length, banked: none.length });
    await refreshHeals(); // playId now answers the catalog copy, or nothing
    await reconcileUpcoming();
  })();
}

/** Extract the id list from a MusicKit "items could not be resolved" rejection. */
function unresolvedIds(e: unknown): string[] {
  const msg = e instanceof Error ? e.message : String(e);
  const m = /could not be resolved:\s*(.+)/i.exec(msg);
  return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
}

/** The still-playable ids of a handle list (deadIds-aware, unplayables dropped). */
const liveIds = (hs: TrackHandle[]): string[] =>
  hs.map(playId).filter((id): id is string => !!id);
/** The ids of Up Next rows MusicKit is fed: live, and not stepped over by Suggest Less. */
const fedIds = (hs: TrackHandle[]): string[] =>
  hs.map(feedId).filter((id): id is string => !!id);

/**
 * Run a MusicKit insert (playNext/playLater) with the same NOT_FOUND self-healing as
 * doLoadFromModel's setQueue: the insert is all-or-nothing, so bank the ids MusicKit
 * names as unresolvable, rebuild the id list (playId swaps in library-id fallbacks or
 * drops the handle), retry. Ends silently once nothing playable is left — the model
 * keeps its entries; the window builders skip dead ones. See docs/features/QUEUE.md.
 *
 * A song may sit in the queue many times (his call, 2026-10-01), but one MusicKit call that
 * holds an id twice keeps only the last copy. So the list goes in PARTS with no id twice
 * (queue-sync.ts `headPart`): one call for a list with no repeat. `playNext` puts each call
 * right after the current song, so its parts go from the end (`order: "reverse"`). A retry
 * re-sends only the parts not in yet: the parts in already resolved, so the rebuild keeps them.
 * QUEUE.md §Repeats in one insert.
 */
async function insertWithRetry(
  where: string,
  run: (ids: string[]) => Promise<void>,
  rebuild: () => string[],
  order: "forward" | "reverse" = "forward",
): Promise<void> {
  let ids = rebuild();
  let done = 0; // ids in MusicKit already: from the start (forward) or from the end (reverse)
  let parts = 0;
  let fails = 0;
  const sentOf = (list: string[]) => (order === "forward" ? list.slice(0, done) : list.slice(list.length - done));
  while (done < ids.length) {
    const left = order === "forward" ? ids.slice(done) : ids.slice(0, ids.length - done);
    const part = order === "forward" ? headPart(left) : tailPart(left);
    try {
      await run(part);
      done += part.length;
      parts++;
    } catch (e) {
      const bad = unresolvedIds(e);
      if (!bad.length || fails >= 2) throw e; // not a resolve failure, or persistently bad
      markDead(bad, "not-found");
      diag.log("player:deadIds", { where, n: bad.length, attempt: fails, bad: bad.slice(0, 10) });
      console.warn(`[player] ${where}: ${bad.length} unresolvable id(s) dropped; retrying`);
      fails++;
      const sent = sentOf(ids);
      ids = rebuild();
      // Never send a part twice: if the rebuild moved the parts already in, stop here. The
      // alignment check after the insert logs it, and the next reconcile repairs from there.
      if (sentOf(ids).join() !== sent.join()) {
        diag.log("player:insertStop", { where, done, why: "rebuild moved the sent parts" });
        return;
      }
    }
  }
  if (parts > 1) diag.log("player:insertParts", { where, parts, n: done });
  noteDropped(where, ids);
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
  roomStationOn = null; // the model's songs replace a room station's queue (ROOMS.md §21.8)
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
  const first = queue.getCurrent();
  if (!first) return;
  let current = first;
  // A current song with no play id (banked dead, or never had one) is fed as nothing: the
  // window then starts on the first upcoming song while the model still names the dead one,
  // one song behind, so that upcoming song played twice (2026-09-29, review). Move the model
  // to the first live song instead, as healDeadNext does. False: nothing live is left.
  const skipDeadCurrent = (): boolean => {
    if (playId(current)) return true;
    const k = queue.getUpcoming().findIndex((h) => !!feedId(h));
    const deadId = current.catalogId ?? current.libraryId;
    diag.log("player:deadCurrent", { id: deadId ?? null, to: k });
    if (deadId) noteDeadSongs([deadId]); // the same "Skipped …" toast, once per burst
    if (k < 0 || !queue.jumpTo(k)) return false;
    const next = queue.getCurrent();
    if (!next) return false;
    current = next;
    return true;
  };
  if (!skipDeadCurrent()) {
    console.warn("[player] nothing playable in window");
    return;
  }
  // A pending grow is moot (this load re-windows); an in-flight one must finish first.
  cancelGrow();
  if (topUp) {
    perf.mark("waitTopUp");
    await topUp;
  }
  // Every reconcile, not only the top-up: a song-change repair still appending when this
  // load swaps the queue landed its old songs behind the new one (2026-09-28, 41 stale
  // songs, twice), and that met the new song's license setup (MEDIA_KEY, the music stopped).
  await reconcileChain;
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
      const id = feedId(h);
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
          if (!skipDeadCurrent()) throw e; // the banked id was the current song's, and none is left
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
  // A library song with no catalog copy (heal.rs) leaves the list the same way, so a click on
  // it starts the next song that plays. Only it left: playContext refuses, and the "no longer
  // offers" toast below names it.
  if (tracks.some(noCatalogCopy)) {
    const kept = tracks.filter((t) => !noCatalogCopy(t));
    if (kept.length > tracks.slice(0, startIndex).filter((t) => !noCatalogCopy(t)).length) {
      startIndex = tracks.slice(0, startIndex).filter((t) => !noCatalogCopy(t)).length;
      tracks = kept;
    }
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
  if (roomBridge && !roomBridge.station(s)) return;
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
    // A first song Suggest Less will skip is hushed before it can sound (SUGGEST-LESS.md §5b);
    // the skip itself runs in `finally`, once the station plays. Two ways to know it first:
    // MusicKit already names the song, or the station is a song's (`ra.<song id>`) and that
    // song is marked — Apple plays the seed first. MusicKit often names nothing yet here (his
    // Snooze run, 2026-10-16), so the seed is the sure one. A first song that is not the seed
    // ends the hush on arrival (`stationSuggestSkip` finds no match).
    if (setting("suggestSkipStations") && !s.isLive) {
      const first = m.nowPlayingItem;
      const a = first?.attributes ?? {};
      const seed = /^ra\.(\d+)$/.exec(s.id)?.[1];
      const firstMarked =
        !!first?.id && !String(first.id).startsWith("ra.") &&
        !!matchOf({ catalogId: first.id, title: first.title ?? a.name ?? "", artistName: first.artistName ?? a.artistName ?? "", albumName: first.albumName ?? a.albumName });
      const seedMarked = !!seed && !!matchOf({ catalogId: seed, title: "", artistName: "" });
      if (firstMarked || seedMarked) {
        diag.log("suggest:preHush", { by: firstMarked ? "first" : "seed", station: s.id });
        hush("suggest", true, SUGGEST_HUSH_MAX_MS);
      }
    }
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
    // now; if MusicKit is still fetching, the coming np-change event handles it. Suggest Less
    // asks first: a station started from a marked song plays that song first (SUGGEST-LESS.md
    // §5b; found in his desk test 2026-10-16, "Kill Bill" played).
    if (mode === "radio" && !stationSuggestSkip()) stationFollow();
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

/** The model holds a queue that MusicKit does not: no current song (a restored Up Next), or
 *  a current song MusicKit has not been fed (a restore with Restore on launch = Song, a
 *  network drop). An insert then changes the model only; the first Play loads it. */
function modelOnlyQueue(): boolean {
  if (mode !== "queue") return false;
  if (!queue.getCurrent()) return true;
  return !music?.nowPlayingItem && !music?.isPlaying && !isLoading && !loadingContext;
}

/** Shared core: filter to playable handles, bootstrap if idle, else mutate model + MusicKit. */
async function enqueue(handles: TrackHandle[], where: "next" | "later"): Promise<void> {
  if (roomBridge) return roomBridge.enqueue(handles, where);
  const playable = handles.filter((h) => playId(h));
  if (!playable.length) return;
  const m = await initPlayer();
  const libOnly = playable.filter((h) => !h.catalogId && h.libraryId).length;
  diag.log("player:enqueue", { where, n: playable.length, libOnly });

  if (!queue.getCurrent() && !queue.getUpcoming().length) {
    await playContext(playable, 0); // nothing at all in the queue → start the block
    return;
  }
  if (modelOnlyQueue()) {
    // A saved Up Next with nothing in MusicKit (a restore with Restore on launch = Queue,
    // or the model's song not fed yet): add it to the queue only, his call 2026-09-29.
    // Before, the block started playing and replaced the saved Up Next. The first Play
    // loads the model through the normal path (playPause).
    if (where === "next") queue.playNextMany(playable);
    else queue.addToQueueMany(playable);
    diag.log("player:enqueueIdle", { where, n: playable.length });
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
      await insertWithRetry("enqueue:next", (ids) => m.playNext({ songs: ids }), () => fedIds(playable), "reverse");
  } else {
    queue.addToQueueMany(playable);
    if (typeof m.playLater === "function")
      await insertWithRetry("enqueue:later", (ids) => m.playLater({ songs: ids }), () => fedIds(playable));
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
  if (!queue.getCurrent() && !queue.getUpcoming().length) {
    await playContext(playable, 0); // nothing at all in the queue → start the block
    return;
  }
  queue.insertManyAt(at, playable);
  if (modelOnlyQueue()) return; // a saved Up Next MusicKit does not hold: the first Play loads it
  if (mode === "radio") {
    pendingBreakout = true;
    return;
  }
  await reconcileUpcoming();
}
/**
 * Play Tracks at once and keep Up Next after them — a drop on Now Playing with Settings ›
 * Playback › Dragging a Song into Now Playing behavior = Keep Queue. The block goes to the top of Up Next and
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
  const live = queue.getUpcoming().slice(0, k).filter((h) => !!feedId(h)).length;
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
      await insertWithRetry("move-top", (ids) => m.playNext({ songs: ids }), one, "reverse");
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
  if (np < 0) {
    diag.log("player:reconcileSkip", { why: "noIndex", mkLen: items.length, modelUp: queue.getUpcoming().length });
    return;
  }

  // Expected MK upcoming = the model's upcoming live ids, in order, capped to the window.
  // No dedup: `playLater` keeps a repeated id (only `setQueue` collapses them, which is why
  // loadFromModel's window still dedups). The rules live in queue-sync.ts, under test.
  // A closure so the NOT_FOUND retry can rebuild it after a dead-id bank (playId is deadIds-aware).
  const computeExpected = (): string[] => expectedIds(queue.getUpcoming(), cap, feedId);
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

const shuffleSubs = new Set<() => void>();
/** A press that shuffles (the Shuffle square, the Compass, the agent; not a rule's mode change).
 *  rules-playback.ts reports it as *You press shuffle* (RULEZ.md §10.1). */
export function onShufflePress(cb: () => void): () => void {
  shuffleSubs.add(cb);
  return () => shuffleSubs.delete(cb);
}

/**
 * Shuffle the remaining queue once. Playing: manual picks rise to the top, the auto
 * tail shuffles (queue.shuffleUpcoming), and MusicKit's live window is reconciled
 * gaplessly — same primitive as drag-reorder, `current` never moves. With no song loaded the
 * press is only reported: what it plays is a rule's (RULEZ.md §10.1). Settings › Idle shuffle
 * plays makes the built-in one, `shuffleLibrary` below; "Nothing" makes none (FUTURE-SETTINGS §5b).
 */
export async function shuffleQueue(): Promise<void> {
  if (roomBridge) return; // the room decides the order (§10)
  await initPlayer();
  shuffleSubs.forEach((cb) => cb());
  if (!queue.getCurrent()) return;
  diag.log("player:shuffle", { idle: false, up: queue.getUpcoming().length });
  queue.shuffleUpcoming();
  await reconcileUpcoming();
}

/**
 * Unshuffle (QUEUE.md §Shuffle and unshuffle; his call 1A, 2026-10-12): Up Next becomes the
 * list's songs after the playing one, in the list's order, and MusicKit's window is
 * reconciled gaplessly — `current` never moves. Nothing happens with no song loaded, or
 * when the playing song is not in the plan (queue.unshuffle says so).
 */
export async function unshuffleQueue(): Promise<void> {
  if (roomBridge) return; // the room decides the order (§10)
  await initPlayer();
  if (!queue.getCurrent()) return;
  const before = queue.getUpcoming().length;
  const ok = queue.unshuffle();
  diag.log("player:unshuffle", { ok, before, up: queue.getUpcoming().length });
  if (ok) await reconcileUpcoming();
}

/**
 * Turn the mode off from a PRESS (the square, the agent's `shuffle-off`): Settings ›
 * Playback › *Shuffle off plays* says whether the list goes on in its order (unshuffle) or
 * stays as shuffled. A rule's *Turn shuffle off* is not a press: it only sets the mode.
 */
export async function shuffleOff(): Promise<void> {
  if (roomBridge) return;
  setShuffleMode(false);
  if (setting("shuffleOff") === "order") await unshuffleQueue();
}

/**
 * Play a list shuffled (the hero's Shuffle, a menu's Shuffle row, the Compass, a pin's
 * On Click, the idle press's rule). With "Shuffle stays on" the mode turns on and the list
 * is handed over IN ORDER from a random song: `setContext` shuffles the rest (his call
 * 3A), and the plan keeps the list's order, so unshuffle can bring it back. With the row
 * off there is no mode and no unshuffle: a shuffled copy plays from its top, as before.
 */
export function shuffledPlay<T>(items: T[], play: (list: T[], start: number) => void): void {
  if (!items.length) return;
  if (setting("shuffleStays")) {
    setShuffleMode(true);
    play(items, queue.randomIndex(items.length));
  } else {
    play(queue.shuffleInPlace(items.slice()), 0);
  }
}

/** The list and where Play starts in it: a random song while the shuffle mode is on (the
 *  queue shuffles the rest), else the top. For a Play / Shuffle row whose picks resolve to
 *  songs later (albums, artists, genres, playlists picked), so the start spans the SONGS. */
export const shuffledStart = <T>(ts: T[]): [T[], number] => [ts, isShuffleOn() ? queue.randomIndex(ts.length) : 0];

/** Play the whole cached library shuffled (the idle shuffle press's rule, *Play the library shuffled*). */
export async function shuffleLibrary(): Promise<void> {
  if (roomBridge) return;
  await initPlayer();
  const all = tracks();
  if (!all.length) {
    console.warn("[player] shuffle: no cached library to play");
    return;
  }
  const handles = all.map((t) => toHandle(t));
  diag.log("player:shuffle", { idle: true, n: handles.length });
  await new Promise<void>((resolve, reject) => shuffledPlay(handles, (list, start) => playContext(list, start).then(resolve, reject)));
}

/**
 * The Shuffle square (NEXT-VERSION §14 A). With "Shuffle stays on" (the default) it is a
 * mode: press = on (and Up Next shuffles now, the one-shot above), press again = off (the
 * list goes on in its order, or stays as shuffled: `shuffleOff`). With the row off it is
 * the one-shot.
 */
export async function toggleShuffle(): Promise<void> {
  if (roomBridge) return;
  if (!setting("shuffleStays")) return shuffleQueue();
  if (setting("shuffleMode")) return shuffleOff();
  setShuffleMode(true);
  await shuffleQueue();
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
  /** A station in a room: this app feeds it to the room (§21.8). Returns false: the
   *  caller's own station play stops, because the room plays it, not radio mode. */
  station(s: Station): boolean;
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
  roomStationOn = null;
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
    const off = Math.abs(roomPositionMs() - positionMs);
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
export async function roomResumeAt(positionMs: number, correcting = false, toleranceMs = 400): Promise<void> {
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
  const off = Math.abs(preciseMs(m) - want);
  // `toleranceMs`: the room's settle passes its own 250 ms, or it would ask for a fix this
  // line then refused (a 390 ms gap is over 250 and under 400).
  if (off > toleranceMs && typeof m.seekToTime === "function") await m.seekToTime(want / 1000);
  if (!correcting && !m.isPlaying) await m.play();
}

/**
 * Where MusicKit is in the song, in ms, to the millisecond. `currentPlaybackTime` counts
 * WHOLE seconds, so the room's 250 ms settle and its seek checks could not see an error under
 * a second: a 390 ms start gap between two apps stayed for the whole song (measured
 * 2026-09-26, ROOMS.md). The <audio> element MusicKit plays through keeps the real time. It
 * is trusted only while it agrees with MusicKit's whole second, so another element can never
 * steer the room; otherwise this falls back to MusicKit.
 */
function preciseMs(m: any): number {
  const coarse = (m.currentPlaybackTime ?? 0) * 1000;
  const els = [...document.querySelectorAll("audio")];
  const el = els.find((a) => !a.paused && a.readyState > 0) ?? els.find((a) => a.currentSrc);
  const fine = el ? el.currentTime * 1000 : NaN;
  return Number.isFinite(fine) && Math.abs(fine - coarse) < 1500 ? fine : coarse;
}

/** Where the local player is, in ms — what the room's drift check compares. */
export function roomPositionMs(): number {
  return music ? preciseMs(music) : 0;
}

/** MusicKit is PLAYING this song now — a Listen Along room made from it need not reload it. */
export function roomPlayingSame(catalogId: string): boolean {
  return !!music?.isPlaying && music?.nowPlayingItem?.id === catalogId;
}

/** False once MusicKit's one-song queue has played out and gone quiet (§5.5). */
export function roomHasSong(): boolean {
  return !!music?.nowPlayingItem;
}

// ── A station in a room: the feeder's MusicKit (ROOMS.md §21.8) ─────────────────
// The feeder's MusicKit holds the STATION queue, not one song, so it can read the next song
// before it plays: MusicKit keeps one song ahead in `queue.items` (§21.7, its own refill on
// each position change). Documented MusicKit only — `setQueue({ station })`, `queue.items`,
// `queue.position`, `changeToMediaAtIndex`, `queueItemsDidChange`. The other members play
// each song the normal room way, one song at a time.

/** A station song as the room needs it. */
export interface RoomStationSong {
  catalogId: string;
  title: string;
  artistName: string;
  albumName: string;
  durationMs: number;
  artworkUrl: string | null;
  isrc: string | null;
}

function stationSongOf(item: any): RoomStationSong | null {
  const id = item?.id;
  if (!id || String(id).startsWith("ra.")) return null;
  const a = item.attributes ?? {};
  const durationMs = Number(a.durationInMillis ?? (item.playbackDuration ?? 0));
  return {
    catalogId: String(id),
    title: String(item.title ?? a.name ?? ""),
    artistName: String(item.artistName ?? a.artistName ?? ""),
    albumName: String(item.albumName ?? a.albumName ?? ""),
    durationMs: Number.isFinite(durationMs) ? Math.round(durationMs) : 0,
    artworkUrl: a.artwork?.url ?? item.artwork?.url ?? null,
    isrc: a.isrc ?? null,
  };
}

/**
 * The station whose queue MusicKit holds, or null. Set by `roomStationLoad`, cleared by any
 * load from the model, so a one-song room queue is never read as a station's.
 */
let roomStationOn: string | null = null;
export const roomStationLoaded = (): string | null => roomStationOn;

/** MusicKit's station queue now: where it is, and every song it holds (none when it holds
 *  no station queue). */
export function roomStationQueue(): { position: number; songs: (RoomStationSong | null)[] } {
  if (!roomStationOn) return { position: -1, songs: [] };
  const q = music?.queue;
  const items: any[] = q?.items ?? [];
  return { position: typeof q?.position === "number" ? q.position : -1, songs: items.map(stationSongOf) };
}

/**
 * Load a station into MusicKit WITHOUT playing it: the room starts it at its own moment.
 * Returns the songs MusicKit holds (the first one, and usually the next).
 */
export async function roomStationLoad(s: Station): Promise<RoomStationSong[]> {
  const m = await initPlayer();
  notePause("room-station");
  // MusicKit's pause rejects with a pending play's AbortError; the pause itself still lands.
  if (m.isPlaying && typeof m.pause === "function") await Promise.resolve(m.pause()).catch(() => {});
  try {
    await setStationQueue(m, s);
  } catch (e) {
    // A play the room asked for and MusicKit had not finished is cut off by this setQueue,
    // and MusicKit rejects with that AbortError. The play is gone now: once more.
    if (!/AbortError|interrupted/i.test(String(e))) throw e;
    diag.log("player:roomStationRetry", { id: s.id });
    await setStationQueue(m, s);
  }
  roomStationOn = s.id;
  diag.log("player:roomStation", { id: s.id, mkLen: m.queue?.items?.length ?? 0 });
  return roomStationQueue().songs.filter((x): x is RoomStationSong => !!x);
}

/** MusicKit's station queue holds this song at or after where it is. */
export function roomStationHas(catalogId: string): boolean {
  const { position, songs } = roomStationQueue();
  return songs.some((x, i) => i >= Math.max(0, position) && x?.catalogId === catalogId);
}

/**
 * Move the feeder's station queue onto `catalogId` (a song change in the room, or a skip).
 * Paused: the room's own step starts it at the room's moment.
 */
export async function roomStationGoTo(catalogId: string): Promise<boolean> {
  const m = music;
  if (!m) return false;
  if (m.nowPlayingItem?.id === catalogId) return true;
  const { position, songs } = roomStationQueue();
  const index = songs.findIndex((x, i) => i >= Math.max(0, position) && x?.catalogId === catalogId);
  if (index < 0 || typeof m.changeToMediaAtIndex !== "function") return false;
  // MusicKit starts the song as it moves; the room starts it at its own moment instead. A
  // pause that cuts that start off rejects with an AbortError, which is the point here.
  await Promise.resolve(m.changeToMediaAtIndex(index)).catch(() => {});
  if (m.isPlaying && typeof m.pause === "function") {
    notePause("room-station");
    await Promise.resolve(m.pause()).catch(() => {});
  }
  diag.log("player:roomStationGoTo", { id: catalogId, index });
  return true;
}

/** A live broadcast in a room: each member tunes in on their own app (§21.8). */
export async function roomLive(s: Station): Promise<void> {
  const m = await initPlayer();
  roomStationOn = null; // a broadcast, not a queue of songs to feed
  await setStationQueue(m, s);
  if (!m.isPlaying) await m.play();
  diag.log("player:roomLive", { id: s.id });
}

/** The room's station, for the Queue card's station row ("Apple Music picks what's next"). */
let roomStationRow: Station | null = null;
export function setRoomStationRow(s: Station | null): void {
  if (roomStationRow?.id === s?.id) return;
  roomStationRow = s;
  emit();
}

/** MusicKit's station queue changed (its one-ahead refill landed). room.ts feeds it on. */
let stationItemsWired = false;
export function onRoomStationItems(cb: () => void): void {
  void initPlayer().then((m) => {
    if (stationItemsWired || !m) return;
    const E = window.MusicKit?.Events;
    if (!E?.queueItemsDidChange) return;
    stationItemsWired = true;
    m.addEventListener(E.queueItemsDidChange, () => {
      if (mode === "room") cb();
    });
  });
}

// ── Transport ────────────────────────────────────────────────────────────────

/**
 * One line per transport press, written at the press before anything can return early
 * (2026-10-01): a Play that did nothing on live left no line, so a stuck song could not be
 * told from a press that never came. `from` is the place (button, space, tray, agent, rule…);
 * `state` is MusicKit's state at the press.
 */
function logPress(what: "playPause" | "next" | "prev", from: string): void {
  if (what !== "playPause") releaseHold(what); // playPause decides for itself
  endEndStall(`press:${what}`);
  const m = music;
  const S = window.MusicKit?.PlaybackStates;
  diag.log("player:press", {
    do: what,
    from,
    state: m && S ? S[m.playbackState] ?? m.playbackState : null,
    id: m?.nowPlayingItem?.id ?? null,
    at: m ? Math.round(m.currentPlaybackTime ?? 0) : null,
    playing: !!m?.isPlaying,
    mode,
    room: !!roomBridge,
  });
}

/** Toggle play/pause. With nothing queued, starts the cached library from the top. */
export async function playPause(why = "button"): Promise<void> {
  logPress("playPause", why);
  // A heal hold shows the song as playing, so this press means Pause: stop the heal (it reads
  // lastUserPauseAt) and leave the song paused at its spot.
  if (heldSpot() !== null) {
    lastUserPauseAt = performance.now();
    releaseHold("pause");
    if (music?.isPlaying) {
      notePause(why);
      await music.pause();
    }
    return;
  }
  if (music?.isPlaying) notePause(roomBridge ? `room:${why}` : why);
  if (roomBridge) return roomBridge.playPause(); // a room command (ROOMS.md §10)
  if (!music?.isPlaying) await requireSignIn(); // pausing never needs a sign-in
  const m = await initPlayer();
  if (m.isPlaying) {
    lastUserPauseAt = performance.now();
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
    // Armed BEFORE the await: on a song stuck in `waiting`, play() never settles, so a check
    // armed after it never ran (live, 2026-10-04: Play at 0:13 did nothing, no silentStart).
    watchForSound("play"); // a stuck song ignores play(): the check reloads it
    await m.play();
    scheduleGrow(); // a preloaded window is the small click window — grow it like any click
    return;
  }
  // Nothing loaded in MusicKit but the model has a plan — a restored session
  // (queue-persist.ts), or a network drop destroyed MusicKit's player: Play resumes where
  // you left off.
  if (queue.getCurrent()) {
    // The spot a network drop or an update restart saved: resume there, once, and only while
    // that song is still the model's current (resume-point.ts). Taking the drop's spot here
    // also stops the reconnect resume below from acting on it again. loadAndResumeAt says
    // why the seek waits for the song to play.
    const restart = resumeAt;
    const drop = resumeAfterReconnect;
    resumeAt = null;
    resumeAfterReconnect = null;
    const cur = queue.getCurrent();
    const sec = resumePoint(cur, cur ? (cur.catalogId ?? cur.libraryId) : undefined, restart, drop);
    if (drop) diag.log("player:resumeOnPlay", { at: Math.round(drop.at), used: sec > 0 });
    await loadAndResumeAt(m, sec);
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
/**
 * Next / Previous while MusicKit holds no song but the model has one — a restored session
 * (queue-persist.ts) or a network drop that destroyed MusicKit's player: the same state
 * playPause loads from. A skip there moves the model and stays paused, as Apple Music does
 * (his call, 2026-09-28); the first Play loads the new song. Before, the skip reached an empty
 * MusicKit and did nothing (found by the shots runner). No play intent: nothing starts. The
 * rule is idle-skip.ts. Returns false when MusicKit has a song (or one is loading): the
 * normal skip runs.
 */
function skipWhileIdle(way: "next" | "prev"): boolean {
  if (music?.nowPlayingItem || isLoading || mode !== "queue") return false;
  const cur = queue.getCurrent();
  if (!cur) return false;
  const spotSec = resumePoint(cur, cur.catalogId ?? cur.libraryId, resumeAt, resumeAfterReconnect);
  const step = idleSkip(way, {
    upcoming: queue.getUpcoming().length,
    history: queue.getHistory().length,
    repeatAll: getRepeat() === "all",
    spotSec,
  });
  diag.log("player:idleSkip", { way, step, spot: Math.round(spotSec) });
  if (step === "none") return true;
  // The song changes or starts over, so a saved spot no longer applies.
  resumeAt = null;
  resumeAfterReconnect = null;
  if (step === "refill" && !queue.refillFromPlan(isShuffleOn())) return true;
  // Next steps over a Suggest Less row as a song end does (SUGGEST-LESS.md §0).
  if (step === "advance" || step === "refill") {
    if (!jumpToNextFed("idleNext")) queue.advance();
  } else if (step === "previous") queue.previous();
  refreshPlayerState(); // Now Playing and its scrubber show the model's song at 0:00
  return true;
}

export async function nextTrack(from = "button"): Promise<void> {
  logPress("next", from);
  transport("next");
  if (roomBridge) return roomBridge.next();
  if (skipWhileIdle("next")) return;
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
  if (await skipCopyByLoad(m, 1)) return;
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
async function healDeadNext(m: any, why: string, bank: boolean, failed?: TrackHandle): Promise<boolean> {
  // `failed`: the song that failed is the model's current, not the next one (onPlaybackError,
  // 2026-09-29). It is banked; the jump below still moves to the first live upcoming song.
  // The next song MusicKit tried: the first fed row, past any Suggest Less row (never banked).
  const nx = failed ?? queue.getUpcoming().find((h) => !!feedId(h));
  const id = nx ? playId(nx) : undefined;
  if (!id) return false;
  // Bank only on MusicKit's own word (the skip rejection). The end-of-song shape also
  // follows a transient failure (a MEDIA_LICENSE hiccup), and banking there skipped
  // LIVE songs for the session (observed 2026-09-12); an unbanked re-window onto a truly
  // dead song fails into the id re-feed, whose NOT_FOUND retry banks it properly.
  if (bank) markDead([id], "unavailable");
  diag.log("player:deadNext", { id, why, bank, current: !!failed });
  perf.event("deadNext", { id, why, bank });
  console.warn(`[player] next song ${bank ? "unavailable" : "failed to start"} (${id}); ${bank ? "moving on" : "re-windowing onto it"}`);
  if (!jumpToNextFed("deadNext")) return false;
  // `stopFirst`: MusicKit sits in `ended` here, so the load's pause is skipped (`isPlaying` is
  // false) and nothing resets its position. Twice on live (2026-09-27, 02:55 and 16:56) the
  // re-windowed song then played with NO now-playing index: both grows returned silently, the
  // queue stayed at one song, and at its end MusicKit started index 0 again — the song played
  // twice. A full stop() resets the controller, as the station break-out learned (QUEUE.md).
  await recoverLoad(m, "deadNext");
  return true;
}

// ── The recovery load must end in sound (2026-09-28) ─────────────────────────────
// A recovery load (the end-of-song heal, the failed-song retry, the dry window, the license
// retry) can end with nothing playing and no error: on live, "Need U" → "Water" had its play()
// cut off, and the music stayed silent for 5½ minutes with no toast. So each recovery load is
// checked: RECOVER_CHECK_MS later MusicKit must play (or still be loading) the same song. If
// it is silent, load it once more; silent again, the toast says so. Nothing is done when the
// user paused, clicked, skipped or the song changed in between.
const RECOVER_CHECK_MS = 4000;
/** A still-loading song gets this many more looks before it counts as silent. */
const RECOVER_LOADING_LOOKS = 3;
let lastUserPauseAt = -Infinity;
let recoverAgain: unknown = null;
/** Bumped when a heal gives up with its toast: a recovery check armed before it does nothing. */
let recoverEpoch = 0;

/** `atSec`: start the song there (a mid-song stall, a Play on a stuck song); 0 = the top. */
async function recoverLoad(m: any, why: string, atSec = 0): Promise<void> {
  await loadAndResumeAt(m, atSec, { stopFirst: true });
  const entry = queue.getCurrent();
  const gen = loadGen;
  const epoch = recoverEpoch;
  const startedAt = performance.now();
  let looks = 0;
  const check = (): void => {
    const mk = music;
    const S = window.MusicKit?.PlaybackStates;
    if (!mk || !S || !entry || mode !== "queue" || isLoading || loadGen !== gen || epoch !== recoverEpoch || queue.getCurrent() !== entry) return;
    if (mk.isPlaying || lastUserPauseAt > startedAt) return;
    const st = mk.playbackState;
    if ((st === S.loading || st === S.waiting || st === S.stalled) && looks++ < RECOVER_LOADING_LOOKS) {
      window.setTimeout(check, RECOVER_CHECK_MS);
      return;
    }
    const id = playId(entry) ?? null;
    // A drop's resume armed for this song, or a known Apple problem with its own toast (the
    // license heal's parallel check found it), owns what comes next: no second word.
    if (resumeAfterReconnect?.entry === entry || health.trouble() !== "none") {
      releaseHold("appleTrouble");
      diag.log("player:recoverLeft", { why, id, trouble: health.trouble() });
      return;
    }
    if (recoverAgain === entry) {
      releaseHold("gaveUp");
      diag.warn("player:recoverGaveUp", { why, id, state: S[st] ?? st });
      toast({ kind: "warn", text: "Playback stopped. Try the song again." });
      return;
    }
    recoverAgain = entry;
    diag.warn("player:recoverSilent", { why, id, state: S[st] ?? st });
    recoverLoad(mk, `${why}:again`, atSec).catch((e) => console.warn("[player] recovery reload:", e));
  };
  window.setTimeout(check, RECOVER_CHECK_MS);
}

// ── A song change must end in sound (2026-10-01) ─────────────────────────────────
// On live, "Two Years" ended, MusicKit named "Drop Dead Gorgeous" as now playing, and no sound
// came: no error, no pause line, no `ended`. The heals above key on `ended` with no item, so
// none ran, and Play did nothing either; Next then Previous (a reload) brought the song back.
// So every song change the model follows while music was meant to play, and every Play press,
// arms one check SILENT_START_MS later. No sound for that entry since the arm → the recovery
// load, which checks itself once more and toasts on a second miss. The rule is pure
// (silentStartStep, pause-rules.ts); its test is tests/pause-rules.test.ts.
const SILENT_START_MS = 4000;
/** A song MusicKit still buffers gets this many more looks before the reload. */
const SILENT_START_LOOKS = 1;
let silentWatch = 0;
/** A check is waiting: a Next or Previous pressed on a silent song still means "play". */
let silentArmed = false;

function watchForSound(why: string): void {
  window.clearTimeout(silentWatch);
  silentArmed = false;
  const entry = queue.getCurrent();
  if (!entry || mode !== "queue") return;
  silentArmed = true;
  const gen = loadGen;
  const armedAt = performance.now();
  let looks = 0;
  const check = (): void => {
    silentArmed = false;
    const mk = music;
    const S = window.MusicKit?.PlaybackStates;
    // A newer load, a song change, a station or a heal in flight owns the music now.
    if (!mk || !S || mode !== "queue" || loadGen !== gen || queue.getCurrent() !== entry) return;
    if (isLoading || loadingContext || endHealing) return;
    const st = mk.playbackState;
    const step = silentStartStep({
      playing: !!mk.isPlaying,
      heard: heardEntry === entry && heardAt > armedAt,
      userPaused: lastUserPauseAt > armedAt,
      buffering: st === S.loading || st === S.waiting || st === S.stalled,
      looks,
      maxLooks: SILENT_START_LOOKS,
    });
    if (step === "fine") return;
    if (step === "look") {
      looks++;
      silentArmed = true;
      silentWatch = window.setTimeout(check, SILENT_START_MS);
      return;
    }
    diag.warn("player:silentStart", { why, id: playId(entry) ?? null, state: S[st] ?? st, s: Math.round((performance.now() - armedAt) / 1000), output: outputKind() });
    // A Play on a song that had played starts it again where it stopped (2026-10-03); a
    // song change that never made sound starts from the top.
    const at = why === "play" && heardEntry === entry ? resumeSpot(lastHeardAt) : 0;
    recoverLoad(mk, `silentStart:${why}`, at).catch((e) => console.warn("[player] silent start reload:", e));
  };
  silentWatch = window.setTimeout(check, SILENT_START_MS);
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
/** The last queue entry MusicKit played sound for (emitProgress). */
let heardEntry: unknown = null;
/** When the last tick past HEARD_S came (performance.now): sound since a moment, not only ever. */
let heardAt = -Infinity;
const HEARD_S = 0.5;
/** The entry the end-of-song heal already retried: a second failure skips it. */
let endRetried: unknown = null;
function onEndedWithoutItem(): void {
  const m = music;
  const S = window.MusicKit?.PlaybackStates;
  if (!m || !S || endHealing || cueingListEnd || loadingContext || isLoading || mode !== "queue") return;
  const st = m.playbackState;
  if ((st !== S.ended && st !== S.completed) || m.nowPlayingItem || !hasFedUpcoming()) return;
  const items: any[] = m.queue?.items ?? [];
  const np = typeof m.nowPlayingItemIndex === "number" ? m.nowPlayingItemIndex : -1;
  const mkRemaining = np >= 0 ? items.length - np - 1 : 0;
  endHealing = true;
  // Which song failed? When MusicKit announced the next song (the model followed it) and
  // then ended with no sound, the failed song is the model's `current`, not the one after it.
  // Retry it once; a second failure skips it as before. Before 2026-09-28 the heal always
  // went past `current`, so "Not Always" and "Starchild" were skipped unheard.
  const cur = queue.getCurrent();
  const retryCurrent = mkRemaining > 0 && !!cur && heardEntry !== cur && endRetried !== cur;
  if (retryCurrent) endRetried = cur;
  const run = retryCurrent
    ? (async () => {
        const id = playId(cur);
        diag.log("player:retryCurrent", { id, np, mkLen: items.length });
        perf.event("retryCurrent", { id, np, mkLen: items.length });
        await recoverLoad(m, "retryCurrent"); // the same `ended` state as healDeadNext
        return true;
      })()
    : mkRemaining > 0
    ? healDeadNext(m, `ended: next item did not start (mk ${np}/${items.length})`, false)
    : (async () => {
        diag.log("player:windowDry", { np, mkLen: items.length, up: queue.getUpcoming().length });
        perf.event("windowDry", { np, mkLen: items.length, up: queue.getUpcoming().length });
        if (!jumpToNextFed("windowDry")) return false;
        await recoverLoad(m, "windowDry"); // same `ended` state as healDeadNext
        return true;
      })();
  run.catch((e) => console.warn("[player] end-of-song heal:", e)).finally(() => {
    endHealing = false;
  });
}

/** Run `fn` once the load in flight has ended (polled; gives up after AFTER_LOAD_MAX_MS). */
function afterLoad(fn: () => void): void {
  const until = performance.now() + AFTER_LOAD_MAX_MS;
  const look = (): void => {
    if (!loadingContext) return fn();
    if (performance.now() < until) window.setTimeout(look, 50);
  };
  window.setTimeout(look, 50);
}
const AFTER_LOAD_MAX_MS = 10_000;

/** MusicKit's own playback error — the auto-advance twin of the skip rejection above. */
function onPlaybackError(e: any): void {
  const msg = String(e?.message ?? e?.error?.message ?? e ?? "");
  // A license refused inside our own load (a Play on a restored queue, 2026-10-18 on the dev
  // app): the load's play() settles with the song paused at 0:00 and no word. Heal it once the
  // load has ended, unless the song plays by then.
  if (loadingContext && mode === "queue" && music && isLicenseError(msg)) {
    diag.warn("player:playbackError", { msg, during: "load", ...errorFields(e) });
    afterLoad(() => {
      if (mode === "queue" && music && !music.isPlaying) onMusicKitTrouble(msg, "playbackError:load");
    });
    return;
  }
  if (loadingContext || mode !== "queue" || !music) return;
  diag.warn("player:playbackError", { msg, ...errorFields(e) });
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
  // Which song is unavailable? When MusicKit already names the model's current as its
  // now-playing item and that song never made sound (heardEntry, the rule the end-of-song
  // heal uses), MusicKit advanced into it and it failed: bank IT. Before 2026-09-29 this
  // always banked peekNext(), the song AFTER the failed one — a live song, skipped for 7 days.
  // A current that was heard is the old song still on screen: the next one failed, as before.
  const cur = queue.getCurrent();
  const npId: string | undefined = music.nowPlayingItem?.id;
  const failedIsCurrent = !!cur && !!npId && isEntry(cur, npId) && heardEntry !== cur;
  healDeadNext(music, msg, true, failedIsCurrent && cur ? cur : undefined).catch((err) => console.warn("[player] dead-next heal:", err));
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
async function recoverFromFailure(source: string, live = false): Promise<{ trouble: health.Trouble; retry: boolean }> {
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
    const r = await health.check(false, true, source, false, live);
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

/** Wait before the license retry, so MusicKit's torn-down key session is gone. */
const KEY_RETRY_MS = 1000;
/** The entry the license retry already loaded again: a second failure is not retried. */
let keyRetried: unknown = null;
/** The last license heal: the same song failing again within LICENSE_AGAIN_MS takes the toast.
 *  A window, not "once per song": the failure near a song's end is the NEXT song's license
 *  (MusicKit asks ~15 s early), so a song healed at its start must still heal at its end. */
let licenseHealed: { entry: unknown; at: number } | null = null;
const LICENSE_AGAIN_MS = 30_000;

/** MusicKit failed on its own (its alert dialog, or a playback error that is not a dead
 *  song): no native dialog, find the cause, retry the current song once after a heal. */
function onMusicKitTrouble(msg: string, via: string): void {
  diag.warn("player:mkTrouble", { msg, via });
  // The song and spot this failure stopped, read before any await (the clock is ours).
  const stopped = mode === "queue" ? queue.getCurrent() : undefined;
  const stoppedAt = lastHeardAt;
  if (isLicenseError(msg)) traceLicense(msg, via, stoppedAt);
  // A failed audio download in a queue song: a network drop, most often a short one.
  if (msg === "loadSegmentError" && stopped) return onDrop(stopped, stoppedAt, via, true);
  const now = performance.now();
  const step = licenseStep({
    msg,
    queueSong: !!stopped,
    room: !!roomBridge,
    justLoaded: now - lastLoadEndAt < LOAD_ERROR_GRACE_MS,
    keyRetried: !!stopped && keyRetried === stopped,
    healed: !!stopped && licenseHealed?.entry === stopped && now - licenseHealed.at < LICENSE_AGAIN_MS,
  });
  if (step === "heal" && stopped) return healLicense(stopped, heardEntry === stopped ? stoppedAt : 0, msg, via);
  // The same song refused again soon after its heal: say so at once. The path below can stay
  // silent (one recovery per RETRY_GAP_MS), and that left a song stopped with no word.
  if (step === "none" && stopped && !roomBridge && isLicenseError(msg)) {
    releaseHold("again");
    recoverEpoch++; // the heal's own sound check must not load it a third time under the toast
    diag.warn("player:licenseGaveUp", { msg, via, id: playId(stopped) ?? null });
    toast({ kind: "warn", text: "Playback stopped. Try the song again." });
    return;
  }
  // The song's license setup failed right after a load: a race inside MusicKit, not Apple's
  // health. Load the song again once, quietly; a second failure takes the license heal.
  if (step === "keyRetry" && stopped) {
    keyRetried = stopped;
    diag.log("player:keyRetry", { via, id: playId(stopped) ?? null });
    window.setTimeout(() => {
      if (!music || mode !== "queue" || queue.getCurrent() !== stopped || music.isPlaying) return; // moved on
      recoverLoad(music, "keyRetry").catch((e) => {
        console.warn("[player] license retry:", e);
        toast({ kind: "warn", text: "Playback stopped. Try the song again." });
      });
    }, KEY_RETRY_MS);
    return;
  }
  if (now - lastTroubleAt < RETRY_GAP_MS) return;
  lastTroubleAt = now;
  void (async () => {
    if (!(await isConnected())) return health.show("signedOut", true, via);
    const r = await recoverFromFailure(via);
    if (r.trouble === "offline" && stopped) armResume(stopped, stoppedAt, via);
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

/** One log line per license failure with what led to it (QUEUE.md §License heal › Why Apple
 *  refused): the last license events from license-watch.ts, `ago` in ms before the failure, and
 *  the song, the spot, the output and the window's state. */
function traceLicense(msg: string, via: string, at: number): void {
  const now = performance.now();
  const m = music;
  diag.warn("player:licenseTrace", {
    msg,
    via,
    id: m?.nowPlayingItem?.id ?? null,
    at: Math.round(at),
    len: Math.round(m?.currentPlaybackDuration ?? 0),
    mode,
    output: outputKind(),
    up: Math.round(now / 1000),
    online: navigator.onLine,
    hidden: document.hidden,
    trace: licenseTrace()
      .slice(-6)
      .map((e) => compactEvent(now - e.t, e)),
  });
}

/** MusicKit stops the song ~40 ms after it raises the error (desk test 2026-10-18). The heal
 *  waits for that stop, looking every LICENSE_SETTLE_STEP_MS, and no longer than this: a song
 *  still playing then was not stopped by the error, and is left alone. A fixed 1 s wait (the
 *  quick retry's) measured as pure delay: the reload right after the stop took the license. */
const LICENSE_SETTLE_MS = 600;
const LICENSE_SETTLE_STEP_MS = 20;

/** A license failure stopped a queue song (2026-10-18, QUEUE.md §License heal). Now Playing
 *  holds the song as playing at its spot (holdForHeal). The Apple check runs during the wait:
 *  a revoked or swapped token is healed, an offline network arms the drop's resume, a sign-in
 *  problem shows its own toast. Apple fine → load the song again once, LICENSE_BACK_S before the
 *  stop, silent until it gets there. recoverLoad checks that it ends in sound: silent twice, the
 *  toast. `at` is 0 when the song was never heard (it failed at its start). */
function healLicense(entry: QueueEntry, at: number, msg: string, via: string): void {
  const startedAt = performance.now();
  licenseHealed = { entry, at: startedAt };
  const spot = resumeSpot(at, LICENSE_BACK_S);
  diag.warn("player:licenseHeal", { msg, via, id: playId(entry) ?? null, at: Math.round(at) });
  holdForHeal(entry, spot);
  emit();
  emitModelProgress();
  // The Apple check runs beside the reload, never before it: it took 441 ms uncached in the
  // desk test, and it matters only when the reload fails. Its answer routes a real cause: a
  // sign-in problem or an offline network ends the hold and takes that cause's own path (the
  // reload's give-up toast stays quiet then, recoverLoad).
  void (async () => {
    if (!(await isConnected())) {
      releaseHold("signedOut");
      return health.show("signedOut", true, via);
    }
    const r = await recoverFromFailure(via);
    if (r.trouble === "offline") {
      releaseHold("offline");
      armResume(entry, at, via);
    } else if (r.trouble !== "none") {
      releaseHold(r.trouble); // its own toast shows
    }
  })().catch((e) => console.warn("[player] license heal check:", e));
  void (async () => {
    const settleUntil = performance.now() + LICENSE_SETTLE_MS;
    while (music?.isPlaying && performance.now() < settleUntil) {
      await new Promise((res) => window.setTimeout(res, LICENSE_SETTLE_STEP_MS));
    }
    const m = music;
    if (!m || mode !== "queue" || queue.getCurrent() !== entry || m.isPlaying || isLoading || lastUserPauseAt > startedAt) {
      diag.log("player:licenseHealSkip", { playing: !!m?.isPlaying, same: queue.getCurrent() === entry, loading: isLoading });
      return releaseHold("skip");
    }
    diag.log("player:licenseReload", { spot: Math.round(spot * 10) / 10, waited: Math.round(performance.now() - startedAt) });
    await recoverLoad(m, "licenseHeal", spot);
    // A Pause pressed while the reload ran: the load's play() still started the song.
    if (lastUserPauseAt > startedAt && m.isPlaying) await m.pause();
  })().catch((e) => {
    releaseHold("error");
    console.warn("[player] license heal:", e);
    toast({ kind: "warn", text: "Playback stopped. Try the song again." });
  });
}

/** A network drop stopped a queue song (his calls 2026-09-27): hold the "can't reach" toast
 *  for its first 5 s, check the network at once (never a cached answer), and go on from the
 *  spot as soon as a check passes — at once, or on the fast rechecks (apple-health.ts).
 *  `first` is false for a resume that failed: that is the same drop, so no new quiet time. */
function onDrop(entry: QueueEntry, at: number, via: string, first: boolean): void {
  // MusicKit can report one drop more than once: the rechecks already running pick it up.
  if (resumeAfterReconnect?.entry === entry && health.trouble() === "offline") return;
  if (first) health.quietDrop(health.DROP_QUIET_MS);
  armResume(entry, at, via);
  void (async () => {
    if (!(await isConnected())) return health.show("signedOut", true, via);
    const r = await recoverFromFailure(via, true);
    if (r.trouble === "offline") health.fastRecheck();
    else if (r.trouble === "none" && !first) {
      // Apple answers, yet the resume failed: no loop of resumes. Say so; Play keeps the spot.
      diag.warn("player:resumeGaveUp", { at: Math.round(at) });
      toast({ kind: "warn", text: "Playback stopped. Try the song again." });
    } else if (r.trouble === "none" && resumeAfterReconnect?.entry === entry) {
      // The network is up (it was back before this check, or it never showed as out): go on
      // now. onTrouble does not fire, because the state did not change.
      resumeAfterReconnect = null;
      resumeDropped(entry, at, "atOnce");
    }
    // A sign-in or developer-token problem: its own toast shows, and the spot stays armed.
  })();
}

// A network drop stopped the song (MusicKit's audio player destroys itself on a
// loadSegmentError). When Apple health sees the network back — a drop's fast rechecks, the
// 5-min recheck, Try again, or any other check — pick the song up where it stopped: once,
// queue mode only, and only if nothing has played or changed since (2026-09-14). Play
// before that takes the spot itself (playPause, resume-point.ts).
let lastHeardAt = 0;
type QueueEntry = NonNullable<ReturnType<typeof queue.getCurrent>>;
let resumeAfterReconnect: { entry: QueueEntry; at: number } | null = null;

function armResume(entry: QueueEntry, at: number, via: string): void {
  resumeAfterReconnect = { entry, at };
  diag.log("player:resumeArmed", { at: Math.round(at), via });
}

function resumeDropped(entry: QueueEntry, at: number, why: string): void {
  const m = music;
  if (!m || mode !== "queue" || m.isPlaying || queue.getCurrent() !== entry) {
    diag.log("player:resumeSkip", { mode, playing: !!m?.isPlaying, same: queue.getCurrent() === entry, why });
    return;
  }
  diag.log("player:resumeAfterReconnect", { at: Math.round(at), why });
  void loadAndResumeAt(m, at)
    .catch((e) => console.warn("[player] resume after reconnect:", e))
    .finally(() => {
      // A resume into a network that is still out fails with no error event: MusicKit just
      // drops the song (nowPlayingItem null). A user's pause keeps it. Seen in the desk test
      // 2026-09-27: without this the song stayed stopped, with no toast and no retry.
      window.setTimeout(() => {
        if (mode !== "queue" || queue.getCurrent() !== entry || m.isPlaying || m.nowPlayingItem) return;
        diag.warn("player:resumeFailed", { at: Math.round(at), why });
        onDrop(entry, at, "resumeFailed", false);
      }, RESUME_CONFIRM_MS);
    });
}
const RESUME_CONFIRM_MS = 3000;

/** Reload the model's current song and move it to `sec`, the spot where it stopped, silent
 *  until it gets there (resumeHush). Two ways failed in the desk test of 2026-09-27: a seek right
 *  after the load raced MusicKit's own start at 0 s and stalled the song at 1 s for good, and a
 *  seek before the first sound (`seekMs`) was ignored. So: wait until it plays, seek, and seek
 *  once more if the clock has not reached the spot. Resolves when the song has loaded; the seek
 *  goes on after that. */
async function loadAndResumeAt(m: any, sec: number, opts: LoadOpts = {}): Promise<void> {
  if (sec <= 3) return loadFromModel(m, true, opts); // the opening seconds: start from the top
  hushForResume(true);
  try {
    await loadFromModel(m, true, opts);
  } catch (e) {
    hushForResume(false);
    throw e;
  }
  void seekOnceStarted(m, sec);
}

async function seekOnceStarted(m: any, sec: number): Promise<void> {
  const pause = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
  const reached = async (ms: number): Promise<boolean> => {
    const until = performance.now() + ms;
    while ((m.currentPlaybackTime ?? 0) < sec - 1 && performance.now() < until) await pause(SEEK_POLL_MS);
    return (m.currentPlaybackTime ?? 0) >= sec - 1;
  };
  try {
    const until = performance.now() + SEEK_START_WAIT_MS;
    while (!m.isPlaying && performance.now() < until) await pause(SEEK_POLL_MS);
    if (!m.isPlaying) {
      diag.warn("player:resumeSeek", { at: Math.round(sec), done: false, why: "not playing" });
      return;
    }
    await m.seekToTime(sec);
    const again = !(await reached(1500));
    if (again) await m.seekToTime(sec);
    diag.log("player:resumeSeek", { at: Math.round(sec), done: true, again });
  } finally {
    hushForResume(false); // sound again at the spot (and on every way out)
  }
}
const SEEK_START_WAIT_MS = 8000;
/** Each silent ms here is heard: 20 ms looks (were 100 and 50, 2026-10-18), a few reads each. */
const SEEK_POLL_MS = 20;

health.onTrouble((t) => {
  if (t !== "none" || !resumeAfterReconnect) return;
  const { entry, at } = resumeAfterReconnect;
  resumeAfterReconnect = null;
  resumeDropped(entry, at, "reconnect");
});

// index.html routes every non-benign MusicKit alert() here; drain what arrived first.
window.__deetsMkAlert = (msg: string) => onMusicKitTrouble(String(msg), "alert");
for (const msg of (window.__deetsMkAlerts ?? []).splice(0)) onMusicKitTrouble(String(msg), "alert");

// Dev-only: the no-subscription hint (DEBUGGING.md §Toasts). `armNoSub` marks a fresh
// sign-in and waits for a real playback error; `noSub` also feeds onPlaybackError a
// synthetic one. Both go through the real guards, so a song must be playing from a queue.
if (import.meta.env.DEV) {
  window.__toast.sim = {
    ...window.__toast.sim,
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
export async function prevTrack(from = "button"): Promise<void> {
  logPress("prev", from);
  transport("prev");
  if (roomBridge) return roomBridge.previous();
  if (skipWhileIdle("prev")) return;
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
  if (await skipCopyByLoad(m, -1)) return;
  if (typeof m.skipToPreviousItem === "function") await m.skipToPreviousItem();
}

/**
 * A skip onto an adjacent copy of the song playing (QUEUE.md § Repeats in one insert): MusicKit
 * takes a skip to the same id as no change of song, so the copy never starts. Move the model
 * one step and load from it, as a click on a Queue row does (his call, 2026-10-01: the ~1 s load
 * only on this skip; every other skip stays gapless). False: not such a skip.
 */
async function skipCopyByLoad(m: any, dir: 1 | -1): Promise<boolean> {
  if (mode !== "queue") return false;
  const ids: (string | undefined)[] = (m.queue?.items ?? []).map((it: any) => it?.id);
  const np = typeof m.nowPlayingItemIndex === "number" ? m.nowPlayingItemIndex : -1;
  if (!skipToSameId(ids, np, dir)) return false;
  if (dir === 1 ? !queue.peekNext() : !queue.getHistory().length) return false;
  diag.log("player:copySkip", { dir, id: ids[np] ?? null, np });
  // Forward goes to the next FED row: the copy MusicKit holds, past any Suggest Less row.
  if (dir === 1) jumpToNextFed("copySkip");
  else queue.previous();
  await loadFromModel(m);
  return true;
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
watchSet("player.volume", volumeListeners);
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
  if (Math.abs(next - (muted ? 0 : level * duck * clipDuck)) < 0.01) return; // the echo of our own write
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

// A resume after a network drop (TOASTS.md §5, his call 2026-09-27): silent from the reload
// until the jump to the spot, so the song's opening is never heard. Like the ducks, a factor on
// MusicKit's gain only: the slider, the saved level and a speaker's own volume never see it
// (with a speaker, MusicKit's gain silences the stream it sends). It can never outlast
// RESUME_HUSH_MAX_MS, whatever fails on the way.
//
// Two reasons hold it, each with its own cap timer, so one never clears the other: the resume,
// and a Suggest Less skip on a station (SUGGEST-LESS.md §5b), which hushes the marked song from
// its arrival until the next song arrives.
type HushReason = "resume" | "suggest";
const hushReasons = new Set<HushReason>();
const hushTimers = new Map<HushReason, number>();
const RESUME_HUSH_MAX_MS = 12_000;
function hush(reason: HushReason, on: boolean, maxMs = RESUME_HUSH_MAX_MS): void {
  window.clearTimeout(hushTimers.get(reason));
  if (on) hushTimers.set(reason, window.setTimeout(() => hush(reason, false), maxMs));
  if (on === hushReasons.has(reason)) return;
  if (on) hushReasons.add(reason);
  else hushReasons.delete(reason);
  diag.log(reason === "resume" ? "player:resumeHush" : "suggest:hush", { on });
  applyVolumeToMusic();
}
const hushForResume = (on: boolean): void => hush("resume", on);

function applyVolumeToMusic(): void {
  volumeListeners.forEach((cb) => cb());
  if (!music) return;
  try {
    music.volume = hushReasons.size ? 0 : volumeSink ? 1 : muted ? 0 : level * duck * clipDuck;
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
  if (volumeSink) volumeSink(muted ? 0 : level * duck * clipDuck);
}

export function getDuck(): number {
  return duck;
}

// A sound clip's duck (RULEZ.md §5.3, sound.ts `playClip`): its own factor, multiplied with the
// wind-down's, so a clip during a sleep fade never overwrites the fade (and the fade never ends
// the clip's duck). The slider does not show it: it is a moment, not your level.
let clipDuck = 1;
export function setClipDuck(f: number): void {
  const next = Math.max(0, Math.min(1, f));
  if (next === clipDuck) return;
  clipDuck = next;
  applyVolumeToMusic();
  if (volumeSink) volumeSink(muted ? 0 : level * duck * clipDuck);
}
/** A speaker holds the volume: each write goes over the network, so a ramp is one step. */
export const volumeOnSpeaker = (): boolean => !!volumeSink;

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

/** The stream's bitrate now, kbps (256 or 64); null before MusicKit is up. The Network panel. */
export const streamKbps = (): number | null => (typeof music?.bitrate === "number" ? music.bitrate : null);

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
  return volumeSink ? 1 : muted ? 0 : level * duck * clipDuck;
}

/** Pause, if anything plays. No sign-in check: pausing never needs one. */
export async function pausePlayback(why = "sleep"): Promise<void> {
  // A deliberate pause (sleep timer, rule, lost speaker): a recovery load's check must not
  // start the music again (2026-09-29). Stamped even when silent: the load may still start.
  lastUserPauseAt = performance.now();
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
    volumeSink(muted ? 0 : level * duck * clipDuck); // the speaker's volume is the speaker's to keep
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
