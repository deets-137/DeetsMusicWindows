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
//   … --hold 30    HOLD the request unanswered for 30 s, then let it through, instead of
//                  refusing it: a request that hangs (the end-of-song stall, QUEUE.md §End
//                  stall). Prints MusicKit's state every 500 ms meanwhile.
//   … --what webPlayback|asset   the request to refuse or hold: the license (default), the
//                  song lookup (`webPlayback`), or the audio itself (`itunes-assets`)
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
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const count = Number(opt("--count") || 1) || 1;
const holdS = Number(opt("--hold") || 0);
const what = opt("--what") ?? "license";
const PATTERNS = { license: "*acquireWebPlaybackLicense*", webPlayback: "*/wa/webPlayback*", asset: "*itunes-assets*" };
if ((shape !== "next" && shape !== "start") || !PATTERNS[what]) {
  console.error("usage: license-fail.mjs next|start [--count N] [--hold S] [--what license|webPlayback|asset] [--port P]");
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
} else {
  // The current song's own license must go through: only the NEXT song's is caught. So the
  // song must be playing and past its first seconds (a song just starting still asks).
  if (!(await mk("m.isPlaying"))) console.log(`${stamp()} ${await cli("resume")}`);
  const ready = Date.now() + 20_000;
  while (Date.now() < ready && !(await mk("m.isPlaying && m.currentPlaybackTime > 3"))) await sleep(250);
}

// Hold the license requests from here on; refuse the first `count`, let the rest through.
const body = Buffer.from(JSON.stringify({ status: -1021, errorCode: -1021 })).toString("base64");
await send("Fetch.enable", { patterns: [{ urlPattern: PATTERNS[what], requestStage: "Request" }] });
let refused = 0;
let refusedAt = null;
const pump = setInterval(async () => {
  while (paused.length) {
    const p = paused.shift();
    if (refused < count && holdS > 0) {
      refused++;
      refusedAt ??= await evaluate("performance.now()");
      console.log(`${stamp()} holding ${what} request ${refused} of ${count} for ${holdS} s`);
      // --cut S: the hung request fails as a network error after S s (what a cut by the app's
      // own fetch wrapper would look like), instead of going through at the hold's end.
      const cutS = Number(opt("--cut") || 0);
      setTimeout(() => {
        console.log(`${stamp()} ${cutS ? "cut" : "released"} ${what} request`);
        void send(cutS ? "Fetch.failRequest" : "Fetch.continueRequest", cutS ? { requestId: p.requestId, errorReason: "Aborted" } : { requestId: p.requestId });
      }, (cutS || holdS) * 1000);
    } else if (refused < count) {
      refused++;
      refusedAt ??= await evaluate("performance.now()");
      console.log(`${stamp()} refused ${what} request ${refused} of ${count}`);
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
  const len = await mk("m.currentPlaybackDuration");
  await mk(`m.seekToTime(${Math.max(0, len - 20)})`);
  console.log(`${stamp()} seeked to ${Math.round(len - 20)} of ${Math.round(len)} s; waiting for the next song's license`);
} else {
  console.log(`${stamp()} ${await cli("resume")}`);
}

// Wait for the refusals and the heal to play out (the hold's cap is 12 s). A held request: wait
// until it is released plus 15 s, printing MusicKit's state each time it changes.
const settleMs = holdS > 0 ? holdS * 1000 + 15_000 : 14_000;
const until = Date.now() + 45_000 + settleMs;
let lastState = "";
while (Date.now() < until) {
  await sleep(500);
  if (holdS > 0) {
    const s = await mk(`[MusicKit.PlaybackStates[m.playbackState], m.nowPlayingItem?.id ?? null, Math.round(m.currentPlaybackTime ?? 0), Math.round(m.currentPlaybackDuration ?? 0), m.nowPlayingItemIndex].join(" ")`);
    if (s !== lastState) console.log(`${stamp()} state: ${s}   (state id at/len index)`);
    lastState = s;
  }
  if (refused >= count && (await evaluate(`performance.now() - ${refusedAt ?? 1e15} > ${settleMs}`))) break;
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
