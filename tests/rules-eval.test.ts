// rules-eval.ts: the rules engine's pure core (docs/architecture/RULES.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validate, evalCond, pickMoment, resolveState, handChange, factsChanged, resume, restart, keepHolds,
  builtinRules, nextEdge, timeFacts, nextClock, readsFact, noteFire, chainDepth, appleMayRun, failingLeaf, CHAIN_CAP, type Known, type Rule, type RowValues, type StateRule, type MomentRule, type Cond,
} from "../src/rules-eval.ts";

const known: Known = {
  events: new Set(["album.open", "artist.open", "diary.open", "cog", "playlist.create", "sleep.arm"]),
  facts: new Set(["surface", "cause", "from", "entry.new", "daylight", "lookMode", "output", "now"]),
  actions: new Set(["grow", "summon", "sleep"]),
  targets: new Set(["key:theme", "key:skin", "key:soundEqPreset", "key:shareActivityApp", "key:shareActivityDiscord", "key:discordRoomInvite", "prop:window.onTop"]),
};

const ROWS: RowValues = {
  drillGrow: "vertical", diaryGrow: "new", lookSchedule: "off", dayTheme: "lilac", daySkin: "press",
  nightTheme: "black-red", nightSkin: "cyber", lookHold: "next", alwaysOnTop: "off", soundEqPerOutput: true,
  soundEqOutputs: {}, sharePauseUntil: 0, playlistCreateSummon: "notmini", sleepSchedule: "off",
};
const rows = (patch: Partial<RowValues>) => builtinRules({ ...ROWS, ...patch });
const byId = (rs: Rule[], id: string) => rs.find((r) => r.id === id);

// ── conditions ──

test("all, any, not and a list of values", () => {
  const f = { surface: "max", output: "hp" } as const;
  assert.equal(evalCond({ all: [{ fact: "surface", is: "max" }, { fact: "output", is: "hp" }] }, f), true);
  assert.equal(evalCond({ all: [{ fact: "surface", is: "max" }, { fact: "output", is: "pc" }] }, f), false);
  assert.equal(evalCond({ any: [{ fact: "surface", is: "midi" }, { fact: "output", is: "hp" }] }, f), true);
  assert.equal(evalCond({ not: { fact: "surface", is: "mini" } }, f), true);
  assert.equal(evalCond({ fact: "surface", is: ["midi", "max"] }, f), true);
  assert.equal(evalCond({ all: [] }, f), true);
  assert.equal(evalCond(undefined, f), true);
});

test("a fact the event does not supply is false, never a match", () => {
  assert.equal(evalCond({ fact: "entry.new", is: true }, { surface: "max" }), false);
  assert.equal(evalCond({ not: { fact: "entry.new", is: true } }, { surface: "max" }), true);
});

test("lt and gte compare numbers (the sharing pause, 2026-09-26)", () => {
  assert.equal(evalCond({ fact: "now", lt: 100 }, { now: 99 }), true);
  assert.equal(evalCond({ fact: "now", lt: 100 }, { now: 100 }), false);
  assert.equal(evalCond({ fact: "now", gte: 100, lt: 200 }, { now: 150 }), true);
  assert.equal(evalCond({ fact: "now", lt: 100 }, { now: "soon" }), false);
});

// ── validate ──

const moment = (patch: Record<string, unknown>) => ({ id: "t", kind: "moment", source: { user: true }, on: true, when: "album.open", card: "*", do: { grow: "full" }, ...patch });

test("a good rule passes; unknown names are refused", () => {
  assert.equal(validate(moment({}), known), null);
  assert.match(validate(moment({ when: "song.end" }), known)!, /unknown event/);
  assert.match(validate(moment({ do: { explode: true } }), known)!, /unknown action/);
  assert.match(validate(moment({ if: { fact: "weather", is: "rain" } }), known)!, /unknown fact/);
  assert.match(validate(moment({ if: { fact: "surface" } }), known)!, /tests nothing/);
  assert.match(validate({ id: "s", kind: "state", while: { all: [] }, set: [{ target: { key: "updateMode" }, value: "off" }], onHand: "next" }, known)!, /unknown target/);
  assert.match(validate(null, known)!, /id/);
});

test("groups at any depth, up to the hang guard (his call 2026-09-27)", () => {
  const leaf = { fact: "surface", is: "max" };
  assert.equal(validate(moment({ if: { all: [leaf, { any: [leaf, leaf] }] } }), known), null);
  assert.equal(validate(moment({ if: { all: [{ any: [{ not: { all: [leaf] } }] }] } }), known), null);
  let deep: unknown = leaf;
  for (let i = 0; i < 20; i++) deep = { all: [deep] };
  assert.match(validate(moment({ if: deep }), known)!, /too deep/);
});

// ── moment pick ──

test("the first matching rule wins; later matches are losers", () => {
  const a = moment({ id: "a", if: { fact: "surface", is: "max" } }) as MomentRule;
  const b = moment({ id: "b", do: { grow: "vertical" } }) as MomentRule;
  const r = pickMoment([a, b], "album.open", "library", { surface: "max" });
  assert.equal(r.rule?.id, "a");
  assert.deepEqual(r.losers.map((x) => x.id), ["b"]);
  assert.equal(pickMoment([a, b], "album.open", "library", { surface: "midi" }).rule?.id, "b");
});

test("a card rule and a * rule: list order decides; a rule for another card never matches", () => {
  const lib = moment({ id: "lib", card: "library" }) as MomentRule;
  const any = moment({ id: "any" }) as MomentRule;
  assert.equal(pickMoment([lib, any], "album.open", "library", {}).rule?.id, "lib");
  assert.equal(pickMoment([lib, any], "album.open", "search", {}).rule?.id, "any");
  assert.equal(pickMoment([lib], "album.open", "search", {}).rule, null);
});

test("an Off rule and another event never match", () => {
  const off = moment({ id: "off", on: false }) as MomentRule;
  assert.equal(pickMoment([off], "album.open", "x", {}).rule, null);
  assert.equal(pickMoment([moment({}) as MomentRule], "artist.open", "x", {}).rule, null);
});

// ── the rows ──

const growFor = (rs: Rule[], event: string, card: string, facts: Record<string, unknown>) =>
  (pickMoment(rs, event as never, card, facts as never).rule?.do as { grow?: string } | undefined)?.grow ?? null;

test("Grow on album or artist: Vertical, Full, Off; sideways in Midi; nothing in Mini", () => {
  for (const ev of ["album.open", "artist.open"]) {
    assert.equal(growFor(rows({ drillGrow: "vertical" }), ev, "library", { surface: "max" }), "vertical");
    assert.equal(growFor(rows({ drillGrow: "vertical" }), ev, "library", { surface: "midi" }), "horizontal");
    assert.equal(growFor(rows({ drillGrow: "full" }), ev, "search", { surface: "max" }), "full");
    assert.equal(growFor(rows({ drillGrow: "full" }), ev, "search", { surface: "midi" }), "horizontal");
    assert.equal(growFor(rows({ drillGrow: "vertical" }), ev, "library", { surface: "mini" }), null);
    assert.equal(growFor(rows({ drillGrow: "off" }), ev, "library", { surface: "max" }), null);
  }
});

test("Diary grow: new entries, every entry, never (RULES.md §4)", () => {
  const f = (n: boolean, surface = "max") => ({ surface, "entry.new": n });
  assert.equal(growFor(rows({ diaryGrow: "new" }), "diary.open", "diary", f(true)), "vertical");
  assert.equal(growFor(rows({ diaryGrow: "new" }), "diary.open", "diary", f(false)), null);
  assert.equal(growFor(rows({ diaryGrow: "new" }), "diary.open", "diary", f(true, "midi")), "horizontal");
  assert.equal(growFor(rows({ diaryGrow: "every" }), "diary.open", "diary", f(false)), "vertical");
  assert.equal(growFor(rows({ diaryGrow: "never" }), "diary.open", "diary", f(true)), null);
});

test("the cog fills Settings in Max and widens it in Midi", () => {
  assert.equal(growFor(rows({}), "cog", "settings", { surface: "max" }), "full");
  assert.equal(growFor(rows({}), "cog", "settings", { surface: "midi" }), "horizontal");
  assert.equal(growFor(rows({}), "cog", "settings", { surface: "mini" }), null);
});

test("New playlist opens Search: always, not in mini, off", () => {
  const summon = (v: RowValues["playlistCreateSummon"], surface: string) =>
    (pickMoment(rows({ playlistCreateSummon: v }), "playlist.create", "playlists", { surface }).rule?.do as { summon?: string } | undefined)?.summon ?? null;
  assert.equal(summon("always", "mini"), "search");
  assert.equal(summon("notmini", "mini"), null);
  assert.equal(summon("notmini", "midi"), "search");
  assert.equal(summon("off", "max"), null);
});

test("Sleep every day: the clock, the sun, off", () => {
  const at = (v: RowValues["sleepSchedule"]) =>
    (pickMoment(rows({ sleepSchedule: v }), "sleep.arm", "*", {}).rule?.do as { sleep?: { at: string } } | undefined)?.sleep?.at ?? null;
  assert.equal(at("clock"), "clock");
  assert.equal(at("sun"), "sun");
  assert.equal(at("off"), null);
});

test("the look schedule: the day look by day, the night look by night, none when off", () => {
  const rs = rows({ lookSchedule: "sun" });
  const day = resolveState(rs, { daylight: true }, []);
  assert.equal(day.set.get("key:theme")?.value, "lilac");
  assert.equal(day.set.get("key:skin")?.value, "press");
  const night = resolveState(rs, { daylight: false }, []);
  assert.equal(night.set.get("key:theme")?.value, "black-red");
  assert.equal(night.set.get("key:skin")?.ruleId, "row:lookSchedule:night");
  assert.equal(resolveState(rows({ lookSchedule: "off" }), { daylight: true }, []).set.size, 0);
  assert.equal((byId(rs, "row:lookSchedule:day") as StateRule).onHand, "next");
  assert.equal((byId(rows({ lookSchedule: "sun", lookHold: "always" }), "row:lookSchedule:day") as StateRule).onHand, "off");
});

test("Keep on top: always, only in the player view, off", () => {
  const top = (v: RowValues["alwaysOnTop"], surface: string) => resolveState(rows({ alwaysOnTop: v }), { surface }, []).set.get("prop:window.onTop")?.value ?? false;
  assert.equal(top("always", "midi"), true);
  assert.equal(top("player", "player"), true);
  assert.equal(top("player", "max"), false);
  assert.equal(top("off", "player"), false);
});

test("EQ for each output: one rule per remembered output; off makes none", () => {
  const rs = rows({ soundEqOutputs: { hp: "warm", pc: "flat" } });
  assert.equal(resolveState(rs, { output: "hp" }, []).set.get("key:soundEqPreset")?.value, "warm");
  assert.equal(resolveState(rs, { output: "pc" }, []).set.get("key:soundEqPreset")?.value, "flat");
  assert.equal(resolveState(rs, { output: "airplay" }, []).set.has("key:soundEqPreset"), false);
  assert.equal(rows({ soundEqPerOutput: false, soundEqOutputs: { hp: "warm" } }).some((r) => r.id.startsWith("row:soundEqOutputs")), false);
});

test("the sharing pause: the three switches read off until the time, then come back", () => {
  const rs = rows({ sharePauseUntil: 1000 });
  const during = resolveState(rs, { now: 999 }, []);
  for (const k of ["shareActivityApp", "shareActivityDiscord", "discordRoomInvite"]) assert.equal(during.set.get(`key:${k}`)?.value, false);
  assert.equal(resolveState(rs, { now: 1000 }, []).set.size, 0);
  assert.equal(nextEdge(rs, 500), 1000);
  assert.equal(nextEdge(rs, 1000), null);
  assert.equal(resolveState(rows({ sharePauseUntil: 0 }), { now: 1 }, []).set.size, 0);
});

test("every built-in rule is valid", () => {
  const all = rows({ lookSchedule: "clock", alwaysOnTop: "player", soundEqOutputs: { hp: "warm" }, sharePauseUntil: 5, sleepSchedule: "sun", playlistCreateSummon: "always", diaryGrow: "every", drillGrow: "full" });
  for (const r of all) assert.equal(validate(r, known), null, r.id);
});

// ── state: first wins, holds ──

const st = (id: string, cond: Cond, value: unknown, onHand: StateRule["onHand"] = "next"): StateRule =>
  ({ id, kind: "state", source: { user: true }, on: true, while: cond, set: [{ target: { key: "theme" }, value }], onHand });

test("two state rules on one target: the first in list order wins", () => {
  const a = st("a", { fact: "surface", is: "max" }, "green");
  const b = st("b", { all: [] }, "sepia");
  assert.equal(resolveState([a, b], { surface: "max" }, []).set.get("key:theme")?.ruleId, "a");
  assert.equal(resolveState([a, b], { surface: "midi" }, []).set.get("key:theme")?.ruleId, "b");
});

test("onHand next: the hold stands until a fact the rule reads changes", () => {
  const r = st("look", { fact: "daylight", is: false }, "black-red");
  const out = handChange(r, "key:theme", { daylight: false, surface: "max" });
  assert.equal(out.do, "hold");
  const holds = out.do === "hold" ? [out.hold] : [];
  assert.deepEqual(holds[0].snap, { daylight: false }); // only the facts the rule reads
  const res = resolveState([r], { daylight: false }, holds);
  assert.equal(res.set.has("key:theme"), false);
  assert.equal(res.held.get("key:theme"), "look");
  assert.equal(factsChanged(holds, [r], { daylight: false, surface: "midi" }).length, 1); // another fact: still held
  assert.equal(factsChanged(holds, [r], { daylight: true }).length, 0);
});

test("a next hold survives a check before its fact is registered (a launch, 2026-09-26)", () => {
  const r = st("look", { fact: "daylight", is: false }, "black-red");
  const out = handChange(r, "key:theme", { daylight: false });
  const holds = out.do === "hold" ? [out.hold] : [];
  assert.equal(factsChanged(restart(holds), [r], { surface: "max" }).length, 1); // no daylight yet
  assert.equal(factsChanged(restart(holds), [r], { daylight: true }).length, 0); // the period moved
});

test("a held target stays yours: a later rule does not take it", () => {
  const a = st("a", { all: [] }, "green");
  const b = st("b", { all: [] }, "sepia");
  const out = handChange(a, "key:theme", {});
  const holds = out.do === "hold" ? [out.hold] : [];
  const res = resolveState([a, b], {}, holds);
  assert.equal(res.set.has("key:theme"), false);
  assert.equal(res.held.get("key:theme"), "a");
});

test("onHand session, until, off, learn", () => {
  const s = handChange(st("s", { all: [] }, 1, "session"), "key:theme", {});
  assert.equal(s.do === "hold" && s.hold.kind, "session");
  const hs = s.do === "hold" ? [s.hold] : [];
  assert.equal(factsChanged(hs, [st("s", { all: [] }, 1, "session")], { now: 5 }).length, 1);
  assert.equal(restart(hs).length, 0);

  const untilRule = st("u", { all: [] }, 1, { until: { fact: "surface", is: "mini" } });
  const u = handChange(untilRule, "key:theme", {});
  const hu = u.do === "hold" ? [u.hold] : [];
  assert.equal(factsChanged(hu, [untilRule], { surface: "max" }).length, 1);
  assert.equal(factsChanged(hu, [untilRule], { surface: "mini" }).length, 0);

  assert.deepEqual(handChange(st("o", { all: [] }, 1, "off"), "key:theme", {}), { do: "off" });
  assert.deepEqual(handChange(st("l", { all: [] }, 1, "learn"), "key:theme", {}), { do: "learn" });
});

test("resume, restart, a rule that is gone or changed", () => {
  const r = st("look", { fact: "daylight", is: true }, "lilac");
  const out = handChange(r, "key:theme", { daylight: true });
  const holds = out.do === "hold" ? [out.hold] : [];
  assert.equal(resume(holds, "look").length, 0);
  assert.equal(restart(holds).length, 1); // a next hold survives a restart (his call, 2026-09-26)
  assert.equal(factsChanged(holds, [], { daylight: true }).length, 0); // the rule is gone
  assert.equal(keepHolds(holds, [r], [r]).length, 1);
  assert.equal(keepHolds(holds, [r], [st("look", { fact: "daylight", is: true }, "green")]).length, 0);
});

// ── Rulez (RULES.md §20, 2026-09-27) ──

test("his example: (Genre is Jazz and Time after 8 PM) or Genre is Rap", () => {
  const c: Cond = { any: [{ all: [{ fact: "genre", is: "jazz" }, { fact: "time", gt: 20 * 60 }] }, { fact: "genre", is: "Rap" }] };
  assert.equal(evalCond(c, { genre: ["Jazz", "Music"], time: 21 * 60 }), true);
  assert.equal(evalCond(c, { genre: ["Jazz"], time: 19 * 60 }), false);
  assert.equal(evalCond(c, { genre: ["rap"], time: 9 * 60 }), true);
  assert.equal(evalCond(c, { time: 22 * 60 }), false); // no genre known: not a match
});

test("is not, gt and lte; text compares without case", () => {
  assert.equal(evalCond({ fact: "artist", isNot: "yeek" }, { artist: "Yeek" }), false);
  assert.equal(evalCond({ fact: "artist", isNot: "yeek" }, { artist: "Other" }), true);
  assert.equal(evalCond({ fact: "songBass", gt: 3 }, { songBass: 3 }), false);
  assert.equal(evalCond({ fact: "songBass", lte: 3 }, { songBass: 3 }), true);
});

test("a draft never runs; a clock rule fires only at its minute", () => {
  const d = moment({ id: "d", draft: true }) as MomentRule;
  assert.equal(pickMoment([d], "album.open", "library", {}).rule, null);
  const c = moment({ id: "c", when: "clock", at: 600 }) as MomentRule;
  assert.equal(pickMoment([c], "clock", "*", {}, 600).rule?.id, "c");
  assert.equal(pickMoment([c], "clock", "*", {}, 601).rule, null);
  assert.equal(pickMoment([c], "clock", "*", {}, 600, new Set(["c"])).rule, null); // turned off by the guard
  assert.match(validate(moment({ when: "clock" }), { ...known, events: new Set(["clock"]) })!, /minute/);
});

test("nextClock: later today, or tomorrow once the minute passed", () => {
  const c = moment({ id: "c", when: "clock", at: 600 }) as MomentRule;
  const morning = new Date(2026, 8, 27, 9, 0);
  assert.equal(new Date(nextClock([c], morning)!.at).getHours(), 10);
  assert.equal(new Date(nextClock([c], morning)!.at).getDate(), 27);
  const night = new Date(2026, 8, 27, 11, 0);
  assert.equal(new Date(nextClock([c], night)!.at).getDate(), 28);
  assert.deepEqual(timeFacts(new Date(2026, 8, 27, 20, 5)), { time: 20 * 60 + 5, day: "sun" });
});

test("the cascade guards: 5 fires in 10 s trip; chains count; Apple waits", () => {
  let times: number[] = [];
  let trip = false;
  for (let i = 0; i < 5; i++) ({ times, trip } = noteFire(times, 1000 + i * 1000));
  assert.equal(trip, true);
  assert.equal(noteFire([0, 1, 2, 3], 20_000).trip, false); // old fires fall out of the window
  assert.deepEqual(chainDepth({ at: 0, depth: 2 }, false, 1000), { caused: true, depth: 3 });
  assert.deepEqual(chainDepth({ at: 0, depth: 2 }, false, 5000), { caused: false, depth: 0 });
  assert.equal(appleMayRun({ caused: true, recent: [], now: 0, backingOff: false }), "caused by a rule");
  // His call 2026-09-27: a number of calls per 30 s, across all rules.
  assert.match(appleMayRun({ caused: false, recent: [0, 1000, 2000], now: 10_000, backingOff: false })!, /3 Apple calls/);
  assert.equal(appleMayRun({ caused: false, recent: [0, 1000], now: 10_000, backingOff: false }), null);
  assert.equal(appleMayRun({ caused: false, recent: [0, 1000, 2000], now: 40_000, backingOff: false }), null);
  assert.equal(appleMayRun({ caused: false, recent: [], now: 0, backingOff: true }), "Apple asked us to wait");
  assert.equal(CHAIN_CAP, 8);
});

test("failingLeaf names the part that keeps a rule from running (Try, route 1)", () => {
  const c: Cond = { all: [{ fact: "surface", is: "max" }, { any: [{ fact: "genre", is: "jazz" }, { fact: "time", gt: 1200 }] }] };
  assert.equal(failingLeaf(c, { surface: "max", genre: ["jazz"], time: 0 }), null);
  assert.deepEqual(failingLeaf(c, { surface: "midi" }), { fact: "surface", is: "max" });
  assert.deepEqual(failingLeaf(c, { surface: "max", genre: ["rap"], time: 0 }), { fact: "genre", is: "jazz" });
});

test("readsFact finds a fact inside nested groups", () => {
  const r = moment({ id: "r", if: { any: [{ all: [{ fact: "time", gt: 1 }] }] } }) as MomentRule;
  assert.equal(readsFact([r], ["time", "day"]), true);
  assert.equal(readsFact([r], ["songBass"]), false);
});
