// Stage the release CLI where tauri.conf.json's bundle.resources expects it
// (cli/dist/deetsmusic.exe → <install>\cli\deetsmusic.exe). Run via `npm run cli:build`.
// `--beta` stages DeetsMusic Beta's CLI (docs/ops/BETA.md §6), built by release.mjs with
// `--features beta` into cli/target-beta, as cli/dist/deetsmusic-beta.exe.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const beta = process.argv.includes("--beta");
const ext = process.platform === "win32" ? ".exe" : "";
const from = join(root, "cli", beta ? "target-beta" : "target", "release", `deetsmusic${ext}`);
const name = `${beta ? "deetsmusic-beta" : "deetsmusic"}${ext}`;
mkdirSync(join(root, "cli", "dist"), { recursive: true });
copyFileSync(from, join(root, "cli", "dist", name));
console.log(`[cli:build] staged cli/dist/${name}`);
