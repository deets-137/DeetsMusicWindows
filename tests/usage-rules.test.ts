// usage-rules.ts: when each usage report is due, the day count's flags, how a setting's value
// is sent, and the random moments (USAGE-COUNTS.md §3).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  utcDay, utcMonth, isoWeek, dayCount, afterDay, weeklyDue, mayTry, afterTry, settingValue, randomDelay, apart,
} from "../src/usage-rules.ts";

const at = (iso: string) => new Date(iso);

test("the ISO week: Monday starts it, the Thursday names its year", () => {
  assert.equal(isoWeek(at("2026-10-13T12:00:00Z")), "2026-W42");
  assert.equal(isoWeek(at("2026-10-12T00:00:00Z")), "2026-W42"); // a Monday
  assert.equal(isoWeek(at("2026-10-11T23:59:59Z")), "2026-W41"); // the Sunday before
  assert.equal(isoWeek(at("2027-01-01T00:00:00Z")), "2026-W53"); // a Friday: still 2026's last week
  assert.equal(isoWeek(at("2025-12-29T00:00:00Z")), "2026-W01"); // a Monday in 2025, week 1 of 2026
});

test("the day and the month are UTC, not local", () => {
  assert.equal(utcDay(at("2026-10-13T23:30:00-05:00")), "2026-10-14");
  assert.equal(utcMonth(at("2026-10-31T23:30:00-05:00")), "2026-11");
});

test("the first day count ever is the first of its week and month", () => {
  assert.deepEqual(dayCount({}, at("2026-10-13T10:00:00Z")), { week: true, month: true });
});

test("one day count per UTC day", () => {
  const s = afterDay({}, at("2026-10-13T10:00:00Z"));
  assert.equal(dayCount(s, at("2026-10-13T23:59:00Z")), null);
  assert.deepEqual(dayCount(s, at("2026-10-14T00:01:00Z")), { week: false, month: false });
});

test("a new week or a new month sets its flag", () => {
  const s = afterDay({}, at("2026-10-11T10:00:00Z")); // Sunday, W41
  assert.deepEqual(dayCount(s, at("2026-10-12T10:00:00Z")), { week: true, month: false });
  const t = afterDay({}, at("2026-10-31T10:00:00Z"));
  assert.deepEqual(dayCount(t, at("2026-11-01T10:00:00Z")), { week: false, month: true });
});

test("a weekly report is due once per ISO week", () => {
  const now = at("2026-10-13T10:00:00Z");
  assert.equal(weeklyDue({}, "settings", now), true);
  assert.equal(weeklyDue({ settingsWeek: "2026-W42" }, "settings", now), false);
  assert.equal(weeklyDue({ settingsWeek: "2026-W42" }, "health", now), true);
  assert.equal(weeklyDue({ settingsWeek: "2026-W41" }, "settings", now), true);
});

test("a report is tried twice in its period, then dropped", () => {
  const now = at("2026-10-13T10:00:00Z");
  let s = {};
  assert.equal(mayTry(s, "day", now), true);
  s = afterTry(s, "day", now);
  assert.equal(mayTry(s, "day", now), true);
  s = afterTry(s, "day", now);
  assert.equal(mayTry(s, "day", now), false);
  assert.equal(mayTry(s, "settings", now), true, "each kind counts its own tries");
  assert.equal(mayTry(s, "day", at("2026-10-14T10:00:00Z")), true, "a new day starts again");
});

test("a toggle goes as on or off, anything else as other", () => {
  assert.equal(settingValue("toggle", ["on", "off"], "on"), "on");
  assert.equal(settingValue("toggle", ["on", "off"], "maybe"), "other");
});

test("a choice goes as the option's value; an unknown value never goes itself", () => {
  assert.equal(settingValue("choice", ["glass", "ocean"], "glass"), "glass");
  assert.equal(settingValue("choice", ["glass", "ocean"], "C:\\Users\\me"), "other");
  assert.equal(settingValue("choice", ["glass", "ocean"], ""), "other");
});

test("an EQ preset the user named goes as 'user', never its id", () => {
  assert.equal(settingValue("choice", ["flat", "u:abc"], "u:abc"), "user");
});

test("a random moment falls inside its window", () => {
  assert.equal(randomDelay(() => 0, 60_000, 5_000), 5_000);
  assert.equal(randomDelay(() => 1, 60_000, 5_000), 60_000);
  assert.equal(randomDelay(() => 0.5, 60_000), 30_000);
});

test("two reports never leave in the same minute", () => {
  assert.equal(apart(100_000, []), 100_000);
  assert.equal(apart(100_000, [90_000]), 150_000);
  assert.equal(apart(100_000, [90_000, 150_000]), 210_000, "moved past the first, then past the second");
  assert.equal(apart(300_000, [90_000]), 300_000);
});
