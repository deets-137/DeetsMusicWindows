// Sleep timer (NEXT-VERSION §17) — the alarm clock left of the volume pill. Its panel is
// a kitchen-timer dial: turn it to set up to 120 minutes, and it turns back as the time
// runs out. Two chips end at the song or at Up Next instead. A schedule row arms the timer
// every day, at sunset (the time zone's sun, look-schedule.ts) or at a set time.
//
// The mark is when the room goes quiet: the wind-down fills the last `sleepWind` minutes
// before it, sinking the volume to nothing, then the music pauses. The fade is a gain
// factor inside player.ts (`setDuck`), never the stored level, so the next Play is at the
// set level. A hand on the volume during the fade turns the timer off (Undo in the toast).
//
// No Apple calls. Everything here is local time and the player's own state.

import { setting, setSetting, onSettingsChange } from "./settings-store";
import {
  getDuck, setDuck, pausePlayback, isPlayingNow, onPlayerState, onPlayerProgress, onVolumeChange,
} from "./player";
import { getUpcoming } from "./queue";
import { trackById } from "./track-store";
import { sunTimes, sunCity } from "./look-schedule";
import { makeDropdown, type DropdownHandle } from "./dropdown";
import { enterRows } from "./pop";
import { toast } from "./toast";
import * as diag from "./diag";

type Mode = "off" | "clock" | "song" | "queue";

const MIN = 60_000;
const DIAL_MAX = 120; // minutes in one turn of the dial
const DETENT = 5; // the dial clicks every five minutes
const WIND_STEPS = [0, 1, 2, 5, 10, 15, 30]; // the wind-down pill's values, in minutes
const SONG_END_MS = 1500; // a song change this close to the end is the song's own end, not a click
const WARN_MS = 60_000; // the "Sleep in 1 minute" toast

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
const clockText = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const hhmmText = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};
const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// ── state ──────────────────────────────────────────────────────

let dropdown: DropdownHandle | null = null; // the title bar panel, for the Compass (COMPASS.md)
let mode: Mode = "off";
let deadline = 0; // clock mode: the mark (ms epoch)
let fromSchedule = false; // the running countdown came from the schedule
let firedMark = 0; // the schedule's mark that already came (fired, or passed under a hand timer)
let skipMark = 0; // "Not tonight": the schedule's mark the user turned off
let warned = false; // the one-minute toast, once per arm
let playing = false;
let songKey = ""; // song / queue mode: the song the end belongs to
let songRemainingMs = 0; // song / queue mode: from the progress ticks
let upcomingEmpty = true; // sampled each progress tick, before a song change
let ownVolumeWrite = false; // our setDuck, seen by the volume listener
let interval = 0;
let undo: { mode: Mode; deadline: number; fromSchedule: boolean } | null = null;

function upcomingMs(): number {
  let sum = 0;
  for (const h of getUpcoming()) sum += trackById(h.catalogId ?? h.libraryId)?.durationMs ?? 0;
  return sum;
}

/** Time to the mark, in ms; 0 when off. */
function remainingMs(now = Date.now()): number {
  switch (mode) {
    case "clock": {
      const rem = Math.max(0, deadline - now);
      // Play out song: once the mark falls inside the playing song, the end moves to the
      // song's end (and the wind-down fills the song's last minutes instead).
      return setting("sleepPlayOut") && playing && songRemainingMs > rem ? songRemainingMs : rem;
    }
    case "song": return Math.max(0, songRemainingMs);
    case "queue": return Math.max(0, songRemainingMs + upcomingMs());
    default: return 0;
  }
}

/** The schedule's next mark after `now`, or 0 when there is none (off, or a polar day). */
function nextMark(now: number): number {
  const kind = setting("sleepSchedule");
  if (kind === "off") return 0;
  const d = new Date(now);
  if (kind === "clock") {
    const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, toMinutes(setting("sleepAt")));
    if (at.getTime() <= now) at.setDate(at.getDate() + 1);
    return at.getTime();
  }
  for (let k = 0; k < 2; k++) {
    const e = sunTimes(new Date(d.getFullYear(), d.getMonth(), d.getDate() + k));
    if (typeof e !== "string" && e.set > now) return e.set;
  }
  return 0;
}

// ── the fade ───────────────────────────────────────────────────

/** Gain for a fraction of the wind-down left. Squared: gain falls faster than loudness
 *  does, so the fade sounds even instead of falling off a cliff in the last seconds. */
const curve = (f: number) => f * f;

function applyDuck(f: number): void {
  ownVolumeWrite = true;
  try {
    setDuck(f);
  } finally {
    ownVolumeWrite = false;
  }
}

function updateFade(): void {
  if (mode === "off" || !playing) return applyDuck(1);
  const rem = remainingMs();
  const wind = setting("sleepWind") * MIN;
  // In song mode with no wind-down, the next song must not sound before the pause lands:
  // its first fraction of a second plays at gain 0.
  if (wind <= 0) return applyDuck(mode !== "clock" && rem < 500 ? 0 : 1);
  applyDuck(rem < wind ? curve(rem / wind) : 1);
}

// ── arm, fire, off ─────────────────────────────────────────────

function ensureTicking(): void {
  const need = mode !== "off" || setting("sleepSchedule") !== "off";
  if (need && !interval) interval = window.setInterval(tick, 1000);
  if (!need && interval) {
    window.clearInterval(interval);
    interval = 0;
  }
}

function armClock(ms: number, scheduled: boolean): void {
  mode = "clock";
  deadline = ms;
  fromSchedule = scheduled;
  warned = false;
  diag.log("sleep:arm", { mode, at: new Date(ms).toISOString(), scheduled, wind: setting("sleepWind") });
  ensureTicking();
  render();
}

function armEnd(kind: "song" | "queue"): void {
  mode = kind;
  fromSchedule = false;
  warned = false;
  songKey = currentKey;
  diag.log("sleep:arm", { mode, wind: setting("sleepWind") });
  ensureTicking();
  render();
}

/** Turn the timer off. A scheduled countdown turned off skips that mark ("Not tonight"). */
function disarm(why: string): void {
  if (mode === "off") return;
  if (fromSchedule) skipMark = deadline;
  diag.log("sleep:off", { why, mode });
  mode = "off";
  fromSchedule = false;
  applyDuck(1);
  ensureTicking();
  render();
}

async function fire(): Promise<void> {
  const mark = deadline;
  const scheduled = fromSchedule;
  diag.log("sleep:fire", { mode, scheduled, playing: isPlayingNow() });
  mode = "off";
  fromSchedule = false;
  if (scheduled) firedMark = mark;
  try {
    await pausePlayback();
  } finally {
    applyDuck(1); // paused: the set level is back for the next Play
  }
  ensureTicking();
  render();
}

function tick(): void {
  const now = Date.now();
  const next = nextMark(now);
  if (mode === "off") {
    // The schedule arms itself once its mark is within one turn of the dial.
    if (next && next !== firedMark && next !== skipMark && next - now <= DIAL_MAX * MIN) armClock(next, true);
  } else if (!fromSchedule && next && next <= now + 1000) {
    firedMark = next; // a hand-set timer holds tonight: the schedule's mark passes under it
  }
  if (mode === "clock") {
    const rem = deadline - now;
    if (rem <= 0) {
      // Play out song: the mark came mid-song, so the end is the song's own (song mode
      // takes over with the same remaining time; a scheduled mark counts as come).
      if (setting("sleepPlayOut") && playing && songRemainingMs > SONG_END_MS) {
        if (fromSchedule) firedMark = deadline;
        diag.log("sleep:playOut", { left: Math.round(songRemainingMs / 1000) });
        mode = "song";
        fromSchedule = false;
        songKey = currentKey;
      } else {
        return void fire();
      }
    } else if (remainingMs(now) <= WARN_MS && !warned && playing) warn();
  }
  updateFade();
  render();
}

function warn(): void {
  warned = true;
  toast({
    kind: "info",
    text: "Sleep in 1 minute.",
    actions: [{ label: "+15 min", run: () => armClock(Date.now() + 15 * MIN, false) }],
  });
}

/** A hand on the volume during the fade: off, with an Undo. */
function cancelByHand(): void {
  undo = { mode, deadline, fromSchedule };
  disarm("volume");
  toast({
    kind: "info",
    text: "Sleep timer off.",
    actions: [{
      label: "Undo",
      run: () => {
        if (!undo) return;
        if (undo.mode === "clock") armClock(undo.deadline, undo.fromSchedule);
        else armEnd(undo.mode as "song" | "queue");
        undo = null;
      },
    }],
  });
}

// ── the player ─────────────────────────────────────────────────

let currentKey = "";

function onProgress(currentTime: number, duration: number): void {
  songRemainingMs = duration > 0 ? Math.max(0, duration - currentTime) * 1000 : 0;
  upcomingEmpty = getUpcoming().length === 0;
  if (mode === "song" || mode === "queue") updateFade();
}

function onSongChange(key: string): void {
  const prev = currentKey;
  currentKey = key;
  if (mode !== "song" && mode !== "queue") return;
  if (!key || key === songKey) return;
  const natural = prev === songKey && songRemainingMs <= SONG_END_MS;
  if (!natural) {
    songKey = key; // a click on another song: the end now belongs to that one
    render();
    return;
  }
  if (mode === "song" || upcomingEmpty) return void fire();
  songKey = key; // Up Next still has songs: the end moves to the next one
}

// ── the panel ──────────────────────────────────────────────────

let els: {
  root: HTMLElement; btn: HTMLElement; panel: HTMLElement; dial: HTMLElement; ring: SVGGElement;
  readout: HTMLElement; caption: HTMLElement; chips: HTMLButtonElement[]; wind: HTMLElement;
  playout: HTMLElement; sched: HTMLElement; timeRow: HTMLElement; time: HTMLElement; status: HTMLElement; off: HTMLElement;
} | null = null;
let dragging = false;
let previewMin: number | null = null; // the dial under the pointer

// The clock face and two z's rising from it (user's call 2026-09-16: no bells, no feet).
const ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  // The face fills the grid (an outline reads ~15 % smaller than a solid disc the same
  // size — the traffic lights beside it), and the z's tuck into the top-right corner so the
  // icon's visual centre stays near the box's centre.
  '<circle cx="10.5" cy="13.5" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/>' +
  '<path d="M10.5 8.6v5.2l3.4 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M15.8 5.2h3.6l-3.6 3.6h3.6M19 0.8h4.2L19 5h4.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>' +
  "</svg>";

/** The dial's face: 120 ticks, numbers every 15, counted counter-clockwise so that
 *  a clockwise turn winds the timer up — the way a kitchen timer is printed. */
function buildFace(ring: SVGGElement): void {
  const NS = "http://www.w3.org/2000/svg";
  const cx = 100, cy = 100, r = 92;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < DIAL_MAX; i++) {
    const a = (-i * 360) / DIAL_MAX * (Math.PI / 180); // counter-clockwise from the top
    const major = i % 15 === 0;
    const med = !major && i % DETENT === 0;
    const len = major ? 14 : med ? 9 : 6;
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", String(cx + r * Math.sin(a)));
    line.setAttribute("y1", String(cy - r * Math.cos(a)));
    line.setAttribute("x2", String(cx + (r - len) * Math.sin(a)));
    line.setAttribute("y2", String(cy - (r - len) * Math.cos(a)));
    line.setAttribute("class", major ? "sleep__tick sleep__tick--major" : med ? "sleep__tick sleep__tick--med" : "sleep__tick");
    frag.appendChild(line);
    if (major) {
      const t = document.createElementNS(NS, "text");
      const rr = r - 24;
      t.setAttribute("x", String(cx + rr * Math.sin(a)));
      t.setAttribute("y", String(cy - rr * Math.cos(a)));
      t.setAttribute("class", "sleep__num");
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("dominant-baseline", "central");
      t.textContent = String(i);
      frag.appendChild(t);
    }
  }
  ring.appendChild(frag);
}

const readoutText = (ms: number): string => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function hint(): string {
  if (previewMin !== null) return `${previewMin} min`;
  switch (mode) {
    case "clock": return fromSchedule ? `Sleep at ${clockText(deadline)}, every day` : `Sleep in ${readoutText(remainingMs())}`;
    case "song": return "Sleep at the end of this song";
    case "queue": return "Sleep at the end of Up Next";
    default: return "The sleep timer. Music pauses when it runs out";
  }
}

function statusText(): string {
  const kind = setting("sleepSchedule");
  if (mode !== "off" && fromSchedule) return "Tonight's sleep, from the schedule.";
  if (kind === "off") return "";
  if (kind === "clock") return `Pauses at ${hhmmText(setting("sleepAt"))} if music is playing.`;
  const next = nextMark(Date.now());
  const city = sunCity();
  const where = city ? ` in ${city}` : "";
  if (!next) return `The sun does not set${where} today.`;
  return `Pauses at sunset, ${clockText(next)}${where}, if music is playing.`;
}

function render(): void {
  if (!els) return;
  const armed = mode !== "off";
  const rem = remainingMs();
  const minutes = previewMin !== null ? previewMin : Math.min(DIAL_MAX, rem / MIN);
  const turn = (reduced() && previewMin === null ? Math.round(minutes) : minutes) / DIAL_MAX * 360;
  els.dial.style.setProperty("--sleep-angle", `${turn.toFixed(3)}deg`);
  els.dial.setAttribute("aria-valuenow", String(Math.round(minutes)));
  els.btn.toggleAttribute("data-armed", armed);
  els.btn.title = hint();
  // The centre: the time, then either the one line of help (off) or the Off button (armed).
  els.readout.textContent = previewMin !== null ? (previewMin ? `${previewMin}:00` : "Off") : armed ? readoutText(rem) : "Off";
  show(els.caption, !armed && previewMin === null);
  show(els.off, armed && previewMin === null);
  els.off.textContent = fromSchedule ? "Not tonight" : "Off";
  els.chips.forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.sleepMode === mode)));
  const wind = setting("sleepWind");
  els.wind.textContent = wind ? `${wind} min` : "Off";
  els.playout.textContent = setting("sleepPlayOut") ? "On" : "Off";
  const kind = setting("sleepSchedule");
  els.sched.textContent = kind === "off" ? "Off" : kind === "sun" ? "Sunset" : "At a time";
  show(els.timeRow, kind === "clock");
  els.time.textContent = hhmmText(setting("sleepAt"));
  const status = statusText();
  els.status.textContent = status;
  show(els.status, !!status);
}

/** Show or hide one of the panel's parts. A row that appears slides in like a new row; the
 *  line under the time (the help, the Off button) fades up more gently, in a slot whose
 *  height is reserved so the time never moves. */
function show(el: HTMLElement, on: boolean): void {
  if (el.hidden === !on) return;
  el.hidden = !on;
  if (!on || !els || els.panel.hidden) return;
  if (el === els.caption || el === els.off) {
    if (reduced()) return;
    el.classList.remove("sleep__fade");
    void el.offsetWidth; // restart a fade still running
    el.classList.add("sleep__fade");
    el.addEventListener("animationend", () => el.classList.remove("sleep__fade"), { once: true });
  } else {
    enterRows([el]);
  }
}

function wireDial(dial: HTMLElement): void {
  let last = 0;
  let acc = 0;
  let start = 0;
  const angleAt = (e: PointerEvent) => {
    const r = dial.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    return (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360; // clockwise from the top
  };
  const snap = (m: number) => Math.max(0, Math.min(DIAL_MAX, Math.round(m / DETENT) * DETENT));
  const commit = (m: number) => {
    previewMin = null;
    if (m > 0) armClock(Date.now() + m * MIN, false);
    else disarm("dial");
    render();
  };
  dial.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    dial.setPointerCapture(e.pointerId);
    dial.toggleAttribute("data-dragging", true);
    last = angleAt(e);
    acc = 0;
    start = mode === "clock" ? Math.min(DIAL_MAX, remainingMs() / MIN) : 0;
    previewMin = snap(start);
    render();
  });
  dial.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const a = angleAt(e);
    let d = a - last;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    last = a;
    acc += d;
    const m = snap(start + acc / (360 / DIAL_MAX));
    if (m !== previewMin) {
      previewMin = m;
      render();
    }
  });
  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    dial.toggleAttribute("data-dragging", false);
    try {
      dial.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    commit(previewMin ?? 0);
  };
  dial.addEventListener("pointerup", end);
  dial.addEventListener("pointercancel", end);
  // A notch of the wheel or an arrow key is one detent.
  const step = (dir: number) => {
    const cur = mode === "clock" ? remainingMs() / MIN : 0;
    commit(snap(cur + dir * DETENT + (dir > 0 ? 0.001 : -0.001)));
  };
  dial.addEventListener("wheel", (e) => {
    e.preventDefault();
    step(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  dial.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") step(-1);
    else if (e.key === "Home" || e.key === "Delete") commit(0);
    else return;
    e.preventDefault();
  });
}

/** Mount the title bar button and its panel, and start the schedule. Called once from main.ts. */
// ── The Compass (COMPASS.md §2): arm, turn off, open the panel ──
/** A hand timer of `minutes` from now, as a turn of the dial would set. */
export function sleepIn(minutes: number): void {
  armClock(Date.now() + minutes * 60_000, false);
}
/** Turn the timer off, as the panel's Off does. */
export function sleepOff(): void {
  disarm("compass");
}
export const sleepArmed = (): boolean => mode !== "off";
/** Sleep at the end of this song, or of Up Next, as the panel's two chips do. */
export function sleepAtEnd(kind: "song" | "queue"): void {
  armEnd(kind);
}
/** Open the title bar panel (the alarm clock's). */
export function openSleepPanel(): void {
  dropdown?.open();
}

export function initSleep(): void {
  const root = $("sleep");
  const btn = $("sleep-btn");
  const panel = $("sleep-panel");
  const dial = $("sleep-dial");
  const ring = document.getElementById("sleep-ring") as SVGGElement | null;
  const readout = $("sleep-readout");
  const caption = $("sleep-caption");
  const wind = $("sleep-wind");
  const playout = $("sleep-playout");
  const sched = $("sleep-sched");
  const timeRow = $("sleep-time-row");
  const time = $("sleep-time");
  const status = $("sleep-status");
  const off = $("sleep-off");
  if (!root || !btn || !panel || !dial || !ring || !readout || !caption || !wind || !playout || !sched || !timeRow || !time || !status || !off) return;
  const chips = Array.from(panel.querySelectorAll<HTMLButtonElement>("[data-sleep-mode]"));
  els = { root, btn, panel, dial, ring, readout, caption, chips, wind, playout, sched, timeRow, time, status, off };

  btn.innerHTML = ICON;
  buildFace(ring);
  wireDial(dial);
  panel.dataset.frames = "sleep";
  dropdown = makeDropdown({
    root, trigger: btn, panel,
    shouldStayOpen: () => dragging,
    // The panel arrives as .pop; its parts slide in one after another (pop.ts), the
    // "Play on" panel's idiom. Only the parts that show.
    onOpen: () => enterRows(Array.from(panel.children).filter((el) => !(el as HTMLElement).hidden)),
  });
  // Off sits inside the dial: its press must not start a turn.
  off.addEventListener("pointerdown", (e) => e.stopPropagation());
  playout.addEventListener("click", () => setSetting("sleepPlayOut", !setting("sleepPlayOut")));

  chips.forEach((c) =>
    c.addEventListener("click", () => {
      const kind = c.dataset.sleepMode as "song" | "queue";
      if (mode === kind) disarm("chip");
      else armEnd(kind);
    }),
  );
  wind.addEventListener("click", () => {
    const i = WIND_STEPS.indexOf(setting("sleepWind"));
    setSetting("sleepWind", WIND_STEPS[(i + 1) % WIND_STEPS.length]);
  });
  sched.addEventListener("click", () => {
    const order: ("off" | "sun" | "clock")[] = ["off", "sun", "clock"];
    setSetting("sleepSchedule", order[(order.indexOf(setting("sleepSchedule")) + 1) % order.length]);
  });
  const shiftTime = (delta: number) => setSetting("sleepAt", toHHMM((toMinutes(setting("sleepAt")) + delta + 1440) % 1440));
  $("sleep-earlier")?.addEventListener("click", () => shiftTime(-15));
  $("sleep-later")?.addEventListener("click", () => shiftTime(15));
  off.addEventListener("click", () => disarm("button"));

  onSettingsChange((k) => {
    if (k !== "sleepSchedule" && k !== "sleepAt" && k !== "sleepWind" && k !== "sleepPlayOut") return;
    if (k === "sleepSchedule" || k === "sleepAt") {
      // A new schedule: tonight's skip and fire marks belong to the old one.
      skipMark = 0;
      firedMark = 0;
      if (fromSchedule) disarm("schedule");
    }
    ensureTicking();
    tick();
  });

  onPlayerState((s) => {
    playing = s.playing;
    onSongChange(s.title ? `${s.title} ${s.artist ?? ""} ${s.album ?? ""}` : "");
    updateFade();
    render();
  });
  onPlayerProgress((p) => onProgress(p.currentTime, p.duration));
  onVolumeChange(() => {
    if (ownVolumeWrite || mode === "off" || getDuck() >= 1) return;
    cancelByHand();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && interval) tick(); // back from sleep or the tray: catch up at once
  });

  ensureTicking();
  tick();
}

/** For the agent's now-playing line and the log: "" when off. */
export function sleepStatus(): string {
  return mode === "off" ? "" : hint();
}
