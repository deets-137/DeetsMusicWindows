// queue.ts: the queue model (QUEUE.md). The rules here are the ones the doc states.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as q from "../src/queue.ts";

const h = (id: string, context = "album:1"): q.TrackHandle => ({ catalogId: id, context });
const ids = (list: readonly q.TrackHandle[]) => list.map((e) => e.catalogId);

beforeEach(() => q.clear());

test("setContext plays from the clicked song; the rest is Up Next", () => {
  q.setContext([h("a"), h("b"), h("c"), h("d")], 1);
  assert.equal(q.getCurrent()?.catalogId, "b");
  assert.deepEqual(ids(q.getUpcoming()), ["c", "d"]);
  // The songs before the click are parked for Previous, not marked as heard.
  assert.deepEqual(ids(q.getHistory()), ["a"]);
  assert.deepEqual(ids(q.getRecentlyPlayed()), []);
});

test("the clicked song never appears twice in the back-chain", () => {
  q.setContext([h("a"), h("b"), h("a"), h("c")], 2);
  assert.deepEqual(ids(q.getHistory()), ["b"]);
});

test("manual picks survive a new context, on top of Up Next", () => {
  q.setContext([h("a"), h("b")], 0);
  q.addToQueue(h("x", "song"));
  q.setContext([h("p"), h("q"), h("r")], 0);
  assert.deepEqual(ids(q.getUpcoming()), ["x", "q", "r"]);
});

test("advance and previous walk the list and come back", () => {
  q.setContext([h("a"), h("b"), h("c")], 0);
  assert.equal(q.advance()?.catalogId, "b");
  assert.equal(q.previous()?.catalogId, "a");
  assert.deepEqual(ids(q.getUpcoming()), ["b", "c"]);
});

test("jumpTo discards the songs skipped over", () => {
  q.setContext([h("a"), h("b"), h("c"), h("d")], 0);
  assert.equal(q.jumpTo(1)?.catalogId, "c");
  assert.deepEqual(ids(q.getUpcoming()), ["d"]);
  assert.equal(q.jumpTo(5)?.catalogId, "c", "an index out of range changes nothing");
});

test("playNext stacks on top; insertManyAt clamps to the list", () => {
  q.setContext([h("a"), h("b"), h("c")], 0);
  q.playNextMany([h("x"), h("y")]);
  assert.deepEqual(ids(q.getUpcoming()), ["x", "y", "b", "c"]);
  q.insertManyAt(99, [h("z")]);
  assert.deepEqual(ids(q.getUpcoming()), ["x", "y", "b", "c", "z"]);
  q.insertManyAt(-3, [h("w")]);
  assert.equal(q.getUpcoming()[0].catalogId, "w");
});

test("move and removeAt edit Up Next in place", () => {
  q.setContext([h("a"), h("b"), h("c"), h("d")], 0);
  q.move(0, 2);
  assert.deepEqual(ids(q.getUpcoming()), ["c", "d", "b"]);
  q.removeAt(1);
  assert.deepEqual(ids(q.getUpcoming()), ["c", "b"]);
  q.removeAt(9);
  assert.deepEqual(ids(q.getUpcoming()), ["c", "b"], "an index out of range removes nothing");
});

test("shuffle keeps manual picks on top by default (FUTURE-SETTINGS §5a)", () => {
  q.setContext([h("a"), h("b"), h("c"), h("d"), h("e")], 0);
  q.addToQueueMany([h("x"), h("y")]);
  q.shuffleUpcoming();
  const up = q.getUpcoming();
  assert.deepEqual(ids(up.slice(0, 2)), ["x", "y"]);
  assert.deepEqual(ids(up.slice(2)).sort(), ["b", "c", "d", "e"]);
});

test("shuffle mode: the clicked song first, then EVERY other song shuffled, no lookback (3A, 2026-10-12)", () => {
  q.setContext([h("a"), h("b"), h("c"), h("d"), h("e")], 3, true);
  assert.equal(q.getCurrent()?.catalogId, "d");
  assert.deepEqual(ids(q.getUpcoming()).sort(), ["a", "b", "c", "e"], "the songs above the click play too");
  assert.deepEqual(ids(q.getHistory()), [], "no parked lookback in shuffle mode");
  assert.deepEqual(ids(q.getPlan()), ["a", "b", "c", "d", "e"], "the plan keeps the list's order");
});

test("unshuffle: the list goes on in its order from the playing song; the rest parks for Previous (1A, 2026-10-12)", () => {
  // A shuffled order, made by hand so the test is not random: a b c, then f before d and e.
  q.setContext([h("a"), h("b"), h("c"), h("d"), h("e"), h("f")], 0);
  q.move(4, 0); // Up Next: f b c d e
  q.move(3, 1); // Up Next: f d b c e
  q.advance(); // f plays (a heard)
  q.advance(); // d plays (f heard)
  assert.equal(q.getCurrent()?.catalogId, "d");
  assert.deepEqual(ids(q.getRecentlyPlayed()), ["a", "f"]);
  assert.equal(q.unshuffle(), true);
  assert.deepEqual(ids(q.getUpcoming()), ["e", "f"], "the songs after d in the list — f again, though heard");
  // Previous: the heard trail (f, then a), then the lookback a..c minus the heard (c, b).
  assert.deepEqual(ids(q.getHistory()), ["b", "c", "a", "f"]);
  assert.deepEqual(ids(q.getRecentlyPlayed()), ["a", "f"], "the heard trail is untouched");
});

test("unshuffle keeps manual picks on top and does nothing with no plan", () => {
  q.setContext([h("a"), h("b"), h("c")], 0, true);
  q.playNextMany([h("x", "song")]);
  assert.equal(q.unshuffle(), true);
  assert.deepEqual(ids(q.getUpcoming()), ["x", "b", "c"]);
  q.clear();
  assert.equal(q.unshuffle(), false, "nothing playing");
});

test("the snapshot carries the plan (v2) and a v1 blob still restores without one", () => {
  q.setContext([h("a"), h("b"), h("c")], 1);
  const s = q.snapshot();
  assert.equal(s.v, 2);
  assert.deepEqual(ids(s.plan ?? []), ["a", "b", "c"]);
  q.clear();
  q.restore(s, true);
  assert.deepEqual(ids(q.getPlan()), ["a", "b", "c"]);
  q.clear();
  q.restore({ ...s, v: 1, plan: undefined }, true);
  assert.deepEqual(ids(q.getPlan()), []);
  assert.equal(q.getCurrent()?.catalogId, "b");
});

test("Repeat all refills an empty Up Next with the whole list, in order", () => {
  q.setContext([h("a"), h("b")], 0);
  q.advance();
  q.advance(); // past the end
  assert.equal(q.refillFromPlan(), true);
  assert.deepEqual(ids(q.getUpcoming()), ["a", "b"]);
  assert.equal(q.refillFromPlan(), false, "no refill while Up Next still has songs");
});
