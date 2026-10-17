// `node scripts/identity-pack.mjs <stage dir> [--beta]` — the signed identity package
// (docs/ops/IDENTITY.md §3.1). release.mjs runs it after the stage is filled, in the signing
// environment (the AZURE_* values). It writes into the stage, so `vpk pack` ships them in current\:
//   DeetsMusic.identity.msix   the package (a manifest; no app files), signed by sign.mjs
//   Assets\                    the logos, one per exact size (npm run icons)
//   resources.pri              the index that picks a logo per size; without it at the root of
//                              current\ the shell falls back to a plated icon (field report)
// The manifest's fields come from src-tauri/identity/identity.json. The Windows SDK's makepri and
// makeappx are found like sign.mjs finds signtool (the newest 10.* x64).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BETA = process.argv.includes("--beta");
const stage = process.argv.slice(2).find((a) => !a.startsWith("--"));
const MSIX = "DeetsMusic.identity.msix"; // identity.rs MSIX

function die(msg) {
  console.error(`[identity] ${msg}`);
  process.exit(1);
}

function sdkTool(name) {
  const bin = join(process.env["ProgramFiles(x86)"] ?? "", "Windows Kits", "10", "bin");
  const versions = existsSync(bin) ? readdirSync(bin).filter((d) => /^10\./.test(d)).sort().reverse() : [];
  for (const v of versions) {
    const p = join(bin, v, "x64", name);
    if (existsSync(p)) return p;
  }
  die(`no x64 ${name} under ${bin} (install the Windows SDK)`);
}

function run(tool, args) {
  const r = spawnSync(tool, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });
  if (r.status !== 0) die(`${tool} ${args.join(" ")} failed:\n${r.stdout}`);
}

if (!stage || !existsSync(stage)) die("usage: node scripts/identity-pack.mjs <stage dir> [--beta]");

const dir = join(root, "src-tauri", "identity");
const id = JSON.parse(readFileSync(join(dir, "identity.json"), "utf8"));
const f = id.flavors[BETA ? "beta" : "live"];
const assets = join(dir, "Assets");
if (!existsSync(join(assets, "Square44x44Logo.targetsize-24_altform-unplated.png"))) die("no logos in src-tauri/identity/Assets: run npm run icons");

const xmlEscape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fields = {
  NAME: f.name,
  APP: f.app,
  DISPLAY: f.display,
  EXE: f.exe,
  PUBLISHER: id.publisher,
  PUBLISHER_DISPLAY: id.publisherDisplay,
  VERSION: id.version,
};
let manifest = readFileSync(join(dir, "AppxManifest.template.xml"), "utf8");
for (const [k, v] of Object.entries(fields)) manifest = manifest.replaceAll(`{{${k}}}`, xmlEscape(v));
if (/\{\{/.test(manifest)) die("a {{field}} in AppxManifest.template.xml has no value");

// The package folder: the manifest, the logos, resources.pri.
const pkg = join(root, "src-tauri", "target", `identity-${BETA ? "beta" : "live"}`);
rmSync(pkg, { recursive: true, force: true });
mkdirSync(pkg, { recursive: true });
writeFileSync(join(pkg, "AppxManifest.xml"), manifest);
cpSync(assets, join(pkg, "Assets"), { recursive: true });
const priconfig = join(pkg, "..", `priconfig-${BETA ? "beta" : "live"}.xml`);
run(sdkTool("makepri.exe"), ["createconfig", "/cf", priconfig, "/dq", "en-US", "/pv", "10.0.0", "/o"]);
run(sdkTool("makepri.exe"), ["new", "/pr", pkg, "/cf", priconfig, "/mn", join(pkg, "AppxManifest.xml"), "/of", join(pkg, "resources.pri"), "/o"]);

// Pack (/nv: the logo paths resolve in the install folder, not in the package) and sign.
const msix = join(stage, MSIX);
run(sdkTool("makeappx.exe"), ["pack", "/o", "/d", pkg, "/nv", "/p", msix]);
const signed = spawnSync(process.execPath, [join(root, "scripts", "sign.mjs"), msix], { stdio: "inherit", env: process.env });
if (signed.status !== 0) die("signing the identity package failed");

// The logos and the index at the root of current\ (the external location).
cpSync(join(pkg, "Assets"), join(stage, "Assets"), { recursive: true });
cpSync(join(pkg, "resources.pri"), join(stage, "resources.pri"));
console.log(`[identity] ${f.name} ${id.version} → ${msix} (+ Assets, resources.pri)`);
