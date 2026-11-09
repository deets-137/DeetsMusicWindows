// Settings › Playback › Right Click > Add to Queue behavior: his call 2026-11-09, a new install
// starts on After added songs and every existing install keeps End of queue (QUEUE.md).
import { test } from "node:test";
import assert from "node:assert/strict";

/** One launch: each query string loads a new copy of the store, which reads localStorage again. */
const launch = async (tag: string): Promise<string> => (await import(`../src/settings-store.ts?${tag}`)).setting("addToQueueAt");

test("2026-11-09: a new install starts on After added songs, and keeps it at the next launch", async () => {
  localStorage.clear();
  assert.equal(await launch("new-first"), "afterAdded");
  assert.equal(await launch("new-second"), "afterAdded");
});

test("2026-11-09: an install from before the row keeps End of queue", async () => {
  localStorage.clear();
  localStorage.setItem("deets.settings", JSON.stringify({ onboardingStep: 0, theme: "lilac" }));
  assert.equal(await launch("old-store"), "end");
});

test("2026-11-09: an install that has only the old look key is not new", async () => {
  localStorage.clear();
  localStorage.setItem("deets.theme", "lilac");
  assert.equal(await launch("old-theme"), "end");
});
