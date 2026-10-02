// queue-sync.ts: what MusicKit's upcoming window should hold (QUEUE.md §The model is the master).
import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedIds, suffixPlan, repairAtSongChange, REPAIR_NEAR, headPart, tailPart, splitRepeats, skipToSameId } from "../src/queue-sync.ts";

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

test("repairAtSongChange 2026-09-28: a near difference now, a far one waits for the top-up", () => {
  assert.equal(repairAtSongChange(0), true);
  assert.equal(repairAtSongChange(REPAIR_NEAR - 1), true);
  assert.equal(repairAtSongChange(REPAIR_NEAR), false);
  assert.equal(repairAtSongChange(155), false); // the Lawn loop
});

// What MusicKit does with one call that holds an id twice: it keeps only the LAST copy
// (probed 2026-10-01). A model of it, to show the split keeps every copy.
const mkOneCall = (ids: string[]) => ids.filter((x, i) => ids.lastIndexOf(x) === i);

test("headPart / tailPart stop before a repeat", () => {
  assert.deepEqual(headPart(["a", "b", "a", "c"]), ["a", "b"]);
  assert.deepEqual(tailPart(["a", "b", "a", "c"]), ["b", "a", "c"]);
  assert.deepEqual(headPart([]), []);
});

test("splitRepeats: no repeat is one part, every copy is kept, no part repeats an id", () => {
  assert.deepEqual(splitRepeats(["a", "b", "c"]), [["a", "b", "c"]]);
  const ids = ["a", "b", "a", "c", "a"];
  const parts = splitRepeats(ids);
  assert.deepEqual(parts, [["a", "b"], ["a", "c"], ["a"]]);
  assert.deepEqual(parts.flat(), ids);
  for (const p of parts) assert.equal(new Set(p).size, p.length);
});

test("splitRepeats 2026-10-01: a top-up with repeats lands whole in MusicKit", () => {
  // The case from the log: rows 1–19 of the sent list all come back later in it.
  const first = Array.from({ length: 19 }, (_, i) => `s${i}`);
  const rest = Array.from({ length: 63 }, (_, i) => `t${i}`);
  const sent = [...first, ...rest, ...first, ...first.slice(0, 8)];
  assert.equal(mkOneCall(sent).length, sent.length - 27); // one call: 27 lost, the bug
  assert.equal(mkOneCall(sent)[0], "t0"); // and the wrong song first
  const parts = splitRepeats(sent);
  assert.ok(parts.length <= 3);
  assert.deepEqual(parts.flatMap(mkOneCall), sent); // in parts: every copy, in order
});

test("playNext order: parts from the end, each put right after the current song, keep the list's order", () => {
  const ids = ["a", "b", "a", "c"];
  let left = ids.slice();
  let up: string[] = []; // MusicKit's Up Next, as playNext builds it
  while (left.length) {
    const part = tailPart(left);
    up = [...mkOneCall(part), ...up];
    left = left.slice(0, left.length - part.length);
  }
  assert.deepEqual(up, ids);
});

test("skipToSameId 2026-10-01: a skip onto an adjacent copy is found, any other skip is not", () => {
  const ids = ["a", "b", "b", "c"];
  assert.equal(skipToSameId(ids, 1, 1), true); // Next from the first copy
  assert.equal(skipToSameId(ids, 2, -1), true); // Previous from the second copy
  assert.equal(skipToSameId(ids, 0, 1), false);
  assert.equal(skipToSameId(ids, 2, 1), false);
  assert.equal(skipToSameId(ids, 3, 1), false); // the end of the window
  assert.equal(skipToSameId(ids, 0, -1), false); // the start of the window
  assert.equal(skipToSameId(ids, -1, 1), false); // no now-playing item
  assert.equal(skipToSameId([null, null], 0, 1), false); // no ids
});
