// The quiet restart's rule (GRAPHICS-FALLBACK.md §10.5, his calls F1 A and F2 A, 2026-10-20).
import { test } from "node:test";
import assert from "node:assert/strict";
import { quietAction, tellNoCard, type QuietState } from "../src/gpu-rules.ts";

const base: QuietState = { mode: "save", graphics: "software", card: "ready", window: "tray", playing: false, tried: false, busy: false };
const act = (p: Partial<QuietState>) => quietAction({ ...base, ...p });

test("quiet restart (2026-10-20): hidden or minimized and silent restarts now; playing waits for the next song", () => {
  assert.equal(act({}), "now");
  assert.equal(act({ window: "min" }), "now");
  assert.equal(act({ playing: true }), "songStart");
  assert.equal(act({ window: "min", playing: true }), "songStart");
});

test("quiet restart (2026-10-20): on screen the toast asks; it never restarts by itself (F1 A)", () => {
  assert.equal(act({ window: "shown" }), "toast");
  assert.equal(act({ window: "shown", playing: true }), "toast");
  assert.equal(act({ window: "shown", busy: true }), "toast"); // the toast is only a question
});

test("quiet restart (2026-10-20): nothing before the card is ready, nothing on the card, nothing when Off", () => {
  assert.equal(act({ card: "unknown" }), "wait");
  assert.equal(act({ card: "none" }), "wait");
  assert.equal(act({ card: "none", window: "shown" }), "wait"); // no toast while a driver still installs
  assert.equal(act({ graphics: "accelerated" }), "none");
  assert.equal(act({ graphics: undefined }), "none");
  assert.equal(act({ mode: "off" }), "none");
  assert.equal(act({ mode: "tell" }), "now"); // Tell only: no rule, but the card still comes back
});

test("quiet restart (2026-10-20): the guards: once per failure, never in a room or with typed text", () => {
  assert.equal(act({ tried: true }), "wait");
  assert.equal(act({ busy: true }), "wait");
  assert.equal(act({ busy: true, playing: true }), "wait");
});

test("the no-card toast (2026-10-20): only a software START with no card, once per install", () => {
  const tell = (p: Partial<Parameters<typeof tellNoCard>[0]>) => tellNoCard({ mode: "save", startedSoftware: true, card: "none", toldBefore: false, ...p });
  assert.equal(tell({}), true);
  assert.equal(tell({ startedSoftware: false }), false); // a card that went away mid-session: a driver install
  assert.equal(tell({ card: "ready" }), false);
  assert.equal(tell({ card: "unknown" }), false);
  assert.equal(tell({ toldBefore: true }), false);
  assert.equal(tell({ mode: "off" }), false);
});
