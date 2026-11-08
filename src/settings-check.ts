// The stored settings, checked against what each key may hold (HANDOFF › Code review leftovers;
// SETTINGS.md §2). The store is JSON in localStorage: a hand edit, an older or newer build, or a
// Backup restore can leave a value the code does not know ("sometimes" for a key that holds
// "always" | "player" | "off", a string where a number goes). Such a value fell through every
// read as a value no branch handles. Now it is dropped at load, so that key reads its default,
// and every other key keeps its value: one bad value resets that key, never the store.
//
// Pure (type imports only), so `tests/settings-check.test.ts` runs it on Node.

import type { Settings } from "./settings-store";
import { RETIRED_SKINS, RETIRED_THEMES, type SkinName, type ThemeName } from "./look-ids";

/** A key whose type is a closed list of strings or numbers (a choice row). */
type Literal<T> = T extends string ? (string extends T ? never : T) : T extends number ? (number extends T ? never : T) : never;
export type ChoiceKey = { [K in keyof Settings]-?: [Literal<Settings[K]>] extends [never] ? never : K }[keyof Settings];

/** Each choice key's values. A `Record` over the key's own type: tsc fails when a value is
 *  added to or taken from a choice in `Settings` and not here, and when a key is missing. */
type Choices = { [K in ChoiceKey]: Record<Settings[K] & PropertyKey, 1> };

const THEMES: Record<ThemeName, 1> = { lilac: 1, green: 1, sepia: 1, moonlight: 1, "black-yellow": 1, "black-red": 1 };
const SKINS: Record<SkinName, 1> = { vanilla: 1, press: 1, ocean: 1, glass: 1, cyber: 1, metal: 1, happy: 1 };
const PLAY_VERB = { open: 1, play: 1, shuffle: 1 } as const;
const SIDE = { left: 1, right: 1 } as const;

export const CHOICES: Choices = {
  alwaysOnTop: { always: 1, player: 1, off: 1 },
  pinView: { cover: 1, player: 1, mini: 1, window: 1 },
  trayView: { cards: 1, player: 1 },
  menuMode: { click: 1, hover: 1 },
  maxShortWindow: { flip: 1, floor: 1 },
  maxCards: { "4": 1, "2cols": 1, "2rows": 1, "1": 1 },
  maxStageSide: SIDE,
  fpQueueSide: SIDE,
  npShade: { text: 1, band: 1 },
  cardGrowPick: { keep: 1, collapse: 1 },
  cardDrill: { inplace: 1, summon: 1 },
  cardGrowView: { keep: 1, size: 1 },
  drillGrow: { vertical: 1, full: 1, off: 1 },
  backgroundMotion: { on: 1, reduced: 1, off: 1 },
  graphicsFallback: { save: 1, tell: 1, off: 1 },
  oceanEdges: { sand: 1, soft: 1 },
  glassCanvas: { aurora: 1, covers: 1, picture: 1 },
  glassTiles: { one: 1, few: 1, some: 1, many: 1 },
  glassAuroraColor: { cover: 1, theme: 1 },
  pressVinyl: { spin: 1, still: 1, off: 1 },
  pressVinylWhere: { stage: 1, card: 1, everywhere: 1 },
  pressVinylSpeed: { "16": 1, "33": 1, "45": 1, "78": 1 },
  pressVinylFps: { "60": 1, "120": 1, "144": 1, "240": 1 },
  metalMaterial: { steel: 1, acrylic: 1 },
  metalGrain: { faint: 1, fine: 1, medium: 1, strong: 1 },
  metalCoverChange: { zoetrope: 1, off: 1 },
  happySky: { follow: 1, day: 1, sunrise: 1, sunset: 1, night: 1 },
  hoverHintDelay: { quick: 1, normal: 1, slow: 1 },
  hoverSongNames: { always: 1, cut: 1, off: 1 },
  toasts: { failures: 1, all: 1 },
  theme: THEMES,
  skin: SKINS,
  lookSchedule: { off: 1, sun: 1, clock: 1, windows: 1 },
  dayTheme: THEMES,
  daySkin: SKINS,
  nightTheme: THEMES,
  nightSkin: SKINS,
  lookHold: { next: 1, always: 1 },
  sleepSchedule: { off: 1, sun: 1, clock: 1 },
  soundEqMode: { parametric: 1, graphic: 1 },
  soundEqPreamp: { limiter: 1, needed: 1, always: 1, manual: 1 },
  soundLowVol: { off: 1, gentle: 1, full: 1 },
  soundLowVolKey: { both: 1, app: 1 },
  soundCrossfeed: { auto: 1, always: 1, off: 1 },
  soundCrossfeedLevel: { light: 1, medium: 1, strong: 1 },
  homeHideLasts: { forever: 1, session: 1 },
  streamQuality: { auto: 1, high: 1, low: 1 },
  playNowScope: { song: 1, list: 1 },
  listenCount: { largest: 1, exact: 1 },
  notesSource: { both: 1, apple: 1, lastfm: 1, none: 1 },
  dropPlayQueue: { keep: 1, replace: 1 },
  previousReach: { lookback: 1, heard: 1 },
  restoreQueue: { song: 1, queue: 1, off: 1 },
  shuffleManual: { top: 1, hold: 1, mix: 1 },
  shuffleIdle: { library: 1, noop: 1 },
  goToTarget: { fits: 1, search: 1, library: 1 },
  shuffleOff: { order: 1, keep: 1 },
  repeatMode: { off: 1, all: 1, one: 1 },
  fullPlayRule: { fraction: 1, end: 1, scrobble: 1 },
  replayDay: { mon: 1, tue: 1, wed: 1, thu: 1, fri: 1, sat: 1, sun: 1 },
  rewindToday: { mins: 1, hm: 1 },
  playlistCreateSummon: { on: 1, off: 1 },
  laterRemove: { off: 1, here: 1, anywhere: 1 },
  playlistGetNew: { missing: 1, since: 1 },
  nowPlayingCover: { album: 1, playlist: 1 },
  newPlaylistCover: { letters: 1, mosaic: 1, note: 1 },
  pinNewAct: PLAY_VERB,
  pinNewDouble: PLAY_VERB,
  tileClick: PLAY_VERB,
  tileDouble: PLAY_VERB,
  collectionClick: PLAY_VERB,
  collectionDouble: PLAY_VERB,
  webReach: { 1: 1, 2: 1, 3: 1 },
  webSize: { 25: 1, 50: 1, 100: 1 },
  webPrefer: { familiar: 1, discover: 1, mix: 1 },
  webSeedFilter: { all: 1, floor: 1, off: 1 },
  webMakeMotion: { shrink: 1, pop: 1 },
  webTempDays: { 1: 1, 3: 1, 5: 1, 7: 1, 30: 1 },
  webPlayMode: { replace: 1, keep: 1, after: 1 },
  diaryRescale: { ask: 1, always: 1, never: 1 },
  diaryGrow: { new: 1, every: 1, never: 1 },
  agentSettings: { allow: 1, ask: 1, off: 1 },
  updateMode: { auto: 1, ask: 1, off: 1 },
  afterUpdateShow: { card: 1, panel: 1, off: 1 },
};

/** The retired theme and skin ids map to their new ones before the check (look-ids.ts). */
const RETIRED: Partial<Record<ChoiceKey, Record<string, string>>> = {
  theme: RETIRED_THEMES, dayTheme: RETIRED_THEMES, nightTheme: RETIRED_THEMES,
  skin: RETIRED_SKINS, daySkin: RETIRED_SKINS, nightSkin: RETIRED_SKINS,
};

const PRIMITIVE = new Set(["boolean", "number", "string"]);
/** Own keys only: "toString" or "constructor" is never a choice. */
const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Drops from `stored`, in place, each value its key cannot hold, and returns those keys:
 * - a choice key whose value is not one of its choices (a number choice may be stored as
 *   its digits, as a choice row once wrote it);
 * - a key whose default is a boolean, number or string, holding another type.
 * A key with no default (a key a newer build added) is left alone, and so is a default that is
 * an object or an array: its own reader checks its shape.
 */
export function dropBadValues(stored: Record<string, unknown>, defaults: Record<string, unknown>): string[] {
  const dropped: string[] = [];
  for (const key of Object.keys(stored)) {
    const v = stored[key];
    if (v === undefined) continue;
    if (has(CHOICES, key)) {
      const k = key as ChoiceKey;
      const retired = RETIRED[k];
      const value = typeof v === "string" && retired && has(retired, v) ? retired[v] : v;
      const ok = (typeof value === "string" || typeof value === "number") && has(CHOICES[k], String(value));
      if (!ok) {
        delete stored[key];
        dropped.push(key);
      } else {
        stored[key] = typeof defaults[key] === "number" ? Number(value) : String(value);
      }
      continue;
    }
    const d = defaults[key];
    if (PRIMITIVE.has(typeof d) && typeof v !== typeof d) {
      delete stored[key];
      dropped.push(key);
    }
  }
  return dropped;
}
