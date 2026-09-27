// resume-point.ts: where Play picks up a song that MusicKit no longer holds (player.ts playPause).
import { test } from "node:test";
import assert from "node:assert/strict";
import { resumePoint } from "../src/resume-point.ts";

const entry = { id: "1200868875" };

test("Play after a network drop resumes at the spot, not 0 s (the 2026-09-27 bug)", () => {
  assert.equal(resumePoint(entry, entry.id, null, { entry, at: 92 }), 92);
});

test("a drop spot for another entry is ignored", () => {
  assert.equal(resumePoint(entry, entry.id, null, { entry: { id: "1200868875" }, at: 92 }), 0);
});

test("a drop spot of 3 s or less starts at 0", () => {
  assert.equal(resumePoint(entry, entry.id, null, { entry, at: 2 }), 0);
});

test("an update restart's spot is used for the same song id only", () => {
  assert.equal(resumePoint(entry, entry.id, { sec: 40, id: entry.id }, null), 40);
  assert.equal(resumePoint(entry, entry.id, { sec: 40, id: "other" }, null), 0);
});

test("the drop spot wins over a restart spot for the same song", () => {
  assert.equal(resumePoint(entry, entry.id, { sec: 40, id: entry.id }, { entry, at: 92 }), 92);
});

test("no current song starts at 0", () => {
  assert.equal(resumePoint(undefined, undefined, { sec: 40, id: "x" }, { entry, at: 92 }), 0);
});
