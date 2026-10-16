// Artist-credit parsing — consolidates the Library's derived Artists view.
//
// A library Track carries only Apple's flat credit STRING ("Drake & Future",
// "Doja Cat (feat. SZA)"), so grouping by exact string splits one artist into a
// tile per collaboration. Apple can't hand us clean identity cheaply either:
// /me/library/artists has the same per-credit-string fragmentation (probed
// 2026-07-03 — entries like "Alessia Cara & Julia Michaels"), and real catalog
// artist ids are the deferred post-v1 backfill (HANDOFF). So: parse the strings,
// zero Apple calls. Since 2026-10-15 a song's PRIMARY artist is Apple's own answer
// (primary-artist.ts): it seeds the vocabulary and leads the song's names; the parse
// still finds the guests.
//
// The trick is a self-built VOCABULARY: a name that ever appears as a complete,
// separator-free credit somewhere in the library ("Drake", "BETWEEN FRIENDS") is
// proven to stand alone. Compound credits split only against that vocabulary —
// which is what keeps "Earth, Wind & Fire" whole (never appears as "Earth") while
// "Drake & Future" splits (both known singletons). feat./ft. clauses are always
// safe to strip.
//
// Placement is MULTI-INDEX (user's call, 2026-07-03): a collab song appears under
// every credited artist the vocabulary knows, so an artist's tile collects
// everything they appear on. One-off guests with no solo presence don't spawn
// tiles — except the LEADING credit, which always gets a home (that's what keeps
// "Tyler, The Creator" one artist inside "Tyler, The Creator & Kali Uchis").
// Primary-only placement is a future toggle (FUTURE-SETTINGS).

import type { Track } from "./library";

// Credit-string separators, as Apple writes them. " x " / " and " are deliberately
// out: too many band names contain them and Apple's credit strings don't use them.
const SEP = /(, | & )/;
const HAS_SEP = /, | & /;

// A trailing feat-clause, parenthesized or bare. Longest alternative first so
// "featuring" isn't half-eaten by "feat".
const FEAT_PAREN = /\s*[([](?:featuring|feat\.?|ft\.?)\s+([^)\]]*)[)\]]\s*/i;
const FEAT_BARE = /\s+(?:featuring|feat\.?|ft\.?)\s+(.+)$/i;

/** Split a credit into its core ("Drake & Future") and feat-clause guests. */
export function splitFeat(credit: string): { core: string; guests: string[] } {
  let core = credit;
  let clause = "";
  const paren = FEAT_PAREN.exec(core);
  if (paren) {
    clause = paren[1];
    core = (core.slice(0, paren.index) + core.slice(paren.index + paren[0].length)).trim();
  } else {
    const bare = FEAT_BARE.exec(core);
    if (bare) {
      clause = bare[1];
      core = core.slice(0, bare.index).trim();
    }
  }
  const guests = clause
    .split(SEP)
    .filter((_, i) => i % 2 === 0)
    .map((s) => s.trim())
    .filter(Boolean);
  return { core, guests };
}

/**
 * The artists a credit string resolves to, given the library vocabulary.
 * Greedy longest-run matching over the core's segments; contiguous unmatched
 * segments rejoin (with their original separators) into remainder chunks, of
 * which only the LEADING one becomes an artist. No matches at all → the whole
 * core stays one artist. Vocabulary-known feat guests ride along.
 */
export function creditArtists(credit: string, vocab: Set<string>): string[] {
  const { core, guests } = splitFeat(credit);
  const out = new Set<string>();

  if (!HAS_SEP.test(core)) {
    if (core || !guests.length) out.add(core);
  } else {
    // split-with-capture: segments at even indices, separators at odd ones
    const parts = core.split(SEP);
    const n = (parts.length + 1) / 2;
    const joined = (i: number, j: number) => parts.slice(2 * i, 2 * j + 1).join("");

    const matched: string[] = [];
    let leadRemainder = "";
    let runStart = -1;
    const closeRun = (end: number) => {
      if (runStart === 0) leadRemainder = joined(0, end); // non-leading remainders drop
      runStart = -1;
    };
    let i = 0;
    while (i < n) {
      let hit = -1;
      for (let j = n - 1; j >= i; j--) if (vocab.has(joined(i, j))) { hit = j; break; }
      if (hit >= 0) {
        if (runStart >= 0) closeRun(i - 1);
        matched.push(joined(i, hit));
        i = hit + 1;
      } else {
        if (runStart < 0) runStart = i;
        i++;
      }
    }
    if (runStart >= 0) closeRun(n - 1);

    if (!matched.length) out.add(core); // nothing known → one whole-name artist
    else {
      if (leadRemainder) out.add(leadRemainder);
      for (const m of matched) out.add(m);
    }
  }

  for (const g of guests) if (vocab.has(g)) out.add(g);
  return [...out];
}

export interface CreditIndex {
  namesOf(t: Track): string[];
  tracksFor(name: string): Track[];
}

/** A song's primary artist name, from Apple (primary-artist.ts registers it). `version`
 *  changes when its answers change, so the memo below rebuilds. */
export interface PrimaryLookup {
  version(): number;
  nameOf(t: Track): string | undefined;
}
let primary: PrimaryLookup = { version: () => 0, nameOf: () => undefined };
export function usePrimaryLookup(lookup: PrimaryLookup): void {
  primary = lookup;
}

/**
 * A song's artists with its primary artist first (ideas/apple-calls.md §5). The parse names
 * the primary already when the vocabulary holds it: it moves to the front. When the parse
 * spells it another way (or not at all), the primary takes the LEADING name's place, which is
 * the primary in Apple's credit order, so one artist never gets two tiles.
 */
export function withPrimary(parsed: string[], primaryName: string | undefined): string[] {
  if (!primaryName) return parsed;
  if (parsed.includes(primaryName)) return [primaryName, ...parsed.filter((n) => n !== primaryName)];
  return [primaryName, ...parsed.slice(1)];
}

/** One name in a song's *Go to Artist ▸* list. */
export interface GoToPerson {
  name: string;
  /** The catalog artist id, when Apple named this artist (the Search way opens it). */
  id?: string;
  /** The Library holds songs under this name (the Library way). */
  inLibrary: boolean;
  /** The song's first artist: the song → artist hop in Search resolves to this one. */
  lead: boolean;
}

/**
 * The people of a song's *Go to Artist ▸* (ideas/apple-calls.md §5.4, P2): the library
 * names first (the primary leads), each with its catalog id when Apple named it too, then
 * Apple's guests the parse does not know, in Apple's order. With no library names (a catalog
 * song), Apple's list alone, the primary first. Names match case-blind.
 */
export function goToPeople(
  names: string[],
  catalog: { id: string; name: string }[] | undefined,
  inLibrary: (name: string) => boolean,
): GoToPerson[] {
  const key = (s: string) => s.trim().toLowerCase();
  const cat = catalog ?? [];
  const byName = new Map(cat.map((a) => [key(a.name), a]));
  const out: GoToPerson[] = names.map((n, i) => ({ name: n, id: byName.get(key(n))?.id, inLibrary: inLibrary(n), lead: i === 0 }));
  const seen = new Set(names.map(key));
  for (const a of cat) {
    if (seen.has(key(a.name))) continue;
    seen.add(key(a.name));
    out.push({ name: a.name, id: a.id, inLibrary: inLibrary(a.name), lead: out.length === 0 });
  }
  return out;
}

// Memoized per tracks-array identity — the track store keeps one stable array
// between syncs, so the parse runs once per library load, not per render — and per
// primary-map version (the artist pass may land after the songs).
const memo = new WeakMap<Track[], { v: number; idx: CreditIndex }>();

export function creditIndex(tracks: Track[]): CreditIndex {
  const v = primary.version();
  const hit = memo.get(tracks);
  if (hit && hit.v === v) return hit.idx;

  const vocab = new Set<string>();
  for (const t of tracks) {
    const s = splitFeat(t.artistName ?? "");
    if (s.core && !HAS_SEP.test(s.core)) vocab.add(s.core);
    // A single-name feat guest is unambiguous; a compound clause is NOT split into
    // vocab (a "feat. Earth, Wind & Fire" must not poison it with "Earth").
    if (s.guests.length === 1) vocab.add(s.guests[0]);
    // Apple's primary artist stands alone by definition, comma or not: "Girl Ultra & Chromeo"
    // splits under Girl Ultra with no solo song by her in the library (§5.3).
    const p = primary.nameOf(t);
    if (p) vocab.add(p);
  }

  const names = new Map<Track, string[]>();
  const byArtist = new Map<string, Track[]>();
  for (const t of tracks) {
    const ns = withPrimary(creditArtists(t.artistName ?? "", vocab), primary.nameOf(t));
    names.set(t, ns);
    for (const nm of ns) {
      let list = byArtist.get(nm);
      if (!list) byArtist.set(nm, (list = []));
      list.push(t);
    }
  }

  const idx: CreditIndex = {
    namesOf: (t) => names.get(t) ?? withPrimary(creditArtists(t.artistName ?? "", vocab), primary.nameOf(t)),
    tracksFor: (name) => byArtist.get(name) ?? [],
  };
  memo.set(tracks, { v, idx });
  return idx;
}
