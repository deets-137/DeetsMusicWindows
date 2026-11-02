// The progress ticks the play log reads (stats.ts), as pure rules so a test holds them.
//
// A stale tick (2026-11-01, LISTEN-LATER.md §8): on Next, MusicKit can send one more progress
// tick after `nowPlayingItem` already names the new song, still carrying the OLD song's position.
// At 95 % of song A it credited song B a full play 3 ms after B started, so a skip 2 s later
// took B off the Later list and counted it in Rewind as heard. A real tick in a play's first
// moments sits near the start; a scrub comes later, by hand.

/** How long after a play starts a far-along tick is treated as the last song's. */
export const STALE_MS = 1000;
/** A tick this far into a song (seconds) is "far along" in a play's first moments. */
export const STALE_SEC = 5;

/** Is this tick the previous song's, arriving after the new play began? */
export function isStaleTick(msSinceStart: number, currentTime: number): boolean {
  return msSinceStart < STALE_MS && currentTime > STALE_SEC;
}
