// EQ presets (SOUND.md §2.2): the built-in curves, the ten-fader graphic fit, and the
// Equalizer APO / AutoEq text format for import and export. Pure data and math.

import { bandBiquads, chainDb, type Band, type BandType } from "./sound-dsp";

export interface EqPreset {
  name: string;
  bands: Band[];
  /** "rbj" for imported presets, whose authors designed against RBJ filters. */
  design: "matched" | "rbj";
  /** An imported preset's own preamp (dB), kept for export; the Preamp setting decides the level. */
  preampDb?: number;
}

export const MAX_BANDS = 10;

const pk = (freq: number, gain: number, q: number): Band => ({ on: true, type: "peak", freq, gain, q });
const ls = (freq: number, gain: number, q = 0.707): Band => ({ on: true, type: "lowshelf", freq, gain, q });
const hs = (freq: number, gain: number, q = 0.707): Band => ({ on: true, type: "highshelf", freq, gain, q });

/** Built-in presets, in the order the stepper walks them. Gentle on purpose: ±5 dB at most. */
export const BUILTIN: { id: string; preset: EqPreset }[] = [
  { id: "flat", preset: { name: "Flat", bands: [], design: "matched" } },
  { id: "bass", preset: { name: "Bass lift", bands: [ls(105, 5)], design: "matched" } },
  { id: "vocal", preset: { name: "Vocal", bands: [pk(250, -2, 1), pk(3000, 3, 1), pk(5500, 1.5, 1.2)], design: "matched" } },
  { id: "treble", preset: { name: "Treble lift", bands: [hs(8000, 4)], design: "matched" } },
  { id: "warm", preset: { name: "Warm", bands: [ls(180, 2.5), pk(3500, -1.5, 0.9), hs(10000, -2)], design: "matched" } },
  { id: "night", preset: { name: "Late night", bands: [ls(90, -4), pk(3000, 1.5, 0.9), hs(9000, -3)], design: "matched" } },
];

/** The ten faders of Graphic mode: octave centres, peaks wide enough to overlap smoothly. */
export const GRAPHIC_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const GRAPHIC_Q = 1.41;

/** True when `bands` are exactly the ten graphic peaks. */
export function isGraphic(bands: Band[]): boolean {
  return bands.length === GRAPHIC_FREQS.length && bands.every((b, i) => b.type === "peak" && b.freq === GRAPHIC_FREQS[i] && b.q === GRAPHIC_Q);
}

/**
 * Ten graphic peaks that reproduce `bands`' curve at the fader centres. The peaks overlap, so
 * a fader's gain is not simply the curve there: a few passes move each gain by the remaining
 * error until the curve at every centre is within 0.1 dB (or 12 passes).
 */
export function fitGraphic(bands: Band[], design: "matched" | "rbj", fs: number): Band[] {
  const want = bands.flatMap((b) => bandBiquads(b, fs, design));
  const target = GRAPHIC_FREQS.map((f) => chainDb(want, f, fs));
  const out = GRAPHIC_FREQS.map((f, i) => pk(f, Math.max(-12, Math.min(12, target[i])), GRAPHIC_Q));
  for (let pass = 0; pass < 12; pass++) {
    const chain = out.flatMap((b) => bandBiquads(b, fs, "matched"));
    let worst = 0;
    GRAPHIC_FREQS.forEach((f, i) => {
      const err = target[i] - chainDb(chain, f, fs);
      worst = Math.max(worst, Math.abs(err));
      out[i].gain = Math.max(-12, Math.min(12, out[i].gain + err * 0.7));
    });
    if (worst < 0.1) break;
  }
  out.forEach((b) => (b.gain = Math.round(b.gain * 10) / 10));
  return out;
}

// ── Equalizer APO / AutoEq text ────────────────────────────────────────────────

const APO_TYPES: Record<string, BandType> = {
  PK: "peak", PEQ: "peak", LS: "lowshelf", LSC: "lowshelf", HS: "highshelf", HSC: "highshelf",
  LP: "lowpass", LPQ: "lowpass", HP: "highpass", HPQ: "highpass", NO: "notch",
};
const TYPE_APO: Record<BandType, string> = { peak: "PK", lowshelf: "LSC", highshelf: "HSC", lowpass: "LPQ", highpass: "HPQ", notch: "NO" };

export interface ApoParse {
  preset: EqPreset | null;
  /** What the parse left out, for the panel's status line. */
  notes: string[];
}

/**
 * Parse `Preamp: -6.1 dB` and `Filter 1: ON PK Fc 105 Hz Gain 4.5 dB Q 0.70` lines. Unknown
 * lines are skipped and counted; bands past the tenth are dropped and said so.
 */
export function parseApo(text: string, name: string): ApoParse {
  const notes: string[] = [];
  const bands: Band[] = [];
  let preampDb: number | undefined;
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const pre = /^preamp:\s*(-?[\d.]+)\s*db/i.exec(line);
    if (pre) {
      preampDb = Number(pre[1]);
      continue;
    }
    const f = /^filter\s*\d*:\s*(on|off)\s+([a-z]+)\s+fc\s+([\d.]+)\s*hz(?:\s+gain\s+(-?[\d.]+)\s*db)?(?:\s+q\s+([\d.]+))?/i.exec(line);
    const type = f && APO_TYPES[f[2].toUpperCase()];
    if (!f || !type) {
      skipped++;
      continue;
    }
    bands.push({ on: f[1].toLowerCase() === "on", type, freq: Number(f[3]), gain: f[4] ? Number(f[4]) : 0, q: f[5] ? Number(f[5]) : 0.707 });
  }
  if (skipped) notes.push(`${skipped} line${skipped === 1 ? "" : "s"} not understood`);
  if (bands.length > MAX_BANDS) {
    notes.push(`kept the first ${MAX_BANDS} of ${bands.length} filters`);
    bands.length = MAX_BANDS;
  }
  if (!bands.length) return { preset: null, notes: notes.length ? notes : ["no filters found"] };
  return { preset: { name, bands, design: "rbj", preampDb }, notes };
}

export function toApo(p: EqPreset, preampDb: number): string {
  const lines = [`# ${p.name} — DeetsMusic`, `Preamp: ${preampDb.toFixed(1)} dB`];
  p.bands.forEach((b, i) => {
    const gain = b.type === "peak" || b.type === "lowshelf" || b.type === "highshelf" ? ` Gain ${b.gain.toFixed(1)} dB` : "";
    lines.push(`Filter ${i + 1}: ${b.on ? "ON" : "OFF"} ${TYPE_APO[b.type]} Fc ${Math.round(b.freq)} Hz${gain} Q ${b.q.toFixed(2)}`);
  });
  return lines.join("\n") + "\n";
}
