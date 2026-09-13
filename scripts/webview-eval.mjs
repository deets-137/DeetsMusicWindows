// `node scripts/webview-eval.mjs "<js>"` — run one expression in the DEV app's main
// webview, as if typed into its devtools console, and print the result.
// `npm run dev:app` opens the CDP port (scripts/dev-app.mjs) and records it in the
// generated config; this reads it back. Promises are awaited; the value comes back as
// JSON (DOM nodes and functions do not survive). Exit 1 on a thrown error, 2 when the
// app is not reachable. DEBUGGING.md §Driving the webview.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (msg, code = 2) => {
  console.error(`[webview-eval] ${msg}`);
  process.exit(code);
};

const expr = process.argv.slice(2).join(" ");
if (!expr) fail('usage: node scripts/webview-eval.mjs "__toast.demo()"');

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
const timer = setTimeout(() => fail("no answer in 20 s"), 20_000);
ws.onerror = () => fail("websocket error");
ws.onopen = () =>
  ws.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      // userGesture: calls like the clipboard write need one.
      params: { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true },
    }),
  );
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id !== 1) return;
  clearTimeout(timer);
  ws.close();
  const r = msg.result ?? {};
  if (msg.error || r.exceptionDetails) {
    console.error(r.exceptionDetails?.exception?.description ?? r.exceptionDetails?.text ?? JSON.stringify(msg.error));
    process.exit(1);
  }
  const v = r.result?.value;
  console.log(v === undefined ? "(undefined)" : typeof v === "string" ? v : JSON.stringify(v, null, 2));
  process.exit(0);
};
