// album-notes-parse.ts: Apple's full note into blocks and mentions (ideas/album-notes.md §4,
// §5.1; his call M1 = A, 2026-10-17). The fixtures are cut from the real notes the probe read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldName, parseNote, partsText, shortText, songPart, type Block } from "../src/album-notes-parse.ts";

const heads = (b: Block[]) => b.filter((x) => x.kind === "heading").map((x) => (x.kind === "heading" ? [x.s, x.index] : []));

test("folding: case, accents, quotes, punctuation and a trailing feat. go", () => {
  assert.equal(foldName("“RRRomeo”"), foldName("Rrromeo"));
  assert.equal(foldName("“¡El groove de Romeo!”"), foldName("¡El Groove De Romeo!"));
  assert.equal(foldName("“Mentirasmentiras” (feat. Buscabulla)"), "mentirasmentiras");
  assert.equal(foldName("Kill Bill (feat. Doja Cat)"), "kill bill");
  assert.equal(foldName("Café &amp; Tea"), "cafe & tea");
});

test("a track-by-track note: <br /> ends a paragraph, a bold line alone is a song heading", () => {
  // Arlo Parks, Collapsed in Sunbeams (2021): the format of 4 of 16 full notes in the sample.
  const note =
    "Here, she talks us through her work, track by track.<br />\n<b>Collapsed in Sunbeams</b>\n“I knew that I wanted poetry in the album.”<br />\n" +
    "<b>Hurt</b>\n“It was a hard song to write.”<br />\n<b>A Song Not Here</b>\nSomething.";
  const b = parseNote(note, ["Collapsed in Sunbeams", "Hurt", "Caroline"]);
  assert.deepEqual(heads(b), [["Collapsed in Sunbeams", 0], ["Hurt", 1], ["A Song Not Here", undefined]]);
  assert.equal(b[0].kind, "para");
  assert.equal(b[0].kind === "para" && partsText(b[0].parts), "Here, she talks us through her work, track by track.");
  assert.equal(b[2].kind === "para" && partsText(b[2].parts), "“I knew that I wanted poetry in the album.”");
});

test("blank lines split paragraphs too, and <i> stays italic", () => {
  const b = parseNote("One <i>Romance</i> line.\n\nTwo.", []);
  assert.equal(b.length, 2);
  assert.deepEqual(b[0].kind === "para" && b[0].parts, [{ t: "text", s: "One " }, { t: "i", s: "Romance" }, { t: "text", s: " line." }]);
});

test("a song name in curly quotes is a mention (M1 = A); the artist's quoted words are not", () => {
  // Camila Cabello, Romance: the names in running text sit in curly quotes, not in bold.
  const b = parseNote("“Dream of You” and “Living Proof” are crush notes. She says: “I loved its sense of eroticism.” Then “Liar,” and more.", [
    "Living Proof",
    "Dream of You",
    "Liar",
  ]);
  assert.equal(b.length, 1);
  const parts = b[0].kind === "para" ? b[0].parts : [];
  assert.deepEqual(
    parts.filter((p) => p.t === "mention"),
    [
      { t: "mention", s: "Dream of You", index: 1 },
      { t: "mention", s: "Living Proof", index: 0 },
      { t: "mention", s: "Liar", index: 2 },
    ],
  );
  // The quotes and the comma stay around the mention; the whole text reads as Apple wrote it.
  assert.equal(partsText(parts), "“Dream of You” and “Living Proof” are crush notes. She says: “I loved its sense of eroticism.” Then “Liar,” and more.");
});

test("a bold name inside a sentence: a mention when it is a song here, else 'maybe' (a song elsewhere)", () => {
  // Rrromeo: bold names in running text; “BOMBAY” (2022) is not on the album.
  const b = parseNote("She loves <b>“Denisse”</b> and still plays <b>“BOMBAY”</b> live.", ["Denisse", "Rrromeo"]);
  const parts = b[0].kind === "para" ? b[0].parts : [];
  assert.deepEqual(parts[1], { t: "mention", s: "“Denisse”", index: 0 });
  assert.deepEqual(parts[3], { t: "b", s: "“BOMBAY”", maybe: true });
});

test("any other tag is dropped and its text kept; entities decoded", () => {
  const b = parseNote('Read <a href="x">this</a> &amp; that&rsquo;s it.', []);
  assert.equal(b[0].kind === "para" && partsText(b[0].parts), "Read this & that’s it.");
});

test("the song's own part of a track-by-track note (the song page's About)", () => {
  const note = "Intro.<br />\n<b>“Mentirasmentiras” (feat. Buscabulla)</b>\n“We wrote it fast.”\n“In one night.”<br />\n<b>Denisse</b>\n“Another.”";
  assert.equal(songPart(note, "Mentirasmentiras (feat. Buscabulla & Chromeo)"), "“We wrote it fast.” “In one night.”");
  assert.equal(songPart(note, "Denisse"), "“Another.”");
  assert.equal(songPart(note, "Rrromeo"), undefined);
  assert.equal(songPart("No headings at all.", "Denisse"), undefined);
});

test("a short note as plain text", () => {
  assert.equal(shortText("  The CDMX artist dives into ’80s pop &amp; more. "), "The CDMX artist dives into ’80s pop & more.");
  assert.equal(shortText("   "), undefined);
  assert.equal(shortText(undefined), undefined);
});
