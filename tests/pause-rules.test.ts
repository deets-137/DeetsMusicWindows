import { test } from "node:test";
import assert from "node:assert/strict";
import { nearSongEnd, isSongEnd, stallCanHappen, silentStartStep, midStallArms, midStallStep, resumeSpot } from "../src/pause-rules";

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

// Live, "Two Years" → "Drop Dead Gorgeous": MusicKit named the song and never played it.
test("a silent song change is reloaded; sound, a pause or a short buffer is not (2026-10-01)", () => {
  const silent = { playing: false, heard: false, userPaused: false, buffering: false, looks: 0, maxLooks: 1 };
  assert.equal(silentStartStep(silent), "reload"); // the stuck song
  assert.equal(silentStartStep({ ...silent, playing: true }), "fine");
  assert.equal(silentStartStep({ ...silent, heard: true }), "fine"); // played, then a media key paused it
  assert.equal(silentStartStep({ ...silent, userPaused: true }), "fine");
  assert.equal(silentStartStep({ ...silent, buffering: true }), "look"); // a slow network gets one more look
  assert.equal(silentStartStep({ ...silent, buffering: true, looks: 1 }), "reload");
});

// Live, "Sepulveda": `waiting` 30 s in, no error, no log, no reload.
test("a buffer in the middle of a playing song arms the stall watch (2026-10-03)", () => {
  const mid = { wasPlaying: true, buffering: true, loading: false, at: 30, duration: 200 };
  assert.equal(midStallArms(mid), true);
  assert.equal(midStallArms({ ...mid, wasPlaying: false }), false); // it was not playing
  assert.equal(midStallArms({ ...mid, loading: true }), false); // our own load
  assert.equal(midStallArms({ ...mid, at: 0 }), false); // a song change passes through waiting
  assert.equal(midStallArms({ ...mid, at: 199 }), false); // the song's end
  assert.equal(midStallArms({ ...mid, buffering: false }), false);
});

test("a stall still buffering at the check is reloaded in the queue, logged elsewhere (2026-10-03)", () => {
  const stuck = { playing: false, userPaused: false, sameSong: true, buffering: true, canReload: true };
  assert.equal(midStallStep(stuck), "reload");
  assert.equal(midStallStep({ ...stuck, canReload: false }), "logOnly"); // a station or a room
  assert.equal(midStallStep({ ...stuck, playing: true }), "fine"); // it came back by itself
  assert.equal(midStallStep({ ...stuck, userPaused: true }), "fine");
  assert.equal(midStallStep({ ...stuck, sameSong: false }), "fine"); // a skip
  assert.equal(midStallStep({ ...stuck, buffering: false }), "fine"); // paused from outside: the pause logger's
});

test("a stall reload starts 2 s before the stop (2026-10-03)", () => {
  assert.equal(resumeSpot(30), 28);
  assert.equal(resumeSpot(1), 0);
});
