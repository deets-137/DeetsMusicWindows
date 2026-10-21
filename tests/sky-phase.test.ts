// sky-phase.ts: the sky over a scene skin (docs/features/happy.md §2.3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { skyAt } from "../src/sky-phase.ts";

const MIN = 60_000;
const rise = Date.UTC(2026, 9, 21, 7, 0);
const set = Date.UTC(2026, 9, 21, 18, 0);
const sun = { rise, set };
const at = (ms: number) => skyAt("follow", ms, sun);

test("a held choice shows one part and no blend", () => {
  assert.deepEqual(skyAt("day", rise, sun), { from: "day", to: "day", t: 0, moon: false });
  assert.deepEqual(skyAt("sunrise", set, sun), { from: "dawn", to: "dawn", t: 0, moon: false });
  assert.deepEqual(skyAt("sunset", rise, sun), { from: "dusk", to: "dusk", t: 0, moon: false });
  assert.deepEqual(skyAt("night", rise + 300 * MIN, sun), { from: "night", to: "night", t: 0, moon: true });
});

test("follow: night before dawn, with the moon", () => {
  assert.deepEqual(at(rise - 120 * MIN), { from: "night", to: "night", t: 0, moon: true });
});

test("follow: night blends into dawn before sunrise", () => {
  const s = at(rise - 35 * MIN);
  assert.equal(s.from, "night");
  assert.equal(s.to, "dawn");
  assert.ok(Math.abs(s.t - 0.5) < 1e-9);
});

test("follow: dawn holds around sunrise, the moon gone", () => {
  assert.deepEqual(at(rise), { from: "dawn", to: "dawn", t: 0, moon: false });
});

test("follow: midday is day", () => {
  assert.deepEqual(at(rise + 300 * MIN), { from: "day", to: "day", t: 0, moon: false });
});

test("follow: day blends into dusk before sunset", () => {
  const s = at(set - 40 * MIN);
  assert.equal(s.from, "day");
  assert.equal(s.to, "dusk");
  assert.ok(Math.abs(s.t - 0.5) < 1e-9);
});

test("follow: dusk blends into night, the moon up", () => {
  const s = at(set + 35 * MIN);
  assert.equal(s.from, "dusk");
  assert.equal(s.to, "night");
  assert.equal(s.moon, true);
});

test("follow: late night is night", () => {
  assert.deepEqual(at(set + 240 * MIN), { from: "night", to: "night", t: 0, moon: true });
});

test("the sun up or down all day holds that part", () => {
  assert.deepEqual(skyAt("follow", rise, "day"), { from: "day", to: "day", t: 0, moon: false });
  assert.deepEqual(skyAt("follow", rise, "night"), { from: "night", to: "night", t: 0, moon: true });
});
