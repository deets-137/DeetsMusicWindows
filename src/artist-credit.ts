// Artist-credit parsing — consolidates the Library's derived Artists view.
//
// A library Track carries only Apple's flat credit STRING ("Drake & Future",
// "Doja Cat (feat. SZA)"), so grouping by exact string splits one artist into a
// tile per collaboration. Apple can't hand us clean identity cheaply either:
// /me/library/artists has the same per-credit-string fragmentation (probed
// 2026-07-03 — entries like "Alessia Cara & Julia Michaels"), and real catalog
// artist ids are the deferred post-v1 backfill (HANDOFF). So: parse the strings,
// zero Apple calls.
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

// Memoized per tracks-array identity — the track store keeps one stable array
// between syncs, so the parse runs once per library load, not per render.
const memo = new WeakMap<Track[], CreditIndex>();

export function creditIndex(tracks: Track[]): CreditIndex {
  const hit = memo.get(tracks);
  if (hit) return hit;

  const vocab = new Set<string>();
  for (const t of tracks) {
    const s = splitFeat(t.artistName ?? "");
    if (s.core && !HAS_SEP.test(s.core)) vocab.add(s.core);
    // A single-name feat guest is unambiguous; a compound clause is NOT split into
    // vocab (a "feat. Earth, Wind & Fire" must not poison it with "Earth").
    if (s.guests.length === 1) vocab.add(s.guests[0]);
  }

  const names = new Map<Track, string[]>();
  const byArtist = new Map<string, Track[]>();
  for (const t of tracks) {
    const ns = creditArtists(t.artistName ?? "", vocab);
    names.set(t, ns);
    for (const nm of ns) {
      let list = byArtist.get(nm);
      if (!list) byArtist.set(nm, (list = []));
      list.push(t);
    }
  }

  const idx: CreditIndex = {
    namesOf: (t) => names.get(t) ?? creditArtists(t.artistName ?? "", vocab),
    tracksFor: (name) => byArtist.get(name) ?? [],
  };
  memo.set(tracks, idx);
  return idx;
}
