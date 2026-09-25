// Release dates in the UI: the Home New shelf's "Coming 09/25" and the album page's
// unreleased songs (SEARCH.md §Unreleased songs).

import type { Track } from "./library";

/** Apple dates a release YYYY-MM-DD with no zone. Read it as local midnight, so "today" is
 *  today here and not a day out either side. NaN when the date is not a full date. */
export function releaseAt(date: string | undefined): number {
  const [y, m, d] = (date ?? "").slice(0, 10).split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d).getTime() : NaN;
}

/** "Coming 09/23" — no year (his call, HOME.md §10): the Home window ahead is five days wide,
 *  and a pre-release album is seldom listed more than a few months ahead. */
export const comingMark = (d: Date): string =>
  `Coming ${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;

/** The coming date of an unreleased song, or null when Apple gave none or it has passed
 *  (a song past its date that still does not play is "not on Apple Music yet"). */
function comingOf(t: Track): Date | null {
  const at = releaseAt(t.releaseDate);
  return at > Date.now() ? new Date(at) : null;
}

/** The hover hint on a dimmed row. */
export function unreleasedHint(t: Track): string {
  const d = comingOf(t);
  return d ? `Not out yet — ${comingMark(d).toLowerCase()}` : "Not on Apple Music yet";
}

/** The toast text when a dimmed row is clicked, or when nothing in a list is out yet. */
export function unreleasedToast(t: Track | undefined, many = false): string {
  const d = t && comingOf(t);
  const when = d ? ` ${comingMark(d)}.` : "";
  if (many || !t) return d ? `These songs are not out yet.${when}` : "These songs are not on Apple Music yet.";
  return d ? `“${t.title}” is not out yet.${when}` : `“${t.title}” is not on Apple Music yet.`;
}
