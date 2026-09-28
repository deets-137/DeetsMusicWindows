// `node scripts/webview-eval.mjs "<js>"` — run one expression in the DEV app's main
// webview, as if typed into its devtools console, and print the result.
// `npm run dev:app` opens the CDP port (scripts/dev-app.mjs) and records it in the
// generated config; this reads it back. Promises are awaited; the value comes back as
// JSON (DOM nodes and functions do not survive). Exit 1 on a thrown error, 2 when the
// app is not reachable. DEBUGGING.md §Driving the webview.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (msg, code = 2) => {
  console.error(`[webview-eval] ${msg}`);
  process.exit(code);
};

// --second: the second dev app (`npm run dev:app -- --second`), which has its own config.
// --shot FILE: save a PNG of the window instead of running an expression (a desk test's picture).
const argv = process.argv.slice(2);
const second = argv[0] === "--second";
if (second) argv.shift();
// --tray: the tray panel's webview (`tray.html`), a CDP target in dev since 2026-09-27
// (dev-app.mjs gives it the main window's arguments). It exists once the app has started;
// it may be hidden, and a script still reads and drives it.
const tray = argv[0] === "--tray";
if (tray) argv.shift();
const shot = argv[0] === "--shot" ? argv[1] : null;
// --shot FILE x,y,w,h[,scale]: only that part of the window, magnified (a close look at a small mark).
const clipArg = shot && argv[2] ? argv[2].split(",").map(Number) : null;
const clip = clipArg ? { x: clipArg[0], y: clipArg[1], width: clipArg[2], height: clipArg[3], scale: clipArg[4] ?? 1 } : undefined;
const expr = shot ? "" : argv.join(" ");
if (!expr && !shot) fail('usage: node scripts/webview-eval.mjs [--second] [--tray] "__toast.demo()" | --shot out.png');

let gen;
try {
  gen = JSON.parse(readFileSync(join(root, "src-tauri", second ? ".tauri.dev2.gen.json" : ".tauri.dev.gen.json"), "utf8"));
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
const page = targets.find((t) => t.type === "page" && t.url.startsWith(gen.build.devUrl) && t.url.includes("tray.html") === tray);
if (!page) fail(`no ${tray ? "tray" : "main-window"} page among ${targets.length} target(s)`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
const timer = setTimeout(() => fail("no answer in 20 s"), 20_000);
ws.onerror = () => fail("websocket error");
ws.onopen = () =>
  ws.send(
    JSON.stringify(
      shot
        ? { id: 1, method: "Page.captureScreenshot", params: { format: "png", ...(clip ? { clip } : {}) } }
        : {
            id: 1,
            method: "Runtime.evaluate",
            // userGesture: calls like the clipboard write need one.
            params: { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true },
          },
    ),
  );
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id !== 1) return;
  clearTimeout(timer);
  ws.close();
  if (shot && msg.result?.data) {
    writeFileSync(shot, Buffer.from(msg.result.data, "base64"));
    console.log(shot);
    process.exit(0);
  }
  const r = msg.result ?? {};
  if (msg.error || r.exceptionDetails) {
    console.error(r.exceptionDetails?.exception?.description ?? r.exceptionDetails?.text ?? JSON.stringify(msg.error));
    process.exit(1);
  }
  const v = r.result?.value;
  console.log(v === undefined ? "(undefined)" : typeof v === "string" ? v : JSON.stringify(v, null, 2));
  process.exit(0);
};
