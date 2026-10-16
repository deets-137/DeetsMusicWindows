// A song's primary artist and an album's real artist (ideas/apple-calls.md §5,
// ideas/album-notes.md §6.2), 2026-10-15: the pure rules in artist-credit.ts and
// library-model.ts. The lookup that primary-artist.ts registers is set here by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creditIndex, goToPeople, usePrimaryLookup, withPrimary } from "../src/artist-credit.ts";
import { groupAlbums, libAlbum } from "../src/library-model.ts";
import type { Track } from "../src/library.ts";

const song = (title: string, artistName: string, extra: Partial<Track> = {}): Track => ({
  title,
  artistName,
  genres: [],
  hasLyrics: false,
  ...extra,
} as Track);

// His library on 2026-10-15: no song by Girl Ultra alone, two collaborations on one album
// (one cover, so one album key).
const cover = { urlTemplate: "https://x/rrromeo/{w}x{h}.{f}", width: 1, height: 1 };
const menti = song("Mentirasmentiras", "Girl Ultra, Buscabulla & Chromeo", {
  libraryArtist: "Girl Ultra",
  albumArtist: "Girl Ultra",
  albumName: "Rrromeo",
  artwork: cover,
});
const denisse = song("Denisse", "Girl Ultra & Chromeo", {
  libraryArtist: "Girl Ultra",
  albumArtist: "Girl Ultra",
  albumName: "Rrromeo",
  artwork: cover,
});
const chromeo = song("Jealous", "Chromeo");

let version = 0;
let primaries = new Map<string, string>();
usePrimaryLookup({ version: () => version, nameOf: (t) => (t.libraryArtist ? primaries.get(t.libraryArtist) : undefined) });

test("2026-10-15: with no primary, Girl Ultra has no name of her own (the bug he reported)", () => {
  primaries = new Map();
  version++;
  const idx = creditIndex([menti, denisse, chromeo]);
  assert.deepEqual(idx.namesOf(menti), ["Girl Ultra, Buscabulla", "Chromeo"]);
  // Denisse's leading name gets a home; Mentirasmentiras goes to "Girl Ultra, Buscabulla".
  assert.deepEqual(idx.tracksFor("Girl Ultra"), [denisse]);
});

test("2026-10-15: the primary leads, seeds the vocabulary, and collects both songs", () => {
  primaries = new Map([["Girl Ultra", "Girl Ultra"]]);
  version++;
  const tracks = [menti, denisse, chromeo];
  const idx = creditIndex(tracks);
  assert.deepEqual(idx.namesOf(menti), ["Girl Ultra", "Chromeo"]);
  assert.deepEqual(idx.namesOf(denisse), ["Girl Ultra", "Chromeo"]);
  assert.deepEqual(idx.tracksFor("Girl Ultra"), [menti, denisse]);
  // A map change (the artist pass landed later) rebuilds the memo on the same array.
  primaries = new Map();
  version++;
  assert.deepEqual(creditIndex(tracks).namesOf(menti), ["Girl Ultra, Buscabulla", "Chromeo"]);
});

test("2026-10-15: a primary the parse spells another way takes the leading name's place", () => {
  assert.deepEqual(withPrimary(["Toddla T", "Jada Kingdom"], "Toddla T"), ["Toddla T", "Jada Kingdom"]);
  assert.deepEqual(withPrimary(["Jada Kingdom", "Toddla T"], "Toddla T"), ["Toddla T", "Jada Kingdom"]);
  assert.deepEqual(withPrimary(["Tyler, the Creator"], "Tyler, The Creator"), ["Tyler, The Creator"]);
  assert.deepEqual(withPrimary(["A & B"], undefined), ["A & B"]);
});

test("2026-10-15 (P2): Go to Artist ▸ lists the library names, then Apple's guests", () => {
  const cat = [
    { id: "1207957662", name: "Girl Ultra" },
    { id: "2", name: "Buscabulla" },
    { id: "3", name: "Chromeo" },
  ];
  const inLib = (n: string) => n === "Girl Ultra" || n === "Chromeo";
  const people = goToPeople(["Girl Ultra", "Chromeo"], cat, inLib);
  assert.deepEqual(
    people.map((p) => [p.name, p.id, p.inLibrary, p.lead]),
    [
      ["Girl Ultra", "1207957662", true, true],
      ["Chromeo", "3", true, false],
      ["Buscabulla", "2", false, false],
    ],
  );
  // No guests stored yet: the library names alone, with no ids.
  assert.deepEqual(goToPeople(["Girl Ultra"], undefined, inLib).map((p) => [p.name, p.id]), [["Girl Ultra", undefined]]);
  // A catalog song (no library names): Apple's list, the primary first and the lead.
  const cs = goToPeople([], cat, () => false);
  assert.deepEqual(cs.map((p) => [p.name, p.lead]), [["Girl Ultra", true], ["Buscabulla", false], ["Chromeo", false]]);
});

test("2026-10-15: Rrromeo is one album, Girl Ultra's, on every run", () => {
  const groups = groupAlbums([menti, denisse]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].artist, "Girl Ultra");
  assert.equal(libAlbum([menti, denisse]).artistName, "Girl Ultra");
  // Songs not re-read yet carry no album artist: the vote, as before.
  const z = { albumName: "Z", artwork: { urlTemplate: "https://x/z/{w}", width: 1, height: 1 } };
  const old = [song("a", "X & Y", z), song("b", "X", z), song("c", "X", z)];
  assert.equal(groupAlbums(old)[0].artist, "X");
});
