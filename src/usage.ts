// Usage counts (docs/features/USAGE-COUNTS.md): WHEN each report leaves, and the user's side
// of it. Five reports, each its own request at its own random moment (§3.4, §12):
//   day         once per UTC day: the version, and whether this is the install's first count
//               of the week / month, or its first ever (usage-rules.ts)
//   settings    once per ISO week: the allow-listed settings (usage-keys.ts), as option values
//   health      once per ISO week: the last finished week's counts, held by Rust (usage.rs)
//   downloaded  once per update version: it reached `ready` (updater.ts's status)
//   applied     the first start on a new version: the counts of this day, week and month move
//               to it on the worker (§12.2)
// Each report waits for a random moment of OPEN time, kept across launches, so a short
// session adds to it instead of starting again (§12.9 A1). Each carries the app's UTC day (the
// worker files it under that day, A3) and a random key made for that one report (the worker
// drops a retry that already landed, A4). A failed report is tried again an hour later or at
// the next launch, until its period ends (A5).
// Rust does every send (`usage_send`) and sets the channel. This module holds the off switch
// (`usageReports`, §2 rule 9), the told gate (nothing leaves before the user was told, §2
// rule 10) and *Show what is sent* (§2 rule 8). A new install is told by the grand opening's
// page 4, which shows the switch (on by default, his call 2026-10-23); a user who turns the
// switch on by hand is told by that act. Every send, skip and off is one diag line with the
// kind, never the content.

import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { setting, onSettingsChange } from "./settings-store";
import { noticeOff } from "./toast";
import * as diag from "./diag";
import { reportedSettings } from "./agent-settings";
import { REPORTED } from "./usage-keys";
import { onUpdateStatus } from "./updater";
import { compareVersions } from "./update-rules";
import {
  dayCount, afterDay, appliedReport, afterApplied, onDownloaded, reportId, clockFor, tickClock,
  keyFor, waited, isoWeek, utcDay,
  type UsageKind, type UsageState,
} from "./usage-rules";

const STATE_KEY = "deets-usage";
const LAST_KEY = "deets-usage-last";
/** "off" once the user was told: the retired notice's own key (toast.ts `onceKey`), kept so an
 *  install that answered it keeps sending. */
export const NOTICE_KEY = "deets-usage-notice";

const SEC = 1000;
const MIN = 60 * SEC;
/** How often the open-time clocks move on. */
const TICK = 15 * SEC;
/** One tick adds at most this much open time: a PC that slept between two ticks does not
 *  count its sleep. */
const TICK_CAP = 2 * MIN;
/** Two reports never leave in the same minute (§3.4). */
const GAP = MIN;
/** A failed report waits this long, or for the next launch, before it is tried again (A5). */
const RETRY = 60 * MIN;
/** Once an hour, ask Rust again whether last week's health report is waiting. */
const HEALTH_LOOK = 60 * MIN;
/** The random moment of each report, in open time (§12.9 A1). The day count and the update
 *  reports go early, so a short session counts; the weekly reports go within half an hour. */
const WINDOWS: Record<UsageKind, [number, number]> = {
  day: [20 * SEC, 5 * MIN],
  applied: [20 * SEC, 5 * MIN],
  downloaded: [20 * SEC, 5 * MIN],
  settings: [MIN, 30 * MIN],
  health: [MIN, 30 * MIN],
};
/** The order a tick looks at the kinds; at most one report leaves per tick. */
const ORDER: UsageKind[] = ["applied", "downloaded", "day", "settings", "health"];
/** What *Show what is sent* shows in place of a report's key: the key itself is not kept. */
const KEY_SHOWN = "(a random key for this one report; not kept)";

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
    // Storage blocked: the state lives for this session; a key made here dies with it, so at
    // worst a report goes twice. WebView2 does not block it.
  }
}

let state: UsageState = read<UsageState>(STATE_KEY, {});
const setState = (s: UsageState) => write(STATE_KEY, (state = s));

/** The last body of each kind that reached the worker, and the UTC day it left: Show what is sent. */
type Last = Partial<Record<UsageKind, { day: string; body: unknown }>>;

/** The running version (getVersion), "" until it is known: nothing is counted before. */
let version = "";
/** The finished week whose health report Rust holds, or null. */
let pendingWeek: string | null = null;
let ticker: number | undefined;
let healthLook: number | undefined;
let lastTick = performance.now();
/** When the last report left, in ms since the page loaded. */
let lastSent: number | undefined;
/** When each kind last failed, this launch only: a new launch tries again at once (A5). */
const failedAt = new Map<UsageKind, number>();
let busy = false;

const told = () => noticeOff(NOTICE_KEY);
const on = () => setting("usageReports") && told();
/** The user was told: the grand opening's page 4 showed the row and its hint, or they turned
 *  the switch on by hand. Then the reports may be planned. */
export function markUsageTold(why: string): void {
  if (told()) return;
  try {
    localStorage.setItem(NOTICE_KEY, "off");
  } catch {
    // Storage blocked: the gate stays shut this session, so nothing is sent. The safe side.
    return;
  }
  diag.log("usage:told", { why });
}

/** Off at once (§2 rule 9): every report waiting for its moment is dropped, with its clock. */
function cancelAll(why: string): void {
  const dropped = Object.keys(state.open ?? {});
  setState({ ...state, open: {}, dl: undefined });
  diag.log("usage:off", { dropped, why });
}

/** 16 bytes from the OS random source, base64url: the key of one report (§12.9 A4). */
function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function lookHealth(): Promise<void> {
  try {
    const h = await invoke<{ pending: { week?: string } | null }>("usage_health");
    pendingWeek = h.pending?.week ?? null;
  } catch (e) {
    diag.warn("usage:fail", { kind: "health", err: String(e) });
  }
}

/** One step of the open-time clocks, then at most one report whose moment has come. */
async function tick(): Promise<void> {
  const nowMs = performance.now();
  const elapsed = nowMs - lastTick;
  lastTick = nowMs;
  if (!on() || !version || busy) return;
  const now = new Date();
  const open = { ...state.open };
  for (const kind of ORDER) {
    const id = reportId(state, kind, now, version, pendingWeek);
    if (!id) {
      delete open[kind];
      continue;
    }
    const [lo, hi] = WINDOWS[kind];
    const fresh = !open[kind] || open[kind]!.id !== id;
    open[kind] = tickClock(clockFor(open[kind], id, Math.random, lo, hi), fresh ? 0 : elapsed, TICK_CAP);
    if (fresh) diag.log("usage:plan", { kind, inMin: Math.round(open[kind]!.at / MIN) });
  }
  setState({ ...state, open });
  if (!waited(lastSent, nowMs, GAP)) return;
  const kind = ORDER.find((k) => {
    const c = open[k];
    return c && c.ms >= c.at && waited(failedAt.get(k), nowMs, RETRY);
  });
  if (kind) await send(kind);
}

async function bodyOf(kind: UsageKind, now: Date, key: string): Promise<Record<string, unknown> | null> {
  const day = utcDay(now);
  switch (kind) {
    case "day": {
      const flags = dayCount(state, now);
      return flags && { ...flags, day, key };
    }
    case "settings":
      return { settings: await reportedSettings(REPORTED), day, key };
    case "health":
      return { day, key }; // Rust adds the pending week's counts from its own file
    case "downloaded":
      return state.dl ? { event: "downloaded", to: state.dl.to, rollback: state.dl.rollback, day, key } : null;
    case "applied": {
      const r = appliedReport(state, now, version, compareVersions);
      return r && { ...r, day, key };
    }
  }
}

/** The state after a report of this kind reached the worker. */
function afterSent(kind: UsageKind, now: Date): UsageState {
  switch (kind) {
    case "day": return afterDay(state, now, version);
    case "settings": return { ...state, settingsWeek: isoWeek(now) };
    case "health": return { ...state, healthWeek: isoWeek(now) };
    case "downloaded": return { ...state, downloaded: state.dl?.to, dl: undefined };
    case "applied": return afterApplied(state, now, version);
  }
}

async function send(kind: UsageKind): Promise<void> {
  // Off means off, at once (§2 rule 9): a report whose moment came after the switch went off
  // sends nothing.
  if (!setting("usageReports")) return void diag.log("usage:skip", { kind, why: "off" });
  if (!told()) return void diag.log("usage:skip", { kind, why: "not told" });
  if (!version) return void diag.log("usage:skip", { kind, why: "no version yet" });
  const now = new Date();
  const id = reportId(state, kind, now, version, pendingWeek);
  if (!id) return void diag.log("usage:skip", { kind, why: kind === "day" ? "sent today" : "not due" });
  const k = keyFor(state.keys?.[kind], id, newKey);
  setState({ ...state, keys: { ...state.keys, [kind]: k } });
  const body = await bodyOf(kind, now, k.key);
  if (!body) return void diag.log("usage:skip", { kind, why: "not due" });
  // What the health report carries, read before the send takes it from the file.
  const shown = kind === "health"
    ? { ...((await invoke<{ pending: object | null }>("usage_health").catch(() => ({ pending: null }))).pending ?? {}), day: body.day, key: KEY_SHOWN }
    : { ...body, key: KEY_SHOWN };
  busy = true;
  lastSent = performance.now();
  try {
    const sent = await invoke<boolean>("usage_send", { kind, body });
    if (!sent) {
      failedAt.set(kind, performance.now());
      return void diag.log("usage:skip", { kind, why: "no worker for this build" });
    }
    const next = afterSent(kind, now);
    const keys = { ...next.keys };
    const open = { ...next.open };
    delete keys[kind];
    delete open[kind];
    setState({ ...next, keys, open });
    if (kind === "health") pendingWeek = null;
    failedAt.delete(kind);
    write(LAST_KEY, { ...read<Last>(LAST_KEY, {}), [kind]: { day: utcDay(now), body: shown } });
    diag.log("usage:send", { kind });
  } catch (e) {
    failedAt.set(kind, performance.now());
    diag.warn("usage:fail", { kind, err: String(e) });
  } finally {
    busy = false;
  }
}

/** The boot part (main.ts, a late part). */
export function initUsage(): void {
  let wasOn = setting("usageReports");
  onSettingsChange((k) => {
    if (k !== "usageReports") return;
    const now = setting("usageReports");
    if (now === wasOn) return;
    wasOn = now;
    if (now) markUsageTold("switched on");
    else cancelAll("switched off");
  });
  if (!setting("usageReports")) {
    diag.log("usage:off", { why: "switch off at launch" });
  } else if (!told()) {
    diag.log("usage:skip", { why: "not told" });
  }
  // An update on disk (updater.ts): its report waits in the state, once per version. Only
  // while the switch is on: off means nothing is collected either.
  onUpdateStatus((s) => {
    if (s?.state !== "ready" || !s.version || !on()) return;
    const next = onDownloaded(state, s.version, !!s.rollback);
    if (next !== state) {
      setState(next);
      diag.log("usage:downloaded", { to: s.version });
    }
  });
  void getVersion().then((v) => {
    version = v;
  }).catch((e) => diag.warn("usage:fail", { kind: "version", err: String(e) }));
  void lookHealth();
  lastTick = performance.now();
  ticker = window.setInterval(() => void tick(), TICK);
  healthLook = window.setInterval(() => void lookHealth(), HEALTH_LOOK);
}

type Sent = { kind: UsageKind; title: string; last?: { day: string; body: unknown }; next: unknown; note?: string };

/** Settings › About › *Show what is sent*: each kind's last report and the next one, as JSON. */
export async function whatIsSent(): Promise<Sent[]> {
  const last = read<Last>(LAST_KEY, {});
  const now = new Date();
  const day = utcDay(now);
  let health: { pending: unknown; current: unknown; channel: string; sends: boolean } = { pending: null, current: null, channel: "", sends: false };
  try {
    health = await invoke("usage_health");
  } catch (e) {
    diag.warn("usage:fail", { kind: "preview", err: String(e) });
  }
  const v = version || ((health.current as { v?: string } | null)?.v ?? "");
  const flags = dayCount(state, now) ?? { week: false, month: false, new: false };
  const out: Sent[] = [
    {
      kind: "day",
      title: "Once a day",
      last: last.day,
      next: { v, channel: health.channel, ...flags, day, key: KEY_SHOWN },
    },
    {
      kind: "settings",
      title: "Once a week: settings",
      last: last.settings,
      next: { channel: health.channel, settings: await reportedSettings(REPORTED), day, key: KEY_SHOWN },
    },
    {
      kind: "health",
      title: "Once a week: errors and Apple calls",
      last: last.health,
      next: { ...((health.pending ?? health.current) as object | null ?? {}), day, key: KEY_SHOWN },
      note: health.pending ? "Last week, sent next." : "This week so far. It is sent next week.",
    },
  ];
  // The update reports show only when one is waiting or one was sent.
  const applied = appliedReport(state, now, v, compareVersions);
  if (applied || last.applied) {
    out.push({
      kind: "applied",
      title: "On the first start after an update",
      last: last.applied,
      next: applied ? { ...applied, to: v, channel: health.channel, day, key: KEY_SHOWN } : null,
      note: applied ? undefined : "Nothing waiting.",
    });
  }
  if (state.dl || last.downloaded) {
    out.push({
      kind: "downloaded",
      title: "When an update downloads",
      last: last.downloaded,
      next: state.dl ? { event: "downloaded", from: v, to: state.dl.to, rollback: state.dl.rollback, channel: health.channel, day, key: KEY_SHOWN } : null,
      note: state.dl ? undefined : "Nothing waiting.",
    });
  }
  return out;
}

declare global {
  interface Window {
    /** DevTools: `__usage.send("day")` sends one report now, past its random moment (dev).
     *  `__usage.tick()` moves the clocks one step; `__usage.state()` reads the state. */
    __usage?: { send: (kind: UsageKind) => Promise<void>; tick: () => Promise<void>; state: () => UsageState };
  }
}
if (import.meta.env.DEV) window.__usage = { send, tick, state: () => state };

/** Stop the clocks (tests and a hot reload). */
export function stopUsage(): void {
  window.clearInterval(ticker);
  window.clearInterval(healthLook);
}
