// settings-store.ts at load (RULES.md §7a, 2026-09-26): theme and skin moved into the store.
// The first-install check still tells a new install from an upgrade, and an upgrade keeps its
// look. Each case loads a fresh copy of the store (a query on the URL) over its own storage.
import { test } from "node:test";
import assert from "node:assert/strict";

let n = 0;
async function loadStore(seed: Record<string, string>) {
  localStorage.clear();
  for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  return import(`../src/settings-store.ts?case=${++n}`) as Promise<typeof import("../src/settings-store.ts")>;
}

test("a brand-new install is fresh, and gets the first-launch pair", async () => {
  const s = await loadStore({});
  assert.equal(s.isFreshInstall(), true);
  assert.equal(s.ownSetting("onboardingStep"), 1);
  assert.equal(s.ownSetting("theme"), "lilac"); // no OS dark mode in Node: the light pair
  assert.equal(s.ownSetting("skin"), "press");
  assert.equal(localStorage.getItem("deets.theme"), "lilac"); // the mirror
});

// 2026-10-23: the tray page loaded the store first and wrote the answer, so the main window
// found `onboardingStep` already there and skipped the grand opening while the walk ran.
test("2026-10-23 a second window on a brand-new install is still fresh, until the opening closes", async () => {
  await loadStore({}); // the first page (the tray) seeds the answer
  const raw = localStorage.getItem("deets.settings");
  localStorage.clear();
  localStorage.setItem("deets.settings", raw!);
  const s = await import(`../src/settings-store.ts?case=${++n}`) as typeof import("../src/settings-store.ts");
  assert.equal(s.isFreshInstall(), true);
  s.setSetting("openingPending", false);
  assert.equal(s.isFreshInstall(), false);
});

test("an upgrade from the old keys is not fresh and keeps its look (a retired id mapped)", async () => {
  const s = await loadStore({ "deets.theme": "viper", "deets.skin": "retro-future", "deets.settings": "{}" });
  assert.equal(s.isFreshInstall(), false);
  assert.equal(s.ownSetting("onboardingStep"), 0);
  assert.equal(s.effective("theme"), "black-red");
  assert.equal(s.effective("skin"), "cyber");
});

test("a store that already holds the look wins over the mirror", async () => {
  const s = await loadStore({ "deets.theme": "sepia", "deets.settings": JSON.stringify({ onboardingStep: 0, theme: "green", skin: "ocean" }) });
  assert.equal(s.ownSetting("theme"), "green");
  assert.equal(s.ownSetting("skin"), "ocean");
  assert.equal(localStorage.getItem("deets.theme"), "green");
});

test("a pick writes the store and the mirror; a rule's value never reaches either", async () => {
  const s = await loadStore({ "deets.settings": JSON.stringify({ onboardingStep: 0, theme: "green", skin: "ocean" }) });
  s.setSetting("theme", "sepia");
  assert.equal(localStorage.getItem("deets.theme"), "sepia");
  s._setOverlay("theme", "moonlight", "row:lookSchedule:night");
  assert.equal(s.effective("theme"), "moonlight");
  assert.equal(s.ownSetting("theme"), "sepia");
  assert.equal(JSON.parse(localStorage.getItem("deets.settings")!).theme, "sepia");
  assert.equal(localStorage.getItem("deets.theme"), "sepia");
});

test("under a rule, your change is heard by onOwnChange, not onSettingsChange", async () => {
  const s = await loadStore({ "deets.settings": JSON.stringify({ onboardingStep: 0, theme: "green" }) });
  const heard: string[] = [];
  s.onSettingsChange((k) => heard.push(`eff:${k}`));
  s.onOwnChange((k) => heard.push(`own:${k}`));
  s._setOverlay("theme", "moonlight", "r");
  s.setSetting("theme", "sepia");
  s._setOverlay("theme", undefined, "r");
  assert.deepEqual(heard, ["eff:theme", "own:theme", "eff:theme"]);
  assert.equal(s.effective("theme"), "sepia");
});

test("picking your own value while a rule shows another is still a hand change", async () => {
  const s = await loadStore({ "deets.settings": JSON.stringify({ onboardingStep: 0, theme: "green" }) });
  const heard: string[] = [];
  s.onOwnChange((k) => heard.push(k));
  s.setSetting("theme", "green"); // no rule: a plain no-op
  s._setOverlay("theme", "moonlight", "r");
  s.setSetting("theme", "green"); // the rule shows moonlight: you picked green again
  assert.deepEqual(heard, ["theme"]);
});

// His call 2026-10-23: turning the schedule on must not change the look in front of you.
const pairs = (s: typeof import("../src/settings-store.ts")) =>
  [s.ownSetting("dayTheme"), s.ownSetting("daySkin"), s.ownSetting("nightTheme"), s.ownSetting("nightSkin")];

test("2026-10-23 the schedule turns on with your own look for day and night", async () => {
  const s = await loadStore({ "deets.settings": JSON.stringify({ onboardingStep: 0, theme: "green", skin: "metal" }) });
  s.setSetting("lookSchedule", "sun");
  assert.deepEqual(pairs(s), ["green", "metal", "green", "metal"]);
  // Off, a new look, on again: never picked, so the pairs follow the new look.
  s.setSetting("lookSchedule", "off");
  s.setSetting("theme", "sepia");
  s.setSetting("lookSchedule", "clock");
  assert.deepEqual(pairs(s), ["sepia", "metal", "sepia", "metal"]);
});

test("2026-10-23 a picked night look stays when the schedule turns on again", async () => {
  const s = await loadStore({ "deets.settings": JSON.stringify({ onboardingStep: 0, theme: "green", skin: "metal" }) });
  s.setSetting("lookSchedule", "sun");
  s.setSetting("nightTheme", "black-red");
  s.setSetting("lookSchedule", "off");
  s.setSetting("theme", "sepia");
  s.setSetting("lookSchedule", "sun");
  assert.deepEqual(pairs(s), ["green", "metal", "black-red", "metal"]);
});

test("2026-10-23 an older store with a night look of its own counts as picked", async () => {
  const s = await loadStore({ "deets.settings": JSON.stringify({ onboardingStep: 0, theme: "green", skin: "metal", nightTheme: "sepia" }) });
  s.setSetting("lookSchedule", "sun");
  assert.equal(s.ownSetting("nightTheme"), "sepia");
  assert.equal(s.ownSetting("dayTheme"), "lilac"); // the default, kept: the pairs are yours
});
