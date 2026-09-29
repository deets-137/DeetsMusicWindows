// Look schedule (LOOK-SCHEDULE.md) — the app changes between a day look and a night look
// (a theme and a skin) by itself: at sunrise and sunset, at set times, or with the Windows
// light/dark mode. Sun times come from the time zone's main city (sun-zones.ts), so the
// app needs no location and makes no request.
//
// A theme or skin picked from the title menu while a schedule is on holds until the next
// change (`lookHold` "next"), or turns the schedule off ("always"). Since 2026-09-26 the
// rules engine runs both (RULES.md §13): see "apply" below.
//
// index.html reads PREPAINT_KEY and HOLD_KEY before first paint, so a launch after a
// change time never flashes the old look. Keep the two in step.

import { setting, setSetting, ownSetting, onSettingsChange, type Settings } from "./settings-store";
import type { ThemeName, SkinName } from "./look-ids";
import { adoptHoldEnd, holdEndsAt, isHeld, onRulesChange, recheck, registerChipText, registerFact, registerHoldEnd, resumeRow } from "./rules";
import { ZONES, ALIASES } from "./sun-zones";

type Period = "day" | "night";
interface Plan {
  period: Period;
  /** The next change (ms), or null when only Windows can end the period. */
  next: number | null;
  /** Today's day window in local minutes [start, end) for the pre-paint; null = Windows mode. */
  window: [number, number] | null;
  /** The sun does not rise or set today. */
  polar?: boolean;
}
interface Hold {
  period: Period;
  until: number | null;
}

const HOLD_KEY = "deets.look.hold";
const PREPAINT_KEY = "deets.look.prepaint";
const MIN = 60_000;
const RECHECK_MS = 15 * MIN; // a timer stops while the PC sleeps; this re-check catches up

/** The title menu's themes and skins (Vanilla is not offered there). */
export const THEME_OPTIONS = [
  { value: "lilac", label: "Lilac" }, { value: "green", label: "Green" }, { value: "sepia", label: "Sepia" },
  { value: "moonlight", label: "Moonlight" }, { value: "black-yellow", label: "Black & Yellow" }, { value: "black-red", label: "Black & Red" },
];
export const SKIN_OPTIONS = [
  { value: "press", label: "Press" }, { value: "ocean", label: "Ocean" }, { value: "glass", label: "Glass" }, { value: "cyber", label: "Cyber" },
];

/** A change to one of these clears a hand pick's hold and applies the schedule at once. */
const SCHEDULE_KEYS: (keyof Settings)[] = [
  "lookSchedule", "dayTheme", "daySkin", "nightTheme", "nightSkin", "dayStart", "nightStart", "sunShift",
];

const prefersDark = (): boolean => {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
};

const store = (key: string, value: unknown): void => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — the schedule still runs for the session */
  }
};

// ── the sun ──────────────────────────────────────────────────────

interface Place {
  lat: number;
  lon: number;
  /** The zone's main city, or null when the zone has none (UTC, Etc/GMT+5). */
  city: string | null;
}

function place(): Place {
  let zone = "";
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    /* no Intl time zone — the UTC offset below */
  }
  const id = ZONES[zone] ? zone : ALIASES[zone];
  const at = id ? ZONES[id] : undefined;
  if (at) return { lat: at[0], lon: at[1], city: id!.split("/").pop()!.replace(/_/g, " ") };
  // No main city: the UTC offset gives the longitude (15° an hour); the latitude is a guess.
  return { lat: 40, lon: -new Date().getTimezoneOffset() / 4, city: null };
}

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;

/** The sleep timer's "Sunset" (sleep.ts): sunrise and sunset on a local calendar day, from
 *  the time zone's main city, or "day" / "night" when the sun stays up or down all day. */
export function sunTimes(day: Date): { rise: number; set: number } | "day" | "night" {
  return sunEdges(day, place());
}

/** The time zone's main city for the sleep panel's status line, or null. */
export function sunCity(): string | null {
  return place().city;
}

/** Sunrise and sunset (ms) on a local calendar day — the standard sunrise equation (NOAA
 *  simplified), good to about a minute. A string when the sun stays up or down all day. */
function sunEdges(day: Date, p: Place): { rise: number; set: number } | Period {
  const n = Math.round(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 12) / DAY_MS + 2440587.5 - 2451545);
  const j = n - p.lon / 360;
  const m = (357.5291 + 0.98560028 * j) % 360;
  const c = 1.9148 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 0.0003 * Math.sin(3 * m * RAD);
  const l = (m + c + 180 + 102.9372) % 360;
  const transit = 2451545 + j + 0.0053 * Math.sin(m * RAD) - 0.0069 * Math.sin(2 * l * RAD);
  const dec = Math.asin(Math.sin(l * RAD) * Math.sin(23.4397 * RAD));
  const cosW = (Math.sin(-0.833 * RAD) - Math.sin(p.lat * RAD) * Math.sin(dec)) / (Math.cos(p.lat * RAD) * Math.cos(dec));
  if (cosW > 1) return "night";
  if (cosW < -1) return "day";
  const w = Math.acos(cosW) / RAD / 360;
  const ms = (jd: number) => (jd - 2440587.5) * DAY_MS;
  return { rise: ms(transit - w), set: ms(transit + w) };
}

const minutesOf = (t: number): number => {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
};

function planSun(now: number): Plan {
  const p = place();
  const shift = setting("sunShift") * MIN;
  const d = new Date(now);
  const dayAt = (k: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + k);
  const edges = (k: number) => {
    const e = sunEdges(dayAt(k), p);
    return typeof e === "string" ? e : { rise: e.rise + shift, set: e.set + shift };
  };
  const today = edges(0);
  const midnight = dayAt(1).getTime();
  if (typeof today === "string") {
    return { period: today, next: midnight, window: today === "day" ? [0, 1440] : [0, 0], polar: true };
  }
  const window: [number, number] = [minutesOf(today.rise), minutesOf(today.set)];
  if (now < today.rise) return { period: "night", next: today.rise, window };
  if (now < today.set) return { period: "day", next: today.set, window };
  const tomorrow = edges(1);
  return { period: "night", next: typeof tomorrow === "string" ? midnight : tomorrow.rise, window };
}

// ── set times and Windows ────────────────────────────────────────

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

function planClock(now: number): Plan {
  const start = toMinutes(setting("dayStart"));
  const end = toMinutes(setting("nightStart"));
  const d = new Date(now);
  const m = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  const day = start <= end ? m >= start && m < end : m >= start || m < end;
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, day ? end : start);
  if (next.getTime() <= now) next.setDate(next.getDate() + 1);
  return { period: day ? "day" : "night", next: next.getTime(), window: [start, end] };
}

function plan(now: number): Plan | null {
  switch (setting("lookSchedule")) {
    case "sun":
      return planSun(now);
    case "clock":
      return planClock(now);
    case "windows":
      return { period: prefersDark() ? "night" : "day", next: null, window: null };
    default:
      return null;
  }
}

// ── apply ────────────────────────────────────────────────────────

// Since 2026-09-26 the schedule is two state rules (RULES.md §13, rules-eval.ts
// `builtinRules`): while `daylight` → the day look, while not → the night look. This module
// keeps the sun and clock plan, the pre-paint, the status line, and is the provider of the
// `daylight` and `lookMode` facts. The engine lays the look on top of your pick and holds your
// hand pick (`lookHold` → the rule's `onHand`); look.ts paints.

const RULE = "row:lookSchedule:";
const held = (): boolean => isHeld(RULE);

let timer = 0;
const listeners = new Set<() => void>();
let lastPlan: Plan | null = null;

function tick(): void {
  window.clearTimeout(timer);
  const now = Date.now();
  const p = plan(now);
  lastPlan = p;
  store(
    PREPAINT_KEY,
    p && {
      window: p.window,
      day: [setting("dayTheme"), setting("daySkin")],
      night: [setting("nightTheme"), setting("nightSkin")],
    },
  );
  if (p?.next != null) timer = window.setTimeout(tick, Math.min(Math.max(p.next - now, 0) + 1000, RECHECK_MS));
  recheck("daylight"); // the engine reads `daylight` again: a new period lays the other look
  listeners.forEach((cb) => cb());
}

/** When your pick ends: the time the hold carries (the plan's next change when you picked,
 *  his call 2026-09-29), else the plan's next change; null = only Windows ends it. */
const pickEnds = (): number | null => holdEndsAt(RULE) ?? lastPlan?.next ?? null;

/** The pre-paint's copy of the hold (index.html reads it before any module runs). The engine
 *  ends the hold at the same two edges the pre-paint reads: the period changes, or `until`. */
function syncHoldKey(): void {
  const p = lastPlan;
  store(HOLD_KEY, held() && p ? ({ period: p.period, until: pickEnds() } satisfies Hold) : null);
}

let handPick = false;
/** A theme or skin is being written by hand now (look.ts `pickLook`). While it is, the schedule
 *  turning off (*For good*) keeps your pick, not the look that was on screen. */
export function noteHandPick(): void {
  handPick = true;
  queueMicrotask(() => (handPick = false));
}

/** One line for Settings › Look schedule: which look shows, and until when. "" when off. */
export function scheduleStatus(): string {
  const now = Date.now();
  const p = plan(now);
  if (!p) return "";
  const at = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (held()) {
    const end = holdEndsAt(RULE) ?? p.next;
    return end === null ? "Your pick stays until Windows changes mode." : `Your pick stays until ${at(end)}.`;
  }
  const look = p.period === "day" ? "Day look" : "Night look";
  const mode = setting("lookSchedule");
  if (mode === "windows") return `${look} while Windows is in ${p.period === "day" ? "light" : "dark"} mode.`;
  if (mode === "clock") return `${look} until ${at(p.next!)}.`;
  const city = place().city;
  const where = city ? `in ${city}` : "for your time zone (no main city, so the time is rough)";
  if (p.polar) return `${look} all day. The sun does not ${p.period === "day" ? "set" : "rise"} ${where} today.`;
  return `${look} until ${p.period === "day" ? "sunset" : "sunrise"}, ${at(p.next!)} ${where}.`;
}

/** Runs after each check and hand pick (the Settings status line). Returns an unsubscribe fn. */
export function onScheduleChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Write the look on screen as your pick (the schedule turned off). */
function keepShownLook(): void {
  if (handPick) return; // *For good*: the pick that turned it off is yours already
  const root = document.documentElement;
  const theme = root.dataset.theme as ThemeName | undefined;
  const skin = root.dataset.skin as SkinName | undefined;
  if (theme && theme !== ownSetting("theme")) setSetting("theme", theme);
  if (skin && skin !== ownSetting("skin")) setSetting("skin", skin);
}

/** Launch, before look.ts paints: the facts and the chip's words, then the plan. The engine
 *  lays the scheduled look before the first paint, so it shows with no animation. */
export function initLookSchedule(): void {
  // A hold saved before 2026-09-29 carries no time: its pre-paint copy has it. Read it before
  // anything writes that copy again, so the engine and the pre-paint end the pick together.
  try {
    const old = JSON.parse(localStorage.getItem(HOLD_KEY) ?? "null") as Hold | null;
    if (old && typeof old.until === "number") adoptHoldEnd(RULE, old.until);
  } catch {
    /* no copy: the hold ends at the next day / night change */
  }
  // A hand pick ends at the time its chip shows (LOOK-SCHEDULE.md §5a, his call 2026-09-29):
  // the next change as planned now. Windows mode has none.
  registerHoldEnd("lookSchedule", () => plan(Date.now())?.next ?? null);
  registerFact("daylight", () => (lastPlan ? lastPlan.period === "day" : undefined));
  registerFact("lookMode", () => setting("lookSchedule"));
  registerChipText("lookSchedule", {
    name: "The look schedule",
    bolt: (t) => {
      const look = lastPlan?.period === "day" ? "day" : "night";
      const own = t === "key:skin" ? labelOf(SKIN_OPTIONS, ownSetting("skin")) : labelOf(THEME_OPTIONS, ownSetting("theme"));
      return `The look schedule shows the ${look} look. Your pick is ${own}.`;
    },
    hand: () => {
      const end = pickEnds();
      const at = end !== null ? new Date(end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
      const until = at ? `until ${at}` : "until Windows changes mode";
      return `Your pick stays ${until}. Press to go back to the schedule now.`;
    },
  });
  onRulesChange(syncHoldKey);
  tick();
  onSettingsChange((k) => {
    if (!SCHEDULE_KEYS.includes(k)) return;
    // Off keeps the look on screen, as it always did: the schedule's look becomes your pick.
    // (Since 2026-09-26 a scheduled change no longer writes your theme and skin, RULES.md §7a.)
    if (k === "lookSchedule" && setting("lookSchedule") === "off") keepShownLook();
    resumeRow(RULE); // a change to the schedule ends a hand pick's hold, as before
    tick();
  });
  try {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (setting("lookSchedule") === "windows") tick();
    });
  } catch {
    /* no media query support — Windows mode applies at launch only */
  }
  // Back from sleep or the tray: check again at once.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && setting("lookSchedule") !== "off") tick();
  });
}

const labelOf = (opts: { value: string; label: string }[], v: string): string => opts.find((o) => o.value === v)?.label ?? v;
