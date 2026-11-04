// idle-release.ts: when a paused song lets go of Apple (2026-11-03: a paused DeetsMusic
// renewed its license every 13 min and stopped the music on the user's iPhone).
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextRenewalAt, releaseAt, RELEASE_MARGIN_MS } from "../src/idle-release.ts";

const MIN = 60_000;

test("Never (0) never releases", () => {
  assert.equal(releaseAt({ pausedAt: 0, minutes: 0, renewalAt: null }), null);
  assert.equal(releaseAt({ pausedAt: 0, minutes: 0, renewalAt: 5 * MIN }), null);
});

test("No renewal time known (a Mac on FairPlay): the minutes alone decide", () => {
  assert.equal(releaseAt({ pausedAt: 1000, minutes: 10, renewalAt: null }), 1000 + 10 * MIN);
});

test("A renewal before the minutes: release just before it (2026-11-03, his call)", () => {
  // Paused 3 min into a song: the renewal is ~9.75 min away, before the 10 min.
  const renewalAt = 9.75 * MIN;
  assert.equal(releaseAt({ pausedAt: 0, minutes: 10, renewalAt }), renewalAt - RELEASE_MARGIN_MS);
});

test("A renewal after the minutes: the minutes decide", () => {
  assert.equal(releaseAt({ pausedAt: 0, minutes: 5, renewalAt: 12 * MIN }), 5 * MIN);
});

test("A renewal inside the margin: release at the pause, never before it", () => {
  assert.equal(releaseAt({ pausedAt: 100_000, minutes: 10, renewalAt: 110_000 }), 100_000);
});

test("The next renewal is the earliest open session's", () => {
  const now = 10 * MIN;
  // Sessions licensed 9 min and 2 min ago; renew after 780 s.
  assert.equal(nextRenewalAt([now - 9 * MIN, now - 2 * MIN], 780, now), now - 9 * MIN + 780_000);
});

test("A due time already past is skipped (that session renewed or is dead)", () => {
  const now = 30 * MIN;
  assert.equal(nextRenewalAt([0], 780, now), null);
  assert.equal(nextRenewalAt([0, now - MIN], 780, now), now - MIN + 780_000);
});

test("No renewAfter, or no open session: none known", () => {
  assert.equal(nextRenewalAt([0], null, 0), null);
  assert.equal(nextRenewalAt([], 780, 0), null);
});
