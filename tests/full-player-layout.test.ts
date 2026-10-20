// full-player-layout.ts: the full player's pure rules (features/fullscreen-player.md §12.2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { rowsPlace, fullArtPx, fullClipFrom, flightFrom, stillCutRight } from "../src/full-player-layout.ts";

test("2026-10-11 a wide card has the controls under the cover, never beside it", () => {
  assert.equal(rowsPlace(1100, 700, 356, 150, 12), "below");
  assert.equal(rowsPlace(1056, 700, 356, 150, 12), "below"); // exactly wideW wider
  assert.equal(rowsPlace(1055, 700, 356, 150, 12), "over"); // not wide, no space under: the band
  assert.equal(rowsPlace(2400, 700, 356), "below"); // ultrawide, even before a measure
  assert.equal(rowsPlace(700, 700, 356), "over");
  assert.equal(rowsPlace(447, 600, 356), "over"); // Midi: taller than wide, no height given
});

test("2026-10-11 the controls go under the cover only when the space under it holds them", () => {
  // Screenshot 2: a card 698 × 960, controls 150 tall with a 12 px gap → 262 free, they fit.
  assert.equal(rowsPlace(698, 960, 356, 150, 12), "below");
  assert.equal(rowsPlace(698, 860, 356, 150, 12), "below"); // exactly 162 free
  assert.equal(rowsPlace(698, 859, 356, 150, 12), "over"); // one pixel short: on the band
  assert.equal(rowsPlace(698, 698, 356, 150, 12), "over"); // screenshot 1: no space under it
  assert.equal(rowsPlace(447, 600, 356), "over"); // no height given: never below
});

test("the cover file is the box in device pixels, rounded up to 200 (§12.5 examples)", () => {
  assert.equal(fullArtPx(700, 1.25, 480), 1000);
  assert.equal(fullArtPx(992, 1.5, 640), 1600);
  assert.equal(fullArtPx(992, 2, 640), 2000);
});

test("the cover file is never smaller than the rest size nor larger than 2000", () => {
  assert.equal(fullArtPx(100, 1, 480), 480);
  assert.equal(fullArtPx(3000, 2, 640), 2000);
  assert.equal(fullArtPx(500, 0, 480), 600); // a missing scale reads as 1
});

test("a resize inside one 200 px bucket asks for the same file", () => {
  assert.equal(fullArtPx(801, 1, 480), fullArtPx(999, 1, 480));
});

test("Max opens from a zero-width line on the full box's left edge (§9.2.2)", () => {
  const rest = { left: 12, top: 52, right: 352, bottom: 500 };
  const full = { left: 364, top: 52, right: 1088, bottom: 808 };
  assert.deepEqual(fullClipFrom(rest, full, "max"), { left: 364, right: 364, top: 52, bottom: 808 });
});

test("2026-10-14: the Max line stays zero wide after the clip's pad", () => {
  const rest = { left: 12, top: 52, right: 352, bottom: 500 };
  const full = { left: 364, top: 52, right: 1088, bottom: 808 };
  const pad = 24;
  const box = fullClipFrom(rest, full, "max", pad);
  // clipBetween shows box.left - pad … box.right + pad: one x, the full box's left edge.
  assert.equal(box.left - pad, full.left);
  assert.equal(box.right + pad, full.left);
});

test("Midi opens from the strip, held inside the full box", () => {
  const rest = { left: 11, top: 52, right: 484, bottom: 200 };
  const full = { left: 12, top: 52, right: 483, bottom: 658 };
  assert.deepEqual(fullClipFrom(rest, full, "midi"), { left: 12, top: 52, right: 483, bottom: 200 });
});

test("2026-10-19 the resting still shows only where the moving box is not", () => {
  // His 1080 × 950 Max window: the resting card in column 1, the full card over columns 2–3.
  const rest = { left: 12, top: 52, right: 352, bottom: 560 };
  // The box starts on the full card, right of the place: the still is cut past its own edge,
  // so it shows whole (the Queue covers it at that moment).
  assert.equal(stillCutRight(rest, 365), -13);
  // Halfway, the box's left edge is inside the place: the still shows left of it only.
  assert.equal(stillCutRight(rest, 188), 164);
  // Landed: the box is on the place, the still is cut to nothing.
  assert.equal(stillCutRight(rest, 12), rest.right - rest.left);
});

test("the flight puts the large picture on the small one", () => {
  const small = { left: 20, top: 60, right: 140, bottom: 180 };
  const large = { left: 24, top: 64, right: 504, bottom: 544 };
  assert.deepEqual(flightFrom(small, large), { dx: -4, dy: -4, scale: 0.25 });
});
