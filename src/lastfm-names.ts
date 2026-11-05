// Pure rules for the Last.fm facts boxes (LISTENERS.md §7): which (artist, album) names to ask
// Last.fm for an Apple album, and the About text from a wiki summary. No DOM, no imports, so
// `tests/lastfm-names.test.ts` reads them as they are.

/** Apple's own release suffix (" - EP", " - Single"), which Spotify's scrobbles and most of
 *  Last.fm's listeners never carry (LISTENERS.md §7.0). */
const RELEASE_SUFFIX = /\s+-\s+(?:EP|Single)\s*$/i;

/** Where a second artist starts in an album artist: " & ", ", ", " x ", " feat. " / " ft. ",
 *  as Web Scrobbler's `removeAdditionalArtists` / `removeFeature` read it (his call,
 *  2026-10-13). */
const MORE_ARTISTS = /\s*,\s+|\s+(?:&|x|×|feat\.?|ft\.?|featuring)\s+/i;

export function stripReleaseSuffix(album: string): string {
  return album.replace(RELEASE_SUFFIX, "").trim();
}

/** The album artist's main name: the text before the first second artist. */
export function mainArtist(artist: string): string {
  const main = artist.split(MORE_ARTISTS)[0]?.trim();
  return main || artist.trim();
}

/**
 * The (artist, album) forms to ask Last.fm, in order (his call, 2026-10-13): Spotify's form
 * first (the main artist, no release suffix: where most scrobbles land), then Apple's exact
 * names. One form when the two are the same.
 */
export function albumForms(artist: string, album: string): Array<[string, string]> {
  const a = artist.trim();
  const b = album.trim();
  if (!a || !b) return [];
  const spotify: [string, string] = [mainArtist(a), stripReleaseSuffix(b) || b];
  const apple: [string, string] = [a, b];
  return spotify[0] === apple[0] && spotify[1] === apple[1] ? [apple] : [spotify, apple];
}

/** What Apple adds to a title that a scrobble may not carry: a featured artist, and the words of
 *  an edition. A remix, a live take or an edit is another recording, so its tag stays. */
const EDITION = String.raw`\b(?:remaster(?:ed)?|deluxe|bonus track|album version|anniversary|explicit)\b`;
const KEEP = String.raw`\b(?:remix|mix|live|edit)\b`;
const TITLE_EXTRA = new RegExp(
  String.raw`\s*[([](?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]` + // (feat. X)
    String.raw`|\s*[([](?![^)\]]*${KEEP})[^)\]]*${EDITION}[^)\]]*[)\]]` + // (Remastered 2011)
    String.raw`|\s+-\s+(?!.*${KEEP}).*${EDITION}.*$`, // - Remastered 2011
  "gi",
);

/** An (artist, title, autocorrect) form: `autocorrect` can move a title to a smaller page. */
export type SongForm = [string, string, boolean];

/**
 * The forms to ask Last.fm for a song. Rust asks each one and keeps the page with more plays
 * (LISTENERS.md §10.2). A plain name that differs from Apple's: the plain form with autocorrect
 * off (*Get Lucky* is 4.9M, 1.8M with it on), with it on, then Apple's names. Names that match:
 * one form. `exact`: Apple's names alone, with no correction.
 */
export function songForms(artist: string, title: string, exact = false): SongForm[] {
  const a = artist.trim();
  const b = title.trim();
  if (!a || !b) return [];
  if (exact) return [[a, b, false]];
  const main = mainArtist(a);
  const plain = b.replace(TITLE_EXTRA, "").trim() || b;
  return main === a && plain === b ? [[a, b, true]] : [[main, plain, false], [main, plain, true], [a, b, true]];
}

/** A row of `artist.getTopTracks` (LISTENERS.md §10.5). */
export interface TopTrack {
  name: string;
  playcount: number;
  listeners: number;
  url?: string;
}

/** A title as an artist's list matches it: the same words `songForms` cuts, in one spelling. */
export const titleKey = (title: string): string =>
  (title.replace(TITLE_EXTRA, "").trim() || title).normalize("NFC").toLowerCase().replace(/[’`]/g, "'").trim();

/** An artist's list by title. Last.fm counts each title text apart, so the largest row wins, as
 *  the largest of a song's forms does. */
export function topByTitle(rows: TopTrack[]): Map<string, TopTrack> {
  const top = new Map<string, TopTrack>();
  for (const row of rows) {
    const key = titleKey(row.name);
    const had = top.get(key);
    if (!had || row.playcount > had.playcount) top.set(key, row);
  }
  return top;
}

/** A count for a song row's pill (his form, 2026-11-05): 4976, 80.4k, 210.4k, 6M. Exact under
 *  10,000; above, one decimal with ".0" dropped. A count that rounds up takes the next unit. */
export function pillCount(n: number): string {
  const unit = (v: number, s: string) => `${Math.round(v * 10) / 10}${s}`;
  if (n >= 999_950_000) return unit(n / 1_000_000_000, "B");
  if (n >= 999_950) return unit(n / 1_000_000, "M");
  if (n >= 10_000) return unit(n / 1_000, "k");
  return String(n);
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'",
  // The named ones a Last.fm wiki uses beyond those (2026-10-17: `&eacute;` showed as text).
  ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»",
  copy: "©", reg: "®", trade: "™", deg: "°", middot: "·", bull: "•",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", agrave: "à", egrave: "è", ograve: "ò",
  acirc: "â", ecirc: "ê", ocirc: "ô", auml: "ä", euml: "ë", iuml: "ï", ouml: "ö", uuml: "ü", ntilde: "ñ", ccedil: "ç",
  aring: "å", oslash: "ø", szlig: "ß",
};

/** The entities a wiki or an Apple note uses, decoded (numbers and the common names). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith("#") && e !== "#39") return String.fromCodePoint(Number(e.slice(1)));
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** A wiki summary as plain text: Last.fm's "Read more on Last.fm" link and every tag
 *  removed, the common entities decoded, the spaces collapsed. */
export function wikiText(html: string): string {
  return decodeEntities(html.replace(/<a\b[^>]*>\s*Read more on Last\.fm\s*<\/a>\.?/gi, "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** The first `n` sentences of a wiki summary, as plain text (his call: two). A sentence ends
 *  at . ! or ? followed by a space and a capital, a digit or an opening quote; "" when the
 *  summary holds no words. */
export function wikiSentences(html: string, n = 2): string {
  const text = wikiText(html);
  if (!text) return "";
  const parts = text.split(/(?<=[.!?]["”’)]?)\s+(?=["“‘(]?[A-Z0-9])/);
  // A title or a short form ends with a period but not a sentence: "Dr. Dre", "Vol. 2",
  // "St. Louis" (2026-10-17, a test of the song facts box). Join it to the part after it.
  const sentences: string[] = [];
  for (const p of parts) {
    const last = sentences.length - 1;
    if (last >= 0 && ABBREV.test(sentences[last])) sentences[last] += ` ${p}`;
    else sentences.push(p);
  }
  return sentences.slice(0, n).join(" ").trim();
}
const ABBREV = /(?:^|[\s(“"])(?:Mr|Mrs|Ms|Dr|St|Mt|Jr|Sr|Vol|No|Op|Pt|feat|ft|vs|Prof|Rev|Gen|Lt|Col|Sgt|Capt|[A-Z])\.$/;

/** A wiki as a note for an About cell (LISTENERS.md §8.3): its plain text, or undefined when
 *  it holds no words. A stub page's summary is only the "Read more on Last.fm" link, which is
 *  not a note: the next step of the order fills the cell (2026-10-17). */
export const noteText = (html: string | undefined): string | undefined => (html ? wikiText(html) || undefined : undefined);
