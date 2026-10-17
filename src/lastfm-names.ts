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

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'",
  // The named ones a Last.fm wiki uses beyond those (2026-10-17: `&eacute;` showed as text).
  ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»",
  copy: "©", reg: "®", trade: "™", deg: "°", middot: "·", bull: "•",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", agrave: "à", egrave: "è", ograve: "ò",
  acirc: "â", ecirc: "ê", ocirc: "ô", auml: "ä", euml: "ë", iuml: "ï", ouml: "ö", uuml: "ü", ntilde: "ñ", ccedil: "ç",
  aring: "å", oslash: "ø", szlig: "ß",
};

/** A wiki summary as plain text: Last.fm's "Read more on Last.fm" link and every tag
 *  removed, the common entities decoded, the spaces collapsed. */
export function wikiText(html: string): string {
  return html
    .replace(/<a\b[^>]*>\s*Read more on Last\.fm\s*<\/a>\.?/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (e.startsWith("#") && e !== "#39") return String.fromCodePoint(Number(e.slice(1)));
      return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
    })
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
