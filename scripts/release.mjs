// `npm run release` — cli:build → signed tauri build → release-check → archive
// (docs/ops/RELEASE.md §1, §6.6).
//
// The updater needs every installer signed with the updater key: `bundle.createUpdaterArtifacts`
// writes the .sig next to the setup exe. The key file comes from Deets' Secrets (override with
// DEETSMUSIC_UPDATER_KEY) and its password from Windows Credential Manager, target
// DeetsMusicUpdaterKey (made with `cmdkey /generic:DeetsMusicUpdaterKey /user:updater /pass`).
// Both go ONLY into the tauri build's environment; neither is printed or written anywhere.
// Note: TAURI_SIGNING_PRIVATE_KEY takes the key's CONTENT, not its path.
//
// Authenticode (RELEASE.md §6.9): Azure Artifact Signing through scripts/sign.mjs (signtool +
// Microsoft's dlib). The app registration's client secret comes from Credential Manager,
// target DeetsMusicAzureSigning; the IDs below are not secrets. The CLI is a bundle resource,
// which Tauri does not sign, so it is signed here after cli:build. DeetsMusic.exe and the
// installer are signed inside tauri build by a signCommand this script passes in a temporary
// --config file (absolute paths; the repo path has spaces), so a plain `tauri build` stays
// unsigned.
//
// `--beta` builds DeetsMusic Beta (docs/ops/BETA.md): DEETSMUSIC_FLAVOR=beta (beta.rs; the channel
// is then always deetsmusic-test), the beta CLI (`--features beta`, into cli/target-beta), and
// tauri.beta.conf.json merged with the windows retitled — Tauri merges an overlay as a JSON merge
// patch, so the windows array must be the whole array (the same trap dev-app.mjs notes). The
// version must be a beta one (0.14.0-beta.1), so a beta build can never share a full version's
// number. Then `npm run release:publish -- --beta`.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const buildEnv = BETA ? { ...signEnv, DEETSMUSIC_FLAVOR: "beta" } : signEnv;
console.log(`[release] ${BETA ? "DeetsMusic Beta" : "DeetsMusic"} ${version} · update channel: ${BETA ? "deetsmusic-test" : process.env.DEETSMUSIC_UPDATE_CHANNEL || "deetsmusic"}`);
const cliExe = BETA ? "deetsmusic-beta.exe" : "deetsmusic.exe";
if (BETA) {
  step("cli:build (beta)", "cargo build --release --features beta --manifest-path cli/Cargo.toml --target-dir cli/target-beta && node scripts/cli-dist.mjs --beta");
} else {
  step("cli:build", "npm run cli:build");
}
step("sign cli", `node "${SIGN_SCRIPT}" "${join(root, "cli", "dist", cliExe)}"`, signEnv);
const signConfig = join(tmpdir(), `deetsmusic-sign-${process.pid}.json`);
writeFileSync(
  signConfig,
  JSON.stringify({ bundle: { windows: { signCommand: { cmd: process.execPath, args: [SIGN_SCRIPT, "%1"] } } } }),
);
process.on("exit", () => rmSync(signConfig, { force: true }));
let configs = `--config "${signConfig}"`;
if (BETA) {
  const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
  const overlay = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.beta.conf.json"), "utf8"));
  overlay.app = { windows: conf.app.windows.map((w) => ({ ...w, title: overlay.productName })) };
  const gen = join(root, "src-tauri", ".tauri.beta.gen.json");
  writeFileSync(gen, JSON.stringify(overlay, null, 2));
  configs = `--config "${gen}" ${configs}`;
}
step("tauri build (signed)", `npx tauri build ${configs}`, {
  ...buildEnv,
  TAURI_SIGNING_PRIVATE_KEY: key,
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
});
step("release-check", `node scripts/release-check.mjs${BETA ? " --beta" : ""}`);
step("archive", `node scripts/archive-installer.mjs${BETA ? " --beta" : ""}`);
