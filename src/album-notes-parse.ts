// Apple's editorial note on an album, read into blocks (docs/features/album-notes.md §4, §5.1).
// Pure, so `tests/album-notes-parse.test.ts` reads it as it is; the view (notes-view.ts) builds
// the DOM from these blocks out of text nodes, never from Apple's string as HTML.
//
// The format, as probed (§5.1): only `<i>`, `<b>` and `<br />` occur; a paragraph ends at
// `<br />\n` or at a blank line; a song heading is a line that holds only `<b>Name</b>`, with the
// artist's words on the lines after it. Any other tag is dropped, its text kept.
//
// Mentions (his call M1 = A, 2026-10-17): a bold name, or a name in curly quotes, that folds to
// a song of this album. Folding drops case, accents, quotes, punctuation and a trailing
// "(feat. …)", so "“RRRomeo”" finds *Rrromeo* and "“Kill Bill”" finds *Kill Bill (feat. Doja Cat)*.
// A bold name that is no song here may be a song elsewhere (*“BOMBAY”*, §1): it is `maybe`,
// matched at the click by one catalog search.

import { decodeEntities } from "./lastfm-names";

export type Part =
  | { t: "text"; s: string }
  | { t: "i"; s: string }
  | { t: "b"; s: string; maybe?: boolean }
  | { t: "mention"; s: string; index: number };

export type Block =
  | { kind: "heading"; s: string; index?: number }
  | { kind: "para"; parts: Part[] };

/** A name as a mention compares it: no case, accents, quotes, punctuation or "(feat. …)". */
export function foldName(s: string): string {
  return decodeEntities(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s*[([](?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/g, "")
    .replace(/[“”"‘’'`´«»¡!¿?.,:;()[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The songs' folded names → their index (the first song wins a tie). */
export function trackIndex(names: string[]): Map<string, number> {
  const m = new Map<string, number>();
  names.forEach((n, i) => {
    const f = foldName(n);
    if (f && !m.has(f)) m.set(f, i);
  });
  return m;
}

/** Apple's note with its paragraph breaks as blank lines and every tag but `<i>`/`<b>` gone. */
function normalize(html: string): string {
  return html
    .replace(/\r\n?/g, "\n")
    .replace(/<br\s*\/?>[ \t]*\n?/gi, "\n\n")
    .replace(/<(?!\/?[ib]>)[^>]*>/gi, "");
}

/** The words of a stretch of text with no tags: decoded, spaces collapsed. */
const plain = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ");

/** A paragraph's text into parts: `<i>`, `<b>`, and the quoted names that are songs here. */
function inline(src: string, idx: Map<string, number>): Part[] {
  const parts: Part[] = [];
  const re = /<(i|b)>([\s\S]*?)<\/\1>/gi;
  let at = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > at) parts.push(...quoted(plain(src.slice(at, m.index)), idx));
    const s = plain(m[2]).trim();
    if (s) {
      if (m[1].toLowerCase() === "i") parts.push({ t: "i", s });
      else {
        const index = idx.get(foldName(s));
        parts.push(index !== undefined ? { t: "mention", s, index } : { t: "b", s, maybe: true });
      }
    }
    at = re.lastIndex;
  }
  if (at < src.length) parts.push(...quoted(plain(src.slice(at)), idx));
  // A part's spaces at the paragraph's edges go.
  if (parts[0]?.t === "text") parts[0].s = parts[0].s.trimStart();
  const last = parts[parts.length - 1];
  if (last?.t === "text") last.s = last.s.trimEnd();
  return parts.filter((p) => p.s !== "");
}

/** A name in curly quotes that folds to a song here becomes a mention; the quotes, and a comma
 *  or period inside them (“Liar,”), stay text around it. Longer quotes (the artist's words) do
 *  not fold to a song name, so they stay text. */
function quoted(s: string, idx: Map<string, number>): Part[] {
  const out: Part[] = [];
  const re = /“([^“”]{1,120}?)([,.!?]?)”/g;
  let at = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const index = idx.get(foldName(m[1]));
    if (index === undefined) continue;
    const start = m.index + 1; // after the opening quote
    out.push({ t: "text", s: s.slice(at, start) });
    out.push({ t: "mention", s: m[1], index });
    at = start + m[1].length;
  }
  out.push({ t: "text", s: s.slice(at) });
  return out.filter((p) => p.s !== "");
}

/** The full note as blocks. `names`: the album's song names, in its order. */
export function parseNote(html: string, names: string[]): Block[] {
  const idx = trackIndex(names);
  const blocks: Block[] = [];
  for (const para of normalize(html).split(/\n\s*\n/)) {
    const lines = para.split("\n").map((l) => l.trim()).filter(Boolean);
    let body: string[] = [];
    const flush = () => {
      if (!body.length) return;
      const parts = inline(body.join(" "), idx);
      if (parts.length) blocks.push({ kind: "para", parts });
      body = [];
    };
    for (const line of lines) {
      const h = /^<b>([\s\S]*?)<\/b>$/i.exec(line);
      if (h && !/<b>/i.test(h[1])) {
        flush();
        const s = plain(h[1]).trim();
        if (s) blocks.push({ kind: "heading", s, index: idx.get(foldName(s)) });
      } else body.push(line);
    }
    flush();
  }
  return blocks;
}

/** The plain text of a block's parts (the song page's About, a hint). */
export const partsText = (parts: Part[]): string => parts.map((p) => p.s).join("").replace(/\s+/g, " ").trim();

/** Apple's words about one song: the paragraphs under its heading in a track-by-track note,
 *  as plain text; undefined when the note has no heading for it (LISTENERS.md §8.3 step 1). */
export function songPart(html: string, title: string): string | undefined {
  const want = foldName(title);
  if (!want) return undefined;
  const blocks = parseNote(html, [title]);
  const at = blocks.findIndex((b) => b.kind === "heading" && foldName(b.s) === want);
  if (at < 0) return undefined;
  const words: string[] = [];
  for (const b of blocks.slice(at + 1)) {
    if (b.kind === "heading") break;
    words.push(partsText(b.parts));
  }
  return words.join(" ").trim() || undefined;
}

/** A short note as plain text (Apple sends it with no tags, §5.1; decoded all the same). */
export const shortText = (s: string | undefined): string | undefined => (s ? plain(s).trim() || undefined : undefined);
