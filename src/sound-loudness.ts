// Match loudness (SOUND.md §3A — phase 5): every song at one perceived loudness.
//
// Measure: while Adaptive sound is on (Match loudness on or off), each routed element's worklet sends its K-weighted mean
// square and sample peak every 100 ms (sound-worklet.ts, before the match gain). This module
// divides MusicKit's volume back out (it acts before the graph, §0), groups the hops into
// 400 ms blocks with 75 % overlap, and at the end of the listen gates them (BS.1770-4) into
// one integrated loudness. The listen counts when 80 % of the song was heard with no jump
// forward; then one row goes to SQLite (loudness.rs) and the in-memory map.
//
// Apply: at each song start, the gain is target − loudness, from (in order) the album's
// loudness when the album plays in order, the song's own, or the library's median gain;
// capped so the song's peak sits at most 2 dB over the limiter's ceiling. It ramps in 50 ms
// on the element nodes. A song measured during this listen gets its own gain next time.
//
// Cost: two biquads and a sum per sample on the audio thread, 10 small messages a second,
// one SQLite row per song. No Apple calls.

import { invoke } from "@tauri-apps/api/core";
import * as sound from "./sound";
import { onListen } from "./stats";
import { getAppliedGain, isPlayingNow, isShuffleOn } from "./player";
import { integratedLufs } from "./sound-dsp";
import { trackById, tracks, onTracksChange } from "./track-store";
import { albumKey } from "./rewind";
import { setting, onSettingsChange, adaptiveOn } from "./settings-store";
import type { TrackHandle } from "./queue";
import type { Track } from "./library";
import * as diag from "./diag";

/** A listen counts once this much of the song was heard (SOUND.md §3A). */
const HEARD_TO_COUNT = 0.8;
/** The limiter may take this much off a song's peak before the gain is capped instead. */
const LIMITER_SHARE_DB = 2;
/** No song is moved further than this, either way. */
const MAX_GAIN_DB = 12;
/** MusicKit's volume below this (−40 dB) leaves too little signal to divide back out. */
const MIN_APPLIED_GAIN = 0.01;

interface Measured {
  lufs: number;
  peakDb: number;
}
const measured = new Map<string, Measured>();
let loaded = false;

/** What decided the gain of the song that plays now (the panel's status line reads this). */
export type GainSource =
  | { kind: "off" }
  | { kind: "idle" }
  | { kind: "song"; lufs: number; gainDb: number; cappedFrom?: number }
  | { kind: "album"; lufs: number; gainDb: number; measured: number; total: number; cappedFrom?: number }
  | { kind: "median"; gainDb: number; songs: number; cappedFrom?: number }
  | { kind: "none" };

interface Listen {
  id: string;
  handle: TrackHandle;
  track?: Track;
  /** 100 ms hops (volume divided out), the last four, and the 400 ms blocks made of them. */
  ring: number[];
  blocks: number[];
  peak: number;
  heardSec: number;
  durationSec: number;
  lastSec?: number;
  jumped: boolean;
  source: GainSource;
}
let listen: Listen | null = null;

const idOf = (h: TrackHandle): string | undefined => h.catalogId ?? h.libraryId;
const lookup = (h: TrackHandle): Track | undefined => trackById(h.catalogId) ?? trackById(h.libraryId);
const toDb = (g: number) => 20 * Math.log10(Math.max(g, 1e-12));

const subs = new Set<() => void>();
export function onLoudnessChange(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}
const emit = () => subs.forEach((cb) => cb());

// ── The library's view: the median gain and an album's loudness ─────────────────────

let medianCache: { gainDb: number; songs: number } | null = null;
function median(): { gainDb: number; songs: number } | null {
  if (!measured.size) return null;
  if (medianCache) return medianCache;
  const lufs = [...measured.values()].map((m) => m.lufs).sort((a, b) => a - b);
  const mid = lufs.length >> 1;
  const m = lufs.length % 2 ? lufs[mid] : (lufs[mid - 1] + lufs[mid]) / 2;
  medianCache = { gainDb: setting("soundLoudTarget") - m, songs: lufs.length };
  return medianCache;
}

/** An album's loudness: its measured songs' energy, weighted by length (as one long track). */
function album(key: string): { lufs: number; peakDb: number; measured: number; total: number } | null {
  let energy = 0, weight = 0, peakDb = -Infinity, count = 0, total = 0;
  for (const t of tracks()) {
    if (albumKey(t) !== key) continue;
    total++;
    const m = measured.get(t.catalogId ?? "") ?? measured.get(t.libraryId ?? "");
    if (!m) continue;
    const w = (t.durationMs ?? 180_000) / 1000;
    energy += w * Math.pow(10, m.lufs / 10);
    weight += w;
    peakDb = Math.max(peakDb, m.peakDb);
    count++;
  }
  return count ? { lufs: 10 * Math.log10(energy / weight), peakDb, measured: count, total } : null;
}

// ── The gain for a song ─────────────────────────────────────────────────────────────

function capped(gainDb: number, peakDb: number | undefined): { gainDb: number; cappedFrom?: number } {
  let g = Math.max(-MAX_GAIN_DB, Math.min(MAX_GAIN_DB, gainDb));
  if (peakDb !== undefined) {
    const room = sound.getSound().ceilingDb + LIMITER_SHARE_DB - peakDb;
    if (g > room) return { gainDb: room, cappedFrom: g };
  }
  return { gainDb: g };
}

function decide(h: TrackHandle, track: Track | undefined): GainSource {
  if (!adaptiveOn() || !setting("soundLoudness")) return { kind: "off" };
  const target = setting("soundLoudTarget");
  if (track && setting("soundLoudAlbum") && !isShuffleOn()) {
    const key = albumKey(track);
    if (h.context === `album:${key}`) {
      const a = album(key);
      if (a) return { kind: "album", lufs: a.lufs, measured: a.measured, total: a.total, ...capped(target - a.lufs, a.peakDb) };
    }
  }
  const id = idOf(h);
  const m = id ? measured.get(id) : undefined;
  if (m) return { kind: "song", lufs: m.lufs, ...capped(target - m.lufs, m.peakDb) };
  const med = setting("soundLoudUnmeasured") === "median" ? median() : null;
  if (med) return { kind: "median", songs: med.songs, ...capped(med.gainDb, undefined) };
  return { kind: "none" };
}

function apply(): void {
  if (!listen) {
    sound.setMatchGain(0);
    emit();
    return;
  }
  listen.source = decide(listen.handle, listen.track);
  const s = listen.source;
  const gainDb = "gainDb" in s ? s.gainDb : 0;
  sound.setMatchGain(gainDb);
  if (s.kind !== "off") diag.log("sound:match", { kind: s.kind, gainDb: +gainDb.toFixed(1) });
  emit();
}

// ── Measuring a listen ──────────────────────────────────────────────────────────────

function finish(): void {
  const l = listen;
  listen = null;
  if (!l || !l.durationSec || l.jumped || l.heardSec < HEARD_TO_COUNT * l.durationSec) return;
  const lufs = integratedLufs(l.blocks);
  if (lufs === null || !isFinite(l.peak) || l.peak <= 0) return;
  const peakDb = toDb(l.peak);
  const heard = Math.min(1, l.heardSec / l.durationSec);
  measured.set(l.id, { lufs, peakDb });
  medianCache = null;
  diag.log("sound:measured", { lufs: +lufs.toFixed(1), peakDb: +peakDb.toFixed(1), heard: +heard.toFixed(2), blocks: l.blocks.length });
  invoke("loudness_save", { songId: l.id, lufs, peakDb, heard }).catch((e) => diag.error("sound:measureSaveFailed", { err: String(e) }));
}

function onStart(h: TrackHandle): void {
  finish();
  const id = idOf(h);
  if (!id) return;
  listen = { id, handle: h, track: lookup(h), ring: [], blocks: [], peak: 0, heardSec: 0, durationSec: 0, jumped: false, source: { kind: "idle" } };
  apply();
}

function onTick(h: TrackHandle, progress: number, currentTime: number): void {
  if (!listen || idOf(h) !== listen.id) return;
  if (progress > 0) listen.durationSec = currentTime / progress;
  const last = listen.lastSec;
  if (last !== undefined) {
    const d = currentTime - last;
    if (d > 0 && d < 2) listen.heardSec += d;
    else if (d >= 2) listen.jumped = true; // a seek forward: the skipped part was never measured
  }
  listen.lastSec = currentTime;
}

function onHop(ms: number, peak: number): void {
  const l = listen;
  if (!l || !sound.getSound().measure || !isPlayingNow()) return;
  // A paused element sends exact zeros; a routed element that is not the one playing does too.
  if (ms === 0 && peak === 0) return;
  const g = getAppliedGain();
  if (g < MIN_APPLIED_GAIN) return;
  l.ring.push(ms / (g * g));
  if (l.ring.length > 4) l.ring.shift();
  if (l.ring.length === 4) l.blocks.push((l.ring[0] + l.ring[1] + l.ring[2] + l.ring[3]) / 4);
  l.peak = Math.max(l.peak, peak / g);
}

// ── For the panel ───────────────────────────────────────────────────────────────────

export function loudnessState(): { source: GainSource; measuredSongs: number; loaded: boolean; heardPct: number | null; songMeasured: boolean } {
  const heardPct = listen && listen.durationSec ? Math.min(100, Math.round((100 * listen.heardSec) / listen.durationSec)) : null;
  // The song has its own row from an earlier listen. This listen measures it again and replaces
  // the row, but the line says "Measured": the number the gain comes from is already there.
  const songMeasured = !!listen && measured.has(listen.id);
  return { source: listen?.source ?? { kind: sound.getSound().match ? "idle" : "off" }, measuredSongs: measured.size, loaded, heardPct, songMeasured };
}

/** The panel's "Forget measurements": every song is measured again from its next full listen. */
export async function forgetMeasurements(): Promise<number> {
  const n = await invoke<number>("loudness_forget");
  measured.clear();
  medianCache = null;
  diag.log("sound:measureForget", { rows: n });
  apply();
  return n;
}

export function initLoudness(): void {
  onListen(onStart, onTick);
  sound.onMeter(onHop);
  invoke<[string, number, number][]>("loudness_all")
    .then((rows) => {
      for (const [id, lufs, peakDb] of rows) measured.set(id, { lufs, peakDb });
      loaded = true;
      medianCache = null;
      diag.log("sound:measurements", { songs: rows.length });
      apply();
    })
    .catch((e) => diag.error("sound:measureLoadFailed", { err: String(e) }));
  onSettingsChange((k) => {
    if (k === "soundAdaptive" || k === "soundLoudness" || k === "soundLoudTarget" || k === "soundLoudAlbum" || k === "soundLoudUnmeasured") {
      medianCache = null;
      apply();
    }
    if (k === "shuffleMode") apply();
  });
  onTracksChange(() => {
    if (listen && !listen.track) {
      listen.track = lookup(listen.handle);
      apply();
    }
  }, "sound-loudness");
  window.addEventListener("beforeunload", finish);
}
