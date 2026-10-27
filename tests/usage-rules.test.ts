// usage-rules.ts: when each usage report is due, the day count's flags, the version each count
// sits under and what an applied update moves, the open-time clocks, the report keys, how a
// setting's value is sent (USAGE-COUNTS.md §3, §12).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  utcDay, utcMonth, isoWeek, dayCount, afterDay, weeklyDue, settingValue, randomDelay, waited,
  movesFor, appliedReport, afterApplied, onDownloaded, reportId, clockFor, tickClock, keyFor,
} from "../src/usage-rules.ts";
import { compareVersions } from "../src/update-rules.ts";

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

test("the first day count ever is the first of its week and month, and new", () => {
  assert.deepEqual(dayCount({}, at("2026-10-13T10:00:00Z")), { week: true, month: true, new: true });
});

test("one day count per UTC day", () => {
  const s = afterDay({}, at("2026-10-13T10:00:00Z"), "1.2.0");
  assert.equal(dayCount(s, at("2026-10-13T23:59:00Z")), null);
  assert.deepEqual(dayCount(s, at("2026-10-14T00:01:00Z")), { week: false, month: false, new: false });
});

test("a new week or a new month sets its flag", () => {
  const s = afterDay({}, at("2026-10-11T10:00:00Z"), "1.2.0"); // Sunday, W41
  assert.deepEqual(dayCount(s, at("2026-10-12T10:00:00Z")), { week: true, month: false, new: false });
  const t = afterDay({}, at("2026-10-31T10:00:00Z"), "1.2.0");
  assert.deepEqual(dayCount(t, at("2026-11-01T10:00:00Z")), { week: false, month: true, new: false });
});

test("2026-10-27: an install from before 1.2.0 is not new", () => {
  assert.equal(dayCount({ day: "2026-10-26", week: "2026-W44", month: "2026-10" }, at("2026-10-27T10:00:00Z"))!.new, false);
  assert.equal(dayCount({ settingsWeek: "2026-W44" }, at("2026-10-27T10:00:00Z"))!.new, false);
});

test("2026-10-27: a day count files the day under its version, the week only when it was the week's first", () => {
  const mon = afterDay({}, at("2026-10-26T10:00:00Z"), "1.1.2");
  assert.deepEqual([mon.vDay, mon.vWeek, mon.vMonth, mon.runV], ["1.1.2", "1.1.2", "1.1.2", "1.1.2"]);
  const tue = afterDay(mon, at("2026-10-27T10:00:00Z"), "1.2.0");
  assert.deepEqual([tue.vDay, tue.vWeek, tue.vMonth], ["1.2.0", "1.1.2", "1.1.2"], "the week and month counts stay under 1.1.2");
  assert.equal(tue.runV, "1.1.2", "a day count never says the update applied: the applied report does");
});

test("2026-10-27: an applied update moves only this day's, week's and month's counts that sit elsewhere", () => {
  const s = { day: "2026-10-27", week: "2026-W44", month: "2026-10", vDay: "1.1.2", vWeek: "1.0.0", vMonth: "1.0.0", runV: "1.1.2" };
  const now = at("2026-10-27T15:00:00Z");
  assert.deepEqual(movesFor(s, now, "1.2.0"), { day: "1.1.2", week: "1.0.0", month: "1.0.0" });
  assert.deepEqual(movesFor(s, at("2026-10-28T01:00:00Z"), "1.2.0"), { week: "1.0.0", month: "1.0.0" }, "a new day: today was not counted yet");
  assert.deepEqual(movesFor({ ...s, vDay: undefined, vWeek: undefined, vMonth: undefined }, now, "1.2.0"), {}, "no record from before 1.2.0: nothing moves");
  const r = appliedReport(s, now, "1.2.0", compareVersions)!;
  assert.equal(r.from, "1.1.2");
  assert.equal(r.rollback, false);
  const after = afterApplied(s, now, "1.2.0");
  assert.deepEqual([after.vDay, after.vWeek, after.vMonth, after.runV], ["1.2.0", "1.2.0", "1.2.0", "1.2.0"]);
  assert.equal(appliedReport(after, now, "1.2.0", compareVersions), null, "sent once");
});

test("2026-10-27: an older version is a rollback; no applied report before a version is known", () => {
  const s = { runV: "1.2.0" };
  assert.equal(appliedReport(s, at("2026-10-27T10:00:00Z"), "1.1.2", compareVersions)!.rollback, true);
  assert.equal(appliedReport({}, at("2026-10-27T10:00:00Z"), "1.2.0", compareVersions), null);
});

test("2026-10-27: a download is reported once per version", () => {
  const a = onDownloaded({}, "1.2.0", false);
  assert.deepEqual(a.dl, { to: "1.2.0", rollback: false });
  assert.equal(onDownloaded(a, "1.2.0", false), a, "the same version again changes nothing");
  assert.equal(onDownloaded({ downloaded: "1.2.0" }, "1.2.0", false).dl, undefined, "already reported");
});

test("2026-10-27: each report has an id; a retry keeps it, the next period starts a new one", () => {
  const now = at("2026-10-27T10:00:00Z");
  assert.equal(reportId({}, "day", now, "1.2.0"), "2026-10-27");
  assert.equal(reportId({ day: "2026-10-27" }, "day", now, "1.2.0"), null);
  assert.equal(reportId({}, "settings", now, "1.2.0"), "2026-W44");
  assert.equal(reportId({}, "health", now, "1.2.0", null), null, "no week waiting in Rust");
  assert.equal(reportId({}, "health", now, "1.2.0", "2026-W43"), "2026-W43");
  assert.equal(reportId({ runV: "1.1.2" }, "applied", now, "1.2.0"), "1.1.2>1.2.0");
  assert.equal(reportId({ dl: { to: "1.2.1", rollback: false } }, "downloaded", now, "1.2.0"), "1.2.1");
});

test("2026-10-27: open time adds up across launches; a new report draws a new moment", () => {
  const c = clockFor(undefined, "2026-10-27", () => 0.5, 20_000, 300_000);
  assert.deepEqual(c, { id: "2026-10-27", at: 160_000, ms: 0 });
  const later = tickClock(tickClock(c, 60_000, 120_000), 60_000, 120_000);
  assert.equal(later.ms, 120_000);
  assert.equal(clockFor(later, "2026-10-27", () => 0.9, 20_000, 300_000), later, "the same report keeps its clock");
  assert.equal(clockFor(later, "2026-10-28", () => 0.9, 20_000, 300_000).ms, 0);
  assert.equal(tickClock(c, 3_600_000, 120_000).ms, 120_000, "a sleep counts as one capped step");
  assert.equal(tickClock(c, -5, 120_000).ms, 0);
});

test("2026-10-27: a report's key is kept for its retry and made new for the next report", () => {
  let n = 0;
  const make = () => `k${++n}`;
  const a = keyFor(undefined, "2026-10-27", make);
  assert.equal(keyFor(a, "2026-10-27", make), a);
  assert.equal(keyFor(a, "2026-10-28", make).key, "k2");
});

test("a weekly report is due once per ISO week", () => {
  const now = at("2026-10-13T10:00:00Z");
  assert.equal(weeklyDue({}, "settings", now), true);
  assert.equal(weeklyDue({ settingsWeek: "2026-W42" }, "settings", now), false);
  assert.equal(weeklyDue({ settingsWeek: "2026-W42" }, "health", now), true);
  assert.equal(weeklyDue({ settingsWeek: "2026-W41" }, "settings", now), true);
});

test("2026-10-27: a failed report waits its hour; the first try never waits", () => {
  assert.equal(waited(undefined, 5, 3_600_000), true);
  assert.equal(waited(1_000, 3_600_999, 3_600_000), false);
  assert.equal(waited(1_000, 3_601_000, 3_600_000), true);
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
