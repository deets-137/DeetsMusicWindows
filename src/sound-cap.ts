// The cap until measured (SOUND.md § 11a-2): a slow gain on a song that has no measurement yet.
// Pure: no DOM, no player. sound-loudness.ts feeds it the 100 ms hops, with MusicKit's volume
// divided out and before the match gain, so the cap never disturbs the song's measurement.
//
// A cut goes at any time, at the attack rate, and lifts at the release rate. A raise waits for
// `settleAtS` of heard audio, because an early reading runs quiet. From then on the gain follows
// the song's running loudness, slowly, and never past it.

import { integratedLufs } from "./sound-dsp";

/** The hop the meter sends. */
const HOP_S = 0.1;
/** A hop at or under this is left out, as `integratedLufs` does. A pause sends none. */
const GATE_LUFS = -70;
/** A block needs four hops (400 ms). */
const BLOCK_HOPS = 4;
/** The running loudness is read again this often: it moves slowly, and the read scans the song. */
const ESTIMATE_EVERY_HOPS = 10;

/** Starting points for his ear test, not decisions (SOUND.md § 11a-2). */
export interface CapValues {
  /** The short-term window, in seconds (BS.1770 short-term). */
  windowS: number;
  /** The level the cap holds a passage to, in dB over the target. */
  level: number;
  attackDbS: number;
  releaseDbS: number;
  /** Heard seconds before the gain may rise. */
  settleAtS: number;
  /** The loudness a song is guessed at before the library has rows (his median is −9.1). */
  startLufs: number;
  /** The most an album's gain moves between two songs. */
  albumStepDb: number;
}

export const CAP_DEFAULTS: Readonly<CapValues> = {
  windowS: 3,
  level: 2,
  attackDbS: 3,
  releaseDbS: 1,
  settleAtS: 20,
  startLufs: -9,
  albumStepDb: 1.5,
};

export interface Cap {
  gainDb: number;
  startDb: number;
  /** The lowest gain this listen reached, for the log. */
  deepestDb: number;
  heardS: number;
  /** The song's running loudness, once there is one. */
  estimateLufs: number | null;
  window: number[];
  ring: number[];
  blocks: number[];
  hops: number;
}

/** What the rule needs from the app at each hop. */
export interface CapRoom {
  target: number;
  minDb: number;
  /** The highest gain allowed: the app's limit, or the room over the song's peak so far. */
  maxDb: number;
}

export const newCap = (startDb: number): Cap => ({
  gainDb: startDb,
  startDb,
  deepestDb: startDb,
  heardS: 0,
  estimateLufs: null,
  window: [],
  ring: [],
  blocks: [],
  hops: 0,
});

const toLufs = (ms: number): number => -0.691 + 10 * Math.log10(ms);

/** One hop's mean square in, the cap's gain in dB out. A hop that is left out holds the gain. */
export function capHop(c: Cap, ms: number, room: CapRoom, v: CapValues): number {
  if (!(ms > 0) || toLufs(ms) <= GATE_LUFS) return c.gainDb;
  c.heardS += HOP_S;
  c.hops++;

  c.window.push(ms);
  const size = Math.max(1, Math.round(v.windowS / HOP_S));
  while (c.window.length > size) c.window.shift();

  c.ring.push(ms);
  if (c.ring.length > BLOCK_HOPS) c.ring.shift();
  if (c.ring.length === BLOCK_HOPS) c.blocks.push(c.ring.reduce((s, x) => s + x, 0) / BLOCK_HOPS);

  const settled = c.heardS >= v.settleAtS;
  if (settled && (c.estimateLufs === null || c.hops % ESTIMATE_EVERY_HOPS === 0)) c.estimateLufs = integratedLufs(c.blocks);

  const shortLufs = toLufs(c.window.reduce((s, x) => s + x, 0) / c.window.length);
  const top = settled && c.estimateLufs !== null ? room.target - c.estimateLufs : c.startDb;
  const want = Math.max(room.minDb, Math.min(room.target + v.level - shortLufs, top, room.maxDb));

  if (want < c.gainDb) c.gainDb = Math.max(want, c.gainDb - v.attackDbS * HOP_S);
  else if (want > c.gainDb) c.gainDb = Math.min(want, c.gainDb + v.releaseDbS * HOP_S);
  c.deepestDb = Math.min(c.deepestDb, c.gainDb);
  return c.gainDb;
}

/** This play is one album in order: the Library's album, or Apple's whole album from Search. */
export const isAlbumPlay = (context: string | undefined, key: string): boolean =>
  context === `album:${key}` || /^search-albums:.+/.test(context ?? "");

/** An album's gain at a song start: toward `wantDb`, by at most `stepDb`. */
export const albumStep = (prevDb: number, wantDb: number, stepDb: number): number =>
  prevDb + Math.max(-stepDb, Math.min(stepDb, wantDb - prevDb));
