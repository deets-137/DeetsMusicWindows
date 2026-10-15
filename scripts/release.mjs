// `npm run release` — cli:build → tauri build (no bundle) → stage → vpk pack → sign the feed →
// release-check (docs/ops/RELEASE.md §1, docs/ops/VELOPACK.md §5.3).
//
// Velopack packs the app (VELOPACK.md): `vpk pack` writes the full package, a delta against the
// previous version, `<Id>-<channel>-Setup.exe` and the feed `releases.<channel>.json` into
// installers/velopack/<Id>-<channel>/. That folder IS the archive: it keeps every package, and
// the previous full package there is what the next delta is made from. Keep it.
//
// Two signatures:
// - Authenticode (RELEASE.md §6.9): Azure Artifact Signing through scripts/sign.mjs (signtool +
//   Microsoft's dlib). `vpk pack --signTemplate` calls it on every exe it packs (the app, the
//   CLI, Update.exe, Setup.exe). The client secret comes from Credential Manager, target
//   DeetsMusicAzureSigning; the IDs below are not secrets.
// - The feed (VELOPACK.md §4): `tauri signer sign` with the updater key, which every install
//   checks against the public key in velo.rs. The key file comes from Deets' Secrets (override
//   with DEETSMUSIC_UPDATER_KEY) and its password from Credential Manager, target
//   DeetsMusicUpdaterKey. Both go ONLY into that step's environment; neither is printed.
//
// `--beta` builds DeetsMusic Beta (docs/ops/BETA.md): DEETSMUSIC_FLAVOR=beta (beta.rs), the beta
// CLI (`--features beta`, into cli/target-beta), tauri.beta.conf.json merged with the windows
// retitled (Tauri merges an overlay as a JSON merge patch, so the windows array must be the whole
// array), packed as `DeetsMusicBeta` on channel deetsmusic-test. The version must be a beta one
// (0.14.0-beta.1). Then `npm run release:publish -- --beta`.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY_FILE =
  process.env.DEETSMUSIC_UPDATER_KEY || join(homedir(), "Documents", "Deets' Secrets", "deetsmusic-updater.key");
const CREDENTIAL = "DeetsMusicUpdaterKey";
const AZURE_CREDENTIAL = "DeetsMusicAzureSigning";
const AZURE_SIGNING = {
  AZURE_TENANT_ID: "7715e97a-6856-491f-9861-c797da0b5288",
  AZURE_CLIENT_ID: "436ce300-2b76-486f-800c-e6207a3e4720", // app registration "Deets Release Signing"
};
const SIGN_SCRIPT = join(root, "scripts", "sign.mjs");
const BETA = process.argv.includes("--beta");

function step(label, command, env = process.env) {
  console.log(`[release] ${label}`);
  const r = spawnSync(command, { cwd: root, stdio: "inherit", shell: true, env });
  if (r.status !== 0) {
    console.error(`[release] ${label} failed`);
    process.exit(r.status ?? 1);
  }
}

function die(msg) {
  console.error(`[release] ${msg}`);
  process.exit(1);
}

// Read the secrets first, so a missing one fails before the slow build.
function readCredential(target, doc) {
  let secret = "";
  try {
    secret = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(root, "scripts", "cred-read.ps1"), "-Target", target],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    );
  } catch {
    die(`could not read '${target}' from Credential Manager (${doc})`);
  }
  if (!secret) die(`'${target}' in Credential Manager is empty`);
  return secret;
}

/** The version's entry in docs/ops/RELEASE-NOTES.md, up to its first subsection (publish-update.mjs's rule). */
function releaseNotes(version) {
  const md = readFileSync(join(root, "docs", "ops", "RELEASE-NOTES.md"), "utf8").replace(/\r\n/g, "\n");
  const start = md.search(new RegExp(`^## ${version.replace(/\./g, "\\.")}\\b`, "m"));
  if (start === -1) return "";
  const body = md.slice(start).split("\n").slice(1).join("\n");
  const end = body.search(/^#{2,3} /m);
  return (end === -1 ? body : body.slice(0, end)).trim();
}

if (!existsSync(KEY_FILE)) die(`no updater key at ${KEY_FILE} (RELEASE.md §6.6)`);
const key = readFileSync(KEY_FILE, "utf8").trim();
const password = readCredential(CREDENTIAL, "RELEASE.md §6.6");
const signEnv = { ...process.env, ...AZURE_SIGNING, AZURE_CLIENT_SECRET: readCredential(AZURE_CREDENTIAL, "RELEASE.md §6.9") };

const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (BETA !== /-beta\.\d+$/.test(version)) {
  die(BETA ? `--beta needs a beta version like 0.14.0-beta.1 (package.json has ${version}; BETA.md §4)` : `${version} is a beta version: build it with --beta`);
}
if (BETA && process.env.DEETSMUSIC_UPDATE_CHANNEL && process.env.DEETSMUSIC_UPDATE_CHANNEL !== "deetsmusic-test") {
  die("a beta build is always on deetsmusic-test; unset DEETSMUSIC_UPDATE_CHANNEL");
}
if (process.env.DEETSMUSIC_VELO_FEED) die("DEETSMUSIC_VELO_FEED is set: a release must read the real feed (unset it)");
const channel = BETA ? "deetsmusic-test" : process.env.DEETSMUSIC_UPDATE_CHANNEL || "deetsmusic";

// vpk and the velopack crate must be the same version (VELOPACK.md §8a).
const cargo = readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8");
const crateVersion = /^velopack = \{ version = "=([\d.]+)"/m.exec(cargo)?.[1];
let vpkVersion = "";
try {
  vpkVersion = execFileSync("vpk", ["-H"], { encoding: "utf8", shell: true }).match(/Velopack CLI ([\d.]+)/)?.[1] ?? "";
} catch {
  die("vpk is not installed: dotnet tool install -g vpk --version " + crateVersion);
}
if (!crateVersion || vpkVersion !== crateVersion) die(`vpk is ${vpkVersion || "unknown"}, the velopack crate ${crateVersion}: they must match`);

const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const overlay = BETA ? JSON.parse(readFileSync(join(root, "src-tauri", "tauri.beta.conf.json"), "utf8")) : {};
const product = overlay.productName ?? conf.productName;
const exeName = `${overlay.mainBinaryName ?? conf.mainBinaryName}.exe`;
const packId = product.replace(/\s+/g, ""); // DeetsMusic · DeetsMusicBeta: the folder under %LOCALAPPDATA%
const out = join(root, "installers", "velopack", `${packId}-${channel}`);
console.log(`[release] ${product} ${version} · channel ${channel} · ${out}`);

// 1. The CLI, signed (it rides in the package beside the app).
const cliExe = BETA ? "deetsmusic-beta.exe" : "deetsmusic.exe";
if (BETA) {
  step("cli:build (beta)", "cargo build --release --features beta --manifest-path cli/Cargo.toml --target-dir cli/target-beta && node scripts/cli-dist.mjs --beta && node scripts/mcpb-pack.mjs");
} else {
  step("cli:build", "npm run cli:build");
}
step("sign cli", `node "${SIGN_SCRIPT}" "${join(root, "cli", "dist", cliExe)}"`, signEnv);

// 2. The app: the exe only. bundle.active is false; tauri-build still copies the resources.
let configs = "";
if (BETA) {
  overlay.app = { windows: conf.app.windows.map((w) => ({ ...w, title: overlay.productName })) };
  const gen = join(root, "src-tauri", ".tauri.beta.gen.json");
  writeFileSync(gen, JSON.stringify(overlay, null, 2));
  configs = `--config "${gen}"`;
}
step("tauri build", `npx tauri build --no-bundle ${configs}`, BETA ? { ...process.env, DEETSMUSIC_FLAVOR: "beta" } : process.env);

// 3. Stage: the exe and every resource the bundle names (the beta's map drops the full CLI).
const stage = join(root, "src-tauri", "target", "velopack-stage");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(join(root, "src-tauri", "target", "release", exeName), join(stage, exeName));
for (const [from, to] of Object.entries({ ...conf.bundle.resources, ...(overlay.bundle?.resources ?? {}) })) {
  if (to !== null) cpSync(join(root, "src-tauri", from), join(stage, to), { recursive: true });
}

// 4. Pack and sign. The previous full package in `out` makes the delta.
mkdirSync(out, { recursive: true });
const notesFile = join(tmpdir(), `deetsmusic-notes-${process.pid}.md`);
writeFileSync(notesFile, releaseNotes(version) || `DeetsMusic ${version}`);
process.on("exit", () => rmSync(notesFile, { force: true }));
step(
  "vpk pack",
  [
    "vpk pack",
    `--packId ${packId}`,
    `--packVersion ${version}`,
    `--packDir "${stage}"`,
    `--mainExe ${exeName}`,
    `--packTitle "${product}"`,
    `--packAuthors "${conf.bundle.publisher}"`,
    `--channel ${channel}`,
    `--icon "${join(root, "src-tauri", BETA ? "icons-beta" : "icons", "icon.ico")}"`,
    `--outputDir "${out}"`,
    `--releaseNotes "${notesFile}"`,
    "--framework webview2",
    "--shortcuts StartMenuRoot",
    `--signTemplate "node \\"${SIGN_SCRIPT}\\" {{file...}}"`,
  ].join(" "),
  signEnv,
);

// 5. Sign the feed (writes releases.<channel>.json.sig beside it).
const feed = join(out, `releases.${channel}.json`);
rmSync(`${feed}.sig`, { force: true });
step("sign the feed", `npx tauri signer sign "${feed}"`, {
  ...process.env,
  TAURI_SIGNING_PRIVATE_KEY: key,
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
});

step("release-check", `node scripts/release-check.mjs${BETA ? " --beta" : ""}`);
console.log(`[release] done: ${out}\\${packId}-${channel}-Setup.exe — install it, test it, then npm run release:publish${BETA ? " -- --beta" : ""}`);
