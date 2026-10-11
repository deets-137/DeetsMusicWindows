// `npm run mcpb:pack` — pack mcpb/ into mcpb/dist/deetsmusic.mcpb, the Claude Desktop extension
// (docs/integrations/MCP-INSTALL.md §8a, fork 7A). `cli:build` runs it, so the bundle is staged
// wherever the CLI is: tauri.conf.json ships both as resources, and a missing resource fails
// even `tauri dev`.
//
// A .mcpb is a zip with manifest.json at its root. Windows' own bsdtar writes the zip, so the
// script needs no package. The bundle's shim starts the installed CLI, so it changes only
// when mcpb/ changes, never with an app version.

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "mcpb");
const out = join(src, "dist", "deetsmusic.mcpb");
const files = ["manifest.json", "package.json", "icon.png", "server"];

for (const f of files) {
  if (!existsSync(join(src, f))) throw new Error(`[mcpb] missing mcpb/${f}`);
}
JSON.parse(readFileSync(join(src, "manifest.json"), "utf8")); // a broken manifest fails here, not in Claude

mkdirSync(dirname(out), { recursive: true });
rmSync(out, { force: true });
const tar = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
execFileSync(tar, ["--format", "zip", "-cf", out, "-C", src, ...files], { stdio: "inherit" });
console.log(`[mcpb] ${out}`);
