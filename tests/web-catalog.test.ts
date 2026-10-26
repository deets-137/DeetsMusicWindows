// The web build's catalog normalizers against the Rust ones (docs/features/WebRooms.md §9.3 C).
// apple-catalog.expected.json is written by Rust (`UPDATE_WEB_FIXTURE=1 cargo test
// web_twin_fixture`); the TypeScript twin must give the same model for the same Apple JSON.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  albumFromCatalog,
  artistDetailFrom,
  artistFromCatalog,
  collectionTracksFrom,
  playlistFromCatalog,
  relatedFrom,
  searchResultsFrom,
  stationFromCatalog,
  trackFromCatalogSong,
} from "../web/apple-catalog.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const raw = read("apple-catalog.json");
const expected = read("apple-catalog.expected.json");

test("web twin: each normalizer matches the Rust output (2026-10-13)", () => {
  assert.deepEqual(raw.songs.map(trackFromCatalogSong), expected.songs);
  assert.deepEqual(raw.albums.map(albumFromCatalog), expected.albums);
  assert.deepEqual(raw.artists.map(artistFromCatalog), expected.artists);
  assert.deepEqual(raw.playlists.map(playlistFromCatalog), expected.playlists);
  assert.deepEqual(raw.stations.map(stationFromCatalog), expected.stations);
});

test("web twin: a search reply fills the five buckets", () => {
  const r = searchResultsFrom({ results: { songs: { data: raw.songs }, stations: { data: raw.stations } } });
  assert.deepEqual(r.songs, expected.songs);
  assert.deepEqual(r.stations, expected.stations);
  assert.deepEqual(r.albums, []);
  assert.deepEqual(r.artists, []);
  assert.deepEqual(r.playlists, []);
});

test("web twin: album tracks skip videos and date an unreleased song by its album", () => {
  const body = { data: [{ attributes: { releaseDate: "2026-11-01" } }] };
  const video = { id: "v1", type: "music-videos", attributes: { name: "Clip" } };
  const ts = collectionTracksFrom("albums", body, [raw.songs[0], video, raw.songs[1]]);
  assert.equal(ts.length, 2);
  assert.equal(ts[0].releaseDate, "2015-03-10"); // its own date stays
  assert.equal(ts[1].unreleased, true);
  assert.equal(ts[1].releaseDate, "2026-11-01");
  assert.equal(collectionTracksFrom("playlists", body, [raw.songs[1]])[0].releaseDate, undefined);
});

test("web twin: an artist reply gives the three views", () => {
  const d = artistDetailFrom({
    data: [{ ...raw.artists[0], views: { "top-songs": { data: [raw.songs[0]] }, "full-albums": { data: raw.albums }, "featured-playlists": { data: raw.playlists } } }],
  });
  assert.deepEqual(d.artist, expected.artists[0]);
  assert.deepEqual(d.topSongs, [expected.songs[0]]);
  assert.deepEqual(d.albums, expected.albums);
  assert.deepEqual(d.featuredPlaylists, expected.playlists);
  assert.deepEqual(d.appearsOn, []);
});

test("web twin: albums, singles and live merge; a release in two views shows once (2026-10-26)", () => {
  const [a, b] = raw.albums;
  const views = { "full-albums": { data: [a] }, singles: { data: [b, a] }, "live-albums": { data: [] }, "appears-on-albums": { data: [b] } };
  const d = artistDetailFrom({ data: [{ ...raw.artists[0], views }] });
  assert.deepEqual(d.albums, [expected.albums[0], expected.albums[1]]);
  assert.deepEqual(d.appearsOn, []); // already on the Albums shelf
  // A view read whole replaces the reply's first page.
  const w = artistDetailFrom({ data: [{ ...raw.artists[0], views }] }, { singles: [] });
  assert.deepEqual(w.albums, [expected.albums[0]]);
  assert.deepEqual(w.appearsOn, [expected.albums[1]]);
});

test("web twin: related gives the first relation, or null", () => {
  const body = { data: [{ relationships: { albums: { data: [{ id: "9", attributes: { name: "Currents", releaseDate: "2015-07-17" } }] } } }] };
  assert.deepEqual(relatedFrom(body, "albums"), { id: "9", name: "Currents", releaseDate: "2015-07-17" });
  assert.equal(relatedFrom(body, "artists"), null);
});
