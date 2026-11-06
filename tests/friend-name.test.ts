// friend-name.ts: which name a friend's row shows (FRIENDS.md §21).
import { test } from "node:test";
import assert from "node:assert/strict";
import { heardName, shownName } from "../src/friend-name.ts";

test("2026-11-06 a friend added by code shows the name they typed", () => {
  assert.equal(shownName({ name: "", theirName: "Sam" }), "Sam");
});

test("2026-11-06 your own name for a friend wins over theirs", () => {
  assert.equal(shownName({ name: "Sammy", theirName: "Sam" }), "Sammy");
});

test("2026-11-06 no name on either side is empty, so the caller picks its word", () => {
  assert.equal(shownName({ name: "", theirName: "" }), "");
});

test("2026-11-06 the worker's stand-in for no name is not a name", () => {
  assert.equal(heardName("Listener"), "");
  assert.equal(heardName(" Sam "), "Sam");
  assert.equal(heardName(undefined), "");
  assert.equal(heardName(42), "");
});
