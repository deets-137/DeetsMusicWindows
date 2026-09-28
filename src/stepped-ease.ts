// A stepped copy of an easing curve, for a CSS transition (docs/features/OCEAN.md §6).
// `steps()` holds each frame still but replaces the ease with a straight line; a skin's
// looping animations keep their ease in sine-sampled keyframes, and a transition has no
// keyframes. So this samples the curve at `fps` and writes it as a CSS `linear()` with a
// flat run per step: the same shape, drawn at most `fps` times a second.
//
// Why: the Ocean heave is re-aimed every 300 ms, so its 1.1 s transition never ends and the
// whole window composited at the display rate while music played (31 % GPU-process CPU on a
// 244 Hz screen against 8 % without music, measured 2026-09-27).

export type Bezier = [number, number, number, number];

const KEYWORDS: Record<string, Bezier> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

/** A CSS timing function (a keyword or `cubic-bezier(…)`) as its four numbers, or null. */
export function parseBezier(css: string): Bezier | null {
  const s = css.trim();
  if (s in KEYWORDS) return KEYWORDS[s];
  const m = /^cubic-bezier\(([^)]*)\)$/.exec(s);
  if (!m) return null;
  const n = m[1].split(",").map(Number);
  return n.length === 4 && n.every(Number.isFinite) ? (n as Bezier) : null;
}

/** A CSS time (`1.1s`, `300ms`) in seconds, or null. */
export function parseSeconds(css: string): number | null {
  const m = /^(-?[\d.]+)(ms|s)$/.exec(css.trim());
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? (m[2] === "ms" ? v / 1000 : v) : null;
}

/** The curve's progress at time x (0…1). */
export function bezierAt([x1, y1, x2, y2]: Bezier, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const coord = (t: number, a: number, b: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  // x(t) is monotonic for 0 ≤ x1, x2 ≤ 1: bisect for the t that gives x, then read y there.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (coord(mid, x1, x2) < x) lo = mid;
    else hi = mid;
  }
  return coord((lo + hi) / 2, y1, y2);
}

/**
 * `linear()` that holds each of round(seconds × fps) steps flat at the curve's value where the
 * step starts (the same jump-end rule as `steps()`), and lands on 1 at the end.
 */
export function steppedEase(curve: Bezier, seconds: number, fps: number): string {
  const n = Math.max(1, Math.round(seconds * fps));
  const pct = (k: number) => `${+((k / n) * 100).toFixed(3)}%`;
  const parts: string[] = [];
  for (let k = 0; k < n; k++) {
    const y = +bezierAt(curve, k / n).toFixed(4);
    parts.push(`${y} ${pct(k)}`, `${y} ${pct(k + 1)}`);
  }
  parts.push("1 100%");
  return `linear(${parts.join(", ")})`;
}
