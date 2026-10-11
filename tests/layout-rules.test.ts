// layout-rules.ts: is a stored card assignment still good? (CARD-MEMORY.md) And which cards
// may be hidden from the picker? (HIDE-CARDS.md)
import { test } from "node:test";
import assert from "node:assert/strict";
import { repairAssignment, fillSlots, canHide, newlyHidden, maxCardsOf, maxSlots, maxNeighbors, maxCanFill, maxBeyond, keepCard } from "../src/layout-rules.ts";

const slots = ["left", "right"] as const;
const pool = new Set(["home", "library", "search"]);
const defaults = { left: "home", right: "library" } as const;
const order = ["home", "library", "search"];
const read = (v: unknown, keep: Set<string> = new Set()) =>
  repairAssignment(slots, typeof v === "string" ? v : JSON.stringify(v), pool, defaults, order, keep);

test("a good assignment comes back as stored", () => {
  assert.deepEqual(read({ left: "home", right: "search" }), { left: "home", right: "search" });
});

test("keys outside the slots are dropped", () => {
  assert.deepEqual(read({ left: "home", right: "search", c: "library" }), { left: "home", right: "search" });
});

test("nothing stored, text that is not JSON, or JSON that is not an object is refused", () => {
  assert.equal(repairAssignment(slots, null, pool, defaults, order), null);
  assert.equal(read("{not json"), null);
  assert.equal(read("null"), null);
  assert.equal(read("42"), null);
});

test("2026-10-10 one card out of the pool replaces only its own slot", () => {
  // Before: one hidden card reset the whole layout to the defaults.
  assert.deepEqual(read({ left: "search", right: "gone" }), { left: "search", right: "library" });
  assert.deepEqual(read({ left: "home" }), { left: "home", right: "library" });
});

test("2026-10-10 a default that is used or hidden takes the first unused card", () => {
  // right's default (library) already sits in left.
  assert.deepEqual(read({ left: "library", right: "gone" }), { left: "library", right: "home" });
  // left's default (home) is hidden: not in the pool.
  const p = new Set(["library", "search"]);
  assert.deepEqual(fillSlots(slots, {}, p, defaults, order), { left: "search", right: "library" });
});

test("2026-10-10 one card twice keeps the first, the second takes its default", () => {
  assert.deepEqual(read({ left: "search", right: "search" }), { left: "search", right: "library" });
});

test("2026-10-10 a hidden card opened by hand stays in its slot across a restart", () => {
  assert.deepEqual(read({ left: "diary", right: "home" }, new Set(["diary"])), { left: "diary", right: "home" });
  assert.deepEqual(read({ left: "diary", right: "home" }), { left: "library", right: "home" });
});

test("2026-10-10 no card left to fill a slot is null", () => {
  assert.equal(fillSlots(slots, {}, new Set(["home"]), defaults, order), null);
});

test("2026-10-10 three everyday cards stay in the picker", () => {
  // Eight everyday cards. Four hidden → four shown: one more may go.
  assert.equal(canHide(["home", "library", "playlists", "search"], "history"), true);
  // Five hidden → rewind, radio, diary shown: the three are locked.
  assert.equal(canHide(["home", "library", "playlists", "search", "history"], "rewind"), false);
});

test("2026-10-10 Rulez and a hidden card never hit the lock", () => {
  const all = ["home", "library", "playlists", "search", "history", "rewind"];
  assert.equal(canHide(all, "rulez"), true);
  assert.equal(canHide(all, "home"), true); // already hidden
});

test("2026-10-10 only the cards a change hid leave their slots", () => {
  assert.deepEqual(newlyHidden(["rewind"], ["rewind", "diary"]), ["diary"]);
  assert.deepEqual(newlyHidden(["rewind", "diary"], ["rewind"]), []);
});

// Layout for Max (docs/features/MAX-CARDS.md, 2026-10-11).
test("2026-10-11 a stored Layout for Max that is not one of the four reads as four cards", () => {
  assert.equal(maxCardsOf("2rows"), "2rows");
  assert.equal(maxCardsOf("2"), "4");
  assert.equal(maxCardsOf(undefined), "4");
});

test("2026-10-11 each Layout for Max has its slots and its neighbors", () => {
  assert.deepEqual(maxSlots("4"), ["left", "right", "c", "d"]);
  assert.deepEqual(maxSlots("2cols"), ["left", "right"]);
  assert.deepEqual(maxSlots("2rows"), ["left", "right"]);
  assert.deepEqual(maxSlots("1"), ["left"]);
  assert.deepEqual(maxNeighbors("4", "left"), { right: "right", down: "c" });
  assert.deepEqual(maxNeighbors("4", "d"), { left: "c", up: "right" });
  assert.deepEqual(maxNeighbors("2cols", "left"), { right: "right" });
  assert.deepEqual(maxNeighbors("2rows", "left"), { down: "right" });
  assert.deepEqual(maxNeighbors("2rows", "right"), { up: "left" });
  assert.deepEqual(maxNeighbors("1", "left"), {});
  assert.deepEqual(maxNeighbors("2cols", "c"), {}); // not in this layout
});

test("2026-10-11 the card the layout was picked from stays on screen, in the last slot", () => {
  assert.deepEqual(keepCard(["left", "right"], { left: "home", right: "library" }, "settings"), { left: "home", right: "settings" });
  assert.deepEqual(keepCard(["left"], { left: "home" }, "settings"), { left: "settings" });
  // Already in the new map: nothing moves.
  assert.deepEqual(keepCard(["left", "right"], { left: "settings", right: "library" }, "settings"), { left: "settings", right: "library" });
});

test("2026-10-11 Fill is its own grow in four-card Max only", () => {
  assert.equal(maxCanFill("4"), true);
  for (const n of ["2cols", "2rows", "1"] as const) assert.equal(maxCanFill(n), false, n);
});

test("2026-10-11 the left edge of content column 2 is the gap beside the stage in every layout", () => {
  for (const n of ["4", "2cols", "2rows", "1"] as const) assert.equal(maxBeyond(n, "left", "left", null), "outer", n);
  assert.equal(maxBeyond("2rows", "right", "left", null), "outer");
  assert.equal(maxBeyond("2cols", "right", "left", null), "card");
});

test("2026-10-11 what lies past each side, at rest and grown", () => {
  // Four cards: today's 2×2 map.
  assert.equal(maxBeyond("4", "left", "right", null), "card");
  assert.equal(maxBeyond("4", "left", "down", null), "card");
  assert.equal(maxBeyond("4", "d", "right", null), "edge");
  assert.equal(maxBeyond("4", "d", "up", null), "card");
  assert.equal(maxBeyond("4", "left", "right", "wide"), "edge");
  assert.equal(maxBeyond("4", "right", "left", "wide"), "outer");
  assert.equal(maxBeyond("4", "c", "up", "tall"), "outer");
  // Two columns: one row, so up is the top padding and down the window edge.
  assert.equal(maxBeyond("2cols", "left", "up", null), "outer");
  assert.equal(maxBeyond("2cols", "left", "down", null), "edge");
  assert.equal(maxBeyond("2cols", "left", "right", "wide"), "edge");
  // Two rows: one content column, so right is the window edge.
  assert.equal(maxBeyond("2rows", "left", "right", null), "edge");
  assert.equal(maxBeyond("2rows", "left", "down", null), "card");
  assert.equal(maxBeyond("2rows", "right", "up", "tall"), "outer");
  // One card: the stage on its left, the edges elsewhere.
  assert.equal(maxBeyond("1", "left", "right", null), "edge");
  assert.equal(maxBeyond("1", "left", "up", null), "outer");
  assert.equal(maxBeyond("1", "left", "down", null), "edge");
});
