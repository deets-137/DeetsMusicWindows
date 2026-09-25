// layout-rules.ts: is a stored card assignment still good? (CARD-MEMORY.md)
import { test } from "node:test";
import assert from "node:assert/strict";
import { storedAssignment } from "../src/layout-rules.ts";

const slots = ["left", "right"] as const;
const pool = new Set(["home", "library", "search"]);
const read = (v: unknown) => storedAssignment(slots, typeof v === "string" ? v : JSON.stringify(v), pool);

test("a good assignment comes back as stored", () => {
  assert.deepEqual(read({ left: "home", right: "search" }), { left: "home", right: "search" });
});

test("keys outside the slots are dropped", () => {
  assert.deepEqual(read({ left: "home", right: "search", c: "library" }), { left: "home", right: "search" });
});

test("an empty slot, an unknown card or one card twice is refused", () => {
  assert.equal(read({ left: "home" }), null);
  assert.equal(read({ left: "home", right: "gone" }), null);
  assert.equal(read({ left: "home", right: "home" }), null);
});

test("nothing stored, text that is not JSON, or JSON that is not an object is refused", () => {
  assert.equal(storedAssignment(slots, null, pool), null);
  assert.equal(read("{not json"), null);
  assert.equal(read("null"), null);
  assert.equal(read("42"), null);
});
