// update-card-rules.ts: the update card's lines, paragraphs and search (docs/features/UPDATE-CARD.md §3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupLines, lastLines, paragraphs, inlineHtml, inLine, searchUpdates, lineOf, startLine } from "../src/update-card-rules.ts";

const E = (version: string, body = "**A new thing.** It does a thing.") => ({ version, date: "2026-10-29", body });

test("2026-10-29 the releases are cut into minor lines, oldest first, patches inside oldest first", () => {
  const lines = groupLines([E("1.2.1"), E("1.2.0"), E("1.1.2"), E("1.0.0")]);
  assert.deepEqual(lines.map((l) => l.line), ["1.0", "1.1", "1.2"]);
  assert.deepEqual(lines[2].entries.map((e) => e.version), ["1.2.0", "1.2.1"]);
  assert.deepEqual(lastLines(lines, 2).map((l) => l.line), ["1.1", "1.2"]);
  assert.equal(lineOf("1.10.3"), "1.10");
});

test("2026-10-29 the card opens on the first version the user has not run yet, else the newest", () => {
  const lines = groupLines([E("1.1.2"), E("1.2.0"), E("1.2.1"), E("1.3.0")]);
  assert.equal(startLine(lines, "1.2.1", false), "1.3"); // 1.2 → 1.3
  assert.equal(startLine(lines, "1.1.2", false), "1.2"); // skipped a version: its page first, Next to 1.3
  assert.equal(startLine(lines, "1.2.0", false), "1.2"); // a patch inside 1.2 is new to them
  assert.equal(startLine(lines, "1.0.0", false), "1.1"); // older than every page shown: the oldest
  assert.equal(startLine(lines, "1.2.1", true), "1.3"); // already opened in this version: the newest
  assert.equal(startLine(lines, "", false), "1.3"); // no update yet
});

test("2026-10-29 paragraphs: the bold lead apart, lines joined, Fixes left out", () => {
  const ps = paragraphs("**Clear Queue.** Right-click\na song.\n\n**Louder on the Player!** Roll.\n\n**Fixes.** Many.\n\nNo lead here.");
  assert.deepEqual(ps, [
    { lead: "Clear Queue", shown: "Clear Queue.", text: "Right-click a song." },
    { lead: "Louder on the Player!", shown: "Louder on the Player!", text: "Roll." },
    { lead: null, shown: null, text: "No lead here." },
  ]);
});

test("2026-10-29 the inline marks are escaped before they become markup", () => {
  assert.equal(inlineHtml("Turn on *Clear the queue* <b> `x`"), "Turn on <em>Clear the queue</em> &lt;b&gt; <code>x</code>");
});

test("2026-10-29 a line shows its marks up to the installed version only", () => {
  const marks = [{ since: "1.2.0" }, { since: "1.2.1" }, { since: "1.3.0" }, { since: "1.2.2" }];
  assert.deepEqual(inLine(marks, "1.2", "1.2.1").map((m) => m.since), ["1.2.0", "1.2.1"]);
});

test("2026-10-29 the Older search finds every word in a note or a setting's name, newest first", () => {
  const lines = groupLines([E("1.2.0", "**Volume by scrolling.** Roll the wheel."), E("1.2.1", "**Clear Queue.** Right-click a song.")]);
  const hits = searchUpdates("right song", lines, []);
  assert.deepEqual(hits, [{ line: "1.2", version: "1.2.1", kind: "note", text: "Clear Queue" }]);
  const s = searchUpdates("wheel", lines, [{ since: "1.2.0", label: "Scroll over the Player for volume" }, { since: "1.2.0", label: "Mouse wheel speed" }]);
  assert.deepEqual(s.map((h) => [h.kind, h.text]), [["note", "Volume by scrolling"], ["setting", "Mouse wheel speed"]]);
  assert.deepEqual(searchUpdates("  ", lines, []), []);
});
