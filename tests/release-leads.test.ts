// The release notes' bold leads (docs/ideas/UpdatesButton.md §6.3), 2026-10-16.
import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseEntries, releaseLeads, leadFaults, versionAfter, leadKey, openFaults, audienceFaults } from "../src/release-leads";

test("2026-11-22 a group under ### Show after update is the release's audience; an unknown one is a fault", () => {
  const md = ["## 1.5.1 — 2026-11-22", "", "**Fix.** Text.", "", "### Show after update", "", "explicit-sign-in", "", "## 1.5.0 — 2026-11-16", "", "**Big.** Text.", "", "### Show after update", "", "## 1.4.9 — 2026-11-01", "", "**Odd.** Text.", "", "### Show after update", "", "explicit-signin", ""].join("\n");
  const [g, all, typo] = releaseEntries(md);
  assert.equal(g.shown, true);
  assert.equal(g.audience, "explicit-sign-in");
  assert.deepEqual(audienceFaults(g), []);
  assert.equal(all.shown, true);
  assert.equal(all.audience, undefined); // no name: every user
  assert.equal(audienceFaults(typo).length, 1);
});

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

test("releaseEntries reads an entry's ### Intro for the update card only, 2026-11-02", () => {
  const md = [
    "## 1.3.0 — 2026-11-01",
    "",
    "**Find out What's New.** A page.",
    "",
    "### Intro",
    "",
    "Hi all.",
    "",
    "Second line.",
    "",
    "### Installing",
    "",
    "Not the intro.",
    "",
    "## 1.2.1 — 2026-10-29",
    "",
    "**Clear Queue.** Right-click.",
  ].join("\r\n");
  const [e, older] = releaseEntries(md);
  assert.equal(e.body, "**Find out What's New.** A page.");
  assert.equal(e.intro, "Hi all.\n\nSecond line.");
  assert.equal(older.intro, undefined);
  assert.equal(releaseEntries(MD)[0].intro, undefined);
});

test("releaseEntries reads ### Start open; openFaults names what is not a lead, 2026-11-02", () => {
  const md = [
    "## 1.3.0 — 2026-11-01",
    "",
    "**Find out What's New.** A page.",
    "",
    "**Reporting errors.** A button.",
    "",
    "### Start open",
    "",
    "find out what's new.",
    "Not a lead here",
  ].join("\n");
  const [e] = releaseEntries(md);
  assert.deepEqual(e.open, ["find out what's new.", "Not a lead here"]);
  assert.equal(leadKey("**Find out What's New.**"), leadKey("find out what's new"));
  assert.deepEqual(openFaults(e), ['### Start open names "Not a lead here", which is not a lead of this entry']);
  assert.equal(releaseEntries(MD)[0].open, undefined);
});

test("releaseEntries marks a release with ### Show after update, empty or not, 2026-11-02", () => {
  const md = ["## 1.3.2 — 2026-11-20", "", "**Big fix.** Text.", "", "### Show after update", "", "## 1.3.1 — 2026-11-10", "", "**Small fix.** Text.", ""].join("\n");
  const [big, small] = releaseEntries(md);
  assert.equal(big.shown, true);
  assert.equal(big.body, "**Big fix.** Text.");
  assert.equal(small.shown, undefined);
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
