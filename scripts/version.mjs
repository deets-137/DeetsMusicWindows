// The app's version: one source, written copies (docs/ops/RELEASE.md §1, his call 2026-11-02).
//
// `package.json` is the source. `npm version 1.4.0` writes it and `package-lock.json`, then runs
// the `version` hook, which is this script: it writes the number into the other five copies.
// Each build tool reads only its own manifest (Cargo cannot read package.json), so the copies
// stay; what this file adds is one list of them, which the release and both checks read too.
//
// No Cargo workspace (`version.workspace = true`): it would make src-tauri and cli share one
// target folder and one Cargo.lock, and cli/Cargo.toml is standalone on purpose.
// `.npmrc` sets `git-tag-version=false`, so `npm version` makes no commit and no tag (tags are
// DOCS-ORG.md §14.3 T1–T4, still open). mcpb/manifest.json keeps its own version (mcpb-pack.mjs).
//
// `node scripts/version.mjs` writes package.json's version into the copies (the hook).
// `node scripts/version.mjs --check` prints each copy and fails on a disagreement.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The [package] version is the first line that starts with `version` (a later
// `[target.….dependencies.windows]` table has its own `version = "0.61"`).
const tomlVersion = /^(version\s*=\s*")([^"]+)(")/m;
// The crate's own entry in its lock: `name = "<crate>"` then its version line.
const lockVersion = (name) => new RegExp(`(name = "${name}"\\r?\\nversion = ")([^"]+)(")`);
// The first `"version"` key in tauri.conf.json is the top-level one (line 5).
const confVersion = /("version"\s*:\s*")([^"]+)(")/;

/** Every file that holds the app's version. `get` reads it from the file's text; `set` (the
 *  copies only) returns the text with the new version. npm writes the first two itself. */
export const VERSION_FILES = [
  { file: "package.json", get: (t) => JSON.parse(t).version },
  {
    file: "package-lock.json",
    // Two places in one file; a disagreement between them reads as the wrong one.
    get: (t) => { const j = JSON.parse(t); return j.version === j.packages?.[""]?.version ? j.version : `${j.version} / ${j.packages?.[""]?.version}`; },
  },
  { file: "src-tauri/tauri.conf.json", get: (t) => JSON.parse(t).version, set: (t, v) => t.replace(confVersion, `$1${v}$3`) },
  { file: "src-tauri/Cargo.toml", get: (t) => tomlVersion.exec(t)?.[2], set: (t, v) => t.replace(tomlVersion, `$1${v}$3`) },
  { file: "cli/Cargo.toml", get: (t) => tomlVersion.exec(t)?.[2], set: (t, v) => t.replace(tomlVersion, `$1${v}$3`) },
  { file: "src-tauri/Cargo.lock", get: (t) => lockVersion("deetsmusic").exec(t)?.[2], set: (t, v) => t.replace(lockVersion("deetsmusic"), `$1${v}$3`) },
  { file: "cli/Cargo.lock", get: (t) => lockVersion("deetsmusic-cli").exec(t)?.[2], set: (t, v) => t.replace(lockVersion("deetsmusic-cli"), `$1${v}$3`) },
];

/** `{ file: version }` for every file in the list (undefined where the version was not found). */
export function readVersions(root = ROOT) {
  return Object.fromEntries(VERSION_FILES.map(({ file, get }) => [file, get(readFileSync(join(root, file), "utf8"))]));
}

/** The files whose version is not package.json's, as `file: version` lines; empty when they agree. */
export function disagreements(root = ROOT) {
  const versions = readVersions(root);
  const current = versions["package.json"];
  return Object.entries(versions).filter(([, v]) => v !== current).map(([f, v]) => `${f}: ${v ?? "(none)"} (package.json says ${current})`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--check")) {
    for (const [f, v] of Object.entries(readVersions())) console.log(`  ${f}: ${v}`);
    const bad = disagreements();
    if (bad.length) { console.error(`[version] the copies disagree:\n  ${bad.join("\n  ")}`); process.exit(1); }
    console.log("[version] ok: every copy agrees");
  } else {
    const version = readVersions()["package.json"];
    for (const { file, get, set } of VERSION_FILES) {
      if (!set) continue;
      const path = join(ROOT, file);
      const before = readFileSync(path, "utf8");
      const after = set(before, version);
      // A pattern that stopped matching would leave the old number without a word: fail instead.
      if (get(after) !== version) { console.error(`[version] could not write ${version} into ${file}`); process.exit(1); }
      if (after !== before) writeFileSync(path, after);
      console.log(`  ${file}: ${get(before)} → ${version}`);
    }
    const bad = disagreements();
    if (bad.length) { console.error(`[version] still disagree:\n  ${bad.join("\n  ")}`); process.exit(1); }
    console.log(`[version] ${version} in every copy`);
  }
}
