// A refused license on the DEV app, then the heal, timed (docs/ops/checks/README.md; QUEUE.md
// §License heal). Two shapes, both seen in the logs:
//
//   node docs/ops/checks/license-fail.mjs next     the live case (2026-10-18, "Pillow Fight"):
//                                                  seek to 20 s before the end, refuse the NEXT
//                                                  song's license (MusicKit asks ~15 s early)
//   node docs/ops/checks/license-fail.mjs start    the dev case: refuse the license of a fresh
//                                                  play (the dev app's queue, from its top)
//   … --count 2    refuse two requests in a row: the heal's own reload is refused too, so the
//                  toast must show (the fails-twice path)
//   … --port 47826 the dev app's bridge port (default: read from the dev log)
//
// How: CDP `Fetch` holds every request to acquireWebPlaybackLicense and answers it with HTTP 200
// and a made-up refusal, `{"status":-1021,"errorCode":-1021}` (Apple's real refusal body is not
// known yet: license-watch.ts will log the first real one). Only this script's session sees it;
// when it ends, nothing is held. The dev app must be playing a queue (the script starts one
// with the bridge if not) at volume 0 (it sets that).
//
// It prints: the timeline from the refusal (the ring's player:/license: lines), then the gap —
// the refusal to the first tick at the spot (the hold's end) — and whether a toast showed.
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const args = process.argv.slice(2);
const shape = args[0];
const count = Number(args[args.indexOf("--count") + 1] || 1) || 1;
if (shape !== "next" && shape !== "start") {
  console.error("usage: license-fail.mjs next|start [--count N] [--port P]");
  process.exit(2);
}

// The bridge port: the dev log's last "bridge: listening on 127.0.0.1:<port>", or --port.
let bridge = args.includes("--port") ? args[args.indexOf("--port") + 1] : null;
if (!bridge) {
  const log = readFileSync(join(process.env.APPDATA, "com.deetsmusic.dev", "deetsmusic.log"), "latin1");
  bridge = [...log.matchAll(/bridge: listening on 127\.0\.0\.1:(\d+)/g)].pop()?.[1] ?? null;
}
if (!bridge) throw new Error("no dev bridge port: pass --port");
// Async: a held license request is answered from this process's event loop, and a synchronous
// call here (a `resume` waits for the song to start) would block that answer.
const cli = (...a) =>
  new Promise((ok) =>
    execFile(join(root, "cli", "dist", "deetsmusic.exe"), ["--port", bridge, ...a], { encoding: "utf8" }, (err, out, errOut) =>
      ok((out || errOut || String(err ?? "")).trim()),
    ),
  );

const gen = JSON.parse(readFileSync(join(root, "src-tauri", ".tauri.dev.gen.json"), "utf8"));
const port = /--remote-debugging-port=(\d+)/.exec(gen.app.windows.find((w) => w.label === "main")?.additionalBrowserArgs ?? "")?.[1];
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === "page" && t.url.startsWith(gen.build.devUrl) && !t.url.includes("tray.html"));
if (!page) throw new Error("no main-window page on the dev app's CDP port");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, no) => ((ws.onopen = ok), (ws.onerror = no)));
let next = 1;
const waiting = new Map();
const paused = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.method === "Fetch.requestPaused") return paused.push(msg.params);
  waiting.get(msg.id)?.(msg);
  waiting.delete(msg.id);
};
const send = (method, params = {}) =>
  new Promise((ok) => {
    const id = next++;
    waiting.set(id, ok);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "eval failed");
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 23);
const mk = (expr) => evaluate(`(() => { const m = MusicKit.getInstance(); return ${expr}; })()`);

console.log(`${stamp()} dev bridge ${bridge}: ${await cli("vol", "0")}`);
if (shape === "start") {
  await mk("m.stop()");
  await sleep(500);
}

// Hold the license requests from here on; refuse the first `count`, let the rest through.
const body = Buffer.from(JSON.stringify({ status: -1021, errorCode: -1021 })).toString("base64");
await send("Fetch.enable", { patterns: [{ urlPattern: "*acquireWebPlaybackLicense*", requestStage: "Request" }] });
let refused = 0;
let refusedAt = null;
const pump = setInterval(async () => {
  while (paused.length) {
    const p = paused.shift();
    if (refused < count) {
      refused++;
      refusedAt ??= await evaluate("performance.now()");
      console.log(`${stamp()} refused license request ${refused} of ${count}`);
      await send("Fetch.fulfillRequest", {
        requestId: p.requestId,
        responseCode: 200,
        // CORS: without these the page's fetch fails as a network error ("Failed to fetch"),
        // which MusicKit shrugs off and asks again at the song change (seen 2026-10-18).
        responseHeaders: [
          { name: "Content-Type", value: "application/json" },
          { name: "Access-Control-Allow-Origin", value: p.request.headers.Origin ?? p.request.headers.origin ?? new URL(gen.build.devUrl).origin },
          { name: "Access-Control-Allow-Credentials", value: "true" },
        ],
        body,
      });
    } else {
      await send("Fetch.continueRequest", { requestId: p.requestId });
    }
  }
}, 20);

const t0 = await evaluate("performance.now()");
if (shape === "next") {
  if (!(await mk("m.isPlaying"))) console.log(`${stamp()} ${await cli("resume")}`);
  await sleep(2500);
  const len = await mk("m.currentPlaybackDuration");
  await mk(`m.seekToTime(${Math.max(0, len - 20)})`);
  console.log(`${stamp()} seeked to ${Math.round(len - 20)} of ${Math.round(len)} s; waiting for the next song's license`);
} else {
  console.log(`${stamp()} ${await cli("resume")}`);
}

// Wait for the refusals and the heal to play out (the hold's cap is 12 s).
const until = Date.now() + 45_000;
while (Date.now() < until) {
  await sleep(500);
  if (refused >= count && (await evaluate(`performance.now() - ${refusedAt ?? 1e15} > 14000`))) break;
}
clearInterval(pump);
await send("Fetch.disable");

const lines = await evaluate(`__diag.events().filter((e) => e.t >= ${t0} && /^(player:(playbackError|mkTrouble|licenseHeal|licenseReload|licenseHealSkip|licenseTrace|healHold|loadWindow|resumeSeek|resumeHush|recoverSilent|recoverGaveUp|np|pause|stall)|license:|toast)/.test(e.tag)).map((e) => ({ t: Math.round(e.t), tag: e.tag, data: e.data }))`);
const zero = refusedAt ?? t0;
for (const l of lines) console.log(`${String(l.t - Math.round(zero)).padStart(7)} ms  ${l.tag}  ${JSON.stringify(l.data ?? "").slice(0, 200)}`);
const end = lines.find((l) => l.tag === "player:healHold" && l.data?.on === false);
const toasts = lines.filter((l) => l.tag === "toast");
console.log("");
console.log(`refused: ${refused} · hold ended: ${end ? `${end.t - Math.round(zero)} ms after the refusal (${end.data.why})` : "never"} · toasts: ${toasts.length ? toasts.map((t) => t.data?.text).join(" | ") : "none"}`);
console.log(`now: ${await cli("np")}`);
ws.close();
