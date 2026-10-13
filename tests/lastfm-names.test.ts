// lastfm-names.ts: the Last.fm name forms for an Apple album and the About text
// (LISTENERS.md §7; probed live 2026-10-12).
import { test } from "node:test";
import assert from "node:assert/strict";
import { albumForms, mainArtist, stripReleaseSuffix, wikiSentences, wikiText } from "../src/lastfm-names.ts";

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
