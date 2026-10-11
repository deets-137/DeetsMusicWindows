#!/usr/bin/env node
// The judge (music-app-comp.md §17.1, M3): runs a scene on each app's profile through the
// sensor (tools/deetsmeter), N passes in alternating order, and turns the events into rows.
//
//   node scripts/compare/run.mjs [--scene play] [--passes 3] [--apps deets,apple]
//                                [--against <results csv>] [--dry]
//
// Every scene that plays sound plays the owner's music ALOUD: he runs those (§17.11).
// Output: scripts/compare/results/<stamp>/ (each pass's steps.json + the sensor's events)
// and scripts/compare/results/<stamp>.csv (§14's columns plus the range and quartiles).
import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { inputTimings, startTimings, sceneRows, startRows, cpuBusy, mark, FLOORS } from "./metrics.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const sensor = join(root, "tools/deetsmeter/target/release/deetsmeter.exe");

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const scene = opt("scene", "play");
const cold = args.includes("--cold");
// A cold start is one pass per reboot (§1.5); its passes add up across boots (coldHistory).
const passes = cold ? 1 : Number(opt("passes", "3"));
/** A cold pass must start this soon after the boot, before anything warms the app's files. */
const COLD_UPTIME_MAX_S = 15 * 60;
const apps = opt("apps", "deets,apple").split(",");
const against = opt("against", null);
const dry = args.includes("--dry");

/** The machine's CPU must be quiet before a pass (§3: idle CPU ≤ 5 %). */
const IDLE_MAX = 0.05;
/** A pass waits this long for a quiet machine, then runs and is flagged busy. */
const IDLE_WAIT_MS = 30_000;

// ── Scenes: a profile in, the sensor's step list out. Names come from the profile, so one
// scene drives both apps the same way (UI Automation presses, option A, §17.11).
const SCENES = {
  // §4 scene 4 without the seek: Play → sound, Next ×3 → sound, Pause. The app must be
  // paused at the start (an app that plays has "Pause", not "Play": nothing is pressed).
  play: (p) => {
    const steps = [
      { do: "attach" },
      { do: "wait_window", timeout_ms: 2000 },
      { do: "place", ...p.place },
      { do: "listen", also: p.also },
      { do: "wait", ms: 800 },
      { do: "invoke", names: p.buttons.play, probe: "self", tag: "play" },
      { do: "wait_sound", timeout_ms: 8000 },
      { do: "wait", ms: 2000 },
    ];
    for (let i = 1; i <= 3; i++) {
      steps.push({ do: "invoke", names: p.buttons.next, tag: `next${i}` }, { do: "wait_sound", timeout_ms: 8000 }, { do: "wait", ms: 2000 });
    }
    steps.push({ do: "invoke", names: p.buttons.pause, probe: "self", tag: "pause" }, { do: "wait", ms: 800 });
    return { steps };
  },
  // §4 scene 6: a real wheel over the song list (his call, 2026-10-10: the pointer goes to the
  // left monitor for about 2 s and the sensor puts it back). Five notches down, settle, five
  // up, settle. Timed in the `list` probe: first change, settled, fps, dropped, p99.
  scroll: (p) => {
    const s = p.scroll;
    const wheel = (delta, tag) => ({ do: "wheel", at: s.at, delta, count: s.notches ?? 5, every_ms: s.every_ms ?? 30, tag, probe: "list" });
    const settle = { do: "settle", quiet_ms: 500, timeout_ms: 5000, probe: "list" };
    return {
      probes: { list: s.probe },
      steps: [
        { do: "attach" },
        { do: "wait_window", timeout_ms: 2000 },
        { do: "place", ...p.place },
        { do: "wait", ms: 800 },
        wheel(-120, "down"),
        settle,
        wheel(120, "up"),
        settle,
        { do: "park" },
      ],
    };
  },
};

// §4 scene 7: the query is typed with real keys (his call, 2026-10-10: the tool takes the
// focus for about a second and gives it back). Five rounds of clear → type → settle, timed
// from the LAST key in the `results` probe: our results list, Apple's suggestion list (his
// call: typed only is scored). Apple's Enter → full page is one more round in the `page`
// probe, reported and not scored. The profile's `open` steps bring up the box, its `after`
// steps put the app back the way it was.
SCENES.search = (p) => {
  const s = p.search;
  const steps = [
    { do: "attach" },
    { do: "wait_window", timeout_ms: 2000 },
    { do: "place", ...p.place },
    { do: "wait", ms: 600 },
    { do: "focus" },
    ...s.open,
    { do: "wait", ms: 800 },
  ];
  for (let i = 1; i <= 5; i++) {
    steps.push(
      { do: "key", key: "ctrl+a" },
      { do: "key", key: "backspace" },
      { do: "settle", quiet_ms: 500, timeout_ms: 3000, probe: "results" },
      { do: "text", text: SEARCH_QUERY, every_ms: 60, tag: `search${i}`, probe: "results" },
      { do: "settle", quiet_ms: 500, timeout_ms: 5000, probe: "results" },
    );
  }
  if (s.enter) {
    steps.push({ do: "key", key: "enter", tag: "enter", probe: "page" }, { do: "settle", quiet_ms: 500, timeout_ms: 5000, probe: "page" });
  }
  steps.push(...(s.after ?? []), { do: "park" });
  return { probes: { results: s.results, ...(s.enter ? { page: s.enter.page } : {}) }, steps };
};
/** One fixed query for both apps: an artist in the owner's library and in Apple's catalog. */
const SEARCH_QUERY = "Alina Baraz";

// §4 scenes 1–2 and 13 (his call, 2026-10-10: warm and cold). Warm: the app is placed on the
// left monitor, closed (close → gone), started again 3 s later (§1.5: a second start within
// a minute), and timed to its window, its first content and its settle in the `content`
// probe. It reopens where it was closed, so the window is lifted the moment it is found and
// the frames from then on are the app's (startTimings). Cold (`--cold`): right after a
// reboot, the app not yet started since; one pass per boot, moved into place after it shows.
SCENES.start = (p) => {
  const s = p.start;
  const startSteps = [
    { do: "launch" },
    { do: "wait_window", timeout_ms: 30000, lift: true },
    cold ? { do: "place", ...p.place } : { do: "place" },
    { do: "settle", quiet_ms: 500, timeout_ms: 20000, probe: "content", content: true },
    { do: "snap", tag: "started" },
  ];
  const steps = cold
    ? startSteps
    : [
        { do: "attach" },
        { do: "wait_window", timeout_ms: 2000 },
        { do: "place", ...p.place },
        { do: "wait", ms: 800 },
        { do: "close" },
        { do: "wait_gone", timeout_ms: 15000 },
        { do: "wait", ms: 3000 },
        ...startSteps,
      ];
  return { app: { attach: p.attach, ...s.launch }, probes: { content: s.content }, steps };
};

// ── DeetsMusic's bridge (AGENT.md): the installed app is found by the PORT'S OWNER, never
// by the version (a dev app answers with the same one, often on the next port).
function deetsPids(attach) {
  const r = spawnSync(sensor, ["find", attach], { encoding: "utf8" });
  const m = (r.stdout ?? "").match(/pids \[([\d, ]*)\]/);
  return m ? m[1].split(",").map((x) => Number(x.trim())).filter(Boolean) : [];
}
function deetsBridge(attach) {
  const pids = deetsPids(attach);
  const net = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
  for (const l of net.split("\n")) {
    const m = l.match(/127\.0\.0\.1:(4782[5-8])\s+\S+\s+LISTENING\s+(\d+)/);
    if (m && pids.includes(Number(m[2]))) {
      const token = JSON.parse(readFileSync(join(process.env.APPDATA, "com.deetsmusic.app", "settings.json"), "utf8")).bridgeToken;
      return { port: Number(m[1]), token };
    }
  }
  return null;
}
async function bridgeCall(b, path, body) {
  const r = await fetch(`http://127.0.0.1:${b.port}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${b.token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return r.json();
}
/** Set a setting through the bridge; under "Ask" the owner approves it in the app (60 s). */
async function deetsSetting(attach, key, value) {
  const b = deetsBridge(attach);
  if (!b) throw new Error("the installed DeetsMusic's bridge was not found");
  const now = (await bridgeCall(b, "/settings", { action: "get", key })).row?.value;
  if (now === value) return now;
  const r = await bridgeCall(b, "/settings", { action: "set", key, value });
  if (r.pending) console.log(`  DeetsMusic asks you to allow "${key} ${value}": answer in the app.`);
  for (let i = 0; i < 60; i++) {
    if ((await bridgeCall(b, "/settings", { action: "get", key })).row?.value === value) return now;
    await sleep(1000);
  }
  throw new Error(`${key} did not become ${value} (not allowed in the app?)`);
}

/**
 * The cards a DeetsMusic window shows, read from its grow buttons' accessible names
 * ("Widen Playlists over Settings", "Fill the window with Rewind", "Make Settings taller,
 * over Rewind", "Collapse Rewind back to its place"). A profile's `expectCards` must all be
 * there: a profile names its layout (§17.9), and a different layout times a different screen.
 */
function cardsShown(uiaText) {
  const cards = new Set();
  for (const m of uiaText.matchAll(/"([^"]+)"/g)) {
    const n = m[1];
    let r;
    if ((r = n.match(/^Fill the window with (.+)$/))) cards.add(r[1]);
    else if ((r = n.match(/^Widen (.+?) over (.+)$/))) cards.add(r[1]).add(r[2]);
    else if ((r = n.match(/^Make (.+?) (?:taller|shorter|wider|narrower), over (.+)$/))) cards.add(r[1]).add(r[2]);
    else if ((r = n.match(/^Collapse (.+?) back to its place$/))) cards.add(r[1]);
  }
  return cards;
}

if (!SCENES[scene]) {
  console.error(`no scene "${scene}"; scenes: ${Object.keys(SCENES).join(", ")}`);
  process.exit(2);
}
if (!existsSync(sensor)) {
  console.error(`no sensor at ${sensor}: cargo build --release --offline in tools/deetsmeter`);
  process.exit(2);
}

const ps = (cmd) => {
  try {
    return execFileSync("powershell.exe", ["-NoProfile", "-Command", cmd], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

const profiles = Object.fromEntries(apps.map((a) => [a, JSON.parse(readFileSync(join(here, "profiles", `${a}.json`), "utf8"))]));
for (const p of Object.values(profiles)) p.versionNow = ps(p.version);
for (const [a, p] of Object.entries(profiles)) {
  const missing = [];
  if (!p[scene] && scene !== "play") missing.push(`the profile has no "${scene}" block (coordinates and probe)`);
  if (cold && scene !== "start") missing.push("--cold is for the start scene only");
  if (cold && !dry && os.uptime() > COLD_UPTIME_MAX_S) missing.push(`a cold start needs a fresh boot: Windows has been up ${Math.round(os.uptime() / 60)} min (restart, sign in, and run this within ${COLD_UPTIME_MAX_S / 60} min)`);
  if (cold && !dry && spawnSync(sensor, ["find", p.attach], { encoding: "utf8" }).stdout?.includes("pid ")) {
    missing.push(`it is already running, so its files are warm (Start with Windows? quit it, then restart Windows)`);
  }
  if (p.expectCards?.length && !dry && !cold) {
    const r = spawnSync(sensor, ["uia", p.attach], { encoding: "utf8" });
    const shown = cardsShown(r.stdout ?? "");
    const lack = p.expectCards.filter((c) => !shown.has(c));
    if (lack.length) missing.push(`cards not on screen: ${lack.join(", ")} (it shows ${[...shown].join(", ") || "none"}; set ${p.layout ?? "the profile's layout"} by hand)`);
  }
  if (missing.length) {
    console.error(`${p.name}: not ready — ${missing.join("; ")}. Nothing was run.`);
    process.exit(2);
  }
}

// What moved under us (§13): recorded beside every row.
const machine = {
  windows_build: os.release(),
  webview2: ps("(Get-ItemProperty 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}').pv"),
  gpu_driver: ps("(Get-CimInstance Win32_VideoController | Sort-Object AdapterRAM -Descending | Select-Object -First 1).DriverVersion"),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function idleGate() {
  const start = Date.now();
  let busy = 1;
  while (Date.now() - start < IDLE_WAIT_MS) {
    const a = os.cpus();
    await sleep(2000);
    busy = cpuBusy(a, os.cpus());
    if (busy <= IDLE_MAX) break;
  }
  return busy;
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outRoot = join(here, "results", stamp);
mkdirSync(outRoot, { recursive: true });
console.log(`compare ${scene} · ${passes} pass(es) · ${apps.map((a) => `${profiles[a].name} ${profiles[a].versionNow}`).join(" vs ")}`);
console.log(`  windows ${machine.windows_build} · webview2 ${machine.webview2} · gpu driver ${machine.gpu_driver}`);

// The skin of each app's row (§13): ours from the bridge, Apple's has none.
for (const [a, p] of Object.entries(profiles)) {
  p.skinNow = "";
  if (p.bridge && !dry) {
    const b = deetsBridge(p.attach);
    if (b) p.skinNow = (await (await fetch(`http://127.0.0.1:${b.port}/health`)).json()).skin ?? "";
  }
}

// A warm start closes the app: ours only quits with Close to tray off (his call: the judge
// turns it off and back on). Put back on every way out, a failure or Ctrl+C included.
const putBack = [];
async function restoreSettings() {
  while (putBack.length) {
    const { a, key, value } = putBack.pop();
    try {
      await deetsSetting(profiles[a].attach, key, value);
      console.log(`  ${profiles[a].name}: ${key} is back to ${value}`);
    } catch (e) {
      console.error(`  ${profiles[a].name}: could not put ${key} back to ${value} (${e.message}): set it by hand`);
    }
  }
}
process.on("SIGINT", async () => {
  await restoreSettings();
  process.exit(130);
});
if (scene === "start" && !cold && !dry) {
  for (const [a, p] of Object.entries(profiles)) {
    if (!p.start?.closeToTray) continue;
    try {
      const was = await deetsSetting(p.attach, "closeToTray", "off");
      if (was !== "off") putBack.push({ a, key: "closeToTray", value: was });
    } catch (e) {
      console.error(`${p.name}: ${e.message}. Nothing was run.`);
      process.exit(2);
    }
  }
}

// Cold passes add up across boots, one per boot: kept per app beside the results.
const coldFile = (a) => join(here, "results", `cold-${a}.jsonl`);
const coldHistory = (a) => (existsSync(coldFile(a)) ? readFileSync(coldFile(a), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

const results = Object.fromEntries(apps.map((a) => [a, { passes: [], busy: [], failed: 0, hz: null }]));
for (let n = 0; n < passes; n++) {
  // Alternate the order, so neither app always goes second (§4); a cold run alternates by boot.
  const flip = cold ? coldHistory(apps[0]).length % 2 === 1 : n % 2 === 1;
  const order = flip ? [...apps].reverse() : apps;
  for (const a of order) {
    const p = profiles[a];
    const dir = join(outRoot, `${a}-p${n + 1}`);
    mkdirSync(dir, { recursive: true });
    const stepsFile = join(dir, "steps.json");
    const { steps, probes, app } = SCENES[scene](p);
    writeFileSync(stepsFile, JSON.stringify({ app: app ?? { attach: p.attach }, ...(probes ? { probes } : {}), steps }, null, 2));
    if (dry) {
      console.log(`  pass ${n + 1} ${p.name}: ${stepsFile} (dry: not run)`);
      continue;
    }
    const busy = await idleGate();
    const r = spawnSync(sensor, ["run", stepsFile, "--out", dir], { encoding: "utf8" });
    writeFileSync(join(dir, "summary.txt"), (r.stdout ?? "") + (r.stderr ?? ""));
    const evFile = join(dir, "events.jsonl");
    const events = existsSync(evFile)
      ? readFileSync(evFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
      : [];
    const failed = r.status !== 0 || events.some((e) => e.ev === "step-failed");
    const timings = scene === "start" ? startTimings(events) : inputTimings(events);
    results[a].hz ??= events.find((e) => e.ev === "output")?.hz ?? null;
    results[a].busy.push(busy);
    if (failed) {
      results[a].failed++;
      const why = events.find((e) => e.ev === "step-failed")?.why ?? (r.stderr || "").trim().split("\n").pop();
      console.log(`  pass ${n + 1} ${p.name}: FAILED (${why}) — ${dir}`);
      continue;
    }
    results[a].passes.push(timings);
    if (scene === "start") {
      const f = (v) => (v == null ? "—" : `${v.toFixed(0)} ms`);
      console.log(`  pass ${n + 1} ${p.name}${busy > IDLE_MAX ? ` (busy ${(busy * 100).toFixed(1)} %)` : ""}: ${cold ? "" : `close → gone ${f(timings.quitMs)} · `}window ${f(timings.windowMs)} · content ${f(timings.contentMs)} · settled ${f(timings.settledMs)}`);
      if (cold) writeFileSync(coldFile(a), JSON.stringify({ when: new Date().toISOString(), version: p.versionNow, uptime_s: Math.round(os.uptime()), ...timings }) + "\n", { flag: "a" });
      continue;
    }
    const line = timings
      .filter((x) => x.tag)
      .map((x) => `${x.tag} ${x.soundMs != null ? `♪${x.soundMs.toFixed(0)}` : ""}${x.changeMs != null ? ` ▣${x.changeMs.toFixed(0)}` : ""}`)
      .join(" · ");
    console.log(`  pass ${n + 1} ${p.name}${busy > IDLE_MAX ? ` (busy ${(busy * 100).toFixed(1)} %)` : ""}: ${line}`);
  }
}
await restoreSettings();
if (dry) process.exit(0);

// ── Rows, the CSV, the tables.
const prevRows = new Map();
if (against) {
  const [head, ...lines] = readFileSync(against, "utf8").trim().split("\n");
  const cols = head.split(",");
  for (const l of lines) {
    const v = Object.fromEntries(l.split(",").map((x, i) => [cols[i], x]));
    const num = (k) => (v[k] === "" ? null : Number(v[k]));
    prevRows.set(`${v.app}|${v.metric}`, { n: num("n"), median: num("median"), min: num("min"), max: num("max"), q1: num("q1"), q3: num("q3"), noisy: v.noisy === "1" });
  }
}

const cols = ["when", "app", "version", "metric", "scene", "median", "spread", "passes", "n", "min", "max", "q1", "q3", "noisy", "busy_passes", "webview2", "gpu_driver", "musickit", "windows_build", "songs", "hz", "skin", "mark"];
const csv = [cols.join(",")];
const table = [];
const fmt = (v) => (v == null ? "" : Number.isInteger(v) ? String(v) : v.toFixed(1));
for (const a of apps) {
  const res = results[a];
  const busyPasses = res.busy.filter((b) => b > IDLE_MAX).length;
  const rows =
    scene === "start"
      ? cold
        ? startRows(coldHistory(a), "cold start")
        : startRows(res.passes, "warm start")
      : sceneRows(res.passes, { motion: scene === "scroll" ? ["down", "up"] : [] });
  for (const row of rows) {
    const prev = prevRows.get(`${a}|${row.metric}`);
    const m = prev ? mark(prev, row, FLOORS[row.kind], row.higherBetter) : "";
    const rec = {
      when: new Date().toISOString(), app: a, version: profiles[a].versionNow, metric: row.metric, scene,
      median: fmt(row.median), spread: row.spread == null ? "" : row.spread.toFixed(3), passes: cold ? row.n : res.passes.length, n: row.n,
      min: fmt(row.min), max: fmt(row.max), q1: fmt(row.q1), q3: fmt(row.q3), noisy: row.noisy ? 1 : 0, busy_passes: busyPasses,
      ...machine, musickit: "", songs: "", hz: res.hz ?? "", skin: profiles[a].skinNow, mark: m,
    };
    csv.push(cols.map((c) => String(rec[c] ?? "").replace(/,/g, ";")).join(","));
    table.push({ app: profiles[a].name, metric: row.metric, unit: row.unit, median: row.median, spread: row.spread, n: row.n, noisy: row.noisy, m });
  }
  if (res.failed) console.log(`  ${profiles[a].name}: ${res.failed} pass(es) failed, left out`);
}
const csvFile = join(here, "results", `${stamp}.csv`);
writeFileSync(csvFile, csv.join("\n") + "\n");

console.log("");
console.log("  metric               " + apps.map((a) => profiles[a].name.padEnd(26)).join(""));
for (const metric of [...new Set(table.map((r) => r.metric))]) {
  const cells = apps.map((a) => {
    const r = table.find((x) => x.app === profiles[a].name && x.metric === metric);
    if (!r) return "—".padEnd(26);
    const s = `${r.median.toFixed(r.unit === "%" ? 1 : 0)} ${r.unit} ±${(r.spread * 100).toFixed(0)} % n${r.n}${r.noisy ? " NOISY" : ""}${r.m ? ` ${r.m}` : ""}`;
    return s.padEnd(26);
  });
  console.log(`  ${metric.padEnd(21)}${cells.join("")}`);
}
console.log(`\n  wrote ${csvFile}`);
