// Filter rules — the pure core (docs/features/filter-rules.md). A filter rule is the rules
// engine's own condition (`Cond`, `evalCond`, his call F2) asked of EACH song in a pool:
// the Library's Filter button, and a Rulez Playlist made from sources at an interval.
// No DOM, no store, no clock of its own: tests/filter-eval.test.ts covers all of it.
// filters.ts is the live half (the reads, the store, the Live passes).

import type { Track } from "./library";
import { evalCond, factsOf, foldAccents, type Cond, type FactId, type Facts } from "./rules-eval";

// ── the shape (filter-rules.md §3) ──────────────────────────────

export type Window = "day" | "week" | "month" | "year" | "ytd";
/** Where a Rulez Playlist's songs come from (§5). The pool is their union, one row per song. */
export type SourceId =
  | "library" | "seen" | "history" | "loved" | "sotd" | "diary" | "pins"
  | `playlist:${string}` // a playlist's libraryId: `local:N`, or an Apple mirror's id (its cache only)
  | `rewind:${Window}`;

export type OrderBy =
  | "hand" // your order: songs stay where they are, new ones go at the end
  | "title" | "artist" | "album" | "year" | "length" | "added" | "plays" | "lastPlayed" | "diaryScore" | "listeners" | "random";
export interface Order {
  by: OrderBy;
  dir: "asc" | "desc";
}
export interface Limit {
  songs?: number;
  minutes?: number;
  perArtist?: number;
}

export interface FilterRule {
  id: string;
  name: string;
  if?: Cond;
  sources: SourceId[];
  order: Order;
  limit?: Limit;
}

/** `weekly:N`: N is the weekday, 0 = Sunday (Date.getDay). */
export type Refresh = "live" | "daily" | "off" | `weekly:${number}`;

/** One stored filter. With a `playlistId` it is a Rulez Playlist (his name, F1). */
export interface FilterRow {
  rule: FilterRule;
  playlistId: number | null;
  refresh: Refresh | null;
  /** Songs you added by hand: they stay whatever the rule says (F4). */
  keep: string[];
  /** Songs you removed: no pass adds them back (F4). */
  never: string[];
  /** One more on every hand edit and rule edit: a pass that started on an older one writes nothing (§13.1a). */
  version: number;
  /** When a pass last wrote the playlist (ms), for Daily and Weekly. */
  madeAt: number | null;
}

/** A song in a pool, with the facts the rule reads. */
export interface Song {
  key: string;
  track: Track;
  facts: Facts;
}

export const DEFAULT_ORDER: Order = { by: "hand", dir: "asc" };
/** A new Rulez Playlist starts on Live (his call, 2026-10-16). */
export const DEFAULT_REFRESH: Refresh = "live";

export function newRule(id: string, name = ""): FilterRule {
  return { id, name, sources: ["library"], order: { ...DEFAULT_ORDER } };
}

// ── the song's own facts ────────────────────────────────────────

/** The song's key: catalog first, the same rule as Rust's `track_key`. */
export const trackKey = (t: Pick<Track, "catalogId" | "libraryId">): string | undefined => t.catalogId ?? t.libraryId;

/** The facts a Track carries itself (§4). The rest come from the page (loved, Suggest Less)
 *  or from one Rust read (plays, the Diary, playlists …). */
export function trackFacts(t: Track): Facts {
  const f: Facts = {
    title: t.title,
    artist: t.artistName,
    albumArtist: t.albumArtist ?? t.artistName,
    genre: t.genres.filter((g) => g !== "Music"),
    explicit: t.contentRating === "explicit",
    lyrics: t.hasLyrics,
  };
  if (t.albumName) f.album = t.albumName;
  if (t.composer) f.composer = t.composer;
  const year = Number(t.releaseDate?.slice(0, 4));
  if (year) f.year = year;
  if (t.durationMs) f.length = Math.round(t.durationMs / 1000);
  if (t.addedRank !== undefined) f.addedRank = t.addedRank;
  return f;
}

/** Facts one Rust read gives (`filter_read`); the others are on the page. */
export const REMOTE_FACTS: ReadonlySet<FactId> = new Set<FactId>([
  "inLibrary", "addedDays", "plays", "finishes", "skips", "lastPlayedDays",
  "playsDay", "playsWeek", "playsMonth", "playsYear", "playsYtd",
  "minutesDay", "minutesWeek", "minutesMonth", "minutesYear", "minutesYtd",
  "diaryScore", "inDiary", "sotd", "inPlaylist", "pinned", "listeners",
]);
/** Facts a song may have no value for: the editor counts them (§13.4). */
export const MAY_BE_MISSING: ReadonlySet<FactId> = new Set<FactId>([
  "album", "composer", "year", "length", "addedRank", "addedDays", "lastPlayedDays", "diaryScore", "listeners",
]);

const ORDER_FACT: Partial<Record<OrderBy, FactId>> = {
  title: "title", artist: "artist", album: "album", year: "year", length: "length", added: "addedRank",
  plays: "plays", lastPlayed: "lastPlayedDays", diaryScore: "diaryScore", listeners: "listeners",
};

/** Every fact the rule reads: its condition and its order (a pass asks Rust only for these). */
export function readsOf(rule: Pick<FilterRule, "if" | "order" | "limit">): Set<FactId> {
  const out = factsOf(rule.if);
  const o = ORDER_FACT[rule.order.by];
  if (o) out.add(o);
  if (rule.limit?.perArtist) out.add("artist");
  if (rule.limit?.minutes) out.add("length");
  return out;
}
export const remoteOf = (rule: Pick<FilterRule, "if" | "order" | "limit">): FactId[] => [...readsOf(rule)].filter((f) => REMOTE_FACTS.has(f));

// ── the pass ────────────────────────────────────────────────────

/** FNV-1a: a stable number for a key and a seed (random order without a reshuffle per read). */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const cmpVal = (a: unknown, b: unknown): number => {
  // A song with no value goes last, in both directions.
  if (a === undefined || a === null) return b === undefined || b === null ? 0 : 1;
  if (b === undefined || b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return foldAccents(String(a)).localeCompare(foldAccents(String(b)));
};

export interface PickOpts {
  keep?: ReadonlySet<string>;
  never?: ReadonlySet<string>;
  /** The playlist's songs now, in order: "your order" keeps them, and a kept song comes from here. */
  current?: readonly Song[];
  /** The random order's seed: one per refresh, so a Live pass does not reshuffle (§3). */
  seed?: number;
}

/** The songs a rule picks from a pool, in order, within the limit. Keys only. */
export function pickSongs(pool: readonly Song[], rule: Pick<FilterRule, "if" | "order" | "limit">, o: PickOpts = {}): string[] {
  const keep = o.keep ?? new Set<string>();
  const never = o.never ?? new Set<string>();
  const seen = new Set<string>();
  const passing: Song[] = [];
  const consider = (s: Song) => {
    if (seen.has(s.key) || never.has(s.key)) return;
    seen.add(s.key);
    if (keep.has(s.key) || evalCond(rule.if, s.facts, { songs: true })) passing.push(s);
  };
  pool.forEach(consider);
  // A song you added by hand stays, even when no source holds it.
  o.current?.forEach((s) => keep.has(s.key) && consider(s));

  let ordered: Song[];
  const { by, dir } = rule.order;
  if (by === "hand") {
    const at = new Map((o.current ?? []).map((s, i) => [s.key, i]));
    const old = passing.filter((s) => at.has(s.key)).sort((a, b) => at.get(a.key)! - at.get(b.key)!);
    ordered = [...old, ...passing.filter((s) => !at.has(s.key))];
  } else if (by === "random") {
    const seed = String(o.seed ?? 0);
    ordered = [...passing].sort((a, b) => hash(a.key + seed) - hash(b.key + seed));
  } else {
    const fact = ORDER_FACT[by]!;
    const sign = dir === "desc" ? -1 : 1;
    ordered = [...passing].sort((a, b) => {
      const va = a.facts[fact];
      const vb = b.facts[fact];
      if (va === undefined || vb === undefined) return cmpVal(va, vb); // missing last either way
      return sign * cmpVal(va, vb) || cmpVal(a.facts.title, b.facts.title);
    });
  }

  const lim = rule.limit;
  if (!lim || (!lim.songs && !lim.minutes && !lim.perArtist)) return ordered.map((s) => s.key);
  const out: string[] = [];
  const perArtist = new Map<string, number>();
  let count = 0;
  let seconds = 0;
  for (const s of ordered) {
    // A kept song is always in, and does not count against the limit.
    if (keep.has(s.key)) {
      out.push(s.key);
      continue;
    }
    if (lim.songs && count >= lim.songs) continue;
    const len = typeof s.facts.length === "number" ? s.facts.length : 0;
    if (lim.minutes && seconds + len > lim.minutes * 60) continue;
    if (lim.perArtist) {
      const a = foldAccents(String(s.facts.artist ?? ""));
      const n = perArtist.get(a) ?? 0;
      if (n >= lim.perArtist) continue;
      perArtist.set(a, n + 1);
    }
    out.push(s.key);
    count++;
    seconds += len;
  }
  return out;
}

/** How many songs in the pool have no value for each fact the rule reads (§13.4). */
export function missingOf(pool: readonly Song[], rule: Pick<FilterRule, "if">): Map<FactId, number> {
  const out = new Map<FactId, number>();
  const facts = [...factsOf(rule.if)].filter((f) => MAY_BE_MISSING.has(f));
  for (const f of facts) out.set(f, pool.reduce((n, s) => n + (s.facts[f] === undefined ? 1 : 0), 0));
  return out;
}

// ── the clock (Daily, Weekly; the same arithmetic as the mirrors, PLAYLIST-REFRESH.md §4) ──

/** The most recent local midnight, in ms. */
export function lastMidnight(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
/** The most recent local midnight of `weekday` (0 = Sunday). Today counts when today IS that day. */
export function lastWeekdayMidnight(weekday: number, now = Date.now()): number {
  const d = new Date(lastMidnight(now));
  d.setDate(d.getDate() - ((d.getDay() - weekday + 7) % 7));
  return d.getTime();
}

/** Is a Daily or Weekly Rulez Playlist due a pass? Live runs on its facts' changes, not the clock. */
export function isDue(refresh: Refresh | null, madeAt: number | null, now = Date.now()): boolean {
  if (!refresh || refresh === "off" || refresh === "live") return false;
  if (madeAt == null) return true;
  if (refresh === "daily") return madeAt < lastMidnight(now);
  return madeAt < lastWeekdayMidnight(Number(refresh.slice(7)) || 0, now);
}

// ── loops: a Rulez Playlist that reads itself through another ──

/** True when `sources` would read playlist `self` again, through itself or a chain of Rulez Playlists. */
export function makesLoop(rows: readonly FilterRow[], self: number, sources: readonly SourceId[]): boolean {
  const byPlaylist = new Map(rows.filter((r) => r.playlistId != null).map((r) => [`playlist:local:${r.playlistId}`, r]));
  const seen = new Set<string>();
  const walk = (list: readonly SourceId[]): boolean => {
    for (const s of list) {
      if (s === `playlist:local:${self}`) return true;
      const r = byPlaylist.get(s);
      if (!r || seen.has(s)) continue;
      seen.add(s);
      if (walk(r.rule.sources)) return true;
    }
    return false;
  };
  return walk(sources);
}
