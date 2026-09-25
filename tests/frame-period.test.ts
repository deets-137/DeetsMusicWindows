// frame-period.ts: which display period a sample of frame gaps is worth (DEBUGGING.md §Frame telemetry).
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextPeriod } from "../src/frame-period.ts";

const at144 = 1000 / 144;
const sample = (base: number, slow: number[] = []) => [...Array(40 - slow.length).fill(base), ...slow];

test("a busy stretch does not pin a fast display slow (the 2026-09-16 bug)", () => {
  // 40 gaps: 25 at 144 Hz, 15 slow ones from a busy moment. The median would be slow.
  const gaps = sample(at144, Array(15).fill(29));
  assert.equal(nextPeriod(gaps, 1000 / 60, false), at144);
});

test("the first valid sample stands, even when slower than the 60 Hz default", () => {
  assert.equal(nextPeriod(sample(1000 / 50), 1000 / 60, false), 1000 / 50);
});

test("after the first sample, only a faster reading wins", () => {
  assert.equal(nextPeriod(sample(1000 / 60), at144, true), null);
  assert.equal(nextPeriod(sample(at144), 1000 / 60, true), at144);
});

test("readings outside 2 to 100 ms are noise", () => {
  assert.equal(nextPeriod(sample(1), 1000 / 60, false), null);
  assert.equal(nextPeriod(sample(150), 1000 / 60, false), null);
  assert.equal(nextPeriod([], 1000 / 60, false), null);
});
