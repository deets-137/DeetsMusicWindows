// `npm run latency:profile` — the latency profile (docs/guide/LOADING-SET.md §3.2).
//
// Reads the command recorder's blocks (src/ipc-timing.ts) from the dev app's log and the one
// rotated before it, over the last N days, and writes docs/guide/latency.json: per command the
// cold and the warm round trips, per cover the misses and the hit share, each as n · p50 · p90 ·
// max, and the misses' deciles for the replay's draw. It holds command names and milliseconds only: no song, no id, no path.
//
//   node scripts/latency-profile.mjs [--days 14] [--log <dir>] [--out <file>] [--print]
//
// A block in the log:
//   2026-10-17 16:25:20.365  INFO  diag: [perf] ipc+art 300 s
//       [perf] ipc playlists_cached cold 14 · warm 3,2,4,9,3
//       [perf] art miss 212,340,95 · hits 41

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const days = Number(opt("days", "14"));
const logDir = opt("log", join(process.env.APPDATA ?? "", "com.deetsmusic.dev"));
const out = opt("out", join(root, "docs", "guide", "latency.json"));

// The rotated file first, so the blocks read oldest to newest.
const files = ["deetsmusic.1.log", "deetsmusic.log"].map((f) => join(logDir, f)).filter(existsSync);
if (!files.length) {
  console.error(`latency:profile: no log in ${logDir}`);
  process.exit(1);
}

const since = Date.now() - days * 86400_000;
const HEAD = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\.\d+\s+\w+\s+diag: \[perf\] ipc\+art /;
const IPC = /^\s+\[perf\] ipc (\S+) (.*)$/;
const ART = /^\s+\[perf\] art (.*)$/;

/** cmd → { cold: number[], warm: number[], failed } */
const cmds = new Map();
const art = { miss: [], hits: 0 };
let first = null;
let last = null;
let blocks = 0;

const nums = (s) => (s === "-" ? [] : s.split(",").map(Number).filter((n) => Number.isFinite(n)));
/** "cold 14 · warm 3,2 · failed 1" → { cold: "14", warm: "3,2", failed: "1" } */
const fields = (rest) => Object.fromEntries(rest.split(" · ").map((p) => p.trim().split(" ", 2)));

for (const file of files) {
  let inBlock = false;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const h = HEAD.exec(line);
    if (h) {
      const t = new Date(h[1].replace(" ", "T")).getTime(); // the log writes local time
      inBlock = t >= since;
      if (inBlock) {
        blocks++;
        first ??= h[1];
        last = h[1];
      }
      continue;
    }
    if (!inBlock) continue;
    if (!/^\s/.test(line)) {
      inBlock = false; // the next timestamped line ends the block
      continue;
    }
    const m = IPC.exec(line);
    // docs/ops/checks/ipc-timing.mjs calls commands that do not exist; they are not waits.
    if (m?.[1].startsWith("deets_check_")) continue;
    if (m) {
      const f = fields(m[2]);
      let c = cmds.get(m[1]);
      if (!c) cmds.set(m[1], (c = { cold: [], warm: [], failed: 0 }));
      if (f.cold) c.cold.push(...nums(f.cold));
      if (f.warm) c.warm.push(...nums(f.warm));
      if (f.failed) c.failed += Number(f.failed) || 0;
      continue;
    }
    const a = ART.exec(line);
    if (a) {
      const f = fields(a[1]);
      if (f.miss) art.miss.push(...nums(f.miss));
      if (f.hits) art.hits += Number(f.hits) || 0;
    }
  }
}

/** Nearest-rank percentiles; null for an empty list. */
function stats(list) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
  return { n: s.length, p50: at(50), p90: at(90), max: s[s.length - 1] };
}
/** The cover misses' spread for the replay's draw (§3.3): p10, p20 … p100. */
function deciles(list) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return Array.from({ length: 10 }, (_, k) => s[Math.min(s.length - 1, Math.ceil(((k + 1) / 10) * s.length) - 1)]);
}

const commands = {};
for (const [name, c] of [...cmds].sort((a, b) => a[0].localeCompare(b[0]))) {
  commands[name] = { cold: stats(c.cold), warm: stats(c.warm), ...(c.failed ? { failed: c.failed } : {}) };
}
const loads = art.miss.length + art.hits;
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const profile = {
  about: "The owner's dev-app round trips per command and cover load times (docs/guide/LOADING-SET.md §3.2). Made by `npm run latency:profile`; edit nothing by hand.",
  version,
  from: first,
  to: last,
  days,
  blocks,
  commands,
  art: { miss: stats(art.miss), deciles: deciles(art.miss), hits: art.hits, hitShare: loads ? Math.round((art.hits / loads) * 1000) / 1000 : null },
};

if (!blocks) {
  console.error(`latency:profile: no [perf] ipc+art block in the last ${days} days (is the recorder in this dev build?)`);
  process.exit(1);
}
writeFileSync(out, JSON.stringify(profile, null, 2) + "\n");
console.log(`latency:profile: ${blocks} blocks, ${cmds.size} commands, ${loads} cover loads (${first} → ${last}) → ${out}`);
if (args.includes("--print")) {
  for (const [name, c] of Object.entries(commands)) {
    const f = (s) => (s ? `${s.p50}/${s.p90}/${s.max} (n ${s.n})` : "-");
    console.log(`  ${name.padEnd(36)} cold ${f(c.cold).padEnd(22)} warm ${f(c.warm)}`);
  }
}
