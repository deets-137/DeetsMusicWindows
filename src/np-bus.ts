// Now-playing bus (TRAY.md §2) — the main window's half of the hub in `bridge.rs`.
//
// Publishes the player's state + progress + volume to Rust (`np_publish`), which
// mirrors it to the tray panel and the `/now-playing` debug route; executes the
// transport commands the panel sends back (`np-command`); reloads the shared track
// store when the extension/tray adds a song (`library-changed`); and reports the
// active theme/skin so the panel and the extension popup can match the app.
//
// A pure consumer of the player's broadcasts: it never
// touches MusicKit directly.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  onPlayerState,
  onPlayerProgress,
  playPause,
  nextTrack,
  prevTrack,
  seekToFraction,
  getVolume,
  setVolume,
  toggleMute,
  isMuted,
  type PlayerState,
  type PlayerProgress,
} from "./player";
import * as queue from "./queue";
import { resolveEntry } from "./queue-rows";
import { addTrackToLibrary } from "./library-add";
import { favoriteOffered, isLoved, toggleLoved, onFavoritesChange } from "./favorites";
import { inLibrary, loadTracks, onTracksChange } from "./track-store";
import { playTracks, playTracksKeepQueue, queueTracksAt, queueTracksNext, queueTracksLater, playStation, reconcileUpcoming } from "./player";
import { toggleShuffle, setShuffleMode, cycleRepeat, setRepeat, getRepeat, isShuffleOn } from "./player";
import { runAgentWrite } from "./agent-writes";
import { materializeTrack } from "./search";
import type { Track } from "./library";
import type { Station } from "./radio";
import { log, events as diagEvents } from "./diag";
import { onToast, type ToastKind } from "./toast";
import { playlistCoverFor, onPlaylistCoverChange } from "./playlist-cover";

export interface NpState {
  active: boolean;
  playing: boolean;
  /** The station's name while one plays (radio mode) — the overlay's album line. */
  station?: string;
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  artworkTemplate?: string;
  /** "Show cover: Playlist" — the playlist's saved cover, for the tray panel only. The
   *  Windows media overlay and AirPlay keep `artworkUrl`/`artworkTemplate` (PLAYLISTS.md §11). */
  coverUrl?: string;
  catalogId?: string;
  inLibrary: boolean;
  /** ♥ for the tray panel's right-click: null = not offered (no consent / no catalog id). */
  loved: boolean | null;
  live: boolean;
  progress: number;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  /** The two modes (NEXT-VERSION §12, §14) — for the agent snapshot; the tray panel ignores them. */
  repeat: "off" | "all" | "one";
  shuffle: boolean;
}

interface NpCommand {
  kind: string;
  value?: number;
  from?: string; // tray | windows | airplay (bridge.rs NpCommand)
}

let lastState: PlayerState = { playing: false, repeat: "off", shuffle: false };
let lastProgress: PlayerProgress = { progress: 0, currentTime: 0, duration: 0 };

function snapshot(): NpState {
  const cur = queue.getCurrent();
  const t = cur ? resolveEntry(cur) : undefined;
  const catalogId = cur?.catalogId ?? t?.catalogId;
  // MusicKit's item first; the model's current fills in when MusicKit holds nothing (a
  // restored session before the first Play) — the same gap-fill the Now Playing card does.
  const title = lastState.title ?? t?.title;
  return {
    active: !!title,
    playing: lastState.playing,
    station: lastState.station?.name,
    title,
    artist: lastState.artist ?? t?.artistName ?? lastState.station?.name,
    album: lastState.album ?? t?.albumName,
    artworkUrl: lastState.artworkUrl,
    artworkTemplate: t?.artwork?.urlTemplate,
    coverUrl: lastState.station ? undefined : playlistCoverFor(cur?.context, 480),
    catalogId,
    inLibrary: inLibrary(catalogId) || inLibrary(cur?.libraryId),
    loved: favoriteOffered(t) ? isLoved(t) : null,
    live: !!lastState.station?.live,
    progress: lastProgress.progress,
    currentTime: lastProgress.currentTime,
    duration: lastProgress.duration,
    volume: getVolume(),
    muted: isMuted(),
    repeat: getRepeat(),
    shuffle: isShuffleOn(),
  };
}

// Progress ticks arrive ~4/s; the panel interpolates, so 1/s is plenty for IPC.
let lastProgressPublish = 0;
export function publish(force = false): void {
  const now = performance.now();
  if (!force && now - lastProgressPublish < 1000) return;
  lastProgressPublish = now;
  invoke("np_publish", { state: snapshot() }).catch((e) => console.warn("[np-bus] publish", e));
}

/**
 * Tell Rust (→ tray panel, → extension /health) which theme × skin is live, and with it
 * the rest of the context `/health` reports: surface, Sound on, record player. The
 * heaviness sampler reads that line, so a heavy sample says what the app was doing
 * (DEBUGGING.md §2026-09-17 review, item 1). Cheap: one IPC call, only on a change.
 */
let soundOn = false;

/** sound.ts calls this when Advanced EQ / Adaptive Sound starts or stops routing audio. */
export function noteSound(on: boolean): void {
  if (on === soundOn) return;
  soundOn = on;
  publishAppearance();
}

export function publishAppearance(): void {
  const root = document.documentElement;
  invoke("appearance_publish", {
    theme: root.dataset.theme ?? "",
    skin: root.dataset.skin ?? "",
    surface: root.dataset.surface ?? "",
    sound: soundOn,
    vinyl: root.dataset.pressVinyl ?? "off",
  }).catch(() => {});
}

async function run(cmd: NpCommand): Promise<void> {
  log("np-bus:command", cmd);
  switch (cmd.kind) {
    case "play-pause":
      return playPause(cmd.from ?? "tray");
    case "play": // a HomePod's touch surface / Siri, relayed by airplay.rs
      if (!lastState.playing) return playPause(cmd.from ?? "tray");
      return;
    case "pause":
      if (lastState.playing) return playPause(cmd.from ?? "tray");
      return;
    case "next":
      return nextTrack();
    case "previous":
      return prevTrack();
    case "seek":
      return seekToFraction(cmd.value ?? 0);
    case "volume":
      setVolume(cmd.value ?? 0);
      return publish(true);
    case "mute":
      toggleMute();
      return publish(true);
    case "add-to-library": {
      const cur = queue.getCurrent();
      const t = cur ? resolveEntry(cur) : undefined;
      if (!t) throw new Error("no current track to add");
      await addTrackToLibrary(t);
      return publish(true);
    }
    case "favorite": { // the tray panel's right-click ♥ (toggles; favorites.ts rolls back on error)
      const cur = queue.getCurrent();
      const t = cur ? resolveEntry(cur) : undefined;
      if (!favoriteOffered(t)) throw new Error("no current track to favorite");
      await toggleLoved(t);
      return publish(true);
    }
    default:
      console.warn("[np-bus] unknown command", cmd);
  }
}

// ── Agent requests (AGENT.md) — the bridge's /command /play /queue /history routes.
// Rust emits `agent-request` {id, kind, payload}; we run it against the player/queue
// and answer with `agent_reply`. Tracks arriving from the catalog are materialized so
// the queue rows and the play log resolve their metadata.

interface AgentRequest {
  id: number;
  kind: string;
  payload: any;
}

const trackOf = (e: queue.QueueEntry): Track | { catalogId?: string; libraryId?: string } =>
  resolveEntry(e) ?? { catalogId: e.catalogId, libraryId: e.libraryId };

async function runAgent(kind: string, payload: any): Promise<unknown> {
  switch (kind) {
    case "command": {
      const k = String(payload?.kind ?? "");
      const v = typeof payload?.value === "number" ? payload.value : undefined;
      switch (k) {
        case "play-pause": await playPause("agent"); break;
        case "play": if (!lastState.playing) await playPause("agent"); break;
        case "pause": if (lastState.playing) await playPause("agent"); break;
        case "next": await nextTrack(); break;
        case "previous": await prevTrack(); break;
        case "seek": await seekToFraction(v ?? 0); break;
        case "volume": setVolume(v ?? 0); break;
        case "mute": toggleMute(); break;
        case "shuffle": await toggleShuffle(); break; // as the button: the mode, or once
        case "shuffle-on": setShuffleMode(true); break;
        case "shuffle-off": setShuffleMode(false); break;
        case "repeat": cycleRepeat(); break;
        case "repeat-off": setRepeat("off"); break;
        case "repeat-all": setRepeat("all"); break;
        case "repeat-one": setRepeat("one"); break;
        case "clear": {
          // Drop every upcoming entry (the current song keeps playing), then re-sync MusicKit.
          for (let i = queue.getUpcoming().length - 1; i >= 0; i--) queue.removeAt(i);
          await reconcileUpcoming();
          break;
        }
        default: throw new Error(`unknown command ${JSON.stringify(k)}`);
      }
      publish(true);
      return snapshot();
    }
    case "play-station": {
      const s = payload?.station as Station | undefined;
      if (!s?.id) throw new Error("nothing to play: no station");
      await playStation(s);
      return { ok: true, station: s };
    }
    case "play":
    case "queue": {
      const tracks = (payload?.tracks ?? []) as Track[];
      if (!tracks.length) throw new Error("nothing to play");
      tracks.forEach(materializeTrack);
      const at = Number(payload?.at);
      if (kind === "play") await (payload?.keepQueue ? playTracksKeepQueue(tracks, "agent") : playTracks(tracks, 0, "agent"));
      else if (Number.isInteger(at) && at >= 1) await queueTracksAt(at - 1, tracks, "agent"); // 1 = top of Up Next
      else if (payload?.mode === "later") await queueTracksLater(tracks, "agent");
      else await queueTracksNext(tracks, "agent");
      return { ok: true, tracks };
    }
    case "queue-get": {
      const cur = queue.getCurrent();
      return {
        current: cur ? trackOf(cur) : null,
        upcoming: queue.getUpcoming().map(trackOf),
        history: queue.getHistory().filter((e) => e.played).map(trackOf),
      };
    }
    case "history-get": {
      const limit = Math.max(1, Math.min(200, Number(payload?.limit) || 50));
      return { plays: [...queue.getPlayLog()].reverse().slice(0, limit).map(trackOf) };
    }
    // The live diag ring (LOGGING.md §Reading it from outside). The file only ever has
    // what a flush has written; this reads the buffer in the window, now. Oldest first,
    // so the reply reads as a story. `tag` keeps the tags that START with it
    // ("player" takes player:np, player:reclick …).
    case "diag-get": {
      const limit = Math.max(1, Math.min(300, Number(payload?.limit) || 100));
      const since = Number(payload?.since) || 0;
      const tag = String(payload?.tag ?? "").trim();
      const all = diagEvents().filter((e) => e.n > since && (!tag || e.tag.startsWith(tag)));
      return { events: all.slice(-limit), dropped: Math.max(0, all.length - limit) };
    }
    case "queue-edit": {
      await runAgentWrite(kind, payload);
      return runAgent("queue-get", null); // the fresh numbering, so the next edit's row is right
    }
    default: {
      const write = runAgentWrite(kind, payload); // library · playlist · folder · update (agent-writes.ts)
      if (write) return write;
      throw new Error(`unknown request ${JSON.stringify(kind)}`);
    }
  }
}

// Agent notices (AGENT.md §3): the warn/error toasts raised while an agent request runs
// ride its reply as `notices`, whatever the user's Show notices tier — the agent needs
// to know the command went wrong so it can correct it. The window still shows them per
// the tier. Requests that start playback wait NOTICE_GRACE_MS after they finish: the
// dead-song toast collects names for 1 s, and a playback error lands after the start.
const NOTICE_GRACE_MS = 1500;
const NOTICE_KINDS: ReadonlySet<ToastKind> = new Set(["warn", "error"]);
const startsPlayback = (kind: string, payload: any): boolean =>
  kind === "play" || kind === "queue" || kind === "play-station" ||
  (kind === "queue-edit" && payload?.action === "jump") ||
  (kind === "command" && ["next", "previous", "play", "play-pause"].includes(String(payload?.kind)));

async function runAgentWithNotices(kind: string, payload: any): Promise<unknown> {
  if (kind === "queue-get" || kind === "history-get" || kind === "update-get" || kind === "settings-get" || kind === "grow-get" || kind === "diag-get") return runAgent(kind, payload);
  const notices: { kind: ToastKind; text: string }[] = [];
  const off = onToast((t) => {
    if (NOTICE_KINDS.has(t.kind)) notices.push(t);
  });
  const grace = () =>
    startsPlayback(kind, payload) ? new Promise((r) => window.setTimeout(r, NOTICE_GRACE_MS)) : Promise.resolve();
  try {
    const result = await runAgent(kind, payload);
    await grace();
    return notices.length && result && typeof result === "object" ? { ...result, notices } : result;
  } catch (e) {
    // A failure's raw text is MusicKit's ("One or more items could not be resolved: 0");
    // the toasts say it plainly, so they ride the error string (agent_json's status
    // mapping reads the prefix only).
    await grace();
    if (!notices.length) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${msg} — ${notices.map((n) => n.text).join(" · ")}`);
  } finally {
    off();
  }
}

export function initNpBus(): void {
  listen<AgentRequest>("agent-request", (e) => {
    const { id, kind, payload } = e.payload;
    log("np-bus:agent", { id, kind });
    runAgentWithNotices(kind, payload).then(
      (result) => invoke("agent_reply", { id, ok: true, result }),
      (err) => invoke("agent_reply", { id, ok: false, error: err instanceof Error ? err.message : String(err) }),
    ).catch((err) => console.error("[np-bus] agent reply failed", err));
  });

  onPlayerState((s) => {
    lastState = s;
    publish(true);
  });
  onPlayerProgress((p) => {
    lastProgress = p;
    publish();
  });
  // Library membership changes (sync, an add from the tray/extension) flip the "+".
  onTracksChange(() => publish(true), "np-bus.publish");
  onFavoritesChange(() => publish(true)); // the tray's ♥ label follows a ♥ set anywhere
  // "Show cover" flipped or a playlist's cover changed: the tray panel's cover follows.
  onPlaylistCoverChange(() => publish(true));

  listen<NpCommand>("np-command", (e) => {
    run(e.payload).catch((err) => console.error("[np-bus] command failed:", e.payload, err));
  });
  // The bridge added a song on our behalf — reflect it in the Library card.
  listen("library-changed", () => {
    log("np-bus:library-changed");
    loadTracks().catch((e) => console.warn("[np-bus] reload after add", e));
  });

  // Volume edits from the titlebar don't go through player state; poll cheaply.
  let lastVol = -1;
  let lastMuted = false;
  window.setInterval(() => {
    const v = getVolume();
    const m = isMuted();
    if (v !== lastVol || m !== lastMuted) {
      lastVol = v;
      lastMuted = m;
      publish(true);
    }
  }, 500);

  publishAppearance();
  publish(true);
}
