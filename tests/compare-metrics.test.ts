// scripts/compare/metrics.mjs: the judge's rules (music-app-comp.md §17.3, §1.4, §12).
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore — a plain .mjs module beside the scripts
import { inputTimings, startTimings, summarize, mark, sceneRows, tagKind, cpuBusy, FLOORS } from "../scripts/compare/metrics.mjs";

const frame = (t: number, c: boolean, probe = "self") => ({ ev: "frame", t, changed: true, probes: { [probe]: { c } } });

test("a press is timed by its probe, its sound and the old sound's end, before the next press", () => {
  const ev = [
    { ev: "input", t: 1_000_000, tag: "play", probe: "self", call_us: 3000 },
    frame(1_010_000, false),
    frame(1_088_000, true),
    { ev: "sound-on", t: 1_150_000 },
    { ev: "input", t: 3_000_000, tag: "next1" },
    frame(3_005_000, true), // no probe on this press: the whole window moves, never timed
    { ev: "sound-off", t: 3_146_000 },
    { ev: "sound-on", t: 4_100_000, gap_ms: 954 },
  ];
  const [play, next] = inputTimings(ev);
  assert.equal(play.changeMs, 88);
  assert.equal(play.soundMs, 150);
  assert.equal(play.callMs, 3);
  assert.equal(play.stopMs, null);
  assert.equal(next.changeMs, null);
  assert.equal(next.soundMs, 1100);
  assert.equal(next.soundGapMs, 954);
  assert.equal(next.stopMs, 146);
});

test("a step the sensor tagged itself (s07-key) is a helper press, not a row", () => {
  const ev = [{ ev: "input", t: 0, tag: "s07-key" }, { ev: "input", t: 10, tag: "search1" }];
  assert.deepEqual(inputTimings(ev).map((x: any) => x.tag), [null, "search1"]);
});

test("a sound after the next press is not credited to the press before it", () => {
  const ev = [
    { ev: "input", t: 0, tag: "play" },
    { ev: "input", t: 100_000, tag: "pause" },
    { ev: "sound-on", t: 200_000 },
  ];
  const [play, pause] = inputTimings(ev);
  assert.equal(play.soundMs, null);
  assert.equal(pause.soundMs, 100);
});

test("repeats of one press pool under one metric", () => {
  assert.equal(tagKind("next3"), "next");
  assert.equal(tagKind("play"), "play");
  const pass = (s: number[]) => s.map((v, i) => ({ tag: `next${i + 1}`, changeMs: null, soundMs: v }));
  const rows = sceneRows([pass([500, 460]), pass([480])]);
  assert.deepEqual(rows.map((r: any) => [r.metric, r.n, r.median]), [["next → sound", 3, 480]]);
});

test("spread over 8 % is NOISY (§1.4); one sample is never noisy", () => {
  assert.equal(summarize([100, 104, 107]).noisy, false);
  assert.equal(summarize([100, 104, 109]).noisy, true);
  assert.equal(summarize([100]).noisy, false);
  assert.equal(summarize([]).n, 0);
});

test("§12: a mark needs no overlap, a move over the floor, and two quiet runs", () => {
  const a = summarize([300, 302, 305]);
  const faster = summarize([250, 252, 255]);
  assert.equal(mark(a, faster, FLOORS.sound), "▲");
  assert.equal(mark(faster, a, FLOORS.sound), "▼");
  // Inside the floor: no change, even with no overlap.
  assert.equal(mark(summarize([100, 101, 102]), summarize([94, 95, 96]), FLOORS.screen), "=");
  // Overlapping ranges: no change.
  assert.equal(mark(summarize([300, 320, 322]), summarize([290, 302, 310]), FLOORS.sound), "=");
  // A noisy side: no change.
  assert.equal(mark(a, summarize([150, 250, 260]), FLOORS.sound), "=");
});

test("a gesture's motion window: fps, dropped gaps and p99 between its first and last change", () => {
  // 240 Hz (period 4.17 ms): frames every 4.17 ms, one gap of 12.5 ms (two frames missing).
  const p = 1e6 / 240;
  const times = [0, 1, 2, 3, 6, 7].map((k) => 1_000_000 + Math.round(k * p) + 20_000);
  const ev = [
    { ev: "output", t: 0, hz: 240 },
    { ev: "input", t: 1_000_000, tag: "down", probe: "list" },
    ...times.map((t) => frame(t, true, "list")),
    frame(times[5] + 4000, false, "list"),
    { ev: "settled", t: 2_000_000, probe: "list", last_change: times[5] },
  ];
  const [x] = inputTimings(ev);
  assert.equal(x.changeMs, 20);
  assert.equal(x.settledMs, (times[5] - 1_000_000) / 1000);
  assert.equal(x.frames, 6);
  assert.ok(Math.abs(x.fps - 5 / ((times[5] - times[0]) / 1e6)) < 1e-9);
  assert.equal(x.dropPct, 20); // 1 of 5 gaps over 1.5 periods
  assert.ok(x.p99Ms > 12 && x.p99Ms <= 12.6);
});

test("typed text is timed from its last key; a change while typing is not the result", () => {
  const ev = [
    { ev: "input", t: 1_000_000, kind: "text", step: 4, tag: "search1", probe: "results" },
    frame(1_100_000, true, "results"), // as-you-type results, before the last key
    { ev: "input-end", t: 1_200_000, kind: "text", step: 4 },
    frame(1_260_000, true, "results"),
    frame(1_300_000, true, "results"),
    { ev: "settled", t: 1_900_000, probe: "results", last_change: 1_300_000 },
  ];
  const [x] = inputTimings(ev);
  assert.equal(x.changeMs, 60);
  assert.equal(x.settledMs, 100);
  // Results already final before the last key: settled 0, never negative.
  const early = [ev[0], ev[1], ev[2], { ev: "settled", t: 1_800_000, probe: "results", last_change: 1_100_000 }];
  assert.equal(inputTimings(early)[0].settledMs, 0);
});

test("a start: quit, window, content and settled, with frames only from the lifted window", () => {
  const box = [0, 0, 100, 100];
  const flat = (t: number, f: boolean) => ({ ev: "frame", t, probes: { content: { flat: f } } });
  const ev = [
    { ev: "input", t: 1_000_000, kind: "close" },
    { ev: "gone", t: 2_700_000 },
    { ev: "launch", t: 4_000_000 },
    flat(4_100_000, false), // another app under the region: before `shown`, never counted
    { ev: "shown", t: 5_000_000, lifted: true, frame: box },
    flat(5_010_000, true), // the launch cover: one flat colour
    { ev: "placed", t: 5_150_000, frame: box },
    flat(5_400_000, false),
    flat(5_600_000, false),
    { ev: "settled", t: 6_200_000, probe: "content", last_change: 5_600_000 },
  ];
  assert.deepEqual(startTimings(ev), { quitMs: 1700, windowMs: 1000, contentMs: 1400, settledMs: 1600 });
  // Opened somewhere else and moved in: frames count from `placed`.
  const moved = ev.map((e: any) => (e.ev === "shown" ? { ...e, frame: [500, 0, 100, 100] } : e));
  assert.equal(startTimings(moved).contentMs, 1400);
  const early = [...ev.slice(0, 5), flat(5_010_000, false), ev[6], { ev: "settled", t: 6_000_000, probe: "content", last_change: 5_010_000 }];
  assert.equal(startTimings(early).contentMs, 1010);
  assert.equal(startTimings(early).settledMs, 1010);
});

test("a start's open fade, then a blank window, is not content (Apple, 2026-10-10)", () => {
  const flat = (t: number, f: boolean) => ({ ev: "frame", t, probes: { content: { flat: f } } });
  const ev = [
    { ev: "launch", t: 0 },
    { ev: "shown", t: 914_000, lifted: true, frame: [0, 0, 10, 10] },
    flat(928_000, false), // the fade over what was under the window
    flat(1_003_000, true), // black while it loads
    { ev: "placed", t: 1_126_000, frame: [0, 0, 10, 10] },
    flat(3_100_000, false), // the list draws
    flat(3_150_000, false),
    { ev: "settled", t: 3_700_000, probe: "content", last_change: 3_150_000 },
  ];
  const x = startTimings(ev);
  assert.equal(x.contentMs, 3100);
  assert.equal(x.settledMs, 3150);
});

test("fps is better higher: a rise is ▲, and its floor is 3 % of the median", () => {
  const before = summarize([200, 202, 204]);
  assert.equal(mark(before, summarize([230, 231, 233]), FLOORS.fps, true), "▲");
  assert.equal(mark(before, summarize([170, 171, 173]), FLOORS.fps, true), "▼");
  assert.equal(mark(before, summarize([205, 206, 207]), FLOORS.fps, true), "=");
});

test("the idle gate reads machine-wide CPU between two os.cpus() readings", () => {
  const t = (user: number, idle: number) => ({ times: { user, nice: 0, sys: 0, irq: 0, idle } });
  assert.equal(cpuBusy([t(0, 0), t(0, 0)], [t(10, 90), t(30, 70)]), 0.2);
});
