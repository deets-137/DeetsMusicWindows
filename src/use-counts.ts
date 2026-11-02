// Feature use counts (docs/features/USAGE-COUNTS.md §18): a feature calls `countUse` when it is
// used, and the count waits here, per UTC day, until the day count carries that finished day
// (usage.ts). Only the names on usage-keys.ts `USE_COUNTS`, only numbers, and nothing while
// *Send usage counts* is off (§2 rule 9: off keeps nothing to send later either).
// Feature reach (§21): which names this install already reported this ISO week and month, so the
// day count can say which uses are the first of their kind in each.

import { setting } from "./settings-store";
import { addUse, afterUses, usesOn, utcDay, reachOf, afterReach, type UseStore, type ReachStore, type Reach } from "./usage-rules";
import type { UseName } from "./usage-keys";

const KEY = "deets-usage-uses";
const REACH_KEY = "deets-usage-reach";

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, s: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(s));
  } catch {
    // Storage blocked: this use is not counted. WebView2 does not block it.
  }
}
const uses = (): UseStore => read<UseStore>(KEY) ?? {};
const reach = (): ReachStore => read<ReachStore>(REACH_KEY) ?? {};

/** One use of `name` today (UTC). */
export function countUse(name: UseName, n = 1): void {
  if (!setting("usageReports") || n <= 0) return;
  write(KEY, addUse(uses(), utcDay(new Date()), name, n));
}

/** The counts of one finished day, for the day count. */
export const usesFor = (day: string): Record<string, number> => usesOn(uses(), day);

/** The reach of that day's uses, for the day count (§21). */
export const reachFor = (day: string, names: readonly string[]): Reach => reachOf(reach(), day, names);

/** The day count that carried `day` reached the worker: that day and every earlier one go, and
 *  its names count as reported for that day's week and month. */
export function usesSent(day: string, names: readonly string[]): void {
  write(KEY, afterUses(uses(), day));
  write(REACH_KEY, afterReach(reach(), day, names));
}

/** *Send usage counts* went off: nothing waits to be sent, and reach starts again. */
export function clearUses(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(REACH_KEY);
  } catch {
    // Storage blocked: there was nothing kept.
  }
}
