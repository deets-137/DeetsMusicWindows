// room-friend-rules.ts: add a room member as a friend (FRIENDS.md §18).
import { test } from "node:test";
import assert from "node:assert/strict";
import { friendNameFromMember, offerAction, roomTag } from "../src/room-friend-rules.ts";

test("roomTag is 16 hex characters and the same for the same room and code", async () => {
  const a = await roomTag("K7QM4XHT", "ABCD2345");
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(await roomTag("K7QM4XHT", "ABCD2345"), a);
});

test("roomTag changes from room to room, and from person to person", async () => {
  const a = await roomTag("K7QM4XHT", "ABCD2345");
  assert.notEqual(await roomTag("K7QM4XHV", "ABCD2345"), a);
  assert.notEqual(await roomTag("K7QM4XHT", "ABCD2346"), a);
});

test("offerAction: your own ask wins, then a friend is answered quietly, else ask", () => {
  assert.equal(offerAction(true, false), "answer");
  assert.equal(offerAction(true, true), "answer");
  assert.equal(offerAction(false, true), "reply");
  assert.equal(offerAction(false, false), "ask");
});

test("friendNameFromMember drops the room's (2) and nothing else", () => {
  assert.equal(friendNameFromMember("Sam (2)"), "Sam");
  assert.equal(friendNameFromMember("Sam"), "Sam");
  assert.equal(friendNameFromMember("Band (1999) live"), "Band (1999) live");
});
