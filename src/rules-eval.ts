// The rules engine's pure core (docs/architecture/RULES.md). No DOM, no store, no timers:
// the types, the validator, the condition check, the moment pick, the state resolve, the
// hold state machine, and the built-in rules each Settings row makes from its own value.
// `npm test` covers all of it (tests/rules-eval.test.ts). rules.ts is the live half.
//
// A rule never replaces a feature (his rule, 2026-09-26): the sleep timer, the look
// schedule, Keep on top stay what they are. A row's rule is only the "when / while" that
// the feature used to decide in its own code.

// ── the shape (RULES.md §4) ──────────────────────────────────────

export type EventId = "album.open" | "artist.open" | "diary.open" | "cog" | "playlist.create" | "sleep.arm";
export type FactId = "surface" | "cause" | "from" | "entry.new" | "daylight" | "lookMode" | "output" | "now";
export type Value = string | number | boolean;
export type Facts = Partial<Record<FactId, Value>>;

/** Who made a rule: a Settings row (from its value), a fixed built-in with no row (the cog), or you (later). */
export type Source = { row: string } | { fixed: string } | { user: true };

/** A leaf: `is` = equal to the value (or to any value in a list); `lt` / `gte` compare a number
 *  (his call, 2026-09-26: the sharing pause is `now < until`). Every test given must hold. */
export type Leaf = { fact: FactId; is?: Value | Value[]; lt?: number; gte?: number };
export type Group = { all: Leaf[] } | { any: Leaf[] } | { not: Leaf };
export type Cond =
  | { all: (Leaf | Group)[] }
  | { any: (Leaf | Group)[] }
  | { not: Leaf | Group }
  | Leaf;

export type GrowAxis = "horizontal" | "vertical" | "full";
export type Action =
  | { grow: GrowAxis }
  | { summon: string }
  | { sleep: { at: "clock" | "sun" } };

export interface MomentRule {
  id: string;
  kind: "moment";
  source: Source;
  on: boolean;
  when: EventId;
  card: string; // a card id, or "*"
  if?: Cond;
  do: Action;
}

/** A store key (`key:theme`) or a window property (`prop:window.onTop`). */
export type RuleTarget = { key: string } | { prop: string };
export type OnHand = "next" | "session" | "off" | "learn" | { until: Cond };

export interface StateRule {
  id: string;
  kind: "state";
  source: Source;
  on: boolean;
  while: Cond;
  set: { target: RuleTarget; value: unknown }[];
  onHand: OnHand;
}

export type Rule = MomentRule | StateRule;
export type Stored = { v: 1; rules: Rule[] };
export const EMPTY: Stored = { v: 1, rules: [] };

export const targetId = (t: RuleTarget): string => ("key" in t ? `key:${t.key}` : `prop:${t.prop}`);

// ── validate (RULES.md §11.2: a broken rule is skipped, never a crash) ──

export interface Known {
  events: ReadonlySet<string>;
  facts: ReadonlySet<string>;
  actions: ReadonlySet<string>;
  targets: ReadonlySet<string>; // target ids
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const isGroupShape = (c: Record<string, unknown>): boolean => "all" in c || "any" in c || "not" in c;

function leafError(l: unknown, k: Known): string | null {
  if (!isObj(l) || typeof l.fact !== "string") return "a leaf needs a fact";
  if (!k.facts.has(l.fact)) return `unknown fact ${l.fact}`;
  if (l.is === undefined && l.lt === undefined && l.gte === undefined) return `leaf ${l.fact} tests nothing`;
  if (l.lt !== undefined && typeof l.lt !== "number") return "lt needs a number";
  if (l.gte !== undefined && typeof l.gte !== "number") return "gte needs a number";
  return null;
}

/** `depth` = how many group levels may still open below this one (top = 2: the top group and one inside). */
function condError(c: unknown, k: Known, depth: number): string | null {
  if (!isObj(c)) return "a condition must be an object";
  if (!isGroupShape(c)) return leafError(c, k);
  if (depth <= 0) return "the condition is too deep";
  const members = "not" in c ? [c.not] : (c.all ?? c.any);
  if (!Array.isArray(members)) return "a group holds a list";
  for (const m of members) {
    const e = condError(m, k, depth - 1);
    if (e) return e;
  }
  return null;
}

/** Null when the rule can run; else why it is skipped. */
export function validate(r: unknown, k: Known): string | null {
  if (!isObj(r) || typeof r.id !== "string") return "a rule needs an id";
  if (r.kind === "moment") {
    if (typeof r.when !== "string" || !k.events.has(r.when)) return `unknown event ${String(r.when)}`;
    if (typeof r.card !== "string") return "a moment rule needs a card";
    if (r.if !== undefined) {
      const e = condError(r.if, k, 2);
      if (e) return e;
    }
    if (!isObj(r.do)) return "a moment rule needs an action";
    const verb = Object.keys(r.do)[0];
    if (!verb || !k.actions.has(verb)) return `unknown action ${String(verb)}`;
    return null;
  }
  if (r.kind === "state") {
    const e = condError(r.while, k, 2);
    if (e) return e;
    if (!Array.isArray(r.set) || !r.set.length) return "a state rule sets nothing";
    for (const s of r.set) {
      if (!isObj(s) || !isObj(s.target)) return "a set needs a target";
      const id = targetId(s.target as RuleTarget);
      if (!k.targets.has(id)) return `unknown target ${id}`;
    }
    const h = r.onHand;
    if (!(h === "next" || h === "session" || h === "off" || h === "learn" || (isObj(h) && !condError(h.until, k, 2)))) return "bad onHand";
    return null;
  }
  return `unknown kind ${String(r.kind)}`;
}

// ── conditions ───────────────────────────────────────────────────

const TRUE: Cond = { all: [] };
export const ALWAYS = TRUE;

function leafHolds(l: Leaf, f: Facts): boolean {
  const v = f[l.fact];
  if (v === undefined) return false;
  if (l.is !== undefined && !(Array.isArray(l.is) ? l.is.includes(v) : l.is === v)) return false;
  if (l.lt !== undefined && !(typeof v === "number" && v < l.lt)) return false;
  if (l.gte !== undefined && !(typeof v === "number" && v >= l.gte)) return false;
  return true;
}

export function evalCond(c: Cond | undefined, f: Facts): boolean {
  if (!c) return true;
  if ("all" in c) return c.all.every((m) => evalCond(m as Cond, f));
  if ("any" in c) return c.any.some((m) => evalCond(m as Cond, f));
  if ("not" in c) return !evalCond(c.not as Cond, f);
  return leafHolds(c, f);
}

/** Every fact a condition reads (a `next` hold watches these). */
export function factsOf(c: Cond | undefined, out: Set<FactId> = new Set()): Set<FactId> {
  if (!c) return out;
  if ("all" in c) c.all.forEach((m) => factsOf(m as Cond, out));
  else if ("any" in c) c.any.forEach((m) => factsOf(m as Cond, out));
  else if ("not" in c) factsOf(c.not as Cond, out);
  else out.add(c.fact);
  return out;
}

// ── moment rules ─────────────────────────────────────────────────

/** The first rule in list order that matches wins (RULES.md §2). `losers` = later matches, for the log. */
export function pickMoment(rules: readonly Rule[], event: EventId, card: string, f: Facts): { rule: MomentRule | null; losers: MomentRule[] } {
  let rule: MomentRule | null = null;
  const losers: MomentRule[] = [];
  for (const r of rules) {
    if (r.kind !== "moment" || !r.on || r.when !== event) continue;
    if (r.card !== "*" && r.card !== card) continue;
    if (!evalCond(r.if, f)) continue;
    if (rule) losers.push(r);
    else rule = r;
  }
  return { rule, losers };
}

// ── holds (RULES.md §8) ──────────────────────────────────────────

/** A state rule standing aside for one target after a hand change. `next` keeps the facts it
 *  saw; it ends when one of them changes. `session` ends at restart; `until` when its condition holds. */
export interface Hold {
  ruleId: string;
  target: string; // target id
  kind: "next" | "session" | "until";
  snap?: Facts;
  until?: Cond;
}

export type HandOutcome = { do: "hold"; hold: Hold } | { do: "learn" } | { do: "off" };

/** You changed a value that `rule` set. What the rule does (RULES.md §8). */
export function handChange(rule: StateRule, target: string, f: Facts): HandOutcome {
  const h = rule.onHand;
  if (h === "learn") return { do: "learn" };
  if (h === "off") return { do: "off" };
  if (h === "session") return { do: "hold", hold: { ruleId: rule.id, target, kind: "session" } };
  if (h === "next") {
    const snap: Facts = {};
    for (const k of factsOf(rule.while)) snap[k] = f[k];
    return { do: "hold", hold: { ruleId: rule.id, target, kind: "next", snap } };
  }
  return { do: "hold", hold: { ruleId: rule.id, target, kind: "until", until: h.until } };
}

/** The holds that still stand after the facts moved to `f`. A hold of a rule that is gone ends too. */
export function factsChanged(holds: readonly Hold[], rules: readonly Rule[], f: Facts): Hold[] {
  const byId = new Map(rules.map((r) => [r.id, r]));
  return holds.filter((h) => {
    const r = byId.get(h.ruleId);
    if (!r || r.kind !== "state" || !r.on) return false;
    if (h.kind === "next") return Object.entries(h.snap ?? {}).every(([k, v]) => f[k as FactId] === v);
    if (h.kind === "until") return !evalCond(h.until, f);
    return true;
  });
}

/** Resume on the chip: the holds of that rule end at once. */
export const resume = (holds: readonly Hold[], ruleId: string): Hold[] => holds.filter((h) => h.ruleId !== ruleId);

/** The app starts again: `session` holds are gone. A `next` hold stays and is checked against
 *  the new facts at the first resolve (his call, 2026-09-26: a look pick survives a restart
 *  until the next day / night change, as `deets.look.hold` did). */
export const restart = (holds: readonly Hold[]): Hold[] => holds.filter((h) => h.kind === "next");

/** A row changed and its rules were made again: a hold of a rule whose shape changed ends. */
export function keepHolds(holds: readonly Hold[], before: readonly Rule[], after: readonly Rule[]): Hold[] {
  const was = new Map(before.map((r) => [r.id, JSON.stringify(r)]));
  const now = new Map(after.map((r) => [r.id, JSON.stringify(r)]));
  return holds.filter((h) => now.has(h.ruleId) && now.get(h.ruleId) === was.get(h.ruleId));
}

// ── state rules ──────────────────────────────────────────────────

export interface Resolved {
  /** target id → the value a rule lays on top, and which rule. */
  set: Map<string, { value: unknown; ruleId: string }>;
  /** target id → the rule that would set it but stands aside for your change. */
  held: Map<string, string>;
}

/** Which state rules hold now, and what each target takes. First rule in list order wins a target;
 *  a held target stays yours (a later rule does not take it). */
export function resolveState(rules: readonly Rule[], f: Facts, holds: readonly Hold[]): Resolved {
  const set = new Map<string, { value: unknown; ruleId: string }>();
  const held = new Map<string, string>();
  const isHeld = (ruleId: string, t: string) => holds.some((h) => h.ruleId === ruleId && h.target === t);
  for (const r of rules) {
    if (r.kind !== "state" || !r.on || !evalCond(r.while, f)) continue;
    for (const s of r.set) {
      const t = targetId(s.target);
      if (set.has(t) || held.has(t)) continue;
      if (isHeld(r.id, t)) held.set(t, r.id);
      else set.set(t, { value: s.value, ruleId: r.id });
    }
  }
  return { set, held };
}

// ── the rows that make rules (RULES.md §13) ──────────────────────

/** The row values the built-in rules read. The settings store's `Settings` satisfies it. */
export interface RowValues {
  drillGrow: "vertical" | "full" | "off";
  diaryGrow: "new" | "every" | "never";
  lookSchedule: "off" | "sun" | "clock" | "windows";
  dayTheme: string;
  daySkin: string;
  nightTheme: string;
  nightSkin: string;
  lookHold: "next" | "always";
  alwaysOnTop: "always" | "player" | "off";
  soundEqPerOutput: boolean;
  soundEqOutputs: Record<string, string>;
  sharePauseUntil: number;
  playlistCreateSummon: "always" | "notmini" | "off";
  sleepSchedule: "off" | "sun" | "clock";
}

/** What a row is set to when one of its rules says `onHand: "off"` (a hand change turns it off). */
export const ROW_OFF: Record<string, [key: string, value: unknown]> = {
  lookSchedule: ["lookSchedule", "off"],
  sharePauseUntil: ["sharePauseUntil", 0],
};

/** The three sharing switches the pause covers (FRIENDS.md D11). */
export const SHARING_KEYS = ["shareActivityApp", "shareActivityDiscord", "discordRoomInvite"] as const;

const surfaceIs = (s: string): Leaf => ({ fact: "surface", is: s });

/** A grow that asks for `max` in Max and the sideways grow in Midi (Midi has only that axis). */
function growPair(id: string, source: Source, when: EventId, card: string, max: GrowAxis, extra: Leaf[] = []): MomentRule[] {
  const rule = (n: number, surface: string, axis: GrowAxis): MomentRule => ({
    id: `${id}:${n}`, kind: "moment", source, on: true, when, card,
    if: { all: [...extra, surfaceIs(surface)] }, do: { grow: axis },
  });
  return [rule(0, "max", max), rule(1, "midi", "horizontal")];
}

/** Every built-in rule, made from the rows' values now. Never stored: made again on each row change. */
export function builtinRules(s: RowValues): Rule[] {
  const out: Rule[] = [];
  const row = (key: string): Source => ({ row: key });

  // Window › Grow on album or artist.
  if (s.drillGrow !== "off") {
    const axis: GrowAxis = s.drillGrow === "full" ? "full" : "vertical";
    out.push(...growPair("row:drillGrow:album", row("drillGrow"), "album.open", "*", axis));
    out.push(...growPair("row:drillGrow:artist", row("drillGrow"), "artist.open", "*", axis));
  }

  // Diary › Grow on open (DIARY.md §4a): taller in Max, wider in Midi.
  if (s.diaryGrow !== "never") {
    const extra: Leaf[] = s.diaryGrow === "new" ? [{ fact: "entry.new", is: true }] : [];
    out.push(...growPair("row:diaryGrow", row("diaryGrow"), "diary.open", "diary", "vertical", extra));
  }

  // The cog: Settings as large as the window allows (no row).
  out.push(...growPair("fixed:cog", { fixed: "cog" }, "cog", "settings", "full"));

  // The look schedule: two state rules, one per period.
  if (s.lookSchedule !== "off") {
    const onHand: OnHand = s.lookHold === "always" ? "off" : "next";
    const look = (period: "day" | "night", theme: string, skin: string): StateRule => ({
      id: `row:lookSchedule:${period}`, kind: "state", source: row("lookSchedule"), on: true,
      while: { fact: "daylight", is: period === "day" },
      set: [{ target: { key: "theme" }, value: theme }, { target: { key: "skin" }, value: skin }],
      onHand,
    });
    out.push(look("day", s.dayTheme, s.daySkin), look("night", s.nightTheme, s.nightSkin));
  }

  // Window › Keep on top: a window property.
  if (s.alwaysOnTop !== "off") {
    out.push({
      id: "row:alwaysOnTop", kind: "state", source: row("alwaysOnTop"), on: true,
      while: s.alwaysOnTop === "always" ? ALWAYS : surfaceIs("player"),
      set: [{ target: { prop: "window.onTop" }, value: true }], onHand: "next",
    });
  }

  // Sound › Remember each output: one rule per remembered output. A pick teaches the rule.
  if (s.soundEqPerOutput) {
    for (const [key, preset] of Object.entries(s.soundEqOutputs)) {
      out.push({
        id: `row:soundEqOutputs:${key}`, kind: "state", source: row("soundEqOutputs"), on: true,
        while: { fact: "output", is: key },
        set: [{ target: { key: "soundEqPreset" }, value: preset }], onHand: "learn",
      });
    }
  }

  // Sharing › Pause sharing for an hour. A hand change on a sharing row ends the pause.
  if (s.sharePauseUntil > 0) {
    out.push({
      id: "row:sharePauseUntil", kind: "state", source: row("sharePauseUntil"), on: true,
      while: { fact: "now", lt: s.sharePauseUntil },
      set: SHARING_KEYS.map((k) => ({ target: { key: k }, value: false })), onHand: "off",
    });
  }

  // Playlists › New playlist opens Search.
  if (s.playlistCreateSummon !== "off") {
    out.push({
      id: "row:playlistCreateSummon", kind: "moment", source: row("playlistCreateSummon"), on: true,
      when: "playlist.create", card: "*",
      if: s.playlistCreateSummon === "notmini" ? { not: surfaceIs("mini") } : undefined,
      do: { summon: "search" },
    });
  }

  // Sleep › Sleep every day. sleep.ts keeps the dial, the warning, the wind-down, the play-out.
  if (s.sleepSchedule !== "off") {
    out.push({
      id: "row:sleepSchedule", kind: "moment", source: row("sleepSchedule"), on: true,
      when: "sleep.arm", card: "*", do: { sleep: { at: s.sleepSchedule } },
    });
  }
  return out;
}

/** The facts a `now`-reading rule changes at next: the earliest `lt` / `gte` edge after `now`. */
export function nextEdge(rules: readonly Rule[], now: number): number | null {
  let best: number | null = null;
  const visit = (c: Cond | undefined): void => {
    if (!c) return;
    if ("all" in c) return c.all.forEach((m) => visit(m as Cond));
    if ("any" in c) return c.any.forEach((m) => visit(m as Cond));
    if ("not" in c) return visit(c.not as Cond);
    if (c.fact !== "now") return;
    for (const t of [c.lt, c.gte]) if (typeof t === "number" && t > now && (best === null || t < best)) best = t;
  };
  for (const r of rules) if (r.on) visit(r.kind === "state" ? r.while : r.if);
  return best;
}
