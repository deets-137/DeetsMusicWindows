// The rule keys of 2026-09-27 (RULES.md §18): Battery saver, the new Focus parts, and their words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RECIPES } from "../src/rules-recipes.ts";
import { resolveState, validate, type Known } from "../src/rules-eval.ts";
import { RULE_KEYS } from "../src/settings-store.ts";
import { doText, sentenceText, doWordOf, NO_LISTS } from "../src/rulez-words.ts";

const recipe = (id: string) => RECIPES.find((r) => r.id === id)!;
const known: Known = {
  events: new Set(["song.play"]),
  facts: new Set(["charging", "explicit"]),
  actions: new Set(["next"]),
  targets: new Set(RULE_KEYS.map((k) => `key:${k}`)),
};

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

test("the new keys read back in their Settings rows' words (2026-09-27)", () => {
  const battery = recipe("battery").rules[0];
  assert.equal(
    doText(battery, NO_LISTS),
    "Fancy Glass: Off, Animate backgrounds: Reduced, Animate card swaps: Off, Animate look changes: Off",
  );
  assert.match(sentenceText(battery, NO_LISTS), /DeetsMusic keeps Fancy Glass off and keeps Animate backgrounds reduced/);
  const quiet = recipe("focus").rules.find((r) => r.id === "recipe:focus:2")!;
  assert.equal(doWordOf(quiet)?.word.id, "toasts");
  assert.equal(doText(quiet, NO_LISTS), "Show notices: Failures");
  const sharing = recipe("focus").rules[0];
  assert.equal(doText(sharing, NO_LISTS), "Pause sharing, Let friends listen along: Off, Put my room code on my box: Off");
});
