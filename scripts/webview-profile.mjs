// `node scripts/webview-profile.mjs "<js>"` — sample the DEV app's main-thread CPU while
// one expression runs (a promise is awaited), then print where the self time went: the
// top functions (name · file:line · ms · %) and the top files. The sibling of
// scripts/webview-eval.mjs, same CDP port discovery; DEBUGGING.md §Profiling the webview.
// Native buckets are Chromium's own: "(program)" = the engine's work outside JS (style,
// layout, paint, image handling…), "(garbage collector)", "(idle)".
//
// `--trace` swaps the JS sampler for Chromium's timeline trace: the engine's own events
// (Layout, UpdateLayoutTree, Paint, HitTest, ImageDecode, EventDispatch, FunctionCall…)
// summed by name with count and max — the view that says what "(program)" was doing.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (msg, code = 2) => {
  console.error(`[webview-profile] ${msg}`);
  process.exit(code);
};
const argv = process.argv.slice(2);
const TRACE = argv.includes("--trace");
const expr = argv.filter((a) => a !== "--trace").join(" ");
if (!expr) fail('usage: node scripts/webview-profile.mjs "<expression>"');

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

const report = (evaluated) => {
  if (evaluated.exceptionDetails) console.error("expression threw:", evaluated.exceptionDetails.exception?.description ?? evaluated.exceptionDetails.text);
  else console.log("result:", JSON.stringify(evaluated.result.value));
};

if (TRACE) {
  const events = [];
  ws.addEventListener("message", (m) => {
    const msg = JSON.parse(m.data);
    if (msg.method === "Tracing.dataCollected") events.push(...msg.params.value);
  });
  const done = new Promise((r) => {
    const onMsg = (m) => {
      if (JSON.parse(m.data).method === "Tracing.tracingComplete") {
        ws.removeEventListener("message", onMsg);
        r();
      }
    };
    ws.addEventListener("message", onMsg);
  });
  await call("Tracing.start", {
    traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "blink.user_timing"], excludedCategories: ["*"] },
    transferMode: "ReportEvents",
  });
  const t0 = Date.now();
  const evaluated = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  const wall = Date.now() - t0;
  await call("Tracing.end");
  await done;
  ws.close();
  report(evaluated);
  // Complete events (ph X) carry `dur` in µs; sum by name. Only the renderer's main thread
  // matters here — pick the thread that hosts the most events with a duration.
  // The page's main thread is the one that does the rendering work: pick the pid/tid
  // with the most time in Layout / style / paint / script events.
  const RENDER = new Set(["Layout", "UpdateLayoutTree", "Paint", "FunctionCall", "EventDispatch", "HitTest", "PrePaint", "UpdateLayerTree"]);
  const byThread = new Map();
  for (const e of events) if (e.ph === "X" && e.dur && RENDER.has(e.name)) { const k = `${e.pid}/${e.tid}`; byThread.set(k, (byThread.get(k) ?? 0) + e.dur); }
  const mainKey = [...byThread].sort((a, b) => b[1] - a[1])[0]?.[0];
  const agg = new Map();
  for (const e of events) {
    if (e.ph !== "X" || !e.dur || `${e.pid}/${e.tid}` !== mainKey) continue;
    const a = agg.get(e.name) ?? { us: 0, n: 0, max: 0 };
    a.us += e.dur;
    a.n += 1;
    if (e.dur > a.max) a.max = e.dur;
    agg.set(e.name, a);
  }
  console.log(`
wall ${wall} ms · ${events.length} trace events · main thread ${mainKey}
`);
  console.log("timeline events on the main thread (inclusive time, so parents contain children):");
  const ms = (us) => (us / 1000).toFixed(1).padStart(8);
  for (const [name, a] of [...agg].sort((x, y) => y[1].us - x[1].us).slice(0, 25))
    console.log(`${ms(a.us)} ms  ×${String(a.n).padStart(5)}  max ${ms(a.max)} ms  ${name}`);
  process.exit(0);
}

await call("Profiler.enable");
await call("Profiler.setSamplingInterval", { interval: 250 }); // µs
await call("Profiler.start");
const t0 = Date.now();
const evaluated = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
const wall = Date.now() - t0;
const { profile } = await call("Profiler.stop");
ws.close();
report(evaluated);

// Self time per node: each sample charges its node the following time delta.
const self = new Map();
for (let i = 0; i < profile.samples.length; i++) {
  const id = profile.samples[i];
  const dt = profile.timeDeltas[i] ?? 0;
  self.set(id, (self.get(id) ?? 0) + dt);
}
const byNode = new Map(profile.nodes.map((n) => [n.id, n]));
const short = (url) => (url ? url.replace(/^https?:\/\/[^/]+\//, "").replace(/\?.*$/, "") : "");
const byFn = new Map();
const byFile = new Map();
let total = 0;
for (const [id, us] of self) {
  const n = byNode.get(id);
  if (!n) continue;
  const cf = n.callFrame;
  const file = cf.url ? short(cf.url) : cf.functionName || "(native)";
  const key = `${cf.functionName || "(anonymous)"} · ${file}${cf.url ? ":" + (cf.lineNumber + 1) : ""}`;
  byFn.set(key, (byFn.get(key) ?? 0) + us);
  byFile.set(file, (byFile.get(file) ?? 0) + us);
  total += us;
}
const ms = (us) => (us / 1000).toFixed(1).padStart(8);
const pct = (us) => ((100 * us) / total).toFixed(1).padStart(5) + "%";
console.log(`\nwall ${wall} ms · sampled ${(total / 1000).toFixed(0)} ms of main-thread time\n`);
console.log("top functions (self time):");
for (const [k, us] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`${ms(us)} ms ${pct(us)}  ${k}`);
console.log("\ntop files:");
for (const [k, us] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`${ms(us)} ms ${pct(us)}  ${k}`);
