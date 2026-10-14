// Usage counts (docs/features/USAGE-COUNTS.md): WHEN each report leaves, and the user's side
// of it. Three reports, each its own request at its own random moment (§3.4):
//   day       once per UTC day, in the first hour the app is open: the version, and whether
//             this is the install's first count of the week / month (usage-rules.ts)
//   settings  once per ISO week: the allow-listed settings (usage-keys.ts), as option values
//   health    once per ISO week: the last finished week's counts, held by Rust (usage.rs)
// Rust does every send (`usage_send`) and sets the channel. This module holds the off switch
// (`usageReports`, §2 rule 9), the notice gate (nothing leaves before the user was told, §2
// rule 10) and *Show what is sent* (§2 rule 8). Every send, skip and off is one diag line
// with the kind, never the content.

import { invoke } from "@tauri-apps/api/core";
import { setting, setSetting, onSettingsChange } from "./settings-store";
import { toast, noticeOff } from "./toast";
import { requestSetting } from "./layout-bus";
import * as diag from "./diag";
import { reportedSettings } from "./agent-settings";
import { REPORTED } from "./usage-keys";
import {
  dayCount, afterDay, weeklyDue, mayTry, afterTry, isoWeek, randomDelay, apart, utcDay,
  type UsageKind, type UsageState,
} from "./usage-rules";

const STATE_KEY = "deets-usage";
const LAST_KEY = "deets-usage-last";
/** The notice's own key (toast.ts `onceKey`): "off" once the user pressed any of its buttons. */
export const NOTICE_KEY = "deets-usage-notice";

const MIN = 60_000;
/** The day count leaves in the first hour the app is open on a new UTC day (§3.4). */
const DAY_WINDOW = 60 * MIN;
/** The weekly reports leave at a random moment in this window of a launch where they are due. */
const WEEK_WINDOW = 90 * MIN;
/** Nothing leaves in the first minutes after launch, nor while the notice is fresh. */
const FIRST = 3 * MIN;
/** Once an hour, look again: a new UTC day or week can start while the app is open. */
const RECHECK = 60 * MIN;
/** The notice waits for the launch's own toasts to settle. */
const NOTICE_AFTER = 20_000;
const NOTICE_WATCH = 30_000;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // Storage blocked: the state lives for this session; at worst a report goes twice a day.
  }
}

let state: UsageState = read<UsageState>(STATE_KEY, {});
const setState = (s: UsageState) => write(STATE_KEY, (state = s));

/** The last body of each kind that reached the worker, and the UTC day it left: Show what is sent. */
type Last = Partial<Record<UsageKind, { day: string; body: unknown }>>;

const timers = new Map<UsageKind, number>();
/** When each planned report leaves, in ms since the page loaded: two never share a minute. */
const planned = new Map<UsageKind, number>();
let recheck: number | undefined;

const told = () => noticeOff(NOTICE_KEY);

function cancelAll(why: string): void {
  diag.log("usage:off", { dropped: [...timers.keys()], why });
  timers.forEach((t) => window.clearTimeout(t));
  timers.clear();
  planned.clear();
}

function plan(kind: UsageKind, windowMs: number): void {
  if (timers.has(kind)) return;
  const others = [...planned.values()].map((at) => at - performance.now());
  const delay = apart(randomDelay(Math.random, windowMs, FIRST), others);
  planned.set(kind, performance.now() + delay);
  timers.set(kind, window.setTimeout(() => {
    timers.delete(kind);
    planned.delete(kind);
    void send(kind);
  }, delay));
  diag.log("usage:plan", { kind, inMin: Math.round(delay / MIN) });
}

/** Plan every report that is due now and not planned yet. */
async function planDue(): Promise<void> {
  if (!setting("usageReports") || !told()) return;
  const now = new Date();
  if (dayCount(state, now) && mayTry(state, "day", now)) plan("day", DAY_WINDOW);
  if (weeklyDue(state, "settings", now) && mayTry(state, "settings", now)) plan("settings", WEEK_WINDOW);
  if (mayTry(state, "health", now) && !timers.has("health")) {
    try {
      const h = await invoke<{ pending: unknown }>("usage_health");
      if (h.pending) plan("health", WEEK_WINDOW);
    } catch (e) {
      diag.warn("usage:fail", { kind: "health", err: String(e) });
    }
  }
}

async function bodyOf(kind: UsageKind, now: Date): Promise<unknown> {
  if (kind === "day") return dayCount(state, now);
  if (kind === "settings") return { settings: await reportedSettings(REPORTED) };
  return undefined; // health: Rust sends the pending week from its own file
}

async function send(kind: UsageKind): Promise<void> {
  // Off means off, at once (§2 rule 9): a timer that fires after the switch went off sends nothing.
  if (!setting("usageReports")) return void diag.log("usage:skip", { kind, why: "off" });
  if (!told()) return void diag.log("usage:skip", { kind, why: "not told" });
  const now = new Date();
  const body = await bodyOf(kind, now);
  if (kind === "day" && !body) return void diag.log("usage:skip", { kind, why: "sent today" });
  // What the health report carries, read before the send takes it from the file.
  const shown = kind === "health" ? (await invoke<{ pending: unknown }>("usage_health").catch(() => ({ pending: null }))).pending : body;
  setState(afterTry(state, kind, now));
  try {
    const sent = await invoke<boolean>("usage_send", { kind, body });
    if (!sent) return void diag.log("usage:skip", { kind, why: "no worker for this build" });
    if (kind === "day") setState(afterDay(state, now));
    else if (kind === "settings") setState({ ...state, settingsWeek: isoWeek(now) });
    else setState({ ...state, healthWeek: isoWeek(now) });
    write(LAST_KEY, { ...read<Last>(LAST_KEY, {}), [kind]: { day: utcDay(now), body: shown } });
    diag.log("usage:send", { kind });
  } catch (e) {
    diag.warn("usage:fail", { kind, err: String(e) });
  }
}

function showNotice(): void {
  const h = toast({
    kind: "info",
    text: "New: DeetsMusic now sends usage counts. They carry no ID, no songs and no place.",
    onceKey: NOTICE_KEY,
    actions: [
      { label: "Show what is sent", run: () => requestSetting("usage") },
      { label: "Turn off", run: () => setSetting("usageReports", false) },
    ],
  });
  diag.log("usage:notice", { shown: h.shown, queued: h.queued });
  // A press on any of its buttons (Got it included) writes the key after the button's own
  // run, and no event says so in this window: look twice a minute until it is written.
  const watch = window.setInterval(() => {
    if (!told()) return;
    window.clearInterval(watch);
    void planDue();
  }, NOTICE_WATCH);
}

/** The boot part (main.ts, a late part). */
export function initUsage(): void {
  let wasOn = setting("usageReports");
  onSettingsChange((k) => {
    if (k !== "usageReports") return;
    const on = setting("usageReports");
    if (on === wasOn) return;
    wasOn = on;
    if (on) void planDue();
    else cancelAll("switched off");
  });
  if (!setting("usageReports")) {
    diag.log("usage:off", { why: "switch off at launch" });
  } else if (!told()) {
    window.setTimeout(showNotice, NOTICE_AFTER);
  }
  void planDue();
  recheck = window.setInterval(() => void planDue(), RECHECK);
}

/** Settings › About › *Show what is sent*: each kind's last report and the next one, as JSON. */
export async function whatIsSent(): Promise<{ kind: UsageKind; title: string; last?: { day: string; body: unknown }; next: unknown; note?: string }[]> {
  const last = read<Last>(LAST_KEY, {});
  const now = new Date();
  let health: { pending: unknown; current: unknown; channel: string; sends: boolean } = { pending: null, current: null, channel: "", sends: false };
  try {
    health = await invoke("usage_health");
  } catch (e) {
    diag.warn("usage:fail", { kind: "preview", err: String(e) });
  }
  const version = (health.current as { v?: string } | null)?.v ?? "";
  const day = dayCount(state, now) ?? { week: false, month: false };
  return [
    {
      kind: "day",
      title: "Once a day",
      last: last.day,
      next: { v: version, channel: health.channel, ...day },
    },
    {
      kind: "settings",
      title: "Once a week: settings",
      last: last.settings,
      next: { channel: health.channel, settings: await reportedSettings(REPORTED) },
    },
    {
      kind: "health",
      title: "Once a week: errors and Apple calls",
      last: last.health,
      next: health.pending ?? health.current,
      note: health.pending ? "Last week, sent next." : "This week so far. It is sent next week.",
    },
  ];
}

declare global {
  interface Window {
    /** DevTools: `__usage.send("day")` sends one report now, past its random moment (dev). */
    __usage?: { send: (kind: UsageKind) => Promise<void>; state: () => UsageState };
  }
}
if (import.meta.env.DEV) window.__usage = { send, state: () => state };

/** Stop the hourly look (tests and a hot reload). */
export function stopUsage(): void {
  window.clearInterval(recheck);
  cancelAll("stopped");
}
