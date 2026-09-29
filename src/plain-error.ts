// The words a warning toast shows for a failure (TOASTS.md). Some errors were written for a
// person ("That is not a friend code.", "Nothing found for “x”"); others are the system's
// own text ("Failed to fetch", "Access is denied. (os error 5)", "friends: no data dir yet").
// A toast shows the first kind as it is and puts a plain sentence in place of the second
// (2026-09-29: rooms, friends and the Compass web put the raw text on screen).

/** Marks of a message written by a system, not for a person. */
const SYSTEM = /os error|failed to fetch|networkerror|load failed|\berror\b|\w::\w|[a-z_]+:\s|\(|\)|\bat\s+\w+\s*\(/i;

/** The error's own words when they were written for a person, else `fallback`. */
export function plainError(e: unknown, fallback: string): string {
  const m = (e instanceof Error ? e.message : String(e ?? "")).trim();
  if (m && m.length <= 160 && /^[A-Z0-9“"‘']/.test(m) && !SYSTEM.test(m)) return m;
  return fallback;
}
