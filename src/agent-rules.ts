// Agent rules (AGENT.md §8, RULEZ.md §7) — the window's half of the bridge's /rules route:
// list, words, show, add, remove, on, off. An agent reads every rule (yours and the built-in
// ones, locked) and writes only yours. It uses the engine's exports read-only
// (`userRules`, `saveUserRules`, `known`, `allRules`, `ruleIdle`) and the words module for the
// sentence; the shaping is `agent-rules-shape.ts` (pure, tested).
//
// The gate (his call, RULEZ.md §6.6): a write rides Settings › Connections › Agent changes
// settings (`agentSettings`): Allow applies at once with a quiet toast, Ask shows the question
// in the window, Off refuses (403). Reads always work. A rule an agent makes carries
// `by: "agent"`, so Rulez can say who made it.

import { setting } from "./settings-store";
import { toast } from "./toast";
import { allRules, known, ruleIdle, saveUserRules, userRules } from "./rules";
import { NO_LISTS, condText, doText, inText, whenText, type Lists } from "./rulez-words";
import { agentWords, findUserRule, shapeAgentRule } from "./agent-rules-shape";
import { registry } from "./cards";
import { presetOptions } from "./sound";
import { THEME_OPTIONS, SKIN_OPTIONS } from "./look-schedule";
import { userFiles } from "./user-files";
import { fileGone } from "./rules-files";
import * as diag from "./diag";
import type { Rule } from "./rules-eval";

type Reply = Record<string, unknown>;
const waiting = (message: string): Reply => ({ ok: true, pending: "user", message });
const blocked = (why: string) => new Error(`blocked: ${why}`);
const unknown = (why: string) => new Error(`unknown: ${why}`);

/** The run-time lists a sentence needs; playlists and stations stay as ids (no async here). */
function lists(): Lists {
  const outputs = Object.entries(setting("soundOutputNames")).map(([value, label]) => ({ value, label }));
  return {
    ...NO_LISTS,
    cards: (Object.values(registry).filter(Boolean) as { id: string; title: string }[]).map((c) => ({ value: c.id, label: c.title })),
    presets: presetOptions().map((p) => ({ value: p.id, label: p.name })),
    outputs: outputs.length ? outputs : [{ value: "default", label: "This PC" }],
    themes: THEME_OPTIONS,
    skins: SKIN_OPTIONS,
    // Your own files (RULEZ.md §5): a picture or a sound by name, so `do: "picture", value: "Blue"` works.
    pictures: userFiles("picture").map((f) => ({ value: f.id, label: f.name })),
    sounds: userFiles("sound").map((f) => ({ value: f.id, label: f.name })),
  };
}

/** Who made a rule, as the agent reads it. */
function sourceOf(r: Rule): string {
  if ("user" in r.source) return r.by === "agent" ? "agent" : "you";
  if ("row" in r.source) return `Settings › ${r.source.row}`;
  if ("recipe" in (r.source as Record<string, unknown>)) return `recipe ${(r.source as { recipe: string }).recipe}`;
  return "built-in";
}

/** A rule whose Do names a picture or a sound that was deleted (RULEZ.md §5.1): Rulez dims it the same way. */
function namesGoneFile(r: Rule): boolean {
  if (r.kind === "moment") {
    const id = "picture" in r.do ? r.do.picture : "playSound" in r.do ? r.do.playSound : null;
    return id !== null && fileGone(id);
  }
  return r.set.some((s) => "key" in s.target && s.target.key === "glassPictureId" && typeof s.value === "string" && fileGone(s.value));
}

/** One rule as the agent sees it: the sentence, the state, and the stored shape. */
function rowOf(r: Rule, l: Lists) {
  const when = r.kind === "moment" ? whenText(r, l) : "While";
  const cond = r.kind === "moment" ? condText(r.if, l) : condText(r.while, l);
  const where = inText(r, l);
  const text = [
    r.kind === "moment" ? `When ${when.charAt(0).toLowerCase()}${when.slice(1)}` : `While ${cond}`,
    r.kind === "moment" && where && where !== "Any card" ? `in ${where}` : "",
    r.kind === "moment" && cond && cond !== "Always" ? `if ${cond}` : "",
    `→ ${doText(r, l)}`,
  ].filter(Boolean).join(", ").replace(", →", " →");
  const yours = "user" in r.source;
  return {
    id: r.id,
    name: r.name ?? "",
    desc: r.desc || undefined,
    kind: r.kind,
    on: r.on,
    locked: !yours,
    source: sourceOf(r),
    idle: ruleIdle(r) ?? (namesGoneFile(r) ? "The file this rule uses is gone." : undefined),
    text,
    rule: yours ? r : undefined,
  };
}

/** GET /rules[?words=1]: every rule (yours first, then the locked ones), or the vocabulary. */
export async function rulesGet(payload: any): Promise<Reply> {
  if (payload?.words) return { words: agentWords(known(), lists()) };
  const l = lists();
  return { rules: allRules().map((r) => rowOf(r, l)) };
}

/** POST /rules: list · words · show · add · remove · on · off. */
export async function rulesWrite(payload: any): Promise<Reply> {
  const action = String(payload?.action ?? "");
  if (action === "list") return rulesGet({});
  if (action === "words") return rulesGet({ words: true });
  const l = lists();
  if (action === "show") {
    const r = allRules().find((x) => x.id === String(payload?.id ?? "")) ?? findUserRule(userRules(), payload?.id);
    if (!r) throw unknown(`no rule ${JSON.stringify(payload?.id)} — list rules first`);
    return { rule: { ...rowOf(r, l), rule: r } };
  }
  if (!["add", "remove", "on", "off"].includes(action)) throw unknown(`rules action ${JSON.stringify(action)}: use list, words, show, add, remove, on, or off`);

  const mine = userRules();
  let apply: () => void;
  let what: string;
  let done: string;
  if (action === "add") {
    const shaped = shapeAgentRule(payload?.rule, known(), mine, l);
    if ("error" in shaped) throw unknown(`the rule was refused: ${shaped.error}`);
    const rule = shaped.rule;
    const row = rowOf(rule, l);
    what = `add the rule ${rule.name ? `"${rule.name}"` : `"${row.text}"`}`;
    done = `Added ${rule.name ? `"${rule.name}"` : "the rule"} (${rule.id}): ${row.text}. It is at the top of the list, so it runs before the others on its event.`;
    apply = () => saveUserRules([rule, ...userRules()]); // a new rule goes to the top, as Rulez does
  } else {
    const r = findUserRule(mine, payload?.id);
    if (!r) {
      const locked = allRules().find((x) => x.id === String(payload?.id ?? ""));
      if (locked) throw blocked(`"${locked.name ?? locked.id}" is made by ${sourceOf(locked)}; change it there.`);
      throw unknown(`no rule of yours ${JSON.stringify(payload?.id)} — list rules first`);
    }
    const name = r.name ? `"${r.name}"` : r.id;
    if (action === "remove") {
      what = `remove the rule ${name}`;
      done = `Removed ${name}.`;
      apply = () => saveUserRules(userRules().filter((x) => x.id !== r.id));
    } else {
      const on = action === "on";
      if (r.on === on) return { ok: true, message: `${name} is already ${on ? "on" : "off"}.` };
      if (on && r.draft) throw unknown(`${name} is a draft with a part missing; finish it in Rulez first`);
      what = `turn ${name} ${on ? "on" : "off"}`;
      done = `${name} is ${on ? "on" : "off"}.`;
      apply = () => saveUserRules(userRules().map((x) => (x.id === r.id ? { ...x, on } : x)));
    }
  }

  const mode = setting("agentSettings");
  if (mode === "off") throw blocked("Agent changes settings is off in DeetsMusic › Settings › Connections.");
  const run = () => {
    apply();
    diag.log("rule:agent", { action, id: payload?.id, by: "agent" });
  };
  if (mode === "ask") {
    toast({
      kind: "info",
      sticky: true,
      text: `An agent wants to ${what}.`,
      actions: [{ label: "Allow", run }, { label: "Not now" }],
    });
    return waiting(`DeetsMusic asked the user to allow an agent to ${what}. Tell them to answer the question in DeetsMusic; it applies when they press Allow, so don't send it again.`);
  }
  run();
  // The store is the truth; Rulez re-reads it through its own listener.
  toast({ kind: "info", text: `An agent ${action === "add" ? "added a rule" : action === "remove" ? "removed a rule" : `turned a rule ${action}`}: ${what.replace(/^(add the rule|remove the rule|turn) /, "")}.` });
  return { ok: true, message: done };
}
