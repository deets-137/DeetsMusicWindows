import { test } from "node:test";
import assert from "node:assert/strict";
import { nearSongEnd, isSongEnd, stallCanHappen } from "../src/pause-rules";

// The 2026-09-24 read: 86 of 93 `outside` pauses were song changes (DEBUGGING.md).
test("a pause at the last seconds is the song ending (2026-09-25)", () => {
  assert.equal(nearSongEnd(238, 240), true);
  assert.equal(nearSongEnd(240, 240), true);
  assert.equal(nearSongEnd(200, 240), false);
  assert.equal(nearSongEnd(5, 0), false); // no duration known: never a song end by time
});

test("a station follow, a queue end or a new song makes a pause a song end (2026-09-25)", () => {
  const base = { evidence: false, idBefore: "1", idNow: "1", nearEnd: false };
  assert.equal(isSongEnd(base), false); // a real outside pause
  assert.equal(isSongEnd({ ...base, evidence: true }), true); // stationFollow / queueEnd
  assert.equal(isSongEnd({ ...base, idNow: "2" }), true); // the user's Next
  assert.equal(isSongEnd({ ...base, idNow: null }), true); // the song left, nothing yet
  assert.equal(isSongEnd({ ...base, nearEnd: true }), true);
});

test("a stall needs a next song (2026-09-25)", () => {
  assert.equal(stallCanHappen("radio", 0), true);
  assert.equal(stallCanHappen("queue", 3), true);
  assert.equal(stallCanHappen("queue", 0), false); // the queue ran out: that is its end
  assert.equal(stallCanHappen("room", 0), false);
});
