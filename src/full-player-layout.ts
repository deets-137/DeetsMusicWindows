// The full player's pure rules (ideas/fullscreen-player.md §12.2): where the rows go, how
// large a cover file to ask for, and where the open's clip starts. No DOM here, so
// tests/full-player-layout.test.ts covers them.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The rows sit BESIDE the cover when the card is at least `rowsW` wider than it is tall (the
 *  cover is then the card's height and the rows take the rest), else OVER the cover on the
 *  band (§7.3). Over gives the largest square at every size; beside only when it costs none. */
export function rowsPlace(cardW: number, cardH: number, rowsW: number): "beside" | "over" {
  return cardW - cardH >= rowsW ? "beside" : "over";
}

/** The largest file the cover box needs (§12.5): the box in device pixels, rounded UP to a
 *  200 px bucket so a resize asks again only when the bucket changes; never smaller than the
 *  rest size (`base`, stageArtPx), never larger than 2000. */
export function fullArtPx(boxCssPx: number, dpr: number, base: number): number {
  const want = Math.ceil((boxCssPx * (dpr > 0 ? dpr : 1)) / 200) * 200;
  return Math.min(2000, Math.max(base, want));
}

/** The box the open's clip starts from (§9.2.2). Midi: the strip, which is inside the full
 *  box. Max: the rest box is in the stage column, OUTSIDE the full box, so the card opens from
 *  a zero-width line on the full box's left edge (the gap beside the stage). */
export function fullClipFrom(rest: Box, full: Box, surface: "midi" | "max"): Box {
  if (surface === "max") return { left: full.left, right: full.left, top: full.top, bottom: full.bottom };
  // The strip, held inside the full box (a launch lift or a rounding can leave it a pixel out).
  return {
    left: Math.max(rest.left, full.left),
    right: Math.min(rest.right, full.right),
    top: Math.max(rest.top, full.top),
    bottom: Math.min(rest.bottom, full.bottom),
  };
}

/** The transform that puts a picture at `from` onto `to` (a flight copy laid out at `to`):
 *  the translate of the top-left corner and one scale (both boxes are squares). */
export function flightFrom(from: Box, to: Box): { dx: number; dy: number; scale: number } {
  const toW = to.right - to.left;
  const scale = toW > 0 ? (from.right - from.left) / toW : 1;
  return { dx: from.left - to.left, dy: from.top - to.top, scale };
}
