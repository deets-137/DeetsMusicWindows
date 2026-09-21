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
// A test build for the update spike compiles in the test channel (update.rs `channel()`):
//   DEETSMUSIC_UPDATE_CHANNEL=deetsmusic-test npm run release
//   npm run release:publish -- --channel deetsmusic-test
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

console.log(`[release] update channel: ${process.env.DEETSMUSIC_UPDATE_CHANNEL || "deetsmusic"}`);
step("cli:build", "npm run cli:build");
step("sign cli", `node "${SIGN_SCRIPT}" "${join(root, "cli", "dist", "deetsmusic.exe")}"`, signEnv);
const signConfig = join(tmpdir(), `deetsmusic-sign-${process.pid}.json`);
writeFileSync(
  signConfig,
  JSON.stringify({ bundle: { windows: { signCommand: { cmd: process.execPath, args: [SIGN_SCRIPT, "%1"] } } } }),
);
process.on("exit", () => rmSync(signConfig, { force: true }));
step("tauri build (signed)", `npx tauri build --config "${signConfig}"`, {
  ...signEnv,
  TAURI_SIGNING_PRIVATE_KEY: key,
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
});
step("release-check", "node scripts/release-check.mjs");
step("archive", "node scripts/archive-installer.mjs");
