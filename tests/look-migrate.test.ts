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
