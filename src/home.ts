// Home data layer (HOME.md) — the three shelves, built from what is already on this
// machine: the play log is SQLite (`play_events_since`), the track metadata is the shared
// store, the playlists are the cached unified list, and the stations are the Radio card's
// local recents. Apple is asked three things and no more: an artist photo never asked for
// before (one per artist, once ever, saved in `artist_catalog` — see fillArtistPhotos),
// and the two recents lists that carry what you played and added on your OTHER devices
// (HOME.md §9). The recents calls are floored, fail softly, and never write a play.
//
// One pass of the log feeds all three shelves:
//   Recently Played  — the log walked newest-first, consecutive plays that share a
//                      `context` collapsed into ONE container tile (playlist / album /
//                      station / artist); a bare context stays one tile per song.
//   Recently Added   — Apple's own `recently-added` list, which groups the songs into
//                      albums and stamps each row with a REAL date. No dates are printed:
//                      they order the shelf and stay out of sight. With no answer from
//                      Apple it falls back to `addedRank` + a round-robin by kind.
//   <bucket>         — the songs and lists this hour of this kind of day usually holds
//                      (weekday/weekend x four parts of the day), decayed by age.
//
// Hiding (HOME.md §4): a right-click hides a tile; the shelf refills from the next
// candidate at once. A hide is a hide, never a dislike — it is not fed back into the
// score. Playing an item again clears its own hide.

import { invoke } from "@tauri-apps/api/core";
import type { Artwork, Track } from "./library";
import { tracks as allTracks, trackById, addTransientTracks } from "./track-store";
import { playlistsCached, playlistTracks } from "./playlists";
import { collectionTracks, catalogRelated, materializeTrack, type Album, type Playlist } from "./search";
import { radioRecents, type Station } from "./radio";
import { playCounts } from "./artist-view";
import { albumKey, pid, playEventsSince, type PlayEvent } from "./rewind";
import { setting, setSetting } from "./settings-store";
import { trouble } from "./apple-health";
import { isConnected } from "./apple";
import { pinnedItems, pinsOf, pinPlayCounts } from "./pins";
import { sotdOn, pickTiles, suggestionTile } from "./sotd";

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
/** Artist photos fetched per rebuild — one per artist, once ever (the answer is saved
 *  in `artist_catalog`). */
const ARTIST_FETCH_MAX = 4;
/** How long Apple's two recents lists stay good. The card rebuilds on every song
 *  change, so without a floor a long listen would call Apple all afternoon. */
const APPLE_FLOOR_MS = 15 * 60_000;
/** After a failed call — offline, or signed out. Short enough to catch a reconnect,
 *  long enough that a rebuild storm cannot hammer Apple. */
const APPLE_RETRY_MS = 2 * 60_000;
/** A nominal song, for spacing rows older than anything we have dated. */
const SONG_MS = 210_000;

// ── the "New" shelf (HOME.md §10) ─────────────────────────────────────────────
/** Artists the shelf asks Apple about. Ten is the whole cost control: one batched call. */
const NEW_ARTISTS = 10;
/** Of those ten, the seats won by our own play counts. The other four go to recency, and
 *  that floor is the point of the rule — a play count is a record of the past, and an
 *  artist you started last week has none. */
const NEW_PLAY_SEATS = 6;
/** Pages of Apple's recent list to read (30 rows each): 90 songs (his call). Recently
 *  Played still brackets against the FIRST page only, so its shelf is unchanged. */
const RECENT_PAGES = 3;
const RECENT_PAGE = 30;
/** The window: released in the last 30 days, or coming in the next 5. */
const NEW_BACK_DAYS = 30;
const NEW_AHEAD_DAYS = 5;
/** How long the release list stays good. A release date does not change in an afternoon
 *  (his call), so this floor is a day where the recents floor is fifteen minutes. */
const NEW_FLOOR_MS = DAY_MS;

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
  /** A tile that is an offer, not a thing you have: the empty-slot dashed rim (the Song of
   *  the Day suggestion). Same token as the empty-playlist drop slot. */
  dashed?: boolean;
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
  /** An album the library does not hold: the WHOLE album, fetched (one song→album hop,
   *  then the catalog album; both memoized for the session). `tracks()` is only the songs
   *  the tile knew. A press and a pin use this (owner, 2026-09-18: pins are not the library). */
  whole?: () => Promise<Track[]>;
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
export const songItem = (t: Track): HomeItem => ({
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
export function albumItem(key: string, fallback: Track[]): HomeItem | null {
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
    whole: mine.length ? undefined : () => wholeAlbum(list),
  };
}

/** The whole album for songs the library does not hold: one song→album hop, then the
 *  catalog album, both memoized in search.ts. The songs are made playable (a transient
 *  add + materialize, as a Search pane does). Falls back to what the tile knew. */
export async function wholeAlbum(known: Track[]): Promise<Track[]> {
  const seed = known.find((t) => t.catalogId);
  if (!seed?.catalogId) return known;
  try {
    const ref = await catalogRelated("songs", seed.catalogId, "albums");
    if (!ref) return known;
    const ts = await collectionTracks("albums", ref.id);
    if (!ts.length) return known;
    addTransientTracks(ts);
    ts.forEach(materializeTrack);
    return byTrackOrder(ts);
  } catch (e) {
    console.warn("[home] whole album", e);
    return known;
  }
}

export function playlistItem(p: Playlist): HomeItem {
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

export const stationItem = (s: Station): HomeItem => ({
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
export function artistItem(name: string): HomeItem | null {
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

// ── Apple's own recents (HOME.md §9) ──────────────────────────────────────────
// Two calls, one per shelf, for CONTINUITY: a play or an add made on your phone never
// reaches this machine otherwise. Both are fetched in Rust, so every song read feeds the
// writer collection for free and a song we have never held becomes a `seen` row.
//
// The floor matters. This card rebuilds whenever the played song changes, so the lists
// are cached for APPLE_FLOOR_MS and the header's refresh square clears the clock.

let appleAt = 0;
let applePlayed: Track[] = [];
let newAt = 0;
let newReleases: Album[] = [];
let appleAdded: { albums: Album[]; playlists: Playlist[] } = { albums: [], playlists: [] };
let appleInFlight: Promise<void> | null = null;

/** The refresh square asks Apple again, floor or no floor. A fresh sign-in does the
 *  same: on a first run Home mounts signed out, so the floor must not outlive the
 *  sign-in that fixes it (main.ts fires `deets:signed-in` once Apple accepts the
 *  token). The walk's first step promises the library fills after signing in — a
 *  shelf that stayed empty behind a floor would be the app breaking that out loud. */
export function refreshApple(): void {
  appleAt = 0;
  newAt = 0;
}
window.addEventListener("deets:signed-in", () => {
  appleAt = 0;
  newAt = 0;
});

/** Read both lists, at most once per floor. A failure keeps the lists we already have
 *  and retries sooner — offline, the shelves simply fall back to what is on disk. */
async function fetchApple(): Promise<void> {
  if (Date.now() < appleAt) return;
  // Signed out, or a sign-in Apple has already refused: do not ask, and do not start a
  // clock. On a true first run the walk's step 1 IS the sign-in, so Home can sit here
  // for minutes. A request would fail for a reason the user is already being told, and
  // a 403 from an expired token would raise a second notice over the card that says the
  // same thing (one cause, one notice — TOASTS.md).
  //
  // The TOKEN is the tell, not `trouble()`. `trouble()` starts at "none" and everything
  // that moves it off "none" is a reaction to a call that has already failed, so on a
  // first launch — no token, no sync, nothing played — it still reads "none" and would
  // wave these calls straight through. `isConnected()` asks Rust whether a token exists,
  // which is what the startup sync and the walk's step 1 both gate on. `trouble()` stays
  // in the condition for the second reason to skip: a token Apple has since refused.
  // Off, Home never leaves this machine (Settings › Home › Follow your other devices).
  if (!setting("homeApple")) return;
  if (trouble() === "signin") return;
  if (!(await isConnected())) return;
  if (appleInFlight) return appleInFlight;
  appleInFlight = (async () => {
    const [played, added] = await Promise.all([
      invoke<Track[]>("recent_played_tracks", { pages: RECENT_PAGES }).catch((e) => {
        console.warn("[home] recent played", e);
        return null;
      }),
      invoke<{ albums: Album[]; playlists: Playlist[] }>("recent_added").catch((e) => {
        console.warn("[home] recent added", e);
        return null;
      }),
    ]);
    if (played) applePlayed = played;
    if (added) appleAdded = added;
    appleAt = Date.now() + (played || added ? APPLE_FLOOR_MS : APPLE_RETRY_MS);
  })();
  try {
    await appleInFlight;
  } finally {
    appleInFlight = null;
  }
}

const idOf = (t: Track): string => t.catalogId ?? t.libraryId ?? t.title;

/** Apple's list is a TOTAL ORDER of recent plays with no times on it. Our log dates a
 *  subset of that order — every play made here. So a row we did not play sits between
 *  the two rows around it that we did, and its time can be read off the bracket:
 *
 *      Apple order        our log
 *      1  101 FM          14:22   <- anchor
 *      2  High            —       <- between 14:22 and 11:05
 *      3  SCARED OF YOU?! —       <- same bracket
 *      4  OVER AGAIN      11:05   <- anchor
 *
 *  Above the newest anchor the bracket opens at now; below the oldest it steps down by
 *  a nominal song. The guessed time NEVER reaches the database — it orders this shelf
 *  and nothing else, so Rewind's minutes and the bucket score stay measured.
 *
 *  A run of two or more consecutive borrowed rows from one album becomes an album tile.
 *  One alone does not: a local run earns its container tile at length one (fork C2), but
 *  there the context is stated by us, and here the album is only inferred. */
function elsewhere(apple: Track[], events: PlayEvent[]): { events: PlayEvent[]; tracks: Map<string, Track> } {
  const tracks = new Map<string, Track>();
  if (!apple.length) return { events: [], tracks };

  // The newest local play per track — the anchors.
  const anchor = new Map<string, number>();
  for (const e of events) {
    const t = trackById(e.trackId);
    const key = t ? idOf(t) : e.trackId;
    if (e.startedTs > (anchor.get(key) ?? 0)) anchor.set(key, e.startedTs);
  }

  const rows = apple.map((t) => ({ t, at: anchor.get(idOf(t)) }));
  // Times, newest first. `prev` is the last time we are sure of.
  const ts = new Array<number>(rows.length);
  let prev = Date.now();
  for (let i = 0; i < rows.length; i++) {
    const known = rows[i].at;
    if (known != null) {
      ts[i] = Math.min(known, prev);
      prev = ts[i];
      continue;
    }
    // The unknown run i..j-1, and the anchor that closes it (if any).
    let j = i;
    while (j < rows.length && rows[j].at == null) j++;
    const n = j - i;
    const next = rows[j]?.at;
    const floor = next != null && next < prev ? next : prev - (n + 1) * SONG_MS;
    for (let k = 0; k < n; k++) ts[i + k] = prev - ((prev - floor) * (k + 1)) / (n + 1);
    prev = ts[j - 1];
    i = j - 1;
  }

  // Only the rows we have no play of our own for become events; the rest are already
  // in the log, with their real times.
  const out: PlayEvent[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].at != null) continue;
    const t = rows[i].t;
    const key = idOf(t);
    if (!trackById(key)) tracks.set(key, t);
    // Consecutive borrowed rows from one album: a run, and so one album tile.
    const mine = albumKey(t);
    const runs = rows[i - 1]?.at == null && i > 0 && albumKey(rows[i - 1].t) === mine;
    const nextRuns = rows[i + 1]?.at == null && i + 1 < rows.length && albumKey(rows[i + 1].t) === mine;
    out.push({
      trackId: key,
      startedTs: Math.round(ts[i]),
      msListened: null,
      completed: false,
      context: runs || nextRuns ? `album:${mine}` : null,
    });
  }
  return { events: out, tracks };
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
function playedShelf(
  events: PlayEvent[],
  playlists: Map<string, Playlist>,
  want: number,
  borrowed: Map<string, Track> = new Map(),
): HomeItem[] {
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
    // A borrowed row's song may not be in the store yet — Rust has just written it as a
    // `seen` row, which the store picks up on its next read, so carry it here meanwhile.
    const resolved = run.events
      .map((e) => trackById(e.trackId) ?? borrowed.get(e.trackId))
      .filter((t): t is Track => !!t);
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

/** Recently Added from Apple's own list (HOME.md §9.2). Apple has already grouped the
 *  songs into their albums and stamped each row with a REAL `dateAdded`, so albums and
 *  playlists sit on one true scale and the round-robin guess above is not needed. The
 *  dates order the shelf and are never printed (his call, 2026-09-18).
 *
 *  Apple is used for the ORDER only. Whether a row draws as an album tile or a song tile
 *  is still our rule: a group of one track is not an album. And `trackCount` from Apple
 *  is ignored — it disagreed with our own count on an EP (measured 2026-09-18).
 *
 *  Anything added HERE since Apple last answered leads the shelf, from `added_at`. Both
 *  are real times, so the two merge honestly, and your newest add never waits on a floor. */
function addedShelfApple(
  added: { albums: Album[]; playlists: Playlist[] },
  playlists: Map<string, Playlist>,
  addedAt: Map<string, number>,
  want: number,
): HomeItem[] {
  const lib = allTracks();
  const rows: { at: number; item: HomeItem | null }[] = [];

  for (const a of added.albums) {
    const at = Date.parse(a.dateAdded ?? "");
    if (!Number.isFinite(at)) continue;
    // Apple's library album carries no catalog id, so the join is name + artist.
    const mine = lib.filter((t) => t.albumName === a.title && t.artistName === a.artistName);
    if (!mine.length) continue; // added on another device; ours after the next sync
    rows.push({ at, item: mine.length > 1 ? albumItem(albumKey(mine[0]), mine) : songItem(mine[0]) });
  }
  for (const p of added.playlists) {
    const at = Date.parse(p.dateAdded ?? "");
    if (!Number.isFinite(at)) continue;
    // Prefer our cached row: it carries the mosaic covers and the track count.
    rows.push({ at, item: playlistItem(playlists.get(pid(p)) ?? p) });
  }

  if (!rows.length) return [];

  // Adds made here since Apple's newest row — real stamps, so they merge, not jump.
  const newest = Math.max(...rows.map((r) => r.at));
  const onShelf = new Set(rows.map((r) => r.item?.key).filter(Boolean));
  for (const [id, at] of addedAt) {
    if (at <= newest) continue;
    const t = lib.find((x) => x.catalogId === id || x.libraryId === id);
    if (!t) continue;
    const sameAlbum = lib.filter((x) => albumKey(x) === albumKey(t));
    const item = sameAlbum.length > 1 ? albumItem(albumKey(t), sameAlbum) : songItem(t);
    if (item && !onShelf.has(item.key)) {
      onShelf.add(item.key);
      rows.push({ at, item });
    }
  }

  const out: HomeItem[] = [];
  const shown = new Set<string>();
  for (const r of rows.sort((a, b) => b.at - a.at)) {
    if (out.length >= want) break;
    if (!r.item || shown.has(r.item.key)) continue;
    shown.add(r.item.key);
    out.push(r.item);
  }
  return out;
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

// ── New — releases from your artists (HOME.md §10) ────────────────────────────
// Ten artists, one batched Apple call. Six seats go to our own play counts, four to the
// artists Apple says you played last — on any device, which is the only way an artist you
// listen to on your phone can reach this machine.

/** The ten artists to ask about. Plays first, then recency, and a recency seat is
 *  LIBRARY ONLY: Apple's list holds artists you do not own (31 of 68, measured
 *  2026-09-18), and those are Apple's discovery job, not ours. A play seat does not
 *  check the library — an artist you play that often has earned the tile (his call).
 *  A fresh install has no plays at all, so every seat falls to recency. */
function newArtists(counts: Map<string, { full: number; partial: number }>): string[] {
  const plays = new Map<string, number>();
  const inLibrary = new Set<string>();
  for (const t of allTracks()) {
    const name = t.artistName?.trim();
    if (name && t.libraryId) inLibrary.add(name);
  }
  for (const [id, c] of counts) {
    const name = trackById(id)?.artistName?.trim();
    if (!name) continue;
    plays.set(name, (plays.get(name) ?? 0) + c.full + c.partial);
  }
  const seats: string[] = [];
  const take = (name: string): void => {
    if (name && !seats.includes(name) && seats.length < NEW_ARTISTS) seats.push(name);
  };
  for (const [name] of [...plays.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    if (seats.length >= NEW_PLAY_SEATS) break;
    take(name);
  }
  // Apple's order IS the recency order. Library only, and the cold start fills the play
  // seats it left empty from the same list.
  for (const t of applePlayed) {
    if (seats.length >= NEW_ARTISTS) break;
    const name = t.artistName?.trim();
    if (name && inLibrary.has(name)) take(name);
  }
  return seats;
}

/** Ask Apple for each artist's newest release, at most once a day. A failure keeps the
 *  list already in hand and retries sooner, exactly as the recents calls do. */
async function fetchNew(counts: Map<string, { full: number; partial: number }>): Promise<void> {
  if (Date.now() < newAt) return;
  if (!setting("homeApple")) return;
  if (trouble() === "signin") return;
  if (!(await isConnected())) return;
  const names = newArtists(counts);
  if (!names.length) return;
  const got = await invoke<Album[]>("artist_new_releases", { names }).catch((e) => {
    console.warn("[home] new releases", e);
    return null;
  });
  if (got) newReleases = got;
  newAt = Date.now() + (got ? NEW_FLOOR_MS : APPLE_RETRY_MS);
}

/** "Coming 09/23" — no year (his call): the window ahead is five days wide, so the year
 *  can only be this one or the next. */
const comingMark = (d: Date): string =>
  `Coming ${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;

/** The shelf: one tile per release inside the window, newest first. A release we do not
 *  hold is a catalog album, and it plays through the same path a Search catalog album
 *  uses, so every tile is playable. */
function newShelf(limit: number): HomeItem[] {
  const now = Date.now();
  const from = now - NEW_BACK_DAYS * DAY_MS;
  const to = now + NEW_AHEAD_DAYS * DAY_MS;
  const out: { at: number; item: HomeItem }[] = [];
  for (const al of newReleases) {
    const id = al.catalogId;
    if (!id || !al.releaseDate) continue;
    // Apple dates a release YYYY-MM-DD with no zone. Read it as local midnight, so
    // "today" is today here and not a day out either side.
    const [y, m, d] = al.releaseDate.split("-").map(Number);
    if (!y || !m || !d) continue;
    const at = new Date(y, m - 1, d).getTime();
    if (at < from || at > to) continue;
    const coming = at > now;
    out.push({
      at,
      item: {
        key: `album:${id}`,
        kind: "album",
        title: al.title,
        sub: coming ? `${comingMark(new Date(at))} · ${al.artistName}` : al.artistName,
        art: al.artwork,
        context: `search-albums:${id}`,
        tracks: () => collectionTracks("albums", id),
        count: al.trackCount,
      },
    });
  }
  return out.sort((a, b) => b.at - a.at).map((r) => r.item).slice(0, limit);
}

// ── the card's one entry point ────────────────────────────────────────────────
const addedAtMap = (): Promise<[string, number][]> => invoke<[string, number][]>("added_at_map");
const artistPhotos = (): Promise<[string, Artwork][]> => invoke<[string, Artwork][]>("artist_photos");

/** Every shelf, ready to render. One SQLite read for the log, one for the add stamps,
 *  one cached playlist list — plus Apple's two recents lists, at most once per floor
 *  (HOME.md §9). An empty shelf is left out, and a failed Apple call costs nothing but
 *  the continuity: every shelf still builds from what is on this machine. */
export async function homeShelves(): Promise<HomeShelf[]> {
  const [events, lists, stamps, faces, counts] = await Promise.all([
    playEventsSince(Date.now() - SCORE_DAYS * DAY_MS),
    playlistsCached(),
    addedAtMap().catch(() => [] as [string, number][]),
    artistPhotos().catch(() => [] as [string, Artwork][]),
    playCounts().catch(() => new Map()),
    fetchApple(),
  ]);
  // The release read needs the recents list, so it follows the fetch above. Its own floor
  // is a day, so this is a no-op on all but the first build of each day.
  await fetchNew(counts);
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
  // Plays made elsewhere fold into the shelf, dated by the bracket rule and unmarked
  // (his call, 2026-09-18). They feed THIS shelf only: `events` stays measured, so the
  // bucket score below and Rewind never see a guessed time.
  const localPlays = events.filter((e) => e.startedTs >= playedFrom);
  // The FIRST page only (30 rows). The list is read 90 deep for the "New" shelf's artist
  // recency, but Recently Played's bracket rule is unchanged by that: a deeper borrow
  // would quietly re-shape a shelf nobody asked to change.
  const borrowed = elsewhere(applePlayed.slice(0, RECENT_PAGE), localPlays);
  const allPlays = [...localPlays, ...borrowed.events].sort((a, b) => a.startedTs - b.startedTs);
  const played = keep(playedShelf(allPlays, playlists, deep, borrowed.tracks));
  // Apple's dated list when we have it; our own rank-and-round-robin when we do not.
  const fromApple = addedShelfApple(appleAdded, playlists, addedAt, deep);
  const added = keep(fromApple.length ? fromApple : addedShelf(lists, addedAt, deep));
  const bucket = bucketShelf(events, playlists, deep);
  // The cold start (fork 3): the bucket shelf stays away until it has something to say.
  const scored = bucket.length >= SCORE_MIN ? keep(bucket) : [];

  const fresh = keep(newShelf(deep));

  // Pinned (PINS.md): every pin, by plays over all time, ties by pin time. A pin is the
  // user's own choice, so the hide list never touches it, and no floor holds it back.
  const pinned = await pinnedShelf();

  // Songs of the Day (DeetsOTD.md §8.6): the picks, newest first, with the suggestion
  // before them when its row is on. Last, after Pinned (owner, 2026-09-18). All local.
  const sotd = await sotdShelf();

  const shelves: HomeShelf[] = [];
  if (played.length) shelves.push({ label: "Recently Played", items: played });
  if (added.length) shelves.push({ label: "Recently Added", items: added });
  if (fresh.length) shelves.push({ label: "New", items: fresh });
  if (scored.length) shelves.push({ label: bucketLabel(), items: scored });
  if (pinned.length) shelves.push({ label: "Pinned", items: pinned });
  if (sotd.length) shelves.push({ label: "Songs of the Day", items: sotd });
  return shelves;
}

/** The last shelf: the picks, newest first, with today's suggestion at its head. Left out
 *  when there is neither — Home's empty-shelf rule. A pick is never hidden: Unmark is the
 *  way off, so the hide list never touches this shelf. */
async function sotdShelf(): Promise<HomeItem[]> {
  if (!sotdOn()) return [];
  const suggestion = await suggestionTile().catch(() => null);
  const tiles = pickTiles(suggestion ? SHELF - 1 : SHELF);
  return suggestion ? [suggestion, ...tiles] : tiles;
}

/** The fifth shelf: the pinned tiles, most played first (PINS.md fork 4). */
async function pinnedShelf(): Promise<HomeItem[]> {
  const items = pinnedItems();
  if (!items.length) return [];
  const counts = await pinPlayCounts(items.map((i) => i.key)).catch(() => new Map<string, number>());
  const at = new Map(pinsOf().map((p) => [p.key, p.pinnedAt]));
  return items
    .sort((a, b) => (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0) || (at.get(b.key) ?? 0) - (at.get(a.key) ?? 0))
    .slice(0, SHELF);
}
