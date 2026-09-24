// Ocean's swell texture (docs/features/OCEAN.md). Pure math, no DOM: `swellLayer` paints one
// depth band of the sea into RGBA pixels, which ocean-worker.ts turns into a PNG and ocean.ts
// sets as a plain background. The boxes then only move (transform), so the compositor carries
// every frame and nothing is painted again.
//
// A row is one line of swell at a given distance. Its crest is a Gerstner (trochoidal) wave:
// sharp at the top, broad in the trough, the shape of a heavy sea. Under each crest the wave's
// body is painted in the water's own color, darkening into the trough, so a nearer swell hides
// the water behind it. Every row has a whole number of waves across the tile, so the tile
// repeats sideways with no seam and a box can roll by whole tiles.

export interface Row {
  /** The row's rest line, in CSS px from the top of the sea. */
  y: number;
  /** Crest height in CSS px. */
  amp: number;
  /** Waves across the tile (a whole number). */
  k: number;
  /** 0–0.8: how sharp the crests are (Gerstner steepness). */
  steep: number;
  /** 0–1: how bright the crest line is (far rows fade into haze). */
  lit: number;
  /** CSS px: how far the wave's body reaches down from its crest. */
  body: number;
  /** CSS px: half-width of the crest line. */
  line: number;
}

export interface LayerSpec {
  /** Tile width and sea height in device px; `px` = device px per CSS px. */
  w: number;
  h: number;
  px: number;
  rows: Row[];
  /** Colors, 0–255: the crest ink, the water at the top and at the bottom of the sea. */
  ink: [number, number, number];
  top: [number, number, number];
  bottom: [number, number, number];
  /** 0–1: how much darker the trough is right under a crest. */
  shade: number;
  seed: number;
  /** The album light (OCEAN.md §7): paint only the crest lines, as neon, over nothing. Each
   *  row's body erases the light behind it, so a nearer swell still hides the rows behind. The
   *  same seed gives the same crests as the band, so the neon lies on the band's lines. */
  neon?: {
    /** The line's core (the album color lifted toward white on dark water). */
    core: [number, number, number];
    /** The bloom around it (the album color). */
    bloom: [number, number, number];
  };
}

/** The three depth bands. Each rolls at its own speed; the tile widths (CSS px) are wide so a
 *  crest's shape does not visibly repeat, and a near wave can be long. */
export const BANDS = [
  { name: "far", tile: 360 },
  { name: "mid", tile: 720 },
  { name: "near", tile: 1200 },
] as const;
export type BandName = (typeof BANDS)[number]["name"];

/**
 * The rows of a sea `height` CSS px tall, in perspective: close together and flat at the top
 * (the horizon), each gap `growth` times the last, so the rows spread out, rise and lengthen
 * toward the bottom (near). Far rows fade into haze. Each row belongs to the band of its depth.
 */
export function seaRows(height: number, growth = 1.1, first = 6): Record<BandName, Row[]> {
  const out: Record<BandName, Row[]> = { far: [], mid: [], near: [] };
  let y = 3, gap = first;
  while (y < height + 60) {
    const t = Math.min(1, y / height); // 0 horizon … 1 bottom
    const band = t < 0.3 ? 0 : t < 0.62 ? 1 : 2;
    const tile = BANDS[band].tile;
    const wavelength = 40 + 300 * t ** 1.2;
    out[BANDS[band].name].push({
      y,
      amp: 0.8 + 20 * t ** 1.5,
      k: Math.max(1, Math.round(tile / wavelength)),
      steep: 0.45 + 0.35 * t,
      lit: 0.18 + 0.82 * t ** 0.8,
      body: Math.max(4, gap * 0.9),
      line: 0.45 + 0.5 * t,
    });
    y += gap;
    gap *= growth;
  }
  return out;
}

/** A tiny seeded generator (mulberry32), so a layer is the same on every launch. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Paint one depth band. Rows are painted far to near (top to bottom), each over the last. */
export function swellLayer(s: LayerSpec): { w: number; h: number; data: Uint8ClampedArray } {
  const { w, h, px } = s;
  const rand = rng(s.seed);
  const tau = Math.PI * 2;
  // premultiplied RGBA in floats while painting
  const r = new Float32Array(w * h), g = new Float32Array(w * h), b = new Float32Array(w * h), a = new Float32Array(w * h);
  const over = (i: number, cr: number, cg: number, cb: number, ca: number) => {
    const k = 1 - ca;
    r[i] = cr * ca + r[i] * k;
    g[i] = cg * ca + g[i] * k;
    b[i] = cb * ca + b[i] * k;
    a[i] = ca + a[i] * k;
  };
  const rows = [...s.rows].sort((p, q) => p.y - q.y);
  for (const row of rows) {
    const ph = rand() * tau;
    // the crests rise and fall along the row in sets, as a real swell does
    const setK = 1 + Math.floor(rand() * 2);
    const setPh = rand() * tau;
    const y0 = row.y * px, amp = row.amp * px, body = row.body * px, line = row.line * px;
    const sq = Math.min(0.8, row.steep);
    for (let x = 0; x < w; x++) {
      // Gerstner: x = (θ − s·sin θ) / k, y = −A·cos θ. Solve θ for this column (Newton).
      const target = (tau * row.k * x) / w + ph;
      let th = target;
      for (let n = 0; n < 6; n++) th -= (th - sq * Math.sin(th) - target) / (1 - sq * Math.cos(th));
      const set = 0.62 + 0.38 * Math.sin((tau * setK * x) / w + setPh);
      const yc = y0 - amp * set * Math.cos(th);
      const lo = Math.max(0, Math.floor(yc - 4 * px)), hi = Math.min(h - 1, Math.ceil(yc + body));
      if (s.neon) {
        neonColumn(s.neon, row, x, yc, px, w, h, r, g, b, a, over);
        continue;
      }
      for (let y = lo; y <= hi; y++) {
        const d = y - yc;
        const i = y * w + x;
        const t = y / (h - 1);
        const wr = s.top[0] + (s.bottom[0] - s.top[0]) * t;
        const wg = s.top[1] + (s.bottom[1] - s.top[1]) * t;
        const wb = s.top[2] + (s.bottom[2] - s.top[2]) * t;
        if (d >= 0) {
          // the body: the water's own color, darkest just under the crest, fading out below
          const dark = 1 - s.shade * (1 - smooth(0, body * 0.8, d));
          over(i, wr * dark, wg * dark, wb * dark, 1 - smooth(body * 0.55, body, d));
        }
        // the crest line, with a faint light just above it
        const edge = Math.exp(-((d / line) ** 2));
        const halo = d < 0 ? 0.18 * Math.exp(d / (2.5 * px)) : 0;
        const la = row.lit * Math.max(edge, halo);
        if (la > 0.002) over(i, s.ink[0], s.ink[1], s.ink[2], la);
      }
    }
  }
  return unpremultiply(w, h, r, g, b, a);
}

/** One column of one row, in neon: erase the light the row's body covers, then the bloom
 *  (reaching further above the crest than below it, onto the row's own water), then the core.
 *  The bloom is wider and the line brighter on the near rows, as the band's own line is. */
function neonColumn(
  n: NonNullable<LayerSpec["neon"]>,
  row: Row,
  x: number,
  yc: number,
  px: number,
  w: number,
  h: number,
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  a: Float32Array,
  over: (i: number, cr: number, cg: number, cb: number, ca: number) => void,
): void {
  const body = row.body * px, line = row.line * px * 1.3;
  const sigma = (2 + 7 * row.lit) * px;
  const lo = Math.max(0, Math.floor(yc - 3 * sigma)), hi = Math.min(h - 1, Math.ceil(yc + body));
  for (let y = lo; y <= hi; y++) {
    const d = y - yc;
    const i = y * w + x;
    if (d >= 0) {
      const keep = smooth(body * 0.55, body, d);
      r[i] *= keep;
      g[i] *= keep;
      b[i] *= keep;
      a[i] *= keep;
    }
    const glow = 0.55 * row.lit * Math.exp(-((d / (d < 0 ? sigma : sigma * 0.5)) ** 2));
    if (glow > 0.002) over(i, n.bloom[0], n.bloom[1], n.bloom[2], glow);
    const core = row.lit * Math.exp(-((d / line) ** 2));
    if (core > 0.002) over(i, n.core[0], n.core[1], n.core[2], core);
  }
}

/** Premultiplied float planes → straight RGBA bytes. */
function unpremultiply(w: number, h: number, r: Float32Array, g: Float32Array, b: Float32Array, a: Float32Array) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < a.length; i++, j += 4) {
    const al = a[i];
    if (al <= 0) continue;
    data[j] = r[i] / al;
    data[j + 1] = g[i] / al;
    data[j + 2] = b[i] / al;
    data[j + 3] = al * 255;
  }
  return { w, h, data };
}
