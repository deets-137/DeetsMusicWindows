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

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** A wiki summary as plain text: Last.fm's "Read more on Last.fm" link and every tag
 *  removed, the common entities decoded, the spaces collapsed. */
export function wikiText(html: string): string {
  return html
    .replace(/<a\b[^>]*>\s*Read more on Last\.fm\s*<\/a>\.?/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (e.startsWith("#") && e !== "#39") return String.fromCodePoint(Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? m;
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
  return parts.slice(0, n).join(" ").trim();
}
