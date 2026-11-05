import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
// The copy editor's server half (COPY-EDIT.md): dev server only, `apply: "serve"`.
import { copyEditPlugin } from "./scripts/copy-edit-plugin.mjs";
// What's new's bold leads, put in the bundle (vite-release-notes.ts; the demo uses it too).
import { releaseNotesPlugin } from "./vite-release-notes";
// The picks the desktop demo plays (WEB-DEMO.md §17).
import { sotdPicks } from "./vite-sotd";
// The CSP on the dev servers, report-only (docs/architecture/CSP.md §12.1): a dev page never
// passes Tauri's asset protocol, so its policy would not reach it.
import { cspDevPlugin } from "./scripts/csp-dev-plugin.mjs";

// The source maps of a build, moved out of it (USAGE-COUNTS.md §16): an error fingerprint names
// a place in a minified chunk (`main.js:2:4439`), and `npm run errors:where` reads it back as a
// source line through these. They go to installers/maps/<version>/ (gitignored, beside the
// release's installers), never into dist/, so the app package carries none. A `--built` dev
// app (VITE_PERF=1) keeps them in dist/ for the page sample.
// Moved once the files are on disk: Vite's own last step adds a line to the top of a chunk
// (`__vite__mapDeps`) and fixes its map then, so a map taken earlier is one line off (seen
// 2026-10-30: every place read one line too high).
import { copyFileSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
function releaseMapsPlugin() {
  return {
    name: "release-maps",
    apply: "build" as const,
    enforce: "post" as const,
    writeBundle(options: { dir?: string }, bundle: Record<string, unknown>) {
      // @ts-expect-error process is a nodejs global
      if (process.env.VITE_PERF === "1" || !options.dir) return;
      const root = dirname(fileURLToPath(import.meta.url));
      const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      const out = join(root, "installers", "maps", version);
      for (const name of Object.keys(bundle)) {
        if (!name.endsWith(".map")) continue;
        const from = join(options.dir, name);
        const to = join(out, name);
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
        unlinkSync(from);
      }
    },
  };
}

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// One `invoke` for the app (src/ipc-core.ts): every `@tauri-apps/api/core` import from src/
// resolves to that file. It times each call in a telemetry build (guide/LOADING-SET.md §3.1;
// release-check 5 keeps the timing out of a release) and answers from the demo with the demo flag
// (WEB-DEMO.md §17). Its own import, and node_modules' (the plugins, the api's other modules), get
// the real module.
function ipcCorePlugin() {
  const shim = fileURLToPath(new URL("./src/ipc-core.ts", import.meta.url));
  return {
    name: "ipc-core",
    enforce: "pre" as const,
    resolveId(id: string, importer?: string) {
      if (id !== "@tauri-apps/api/core" || !importer) return null;
      const from = importer.replace(/\\/g, "/");
      if (!from.includes("/src/") || from.includes("/node_modules/") || from.includes("/src/ipc-core.ts")) return null;
      return shim;
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  define: { __DEMO_VERSION__: JSON.stringify(JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version) },

  // demo/catalog.ts reads its feed with a top-level await (WEB-DEMO.md §15.3), in the demo's own chunk.
  esbuild: { supported: { "top-level-await": true } },

  plugins: [ipcCorePlugin(), sotdPicks(), copyEditPlugin(), releaseNotesPlugin(), cspDevPlugin(), releaseMapsPlugin()],

  // Two pages: the player (index.html) and the tray panel (tray.html, TRAY.md).
  build: {
    // Hidden source maps (no comment in the JS, so the code is the same bytes). A `--built` dev
    // app (VITE_PERF=1) keeps them beside the chunks for the page sample (page-sample.ts); any
    // other build moves them to installers/maps/<version>/ (releaseMapsPlugin above).
    sourcemap: "hidden",
    rollupOptions: {
      input: { main: "index.html", tray: "tray.html" },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available. `npm run dev:app`
  //    (scripts/dev-app.mjs) finds a free one first and passes it as VITE_PORT, so a
  //    second dev server on this machine (another Deets* app) doesn't block us.
  server: {
    port: Number(process.env.VITE_PORT) || 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`, and the CLI's cargo output: a
      //    `cargo build` in cli/ locks its .pdb files, and watching one crashes vite (EBUSY).
      //    Every cargo `target/` the same way: tools/deetsmeter's .exe crashed it (2026-10-10).
      //    And `shots/`: the runner writes an index.html there, and Vite reloaded the dev app's
      //    page on it, mid desk test (2026-10-11). And `installers/`: `vpk pack` locks
      //    RELEASES-deetsmusic while it writes, and the watch crashed vite (EBUSY) during
      //    both 0.31.0 builds, which left the dev app on an error page (2026-10-20).
      ignored: ["**/src-tauri/**", "**/target/**", "**/shots/**", "**/installers/**"],
    },
  },
}));
