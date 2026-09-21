// Build the web demo and copy it into the DeetsSolutions repo (docs/features/WEB-DEMO.md §6).
//
//   npm run demo:publish                     build, copy dist-web/ → ../DeetsSolutions/deetsmusic/demo/app/
//   npm run demo:publish -- --no-build       copy the dist-web/ that is already there
//   npm run demo:publish -- --push           also commit app/ on DeetsSolutions master and push it
//
// release:publish runs it with --push after a live publish, so the demo on deets.solutions
// follows every release with no work in that repo (the owner's call, 2026-09-21). A push to
// DeetsSolutions master deploys the site (Cloudflare Pages).
//
// --push is careful with the other repo: it runs only on `master`, pulls first (fast-forward
// only), and stages nothing but deetsmusic/demo/app/, so work in progress there is never swept
// into the commit. When a check fails it copies the files, says why, and pushes nothing.

import { execFileSync, execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = resolve(root, "..", "DeetsSolutions");
const APP_PATH = "deetsmusic/demo/app";
const dest = join(site, ...APP_PATH.split("/"));
const out = join(root, "dist-web");
const push = process.argv.includes("--push");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

const git = (...args) => execFileSync("git", args, { cwd: site, encoding: "utf8" }).trim();
const stop = (msg) => {
  console.error(`[demo] ${msg}`);
  process.exit(1);
};

if (!existsSync(join(site, "deetsmusic", "demo", "index.html"))) stop(`no demo page at ${join(site, "deetsmusic", "demo")} — is ../DeetsSolutions checked out?`);

// Before the copy: the pull must not meet a changed app/ folder.
let canPush = false;
if (push) {
  const branch = git("branch", "--show-current");
  if (branch !== "master") {
    console.warn(`[demo] DeetsSolutions is on '${branch}', not master: copying only, no commit`);
  } else {
    try {
      git("pull", "--ff-only", "--quiet");
      canPush = true;
    } catch (e) {
      console.warn(`[demo] DeetsSolutions could not fast-forward (${String(e.message).split("\n")[0]}): copying only, no commit`);
    }
  }
}

if (!process.argv.includes("--no-build")) execSync("npm run demo:build", { cwd: root, stdio: "inherit" });
if (!existsSync(join(out, "index.html"))) stop("dist-web/index.html is missing — the build did not run");

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(out, dest, { recursive: true });
console.log(`[demo] copied dist-web → ${dest}`);

if (!push) {
  console.log("[demo] next: review, commit and push in ../DeetsSolutions (or run with --push)");
  process.exit(0);
}
if (!canPush) process.exit(1);

git("add", "-A", "--", APP_PATH);
if (!git("diff", "--cached", "--name-only", "--", APP_PATH)) {
  console.log("[demo] the demo build is unchanged: nothing to commit");
  process.exit(0);
}
git("commit", "--quiet", "-m", `DeetsMusic demo: the build from ${version}`, "--", APP_PATH);
git("push", "--quiet", "origin", "master");
console.log(`[demo] committed and pushed the ${version} demo to DeetsSolutions master (Pages deploys it)`);
