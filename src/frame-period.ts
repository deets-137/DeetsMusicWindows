// The pure rule behind `sampleHz` (frames.ts; DEBUGGING.md §Frame telemetry): which frame
// period a sample of rAF gaps is worth. No DOM, so tests/frame-period.test.ts can pin it.

/**
 * The period (ms) this sample says, or null to keep `current`. A gap is never SHORTER than
 * the real period, so the truth sits at the fast end: take the 20th percentile, not the
 * median (a median taken once in a busy moment pinned a 238 Hz display at 34 Hz, 2026-09-16).
 * The first valid sample stands as it is (a display slower than the 60 Hz default is real);
 * after that only a faster reading wins. A reading outside 2–100 ms is noise.
 */
export function nextPeriod(gaps: readonly number[], current: number, sampled: boolean): number | null {
  if (!gaps.length) return null;
  const sorted = [...gaps].sort((a, b) => a - b);
  const p20 = sorted[Math.floor(sorted.length * 0.2)];
  if (p20 > 2 && p20 < 100 && (!sampled || p20 < current)) return p20;
  return null;
}
