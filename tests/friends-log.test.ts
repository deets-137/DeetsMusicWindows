// friends-log.ts: the Friends on DM shelf's log and its split (features/friends-shelf.md §2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { asLogAlbum, expireLogs, KEEP_MS, mergeAlbums, recentToSend, takeTurns, type LogAlbum } from "../src/friends-log.ts";

const al = (album: string, at: number, artist = "A"): LogAlbum => ({ album, artist, title: `${album} song`, catalogId: `id-${album}`, artworkUrl: null, at });

test("2026-10-29 one entry per album, the newest play wins, newest first, capped", () => {
  const log = mergeAlbums([al("X", 1), al("Y", 2)], [al("x", 5), al("Z", 3)], 2);
  assert.deepEqual(log.map((a) => [a.album, a.at]), [["x", 5], ["Z", 3]]);
});

test("2026-10-29 the same name by another artist is another album", () => {
  assert.equal(mergeAlbums([al("Greatest Hits", 1, "A")], [al("Greatest Hits", 2, "B")]).length, 2);
});

test("2026-10-29 a friend not heard from in 7 days is forgotten", () => {
  const now = 10 * KEEP_MS;
  const kept = expireLogs({ old: { heard: now - KEEP_MS, albums: [] }, fresh: { heard: now - 1, albums: [] } }, now);
  assert.deepEqual(Object.keys(kept), ["fresh"]);
});

test("2026-10-29 a sending app leaves out the album playing now and sends 3", () => {
  const mine = [al("Now", 9), al("B", 8), al("C", 7), al("D", 6), al("E", 5)];
  assert.deepEqual(recentToSend(mine, { album: "now", artist: "a" }).map((a) => a.album), ["B", "C", "D"]);
  assert.deepEqual(recentToSend(mine, null).map((a) => a.album), ["Now", "B", "C"]);
});

test("2026-10-29 an entry with no album or no song id is dropped", () => {
  assert.equal(asLogAlbum({ album: "", catalogId: "1", at: 1 }), null);
  assert.equal(asLogAlbum({ album: "X", catalogId: "", at: 1 }), null);
  assert.equal(asLogAlbum({ album: "X", catalogId: "1", at: "soon" }), null);
  assert.equal(asLogAlbum({ album: "X", catalogId: "1", at: 1 })?.title, "X");
});

test("2026-10-29 one friend fills the shelf", () => {
  const albums = Array.from({ length: 10 }, (_, i) => al(`A${i}`, 100 - i));
  assert.equal(takeTurns([{ code: "f1", albums }], new Set()).length, 10);
});

test("2026-10-29 friends take turns, the newest first, and a short list leaves room", () => {
  const f1 = { code: "f1", albums: [al("a1", 50), al("a2", 40), al("a3", 30), al("a4", 20)] };
  const f2 = { code: "f2", albums: [al("b1", 60)] };
  const f3 = { code: "f3", albums: [al("c1", 10), al("c2", 9)] };
  const out = takeTurns([f1, f2, f3], new Set(), 6).map((x) => x.album.album);
  assert.deepEqual(out, ["b1", "a1", "c1", "a2", "c2", "a3"]);
});

test("2026-10-29 an album playing now, or already taken by a friend, is passed over", () => {
  const f1 = { code: "f1", albums: [al("Same", 50), al("a2", 40)] };
  const f2 = { code: "f2", albums: [al("Same", 45), al("b2", 30)] };
  const out = takeTurns([f1, f2], new Set(["now\na"]), 10).map((x) => `${x.code}:${x.album.album}`);
  assert.deepEqual(out, ["f1:Same", "f2:b2", "f1:a2"]);
  const skipped = takeTurns([f1], new Set(["same\na"]), 10).map((x) => x.album.album);
  assert.deepEqual(skipped, ["a2"]);
});
