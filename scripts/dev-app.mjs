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
//   5. flags for measuring: --perf (hold DevTools shut), --built (serve a release-shaped
//      bundle), --gpu=off|slow (pretend to be a weaker machine). DEBUGGING.md §Measuring
//      like the live app, §Pretending to be a weaker machine.
//   6. --fresh : be a first-time user. ONBOARDING.md §Testing a first run.
import { createServer } from "node:net";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// --gpu=off | slow — pretend this is a weaker machine, so a skin that is comfortable on a
// dedicated card can be checked against the hardware most people actually have.
//   off  : no GPU at all. Chromium falls back to software (SwiftShader), which is WORSE than
//          any real integrated chip — a hard floor. Survive this and you survive anything.
//   slow : the GPU stays, but raster moves to the CPU and its memory is squeezed to 64 MB,
//          which is the shape of an integrated part sharing system RAM.
// Confirm which one is live from the `[perf] gpu …` line in the log: it prints the real
// renderer string, so "SwiftShader" means off actually took. DEBUGGING.md §Pretending to be
// a weaker machine.
const GPU_FLAGS = {
  off: "--disable-gpu --disable-gpu-compositing",
  slow: "--disable-gpu-rasterization --disable-accelerated-2d-canvas --force-gpu-mem-available-mb=64",
};
const gpuMode = (process.argv.find((a) => a.startsWith("--gpu=")) ?? "").slice(6);
if (gpuMode && !GPU_FLAGS[gpuMode]) {
  console.error(`[dev:app] unknown --gpu=${gpuMode} — use ${Object.keys(GPU_FLAGS).join(" or ")}`);
  process.exit(2);
}

// --fresh[=keep] — launch as a FIRST-TIME USER (ONBOARDING.md §Testing a first run).
//
// Everything a first run does not have lives in exactly two folders, both named after the
// identifier: %APPDATA%\<id> (the Apple token, settings.json, the SQLite cache, the Last.fm
// session, the logs) and %LOCALAPPDATA%\<id>\EBWebView (localStorage — theme, skin, surface,
// the layout keys, every once-key). Delete both and the next launch is a true first run.
//
// This is a real wipe, not a flag the app reads: a pretend-first-run mode inside the app
// would be a second signed-out code path, and a stranger could reach it.
//
//   --fresh       everything goes. You sign in to Apple again — this is the honest test of
//                 the walk from step 1.
//   --fresh=keep  the same wipe, then the Apple token and the library cache are put back.
//                 You land on a first-run UI, already signed in, with no Apple round trip —
//                 the way to test steps 2 onward again and again.
//
// The guard below is the whole safety story: the identifier comes from tauri.dev.conf.json
// and must end in ".dev", so this can never delete the installed app's data.
const KEEP = ["user-token.txt", "deetsmusic.db", "deetsmusic.db-shm", "deetsmusic.db-wal"];
const freshArg = process.argv.find((a) => a === "--fresh" || a.startsWith("--fresh="));
if (freshArg) {
  const mode = freshArg.includes("=") ? freshArg.slice(8) : "all";
  if (mode !== "all" && mode !== "keep") {
    console.error(`[dev:app] unknown ${freshArg} — use --fresh or --fresh=keep`);
    process.exit(2);
  }
  const id = base.identifier;
  if (!id.endsWith(".dev")) {
    console.error(`[dev:app] --fresh refuses identifier "${id}": it is not a dev profile. Nothing was deleted.`);
    process.exit(2);
  }
  const roaming = join(process.env.APPDATA, id);
  const local = join(process.env.LOCALAPPDATA, id, "EBWebView");
  // Carry the kept files out before the wipe, so a half-finished delete cannot lose them.
  const stash = join(root, "node_modules", ".deets-fresh");
  const kept = [];
  if (mode === "keep" && existsSync(roaming)) {
    rmSync(stash, { recursive: true, force: true });
    mkdirSync(stash, { recursive: true });
    for (const f of KEEP) {
      if (existsSync(join(roaming, f))) {
        copyFileSync(join(roaming, f), join(stash, f));
        kept.push(f);
      }
    }
  }
  for (const dir of [roaming, local]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      // Windows will not delete a file a process holds open — the dev app is still running.
      console.error(`[dev:app] --fresh could not clear ${dir}: ${e.message}`);
      console.error(`[dev:app] Close the dev app (and any \`deetsmusic\` CLI) first, then try again.`);
      process.exit(2);
    }
    // Look at the target afterwards. A delete that reports success without deleting is the
    // worst failure this script can have: the app then launches on a full profile and the
    // whole first-run test is a lie. It happens for real — run this from inside an MSIX
    // package (a shell in the Claude desktop app) and the delete lands in that package's
    // private copy of %APPDATA%, throws nothing, and leaves the real folder untouched
    // (DEBUGGING.md §Sign-in records the same trap for the registry). Run it from an
    // ordinary terminal.
    if (existsSync(dir)) {
      console.error(`[dev:app] --fresh deleted ${dir} and it is STILL THERE. Nothing was cleared.`);
      console.error(`[dev:app] A sandboxed or redirected shell (an MSIX package) does this. Run it from a normal terminal.`);
      process.exit(2);
    }
  }
  if (kept.length) {
    mkdirSync(roaming, { recursive: true });
    for (const f of kept) copyFileSync(join(stash, f), join(roaming, f));
    rmSync(stash, { recursive: true, force: true });
  }
  console.log(
    `[dev:app] --fresh: cleared ${id} — first-time user` +
      (kept.length ? `, signed in (kept ${kept.join(", ")})` : ", signed out"),
  );
}

const windows = conf.app.windows.map((w) => ({
  ...w,
  title: `${w.title} (dev)`,
  ...(w.label === "main"
    ? {
        additionalBrowserArgs:
          `${w.additionalBrowserArgs ?? ""} --remote-debugging-port=${cdp}${gpuMode ? " " + GPU_FLAGS[gpuMode] : ""}`.trim(),
      }
    : {}),
}));

// --perf  : hold DevTools shut (it renders in the same GPU process and distorts every
//           graphics measurement). Everything else is the normal dev server.
// --built : also serve a RELEASE-SHAPED bundle — `vite build` with VITE_PERF=1, served by
//           `vite preview` — so the page is minified, bundled and on one stylesheet like the
//           installed app, while the telemetry stays compiled in. This is the only honest way
//           to measure what the live app does. DEBUGGING.md §Measuring like the live app.
const BUILT = process.argv.includes("--built");
const PERF = BUILT || process.argv.includes("--perf");
const passThrough = process.argv
  .slice(2)
  .filter((a) => a !== "--perf" && a !== "--built" && !a.startsWith("--gpu=") && a !== "--fresh" && !a.startsWith("--fresh="));

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
    (PERF ? " · DevTools held shut (--perf)" : "") +
    (gpuMode ? ` · GPU ${gpuMode.toUpperCase()} (pretending to be a weaker machine)` : ""),
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
