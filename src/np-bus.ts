// Now-playing bus (TRAY.md §2) — the main window's half of the hub in `bridge.rs`.
//
// Publishes the player's state + progress + volume to Rust (`np_publish`), which
// mirrors it to the tray panel and the `/now-playing` debug route; executes the
// transport commands the panel sends back (`np-command`); reloads the shared track
// store when the extension/tray adds a song (`library-changed`); and reports the
// active theme/skin so the panel and the extension popup can match the app.
//
// A pure consumer of the player's broadcasts, like media-session.ts: it never
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
import { inLibrary, loadTracks, onTracksChange } from "./track-store";
import { playTracks, queueTracksNext, queueTracksLater, shuffleQueue, playStation, reconcileUpcoming } from "./player";
import { materializeTrack } from "./search";
import type { Track } from "./library";
import type { Station } from "./radio";
import { log } from "./diag";

export interface NpState {
  active: boolean;
  playing: boolean;
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  artworkTemplate?: string;
  catalogId?: string;
  inLibrary: boolean;
  live: boolean;
  progress: number;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
}

interface NpCommand {
  kind: string;
  value?: number;
}

let lastState: PlayerState = { playing: false };
let lastProgress: PlayerProgress = { progress: 0, currentTime: 0, duration: 0 };

function snapshot(): NpState {
  const cur = queue.getCurrent();
  const t = cur ? resolveEntry(cur) : undefined;
  const catalogId = cur?.catalogId ?? t?.catalogId;
  return {
    active: !!lastState.title,
    playing: lastState.playing,
    title: lastState.title,
    artist: lastState.artist ?? lastState.station?.name,
    album: lastState.album,
    artworkUrl: lastState.artworkUrl,
    artworkTemplate: t?.artwork?.urlTemplate,
    catalogId,
    inLibrary: inLibrary(catalogId) || inLibrary(cur?.libraryId),
    live: !!lastState.station?.live,
    progress: lastProgress.progress,
    currentTime: lastProgress.currentTime,
    duration: lastProgress.duration,
    volume: getVolume(),
    muted: isMuted(),
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

/** Tell Rust (→ tray panel, → extension /health) which theme × skin is live. */
export function publishAppearance(): void {
  const root = document.documentElement;
  invoke("appearance_publish", { theme: root.dataset.theme ?? "", skin: root.dataset.skin ?? "" }).catch(() => {});
}

async function run(cmd: NpCommand): Promise<void> {
  log("np-bus:command", cmd);
  switch (cmd.kind) {
    case "play-pause":
      return playPause();
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
        case "play-pause": await playPause(); break;
        case "play": if (!lastState.playing) await playPause(); break;
        case "pause": if (lastState.playing) await playPause(); break;
        case "next": await nextTrack(); break;
        case "previous": await prevTrack(); break;
        case "seek": await seekToFraction(v ?? 0); break;
        case "volume": setVolume(v ?? 0); break;
        case "mute": toggleMute(); break;
        case "shuffle": await shuffleQueue(); break;
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
      if (kind === "play") await playTracks(tracks, 0, "agent");
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
    default:
      throw new Error(`unknown request ${JSON.stringify(kind)}`);
  }
}

export function initNpBus(): void {
  listen<AgentRequest>("agent-request", (e) => {
    const { id, kind, payload } = e.payload;
    log("np-bus:agent", { id, kind });
    runAgent(kind, payload).then(
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
  onTracksChange(() => publish(true));

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
