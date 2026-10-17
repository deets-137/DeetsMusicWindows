// listeners.ts fmtCount: the short form of a Last.fm count, on the badge and in every facts box.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtCount } from "../src/listeners.ts";

test("counts read as they did", () => {
  assert.equal(fmtCount(0), "0");
  assert.equal(fmtCount(999), "999");
  assert.equal(fmtCount(1234), "1.2K");
  assert.equal(fmtCount(45_678), "46K");
  assert.equal(fmtCount(4_567_890), "4.6M");
  assert.equal(fmtCount(16_795_061), "17M");
});

// The edge of a unit (2026-10-17, a test of the song facts box): 999,999 read "1000K" and
// 9,999,999 read "10.0M".
test("a count at the edge of a unit rounds into the next one (2026-10-17)", () => {
  assert.equal(fmtCount(999_999), "1.0M");
  assert.equal(fmtCount(999_499), "999K");
  assert.equal(fmtCount(9_999), "10K");
  assert.equal(fmtCount(9_949), "9.9K");
  assert.equal(fmtCount(9_999_999), "10M");
});
