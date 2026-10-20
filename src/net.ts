// The Network button and its panel (docs/features/speedtest.md §7–§8, his calls 2026-10-19). The
// Max title bar button right of the Rewind button; the car from his drawing (2026-10-19). Each
// open drives it off to the right as the next one drives in from the left; each close, the
// other way (`drive`). The glyph turns the Bad color while the title says Bad (F3).
//
// The panel, top to bottom (his layout):
//   - the title line, "Network: Good" (Good · OK · Bad, his words), in the title face, bold;
//   - one bar per link for the last hour, one cell per minute: Internet, Wi-Fi, Apple Music,
//     Stream, AirPlay (Wi-Fi only on Wi-Fi, AirPlay only with a speaker in the hour). The
//     AirPlay row also draws its round trip and its resent share as two lines (N2 c);
//   - the Test row: the result on the left, the Test button on the right (net_test).
//
// What it reads (§8.1): the ping (`net_ping`, every 30 s, only while music plays, N3), the Wi-Fi
// signal (`net_wifi`, every 60 s while music plays, N5), Apple's calls by minute
// (`apple_calls_minutes`), and the feed (net-feed.ts): stalls, socket drops, AirPlay's counts,
// the fetch wrap's song pieces. Offline from the webview's own events. Nothing runs while the
// music is paused and the panel is shut: the bars fill from events then, and the ping waits.
// Everything stays in memory; the bars start empty at each launch.

import "./styles/net.css";
import { invoke } from "@tauri-apps/api/core";
import { makeDropdown, type DropdownHandle } from "./dropdown";
import { enterRows } from "./pop";
import { keepRightInWindow } from "./quick-panel";
import { currentSurface } from "./surface";
import { onPlayerState, streamKbps } from "./player";
import { onTrouble, type Trouble } from "./apple-health";
import { onNetNote, type AirplayStats, type NetNote } from "./net-feed";
import {
  emptyMinute, median, resendShare, pushRing, worst, titleVerdict, testVerdict,
  internetVerdict, wifiVerdict, appleVerdict, streamVerdict, airplayVerdict, VERDICT_WORDS,
  type Minute, type CellVerdict, type Verdict,
} from "./net-rules";
import * as diag from "./diag";
import { tokenMs } from "./boot-cover";

const HOUR = 60;
const PING_EVERY_MS = 30_000;
const PING_N = 3;
const WIFI_EVERY_MS = 60_000;
/** While the panel is open, its numbers are read again this often. */
const OPEN_EVERY_MS = 5_000;
/** A minute keeps at most this many song pieces (a song is about 10). */
const PIECES_PER_MINUTE = 100;

interface Ping { sent: number; rtts: number[] }
interface Wifi { quality: number; rxMbps: number }
interface SpeedTest { bytes: number; ms: number; mbps: number; ping: Ping }
interface AppleMinutes { minutes: { m: number; ok: number; bad: number }[]; backoffS: number | null }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const nowMin = () => Math.floor(Date.now() / 60_000);
const clock = (m: number) => new Date(m * 60_000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const mbpsText = (kbps: number) => (kbps >= 1000 ? `${(kbps / 1000).toFixed(kbps >= 10_000 ? 0 : 1)} Mbps` : `${Math.round(kbps)} kbps`);
const pct = (share: number) => `${(share * 100).toFixed(share < 0.01 ? 1 : 0)} %`;

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
let apSeen = false; // a speaker in the hour: its row shows
let wifiNow: Wifi | null = null;
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

const readWifi = async () => {
  try {
    wifiNow = await invoke<Wifi | null>("net_wifi");
    if (wifiNow) {
      const c = cur();
      c.wifi = Math.min(c.wifi ?? 100, wifiNow.quality);
    }
  } catch {
    wifiNow = null;
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

// ── the timers: only while music plays (the ping, N3; the Wi-Fi read, N5), and while the
//    panel is open (its numbers) ──
let pingTimer = 0;
let wifiTimer = 0;
let openTimer = 0;
function armPlaying(on: boolean): void {
  if (on === !!pingTimer) return;
  window.clearInterval(pingTimer);
  window.clearInterval(wifiTimer);
  pingTimer = wifiTimer = 0;
  diag.log("net:watch", { on });
  if (!on) return;
  void ping();
  void readWifi();
  pingTimer = window.setInterval(() => void ping(), PING_EVERY_MS);
  wifiTimer = window.setInterval(() => void readWifi(), WIFI_EVERY_MS);
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
    apSeen = true;
    // A new session starts its counts at 0: take this poll as the new base.
    if (was && was.speaker === ap.speaker && ap.packets >= was.packets) {
      c.apPackets += ap.packets - was.packets;
      c.apResends += Math.max(0, ap.resends - was.resends);
      c.apStarved += Math.max(0, ap.starved - was.starved);
    }
    if (ap.rttP95Ms > 0) c.apRtt = Math.max(c.apRtt ?? 0, ap.rttP95Ms);
    if (!was) paint();
    return; // every 2 s: the button repaints on the next ping, the open panel on its own beat
  }
  paint();
}

// ── the rows ──
interface Row {
  key: string;
  name: string;
  show: (h: Minute[]) => boolean;
  verdicts: (h: Minute[]) => CellVerdict[];
  /** The row's numbers now, right of its name. */
  now: (h: Minute[]) => string;
  /** One cell's hover hint, after its time. */
  cell: (c: Minute, i: number) => string;
  /** The line under a row that is Bad now, in the user's terms. */
  poor: string;
}

const appleOf = (m: number) => apple.minutes.find((a) => a.m === m) ?? { ok: 0, bad: 0 };
const last5 = (h: Minute[]) => h.slice(-5);

const ROWS: Row[] = [
  {
    key: "internet",
    name: "Internet",
    show: () => true,
    verdicts: (h) => h.map(internetVerdict),
    now: (h) => {
      if (!navigator.onLine) return "Offline";
      const recent = last5(h);
      const sent = recent.reduce((a, c) => a + c.pingSent, 0);
      if (!sent) return playing ? "Pinging…" : "Pings while music plays";
      const rtts = recent.flatMap((c) => c.rtts);
      const r = median(rtts);
      return `${r === null ? "–" : `${Math.round(r)} ms`} · ${pct((sent - rtts.length) / sent)} lost`;
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
    key: "wifi",
    name: "Wi-Fi",
    show: (h) => !!wifiNow || h.some((c) => c.wifi !== null),
    verdicts: (h) => h.map(wifiVerdict),
    now: () => (wifiNow ? `Signal ${wifiNow.quality} %${wifiNow.rxMbps ? ` · ${wifiNow.rxMbps} Mbps link` : ""}` : "Not on Wi-Fi now"),
    cell: (c) => (c.wifi === null ? "no reading" : `signal ${c.wifi} %`),
    poor: "The Wi-Fi signal is weak. Move closer to the router, or use a cable.",
  },
  {
    key: "apple",
    name: "Apple Music",
    show: () => true,
    verdicts: (h) => h.map((c) => (c.m === nowMin() && (appleTrouble === "app" || appleTrouble === "offline") ? "bad" : appleVerdict(appleOf(c.m).ok, appleOf(c.m).bad))),
    now: () => {
      if (apple.backoffS) return `Apple asked us to wait ${apple.backoffS} s`;
      if (appleTrouble === "app") return "Not answering";
      if (appleTrouble === "offline") return "Out of reach";
      const ok = apple.minutes.reduce((a, m) => a + m.ok, 0);
      const bad = apple.minutes.reduce((a, m) => a + m.bad, 0);
      return ok + bad ? `${plural(ok + bad, "call")} this hour${bad ? `, ${bad} failed` : ""}` : "No calls this hour";
    },
    cell: (c) => {
      const a = appleOf(c.m);
      return a.ok + a.bad ? `${plural(a.ok + a.bad, "call")}${a.bad ? `, ${a.bad} failed` : ""}` : "no calls";
    },
    poor: "Apple Music is slow to answer. DeetsMusic keeps trying.",
  },
  {
    key: "stream",
    name: "Stream",
    show: () => true,
    verdicts: (h) => h.map(streamVerdict),
    now: (h) => {
      const kbps = streamKbps();
      const stalls = h.reduce((a, c) => a + c.stalls, 0);
      const speed = median(h.flatMap((c) => c.pieceKbps).slice(-20));
      return [kbps ? `${kbps} kbps` : "", plural(stalls, "pause") + " this hour", speed ? `songs load at ${mbpsText(speed)}` : ""].filter(Boolean).join(" · ");
    },
    cell: (c) => {
      if (!c.playing && !c.stalls) return "not playing";
      const parts = [c.stalls ? `${plural(c.stalls, "pause")} to load (${Math.round(c.stallS)} s)` : "no pause"];
      const speed = median(c.pieceKbps);
      if (speed) parts.push(`songs load at ${mbpsText(speed)}`);
      return parts.join(" · ");
    },
    poor: "Songs pause to load. Settings › Playback › Stream quality › Low may help.",
  },
  {
    key: "airplay",
    name: "AirPlay",
    show: () => apSeen,
    verdicts: (h) => h.map(airplayVerdict),
    now: (h) => {
      if (!ap) return "No speaker now";
      const recent = last5(h);
      const share = resendShare({ apPackets: recent.reduce((a, c) => a + c.apPackets, 0), apResends: recent.reduce((a, c) => a + c.apResends, 0) });
      return `${ap.speaker} · ${Math.round(ap.rttP95Ms || ap.rttMs)} ms · ${share === null ? "–" : pct(share)} resent`;
    },
    cell: (c) => {
      const share = resendShare(c);
      if (share === null) return "no speaker";
      return `${pct(share)} resent${c.apStarved ? ` · ${plural(c.apStarved, "gap")} from this PC` : ""}${c.apRtt ? ` · ${Math.round(c.apRtt)} ms` : ""}`;
    },
    poor: "The speaker misses sound. Move it or the PC closer to the router.",
  },
];

/** The title's word: the worst of every row in the last five minutes. */
function verdictNow(h: Minute[]): Verdict {
  return titleVerdict(ROWS.filter((r) => r.show(h)).map((r) => r.verdicts(h)), navigator.onLine);
}

// ── the AirPlay lines (N2 c): the round trip and the resent share over the hour ──
function airplayLines(h: Minute[]): string {
  const rtts = h.map((c) => c.apRtt);
  const shares = h.map((c) => resendShare(c));
  const rttTop = Math.max(50, ...rtts.map((v) => v ?? 0));
  const shareTop = Math.max(0.02, ...shares.map((v) => v ?? 0));
  const line = (vs: (number | null)[], top: number) => {
    const segs: string[] = [];
    let seg: string[] = [];
    vs.forEach((v, i) => {
      if (v === null) {
        if (seg.length) segs.push(seg.join(" "));
        seg = [];
        return;
      }
      seg.push(`${i + 0.5},${(20 - (v / top) * 19).toFixed(2)}`);
    });
    if (seg.length) segs.push(seg.join(" "));
    // A lone point draws as a short dash, so one minute of data still shows.
    return segs.map((s) => (s.includes(" ") ? s : `${s} ${s.replace(/^([\d.]+)/, (x) => String(+x + 0.6))}`));
  };
  const poly = (cls: string, pts: string[]) => pts.map((p) => `<polyline class="${cls}" points="${p}" />`).join("");
  return (
    `<svg class="net__lines" viewBox="0 0 60 20" preserveAspectRatio="none" aria-hidden="true">` +
    poly("net__line-rtt", line(rtts, rttTop)) + poly("net__line-resend", line(shares, shareTop)) +
    `</svg><div class="net__keys"><span class="net__key" data-k="rtt">Round trip, up to ${Math.round(rttTop)} ms</span>` +
    `<span class="net__key" data-k="resend">Resent, up to ${pct(shareTop)}</span></div>`
  );
}

// ── the Test row ──
function testText(): { text: string; tone: string } {
  if (testing) return { text: "Testing…", tone: "" };
  if (!lastTest) return { text: "Pings our server, then downloads 2 MB", tone: "" };
  const ago = Math.round((Date.now() - lastTest.at) / 60_000);
  const when = ago < 1 ? "just now" : `${ago} min ago`;
  if ("err" in lastTest) return { text: `The test did not finish · ${when}`, tone: "bad" };
  const r = lastTest.r;
  const rtt = median(r.ping.rtts);
  const lost = r.ping.sent - r.ping.rtts.length;
  return {
    text: `${r.mbps >= 10 ? Math.round(r.mbps) : r.mbps.toFixed(1)} Mbps · ${rtt === null ? "–" : `${Math.round(rtt)} ms`}${lost ? ` · ${lost} lost` : ""} · ${when}`,
    tone: testVerdict(r.mbps),
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
          `<div class="net__row" data-row="${r.key}"><div class="net__head"><span class="net__name">${r.name}</span><span class="net__now"></span></div>` +
          `<div class="net__bar">${cells}</div>${r.key === "airplay" ? `<div class="net__graph"></div>` : ""}<div class="net__poor" hidden>${esc(r.poor)}</div></div>`,
      )
      .join("") +
    `<div class="net__axis" aria-hidden="true"><span>1 h ago</span><span>now</span></div>` +
    `<div class="set quick__rows"><div class="set__row net__test"><span class="net__result"></span>` +
    `<div class="set__split"><button class="set__half" type="button" data-net-test title="Pings support.deets.solutions, then downloads 2 MB from it. Nothing is kept">Test</button></div></div></div>`;
  shape = rows.map((r) => r.key).join();
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
  if (rows.map((r) => r.key).join() !== shape) build(rows);
  const word = panel.querySelector<HTMLElement>(".net__word")!;
  word.textContent = VERDICT_WORDS[v];
  word.dataset.tone = v;
  for (const r of rows) {
    const el = panel.querySelector<HTMLElement>(`[data-row="${r.key}"]`);
    if (!el) continue;
    const vs = r.verdicts(h);
    el.querySelector(".net__now")!.textContent = r.now(h);
    el.querySelectorAll<HTMLElement>(".net__cell").forEach((cell, i) => {
      const cv = vs[i];
      if (cell.dataset.v !== cv) cell.dataset.v = cv;
      const tip = `${clock(h[i].m)} · ${r.cell(h[i], i)}`;
      if (cell.title !== tip) cell.title = tip;
    });
    (el.querySelector(".net__poor") as HTMLElement).hidden = worst(vs.slice(-5)) !== "bad";
    const graph = el.querySelector(".net__graph");
    if (graph) graph.innerHTML = airplayLines(h);
  }
  const t = testText();
  const res = panel.querySelector<HTMLElement>(".net__result")!;
  res.textContent = t.text;
  if (t.tone) res.dataset.tone = t.tone;
  else delete res.dataset.tone;
  (panel.querySelector("[data-net-test]") as HTMLButtonElement).disabled = testing;
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
  });
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
      void Promise.all([readApple(), readWifi()]).then(paint);
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
