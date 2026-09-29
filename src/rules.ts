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
  APPLE_CAP, CHAIN_CAP, EMPTY, ROW_OFF, appleMayRun, failingLeaf, leafResults, builtinRules, chainDepth, factsChanged, handChange, holdVerdict, keepHolds, nextClock, nextEdge,
  noteFire, pickMoment, readsFact, resolveState, restart, resume as resumeHolds, targetId, timeFacts, validate,
  type EventId, type FactId, type FactValue, type Facts, type Hold, type Known, type MomentRule, type Rule, type RowValues,
  type Leaf, type StateRule, type Stored,
} from "./rules-eval";
import { recipeRules } from "./rules-recipes";
import * as diag from "./diag";

// ── the registry (RULES.md §6) ───────────────────────────────────

interface FactDef {
  read: () => FactValue | undefined;
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
  /** `clock` only: the minute that arrived. */
  at?: number;
}
interface ActionDef {
  /** `apple` = the action calls Apple (RULES.md §6, the guards §20.5). */
  cost: "free" | "apple";
  /** An Apple action's target still exists (a playlist, a station). */
  exists?: (arg: unknown) => boolean;
  /** A free action that calls Apple for some targets (Add to an Apple Music playlist). */
  appleIf?: (arg: unknown) => boolean;
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
/** Each fact's value when its seam last fired (JSON), so a seam that fires with no change is
 *  no check. Found 2026-09-27: Sound's seam fires with the audio worklet's status, about 4 times
 *  a second with the EQ on, and every check redrew Rulez (its hover box could never show). */
const seamSeen = new Map<FactId, string>();

export function registerFact(id: FactId, read: FactDef["read"], opts: Omit<FactDef, "read"> = {}): void {
  facts.set(id, { read, ...opts });
  opts.seam?.(() => {
    let now: string;
    try {
      now = JSON.stringify(read() ?? null);
    } catch {
      now = "";
    }
    if (seamSeen.get(id) === now) return;
    seamSeen.set(id, now);
    recheck(`fact:${id}`);
  });
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

/** When a hand pick under a row's rules ends at the latest (ms), asked at the hand change. The
 *  look schedule's hold ends at the time its chip shows (LOOK-SCHEDULE.md §5a, his call
 *  2026-09-29); null = only the condition ends it. */
const holdEnds = new Map<string, () => number | null>();
export function registerHoldEnd(row: string, end: () => number | null): void {
  holdEnds.set(row, end);
}

/** The names the registry knows now (Rulez greys out the words whose module has not registered). */
export function known(): Known {
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
  "goToTarget", "shuffleIdle",
];

let started = false;
let launched = false; // the launch cover is done: every module has registered its parts
let built = false; // the first rule list exists (initRules)
let all: Rule[] = []; // the user's own rules (Rulez), then the built-in ones
let live: Rule[] = []; // the rules that can run now
let holds: Hold[] = [];
const skipped = new Set<string>(); // "id:reason", so a broken rule is logged once
const skipWhy = new Map<string, string>(); // a user rule the validator refuses → why (Rulez dims it)

/** Your own rules, in list order (Rulez). */
export function userRules(): Rule[] {
  const stored: Stored = allSettings().rules ?? EMPTY;
  return stored.v === 1 && Array.isArray(stored.rules) ? stored.rules : [];
}

/** Save your rules (Rulez). A row change rebuilds through the store's listener. */
export function saveUserRules(rules: Rule[]): void {
  setSetting("rules", { ...(allSettings().rules ?? EMPTY), v: 1, rules });
}

/** The recipes you turned on (RULEZ.md §4, route 3: all ship off). */
export const recipesOn = (): string[] => (allSettings().rules ?? EMPTY).recipes ?? [];
export function setRecipe(id: string, on: boolean): void {
  const stored = allSettings().rules ?? EMPTY;
  const now = new Set(stored.recipes ?? []);
  if (on) now.add(id);
  else now.delete(id);
  diag.log("rule:recipe", { id, on });
  setSetting("rules", { ...stored, recipes: [...now] });
}

/** For the Logs view: when each rule last ran, each rule's recent fires, the overlay and holds. */
export function ruleStats() {
  return {
    lastRun: new Map(lastRun),
    fires: new Map(fires),
    offForSession: new Set(offForSession),
    applied: new Map(applied),
    appliedValue: new Map(appliedValue),
    held: new Map(heldNow),
    holds: [...holds],
    facts: readFacts(),
  };
}

/** Try (route 1): would this rule run now, and if not, why. It runs nothing. For a moment
 *  rule the event's own facts are unknown, so it checks the If against the facts now. */
export function tryRule(id: string): { runs: boolean; leaf?: Leaf; lostTo?: Rule; note?: string } {
  const r = all.find((x) => x.id === id);
  if (!r) return { runs: false, note: "This rule is gone." };
  if (r.draft) return { runs: false, note: "A part is missing." };
  if (!r.on) return { runs: false, note: "This rule is off." };
  if (offForSession.has(r.id)) return { runs: false, note: "It fired 5 times in 10 seconds and is off until DeetsMusic starts again." };
  if (!live.includes(r)) return { runs: false, note: skipWhy.get(r.id) ?? "Its part is not ready in this app yet." };
  const f = readFacts({ card: r.kind === "moment" ? r.card : undefined });
  if (r.kind === "state") {
    const leaf = failingLeaf(r.while, f) ?? undefined;
    if (leaf) return { runs: false, leaf };
    const lost = r.set.map((s) => applied.get("key" in s.target ? `key:${s.target.key}` : `prop:${s.target.prop}`)).find((x) => x && x !== r.id);
    const lostTo = lost ? all.find((x) => x.id === lost) : undefined;
    return lostTo ? { runs: false, lostTo } : { runs: true };
  }
  const leaf = failingLeaf(r.if, f) ?? undefined;
  if (leaf) return { runs: false, leaf };
  const { rule } = pickMoment(live, r.when, r.card, f, r.at, offForSession);
  if (rule && rule.id !== r.id) return { runs: false, lostTo: rule };
  return { runs: true };
}

/** A rule that can run reads one of these facts (a costly fact runs only while one does). */
export const ruleReads = (ids: readonly FactId[]): boolean => readsFact(live, ids);

/** Every rule now: yours, then the built-in ones (Rulez shows the built-in ones locked). */
export const allRules = (): readonly Rule[] => all;

/** Why a rule does not run now, or null (Rulez's dim and its hint). */
export function ruleIdle(r: Rule): string | null {
  if (r.draft) return "A part is missing, so this rule does not run yet.";
  if (!r.on) return "This rule is off.";
  if (offForSession.has(r.id)) return "This rule fired 5 times in 10 seconds, so it is off until DeetsMusic starts again.";
  const why = skipWhy.get(r.id);
  return why ? `This rule cannot run: ${why}.` : null;
}

/** Make the rule list again from the rows (a row changed). */
function rebuild(why: string): void {
  const before = all;
  all = [...userRules(), ...recipeRules(recipesOn()), ...builtinRules(allSettings())];
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
  skipWhy.clear();
  live = all.filter((r) => {
    if (r.draft) return false; // a Rulez row with a part missing: saved, never run, no log
    const why = validate(r, k);
    if (!why) return true;
    // A built-in rule or a recipe whose module has not registered yet only waits: no log line.
    if (!("user" in r.source)) return false;
    skipWhy.set(r.id, why);
    // Until the launch is done, a module may still register the part: no line yet (found in the
    // Logs view 2026-09-27: every rule of yours read "unknown event" at launch, then ran fine).
    if (!launched) return false;
    const key = `${r.id}:${why}`;
    if (!skipped.has(key)) {
      skipped.add(key);
      diag.log("rule:skip", { id: r.id, why });
    }
    return false;
  });
  if (built) armClock();
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

// Cascades are allowed (his call, 2026-09-27): an action may set off another rule. The guards
// (RULES.md §20.5, the numbers in rules-eval.ts): a chain stops at CHAIN_CAP; a user rule that
// fires FIRE_CAP times in FIRE_WINDOW_MS is off for the session; an Apple action never runs
// from a rule-caused event, at most APPLE_CAP of them in APPLE_WINDOW_MS across all rules, and
// never while Apple asks us to wait. Memory: the last FIRE_CAP fire times per rule, the last
// run per rule (the Logs view), the last APPLE_CAP Apple runs; nothing else per fire.
let acting = false;
let lastAction: { at: number; depth: number } | null = null;
const fires = new Map<string, number[]>();
const offForSession = new Set<string>();
let appleRecent: number[] = [];
/** When each rule last ran (any rule; the Logs view's "Last ran", RULEZ.md §4). */
const lastRun = new Map<string, number>();
let appleGate: () => boolean = () => false;

/** main.ts: Apple asks us to wait now (apple-health.ts), so a rule's Apple action waits. */
export function setAppleGate(fn: () => boolean): void {
  appleGate = fn;
}

/**
 * A site reports what happened. The first matching moment rule runs its action; returns that
 * rule's id, or null. Refused only while a state check runs (a listener's emit).
 */
export function emit(event: EventId, ctx: EmitCtx): string | null {
  return fire(event, ctx)?.id ?? null;
}

/** A cancel event (RULES.md §20.7): true when the rule that matched says Keep, so the site
 *  does not do what it was about to do. */
export function cancelled(event: EventId, ctx: EmitCtx): boolean {
  const r = fire(event, ctx);
  return !!r && "keep" in r.do;
}

/** A site that asks the rules which way to go (Go to: `openIn`, RULEZ.md §10.1): the Do of the
 *  rule that matched, or null when none did (the site's own default). */
export function decided(event: EventId, ctx: EmitCtx): MomentRule["do"] | null {
  return fire(event, ctx)?.do ?? null;
}

function fire(event: EventId, ctx: EmitCtx): MomentRule | null {
  if (!started) return null;
  if (checking) {
    diag.log("rule", { event, applied: false, reason: "held" });
    return null;
  }
  const now = Date.now();
  const chain = chainDepth(lastAction, acting, now);
  if (chain.depth >= CHAIN_CAP) {
    diag.warn("rule", { event, applied: false, reason: "chain", depth: chain.depth });
    return null;
  }
  const f = readFacts({ card: ctx.card, ...ctx.facts });
  const { rule, losers } = pickMoment(live, event, ctx.card, f, ctx.at, offForSession);
  losers.forEach((l) => diag.log("rule", { id: l.id, event, applied: false, reason: `lost to ${rule!.id}` }));
  // The snapshot (RULEZ.md §9): every rule that listens to this event, with its verdict.
  const snap = momentSnap(event, ctx, f, rule, losers, chain);
  if (!rule) {
    // The events that come often (a song, a press) log only a match: the ring is not a trace.
    if (!QUIET.has(event)) diag.log("rule", { event, card: ctx.card, applied: false, reason: "no rule" });
    logSnap(snap);
    return null;
  }
  const [verb, arg] = Object.entries(rule.do)[0];
  const def = actions.get(verb)!;
  if (def.cost === "apple" || def.appleIf?.(arg)) {
    const why =
      appleMayRun({ caused: chain.caused, recent: appleRecent, now, backingOff: appleGate() }) ??
      (def.exists && !def.exists(arg) ? "its playlist or station is gone" : null);
    if (why) {
      diag.log("rule", { id: rule.id, event, applied: false, reason: why });
      if (snap) snap.rules[0] = { ...snap.rules[0], verdict: "refused", reason: why };
      logSnap(snap);
      return null;
    }
    appleRecent = [...appleRecent, now].slice(-APPLE_CAP);
  }
  lastRun.set(rule.id, now);
  if ("user" in rule.source || "recipe" in rule.source) {
    const n = noteFire(fires.get(rule.id) ?? [], now);
    fires.set(rule.id, n.times);
    if (n.trip) tripRule(rule);
  }
  const wasActing = acting;
  acting = true;
  lastAction = { at: now, depth: chain.depth };
  try {
    const out = def.run(arg, ctx, rule);
    if (out instanceof Promise) out.catch((e) => diag.error("rule:action", { id: rule.id, e: String(e) }));
    diag.log("rule", { id: rule.id, event, card: ctx.card, applied: true, do: verb, arg, depth: chain.depth || undefined });
    logSnap(snap);
  } catch (e) {
    diag.error("rule:action", { id: rule.id, e: String(e) });
  } finally {
    acting = wasActing;
    // The window for "caused by this action" starts when it has run (a skip's song is async).
    lastAction = { at: Date.now(), depth: chain.depth };
  }
  return rule;
}

// ── snapshots (RULEZ.md §9, his call 2026-09-27) ─────────────────
// When a rule runs, or a rule that listens to the event does not (its condition failed, it lost
// to a rule above, the guards refused it), the moment is saved: every fact, each condition with
// ✓ / ✗, the verdict and the chain. It goes to the diag ring as `rule:snap`, so the Logs view,
// the log file (the ring's flush), a bug report and the agent's diag tool all read the same
// thing. Events no rule listens to save nothing. About 1 KB each; the ring bounds them.

export type Verdict = "ran" | "lost" | "no" | "refused" | "holds" | "ended" | "hand";
export interface SnapRule {
  id: string;
  name?: string;
  verdict: Verdict;
  reason?: string;
  conds: { leaf: Leaf; holds: boolean }[];
}
export interface Snap {
  event?: EventId;
  target?: string;
  card?: string;
  depth?: number;
  caused?: boolean;
  facts: Facts;
  rules: SnapRule[];
}

const snapName = (r: Rule) => r.name;
function momentSnap(event: EventId, ctx: EmitCtx, f: Facts, won: MomentRule | null, losers: MomentRule[], chain: { caused: boolean; depth: number }): Snap | null {
  const listeners = live.filter(
    (r): r is MomentRule =>
      r.kind === "moment" && r.on && !r.draft && r.when === event && (r.card === "*" || r.card === ctx.card) && (event !== "clock" || r.at === ctx.at),
  );
  if (!listeners.length) return null;
  const rules: SnapRule[] = listeners.map((r) => ({
    id: r.id,
    name: snapName(r),
    verdict: r === won ? "ran" : losers.includes(r) ? "lost" : offForSession.has(r.id) ? "refused" : "no",
    reason: r === won ? undefined : losers.includes(r) ? `lost to ${won?.id}` : offForSession.has(r.id) ? "off until restart" : undefined,
    conds: leafResults(r.if, f),
  }));
  rules.sort((a, b) => (a.verdict === "ran" ? -1 : b.verdict === "ran" ? 1 : 0));
  return { event, card: ctx.card, depth: chain.depth || undefined, caused: chain.caused || undefined, facts: f, rules };
}
function logSnap(s: Snap | null): void {
  if (s) diag.log("rule:snap", s);
}
/** A While rule started, ended or stood aside: its snapshot. */
function stateSnap(ruleId: string, target: string, verdict: Verdict, f: Facts): void {
  const r = all.find((x) => x.id === ruleId);
  if (!r || r.kind !== "state") return;
  logSnap({ target, facts: f, rules: [{ id: r.id, name: snapName(r), verdict, conds: leafResults(r.while, f) }] });
}

/** The events that fire often: a miss writes no log line. */
const QUIET = new Set<EventId>(["song.play", "song.end", "music.pause", "music.resume", "skip.next", "skip.prev", "card.open", "grow.outside", "grow.back", "surface.change", "queue.summon", "goto.artist", "goto.album", "shuffle.press"]);

/** The fire cap: the rule is off until the app starts again, and a notice names it. */
function tripRule(rule: Rule): void {
  offForSession.add(rule.id);
  fires.delete(rule.id);
  diag.warn("rule:trip", { id: rule.id, name: rule.name });
  const name = rule.name ? `"${rule.name}"` : "A rule";
  void import("./toast").then(({ toast }) =>
    toast({ kind: "warn", text: `${name} ran 5 times in 10 seconds, so it is off until DeetsMusic starts again.`, timeout: 8000 }),
  );
  changeSubs.forEach((cb) => cb());
}

// ── the clock (RULES.md §20.3: "The clock reaches __") ───────────

let clockTimer = 0;
function armClock(): void {
  window.clearTimeout(clockTimer);
  const next = nextClock(live, new Date());
  if (!next) return;
  // A timer stops while the PC sleeps: never wait past 15 minutes, and check again when shown.
  const wait = Math.min(next.at - Date.now(), 15 * 60_000);
  clockTimer = window.setTimeout(() => {
    // A timer the PC slept through runs at wake: "At 7:00 play Morning" must not start at
    // 13:00. More than a minute late, the moment has passed (2026-09-29).
    const late = Date.now() - next.at;
    if (late > 60_000) diag.log("rule:clockLate", { at: next.minute, lateMin: Math.round(late / 60_000) });
    else if (late >= -1000) emit("clock", { card: "*", at: next.minute });
    armClock();
  }, Math.max(wait, 0) + 50);
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
  if (!built) return; // no rules yet: a saved hold would read as the hold of a rule that is gone
  const f = readFacts();
  const ended = holds.filter((h) => !factsChanged([h], all, f).length);
  if (ended.length) {
    holds = holds.filter((h) => !ended.includes(h));
    ended.forEach((h) => diag.log("rule:hold", { id: h.ruleId, target: h.target, ended: true }));
    saveHolds();
  }
  // A `next` hold saved before 2026-09-29 kept raw values: read them once as the condition's
  // verdict, so a time fact that only ticks no longer ends it.
  let moved = false;
  holds = holds.map((h) => {
    if (h.kind !== "next" || h.verdict !== undefined) return h;
    const r = all.find((x) => x.id === h.ruleId);
    if (!r || r.kind !== "state") return h;
    moved = true;
    const { snap: _old, ...rest } = h;
    return { ...rest, verdict: holdVerdict(h, r) };
  });
  if (moved) saveHolds();
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
  for (const [t, id] of next)
    if (applied.get(t) !== id) {
      diag.log("rule", { id, target: t, applied: true, why });
      stateSnap(id, t, "holds", f);
    }
  for (const [t, id] of applied)
    if (!next.has(t)) {
      diag.log("rule", { id, target: t, applied: false, why, reason: res.held.has(t) ? "hand" : "ended" });
      stateSnap(id, t, res.held.has(t) ? "hand" : "ended", f);
    }
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
  // A hold that ends at a time (the look schedule's hand pick).
  for (const h of holds) if (h.endsAt !== undefined && h.endsAt > now && (at === null || h.endsAt < at)) at = h.endsAt;
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
    const end = holdEnds.get(rowOf(rule.id))?.() ?? null;
    const hold = end !== null && end > Date.now() ? { ...out.hold, endsAt: end } : out.hold;
    // One hand change holds every target the rule sets (a look is its theme AND its skin), unless
    // the rule holds each target alone (Focus's switches, `holdEach`, his call 2026-09-29).
    const targets = rule.holdEach ? [target] : rule.set.map((s) => targetId(s.target));
    for (const t of targets) {
      holds = holds.filter((h) => !(h.ruleId === rule.id && h.target === t));
      holds.push({ ...hold, target: t });
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
  const own = all.find((r) => r.id === id && "user" in r.source);
  const text = own ? undefined : texts.get(rowOf(id));
  const name = own ? `Your rule "${own.name || "Untitled"}"` : text?.name ?? "A rule";
  if (bolt) return { kind: "bolt", ruleId: bolt, hint: text?.bolt?.(target) ?? `${name} sets this now.` };
  return { kind: "hand", ruleId: hand!, hint: text?.hand?.(target) ?? `Your pick holds. Press to give it back to ${own ? name[0].toLowerCase() + name.slice(1) : name.toLowerCase()}.` };
}

/** Resume on the chip: the rule acts again at once. A `holdEach` rule gives back only the
 *  chip's own target (Focus: one switch). */
export function resumeRule(ruleId: string, target?: string): void {
  const r = all.find((x) => x.id === ruleId);
  const one = r?.kind === "state" && r.holdEach ? target : undefined;
  holds = resumeHolds(holds, ruleId, one);
  diag.log("rule:resume", { id: ruleId, target: one });
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

/** When the hold of a rule of this id ends at the latest (ms), or null (no hold, or no time). */
export function holdEndsAt(ruleIdPrefix: string): number | null {
  const h = holds.find((x) => x.ruleId.startsWith(ruleIdPrefix));
  return h?.endsAt ?? null;
}

/** A hold saved before it carried a time: give it `at` (the look schedule reads its old
 *  pre-paint copy once at launch, 2026-09-29). */
export function adoptHoldEnd(ruleIdPrefix: string, at: number): void {
  let moved = false;
  holds = holds.map((h) => (h.ruleId.startsWith(ruleIdPrefix) && h.endsAt === undefined ? ((moved = true), { ...h, endsAt: at }) : h));
  if (!moved) return;
  saveHolds();
  recheck("hold-end");
}

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
  rebuild("init");
  built = true;
  // The clock is the engine's own fact. A rule on it (`now < until`) needs no seam: the one
  // timer wakes at its edge (`nextEdge`). Registered AFTER the first build: a registration
  // runs a check, and a check before the rules exist ended every saved hold (found 2026-09-26,
  // a held look lost on reload).
  registerFact("now", () => Date.now());
  // Rulez's time facts (RULES.md §20.3). The minute timer runs only while a rule reads them.
  const nextMinute = () => (readsFact(live, ["time", "day"]) ? Math.ceil((Date.now() + 1) / 60_000) * 60_000 : null);
  registerFact("time", () => timeFacts(new Date()).time, { next: nextMinute });
  registerFact("day", () => timeFacts(new Date()).day);
  // The card an event happened in: every emit supplies it; registered so a rule may name it.
  registerFact("card", () => undefined);
  registerEvent("clock");
  // A cancel event's Do: the site reads it (`cancelled`); the action itself does nothing.
  registerAction("keep", { cost: "free", run: () => undefined });
  diag.log("rule:init", { rules: all.length, live: live.length, holds: holds.length });
  onSettingsChange((k) => {
    if (!(ROW_KEYS as string[]).includes(k) && k !== "rules") return;
    rebuild(`row:${k}`);
    recheck(`row:${k}`);
  });
  onOwnChange(onHand);
  window.addEventListener("deets:boot-done", () => {
    launched = true;
    relist(false); // a rule still broken now is logged once
  }, { once: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      recheck("visible");
      armClock();
    }
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
