// `node scripts/frame-why.mjs "<js>"` — why the DEV app's main thread worked on each frame
// while one expression ran (a promise is awaited): the frame recorder (DEBUGGING.md § Why a
// frame is late, 2026-10-18, his ask: hunt the frame drops before fixing them).
//
// It traces with Chromium's invalidation tracking on, then for every main-thread frame
// (`BeginMainFrame`) prints its time split (style, layout, paint, script) and the INVALIDATIONS
// that made its style or layout dirty: the element, the reason ("Inline CSS style declaration
// was mutated", "Attribute", "Animation"…) and, when a script did it, the script's line. The
// summary at the end ranks the causes over the whole run, which is the list to fix from.
//
// A composited animation (transform, opacity, and clip-path in this WebView2) needs no main-
// thread frame at all; a frame that recalculates style during one is the thing to explain.
//
// Flags: `--frames=N` prints the N costliest frames (default 12); `--all` prints every frame;
// `--causes=N` prints N invalidations per frame (default 6), subtree ones first.
// Same CDP port discovery as webview-eval.mjs / webview-profile.mjs.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (msg, code = 2) => {
  console.error(`[frame-why] ${msg}`);
  process.exit(code);
};
const argv = process.argv.slice(2);
const expr = argv.filter((a) => !a.startsWith("--")).join(" ");
if (!expr) fail('usage: node scripts/frame-why.mjs "<expression>" [--frames=N] [--all]');
const showN = Number((argv.find((a) => a.startsWith("--frames=")) ?? "").slice(9)) || 12;
const ALL = argv.includes("--all");
const causesN = Number((argv.find((a) => a.startsWith("--causes=")) ?? "").slice(9)) || 6;

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
const events = [];
let complete;
const done = new Promise((r) => (complete = r));
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  } else if (msg.method === "Tracing.dataCollected") events.push(...msg.params.value);
  else if (msg.method === "Tracing.tracingComplete") complete();
};
ws.onerror = () => fail("websocket error");
await new Promise((r) => (ws.onopen = r));

await call("Tracing.start", {
  traceConfig: {
    includedCategories: [
      "devtools.timeline",
      "disabled-by-default-devtools.timeline",
      "disabled-by-default-devtools.timeline.invalidationTracking",
      "disabled-by-default-devtools.timeline.stack",
      "blink.user_timing",
      "cc", // ProxyMain::BeginMainFrame, the frame boundary
      "benchmark",
    ],
    excludedCategories: ["*"],
  },
  transferMode: "ReportEvents",
});
const evaluated = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
await call("Tracing.end");
await done;
ws.close();
if (evaluated.exceptionDetails) console.error("expression threw:", evaluated.exceptionDetails.exception?.description ?? evaluated.exceptionDetails.text);

// The renderer's main thread: the thread named CrRendererMain with the most events.
const names = new Map();
for (const e of events) if (e.ph === "M" && e.name === "thread_name") names.set(`${e.pid}/${e.tid}`, e.args?.name ?? "?");
const count = new Map();
for (const e of events) {
  const k = `${e.pid}/${e.tid}`;
  if (names.get(k) === "CrRendererMain") count.set(k, (count.get(k) ?? 0) + 1);
}
const main = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
if (!main) fail("no renderer main thread in the trace");
const onMain = events.filter((e) => `${e.pid}/${e.tid}` === main).sort((a, b) => a.ts - b.ts);

const ms = (us) => (us / 1000).toFixed(1);
/** A script position from a trace stack: "file.ts:line fn". */
const where = (stack) => {
  const f = (stack ?? []).find((s) => s.url && !s.url.includes("frame-why"));
  if (!f) return null;
  const file = f.url.replace(/^https?:\/\/[^/]+\//, "").replace(/\?.*$/, "");
  return `${file}:${(f.lineNumber ?? 0) + 1}${f.functionName ? ` ${f.functionName}` : ""}`;
};
/** One invalidation as a short line: what, why, from where. */
const describe = (e) => {
  const d = e.args?.data ?? {};
  const node = d.nodeName ? d.nodeName.replace(/\s+/g, " ").slice(0, 60) : "";
  const reason = d.reason ?? d.invalidationSet?.toString?.() ?? e.name;
  const extra = d.extraData ? ` (${String(d.extraData).slice(0, 40)})` : "";
  const src = where(d.stackTrace) ?? where(e.args?.beginData?.stackTrace);
  return `${e.name.replace("InvalidationTracking", "")}: ${reason}${extra}${node ? ` · ${node}` : ""}${src ? ` · ${src}` : ""}`;
};

// Frames: each BeginMainFrame on the main thread. Invalidations between the end of the frame
// before and the end of this one are this frame's causes.
const frames = onMain.filter((e) => e.name === "ProxyMain::BeginMainFrame" && e.ph === "X");
const inside = (e, f) => e.ts >= f.ts && e.ts < f.ts + f.dur;
const sum = (f, name) => onMain.filter((e) => e.ph === "X" && e.name === name && inside(e, f)).reduce((s, e) => s + e.dur, 0);
const INV = /InvalidationTracking$|^ScheduleStyleRecalculation$|^InvalidateLayout$/;
const SCRIPT = new Set(["FunctionCall", "TimerFire", "FireAnimationFrame", "EventDispatch", "RunMicrotasks", "v8.callFunction"]);
/** A script event as "kind file:line fn". */
function scriptName(e) {
  const d = e.args?.data ?? {};
  const file = d.url ? `${d.url.replace(/^https?:\/\/[^/]+\//, "").replace(/\?.*$/, "")}:${(d.lineNumber ?? 0) + 1}` : "";
  const kind = e.name === "EventDispatch" ? `event ${d.type}` : e.name === "TimerFire" ? "timer" : e.name === "FireAnimationFrame" ? "frame callback" : e.name;
  return `${kind}${file ? ` ${file}` : ""}${d.functionName ? ` ${d.functionName}` : ""}`;
}
const invs = onMain.filter((e) => INV.test(e.name));
const rows = [];
let from = frames.length ? frames[0].ts - 1e6 : 0;
for (const f of frames) {
  const end = f.ts + f.dur;
  const causes = invs.filter((e) => e.ts >= from && e.ts < end).map(describe);
  from = end;
  const style = sum(f, "UpdateLayoutTree");
  const elements = onMain.filter((e) => e.name === "UpdateLayoutTree" && inside(e, f)).reduce((s, e) => s + (e.args?.elementCount ?? 0), 0);
  // The scripts that ran for this frame: from the frame before to this frame's end (timers,
  // events and promise jobs run between frames; animation-frame callbacks run inside it).
  const scripts = onMain
    .filter((e) => e.ph === "X" && e.dur >= 300 && e.ts >= from - (end - f.ts) && e.ts < end && SCRIPT.has(e.name))
    .map((e) => ({ ms: e.dur, what: scriptName(e) }))
    .sort((a, b) => b.ms - a.ms);
  rows.push({ f, total: f.dur, style, layout: sum(f, "Layout"), paint: sum(f, "Paint") + sum(f, "PrePaint"), script: sum(f, "FireAnimationFrame") + sum(f, "FunctionCall"), elements, causes, scripts });
}
// Forced style and layout outside a frame (a script read a box): their own causes.
const forced = onMain.filter((e) => e.ph === "X" && (e.name === "UpdateLayoutTree" || e.name === "Layout") && !frames.some((f) => inside(e, f)));

const t0 = frames[0]?.ts ?? 0;
console.log(`result: ${JSON.stringify(evaluated.result?.value)}`);
console.log(`\n${frames.length} main-thread frames · ${invs.length} invalidations · ${forced.length} forced style/layout passes outside a frame (${ms(forced.reduce((s, e) => s + e.dur, 0))} ms)`);
const pick = ALL ? rows : [...rows].sort((a, b) => b.total - a.total).slice(0, showN).sort((a, b) => a.f.ts - b.f.ts);
console.log(`\n${ALL ? "every frame" : `the ${pick.length} costliest frames`} (time from the first frame; ms):`);
for (const r of pick) {
  console.log(`  +${ms(r.f.ts - t0).padStart(7)}  ${ms(r.total).padStart(5)}  style ${ms(r.style)} (${r.elements} el) · layout ${ms(r.layout)} · paint ${ms(r.paint)} · script ${ms(r.script)}`);
  r.scripts.slice(0, 4).forEach((s) => console.log(`           ▸ ${ms(s.ms).padStart(5)} ms ${s.what}`));
  const seen = new Map();
  for (const c of r.causes) seen.set(c, (seen.get(c) ?? 0) + 1);
  // A subtree invalidation restyles everything under its element: it explains a large count.
  const listed = causesN > 6 ? [...seen].sort((a, b) => Number(b[0].includes("subtree")) - Number(a[0].includes("subtree"))) : [...seen];
  listed.slice(0, causesN).forEach(([c, n]) => console.log(`             ${n > 1 ? `${n}× ` : ""}${c}`));
  if (seen.size > causesN) console.log(`             … ${seen.size - causesN} more`);
}
// The ranking: each cause (without its node, so one reason on many rows counts as one), the
// frames it dirtied and the style time of those frames.
const rank = new Map();
for (const r of rows) {
  const keys = new Set(r.causes.map((c) => c.replace(/ · [^·]*(?= · |$)/, "")));
  for (const k of keys) {
    const x = rank.get(k) ?? { frames: 0, style: 0 };
    x.frames++;
    x.style += r.style + r.layout;
    rank.set(k, x);
  }
}
console.log(`\nthe causes, by the style + layout time of the frames they dirtied:`);
[...rank].sort((a, b) => b[1].style - a[1].style).slice(0, 15).forEach(([k, x]) => console.log(`  ${ms(x.style).padStart(7)} ms  ${String(x.frames).padStart(4)} frames  ${k}`));
if (forced.length) {
  console.log(`\nforced passes (a script read the layout):`);
  forced.slice(0, 10).forEach((e) => console.log(`  +${ms(e.ts - t0).padStart(7)}  ${e.name} ${ms(e.dur)} ms${where(e.args?.beginData?.stackTrace) ? ` · ${where(e.args.beginData.stackTrace)}` : ""}`));
}
