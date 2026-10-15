// update-rules.ts: the version order and the skip a rollback leaves (VELOPACK.md §12.4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, rollbackSkip } from "../src/update-rules.ts";

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
