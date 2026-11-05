// A playlist's saved sort (PLAYLISTS.md §13): the order a Play outside the page must give.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSort, isDefaultSort, orderPlaylist } from "../src/playlist-sort.ts";
import type { Track } from "../src/library.ts";

const song = (title: string, artistName: string): Track => ({ title, artistName }) as Track;
const list = [song("Beta", "Zed"), song("Alpha", "Mid"), song("Gamma", "Abe")];
const titles = (ts: Track[]) => ts.map((t) => t.title);

test("no saved sort: the authored order, the same list (2026-11-04)", () => {
  assert.equal(orderPlaylist(list, null), list);
  assert.equal(orderPlaylist(list, { sortKey: "order", sortDir: "asc" }), list);
});

test("Playlist Order descending reverses the authored order (2026-11-04)", () => {
  assert.deepEqual(titles(orderPlaylist(list, { sortKey: "order", sortDir: "desc" })), ["Gamma", "Alpha", "Beta"]);
});

test("A–Z and Artist sort both ways, and leave the given list alone (2026-11-04)", () => {
  assert.deepEqual(titles(orderPlaylist(list, { sortKey: "az", sortDir: "asc" })), ["Alpha", "Beta", "Gamma"]);
  assert.deepEqual(titles(orderPlaylist(list, { sortKey: "az", sortDir: "desc" })), ["Gamma", "Beta", "Alpha"]);
  assert.deepEqual(titles(orderPlaylist(list, { sortKey: "artist", sortDir: "asc" })), ["Gamma", "Alpha", "Beta"]);
  assert.deepEqual(titles(list), ["Beta", "Alpha", "Gamma"]);
});

test("the same song twice keeps two rows in descending order (2026-11-04)", () => {
  const twice = [song("One", "A"), song("Two", "A"), song("One", "A")];
  const out = orderPlaylist(twice, { sortKey: "order", sortDir: "desc" });
  assert.equal(out[0], twice[2]);
  assert.equal(out[2], twice[0]);
});

test("a stored sort this app does not offer is dropped (2026-11-04)", () => {
  assert.deepEqual(cleanSort("az", "desc"), { sortKey: "az", sortDir: "desc" });
  assert.equal(cleanSort("plays", "asc"), null);
  assert.equal(cleanSort("az", "up"), null);
  assert.equal(cleanSort(null, "asc"), null);
});

test("only Playlist Order ascending is the default (2026-11-04)", () => {
  assert.equal(isDefaultSort({ sortKey: "order", sortDir: "asc" }), true);
  assert.equal(isDefaultSort({ sortKey: "order", sortDir: "desc" }), false);
  assert.equal(isDefaultSort({ sortKey: "az", sortDir: "asc" }), false);
});
