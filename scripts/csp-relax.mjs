// `npm run csp:relax` — sign a CSP relaxation (docs/architecture/CSP.md §7) and print the D1
// command that puts it in DeetsSupport's /config. Installs fetch it at start and apply it from
// their next launch, for the versions it names.
//
//   npm run csp:relax -- --add "connect-src https://new.apple.com" --versions "0.32.*"
//   npm run csp:relax -- --mode report --versions "0.32.0,0.32.1"
//   npm run csp:relax -- --withdraw
//
// --add      "<directive> <source> [<source>…]", once per directive (repeatable)
// --mode     report | enforce (left out: the release's own mode)
// --versions comma-separated: an exact version, or a prefix ending in * ("0.32.*", "*")
//
// It signs with the updater key, as release.mjs signs the feed (RELEASE.md §6.6): the key file
// from Deets' Secrets (or DEETSMUSIC_UPDATER_KEY), the password from Credential Manager. Neither
// is printed. The D1 command is printed, never run: putting it live is the owner's call.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY_FILE =
  process.env.DEETSMUSIC_UPDATER_KEY || join(homedir(), "Documents", "Deets' Secrets", "deetsmusic-updater.key");
const CREDENTIAL = "DeetsMusicUpdaterKey";
// The same lists csp.rs checks; a relaxation it would refuse is refused here first.
const DIRECTIVES = [
  "default-src", "script-src", "style-src", "img-src", "media-src", "font-src", "connect-src",
  "worker-src", "object-src", "base-uri", "form-action", "frame-src", "manifest-src", "child-src",
];
const SOURCE = /^[A-Za-z0-9:/*.\-_'+=]{1,200}$/;
const D1 = `npx wrangler d1 execute deets-support --remote --command`;

function die(msg) {
  console.error(`[csp:relax] ${msg}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const values = (flag) => args.flatMap((a, i) => (a === flag && args[i + 1] !== undefined ? [args[i + 1]] : []));

if (args.includes("--withdraw")) {
  console.log("Run in ../DeetsSupport to withdraw the relaxation (installs drop it at their next start):\n");
  console.log(`${D1} "DELETE FROM config WHERE app = 'deetsmusic' AND key = 'csp'"`);
  process.exit(0);
}

const add = {};
for (const a of values("--add")) {
  const [directive, ...sources] = a.trim().split(/\s+/);
  if (!DIRECTIVES.includes(directive)) die(`unknown directive "${directive}"`);
  if (!sources.length) die(`--add "${a}" names no source`);
  for (const s of sources) if (!SOURCE.test(s)) die(`bad source "${s}"`);
  add[directive] = [...(add[directive] ?? []), ...sources];
}
const [mode] = values("--mode");
if (mode !== undefined && mode !== "report" && mode !== "enforce") die(`--mode is report or enforce, not "${mode}"`);
const versions = (values("--versions")[0] ?? "").split(",").map((v) => v.trim()).filter(Boolean);
if (!versions.length) die(`--versions is required ("0.32.*", or "*" for every version)`);
if (!Object.keys(add).length && !mode) die("nothing to relax: give --add or --mode");

const payload = JSON.stringify({ ...(mode ? { mode } : {}), add, versions });

if (!existsSync(KEY_FILE)) die(`no updater key at ${KEY_FILE} (RELEASE.md §6.6)`);
let password = "";
try {
  password = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(root, "scripts", "cred-read.ps1"), "-Target", CREDENTIAL],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
} catch {
  die(`could not read '${CREDENTIAL}' from Credential Manager (RELEASE.md §6.6)`);
}

const dir = mkdtempSync(join(tmpdir(), "csp-relax-"));
try {
  const file = join(dir, "csp.json");
  writeFileSync(file, payload);
  const r = spawnSync(`npx tauri signer sign "${file}"`, {
    cwd: root,
    shell: true,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: readFileSync(KEY_FILE, "utf8").trim(), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password },
  });
  if (r.status !== 0) die("tauri signer sign failed");
  const sig = readFileSync(`${file}.sig`, "utf8").trim();
  const value = JSON.stringify({ payload, sig }).replace(/'/g, "''");
  console.log(`Payload: ${payload}\n`);
  console.log("Run in ../DeetsSupport to put it live (installs save it at their next start, and use it from the launch after):\n");
  console.log(`${D1} "INSERT OR REPLACE INTO config (app, key, value) VALUES ('deetsmusic', 'csp', '${value}')"`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
