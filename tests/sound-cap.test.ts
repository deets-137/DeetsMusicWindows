// The cap until measured (SOUND.md § 11a-2): the pure rule in src/sound-cap.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CAP_DEFAULTS as V, albumStep, capHop, isAlbumPlay, newCap, type Cap } from "../src/sound-cap.ts";

const ROOM = { target: -14, minDb: -12, maxDb: 12 };
/** The mean square that reads as this loudness. */
const ms = (lufs: number) => Math.pow(10, (lufs + 0.691) / 10);
/** `seconds` of steady audio at `lufs`. */
function play(c: Cap, lufs: number, seconds: number, room = ROOM): number {
  let g = c.gainDb;
  for (let i = 0; i < Math.round(seconds * 10); i++) g = capHop(c, ms(lufs), room, V);
  return g;
}

test("a loud song is cut before it settles, then sits near the target", () => {
  const c = newCap(-5);
  assert.ok(play(c, -4, 10) < -5, "a passage far over the level is cut at once");
  const g = play(c, -4, 60);
  assert.ok(Math.abs(-4 + g - -14) < 0.2, `heard level ${-4 + g}`);
});

test("the cut never moves faster than the attack rate", () => {
  const c = newCap(-5);
  let last = c.gainDb;
  for (let i = 0; i < 100; i++) {
    const g = capHop(c, ms(0), ROOM, V);
    assert.ok(last - g <= V.attackDbS * 0.1 + 1e-9);
    last = g;
  }
});

test("a quiet song stays at the start guess until it settles, then rises to the target", () => {
  const c = newCap(-5);
  assert.equal(play(c, -24, 19), -5, "no raise before settleAtS: an early reading runs quiet");
  const after = play(c, -24, 3);
  assert.ok(after > -5 && after <= -5 + 3 * V.releaseDbS + 0.2, `rises at the release rate, ${after}`);
  assert.ok(Math.abs(play(c, -24, 30) - 10) < 0.2, "the gain ends at target minus the song's loudness");
});

test("the gain never rises past the running loudness", () => {
  const c = newCap(-5);
  assert.ok(play(c, -20, 120) <= 6 + 0.01);
});

test("a raise stops at the room over the song's peak", () => {
  const c = newCap(-5);
  assert.ok(play(c, -24, 60, { ...ROOM, maxDb: 1 }) <= 1);
});

test("a cut lifts at the release rate once the loud passage ends", () => {
  const c = newCap(-5);
  play(c, -14, 30); // settles at the target: no gain
  const cut = play(c, -2, 4);
  assert.ok(cut < -2, `cut ${cut}`);
  const before = c.gainDb;
  const lifted = play(c, -14, 1);
  assert.ok(lifted - before <= V.releaseDbS + 0.01, `lifted ${lifted - before}`);
});

test("silence and a pause hold the gain and the clock", () => {
  const c = newCap(-5);
  play(c, -4, 5);
  const { gainDb, heardS } = c;
  assert.equal(capHop(c, 0, ROOM, V), gainDb);
  assert.equal(capHop(c, ms(-80), ROOM, V), gainDb);
  assert.equal(c.heardS, heardS);
});

test("the deepest gain is kept for the log", () => {
  const c = newCap(-5);
  play(c, -2, 5);
  const deepest = c.deepestDb;
  play(c, -30, 10); // still before settleAtS: the cut lifts back toward the start
  assert.equal(c.deepestDb, deepest);
  assert.ok(c.gainDb > deepest);
});

test("2026-11-05: an album played from Search is an album play (439 plays against 48)", () => {
  assert.equal(isAlbumPlay("search-albums:1440857781", "any"), true);
  assert.equal(isAlbumPlay("album:abc", "abc"), true);
  assert.equal(isAlbumPlay("album:abc", "other"), false);
  assert.equal(isAlbumPlay("search-albums:", "any"), false, "no id: not one album");
  assert.equal(isAlbumPlay("playlist:p.1", "abc"), false);
  assert.equal(isAlbumPlay(undefined, "abc"), false);
});

test("an album's gain moves by at most one step between songs", () => {
  assert.equal(albumStep(-5, -9, 1.5), -6.5);
  assert.equal(albumStep(-5, 2, 1.5), -3.5);
  assert.equal(albumStep(-5, -5.4, 1.5), -5.4);
});
