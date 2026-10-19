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

/**
 * A song change or a Play that must end in sound (2026-10-01): what one check does. Sound
 * since the arm, or a user pause since it, is fine. A song MusicKit still buffers gets
 * `maxLooks` more looks. Anything else is silent: reload it.
 */
export function silentStartStep(p: {
  playing: boolean;
  heard: boolean;
  userPaused: boolean;
  buffering: boolean;
  looks: number;
  maxLooks: number;
}): "fine" | "look" | "reload" {
  if (p.playing || p.heard || p.userPaused) return "fine";
  if (p.buffering && p.looks < p.maxLooks) return "look";
  return "reload";
}

// ── A song that stops loading in the middle (2026-10-03, QUEUE.md §Mid-song stall) ──
// On live, "Sepulveda" went from playing to MusicKit's `waiting` 30 s in, with no error, and
// stayed there: nothing logged it and nothing reloaded it.

/** How long a song may buffer in the middle before it is reloaded (his choice: 8 s). */
export const MID_STALL_MS = 8000;
/** The reload starts this many seconds before the stop, so the cut bar is heard again. */
export const STALL_BACK_S = 2;

/** Does a buffer arm the watch? Only one in the middle of a song that was playing: not a load,
 *  not the song's first second (a song change passes through `waiting`), not its last seconds. */
export function midStallArms(p: { wasPlaying: boolean; buffering: boolean; loading: boolean; at: number; duration: number }): boolean {
  return p.wasPlaying && p.buffering && !p.loading && p.at >= 1 && !nearSongEnd(p.at, p.duration);
}

/**
 * The watch's one check, MID_STALL_MS after the arm. Sound, a user pause, another song or a
 * pause from outside (no longer buffering) is fine. In a station or a room it only logs.
 */
export function midStallStep(p: {
  playing: boolean;
  userPaused: boolean;
  sameSong: boolean;
  buffering: boolean;
  canReload: boolean;
}): "fine" | "logOnly" | "reload" {
  if (p.playing || p.userPaused || !p.sameSong || !p.buffering) return "fine";
  return p.canReload ? "reload" : "logOnly";
}

/** A license heal starts this close to the stop (his pick, 2026-10-18): MusicKit's clock ticks
 *  about 4 times a second, so the last tick is at most ~0.25 s behind what was heard. */
export const LICENSE_BACK_S = 0.5;

/** Where a reload starts: `back` seconds before `at`, never below 0. Seconds. */
export function resumeSpot(at: number, back = STALL_BACK_S): number {
  return Math.max(0, at - back);
}

// ── A song that sticks at its end (2026-10-18, QUEUE.md §End stall) ─────────────────
// On live, "Flower In A Hurricane" reached 225 of 225 s and sat in `waiting` for 28 s, the
// song still "now playing", until a Next press. midStallArms skips a song's last seconds, the
// end-of-song heal needs `ended`, and the song-change check needs the song to change: none ran.

/** Does a buffer arm the end watch? A playing song buffering in its last seconds, outside a
 *  load, with a song queued after it (a queue end is maybeFinishQueue's). */
export function endStallArms(p: { wasPlaying: boolean; buffering: boolean; loading: boolean; at: number; duration: number; upcoming: number }): boolean {
  return p.wasPlaying && p.buffering && !p.loading && p.upcoming > 0 && p.duration > 0 && nearSongEnd(p.at, p.duration);
}

/**
 * The end watch's heal, END_STALL_HEAL_MS after the arm (his call, 2026-10-18). Not stuck any
 * more: nothing. A license or song lookup still out: wait (a reload waits for it too; the
 * license cut owns it). A user pause, a room, a station or a load or heal in flight: nothing.
 * Else: move to the next song and load it.
 */
export function endStallStep(p: { holds: boolean; requestOut: boolean; userPaused: boolean; canReload: boolean }): "fine" | "wait" | "leave" | "reload" {
  if (!p.holds) return "fine";
  if (p.requestOut) return "wait";
  if (p.userPaused || !p.canReload) return "leave";
  return "reload";
}

// ── A license failure (2026-10-18, QUEUE.md §License heal) ───────────────────────
// On live, 2026-10-18 12:40, MusicKit's MEDIA_LICENSE stopped a song about 2 min in. Apple's
// health check passed, and the only answer was the toast: the quiet retry covered MEDIA_KEY
// right after a load only. Seen 5 times between 2026-09-24 and 2026-10-18.

const MEDIA_KEY = /^MEDIA_KEY\b/;
const MEDIA_DRM = /^MEDIA_(?:KEY|LICENSE)\b/;

/** A license or key failure (MusicKit's MEDIA_LICENSE / MEDIA_KEY…). */
export function isLicenseError(msg: string): boolean {
  return MEDIA_DRM.test(msg);
}

/**
 * What a MusicKit error does to a queue song. `keyRetry`: a MEDIA_KEY just after our load (a
 * race in MusicKit's key setup), loaded again from the top. `heal`: any other license failure,
 * the first for this song: check Apple, then load it again at the spot. `none`: not a license
 * failure, not a queue song, a room, or this song was healed already (the old path, the toast).
 */
export function licenseStep(p: {
  msg: string;
  queueSong: boolean;
  room: boolean;
  justLoaded: boolean;
  keyRetried: boolean;
  healed: boolean;
}): "keyRetry" | "heal" | "none" {
  if (!p.queueSong || p.room || !MEDIA_DRM.test(p.msg)) return "none";
  if (MEDIA_KEY.test(p.msg) && p.justLoaded && !p.keyRetried) return "keyRetry";
  return p.healed ? "none" : "heal";
}
