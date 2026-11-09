// The progress bar on the Discord card (docs/integrations/FRIENDS.md §8.9a). Pure, so it has a
// unit test (tests/presence-bar.test.ts). presence.ts holds the state and does the sending.
//
// A bar is two instants on the wall clock, and Discord draws it from them on its own, so a card
// that was sent right stays right until the song's position jumps. These rules say what to send
// and when the card on Discord no longer matches the song.

/** How far the card may sit from the song, in seconds, before a corrected card goes out. A
 *  short pause stays inside it, so it costs Discord no update. */
export const BAR_TOLERANCE_S = 3;

/** The bar as Discord takes it: `timestamps.start` and `.end`, epoch milliseconds. */
export interface Bar {
  start: number;
  end: number;
}

/** One progress report from the player, in seconds. */
export interface Tick {
  currentTime: number;
  duration: number;
}

/** Is this report about the song on now? A report with no length says nothing. With the song's
 *  own length unknown (`songS` is 0) there is nothing to compare, so it is taken as it is. */
export function tickFits(tick: Tick, songS: number, tolerance = BAR_TOLERANCE_S): boolean {
  if (tick.duration <= 0) return false;
  return songS <= 0 || Math.abs(tick.duration - songS) <= tolerance;
}

/** The bar for a card sent now. A report from the song before never sets the position or the
 *  length (the 2026-11-09 bug): the card then starts at 0:00 with the song's own length. Null
 *  when no length is known, because a card with no bar is better than a bar that lies. */
export function barFor(now: number, tick: Tick, songS: number): Bar | null {
  const fits = tickFits(tick, songS);
  const length = fits ? tick.duration : songS;
  if (length <= 0) return null;
  const start = Math.round(now - (fits ? Math.max(0, tick.currentTime) : 0) * 1000);
  return { start, end: Math.round(start + length * 1000) };
}

/** Does the card on Discord disagree with this report? True after a resume, a seek, a Repeat One
 *  loop or a restored position. A card sent with no bar disagrees as soon as a length is known. */
export function barIsWrong(sent: Bar | null, now: number, tick: Tick, songS: number, tolerance = BAR_TOLERANCE_S): boolean {
  if (!tickFits(tick, songS)) return false;
  if (!sent) return true;
  const shown = (now - sent.start) / 1000;
  const shownLength = (sent.end - sent.start) / 1000;
  return Math.abs(shown - tick.currentTime) > tolerance || Math.abs(shownLength - tick.duration) > tolerance;
}
