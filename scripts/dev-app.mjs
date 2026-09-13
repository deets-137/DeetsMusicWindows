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
//      the same port.
import { createServer } from "node:net";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.dev.conf.json"), "utf8"));
const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const windows = conf.app.windows.map((w) => ({ ...w, title: `${w.title} (dev)` }));

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

const gen = join(root, "src-tauri", ".tauri.dev.gen.json");
writeFileSync(gen, JSON.stringify({ ...base, app: { windows }, build: { devUrl: `http://localhost:${port}` } }, null, 2));
console.log(`[dev:app] vite on ${port} · identifier ${base.identifier}`);

// Run the local tauri CLI directly (no npx/shell) so a space in the path — this user
// dir has one — can't split an argument; the config is passed relative to the repo root.
const tauriBin = join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
const child = spawn(
  process.execPath,
  [tauriBin, "dev", "--config", "src-tauri/.tauri.dev.gen.json", ...process.argv.slice(2)],
  { cwd: root, stdio: "inherit", env: { ...process.env, VITE_PORT: String(port) } },
);
child.on("exit", (code) => process.exit(code ?? 0));
