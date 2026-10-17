// notes-order.ts: which note an About cell shows (LISTENERS.md §8.2 item 3, his calls 2026-10-17).
import { test } from "node:test";
import assert from "node:assert/strict";
import { needsAlbumWiki, pickNote } from "../src/notes-order.ts";

const all = { appleSong: "a-song", lastfmSong: "l-song", appleAlbum: "a-album", lastfmAlbum: "l-album" };

test("both sources: the song first, Apple first inside each level", () => {
  assert.deepEqual(pickNote(all, "both"), { text: "a-song", from: "apple", of: "song" });
  assert.deepEqual(pickNote({ ...all, appleSong: undefined }, "both"), { text: "l-song", from: "lastfm", of: "song" });
  // the case his order decides: a Last.fm song wiki beats Apple's album note
  assert.equal(pickNote({ lastfmSong: "l-song", appleAlbum: "a-album" }, "both")?.text, "l-song");
  assert.deepEqual(pickNote({ appleAlbum: "a-album", lastfmAlbum: "l-album" }, "both"), { text: "a-album", from: "apple", of: "album" });
  assert.deepEqual(pickNote({ lastfmAlbum: "l-album" }, "both"), { text: "l-album", from: "lastfm", of: "album" });
});

test("one source keeps the song-before-album order inside it", () => {
  assert.equal(pickNote(all, "apple")?.text, "a-song");
  assert.equal(pickNote({ ...all, appleSong: "" }, "apple")?.text, "a-album");
  assert.equal(pickNote(all, "lastfm")?.text, "l-song");
  assert.equal(pickNote({ lastfmAlbum: "l-album", appleSong: "a-song" }, "lastfm")?.text, "l-album");
  assert.equal(pickNote({ lastfmSong: "l-song" }, "apple"), null);
});

test("None, or nothing anywhere, leaves the cell empty", () => {
  assert.equal(pickNote(all, "none"), null);
  assert.equal(pickNote({}, "both"), null);
  assert.equal(pickNote({ lastfmSong: "   " }, "both"), null);
});

test("the album's Last.fm facts are asked only when nothing before them fills the cell", () => {
  assert.equal(needsAlbumWiki({}, "both"), true);
  assert.equal(needsAlbumWiki({ lastfmSong: "l-song" }, "both"), false);
  assert.equal(needsAlbumWiki({ appleAlbum: "a-album" }, "both"), false);
  assert.equal(needsAlbumWiki({ appleAlbum: "a-album" }, "lastfm"), true);
  assert.equal(needsAlbumWiki({}, "apple"), false);
  assert.equal(needsAlbumWiki({}, "none"), false);
});
