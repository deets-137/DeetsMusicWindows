// `npm run dev:app` — tauri dev, isolated from the installed app AND from any other
// dev server on the machine (HANDOFF.md → Run it):
//   1. find a free port from 1420 up (another Deets* project may hold 1420);
//   2. merge src-tauri/tauri.dev.conf.json (the dev identifier) with a build.devUrl on
//      that port and "(dev)" window titles into a generated, gitignored config. The
//      titles are stamped onto the FULL window objects from tauri.conf.json: Tauri
//      merges an overlay as a JSON merge patch, so an array replaces the whole array —
//      a bare {label, title} list used to strip both windows to defaults (decorations
//      back on, the tray panel loading index.html as a second full app window);
//   3. run `tauri dev --config <generated>` with VITE_PORT set so vite.config.ts binds
//      the same port;
//   4. open a WebView2 remote-debugging (CDP) port on the main window, from 9222 up, so
//      `node scripts/webview-eval.mjs "<js>"` can run console calls from outside the app
//      (DEBUGGING.md §Driving the webview). It is appended to the window's own
//      additionalBrowserArgs — the env var would replace them, autoplay flag included.
import { createServer } from "node:net";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.dev.conf.json"), "utf8"));
const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));

// Vite binds `localhost`, which on this Windows box resolves to ::1 first — so probe
// both families, or an orphaned vite on ::1 reads as free and the launch fails.
const freeOn = (port, host) =>
  new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
const free = async (port) => (await freeOn(port, "127.0.0.1")) && (await freeOn(port, "::1"));

let port = 1420;
while (!(await free(port))) port += 1;
let cdp = 9222;
while (!(await free(cdp))) cdp += 1;

const windows = conf.app.windows.map((w) => ({
  ...w,
  title: `${w.title} (dev)`,
  ...(w.label === "main" ? { additionalBrowserArgs: `${w.additionalBrowserArgs ?? ""} --remote-debugging-port=${cdp}`.trim() } : {}),
}));

// --perf  : hold DevTools shut (it renders in the same GPU process and distorts every
//           graphics measurement). Everything else is the normal dev server.
// --built : also serve a RELEASE-SHAPED bundle — `vite build` with VITE_PERF=1, served by
//           `vite preview` — so the page is minified, bundled and on one stylesheet like the
//           installed app, while the telemetry stays compiled in. This is the only honest way
//           to measure what the live app does. DEBUGGING.md §Measuring like the live app.
const BUILT = process.argv.includes("--built");
const PERF = BUILT || process.argv.includes("--perf");
const passThrough = process.argv.slice(2).filter((a) => a !== "--perf" && a !== "--built");

let preview;
if (BUILT) {
  console.log(`[dev:app] --built: building a release-shaped bundle with the telemetry kept…`);
  const build = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "build"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, VITE_PERF: "1" },
  });
  const code = await new Promise((r) => build.on("exit", r));
  if (code) process.exit(code);
  preview = spawn(
    process.execPath,
    [join(root, "node_modules", "vite", "bin", "vite.js"), "preview", "--port", String(port), "--strictPort"],
    { cwd: root, stdio: "inherit", env: { ...process.env } },
  );
  await new Promise((r) => setTimeout(r, 1200)); // let preview bind before tauri loads the URL
}

const gen = join(root, "src-tauri", ".tauri.dev.gen.json");
writeFileSync(
  gen,
  JSON.stringify(
    {
      ...base,
      app: { windows },
      // With --built the bundle is already made and served by preview, so tauri must NOT start
      // the dev server on top of it.
      build: { devUrl: `http://localhost:${port}`, ...(BUILT ? { beforeDevCommand: "" } : {}) },
    },
    null,
    2,
  ),
);
console.log(
  `[dev:app] ${BUILT ? "release-shaped bundle (vite preview)" : "vite"} on ${port} · webview CDP on ${cdp} · identifier ${base.identifier}` +
    (PERF ? " · DevTools held shut (--perf)" : ""),
);

// Run the local tauri CLI directly (no npx/shell) so a space in the path — this user
// dir has one — can't split an argument; the config is passed relative to the repo root.
const tauriBin = join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
const child = spawn(
  process.execPath,
  [tauriBin, "dev", "--config", "src-tauri/.tauri.dev.gen.json", ...passThrough],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, VITE_PORT: String(port), ...(PERF ? { DEETS_NO_DEVTOOLS: "1" } : {}) },
  },
);
child.on("exit", (code) => {
  preview?.kill(); // the preview server outlives tauri otherwise and holds the port
  process.exit(code ?? 0);
});
