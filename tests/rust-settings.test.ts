// src/rust-settings.ts against src-tauri/src/settings.rs `SettingsData` (2026-10-11). tsc cannot
// see across the IPC boundary, so this reads both files: a field added, renamed or removed on
// one side only fails here, and so does an `Option<…>` that is not `| null` in TypeScript.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function rustFields(): Map<string, string> {
  const rs = readFileSync(join(ROOT, "src-tauri", "src", "settings.rs"), "utf8");
  const start = rs.indexOf("pub struct SettingsData {");
  assert.ok(start >= 0, "SettingsData not found in settings.rs");
  const body = rs.slice(start, rs.indexOf("\n}", start));
  return new Map([...body.matchAll(/^\s*pub (\w+): (.+),\s*$/gm)].map((m) => [camel(m[1]), m[2]]));
}

function tsFields(): Map<string, string> {
  const ts = readFileSync(join(ROOT, "src", "rust-settings.ts"), "utf8");
  const start = ts.indexOf("export interface RustSettings {");
  assert.ok(start >= 0, "RustSettings not found in rust-settings.ts");
  const body = ts.slice(start, ts.indexOf("\n}", start));
  return new Map([...body.matchAll(/^\s*(\w+)\??: (.+);\s*$/gm)].map((m) => [m[1], m[2]]));
}

test("RustSettings has exactly the fields of settings.rs SettingsData (2026-10-11)", () => {
  const rust = [...rustFields().keys()].sort();
  const ts = [...tsFields().keys()].sort();
  assert.ok(rust.length > 10, `read ${rust.length} Rust fields`);
  assert.deepEqual(ts, rust);
});

test("an Option in Rust is | null in RustSettings, and nothing else is", () => {
  const ts = tsFields();
  for (const [name, type] of rustFields()) {
    const optional = /^Option</.test(type);
    assert.equal(/\| null$/.test(ts.get(name) ?? ""), optional, `${name}: Rust ${type}, TypeScript ${ts.get(name)}`);
  }
});

test("a bool in Rust is boolean, a number type is number, a String is string", () => {
  const ts = tsFields();
  for (const [name, type] of rustFields()) {
    const want = type === "bool" ? "boolean" : /^(u|i|f)\d+$/.test(type) ? "number" : type === "String" ? "string" : null;
    if (want) assert.equal(ts.get(name), want, `${name}: Rust ${type}`);
  }
});
