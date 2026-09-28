// idle-skip.ts: Next and Previous while MusicKit holds no song (the 2026-09-28 bug: they did nothing).
import { test } from "node:test";
import assert from "node:assert/strict";
import { idleSkip } from "../src/idle-skip.ts";

const base = { upcoming: 0, history: 0, repeatAll: false, spotSec: 0 };

test("Next with Up Next moves to the next song (the 2026-09-28 bug)", () => {
  assert.equal(idleSkip("next", { ...base, upcoming: 3 }), "advance");
});

test("Next at the end: nothing, or a new lap under repeat all", () => {
  assert.equal(idleSkip("next", base), "none");
  assert.equal(idleSkip("next", { ...base, repeatAll: true }), "refill");
});

test("Next ignores a saved spot: the next song starts from the top", () => {
  assert.equal(idleSkip("next", { ...base, upcoming: 1, spotSec: 120 }), "advance");
});

test("Previous with a back-chain moves to the song before (the 2026-09-28 bug)", () => {
  assert.equal(idleSkip("prev", { ...base, history: 2 }), "previous");
  assert.equal(idleSkip("prev", base), "none");
});

test("Previous past 3 s of a saved spot restarts the song, like MusicKit's own Previous", () => {
  assert.equal(idleSkip("prev", { ...base, history: 2, spotSec: 95 }), "restart");
  assert.equal(idleSkip("prev", { ...base, history: 2, spotSec: 3 }), "previous");
});
