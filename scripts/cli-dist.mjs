// Stage the release CLI where tauri.conf.json's bundle.resources expects it
// (cli/dist/deetsmusic.exe → <install>\cli\deetsmusic.exe). Run via `npm run cli:build`.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const exe = process.platform === "win32" ? "deetsmusic.exe" : "deetsmusic";
mkdirSync(join(root, "cli", "dist"), { recursive: true });
copyFileSync(join(root, "cli", "target", "release", exe), join(root, "cli", "dist", exe));
console.log(`[cli:build] staged cli/dist/${exe}`);
