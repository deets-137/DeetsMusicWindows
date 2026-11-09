// presence-bar.ts: what the Discord card's bar says, and when it needs correcting (FRIENDS.md §8.9a).
import { test } from "node:test";
import assert from "node:assert/strict";
import { barFor, barIsWrong, tickFits, BAR_TOLERANCE_S } from "../src/presence-bar.ts";

const NOW = 1_794_209_683_000;

test("the previous song's last report never sets the new card (live ticket, 2026-11-09)", () => {
  // BROKEN ROAD ended at 1:41 and King's Dead (3:50) began: the card must not read 1:41 of 1:41.
  assert.deepEqual(barFor(NOW, { currentTime: 101, duration: 101 }, 230), { start: NOW, end: NOW + 230_000 });
});

test("a report from the song on now sets the position and the length", () => {
  assert.deepEqual(barFor(NOW, { currentTime: 30, duration: 200 }, 200), { start: NOW - 30_000, end: NOW + 170_000 });
});

test("a held report with no length: the song's own length from 0:00", () => {
  assert.deepEqual(barFor(NOW, { currentTime: 0, duration: 0 }, 180), { start: NOW, end: NOW + 180_000 });
});

test("no length known means no bar", () => {
  assert.equal(barFor(NOW, { currentTime: 0, duration: 0 }, 0), null);
});

test("the song's length unknown: the report is taken as it is", () => {
  assert.equal(tickFits({ currentTime: 5, duration: 200 }, 0), true);
  assert.deepEqual(barFor(NOW, { currentTime: 5, duration: 200 }, 0), { start: NOW - 5_000, end: NOW + 195_000 });
});

test("a small difference in length between Apple's two numbers is the same song", () => {
  assert.equal(tickFits({ currentTime: 1, duration: 200.4 }, 200), true);
});

test("a negative position counts as the start", () => {
  assert.equal(barFor(NOW, { currentTime: -2, duration: 100 }, 100)?.start, NOW);
});

const sent = { start: NOW - 60_000, end: NOW + 140_000 }; // 1:00 into a 3:20 song

test("a card that matches the song is left alone", () => {
  assert.equal(barIsWrong(sent, NOW, { currentTime: 60, duration: 200 }, 200), false);
});

test("a difference at the tolerance is left alone, past it is corrected", () => {
  assert.equal(barIsWrong(sent, NOW, { currentTime: 60 - BAR_TOLERANCE_S, duration: 200 }, 200), false);
  assert.equal(barIsWrong(sent, NOW, { currentTime: 60 - BAR_TOLERANCE_S - 0.5, duration: 200 }, 200), true);
});

test("a resume after a pause: the card ran ahead of the song", () => {
  assert.equal(barIsWrong(sent, NOW, { currentTime: 40, duration: 200 }, 200), true);
});

test("a seek forward or back", () => {
  assert.equal(barIsWrong(sent, NOW, { currentTime: 150, duration: 200 }, 200), true);
  assert.equal(barIsWrong(sent, NOW, { currentTime: 5, duration: 200 }, 200), true);
});

test("a Repeat One loop: the card has run out, the song is at the start", () => {
  const done = { start: NOW - 200_500, end: NOW - 500 };
  assert.equal(barIsWrong(done, NOW, { currentTime: 0.2, duration: 200 }, 200), true);
});

test("a card with the wrong length is corrected", () => {
  const wrong = { start: NOW - 60_000, end: NOW + 40_000 };
  assert.equal(barIsWrong(wrong, NOW, { currentTime: 60, duration: 200 }, 200), true);
});

test("a card sent with no bar gets one when the length is known", () => {
  assert.equal(barIsWrong(null, NOW, { currentTime: 1, duration: 200 }, 0), true);
});

test("the old song's report, or a report with no length, corrects nothing", () => {
  assert.equal(barIsWrong(sent, NOW, { currentTime: 100, duration: 100 }, 200), false);
  assert.equal(barIsWrong(null, NOW, { currentTime: 100, duration: 100 }, 200), false);
  assert.equal(barIsWrong(sent, NOW, { currentTime: 0, duration: 0 }, 200), false);
});
