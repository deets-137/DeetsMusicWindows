// update-rules.ts: the version order and the skip a rollback leaves (VELOPACK.md §12.4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, rollbackSkip, opensWhatsNew, offeredDefaultVersions } from "../src/update-rules.ts";

test("a pre-release sorts before its release, and numbers compare as numbers", () => {
  assert.equal(compareVersions("0.28.0-beta.4", "0.28.0"), -1);
  assert.equal(compareVersions("0.28.0-beta.10", "0.28.0-beta.9"), 1);
  assert.equal(compareVersions("0.27.0", "0.28.0-beta.1"), -1);
  assert.equal(compareVersions("0.28.0-beta.2", "0.28.0-beta.2"), 0);
});

test("a rollback keeps a newer skip (the 2026-10-15 desk test: rolling back from beta.3 lost the skip of beta.4)", () => {
  assert.equal(rollbackSkip("0.28.0-beta.4", "0.28.0-beta.3"), "0.28.0-beta.4");
});

test("a rollback skips the version it leaves when nothing newer was skipped", () => {
  assert.equal(rollbackSkip("", "0.28.0-beta.3"), "0.28.0-beta.3");
  assert.equal(rollbackSkip("0.27.0", "0.28.0"), "0.28.0");
});

// The Updates panel's own open (UPDATE-CARD.md §3.10, his call 9, 2026-10-29).
test("2026-10-29 what's new opens after a minor or major update with a new setting in the range", () => {
  assert.equal(opensWhatsNew("1.2.1", "1.3.0", ["1.3.0"], false), true);
  assert.equal(opensWhatsNew("1.2.1", "1.3.2", ["1.2.3"], false), true); // a patch inside the range counts
  assert.equal(opensWhatsNew("1.9.0", "2.0.0", ["2.0.0"], false), true);
});

test("2026-10-29 what's new stays shut after a patch, or with no setting in the range", () => {
  assert.equal(opensWhatsNew("1.2.1", "1.2.4", ["1.2.3"], false), false); // 1.2.X: never by default
  assert.equal(opensWhatsNew("1.2.1", "1.3.0", ["1.2.1", "1.4.0"], false), false); // both outside the range
  assert.equal(opensWhatsNew("1.2.1", "1.3.0", [], false), false);
});

test("2026-10-29 a changed default counts only while the user's value is still the old one", () => {
  const changes = [
    { since: "1.3.0", key: "gap", from: "compact", to: "spacious" },
    { since: "1.4.0", key: "list", from: ["a"], to: ["a", "b"] },
  ];
  const mine: Record<string, unknown> = { gap: "compact", list: ["a", "c"] };
  assert.deepEqual(offeredDefaultVersions(changes, (k) => mine[k]), ["1.3.0"]); // list was changed by hand
  mine.gap = "spacious"; // already has the new value
  assert.deepEqual(offeredDefaultVersions(changes, (k) => mine[k]), []);
});

test("2026-10-29 what's new: the toggle opens it after every update, never on a fresh install or a rollback", () => {
  assert.equal(opensWhatsNew("1.2.1", "1.2.2", [], true), true);
  assert.equal(opensWhatsNew("", "1.3.0", ["1.3.0"], true), false); // fresh install
  assert.equal(opensWhatsNew("1.3.0", "1.2.1", ["1.3.0"], true), false); // rollback
  assert.equal(opensWhatsNew("1.3.0", "1.3.0", ["1.3.0"], true), false); // same version
});
