// Build the web demo and copy it into the DeetsSolutions repo (docs/features/WEB-DEMO.md §6).
//
//   npm run demo:publish            build, then copy dist-web/ → ../DeetsSolutions/deetsmusic/demo/app/
//   npm run demo:publish -- --no-build   copy the dist-web/ that is already there
//
// It only writes files. Committing and deploying DeetsSolutions stays a step you take there.
// release:publish calls this after an update goes out, so the demo matches the release.

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = resolve(root, "..", "DeetsSolutions");
const dest = join(site, "deetsmusic", "demo", "app");
const out = join(root, "dist-web");

if (!existsSync(join(site, "deetsmusic", "demo", "index.html"))) {
  console.error(`[demo] no demo page at ${join(site, "deetsmusic", "demo")} — is ../DeetsSolutions checked out?`);
  process.exit(1);
}

if (!process.argv.includes("--no-build")) execSync("npm run demo:build", { cwd: root, stdio: "inherit" });
if (!existsSync(join(out, "index.html"))) {
  console.error("[demo] dist-web/index.html is missing — the build did not run");
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(out, dest, { recursive: true });
console.log(`[demo] copied dist-web → ${dest}`);
console.log("[demo] next: review, commit and deploy in ../DeetsSolutions");
