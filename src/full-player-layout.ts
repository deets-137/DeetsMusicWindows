// The full player's pure rules (features/fullscreen-player.md §12.2): where the rows go, how
// large a cover file to ask for, and where the open's clip starts. No DOM here, so
// tests/full-player-layout.test.ts covers them.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type RowsPlace = "over" | "below";

/** The rows sit OVER the cover on the band (§7.3), or the controls sit BELOW it and only the
 *  title, artist and album stay on the band (his calls, 2026-10-11):
 *  - below when the space under the full-size square holds the controls (`controlsH`, plus
 *    the `gap` above them): the cover keeps its full size;
 *  - below when the card is at least `wideW` wider than it is tall (a wide or ultrawide
 *    window): the cover gives up the controls' height. There is no column beside the cover;
 *    this test is where that column used to start;
 *  - else over: the largest square, the controls on the band. */
export function rowsPlace(cardW: number, cardH: number, wideW: number, controlsH = Infinity, gap = 0): RowsPlace {
  if (cardW - cardH >= wideW) return "below";
  return cardH - Math.min(cardW, cardH) >= controlsH + gap ? "below" : "over";
}

/** The largest file the cover box needs (§12.5): the box in device pixels, rounded UP to a
 *  200 px bucket so a resize asks again only when the bucket changes; never smaller than the
 *  rest size (`base`, stageArtPx), never larger than 2000. */
export function fullArtPx(boxCssPx: number, dpr: number, base: number): number {
  const want = Math.ceil((boxCssPx * (dpr > 0 ? dpr : 1)) / 200) * 200;
  return Math.min(2000, Math.max(base, want));
}

/** The box the open's clip starts from (§9.2.2). Midi only since 2026-10-19: Max moves a card
 *  box instead (§14.10, `stillCutRight`). Midi: the strip, which is inside the full
 *  box. Max: the rest box is in the stage column, OUTSIDE the full box, so the card opens from
 *  a zero-width line on the full box's left edge (the gap beside the stage). `pad` is the clip's
 *  own pad (clipBetween opens every edge past the box by it, for the shadow): the line's edges
 *  are pulled in by it, so the line is zero wide ON SCREEN. Without that, the close ended on a
 *  2 × pad strip of the full card that vanished in one frame (2026-10-14). */
export function fullClipFrom(rest: Box, full: Box, surface: "midi" | "max", pad = 0): Box {
  if (surface === "max") return { left: full.left + pad, right: full.left - pad, top: full.top, bottom: full.bottom };
  // The strip, held inside the full box (a launch lift or a rounding can leave it a pixel out).
  return {
    left: Math.max(rest.left, full.left),
    right: Math.min(rest.right, full.right),
    top: Math.max(rest.top, full.top),
    bottom: Math.min(rest.bottom, full.bottom),
  };
}

/** Max's moving card box (§14.10): Now Playing's resting place in column 1 is filled by a bare
 *  still of the card, cut where the moving box covers it, so the two never overlap (two Glass
 *  cards on top of each other showed a darker patch). The box covers the place from top to
 *  bottom in every Max layout (its top and bottom edges never come inside the place's), so the
 *  cut is only the still's right edge: the box's left edge, in the still's own frame. Linear in
 *  the box's left edge, so a keyframe at each end of the motion follows the box exactly (the
 *  same easing). Returns the `inset()` right value at a box whose left edge is `boxLeft`. */
export function stillCutRight(rest: Box, boxLeft: number): number {
  return rest.right - boxLeft;
}

/** The transform that puts a picture at `from` onto `to` (a flight copy laid out at `to`):
 *  the translate of the top-left corner and one scale (both boxes are squares). */
export function flightFrom(from: Box, to: Box): { dx: number; dy: number; scale: number } {
  const toW = to.right - to.left;
  const scale = toW > 0 ? (from.right - from.left) / toW : 1;
  return { dx: from.left - to.left, dy: from.top - to.top, scale };
}
