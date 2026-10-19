// The motion monitor's runner (README.md §2, 2026-10-14). It takes the motion set
// (docs/guide/motion.json) and the full player's open and close, puts smooth-monitor.js in
// front of every shot and a report after it, runs scripts/shots.mjs on the web demo, and
// prints each shot's flashes, snaps, jitters, teleports and row jumps. No dev app is needed.
//
//   node docs/ops/checks/smooth.mjs                    every shot, every skin (~40 min)
//   node docs/ops/checks/smooth.mjs --skin press       one skin
//   node docs/ops/checks/smooth.mjs --only grow,drill  some shots (ids from motion.json, or
//                                                      fullplayer-max / -midi / -portrait / -landscape)
//   node docs/ops/checks/smooth.mjs --report           print the last run again, run nothing
//
// On the dev app (2026-10-19, README.md §2a): the full player's open and close at his real
// window sizes, every skin. Needs `npm run dev:app` running and nobody else driving it.
//   node docs/ops/checks/smooth.mjs --dev              portrait (maximized on his portrait
//                                                      screen, 1080×1872), landscape Max
//                                                      1080×760, and Midi (~12 min)
//   node docs/ops/checks/smooth.mjs --dev --place portrait --skin cyber
//   node docs/ops/checks/smooth.mjs --dev --put-back   put the window, surface and skin back
//                                                      after a run that was stopped
// Each dev shot reloads the page first (a page the runner has been attached to before runs at
// about half rate, fullscreen-player.md §14.8), sets the skin with an eval step and puts it back.
// It never uses a shot `looks`: setting the theme counts as a change by hand for his Live
// Theming rule (album color → theme), which then holds the wrong theme.
//
// The list is written to shots/scratch/smooth.json and the run to shots/scratch/smooth/ (dev:
// smooth-dev-<place>.json and shots/scratch/smooth-dev-<place>/).
// What a hit means and the hits that are designed motion: README.md §2a.

import { readFileSync, writeFileSync, readdirSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const scratch = join(repo, "shots", "scratch");
const SKINS = ["vanilla", "glass", "ocean", "press", "cyber"];
const PLACES = ["portrait", "landscape", "midi"];
mkdirSync(scratch, { recursive: true }); // shots/ is not in git: a fresh checkout has none

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dev = args.includes("--dev");

/** The full player: open from the Compass, then Escape. Max and Midi, and Max at his two
 *  window shapes: portrait (the stacked layout) and landscape. */
const fullPlayer = (size, resize) => ({
  id: `fullplayer-${resize ? resize.id : size}`,
  about: `${resize ? `Max ${resize.w}×${resize.h}` : size === "max" ? "Max" : "Midi"}: open the full player from the Compass, then Escape closes it.`,
  covers: "features/fullscreen-player.md",
  kind: "clip", source: "demo", size, window: true, seconds: 9,
  strip: { fps: 30, seconds: 1.2, cols: 9, width: resize?.h > resize?.w ? 200 : size === "max" ? 360 : 240 },
  // A short Max flips to Midi in the demo; his app keeps Max at 1080×760 (its floor is lower).
  ...(resize?.h < 800 ? { settings: { maxShortWindow: "floor" } } : {}),
  // The window first, then the monitor: a resize is not motion.
  pre: resize ? [{ resize: [resize.w, resize.h], over: 0 }, { wait: 1500 }] : [],
  steps: [
    { wait: 1200 },
    { key: "Ctrl+Space" }, { wait: 400 }, { type: "full player", delay: 40 }, { wait: 500 },
    { key: "Enter", strip: true, frames: 60 }, { wait: 1800 },
    { key: "Escape", frames: 40 }, { wait: 1800 },
  ],
});

const hitLines = (mon) => {
  const fl = mon.flash.map((x) => `${x[1]} @${x[0]}ms to ${x[2]} for ${x[3]}ms`);
  const sn = mon.snap.map((x) => `${x[1]} @${x[0]}ms from ${x[2]}`);
  const ji = mon.jitter.map((x) => `${x[1]} @${x[0]}ms ${x[2]}px back in ${x[3]}ms`);
  const tp = (mon.teleport ?? []).map((x) => `${x[1]} @${x[0]}ms ${x[2]}px ${x[3]} → ${x[4]}`);
  const rj = (mon.rowjump ?? []).map((x) => `${x[1]} @${x[0]}ms "${x[2]}" → "${x[3]}" (${x[4]}px)`);
  return [["FLASH ", fl], ["SNAP  ", sn], ["JITTER", ji], ["TELEPORT", tp], ["ROW JUMP", rj]].filter(([, l]) => l.length);
};

/** Each shot's console file → one block of lines. */
function report(dirs) {
  const rows = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      rows.push(`No run yet: ${dir} is missing.`);
      continue;
    }
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".console.txt")).sort()) {
      const txt = readFileSync(join(dir, f), "utf8");
      const m = [...txt.matchAll(/→ "MON (.*)"\s*$/gm)].pop();
      const shot = f.replace(".console.txt", "");
      if (!m || m[1] === "undefined") {
        rows.push(`${shot}: no report (the shot reloads the page, as boot does)`);
        continue;
      }
      const mon = JSON.parse(JSON.parse(`"${m[1]}"`));
      const hits = hitLines(mon);
      rows.push(`${shot} (${mon.frames} frames)${hits.length ? "" : ": clean"}` + hits.map(([k, l]) => `\n   ${k} ${l.join(" | ")}`).join(""));
    }
  }
  console.log(rows.join("\n"));
}

const devDir = (place) => join(scratch, `smooth-dev-${place}`);
const places = (arg("--place")?.split(",") ?? PLACES).filter((p) => PLACES.includes(p));
if (args.includes("--report")) {
  report(dev ? places.map(devDir) : [join(scratch, "smooth")]);
  process.exit(0);
}

const monitor = readFileSync(join(here, "smooth-monitor.js"), "utf8").trim();
const REPORT = { probe: '"MON "+JSON.stringify(window.__mon)' };
const skins = arg("--skin") ? arg("--skin").split(",") : SKINS;

if (!dev) {
  const listPath = join(scratch, "smooth.json");
  const outDir = join(scratch, "smooth");
  const motion = JSON.parse(readFileSync(join(repo, "docs", "guide", "motion.json"), "utf8"));
  let shots = [...motion.shots, fullPlayer("max"), fullPlayer("midi"),
    fullPlayer("max", { id: "portrait", w: 1080, h: 1872 }), fullPlayer("max", { id: "landscape", w: 1080, h: 760 })];
  const only = arg("--only")?.split(",").map((s) => s.trim());
  if (only) shots = shots.filter((s) => only.includes(s.id));
  if (!shots.length) {
    console.error("No shot matches --only.");
    process.exit(1);
  }
  for (const s of shots) {
    s.steps = [...(s.pre ?? []), { probe: monitor }, ...s.steps, { wait: 600 }, REPORT];
    delete s.pre;
  }
  writeFileSync(listPath, JSON.stringify({
    about: "Generated by docs/ops/checks/smooth.mjs: the motion set and the full player, each shot under the motion monitor.",
    looks: [{ theme: "moonlight", skin: arg("--skin") ?? "*" }],
    shots,
  }, null, 1));
  rmSync(outDir, { recursive: true, force: true });
  const run = spawnSync(process.execPath, [join(repo, "scripts", "shots.mjs"), "--scratch", "smooth"], { cwd: repo, stdio: "inherit" });
  if (run.status !== 0) process.exit(run.status ?? 1);
  report([outDir]);
  process.exit(0);
}

// ── the dev app ──────────────────────────────────────────────────────────────

const wasPath = join(scratch, "smooth-dev-was.json");
const evalDev = (expr) => {
  const r = spawnSync(process.execPath, [join(repo, "scripts", "webview-eval.mjs"), expr], { cwd: repo, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`webview-eval: ${(r.stderr || r.stdout).trim()}`);
  const t = r.stdout.trim();
  try { return JSON.parse(t); } catch { return t; }
};
const putBack = () => {
  if (!existsSync(wasPath)) return console.log("Nothing to put back.");
  const was = JSON.parse(readFileSync(wasPath, "utf8"));
  evalDev(`(async () => { await window.__surface.set(${JSON.stringify(was.surface.surface)}, ${JSON.stringify(was.surface.view)}); await window.__surface.place(${JSON.stringify(was.bounds)}); window.__store.set("skin", ${JSON.stringify(was.skin)}); return true; })()`);
  rmSync(wasPath);
  console.log(`Put back: ${was.surface.surface}, ${was.bounds.w}×${was.bounds.h}${was.bounds.max ? " maximized" : ""}, skin ${was.skin}.`);
};
if (args.includes("--put-back")) {
  putBack();
  process.exit(0);
}

const has = evalDev("!!(window.__surface?.place && window.__store && window.__full)");
if (has !== true) {
  console.error("The dev app has no __surface.place / __store / __full: start it again with `npm run dev:app`.");
  process.exit(1);
}
if (!existsSync(wasPath))
  writeFileSync(wasPath, JSON.stringify(evalDev(`(async () => ({ bounds: await window.__surface.bounds(), surface: window.__surface.now(), skin: window.__store.get("skin") }))()`), null, 1));
const was = JSON.parse(readFileSync(wasPath, "utf8"));

/** One skin's open and close on the page as it is now (its window already placed). */
const devShot = (place, skin) => ({
  id: `fp-${place}-${skin}`,
  about: `The full player's open and close on the dev app, ${place}, ${skin}, under the motion monitor.`,
  covers: "features/fullscreen-player.md",
  kind: "clip", source: "dev", seconds: 7,
  steps: [
    { reload: true }, { wait: 3500 },
    { eval: `window.__store.set('skin', '${skin}')` }, { wait: 1800 },
    { probe: monitor }, { wait: 400 },
    { eval: "window.__full.open('shot')", frames: 90 }, { wait: 1800 },
    { eval: "window.__full.close('shot')", frames: 90 }, { wait: 1600 },
    REPORT,
    { eval: `window.__store.set('skin', ${JSON.stringify(was.skin)})` }, { wait: 800 },
  ],
});

let failed = 0;
try {
  for (const place of places) {
    const placed = place === "midi"
      ? evalDev(`(async () => { const b = await window.__surface.bounds(); if (b.max) await window.__surface.place({ ...b, x: 200, y: 200, max: false }); await window.__surface.set("midi"); await new Promise((r) => setTimeout(r, 800)); return window.__surface.bounds(); })()`)
      : evalDev(`(async () => { if (window.__surface.now().surface !== "max") await window.__surface.set("max"); ${place === "portrait" ? 'return window.__surface.place({ max: "portrait" });' : "await window.__surface.place({ x: 200, y: 200, w: 1080, h: 760, max: false }); return window.__surface.bounds();"} })()`);
    const surface = evalDev("window.__surface.now().surface");
    console.log(`[smooth] ${place}: ${surface} ${placed.w}×${placed.h}${placed.max ? " maximized" : ""}`);
    const listPath = join(scratch, `smooth-dev-${place}.json`);
    writeFileSync(listPath, JSON.stringify({
      about: `Generated by docs/ops/checks/smooth.mjs --dev: the full player on the dev app, ${place} (${surface} ${placed.w}×${placed.h}), each skin under the motion monitor.`,
      shots: skins.map((s) => devShot(place, s)),
    }, null, 1));
    rmSync(devDir(place), { recursive: true, force: true });
    const run = spawnSync(process.execPath, [join(repo, "scripts", "shots.mjs"), "--scratch", `smooth-dev-${place}`], { cwd: repo, stdio: "inherit" });
    if (run.status !== 0) failed++;
  }
} finally {
  putBack();
}
report(places.map(devDir));
process.exit(failed ? 1 : 0);
