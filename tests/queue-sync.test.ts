// queue-sync.ts: what MusicKit's upcoming window should hold (QUEUE.md §The model is the master).
import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedIds, suffixPlan } from "../src/queue-sync.ts";

const id = (e: { id?: string }) => e.id;

test("expectedIds keeps a repeated song (the 2026-09-24 bug)", () => {
  const up = [{ id: "a" }, { id: "b" }, { id: "a" }];
  assert.deepEqual(expectedIds(up, 10, id), ["a", "b", "a"]);
});

test("expectedIds skips an entry with no playable id and stops at the cap", () => {
  const up = [{ id: "a" }, {}, { id: "b" }, { id: "c" }];
  assert.deepEqual(expectedIds(up, 2, id), ["a", "b"]);
});

test("suffixPlan: in sync means nothing to do", () => {
  assert.equal(suffixPlan(["a", "b"], ["a", "b"]), null);
  assert.equal(suffixPlan([], []), null);
});

test("suffixPlan: a reorder keeps the shared prefix and drops the rest", () => {
  assert.deepEqual(suffixPlan(["a", "b", "c", "d"], ["a", "c", "b", "d"]), { keep: 1, drop: 3 });
});

test("suffixPlan: songs added at the end drop nothing", () => {
  assert.deepEqual(suffixPlan(["a", "b"], ["a", "b", "c"]), { keep: 2, drop: 0 });
});

test("suffixPlan: songs removed at the end drop only those", () => {
  assert.deepEqual(suffixPlan(["a", "b", "c"], ["a"]), { keep: 1, drop: 2 });
});

test("suffixPlan: a repeated song compares by position, not by id", () => {
  // MusicKit holds a, b; the model re-queued a after b.
  assert.deepEqual(suffixPlan(["a", "b"], ["a", "b", "a"]), { keep: 2, drop: 0 });
});
