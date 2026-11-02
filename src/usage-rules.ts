// The pure rules of the usage reports (USAGE-COUNTS.md §3, §12): when each report is due, the
// day count's week and month flags, the version each count sits under and what an applied
// update moves, the open-time clocks, the report keys, and how a setting's value is sent.
// usage.ts holds the DOM, the store and the calls; this holds the rules, so
// tests/usage-rules.test.ts can check them.

const pad = (n: number) => String(n).padStart(2, "0");

/** The UTC day, "2026-10-13". */
export function utcDay(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The UTC month, "2026-10". */
export function utcMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** The ISO week, "2026-W42": weeks start on Monday, and the week's Thursday names its year.
 *  The worker (DeetsSupport src/usage.js) computes the same string. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${pad(w)}`;
}

/** The UTC day's bounds, ms: [its 00:00, the next day's 00:00). */
export function utcDayBounds(day: string): [number, number] {
  const lo = Date.parse(`${day}T00:00:00Z`);
  return [lo, lo + 86_400_000];
}

/** A day has 1,440 minutes: a sum over it can never be more (a play that runs past midnight
 *  counts to the day it started on, so the cap holds the edge). */
export const DAY_MINUTES = 1440;

/** The day the day count's minutes describe (§17, his call 2026-11-01): the last day that sent a
 *  day count, now over. null: nothing sent before, or the last count was today. */
export function listenDay(state: UsageState, now: Date): string | null {
  return state.day && state.day !== utcDay(now) ? state.day : null;
}

/** The whole minutes listened on one UTC day: every play that started on it (Rewind's rule,
 *  rewind.ts `listenedToday`), capped at the day's length. */
export function listenMinutes(events: readonly { startedTs: number; msListened: number | null }[], day: string): number {
  const [lo, hi] = utcDayBounds(day);
  const ms = events.reduce((sum, e) => (e.startedTs >= lo && e.startedTs < hi ? sum + (e.msListened ?? 0) : sum), 0);
  return Math.min(DAY_MINUTES, Math.round(ms / 60_000));
}

/** Feature use counts (§18, his call 2026-11-01): how many times each use (usage-keys.ts
 *  `USE_COUNTS`) happened on each UTC day, `{ day: { name: n } }`. Kept on the PC; the day count
 *  carries one finished day's, as it carries that day's minutes. */
export type UseStore = Record<string, Record<string, number>>;
/** A day's counts are kept this many days at most: an install that never sends drops them. */
export const USE_KEEP_DAYS = 30;

/** One more use of `name` on `day`. Days older than `USE_KEEP_DAYS` before it go. */
export function addUse(store: UseStore, day: string, name: string, n = 1): UseStore {
  const cut = utcDay(new Date(utcDayBounds(day)[0] - USE_KEEP_DAYS * 86_400_000));
  const out: UseStore = {};
  for (const [d, counts] of Object.entries(store)) if (d >= cut) out[d] = counts;
  const today = { ...out[day] };
  today[name] = (today[name] ?? 0) + n;
  out[day] = today;
  return out;
}

/** The counts of one day: `{}` when nothing was used. */
export const usesOn = (store: UseStore, day: string): Record<string, number> => ({ ...store[day] });

/** After the day count that carried `day`: that day and every earlier one are done. */
export function afterUses(store: UseStore, day: string): UseStore {
  const out: UseStore = {};
  for (const [d, counts] of Object.entries(store)) if (d > day) out[d] = counts;
  return out;
}

/** Feature reach (§21, his call 2026-11-02): which uses this install already reported in the
 *  ISO week and the month of its last sent uses. Kept on the PC, never sent. */
export interface ReachStore { week?: string; month?: string; weekNames?: string[]; monthNames?: string[] }
/** What the day count adds beside a day's uses: the names that are the first of their kind in
 *  that day's week and month, and whether these are the install's first uses sent in each. */
export interface Reach { firstWeek: string[]; firstMonth: string[]; reportWeek: boolean; reportMonth: boolean }

const periodsOf = (day: string): { week: string; month: string } => {
  const d = new Date(utcDayBounds(day)[0]);
  return { week: isoWeek(d), month: utcMonth(d) };
};

/** The reach of `day`'s uses `names`. */
export function reachOf(store: ReachStore, day: string, names: readonly string[]): Reach {
  const { week, month } = periodsOf(day);
  const seenW = store.week === week ? store.weekNames ?? [] : [];
  const seenM = store.month === month ? store.monthNames ?? [] : [];
  return {
    firstWeek: names.filter((n) => !seenW.includes(n)),
    firstMonth: names.filter((n) => !seenM.includes(n)),
    reportWeek: store.week !== week,
    reportMonth: store.month !== month,
  };
}

/** After the day count that carried `day`'s uses `names` reached the worker. */
export function afterReach(store: ReachStore, day: string, names: readonly string[]): ReachStore {
  const { week, month } = periodsOf(day);
  const join = (seen: string[] | undefined, same: boolean) => [...new Set([...(same ? seen ?? [] : []), ...names])];
  return {
    week,
    month,
    weekNames: join(store.weekNames, store.week === week),
    monthNames: join(store.monthNames, store.month === month),
  };
}

/** The open-time clock of one report (§12.9 A1): `id` names the report it waits for (a day, a
 *  week, an update), `at` the random moment drawn for it, `ms` the time the app has been open
 *  since. It is kept across launches, so a short session adds to it instead of starting again. */
export interface OpenClock { id: string; at: number; ms: number }

/** What this install last sent, kept in its own storage and never sent (§3.1). */
export interface UsageState {
  /** The UTC day, ISO week and month of the last day count that reached the worker. */
  day?: string;
  week?: string;
  month?: string;
  /** The version each of those three counts sits under on the worker (§12.2): the day count
   *  files day, week and month under the version that sent it, and an applied update moves
   *  them. Three, because a count of the week can sit under an older version than today's. */
  vDay?: string;
  vWeek?: string;
  vMonth?: string;
  /** The version this install last reported running: by a day count or an applied update. */
  runV?: string;
  /** The ISO week of the last settings report and of the last health report. */
  settingsWeek?: string;
  healthWeek?: string;
  /** An update on disk, waiting for its report (§12.2), and the last version reported so. */
  dl?: { to: string; rollback: boolean };
  downloaded?: string;
  /** One key per report, kept until the report lands, the same on its retry (§12.9 A4). */
  keys?: Partial<Record<UsageKind, { id: string; key: string }>>;
  /** Each kind's open-time clock (§12.9 A1). */
  open?: Partial<Record<UsageKind, OpenClock>>;
}

export type UsageKind = "day" | "settings" | "health" | "downloaded" | "applied";

/** The day count due now, with its flags, or null when today's has gone (§3.1). The flags say
 *  "this is this install's first count of the week / month", so the worker counts weekly and
 *  monthly installs with no ID. `new`: the install has sent nothing ever (§12.7 call 1). */
export function dayCount(state: UsageState, now: Date): { week: boolean; month: boolean; new: boolean } | null {
  if (state.day === utcDay(now)) return null;
  return {
    week: state.week !== isoWeek(now),
    month: state.month !== utcMonth(now),
    new: state.day === undefined && state.settingsWeek === undefined && state.healthWeek === undefined,
  };
}

/** The state after a day count from version `v` reached the worker: the day sits under `v`,
 *  and the week and the month too when the count was their first. */
export function afterDay(state: UsageState, now: Date, v: string): UsageState {
  const flags = dayCount(state, now);
  return {
    ...state,
    day: utcDay(now), week: isoWeek(now), month: utcMonth(now),
    vDay: v,
    vWeek: flags?.week ? v : state.vWeek,
    vMonth: flags?.month ? v : state.vMonth,
    runV: state.runV ?? v,
  };
}

/** The counts of the current day, week and month that sit under a version other than `v`:
 *  what an applied update moves (§12.2). An install from before 1.2.0 has no record of the
 *  version, so its counts stay where they are. */
export function movesFor(state: UsageState, now: Date, v: string): Partial<Record<"day" | "week" | "month", string>> {
  const out: Partial<Record<"day" | "week" | "month", string>> = {};
  if (state.day === utcDay(now) && state.vDay && state.vDay !== v) out.day = state.vDay;
  if (state.week === isoWeek(now) && state.vWeek && state.vWeek !== v) out.week = state.vWeek;
  if (state.month === utcMonth(now) && state.vMonth && state.vMonth !== v) out.month = state.vMonth;
  return out;
}

/** The applied report due now on version `v`, or null: the first start on a version this
 *  install has not reported running. `rollback` when it is older. */
export function appliedReport(
  state: UsageState, now: Date, v: string, compare: (a: string, b: string) => number,
): { event: "applied"; from: string; moves: ReturnType<typeof movesFor>; rollback: boolean } | null {
  if (!state.runV || state.runV === v) return null;
  return { event: "applied", from: state.runV, moves: movesFor(state, now, v), rollback: compare(v, state.runV) < 0 };
}

/** The state after the applied report of `v` reached the worker: the moved counts sit under `v`. */
export function afterApplied(state: UsageState, now: Date, v: string): UsageState {
  const moved = movesFor(state, now, v);
  return {
    ...state,
    runV: v,
    vDay: moved.day ? v : state.vDay,
    vWeek: moved.week ? v : state.vWeek,
    vMonth: moved.month ? v : state.vMonth,
  };
}

/** An update reached `ready` (updater.ts): the state that holds its report, once per version. */
export function onDownloaded(state: UsageState, to: string, rollback: boolean): UsageState {
  if (state.downloaded === to || state.dl?.to === to) return state;
  return { ...state, dl: { to, rollback } };
}

/** What a report waits for: the day, the week, the update. A new id starts a new clock and a
 *  new key; the same id keeps both (a retry). null: nothing of this kind is due. */
export function reportId(state: UsageState, kind: UsageKind, now: Date, v: string, pendingWeek?: string | null): string | null {
  switch (kind) {
    case "day": return dayCount(state, now) ? utcDay(now) : null;
    case "settings": return weeklyDue(state, "settings", now) ? isoWeek(now) : null;
    case "health": return pendingWeek && weeklyDue(state, "health", now) ? pendingWeek : null;
    case "downloaded": return state.dl ? `${state.dl.to}` : null;
    case "applied": return state.runV && state.runV !== v ? `${state.runV}>${v}` : null;
  }
}

/** The clock for report `id`: the same one while the id holds, else a new one with a fresh
 *  random moment between `minMs` and `maxMs` of open time. */
export function clockFor(prev: OpenClock | undefined, id: string, rand: () => number, minMs: number, maxMs: number): OpenClock {
  return prev && prev.id === id ? prev : { id, at: randomDelay(rand, maxMs, minMs), ms: 0 };
}

/** Add open time to a clock. One step adds at most `capMs`, so a PC that slept between two
 *  ticks does not count its sleep as open time. */
export function tickClock(c: OpenClock, elapsedMs: number, capMs: number): OpenClock {
  return { ...c, ms: c.ms + Math.max(0, Math.min(elapsedMs, capMs)) };
}

/** The key of report `id`: the one already made for it (a retry), else a new one. */
export function keyFor(prev: { id: string; key: string } | undefined, id: string, make: () => string): { id: string; key: string } {
  return prev && prev.id === id ? prev : { id, key: make() };
}

/** Is the weekly report of this kind still due this ISO week? */
export function weeklyDue(state: UsageState, kind: "settings" | "health", now: Date): boolean {
  return (kind === "settings" ? state.settingsWeek : state.healthWeek) !== isoWeek(now);
}

/** How one setting is sent (§3.2): a toggle as "on" / "off"; a choice as the option's value;
 *  an EQ preset the user made and named ("u:…") as "user"; anything else as "other", never
 *  the value itself (a value a bug or an agent wrote). */
export function settingValue(kind: "toggle" | "choice", options: readonly string[], raw: string): string {
  if (kind === "toggle") return raw === "on" || raw === "off" ? raw : "other";
  if (raw.startsWith("u:")) return "user";
  return options.includes(raw) && /^[A-Za-z0-9._:+-]{1,32}$/.test(raw) ? raw : "other";
}

/** The places a setting can be changed from (settings-store.ts `SettingSource`), as the
 *  settings report may name them (§22). Kept here, not imported: this file stays pure. */
export const CHANGE_SOURCES: readonly string[] = [
  "onboarding", "walk", "settings", "quick", "compass", "panel", "update", "agent", "rule", "app", "before",
];

/** Where one reported setting was last changed, and in which release line (§22, his call
 *  2026-11-02: to find the settings worth posing again). `<key>.src`: the source, `default` when
 *  the change log has no record (never changed since 1.3.0, the first version with the log), or
 *  `other` for a name the list does not know. `<key>.v`: the line ("1.3") of that change, only
 *  when the record has a version (`before` has none). Never the time, never the exact version. */
export function changeFields(key: string, change: { source: string; version: string } | null): Record<string, string> {
  if (!change) return { [`${key}.src`]: "default" };
  const out: Record<string, string> = { [`${key}.src`]: CHANGE_SOURCES.includes(change.source) ? change.source : "other" };
  const line = /^(\d{1,3})\.(\d{1,3})\./.exec(change.version);
  if (line) out[`${key}.v`] = `${line[1]}.${line[2]}`;
  return out;
}

/** A random moment, in ms from now, inside the next `windowMs`, never closer than `minMs`
 *  (§3.4: each report at its own random moment). `rand` is Math.random, passed in for tests. */
export function randomDelay(rand: () => number, windowMs: number, minMs = 0): number {
  return Math.round(minMs + rand() * Math.max(0, windowMs - minMs));
}

/** Has `ms` passed since `since` (ms on one clock)? Never anything yet: yes. Two uses: no two
 *  reports in the same minute (§3.4), and a failed report waits an hour, or the next launch,
 *  before it is tried again; it is tried until its period ends (§12.9 A5). */
export function waited(since: number | undefined, now: number, ms: number): boolean {
  return since === undefined || now - since >= ms;
}
