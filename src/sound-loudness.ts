// Match loudness (SOUND.md §3A — phase 5): every song at one perceived loudness.
//
// Measure: while Match loudness is on (its own switch since 2026-11-04, SOUND.md § 11a-1), each routed element's worklet sends its K-weighted mean
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
// Cap (SOUND.md § 11a-2): a song with no row is held by a slow cap (sound-cap.ts) until it has
// one. An album in order with songs still unmeasured takes one gain instead, which moves only at
// a song start, so the album stays even as one piece.
//
// Cost: two biquads and a sum per sample on the audio thread, 10 small messages a second,
// one SQLite row per song. No Apple calls.

import { invoke } from "@tauri-apps/api/core";
import * as sound from "./sound";
import { onListen } from "./stats";
import { getAppliedGain, isPlayingNow, isShuffleOn } from "./player";
import { integratedLufs } from "./sound-dsp";
import { CAP_DEFAULTS, albumStep, capHop, isAlbumPlay, newCap, type Cap, type CapValues } from "./sound-cap";
import { trackById, tracks, onTracksChange } from "./track-store";
import { albumKey } from "./rewind";
import { effective, setting, onSettingsChange } from "./settings-store";
import { getCurrent, getHistory, getPlan, getUpcoming, type TrackHandle } from "./queue";
import type { Track } from "./library";
import * as diag from "./diag";
import { registerFact } from "./rules";

/** A listen counts once this much of the song was heard (SOUND.md §3A). */
const HEARD_TO_COUNT = 0.8;
/** The limiter may take this much off a song's peak before the gain is capped instead. */
const LIMITER_SHARE_DB = 2;
/** No song is moved further than this, either way. */
const MAX_GAIN_DB = 12;
/** MusicKit's volume below this (−40 dB) leaves too little signal to divide back out. */
const MIN_APPLIED_GAIN = 0.01;
/** The meter's hop, in seconds, and the ramp of one cap step: a step ends as the next one starts. */
const HOP_S = 0.1;
const CAP_RAMP_MS = 100;

/** until: a song with no row. always: every song. off: the median or no change, as before the cap. */
export type CapMode = "until" | "always" | "off";

declare global {
  interface Window {
    /** The ear test's dials (SOUND.md § 11a-2, step 4). Dev only. */
    __cap?: {
      set: (values: Partial<CapValues>) => CapValues;
      mode: (mode: CapMode) => CapMode;
      state: () => unknown;
      forget: () => Promise<number>;
    };
  }
}

interface Measured {
  lufs: number;
  peakDb: number;
}
const measured = new Map<string, Measured>();

/** Until measured, in every build since his ear test (SOUND.md § 11a-2). `__cap` changes it in dev only. */
let capMode: CapMode = "until";
const capValues: CapValues = { ...CAP_DEFAULTS };

/** One album played in order that is not fully measured: its gain, and what was heard of it. */
interface AlbumRun {
  context: string;
  /** The gain of the last song. Null until the first song ends. */
  gainDb: number | null;
  heard: Map<string, Measured & { sec: number }>;
}
let run: AlbumRun | null = null;

/** What decided the gain of the song that plays now (the panel's status line reads this). */
export type GainSource =
  | { kind: "off" }
  | { kind: "idle" }
  | { kind: "song"; lufs: number; gainDb: number; cappedFrom?: number }
  | { kind: "album"; lufs: number; gainDb: number; measured: number; total: number; cappedFrom?: number }
  | { kind: "median"; gainDb: number; songs: number; cappedFrom?: number }
  | { kind: "capped"; gainDb: number }
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
  /** Match loudness changed during this listen. The song may not be routed yet, and only part
   *  of it was measured, so it moves from the next song and saves no row (§ 11a-1). */
  late?: boolean;
  source: GainSource;
  /** The cap holding this song, while one does. */
  cap?: Cap;
  /** The album run this song is part of. */
  run?: AlbumRun;
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
  medianCache = { gainDb: effective("soundLoudTarget") - m, songs: lufs.length };
  return medianCache;
}

/** An album's songs. `tracks()` is the library only, so Apple's whole album from Search reads the
 *  queue: every song of the play carries its context. */
function albumSongs(h: TrackHandle, key: string): { catalogId?: string; libraryId?: string; durationMs?: number }[] {
  if (h.context === `album:${key}`) return tracks().filter((t) => albumKey(t) === key);
  const seen = new Map<string, TrackHandle>();
  for (const e of [...getHistory(), getCurrent(), ...getUpcoming(), ...getPlan()]) {
    const id = e && e.context === h.context ? idOf(e) : undefined;
    if (e && id) seen.set(id, e);
  }
  return [...seen.values()].map((e) => ({ catalogId: e.catalogId, libraryId: e.libraryId, durationMs: lookup(e)?.durationMs }));
}

/** An album's loudness: its measured songs' energy, weighted by length (as one long track). A song
 *  with no row counts for what this run heard of it. */
function album(h: TrackHandle, key: string): { lufs: number; peakDb: number; measured: number; total: number } | null {
  let energy = 0, weight = 0, peakDb = -Infinity, count = 0, total = 0;
  for (const t of albumSongs(h, key)) {
    total++;
    const row = measured.get(t.catalogId ?? "") ?? measured.get(t.libraryId ?? "");
    const heard = row ? undefined : (run?.heard.get(t.catalogId ?? "") ?? run?.heard.get(t.libraryId ?? ""));
    const m = row ?? heard;
    if (!m) continue;
    const w = heard ? heard.sec : (t.durationMs ?? 180_000) / 1000;
    energy += w * Math.pow(10, m.lufs / 10);
    weight += w;
    peakDb = Math.max(peakDb, m.peakDb);
    if (row) count++;
  }
  return weight ? { lufs: 10 * Math.log10(energy / weight), peakDb, measured: count, total } : null;
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

/** An album in order. Fully measured: its one fixed gain. Otherwise the run's gain, which this
 *  reads afresh but which moves only when a song ends, so a second read in a song changes nothing.
 *  Null: the first song of a run with nothing known, which settles as any song does. */
function albumGain(h: TrackHandle, key: string, target: number): GainSource | null {
  const context = capMode === "until" ? h.context : undefined;
  if (!context) run = null;
  else if (run?.context !== context) run = { context, gainDb: null, heard: new Map() };
  if (listen) listen.run = run ?? undefined;

  const a = album(h, key);
  const want = a ? capped(target - a.lufs, a.peakDb) : null;
  const prev = run?.gainDb ?? null;
  if (prev === null || (a && a.measured === a.total)) {
    return a && want ? { kind: "album", lufs: a.lufs, measured: a.measured, total: a.total, ...want } : null;
  }
  const gainDb = want ? albumStep(prev, want.gainDb, capValues.albumStepDb) : prev;
  return { kind: "album", lufs: a?.lufs ?? target - gainDb, measured: a?.measured ?? 0, total: a?.total ?? 0, gainDb, cappedFrom: want?.cappedFrom };
}

function decide(h: TrackHandle, track: Track | undefined): GainSource {
  if (!setting("soundMatch")) return { kind: "off" };
  if (listen?.late) return { kind: "idle" };
  const target = effective("soundLoudTarget");
  const key = track && setting("soundLoudAlbum") && !isShuffleOn() ? albumKey(track) : undefined;
  if (key !== undefined && isAlbumPlay(h.context, key)) {
    const s = albumGain(h, key, target);
    if (s) return s;
  } else {
    run = null;
    if (listen) listen.run = undefined;
  }
  const id = idOf(h);
  const m = id ? measured.get(id) : undefined;
  if (m) return { kind: "song", lufs: m.lufs, ...capped(target - m.lufs, m.peakDb) };
  if (capMode !== "off") return { kind: "capped", gainDb: startGuess(target) };
  const med = median();
  if (med) return { kind: "median", songs: med.songs, ...capped(med.gainDb, undefined) };
  return { kind: "none" };
}

/** Where a song with no row starts: the library's usual gain, or a fixed guess before it has rows. */
const startGuess = (target: number): number => capped(median()?.gainDb ?? target - capValues.startLufs, undefined).gainDb;

/** Put the cap on the song when the source asks for one. A running cap keeps its state: this runs
 *  again in a song, on a settings change or a late track. */
function withCap(l: Listen, s: GainSource): GainSource {
  const wants = capMode === "always" ? s.kind !== "off" && s.kind !== "idle" : s.kind === "capped";
  if (!wants) {
    if (l.cap) dropCap(l);
    return s;
  }
  if (!l.cap) {
    l.cap = newCap("gainDb" in s ? s.gainDb : startGuess(effective("soundLoudTarget")));
    diag.log("sound:capOn", { startDb: +l.cap.startDb.toFixed(1), mode: capMode });
  }
  return { kind: "capped", gainDb: l.cap.gainDb };
}

function dropCap(l: Listen): void {
  if (!l.cap) return;
  diag.log("sound:cap", { db: +l.cap.deepestDb.toFixed(1) });
  diag.log("sound:capOff", { db: +l.cap.gainDb.toFixed(1), heardS: Math.round(l.cap.heardS) });
  l.cap = undefined;
}

function apply(): void {
  if (!listen) {
    sound.setMatchGain(0);
    emit();
    return;
  }
  listen.source = withCap(listen, decide(listen.handle, listen.track));
  const s = listen.source;
  const gainDb = "gainDb" in s ? s.gainDb : 0;
  sound.setMatchGain(gainDb);
  if (s.kind !== "off") diag.log("sound:match", { kind: s.kind, gainDb: +gainDb.toFixed(1) });
  emit();
}

// ── Measuring a listen ──────────────────────────────────────────────────────────────

/** A song ends: its run keeps the gain it ended on and the audio it heard, a skipped song's too. */
function leave(l: Listen): void {
  dropCap(l);
  const r = l.run;
  if (!r) return;
  if ("gainDb" in l.source) r.gainDb = l.source.gainDb;
  const lufs = integratedLufs(l.blocks);
  if (lufs !== null && l.peak > 0) r.heard.set(l.id, { lufs, peakDb: toDb(l.peak), sec: l.blocks.length * HOP_S });
}

function finish(): void {
  const l = listen;
  listen = null;
  if (l) leave(l);
  if (!l || !l.durationSec || l.jumped || l.late || l.heardSec < HEARD_TO_COUNT * l.durationSec) return;
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
  if (l.cap) {
    const room = l.peak > 0 ? sound.getSound().ceilingDb + LIMITER_SHARE_DB - toDb(l.peak) : MAX_GAIN_DB;
    const was = l.cap.gainDb;
    const db = capHop(l.cap, ms / (g * g), { target: effective("soundLoudTarget"), minDb: -MAX_GAIN_DB, maxDb: Math.min(MAX_GAIN_DB, room) }, capValues);
    if (db !== was) {
      l.source = { kind: "capped", gainDb: db };
      sound.setMatchGain(db, CAP_RAMP_MS);
    }
  }
}

// ── For the panel ───────────────────────────────────────────────────────────────────

export function loudnessState(): { source: GainSource } {
  return { source: listen?.source ?? { kind: sound.getSound().match ? "idle" : "off" } };
}

/** Every song is measured again from its next listen. Dev only now: `__cap.forget()`, for the ear test. */
async function forgetMeasurements(): Promise<number> {
  const n = await invoke<number>("loudness_forget");
  measured.clear();
  medianCache = null;
  diag.log("sound:measureForget", { rows: n });
  apply();
  return n;
}

/** The ear test's handle: change a value or the mode on the song that plays now. */
function devCap(): void {
  window.__cap = {
    set(values) {
      Object.assign(capValues, values);
      diag.log("sound:capValues", { ...capValues });
      return { ...capValues };
    },
    mode(mode) {
      capMode = mode;
      run = null;
      diag.log("sound:capMode", { mode });
      apply();
      return capMode;
    },
    forget: forgetMeasurements,
    state: () => ({
      mode: capMode,
      values: { ...capValues },
      source: listen?.source,
      cap: listen?.cap && {
        gainDb: +listen.cap.gainDb.toFixed(2),
        startDb: +listen.cap.startDb.toFixed(2),
        deepestDb: +listen.cap.deepestDb.toFixed(2),
        heardS: Math.round(listen.cap.heardS),
        estimateLufs: listen.cap.estimateLufs,
      },
      run: run && { context: run.context, gainDb: run.gainDb, heard: run.heard.size },
    }),
  };
}

export function initLoudness(): void {
  if (import.meta.env.DEV) devCap();
  // Rulez's "Song loudness" (RULES.md §20.3): the song's measured LUFS, when it has a row. The
  // song change already runs the state check (the player's seam), so it needs none of its own.
  registerFact("loudness", () => {
    const m = listen ? measured.get(listen.id) : undefined;
    return m ? Math.round(m.lufs * 10) / 10 : undefined;
  });
  onListen(onStart, onTick);
  sound.onMeter(onHop);
  invoke<[string, number, number][]>("loudness_all")
    .then((rows) => {
      for (const [id, lufs, peakDb] of rows) measured.set(id, { lufs, peakDb });
      medianCache = null;
      diag.log("sound:measurements", { songs: rows.length });
      apply();
    })
    .catch((e) => diag.error("sound:measureLoadFailed", { err: String(e) }));
  onSettingsChange((k) => {
    if (k === "soundMatch" || k === "soundLoudTarget" || k === "soundLoudAlbum") {
      if (k === "soundMatch" && listen) listen.late = true;
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
