// The Rewind card's time spans as pure rules (DEETS-REWIND.md §8; tests/rewind-window.test.ts).
// rewind.ts reads the log with them; this file has no imports, so the rules are testable.

export type RewindWindow = "day" | "week" | "month" | "ytd" | "year";

const DAY_MS = 86_400_000;

/** Window start in epoch-ms. Rolling for all but YTD (local Jan 1), per design. */
export function windowStart(w: RewindWindow, now = Date.now()): number {
  switch (w) {
    case "day": return now - DAY_MS;
    case "week": return now - 7 * DAY_MS;
    case "month": return now - 30 * DAY_MS;
    case "year": return now - 365 * DAY_MS;
    case "ytd": return new Date(new Date(now).getFullYear(), 0, 1).getTime();
  }
}

/** Is a Song of the Day pick (its local day, "YYYY-MM-DD") in the window? A pick is in when ANY
 *  part of its day is (his call K3, 2026-10-18). A pick has a day, not a time: it was read as
 *  noon of its day, so yesterday's pick left Past Day at midday (F5). The day's end is the next
 *  local midnight, so a daylight-saving day of 23 or 25 hours ends where it really ends. */
export function dayInWindow(day: string, w: RewindWindow, now = Date.now()): boolean {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return false;
  const dayEnd = new Date(y, m - 1, d + 1).getTime(); // the next local midnight
  return dayEnd > windowStart(w, now);
}

/** Local midnight of today: where the Rewind panel's "Today" starts (docs/features/listening-time.md). */
export function todayStart(now = Date.now()): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** The Rewind panel's Today number. `mins` (his call, 2026-10-19): always minutes, "134 mins".
 *  `hm` (Settings › Rewind › Today's time in): hours and minutes past the hour, "2 hrs 14 mins".
 *  Whole minutes, rounded down, so the number never shows a minute not yet listened. */
export function fmtToday(ms: number, unit: "mins" | "hm"): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  const mins = (n: number) => `${n} ${n === 1 ? "min" : "mins"}`;
  if (unit === "mins" || min < 60) return mins(min);
  const hr = Math.floor(min / 60);
  const rem = min % 60;
  const hrs = `${hr} ${hr === 1 ? "hr" : "hrs"}`;
  return rem ? `${hrs} ${mins(rem)}` : hrs;
}
