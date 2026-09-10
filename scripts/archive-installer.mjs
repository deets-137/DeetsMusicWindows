// Copy the installer this build just produced into installers/, the local archive of
// shipped builds (gitignored — ~6 MB each, the same way DeetsAirplay keeps its own).
// Keeping every shipped setup exe means an older version can be re-installed without
// a rebuild, and a "what did 0.1.2 actually do?" question has an artifact to answer it.
// Run via `npm run release`.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const name = `DeetsMusic_${version}_x64-setup.exe`;
const from = join(root, "src-tauri", "target", "release", "bundle", "nsis", name);

if (!existsSync(from)) {
  // A version mismatch across package.json / tauri.conf.json / Cargo.toml is the usual
  // cause: tauri names the installer from tauri.conf.json, this script from package.json.
  console.error(`[archive] no installer at ${from}`);
  console.error("[archive] check that package.json, tauri.conf.json and Cargo.toml agree on the version");
  process.exit(1);
}

const dir = join(root, "installers");
mkdirSync(dir, { recursive: true });
copyFileSync(from, join(dir, name));
const mb = (statSync(from).size / 1024 / 1024).toFixed(1);
console.log(`[archive] installers/${name} (${mb} MB)`);
