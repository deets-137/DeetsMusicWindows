// The now mark's rule (docs/features/NOW-MARK.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { markMove, planMarks, rowsOfSong } from "../src/now-mark-rules.ts";

const rows = [{ c: "1", l: "a" }, { c: "2" }, { c: "1", l: "b" }, { l: "c" }];
const ids = (x: { c?: string; l?: string }) => [x.c, x.l];

test("a song matches by either id, each copy counts (2026-11-04)", () => {
  assert.deepEqual(rowsOfSong(rows, ids, ["1", undefined]), [0, 2]);
  assert.deepEqual(rowsOfSong(rows, ids, [undefined, "c"]), [3]);
  assert.deepEqual(rowsOfSong(rows, ids, ["9", "z"]), []);
  assert.deepEqual(rowsOfSong(rows, ids, [undefined, undefined]), []);
});

test("the source list shows one chevron, nearest its last place (2026-11-04)", () => {
  assert.deepEqual(planMarks([3, 9], true, null), [{ row: 3, shape: "chevron" }]);
  assert.deepEqual(planMarks([3, 9], true, 8), [{ row: 9, shape: "chevron" }]);
  assert.deepEqual(planMarks([3, 9], true, 4), [{ row: 3, shape: "chevron" }]);
});

test("any other list shows a line on each copy (2026-11-04)", () => {
  assert.deepEqual(planMarks([3, 9], false, 8), [{ row: 3, shape: "line" }, { row: 9, shape: "line" }]);
});

test("no row, no mark (2026-11-04)", () => {
  assert.deepEqual(planMarks([], true, 2), []);
});

const chev = (row: number) => [{ row, shape: "chevron" as const }];
const line = (row: number) => [{ row, shape: "line" as const }];

test("a chevron slides up to the reach, either way (2026-11-04)", () => {
  assert.equal(markMove(chev(2), chev(3), 8), "slide");
  assert.equal(markMove(chev(10), chev(2), 8), "slide");
  assert.equal(markMove(chev(2), chev(11), 8), "swap");
});

test("the same plan moves nothing (2026-11-04)", () => {
  assert.equal(markMove(chev(2), chev(2), 8), "none");
  assert.equal(markMove([], [], 8), "none");
  assert.equal(markMove(line(1), line(1), 8), "none");
});

test("a line never slides, and a change of shape fades (2026-11-04)", () => {
  assert.equal(markMove(line(1), line(2), 8), "swap");
  assert.equal(markMove(line(1), chev(1), 8), "swap");
  assert.equal(markMove(chev(1), line(1), 8), "swap");
  assert.equal(markMove(chev(1), [], 8), "swap");
  assert.equal(markMove([], chev(1), 8), "swap");
});
