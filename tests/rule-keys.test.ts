// The rule keys of 2026-09-27 (RULES.md §18): Battery saver, the new Focus parts, and their words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RECIPES } from "../src/rules-recipes.ts";
import { pickMoment, resolveState, validate, type Known } from "../src/rules-eval.ts";
import { RULE_KEYS } from "../src/settings-store.ts";
import { doText, sentenceText, doWordOf, NO_LISTS } from "../src/rulez-words.ts";

const recipe = (id: string) => RECIPES.find((r) => r.id === id)!;
const known: Known = {
  events: new Set(["song.play"]),
  facts: new Set(["charging", "explicit"]),
  actions: new Set(["next"]),
  targets: new Set(RULE_KEYS.map((k) => `key:${k}`)),
};

test("2026-11-04 Unshuffled from the top turns shuffle off only when an album starts with it on", () => {
  const rules = recipe("albumTop").rules;
  const words: Known = { events: new Set(["album.top"]), facts: new Set(["shuffle"]), actions: new Set(["shuffle"]), targets: new Set() };
  for (const r of rules) assert.equal(validate(r, words), null);
  assert.deepEqual(pickMoment(rules, "album.top", "library", { shuffle: true }).rule?.do, { shuffle: false });
  assert.equal(pickMoment(rules, "album.top", "library", { shuffle: false }).rule, null);
  assert.equal(pickMoment(rules, "song.play", "library", { shuffle: true }).rule, null);
  assert.equal(sentenceText(rules[0], NO_LISTS), "When you start an album from the top, DeetsMusic turns shuffle off, only if shuffle is on.");
});

test("2026-11-05 Quieter after sunset holds the level at -18, a number, only in the dark", () => {
  const rules = recipe("sunset").rules;
  const words: Known = { ...known, facts: new Set(["daylight"]) };
  for (const r of rules) assert.equal(validate(r, words), null);
  assert.equal(resolveState(rules, { daylight: false }, []).set.get("key:soundLoudTarget")?.value, -18);
  assert.equal(resolveState(rules, { daylight: true }, []).set.has("key:soundLoudTarget"), false);
  assert.equal(doWordOf(rules[0])?.word.id, "soundLoudTarget");
  assert.deepEqual(doWordOf(rules[0])?.word.state?.("-18"), [{ target: { key: "soundLoudTarget" }, value: -18 }]);
  assert.match(sentenceText(rules[0], NO_LISTS), /plays songs at Quieter/);
});

test("Battery saver (2026-09-27) holds only while the PC reports not charging", () => {
  const rules = recipe("battery").rules;
  for (const r of rules) assert.equal(validate(r, known), null);
  const on = resolveState(rules, { charging: false }, []).set;
  assert.equal(on.get("key:glassFancy")?.value, false);
  assert.equal(on.get("key:backgroundMotion")?.value, "reduced");
  assert.equal(on.get("key:cardSwapMotion")?.value, false);
  assert.equal(on.get("key:appearanceMotion")?.value, false);
  assert.equal(on.has("key:fancyScrubber"), false); // the scrubber stays yours
  assert.equal(resolveState(rules, { charging: true }, []).set.size, 0); // a desktop, or plugged in
  assert.equal(resolveState(rules, {}, []).set.size, 0); // no battery API: no fact, no hold
});

test("Focus (2026-09-27) also stops listen-along and the room code, and keeps failures only", () => {
  const rules = recipe("focus").rules;
  for (const r of rules) assert.equal(validate(r, known), null);
  const set = resolveState(rules, {}, []).set;
  for (const k of ["shareActivityApp", "shareActivityDiscord", "discordRoomInvite", "friendsListenAlong", "friendsRoomInvite"])
    assert.equal(set.get(`key:${k}`)?.value, false, k);
  assert.equal(set.get("key:toasts")?.value, "failures");
});

test("2026-09-29: Focus's switches hold one by one; Battery saver still holds as one rule", () => {
  const focus = recipe("focus").rules.find((r) => r.id === "recipe:focus:0")!;
  assert.equal(focus.kind === "state" && focus.holdEach, true);
  const battery = recipe("battery").rules[0];
  assert.equal(battery.kind === "state" && battery.holdEach, undefined);
  // One switch held by hand: the other four stay paused.
  const holds = [{ ruleId: "recipe:focus:0", target: "key:shareActivityApp", kind: "next" as const, verdict: true }];
  const res = resolveState([focus], {}, holds);
  assert.equal(res.held.get("key:shareActivityApp"), "recipe:focus:0");
  for (const k of ["shareActivityDiscord", "discordRoomInvite", "friendsListenAlong", "friendsRoomInvite"])
    assert.equal(res.set.get(`key:${k}`)?.value, false, k);
});

test("the new keys read back in their Settings rows' words (2026-09-27)", () => {
  const battery = recipe("battery").rules[0];
  assert.equal(
    doText(battery, NO_LISTS),
    "Fancy Glass: Off, Animate backgrounds: Reduced, Animate card swaps: Off, Animate look changes: Off",
  );
  assert.match(sentenceText(battery, NO_LISTS), /DeetsMusic keeps Fancy Glass off and keeps background motion reduced/);
  const quiet = recipe("focus").rules.find((r) => r.id === "recipe:focus:2")!;
  assert.equal(doWordOf(quiet)?.word.id, "toasts");
  assert.equal(doText(quiet, NO_LISTS), "Show notices: Failures");
  const sharing = recipe("focus").rules[0];
  assert.equal(doText(sharing, NO_LISTS), "Pause sharing, Let friends listen along: Off, Put my room code on my box: Off");
});

test("2026-10-11 Layout for Max is a rule key and reads in its row's words", () => {
  const rule = {
    id: "user:maxcards", kind: "state" as const, source: { user: true as const }, on: true, name: "Two cards",
    while: { is: true, fact: "charging" } as never, set: [{ target: { key: "maxCards" }, value: "2cols" }], onHand: "next" as const,
  };
  assert.ok((RULE_KEYS as readonly string[]).includes("maxCards"));
  assert.equal(doWordOf(rule)?.word.id, "maxCards");
  assert.equal(doText(rule, NO_LISTS), "Layout for Max: 2 columns");
  assert.match(sentenceText(rule, NO_LISTS), /keeps Max at 2 columns/);
});
