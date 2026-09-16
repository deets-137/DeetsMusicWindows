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

import workletUrl from "./sound-worklet.ts?worker&url";
import type { BusConfig } from "./sound-worklet";
import { bandBiquads, chainDb, integratedLufs, logFreqs, lowVolumeShelves, kWeighting, type Band } from "./sound-dsp";
import { getVolume, getDuck, onVolumeChange, isPlayingNow, getAppliedGain } from "./player";
import * as diag from "./diag";
import { toast } from "./toast";
import { setting, setSetting, onSettingsChange, type Settings } from "./settings-store";
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
  /** Windows master volume 0..1 (Rust feeds it in phase 4; 1 until then). */
  masterVolume: number;
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

/** Any effect on: the only condition under which a new element is routed. */
function wanted(): boolean {
  return (config.eqOn && config.bands.some((b) => b.on)) || config.lowVolume > 0 || config.crossfeed.on;
}

// ── The context and the bus ──────────────────────────────────────────────────────────

let ctx: AudioContext | null = null;
let bus: AudioWorkletNode | null = null;
let ready: Promise<void> | null = null;
const routed = new WeakMap<HTMLMediaElement, { source: MediaElementAudioSourceNode; node: AudioWorkletNode }>();
let routedCount = 0;
let lastStatus: { limiterDb: number; outPeakDb: number; matchDb: number } | null = null;
/** Every element node also feeds this sum, so the panel can read the song before any effect. */
let pre: GainNode | null = null;
let preAnalyser: AnalyserNode | null = null;

function ensureContext(): Promise<void> {
  ready ??= (async () => {
    ctx = new AudioContext({ latencyHint: "playback" });
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
    bus.connect(ctx.destination);
    pre = ctx.createGain(); // pulled only while an analyser listens to it
    watchContext(ctx);
    diag.log("sound:context", { rate: ctx.sampleRate, state: ctx.state, baseLatency: ctx.baseLatency });
  })().catch((e) => {
    diag.error("sound:contextFailed", { err: String(e) });
    ready = null;
    ctx = null;
    bus = null;
    throw e;
  });
  return ready;
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

function route(el: HTMLMediaElement): void {
  if (!ctx || !bus || routed.has(el)) return;
  try {
    const source = ctx.createMediaElementSource(el);
    const node = new AudioWorkletNode(ctx, "deets-element", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    source.connect(node).connect(bus);
    if (pre) node.connect(pre);
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
      if (routed.has(this)) void resume("play");
      else if (wanted() || inspecting) {
        const el = this;
        if (ctx && bus) route(el);
        else void ensureContext().then(() => route(el), () => {});
      }
    }
    return original.apply(this, args);
  };
}

// ── Config → the bus ─────────────────────────────────────────────────────────────────

/** The volume the listener has set (app slider × Windows master), in dB below full. */
function volumeDropDb(): number {
  const duck = getDuck();
  const app = duck > 0 ? getVolume() / duck : getVolume(); // the sleep fade is not "listening quieter"
  const level = Math.max(app * config.masterVolume, 1e-4);
  return -20 * Math.log10(level);
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
  const shelves = config.lowVolume > 0 ? lowVolumeShelves(volumeDropDb(), config.lowVolume) : { low: 0, high: 0 };
  const preampDb = config.eqOn ? preampFor(eq) : 0;
  return {
    enabled: wanted(),
    compare,
    preampDb,
    bands: eq,
    design: config.design,
    lowShelfDb: shelves.low,
    highShelfDb: shelves.high,
    crossfeed: config.crossfeed,
    ceilingDb: config.ceilingDb,
    solo,
  };
}

function push(): void {
  bus?.port.postMessage({ type: "config", config: busConfig() });
}

/** Change any part of the config. Routes nothing by itself: the next play does. */
export function setSound(patch: Partial<SoundConfig>): void {
  const before = wanted();
  Object.assign(config, patch);
  const after = wanted();
  if (before !== after) diag.log(after ? "sound:on" : "sound:off", { routed: routedCount });
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
  return { wanted: wanted(), routed: routedCount, state: ctx?.state ?? "none", rate: ctx?.sampleRate ?? null, bus: lastStatus, dropDb: volumeDropDb(), shelves: busConfig() };
}

// ── Settings → config (the panel writes settings; this is the one reader) ──────────────

/** The output the sound goes to. Rust fills it in (phase 4); until then "this PC", kind unknown. */
export interface SoundOutput {
  key: string;
  name: string;
  kind: "speakers" | "headphones" | "headset" | "airplay" | "unknown";
}
let output: SoundOutput = { key: "default", name: "This PC", kind: "unknown" };

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
  if (setting("soundEqPerOutput")) setSetting("soundEqOutputs", { ...setting("soundEqOutputs"), [output.key]: id });
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

/** The crossfeed is on right now, and why (the panel's status line reads this). */
export function crossfeedState(): { on: boolean; why: string } {
  const mode = setting("soundCrossfeed");
  if (!setting("soundAdaptive") || mode === "off") return { on: false, why: mode === "off" ? "Off" : "Adaptive sound is off" };
  if (mode === "always") return { on: true, why: "Always on" };
  if (output.kind === "headphones" || output.kind === "headset") return { on: true, why: `${output.name}: ${output.kind}` };
  if (output.kind === "unknown") return { on: false, why: "The output type is not known yet" };
  return { on: false, why: `${output.name}: ${output.kind === "airplay" ? "a speaker" : output.kind}` };
}

/** Windows master volume 0..1 (phase 4 feeds it; 1 = not read). */
let windowsMaster = 1;
let windowsMasterKnown = false;

function applySettings(): void {
  const p = activePreset();
  const adaptive = setting("soundAdaptive");
  const xf = crossfeedState();
  const level = CROSSFEED_LEVELS[setting("soundCrossfeedLevel")];
  const patch: Partial<SoundConfig> = {
    eqOn: setting("soundEq"),
    bands: p.bands,
    design: p.design,
    preampMode: setting("soundEqPreamp"),
    preampDb: setting("soundEqPreampDb"),
    lowVolume: adaptive ? LOW_VOL_STRENGTH[setting("soundLowVol")] : 0,
    masterVolume: setting("soundLowVolKey") === "both" ? windowsMaster : 1,
    crossfeed: { on: xf.on, ...level },
  };
  const was = wanted();
  Object.assign(config, patch);
  const on = wanted();
  if (on !== was) diag.log(on ? "sound:on" : "sound:off", { eq: config.eqOn, lowVolume: config.lowVolume, crossfeed: config.crossfeed.on, routed: routedCount });
  if (on && !setting("soundFirstOn")) setSetting("soundFirstOn", Date.now());
  if (on) void ensureContext().catch(() => {});
  push();
  emit();
}

export function setWindowsMaster(v: number): void {
  windowsMaster = Math.max(0, Math.min(1, v));
  windowsMasterKnown = true;
  applySettings();
}
export function getWindowsMaster(): { value: number; known: boolean } {
  return { value: windowsMaster, known: windowsMasterKnown };
}

/** Called by the output watcher (phase 4): switch to the preset remembered for this output. */
export function setOutput(next: SoundOutput): void {
  if (next.key === output.key && next.kind === output.kind && next.name === output.name) return;
  output = next;
  diag.log("sound:output", { kind: next.kind });
  const remembered = setting("soundEqOutputs")[next.key];
  if (setting("soundEqPerOutput") && remembered && remembered !== setting("soundEqPreset")) setSetting("soundEqPreset", remembered);
  applySettings();
}
export function getOutput(): SoundOutput {
  return output;
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
  if (import.meta.env.DEV) (window as any).__sound = { set: setSound, get: getSound, status: soundStatus, compare: setCompare, offlineTest, setOutput, setWindowsMaster };
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
  const base: BusConfig = { enabled: true, compare: false, preampDb: 0, bands: [], design: "matched", lowShelfDb: 0, highShelfDb: 0, crossfeed: { on: false, fc: 700, db: -6 }, ceilingDb: -1, solo: null };

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

  // 5. Fuller at low volume: −17 dB (14 %) at full strength → the shelf gains at 50 Hz and 16 kHz.
  {
    const s = lowVolumeShelves(17, 1);
    const rows: unknown[] = [];
    for (const f of [50, 1000, 16000]) {
      const r = await render({ ...base, lowShelfDb: s.low, highShelfDb: s.high, ceilingDb: 12 }, 1, sine(f, 0.1));
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
