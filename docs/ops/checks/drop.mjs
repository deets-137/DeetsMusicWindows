// A network drop or an unplug, held, on the DEV app (docs/ops/checks/README.md).
//
//   node docs/ops/checks/drop.mjs net 20        the webview offline for 20 s, the Apple check held out
//   node docs/ops/checks/drop.mjs battery off   the page's BatteryManager reads "not charging"
//   node docs/ops/checks/drop.mjs battery on    … and "charging" again
//
// Why one script holds the socket: CDP network emulation lasts only while its session is open
// (DESK-TESTS.md §1, "A network drop, held"). MusicKit buffers a whole song in seconds, so a cut
// alone does nothing to a playing song: seek past the buffer while it holds
// (`deetsmusic --port <dev bridge> control seek <s>`). Only the webview goes offline; Rust keeps
// its network, so `apple_force_offline` (dev builds only) holds the app's own Apple check out.
// The battery override tests the rule path (the `charging` fact), not the hardware.
//
// It prints the ring lines the drop caused (`__diag.events()`, from the drop's start).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const [what, arg] = process.argv.slice(2);
if (!(what === "net" && Number(arg) > 0) && !(what === "battery" && (arg === "on" || arg === "off"))) {
  console.error("usage: drop.mjs net <seconds> | battery on|off");
  process.exit(2);
}

const gen = JSON.parse(readFileSync(join(root, "src-tauri", ".tauri.dev.gen.json"), "utf8"));
const port = /--remote-debugging-port=(\d+)/.exec(gen.app.windows.find((w) => w.label === "main")?.additionalBrowserArgs ?? "")?.[1];
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === "page" && t.url.startsWith(gen.build.devUrl) && !t.url.includes("tray.html"));
if (!page) throw new Error("no main-window page on the dev app's CDP port");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, no) => ((ws.onopen = ok), (ws.onerror = no)));
let next = 1;
const waiting = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
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
const t0 = await evaluate("performance.now()");
const stamp = () => new Date().toISOString().slice(11, 23);

if (what === "net") {
  const secs = Number(arg);
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await evaluate(`window.__TAURI_INTERNALS__.invoke("apple_force_offline", { secs: ${secs} })`);
  console.log(`${stamp()} offline for ${secs} s (webview + the Apple check). navigator.onLine = ${await evaluate("navigator.onLine")}`);
  await sleep(secs * 1000);
  await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await send("Network.setCacheDisabled", { cacheDisabled: false });
  await evaluate(`window.__TAURI_INTERNALS__.invoke("apple_force_offline", { secs: 0 })`);
  console.log(`${stamp()} online again. navigator.onLine = ${await evaluate("navigator.onLine")}`);
  await sleep(1500);
} else {
  const charging = arg === "on";
  await evaluate(`navigator.getBattery().then((b) => {
    Object.defineProperty(b, "charging", { get: () => ${charging}, configurable: true });
    b.dispatchEvent(new Event("chargingchange"));
  })`);
  console.log(`${stamp()} BatteryManager.charging = ${charging}, chargingchange fired`);
  await sleep(800);
}

// `__diag.events()` is the live ring; `t` is ms on the page's clock (performance.now).
const mine = await evaluate(`__diag.events().filter((e) => e.t >= ${t0}).map((e) => Math.round(e.t) + "ms  " + e.tag + (e.data !== undefined ? "  " + JSON.stringify(e.data).slice(0, 220) : ""))`);
console.log(`--- ring since the drop (${mine.length}) ---`);
for (const l of mine.slice(-60)) console.log(l);
ws.close();
