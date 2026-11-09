// library-model.ts: one album key (UPLOADS.md §2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { albumKey, groupAlbums, isUploadLink } from "../src/library-model.ts";
import type { Track } from "../src/library.ts";

const song = (over: Partial<Track>): Track =>
  ({ title: "A song", artistName: "MF DOOM", albumName: "Villainy", genres: [], hasLyrics: false, ...over }) as Track;
const art = (urlTemplate: string) => ({ urlTemplate, width: 600, height: 600 });

test("2026-11-06 two signatures on an uploaded album are one album", () => {
  const a = song({ libraryAlbumId: "l.abc", artwork: art("https://store-037.blobstore.apple.com/a/image?X-Amz-Signature=1") });
  const b = song({ libraryAlbumId: "l.abc", artwork: art("https://store-037.blobstore.apple.com/b/image?X-Amz-Signature=2") });
  assert.equal(albumKey(a), albumKey(b));
  assert.equal(groupAlbums([a, b]).length, 1);
});

test("2026-11-06 an uploaded album keeps its key once its cover is saved", () => {
  const signed = song({ libraryAlbumId: "l.abc", artwork: art("https://store-037.blobstore.apple.com/a/image?X-Amz-Signature=1") });
  const saved = song({ libraryAlbumId: "l.abc", artwork: art("http://cover.localhost/upload/0123") });
  assert.equal(albumKey(signed), albumKey(saved));
});

test("2026-11-06 with no library album id an upload keys on the album's artist", () => {
  const a = song({ albumArtist: "DOOM", artistName: "DOOM feat. Guest", artwork: art("http://cover.localhost/upload/1") });
  const b = song({ albumArtist: "DOOM", artistName: "DOOM", artwork: art("http://cover.localhost/upload/2") });
  assert.equal(albumKey(a), albumKey(b));
});

test("2026-11-06 two uploaded albums of one name stay apart", () => {
  const a = song({ libraryAlbumId: "l.abc", artwork: art("http://cover.localhost/upload/1") });
  const b = song({ libraryAlbumId: "l.xyz", artwork: art("http://cover.localhost/upload/1") });
  assert.notEqual(albumKey(a), albumKey(b));
});

test("2026-11-06 a catalog album's key does not change", () => {
  const url = "https://is1-ssl.mzstatic.com/image/thumb/a/{w}x{h}bb.jpg";
  assert.equal(albumKey(song({ libraryAlbumId: "l.abc", artwork: art(url) })), `Villainy ${url}`);
  assert.equal(albumKey(song({})), "Villainy MF DOOM");
});

test("2026-11-09 only an upload's signed link counts as one", () => {
  assert.equal(isUploadLink("https://store-037.blobstore.apple.com/sq/x.jpg?X-Amz-Expires=86400"), true);
  assert.equal(isUploadLink("http://cover.localhost/upload/abc"), false);
  assert.equal(isUploadLink("https://is1-ssl.mzstatic.com/image/thumb/a/512x512bb.jpg"), false);
});
