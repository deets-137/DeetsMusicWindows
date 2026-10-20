// The Network button and its panel (docs/features/speedtest.md §7–§8, his calls 2026-10-19). The
// Max title bar button right of the Rewind button; the car from his drawing (2026-10-19). Each
// open drives it off to the right as the next one drives in from the left; each close, the
// other way (`drive`). The glyph turns the Bad color while the title says Bad (F3).
//
// The panel, top to bottom (his layout):
//   - the title line, "Network: Good" (Good · OK · Bad, his words), in the title face, bold;
//   - one row per link: its name, its numbers as small tiles (a value over a short label, his
//     ask 2026-10-19: no line of parts joined by dots), and a bar for the last hour, one cell per
//     minute. Internet, AirPlay (once a speaker has played this session), Apple Music, Stream.
//     Wi-Fi and the AirPlay lines were taken out on 2026-10-19 (his call, speedtest.md §10);
//   - the Test row: the result as a tile on the left, the Test button on the right (net_test).
//
// What it reads (§8.1): the ping (`net_ping`, every 30 s, only while music plays, N3), Apple's
// calls by minute (`apple_calls_minutes`), and the feed (net-feed.ts): stalls, socket drops,
// AirPlay's counts,
// the fetch wrap's song pieces. Offline from the webview's own events. Nothing runs while the
// music is paused and the panel is shut: the bars fill from events then, and the ping waits.
// Everything stays in memory; the bars start empty at each launch.

import "./styles/net.css";
import { invoke } from "@tauri-apps/api/core";
import { makeDropdown, type DropdownHandle } from "./dropdown";
import { enterRows } from "./pop";
import { keepRightInWindow } from "./quick-panel";
import { currentSurface } from "./surface";
import { onPlayerState } from "./player";
import { onTrouble, type Trouble } from "./apple-health";
import { onNetNote, type AirplayStats, type NetNote } from "./net-feed";
import {
  emptyMinute, median, resendShare, pushRing, worst, titleVerdict, testVerdict,
  internetVerdict, appleVerdict, streamVerdict, airplayVerdict, VERDICT_WORDS,
  type Minute, type CellVerdict, type Verdict,
} from "./net-rules";
import * as diag from "./diag";
import { tokenMs } from "./boot-cover";
import * as frames from "./frames";

declare global {
  interface Window {
    /** The shots runner's handle on the dev app (DESK-TESTS.md §6): the AirPlay row's state, and
     *  `speakerPlayed`, which does what music on a speaker does to it (the row comes), so the
     *  panel's grow can be watched without playing music. Dev builds only. */
    __net?: {
      state: () => { apSeen: boolean; speaker: string | null; playing: boolean; rows: string };
      speakerPlayed: () => void;
    };
  }
}

const HOUR = 60;
const PING_EVERY_MS = 30_000;
const PING_N = 3;
/** While the panel is open, its numbers are read again this often. */
const OPEN_EVERY_MS = 5_000;
/** A minute keeps at most this many song pieces (a song is about 10). */
const PIECES_PER_MINUTE = 100;

interface Ping { sent: number; rtts: number[] }
interface SpeedTest { bytes: number; ms: number; mbps: number; ping: Ping }
interface AppleMinutes { minutes: { m: number; ok: number; bad: number }[]; backoffS: number | null }

const nowMin = () => Math.floor(Date.now() / 60_000);
const clock = (m: number) => new Date(m * 60_000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const mbpsText = (kbps: number) => (kbps >= 1000 ? `${(kbps / 1000).toFixed(kbps >= 10_000 ? 0 : 1)} Mbps` : `${Math.round(kbps)} kbps`);
const pct = (share: number) => `${(share * 100).toFixed(share < 0.01 ? 1 : 0)} %`;
/** Apple's wait in the largest unit that reads whole: "45 s", "12 min", "1 h". */
const waitText = (s: number) => (s < 120 ? `${s} s` : s < 2 * 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);

// ── the minutes ──
const minutes: Minute[] = [];
function cur(): Minute {
  const m = nowMin();
  let last = minutes[minutes.length - 1];
  if (!last || last.m !== m) {
    last = emptyMinute(m);
    pushRing(minutes, last, HOUR);
  }
  return last;
}
/** The last hour, one entry per minute, oldest first; a minute with no entry is empty. */
function hour(): Minute[] {
  const by = new Map(minutes.map((c) => [c.m, c]));
  const now = nowMin();
  return Array.from({ length: HOUR }, (_, i) => by.get(now - HOUR + 1 + i) ?? emptyMinute(now - HOUR + 1 + i));
}

let apple: AppleMinutes = { minutes: [], backoffS: null };
let appleTrouble: Trouble = "none";
let ap: AirplayStats | null = null; // the last AirPlay poll
let apSeen = false; // a speaker has played this session: its row shows
let playing = false;
let offlineSince: number | null = navigator.onLine ? null : nowMin();
let lastTest: { at: number; r: SpeedTest } | { at: number; err: string } | null = null;
let testing = false;
let pingFault = false;

const readApple = async () => {
  try {
    apple = await invoke<AppleMinutes>("apple_calls_minutes");
  } catch {
    /* an old build or the demo: the row stays empty */
  }
};

const ping = async () => {
  const c = cur();
  c.playing = true;
  try {
    const p = await invoke<Ping>("net_ping", { n: PING_N });
    c.pingSent += p.sent;
    c.rtts.push(...p.rtts);
  } catch (e) {
    // No address for the host is a link that cannot reach the internet: every echo is lost.
    if (/no (IPv4 )?address/.test(String(e))) c.pingSent += PING_N;
    else if (!pingFault) {
      pingFault = true;
      diag.warn("net:ping", { e: String(e).slice(0, 120) });
    }
  }
  await readApple();
  paint();
};

// ── the timers: only while music plays (the ping, N3), and while the panel is open (its
//    numbers) ──
let pingTimer = 0;
let openTimer = 0;
function armPlaying(on: boolean): void {
  if (on === !!pingTimer) return;
  window.clearInterval(pingTimer);
  pingTimer = 0;
  diag.log("net:watch", { on });
  if (!on) return;
  void ping();
  pingTimer = window.setInterval(() => void ping(), PING_EVERY_MS);
}

function onNote(n: NetNote): void {
  const c = cur();
  if (n.kind === "stall") {
    c.stalls++;
    c.stallS += n.s;
  } else if (n.kind === "drop") c.drops++;
  else if (n.kind === "piece") {
    if (c.pieceKbps.length < PIECES_PER_MINUTE) c.pieceKbps.push(n.kbps);
  } else if (n.kind === "airplay") {
    const was = ap;
    ap = n.stats;
    if (!ap) return void (was && paint());
    // The row comes once a speaker has PLAYED this session (his words, 2026-10-19): music
    // playing while a speaker is on. Not its packets: the sender streams silence to hold the
    // session, ~125 packets a second with nothing playing (measured 2026-10-19).
    const played = !apSeen && playing;
    if (played) apSeen = true;
    // A new session starts its counts at 0: take this poll as the new base.
    if (was && was.speaker === ap.speaker && ap.packets >= was.packets) {
      c.apPackets += ap.packets - was.packets;
      c.apResends += Math.max(0, ap.resends - was.resends);
      c.apStarved += Math.max(0, ap.starved - was.starved);
    }
    if (ap.rttP95Ms > 0) c.apRtt = Math.max(c.apRtt ?? 0, ap.rttP95Ms);
    if (!was || played) paint();
    return; // every 2 s: the button repaints on the next ping, the open panel on its own beat
  }
  paint();
}

// ── the rows ──
// A row shows one word, its status: Good, OK or Bad over the last five minutes, the title's
// own words; "–" while it has nothing to judge. The numbers and what they mean are the
// status's hover hint (his ask, 2026-10-19: minimal text, the reading on hover). The advice
// for a Bad row is the hint's last sentence.
interface Row {
  key: string;
  name: string;
  show: (h: Minute[]) => boolean;
  verdicts: (h: Minute[]) => CellVerdict[];
  /** The status's hover hint: the row's numbers now, in sentences. */
  hint: (h: Minute[]) => string;
  /** One cell's hover hint, after its time. */
  cell: (c: Minute, i: number) => string;
  /** The hint's last sentence while the row is Bad now, in the user's terms. */
  poor: string;
}

const appleOf = (m: number) => apple.minutes.find((a) => a.m === m) ?? { ok: 0, bad: 0 };
const last5 = (h: Minute[]) => h.slice(-5);

// The order (his call, 2026-10-19): AirPlay takes the place Wi-Fi had, under Internet.
const ROWS: Row[] = [
  {
    key: "internet",
    name: "Internet",
    show: () => true,
    verdicts: (h) => h.map(internetVerdict),
    hint: (h) => {
      if (!navigator.onLine) {
        const since = offlineSince === null ? 0 : nowMin() - offlineSince;
        return since < 1 ? "Offline." : `Offline for ${since} min.`;
      }
      const recent = last5(h);
      const sent = recent.reduce((a, c) => a + c.pingSent, 0);
      if (!sent) return playing ? "Checking the link." : "The link is checked every 30 s while music plays.";
      const rtts = recent.flatMap((c) => c.rtts);
      const r = median(rtts);
      return `${pct((sent - rtts.length) / sent)} of pings lost in the last 5 min${r === null ? "" : `, ${Math.round(r)} ms round trip`}.`;
    },
    cell: (c) => {
      if (c.offline) return "offline";
      const parts: string[] = [];
      if (c.pingSent) {
        const r = median(c.rtts);
        parts.push(`${c.rtts.length} of ${c.pingSent} pings back${r === null ? "" : ` · ${Math.round(r)} ms`}`);
      }
      if (c.drops) parts.push(plural(c.drops, "connection drop"));
      return parts.join(" · ") || "no ping (music paused)";
    },
    poor: "Songs may pause to load.",
  },
  {
    key: "airplay",
    name: "AirPlay",
    show: () => apSeen,
    verdicts: (h) => h.map(airplayVerdict),
    hint: (h) => {
      if (!ap) return "No speaker now.";
      const recent = last5(h);
      const share = resendShare({ apPackets: recent.reduce((a, c) => a + c.apPackets, 0), apResends: recent.reduce((a, c) => a + c.apResends, 0) });
      return `${ap.speaker}: ${share === null ? "no sound sent yet" : `${pct(share)} of the sound sent again`}, ${Math.round(ap.rttP95Ms || ap.rttMs)} ms round trip.`;
    },
    cell: (c) => {
      const share = resendShare(c);
      if (share === null) return "no speaker";
      return `${pct(share)} resent${c.apStarved ? ` · ${plural(c.apStarved, "gap")} from this PC` : ""}${c.apRtt ? ` · ${Math.round(c.apRtt)} ms` : ""}`;
    },
    poor: "The speaker misses sound. Move it or the PC closer to the router.",
  },
  {
    key: "apple",
    name: "Apple Music",
    show: () => true,
    verdicts: (h) => h.map((c) => (c.m === nowMin() && (appleTrouble === "app" || appleTrouble === "offline") ? "bad" : appleVerdict(appleOf(c.m).ok, appleOf(c.m).bad))),
    hint: () => {
      if (appleTrouble === "app") return "Apple Music is not answering.";
      if (appleTrouble === "offline") return "Apple Music is out of reach.";
      const ok = apple.minutes.reduce((a, m) => a + m.ok, 0);
      const bad = apple.minutes.reduce((a, m) => a + m.bad, 0);
      const calls = ok + bad ? `${bad ? `${bad} of ${plural(ok + bad, "call")}` : `None of ${plural(ok, "call")}`} to Apple failed this hour.` : "No calls to Apple this hour.";
      return apple.backoffS ? `${calls} Apple asked us to wait ${waitText(apple.backoffS)}.` : calls;
    },
    cell: (c) => {
      const a = appleOf(c.m);
      return a.ok + a.bad ? `${plural(a.ok + a.bad, "call")}${a.bad ? `, ${a.bad} failed` : ""}` : "no calls";
    },
    poor: "DeetsMusic keeps trying.",
  },
  {
    key: "stream",
    name: "Stream",
    show: () => true,
    verdicts: (h) => h.map(streamVerdict),
    hint: (h) => {
      const stalls = h.reduce((a, c) => a + c.stalls, 0);
      const speed = median(h.flatMap((c) => c.pieceKbps).slice(-20));
      return `${stalls ? `${plural(stalls, "pause")} to load` : "No pauses to load"} this hour.${speed ? ` Songs load at ${mbpsText(speed)}.` : ""}`;
    },
    cell: (c) => {
      if (!c.playing && !c.stalls) return "not playing";
      const parts = [c.stalls ? `${plural(c.stalls, "pause")} to load (${Math.round(c.stallS)} s)` : "no pause"];
      const speed = median(c.pieceKbps);
      if (speed) parts.push(`songs load at ${mbpsText(speed)}`);
      return parts.join(" · ");
    },
    poor: "Settings › Playback › Stream quality › Low may help.",
  },
];

/** The title's word: the worst of every row in the last five minutes. */
function verdictNow(h: Minute[]): Verdict {
  return titleVerdict(ROWS.filter((r) => r.show(h)).map((r) => r.verdicts(h)), navigator.onLine);
}

// ── the Test row ──
/** The Test's status (its speed judged as a stream needs it) and the numbers as its hint. */
function testStatus(): { word: string; tone: CellVerdict; hint: string } {
  if (testing) return { word: "Testing…", tone: "none", hint: "Pings our server, then downloads 2 MB." };
  if (!lastTest) return { word: "–", tone: "none", hint: "Test pings our server, then downloads 2 MB. Nothing is kept." };
  const ago = Math.round((Date.now() - lastTest.at) / 60_000);
  const when = ago < 1 ? "Just now" : `${ago} min ago`;
  if ("err" in lastTest) return { word: VERDICT_WORDS.bad, tone: "bad", hint: `${when}: the test did not finish.` };
  const r = lastTest.r;
  const rtt = median(r.ping.rtts);
  const lost = r.ping.sent - r.ping.rtts.length;
  const v = testVerdict(r.mbps);
  return {
    word: VERDICT_WORDS[v],
    tone: v,
    hint: `${when}: ${r.mbps >= 10 ? Math.round(r.mbps) : r.mbps.toFixed(1)} Mbps down, ${rtt === null ? "no ping back" : `${Math.round(rtt)} ms round trip`}${lost ? `, ${lost} of ${r.ping.sent} pings lost` : ""}.`,
  };
}

async function runTest(): Promise<void> {
  if (testing) return;
  testing = true;
  paint();
  diag.log("net:test", { phase: "start" });
  try {
    const r = await invoke<SpeedTest>("net_test");
    lastTest = { at: Date.now(), r };
    const c = cur();
    c.pingSent += r.ping.sent;
    c.rtts.push(...r.ping.rtts);
    diag.log("net:test", { mbps: +r.mbps.toFixed(2), bytes: r.bytes, ms: r.ms, back: r.ping.rtts.length, sent: r.ping.sent });
  } catch (e) {
    lastTest = { at: Date.now(), err: String(e) };
    diag.warn("net:test", { e: String(e).slice(0, 160) });
  }
  testing = false;
  paint();
}

// ── paint ──
let root: HTMLElement | null = null;
let btn: HTMLElement | null = null;
let panel: HTMLElement | null = null;
let dropdown: DropdownHandle | null = null;
let shape = ""; // the rows the panel was built with; a change rebuilds it
let wasVerdict: Verdict | null = null;

function build(rows: Row[]): void {
  if (!panel) return;
  const cells = Array.from({ length: HOUR }, () => `<i class="net__cell"></i>`).join("");
  panel.innerHTML =
    `<div class="net__title">Network: <span class="net__word"></span></div>` +
    rows
      .map(
        (r) =>
          `<div class="net__row" data-row="${r.key}"><div class="net__head"><span class="net__name">${r.name}</span><span class="net__status"></span></div>` +
          `<div class="net__bar">${cells}</div></div>`,
      )
      .join("") +
    `<div class="net__axis" aria-hidden="true"><span>1 h ago</span><span>now</span></div>` +
    `<div class="set quick__rows"><div class="set__row net__test"><span class="net__name">Speed</span><span class="net__status net__result"></span>` +
    `<div class="set__split"><button class="set__half" type="button" data-net-test title="Pings support.deets.solutions, then downloads 2 MB from it. Nothing is kept">Test</button></div></div></div>`;
  shape = rows.map((r) => r.key).join();
}

/** A status word, its tone and its hover hint, each written only when it changed. */
function setStatus(el: HTMLElement, word: string, tone: CellVerdict, hint: string): void {
  if (el.textContent !== word) el.textContent = word;
  if (el.dataset.tone !== tone) el.dataset.tone = tone;
  if (el.dataset.hint !== hint) el.title = hint; // hint.ts moves `title` to `data-hint`
}

/** Repaint the button, and the panel when it is open. Cheap: no call, no new element unless a
 *  row comes or goes. */
function paint(): void {
  if (!root || !btn) return;
  const h = hour();
  const v = verdictNow(h);
  if (v !== wasVerdict) {
    btn.dataset.tone = v;
    btn.title = `Network: ${VERDICT_WORDS[v]}`;
    if (wasVerdict !== null) diag.log("net:verdict", { from: wasVerdict, to: v });
    wasVerdict = v;
  }
  if (!panel || panel.hidden) return;
  const rows = ROWS.filter((r) => r.show(h));
  // A row that comes while the panel is open (AirPlay, the first time a speaker plays this
  // session) opens its own room and fades in (his ask, 2026-10-19). The first build at an open
  // has nothing to grow from.
  let came: string[] = [];
  const keys = rows.map((r) => r.key).join();
  if (keys !== shape) {
    if (shape) {
      const had = new Set(shape.split(","));
      came = rows.map((r) => r.key).filter((k) => !had.has(k));
    }
    build(rows);
  }
  const word = panel.querySelector<HTMLElement>(".net__word")!;
  word.textContent = VERDICT_WORDS[v];
  word.dataset.tone = v;
  for (const r of rows) {
    const el = panel.querySelector<HTMLElement>(`[data-row="${r.key}"]`);
    if (!el) continue;
    const vs = r.verdicts(h);
    // Offline now is Bad at once, as the title is, before a minute of it has been judged.
    const now = r.key === "internet" && !navigator.onLine ? "bad" : worst(vs.slice(-5));
    const hint = now === "bad" ? `${r.hint(h)} ${r.poor}` : r.hint(h);
    setStatus(el.querySelector<HTMLElement>(".net__status")!, now === "none" ? "–" : VERDICT_WORDS[now], now, hint);
    el.querySelectorAll<HTMLElement>(".net__cell").forEach((cell, i) => {
      const cv = vs[i];
      if (cell.dataset.v !== cv) cell.dataset.v = cv;
      const tip = `${clock(h[i].m)} · ${r.cell(h[i], i)}`;
      if (cell.dataset.hint !== tip) cell.title = tip;
    });
  }
  const t = testStatus();
  setStatus(panel.querySelector<HTMLElement>(".net__result")!, t.word, t.tone, t.hint);
  (panel.querySelector("[data-net-test]") as HTMLButtonElement).disabled = testing;
  if (came.length) {
    const els = came.map((k) => panel!.querySelector<HTMLElement>(`[data-row="${k}"]`)).filter((el): el is HTMLElement => !!el);
    openRoom(els);
    enterRows(els);
    diag.log("net:row", { came });
  }
}

// ── a new row opens its own room ──
// AirPlay comes in the middle of the panel, so the panel's height alone could not hide the
// change: the rows under it moved down in one frame while the panel's edge glided (the shots,
// 2026-10-19). The row grows from nothing, with the panel's gap above it, on --pop-grow and
// --pop-ease (the panels' grow), so the rows under it glide down and the panel follows.
function openRoom(els: HTMLElement[]): void {
  if (!panel || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const gap = parseFloat(getComputedStyle(panel).rowGap) || 0;
  const opts = { duration: tokenMs("--pop-grow"), easing: getComputedStyle(panel).getPropertyValue("--pop-ease").trim() || "ease" };
  frames.during("fold", 250, "open");
  for (const el of els) {
    const h = el.offsetHeight;
    el.style.overflow = "hidden";
    el.animate([{ height: "0px", marginTop: `${-gap}px` }, { height: `${h}px`, marginTop: "0px" }], opts).onfinish = () => {
      el.style.overflow = "";
    };
  }
}

/** Open the panel (the Compass's row, COMPASS.md §9). Max only, as its button. */
export function openNetworkPanel(): void {
  if (currentSurface() !== "max") return;
  dropdown?.open();
}

export function initNetwork(): void {
  root = document.getElementById("net");
  btn = document.getElementById("net-open");
  panel = document.getElementById("net-panel");
  if (!root || !btn || !panel) return;
  root.hidden = false;

  onNetNote(onNote);
  onPlayerState((s) => {
    playing = s.playing;
    if (playing) cur().playing = true;
    armPlaying(playing);
    // Music with a speaker already on: that speaker has played (the row's rule, onNote).
    if (playing && ap && !apSeen) {
      apSeen = true;
      paint();
    }
  });
  // `?.`: the unit tests load this module in Node, where `import.meta.env` does not exist.
  if (import.meta.env?.DEV)
    window.__net = {
      state: () => ({ apSeen, speaker: ap?.speaker ?? null, playing, rows: shape }),
      speakerPlayed: () => {
        apSeen = true;
        paint();
      },
    };
  onTrouble((t) => {
    appleTrouble = t;
    paint();
  });
  window.addEventListener("offline", () => {
    offlineSince = nowMin();
    cur().offline = true;
    diag.log("net:offline", {});
    paint();
  });
  window.addEventListener("online", () => {
    // Every minute of the drop is marked, though nothing ran in them.
    const from = offlineSince ?? nowMin();
    for (let m = Math.max(from, nowMin() - HOUR + 1); m <= nowMin(); m++) {
      let c = minutes.find((x) => x.m === m);
      if (!c) {
        c = emptyMinute(m);
        minutes.push(c);
      }
      c.offline = true;
    }
    minutes.sort((a, b) => a.m - b.m);
    if (minutes.length > HOUR) minutes.splice(0, minutes.length - HOUR);
    diag.log("net:online", { minutes: nowMin() - from + 1 });
    offlineSince = null;
    paint();
  });

  panel.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-net-test]")) void runTest();
  });

  dropdown = makeDropdown({
    root,
    trigger: btn,
    panel,
    onOpen: () => {
      shape = "";
      paint();
      keepRightInWindow(root!, panel!);
      enterRows(panel!.children);
      diag.log("net:open", { verdict: wasVerdict });
      void readApple().then(paint);
      window.clearInterval(openTimer);
      openTimer = window.setInterval(() => {
        if (panel!.hidden) return void window.clearInterval(openTimer);
        void readApple().then(paint);
      }, OPEN_EVERY_MS);
    },
  });
  window.addEventListener("resize", () => { if (panel && !panel.hidden) keepRightInWindow(root!, panel); });

  // The car drives (his ask, 2026-10-19), as the updates arrows roll: on an open it leaves to the
  // right, out of the glyph's box, and the next one comes in from the left; on a close, the
  // other way. By any path (the button, a click away, Escape, the Compass). A close of a panel
  // that was already shut sets `hidden` again, so only a real change drives it.
  let shut = panel.hidden;
  new MutationObserver(() => {
    if (panel!.hidden === shut) return;
    shut = panel!.hidden;
    drive(shut ? -1 : 1);
  }).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  paint();
}

/** One drive of the car: `dir` 1 leaves to the right, −1 to the left. The exit on the app's own
 *  curve, the entry on the roll's (the Compass needle's overshoot, a car settling as it stops). */
function drive(dir: 1 | -1): void {
  const car = btn?.querySelector(".net__car");
  if (!car || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cs = getComputedStyle(document.documentElement);
  const x = parseFloat(cs.getPropertyValue("--net-drive-x")) || 0;
  const enter = cs.getPropertyValue("--net-drive").trim().replace(/^\S+\s*/, "") || "ease";
  const leave = cs.getPropertyValue("--ease-ui").trim() || "ease";
  car.getAnimations().forEach((a) => a.cancel());
  car.animate(
    [
      { transform: "translateX(0)", opacity: 1, easing: leave },
      { transform: `translateX(${dir * x}px)`, opacity: 0, offset: 0.4 },
      { transform: `translateX(${-dir * x}px)`, opacity: 0, offset: 0.4, easing: enter },
      { transform: "translateX(0)", opacity: 1 },
    ],
    { duration: tokenMs("--net-drive") },
  );
}
