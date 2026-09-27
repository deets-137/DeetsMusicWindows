// The build check of RULES.md §7a: theme and skin live in the settings store since 2026-09-26.
// `deets.theme` / `deets.skin` are only a mirror of your value (for a roll back to an older
// build), so no new code may read them. Only the store (which writes the mirror and migrates
// from it) and the two pre-paints (which fall back to it) may name them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const ALLOWED = new Set(["src/settings-store.ts", "index.html", "tray.html"]);
const SCAN = ["src", "scripts", "demo", "extension", "index.html", "tray.html", "vite.config.ts", "vite.demo.config.ts"];

function* files(path: string): Generator<string> {
  let st;
  try {
    st = statSync(path);
  } catch {
    return; // a folder this checkout does not have
  }
  if (st.isFile()) {
    if (/\.(ts|mjs|js|html)$/.test(path)) yield path;
    return;
  }
  for (const name of readdirSync(path)) if (name !== "node_modules") yield* files(join(path, name));
}

test("only the store and the pre-paints name deets.theme / deets.skin (2026-09-26)", () => {
  const offenders: string[] = [];
  for (const top of SCAN) {
    for (const f of files(join(ROOT, top))) {
      const rel = relative(ROOT, f).replace(/\\/g, "/");
      if (ALLOWED.has(rel)) continue;
      if (/deets\.(theme|skin)\b/.test(readFileSync(f, "utf8"))) offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], "read the store's theme / skin (effective or ownSetting) instead");
});
