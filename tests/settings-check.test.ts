import { test } from "node:test";
import assert from "node:assert/strict";
import { dropBadValues } from "../src/settings-check.ts";

const DEFAULTS = { alwaysOnTop: "off", webSize: 50, maxCards: "4", cardGrow: true, sizeMini: "320x320", rules: [], theme: "lilac" };

test("2026-11-07: a choice outside its options is dropped, the others stay", () => {
  const s: Record<string, unknown> = { alwaysOnTop: "sometimes", maxCards: "2cols", cardGrow: false };
  assert.deepEqual(dropBadValues(s, DEFAULTS), ["alwaysOnTop"]);
  assert.deepEqual(s, { maxCards: "2cols", cardGrow: false });
});

test("2026-11-07: a number choice stored as digits comes back a number; a string choice as a string", () => {
  const s: Record<string, unknown> = { webSize: "100", maxCards: 4 };
  assert.deepEqual(dropBadValues(s, DEFAULTS), []);
  assert.deepEqual(s, { webSize: 100, maxCards: "4" });
  assert.deepEqual(dropBadValues({ webSize: 75 }, DEFAULTS), ["webSize"]);
});

test("2026-11-07: a plain key with the wrong type is dropped; object defaults and unknown keys are left", () => {
  const s: Record<string, unknown> = { cardGrow: "yes", sizeMini: 320, rules: { odd: 1 }, newerKey: "x" };
  assert.deepEqual(dropBadValues(s, DEFAULTS).sort(), ["cardGrow", "sizeMini"]);
  assert.deepEqual(s, { rules: { odd: 1 }, newerKey: "x" });
});

test("2026-11-07: a retired theme or skin id maps to its new id; an unknown one is dropped", () => {
  const s: Record<string, unknown> = { theme: "viper", daySkin: "desk", nightTheme: "neon" };
  assert.deepEqual(dropBadValues(s, DEFAULTS), ["nightTheme"]);
  assert.deepEqual(s, { theme: "black-red", daySkin: "press" });
});

test("2026-11-07: null and objects in a choice key are dropped", () => {
  assert.deepEqual(dropBadValues({ alwaysOnTop: null, trayView: { a: 1 } }, DEFAULTS), ["alwaysOnTop", "trayView"]);
});
