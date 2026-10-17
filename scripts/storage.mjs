// `npm run storage` — where the repo's disk space goes (the owner's ask, 2026-10-16).
//
// Almost all of it is build output that git ignores: Rust's `target*` folders (src-tauri, the
// CLI, the crates, the tools), then `shots/`. Git itself is a few tens of MB. The worst grower
// is `<target>/debug/incremental`: a build setup (dev, check, test, a second app) gets a new
// folder there whenever its hash changes (a version bump, a feature change), and the old one
// is never used or removed again. 35 GB of it on 2026-10-16.
//
//   node scripts/storage.mjs                 the size table
//   node scripts/storage.mjs --prune [h]     delete incremental folders unused for h hours
//                                            (default 24); Rust rebuilds one on the next build
//   node scripts/storage.mjs --check         `npm run check`: one warning line when the build
//                                            folders pass the limit, else nothing; always exit 0
//   --limit <GB>                             the limit for --check (default LIMIT_GB)
//
// Sizes count a hard-linked file once (Cargo links its outputs between `deps/` and the
// profile folder), so they match the disk, not the sum of the listings.

import { readdirSync, lstatSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
// The build folders may hold this much before `npm run check` says so. A full set of current
// build setups is about 20 GB (the dev app, check, test, release, the second app).
const LIMIT_GB = 40;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, dflt) => {
  const i = args.indexOf(name);
  const v = i >= 0 ? Number(args[i + 1]) : NaN;
  return Number.isFinite(v) ? v : dflt;
};

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const fmt = (n) => (n >= GB ? `${(n / GB).toFixed(2)} GB` : `${(n / MB).toFixed(1)} MB`);

// ── Sizes ──
const seen = new Set(); // "dev:ino" of every file counted, so a hard link counts once

function sizeOf(path) {
  let total = 0;
  let st;
  try {
    st = lstatSync(path, { bigint: true });
  } catch {
    return 0;
  }
  if (st.isSymbolicLink()) return 0;
  if (!st.isDirectory()) {
    const id = `${st.dev}:${st.ino}`;
    if (st.nlink > 1n) {
      if (seen.has(id)) return 0;
      seen.add(id);
    }
    return Number(st.size);
  }
  let entries;
  try {
    entries = readdirSync(path);
  } catch {
    return 0;
  }
  for (const e of entries) total += sizeOf(join(path, e));
  return total;
}

/** Every Cargo target folder: a folder named `target` or `target-*` under a crate, at most
 *  three levels down. `node_modules` and `.git` are never entered. */
function targetDirs() {
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === "node_modules" || e.name === ".git") continue;
      const p = join(dir, e.name);
      if (/^target(-.+)?$/.test(e.name)) out.push(p);
      else if (depth < 3) walk(p, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

/** The incremental folders of every profile (`debug`, `release`, …) in a target folder. */
function incrementalDirs(target) {
  const out = [];
  for (const profile of safeList(target)) {
    const inc = join(target, profile, "incremental");
    for (const d of safeList(inc)) out.push(join(inc, d));
  }
  return out;
}

function safeList(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

const rel = (p) => relative(root, p).replaceAll("\\", "/");

// ── --check: one line, only when over ──
// The walk takes ~5 s over 55 GB, so `npm run check` (the pre-push hook) measures at most once a
// day and reads the number back otherwise. The stamp sits in src-tauri/target, so a
// `cargo clean` drops it with the folders it measured.
if (flag("--check")) {
  const limit = value("--limit", LIMIT_GB) * GB;
  const stamp = join(root, "src-tauri", "target", ".storage-check.json");
  let total = -1;
  try {
    const s = JSON.parse(readFileSync(stamp, "utf8"));
    if (Date.now() - s.at < 24 * 3600_000) total = s.total;
  } catch {
    /* no stamp yet */
  }
  if (total < 0) {
    total = targetDirs().reduce((s, t) => s + sizeOf(t), 0);
    try {
      writeFileSync(stamp, JSON.stringify({ at: Date.now(), total }));
    } catch {
      /* no target folder: nothing built, nothing to warn about */
    }
  }
  if (total > limit)
    console.log(`[storage] the build folders hold ${fmt(total)}, over the ${fmt(limit)} limit: npm run storage -- --prune`);
  process.exit(0);
}

// ── --prune: delete stale incremental folders ──
if (flag("--prune")) {
  const hours = value("--prune", 24);
  const busy = buildRunning();
  if (busy) {
    console.error(`[storage] ${busy} is running. A build may be using these folders; prune when it ends.`);
    process.exit(1);
  }
  const cut = Date.now() - hours * 3600_000;
  let freed = 0;
  let count = 0;
  for (const t of targetDirs()) {
    for (const d of incrementalDirs(t)) {
      if (lstatSync(d).mtimeMs >= cut) continue;
      const z = sizeOf(d);
      rmSync(d, { recursive: true, force: true });
      freed += z;
      count++;
    }
  }
  rmSync(join(root, "src-tauri", "target", ".storage-check.json"), { force: true }); // the next check measures again
  console.log(`[storage] pruned ${count} incremental folder(s) unused for ${hours} h: ${fmt(freed)} freed`);
  process.exit(0);
}

/** The name of a running Cargo or rustc process, else null (Windows `tasklist`). */
function buildRunning() {
  try {
    const out = execFileSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8" });
    const hit = out.split(/\r?\n/).map((l) => l.split('","')[0].replace(/^"/, "").toLowerCase()).find((n) => n === "cargo.exe" || n === "rustc.exe");
    return hit ?? null;
  } catch {
    return null;
  }
}

// ── The table ──
const rows = [];
for (const e of readdirSync(root, { withFileTypes: true })) rows.push({ name: e.name, size: sizeOf(join(root, e.name)) });
// The build folders are counted inside their top-level folder above; read them again for the
// breakdown with a fresh link set, so each folder's own number is whole.
seen.clear();
const total = rows.reduce((s, r) => s + r.size, 0);
rows.sort((a, b) => b.size - a.size);

console.log(`DeetsMusic repo: ${fmt(total)} on disk\n`);
console.log("Top level (over 10 MB):");
for (const r of rows) if (r.size > 10 * MB) console.log(`  ${fmt(r.size).padStart(10)}  ${r.name}`);

console.log("\nBuild folders:");
let buildTotal = 0;
for (const t of targetDirs()) {
  const parts = [];
  let tTotal = 0;
  for (const profile of safeList(t)) {
    for (const kind of safeList(join(t, profile))) {
      const z = sizeOf(join(t, profile, kind));
      tTotal += z;
      if (z > 100 * MB) parts.push({ name: `${profile}/${kind}`, size: z });
    }
    // The profile's own files (the .exe, linked from deps/, is counted once).
    for (const f of readdirSync(join(t, profile), { withFileTypes: true })) if (!f.isDirectory()) tTotal += sizeOf(join(t, profile, f.name));
  }
  buildTotal += tTotal;
  if (tTotal < 10 * MB) continue;
  console.log(`  ${fmt(tTotal).padStart(10)}  ${rel(t)}`);
  for (const p of parts.sort((a, b) => b.size - a.size)) console.log(`  ${fmt(p.size).padStart(10)}    ${p.name}`);
}
const stale = targetDirs().flatMap(incrementalDirs).filter((d) => lstatSync(d).mtimeMs < Date.now() - 24 * 3600_000);
console.log(`\n  ${fmt(buildTotal)} in build folders (limit for npm run check: ${LIMIT_GB} GB)`);
if (stale.length) console.log(`  ${stale.length} incremental folder(s) unused for 24 h: npm run storage -- --prune`);
