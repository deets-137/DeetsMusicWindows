// Home data layer (HOME.md) — the three shelves, built from what is already on this
// machine: the play log is SQLite (`play_events_since`), the track metadata is the shared
// store, the playlists are the cached unified list, and the stations are the Radio card's
// local recents. The ONE exception is an artist photo Apple has never been asked for —
// one call per artist, once ever, saved in `artist_catalog` (see fillArtistPhotos).
//
// One pass of the log feeds all three shelves:
//   Recently Played  — the log walked newest-first, consecutive plays that share a
//                      `context` collapsed into ONE container tile (playlist / album /
//                      station / artist); a bare context stays one tile per song.
//   Recently Added   — songs + albums by `addedRank`, playlists by their `dateAdded`,
//                      interleaved round-robin. No dates are printed: Apple sends no
//                      per-song dateAdded, so we know the ORDER, never the day.
//   <bucket>         — the songs and lists this hour of this kind of day usually holds
//                      (weekday/weekend x four parts of the day), decayed by age.
//
// Hiding (HOME.md §4): a right-click hides a tile; the shelf refills from the next
// candidate at once. A hide is a hide, never a dislike — it is not fed back into the
// score. Playing an item again clears its own hide.

import { invoke } from "@tauri-apps/api/core";
import type { Artwork, Track } from "./library";
import { tracks as allTracks, trackById } from "./track-store";
import { playlistsCached, playlistTracks } from "./playlists";
import type { Playlist } from "./search";
import { radioRecents, type Station } from "./radio";
import { albumKey, pid, playEventsSince, type PlayEvent } from "./rewind";
import { setting, setSetting } from "./settings-store";

// ── the windows ───────────────────────────────────────────────────────────────
const DAY_MS = 86_400_000;
/** How far back Recently Played looks. */
const PLAYED_DAYS = 60;
/** How far back the bucket score looks — the one log read covers both. */
const SCORE_DAYS = 180;
/** Age at which a play counts half as much in the score. */
const HALF_LIFE_DAYS = 42;
/** Tiles per shelf. The shelf scrolls sideways, so width is no limit (his call,
 *  2026-09-15). Candidates are built deeper still, so a hide refills at once. */
export const SHELF = 12;
/** The bucket shelf stays hidden under this many scored items (the cold start). */
const SCORE_MIN = 5;
/** A song is dropped from the bucket shelf when this much of it came from a list
 *  that is already on the shelf (container suppression). */
const FROM_CONTAINER = 0.6;
/** Artist photos fetched per rebuild — the only Apple calls Home ever makes, one per
 *  artist, once ever (the answer is saved in `artist_catalog`). */
const ARTIST_FETCH_MAX = 4;

// ── one tile ──────────────────────────────────────────────────────────────────
export type HomeKind = "song" | "album" | "playlist" | "station" | "artist";

export interface HomeItem {
  /** Stable identity, and the hide key: "song:<trackId>", "album:<albumKey>",
   *  "playlist:<pid>", "station:<id>", "artist:<name>". */
  key: string;
  kind: HomeKind;
  title: string;
  sub: string;
  art?: Artwork;
  /** An artist tile wears a round thumb, as it does everywhere else. */
  round?: boolean;
  /** A playlist with no artwork of its own draws the derived mosaic. */
  mosaic?: string[];
  mosaicSeed?: string;
  /** The queue-origin tag for anything played from this tile. */
  context: string;
  playlist?: Playlist;
  station?: Station;
  /** The songs this tile plays. Async only for a playlist (its content cache). */
  tracks: () => Track[] | Promise<Track[]>;
  /** Songs in the tile, when known without a fetch (the drag ghost). */
  count?: number;
}

export interface HomeShelf {
  label: string;
  items: HomeItem[];
}

// ── hiding ────────────────────────────────────────────────────────────────────
// "Forever" keeps the map in the settings store; "This session" keeps it in memory
// only (the stored map is left alone, so switching back restores it).
let sessionHidden: Record<string, number> = {};
const sessionScope = (): boolean => setting("homeHideLasts") === "session";
const hiddenMap = (): Record<string, number> => (sessionScope() ? sessionHidden : setting("homeHidden"));
const writeHidden = (m: Record<string, number>): void => {
  if (sessionScope()) sessionHidden = m;
  else setSetting("homeHidden", m);
};

/** Hide one tile. Returns an undo for the toast's button. */
export function hideItem(key: string): () => void {
  writeHidden({ ...hiddenMap(), [key]: Date.now() });
  return () => unhideItem(key);
}

export function unhideItem(key: string): void {
  const m = { ...hiddenMap() };
  if (!(key in m)) return;
  delete m[key];
  writeHidden(m);
}

export const hiddenCount = (): number => Object.keys(hiddenMap()).length;

export function clearHidden(): void {
  writeHidden({});
}

// ── the bucket (fork A1) ──────────────────────────────────────────────────────
type Part = "morning" | "afternoon" | "evening" | "night";
const partOf = (h: number): Part => (h < 5 ? "night" : h < 11 ? "morning" : h < 17 ? "afternoon" : h < 22 ? "evening" : "night");

/** Weekday/weekend x part of day: the densest rule that still says something true.
 *  Eight buckets fill in weeks; twenty-eight (one per weekday) would take months. */
export function bucketOf(ts: number): string {
  const d = new Date(ts);
  const day = d.getDay();
  return `${day === 0 || day === 6 ? "Weekend" : "Weekday"} ${partOf(d.getHours())}`;
}

/** The shelf's own label — the bucket it is showing, not a claim about the future. */
export const bucketLabel = (ts = Date.now()): string => bucketOf(ts);

// ── context tags → a container ────────────────────────────────────────────────
type Container =
  | { kind: "playlist"; key: string; p: Playlist }
  | { kind: "album"; key: string }
  | { kind: "station"; key: string; s: Station }
  | { kind: "artist"; key: string; name: string };

/** What a `play_events.context` tag names, or null when it names no container (the
 *  bare tags — "library", "search", "history", "rewind" — and anything whose target
 *  is gone: a deleted playlist, a station no longer in recents). `sample` is a track
 *  from the same run, which supplies an album's identity. */
function containerOf(context: string | null, sample: Track | undefined, playlists: Map<string, Playlist>): Container | null {
  if (!context) return null;
  const at = context.indexOf(":");
  const head = at < 0 ? context : context.slice(0, at);
  const rest = at < 0 ? "" : context.slice(at + 1);
  switch (head) {
    case "playlist": {
      const p = playlists.get(rest);
      return p ? { kind: "playlist", key: `playlist:${rest}`, p } : null;
    }
    case "album":
      return { kind: "album", key: `album:${rest}` };
    // A catalog album opened in Search carries its own tag; the album it played is
    // the one its songs belong to.
    case "search-albums":
      return sample ? { kind: "album", key: `album:${albumKey(sample)}` } : null;
    case "artist":
      return rest ? { kind: "artist", key: `artist:${rest}`, name: rest } : null;
    case "station": {
      const s = radioRecents().find((x) => x.id === rest);
      return s ? { kind: "station", key: `station:${s.id}`, s } : null;
    }
    default:
      return null;
  }
}

// ── tiles ─────────────────────────────────────────────────────────────────────
const songItem = (t: Track): HomeItem => ({
  key: `song:${t.catalogId ?? t.libraryId ?? t.title}`,
  kind: "song",
  title: t.title,
  sub: t.artistName,
  art: t.artwork,
  context: "home",
  tracks: () => [t],
  count: 1,
});

const byTrackOrder = (ts: Track[]): Track[] =>
  [...ts].sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0));

/** An album tile. Its songs come from the library where they are there (the whole
 *  album, in disc/track order); `fallback` covers a catalog album played from Search. */
function albumItem(key: string, fallback: Track[]): HomeItem | null {
  const mine = allTracks().filter((t) => albumKey(t) === key);
  const list = mine.length ? byTrackOrder(mine) : byTrackOrder(fallback);
  const head = list[0];
  if (!head) return null;
  return {
    key: `album:${key}`,
    kind: "album",
    title: head.albumName ?? "Album",
    sub: head.artistName,
    art: head.artwork,
    context: `album:${key}`,
    tracks: () => list,
    count: list.length,
  };
}

function playlistItem(p: Playlist): HomeItem {
  return {
    key: `playlist:${pid(p)}`,
    kind: "playlist",
    title: p.name,
    sub: p.trackCount != null ? `${p.trackCount} song${p.trackCount === 1 ? "" : "s"}` : (p.curatorName ?? "Playlist"),
    art: p.artwork,
    mosaic: p.artwork ? undefined : p.coverUrls,
    mosaicSeed: p.libraryId ?? p.name,
    context: `playlist:${pid(p)}`,
    playlist: p,
    tracks: () => playlistTracks(p),
    count: p.trackCount,
  };
}

const stationItem = (s: Station): HomeItem => ({
  key: `station:${s.id}`,
  kind: "station",
  title: s.name,
  sub: s.tagline ?? (s.isLive ? "Apple Music live radio" : "Apple Music station"),
  art: s.artwork,
  context: `station:${s.id}`,
  station: s,
  tracks: () => [],
});

// Artist photos. The cached ones (`artist_catalog`, filled by the Library artist view)
// come free with `artist_photos`. An artist with no row costs ONE Apple call, once, the
// first time they reach a shelf — `library_artist_info` with `featured: false`, which
// resolves the id and the photo from one of their songs and saves both (his call,
// 2026-09-15). Until it lands, the tile borrows one of that artist's album covers.
let photos = new Map<string, Artwork>();
/** Names already asked about this session — including the ones Apple has no photo for,
 *  so a missing photo is asked about once, not on every rebuild. */
const askedFor = new Set<string>();

/** Fetch the photos an artist shelf tile is missing. Resolves true when at least one
 *  arrived, which is the card's cue to draw again. Never more than `ARTIST_FETCH_MAX`
 *  calls per rebuild, so a shelf of new artists cannot burst. */
export async function fillArtistPhotos(items: HomeItem[]): Promise<boolean> {
  const missing = items
    .filter((i) => i.kind === "artist" && !photos.has(i.title) && !askedFor.has(i.title))
    .slice(0, ARTIST_FETCH_MAX);
  if (!missing.length) return false;
  let got = false;
  await Promise.all(
    missing.map(async (i) => {
      askedFor.add(i.title);
      try {
        const list = i.tracks();
        const ids = (Array.isArray(list) ? list : []).map((t) => t.catalogId);
        const info = await invoke<{ artwork?: Artwork } | null>("library_artist_info", {
          name: i.title,
          songId: ids.find(Boolean) ?? null,
          featured: false,
        });
        if (info?.artwork) {
          photos.set(i.title, info.artwork);
          got = true;
        }
      } catch (e) {
        askedFor.delete(i.title); // a failed call may be tried again later
        console.warn("[home] artist photo", i.title, e);
      }
    }),
  );
  return got;
}

/** An artist tile plays that artist's library songs, albums oldest first. */
function artistItem(name: string): HomeItem | null {
  const mine = allTracks().filter((t) => t.artistName === name);
  if (!mine.length) return null;
  const list = [...mine].sort(
    (a, b) =>
      (a.releaseDate ?? "").localeCompare(b.releaseDate ?? "") ||
      (a.albumName ?? "").localeCompare(b.albumName ?? "") ||
      (a.discNumber ?? 1) - (b.discNumber ?? 1) ||
      (a.trackNumber ?? 0) - (b.trackNumber ?? 0),
  );
  return {
    key: `artist:${name}`,
    kind: "artist",
    title: name,
    sub: `${list.length} song${list.length === 1 ? "" : "s"}`,
    art: photos.get(name) ?? list[0].artwork,
    round: true,
    context: `artist:${name}`,
    tracks: () => list,
    count: list.length,
  };
}

function itemOf(c: Container, fallback: Track[]): HomeItem | null {
  switch (c.kind) {
    case "playlist": return playlistItem(c.p);
    case "album": return albumItem(c.key.slice("album:".length), fallback);
    case "station": return stationItem(c.s);
    case "artist": return artistItem(c.name);
  }
}

// ── runs ──────────────────────────────────────────────────────────────────────
interface Run {
  context: string | null;
  events: PlayEvent[];
}

/** Consecutive events that share a context, oldest run first. */
function runsOf(events: PlayEvent[]): Run[] {
  const out: Run[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && last.context === e.context) last.events.push(e);
    else out.push({ context: e.context, events: [e] });
  }
  return out;
}

// ── shelf 1: Recently Played ──────────────────────────────────────────────────
function playedShelf(events: PlayEvent[], playlists: Map<string, Playlist>, want: number): HomeItem[] {
  const out: HomeItem[] = [];
  const seen = new Set<string>();
  const push = (it: HomeItem | null) => {
    if (!it || seen.has(it.key)) return;
    seen.add(it.key);
    out.push(it);
  };
  const runs = runsOf(events).reverse(); // newest run first
  for (const run of runs) {
    if (out.length >= want) break;
    const resolved = run.events.map((e) => trackById(e.trackId)).filter((t): t is Track => !!t);
    const c = containerOf(run.context, resolved[0], playlists);
    // C2: any run of one or more earns its container tile. A container we cannot
    // resolve (deleted playlist, forgotten station) falls back to its songs.
    const tile = c ? itemOf(c, resolved) : null;
    if (tile) push(tile);
    else for (const t of [...resolved].reverse()) push(songItem(t));
  }
  return out;
}

// ── shelf 2: Recently Added ───────────────────────────────────────────────────
/** Newness within a kind. `addedAt` (this app's own stamp) beats a rank, because a
 *  song added here has no rank until the next library sync. */
const newness = (t: Track, addedAt: Map<string, number>): number => {
  const stamp = addedAt.get(t.catalogId ?? "") ?? addedAt.get(t.libraryId ?? "");
  return stamp != null ? stamp : (t.addedRank ?? -1);
};

function addedShelf(playlists: Playlist[], addedAt: Map<string, number>, want: number): HomeItem[] {
  const lib = allTracks();
  const songs = [...lib]
    .filter((t) => newness(t, addedAt) >= 0)
    .sort((a, b) => newness(b, addedAt) - newness(a, addedAt))
    .slice(0, want * 2);

  // An album is as new as its newest track. A group of ONE track is not an album — a
  // single song added on its own belongs in the song lane, not as an album tile of one.
  const albums = new Map<string, { at: number; n: number }>();
  for (const t of lib) {
    const at = newness(t, addedAt);
    const k = albumKey(t);
    const g = albums.get(k) ?? { at: -1, n: 0 };
    albums.set(k, { at: Math.max(g.at, at), n: g.n + 1 });
  }
  const albumKeys = [...albums.entries()]
    .filter(([, g]) => g.n > 1 && g.at >= 0)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, want * 2)
    .map(([k]) => k);

  const lists = [...playlists]
    .filter((p) => p.dateAdded)
    .sort((a, b) => Date.parse(b.dateAdded ?? "") - Date.parse(a.dateAdded ?? ""))
    .slice(0, want * 2);

  // A song whose album is on this same shelf would say the same thing twice (you add an
  // album, and its songs are the newest songs). The albums are decided FIRST, so the rule
  // holds wherever the song lands in the round-robin.
  // The lanes are disjoint by construction: an album tile covers every song in it, so
  // the song lane holds only what has no album tile (a single added song, an upload).
  const onShelf = new Set(albumKeys);
  const solo = songs.filter((t) => !onShelf.has(albumKey(t)));

  // Round-robin, songs leading: every tile is recent within its own kind, and the
  // shelf never claims an order across kinds that we cannot know (A1).
  const out: HomeItem[] = [];
  const shown = new Set<string>();
  const take = (it: HomeItem | null) => {
    if (!it || shown.has(it.key)) return;
    shown.add(it.key);
    out.push(it);
  };
  for (let i = 0; out.length < want && i < want * 2; i++) {
    if (solo[i]) take(songItem(solo[i]));
    if (albumKeys[i]) take(albumItem(albumKeys[i], []));
    if (lists[i]) take(playlistItem(lists[i]));
  }
  return out.slice(0, want);
}

// ── shelf 3: the bucket ───────────────────────────────────────────────────────
interface Score {
  ms: number;
  plays: number;
}
const bump = (m: Map<string, Score>, key: string, ms: number, w: number): void => {
  const s = m.get(key) ?? { ms: 0, plays: 0 };
  s.ms += ms * w;
  s.plays += w;
  m.set(key, s);
};
const rank = (m: Map<string, Score>): [string, Score][] =>
  [...m.entries()].sort((a, b) => b[1].ms - a[1].ms || b[1].plays - a[1].plays);

function bucketShelf(events: PlayEvent[], playlists: Map<string, Playlist>, want: number): HomeItem[] {
  const now = Date.now();
  const here = bucketOf(now);
  const songScore = new Map<string, Score>();
  const boxScore = new Map<string, Score>();
  const boxOf = new Map<string, Container>();
  const boxSample = new Map<string, Track[]>();
  // How much of a song came from each container — the suppression evidence.
  const songFrom = new Map<string, Map<string, number>>();
  const songTrack = new Map<string, Track>();
  let scored = 0;

  for (const e of events) {
    if (bucketOf(e.startedTs) !== here) continue;
    const t = trackById(e.trackId);
    if (!t) continue;
    const w = Math.pow(0.5, (now - e.startedTs) / (HALF_LIFE_DAYS * DAY_MS));
    const ms = e.msListened ?? 0;
    const sKey = `song:${t.catalogId ?? t.libraryId ?? t.title}`;
    bump(songScore, sKey, ms, w);
    songTrack.set(sKey, t);
    scored++;
    const c = containerOf(e.context, t, playlists);
    if (!c) continue;
    bump(boxScore, c.key, ms, w);
    boxOf.set(c.key, c);
    const sample = boxSample.get(c.key) ?? [];
    if (sample.length < 40) sample.push(t);
    boxSample.set(c.key, sample);
    const from = songFrom.get(sKey) ?? new Map<string, number>();
    from.set(c.key, (from.get(c.key) ?? 0) + w);
    songFrom.set(sKey, from);
  }
  if (!scored) return [];

  // Containers take at most half the shelf (D1), so one heavy playlist cannot fill it.
  const out: HomeItem[] = [];
  const chosen = new Set<string>();
  for (const [key] of rank(boxScore)) {
    if (out.length >= Math.floor(want / 2)) break;
    const c = boxOf.get(key);
    const tile = c ? itemOf(c, boxSample.get(key) ?? []) : null;
    if (!tile) continue;
    chosen.add(key);
    out.push(tile);
  }
  // Songs fill the rest — minus any whose plays here came mostly from a container
  // already on the shelf. A song you also play on its own keeps its tile.
  for (const [key, s] of rank(songScore)) {
    if (out.length >= want) break;
    const from = songFrom.get(key);
    if (from) {
      const inBox = [...from.entries()].filter(([k]) => chosen.has(k)).reduce((a, [, v]) => a + v, 0);
      if (s.plays > 0 && inBox / s.plays > FROM_CONTAINER) continue;
    }
    const t = songTrack.get(key);
    if (t) out.push(songItem(t));
  }
  return out;
}

// ── the card's one entry point ────────────────────────────────────────────────
const addedAtMap = (): Promise<[string, number][]> => invoke<[string, number][]>("added_at_map");
const artistPhotos = (): Promise<[string, Artwork][]> => invoke<[string, Artwork][]>("artist_photos");

/** Every shelf, ready to render. One SQLite read for the log, one for the add stamps,
 *  one cached playlist list. No Apple call, ever. An empty shelf is left out. */
export async function homeShelves(): Promise<HomeShelf[]> {
  const [events, lists, stamps, faces] = await Promise.all([
    playEventsSince(Date.now() - SCORE_DAYS * DAY_MS),
    playlistsCached(),
    addedAtMap().catch(() => [] as [string, number][]),
    artistPhotos().catch(() => [] as [string, Artwork][]),
  ]);
  // Keep anything fetched this session that the cached read does not carry yet.
  photos = new Map([...faces, ...photos]);
  const playlists = new Map(lists.map((p) => [pid(p), p]));
  const addedAt = new Map(stamps);

  // A play is a stronger signal than a hide: an item played since it was hidden
  // comes back (E3). The log is the record, so no player hook is needed.
  const hidden = hiddenMap();
  if (Object.keys(hidden).length) {
    const lastPlay = new Map<string, number>();
    const note = (key: string, ts: number) => {
      if (ts > (lastPlay.get(key) ?? 0)) lastPlay.set(key, ts);
    };
    for (const e of events) {
      const t = trackById(e.trackId);
      if (t) note(`song:${t.catalogId ?? t.libraryId ?? t.title}`, e.startedTs);
      const c = containerOf(e.context, t, playlists);
      if (c) note(c.key, e.startedTs);
    }
    for (const [key, at] of Object.entries(hidden)) if ((lastPlay.get(key) ?? 0) > at) unhideItem(key);
  }

  const keep = (items: HomeItem[]): HomeItem[] => {
    const h = hiddenMap();
    return items.filter((i) => !(i.key in h)).slice(0, SHELF);
  };

  const playedFrom = Date.now() - PLAYED_DAYS * DAY_MS;
  const deep = SHELF * 3; // candidates, so a hide refills at once
  const played = keep(playedShelf(events.filter((e) => e.startedTs >= playedFrom), playlists, deep));
  const added = keep(addedShelf(lists, addedAt, deep));
  const bucket = bucketShelf(events, playlists, deep);
  // The cold start (fork 3): the bucket shelf stays away until it has something to say.
  const scored = bucket.length >= SCORE_MIN ? keep(bucket) : [];

  const shelves: HomeShelf[] = [];
  if (played.length) shelves.push({ label: "Recently Played", items: played });
  if (added.length) shelves.push({ label: "Recently Added", items: added });
  if (scored.length) shelves.push({ label: bucketLabel(), items: scored });
  return shelves;
}
