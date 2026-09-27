// The agent's rule, shaped (RULEZ.md §7, route 2). Pure: no DOM, no Tauri; `npm test` covers
// it. An agent sends a rule the way Rulez stores one, or the shorter words form (a Do word id
// and a value); this file turns either into a stored `Rule`, with the id, the source and the
// `by: "agent"` mark set here and never by the caller, and refuses what `validate()` refuses.

import { validate, type Cond, type Known, type MomentRule, type Rule, type StateRule, type Value } from "./rules-eval";
import { DOS, EVENTS, FACTS, choicesOf, dosFor, eventWord, isComplete, parseTime, type DoWord, type Lists } from "./rulez-words";

export type Shaped = { rule: Rule } | { error: string };

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** A new agent rule's id: `a:` so a log line says who made it; unique in the list it joins. */
export function agentRuleId(existing: readonly Rule[], now = Date.now()): string {
  const taken = new Set(existing.map((r) => r.id));
  let n = 0;
  for (;;) {
    const id = `a:${now.toString(36)}${n ? `-${n}` : ""}`;
    if (!taken.has(id)) return id;
    n++;
  }
}

/** A Do word's choice, by its label or its value (any case). */
function choiceValue(w: DoWord, raw: unknown, lists: Lists): Value | undefined {
  const cs = choicesOf(w, lists);
  if (!cs.length) return typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" ? raw : undefined;
  const want = String(raw ?? "").trim().toLowerCase();
  const hit = cs.find((c) => String(c.value).toLowerCase() === want || c.label.toLowerCase() === want);
  return hit?.value;
}

/** The value a Do word takes, from the agent's `value`, checked against what the word accepts. */
function doValue(w: DoWord, raw: unknown, lists: Lists): { value: Value } | { error: string } {
  switch (w.input) {
    case "none":
      return { value: true };
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[^\d.+-]/g, ""));
      return Number.isFinite(n) ? { value: n } : { error: `${w.label} takes a number${w.unit ? ` (${w.unit})` : ""}` };
    }
    case "text": {
      const t = String(raw ?? "").trim();
      return t ? { value: t } : { error: `${w.label} takes some text as value` };
    }
    case "choice": {
      const v = choiceValue(w, raw, lists);
      if (v !== undefined) return { value: v };
      const cs = choicesOf(w, lists);
      return { error: cs.length ? `${w.label} takes one of: ${cs.map((c) => c.label).join(", ")}` : `${w.label} takes a value` };
    }
  }
}

/**
 * Shape what an agent sent into a stored rule.
 *
 * Accepted (both any case in labels):
 * - the stored shape: `{ kind: "moment", when, card?, if?, do }` or `{ kind: "state", while, set, onHand? }`,
 *   plus `name?`, `desc?`, `on?`;
 * - the words form: `{ when: "<event id>", at?: "8:00 PM", card?, if?, do: "<do word id>", value? }`
 *   for a moment rule, or `{ while: <condition>, do: "<do word id>", value?, onHand? }` for a state rule.
 * The id, the source and `by: "agent"` are set here. A rule that is not complete is refused
 * (an agent gets no drafts: it can send the whole rule).
 */
export function shapeAgentRule(input: unknown, known: Known, existing: readonly Rule[], lists: Lists, now = Date.now()): Shaped {
  if (!isObj(input)) return { error: "a rule is an object" };
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 60) : undefined;
  const desc = typeof input.desc === "string" && input.desc.trim() ? input.desc.trim().slice(0, 200) : undefined;
  const on = input.on === undefined ? true : input.on === true || input.on === "on";
  const base = { id: agentRuleId(existing, now), source: { user: true } as const, by: "agent" as const, on, name, desc };

  const isState = input.kind === "state" || (input.kind === undefined && input.while !== undefined);
  let rule: Rule;
  if (isState) {
    const cond = input.while as Cond | undefined;
    if (!isObj(cond)) return { error: "a while rule needs a condition: `while`" };
    let set: StateRule["set"];
    if (Array.isArray(input.set)) set = input.set as StateRule["set"];
    else {
      const w = wordFor(input.do, { kind: "state" });
      if ("error" in w) return w;
      if (!w.word.state) return { error: `${w.word.label} is a one-time action; use a when rule` };
      const v = doValue(w.word, input.value, lists);
      if ("error" in v) return v;
      set = w.word.state(v.value);
    }
    const onHand = input.onHand ?? "next";
    rule = { ...base, kind: "state", while: cond, set, onHand: onHand as StateRule["onHand"] };
  } else {
    const when = String(input.when ?? "");
    if (!when) return { error: `a rule needs \`when\`: one of ${EVENTS.map((e) => e.id).join(", ")}` };
    if (!eventWord(when as MomentRule["when"]) && !known.events.has(when)) return { error: `unknown event ${JSON.stringify(when)}; ask for the words` };
    const card = typeof input.card === "string" && input.card.trim() ? input.card.trim() : "*";
    const m: MomentRule = { ...base, kind: "moment", when: when as MomentRule["when"], card, do: {} as never };
    if (when === "clock") {
      const at = typeof input.at === "number" ? input.at : parseTime(String(input.at ?? ""));
      if (at === null || at === undefined) return { error: "a clock rule needs `at`, e.g. 8:00 PM or 20:00" };
      m.at = at;
    }
    if (input.if !== undefined) {
      if (!isObj(input.if)) return { error: "`if` is a condition object" };
      m.if = input.if as Cond;
    }
    if (isObj(input.do)) m.do = input.do as MomentRule["do"];
    else {
      const w = wordFor(input.do, m);
      if ("error" in w) return w;
      if (!w.word.moment) return { error: `${w.word.label} holds a value; use a while rule` };
      const v = doValue(w.word, input.value, lists);
      if ("error" in v) return v;
      m.do = w.word.moment(v.value);
    }
    rule = m;
  }

  const why = validate(rule, known);
  if (why) return { error: why };
  if (!isComplete(rule)) return { error: "the rule is not complete: it needs its when and its do" };
  return { rule };
}

/** The Do word an agent named, by id or label; only the words this kind of rule offers. */
function wordFor(raw: unknown, rule: { kind: "state" } | MomentRule): { word: DoWord } | { error: string } {
  const want = String(raw ?? "").trim().toLowerCase();
  const offered = rule.kind === "state" ? DOS.filter((d) => d.state) : dosFor(rule);
  const word = offered.find((d) => d.id.toLowerCase() === want || d.label.toLowerCase() === want);
  if (word) return { word };
  const kind = rule.kind === "state" ? "a while rule holds" : "a when rule does";
  if (!want) return { error: `a rule needs \`do\`: ${kind} one of ${offered.map((d) => d.id).join(", ")}` };
  return { error: `unknown do ${JSON.stringify(raw)}: ${kind} one of ${offered.map((d) => d.id).join(", ")}` };
}

/** A rule of yours by its id, or by its name (any case). Only your own rules: a built-in rule has no agent verb. */
export function findUserRule(rules: readonly Rule[], ref: unknown): Rule | undefined {
  const want = String(ref ?? "").trim().toLowerCase();
  if (!want) return undefined;
  return rules.find((r) => r.id.toLowerCase() === want) ?? rules.find((r) => (r.name ?? "").trim().toLowerCase() === want);
}

/** The vocabulary an agent reads before it writes a rule (`rules words`). */
export function agentWords(known: Known, lists: Lists) {
  return {
    events: EVENTS.map((e) => ({ id: e.id, label: e.label, section: e.section, known: known.events.has(e.id), cancel: e.cancel || undefined })),
    facts: FACTS.map((f) => ({
      id: f.id, label: f.label, section: f.section, kind: f.kind, unit: f.unit, known: known.facts.has(f.id),
      choices: f.choices ? choicesOf(f, lists).map((c) => ({ value: c.value, label: c.label })) : undefined,
      yes: f.yes, no: f.no,
    })),
    dos: DOS.map((d) => ({
      id: d.id, label: d.label, section: d.section, input: d.input, unit: d.unit,
      when: !!d.moment, while: !!d.state, cancel: d.cancel || undefined,
      choices: d.choices ? choicesOf(d, lists).map((c) => ({ value: c.value, label: c.label })) : undefined,
    })),
    cards: lists.cards.map((c) => ({ id: c.value, label: c.label })),
    conditions: "a leaf { fact, is | isNot | lt | gt | lte | gte } or a group { all: [...] } | { any: [...] } | { not: ... }, any depth; text compares without case",
  };
}
