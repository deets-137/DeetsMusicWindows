// The fetch wrap's A/B on the DEV app (docs/features/speedtest.md §6; made 2026-10-19, his ask:
// "ensure we consistently test for any lag, performance, issues"). Run it on every change to
// src/fetch-wrap.ts, and before a release that carries one (RELEASE.md §0b).
//
//   node docs/ops/checks/fetch-wrap.mjs              20 cold starts with the wrap on, 20 off
//   … --n 10        starts per side (default 20)
//   … --block 5     starts in a row before the side changes: A B A B in turns (default 5)
//   … --port 47826  the dev app's bridge port (default: read from the dev log)
//
// Needs `npm run dev:built` (the honest build, CLAUDE.md › Graphics) running and signed in.
// Each block sets or clears `deets.dev.fetchWrap` and reloads the page; each start clears the
// webview's HTTP cache first, so every start is cold, then plays one song over the bridge at
// volume 0 and reads that play's `[perf] click→sound` and `[perf] fetchwrap` lines from the log.
//
// It prints the medians and the worst of each side, and the §6.2 table: PASS or FAIL per line.
// What it does not cover (by hand, §6.2): the song-to-song advance, the 20-minute play, memory.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const args = process.argv.slice(2);
const opt = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
const N = Number(opt("--n", 20)) || 20;
const BLOCK = Number(opt("--block", 5)) || 5;
const LOG = join(process.env.APPDATA, "com.deetsmusic.dev", "deetsmusic.log");
const SONGS = [
  "Bohemian Rhapsody Queen", "Dreams Fleetwood Mac", "Smells Like Teen Spirit Nirvana", "Billie Jean Michael Jackson",
  "Hey Ya OutKast", "Rolling in the Deep Adele", "Clocks Coldplay", "Levitating Dua Lipa", "Redbone Childish Gambino", "Mr. Brightside The Killers",
];

let bridge = opt("--port", null);
const logText = () => readFileSync(LOG, "latin1");
if (!bridge) bridge = [...logText().matchAll(/bridge: listening on 127\.0\.0\.1:(\d+)/g)].pop()?.[1] ?? null;
if (!bridge) throw new Error("no dev bridge port: pass --port");
const cli = (...a) => execFileSync(join(root, "cli", "dist", "deetsmusic.exe"), ["--port", bridge, ...a], { encoding: "utf8" }).trim();

// ── CDP to the main window ──
const gen = JSON.parse(readFileSync(join(root, "src-tauri", ".tauri.dev.gen.json"), "utf8"));
const port = /--remote-debugging-port=(\d+)/.exec(gen.app.windows.find((w) => w.label === "main")?.additionalBrowserArgs ?? "")?.[1];
const pageOf = async () => {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === "page" && !t.url.includes("tray.html") && /localhost|127\.0\.0\.1/.test(t.url));
  if (!page) throw new Error("no main-window page on the dev app's CDP port");
  return page;
};
let ws;
let next = 1;
const waiting = new Map();
const connect = async () => {
  ws = new WebSocket((await pageOf()).webSocketDebuggerUrl);
  await new Promise((ok, no) => ((ws.onopen = ok), (ws.onerror = no)));
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    waiting.get(msg.id)?.(msg);
    waiting.delete(msg.id);
  };
};
const send = (method, params = {}) =>
  new Promise((ok) => {
    const id = next++;
    waiting.set(id, ok);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evalJs = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function side(on) {
  await evalJs(on ? `localStorage.removeItem("deets.dev.fetchWrap")` : `localStorage.setItem("deets.dev.fetchWrap", "off")`);
  await evalJs("location.reload()").catch(() => {});
  ws.close();
  await sleep(8000); // the reload and the launch reads
  await connect();
  await send("Network.enable");
  const stats = await evalJs("JSON.stringify(window.__fetchWrap?.stats() ?? null)");
  const s = JSON.parse(stats ?? "null");
  if (on && !s?.on) throw new Error("the wrap is not on after the reload: is this a dev or dev:built app?");
  if (!on && s?.on) throw new Error("the wrap is still on with the flag set");
}

const PERF = /\[perf\] click→sound (\d+) ms.*?· stream (\d+|\?)/;
const EVENTS = /\b(deadNext|windowDry|misalign|desync|playbackError)\b/g;
async function start(song) {
  await send("Network.clearBrowserCache");
  const before = logText().length;
  cli("vol", "0");
  cli("play", song);
  await sleep(1500); // the perf line lands after `sound`
  const added = logText().slice(before);
  const line = [...added.matchAll(/^.*\[perf\] click→sound.*$/gm)].pop()?.[0];
  const wrap = [...added.matchAll(/\[perf\] fetchwrap (\{.*\})/g)].pop()?.[1];
  const m = line && PERF.exec(line);
  if (!m) return null;
  return { total: +m[1], stream: m[2] === "?" ? null : +m[2], events: [...added.matchAll(EVENTS)].map((e) => e[1]), wrap: wrap ? JSON.parse(wrap) : null };
}

const median = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

await connect();
const runs = { on: [], off: [] };
let k = 0;
while (runs.on.length < N || runs.off.length < N) {
  for (const on of [true, false]) {
    const list = on ? runs.on : runs.off;
    if (list.length >= N) continue;
    await side(on);
    for (let i = 0; i < BLOCK && list.length < N; i++) {
      const r = await start(SONGS[k++ % SONGS.length]);
      if (r) list.push(r);
      console.log(`${on ? "on " : "off"} ${list.length}/${N}: ${r ? `${r.total} ms, stream ${r.stream}${r.events.length ? `, ${r.events.join(" ")}` : ""}${r.wrap ? `, pieces ${r.wrap.pieces}, faults ${r.wrap.faults}` : ""}` : "no perf line"}`);
    }
  }
}
await evalJs(`localStorage.removeItem("deets.dev.fetchWrap")`); // the wrap back on, as shipped
cli("pause");

const sum = (rs) => ({
  total: median(rs.map((r) => r.total)), worst: Math.max(...rs.map((r) => r.total)),
  stream: median(rs.map((r) => r.stream)), events: rs.flatMap((r) => r.events),
});
const a = sum(runs.on);
const b = sum(runs.off);
const wraps = runs.on.map((r) => r.wrap).filter(Boolean);
const last = wraps[wraps.length - 1] ?? {};
const extra = a.events.filter((e) => !b.events.includes(e));
const rows = [
  ["click→sound median, on within 5 ms of off", `${a.total} vs ${b.total}`, a.total - b.total <= 5],
  ["click→sound worst, on within 5 ms of off", `${a.worst} vs ${b.worst}`, a.worst - b.worst <= 5],
  ["stream stage median, within 5 ms", `${a.stream} vs ${b.stream}`, a.stream - b.stream <= 5],
  ["no out-of-click event the off run lacks", extra.join(" ") || "none", extra.length === 0],
  ["0 wrap faults", String(last.faults ?? "?"), last.faults === 0],
  ["the wrap's own cost under 0.1 ms per call", String(last.costPerCallMs ?? "?"), (last.costPerCallMs ?? 1) < 0.1],
  ["the wrap saw the song's pieces (fetch, not XHR)", `${median(wraps.map((w) => w.pieces))} pieces, ${last.unseen ?? "?"} unseen`, median(wraps.map((w) => w.pieces)) > 0],
];
console.log("\n| Measure | On vs off | Pass |\n|---|---|---|");
for (const [what, got, ok] of rows) console.log(`| ${what} | ${got} | ${ok ? "PASS" : "FAIL"} |`);
ws.close();
process.exit(rows.every((r) => r[2]) ? 0 : 1);
