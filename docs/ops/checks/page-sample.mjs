// The page sample's checks (DEBUGGING.md § The page sample, built 2026-10-17). Runs on a RUNNING
// dev app over its CDP port, through scripts/webview-eval.mjs, and changes nothing the user keeps:
// the timers it makes are its own and it clears them.
//
//   node docs/ops/checks/page-sample.mjs            # the second dev app (npm run dev:app -- --second [--built])
//   node docs/ops/checks/page-sample.mjs --first    # the first dev app (only when no other session drives it)
//
// Each check prints ok / FAIL with what it read; the exit code is the number of failures.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const first = process.argv.includes("--first");
const evalJs = (expr) => {
  const out = execFileSync(process.execPath, [join(root, "scripts", "webview-eval.mjs"), ...(first ? [] : ["--second"]), expr], { encoding: "utf8" }).trim();
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
};
const read = () => evalJs("window.__pageSample.read().then((s) => JSON.stringify(s))");
const sample = () => {
  const s = read();
  return typeof s === "string" ? JSON.parse(s) : s;
};

let fails = 0;
const check = (name, ok, seen) => {
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${seen === undefined ? "" : ` — ${typeof seen === "string" ? seen : JSON.stringify(seen)}`}`);
};

// 1. The handle exists (a telemetry build), and one sample has every listed count.
check("the __pageSample handle exists", evalJs("typeof window.__pageSample") === "object");
const s0 = sample();
const keys = ["heapMB", "heapTotalMB", "dom", "imgs", "canvases", "anims", "intervals", "intervalTop", "timeouts", "timeoutTop", "raf10s", "sets", "songs", "minPlayed", "upMin", "surface", "slots", "visible"];
check("a sample has every listed count", keys.every((k) => k in s0), keys.filter((k) => !(k in s0)));
check("the listener sets are named", ["settings", "player.state", "player.progress", "player.volume", "queue", "tracks"].every((k) => typeof s0.sets?.[k] === "number"), s0.sets);
check("the heap is read", typeof s0.heapMB === "number" && s0.heapMB > 0, s0.heapMB);
check("counts only: no title, artist or id in the sample", !/"(title|artistName|name|catalogId|libraryId|id)"/.test(JSON.stringify(s0)));

// 2. Intervals: three made here count three more and name this line; clearing them takes them back.
evalJs("(window.__psCheck = [1,2,3].map(() => setInterval(() => {}, 60000)), 'made')");
const s1 = sample();
check("3 new intervals count 3 more", s1.intervals === s0.intervals + 3, `${s0.intervals} → ${s1.intervals}`);
check("the interval top names the line that made them", s1.intervalTop.some((t) => / x3$/.test(t)), s1.intervalTop);
evalJs("(window.__psCheck.forEach((id) => clearInterval(id)), 'cleared')");
const s2 = sample();
check("clearInterval takes them back", s2.intervals === s0.intervals, `${s1.intervals} → ${s2.intervals}`);

// 3. Timeouts: one that fires leaves the count; one cleared by clearInterval (one id space) too.
evalJs("(window.__psT = setTimeout(() => {}, 60000), window.__psF = setTimeout(() => {}, 50), 'made')");
const s3 = sample();
evalJs("new Promise((r) => setTimeout(() => { clearInterval(window.__psT); r('done'); }, 200))");
const s4 = sample();
check("a timeout that fires and one cleared by the other clear both leave the count", s4.timeouts <= s3.timeouts - 2 + 1, `${s3.timeouts} → ${s4.timeouts} (the wait's own timeout fired too)`);

// 4. Animation frames: a loop of 60 calls shows in the last 10 s.
const before = sample().raf10s;
evalJs("new Promise((r) => { let n = 0; const f = () => (++n < 60 ? requestAnimationFrame(f) : r('done')); requestAnimationFrame(f); })");
const after = sample().raf10s;
check("60 animation-frame calls show in raf10s", after >= before + 60 || after >= 60, `${before} → ${after}`);

// 5. A hand sample reaches the ring and /health.
evalJs("window.__pageSample.take().then(() => 'taken')");
const ring = evalJs("JSON.stringify(window.__diag?.events?.().filter((e) => e.tag === 'page:sample').slice(-1)[0] ?? null)");
const last = typeof ring === "string" ? JSON.parse(ring) : ring;
check("the ring has the page:sample line", last?.data?.why === "hand", last?.data ? Object.keys(last.data).length + " fields" : last);
let health = null;
for (const port of [47825, 47826, 47827, 47828]) {
  try {
    const h = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    if (h.page && Math.abs(h.page.upMin - sample().upMin) < 1) health = { port, page: h.page };
  } catch {}
}
check("/health answers the sample under page", !!health, health ? `port ${health.port}, dom ${health.page.dom}` : "no port");

// 6. Race: two samples asked at once write one line (the second waits for the next song).
const n0 = evalJs("window.__diag.events().filter((e) => e.tag === 'page:sample').length");
evalJs("Promise.all([window.__pageSample.take(), window.__pageSample.take()]).then(() => 'both')");
const n1 = evalJs("window.__diag.events().filter((e) => e.tag === 'page:sample').length");
check("two at once write one line", n1 - n0 === 1, `${n0} → ${n1}`);

// 7. Built bundle: a timer's line is a source path, not a chunk column.
const built = evalJs("[...document.scripts].some((s) => /\\/assets\\//.test(s.src))");
if (built) check("--built: the top names a src/ line through the source map", s1.intervalTop.concat(s1.timeoutTop).some((t) => /^(src|node_modules)\//.test(t)), s1.intervalTop.concat(s1.timeoutTop));
else console.log("skip --built source names (this is the dev server)");

process.exit(fails);
