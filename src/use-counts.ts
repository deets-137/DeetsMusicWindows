// Feature use counts (docs/features/USAGE-COUNTS.md §18): a feature calls `countUse` when it is
// used, and the count waits here, per UTC day, until the day count carries that finished day
// (usage.ts). Only the names on usage-keys.ts `USE_COUNTS`, only numbers, and nothing while
// *Send usage counts* is off (§2 rule 9: off keeps nothing to send later either).

import { setting } from "./settings-store";
import { addUse, afterUses, usesOn, utcDay, type UseStore } from "./usage-rules";
import type { UseName } from "./usage-keys";

const KEY = "deets-usage-uses";

function read(): UseStore {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as UseStore) : {};
  } catch {
    return {};
  }
}
function write(s: UseStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage blocked: this use is not counted. WebView2 does not block it.
  }
}

/** One use of `name` today (UTC). */
export function countUse(name: UseName, n = 1): void {
  if (!setting("usageReports") || n <= 0) return;
  write(addUse(read(), utcDay(new Date()), name, n));
}

/** The counts of one finished day, for the day count. */
export const usesFor = (day: string): Record<string, number> => usesOn(read(), day);

/** The day count that carried `day` reached the worker: that day and every earlier one go. */
export const usesSent = (day: string): void => write(afterUses(read(), day));

/** *Send usage counts* went off: nothing waits to be sent. */
export function clearUses(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: there was nothing kept.
  }
}
