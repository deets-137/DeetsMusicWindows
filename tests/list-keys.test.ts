// list-keys.ts: which row takes the focus back after a redraw removed the focused one (COMPASS.md §5a).
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickRefocus, windowedRefocus } from "../src/list-keys.ts";

test("the same row, redrawn, takes the focus back (Rulez open / fold, 2026-09-27)", () => {
  const list = [{ id: "a", idx: "0" }, { id: "b", idx: "1" }, { id: "c", idx: "2" }];
  assert.equal(pickRefocus({ key: "id", value: "b", index: 1 }, null, list), 1);
});

test("a list of another kind starts at its first row (a Diary tile → the entry's songs)", () => {
  const songs = [{ songI: "0" }, { songI: "1" }, { songI: "2" }];
  assert.equal(pickRefocus({ key: "entry", value: "3", index: 1 }, null, songs), 0);
});

test("Escape out of a drill goes back to the row it came from (the Diary tile)", () => {
  const tiles = [{ entry: "1" }, { entry: "3" }, { entry: "7" }];
  assert.equal(pickRefocus({ key: "songI", value: "2", index: 2 }, { key: "entry", value: "7" }, tiles), 2);
});

test("a row gone from the same list: the row now at its place, clamped", () => {
  const list = [{ idx: "0" }, { idx: "1" }];
  assert.equal(pickRefocus({ key: "idx", value: "5", index: 5 }, null, list), 1);
});

test("an empty list gives no row", () => {
  assert.equal(pickRefocus({ key: "id", value: "a", index: 0 }, null, []), -1);
});

// The Library after an arrow key, then a wheel scroll (2026-10-11): the ring went to another
// song in the buffer and its scrollIntoView threw the list back 956 px.
test("a row the wheel scrolled out of the window parks the ring (2026-10-11)", () => {
  assert.equal(windowedRefocus({ index: 6, count: 3898, rendered: false, sameBox: true, parked: false }), "park");
});

test("the parked row, rendered again, takes the ring back without a scroll (2026-10-11)", () => {
  assert.equal(windowedRefocus({ index: 6, count: 3898, rendered: true, sameBox: true, parked: true }), "return");
});

test("a redraw that replaced the list's box is not a scroll: pickRefocus decides (2026-10-11)", () => {
  assert.equal(windowedRefocus({ index: 6, count: 3898, rendered: false, sameBox: false, parked: false }), "pick");
});

test("a row past the end of a shorter list is gone, not parked (2026-10-11)", () => {
  assert.equal(windowedRefocus({ index: 120, count: 40, rendered: false, sameBox: true, parked: false }), "pick");
});

test("a row redrawn in place without a park keeps today's rule (2026-10-11)", () => {
  assert.equal(windowedRefocus({ index: 6, count: 3898, rendered: true, sameBox: true, parked: false }), "pick");
});
