// The page sample's inputs that other modules feed (DEBUGGING.md § The page sample, his calls
// 2026-10-17). No imports, so the modules that call it (settings-store.ts, stats.ts) still load
// in the unit tests and in the tray panel. It holds names and counts only; the sample itself
// (page-sample.ts) is dev telemetry and reads it.

/** A listener set (or map) the sample reports by size: a set that only grows is a leak. */
const sets = new Map<string, { readonly size: number }>();
/** Register a module's listener set under a name. Cheap: one map entry, at module load. */
export function watchSet(name: string, set: { readonly size: number }): void {
  sets.set(name, set);
}
export const watchedSets = (): ReadonlyMap<string, { readonly size: number }> => sets;

let songs = 0;
let msPlayed = 0;
let onSong: (() => void) | null = null;

/** stats.ts: a listen started. The sample is taken here (his call: one per song start). */
export function songStarted(): void {
  songs++;
  onSong?.();
}
/** stats.ts: a listen ended, with the time it played. */
export function songListened(ms: number): void {
  if (ms > 0) msPlayed += ms;
}
export const songCounts = (): { songs: number; minPlayed: number } => ({ songs, minPlayed: Math.round(msPlayed / 6000) / 10 });

/** page-sample.ts sets the song-start hook; nothing else does. */
export function setSongHook(fn: () => void): void {
  onSong = fn;
}
