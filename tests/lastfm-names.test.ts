// lastfm-names.ts: the Last.fm name forms for an Apple album and the About text
// (LISTENERS.md §7; probed live 2026-10-12).
import { test } from "node:test";
import assert from "node:assert/strict";
import { albumForms, mainArtist, noteText, pillCount, songForms, stripReleaseSuffix, titleKey, topByTitle, wikiSentences, wikiText } from "../src/lastfm-names.ts";

test("2026-11-05: an artist's list matches a title by the words songForms cuts", () => {
  assert.equal(titleKey("Love (feat. IshDARR)"), "love");
  assert.equal(titleKey("Don’t Stop [Remastered 2011]"), "don't stop");
  assert.equal(titleKey("Heat - Remastered 2011"), "heat");
  // a remix or a live take is another recording, so it never meets the plain song
  assert.notEqual(titleKey("Heat (Live)"), titleKey("Heat"));
  assert.notEqual(titleKey("Heat (Flume Remix)"), titleKey("Heat"));
});

test("2026-11-05: the largest row of a title wins, in any order", () => {
  const rows = [
    { name: "Superlove", playcount: 1503, listeners: 90 },
    { name: "Superlove (feat. Oh Wonder)", playcount: 528214, listeners: 4000 },
    { name: "SUPERLOVE", playcount: 12, listeners: 1 },
  ];
  assert.equal(topByTitle(rows).get("superlove")?.playcount, 528214);
  assert.equal(topByTitle([...rows].reverse()).get("superlove")?.playcount, 528214);
  assert.equal(topByTitle([]).size, 0);
});

test("Apple's release suffix comes off", () => {
  assert.equal(stripReleaseSuffix("THREAD 27 - EP"), "THREAD 27");
  assert.equal(stripReleaseSuffix("GUERILLAZ - Single"), "GUERILLAZ");
  assert.equal(stripReleaseSuffix("Essex Honey"), "Essex Honey");
  // only at the end, and only those two words
  assert.equal(stripReleaseSuffix("EP - Live"), "EP - Live");
  assert.equal(stripReleaseSuffix("Singles - Remastered"), "Singles - Remastered");
});

test("the main artist is the name before a second artist", () => {
  assert.equal(mainArtist("H.LLS & Lucy Park"), "H.LLS");
  assert.equal(mainArtist("Lucy Park, Botaii"), "Lucy Park");
  assert.equal(mainArtist("Fred again.. x Skrillex"), "Fred again..");
  assert.equal(mainArtist("Drake feat. Rihanna"), "Drake");
  assert.equal(mainArtist("Blood Orange"), "Blood Orange");
  // an x inside a name is not a separator
  assert.equal(mainArtist("Charli xcx"), "Charli xcx");
});

test("Spotify's form first, then Apple's exact names", () => {
  assert.deepEqual(albumForms("H.LLS & Lucy Park", "GUERILLAZ - Single"), [
    ["H.LLS", "GUERILLAZ"],
    ["H.LLS & Lucy Park", "GUERILLAZ - Single"],
  ]);
  assert.deepEqual(albumForms("Lucy Park", "THREAD 27 - EP"), [
    ["Lucy Park", "THREAD 27"],
    ["Lucy Park", "THREAD 27 - EP"],
  ]);
});

test("one form when Spotify's and Apple's are the same", () => {
  assert.deepEqual(albumForms("Blood Orange", "Essex Honey"), [["Blood Orange", "Essex Honey"]]);
});

test("nothing to ask without both names", () => {
  assert.deepEqual(albumForms("", "Album"), []);
  assert.deepEqual(albumForms("Artist", "  "), []);
});

test("the wiki loses its Read more link, its tags and its entities", () => {
  const html = `In Rainbows is the seventh album by &quot;Radiohead&quot; &amp; friends. <a href="https://www.last.fm/music/Radiohead/In+Rainbows">Read more on Last.fm</a>.`;
  assert.equal(wikiText(html), `In Rainbows is the seventh album by "Radiohead" & friends.`);
});

test("About is the first two sentences", () => {
  const html = "First one. Second one! Third one? Fourth.";
  assert.equal(wikiSentences(html), "First one. Second one!");
  assert.equal(wikiSentences(html, 1), "First one.");
  assert.equal(wikiSentences("Only one sentence"), "Only one sentence");
  assert.equal(wikiSentences(`<a href="x">Read more on Last.fm</a>`), "");
});

test("a decimal or an initial does not end a sentence", () => {
  assert.equal(wikiSentences("It sold 2.5 million copies. It won awards. Later."), "It sold 2.5 million copies. It won awards.");
  assert.equal(wikiSentences("Made with the help of producer e.g. someone. Then more. End."), "Made with the help of producer e.g. someone. Then more.");
});

// A test of the song facts box (2026-10-17): titles and short forms, more entities, a stub wiki.
test("a title or a short form does not end a sentence (2026-10-17)", () => {
  assert.equal(wikiSentences("Produced by Dr. Dre in St. Louis. It charted. Later."), "Produced by Dr. Dre in St. Louis. It charted.");
  assert.equal(wikiSentences("From Vol. 2 of the series. It charted. Later."), "From Vol. 2 of the series. It charted.");
  assert.equal(wikiSentences("Mr. Brightside is a song. It charted. Later."), "Mr. Brightside is a song. It charted.");
});

test("the named entities a wiki uses are decoded (2026-10-17)", () => {
  assert.equal(wikiText("Beyonc&eacute; &ndash; caf&eacute; &hellip; it&rsquo;s"), "Beyoncé – café … it’s");
  assert.equal(wikiText("&unknown; stays"), "&unknown; stays");
});

test("a stub wiki (only the Read more link) is no note (2026-10-17)", () => {
  assert.equal(noteText(`<a href="https://www.last.fm/music/x">Read more on Last.fm</a>`), undefined);
  assert.equal(noteText(""), undefined);
  assert.equal(noteText(undefined), undefined);
  assert.equal(noteText("A song. <a href=\"x\">Read more on Last.fm</a>"), "A song.");
});

test("a song's forms: the plain form, then Apple's (2026-11-05)", () => {
  assert.deepEqual(songForms("Leven Kali & Alissia", "RAINING SUN"), [["Leven Kali", "RAINING SUN", false], ["Leven Kali", "RAINING SUN", true], ["Leven Kali & Alissia", "RAINING SUN", true]]);
  assert.deepEqual(songForms("WILLOW", "pain for fun (feat. St. Vincent)")[0], ["WILLOW", "pain for fun", false]);
  assert.deepEqual(songForms("Rahill", "Song [feat. Beck]")[0], ["Rahill", "Song", false]);
  assert.deepEqual(songForms("SZA", "Kill Bill"), [["SZA", "Kill Bill", true]]);
  assert.deepEqual(songForms("SZA", "(with you)"), [["SZA", "(with you)", true]]); // a title that is only the extra stays
  assert.deepEqual(songForms("", "Kill Bill"), []);
});

test("the pill's number: his four examples, and the edges (2026-11-05)", () => {
  assert.equal(pillCount(4976), "4976");
  assert.equal(pillCount(80_000), "80k");
  assert.equal(pillCount(210_400), "210.4k");
  assert.equal(pillCount(6_000_000), "6M");
  assert.equal(pillCount(9_999), "9999");
  assert.equal(pillCount(10_000), "10k");
  assert.equal(pillCount(80_440), "80.4k");
  assert.equal(pillCount(999_949), "999.9k");
  assert.equal(pillCount(999_950), "1M"); // never "1000k"
  assert.equal(pillCount(6_440_000), "6.4M");
  assert.equal(pillCount(999_950_000), "1B");
});

// Plain title of each form, the first of the three.
const plainTitle = (t: string) => songForms("Queen", t)[0][1];

test("an edition's words come off a title, a recording's stay (2026-11-05)", () => {
  assert.equal(plainTitle("Bohemian Rhapsody (Remastered 2011)"), "Bohemian Rhapsody");
  assert.equal(plainTitle("Bohemian Rhapsody - Remastered 2011"), "Bohemian Rhapsody");
  assert.equal(plainTitle("Dreams (2004 Remaster)"), "Dreams");
  assert.equal(plainTitle("Song - 2021 Remaster"), "Song");
  assert.equal(plainTitle("Song (Deluxe Edition)"), "Song");
  assert.equal(plainTitle("Song (Bonus Track)"), "Song");
  assert.equal(plainTitle("Song [Explicit]"), "Song");
  assert.equal(plainTitle("Song (30th Anniversary Edition)"), "Song");
  assert.equal(plainTitle("Get Lucky (Daft Punk Remix)"), "Get Lucky (Daft Punk Remix)");
  assert.equal(plainTitle("Song (Live at Wembley) "), "Song (Live at Wembley)");
  assert.equal(plainTitle("Song (Radio Edit)"), "Song (Radio Edit)");
  assert.equal(plainTitle("Song - Remastered Live"), "Song - Remastered Live");
  assert.equal(plainTitle("Song (Remastered Remix)"), "Song (Remastered Remix)");
});

test("Exact title asks Apple's names alone, with no correction (2026-11-05)", () => {
  assert.deepEqual(songForms("A & B", "Song (feat. C)", true), [["A & B", "Song (feat. C)", false]]);
});
