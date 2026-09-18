#!/usr/bin/env node
// boot-log — keep a row for every start-up, so start-up can be TRENDED.
// DEBUGGING.md §2026-09-17 review, item 7: the app already writes `[perf] frames boot`, but
// nothing kept it. The rolling log holds one rotated generation, so a boot older than about
// a megabyte of lines is gone — on 2026-09-17 the only reason a 2 a.m. window survived was
// the luck of the rotation. This harvests what is still in the log into a committed file.
//
//   node scripts/boot-log.mjs                 # harvest both apps, print the trend
//   node scripts/boot-log.mjs --installed     # the installed app only
//   node scripts/boot-log.mjs --dev           # the dev app only
//   node scripts/boot-log.mjs --show 20       # print the last 20 rows and stop
//   node scripts/boot-log.mjs --json
//
// It reads only log files already on this PC, starts nothing, and never writes a row twice:
// a boot is identified by its app and its `start:` timestamp.
//
// In practice this sees the DEV app. `[perf] frames boot` rides the telemetry gate, so an
// ordinary installed release writes no boot line at all — by design (telemetry-on.ts). An
// installed build made with VITE_PERF=1 does, which is the only way to trend the real thing.
//
// A row is one start-up:
//   when          the `start:` line's own local timestamp
//   app           dev | installed
//   version       what that build called itself
//   to_first_paint_ms  start: → the boot frames line (the window the person waits through)
//   boot_ms       the boot window frames.ts measured
//   frames, hz, dropped_pct, worst_ms, longtasks, longtask_max_ms
//   gpu           accelerated | software | (blank when the line did not land)

import { readFileSync, existsSync, writeFileSync, appendFileSync, statSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const value = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const CSV = join(process.cwd(), "scripts", "boot-history.csv");
const COLUMNS = [
  "when", "app", "version", "to_first_paint_ms", "boot_ms", "frames", "hz",
  "dropped_pct", "worst_ms", "longtasks", "longtask_max_ms", "gpu",
];

const appData = process.env.APPDATA ?? "";
const WANTED = flag("installed") ? ["installed"] : flag("dev") ? ["dev"] : ["installed", "dev"];
const DIRS = { installed: "com.deetsmusic.app", dev: "com.deetsmusic.dev" };

// The log keeps milliseconds and `wait` is a sub-second number, so they are parsed: without
// them every wait came out as a whole second (4000 / 3000 / 2000 ms), which looks like a
// trend and is only the clock's resolution.
const stamp = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)/;
const at = (line) => {
  const m = stamp.exec(line);
  return m ? new Date(`${m[1]}T${m[2]}`) : null;
};
const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));

// ── harvest ───────────────────────────────────────────────────────────────────
//
// One pass per app, oldest generation first. A `start:` line opens a boot; the first
// `frames boot` and `[perf] gpu` after it belong to it; the next `start:` closes it. A boot
// whose frames line never arrived (a crash, a log that rotated mid-boot) is skipped rather
// than written with holes.
function harvest(app) {
  const dir = join(appData, DIRS[app]);
  const files = [join(dir, "deetsmusic.1.log"), join(dir, "deetsmusic.log")].filter(existsSync);
  const rows = [];
  let open = null;
  const close = () => {
    if (open?.boot_ms) rows.push(open);
    open = null;
  };
  for (const f of files) {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      if (!line) continue;
      const m = /INFO\s+start: DeetsMusic (\S+)/.exec(line);
      if (m) {
        close();
        const t = at(line);
        if (t) open = { when: local(t), t, app, version: m[1], gpu: "" };
        continue;
      }
      if (!open) continue;
      const b =
        /\[perf\] frames boot (\d+) ms · (\d+) frames @(\d+) Hz · dropped \d+ \(([\d.]+)%\)(?: · worst (\d+) ms)?(?: · first \d+ ms)?(?: · longtasks (\d+) \(max (\d+) ms\))?/.exec(
          line,
        );
      if (b && !open.boot_ms) {
        const t = at(line);
        open.boot_ms = Number(b[1]);
        open.frames = Number(b[2]);
        open.hz = Number(b[3]);
        open.dropped_pct = Number(b[4]);
        open.worst_ms = Number(b[5] ?? 0);
        open.longtasks = Number(b[6] ?? 0);
        open.longtask_max_ms = Number(b[7] ?? 0);
        open.to_first_paint_ms = t ? t.getTime() - open.t.getTime() : 0;
        continue;
      }
      const g = /\[perf\] gpu (\w+)/.exec(line);
      if (g && !open.gpu) open.gpu = g[1];
    }
  }
  close();
  return rows;
}

function local(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ── the file ──────────────────────────────────────────────────────────────────
function readRows() {
  if (!existsSync(CSV)) return [];
  const lines = readFileSync(CSV, "utf8").split("\n").map((l) => l.replace("\r", "")).filter((l) => l.trim());
  const head = lines[0].split(",");
  return lines.slice(1).map((l) => {
    const f = l.split(",");
    return Object.fromEntries(head.map((h, i) => [h, f[i] ?? ""]));
  });
}

const existing = readRows();
const seen = new Set(existing.map((r) => `${r.app}@${r.when}`));
const fresh = [];
for (const app of WANTED) {
  for (const r of harvest(app)) {
    if (seen.has(`${r.app}@${r.when}`)) continue;
    seen.add(`${r.app}@${r.when}`);
    fresh.push(r);
  }
}
fresh.sort((a, b) => a.when.localeCompare(b.when));

if (fresh.length) {
  const body = fresh.map((r) => COLUMNS.map((c) => csvCell(r[c] ?? "")).join(",")).join("\n") + "\n";
  if (!existsSync(CSV)) writeFileSync(CSV, COLUMNS.join(",") + "\n");
  appendFileSync(CSV, body);
}

// ── the trend ─────────────────────────────────────────────────────────────────
const all = readRows();
if (flag("json")) {
  console.log(JSON.stringify({ added: fresh.length, rows: all }, null, 2));
  process.exit(0);
}

const show = Number(value("show") ?? 12);
console.log(`boot-log — ${all.length} start-up(s) on file, ${fresh.length} new`);
if (existsSync(CSV)) console.log(`  scripts/boot-history.csv (${Math.round(statSync(CSV).size / 1024)} KB)`);
if (!all.length) {
  console.log("  nothing yet — start the app once and run this again");
  process.exit(0);
}
console.log(`\nwhen                  app        version  wait  boot  frames   drop%  worst  longtasks  gpu`);
for (const r of all.slice(-show)) {
  console.log(
    `${r.when.padEnd(21)}${r.app.padEnd(11)}${String(r.version).padEnd(9)}` +
      `${(r.to_first_paint_ms + "ms").padStart(6)}${(r.boot_ms + "ms").padStart(7)}${String(r.frames).padStart(7)}` +
      `${String(r.dropped_pct).padStart(8)}${(r.worst_ms + "ms").padStart(7)}` +
      `  ${(r.longtasks === "0" ? "-" : `${r.longtasks} (max ${r.longtask_max_ms} ms)`).padEnd(17)}${r.gpu}`,
  );
}

// The median per app, which is the number to compare across versions. `wait` is what the
// person actually sits through: the app's own start line to the first painted frame.
const med = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
console.log("");
for (const app of ["installed", "dev"]) {
  const rows = all.filter((r) => r.app === app);
  if (!rows.length) continue;
  const byVersion = new Map();
  for (const r of rows) {
    if (!byVersion.has(r.version)) byVersion.set(r.version, []);
    byVersion.get(r.version).push(r);
  }
  const parts = [...byVersion.entries()].map(
    ([v, rs]) => `${v}: wait ${med(rs.map((r) => Number(r.to_first_paint_ms)))} ms, boot ${med(rs.map((r) => Number(r.boot_ms)))} ms (n=${rs.length})`,
  );
  console.log(`${app} median per version — ${parts.join(" · ")}`);
}
console.log(`\nRun this after a session: the rolling log keeps one rotated generation, so a boot that`);
console.log(`is not harvested is gone. Rows are keyed by app + start time, so running it twice is safe.`);
