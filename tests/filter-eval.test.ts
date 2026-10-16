// filter-eval.ts and the filter half of rules-eval.ts (docs/features/filter-rules.md §13).
import { test } from "node:test";
import assert from "node:assert/strict";
import { evalCond, validate, type Cond, type Facts } from "../src/rules-eval.ts";
import { isDue, lastMidnight, makesLoop, missingOf, pickSongs, readsOf, remoteOf, trackFacts, type FilterRow, type Song } from "../src/filter-eval.ts";
import type { Track } from "../src/library.ts";

const S = { songs: true } as const;
const song = (key: string, facts: Facts, extra: Partial<Track> = {}): Song => ({
  key,
  track: { title: String(facts.title ?? key), artistName: String(facts.artist ?? ""), genres: [], hasLyrics: false, catalogId: key, ...extra },
  facts: { title: key, ...facts },
});

test("accents fold away in a filter: venus finds Vénus, Beyonce finds Beyoncé (§13.5)", () => {
  const f = { title: "Vénus", artist: "Beyoncé" };
  assert.equal(evalCond({ fact: "title", has: "venus" }, f, S), true);
  assert.equal(evalCond({ fact: "artist", is: "beyonce" }, f, S), true);
  // The toggle on: accents count.
  assert.equal(evalCond({ fact: "title", has: "venus", accents: true }, f, S), false);
  assert.equal(evalCond({ fact: "title", has: "Vénus", accents: true }, f, S), true);
  // A Rulez rule reads as before: case only.
  assert.equal(evalCond({ fact: "artist", is: "beyonce" }, f), false);
});

test("contains: any member of a list, any of the wanted texts", () => {
  const f = { genre: ["Hip-Hop/Rap", "Jazz"], title: "Live at the Apollo (Remix)" };
  assert.equal(evalCond({ fact: "genre", has: "rap" }, f, S), true);
  assert.equal(evalCond({ fact: "title", has: ["remix", "edit"] }, f, S), true);
  assert.equal(evalCond({ fact: "title", has: "acoustic" }, f, S), false);
});

test("a missing value: positive tests fail, is-not holds in a filter only (§13.4)", () => {
  const none: Facts = {};
  assert.equal(evalCond({ fact: "diaryScore", gte: 8 }, none, S), false);
  assert.equal(evalCond({ fact: "diaryScore", isNot: 8 }, none, S), true);
  assert.equal(evalCond({ fact: "diaryScore", isNot: 8 }, none), false); // Rulez: unchanged
  assert.equal(evalCond({ not: { any: [{ fact: "diaryScore", is: 8 }] } }, none, S), true);
});

test("known: has a value, has no value", () => {
  assert.equal(evalCond({ fact: "listeners", known: true }, { listeners: 900 }, S), true);
  assert.equal(evalCond({ fact: "listeners", known: true }, {}, S), false);
  assert.equal(evalCond({ fact: "listeners", known: false }, {}, S), true);
  assert.equal(evalCond({ fact: "listeners", known: false }, { listeners: 900 }, S), false);
  // Known with a number test: both must hold.
  assert.equal(evalCond({ fact: "listeners", known: true, lt: 1000 }, { listeners: 900 }, S), true);
});

test("validate takes has and known as tests", () => {
  const k = { events: new Set(["song.play"]), facts: new Set(["title", "listeners"]), actions: new Set(["next"]), targets: new Set<string>() };
  const r = (c: Cond) => ({ id: "x", kind: "moment", source: { user: true }, on: true, when: "song.play", card: "*", if: c, do: { next: true } });
  assert.equal(validate(r({ fact: "title", has: "live" }), k), null);
  assert.equal(validate(r({ fact: "listeners", known: false }), k), null);
  assert.match(validate(r({ fact: "title", has: 3 as never }), k) ?? "", /has needs text/);
});

test("a track's own facts", () => {
  const t: Track = { title: "So What", artistName: "Miles Davis", albumName: "Kind of Blue", genres: ["Jazz", "Music"], hasLyrics: false, durationMs: 562_000, releaseDate: "1959-08-17", contentRating: "explicit", composer: "Miles Davis", addedRank: 12 };
  assert.deepEqual(trackFacts(t), {
    title: "So What", artist: "Miles Davis", albumArtist: "Miles Davis", genre: ["Jazz"], explicit: true, lyrics: false,
    album: "Kind of Blue", composer: "Miles Davis", year: 1959, length: 562, addedRank: 12,
  });
});

test("reads: the condition, the order and the limit; only the remote ones go to Rust", () => {
  const rule = { if: { all: [{ fact: "genre", is: "Jazz" }, { fact: "plays", gte: 5 }] } as Cond, order: { by: "lastPlayed", dir: "desc" } as const, limit: { perArtist: 2 } };
  assert.deepEqual([...readsOf(rule)].sort(), ["artist", "genre", "lastPlayedDays", "plays"]);
  assert.deepEqual(remoteOf(rule).sort(), ["lastPlayedDays", "plays"]);
});

const jazz: Cond = { fact: "genre", is: "Jazz" };
const pool = [
  song("a", { genre: ["Jazz"], artist: "Miles", plays: 9, length: 300 }),
  song("b", { genre: ["Rock"], artist: "Queen", plays: 50, length: 200 }),
  song("c", { genre: ["Jazz"], artist: "Miles", plays: 3, length: 400 }),
  song("d", { genre: ["Jazz"], artist: "Coltrane", length: 250 }),
  song("e", { genre: ["Jazz"], artist: "Miles", plays: 1, length: 100 }),
];
const hand = { by: "hand", dir: "asc" } as const;

test("your order: songs stay where they are, new ones join at the end", () => {
  const current = [pool[3], pool[0]];
  assert.deepEqual(pickSongs(pool, { if: jazz, order: hand }, { current }), ["d", "a", "c", "e"]);
});

test("Never keeps a song out; Keep holds one in, from the playlist when no source has it (F4)", () => {
  const extra = song("z", { genre: ["Pop"] });
  const keys = pickSongs(pool, { if: jazz, order: hand }, { never: new Set(["c"]), keep: new Set(["b", "z"]), current: [extra] });
  assert.deepEqual(keys, ["z", "a", "b", "d", "e"]);
});

test("a sort: the value's order, a song with no value last in both directions", () => {
  assert.deepEqual(pickSongs(pool, { if: jazz, order: { by: "plays", dir: "desc" } }), ["a", "c", "e", "d"]);
  assert.deepEqual(pickSongs(pool, { if: jazz, order: { by: "plays", dir: "asc" } }), ["e", "c", "a", "d"]);
});

test("random: the same seed gives the same order; another seed may not", () => {
  const r = { if: jazz, order: { by: "random", dir: "asc" } as const };
  assert.deepEqual(pickSongs(pool, r, { seed: 7 }), pickSongs(pool, r, { seed: 7 }));
  assert.equal(pickSongs(pool, r, { seed: 7 }).length, 4);
});

test("limits: songs, minutes, per artist; a kept song is always in and not counted", () => {
  const byPlays = { by: "plays", dir: "desc" } as const;
  assert.deepEqual(pickSongs(pool, { if: jazz, order: byPlays, limit: { songs: 2 } }), ["a", "c"]);
  assert.deepEqual(pickSongs(pool, { if: jazz, order: byPlays, limit: { perArtist: 1 } }), ["a", "d"]);
  assert.deepEqual(pickSongs(pool, { if: jazz, order: byPlays, limit: { minutes: 10 } }), ["a", "e"]); // 300 + 100 s; c (400) and d (250) would pass 600
  assert.deepEqual(pickSongs(pool, { if: jazz, order: byPlays, limit: { songs: 1 } }, { keep: new Set(["e"]) }), ["a", "e"]);
});

test("the missing count names the facts a song may lack", () => {
  const m = missingOf(pool, { if: { all: [{ fact: "plays", gte: 1 }, { fact: "diaryScore", gte: 1 }] } });
  assert.equal(m.get("diaryScore"), 5);
  assert.equal(m.has("plays"), false); // a play count is 0, never missing
});

test("Daily and Weekly: due before the last midnight; Live and Off never by the clock", () => {
  const now = new Date(2026, 9, 16, 15, 0).getTime(); // a Friday
  const lastNight = lastMidnight(now);
  assert.equal(isDue("daily", lastNight - 1, now), true);
  assert.equal(isDue("daily", lastNight + 1, now), false);
  assert.equal(isDue("weekly:5", lastNight + 1, now), false); // Friday counts today
  assert.equal(isDue("weekly:5", lastNight - 1, now), true);
  assert.equal(isDue("weekly:1", lastNight - 1, now), false); // Monday's midnight was earlier
  assert.equal(isDue("daily", null, now), true);
  assert.equal(isDue("live", null, now), false);
  assert.equal(isDue("off", null, now), false);
});

test("a loop through another Rulez Playlist is found", () => {
  const row = (playlistId: number, sources: string[]): FilterRow => ({
    rule: { id: `f${playlistId}`, name: "", sources: sources as never, order: hand }, playlistId, refresh: "live", keep: [], never: [], version: 0, madeAt: null,
  });
  const rows = [row(1, ["library"]), row(2, ["playlist:local:1"])];
  assert.equal(makesLoop(rows, 1, ["playlist:local:2"]), true);
  assert.equal(makesLoop(rows, 1, ["playlist:local:1"]), true);
  assert.equal(makesLoop(rows, 3, ["playlist:local:2"]), false);
});

// The time is logged, never asserted: `npm test` runs every file at once, and a loaded CPU made
// one run take 265 ms (2026-10-16). The gate is measured on its own (filter-rules.md §13.1b).
test("the gate's page part: 20,000 songs, the time logged (§13.1b)", () => {
  const big: Song[] = [];
  const genres = ["Jazz", "Rock", "Hip-Hop/Rap", "Pop", "Électronique"];
  for (let i = 0; i < 20_000; i++)
    big.push(song(`s${i}`, { genre: [genres[i % 5]], artist: `Artist ${i % 900}`, title: `Song ${i}`, plays: i % 37, length: 120 + (i % 300), diaryScore: i % 7 ? undefined : i % 10 }));
  const rule = {
    if: { all: [{ any: [{ fact: "genre", has: "electronique" }, { fact: "genre", is: "Jazz" }] }, { fact: "plays", gte: 5 }, { fact: "diaryScore", isNot: 3 }] } as Cond,
    order: { by: "plays", dir: "desc" } as const,
    limit: { songs: 100, perArtist: 2 },
  };
  pickSongs(big, rule); // warm
  const t0 = performance.now();
  const keys = pickSongs(big, rule);
  console.log(`[gate] page part, 20,000 songs: ${(performance.now() - t0).toFixed(1)} ms`);
  assert.equal(keys.length, 100);
});
