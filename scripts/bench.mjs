// `node scripts/bench.mjs appearance|idle|scroll [--passes 3] [--skins press,ocean] [--ms 3000]
// [--note "…"] [--css "<rules>"] [--attr name=value]` — a REPEATABLE measurement of a scene, so a graphics change can be A/B'd instead
// of eyeballed. Sibling of webview-eval.mjs / webview-profile.mjs, same CDP port discovery.
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
//   3. Runs every scene --passes times and reports the MEDIAN and the SPREAD, never one run.
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
const flagValues = new Set(["passes", "tolerance", "skins", "ms", "note", "css", "attr"].map((f) => flag(f, null)).filter(Boolean));
const scene = argv.find((a) => !a.startsWith("--") && !flagValues.has(a)) ?? "appearance";
const PASSES = Math.max(1, Number(flag("passes", 3)));
const TOLERANCE = Number(flag("tolerance", 8));
const ONLY = flag("skins", "").split(",").filter(Boolean);
const WINDOW_MS = Number(flag("ms", 3000));
// --css "<rules>" injects a stylesheet for the whole run and removes it after: an A/B of one
// feature (hide it, cheapen it) under the same noise gate. The rules land in the row's note.
const CSS = flag("css", "");
// --attr name=value sets data-<name> on <html> for the run and puts the old value back after:
// an A/B of a settings attribute (glass-fancy=on) without touching the stored settings.
const ATTR = flag("attr", "");
const [attrName, attrValue] = ATTR ? [ATTR.split("=")[0], ATTR.split("=").slice(1).join("=")] : [];
const attrProp = attrName?.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

let gen;
try {
  gen = JSON.parse(readFileSync(join(root, "src-tauri", ".tauri.dev.gen.json"), "utf8"));
} catch {
  fail("no generated dev config — start the app with `npm run dev:app`");
}
const args = gen.app.windows.find((w) => w.label === "main")?.additionalBrowserArgs ?? "";
const port = /--remote-debugging-port=(\d+)/.exec(args)?.[1];
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
// A steady outside load passes the idle check above: two samples are equally slow, so they
// agree. On 2026-09-16 a game (Surviving Mars) held 97% of the GPU's 3D engine through a whole
// baseline and the gate let it by. So also read Windows' own per-process GPU counters and name
// anything that is not this app's WebView. --contended runs anyway, on purpose (a user with
// a game or a video open is a real case), and says so in the row.
const CONTENDED = argv.includes("--contended");
const others = await gpuOthers();
if (others.length) {
  const list = others.map((o) => `${o.name} ${o.pct}%`).join(", ");
  if (!CONTENDED) {
    console.error(`
[bench] REFUSING: other programs are using the GPU's 3D engine: ${list}.
        Close them for a clean baseline, or pass --contended to measure a shared GPU on purpose.`);
    process.exit(1);
  }
  console.log(`GPU shared on purpose (--contended): ${list}`);
}
const sharedNote = CONTENDED ? ` [contended: ${others.map((o) => `${o.name} ${o.pct}%`).join(", ") || "nothing else on the GPU"}]` : "";
console.log(`machine is quiet enough — proceeding\n`);

// Other processes' share of the GPU 3D engine (Windows perf counters), over 10%, excluding
// WebView2 (this app's own GPU process). Empty on any failure: a missing counter must not block.
async function gpuOthers() {
  try {
    const { execFileSync } = await import("node:child_process");
    const ps =
      "$s=(Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -SampleInterval 1 -MaxSamples 2).CounterSamples;" +
      "$s | Group-Object { ($_.InstanceName -split '_')[1] } | % { $p=[int]$_.Name; $v=($_.Group | Measure-Object CookedValue -Sum).Sum/2;" +
      "if($v -gt 10){ $n=(Get-Process -Id $p -EA SilentlyContinue).ProcessName; \"$n`t$([math]::Round($v))\" } }";
    const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { encoding: "utf8", timeout: 15000 });
    return out
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => ({ name: l.split("\t")[0] || "?", pct: Number(l.split("\t")[1]) }))
      .filter((o) => !/msedgewebview2|dwm/i.test(o.name));
  } catch {
    return [];
  }
}

// ── 2. the scene ─────────────────────────────────────────────────────────────
// appearance : switch to each skin; the window is the rise (a TRANSITION cost).
// idle       : settle on each skin, then touch nothing (a STEADY cost: the aurora, the sea, the
//              album aurora, the record player when a song plays).
// scroll     : settle on each skin, then scroll the library list at a steady speed (the cost of
//              content moving under and over each skin's layers).
// Frames ÷ ms stops at the display rate for any cheap scene, so every window also records the
// CPU time the GPU process and the page's renderer spent in it (CDP SystemInfo; 100 = one core).
// Under --gpu=off the GPU process IS the rasteriser, so its CPU is the whole draw cost.
const SCENES = ["appearance", "idle", "scroll"];
if (!SCENES.includes(scene)) fail(`unknown scene ${JSON.stringify(scene)} — use ${SCENES.join(", ")}`);

const skins = (await evaluate("[...document.querySelectorAll('[data-skin-choice]')].map(e=>e.dataset.skinChoice)")).filter(
  (s) => !ONLY.length || ONLY.includes(s),
);
if (!skins.length) fail("no skin choices matched");
const was = await evaluate("document.documentElement.dataset.skin");
const attrWas = attrProp ? await evaluate(`document.documentElement.dataset.${attrProp} ?? null`) : null;
if (attrProp) await evaluate(`document.documentElement.dataset.${attrProp}=${JSON.stringify(attrValue)}`);
if (CSS) await evaluate(`(()=>{const e=document.createElement("style");e.id="bench-css";e.textContent=${JSON.stringify(CSS)};document.head.append(e)})()`);

// SystemInfo answers on the browser target, not the page
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const bws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => (bws.onopen = r));
const cpuNow = () =>
  new Promise((resolve) => {
    bws.onmessage = (m) => {
      const info = JSON.parse(m.data).result?.processInfo ?? [];
      const sum = (t) => info.filter((p) => p.type === t).reduce((a, p) => a + p.cpuTime, 0);
      resolve({ gpu: sum("GPU"), page: sum("renderer"), t: performance.now() });
    };
    bws.send(JSON.stringify({ id: 1, method: "SystemInfo.getProcessInfo" }));
  });
const cpuPct = (a, b) => ({
  gpu: ((b.gpu - a.gpu) * 1000 * 100) / (b.t - a.t),
  page: ((b.page - a.page) * 1000 * 100) / (b.t - a.t),
});

const settle = async (s) => {
  if ((await evaluate("document.documentElement.dataset.skin")) !== s) {
    await evaluate(`document.querySelector('[data-skin-choice=${JSON.stringify(s)}]').click()`);
  }
  await evaluate("new Promise(r=>setTimeout(r,2600))"); // the longest rise (Ocean 1525 ms) + the cover
};
const SCROLL = `(async()=>{
  const el=document.querySelector('.lib-view--windowed')||document.querySelector('.lib-view');
  if(!el) return 'no library list';
  // Bounce inside the first 1500 px only: a run down the whole 3,895-row library measures
  // artwork arriving from the network (250 ms frames), not the skin. A warm-up bounce
  // caches those covers before the window opens.
  const top=Math.min(1500, el.scrollHeight-el.clientHeight);
  const bounce=(ms)=>new Promise(done=>{ const t0=performance.now(); let dir=1; const step=(now)=>{
    if(now-t0>ms) return done();
    el.scrollTop+=dir*6; // a steady held-wheel speed
    if(el.scrollTop>=top) dir=-1; else if(el.scrollTop<=0) dir=1;
    requestAnimationFrame(step); }; requestAnimationFrame(step); });
  el.scrollTop=0; await bounce(1500); el.scrollTop=0; await new Promise(r=>setTimeout(r,400));
  const w=__frames.sample(${WINDOW_MS},'bench-scroll');
  await bounce(${WINDOW_MS});
  return await w; })()`;

const runs = new Map(skins.map((s) => [s, []]));
for (let p = 0; p < PASSES; p++) {
  for (const s of skins) {
    let line, a, b;
    if (scene === "appearance") {
      // Click the real control: the MCP settings route is tagged by=agent and runs
      // --agent-motion slower, which hides exactly the hitches we are hunting.
      a = await cpuNow();
      line = await evaluate(`(async()=>{
        document.querySelector('[data-skin-choice=${JSON.stringify(s)}]').click();
        await new Promise(r=>setTimeout(r,120));
        return await __frames.sample(4200,'bench-${s}');
      })()`);
      b = await cpuNow();
      await evaluate("new Promise(r=>setTimeout(r,900))"); // let the cover fully settle
    } else {
      await settle(s);
      a = await cpuNow();
      line = await evaluate(scene === "idle" ? `__frames.sample(${WINDOW_MS},'bench-idle-${s}')` : SCROLL);
      b = await cpuNow();
    }
    if (!/frames/.test(line)) fail(`scene ${scene} on ${s}: ${line}`);
    runs.get(s).push({ line, cpu: cpuPct(a, b) });
  }
  process.stdout.write(`  pass ${p + 1}/${PASSES} done\n`);
}
bws.close();

// ── 3. report ────────────────────────────────────────────────────────────────
// Every gated run also appends to scripts/perf-history.csv, so a change can be compared with
// a week ago instead of with a memory. Only runs that got PAST the noise gate are written —
// a row from a noisy machine is worse than no row, because it looks like evidence.
// The gpu mode, renderer and hz go in each row: rows are only comparable within the same set.
const renderer = await evaluate(`(()=>{try{const c=document.createElement('canvas');
  const gl=c.getContext('webgl');const d=gl&&gl.getExtension('WEBGL_debug_renderer_info');
  const n=d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):'unknown';
  gl&&gl.getExtension('WEBGL_lose_context')?.loseContext();return n;}catch(e){return 'unknown'}})()`);
// The mode comes from the flags the runner really passed (the generated config), not from the
// renderer string: under --disable-gpu WebGL can be absent ("unknown" is not "accelerated"),
// and under --gpu=slow the renderer string is still the real card.
const gpuMode = /--disable-gpu(\s|$)/.test(args) ? "off" : /--disable-gpu-rasterization/.test(args) ? "slow" : "on";
const surface = await evaluate("document.documentElement.dataset.surface ?? ''");
const playing = await evaluate("/pause/i.test(document.querySelector('#np-playpause')?.getAttribute('aria-label')??'')");
let commit = "?", dirty = "?";
try {
  const { execFileSync } = await import("node:child_process");
  const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
  commit = git("rev-parse", "--short", "HEAD");
  dirty = git("status", "--porcelain").length ? "dirty" : "clean";
} catch {
  /* not a checkout — leave the marks */
}

const stats = (list) => {
  const fps = list.map((r) => fpsOf(r.line));
  return {
    fps: median(fps),
    worst: median(list.map((r) => Number(/worst (\d+)/.exec(r.line)?.[1] ?? 0))),
    drops: median(list.map((r) => Number(/dropped \d+ \(([\d.]+)%\)/.exec(r.line)?.[1] ?? 0))),
    sp: Math.max(...fps) ? ((Math.max(...fps) - Math.min(...fps)) / Math.max(...fps)) * 100 : 0,
    ms: /(\d+) ms ·/.exec(list[0].line)?.[1] ?? "",
    gpuCpu: median(list.map((r) => r.cpu.gpu)),
    pageCpu: median(list.map((r) => r.cpu.page)),
  };
};

console.log(`\n${scene} · gpu=${gpuMode} · surface ${surface} · playing ${playing}`);
console.log(`skin           window  fps(med)  spread  worst(med)  drop%  gpu-cpu  page-cpu`);
for (const [s, list] of runs) {
  const st = stats(list);
  const warn = st.sp > 25 ? "  ← too noisy to trust" : "";
  console.log(
    `${s.padEnd(13)}${(st.ms + "ms").padStart(8)}${String(st.fps).padStart(10)}${(st.sp.toFixed(0) + "%").padStart(8)}` +
      `${(st.worst + "ms").padStart(12)}${st.drops.toFixed(1).padStart(7)}${(st.gpuCpu.toFixed(0) + "%").padStart(9)}${(st.pageCpu.toFixed(0) + "%").padStart(10)}${warn}`,
  );
}
console.log(`\nspread is max→min fps across passes. Over ~25% and the median means nothing —`);
console.log(`quieten the machine and run again rather than believing it. cpu: 100% = one core.`);

// ── 4. the history file ──────────────────────────────────────────────────────
const CSV = join(root, "scripts", "perf-history.csv");
const HEAD =
  "when,commit,tree,scene,skin,surface,playing,gpu,renderer,hz,passes,window_ms,fps_med,spread_pct,worst_med_ms,drop_pct_med,gpu_cpu_pct,page_cpu_pct,note\n";
const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));
const when = new Date().toISOString();
const note = flag("note", "") + (CSS ? ` [css: ${CSS}]` : "") + (ATTR ? ` [attr: data-${ATTR}]` : "") + sharedNote;
let rows = "";
for (const [s, list] of runs) {
  const st = stats(list);
  rows +=
    [when, commit, dirty, scene, s, surface, playing, gpuMode, renderer, hz, PASSES, st.ms, st.fps, st.sp.toFixed(1), st.worst,
      st.drops.toFixed(1), st.gpuCpu.toFixed(1), st.pageCpu.toFixed(1), note]
      .map(csvCell)
      .join(",") + "\n";
}
if (!existsSync(CSV)) writeFileSync(CSV, HEAD);
appendFileSync(CSV, rows);
console.log(`\nappended ${runs.size} row(s) to scripts/perf-history.csv  (gpu=${gpuMode}, ${commit}/${dirty}${note ? `, note "${note}"` : ""})`);
if (dirty === "dirty") console.log(`the tree is DIRTY, so this row is not reproducible from the commit alone — pass --note to say what was in flight.`);

await evaluate(`document.getElementById("bench-css")?.remove()`);
if (attrProp) await evaluate(attrWas === null ? `delete document.documentElement.dataset.${attrProp}` : `document.documentElement.dataset.${attrProp}=${JSON.stringify(attrWas)}`);
await evaluate(`document.querySelector('[data-skin-choice=${JSON.stringify(was)}]')?.click()`); // put the look back
console.log(`\nrestored skin: ${was}`);
ws.close();
process.exit(0);
