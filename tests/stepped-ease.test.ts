// stepped-ease.ts: the Ocean heave's curve, stepped at --ambient-fps (OCEAN.md §6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { bezierAt, parseBezier, parseSeconds, steppedEase } from "../src/stepped-ease.ts";

const heave = parseBezier("cubic-bezier(0.37, 0, 0.63, 1)")!;

test("parses the heave's token and the keywords", () => {
  assert.deepEqual(heave, [0.37, 0, 0.63, 1]);
  assert.deepEqual(parseBezier(" ease-in-out "), [0.42, 0, 0.58, 1]);
  assert.equal(parseBezier("steps(4)"), null);
  assert.equal(parseBezier("cubic-bezier(1, 2)"), null);
});

test("parses a CSS time in seconds", () => {
  assert.equal(parseSeconds(" 1.1s"), 1.1);
  assert.equal(parseSeconds("300ms"), 0.3);
  assert.equal(parseSeconds("fast"), null);
});

test("the curve holds its ends and its symmetric middle", () => {
  assert.equal(bezierAt(heave, 0), 0);
  assert.equal(bezierAt(heave, 1), 1);
  assert.ok(Math.abs(bezierAt(heave, 0.5) - 0.5) < 1e-6);
  assert.ok(Math.abs(bezierAt([0, 0, 1, 1], 0.3) - 0.3) < 1e-6);
});

test("1.1 s at 30 fps is 33 flat steps on the eased curve (the 2026-09-27 cap)", () => {
  const css = steppedEase(heave, 1.1, 30);
  const points = css.slice("linear(".length, -1).split(", ");
  assert.equal(points.length, 33 * 2 + 1);
  assert.equal(points[0], "0 0%");
  assert.equal(points.at(-1), "1 100%");
  // each step is flat: its start and end share a value
  for (let k = 0; k < 33; k++) assert.equal(points[2 * k].split(" ")[0], points[2 * k + 1].split(" ")[0]);
  // the ease is kept: the first steps rise slower than a straight line would
  assert.ok(Number(points[2].split(" ")[0]) < 1 / 33);
});

test("Reduced (15 fps) halves the steps; a tiny duration still has one", () => {
  assert.equal(steppedEase(heave, 1.1, 15).split(", ").length, 17 * 2 + 1);
  assert.equal(steppedEase(heave, 0.001, 30).split(", ").length, 3);
});
