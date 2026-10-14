// Every Tauri command the rooms port can reach has an answer or a written reason
// (docs/features/WebRooms.md §9.3 J). The port bundles the whole import closure of web/app.ts, and
// a command with no handler answers `null`. That is right for a desktop write behind a row the
// web leaves out, and wrong for anything the four cards need to draw. So each command named in
// the closure must be in web/handlers.ts: HANDLED (a real answer) or NULL_ON_PURPOSE (a reason).
// A new `invoke("…")` in a shared file then fails here, not on a visitor's page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HANDLED, NULL_ON_PURPOSE } from "../web/handlers.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The static import closure of one entry: relative imports only, types skipped. */
function closure(entry: string): Map<string, string> {
  const seen = new Map<string, string>();
  const queue = [resolve(root, entry)];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    const text = readFileSync(file, "utf8");
    seen.set(file, text);
    const specs = [
      ...text.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+["'](\.[^"']+)["']/gms),
      ...text.matchAll(/^\s*import\s+["'](\.[^"']+)["']/gm),
      ...text.matchAll(/import\(\s*["'](\.[^"']+)["']\s*\)/g),
    ].map((m) => m[1]);
    for (const spec of specs) {
      const base = resolve(dirname(file), spec);
      const hit = [base, `${base}.ts`].find((p) => /\.ts$/.test(p) && existsSync(p));
      if (hit) queue.push(hit);
    }
  }
  return seen;
}

test("web port: every command it can reach is answered or listed (2026-10-13)", () => {
  const files = closure("web/app.ts");
  assert.ok(files.size > 50, `the closure looks too small (${files.size} files): did web/app.ts move?`);
  const named = new Map<string, string>();
  for (const [file, text] of files) {
    for (const m of text.matchAll(/invoke\s*(?:<[^>]*(?:<[^>]*>[^>]*)*>)?\s*\(\s*["']([a-z0-9_]+)["']/g)) {
      if (!named.has(m[1])) named.set(m[1], file.slice(root.length + 1));
    }
  }
  const missing = [...named].filter(([cmd]) => !HANDLED.has(cmd) && !NULL_ON_PURPOSE.has(cmd)).map(([cmd, file]) => `${cmd} (${file})`);
  assert.deepEqual(missing, [], "add each to HANDLED or NULL_ON_PURPOSE in web/handlers.ts");
});

test("web port: no command is both answered and listed as null", () => {
  const both = [...NULL_ON_PURPOSE].filter((c) => HANDLED.has(c));
  assert.deepEqual(both, []);
});
