// agent-rules-shape.ts: an agent's rule becomes a stored rule, or is refused with the reason (RULEZ.md §7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeAgentRule, findUserRule, agentRuleId, agentWords } from "../src/agent-rules-shape.ts";
import { NO_LISTS, DOS, EVENTS, FACTS } from "../src/rulez-words.ts";
import type { Known, Rule } from "../src/rules-eval.ts";

const known: Known = {
  events: new Set(EVENTS.map((e) => e.id)),
  facts: new Set(FACTS.map((f) => f.id)),
  actions: new Set(["play", "pause", "next", "prev", "shuffle", "repeat", "volume", "set", "keep", "sleepIn", "sharePause", "summon", "grow", "note", "hide"]),
  targets: new Set(["key:theme", "key:skin", "key:soundEqPreset", "prop:tone.bass", "prop:window.onTop"]),
};
const lists = { ...NO_LISTS, presets: [{ value: "warm", label: "Warm" }], themes: [{ value: "night", label: "Night" }], cards: [{ value: "queue", label: "Queue" }] };

test("the words form: when + do word + value makes a complete moment rule marked by the agent", () => {
  const r = shapeAgentRule({ name: "Skip rap", when: "song.play", if: { fact: "genre", is: "Rap" }, do: "next" }, known, [], lists);
  assert.ok("rule" in r, JSON.stringify(r));
  const rule = r.rule;
  assert.equal(rule.kind, "moment");
  assert.equal(rule.by, "agent");
  assert.deepEqual(rule.source, { user: true });
  assert.ok(rule.id.startsWith("a:"));
  assert.equal(rule.on, true);
  assert.equal(rule.name, "Skip rap");
  if (rule.kind === "moment") {
    assert.equal(rule.card, "*");
    assert.deepEqual(rule.do, { next: true });
  }
});

test("a choice value takes the label any case; a wrong one names the choices", () => {
  const ok = shapeAgentRule({ when: "song.play", do: "preset", value: "WARM" }, known, [], lists);
  assert.ok("rule" in ok, JSON.stringify(ok));
  const bad = shapeAgentRule({ when: "song.play", do: "preset", value: "Loud" }, known, [], lists);
  assert.ok("error" in bad && /Warm/.test(bad.error), JSON.stringify(bad));
});

test("a while rule from a do word holds a value; a one-time word is refused there", () => {
  const r = shapeAgentRule({ while: { fact: "genre", is: "Jazz" }, do: "theme", value: "Night" }, known, [], lists);
  assert.ok("rule" in r, JSON.stringify(r));
  assert.equal(r.rule.kind, "state");
  if (r.rule.kind === "state") {
    assert.equal(r.rule.onHand, "next");
    assert.deepEqual(r.rule.set[0], { target: { key: "theme" }, value: "night" });
  }
  const bad = shapeAgentRule({ while: { fact: "genre", is: "Jazz" }, do: "next" }, known, [], lists);
  assert.ok("error" in bad && /while|when/.test(bad.error));
});

test("the stored shape passes through validate, and a bad one is refused with its reason", () => {
  const r = shapeAgentRule({ kind: "moment", when: "clock", at: "8:00 PM", card: "*", do: { pause: true } }, known, [], lists);
  assert.ok("rule" in r, JSON.stringify(r));
  if (r.rule.kind === "moment") assert.equal(r.rule.at, 20 * 60);
  const noAt = shapeAgentRule({ when: "clock", do: "pause" }, known, [], lists);
  assert.ok("error" in noAt && /at/.test(noAt.error));
  const badFact = shapeAgentRule({ when: "song.play", if: { fact: "mood", is: "sad" }, do: "pause" }, known, [], lists);
  assert.ok("error" in badFact && /unknown fact/.test(badFact.error));
  const noWhen = shapeAgentRule({ do: "pause" }, known, [], lists);
  assert.ok("error" in noWhen && /when/.test(noWhen.error));
});

test("ids never collide and a rule is found by id or by name, any case", () => {
  const a = agentRuleId([], 1000);
  const b = agentRuleId([{ id: a } as Rule], 1000);
  assert.notEqual(a, b);
  const rules = [{ id: "a:x", name: "Night jazz", kind: "moment" } as Rule];
  assert.equal(findUserRule(rules, "A:X")?.id, "a:x");
  assert.equal(findUserRule(rules, "night JAZZ")?.id, "a:x");
  assert.equal(findUserRule(rules, ""), undefined);
});

test("the words list every event, fact and do, and say which the app has registered", () => {
  const w = agentWords({ ...known, events: new Set(["song.play"]) }, lists);
  assert.equal(w.events.length, EVENTS.length);
  assert.equal(w.facts.length, FACTS.length);
  assert.equal(w.dos.length, DOS.length);
  assert.equal(w.events.find((e) => e.id === "song.play")?.known, true);
  assert.equal(w.events.find((e) => e.id === "album.open")?.known, false);
  assert.deepEqual(w.dos.find((d) => d.id === "preset")?.choices, [{ value: "warm", label: "Warm" }]);
});
