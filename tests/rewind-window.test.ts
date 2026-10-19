// rewind-window.ts: the Rewind card's time spans (DEETS-REWIND.md §8, F5 and his call K3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayInWindow, windowStart, todayStart, fmtToday } from "../src/rewind-window.ts";

/** A local time, as the user's clock reads it. */
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

test("2026-10-18 F5: yesterday's pick stays in Past Day all of today", () => {
  // The bug: the pick read as noon of its day, so at 15:00 today it was 27 h old and left.
  assert.equal(dayInWindow("2026-10-17", "day", at(2026, 10, 18, 9)), true);
  assert.equal(dayInWindow("2026-10-17", "day", at(2026, 10, 18, 15)), true);
  assert.equal(dayInWindow("2026-10-17", "day", at(2026, 10, 18, 23, 59)), true);
});

test("a pick is out once no part of its day is in the window", () => {
  // Past Day at 15:00 on the 18th starts 15:00 on the 17th: the 16th ended before that.
  assert.equal(dayInWindow("2026-10-16", "day", at(2026, 10, 18, 15)), false);
  // Past Week at noon on the 18th starts noon on the 11th: the 11th is in, the 10th is out.
  assert.equal(dayInWindow("2026-10-11", "week", at(2026, 10, 18, 12)), true);
  assert.equal(dayInWindow("2026-10-10", "week", at(2026, 10, 18, 12)), false);
});

test("today's pick is always in", () => {
  for (const w of ["day", "week", "month", "ytd", "year"] as const) assert.equal(dayInWindow("2026-10-18", w, at(2026, 10, 18, 0, 5)), true);
});

test("This Year starts at local midnight on 1 January", () => {
  assert.equal(windowStart("ytd", at(2027, 1, 1, 8)), at(2027, 1, 1));
  assert.equal(dayInWindow("2026-12-31", "ytd", at(2027, 1, 1, 8)), false);
  assert.equal(dayInWindow("2027-01-01", "ytd", at(2027, 1, 1, 8)), true);
});

test("a day that is not a date is never in", () => {
  assert.equal(dayInWindow("", "year"), false);
  assert.equal(dayInWindow("not-a-day", "year"), false);
});

test("2026-10-19 Today starts at local midnight", () => {
  assert.equal(todayStart(at(2026, 10, 19, 0, 0)), at(2026, 10, 19));
  assert.equal(todayStart(at(2026, 10, 19, 23, 59)), at(2026, 10, 19));
});

test("2026-10-19 the Today number: minutes always, or hours and minutes", () => {
  const m = 60_000;
  assert.equal(fmtToday(0, "mins"), "0 mins");
  assert.equal(fmtToday(59_999, "mins"), "0 mins"); // a minute not yet listened is not shown
  assert.equal(fmtToday(m, "mins"), "1 min");
  assert.equal(fmtToday(134 * m, "mins"), "134 mins");
  assert.equal(fmtToday(47 * m, "hm"), "47 mins");
  assert.equal(fmtToday(60 * m, "hm"), "1 hr");
  assert.equal(fmtToday(65 * m, "hm"), "1 hr 5 mins");
  assert.equal(fmtToday(134 * m, "hm"), "2 hrs 14 mins");
  assert.equal(fmtToday(121 * m, "hm"), "2 hrs 1 min");
});
