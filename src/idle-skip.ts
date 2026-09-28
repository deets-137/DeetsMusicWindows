// The pure half of a skip while MusicKit holds no song (player.ts `idleSkip`; QUEUE.md §Next
// and Previous before the first Play). A restored session, or a network drop that destroyed
// MusicKit's player, leaves the model with a song and MusicKit with none; Play loads it
// (playPause), but Next and Previous used to ask MusicKit to skip and so did nothing (found by
// the shots runner, 2026-09-28). His call, 2026-09-28: they move the model and stay paused, as
// Apple Music does. No MusicKit and no DOM here, so tests/idle-skip.test.ts pins the rules.

export type IdleSkip =
  | "advance" //   the next song becomes Now Playing, paused
  | "refill" //    repeat all at the end: start the lap again, then advance
  | "previous" //  the song before becomes Now Playing, paused
  | "restart" //   the song stays; its saved spot goes, so Play starts it from the top
  | "none"; //     nothing to move to

export interface IdleState {
  upcoming: number; //   songs in Up Next
  history: number; //    songs in the back-chain
  repeatAll: boolean;
  spotSec: number; //    where Play would start this song (an update restart or a drop), else 0
}

/** Next and Previous with MusicKit empty. Previous restarts the song past 3 s, the same
 *  line MusicKit's own Previous uses (player.ts prevTrack). */
export function idleSkip(way: "next" | "prev", s: IdleState): IdleSkip {
  if (way === "next") {
    if (s.upcoming > 0) return "advance";
    return s.repeatAll ? "refill" : "none";
  }
  if (s.spotSec > 3) return "restart";
  return s.history > 0 ? "previous" : "none";
}
