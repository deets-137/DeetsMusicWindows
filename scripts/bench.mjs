// `node scripts/bench.mjs appearance|idle|scroll|airplay|grow|compass|sound|swap|libsort
// [--passes 3] [--skins press,ocean] [--ms 3000]
// [--note "…"] [--css "<rules>"] [--attr name=value] [--repeat N]` — a REPEATABLE measurement of a scene, so a graphics change can be A/B'd instead
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
const flagValues = new Set(["passes", "tolerance", "skins", "ms", "note", "css", "attr", "repeat"].map((f) => flag(f, null)).filter(Boolean));
const scene = argv.find((a) => !a.startsWith("--") && !flagValues.has(a)) ?? "appearance";
const PASSES = Math.max(1, Number(flag("passes", 3)));
const TOLERANCE = Number(flag("tolerance", 8));
const ONLY = flag("skins", "").split(",").filter(Boolean);
const WINDOW_MS = Number(flag("ms", 3000));
// --repeat N runs ONE scene N times and reports the memory slope instead of a frame table
// (DEBUGGING.md §the leak run). 1 = the ordinary benchmark.
const REPEAT = Math.max(1, Number(flag("repeat", 1)));
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
    const { execFile } = await import("node:child_process");
    const ps =
      "$s=(Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -SampleInterval 1 -MaxSamples 2).CounterSamples;" +
      "$s | Group-Object { ($_.InstanceName -split '_')[1] } | % { $p=[int]$_.Name; $v=($_.Group | Measure-Object CookedValue -Sum).Sum/2;" +
      "if($v -gt 10){ $n=(Get-Process -Id $p -EA SilentlyContinue).ProcessName; \"$n`t$([math]::Round($v))\" } }";
    // Async, and killed by hand on the deadline. execFileSync's own `timeout` did NOT end
    // this child: on 2026-09-17 three runs in a row hung in the gate, before any scene,
    // with a PowerShell still alive minutes later. The counter path expands to every engine
    // of every process, and on a busy machine that read can simply never come back — so the
    // gate now gives it 12 s, kills it, and carries on with no GPU names rather than hanging.
    const out = await new Promise((resolve) => {
      const child = execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", ps],
        { encoding: "utf8", windowsHide: true },
        (err, stdout) => resolve(err ? "" : stdout),
      );
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill("SIGKILL");
          console.log("[bench] the GPU counter read timed out — carrying on without it");
          resolve("");
        }
      }, 12000).unref?.();
    });
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => ({ name: l.split("\t")[0] || "?", pct: Number(l.split("\t")[1]) }))
      .filter((o) => !/msedgewebview2|dwm/i.test(o.name));
  } catch {
    return [];
  }
}

// ── the host exe ─────────────────────────────────────────────────────────────
// CDP's SystemInfo lists the WebView2 processes only, so the Rust exe — the AirPlay
// session, the tap ring, the SQLite work — was invisible to this bench (DEBUGGING.md
// §2026-09-17 review, item 3). PowerShell reads its CPU time and working set.
// The reading is taken OUTSIDE the CDP pair (before `a`, after `b`), so its ~200 ms
// costs nothing to the gpu and page percentages that older rows are compared with.
const { execFile: execAsync } = await import("node:child_process");
// Async and killable, for the same reason as gpuOthers: a bench run spawns this ~24 times
// per scene, and on 2026-09-17 one of those spawns hung and stalled the whole scene. A
// reading that does not come back in 5 s is dropped — the host columns read 0 for that
// window and the run carries on, which is better than a run that never ends.
function hostNow() {
  // Three numbers in one spawn: the host exe CPU time, its working set, and the working set
  // of the WHOLE app tree (the host plus every WebView2 child that descends from it). The
  // tree total is the leak signal perf-history.csv had no column for (review item 5): the
  // page heap can sit still while the renderer, the GPU process and the rest climb.
  const ps =
    "$root = Get-Process deetsmusic -EA SilentlyContinue | ? { $_.Path -like '*\\target\\*' } | Select-Object -First 1;" +
    "if (-not $root) { $root = Get-Process deetsmusic -EA SilentlyContinue | Select-Object -First 1 };" +
    "if ($root) {" +
    "  $all = Get-CimInstance Win32_Process -Filter \"Name='deetsmusic.exe' OR Name='msedgewebview2.exe'\";" +
    "  $by = @{}; foreach ($q in $all) { $by[[int]$q.ProcessId] = [int]$q.ParentProcessId };" +
    "  $tree = 0;" +
    "  foreach ($q in $all) {" +
    "    $id = [int]$q.ProcessId; $n = 0;" +
    "    while ($by.ContainsKey($id) -and $n -lt 10) { if ($id -eq $root.Id) { break }; $id = $by[$id]; $n++ };" +
    "    if ($id -eq $root.Id) { $g = Get-Process -Id $q.ProcessId -EA SilentlyContinue; if ($g) { $tree += $g.WorkingSet64 } }" +
    "  };" +
    "  \"$($root.TotalProcessorTime.TotalSeconds)`t$($root.WorkingSet64)`t$tree\"" +
    "}";
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const child = execAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", ps],
      { encoding: "utf8", windowsHide: true },
      (err, stdout) => {
        if (err || !stdout.trim()) return finish(null);
        const [cpu, ws, tree] = stdout.trim().split("\t");
        finish({ cpu: Number(cpu), ws: Number(ws) / 1048576, tree: Number(tree) / 1048576, t: performance.now() });
      },
    );
    setTimeout(() => {
      if (!done) {
        child.kill("SIGKILL");
        finish(null);
      }
    }, 5000).unref?.();
  });
}
const hostPct = (a, b) =>
  a && b ? { cpu: ((b.cpu - a.cpu) * 1000 * 100) / (b.t - a.t), ws: b.ws, tree: b.tree } : { cpu: 0, ws: 0, tree: 0 };

/** The page own JS heap in MB. `performance.memory` is Chromium's, so WebView2 has it. */
const heapMb = () =>
  evaluate("(()=>{const m=performance.memory; return m ? m.usedJSHeapSize/1048576 : 0})()").then((v) => Number(v) || 0);

/** Ask V8 to collect before a memory reading, so a slope means retention, not litter. */
const collect = async () => {
  try {
    await call("HeapProfiler.collectGarbage");
  } catch {
    /* the domain may be shut; readings without it are still comparable run to run */
  }
};

// ── 2. the scene ─────────────────────────────────────────────────────────────
// appearance : switch to each skin; the window is the rise (a TRANSITION cost).
// idle       : settle on each skin, then touch nothing (a STEADY cost: the aurora, the sea, the
//              album aurora, the record player when a song plays).
// scroll     : settle on each skin, then scroll the library list at a steady speed (the cost of
//              content moving under and over each skin's layers).
// Frames ÷ ms stops at the display rate for any cheap scene, so every window also records the
// CPU time the GPU process and the page's renderer spent in it (CDP SystemInfo; 100 = one core).
// Under --gpu=off the GPU process IS the rasteriser, so its CPU is the whole draw cost.
// airplay    : a song through a live AirPlay session (AIRPLAY.md §12). It measures the part
//              the other scenes cannot see: the host exe's CPU, the in-page tap's worst gap
//              between chunks, and whether the session starved. It does NOT connect a
//              speaker — a script must not take a speaker the room is listening to — so
//              connect one in the app first, then run it.
const GESTURE_NAMES = ["grow", "compass", "sound", "swap", "libsort"];
const SCENES = ["appearance", "idle", "scroll", "airplay", ...GESTURE_NAMES];
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

// ── the gesture scenes (2026-09-17, review item 4) ───────────────────────────
// Every scene below clicks the app's OWN control and puts the state back, so a pass leaves
// the app as it found it. They exist because the three scenes above all predate Grow, the
// Compass, the Sound panel, the card swap and the library's sort pop: those gestures were
// only ever measured incidentally, from the owner using the app, which cannot be re-run.
//
// `wait` is the only tuning: each is the motion's own length plus a settle, read from the
// token it animates on. A scene that finds no control returns a sentence, and the pass
// fails with it rather than reporting a number for a gesture that did not happen.
const GESTURES = {
  // Grow a card from a real edge strip, then collapse it from the strip that now collapses.
  // The same path as `deetsmusic grow <card> <dir>`: both end in growCard().
  grow: `(async()=>{
    const zone=(act)=>document.querySelector('.grow-zone[data-act="'+act+'"]:not([hidden])');
    if(!zone('grow')) return 'no grow zone — Settings › Window › Grow cards from edges is off, or the window is Mini';
    const w=__frames.sample(${WINDOW_MS},'bench-grow');
    zone('grow').click();
    await new Promise(r=>setTimeout(r,1100));
    const grew=!!document.querySelector('[data-grown], .is-grown, .panel--grown');
    (zone('collapse')||zone('grow')).click();
    await new Promise(r=>setTimeout(r,900));
    const line=await w;
    return grew?line:'the click did not grow a card — '+line; })()`,

  // Ctrl+Space, four keystrokes, then Escape twice (the first clears the text, the second
  // closes — COMPASS.md). The typing is what costs: every keystroke re-ranks the rows.
  compass: `(async()=>{
    // The bar is built once and hidden, so its INPUT always exists: the panel hidden flag is
    // the only honest "is it open" (an earlier version read the input and believed the bar
    // was stuck open through three scenes — 2026-09-17).
    const bar=document.getElementById('compass');
    const open=()=>!!bar&&!bar.hidden;
    if(!bar) return 'no compass bar in this build';
    const w=__frames.sample(${WINDOW_MS},'bench-compass');
    document.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',ctrlKey:true,bubbles:true}));
    await new Promise(r=>setTimeout(r,450));
    const i=bar.querySelector('.compass__input');
    if(!open()||!i) return 'Ctrl+Space did not open the compass';
    for(const ch of 'libr'){
      i.value+=ch;
      i.dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(r=>setTimeout(r,140));
    }
    await new Promise(r=>setTimeout(r,350));
    for(let k=0;k<2;k++){
      i.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));
      await new Promise(r=>setTimeout(r,200));
    }
    // The bar MUST be shut again: one left open would sit over every scene after it.
    if(open()) document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));
    await new Promise(r=>setTimeout(r,250));
    const line=await w;
    return open()?'the compass bar would not close — '+line:line; })()`,

  // The title-bar Sound panel: open, let the rows fly in and the curve draw, close.
  sound: `(async()=>{
    const btn=document.getElementById('sound-btn');
    if(!btn) return 'no sound button';
    const panel=document.getElementById('sound-panel');
    const shown=()=>!!panel&&!panel.hidden&&panel.offsetHeight>0;
    const bar=document.getElementById('compass');
    if(bar&&!bar.hidden){ document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true})); await new Promise(r=>setTimeout(r,250)); }
    const w=__frames.sample(${WINDOW_MS},'bench-sound');
    btn.click();
    await new Promise(r=>setTimeout(r,1200));
    const opened=shown();
    btn.click();
    await new Promise(r=>setTimeout(r,700));
    const line=await w;
    return opened?line:'the panel never opened — '+line; })()`,

  // A card swap through the slot picker: the card title is the trigger, then a sibling card
  // is picked and the original put back. Two swaps, so the scene ends where it started.
  swap: `(async()=>{
    const title=[...document.querySelectorAll('.panel__title.is-pickable')][0];
    if(!title) return 'no pickable card title';
    const head=title.closest('.panel__head');
    const menu=head&&head.querySelector('.slot-picker__menu');
    if(!menu) return 'no slot picker';
    const items=[...menu.querySelectorAll('.flyout__item')];
    const mine=items.find(b=>b.getAttribute('aria-checked')==='true');
    const other=items.find(b=>b.getAttribute('aria-checked')!=='true');
    if(!mine||!other) return 'only one card in the pool';
    const w=__frames.sample(${WINDOW_MS},'bench-swap');
    title.click(); await new Promise(r=>setTimeout(r,260));
    other.click(); await new Promise(r=>setTimeout(r,1100));
    const back=()=>{
      const h=[...document.querySelectorAll('.panel__title.is-pickable')].map(t=>t.closest('.panel__head'))
        .find(h=>h&&h.querySelector('.flyout__item[data-card-id='+JSON.stringify(mine.dataset.cardId)+']'));
      return h&&{t:h.querySelector('.panel__title'),b:h.querySelector('.flyout__item[data-card-id='+JSON.stringify(mine.dataset.cardId)+']')};
    };
    const r2=back();
    if(r2&&r2.t&&r2.b){ r2.t.click(); await new Promise(r=>setTimeout(r,260)); r2.b.click(); }
    await new Promise(r=>setTimeout(r,900));
    return await w; })()`,

  // The library's Sort pop: open it, pick another key, put the old one back. This is the
  // gesture the logs call `pointerup lib-pop__opt` — the slowest press→paint in the app.
  libsort: `(async()=>{
    // The LONG list, not whichever sort pill is first on screen: a 48-row playlist sorts in
    // no time and would report a healthy number for the gesture that is actually slow. The
    // windowed view only exists past WINDOW_MIN rows, so it is the marker for "long".
    const view=document.querySelector('.lib-view--windowed');
    const card=view&&view.closest('.panel');
    const pill=card&&card.querySelector('.lib-pill[data-pop="sort"]');
    if(!pill) return 'no long sorted list on screen — put Library (all songs) in a slot and run again';
    const rows=view.querySelectorAll('[data-idx]').length;
    const w=__frames.sample(${WINDOW_MS},'bench-libsort');
    pill.click(); await new Promise(r=>setTimeout(r,260));
    const opts=[...document.querySelectorAll('.lib-pop__opt[data-sort-key]')];
    const was=opts.find(o=>o.classList.contains('is-active'));
    const other=opts.find(o=>!o.classList.contains('is-active'));
    if(!was||!other) return 'no second sort key';
    const wasKey=was.dataset.sortKey;
    other.click();
    await new Promise(r=>setTimeout(r,900));
    pill.click(); await new Promise(r=>setTimeout(r,260));
    const back=[...document.querySelectorAll('.lib-pop__opt[data-sort-key]')].find(o=>o.dataset.sortKey===wasKey);
    if(back) back.click();
    await new Promise(r=>setTimeout(r,900));
    return (await w)+' · windowed list, '+rows+' rows mounted'; })()`,
};

// ── the airplay scene ────────────────────────────────────────────────────────
// One window over a song that is already playing on a speaker the user connected. It
// reports what no other scene can: the host exe's CPU (the session, the encoder and the
// ring live there), the in-page tap's worst gap between chunks, and any "tap starved"
// line the session wrote while the window was open. The 500 ms prefill (AIRPLAY.md §12)
// was sized from ONE run; this makes it a number that can be re-measured.
if (scene === "airplay") {
  const tap = await evaluate("(()=>{try{return __sound.status().tap}catch(e){return null}})()");
  const playingNow = await evaluate("/pause/i.test(document.querySelector('#np-playpause')?.getAttribute('aria-label')??'')");
  if (!tap?.armed) {
    fail(
      `no in-page tap is armed. Connect a speaker in the app (AirPlay row) with Capture set to
        "This app", then run again. This scene never connects a speaker itself, and it
        cannot measure All-PC-sound (loopback), which has no tap.`,
      1,
    );
  }
  if (!playingNow) fail("nothing is playing — start a song on the speaker, then run again.", 1);

  const logFile = join(process.env.APPDATA ?? "", "com.deetsmusic.dev", "airplay.log");
  const starvedLines = () => {
    try {
      return readFileSync(logFile, "utf8").split("\n").filter((l) => /starved/.test(l)).length;
    } catch {
      return 0;
    }
  };

  const before = { ...tap, starved: starvedLines() };
  const ha = await hostNow();
  const a = await cpuNow();
  const line = await evaluate(`__frames.sample(${AIRPLAY_MS},'bench-airplay')`);
  const b = await cpuNow();
  const host = hostPct(ha, await hostNow());
  const after = await evaluate("__sound.status().tap");
  const cpu = cpuPct(a, b);
  const starved = starvedLines() - before.starved;
  const secs = Math.round(AIRPLAY_MS / 1000);

  console.log(`\nairplay · ${secs} s window · ${line}`);
  console.log(`  chunks         ${after.chunks - before.chunks} in the window (${((after.chunks - before.chunks) / secs).toFixed(1)}/s)`);
  console.log(`  failed         ${after.failed - before.failed}`);
  console.log(`  worst gap      ${after.worstGapMs} ms${after.worstGapMs > before.worstGapMs ? " (a new worst, set in this window)" : " (set before this window)"}`);
  console.log(`  last gap       ${after.lastGapMs} ms`);
  console.log(`  starved lines  ${starved}${starved ? "  ← the page stopped feeding the session" : ""}`);
  console.log(`  host exe       ${host.cpu.toFixed(0)}% cpu · ${host.ws.toFixed(0)} MB`);
  console.log(`  gpu ${cpu.gpu.toFixed(0)}% · page ${cpu.page.toFixed(0)}%`);
  console.log(`\nA gap over ~500 ms is the prefill's whole budget (AIRPLAY.md §12). cpu: 100% = one core.`);
  ws.close();
  process.exit(0);
}

// ── the leak run — `--repeat N` (2026-09-17, review item 5) ──────────────────
//
// A scene run N times over, with a forced collection and a memory reading between each, and
// a least-squares slope at the end: **MB per run**. This is the question `perf-history.csv`
// could not answer — whether a gesture RETAINS anything — and it is the shape of the
// night-of-09-16 climb, where the page looked still while the tree grew 70 MB per 10 min.
//
// Both numbers are kept because they fail differently. The page heap catches a listener, a
// closure or a detached node the JS side is holding. The tree total catches what the heap
// never sees: renderer layers, GPU textures, the audio graph, the host exe. A run where the
// heap is flat and the tree climbs is exactly the case that went unnamed in September.
if (REPEAT > 1) {
  const skin = skins[0];
  await settle(skin);
  const expr = scene === "idle" ? `__frames.sample(${WINDOW_MS},'bench-idle-${skin}')` : scene === "scroll" ? SCROLL : GESTURES[scene];
  if (!expr) fail(`--repeat needs a gesture scene, not ${JSON.stringify(scene)}`);
  console.log(`leak run — ${scene} on ${skin}, ${REPEAT} times, collecting between each\n`);
  console.log(`  run   heap MB   tree MB`);
  const heaps = [];
  const trees = [];
  for (let i = 0; i <= REPEAT; i++) {
    await collect();
    await evaluate("new Promise(r=>setTimeout(r,250))"); // let the collection land
    const h = await heapMb();
    const host = await hostNow();
    heaps.push(h);
    trees.push(host?.tree ?? 0);
    console.log(`  ${String(i).padStart(3)}${h.toFixed(1).padStart(10)}${(host?.tree ?? 0).toFixed(0).padStart(10)}`);
    if (i === REPEAT) break;
    const line = await evaluate(expr);
    if (!/frames/.test(line)) fail(`scene ${scene} on ${skin}: ${line}`);
  }
  // Least squares over the readings, so one noisy sample cannot make a slope on its own.
  const slope = (ys) => {
    const n = ys.length;
    const mx = (n - 1) / 2;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    ys.forEach((y, x) => {
      num += (x - mx) * (y - my);
      den += (x - mx) ** 2;
    });
    return den ? num / den : 0;
  };
  // The FIRST run is not a leak: a gesture builds its one-time structures then (the Compass's
  // rows, a panel's markup, a worklet). On the smoke test the heap stepped 7.6 → 10.0 MB on
  // run 1 and then sat at 10.1–10.2 for seven more. So the headline slope is the WARM one,
  // from run 1 on, and the cold step is reported beside it instead of being smeared into it.
  const hs = slope(heaps.slice(1));
  const ts = slope(trees.slice(1));
  const coldHeap = heaps.length > 1 ? heaps[1] - heaps[0] : 0;
  const coldTree = trees.length > 1 ? trees[1] - trees[0] : 0;
  const sign = (n, d = 2) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}`;
  console.log(
    `\nheap  ${heaps[0].toFixed(1)} → ${heaps[heaps.length - 1].toFixed(1)} MB · first run ${sign(coldHeap, 1)} (one-time build) · warm slope ${sign(hs)} MB per run`,
  );
  console.log(
    `tree  ${trees[0].toFixed(0)} → ${trees[trees.length - 1].toFixed(0)} MB · first run ${sign(coldTree, 0)} · warm slope ${sign(ts)} MB per run`,
  );
  console.log(
    `\nA slope near zero is what a clean gesture looks like. Windows hands memory back lazily,\nso read the TREND over ${REPEAT} runs, never two readings — and re-run before believing a\nsmall positive slope, because one GC that did not finish looks exactly like a small leak.`,
  );
  await evaluate(`document.querySelector('[data-skin-choice=${JSON.stringify(was)}]')?.click()`);
  ws.close();
  process.exit(0);
}


const runs = new Map(skins.map((s) => [s, []]));
for (let p = 0; p < PASSES; p++) {
  for (const s of skins) {
    let line, a, b;
    const ha = await hostNow();
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
      const expr =
        scene === "idle" ? `__frames.sample(${WINDOW_MS},'bench-idle-${s}')` : scene === "scroll" ? SCROLL : GESTURES[scene];
      line = await evaluate(expr);
      b = await cpuNow();
    }
    if (!/frames/.test(line)) fail(`scene ${scene} on ${s}: ${line}`);
    runs.get(s).push({ line, cpu: cpuPct(a, b), host: hostPct(ha, await hostNow()), heap: await heapMb() });
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
    hostCpu: median(list.map((r) => r.host?.cpu ?? 0)),
    hostWs: median(list.map((r) => r.host?.ws ?? 0)),
    heap: median(list.map((r) => r.heap ?? 0)),
    treeWs: median(list.map((r) => r.host?.tree ?? 0)),
  };
};

console.log(`\n${scene} · gpu=${gpuMode} · surface ${surface} · playing ${playing}`);
console.log(`skin           window  fps(med)  spread  worst(med)  drop%  gpu-cpu  page-cpu  host-cpu  host-MB  heap-MB  tree-MB`);
for (const [s, list] of runs) {
  const st = stats(list);
  const warn = st.sp > 25 ? "  ← too noisy to trust" : "";
  console.log(
    `${s.padEnd(13)}${(st.ms + "ms").padStart(8)}${String(st.fps).padStart(10)}${(st.sp.toFixed(0) + "%").padStart(8)}` +
      `${(st.worst + "ms").padStart(12)}${st.drops.toFixed(1).padStart(7)}${(st.gpuCpu.toFixed(0) + "%").padStart(9)}${(st.pageCpu.toFixed(0) + "%").padStart(10)}` +
      `${(st.hostCpu.toFixed(0) + "%").padStart(10)}${st.hostWs.toFixed(0).padStart(9)}` +
      `${st.heap.toFixed(0).padStart(9)}${st.treeWs.toFixed(0).padStart(9)}${warn}`,
  );
}
console.log(`\nspread is max→min fps across passes. Over ~25% and the median means nothing —`);
console.log(`quieten the machine and run again rather than believing it. cpu: 100% = one core.`);

// ── 4. the history file ──────────────────────────────────────────────────────
// Every gated run appends here, so a change can be compared with a week ago instead of with
// a memory. Only runs that got PAST the noise gate are written — a row from a noisy machine
// is worse than no row, because it looks like evidence.
//
// COLUMNS grows over time, and every new column has been appended just before `note`. A file
// written by an older bench therefore has SHORTER rows, and on 2026-09-17 the header was left
// behind while the rows grew, which makes the whole history unreadable in a spreadsheet. So
// the writer migrates: it reads what is there, re-spells every row against the current
// columns (a row of K fields is the first K-1 columns plus `note`) and rewrites the file with
// the current header. Nothing is lost and the file is always square.
const CSV = join(root, "scripts", "perf-history.csv");
const COLUMNS = [
  "when", "commit", "tree", "scene", "skin", "surface", "playing", "gpu", "renderer", "hz",
  "passes", "window_ms", "fps_med", "spread_pct", "worst_med_ms", "drop_pct_med",
  "gpu_cpu_pct", "page_cpu_pct", "host_cpu_pct", "host_ws_mb", "page_heap_mb", "tree_ws_mb", "note",
];
const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));

/** One CSV line → its fields, honouring quotes (the renderer string and notes hold commas). */
function csvSplit(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Bring an older file up to the current columns, then append `rows`. */
function writeHistory(rows) {
  const head = COLUMNS.join(",") + "\n";
  if (!existsSync(CSV)) {
    writeFileSync(CSV, head + rows);
    return 0;
  }
  const lines = readFileSync(CSV, "utf8").split("\n").map((l) => l.replace("\r", "")).filter((l) => l.trim());
  const had = lines[0] === COLUMNS.join(",");
  if (had) {
    appendFileSync(CSV, rows);
    return 0;
  }
  const body = lines.slice(1).map((l) => {
    const f = csvSplit(l);
    const wide = COLUMNS.map(() => "");
    // Every column was added before `note`, so the leading fields line up and the last is note.
    for (let i = 0; i < f.length - 1 && i < COLUMNS.length - 1; i++) wide[i] = f[i];
    wide[COLUMNS.length - 1] = f[f.length - 1] ?? "";
    return wide.map(csvCell).join(",");
  });
  writeFileSync(CSV, head + body.join("\n") + "\n" + rows);
  return body.length;
}

const when = new Date().toISOString();
const note = flag("note", "") + (CSS ? ` [css: ${CSS}]` : "") + (ATTR ? ` [attr: data-${ATTR}]` : "") + sharedNote;
let rows = "";
for (const [s, list] of runs) {
  const st = stats(list);
  rows +=
    [when, commit, dirty, scene, s, surface, playing, gpuMode, renderer, hz, PASSES, st.ms, st.fps, st.sp.toFixed(1), st.worst,
      st.drops.toFixed(1), st.gpuCpu.toFixed(1), st.pageCpu.toFixed(1), st.hostCpu.toFixed(1), st.hostWs.toFixed(0),
      st.heap.toFixed(1), st.treeWs.toFixed(0), note]
      .map(csvCell)
      .join(",") + "\n";
}
const migrated = writeHistory(rows);
console.log(`\nappended ${runs.size} row(s) to scripts/perf-history.csv  (gpu=${gpuMode}, ${commit}/${dirty}${note ? `, note "${note}"` : ""})`);
if (migrated) console.log(`re-spelled ${migrated} older row(s) against the current columns (the file had an older header)`);
if (dirty === "dirty") console.log(`the tree is DIRTY, so this row is not reproducible from the commit alone — pass --note to say what was in flight.`);

await evaluate(`document.getElementById("bench-css")?.remove()`);
if (attrProp) await evaluate(attrWas === null ? `delete document.documentElement.dataset.${attrProp}` : `document.documentElement.dataset.${attrProp}=${JSON.stringify(attrWas)}`);
await evaluate(`document.querySelector('[data-skin-choice=${JSON.stringify(was)}]')?.click()`); // put the look back
console.log(`\nrestored skin: ${was}`);
ws.close();
process.exit(0);
