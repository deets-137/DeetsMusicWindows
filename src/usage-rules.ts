// The pure rules of the usage reports (USAGE-COUNTS.md §3): when each report is due, the
// day count's week and month flags, how a setting's value is sent, and when in the day or
// week a report leaves. usage.ts holds the DOM, the store and the calls; this holds the rules,
// so tests/usage-rules.test.ts can check them.

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

/** What this install last sent, kept in its own storage and never sent (§3.1). */
export interface UsageState {
  /** The UTC day, ISO week and month of the last day count that reached the worker. */
  day?: string;
  week?: string;
  month?: string;
  /** The ISO week of the last settings report and of the last health report. */
  settingsWeek?: string;
  healthWeek?: string;
  /** A failed send is tried once more at the next launch, then dropped (§3.4). */
  tries?: Partial<Record<UsageKind, { period: string; n: number }>>;
}

export type UsageKind = "day" | "settings" | "health";

/** The day count due now, with its flags, or null when today's has gone (§3.1). The flags say
 *  "this is this install's first count of the week / month", so the worker counts weekly and
 *  monthly installs with no ID. */
export function dayCount(state: UsageState, now: Date): { week: boolean; month: boolean } | null {
  if (state.day === utcDay(now)) return null;
  return { week: state.week !== isoWeek(now), month: state.month !== utcMonth(now) };
}

/** The state after a day count reached the worker. */
export function afterDay(state: UsageState, now: Date): UsageState {
  return { ...state, day: utcDay(now), week: isoWeek(now), month: utcMonth(now) };
}

/** Is the weekly report of this kind still due this ISO week? */
export function weeklyDue(state: UsageState, kind: "settings" | "health", now: Date): boolean {
  return (kind === "settings" ? state.settingsWeek : state.healthWeek) !== isoWeek(now);
}

/** The period a report of this kind belongs to: the retry rule counts per period. */
export function periodOf(kind: UsageKind, now: Date): string {
  return kind === "day" ? utcDay(now) : isoWeek(now);
}

/** May this kind be tried now? A report is tried at most twice in its period: once, and once
 *  more at the next launch (§3.4). */
export function mayTry(state: UsageState, kind: UsageKind, now: Date): boolean {
  const t = state.tries?.[kind];
  return !t || t.period !== periodOf(kind, now) || t.n < 2;
}

/** The state after one try of this kind (sent or failed). */
export function afterTry(state: UsageState, kind: UsageKind, now: Date): UsageState {
  const period = periodOf(kind, now);
  const t = state.tries?.[kind];
  const n = t && t.period === period ? t.n + 1 : 1;
  return { ...state, tries: { ...state.tries, [kind]: { period, n } } };
}

/** How one setting is sent (§3.2): a toggle as "on" / "off"; a choice as the option's value;
 *  an EQ preset the user made and named ("u:…") as "user"; anything else as "other", never
 *  the value itself (a value a bug or an agent wrote). */
export function settingValue(kind: "toggle" | "choice", options: readonly string[], raw: string): string {
  if (kind === "toggle") return raw === "on" || raw === "off" ? raw : "other";
  if (raw.startsWith("u:")) return "user";
  return options.includes(raw) && /^[A-Za-z0-9._:+-]{1,32}$/.test(raw) ? raw : "other";
}

/** A random moment, in ms from now, inside the next `windowMs`, never closer than `minMs`
 *  (§3.4: each report at its own random moment). `rand` is Math.random, passed in for tests. */
export function randomDelay(rand: () => number, windowMs: number, minMs = 0): number {
  return Math.round(minMs + rand() * Math.max(0, windowMs - minMs));
}

/** Two reports never leave in the same minute (§3.4): push `delay` past every other planned
 *  moment by at least `gapMs`. */
export function apart(delay: number, others: readonly number[], gapMs = 60_000): number {
  let d = delay;
  for (let moved = true; moved; ) {
    moved = false;
    for (const o of others) {
      if (Math.abs(d - o) < gapMs) {
        d = o + gapMs;
        moved = true;
      }
    }
  }
  return d;
}
