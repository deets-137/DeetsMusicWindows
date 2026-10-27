// wheel-step.ts: the wheel on the volume (WHEEL-VOLUME.md), the trackpad cap from 2026-10-27.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeWheelStepper, isNotch, STEP, SMOOTH_RISE_PER_S } from "../src/wheel-step.ts";

const notch = (t: number, up = true) => ({ deltaY: up ? -100 : 100, wheelDeltaY: up ? 120 : -120, deltaMode: 0, t });
const pad = (t: number, w: number) => ({ deltaY: -w / 1.2, wheelDeltaY: w, deltaMode: 0, t });
const run = (events: ReturnType<typeof notch>[]) => {
  const step = makeWheelStepper();
  return events.map(step);
};
const total = (out: { steps: number }[]) => out.reduce((s, o) => s + o.steps, 0);

test("a notched mouse: one step per notch, never capped", () => {
  const out = run(Array.from({ length: 10 }, (_, i) => notch(i * 10)));
  assert.equal(total(out), 10);
  assert.ok(out.every((o) => o.device === "notch"));
  assert.equal(out[0].note, "start");
});

test("a touchpad swipe no longer jumps to full volume (2026-10-27)", () => {
  // 50 small events in 500 ms, 10 notches of travel: one step per event used to be +250 %.
  const out = run(Array.from({ length: 50 }, (_, i) => pad(i * 10, 24)));
  assert.equal(out[0].device, "smooth");
  const risen = total(out) * STEP;
  assert.ok(risen <= STEP + SMOOTH_RISE_PER_S * 0.49 + 1e-9, `rose ${risen}`);
  assert.ok(risen >= 0.2, `rose only ${risen}`);
});

test("a touchpad's coast after the lift stays under the cap", () => {
  // A full second of fast events: at most 40 % plus the first step.
  const out = run(Array.from({ length: 100 }, (_, i) => pad(i * 10, 120 * 0.9)));
  assert.ok(total(out) * STEP <= STEP + SMOOTH_RISE_PER_S + 1e-9);
});

test("lowering is never held back", () => {
  const out = run(Array.from({ length: 50 }, (_, i) => pad(i * 10, -24)));
  assert.equal(total(out), -10);
});

test("small travel adds up to one step", () => {
  const out = run([pad(0, 40), pad(10, 40), pad(20, 40)]);
  assert.deepEqual(out.map((o) => o.steps), [0, 0, 1]);
});

test("turning back starts the count over", () => {
  const out = run([pad(0, 80), pad(10, -80), pad(20, -80)]);
  assert.deepEqual(out.map((o) => o.steps), [0, 0, -1]);
});

test("a gesture that turns smooth part way is smooth from then on", () => {
  const out = run([notch(0), pad(10, 30)]);
  assert.equal(out[0].device, "notch");
  assert.equal(out[1].device, "smooth");
  assert.equal(out[1].note, "smooth");
});

test("a pause starts a new gesture, read again", () => {
  const out = run([pad(0, 30), notch(1000)]);
  assert.equal(out[1].note, "start");
  assert.equal(out[1].device, "notch");
});

test("what the rule cannot read is smooth (the safe side)", () => {
  assert.equal(isNotch({ deltaY: -100, deltaMode: 0, t: 0 }), false); // no wheelDeltaY
  assert.equal(isNotch({ deltaY: -3, wheelDeltaY: 120, deltaMode: 1, t: 0 }), false); // lines
  assert.equal(isNotch({ deltaY: -100, wheelDeltaY: 240, deltaMode: 0, t: 0 }), true);
});
