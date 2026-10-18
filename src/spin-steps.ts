// The Press record's Spin FPS row (VINYL.md §12): how often the disc redraws. A pure rule, so
// tests/spin-steps.test.ts can pin it; vinyl.ts and the Settings hint read it.
//
// The disc steps at a rate that divides the display's rate evenly: the display rate ÷ a whole
// number, the one nearest the row's FPS. A rate that does not divide it (120 on a 144 Hz
// display) would hold one frame in six longer than the rest, and that judder shows.

/** The redraws a second the disc gets: `hz` ÷ the whole number that lands nearest `want`.
 *  `hz` null (not known yet) = `want` as it is. */
export function spinFps(hz: number | null, want: number): number {
  if (!hz || hz <= 0) return want;
  return hz / Math.max(1, Math.round(hz / want));
}

/** The spin's easing for one turn of `periodS` seconds: "linear" when the disc draws on every
 *  display frame anyway (or the rate is not known), else `steps(n)` with n steps a turn.
 *  Chromium draws no frame for a step whose angle did not change, so fewer steps = less work. */
export function spinEasing(periodS: number, hz: number | null, want: number): string {
  if (!hz || hz <= 0 || !(periodS > 0)) return "linear";
  const fps = spinFps(hz, want);
  if (fps >= hz) return "linear";
  return `steps(${Math.max(1, Math.round(periodS * fps))})`;
}
