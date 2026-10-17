import { defineConfig } from "vite";
// The copy editor's server half (COPY-EDIT.md): dev server only, `apply: "serve"`.
import { copyEditPlugin } from "./scripts/copy-edit-plugin.mjs";
// What's new's bold leads, put in the bundle (vite-release-notes.ts; the demo uses it too).
import { releaseNotesPlugin } from "./vite-release-notes";

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
