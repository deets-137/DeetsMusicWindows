// spin-steps.ts: the Press record's Spin FPS row (VINYL.md §12).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spinFps, spinEasing } from "../src/spin-steps.ts";

test("240 Hz: each choice divides the display rate", () => {
  assert.equal(spinFps(240, 60), 60);
  assert.equal(spinFps(240, 120), 120);
  assert.equal(spinFps(240, 144), 120); // 144 does not divide 240: the nearest that does
  assert.equal(spinFps(240, 240), 240);
});

test("144 Hz: the 120 default stays at the full rate (no judder, 2026-10-17)", () => {
  assert.equal(spinFps(144, 120), 144);
  assert.equal(spinFps(144, 60), 72);
  assert.equal(spinFps(144, 240), 144);
});

test("60 Hz and 165 Hz", () => {
  assert.equal(spinFps(60, 120), 60);
  assert.equal(spinFps(60, 60), 60);
  assert.equal(spinFps(165, 120), 165);
  assert.equal(spinFps(165, 60), 55);
});

test("an unknown rate keeps the choice and the plain spin", () => {
  assert.equal(spinFps(null, 120), 120);
  assert.equal(spinEasing(3.6, null, 120), "linear");
});

test("the easing: steps per turn at the rate, linear at the full rate", () => {
  assert.equal(spinEasing(3.6, 240, 120), "steps(432)"); // 16⅔ rpm, the blind test's spin
  assert.equal(spinEasing(60 / 78, 240, 120), "steps(92)"); // 78 rpm
  assert.equal(spinEasing(3.6, 240, 240), "linear");
  assert.equal(spinEasing(3.6, 144, 120), "linear");
  assert.equal(spinEasing(3.6, 60, 60), "linear");
  assert.equal(spinEasing(0, 240, 120), "linear");
});
