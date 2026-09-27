// The rules engine, live half (docs/architecture/RULES.md). rules-eval.ts is the pure half.
//
// A module adds its own parts to the registry: an event it reports (`emit`), a fact the
// engine can read, an action a moment rule can take, a window property a state rule can hold.
// Only this module knows rules exist; a site just says what happened.
//
// Moment rules run from `emit`. State rules run from a check (`recheck`) on every seam a fact
// names, on the one fact timer, on a row change and when the page shows again. The check lays
// each active rule's value on its target (the store's overlay, or a property) and lifts it when
// the rule ends. No rule sets off a rule: `emit` is refused while an action or a check runs.

import {
  RULE_KEYS, allSettings, onSettingsChange, onOwnChange, overlayOf, ownSetting, setSetting, _setOverlay,
  type RuleKey, type Settings,
} from "./settings-store";
import {
  EMPTY, ROW_OFF, builtinRules, factsChanged, handChange, keepHolds, nextEdge, pickMoment, resolveState,
  restart, resume as resumeHolds, validate,
  type EventId, type FactId, type Facts, type Hold, type Known, type Rule, type RowValues, type StateRule, type Stored, type Value,
} from "./rules-eval";
import * as diag from "./diag";

// ── the registry (RULES.md §6) ───────────────────────────────────

interface FactDef {
  read: () => Value | undefined;
  /** Tells the engine when the fact changes (a seam). Returns an unsubscribe fn. */
  seam?: (cb: () => void) => () => void;
  /** A fact that changes with time and no seam: when it changes next (ms), or null. */
  next?: () => number | null;
}
export interface EmitCtx {
  card: string;
  /** Facts only the event knows (`entry.new`, `cause`, `from`). */
  facts?: Facts;
  /** How many levels the card has open after the event (a grow ends on Back past it). */
  depth?: number;
}
interface ActionDef {
  /** `apple` = the action calls Apple (RULES.md §6). None does yet. */
  cost: "free" | "apple";
  run: (arg: unknown, ctx: EmitCtx, rule: Rule) => unknown;
}
interface PropDef {
  apply: (value: unknown) => void;
  /** The value when no rule holds the property. */
  off: unknown;
}
/** The chip's words for a row's rules (rule-chip.ts). */
interface ChipText {
  name: string;
  bolt?: (target: string) => string;
  hand?: (target: string) => string;
}

const events = new Map<EventId, { facts: FactId[] }>();
const facts = new Map<FactId, FactDef>();
const actions = new Map<string, ActionDef>();
const props = new Map<string, PropDef>();
const texts = new Map<string, ChipText>();

export function registerEvent(id: EventId, def: { facts: FactId[] } = { facts: [] }): void {
  events.set(id, def);
  relist();
}
export function registerFact(id: FactId, read: FactDef["read"], opts: Omit<FactDef, "read"> = {}): void {
  facts.set(id, { read, ...opts });
  opts.seam?.(() => recheck(`fact:${id}`));
  relist();
}
export function registerAction(verb: string, def: ActionDef): void {
  actions.set(verb, def);
  relist();
}
export function registerProp(id: string, def: PropDef): void {
  props.set(id, def);
  relist();
}
/** A row's name and the chip's hints for its rules. */
export function registerChipText(row: string, text: ChipText): void {
  texts.set(row, text);
}

function known(): Known {
  return {
    events: new Set(events.keys()),
    // A fact is known when a provider reads it, or when an event supplies it (`entry.new`).
    facts: new Set([...facts.keys(), ...[...events.values()].flatMap((e) => e.facts)]),
    actions: new Set(actions.keys()),
    targets: new Set([...RULE_KEYS.map((k) => `key:${k}`), ...[...props.keys()].map((p) => `prop:${p}`)]),
  };
}

// ── the rules ────────────────────────────────────────────────────

const STORE_HOLDS = "deets.rules.holds";

/** The rows whose values make the built-in rules (RULES.md §13). */
const ROW_KEYS: (keyof RowValues)[] = [
  "drillGrow", "diaryGrow", "lookSchedule", "dayTheme", "daySkin", "nightTheme", "nightSkin", "lookHold",
  "alwaysOnTop", "soundEqPerOutput", "soundEqOutputs", "sharePauseUntil", "playlistCreateSummon", "sleepSchedule",
];

let started = false;
let all: Rule[] = []; // the user's own rules (none until the editor), then the built-in ones
let live: Rule[] = []; // the rules that can run now
let holds: Hold[] = [];
const skipped = new Set<string>(); // "id:reason", so a broken rule is logged once

function userRules(): Rule[] {
  const stored: Stored = allSettings().rules ?? EMPTY;
  return stored.v === 1 && Array.isArray(stored.rules) ? stored.rules : [];
}

/** Make the rule list again from the rows (a row changed). */
function rebuild(why: string): void {
  const before = all;
  all = [...userRules(), ...builtinRules(allSettings())];
  // A row change ends the holds of the rules it changed. At launch there is no "before": a
  // saved hold stays while its rule exists (the facts decide at the first check).
  holds = before.length ? keepHolds(holds, before, all) : holds.filter((h) => all.some((r) => r.id === h.ruleId));
  diag.log("rule:rebuild", { why, rules: all.length });
  relist(false);
}

/** Filter to the rules the registry can run now. A rule naming a part not registered yet (a
 *  module that inits later) waits; a user rule that is broken is logged once. */
function relist(check = true): void {
  if (!started) return;
  const k = known();
  live = all.filter((r) => {
    const why = validate(r, k);
    if (!why) return true;
    // A built-in rule whose module has not registered yet only waits: no log line.
    if (!("user" in r.source)) return false;
    const key = `${r.id}:${why}`;
    if (!skipped.has(key)) {
      skipped.add(key);
      diag.log("rule:skip", { id: r.id, why });
    }
    return false;
  });
  if (check) recheck("registry");
}

// ── facts ────────────────────────────────────────────────────────

function readFacts(extra?: Facts): Facts {
  const f: Facts = {};
  for (const [id, def] of facts) {
    try {
      const v = def.read();
      if (v !== undefined) f[id] = v;
    } catch (e) {
      diag.error("rule:fact", { id, e: String(e) });
    }
  }
  return { ...f, ...extra };
}

// ── moment rules (RULES.md §10) ──────────────────────────────────

let acting = false;

/**
 * A site reports what happened. The first matching moment rule runs its action; returns that
 * rule's id, or null. Refused while an action or a check runs: no rule sets off a rule.
 */
export function emit(event: EventId, ctx: EmitCtx): string | null {
  if (!started) return null;
  if (acting || checking) {
    diag.log("rule", { event, applied: false, reason: "held" });
    return null;
  }
  const f = readFacts(ctx.facts);
  const { rule, losers } = pickMoment(live, event, ctx.card, f);
  losers.forEach((l) => diag.log("rule", { id: l.id, event, applied: false, reason: `lost to ${rule!.id}` }));
  if (!rule || rule.kind !== "moment") {
    diag.log("rule", { event, card: ctx.card, applied: false, reason: "no rule" });
    return null;
  }
  const [verb, arg] = Object.entries(rule.do)[0];
  acting = true;
  try {
    const out = actions.get(verb)!.run(arg, ctx, rule);
    if (out instanceof Promise) out.catch((e) => diag.error("rule:action", { id: rule.id, e: String(e) }));
    diag.log("rule", { id: rule.id, event, card: ctx.card, applied: true, do: verb, arg });
  } catch (e) {
    diag.error("rule:action", { id: rule.id, e: String(e) });
  } finally {
    acting = false;
  }
  return rule.id;
}

// ── state rules ──────────────────────────────────────────────────

let checking = false;
let again = false;
let timer = 0;
/** What each target holds now: target id → rule id (a rule's value), for the log and the chip. */
let applied = new Map<string, string>();
let appliedValue = new Map<string, unknown>();
let heldNow = new Map<string, string>();
const propNow = new Map<string, unknown>();
const changeSubs = new Set<() => void>();

function saveHolds(): void {
  try {
    const keep = holds.filter((h) => h.kind === "next");
    if (keep.length) localStorage.setItem(STORE_HOLDS, JSON.stringify(keep));
    else localStorage.removeItem(STORE_HOLDS);
  } catch {
    /* storage off: the holds last this session */
  }
}

function loadHolds(): Hold[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_HOLDS) ?? "[]") as Hold[];
    return Array.isArray(raw) ? restart(raw) : [];
  } catch {
    return [];
  }
}

/** Check every state rule against the facts now, and lay or lift their values. */
export function recheck(why: string): void {
  if (!started) return;
  if (checking) {
    again = true;
    return;
  }
  checking = true;
  try {
    for (let pass = 0; pass < 3; pass++) {
      again = false;
      checkOnce(why);
      if (!again) break;
    }
  } finally {
    checking = false;
  }
}

function checkOnce(why: string): void {
  const f = readFacts();
  const ended = holds.filter((h) => !factsChanged([h], all, f).length);
  if (ended.length) {
    holds = holds.filter((h) => !ended.includes(h));
    ended.forEach((h) => diag.log("rule:hold", { id: h.ruleId, target: h.target, ended: true }));
    saveHolds();
  }
  let res;
  try {
    res = resolveState(live, f, holds);
  } catch (e) {
    diag.error("rule:state", { e: String(e) });
    return;
  }
  const next = new Map<string, string>();
  for (const [t, { ruleId }] of res.set) next.set(t, ruleId);
  // Log each start and end.
  for (const [t, id] of next) if (applied.get(t) !== id) diag.log("rule", { id, target: t, applied: true, why });
  for (const [t, id] of applied) if (!next.has(t)) diag.log("rule", { id, target: t, applied: false, why, reason: res.held.has(t) ? "hand" : "ended" });
  applied = next;
  appliedValue = new Map([...res.set].map(([t, v]) => [t, v.value]));
  heldNow = res.held;
  // The store's keys.
  for (const k of RULE_KEYS as readonly RuleKey[]) {
    const s = res.set.get(`key:${k}`);
    try {
      _setOverlay(k, s?.value, s?.ruleId ?? "");
    } catch (e) {
      diag.error("rule:overlay", { key: k, e: String(e) });
    }
  }
  // The properties.
  for (const [id, def] of props) {
    const s = res.set.get(`prop:${id}`);
    const value = s ? s.value : def.off;
    if (propNow.has(id) && propNow.get(id) === value) continue;
    propNow.set(id, value);
    try {
      def.apply(value);
    } catch (e) {
      diag.error("rule:prop", { id, e: String(e) });
    }
  }
  armTimer();
  changeSubs.forEach((cb) => cb());
}

/** One timer, for the nearest time a fact or a `now` rule changes (RULES.md §5). A timer stops
 *  while the PC sleeps, so the page showing again checks too, and no wait is past 15 minutes. */
function armTimer(): void {
  window.clearTimeout(timer);
  const now = Date.now();
  let at = nextEdge(live, now);
  for (const def of facts.values()) {
    const n = def.next?.() ?? null;
    if (n !== null && n > now && (at === null || n < at)) at = n;
  }
  if (at === null) return;
  timer = window.setTimeout(() => recheck("timer"), Math.min(at - now + 500, 15 * 60_000));
}

// ── a hand change (RULES.md §8) ──────────────────────────────────

function onHand(key: RuleKey): void {
  const ruleId = overlayOf(key);
  const rule = live.find((r) => r.id === ruleId) as StateRule | undefined;
  if (!rule) return;
  const target = `key:${key}`;
  const out = handChange(rule, target, readFacts());
  diag.log("rule:hand", { id: rule.id, target, do: out.do });
  if (out.do === "hold") {
    // One hand change holds every target the rule sets (a look is its theme AND its skin).
    for (const s of rule.set) {
      const t = s.target && "key" in s.target ? `key:${s.target.key}` : `prop:${(s.target as { prop: string }).prop}`;
      holds.push({ ...out.hold, target: t });
    }
    saveHolds();
    recheck("hand");
  } else if (out.do === "off") {
    const row = "row" in rule.source ? rule.source.row : "";
    const off = ROW_OFF[row];
    if (off) setSetting(off[0] as keyof Settings, off[1] as never);
    recheck("hand");
  }
  // "learn": the feature wrote the row's data itself (sound.ts selectPreset); the rules are made
  // again from it, and the check that follows lays the new value.
}

// ── the chip's view ──────────────────────────────────────────────

export interface ChipState {
  kind: "bolt" | "hand";
  ruleId: string;
  hint: string;
}

const rowOf = (ruleId: string): string => ruleId.split(":")[1] ?? "";

/** What the chip beside `target` shows now, or null. */
export function chipState(target: string): ChipState | null {
  // A rule that lays your own value changes nothing you can see: no bolt (a sharing switch
  // that is Off already, under the pause).
  const same = target.startsWith("key:") && appliedValue.get(target) === ownSetting(target.slice(4) as keyof Settings);
  const bolt = same ? undefined : applied.get(target);
  const hand = heldNow.get(target);
  const id = bolt ?? hand;
  if (!id) return null;
  const text = texts.get(rowOf(id));
  const name = text?.name ?? "A rule";
  if (bolt) return { kind: "bolt", ruleId: bolt, hint: text?.bolt?.(target) ?? `${name} sets this now.` };
  return { kind: "hand", ruleId: hand!, hint: text?.hand?.(target) ?? `Your pick holds. Press to give it back to ${name.toLowerCase()}.` };
}

/** Resume on the chip: the rule acts again at once. */
export function resumeRule(ruleId: string): void {
  holds = resumeHolds(holds, ruleId);
  diag.log("rule:resume", { id: ruleId });
  saveHolds();
  recheck("resume");
}

/** End every hold of the rules whose id starts with `prefix` (a row's own settings changed). */
export function resumeRow(prefix: string): void {
  const before = holds.length;
  holds = holds.filter((h) => !h.ruleId.startsWith(prefix));
  if (holds.length === before) return;
  saveHolds();
  recheck("row");
}

/** A rule of this id stands aside for your change now. */
export const isHeld = (ruleIdPrefix: string): boolean => holds.some((h) => h.ruleId.startsWith(ruleIdPrefix));

/** Be told after each check (the chip repaints). Returns an unsubscribe fn. */
export function onRulesChange(cb: () => void): () => void {
  changeSubs.add(cb);
  return () => changeSubs.delete(cb);
}

// ── init ─────────────────────────────────────────────────────────

/** main.ts, after the store and before the cards. */
export function initRules(): void {
  if (started) return;
  started = true;
  holds = loadHolds();
  // The clock is the engine's own fact. A rule on it (`now < until`) needs no seam: the one
  // timer wakes at its edge (`nextEdge`).
  registerFact("now", () => Date.now());
  rebuild("init");
  diag.log("rule:init", { rules: all.length, live: live.length, holds: holds.length });
  onSettingsChange((k) => {
    if (!(ROW_KEYS as string[]).includes(k) && k !== "rules") return;
    rebuild(`row:${k}`);
    recheck(`row:${k}`);
  });
  onOwnChange(onHand);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) recheck("visible");
  });
  recheck("init");
  // A measuring handle for the desk tests (DEBUGGING.md): read the engine from DevTools. The
  // flag loads lazily: telemetry-on.ts needs Vite, and the unit tests load this module.
  void import("./telemetry-on").then(({ TELEMETRY }) => {
    if (!TELEMETRY) return;
    (window as unknown as { __rules: unknown }).__rules = {
      rules: () => all,
      live: () => live,
      holds: () => holds,
      applied: () => Object.fromEntries(applied),
      facts: () => readFacts(),
      recheck: () => recheck("console"),
    };
  });
}
