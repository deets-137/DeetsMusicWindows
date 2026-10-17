// reveal-wave.ts: the diagonal wave of a card's first screen (UX-COVERUPS.md §7.2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { waveDelays, type Box } from "../src/reveal-wave.ts";

const grid = (lines: number, cols: number, h = 100): Box[] => {
  const out: Box[] = [];
  for (let r = 0; r < lines; r++) for (let c = 0; c < cols; c++) out.push({ top: r * (h + 8), left: c * 120, height: h });
  return out;
};

test("a grid: delay is (line + column) over the whole span, first 0, last the span", () => {
  const d = waveDelays(grid(3, 4), 500);
  assert.equal(d[0].delay, 0);
  assert.equal(d[11].delay, 500); // line 2, column 3: (2 + 3) / (3 + 4 - 2)
  assert.equal(d[1].delay, 100); // line 0, column 1
  assert.equal(d[4].delay, 100); // line 1, column 0: the same step as its diagonal neighbour
});

test("one column: one by one, the same total span", () => {
  const d = waveDelays(grid(6, 1, 48), 500);
  assert.deepEqual(d.map((x) => x.delay), [0, 100, 200, 300, 400, 500]);
});

test("a 40-tile grid takes the same span as 6 rows", () => {
  const d = waveDelays(grid(5, 8), 500);
  assert.equal(Math.max(...d.map((x) => x.delay)), 500);
});

test("a single tile has no delay", () => {
  assert.deepEqual(waveDelays([{ top: 0, left: 0, height: 50 }], 500), [{ delay: 0, order: 0 }]);
});

test("reading order: by line, then left; a top within half a tile is the same line", () => {
  const boxes: Box[] = [
    { top: 110, left: 0, height: 100 }, // line 1
    { top: 3, left: 240, height: 100 }, // line 0, a little lower than its line's first
    { top: 0, left: 0, height: 100 }, // line 0
  ];
  assert.deepEqual(
    waveDelays(boxes, 300).map((x) => x.order),
    [2, 1, 0],
  );
});

test("no tiles: nothing", () => {
  assert.deepEqual(waveDelays([], 500), []);
});
