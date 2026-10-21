// The sky over a scene skin (docs/features/happy.md §1.2, §2.3): which part of the day it shows
// and how far it has blended into the next. Pure, so it is tested (tests/sky-phase.test.ts);
// scene.ts paints it.
//
// Settings › Skin settings › Sky: *Follow the time* walks night → dawn → day → dusk → night on
// the sun's times where you are (look-schedule.ts sunTimes); the other choices hold one part.

export type SkyPart = "day" | "dawn" | "dusk" | "night";
export type SkyMode = "follow" | "day" | "sunrise" | "sunset" | "night";
export type Sun = { rise: number; set: number } | "day" | "night";

export interface Sky {
  /** The part painted underneath. */
  from: SkyPart;
  /** The part blending in over it. */
  to: SkyPart;
  /** How far `to` has come in, 0–1. */
  t: number;
  /** The moon in the sun's place. */
  moon: boolean;
}

const MIN = 60_000;
// The day's edges, in minutes from sunrise (−) or sunset (+). Dawn and dusk hold for 40 minutes
// around the sun's edge, with a 30–40 minute blend on each side.
const NIGHT_TO_DAWN = [-50, -20];
const DAWN_TO_DAY = [20, 60];
const DAY_TO_DUSK = [-60, -20];
const DUSK_TO_NIGHT = [20, 50];
const MOON_AFTER_SET = 10; // the moon rises once the sun is down
const MOON_BEFORE_RISE = -10;

const still = (part: SkyPart): Sky => ({ from: part, to: part, t: 0, moon: part === "night" });
const ramp = (x: number, [a, b]: number[]) => Math.min(1, Math.max(0, (x - a) / (b - a)));

export function skyAt(mode: SkyMode, now: number, sun: Sun): Sky {
  if (mode === "day") return still("day");
  if (mode === "sunrise") return still("dawn");
  if (mode === "sunset") return still("dusk");
  if (mode === "night") return still("night");
  if (sun === "day") return still("day");
  if (sun === "night") return still("night");
  const fromRise = (now - sun.rise) / MIN;
  const fromSet = (now - sun.set) / MIN;
  const moon = fromSet >= MOON_AFTER_SET || fromRise < MOON_BEFORE_RISE;
  const at = (from: SkyPart, to: SkyPart, t: number): Sky => (t <= 0 ? { ...still(from), moon } : t >= 1 ? { ...still(to), moon } : { from, to, t, moon });
  if (fromRise < DAWN_TO_DAY[0]) return at("night", "dawn", ramp(fromRise, NIGHT_TO_DAWN));
  if (fromSet < DAY_TO_DUSK[0]) return at("dawn", "day", ramp(fromRise, DAWN_TO_DAY));
  if (fromSet < DUSK_TO_NIGHT[0]) return at("day", "dusk", ramp(fromSet, DAY_TO_DUSK));
  return at("dusk", "night", ramp(fromSet, DUSK_TO_NIGHT));
}
