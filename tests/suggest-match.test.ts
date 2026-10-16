// suggest-match.ts: which Suggest Less mark a song matches (SUGGEST-LESS.md §5c).
import { test } from "node:test";
import assert from "node:assert/strict";
import { addMark, emptySets, fold, featNames, creditedNames, matchSong, albumNameKey } from "../src/suggest-match.ts";

const song = (over: Partial<Parameters<typeof matchSong>[1]> = {}) => ({ title: "Song", artistName: "Artist", ...over });

test("fold: case, accents and spaces", () => {
  assert.equal(fold("  Beyoncé   Knowles "), "beyonce knowles");
  assert.equal(fold(undefined), "");
  assert.equal(albumNameKey("Lemonade", "Beyoncé"), "lemonade|beyonce");
});

test("featNames reads the feat. and with parts", () => {
  assert.deepEqual(featNames("Song (feat. A & B)"), ["A", "B"]);
  assert.deepEqual(featNames("Song [with C]"), ["C"]);
  assert.deepEqual(featNames("Song (Live)"), []);
  assert.deepEqual(creditedNames({ title: "X (feat. Ünder)", artistName: "A, B" }), ["a", "b", "a, b", "under"]);
});

test("a song mark matches by catalog id, library id or the extra id", () => {
  const s = emptySets();
  addMark(s, "song", "123");
  assert.equal(matchSong(s, song({ catalogId: "123" })), "song");
  assert.equal(matchSong(s, song({ libraryId: "i.x" }), "123"), "song");
  assert.equal(matchSong(s, song({ catalogId: "999" })), null);
});

test("an artist mark matches the line, a split name and a feat. guest", () => {
  const s = emptySets();
  addMark(s, "artist", "id-1", "Drake");
  assert.equal(matchSong(s, song({ artistName: "Drake" })), "artist");
  assert.equal(matchSong(s, song({ artistName: "Future & Drake" })), "artist");
  assert.equal(matchSong(s, song({ title: "Hit (feat. DRAKE)", artistName: "Rihanna" })), "artist");
  assert.equal(matchSong(s, song({ artistName: "Drakeo the Ruler" })), null);
});

test("an album mark needs the album name and its artist", () => {
  const s = emptySets();
  addMark(s, "album", "a1", "Thriller", "Michael Jackson");
  assert.equal(matchSong(s, song({ albumName: "Thriller", artistName: "Michael Jackson" })), "album");
  assert.equal(matchSong(s, song({ albumName: "thriller", artistName: "Paul McCartney", albumArtist: "Michael Jackson" })), "album");
  assert.equal(matchSong(s, song({ albumName: "Thriller", artistName: "Someone Else" })), null);
});

test("the order: song before album before artist", () => {
  const s = emptySets();
  addMark(s, "song", "1");
  addMark(s, "album", "a", "Album", "Artist");
  addMark(s, "artist", "b", "Artist");
  assert.equal(matchSong(s, song({ catalogId: "1", albumName: "Album" })), "song");
  assert.equal(matchSong(s, song({ albumName: "Album" })), "album");
  assert.equal(matchSong(s, song({})), "artist");
});
