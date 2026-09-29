// The rules engine's pure core (docs/architecture/RULES.md). No DOM, no store, no timers:
// the types, the validator, the condition check, the moment pick, the state resolve, the
// hold state machine, and the built-in rules each Settings row makes from its own value.
// `npm test` covers all of it (tests/rules-eval.test.ts). rules.ts is the live half.
//
// A rule never replaces a feature (his rule, 2026-09-26): the sleep timer, the look
// schedule, Keep on top stay what they are. A row's rule is only the "when / while" that
// the feature used to decide in its own code.

// ── the shape (RULES.md §4) ──────────────────────────────────────

export type EventId =
  | "album.open" | "artist.open" | "diary.open" | "cog" | "playlist.create" | "sleep.arm"
  // Rulez (RULES.md §20.3): playback, time, window, sound.
  | "song.play" | "song.end" | "music.pause" | "music.resume" | "skip.next" | "skip.prev" | "queue.end" | "station.play"
  | "clock" | "app.open" | "surface.change" | "tray.hide" | "tray.show" | "card.open" | "output.change"
  // A cancel event (RULEZ.md §1.7): a rule whose Do is `keep` stops what the app was about to do.
  | "grow.outside" | "station.return" | "grow.back" | "replay.weekly"
  // Route 8 (RULEZ.md §10.1): the Queue's layout change (a cancel event), Go to, the shuffle press.
  | "queue.summon" | "goto.artist" | "goto.album" | "shuffle.press";
export type FactId =
  | "surface" | "cause" | "from" | "entry.new" | "daylight" | "lookMode" | "output" | "now"
  // Rulez (RULES.md §20.3).
  | "genre" | "artist" | "album" | "year" | "explicit" | "playing" | "shuffle" | "repeat" | "volume" | "source"
  | "time" | "day" | "card" | "grown"
  | "eqPreset" | "eqBass" | "eqMids" | "eqTreble" | "loudness" | "songBass" | "songMids" | "songTreble"
  // Route 5 (RULEZ.md §3): facts that cost nothing, from app state.
  | "outputKind" | "loved" | "diaryScore" | "plays" | "queueLength" | "sinceOpen" | "idle"
  | "battery" | "charging" | "online" | "dataSaver"
  // Route 8 (RULEZ.md §10.1): a song is loaded; the window's size.
  | "loaded" | "windowWidth" | "windowHeight"
  // RULEZ.md §11: the cover's color as a word, and light or dark.
  | "albumColor" | "albumLight";
export type Value = string | number | boolean;
/** A fact's value. A list (a song's genres) holds when any member does. */
export type FactValue = Value | string[];
export type Facts = Partial<Record<FactId, FactValue>>;

/** Who made a rule: a Settings row (from its value), a fixed built-in with no row (the cog), or you (Rulez). */
export type Source = { row: string } | { fixed: string } | { user: true } | { recipe: string };

/** A leaf: `is` = equal to the value (or to any value in a list), `isNot` = equal to none of them (not `not`: that name is the group);
 *  `lt` / `gt` / `gte` / `lte` compare a number (his call, 2026-09-26: the sharing pause is
 *  `now < until`). Every test given must hold. Text compares without case. */
export type Leaf = { fact: FactId; is?: Value | Value[]; isNot?: Value | Value[]; lt?: number; gt?: number; gte?: number; lte?: number };
/** A condition: a leaf, or a group of conditions at any depth (his call, 2026-09-27, RULES.md §20.1). */
export type Cond = { all: Cond[] } | { any: Cond[] } | { not: Cond } | Leaf;
export type Group = Exclude<Cond, Leaf>;

export type GrowAxis = "horizontal" | "vertical" | "full";
export type Action =
  | { grow: GrowAxis }
  | { summon: string }
  | { sleep: { at: "clock" | "sun" } }
  // Rulez (RULES.md §20.3). A When row's "set" writes your value (§20.4).
  | { play: true }
  | { pause: true }
  | { next: true }
  | { prev: true }
  | { shuffle: boolean }
  | { repeat: "off" | "all" | "one" }
  | { volume: number }
  | { playPlaylist: string }
  | { playStation: string }
  | { set: { key: string; value: unknown } }
  | { sharePause: number }
  | { sleepIn: number }
  | { keep: true }
  // Route 6 (RULEZ.md §3): what the app already does.
  | { note: string }
  | { addTo: string }
  | { love: true }
  | { diary: true }
  | { scrobble: boolean }
  | { hide: true }
  // Your own files (RULEZ.md §5, rules-files.ts): a When row's picture writes your value; a sound plays once.
  | { picture: string }
  | { playSound: string }
  // Route 8 (RULEZ.md §10.1): where Go to opens (the site reads it, as a cancel site reads Keep);
  // the idle shuffle press.
  | { openIn: "library" | "search" }
  | { shuffleLibrary: true };

/** Name and Desc (Rulez), and `draft`: a row with a part still missing is saved and never runs. */
interface Named {
  name?: string;
  desc?: string;
  draft?: boolean;
  /** Made by an agent through the bridge (RULEZ.md, route 2); Rulez marks the row. */
  by?: "agent";
}

export interface MomentRule extends Named {
  id: string;
  kind: "moment";
  source: Source;
  on: boolean;
  when: EventId;
  /** `clock` only: the minute of the day it fires at. */
  at?: number;
  card: string; // a card id, or "*"
  if?: Cond;
  do: Action;
}

/** A store key (`key:theme`) or a window property (`prop:window.onTop`). */
export type RuleTarget = { key: string } | { prop: string };
export type OnHand = "next" | "session" | "off" | "learn" | { until: Cond };

export interface StateRule extends Named {
  id: string;
  kind: "state";
  source: Source;
  on: boolean;
  while: Cond;
  set: { target: RuleTarget; value: unknown }[];
  onHand: OnHand;
  /** A hand change holds only the target you changed (Focus's sharing switches, his call
   *  2026-09-29). Without it one hand change holds every target the rule sets: a look is its
   *  theme AND its skin, and Battery saver sticks together (his call, 2026-09-27). */
  holdEach?: boolean;
}

export type Rule = MomentRule | StateRule;
/** `recipes`: the shipped recipes you turned on (RULEZ.md §4, route 3). Off by default. */
export type Stored = { v: 1; rules: Rule[]; recipes?: string[] };
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
  const nums = ["lt", "gt", "gte", "lte"] as const;
  if (l.is === undefined && l.isNot === undefined && nums.every((n) => l[n] === undefined)) return `leaf ${l.fact} tests nothing`;
  for (const n of nums) if (l[n] !== undefined && typeof l[n] !== "number") return `${n} needs a number`;
  return null;
}

/** Any depth for you (RULES.md §20.1); the stop is only so a hand-edited store cannot hang the check. */
export const COND_DEPTH = 16;

/** `depth` = how many group levels may still open below this one. */
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
    if (r.when === "clock" && (typeof r.at !== "number" || r.at < 0 || r.at >= 1440)) return "a clock rule needs a minute";
    if (r.if !== undefined) {
      const e = condError(r.if, k, COND_DEPTH);
      if (e) return e;
    }
    if (!isObj(r.do)) return "a moment rule needs an action";
    const verb = Object.keys(r.do)[0];
    if (!verb || !k.actions.has(verb)) return `unknown action ${String(verb)}`;
    return null;
  }
  if (r.kind === "state") {
    const e = condError(r.while, k, COND_DEPTH);
    if (e) return e;
    if (!Array.isArray(r.set) || !r.set.length) return "a state rule sets nothing";
    for (const s of r.set) {
      if (!isObj(s) || !isObj(s.target)) return "a set needs a target";
      const id = targetId(s.target as RuleTarget);
      if (!k.targets.has(id)) return `unknown target ${id}`;
    }
    const h = r.onHand;
    if (!(h === "next" || h === "session" || h === "off" || h === "learn" || (isObj(h) && !condError(h.until, k, COND_DEPTH)))) return "bad onHand";
    return null;
  }
  return `unknown kind ${String(r.kind)}`;
}

// ── conditions ───────────────────────────────────────────────────

const TRUE: Cond = { all: [] };
export const ALWAYS = TRUE;

const fold = (x: Value): Value => (typeof x === "string" ? x.toLowerCase() : x);
/** The fact's value (or any of its values, for a list) equals one of `want`. */
function matches(v: FactValue, want: Value | Value[]): boolean {
  const wants = (Array.isArray(want) ? want : [want]).map(fold);
  const have = (Array.isArray(v) ? v : [v]).map(fold);
  return have.some((h) => wants.includes(h));
}

function leafHolds(l: Leaf, f: Facts): boolean {
  const v = f[l.fact];
  if (v === undefined) return false;
  if (l.is !== undefined && !matches(v, l.is)) return false;
  if (l.isNot !== undefined && matches(v, l.isNot)) return false;
  const n = typeof v === "number" ? v : null;
  if (l.lt !== undefined && !(n !== null && n < l.lt)) return false;
  if (l.gt !== undefined && !(n !== null && n > l.gt)) return false;
  if (l.gte !== undefined && !(n !== null && n >= l.gte)) return false;
  if (l.lte !== undefined && !(n !== null && n <= l.lte)) return false;
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
export function pickMoment(rules: readonly Rule[], event: EventId, card: string, f: Facts, at?: number, skip?: ReadonlySet<string>): { rule: MomentRule | null; losers: MomentRule[] } {
  let rule: MomentRule | null = null;
  const losers: MomentRule[] = [];
  for (const r of rules) {
    if (r.kind !== "moment" || !r.on || r.draft || r.when !== event) continue;
    if (skip?.has(r.id)) continue;
    if (event === "clock" && r.at !== at) continue;
    if (r.card !== "*" && r.card !== card) continue;
    if (!evalCond(r.if, f)) continue;
    if (rule) losers.push(r);
    else rule = r;
  }
  return { rule, losers };
}

// ── holds (RULES.md §8) ──────────────────────────────────────────

/** A state rule standing aside for one target after a hand change. `next` keeps the whole
 *  condition's verdict at the hand change (`verdict`); it ends when that verdict flips, so a
 *  time or counter fact that only ticks keeps the hold, and so does a switch between the leaves
 *  of an "or" group (his call, 2026-09-29: the hold lasts until the rule's CONDITION changes).
 *  `session` ends at restart; `until` when its condition holds. `endsAt` (ms, any kind): the
 *  hold ends at that time too — the look schedule's hand pick ends at the time its chip shows
 *  (LOOK-SCHEDULE.md §5a). */
export interface Hold {
  ruleId: string;
  target: string; // target id
  kind: "next" | "session" | "until";
  /** `next`: the rule's While at the hand change (true: a hold starts only while the rule acts). */
  verdict?: boolean;
  /** `next`, saved before 2026-09-29: the raw values the rule read. Read once as `verdict`. */
  snap?: Facts;
  until?: Cond;
  endsAt?: number;
}

export type HandOutcome = { do: "hold"; hold: Hold } | { do: "learn" } | { do: "off" };

/** A condition's verdict, or null when facts with no value (a module not registered yet, at
 *  launch; no song for a cover fact) leave it undecided. Three-valued: an "or" with one true
 *  member is true, an "and" with one false member is false, whatever the unknown ones are. */
export function verdictOf(c: Cond | undefined, f: Facts): boolean | null {
  if (!c) return true;
  if ("all" in c) {
    let unknown = false;
    for (const m of c.all) {
      const v = verdictOf(m as Cond, f);
      if (v === false) return false;
      if (v === null) unknown = true;
    }
    return unknown ? null : true;
  }
  if ("any" in c) {
    let unknown = false;
    for (const m of c.any) {
      const v = verdictOf(m as Cond, f);
      if (v === true) return true;
      if (v === null) unknown = true;
    }
    return unknown ? null : false;
  }
  if ("not" in c) {
    const v = verdictOf(c.not as Cond, f);
    return v === null ? null : !v;
  }
  return f[c.fact] === undefined ? null : leafHolds(c, f);
}

/** You changed a value that `rule` set. What the rule does (RULES.md §8). */
export function handChange(rule: StateRule, target: string, f: Facts): HandOutcome {
  const h = rule.onHand;
  if (h === "learn") return { do: "learn" };
  if (h === "off") return { do: "off" };
  if (h === "session") return { do: "hold", hold: { ruleId: rule.id, target, kind: "session" } };
  // The rule acts on this target, so its condition holds: an undecided read is true.
  if (h === "next") return { do: "hold", hold: { ruleId: rule.id, target, kind: "next", verdict: verdictOf(rule.while, f) ?? true } };
  return { do: "hold", hold: { ruleId: rule.id, target, kind: "until", until: h.until } };
}

/** A `next` hold's verdict: its own, or (a hold saved before 2026-09-29) its raw values read
 *  through the rule's While now; undecided (a value was missing) reads as true, since a hold
 *  only starts while the rule acts. */
export function holdVerdict(h: Hold, r: StateRule): boolean {
  return h.verdict ?? verdictOf(r.while, h.snap ?? {}) ?? true;
}

/** The holds that still stand after the facts moved to `f`. A hold of a rule that is gone ends too.
 *  A fact `f` does not hold yet (its module has not registered, at launch) is not a change. */
export function factsChanged(holds: readonly Hold[], rules: readonly Rule[], f: Facts): Hold[] {
  const byId = new Map(rules.map((r) => [r.id, r]));
  return holds.filter((h) => {
    const r = byId.get(h.ruleId);
    if (!r || r.kind !== "state" || !r.on) return false;
    if (h.endsAt !== undefined && typeof f.now === "number" && f.now >= h.endsAt) return false;
    if (h.kind === "next") {
      // Only the whole condition's flip ends the hold; undecided is not a change.
      const now = verdictOf(r.while, f);
      return now === null || now === holdVerdict(h, r);
    }
    if (h.kind === "until") return !evalCond(h.until, f);
    return true;
  });
}

/** Resume on the chip: the holds of that rule end at once — only `target`'s when it is given
 *  (a `holdEach` rule, whose targets hold one by one). */
export const resume = (holds: readonly Hold[], ruleId: string, target?: string): Hold[] =>
  holds.filter((h) => h.ruleId !== ruleId || (target !== undefined && h.target !== target));

/** The app starts again: `session` holds are gone. A `next` hold stays and is checked against
 *  the new facts at the first resolve (his call, 2026-09-26: a look pick survives a restart
 *  until the next day / night change, as `deets.look.hold` did; since 2026-09-29 also until
 *  its `endsAt`, the time the chip showed). */
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
    if (r.kind !== "state" || !r.on || r.draft || !evalCond(r.while, f)) continue;
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
  goToTarget: "fits" | "search" | "library";
  shuffleIdle: "library" | "noop";
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

  // Menus › Go to opens (FUTURE-SETTINGS §20, RULEZ.md §10.1). "Where it fits" makes no rule: the
  // menu keeps its own split (the Library in place, every other card in Search).
  if (s.goToTarget !== "fits") {
    for (const kind of ["artist", "album"] as const)
      out.push({
        id: `row:goToTarget:${kind}`, kind: "moment", source: row("goToTarget"), on: true,
        when: `goto.${kind}`, card: "*", do: { openIn: s.goToTarget },
      });
  }

  // Playback › Idle shuffle plays (FUTURE-SETTINGS §5b): a shuffle press with no song loaded plays
  // the library shuffled. This rule is the one path; player.ts has no idle branch of its own.
  if (s.shuffleIdle === "library") {
    out.push({
      id: "row:shuffleIdle", kind: "moment", source: row("shuffleIdle"), on: true,
      when: "shuffle.press", card: "*", if: { fact: "loaded", is: false }, do: { shuffleLibrary: true },
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
    for (const t of [c.lt, c.gt, c.gte, c.lte]) if (typeof t === "number" && t > now && (best === null || t < best)) best = t;
  };
  for (const r of rules) if (r.on) visit(r.kind === "state" ? r.while : r.if);
  return best;
}

// ── time (RULES.md §20.3) ────────────────────────────────────────

export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** The `time` fact (the minute of the day, 0–1439) and the `day` fact, in local time. */
export function timeFacts(d: Date): { time: number; day: string } {
  return { time: d.getHours() * 60 + d.getMinutes(), day: DAYS[d.getDay()] };
}

/** When the next clock rule fires (epoch ms), or null. A minute that passed today is tomorrow's. */
export function nextClock(rules: readonly Rule[], now: Date): { at: number; minute: number } | null {
  let best: { at: number; minute: number } | null = null;
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (const r of rules) {
    if (r.kind !== "moment" || !r.on || r.draft || r.when !== "clock" || typeof r.at !== "number") continue;
    const day = r.at > nowMin ? 0 : 1;
    // A day is not always 24 h (a clock change), so build the date, not the sum.
    const at = new Date(midnight + day * 86_400_000 + 3_600_000 * 12);
    at.setHours(Math.floor(r.at / 60), r.at % 60, 0, 0);
    if (!best || at.getTime() < best.at) best = { at: at.getTime(), minute: r.at };
  }
  return best;
}

/** A rule reads this fact (the engine runs the minute timer only while a rule reads the time). */
export function readsFact(rules: readonly Rule[], ids: readonly FactId[]): boolean {
  return rules.some((r) => r.on && !r.draft && [...factsOf(r.kind === "state" ? r.while : r.if)].some((f) => ids.includes(f)));
}

// ── the cascade guards (RULES.md §20.5) ──────────────────────────

/** A rule that fires this many times inside the window turns off for the session. */
export const FIRE_CAP = 5;
export const FIRE_WINDOW_MS = 10_000;
/** A chain stops after this many rules in a row. */
export const CHAIN_CAP = 8;
/** An event this soon after a rule's action counts as caused by it (a skip's next song is async). */
export const CAUSE_MS = 3_000;
/** All rules together make at most APPLE_CAP Apple actions in APPLE_WINDOW_MS (his call,
 *  2026-09-27: a number of calls per 30 s, RULEZ.md §4). */
export const APPLE_CAP = 3;
export const APPLE_WINDOW_MS = 30_000;

/** Note one fire. `times` = the last fire times (at most FIRE_CAP kept); `trip` = the cap is reached. */
export function noteFire(times: readonly number[], now: number): { times: number[]; trip: boolean } {
  const kept = [...times, now].filter((t) => now - t < FIRE_WINDOW_MS).slice(-FIRE_CAP);
  return { times: kept, trip: kept.length >= FIRE_CAP };
}

/** How deep a chain an event starts: 0 for a hand event; one more than the last action's for a
 *  rule-caused one. */
export function chainDepth(last: { at: number; depth: number } | null, acting: boolean, now: number): { caused: boolean; depth: number } {
  const caused = acting || (!!last && now - last.at < CAUSE_MS);
  return { caused, depth: caused && last ? last.depth + 1 : 0 };
}

/** May an Apple action run now? `recent` = when the rules' Apple actions ran (any rule). */
export function appleMayRun(o: { caused: boolean; recent: readonly number[]; now: number; backingOff: boolean }): string | null {
  if (o.caused) return "caused by a rule";
  if (o.backingOff) return "Apple asked us to wait";
  if (o.recent.filter((t) => o.now - t < APPLE_WINDOW_MS).length >= APPLE_CAP) return `${APPLE_CAP} Apple calls in 30 s already`;
  return null;
}

// ── snapshots (RULEZ.md §9, his call 2026-09-27): each condition with its result ──

/** Every leaf of a condition, in order, with whether it holds for `f` (a snapshot's ✓ / ✗). */
export function leafResults(c: Cond | undefined, f: Facts): { leaf: Leaf; holds: boolean }[] {
  if (!c) return [];
  if ("all" in c) return c.all.flatMap((m) => leafResults(m, f));
  if ("any" in c) return c.any.flatMap((m) => leafResults(m, f));
  if ("not" in c) return leafResults(c.not, f);
  return [{ leaf: c, holds: evalCond(c, f) }];
}

// ── Try (RULEZ.md §3, route 1): why a rule would not run now ─────

/** The first leaf that keeps `c` from holding with `f`, or null when it holds. For an "or"
 *  group that fails, its first member's reason. */
export function failingLeaf(c: Cond | undefined, f: Facts): Leaf | null {
  if (!c || evalCond(c, f)) return null;
  if ("all" in c) {
    for (const m of c.all) {
      const l = failingLeaf(m, f);
      if (l) return l;
    }
    return null;
  }
  if ("any" in c) return c.any.length ? failingLeaf(c.any[0], f) : null;
  if ("not" in c) return "fact" in c.not ? c.not : null;
  return c;
}
