import { defineConfig, type Plugin } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// The copy editor's server half (COPY-EDIT.md): dev server only, `apply: "serve"`.
import { copyEditPlugin } from "./scripts/copy-edit-plugin.mjs";
import { releaseEntries, releaseLeads } from "./src/release-leads";

/** `virtual:release-notes` (docs/features/UpdatesButton.md §3.4): the installed version's bold
 *  leads from RELEASE-NOTES.md, put in the bundle so What's new needs no network call. The
 *  entry is written before the build (RELEASE.md §0 step 1); a version with no entry gives []. */
function releaseNotesPlugin(): Plugin {
  const id = "virtual:release-notes";
  return {
    name: "deets-release-notes",
    resolveId: (s) => (s === id ? `\0${id}` : null),
    load(s) {
      if (s !== `\0${id}`) return null;
      const version: string = JSON.parse(readFileSync(resolve("package.json"), "utf8")).version;
      // Absolute: a relative watch file reads as an import of the virtual module in dev.
      const notes = resolve("docs/ops/RELEASE-NOTES.md");
      this.addWatchFile(notes);
      const entry = releaseEntries(readFileSync(notes, "utf8")).find((e) => e.version === version);
      return `export default ${JSON.stringify({ version, leads: entry ? releaseLeads(entry.body) : [] })};`;
    },
  };
}

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [copyEditPlugin(), releaseNotesPlugin()],

  // Two pages: the player (index.html) and the tray panel (tray.html, TRAY.md).
  build: {
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
      //    page on it, mid desk test (2026-10-11).
      ignored: ["**/src-tauri/**", "**/target/**", "**/shots/**"],
    },
  },
}));
