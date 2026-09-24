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
// DeetsMusic Beta (`--beta`, BETA.md §4): Tauri names its installer after the product
// ("DeetsMusic Beta_…"). It is archived under the plain name, which is the one the Worker serves
// (update.js FILE), in installers/beta/ so it never mixes with a real release.
const BETA = process.argv.includes("--beta");
const built = BETA ? `DeetsMusic Beta_${version}_x64-setup.exe` : name;
const from = join(root, "src-tauri", "target", "release", "bundle", "nsis", built);

if (!existsSync(from)) {
  // A version mismatch across package.json / tauri.conf.json / Cargo.toml is the usual
  // cause: tauri names the installer from tauri.conf.json, this script from package.json.
  console.error(`[archive] no installer at ${from}`);
  console.error("[archive] check that package.json, tauri.conf.json and Cargo.toml agree on the version");
  process.exit(1);
}

// A pre-release version (0.4.2-t1, the update spike) goes to installers/dev/, so the top
// folder holds only real releases.
const sub = BETA ? "installers/beta" : version.includes("-") ? "installers/dev" : "installers";
const dir = join(root, sub);
mkdirSync(dir, { recursive: true });
copyFileSync(from, join(dir, name));
// The updater signature (RELEASE.md §6.6) travels with its installer; publish-update.mjs reads it here.
if (existsSync(`${from}.sig`)) copyFileSync(`${from}.sig`, join(dir, `${name}.sig`));
const mb = (statSync(from).size / 1024 / 1024).toFixed(1);
console.log(`[archive] ${sub}/${name} (${mb} MB)`);
