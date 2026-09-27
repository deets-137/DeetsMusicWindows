// Rulez's playback words (docs/architecture/RULES.md §20.3): the events a song and the
// transport report, the facts about the song playing, the actions a rule can take on the
// player, and the volume as a property a While rule can hold.
//
// The player does not know rules exist: this module watches its state and its transport hook
// and reports to the engine. It reads only what the app already holds (the queue, the library,
// MusicKit's own item): no fact calls Apple. *Play a playlist* and *Play a station* are the two
// Apple actions; the engine's guards cover them (RULES.md §20.5).

import {
  getRepeat, getVolume, isShuffleOn, nextTrack, nowPlayingMeta, onPlayerProgress, onPlayerState, onTransport,
  pausePlayback, playPause, playStation, playTracks, prevTrack, setRepeat, setShuffleMode, setVolume,
  isPlayingNow, onVolumeChange, type PlayerState,
} from "./player";
import { getCurrent, getUpcoming } from "./queue";
import { trackById } from "./track-store";
import { playlistsCached, playlistTracks } from "./playlists";
import { radioDiscovery, radioSpecialPeek, type Station } from "./radio";
import type { Playlist } from "./search";
import { emit, recheck, registerAction, registerEvent, registerFact, registerProp } from "./rules";
import * as diag from "./diag";

/** The song key now: what changes when a new song plays. */
const keyNow = (s?: PlayerState): string => {
  const c = getCurrent();
  return (c?.catalogId ?? c?.libraryId ?? "") || (s?.title ? `${s.title}|${s.artist ?? ""}` : "");
};

const trackNow = () => {
  const c = getCurrent();
  return c ? trackById(c.catalogId) ?? trackById(c.libraryId) : undefined;
};

/** Where the song came from, by the queue entry's context tag (`album:…`, `playlist:…`). */
function sourceNow(station: boolean): string | undefined {
  if (station) return "station";
  const ctx = getCurrent()?.context ?? "";
  if (!ctx) return undefined;
  const kind = ctx.split(":")[0];
  return ["album", "playlist", "library", "artist"].includes(kind) ? kind : "library";
}

// ── the playlists a rule may play (an Apple action checks its target is still there) ──
let playlistIds = new Set<string>();
const pidOf = (p: Playlist) => p.libraryId ?? p.catalogId ?? p.name;
async function refreshPlaylists(): Promise<Playlist[]> {
  const list = await playlistsCached();
  playlistIds = new Set(list.map(pidOf));
  return list;
}

// ── the volume, held by a While rule (a property, RULES.md §20.4) ──
let volBase: number | null = null; // your volume before the rule laid its own
let volLaid: number | null = null;
function applyVolume(v: unknown): void {
  if (typeof v === "number") {
    if (volBase === null) volBase = getVolume();
    volLaid = Math.max(0, Math.min(100, v)) / 100;
    setVolume(volLaid);
    diag.log("rule:volume", { laid: Math.round(volLaid * 100) });
    return;
  }
  // The rule ended: give your volume back, unless you moved it meanwhile (your change wins).
  if (volBase === null) return; // no rule laid one (the engine's first check at launch)
  if (volLaid !== null && Math.abs(getVolume() - volLaid) < 0.01) setVolume(volBase);
  diag.log("rule:volume", { back: Math.round(volBase * 100) });
  volBase = volLaid = null;
}

export function initRulesPlayback(): void {
  let last: PlayerState | null = null; // the player's last state (the facts read it too)
  for (const e of ["song.play", "song.end", "music.pause", "music.resume", "skip.next", "skip.prev", "queue.end", "station.play", "station.return"] as const)
    registerEvent(e, { facts: [] });

  const meta = () => nowPlayingMeta();
  registerFact("genre", () => trackNow()?.genres?.filter((g) => g !== "Music") ?? meta().genres?.filter((g) => g !== "Music"));
  registerFact("artist", () => trackNow()?.artistName ?? last?.artist);
  registerFact("album", () => trackNow()?.albumName ?? last?.album);
  registerFact("year", () => {
    const d = trackNow()?.releaseDate;
    return (d ? Number(d.slice(0, 4)) || undefined : undefined) ?? meta().year;
  });
  registerFact("explicit", () => {
    const r = trackNow()?.contentRating;
    return r ? r === "explicit" : meta().explicit;
  });
  // The facts a While rule reads between events have a seam, so the check runs when they move.
  const onState = (cb: () => void) => onPlayerState(() => cb());
  registerFact("playing", () => isPlayingNow(), { seam: onState });
  registerFact("shuffle", () => isShuffleOn(), { seam: onState });
  registerFact("repeat", () => getRepeat(), { seam: onState });
  registerFact("volume", () => Math.round(getVolume() * 100), { seam: onVolumeChange });
  registerFact("source", () => sourceNow(!!last?.station));

  registerAction("play", { cost: "free", run: () => (isPlayingNow() ? undefined : playPause("rule")) });
  registerAction("pause", { cost: "free", run: () => pausePlayback("rule") });
  registerAction("next", { cost: "free", run: () => nextTrack() });
  registerAction("prev", { cost: "free", run: () => prevTrack() });
  registerAction("shuffle", { cost: "free", run: (on) => setShuffleMode(!!on) });
  registerAction("repeat", { cost: "free", run: (m) => setRepeat(m as "off" | "all" | "one") });
  registerAction("volume", { cost: "free", run: (v) => setVolume(Math.max(0, Math.min(100, Number(v))) / 100) });
  registerAction("playPlaylist", {
    cost: "apple",
    exists: (id) => playlistIds.has(String(id)),
    run: async (id) => {
      const list = await refreshPlaylists();
      const p = list.find((x) => pidOf(x) === id);
      if (!p) return;
      const tracks = await playlistTracks(p);
      if (tracks.length) await playTracks(tracks, 0, `playlist:${id}`);
    },
  });
  // A recipe names the Discovery station by `special` (its id is yours: `ra.q-…`).
  const stationOf = (s: unknown): Station | undefined => {
    const x = s as (Station & { special?: string }) | null;
    if (x?.special === "discovery") return radioSpecialPeek().find((st) => st.id.startsWith("ra.q-"));
    return x?.id ? x : undefined;
  };
  registerAction("playStation", {
    cost: "apple",
    exists: (s) => !!stationOf(s) || (s as { special?: string })?.special === "discovery",
    run: async (s) => {
      const st = stationOf(s) ?? ((s as { special?: string })?.special === "discovery" ? await radioDiscovery() : null);
      if (st) await playStation(st);
    },
  });
  registerProp("volume", { apply: applyVolume, off: null });
  void refreshPlaylists().catch(() => {});

  onTransport((way) => emit(way === "next" ? "skip.next" : "skip.prev", { card: "*" }));

  // ── the song and pause events, from the player's state ──
  let lastKey = "";
  let paused = false;
  let pauseTimer = 0;
  let progress = { at: 0, dur: 0 };
  let heardKey = ""; // the song the progress below belongs to
  onPlayerProgress((p) => {
    progress = { at: p.currentTime, dur: p.duration };
    heardKey = keyNow();
  });
  const nearEnd = () => progress.dur > 0 && progress.at >= progress.dur - 3;

  onPlayerState((s) => {
    const prev = last;
    last = s;
    if (s.loading) return;
    const key = keyNow(s);
    if (s.station?.id && s.station.id !== prev?.station?.id) emit("station.play", { card: "*" });
    if (key && key !== lastKey && s.playing) {
      // The song before this one reached its end on its own: a song ended.
      if (lastKey && heardKey === lastKey && nearEnd()) emit("song.end", { card: "*" });
      lastKey = key;
      paused = false;
      window.clearTimeout(pauseTimer);
      emit("song.play", { card: "*" });
      return;
    }
    if (key !== lastKey) return;
    if (prev?.playing && !s.playing) {
      // A pause settles first: a skip passes through "not playing" for a moment.
      window.clearTimeout(pauseTimer);
      pauseTimer = window.setTimeout(() => {
        if (isPlayingNow() || keyNow() !== key) return;
        paused = true;
        if (nearEnd() && !getUpcoming().length) {
          emit("song.end", { card: "*" });
          emit("queue.end", { card: "*" });
        } else emit("music.pause", { card: "*" });
      }, 400);
    } else if (!prev?.playing && s.playing && paused) {
      paused = false;
      emit("music.resume", { card: "*" });
    }
  });
  recheck("playback");
}
