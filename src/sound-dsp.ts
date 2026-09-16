// Sound DSP math (SOUND.md §2.1, §3): filter design and responses, hand-rolled.
// Pure functions, no DOM and no Web Audio — the worklet (sound-worklet.ts) runs them on the
// audio thread, and the panel draws its curve with the same numbers.
//
// Two biquad families:
// - RBJ cookbook (bilinear transform): what Equalizer APO and AutoEq design against, so an
//   imported preset sounds as its author measured it.
// - Matched peak (Orfanidis 1997, prescribed Nyquist gain): the analog bell's gain at the
//   Nyquist frequency is kept, so a high band is not squeezed ("cramped") by the bilinear
//   transform. Used for bands made in DeetsMusic.

/** Normalised biquad (a0 = 1). */
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export type BandType = "peak" | "lowshelf" | "highshelf" | "lowpass" | "highpass" | "notch";

export interface Band {
  on: boolean;
  type: BandType;
  /** Hz. */
  freq: number;
  /** dB (peak and shelves). */
  gain: number;
  q: number;
  /** Low-pass / high-pass steepness in dB per octave: 12, 24 or 48. */
  slope?: 12 | 24 | 48;
}

export const IDENTITY: Biquad = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

const norm = (b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Biquad => ({
  b0: b0 / a0,
  b1: b1 / a0,
  b2: b2 / a0,
  a1: a1 / a0,
  a2: a2 / a0,
});

/** Frequencies at or above this fraction of the Nyquist are clamped (a biquad cannot sit on it). */
const MAX_NYQ = 0.995;
const clampFreq = (f: number, fs: number) => Math.min(Math.max(f, 1), (fs / 2) * MAX_NYQ);

// ── RBJ cookbook ────────────────────────────────────────────────────────────────

export function rbj(type: BandType, freq: number, gainDb: number, q: number, fs: number): Biquad {
  const w0 = (2 * Math.PI * clampFreq(freq, fs)) / fs;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  switch (type) {
    case "peak":
      return norm(1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A);
    case "notch":
      return norm(1, -2 * cos, 1, 1 + alpha, -2 * cos, 1 - alpha);
    case "lowpass":
      return norm((1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
    case "highpass":
      return norm((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
    case "lowshelf": {
      const s = 2 * Math.sqrt(A) * alpha;
      return norm(
        A * (A + 1 - (A - 1) * cos + s),
        2 * A * (A - 1 - (A + 1) * cos),
        A * (A + 1 - (A - 1) * cos - s),
        A + 1 + (A - 1) * cos + s,
        -2 * (A - 1 + (A + 1) * cos),
        A + 1 + (A - 1) * cos - s,
      );
    }
    case "highshelf": {
      const s = 2 * Math.sqrt(A) * alpha;
      return norm(
        A * (A + 1 + (A - 1) * cos + s),
        -2 * A * (A - 1 + (A + 1) * cos),
        A * (A + 1 + (A - 1) * cos - s),
        A + 1 - (A - 1) * cos + s,
        2 * (A - 1 - (A + 1) * cos),
        A + 1 - (A - 1) * cos - s,
      );
    }
  }
}

// ── Matched peak (Orfanidis, "Digital Parametric Equalizer Design with Prescribed
//    Nyquist-Frequency Gain", JAES 1997) ─────────────────────────────────────────────

/**
 * A bell whose gain at the Nyquist equals its analog prototype's (the RBJ analog bell,
 * H(s) = (s² + s·A·w0/Q + w0²) / (s² + s·w0/(A·Q) + w0²), A = √G). The bandwidth is taken
 * where the gain is half the peak in dB (√G), which for that prototype is w0/Q.
 */
export function matchedPeak(freq: number, gainDb: number, q: number, fs: number): Biquad {
  if (Math.abs(gainDb) < 1e-6) return IDENTITY;
  const w0 = (2 * Math.PI * clampFreq(freq, fs)) / fs;
  const G = Math.pow(10, gainDb / 20);
  const G0 = 1;
  const GB = Math.sqrt(G);
  // Digital bandwidth: the analog edges (where the gain is √G) mapped to the digital axis.
  const W0 = w0; // matched at the centre
  const half = W0 / (2 * q);
  const edge = Math.sqrt(W0 * W0 + half * half);
  const dw = Math.min(edge + half, Math.PI * MAX_NYQ) - Math.max(edge - half, 1e-9);
  const F = Math.abs(G * G - GB * GB);
  const G00 = Math.abs(G * G - G0 * G0);
  const F00 = Math.abs(GB * GB - G0 * G0);
  const pi2 = Math.PI * Math.PI;
  const num = G0 * G0 * (w0 * w0 - pi2) ** 2 + (G * G * F00 * pi2 * dw * dw) / F;
  const den = (w0 * w0 - pi2) ** 2 + (F00 * pi2 * dw * dw) / F;
  const G1 = Math.sqrt(num / den);
  const G01 = Math.abs(G * G - G0 * G1);
  const G11 = Math.abs(G * G - G1 * G1);
  const F01 = Math.abs(GB * GB - G0 * G1);
  const F11 = Math.abs(GB * GB - G1 * G1);
  const W2 = Math.sqrt(G11 / G00) * Math.tan(w0 / 2) ** 2;
  const DW = (1 + Math.sqrt(F00 / F11) * W2) * Math.tan(dw / 2);
  const C = F11 * DW * DW - 2 * W2 * (F01 - Math.sqrt(F00 * F11));
  const D = 2 * W2 * (G01 - Math.sqrt(G00 * G11));
  const A = Math.sqrt((C + D) / F);
  const B = Math.sqrt((G * G * C + GB * GB * D) / F);
  const a0 = 1 + W2 + A;
  return {
    b0: (G1 + G0 * W2 + B) / a0,
    b1: (-2 * (G1 - G0 * W2)) / a0,
    b2: (G1 - B + G0 * W2) / a0,
    a1: (-2 * (1 - W2)) / a0,
    a2: (1 + W2 - A) / a0,
  };
}

// ── A band → its biquads ────────────────────────────────────────────────────────

/** Butterworth section Qs for an order-2n low/high-pass (n sections). */
function butterworthQs(sections: number): number[] {
  const order = sections * 2;
  return Array.from({ length: sections }, (_, k) => 1 / (2 * Math.cos((Math.PI * (2 * k + 1)) / (2 * order))));
}

/**
 * The biquads one band needs. `design`: "matched" for bands made here, "rbj" for imported
 * presets (their authors designed against RBJ). Steep cuts are Butterworth cascades.
 */
export function bandBiquads(band: Band, fs: number, design: "matched" | "rbj"): Biquad[] {
  if (!band.on) return [];
  switch (band.type) {
    case "peak":
      return [design === "matched" ? matchedPeak(band.freq, band.gain, band.q, fs) : rbj("peak", band.freq, band.gain, band.q, fs)];
    case "lowpass":
    case "highpass": {
      const slope = band.slope ?? 12;
      if (slope === 12) return [rbj(band.type, band.freq, 0, band.q, fs)];
      return butterworthQs(slope / 12).map((q) => rbj(band.type, band.freq, 0, q, fs));
    }
    default:
      return [rbj(band.type, band.freq, band.gain, band.q, fs)];
  }
}

// ── Responses ───────────────────────────────────────────────────────────────────

/** |H(e^jw)| in dB at `freq`. */
export function biquadDb(c: Biquad, freq: number, fs: number): number {
  const w = (2 * Math.PI * freq) / fs;
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * c1 + c.b2 * c2, ni = -(c.b1 * s1 + c.b2 * s2);
  const dr = 1 + c.a1 * c1 + c.a2 * c2, di = -(c.a1 * s1 + c.a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

export function chainDb(chain: Biquad[], freq: number, fs: number): number {
  return chain.reduce((sum, c) => sum + biquadDb(c, freq, fs), 0);
}

/** The analog RBJ bell's gain in dB at `freq` — the shape a band is meant to have. */
export function analogPeakDb(f0: number, gainDb: number, q: number, freq: number): number {
  const A = Math.pow(10, gainDb / 40);
  const x = freq / f0; // s = jx, normalised
  const re = 1 - x * x;
  const num = re * re + ((x * A) / q) ** 2;
  const den = re * re + (x / (A * q)) ** 2;
  return 10 * Math.log10(num / den);
}

/** Log-spaced frequencies for a curve: `n` points over 20 Hz–20 kHz. */
export function logFreqs(n: number, lo = 20, hi = 20000): number[] {
  return Array.from({ length: n }, (_, i) => lo * Math.pow(hi / lo, i / (n - 1)));
}

// ── Loudness (ITU-R BS.1770-4) ──────────────────────────────────────────────────

/** The two K-weighting stages for `fs`, from the analog specification (as libebur128 derives them). */
export function kWeighting(fs: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const highpass: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, highpass];
}

/**
 * Integrated loudness (LUFS) from 400 ms block mean squares (already K-weighted, summed over
 * channels, 100 ms hop): absolute gate −70 LUFS, then relative gate −10 LU.
 */
export function integratedLufs(blocks: ArrayLike<number>): number | null {
  const lufs = (ms: number) => -0.691 + 10 * Math.log10(ms);
  const abs: number[] = [];
  for (let i = 0; i < blocks.length; i++) if (blocks[i] > 0 && lufs(blocks[i]) > -70) abs.push(blocks[i]);
  if (!abs.length) return null;
  const relGate = lufs(abs.reduce((s, v) => s + v, 0) / abs.length) - 10;
  const rel = abs.filter((v) => lufs(v) > relGate);
  if (!rel.length) return null;
  return lufs(rel.reduce((s, v) => s + v, 0) / rel.length);
}

// ── Equal loudness (ISO 226:2003), for Fuller at low volume ─────────────────────

const ISO_F = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500];
const ISO_AF = [0.532, 0.506, 0.48, 0.455, 0.432, 0.409, 0.387, 0.367, 0.349, 0.33, 0.315, 0.301, 0.288, 0.276, 0.267, 0.259, 0.253, 0.25, 0.246, 0.244, 0.243, 0.243, 0.243, 0.242, 0.242, 0.245, 0.254, 0.271, 0.301];
const ISO_LU = [-31.6, -27.2, -23, -19.1, -15.9, -13, -10.3, -8.1, -6.2, -4.5, -3.1, -2, -1.1, -0.4, 0, 0.3, 0.5, 0, -2.7, -4.1, -1, 1.7, 2.5, 1.2, -2.1, -7.1, -11.2, -10.7, -3.1];
const ISO_TF = [78.5, 68.7, 59.5, 51.1, 44, 37.5, 31.5, 26.5, 22.1, 17.9, 14.4, 11.4, 8.6, 6.2, 4.4, 3, 2.2, 2.4, 3.5, 1.7, -1.3, -4.2, -6, -5.4, -1.5, 6, 12.6, 13.9, 12.3];

/** Sound pressure level (dB SPL) that sounds as loud as `phon` at table frequency index `i`. */
export function isoSpl(i: number, phon: number): number {
  const af = ISO_AF[i], lu = ISO_LU[i], tf = ISO_TF[i];
  const Af = 4.47e-3 * (Math.pow(10, 0.025 * phon) - 1.15) + Math.pow(0.4 * Math.pow(10, (tf + lu) / 10 - 9), af);
  return (10 / af) * Math.log10(Af) - lu + 94;
}

export const ISO_FREQS: readonly number[] = ISO_F;

/**
 * Boost (dB) at table index `i` that keeps a mix balanced as at `refPhon` when heard `dropDb`
 * quieter: how much more the contour rises there than at 1 kHz. Negative results clamp to 0.
 */
export function isoCompensation(i: number, refPhon: number, dropDb: number): number {
  const low = Math.max(refPhon - dropDb, 20);
  const k = ISO_F.indexOf(1000);
  const rise = isoSpl(i, low) - isoSpl(i, refPhon);
  const riseRef = isoSpl(k, low) - isoSpl(k, refPhon);
  return Math.max(0, rise - riseRef);
}

/** The listening level full volume is assumed to reach, in phon (a room at a loud-ish level). */
export const LOW_VOLUME_REF_PHON = 80;

/**
 * The two shelves for Fuller at low volume: the ISO 226 compensation at 100 Hz (low shelf)
 * and 10 kHz (high shelf), scaled by `strength` 0..1, never more than the drop itself (so the
 * boost cannot lift the signal above where the volume put it) and capped at 12 / 6 dB.
 */
export function lowVolumeShelves(dropDb: number, strength: number): { low: number; high: number } {
  const d = Math.max(0, dropDb);
  const i100 = ISO_F.indexOf(100), i10k = ISO_F.indexOf(10000);
  const low = Math.min(isoCompensation(i100, LOW_VOLUME_REF_PHON, d) * strength, 12, d);
  const high = Math.min(isoCompensation(i10k, LOW_VOLUME_REF_PHON, d) * strength, 6, d);
  return { low, high };
}
