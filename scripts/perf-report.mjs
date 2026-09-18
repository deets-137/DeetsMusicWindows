#!/usr/bin/env node
// perf-report — read the logs this app already writes and print what they say.
// DEBUGGING.md §2026-09-17 review, item 2: a review was `grep | tail` by hand, so
// "did it get worse" had no answer. This reads the rolling log (dev and installed,
// the rotated generation included) and scripts/heaviness-samples.log, and prints
// p50 / p95 / worst per name with the row count.
//
//   node scripts/perf-report.mjs                 # dev log + heaviness, whole file
//   node scripts/perf-report.mjs --installed     # the installed app's log instead
//   node scripts/perf-report.mjs --since 2h      # 30m | 2h | 3d | 2026-09-16 23:00
//   node scripts/perf-report.mjs --file <path>   # any log file, or several
//   node scripts/perf-report.mjs --all           # every row, not the worst 15
//   node scripts/perf-report.mjs --json          # the same numbers as JSON
//
// It reads nothing but files that are already on this PC and starts no app.
//
// What it parses (every line shape is written by src/perf.ts, src/frames.ts,
// src/diag.ts or the Rust airplay module):
//   [perf] click→sound 333 ms (MusicKit said playing at 329) · … {"where":"next", …}
//   [perf] frames scroll lib-view 812 ms · 117 frames @144 Hz · dropped 3 (2.6%) · worst 41 ms
//   [perf] input pointerup lib-row 41 ms (delay 3)
//   sound:clockSlip / sound:startLost                       (counted, with the last time)
//   airplay: capture heard sound: 441882 frames, 441882 not silent, in the last 10 s
//   2026-09-17 15:56 installed up=246min total=871MB … | host=64MB/0.9% … | skin=cyber …

import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

// ── arguments ─────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const files = argv.flatMap((a, i) => (argv[i - 1] === "--file" ? [a] : []));
const asJson = flag("--json");
const appData = process.env.APPDATA ?? "";
const idDir = flag("--installed") ? "com.deetsmusic.app" : "com.deetsmusic.dev";
const logDir = join(appData, idDir);
// The rotated generation first, so the oldest lines come first in one stream.
const logFiles = files.length
  ? files
  : [join(logDir, "deetsmusic.1.log"), join(logDir, "deetsmusic.log")].filter(existsSync);
const heavinessFile = join(process.cwd(), "scripts", "heaviness-samples.log");

/** `--since 30m | 2h | 3d | 2026-09-16 | "2026-09-16 23:00"` → a Date, or null. */
function since() {
  const s = value("--since");
  if (!s) return null;
  const rel = /^(\d+)([mhd])$/.exec(s);
  if (rel) {
    const ms = { m: 60e3, h: 3600e3, d: 86400e3 }[rel[2]] * Number(rel[1]);
    return new Date(Date.now() - ms);
  }
  const d = new Date(s.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}
const from = since();

// ── statistics ────────────────────────────────────────────────────────────────

const pct = (sorted, p) => {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
};
const round = (n) => (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10);

/** Every measurement under one name, reduced to the three numbers that matter. */
class Series {
  constructor() {
    this.v = [];
    this.extra = new Map();
  }
  add(n, extra) {
    if (Number.isFinite(n)) this.v.push(n);
    if (extra) for (const [k, x] of Object.entries(extra)) this.extra.set(k, (this.extra.get(k) ?? 0) + x);
  }
  stats() {
    const s = [...this.v].sort((a, b) => a - b);
    return { n: s.length, p50: round(pct(s, 50)), p95: round(pct(s, 95)), worst: round(s[s.length - 1] ?? 0) };
  }
}
const group = (map, key) => {
  let s = map.get(key);
  if (!s) map.set(key, (s = new Series()));
  return s;
};

// ── reading ───────────────────────────────────────────────────────────────────

const stamp = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)/;
function lineTime(line) {
  const m = stamp.exec(line);
  return m ? new Date(`${m[1]}T${m[2]}`) : null;
}

const report = {
  files: [],
  window: { from: from ? from.toISOString() : null, first: null, last: null },
  play: new Map(),
  frames: new Map(),
  framesDropped: new Map(),
  input: new Map(),
  events: new Map(),
  capture: { ok: 0, partial: 0, silent: 0, last: null },
  heaviness: new Map(),
};

function note(line) {
  const t = lineTime(line);
  if (from && t && t < from) return false;
  if (t) {
    if (!report.window.first) report.window.first = t;
    report.window.last = t;
  }
  return true;
}

for (const f of logFiles) {
  if (!existsSync(f)) continue;
  report.files.push(`${f} (${Math.round(statSync(f).size / 1024)} KB)`);
  const text = readFileSync(f, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;

    // click→sound: the number the user feels. Keyed by `where` so a click on a row and
    // a Next are not averaged together.
    let m = /\[perf\] click→sound (\d+) ms/.exec(line);
    if (m) {
      if (!note(line)) continue;
      const where = /"where"\s*:\s*"([^"]+)"/.exec(line)?.[1] ?? "?";
      const mk = /MusicKit said playing at (\d+)/.exec(line)?.[1];
      group(report.play, where).add(Number(m[1]), mk ? { musickit: Number(mk) } : undefined);
      continue;
    }

    // frames: the gesture's own smoothness. `name detail` is the key.
    m = /\[perf\] frames (.+?) (\d+) ms · (\d+) frames @(\d+) Hz · dropped (\d+) \(([\d.]+)%\)(?: · worst (\d+) ms)?/.exec(line);
    if (m) {
      if (!note(line)) continue;
      group(report.frames, m[1]).add(Number(m[7] ?? 0));
      group(report.framesDropped, m[1]).add(Number(m[6]));
      continue;
    }

    // input: press → paint.
    m = /\[perf\] input (\S+) (\S+) (\d+) ms \(delay (\d+)\)/.exec(line);
    if (m) {
      if (!note(line)) continue;
      group(report.input, `${m[1]} ${m[2]}`).add(Number(m[3]));
      continue;
    }

    // The named faults, counted. A count that climbs between two runs is the signal.
    m = /(sound:clockSlip|sound:startLost|sound:tapRate|airplay:tapDisarmed|\[perf\] abandon|panic)/.exec(line);
    if (m) {
      if (!note(line)) continue;
      const s = group(report.events, m[1]);
      s.add(1);
      s.last = line.slice(0, 160);
      continue;
    }

    // The AirPlay capture's own verdict: is the stream carrying sound at all.
    m = /capture heard (\w+): (\d+) frames, (\d+) not silent/.exec(line);
    if (m) {
      if (!note(line)) continue;
      const frames = Number(m[2]);
      const heard = Number(m[3]);
      const key = heard === 0 ? "silent" : heard < frames * 0.9 ? "partial" : "ok";
      report.capture[key]++;
      report.capture.last = line.slice(0, 160);
      continue;
    }
  }
}

// The heaviness log: one row per app per sample. Reported per label (installed / dev),
// and per process bucket when the row carries the split.
if (existsSync(heavinessFile)) {
  report.files.push(`${heavinessFile} (${Math.round(statSync(heavinessFile).size / 1024)} KB)`);
  for (const line of readFileSync(heavinessFile, "utf8").split(/\r?\n/)) {
    const m = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) (installed|dev) up=(\d+)min total=(\d+)MB .*?cpu=([\d.]+)%/.exec(line);
    if (!m) continue;
    const t = new Date(m[1].replace(" ", "T"));
    if (from && t < from) continue;
    group(report.heaviness, `${m[2]} total MB`).add(Number(m[4]));
    group(report.heaviness, `${m[2]} cpu %`).add(Number(m[5]));
    for (const [, bucket, mb, cpu] of line.matchAll(/(\w+?)(?:x\d+)?=(\d+)MB\/([\d.]+)%/g)) {
      group(report.heaviness, `${m[2]} ${bucket} MB`).add(Number(mb));
      group(report.heaviness, `${m[2]} ${bucket} cpu %`).add(Number(cpu));
    }
  }
}

// ── printing ──────────────────────────────────────────────────────────────────

// Every stamp in these logs is local time, so it is printed back as local time.
const local = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ` +
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

// The worst 15 by p95, which is what a review looks at; `--all` prints every row.
const TOP = flag("--all") ? Infinity : 15;
const table = (title, map, unit, extra) => {
  if (!map.size) return;
  let rows = [...map.entries()].map(([k, s]) => [k, s.stats(), s]);
  rows.sort((a, b) => b[1].p95 - a[1].p95);
  const hidden = Math.max(0, rows.length - TOP);
  rows = rows.slice(0, TOP);
  const w = Math.max(...rows.map((r) => r[0].length), 12);
  console.log(`\n${title}`);
  console.log(`${"name".padEnd(w)}   n     p50     p95   worst`);
  for (const [k, st, s] of rows) {
    const line =
      `${k.padEnd(w)} ${String(st.n).padStart(3)} ` +
      `${String(st.p50).padStart(7)} ${String(st.p95).padStart(7)} ${String(st.worst).padStart(7)}  ${unit}`;
    console.log(extra ? extra(line, st, s) : line);
  }
  if (hidden) console.log(`… ${hidden} more (--all)`);
};

if (asJson) {
  const out = (map) => Object.fromEntries([...map].map(([k, s]) => [k, s.stats()]));
  console.log(
    JSON.stringify(
      {
        window: { from: from ? local(from) : null, first: report.window.first && local(report.window.first), last: report.window.last && local(report.window.last) },
        play: out(report.play),
        frames: out(report.frames),
        framesDropped: out(report.framesDropped),
        input: out(report.input),
        events: Object.fromEntries([...report.events].map(([k, s]) => [k, s.stats().n])),
        capture: report.capture,
        heaviness: out(report.heaviness),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log(`perf-report — ${idDir}${from ? `, since ${value("--since")}` : ""}`);
for (const f of report.files) console.log(`  ${f}`);
if (report.window.first) {
  console.log(`  lines from ${local(report.window.first)} to ${local(report.window.last)}`);
}

table("click→sound (ms, by where)", report.play, "ms", (line, st, s) => {
  const mk = s.extra.get("musickit");
  return mk ? `${line}  · MusicKit's own mean ${Math.round(mk / st.n)} ms` : line;
});
table("frames — worst gap in the gesture (ms)", report.frames, "ms");
table("frames — dropped (%)", report.framesDropped, "%");
table("input — press → paint (ms)", report.input, "ms");
table("heaviness", report.heaviness, "");

if (report.events.size) {
  console.log("\nfaults");
  for (const [k, s] of report.events) console.log(`  ${k.padEnd(22)} ${String(s.stats().n).padStart(4)}   last: ${s.last ?? ""}`);
}
const c = report.capture;
if (c.ok + c.partial + c.silent) {
  console.log(`\nairplay capture — ok ${c.ok} · partial ${c.partial} · silent ${c.silent}`);
  if (c.last) console.log(`  last: ${c.last}`);
}
if (!report.files.length) console.log("no log files found — start the app once, or pass --file <path>");
