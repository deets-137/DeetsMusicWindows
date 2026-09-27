// rulez-words.ts: how a rule reads back as words, and the time field (RULES.md §20.3).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTime, formatTime, condText, leafText, whenText, doText, doWordOf, dosFor, isComplete, NO_LISTS, DOS, EVENTS, FACTS,
} from "../src/rulez-words.ts";
import { builtinRules, type MomentRule, type StateRule, type Rule } from "../src/rules-eval.ts";

const lists = { ...NO_LISTS, cards: [{ value: "queue", label: "Queue" }, { value: "playlists", label: "Playlists" }], themes: [{ value: "lilac", label: "Lilac" }] };

test("the time field reads 8pm, 8:00 PM and 20:00 alike", () => {
  assert.equal(parseTime("8pm"), 20 * 60);
  assert.equal(parseTime("8:00 PM"), 20 * 60);
  assert.equal(parseTime("20:00"), 20 * 60);
  assert.equal(parseTime("12:30 am"), 30);
  assert.equal(parseTime("13 pm"), null);
  assert.equal(parseTime("soon"), null);
  assert.equal(formatTime(20 * 60 + 5), "8:05 PM");
  assert.equal(formatTime(0), "12:00 AM");
});

test("his example reads back with its parentheses", () => {
  const c = { any: [{ all: [{ fact: "genre", is: "Jazz" }, { fact: "time", gt: 20 * 60 }] }, { fact: "genre", is: "Rap" }] } as const;
  assert.equal(condText(c as never, lists), "(Genre is Jazz and Time is after 8:00 PM) or Genre is Rap");
  assert.equal(leafText({ fact: "playing", is: false }, lists), "The music is paused");
  assert.equal(leafText({ fact: "songBass", gt: 3 }, lists), "Song bass is above +3 dB");
});

test("a row reads as When · Do; a cancel event offers only Keep", () => {
  const r: MomentRule = { id: "u:1", kind: "moment", source: { user: true }, on: true, when: "grow.outside", card: "queue", if: { fact: "grown", is: "playlists" }, do: { keep: true } };
  assert.equal(whenText(r, lists), "You press outside a grown card");
  assert.equal(doText(r, lists), "Keep it from happening");
  assert.deepEqual(dosFor(r).map((d) => d.id), ["keep"]);
  assert.equal(doWordOf(r)?.word.id, "keep");
  const s: StateRule = { id: "u:2", kind: "state", source: { user: true }, on: true, while: { all: [] }, set: [{ target: { prop: "tone.bass" }, value: -3 }], onHand: "next" };
  assert.equal(doText(s, lists), "Set the bass to -3 dB");
  assert.ok(dosFor(s).every((d) => d.state));
});

test("a draft is not complete until its When and Do are there", () => {
  assert.equal(isComplete({ id: "d", kind: "moment", source: { user: true }, on: false, when: "" as never, card: "*", do: {} as never }), false);
  assert.equal(isComplete({ id: "c", kind: "moment", source: { user: true }, on: true, when: "clock", card: "*", do: { pause: true } }), false);
  assert.equal(isComplete({ id: "c", kind: "moment", source: { user: true }, on: true, when: "clock", at: 60, card: "*", do: { pause: true } }), true);
});

test("every built-in rule reads back as words (the locked rows)", () => {
  const all: Rule[] = builtinRules({
    drillGrow: "vertical", diaryGrow: "new", lookSchedule: "sun", dayTheme: "lilac", daySkin: "press", nightTheme: "black-red", nightSkin: "cyber",
    lookHold: "next", alwaysOnTop: "player", soundEqPerOutput: true, soundEqOutputs: { hp: "bass" }, sharePauseUntil: 5, playlistCreateSummon: "notmini", sleepSchedule: "sun",
  });
  for (const r of all) {
    assert.ok(whenText(r, lists).length > 0, r.id);
    assert.ok(doText(r, lists).length > 0, r.id);
  }
});

test("the word lists have no duplicate ids", () => {
  for (const l of [DOS.map((d) => d.id), EVENTS.map((e) => e.id), FACTS.map((f) => f.id)]) assert.equal(new Set(l).size, l.length);
});
