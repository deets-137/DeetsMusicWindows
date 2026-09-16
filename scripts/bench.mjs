// `node scripts/bench.mjs appearance [--passes 3] [--skins press,ocean]` — a REPEATABLE
// measurement of the appearance switch, so a graphics change can be A/B'd instead of eyeballed.
// Sibling of webview-eval.mjs / webview-profile.mjs, same CDP port discovery.
// DEBUGGING.md §Benchmarking a scene.
//
// Why this exists: on 2026-09-16 the same skin switch measured anywhere from 36 to 236 fps
// run to run, because node, vite, a CDP session and an open DevTools were all competing for
// the same CPU and GPU. A single reading from this machine means nothing. So this script:
//
//   1. REFUSES to report until the machine is quiet. It samples idle frame throughput twice
//      and bails if the two disagree by more than --tolerance (default 8%), or if DevTools is
//      open — DevTools renders its own UI in the same GPU process and was the single largest
//      distortion found.
//   2. Re-samples the display refresh first (`__frames.resample()`), because a `dropped`
//      percentage judged against a stale refresh rate is silently wrong. See frames.ts.
//   3. Runs every switch --passes times and reports the MEDIAN and the SPREAD, never one run.
//
// Read `spread` before anything else. If it is wide the run is noise, whatever the median says.
import { readFileSync, existsSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (msg, code = 2) => {
  console.error(`[bench] ${msg}`);
  process.exit(code);
};
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const scene = argv.find((a) => !a.startsWith("--")) ?? "appearance";
const PASSES = Math.max(1, Number(flag("passes", 3)));
const TOLERANCE = Number(flag("tolerance", 8));
const ONLY = flag("skins", "").split(",").filter(Boolean);

let gen;
try {
  gen = JSON.parse(readFileSync(join(root, "src-tauri", ".tauri.dev.gen.json"), "utf8"));
} catch {
  fail("no generated dev config — start the app with `npm run dev:app`");
}
const port = /--remote-debugging-port=(\d+)/.exec(gen.app.windows.find((w) => w.label === "main")?.additionalBrowserArgs ?? "")?.[1];
if (!port) fail("the dev config has no CDP port — restart `npm run dev:app`");

let targets;
try {
  targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
} catch {
  fail(`nothing answers on CDP port ${port} — is the dev app running?`);
}
const devtoolsOpen = targets.some((t) => t.url.startsWith("devtools://"));
const page = targets.find((t) => t.type === "page" && t.url.startsWith(gen.build.devUrl) && !t.url.includes("tray.html"));
if (!page) fail(`no main-window page among ${targets.length} target(s)`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
};
ws.onerror = () => fail("websocket error");
await new Promise((r) => (ws.onopen = r));

const evaluate = async (expression) => {
  const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) fail(`page threw: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const fpsOf = (line) => {
  const m = /(\d+) ms · (\d+) frames/.exec(line);
  return m ? Math.round((Number(m[2]) / Number(m[1])) * 1000) : 0;
};

// ── 1. is this machine fit to measure on? ────────────────────────────────────
console.log(`[bench] ${scene} · ${PASSES} passes · port ${port}`);
await evaluate("__frames.resample()");
await evaluate("new Promise(r=>setTimeout(r,1600))"); // let the sample land
const hz = await evaluate("__frames.hz");
const idle = [];
for (let i = 0; i < 2; i++) idle.push(fpsOf(await evaluate(`__frames.sample(900,'bench-idle')`)));
const spread = idle[0] ? Math.abs(idle[0] - idle[1]) / Math.max(...idle) * 100 : 100;

console.log(`\nnoise check — display ${hz} Hz · idle ${idle.join(" / ")} fps · spread ${spread.toFixed(1)}%`);
if (devtoolsOpen) {
  console.error(`
[bench] REFUSING: DevTools is open. It renders its own UI in the same GPU process and was the
        single largest distortion found on 2026-09-16. Close it (or use a build that does not
        auto-open it) and run again.`);
  process.exit(1);
}
if (spread > TOLERANCE) {
  console.error(`
[bench] REFUSING: idle throughput varied ${spread.toFixed(1)}% between two samples (limit ${TOLERANCE}%).
        Something else on this machine is competing for the CPU or GPU — close other Deets apps,
        vite watchers and profilers, then run again. A number taken now would be noise.`);
  process.exit(1);
}
console.log(`machine is quiet enough — proceeding\n`);

// ── 2. the scene ─────────────────────────────────────────────────────────────
if (scene !== "appearance") fail(`unknown scene ${JSON.stringify(scene)} — only "appearance" so far`);

const skins = (await evaluate("[...document.querySelectorAll('[data-skin-choice]')].map(e=>e.dataset.skinChoice)")).filter(
  (s) => !ONLY.length || ONLY.includes(s),
);
if (!skins.length) fail("no skin choices matched");
const was = await evaluate("document.documentElement.dataset.skin");

const runs = new Map(skins.map((s) => [s, []]));
for (let p = 0; p < PASSES; p++) {
  for (const s of skins) {
    // Click the real control: the MCP settings route is tagged by=agent and runs
    // --agent-motion slower, which hides exactly the hitches we are hunting.
    const line = await evaluate(`(async()=>{
      document.querySelector('[data-skin-choice=${JSON.stringify(s)}]').click();
      await new Promise(r=>setTimeout(r,120));
      const rise = __frames.sample(4200,'bench-${s}');
      return await rise;
    })()`);
    runs.get(s).push(line);
    await evaluate("new Promise(r=>setTimeout(r,900))"); // let the cover fully settle
  }
  process.stdout.write(`  pass ${p + 1}/${PASSES} done\n`);
}

// ── 3. report ────────────────────────────────────────────────────────────────
// Every gated run also appends to scripts/perf-history.csv, so a change can be compared with
// a week ago instead of with a memory. Only runs that got PAST the noise gate are written —
// a row from a noisy machine is worse than no row, because it looks like evidence.
// The renderer and hz go in each row: rows are only comparable within the same pair.
const renderer = await evaluate(`(()=>{try{const c=document.createElement('canvas');
  const gl=c.getContext('webgl');const d=gl&&gl.getExtension('WEBGL_debug_renderer_info');
  const n=d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):'unknown';
  gl&&gl.getExtension('WEBGL_lose_context')?.loseContext();return n;}catch(e){return 'unknown'}})()`);
const gpuMode = /swiftshader|software|llvmpipe/i.test(renderer) ? "software" : "accelerated";
let commit = "?", dirty = "?";
try {
  const { execFileSync } = await import("node:child_process");
  const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
  commit = git("rev-parse", "--short", "HEAD");
  dirty = git("status", "--porcelain").length ? "dirty" : "clean";
} catch {
  /* not a checkout — leave the marks */
}

console.log(`\nskin            rise      fps(med)   spread   worst(med)`);
for (const [s, lines] of runs) {
  const fps = lines.map(fpsOf);
  const worst = lines.map((l) => Number(/worst (\d+)/.exec(l)?.[1] ?? 0));
  const sp = Math.max(...fps) ? ((Math.max(...fps) - Math.min(...fps)) / Math.max(...fps)) * 100 : 0;
  const rise = /(\d+) ms ·/.exec(lines[0])?.[1] ?? "?";
  const warn = sp > 25 ? "  ← too noisy to trust" : "";
  console.log(
    `${s.padEnd(15)}${(rise + "ms").padStart(7)}${String(median(fps)).padStart(11)}${(sp.toFixed(0) + "%").padStart(9)}${(median(worst) + "ms").padStart(12)}${warn}`,
  );
}
console.log(`\nspread is max→min across passes. Over ~25% and the median means nothing —`);
console.log(`quieten the machine and run again rather than believing it.`);

// ── 4. the history file ──────────────────────────────────────────────────────
const CSV = join(root, "scripts", "perf-history.csv");
const HEAD = "when,commit,tree,scene,skin,gpu,renderer,hz,passes,rise_ms,fps_med,spread_pct,worst_med_ms,drop_pct_med,note\n";
const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));
const when = new Date().toISOString();
const note = flag("note", "");
let rows = "";
for (const [s, lines] of runs) {
  const fps = lines.map(fpsOf);
  const worst = lines.map((l) => Number(/worst (\d+)/.exec(l)?.[1] ?? 0));
  const drops = lines.map((l) => Number(/dropped \d+ \(([\d.]+)%\)/.exec(l)?.[1] ?? 0));
  const sp = Math.max(...fps) ? ((Math.max(...fps) - Math.min(...fps)) / Math.max(...fps)) * 100 : 0;
  rows +=
    [when, commit, dirty, scene, s, gpuMode, renderer, hz, PASSES, /(\d+) ms ·/.exec(lines[0])?.[1] ?? "", median(fps), sp.toFixed(1), median(worst), median(drops).toFixed(1), note]
      .map(csvCell)
      .join(",") + "\n";
}
if (!existsSync(CSV)) writeFileSync(CSV, HEAD);
appendFileSync(CSV, rows);
console.log(`\nappended ${runs.size} row(s) to scripts/perf-history.csv  (gpu=${gpuMode}, ${commit}/${dirty}${note ? `, note "${note}"` : ""})`);
if (dirty === "dirty") console.log(`the tree is DIRTY, so this row is not reproducible from the commit alone — pass --note to say what was in flight.`);

await evaluate(`document.querySelector('[data-skin-choice=${JSON.stringify(was)}]')?.click()`); // put the look back
console.log(`\nrestored skin: ${was}`);
ws.close();
process.exit(0);
