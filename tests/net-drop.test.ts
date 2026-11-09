// net-drop.ts: which failed background reads are only a dropped connection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isNetDrop } from "../src/net-drop.ts";

test("reqwest's no-answer texts are a drop", () => {
  assert.equal(isNetDrop("error sending request for url (https://api.music.apple.com/v1/me/library/playlists)"), true);
  assert.equal(isNetDrop("request or response body error"), true);
  assert.equal(isNetDrop(new Error("error sending request for url (https://x)")), true);
});

test("a sync's joined pages are a drop only when every page got no answer", () => {
  assert.equal(isNetDrop("library sync incomplete — 2 page(s) failed: error sending request | error sending request"), true);
  assert.equal(isNetDrop("library sync incomplete — 2 page(s) failed: error sending request | library/songs HTTP 500"), false);
});

test("anything else stays an error", () => {
  assert.equal(isNetDrop("library/playlists HTTP 500"), false);
  assert.equal(isNetDrop("not connected to Apple Music"), false);
  assert.equal(isNetDrop("error decoding response body"), false);
  assert.equal(isNetDrop(undefined), false);
});
