// The command recorder's checks (guide/LOADING-SET.md §3.1, built 2026-10-17). Runs on a RUNNING
// dev app over its CDP port, through scripts/webview-eval.mjs. It changes nothing the user keeps:
// it calls one command that does not exist, and it writes one recorder block to the log early.
//
//   node docs/ops/checks/ipc-timing.mjs             # the first dev app (npm run dev:app [-- --built])
//   node docs/ops/checks/ipc-timing.mjs --second    # the second dev app
//
// Each check prints ok / FAIL with what it read; the exit code is the number of failures.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const second = process.argv.includes("--second");
const evalJs = (expr) => {
  const out = execFileSync(process.execPath, [join(root, "scripts", "webview-eval.mjs"), ...(second ? ["--second"] : []), expr], { encoding: "utf8" }).trim();
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
};
// The page's own ipc-core.ts (with its ?t= stamp): a bare import would be a second copy of the
// module, with its own counts (memory: eval module URLs).
const viaPage = (body) =>
  evalJs(`(async () => { const u = performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes("/src/ipc-core.ts")); if (!u) return JSON.stringify({ noModule: true }); const m = await import(u); ${body} })()`);

let fails = 0;
const check = (name, ok, seen) => {
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${seen === undefined ? "" : ` — ${typeof seen === "string" ? seen : JSON.stringify(seen)}`}`);
};
// Each run its own names, so a second run in one page life starts cold too.
const run = Date.now().toString(36);
const NO = `deets_check_no_such_${run}`;
const RACE = `deets_check_race_${run}`;
const commands = () => evalJs("JSON.stringify(window.__ipcTiming.commands())");

// 1. The handle exists (a telemetry build), and the launch reads are timed: boot-prefetch.ts makes
//    them before any other module, so this proves the import is redirected from the first call.
check("the __ipcTiming handle exists", evalJs("typeof window.__ipcTiming") === "object");
const c0 = commands();
const launch = ["library_tracks", "seen_tracks", "catalog_heals", "queue_state_get"];
check("the launch reads have a cold round trip", launch.every((k) => typeof c0[k]?.cold === "number"), Object.fromEntries(launch.map((k) => [k, c0[k]?.cold])));
check("the log writes are not timed", !("diag_flush" in c0) && !("log_event" in c0));
check("many commands are timed", Object.keys(c0).length > 20, Object.keys(c0).length);

// 2. The marks: every settled call has a begin and an end with the same id.
const m = evalJs(`JSON.stringify((() => { const l = (window.__marks || []).filter((x) => x.name.startsWith("ipc:")); const b = new Set(l.filter((x) => x.name.endsWith(":begin")).map((x) => x.detail)); const e = l.filter((x) => x.name.endsWith(":end")); return { begins: b.size, ends: e.length, orphans: e.filter((x) => !b.has(x.detail)).length }; })())`);
check("each ipc end has its begin", m.orphans === 0 && m.ends > 0, m);

// 3. A command that fails is timed and counted: the first is cold, the second warm, both failed.
const f = viaPage(`const out = []; for (let i = 0; i < 2; i++) { try { await m.invoke("${NO}"); out.push("resolved"); } catch (e) { out.push(String(e).slice(0, 80)); } } return JSON.stringify({ out, c: window.__ipcTiming.commands()["${NO}"], line: window.__ipcTiming.pending()?.split("\\n").find((l) => l.includes("${NO}")) });`);
check("the page's ipc-core module is loaded", !f.noModule);
check("a failing command still rejects to its caller", f.out?.every((o) => o.includes("not found")), f.out);
check("a failing command is cold, then warm, and failed twice", f.c?.cold !== undefined && f.c?.warm.length === 1 && f.c?.failed === 2, f.c);
check("its block line names the fails", /cold \d+ · warm \d+ · failed 2$/.test(f.line ?? ""), f.line);

// 4. Two first calls at once (a race): one value is cold, the other warm.
const r = viaPage(`await Promise.allSettled([m.invoke("${RACE}"), m.invoke("${RACE}")]); return JSON.stringify(window.__ipcTiming.commands()["${RACE}"]);`);
check("two first calls at once give one cold and one warm", r?.cold !== undefined && r?.warm.length === 1 && r?.calls === 2, r);

// 5. A flush writes the block once: after it, a cold value is not written again.
evalJs("(window.__ipcTiming.flush(), 'flushed')");
const after = String(evalJs("JSON.stringify(window.__ipcTiming.pending() ?? '')"));
check("after a flush, the check commands are not in the next block", !after.includes("deets_check_"), after.split("\n").filter((l) => l.includes("deets_check_")));
const log = readFileSync(join(process.env.APPDATA ?? "", second ? "com.deetsmusic.dev2" : "com.deetsmusic.dev", "deetsmusic.log"), "utf8").split(/\r?\n/);
const head = log.findLastIndex((l) => /diag: \[perf\] ipc\+art \d+ s$/.test(l));
const body = [];
for (let i = head + 1; head >= 0 && i < log.length && /^\s/.test(log[i]); i++) body.push(log[i].trim());
check("the log has the block, with its head line", head >= 0 && body.length > 0, `${body.length} lines`);
check("the block names the failing check command", body.some((l) => l.startsWith(`[perf] ipc ${NO} cold`)));
check("every block line is a command name and numbers only", body.every((l) => /^\[perf\] (ipc [a-z0-9_:|.-]+|art)( (cold|warm|miss|hits|dropped|failed) [\d,-]+)( · (cold|warm|miss|hits|dropped|failed) [\d,-]+)*$/.test(l)), body.filter((l) => !/^\[perf\] (ipc [a-z0-9_:|.-]+|art) /.test(l)).slice(0, 3));

// 6. Covers: the page loaded some, and a miss is at least the hit threshold.
const a = evalJs("JSON.stringify(window.__ipcTiming.art())");
check("cover loads are counted", a.hits + a.misses.length > 0, `${a.hits} hits, ${a.misses.length} misses`);
check("every miss is 8 ms or more", a.misses.every((ms) => ms >= 8), Math.min(...a.misses));

// 7. The redraw and mosaic marks are there.
const k = evalJs(`JSON.stringify({ coll: (window.__marks || []).filter((x) => x.name === "coll:render").map((x) => x.detail).slice(-3) })`);
check("coll:render names the level, the grouping and the row count", k.coll.length > 0 && k.coll.every((d) => / \S+ \d+$/.test(d)), k.coll);

// 8. The profile script reads the log.
let prof = "";
try {
  prof = execFileSync(process.execPath, [join(root, "scripts", "latency-profile.mjs"), "--days", "1", "--out", join(process.env.TEMP ?? root, "latency-check.json"), ...(second ? ["--log", join(process.env.APPDATA ?? "", "com.deetsmusic.dev2")] : [])], { encoding: "utf8" });
} catch (e) {
  prof = String(e.stdout ?? e);
}
check("latency:profile reads the blocks", /\d+ blocks, \d+ commands/.test(prof), prof.trim());

console.log(fails ? `${fails} FAIL` : "all ok");
process.exit(fails);
