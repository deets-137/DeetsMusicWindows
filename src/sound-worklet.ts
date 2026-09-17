// Sound worklet (SOUND.md §1): runs on Web Audio's audio thread, in 128-sample blocks.
// Two processors:
// - "deets-element": one per routed MusicKit <audio>. Measures K-weighted loudness before
//   anything changes it (§3A) and applies the song's match gain with a ramp.
// - "deets-bus": one per context, after every element. Preamp → EQ → Fuller at low volume →
//   crossfeed → limiter, and a level-matched bypass for Compare.
// Every setting arrives as a port message; nothing here reads the DOM or the store.

import { bandBiquads, kWeighting, rbj, type Band, type Biquad } from "./sound-dsp";

// ── AudioWorkletGlobalScope (not in the DOM lib) ────────────────────────────────
declare const sampleRate: number;
declare const currentFrame: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
}

const dbToGain = (db: number) => Math.pow(10, db / 20);
const gainToDb = (g: number) => 20 * Math.log10(Math.max(g, 1e-12));
const TINY = 1e-15; // below this, filter state is zeroed (subnormal floats are slow on x86)

/** One biquad in transposed direct form II, stereo state. */
class Section {
  c: Biquad;
  z1 = [0, 0];
  z2 = [0, 0];
  constructor(c: Biquad) {
    this.c = c;
  }
  run(x: number, ch: number): number {
    const c = this.c;
    const y = c.b0 * x + this.z1[ch];
    this.z1[ch] = c.b1 * x - c.a1 * y + this.z2[ch];
    this.z2[ch] = c.b2 * x - c.a2 * y;
    return y;
  }
  settle(): void {
    for (let ch = 0; ch < 2; ch++) {
      if (Math.abs(this.z1[ch]) < TINY) this.z1[ch] = 0;
      if (Math.abs(this.z2[ch]) < TINY) this.z2[ch] = 0;
    }
  }
}

// ── deets-element ───────────────────────────────────────────────────────────────

class ElementProcessor extends AudioWorkletProcessor {
  private k = kWeighting(sampleRate).map((c) => new Section(c));
  private gain = 1;
  private target = 1;
  private step = 0;
  private metering = false;
  private hop = Math.round(sampleRate / 10); // 100 ms
  private acc = 0;
  private count = 0;
  private peak = 0;
  // The start watch (sound.ts `watchStart`, SOUND.md §10.5): the first block this node ever runs
  // ("alive"), and the first non-silent input sample after a play ("first").
  private aliveSent = false;
  private watching = 0;

  constructor(options?: { processorOptions?: { gainDb?: number; meter?: boolean } }) {
    super(options);
    const o = options?.processorOptions;
    if (o?.gainDb !== undefined) this.gain = this.target = dbToGain(o.gainDb);
    this.metering = !!o?.meter;
    this.port.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === "gain") {
        this.target = dbToGain(m.db);
        const ramp = Math.max(1, Math.round(((m.rampMs ?? 50) / 1000) * sampleRate));
        this.step = (this.target - this.gain) / ramp;
      } else if (m.type === "watch") {
        this.watching = m.id;
      } else if (m.type === "meter") {
        this.metering = !!m.on;
        this.acc = this.count = this.peak = 0;
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const out = outputs[0];
    const n = out[0].length;
    const inL = input[0], inR = input[1] ?? input[0];
    if (!this.aliveSent) {
      this.aliveSent = true;
      this.port.postMessage({ type: "alive", frame: currentFrame });
    }
    if (this.watching && inL) {
      for (let i = 0; i < n; i++) {
        if (Math.abs(inL[i]) > 1e-4 || (inR && Math.abs(inR[i]) > 1e-4)) {
          this.port.postMessage({ type: "first", id: this.watching, frame: currentFrame + i });
          this.watching = 0;
          break;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const l = inL ? inL[i] : 0;
      const r = inR ? inR[i] : 0;
      if (this.metering) {
        const kl = this.k[1].run(this.k[0].run(l, 0), 0);
        const kr = this.k[1].run(this.k[0].run(r, 1), 1);
        this.acc += kl * kl + kr * kr;
        const p = Math.max(Math.abs(l), Math.abs(r));
        if (p > this.peak) this.peak = p;
        if (++this.count === this.hop) {
          // Sum over channels of each channel's mean square (BS.1770 weights L and R at 1).
          this.port.postMessage({ type: "meter", ms: this.acc / this.hop, peak: this.peak });
          this.acc = this.count = this.peak = 0;
        }
      }
      if (this.step !== 0) {
        this.gain += this.step;
        if ((this.step > 0 && this.gain >= this.target) || (this.step < 0 && this.gain <= this.target)) {
          this.gain = this.target;
          this.step = 0;
        }
      }
      out[0][i] = l * this.gain;
      if (out[1]) out[1][i] = r * this.gain;
    }
    this.k.forEach((s) => s.settle());
    return true;
  }
}

// ── deets-bus ───────────────────────────────────────────────────────────────────

export interface BusConfig {
  /** false: pass the input through untouched (every effect off). */
  enabled: boolean;
  /** Hold-to-compare: the chain bypassed, level-matched. */
  compare: boolean;
  preampDb: number;
  bands: Band[];
  design: "matched" | "rbj";
  /** Fuller at low volume: shelf gains in dB (0 = off). */
  lowShelfDb: number;
  highShelfDb: number;
  crossfeed: { on: boolean; fc: number; db: number };
  ceilingDb: number;
  /** Listen to a zone: only lo–hi Hz is heard (24 dB/oct each side), or null. Applies on top of
   *  whatever plays, effects on or off, so a new listener hears what the zone sounds like. */
  solo: { lo: number; hi: number } | null;
}

/** A chain of biquads with its own state. */
class Chain {
  sections: Section[];
  constructor(coeffs: Biquad[]) {
    this.sections = coeffs.map((c) => new Section(c));
  }
  run(x: number, ch: number): number {
    for (const s of this.sections) x = s.run(x, ch);
    return x;
  }
}

const bandKey = (bands: Band[]) => bands.map((b) => `${b.on ? 1 : 0}${b.type}${b.slope ?? ""}`).join("|");

class BusProcessor extends AudioWorkletProcessor {
  private cfg: BusConfig | null = null;

  // EQ: parameters glide per block toward the target; a change of shape (count, types, on/off)
  // crossfades from the old chain to a new one over FADE samples.
  private eqNow: Band[] = [];
  private eqTarget: Band[] = [];
  private eqDesign: "matched" | "rbj" = "matched";
  private eq = new Chain([]);
  private eqOld: Chain | null = null;
  private eqFade = 0;
  private readonly FADE = Math.round(0.02 * sampleRate);

  private preamp = 1;
  private preampTarget = 1;

  private lowDb = 0;
  private highDb = 0;
  private lowTarget = 0;
  private highTarget = 0;
  private shelves = new Chain([rbj("lowshelf", 100, 0, 0.707, sampleRate), rbj("highshelf", 10000, 0, 0.707, sampleRate)]);

  // Crossfeed (Bauer, as bs2b): complementary one-pole low/high-pass per channel. No explicit
  // delay: the low-pass's own group delay (~0.23 ms at 700 Hz) is the interaural delay, and an
  // added delay line made a mono signal dip 3.4 dB near 1 kHz (offline test, 2026-09-16).
  private xfC = 0; // linear cross level, glides
  private xfTarget = 0;
  private xfA = Math.exp((-2 * Math.PI * 700) / sampleRate);
  private xfLp = [0, 0];
  private xfHpLp = [0, 0];

  // Limiter: window-min of the needed gain over LA samples, box-averaged over LA, signal delayed LA − 1.
  private readonly LA = Math.max(2, Math.round(0.0015 * sampleRate));
  private ceiling = dbToGain(-1);
  private minQ = new Float64Array(0); // values
  private minI = new Int32Array(0); // sample indices
  private qHead = 0;
  private qTail = 0;
  private boxBuf: Float64Array;
  private boxSum = 0;
  private boxPos = 0;
  private env = 1;
  private readonly releaseCoef = 1 - Math.exp(-1 / (0.08 * sampleRate));
  private delayL: Float32Array;
  private delayR: Float32Array;
  private dryL: Float32Array;
  private dryR: Float32Array;
  private dPos = 0;
  private t = 0; // running sample index

  // Bypass / compare: wet ↔ dry, dry level-matched to the wet.
  private mix = 0; // 0 = wet, 1 = dry
  private matchGain = 1;
  private msWet = 0;
  private msDry = 0;
  private readonly msCoef = 1 - Math.exp(-1 / (3 * sampleRate));
  private readonly mixStep = 1 / Math.round(0.02 * sampleRate);

  // Listen to a zone: a band-pass faded in and out over 20 ms.
  private solo = new Chain([]);
  private soloKey = "";
  private soloMix = 0;

  // Status for the panel: the limiter's deepest cut and the output peak since the last post.
  private minEnv = 1;
  private outPeak = 0;
  private sinceStatus = 0;

  constructor(options?: { processorOptions?: { config?: BusConfig } }) {
    super(options);
    const size = this.LA * 2 + 8;
    this.minQ = new Float64Array(size);
    this.minI = new Int32Array(size);
    this.boxBuf = new Float64Array(this.LA).fill(1);
    this.boxSum = this.LA;
    this.delayL = new Float32Array(this.LA);
    this.delayR = new Float32Array(this.LA);
    this.dryL = new Float32Array(this.LA);
    this.dryR = new Float32Array(this.LA);
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data?.type === "config") this.configure(e.data.config as BusConfig);
    };
    const initial = options?.processorOptions?.config;
    if (initial) this.configure(initial);
  }

  private configure(c: BusConfig): void {
    const first = this.cfg === null;
    this.cfg = c;
    this.preampTarget = dbToGain(c.preampDb);
    this.lowTarget = c.lowShelfDb;
    this.highTarget = c.highShelfDb;
    this.xfTarget = c.crossfeed.on ? dbToGain(c.crossfeed.db) : 0;
    this.xfA = Math.exp((-2 * Math.PI * c.crossfeed.fc) / sampleRate);
    this.ceiling = dbToGain(c.ceilingDb);
    const bands = c.bands.map((b) => ({ ...b }));
    if (first || bandKey(bands) !== bandKey(this.eqTarget) || c.design !== this.eqDesign) {
      this.eqOld = first ? null : this.eq;
      this.eqFade = first ? 0 : this.FADE;
      this.eqNow = bands.map((b) => ({ ...b }));
      this.eqDesign = c.design;
      this.eq = new Chain(this.coeffs(this.eqNow));
    }
    this.eqTarget = bands;
    const soloKey = c.solo ? `${c.solo.lo}-${c.solo.hi}` : "";
    if (c.solo && soloKey !== this.soloKey) {
      const hp: Band = { on: true, type: "highpass", freq: c.solo.lo, gain: 0, q: 0.707, slope: 24 };
      const lp: Band = { on: true, type: "lowpass", freq: c.solo.hi, gain: 0, q: 0.707, slope: 24 };
      this.solo = new Chain([...bandBiquads(hp, sampleRate, "rbj"), ...bandBiquads(lp, sampleRate, "rbj")]);
    }
    this.soloKey = soloKey;
    if (first) {
      this.preamp = this.preampTarget;
      this.lowDb = this.lowTarget;
      this.highDb = this.highTarget;
      this.xfC = this.xfTarget;
      this.mix = c.enabled && !c.compare ? 0 : 1;
      this.rebuildShelves();
    }
  }

  private coeffs(bands: Band[]): Biquad[] {
    return bands.flatMap((b) => bandBiquads(b, sampleRate, this.eqDesign));
  }

  private rebuildShelves(): void {
    const s = this.shelves.sections;
    s[0].c = rbj("lowshelf", 100, this.lowDb, 0.707, sampleRate);
    s[1].c = rbj("highshelf", 10000, this.highDb, 0.707, sampleRate);
  }

  /** Once per block: glide EQ parameters and shelf gains toward their targets. */
  private glide(): void {
    let moved = false;
    for (let i = 0; i < this.eqNow.length; i++) {
      const a = this.eqNow[i], b = this.eqTarget[i];
      if (!b) continue;
      const f = a.freq * Math.pow(b.freq / a.freq, 0.25);
      const g = a.gain + (b.gain - a.gain) * 0.25;
      const q = a.q * Math.pow(b.q / a.q, 0.25);
      const close = Math.abs(Math.log(b.freq / f)) < 1e-4 && Math.abs(b.gain - g) < 1e-3 && Math.abs(Math.log(b.q / q)) < 1e-4;
      const nf = close ? b.freq : f, ng = close ? b.gain : g, nq = close ? b.q : q;
      if (nf !== a.freq || ng !== a.gain || nq !== a.q) moved = true;
      a.freq = nf;
      a.gain = ng;
      a.q = nq;
    }
    if (moved) {
      const cs = this.coeffs(this.eqNow);
      this.eq.sections.forEach((s, i) => cs[i] && (s.c = cs[i]));
    }
    const lowStep = Math.max(-0.1, Math.min(0.1, this.lowTarget - this.lowDb));
    const highStep = Math.max(-0.1, Math.min(0.1, this.highTarget - this.highDb));
    if (lowStep !== 0 || highStep !== 0) {
      this.lowDb += lowStep;
      this.highDb += highStep;
      this.rebuildShelves();
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const n = out[0].length;
    const input = inputs[0];
    const inL = input[0], inR = input[1] ?? input[0];
    const cfg = this.cfg;
    if (!cfg) {
      for (let i = 0; i < n; i++) {
        out[0][i] = inL ? inL[i] : 0;
        if (out[1]) out[1][i] = inR ? inR[i] : 0;
      }
      return true;
    }
    this.glide();
    const mixTarget = cfg.enabled && !cfg.compare ? 0 : 1;
    const LA = this.LA;
    for (let i = 0; i < n; i++) {
      const xl = inL ? inL[i] : 0;
      const xr = inR ? inR[i] : 0;

      // Preamp → EQ (crossfading from the old chain while a shape change fades in)
      this.preamp += (this.preampTarget - this.preamp) * 0.002;
      let l = xl * this.preamp, r = xr * this.preamp;
      if (this.eqFade > 0 && this.eqOld) {
        const w = this.eqFade / this.FADE; // 1 → 0
        const nl = this.eq.run(l, 0), nr = this.eq.run(r, 1);
        const ol = this.eqOld.run(l, 0), or = this.eqOld.run(r, 1);
        l = nl * Math.sqrt(1 - w) + ol * Math.sqrt(w);
        r = nr * Math.sqrt(1 - w) + or * Math.sqrt(w);
        if (--this.eqFade === 0) this.eqOld = null;
      } else {
        l = this.eq.run(l, 0);
        r = this.eq.run(r, 1);
      }

      // Fuller at low volume
      if (this.lowDb !== 0 || this.highDb !== 0) {
        l = this.shelves.run(l, 0);
        r = this.shelves.run(r, 1);
      }

      // Crossfeed: direct = (x + c·HP(x)) / (1 + c); cross = c·LP(other) / (1 + c). Mono sums flat.
      this.xfC += (this.xfTarget - this.xfC) * 0.0005;
      if (this.xfC > 1e-4) {
        const a = this.xfA, c = this.xfC, norm = 1 / (1 + c);
        this.xfLp[0] = (1 - a) * r + a * this.xfLp[0]; // cross into L comes from R
        this.xfLp[1] = (1 - a) * l + a * this.xfLp[1];
        this.xfHpLp[0] = (1 - a) * l + a * this.xfHpLp[0];
        this.xfHpLp[1] = (1 - a) * r + a * this.xfHpLp[1];
        const hpL = l - this.xfHpLp[0], hpR = r - this.xfHpLp[1];
        const nl = (l + c * hpL + c * this.xfLp[0]) * norm;
        const nr = (r + c * hpR + c * this.xfLp[1]) * norm;
        l = nl;
        r = nr;
      }

      // Limiter
      const peak = Math.max(Math.abs(l), Math.abs(r));
      const need = peak > this.ceiling ? this.ceiling / peak : 1;
      const t = this.t++;
      while (this.qTail > this.qHead && this.minQ[this.qTail - 1] >= need) this.qTail--;
      this.minQ[this.qTail] = need;
      this.minI[this.qTail++] = t;
      while (this.minI[this.qHead] <= t - LA) this.qHead++;
      if (this.qHead > LA) {
        // compact the queue
        this.minQ.copyWithin(0, this.qHead, this.qTail);
        this.minI.copyWithin(0, this.qHead, this.qTail);
        this.qTail -= this.qHead;
        this.qHead = 0;
      }
      const held = this.minQ[this.qHead];
      this.boxSum += held - this.boxBuf[this.boxPos];
      this.boxBuf[this.boxPos] = held;
      this.boxPos = (this.boxPos + 1) % LA;
      const avg = this.boxSum / LA;
      this.env = avg < this.env ? avg : this.env + (avg - this.env) * this.releaseCoef;
      const dPrev = (this.dPos + 1) % LA; // the oldest slot: LA − 1 samples back
      const wetL = this.delayL[dPrev] * this.env;
      const wetR = this.delayR[dPrev] * this.env;
      const dryL = this.dryL[dPrev];
      const dryR = this.dryR[dPrev];
      this.delayL[this.dPos] = l;
      this.delayR[this.dPos] = r;
      this.dryL[this.dPos] = xl;
      this.dryR[this.dPos] = xr;
      this.dPos = dPrev;

      // Level match for Compare (3 s averages)
      this.msWet += (wetL * wetL + wetR * wetR - this.msWet) * this.msCoef;
      this.msDry += (dryL * dryL + dryR * dryR - this.msDry) * this.msCoef;

      // Wet ↔ dry
      if (this.mix !== mixTarget) this.mix = mixTarget > this.mix ? Math.min(1, this.mix + this.mixStep) : Math.max(0, this.mix - this.mixStep);
      let yl = wetL, yr = wetR;
      if (this.mix > 0) {
        const dg = cfg.compare ? this.matchGain : 1;
        yl = wetL * (1 - this.mix) + dryL * dg * this.mix;
        yr = wetR * (1 - this.mix) + dryR * dg * this.mix;
      }
      // Listen to a zone
      const soloTarget = cfg.solo ? 1 : 0;
      if (this.soloMix !== soloTarget) this.soloMix = soloTarget > this.soloMix ? Math.min(1, this.soloMix + this.mixStep) : Math.max(0, this.soloMix - this.mixStep);
      if (this.soloMix > 0) {
        const sl = this.solo.run(yl, 0), sr = this.solo.run(yr, 1);
        yl = yl * (1 - this.soloMix) + sl * this.soloMix;
        yr = yr * (1 - this.soloMix) + sr * this.soloMix;
      }
      out[0][i] = yl;
      if (out[1]) out[1][i] = yr;

      if (this.env < this.minEnv) this.minEnv = this.env;
      const op = Math.max(Math.abs(yl), Math.abs(yr));
      if (op > this.outPeak) this.outPeak = op;
    }
    this.eq.sections.forEach((s) => s.settle());
    this.eqOld?.sections.forEach((s) => s.settle());
    this.shelves.sections.forEach((s) => s.settle());
    this.solo.sections.forEach((s) => s.settle());
    if (Math.abs(this.xfLp[0]) < TINY) this.xfLp[0] = 0;
    if (Math.abs(this.xfLp[1]) < TINY) this.xfLp[1] = 0;
    if (Math.abs(this.xfHpLp[0]) < TINY) this.xfHpLp[0] = 0;
    if (Math.abs(this.xfHpLp[1]) < TINY) this.xfHpLp[1] = 0;
    // The dry path's gain for Compare follows the wet level, but only while the wet is heard
    // (while comparing, the averages would chase themselves).
    if (!cfg.compare && this.msDry > 1e-9) this.matchGain = Math.min(4, Math.max(0.25, Math.sqrt(this.msWet / this.msDry)));
    this.sinceStatus += n;
    if (this.sinceStatus >= sampleRate / 4) {
      this.port.postMessage({ type: "status", limiterDb: gainToDb(this.minEnv), outPeakDb: gainToDb(this.outPeak), matchDb: gainToDb(this.matchGain) });
      this.minEnv = 1;
      this.outPeak = 0;
      this.sinceStatus = 0;
    }
    return true;
  }
}

registerProcessor("deets-element", ElementProcessor);
registerProcessor("deets-bus", BusProcessor);
