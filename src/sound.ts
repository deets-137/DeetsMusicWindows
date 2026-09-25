// Sound (SOUND.md §1): the Web Audio graph behind Advanced EQ and DeetsAdaptiveSound.
//
// Nothing is routed while every effect is off: MusicKit's <audio> plays straight to the
// speakers, exactly as before. The first play with an effect on routes that element
// (createMediaElementSource cannot be undone) into its own "deets-element" node and then the
// shared "deets-bus" (sound-worklet.ts). From then on the element is heard only through the
// graph, so a context that stops means silence: `watchContext` resumes it and says so.
//
// Facts this rests on (SOUND.md §0): DRM audio passes through Web Audio; `music.volume` acts
// before the graph; MusicKit keeps a pool of <audio> elements, so more than one gets routed.
//
// The AirPlay tap (AIRPLAY.md §12) sits after the bus: bus → tap → sink gain → destination.
// Armed, the tap posts 16-bit chunks that go to Rust (`airplay_tap`); the sink gain at 0 makes
// the PC silent while the speaker plays. The context runs at 44.1 kHz, Apple's own rate, so the
// tap hands the speaker the decode bit-exact and the local path loses nothing (§12.5 T1).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import workletUrl from "./sound-worklet.ts?worker&url";
import type { BusConfig } from "./sound-worklet";
import { bandBiquads, chainDb, integratedLufs, logFreqs, lowVolumeShelves, kWeighting, type Band } from "./sound-dsp";
import { getVolume, getDuck, onVolumeChange, isPlayingNow, getAppliedGain } from "./player";
import * as diag from "./diag";
import * as perf from "./perf";
import { TELEMETRY } from "./telemetry-on";
import { toast } from "./toast";
import { setting, setSetting, onSettingsChange, adaptiveOn, type Settings } from "./settings-store";
import { BUILTIN, type EqPreset } from "./sound-presets";

// ── The state every part reads (settings wire into this in the panel phase) ──────────

export interface SoundConfig {
  eqOn: boolean;
  bands: Band[];
  /** Imported presets keep RBJ filters (their authors designed against them). */
  design: "matched" | "rbj";
  preampDb: number;
  preampMode: "limiter" | "needed" | "always" | "manual";
  /** Fuller at low volume: 0 off, 0.5 gentle, 1 full. */
  lowVolume: number;
  /** The Windows master volume as a gain (audio_out.rs; 1 while AirPlay plays or when not read). */
  masterVolume: number;
  /** Match loudness is on: each song gets its gain (sound-loudness.ts). */
  match: boolean;
  /** Adaptive sound is on: element meters run and songs are measured, even with Match loudness
   *  off, so the gains are ready when it is turned on (user's call 2026-09-17, SOUND.md §3A). */
  measure: boolean;
  crossfeed: { on: boolean; fc: number; db: number };
  ceilingDb: number;
}

const config: SoundConfig = {
  eqOn: false,
  bands: [],
  design: "matched",
  preampDb: 0,
  preampMode: "limiter",
  lowVolume: 0,
  masterVolume: 1,
  match: false,
  measure: false,
  crossfeed: { on: false, fc: 700, db: -6 },
  ceilingDb: -1,
};

let compare = false;
/** The panel is open: its song shape needs the audio in the graph, effects or not (SOUND.md §2.5). */
let inspecting = false;
/** Listen to a zone: the band held in the panel, or null. */
let solo: { lo: number; hi: number } | null = null;
/** Every <audio> MusicKit has played, so opening the panel can route the one already playing. */
const seen = new Set<HTMLMediaElement>();

/** Any effect on, or the AirPlay tap armed: the only conditions under which a new element is routed. */
function wanted(): boolean {
  return (config.eqOn && config.bands.some((b) => b.on)) || config.lowVolume > 0 || config.crossfeed.on || config.match || config.measure || tapArmed;
}

/**
 * The element meters (100 ms hops, `onMeter`) run whenever the graph is wanted. Until
 * 2026-09-25 they ran only with Adaptive sound (`config.measure`), so the Ocean heave and the
 * Room panel's bob moved only with it; Adaptive sound is hidden now, and his call keeps them
 * moving with the Equalizer (SOUND.md §11a). `config.measure` still gates the loudness
 * measuring (sound-loudness.ts), so no new rows reach the `loudness` table.
 */
let meterOn = false;
function syncMeter(): void {
  const on = wanted();
  if (on === meterOn) return;
  meterOn = on;
  for (const n of elementNodes) n.port.postMessage({ type: "meter", on });
  diag.log(on ? "sound:meterOn" : "sound:meterOff", { routed: routedCount });
}

// ── The context and the bus ──────────────────────────────────────────────────────────

let ctx: AudioContext | null = null;
let bus: AudioWorkletNode | null = null;
/** After the bus: the AirPlay tap, then the sink gain (0 while a speaker plays alone). */
let tap: AudioWorkletNode | null = null;
let sink: GainNode | null = null;
let tapArmed = false;
let sinkGain = 1;
const tapStats = { chunks: 0, failed: 0, lastAt: 0, lastGapMs: 0, worstGapMs: 0 };
let ready: Promise<void> | null = null;
/** The rate the tap needs: the AirPlay stream is 44.1 kHz and the crate does not resample the tap. */
const TAP_RATE = 44100;
const routed = new WeakMap<HTMLMediaElement, { source: MediaElementAudioSourceNode; node: AudioWorkletNode }>();
let routedCount = 0;
/** Every element node, so a song's match gain and the meter switch reach all of them. */
const elementNodes: AudioWorkletNode[] = [];
/** The match gain now (dB), given to an element routed later too. */
let matchDb = 0;
type MeterHop = (ms: number, peak: number) => void;
const meterSubs = new Set<MeterHop>();
/** The element meters' 100 ms hops: K-weighted mean square and sample peak, with MusicKit's volume still in. */
export function onMeter(cb: MeterHop): () => void {
  meterSubs.add(cb);
  return () => meterSubs.delete(cb);
}
let lastStatus: { limiterDb: number; outPeakDb: number; matchDb: number } | null = null;
/** Every element node also feeds this sum, so the panel can read the song before any effect. */
let pre: GainNode | null = null;
let preAnalyser: AnalyserNode | null = null;

function ensureContext(): Promise<void> {
  ready ??= (async () => {
    // 44.1 kHz, Apple's rate (AIRPLAY.md §12.1 item 10; §12.5 T1 measured the local path
    // identical to the device rate). Dev only: `sessionStorage["deets.dev.soundRate"] = "48000"`
    // + reload creates the context at another rate, so the fidelity probe can compare.
    const devRate = import.meta.env.DEV ? Number(sessionStorage.getItem("deets.dev.soundRate")) || undefined : undefined;
    ctx = new AudioContext({ latencyHint: "playback", sampleRate: devRate ?? TAP_RATE });
    await ctx.audioWorklet.addModule(workletUrl);
    bus = new AudioWorkletNode(ctx, "deets-bus", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { config: busConfig() },
    });
    bus.port.onmessage = (e) => {
      if (e.data?.type === "status") {
        lastStatus = e.data;
        emit();
      }
    };
    tap = new AudioWorkletNode(ctx, "deets-tap", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    tap.port.onmessage = (e) => {
      if (e.data?.type === "chunk") forwardChunk(e.data.buf as ArrayBuffer);
    };
    sink = ctx.createGain();
    sink.gain.value = sinkGain;
    bus.connect(tap).connect(sink).connect(ctx.destination);
    if (tapArmed) tap.port.postMessage({ type: "arm", on: true });
    pre = ctx.createGain(); // pulled only while an analyser listens to it
    watchContext(ctx);
    diag.log("sound:context", { rate: ctx.sampleRate, state: ctx.state, baseLatency: ctx.baseLatency });
  })().catch((e) => {
    diag.error("sound:contextFailed", { err: String(e) });
    ready = null;
    ctx = null;
    bus = null;
    tap = null;
    sink = null;
    throw e;
  });
  return ready;
}

// ── The AirPlay tap (AIRPLAY.md §12) ────────────────────────────────────────────────

/** One chunk from the tap: raw bytes to Rust, which pushes them into the live session's ring. */
function forwardChunk(buf: ArrayBuffer): void {
  const now = performance.now();
  if (tapStats.lastAt) {
    tapStats.lastGapMs = Math.round(now - tapStats.lastAt);
    if (tapStats.lastGapMs > tapStats.worstGapMs) tapStats.worstGapMs = tapStats.lastGapMs;
  }
  tapStats.lastAt = now;
  tapStats.chunks++;
  invoke("airplay_tap", new Uint8Array(buf)).catch((e) => {
    if (tapStats.failed++ === 0) diag.warn("sound:tapFailed", { err: String(e) });
  });
}

/**
 * airplay.ts: arm the tap before a "DeetsMusic only" connect (the pacer pads silence until
 * chunks arrive), disarm on disconnect. Arming routes the element playing now, mid-song
 * (§12.5 T4: no audible gap); disarming leaves it routed, a bypass at the graph's known zero cost.
 * Resolves to the armed state: false when the context could not be made or runs at another rate.
 */
export async function armTap(on: boolean): Promise<boolean> {
  if (on === tapArmed) return on;
  tapArmed = on;
  if (on) {
    try {
      await ensureContext();
    } catch {
      tapArmed = false;
      return false;
    }
    if (!ctx || !tap) return false;
    if (ctx.sampleRate !== TAP_RATE) {
      // The stream would play at the wrong pitch: refuse, and let All PC sound be the answer.
      diag.error("sound:tapRate", { rate: ctx.sampleRate });
      tapArmed = false;
      return false;
    }
    tapStats.chunks = tapStats.failed = tapStats.lastAt = tapStats.lastGapMs = tapStats.worstGapMs = 0;
    for (const el of seen) if (!el.paused && !routed.has(el)) route(el);
    tap.port.postMessage({ type: "arm", on: true });
    void resume("tap");
    diag.log("airplay:tapArmed", { routed: routedCount, rate: ctx.sampleRate });
  } else {
    tap?.port.postMessage({ type: "arm", on: false });
    diag.log("airplay:tapDisarmed", { chunks: tapStats.chunks, failed: tapStats.failed, worstGapMs: tapStats.worstGapMs });
  }
  syncMeter();
  push(); // the bus's `enabled` follows wanted()
  return tapArmed;
}

/** The PC's own output: 0 while a speaker plays alone (a short ramp, no click), 1 otherwise. */
export function setSink(gain: 0 | 1): void {
  if (gain === sinkGain) return;
  sinkGain = gain;
  if (sink && ctx) sink.gain.setTargetAtTime(gain, ctx.currentTime, 0.003);
  diag.log("sound:sink", { gain });
}

export function tapStatus() {
  return { armed: tapArmed, sink: sinkGain, ...tapStats };
}

let resumeFailedShown = false;
function watchContext(c: AudioContext): void {
  c.onstatechange = () => {
    diag.log("sound:ctx", { state: c.state, routed: routedCount });
    if (c.state !== "running" && routedCount > 0 && isPlayingNow()) void resume("statechange");
  };
}

async function resume(why: string): Promise<void> {
  if (!ctx || ctx.state === "running" || ctx.state === "closed") return;
  try {
    await ctx.resume();
    diag.log("sound:resumed", { why });
  } catch (e) {
    diag.error("sound:resumeFailed", { why, err: String(e) });
    if (!resumeFailedShown) {
      resumeFailedShown = true;
      toast({ kind: "error", text: "Sound effects stopped the audio. Restart DeetsMusic to hear music again." });
    }
  }
}

// ── The start watch (SOUND.md §10.5) ────────────────────────────────────────────────
// The first probe run on 2026-09-16 lost its first tone through a freshly routed element, and
// the cause is not proven. Each play of a routed element is timed: from the play() call to
// the first non-silent sample the element node receives, against how far the element's own
// clock moved meanwhile. A start that looks lost writes `sound:startLost` to the log file
// (release too); in dev every start writes one `[perf] sound start {…}` line.

interface NodeInfo {
  createdAt: number;
  aliveAt?: number;
}
const nodeInfo = new WeakMap<AudioWorkletNode, NodeInfo>();
interface StartWatch {
  id: number;
  t0: number;
  c0: number;
  fresh: boolean;
  ctxState: string;
  timer: number;
}
const startWatches = new WeakMap<HTMLMediaElement, StartWatch>();
let watchSeq = 0;
/** No sound this long after a play of an element that is still playing: reported as silent. */
const START_SILENT_MS = 5000;
/** The element's clock moved this far before sound reached a freshly routed node / a routed one. */
const START_FRESH_GAP_MS = 750;
const START_GAP_MS = 2500;
/** A new element node that took this long to run its first block. */
const START_ALIVE_MS = 150;

function watchStart(el: HTMLMediaElement, fresh: boolean): void {
  const r = routed.get(el);
  if (!r) return;
  const prev = startWatches.get(el);
  if (prev) window.clearTimeout(prev.timer);
  // A play after the end starts again from 0 (a replay measured −1294 ms from the old end).
  const c0 = el.ended ? 0 : el.currentTime;
  const w: StartWatch = { id: ++watchSeq, t0: performance.now(), c0, fresh, ctxState: ctx?.state ?? "none", timer: 0 };
  w.timer = window.setTimeout(() => {
    if (startWatches.get(el) === w && !el.paused) reportStart(el, r.node, w, false);
  }, START_SILENT_MS);
  startWatches.set(el, w);
  r.node.port.postMessage({ type: "watch", id: w.id });
}

function reportStart(el: HTMLMediaElement, node: AudioWorkletNode, w: StartWatch, heard: boolean): void {
  window.clearTimeout(w.timer);
  startWatches.delete(el);
  const info = nodeInfo.get(node);
  const data = {
    heard,
    fresh: w.fresh,
    mediaMs: Math.round((el.currentTime - w.c0) * 1000), // the element's clock moved this far before sound arrived
    wallMs: Math.round(performance.now() - w.t0),
    aliveMs: w.fresh && info?.aliveAt !== undefined ? Math.round(info.aliveAt - info.createdAt) : null,
    ctx: w.ctxState,
    src: el.src.startsWith("blob:") ? "blob" : "stream",
  };
  perf.event("sound start", data);
  // A fresh route or a new node is where the loss was seen; a routed element's song may simply
  // open with silence, so it needs a longer gap before it counts.
  // Songs often open with up to half a second of silence; the probe lost a whole 3 s tone.
  const lost = !heard || (w.fresh && data.mediaMs > START_FRESH_GAP_MS) || data.mediaMs > START_GAP_MS || (data.aliveMs ?? 0) > START_ALIVE_MS;
  if (lost) diag.warn("sound:startLost", data);
}

// ── The clock watch: the audio clock against the wall clock while routed audio plays ───
// Chromium's `playoutStats` (dropout counts) is not in this WebView (Edge 153, 2026-09-16).
// Instead, every CLOCK_EVERY_MS the output timestamp's context time and performance time are
// compared; an output that stalls or drops falls behind the wall clock by the lost time.
const CLOCK_EVERY_MS = 5000;
const CLOCK_SLIP_MS = 20;
let clockTimer = 0;
let clockLast: { ctxMs: number; perfMs: number } | null = null;
function watchClock(): void {
  if (clockTimer) return;
  clockTimer = window.setInterval(() => {
    if (!ctx || ctx.state !== "running" || !isPlayingNow()) {
      clockLast = null;
      return;
    }
    const ts = ctx.getOutputTimestamp();
    if (ts.contextTime === undefined || ts.performanceTime === undefined) return;
    const now = { ctxMs: ts.contextTime * 1000, perfMs: ts.performanceTime };
    if (clockLast) {
      const slip = now.perfMs - clockLast.perfMs - (now.ctxMs - clockLast.ctxMs);
      if (slip > CLOCK_SLIP_MS) {
        const data = { slipMs: Math.round(slip), overMs: Math.round(now.perfMs - clockLast.perfMs), routed: routedCount };
        diag.warn("sound:clockSlip", data);
        perf.event("sound clockSlip", data);
      }
    }
    clockLast = now;
  }, CLOCK_EVERY_MS);
}

function route(el: HTMLMediaElement): void {
  if (!ctx || !bus || routed.has(el)) return;
  try {
    const source = ctx.createMediaElementSource(el);
    const node = new AudioWorkletNode(ctx, "deets-element", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { meter: meterOn, gainDb: matchDb },
    });
    const info: NodeInfo = { createdAt: performance.now() };
    nodeInfo.set(node, info);
    node.port.onmessage = (e) => {
      const m = e.data;
      // MusicKit keeps more than one element routed. The idle one sends exact zeros every
      // hop, and fed between the playing one's hops they flipped the Ocean heave off and on
      // ~17 times a second (and flooded the diag ring). A silent playing element still goes
      // quiet to the subscribers: each one has its own idle timer.
      if (m?.type === "meter") {
        if (m.ms === 0 && m.peak === 0) return;
        meterSubs.forEach((cb) => cb(m.ms, m.peak));
      }
      else if (m?.type === "alive") info.aliveAt = performance.now();
      else if (m?.type === "first") {
        const w = startWatches.get(el);
        if (w && w.id === m.id) reportStart(el, node, w, true);
      }
    };
    elementNodes.push(node);
    source.connect(node).connect(bus);
    if (pre) node.connect(pre);
    watchClock();
    routed.set(el, { source, node });
    routedCount++;
    diag.log("sound:route", { routed: routedCount, state: ctx.state });
  } catch (e) {
    diag.error("sound:routeFailed", { err: String(e) });
  }
}

/**
 * Route MusicKit's elements as they start playing. The hook runs before the real play(), so
 * a context that is already warm routes the element before its first sample is heard.
 */
function installPlayHook(): void {
  const proto = HTMLMediaElement.prototype;
  const original = proto.play;
  proto.play = function (this: HTMLMediaElement, ...args: []) {
    if (this instanceof HTMLAudioElement && !this.dataset.soundSkip) {
      seen.add(this);
      const el = this;
      if (routed.has(el)) {
        void resume("play");
        watchStart(el, false);
      } else if (wanted() || inspecting) {
        if (ctx && bus) {
          route(el);
          watchStart(el, true);
        } else {
          void ensureContext().then(() => {
            route(el);
            watchStart(el, true);
          }, () => {});
        }
      }
    }
    return original.apply(this, args);
  };
}

// ── Config → the bus ─────────────────────────────────────────────────────────────────

/** The level the listener hears, in dB below full: the app slider × Windows master, and the
 *  match gain when Match loudness is on. The ear needs the compensation for the level it gets,
 *  and a song matched 7 dB down is 7 dB quieter whatever the slider says (before 2026-09-18 the
 *  slider alone was read, so raising it to undo the match gain shrank the shelves for nothing). */
function volumeDropDb(): number {
  const duck = getDuck();
  const app = duck > 0 ? getVolume() / duck : getVolume(); // the sleep fade is not "listening quieter"
  const level = Math.max(app * config.masterVolume, 1e-4);
  const match = config.match ? matchDb : 0;
  return -20 * Math.log10(level) - match;
}

/** The EQ curve's highest point over 20 Hz–20 kHz (dB). */
export function curvePeakDb(bands = config.bands, design = config.design, fs = ctx?.sampleRate ?? 48000): number {
  const chain = bands.flatMap((b) => bandBiquads(b, fs, design));
  return logFreqs(256).reduce((m, f) => Math.max(m, chainDb(chain, f, fs)), -Infinity);
}

/** How far below full scale a song reaches the graph, in dB (MusicKit's volume acts first). */
export function headroomDb(): number {
  return -20 * Math.log10(Math.max(getAppliedGain(), 1e-4));
}

/** The preamp (dB) for `bands` under the chosen mode (SOUND.md §2.1a). */
export function preampFor(bands: Band[] = config.bands): number {
  switch (config.preampMode) {
    case "limiter":
      return 0;
    case "manual":
      return config.preampDb;
    case "always":
      return -Math.max(0, curvePeakDb(bands));
    case "needed":
      return -Math.max(0, curvePeakDb(bands) - headroomDb());
  }
}

function busConfig(): BusConfig {
  const eq = config.eqOn ? config.bands : [];
  const shelves = config.lowVolume > 0 ? lowVolumeShelves(volumeDropDb(), config.lowVolume) : { low: 0, sub: 0, high: 0 };
  const preampDb = config.eqOn ? preampFor(eq) : 0;
  return {
    enabled: wanted(),
    compare,
    preampDb,
    bands: eq,
    design: config.design,
    lowShelfDb: shelves.low,
    subShelfDb: shelves.sub,
    highShelfDb: shelves.high,
    crossfeed: config.crossfeed,
    ceilingDb: config.ceilingDb,
    solo,
  };
}

function push(): void {
  bus?.port.postMessage({ type: "config", config: busConfig() });
}

/** The song's match gain (SOUND.md §3A), ramped on every element: only one plays at a time. */
export function setMatchGain(db: number, rampMs = 50): void {
  if (Math.abs(db - matchDb) < 0.01) return;
  matchDb = db;
  for (const n of elementNodes) n.port.postMessage({ type: "gain", db, rampMs });
  // Fuller at low volume keys on the heard level, which this gain is part of (volumeDropDb).
  if (config.lowVolume > 0 && config.match) {
    push();
    emit();
  }
}
export function getMatchGain(): number {
  return matchDb;
}

/** Change any part of the config. Routes nothing by itself: the next play does. */
export function setSound(patch: Partial<SoundConfig>): void {
  const before = wanted();
  Object.assign(config, patch);
  const after = wanted();
  if (before !== after) {
    diag.log(after ? "sound:on" : "sound:off", { routed: routedCount });
    // /health carries "sound" as context for the heaviness sampler (DEBUGGING.md
    // §2026-09-17 review, item 1).
    void import("./np-bus").then((m) => m.noteSound(after));
  }
  if (after) void ensureContext().catch(() => {}); // warm it, so the next play routes before its first sample
  push();
}

export function getSound(): Readonly<SoundConfig> {
  return config;
}

/**
 * The panel opened or closed. Open: the audio goes through the graph (a bit-exact passthrough
 * when every effect is off) so the song's shape can be read; the element already playing is
 * routed now. Closed: nothing new is routed unless an effect is on (routed elements stay).
 */
export async function setInspecting(on: boolean): Promise<AnalyserNode | null> {
  inspecting = on;
  if (!on) {
    if (preAnalyser && pre) {
      try {
        pre.disconnect(preAnalyser);
      } catch {
        /* not connected */
      }
    }
    if (solo) setSolo(null);
    return null;
  }
  try {
    await ensureContext();
  } catch {
    return null;
  }
  if (!ctx || !pre) return null;
  for (const el of seen) if (!el.paused && !routed.has(el)) route(el);
  void resume("inspect");
  preAnalyser ??= Object.assign(ctx.createAnalyser(), { fftSize: 8192, smoothingTimeConstant: 0, minDecibels: -140, maxDecibels: 0 });
  pre.connect(preAnalyser);
  diag.log("sound:inspect", { routed: routedCount });
  return preAnalyser;
}

/** Listen to a zone: only lo–hi Hz is heard while held; null lets everything through again. */
export function setSolo(zone: { lo: number; hi: number } | null): void {
  solo = zone;
  push();
  if (zone) diag.log("sound:solo", zone);
}

/** Hold-to-compare (SOUND.md §7): the chain bypassed, level-matched to what it was doing. */
export function setCompare(on: boolean): void {
  compare = on;
  push();
}

export function soundStatus() {
  return { wanted: wanted(), routed: routedCount, state: ctx?.state ?? "none", rate: ctx?.sampleRate ?? null, bus: lastStatus, dropDb: volumeDropDb(), shelves: busConfig(), tap: tapStatus() };
}

// ── Settings → config (the panel writes settings; this is the one reader) ──────────────

/** The output the sound goes to: the AirPlay speaker while one plays, else the Windows default (audio_out.rs). */
export interface SoundOutput {
  key: string;
  name: string;
  kind: "speakers" | "headphones" | "headset" | "airplay" | "unknown";
}
const NO_OUTPUT: SoundOutput = { key: "default", name: "This PC", kind: "unknown" };
let output: SoundOutput = NO_OUTPUT;
let windowsOutput: SoundOutput | null = null;
/** The output's kind now (speakers, headphones, airplay …), for `player:stall` (DEBUGGING.md). */
export const outputKind = (): SoundOutput["kind"] => output.kind;
let airplayOutput: SoundOutput | null = null;

const CROSSFEED_LEVELS = { light: { fc: 650, db: -9.5 }, medium: { fc: 700, db: -6 }, strong: { fc: 700, db: -4.5 } } as const;
const LOW_VOL_STRENGTH = { off: 0, gentle: 0.5, full: 1 } as const;

export function presetFor(id: string): EqPreset {
  if (id === "custom") return setting("soundEqCustom");
  if (id.startsWith("u:")) return setting("soundEqUser")[id] ?? BUILTIN[0].preset;
  return BUILTIN.find((p) => p.id === id)?.preset ?? BUILTIN[0].preset;
}

export function activePreset(): EqPreset {
  return presetFor(setting("soundEqPreset"));
}

/** Every preset the stepper walks: built-ins, Custom (once it has bands), then the user's. */
export function presetOptions(): { id: string; name: string }[] {
  const list = BUILTIN.map((b) => ({ id: b.id, name: b.preset.name }));
  if (setting("soundEqCustom").bands.length || setting("soundEqPreset") === "custom") list.push({ id: "custom", name: "Custom" });
  for (const [id, p] of Object.entries(setting("soundEqUser"))) list.push({ id, name: p.name });
  return list;
}

/** Pick a preset; with per-output profiles on, the current output remembers it. */
export function selectPreset(id: string): void {
  setSetting("soundEqPreset", id);
  if (setting("soundEqPerOutput")) {
    setSetting("soundEqOutputs", { ...setting("soundEqOutputs"), [output.key]: id });
    if (setting("soundOutputNames")[output.key] !== output.name) setSetting("soundOutputNames", { ...setting("soundOutputNames"), [output.key]: output.name });
  }
  diag.log("sound:preset", { id, output: output.kind });
}

/** An edit: a user preset changes in place; a built-in becomes Custom. */
export function commitBands(bands: EqPreset["bands"]): void {
  const id = setting("soundEqPreset");
  const cur = activePreset();
  if (id.startsWith("u:")) {
    setSetting("soundEqUser", { ...setting("soundEqUser"), [id]: { ...cur, bands } });
  } else {
    setSetting("soundEqCustom", { name: "Custom", bands, design: id === "custom" ? cur.design : "matched" });
    if (id !== "custom") selectPreset("custom");
  }
}

/** The crossfeed is on right now, and why, in the words of the panel's status line. */
export function crossfeedState(): { on: boolean; why: string } {
  const mode = setting("soundCrossfeed");
  if (mode === "off") return { on: false, why: "Off." };
  if (!adaptiveOn()) return { on: false, why: "Adaptive sound is off." };
  if (mode === "always") return { on: true, why: "On for every output." };
  if (output.kind === "headphones") return { on: true, why: `On: ${output.name} is headphones.` };
  if (output.kind === "headset") return { on: true, why: `On: ${output.name} is a headset.` };
  if (output.kind === "unknown") return { on: false, why: `Off: Windows does not say whether ${output.name} is headphones. Pick Always to use it.` };
  return { on: false, why: `Off: ${output.name} is a speaker.` };
}

/** The Windows volume slider (0..1) and the attenuation it applies (dB), from audio_out.rs. */
let windowsMaster = 1;
let windowsMasterDb = 0;
let windowsMasterKnown = false;

function applySettings(): void {
  const p = activePreset();
  const adaptive = adaptiveOn();
  const xf = crossfeedState();
  const level = CROSSFEED_LEVELS[setting("soundCrossfeedLevel")];
  const patch: Partial<SoundConfig> = {
    eqOn: setting("soundEq"),
    bands: p.bands,
    design: p.design,
    preampMode: setting("soundEqPreamp"),
    preampDb: setting("soundEqPreampDb"),
    lowVolume: adaptive ? LOW_VOL_STRENGTH[setting("soundLowVol")] : 0,
    // Windows' slider in dB, not its 0..1 position (the slider is a taper). The AirPlay capture
    // is taken before the Windows volume, so while a speaker plays it does not count.
    masterVolume: setting("soundLowVolKey") === "both" && !airplayOutput && windowsMasterKnown ? Math.pow(10, windowsMasterDb / 20) : 1,
    match: adaptive && setting("soundLoudness"),
    measure: adaptive,
    crossfeed: { on: xf.on, ...level },
  };
  const was = wanted();
  const matchWas = config.match;
  const measureWas = config.measure;
  Object.assign(config, patch);
  if (config.measure !== measureWas) diag.log(config.measure ? "sound:measureOn" : "sound:measureOff", { routed: routedCount });
  syncMeter();
  if (config.match !== matchWas) diag.log(config.match ? "sound:matchOn" : "sound:matchOff", { routed: routedCount });
  const on = wanted();
  if (on !== was) diag.log(on ? "sound:on" : "sound:off", { eq: config.eqOn, lowVolume: config.lowVolume, crossfeed: config.crossfeed.on, routed: routedCount });
  if (on && !setting("soundFirstOn")) setSetting("soundFirstOn", Date.now());
  if (on) void ensureContext().catch(() => {});
  push();
  emit();
}

/** The Windows volume moved (or a dev call): `v` the slider 0..1, `db` its attenuation (<= 0). */
export function setWindowsMaster(v: number, db = 20 * Math.log10(Math.max(v, 1e-4))): void {
  windowsMaster = Math.max(0, Math.min(1, v));
  windowsMasterDb = Math.min(0, db);
  windowsMasterKnown = true;
  applySettings();
}
export function getWindowsMaster(): { value: number; db: number; known: boolean; airplay: boolean } {
  return { value: windowsMaster, db: windowsMasterDb, known: windowsMasterKnown, airplay: !!airplayOutput };
}

/** airplay.ts: the speaker that plays now, or null when it lets go (Windows' output returns). */
export function setAirplayOutput(name: string | null): void {
  airplayOutput = name ? { key: `airplay:${name}`, name, kind: "airplay" } : null;
  setOutput(airplayOutput ?? windowsOutput ?? NO_OUTPUT);
}

interface WindowsOutput {
  key: string;
  name: string;
  kind: SoundOutput["kind"];
  volume: number;
  volumeDb: number;
  muted: boolean;
}
function takeWindowsOutput(o: WindowsOutput | null): void {
  windowsOutput = o ? { key: o.key, name: o.name, kind: o.kind } : null;
  if (o) {
    windowsMaster = Math.max(0, Math.min(1, o.volume));
    windowsMasterDb = Math.min(0, o.volumeDb);
    windowsMasterKnown = true;
  }
  if (!airplayOutput) setOutput(windowsOutput ?? NO_OUTPUT);
  applySettings();
}

/** Follow the Windows default output and its volume (phase 4). Events only: nothing polls. */
function watchWindowsOutput(): void {
  void listen<WindowsOutput | null>("audio-output", (e) => takeWindowsOutput(e.payload)).catch(() => {});
  void invoke<WindowsOutput | null>("audio_output").then(takeWindowsOutput, () => {});
}

/** Switch to the preset remembered for this output. */
export function setOutput(next: SoundOutput): void {
  if (next.key === output.key && next.kind === output.kind && next.name === output.name) return;
  output = next;
  diag.log("sound:output", { kind: next.kind, name: next.name });
  const remembered = setting("soundEqOutputs")[next.key];
  if (setting("soundEqPerOutput") && remembered && remembered !== setting("soundEqPreset")) setSetting("soundEqPreset", remembered);
  applySettings();
}
export function getOutput(): SoundOutput {
  return output;
}
/** A remembered output's name for the panel's list (its key is a Windows id). */
export function outputName(key: string): string {
  if (key === output.key) return output.name;
  return setting("soundOutputNames")[key] ?? (key === "default" ? "This PC" : key.startsWith("airplay:") ? key.slice("airplay:".length) : "An earlier output");
}

// ── Change notices for the panel ─────────────────────────────────────────────────────

const listeners = new Set<() => void>();
export function onSoundChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function emit(): void {
  listeners.forEach((cb) => cb());
}

// ── The review (SOUND.md §7) ─────────────────────────────────────────────────────────

const DAY = 86_400_000;
/** When the "keep it?" question is due (epoch ms), or 0 when it never is. */
export function reviewDue(): number {
  const first = setting("soundFirstOn");
  const days = setting("soundReviewDays");
  return first && days ? first + days * DAY : 0;
}

let reviewTimer = 0;
function checkReview(): void {
  window.clearTimeout(reviewTimer);
  const due = reviewDue();
  if (!due || setting("soundReviewed")) return;
  const wait = due - Date.now();
  if (wait > 0) {
    reviewTimer = window.setTimeout(checkReview, Math.min(wait, 6 * 3600_000));
    return;
  }
  diag.log("sound:reviewDue", { days: setting("soundReviewDays") });
  toast({
    kind: "info",
    text: "You have used Sound effects for a while. Keep them?",
    onceKey: `sound-review-${setting("soundFirstOn")}`,
    actions: [
      { label: "Keep", run: () => setSetting("soundReviewed", true) },
      {
        label: "Turn off",
        run: () => {
          setSetting("soundEq", false);
          setSetting("soundAdaptive", false);
        },
      },
    ],
  });
}

export function initSound(): void {
  installPlayHook();
  onVolumeChange(() => {
    if (config.lowVolume > 0 || (config.eqOn && config.preampMode === "needed")) {
      push();
      emit();
    }
  });
  onSettingsChange((k: keyof Settings) => {
    if (!String(k).startsWith("sound")) return;
    applySettings();
    if (k === "soundFirstOn" || k === "soundReviewDays" || k === "soundReviewed") checkReview();
  });
  applySettings();
  checkReview();
  watchWindowsOutput();
  // TELEMETRY, not DEV: the `airplay` bench scene reads `__sound.status().tap` and must
  // run on the release-shaped build too (telemetry-on.ts). Absent from the installed app.
  if (TELEMETRY) (window as any).__sound = { set: setSound, get: getSound, status: soundStatus, compare: setCompare, offlineTest, setOutput, setWindowsMaster, inspect: setInspecting };
}

/** A live preview of bands while a handle or fader is dragged; the release commits to settings. */
export function previewBands(bands: Band[]): void {
  config.bands = bands;
  push();
}

export function sampleRateNow(): number {
  return ctx?.sampleRate ?? 48000;
}

export function busStatus() {
  return lastStatus;
}
export function contextState(): string {
  return ctx?.state ?? "none";
}
export function routedElements(): number {
  return routedCount;
}
export { volumeDropDb };


// ── Offline self-test (dev, silent): OfflineAudioContext runs the real worklet ───────

async function offlineTest(): Promise<Record<string, unknown>> {
  const fs = 48000;
  const report: Record<string, unknown> = {};
  const base: BusConfig = { enabled: true, compare: false, preampDb: 0, bands: [], design: "matched", lowShelfDb: 0, subShelfDb: 0, highShelfDb: 0, crossfeed: { on: false, fc: 700, db: -6 }, ceilingDb: -1, solo: null };

  /** Render `seconds` of `gen(i, ch)` through a bus with `cfg`; returns [input, output] channel data. */
  async function render(cfg: BusConfig, seconds: number, gen: (i: number, ch: number) => number) {
    const n = Math.round(seconds * fs);
    const oc = new OfflineAudioContext(2, n, fs);
    await oc.audioWorklet.addModule(workletUrl);
    const buf = oc.createBuffer(2, n, fs);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = gen(i, ch);
    }
    const src = oc.createBufferSource();
    src.buffer = buf;
    const node = new AudioWorkletNode(oc, "deets-bus", { outputChannelCount: [2], processorOptions: { config: cfg } });
    src.connect(node).connect(oc.destination);
    src.start();
    const out = await oc.startRendering();
    return { input: [buf.getChannelData(0), buf.getChannelData(1)], output: [out.getChannelData(0), out.getChannelData(1)], n };
  }
  const LA = Math.max(2, Math.round(0.0015 * fs));
  const sine = (f: number, a: number) => (i: number) => a * Math.sin((2 * Math.PI * f * i) / fs);
  const rmsDb = (x: Float32Array, from: number) => {
    let s = 0;
    for (let i = from; i < x.length; i++) s += x[i] * x[i];
    return 10 * Math.log10(s / (x.length - from));
  };

  // 1. Every effect off and flat-but-enabled: the output is the input, delayed LA − 1 samples.
  for (const [name, cfg] of [["passthrough", { ...base, enabled: false }], ["flat", base]] as const) {
    const r = await render(cfg as BusConfig, 1, (i, ch) => Math.sin(i * 0.01 * (ch + 1)) * 0.5 + (Math.random() - 0.5) * 0.2);
    let maxErr = 0;
    for (let ch = 0; ch < 2; ch++) for (let i = LA; i < r.n; i++) maxErr = Math.max(maxErr, Math.abs(r.output[ch][i] - r.input[ch][i - (LA - 1)]));
    report[name] = { maxErr };
  }

  // 2. EQ: tone gains through the worklet against the design's own curve.
  const bands: Band[] = [
    { on: true, type: "peak", freq: 1000, gain: 6, q: 1 },
    { on: true, type: "peak", freq: 12000, gain: -6, q: 1.4 },
    { on: true, type: "lowshelf", freq: 120, gain: 4, q: 0.707 },
  ];
  const chain = bands.flatMap((b) => bandBiquads(b, fs, "matched"));
  const eqRows: unknown[] = [];
  for (const f of [60, 1000, 3000, 12000, 16000]) {
    const r = await render({ ...base, bands, ceilingDb: 12 }, 1, sine(f, 0.1));
    const got = rmsDb(r.output[0], fs / 2) - rmsDb(r.input[0], fs / 2);
    eqRows.push({ f, got: +got.toFixed(3), want: +chainDb(chain, f, fs).toFixed(3) });
  }
  report.eq = eqRows;

  // 3. Limiter: a +6 dBFS sine never leaves above the −1 dBFS ceiling.
  {
    const r = await render(base, 1, sine(997, 2));
    let peak = 0;
    for (let i = 0; i < r.n; i++) peak = Math.max(peak, Math.abs(r.output[0][i]));
    report.limiter = { peakDbfs: +(20 * Math.log10(peak)).toFixed(3), ceiling: -1 };
  }

  // 4. Crossfeed on a mono signal stays flat (the direct and cross paths sum to 1).
  {
    const rows: unknown[] = [];
    for (const f of [100, 1000, 10000]) {
      const r = await render({ ...base, crossfeed: { on: true, fc: 700, db: -4.5 }, ceilingDb: 12 }, 1, sine(f, 0.2));
      rows.push({ f, dB: +(rmsDb(r.output[0], fs / 2) - rmsDb(r.input[0], fs / 2)).toFixed(3) });
    }
    report.crossfeedMono = rows;
  }

  // 5. Fuller at low volume: −17 dB (14 %) at full strength → the gains at 31.5 / 50 / 100 Hz
  //    against ISO 226 (8.0 / 7.0 / 5.3 dB), 1 kHz flat, 16 kHz the treble shelf.
  {
    const s = lowVolumeShelves(17, 1);
    const rows: unknown[] = [];
    for (const f of [31.5, 50, 100, 1000, 16000]) {
      const r = await render({ ...base, lowShelfDb: s.low, subShelfDb: s.sub, highShelfDb: s.high, ceilingDb: 12 }, 1, sine(f, 0.1));
      rows.push({ f, dB: +(rmsDb(r.output[0], fs / 2) - rmsDb(r.input[0], fs / 2)).toFixed(2) });
    }
    report.lowVolume = { shelves: s, rows };
  }

  // 6. Listen to a zone (Body, 150–500 Hz): 300 Hz passes, 60 Hz and 3 kHz are cut.
  {
    const rows: unknown[] = [];
    for (const f of [60, 300, 3000]) {
      const r = await render({ ...base, enabled: false, solo: { lo: 150, hi: 500 } }, 1, sine(f, 0.2));
      rows.push({ f, dB: +(rmsDb(r.output[0], fs / 2) - rmsDb(r.input[0], fs / 2)).toFixed(2) });
    }
    report.solo = rows;
  }

  // 7. The element meter: a 1 kHz sine at −23 dBFS on both channels reads −23 LUFS.
  {
    const seconds = 12;
    const n = seconds * fs;
    const oc = new OfflineAudioContext(2, n, fs);
    await oc.audioWorklet.addModule(workletUrl);
    const buf = oc.createBuffer(2, n, fs);
    const a = Math.pow(10, -23 / 20);
    for (let ch = 0; ch < 2; ch++) buf.getChannelData(ch).set(Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * 1000 * i) / fs)));
    const src = oc.createBufferSource();
    src.buffer = buf;
    const node = new AudioWorkletNode(oc, "deets-element", { outputChannelCount: [2], processorOptions: { meter: true } });
    const hops: number[] = [];
    node.port.onmessage = (e) => e.data?.type === "meter" && hops.push(e.data.ms);
    src.connect(node).connect(oc.destination);
    src.start();
    await oc.startRendering();
    await new Promise((r) => setTimeout(r, 200)); // let the last port messages land
    const blocks: number[] = [];
    for (let i = 0; i + 4 <= hops.length; i++) blocks.push((hops[i] + hops[i + 1] + hops[i + 2] + hops[i + 3]) / 4);
    report.meter = { hops: hops.length, lufs: integratedLufs(blocks), kFs: kWeighting(fs)[0].b0 };
  }
  return report;
}
