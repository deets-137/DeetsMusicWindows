// layout-rules.ts: is a stored card assignment still good? (CARD-MEMORY.md) And which cards
// may be hidden from the picker? (HIDE-CARDS.md)
import { test } from "node:test";
import assert from "node:assert/strict";
import { repairAssignment, fillSlots, canHide, newlyHidden } from "../src/layout-rules.ts";

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
