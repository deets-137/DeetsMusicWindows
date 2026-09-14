// `npm run release` — cli:build → signed tauri build → release-check → archive
// (docs/RELEASE.md §1, §6.6).
//
// The updater needs every installer signed with the updater key: `bundle.createUpdaterArtifacts`
// writes the .sig next to the setup exe. The key file comes from Deets' Secrets (override with
// DEETSMUSIC_UPDATER_KEY) and its password from Windows Credential Manager, target
// DeetsMusicUpdaterKey (made with `cmdkey /generic:DeetsMusicUpdaterKey /user:updater /pass`).
// Both go ONLY into the tauri build's environment; neither is printed or written anywhere.
// Note: TAURI_SIGNING_PRIVATE_KEY takes the key's CONTENT, not its path.
//
// A test build for the update spike compiles in the test channel (update.rs `channel()`):
//   DEETSMUSIC_UPDATE_CHANNEL=deetsmusic-test npm run release
//   npm run release:publish -- --channel deetsmusic-test
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY_FILE =
  process.env.DEETSMUSIC_UPDATER_KEY || join(homedir(), "Documents", "Deets' Secrets", "deetsmusic-updater.key");
const CREDENTIAL = "DeetsMusicUpdaterKey";

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
if (!existsSync(KEY_FILE)) die(`no updater key at ${KEY_FILE} (RELEASE.md §6.6)`);
const key = readFileSync(KEY_FILE, "utf8").trim();
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
if (!password) die(`'${CREDENTIAL}' in Credential Manager is empty`);

console.log(`[release] update channel: ${process.env.DEETSMUSIC_UPDATE_CHANNEL || "deetsmusic"}`);
step("cli:build", "npm run cli:build");
step("tauri build (signed)", "npx tauri build", {
  ...process.env,
  TAURI_SIGNING_PRIVATE_KEY: key,
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
});
step("release-check", "node scripts/release-check.mjs");
step("archive", "node scripts/archive-installer.mjs");
