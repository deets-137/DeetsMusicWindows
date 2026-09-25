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

test("Repeat all refills an empty Up Next with the whole list, in order", () => {
  q.setContext([h("a"), h("b")], 0);
  q.advance();
  q.advance(); // past the end
  assert.equal(q.refillFromPlan(), true);
  assert.deepEqual(ids(q.getUpcoming()), ["a", "b"]);
  assert.equal(q.refillFromPlan(), false, "no refill while Up Next still has songs");
});
