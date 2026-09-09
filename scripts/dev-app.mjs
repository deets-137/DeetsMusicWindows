// `npm run dev:app` — tauri dev, isolated from the installed app AND from any other
// dev server on the machine (HANDOFF.md → Run it):
//   1. find a free port from 1420 up (another Deets* project may hold 1420);
//   2. merge src-tauri/tauri.dev.conf.json (dev identifier + window titles) with a
//      build.devUrl on that port into a generated, gitignored config;
//   3. run `tauri dev --config <generated>` with VITE_PORT set so vite.config.ts binds
//      the same port.
import { createServer } from "node:net";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.dev.conf.json"), "utf8"));

const free = (port) =>
  new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });

let port = 1420;
while (!(await free(port))) port += 1;

const gen = join(root, "src-tauri", ".tauri.dev.gen.json");
writeFileSync(gen, JSON.stringify({ ...base, build: { devUrl: `http://localhost:${port}` } }, null, 2));
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
