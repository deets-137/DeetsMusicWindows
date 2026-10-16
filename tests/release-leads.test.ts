// The release notes' bold leads (docs/ideas/UpdatesButton.md §6.3), 2026-10-16.
import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseEntries, releaseLeads, leadFaults, versionAfter } from "../src/release-leads";

const MD = [
  "# Release notes",
  "",
  "Header text.",
  "",
  "## 0.29.0 — 2026-10-20",
  "",
  "**App updates in 2 seconds.** Press Restart now.",
  "",
  "**New App Icon** in the tray",
  "and the taskbar.",
  "",
  "A paragraph with no lead.",
  "",
  "**Fixes.** Several.",
  "",
  "### Installing",
  "",
  "**Not a lead.** The part after ### is not copied.",
  "",
  "## 0.28.0 — 2026-10-16",
  "",
  "**Lists.** A sort keeps your place.",
  "",
].join("\r\n");

test("releaseEntries cuts each entry at its first ### and keeps the order", () => {
  const e = releaseEntries(MD);
  assert.deepEqual(e.map((x) => [x.version, x.date]), [["0.29.0", "2026-10-20"], ["0.28.0", "2026-10-16"]]);
  assert.ok(!e[0].body.includes("Not a lead"));
});

test("releaseLeads takes each paragraph's bold start, drops the period and Fixes", () => {
  assert.deepEqual(releaseLeads(releaseEntries(MD)[0].body), ["App updates in 2 seconds", "New App Icon"]);
});

test("leadFaults finds a paragraph with no lead and a one-word lead", () => {
  assert.equal(leadFaults(releaseEntries(MD)[0].body).length, 1);
  assert.equal(leadFaults(releaseEntries(MD)[1].body).length, 1);
  assert.deepEqual(leadFaults("**Halved Press's record spin.** It turns at 16⅔.\n\n**Fixes.** Two."), []);
});

test("leadFaults wants Fixes last, and a pipe is not a word", () => {
  assert.equal(leadFaults("**Fixes.** One.\n\n**Gapless AirPlay.** No gap.").length, 1);
  assert.deepEqual(leadFaults("**Choices to default to 1 | 2 | 4 cards for Max.** Text."), []);
});

test("versionAfter compares numbers, not strings", () => {
  assert.equal(versionAfter("0.29.0", "0.28.0"), true);
  assert.equal(versionAfter("0.28.10", "0.28.9"), true);
  assert.equal(versionAfter("0.28.0", "0.28.0"), false);
  assert.equal(versionAfter("0.28.0-t1", "0.28.0"), false);
});
