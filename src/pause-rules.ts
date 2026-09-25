// The pause labels' pure rules (DEBUGGING.md §Why did it pause, fixes 1 and 3; 2026-09-25).
// player.ts holds the timers and MusicKit; these decide. Tested in tests/pause-rules.test.ts.

/** A pause this close to the song's end (seconds) is the song ending, not a stop. */
export const SONG_END_TAIL_S = 2;

/** Was the pause at the song's end? `at` and `duration` in seconds; an unknown duration is no. */
export function nearSongEnd(at: number, duration: number): boolean {
  return duration > 0 && duration - at <= SONG_END_TAIL_S;
}

/**
 * A pause with no note from our code is a song change when, within its wait, a stationFollow
 * or a queueEnd came (`evidence`), the song changed, or it came at the song's end.
 */
export function isSongEnd(p: { evidence: boolean; idBefore: string | null; idNow: string | null; nearEnd: boolean }): boolean {
  return p.evidence || p.idNow !== p.idBefore || p.nearEnd;
}

/** A song end stalls only when something should come next: a station, or songs still queued. */
export function stallCanHappen(mode: string, upcoming: number): boolean {
  return mode === "radio" || upcoming > 0;
}
