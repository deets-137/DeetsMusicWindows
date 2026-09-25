// Library card — defines the Library's browse contexts and feeds them to the
// shared collection-card engine. Everything is derived client-side from the
// cached tracks we already hold in memory:
//
//   Library ─┬─ Songs   (line rows carry a mini cover so the list isn't barren)
//            ├─ Albums  → Album detail  (that album's tracks; covers omitted —
//            │                            they'd all be identical)
//            └─ Artists → Artist detail (that artist's Albums + Songs)
//
// Albums/Artists are grouped from the tracks (no extra API calls); real artist
// photos + album art arrive later via catalog hydrate, behind the same tiles.
// Artists group by PARSED credit (artist-credit.ts), so collabs/features land
// under every credited artist instead of fragmenting into one tile per credit.

import { librarySync, onSyncEvent, type Track, type Artwork } from "./library";
import { creditIndex } from "./artist-credit";
import { tracks, onTracksChange } from "./track-store";
import { playTracks } from "./player";
import { requestOpenPlaylist, playlistTracks } from "./playlists";
import { onLibraryDrill, takeLibraryDrill } from "./layout-bus";
import { isLoved, onFavoritesChange, reconcileAlbum } from "./favorites";
import { requestPlaylistPane } from "./go-to";
import { songMenu, albumMenu, artistMenu, playlistMenu, listMenu, setMenu, tileMenu, type AlbumSubject } from "./media-menu";
import {
  creditsFor, primeCredits, songsByWriter, fetchCredits, searchAppleForWriter,
  CREDITS_LABEL, CREDITS_NONE, CREDITS_READING, CREDITS_READ_FAILED,
  WRITER_REACH, WRITER_SEARCH_NOTE, FLAT_MARK,
  type WriterSong,
} from "./credits";
import { initCollectionCard, esc, type Context, type Grouping, type SortSpec, type Density, type ActionTitles, type ColumnMode, type ColumnSpec, formatTotal } from "./collection-card";
import { onGrowChange } from "./card-grow";
import type { MenuItem } from "./context-menu";
import type { CardDef } from "./cards";
import { registerDropTarget } from "./row-drag";
import { dropToLibrary } from "./drop-actions";
import { libraryAddEnabled } from "./library-add";
import { mosaicHTML } from "./mosaic";
import {
  libraryArtistInfo, expireArtistInfo, yourPlaylistsFor, checkPlaylists, artistShelvesHTML,
  playCounts, type LibraryArtistInfo, type YourPlaylists, type CheckProgress, type PlayCount,
} from "./artist-view";
import { handOff } from "./handoff";
import { collectionTracks } from "./search";
import { pinActivate, pinnedShelfHTML, pinShelfItem, onPinsChange, pinDragRow } from "./pins";
import { addSquareHTML } from "./add-square";
import { unreleasedHint } from "./release";
import { fullViews, FULL_LIB, type FullViews } from "./library-full";

// ── derived models ────────────────────────────────────────────────────────────
interface AlbumGroup {
  key: string;
  name: string;
  artist: string;
  artwork?: Artwork;
  releaseDate?: string; // earliest track release
  addedRank?: number; // earliest-added track's rank
  count: number;
}
/** A genre of the library (a song's first genre), for the Genres view. */
interface GenreGroup {
  name: string;
  songCount: number;
  artistCount: number;
  /** Up to 16 distinct covers, for the mosaic tile. */
  covers: string[];
}

interface ArtistGroup {
  name: string;
  artwork?: Artwork; // representative cover until catalog hydrate gives a real photo
  releaseDate?: string;
  addedRank?: number;
  albumCount: number;
  songCount: number;
}

// Albums key on album name + COVER-ART URL, not the per-track artist. Every track on an
// album shares one cover URL, so this reunites tracks that credit a featured guest (which
// used to fragment the album into one entry per artist) and collapses various-artists
// compilations, while two same-named albums with different covers stay distinct. Tracks
// with no artwork fall back to the old name+artist key. The TRUE album identity (a real
// library/catalog album id) is a later catalog-hydrate upgrade; this is the cheap fix.
export const albumKey = (t: Track) => {
  const name = t.albumName ?? "Unknown Album";
  const art = t.artwork?.urlTemplate;
  return art ? `${name} ${art}` : `${name} ${t.artistName ?? ""}`;
};

function groupAlbums(tracks: Track[]): AlbumGroup[] {
  // Album's displayed artist = its DOMINANT track artist (a featured guest on one track
  // shouldn't relabel the whole album), tracked via per-artist counts.
  const map = new Map<string, AlbumGroup & { artistCounts: Map<string, number> }>();
  for (const t of tracks) {
    const key = albumKey(t);
    let g = map.get(key);
    if (!g) {
      g = { key, name: t.albumName ?? "Unknown Album", artist: "", count: 0, artistCounts: new Map() };
      map.set(key, g);
    }
    g.count++;
    const an = t.artistName ?? "";
    g.artistCounts.set(an, (g.artistCounts.get(an) ?? 0) + 1);
    if (!g.artwork && t.artwork) g.artwork = t.artwork;
    if (t.releaseDate && (!g.releaseDate || t.releaseDate < g.releaseDate)) g.releaseDate = t.releaseDate;
    // album's "added" = its MOST-RECENTLY-added track, so a freshly-touched album surfaces first
    if (t.addedRank != null && (g.addedRank == null || t.addedRank > g.addedRank)) g.addedRank = t.addedRank;
  }
  const groups = [...map.values()];
  for (const g of groups) {
    let best = -1;
    for (const [name, n] of g.artistCounts) if (n > best) { best = n; g.artist = name; }
  }
  return groups;
}

// Artists come from PARSED credits, not raw strings ("Drake & Future" counts under
// both), so a song can join several groups — songCount is appearances. The split
// rules + vocabulary live in artist-credit.ts.
function groupArtists(tracks: Track[]): ArtistGroup[] {
  const idx = creditIndex(tracks);
  const map = new Map<string, ArtistGroup & { albums: Set<string> }>();
  for (const t of tracks) {
    for (const name of idx.namesOf(t)) {
      let g = map.get(name);
      if (!g) {
        g = { name, albumCount: 0, songCount: 0, albums: new Set() };
        map.set(name, g);
      }
      g.songCount++;
      if (t.albumName) g.albums.add(t.albumName);
      if (!g.artwork && t.artwork) g.artwork = t.artwork;
      if (t.releaseDate && (!g.releaseDate || t.releaseDate > g.releaseDate)) g.releaseDate = t.releaseDate; // latest
      if (t.addedRank != null && (g.addedRank == null || t.addedRank < g.addedRank)) g.addedRank = t.addedRank;
    }
  }
  return [...map.values()].map((g) => ({ ...g, albumCount: g.albums.size }));
}

/** A song's genre for grouping: its first genre, as Apple lists it. */
const genreOf = (t: Track): string | undefined => t.genres[0];
function groupGenres(tracks: Track[]): GenreGroup[] {
  const map = new Map<string, GenreGroup & { artists: Set<string>; coverSet: Set<string> }>();
  for (const t of tracks) {
    const name = genreOf(t);
    if (!name) continue;
    let g = map.get(name);
    if (!g) {
      g = { name, songCount: 0, artistCount: 0, covers: [], artists: new Set(), coverSet: new Set() };
      map.set(name, g);
    }
    g.songCount++;
    g.artists.add(t.artistName);
    const art = t.artwork?.urlTemplate;
    if (art && g.coverSet.size < 16 && !g.coverSet.has(art)) {
      g.coverSet.add(art);
      g.covers.push(art);
    }
  }
  return [...map.values()].map(({ artists, coverSet: _c, ...g }) => ({ ...g, artistCount: artists.size }));
}
/** The songs of one genre, in artist order (release, album, track): the tile's drag and play. */
const genreTracks = (ts: Track[], name: string): Track[] => artistOrder(ts.filter((t) => genreOf(t) === name));

// ── artwork + cells ─────────────────────────────────────────────────────────────
// The shared cell for every collection card. `musicCell` (below) is the only export;
// the Playlists card renders through it too, so one shape/density system serves both.
// The builders it composes (rowThumb/tileCover/rowHTML/tileHTML) are private here.
function artURL(art: Artwork | undefined, px: number): string | null {
  if (!art?.urlTemplate) return null;
  const s = String(px);
  return art.urlTemplate.replace("{w}", s).replace("{h}", s).replace("{f}", "jpg");
}
const trackId = (t: Track) => t.libraryId ?? t.catalogId ?? `${t.title} ${t.artistName}`;

/** The explicit mark (Apple's `contentRating: "explicit"`): a filled square with an E,
 *  the same badge slot and size as the Apple sigil on playlist rows. Theme roles only. */
export const EXPLICIT_SIGIL =
  `<svg class="lib-src-badge lib-src-badge--explicit" viewBox="0 0 24 24" role="img" aria-label="Explicit">` +
  `<rect x="3" y="3" width="18" height="18" rx="3"/>` +
  `<path class="lib-src-badge__letter" d="M9 7h6v2h-4v2h3.5v2H11v2h4v2H9z"/></svg>`;
export const explicitBadge = (t: { contentRating?: string }): string =>
  t.contentRating === "explicit" ? EXPLICIT_SIGIL : "";

const ICON_HEART =
  '<svg class="lib-pill__icon lib-pill__icon--heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/></svg>';
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
// The derived cover (a playlist with no artwork): one picture drawn from up to 100 track
// covers, `mosaic.ts` (PLAYLISTS.md §11). `seed` is the playlist's id.
function rowThumb(art: Artwork | undefined, round: boolean, name: string, mosaic?: string[], seed?: string): string {
  const r = round ? " lib-row__art--round" : "";
  const url = artURL(art, 72);
  if (url) return `<img class="lib-row__art${r}" src="${esc(url)}" alt="" loading="lazy" decoding="async" data-art />`;
  if (mosaic?.length) return mosaicHTML("lib-row__art", mosaic, seed ?? name);
  return `<div class="lib-row__art${r} lib-row__art--empty" aria-hidden="true">${round ? esc(initials(name)) : "♪"}</div>`;
}
function tileCover(art: Artwork | undefined, px: number, round: boolean, name: string, mosaic?: string[], seed?: string): string {
  const r = round ? " lib-tile__cover--round" : "";
  const url = artURL(art, px);
  if (url) return `<img class="lib-tile__cover${r}" src="${esc(url)}" alt="" loading="lazy" decoding="async" data-art />`;
  if (mosaic?.length) return mosaicHTML("lib-tile__cover", mosaic, seed ?? name);
  return `<div class="lib-tile__cover${r} lib-tile__cover--empty" aria-hidden="true">${round ? esc(initials(name)) : "♪"}</div>`;
}
const px = (density: Density) => (density === "large" ? 300 : 160);

/** The detail hero's cover (a real cover, a mosaic, or the ♪ placeholder). Fetched at
 *  2× the token size so it stays crisp on a HiDPI panel. `round` = an artist's photo. */
const HERO_PX = 360;
export function heroCover(art: Artwork | undefined, name: string, mosaic?: string[], seed?: string, round = false): string {
  const cls = round ? "lib-hero__cover lib-hero__cover--round" : "lib-hero__cover";
  const url = artURL(art, HERO_PX);
  if (url) return `<img class="${cls}" src="${esc(url)}" alt="${esc(name)}" decoding="async" data-art />`;
  if (mosaic?.length) return mosaicHTML(cls, mosaic, seed ?? name);
  return `<div class="${cls} lib-hero__cover--empty" aria-hidden="true">${round ? esc(initials(name)) : "♪"}</div>`;
}

/** "3:41" for a track length; "" when unknown. */
export const fmtClock = (ms: number | undefined): string => {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function rowHTML(idx: number, title: string, sub: string, thumb?: string, selected = false, badge = "", cid = ""): string {
  const art = thumb ? thumb : "";
  // `badge` (a source sigil) rides the row's trailing edge (right-aligned via CSS).
  // data-cid: the hover hint reads the song's writers off it (CREDITS.md §7, hint.ts).
  const id = cid ? ` data-cid="${esc(cid)}"` : "";
  return `<div class="lib-row${thumb ? " lib-row--art" : ""}${selected ? " is-selected" : ""}" data-idx="${idx}"${id}>${art}<div class="lib-row__text"><span class="lib-row__title">${esc(
    title,
  )}</span><span class="lib-row__artist">${esc(sub)}</span></div>${badge}</div>`;
}
function tileHTML(idx: number, cover: string, primary: string | undefined, sub: string | undefined, selected = false, badge = ""): string {
  const p = primary ? `<span class="lib-tile__name">${esc(primary)}</span>` : "";
  const subText = sub != null ? `<span class="lib-tile__sub">${esc(sub)}</span>` : "";
  // With a badge, the sub shares a flex row with it (count left, sigil right).
  const s = sub != null && badge ? `<div class="lib-tile__subrow">${subText}${badge}</div>` : subText;
  return `<div class="lib-tile${selected ? " is-selected" : ""}" data-idx="${idx}">${cover}<div class="lib-tile__meta">${p}${s}</div></div>`;
}

/**
 * Render one piece of music — a line row (`lines`) or a grid tile (`small`/`large`).
 * `primary` is the identity line (song/album/artist name) and doubles as the empty-art
 * fallback label; `sub` is the secondary line (artist, count, …). Options: `round` cover
 * (artists), `hideCover` (album detail — every track shares the cover), `selected`, and
 * `badge` — raw trailing HTML (e.g. a source sigil) right-aligned on the sub line/row.
 *
 * This is the single shared cell across collection cards (Library, Playlists): the
 * row-vs-tile + density choice lives here, so it can't drift per-card.
 */
export function musicCell(
  density: Density,
  idx: number,
  art: Artwork | undefined,
  primary: string,
  sub: string,
  opts: { round?: boolean; hideCover?: boolean; selected?: boolean; badge?: string; mosaic?: string[]; mosaicSeed?: string; num?: number; cid?: string } = {},
): string {
  const { round = false, hideCover = false, selected = false, badge = "", mosaic, mosaicSeed, num, cid = "" } = opts;
  // `num` (an album's track number) takes the cover's slot on a line row.
  const slot = num !== undefined ? `<span class="lib-row__num">${num}</span>` : hideCover ? undefined : rowThumb(art, round, primary, mosaic, mosaicSeed);
  return density === "lines"
    ? rowHTML(idx, primary, sub, slot, selected, badge, cid)
    : tileHTML(idx, tileCover(art, px(density), round, primary, mosaic, mosaicSeed), primary, sub, selected, badge);
}

// ── sort specs (per grouping) ────────────────────────────────────────────────────
// "Added Date" negates the rank so ascending (the default ↑) puts the MOST
// recently added first; the ↓ arrow flips to oldest-first.
const recency = (rank: number | undefined) => (rank == null ? undefined : -rank);
// Artist, Album, Length and Genre are the column headers of a grown card (CARD-GROW.md §9a),
// and they sit in the Sort popover too, so the dropdown always shows the sort in force.
// Artist, Album and Genre name a COLLECTION, so on a flat song list they sort inside it too
// (the record-shop order): by artist, then album, then track; by album, then track; by genre,
// then artist, album, track. Read as one key, so the arrow flips the whole order at once.
const trackPos = (t: Track) => String((t.discNumber ?? 1) * 1000 + (t.trackNumber ?? 0)).padStart(6, "0");
const inAlbum = (t: Track) => `${t.albumName ?? ""}\u0001${trackPos(t)}`;
const songSorts: SortSpec<Track>[] = [
  { key: "az", label: "A–Z", type: "str", get: (t) => t.title },
  { key: "artist", label: "Artist", type: "str", hidden: true, get: (t) => `${t.artistName}\u0001${inAlbum(t)}` },
  { key: "album", label: "Album", type: "str", hidden: true, get: (t) => inAlbum(t) },
  { key: "release", label: "Release Date", type: "str", get: (t) => t.releaseDate },
  { key: "added", label: "Added Date", type: "num", get: (t) => recency(t.addedRank) },
  { key: "time", label: "Length", type: "num", get: (t) => t.durationMs },
  { key: "genre", label: "Genre", type: "str", hidden: true, get: (t) => `${t.genres[0] ?? ""}\u0001${t.artistName}\u0001${inAlbum(t)}` },
];
// The play_stats key is CATALOG-first (`record_play` in library.rs, to match the tracks PK).
// A library song carries both ids and they differ, so a library-first lookup misses every one.
const playsKey = (t: Track) => t.catalogId ?? t.libraryId ?? "";
/** This app's own play tallies (zero Apple calls): most played first under the default ↑. */
const playsSort = (plays: () => Map<string, PlayCount> | undefined): SortSpec<Track> => ({
  key: "plays",
  label: "Plays",
  type: "num",
  get: (t) => {
    const c = plays()?.get(playsKey(t));
    return c ? -(c.full * 1e6 + c.partial) : undefined;
  },
});
const playsOf = (plays: (() => Map<string, PlayCount> | undefined) | undefined, t: Track): number | undefined => {
  const c = plays?.()?.get(playsKey(t));
  return c ? c.full + c.partial : undefined;
};
// An album detail leads with disc/track order; the shared song sorts follow.
const trackSorts: SortSpec<Track>[] = [
  { key: "track", label: "Track Order", type: "num", get: (t) => (t.discNumber ?? 1) * 1000 + (t.trackNumber ?? 0) },
  ...songSorts,
];
const albumSorts: SortSpec<AlbumGroup>[] = [
  { key: "az", label: "A–Z", type: "str", get: (a) => a.name },
  { key: "release", label: "Release Date", type: "str", get: (a) => a.releaseDate },
  { key: "added", label: "Added Date", type: "num", get: (a) => recency(a.addedRank) },
];
const artistSorts: SortSpec<ArtistGroup>[] = [
  { key: "az", label: "A–Z", type: "str", get: (a) => a.name },
  { key: "songs", label: "Song Count", type: "num", get: (a) => a.songCount },
];
const genreSorts: SortSpec<GenreGroup>[] = [
  { key: "az", label: "A–Z", type: "str", get: (g) => g.name },
  { key: "songs", label: "Song Count", type: "num", get: (g) => g.songCount },
  { key: "artists", label: "Artist Count", type: "num", get: (g) => g.artistCount },
];

// ── right-click menu (Play Now / Play Next / Add to Queue) ───────────────────────
// One builder for songs and albums: a song is a 1-track list; an album is its tracks
// in disc/track order. "Play Now" plays the list from the top (a song → just that song;
// an album → the whole album as the new context). Next/Later insert without a rebuild.
export const albumOrder = (ts: Track[]): Track[] =>
  [...ts].sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0));
/** An artist's songs in album order: albums oldest first, each in disc/track order (a drag). */
export const artistOrder = (ts: Track[]): Track[] =>
  [...ts].sort(
    (a, b) =>
      (a.releaseDate ?? "").localeCompare(b.releaseDate ?? "") ||
      (a.albumName ?? "").localeCompare(b.albumName ?? "") ||
      (a.discNumber ?? 1) - (b.discNumber ?? 1) ||
      (a.trackNumber ?? 0) - (b.trackNumber ?? 0),
  );

/**
 * In-place drill navigation for a card's right-click menus. When passed to a media-menu.ts builder
 * (the Library card supplies it), "Go to Artist/Album" pushes the SAME context an
 * artist/album tile would — over the user's library, staying in this card's stack.
 * Absent (Playlists/Rewind), the verbs fall back to the shared catalog drill-in
 * (go-to.ts → Search card). `artistNames` returns a track's credited artists,
 * leading-credit first (so a collab offers each as a submenu row).
 */
export interface LibNav {
  artistNames: (t: Track) => string[];
  drillArtist: (name: string) => void;
  drillAlbum: (t: Track) => void;
  drillGenre: (name: string) => void;
  /** The song level (CREDITS.md §7.6) — local, so it stays in this card. */
  drillSong: (t: Track) => void;
}

/** A library album (its songs in disc/track order) as the menu builders take it
 *  (media-menu.ts, CONTEXT-MENUS.md). `pinKey`: the tile's own key, where it has one. */
export const libAlbum = (ts: Track[], pinKey?: string): AlbumSubject => ({
  title: ts[0]?.albumName ?? "Album",
  artistName: ts[0]?.artistName,
  artwork: ts[0]?.artwork,
  known: ts,
  pinKey,
});

// ── groupings ─────────────────────────────────────────────────────────────────
export interface SongOpts {
  hideCover?: boolean; // album detail: every track shares the cover, so omit it
  numbered?: boolean; // album detail: track number in the cover's slot, length as the subline
  selectedId?: string; // highlight this track (e.g. drilled-in)
  context?: string; // queue-origin tag for entries played from this list
  nav?: LibNav; // in-place "Go to Artist/Album" (Library only)
  extraSorts?: SortSpec<Track>[]; // appended to the Sort menu (the artist view's Popular / Most Played)
  actionTitles?: ActionTitles; // hover text for the Play / Shuffle row (what the list is)
  /** The play tallies (the Library root): a Plays sort, and the Plays column of a filled card. */
  plays?: () => Map<string, PlayCount> | undefined;
  /** A catalog list (the Full view, FULL-LIB.md): each line row ends in the Add square with
   *  the ✓ mark on a song you have, and an unreleased song is dimmed as in Search. */
  mark?: boolean;
}

// ── the columns of a grown card (CARD-GROW.md §9a) ──────────────────────────────
// Wide: Title · Artist · Album · Length · ♥. Full adds Genre · Year (· Plays where the
// tallies are known). An album's list keeps its track number as the lead cell and drops the
// Album column: every row shares it.
const HEART_MARK =
  '<svg class="lib-row__heart-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/></svg>';
const END = "lib-cols__cell--end";
function songColumns(cols: ColumnMode, o: SongOpts): ColumnSpec[] {
  const specs: ColumnSpec[] = [
    o.numbered ? { key: "lead", label: "#", sortKey: "track", width: "auto", cls: END } : { key: "lead", label: "", width: "auto" },
    { key: "title", label: "Title", sortKey: "az", width: "minmax(0, 2fr)" },
    { key: "artist", label: "Artist", sortKey: "artist", width: "minmax(0, 1.3fr)" },
    ...(o.hideCover ? [] : [{ key: "album", label: "Album", sortKey: "album", width: "minmax(0, 1.3fr)" }]),
    { key: "time", label: "Length", sortKey: "time", width: "var(--grow-col-time)", cls: END },
    { key: "heart", label: "♥", width: "var(--grow-col-heart)", cls: "lib-cols__cell--center" },
  ];
  if (cols === "full") {
    specs.push(
      { key: "genre", label: "Genre", sortKey: "genre", width: "minmax(0, 1fr)" },
      { key: "year", label: "Year", sortKey: "release", width: "var(--grow-col-year)", cls: END },
    );
    if (o.plays) specs.push({ key: "plays", label: "Plays", sortKey: "plays", width: "var(--grow-col-plays)", cls: END });
  }
  return specs;
}
function songColsHTML(t: Track, idx: number, cols: ColumnMode, o: SongOpts): string {
  const lead = o.numbered ? `<span class="lib-row__num lib-row__cell--end">${t.trackNumber ?? idx + 1}</span>` : rowThumb(t.artwork, false, t.title);
  const cells = [
    lead,
    `<span class="lib-row__cell lib-row__title">${esc(t.title)}${explicitBadge(t)}${o.mark ? markSquare(t) : ""}</span>`,
    `<span class="lib-row__cell lib-row__artist">${esc(t.artistName)}</span>`,
    ...(o.hideCover ? [] : [`<span class="lib-row__cell lib-row__album">${esc(t.albumName ?? "")}</span>`]),
    `<span class="lib-row__cell lib-row__cell--end lib-row__time">${fmtClock(t.durationMs)}</span>`,
    `<span class="lib-row__cell lib-row__cell--center lib-row__heart">${isLoved(t) ? HEART_MARK : ""}</span>`,
  ];
  if (cols === "full") {
    cells.push(
      `<span class="lib-row__cell lib-row__genre">${esc(t.genres[0] ?? "")}</span>`,
      `<span class="lib-row__cell lib-row__cell--end lib-row__year">${esc(t.releaseDate?.slice(0, 4) ?? "")}</span>`,
    );
    if (o.plays) {
      const n = playsOf(o.plays, t);
      cells.push(`<span class="lib-row__cell lib-row__cell--end lib-row__plays">${n === undefined ? "" : n}</span>`);
    }
  }
  const selected = !!o.selectedId && trackId(t) === o.selectedId;
  return dimUnreleased(`<div class="lib-row lib-row--art lib-row--cols${selected ? " is-selected" : ""}" data-idx="${idx}">${cells.join("")}</div>`, t, !!o.mark);
}

// The Full view's rows (FULL-LIB.md): the Add square, marked, and Search's unreleased dim.
const markSquare = (t: Track): string => (t.unreleased ? "" : addSquareHTML(t, "add-square--row", true));
const dimUnreleased = (html: string, t: Track, mark: boolean): string =>
  mark && t.unreleased
    ? html.replace('class="lib-row', `aria-disabled="true" title="${esc(unreleasedHint(t))}" class="lib-row is-unreleased`)
    : html;

export function songsGrouping(list: () => Track[], o: SongOpts = {}): Grouping<Track> {
  return {
    key: "songs",
    label: "Songs",
    sorts: [...(o.numbered ? trackSorts : songSorts), ...(o.plays ? [playsSort(o.plays)] : []), ...(o.extraSorts ?? [])],
    list,
    name: (t) => t.title,
    match: (t, q) =>
      t.title.toLowerCase().includes(q) ||
      t.artistName.toLowerCase().includes(q) ||
      (t.albumName?.toLowerCase().includes(q) ?? false),
    render: (t, density, idx, cols) =>
      cols && density === "lines"
        ? songColsHTML(t, idx, cols, o)
        : dimUnreleased(
            musicCell(density, idx, t.artwork, t.title, o.numbered && density === "lines" ? fmtClock(t.durationMs) : t.artistName, {
              hideCover: o.hideCover,
              num: o.numbered && density === "lines" ? (t.trackNumber ?? idx + 1) : undefined,
              selected: !!o.selectedId && trackId(t) === o.selectedId,
              badge: explicitBadge(t) + (o.mark && density === "lines" ? markSquare(t) : ""),
              cid: t.catalogId ?? "",
            }),
            t,
            !!o.mark,
          ),
    columns: (cols) => songColumns(cols, o),
    isSelected: o.selectedId ? (t) => trackId(t) === o.selectedId : undefined,
    // Click a song → play it and queue the rest of THIS list from here, in the
    // current sort order (the engine hands us the live sorted view).
    activate: (_t, idx, items) =>
      playTracks(items, idx, o.context).catch((e) => console.error("[library] play", e)),
    playAll: o.actionTitles ?? true, // the Play / Shuffle row (NEXT-VERSION §13)
    // Right-click → act on this song; Play Now's scope (just it, or it then the list)
    // is the setting (SETTINGS.md / FUTURE-SETTINGS §1).
    menu: (t, idx, items) => songMenu(t, { context: o.context, nav: o.nav, listFrom: { items, idx } }),
    drag: (t) => ({ source: "library", kind: "song", tracks: () => [t], context: o.context }),
    // Multi-select (NEXT-VERSION §19). Keyed by the SONG, so a sort, a filter or a sync
    // keeps the picks. The set's menu is the ordinary track menu over many songs, which
    // is where "Add to Playlist ▸ New Playlist…" builds a list from a hand-picked set.
    pick: {
      id: trackId,
      can: o.mark ? (t) => !t.unreleased : undefined, // an unreleased song is never picked (SEARCH.md)
      menu: (ts) => setMenu(() => ts, ts.length, "song", { context: o.context }),
      drag: (ts) => ({ source: "library", kind: "song", count: ts.length, tracks: () => ts, context: o.context }),
      play: (ts) => void playTracks(ts, 0, o.context).catch((e) => console.error("[library] play picked", e)),
    },
  };
}

function albumsGrouping(
  list: () => Track[],
  openDetail: (a: AlbumGroup) => Context,
  nav?: LibNav,
): Grouping<AlbumGroup> {
  return {
    key: "albums",
    label: "Albums",
    sorts: albumSorts,
    list: () => groupAlbums(list()),
    name: (a) => a.name,
    match: (a, q) => a.name.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q),
    render: (a, density, idx) => musicCell(density, idx, a.artwork, a.name, a.artist),
    open: openDetail,
    // Right-click → act on the whole album, tracks in disc/track order.
    menu: (a) => albumMenu(libAlbum(albumOrder(list().filter((t) => albumKey(t) === a.key))), { context: `album:${a.key}`, nav }),
    drag: (a) => ({
      source: "library",
      kind: "album",
      count: a.count,
      tracks: () => albumOrder(list().filter((t) => albumKey(t) === a.key)),
      context: `album:${a.key}`,
    }),
    // Multi-select over tiles (NEXT-VERSION §19): pick several albums, then drag or file
    // them as one. The set's songs are each album's own order, albums back to back.
    pick: {
      noun: "album",
      id: (a) => a.key,
      menu: (as) => setMenu(() => albumsTracks(as, list), as.length, "album", { context: "albums:picked" }),
      drag: (as) => {
        const ts = albumsTracks(as, list);
        return { source: "library", kind: "album", count: ts.length, tracks: () => ts, context: "albums:picked" };
      },
      play: (as) => void playTracks(albumsTracks(as, list), 0, "albums:picked").catch((e) => console.error("[library] play albums", e)),
    },
  };
}

/** The songs of several albums, each in its own disc/track order, albums back to back. */
function albumsTracks(as: AlbumGroup[], list: () => Track[]): Track[] {
  const all = list();
  return as.flatMap((a) => albumOrder(all.filter((t) => albumKey(t) === a.key)));
}

function artistsGrouping(list: () => Track[], openDetail: (a: ArtistGroup) => Context, nav?: LibNav): Grouping<ArtistGroup> {
  return {
    key: "artists",
    label: "Artists",
    sorts: artistSorts,
    list: () => groupArtists(list()),
    name: (a) => a.name,
    match: (a, q) => a.name.toLowerCase().includes(q),
    render: (a, density, idx) =>
      musicCell(density, idx, a.artwork, a.name, `${a.songCount} song${a.songCount === 1 ? "" : "s"}`, { round: true }),
    open: openDetail,
    // Right-click → Start Station (the artist seed resolves lazily via one of their
    // songs — derived groups carry no catalog artist id; see start-station.ts).
    // The station and the link resolve the artist lazily via one of their songs (derived
    // groups carry no catalog artist id; see start-station.ts).
    menu: (a) =>
      artistMenu(
        { name: a.name, artwork: a.artwork, songs: artistOrder(creditIndex(list()).tracksFor(a.name)), inLibrary: true },
        { context: `artist:${a.name}`, nav },
      ),
    drag: (a) => ({
      source: "library",
      kind: "artist",
      count: a.songCount,
      tracks: () => artistOrder(creditIndex(list()).tracksFor(a.name)),
      context: `artist:${a.name}`,
    }),
    // Multi-select over tiles (§19): several artists, each one's songs in album order.
    pick: {
      noun: "artist",
      id: (a) => a.name,
      menu: (as) => setMenu(() => artistsTracks(as, list), as.length, "artist", { context: "artists:picked" }),
      drag: (as) => {
        const ts = artistsTracks(as, list);
        return { source: "library", kind: "artist", count: ts.length, tracks: () => ts, context: "artists:picked" };
      },
      play: (as) => void playTracks(artistsTracks(as, list), 0, "artists:picked").catch((e) => console.error("[library] play artists", e)),
    },
  };
}

/** The Genres view (the user's ask, 2026-09-17): one mosaic tile per genre, a drill to its songs.
 *  A genre is a collection the way an artist is, so it is a View, not only a sort. */
function genresGrouping(list: () => Track[], openDetail: (g: GenreGroup) => Context): Grouping<GenreGroup> {
  const sub = (g: GenreGroup) => `${g.songCount} song${g.songCount === 1 ? "" : "s"} · ${g.artistCount} artist${g.artistCount === 1 ? "" : "s"}`;
  return {
    key: "genres",
    label: "Genres",
    sorts: genreSorts,
    list: () => groupGenres(list()),
    name: (g) => g.name,
    match: (g, q) => g.name.toLowerCase().includes(q),
    render: (g, density, idx) => musicCell(density, idx, undefined, g.name, sub(g), { mosaic: g.covers, mosaicSeed: g.name }),
    open: openDetail,
    // A genre is a list, not one album or artist: play it, queue it, file it (no link).
    menu: (g) => listMenu(() => genreTracks(list(), g.name), { context: `genre:${g.name}` }),
    drag: (g) => ({ source: "library", kind: "artist", count: g.songCount, tracks: () => genreTracks(list(), g.name), context: `genre:${g.name}` }),
    pick: {
      noun: "genre",
      id: (g) => g.name,
      menu: (gs) => setMenu(() => gs.flatMap((g) => genreTracks(list(), g.name)), gs.length, "genre", { context: "genres:picked" }),
      drag: (gs) => {
        const ts = gs.flatMap((g) => genreTracks(list(), g.name));
        return { source: "library", kind: "artist", count: ts.length, tracks: () => ts, context: "genres:picked" };
      },
      play: (gs) => void playTracks(gs.flatMap((g) => genreTracks(list(), g.name)), 0, "genres:picked").catch((e) => console.error("[library] play genres", e)),
    },
  };
}

/** The songs of several artists, each one in album order, artists back to back. */
function artistsTracks(as: ArtistGroup[], list: () => Track[]): Track[] {
  const idx = creditIndex(list());
  return as.flatMap((a) => artistOrder(idx.tracksFor(a.name)));
}

// ── the card ────────────────────────────────────────────────────────────────────
// The card owns its header markup (back chevron + title + refresh) and the engine's
// .coll-body mount point, so it can be mounted into any slot.
const HEAD = `
  <header class="panel__head">
    <button class="panel__back" id="library-back" type="button" aria-label="Back" title="Goes back one step" hidden>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
    <h2 class="panel__title">Library</h2>
    <div class="coll-views" data-coll-views role="group" aria-label="Show" hidden></div>
    <button class="panel__action" id="library-refresh" type="button" aria-label="Refresh library" title="Reads your library from Apple Music again">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="23 4 23 10 17 10"></polyline>
        <polyline points="1 20 1 14 7 14"></polyline>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
      </svg>
    </button>
  </header>
  <div class="coll-body"></div>`;

export const libraryCard: CardDef = {
  id: "library",
  title: "Library",
  mount(host, mountOpts) {
    host.innerHTML = HEAD;
    const refreshBtn = host.querySelector<HTMLElement>("#library-refresh");

    // `tracks` is the shared store's live accessor — no per-card copy of the library.
    // detail contexts (filter live over the current cache via closures)
    // album detail: track number order feels right for an album, so default to it
    const albumDetail = (a: AlbumGroup, highlight?: Track): Context => {
      const list = () => tracks().filter((t) => albumKey(t) === a.key);
      return {
        title: a.name,
        key: `album:${a.key}`, // card memory (CARD-MEMORY.md §5)
        headerLabel: "Album",
        // The hero: cover, name, the artist as a tappable subtitle (→ artist detail), and
        // year · songs · length. Read live so a sync that adds a track updates the line.
        hero: () => {
          const ts = list();
          const artist = a.artist || ts[0]?.artistName || "";
          const year = (a.releaseDate ?? ts.find((t) => t.releaseDate)?.releaseDate)?.slice(0, 4);
          const total = formatTotal(ts.reduce((n, t) => n + (t.durationMs ?? 0), 0));
          // The ♥ state: asked once per install, the first time this hero draws (F1A). The
          // seed is the album's first song, as `albumMenu` picks it.
          reconcileAlbum({ seed: albumOrder(ts).find((t) => t.catalogId)?.catalogId, name: a.name });
          return {
            cover: heroCover(a.artwork ?? ts[0]?.artwork, a.name),
            title: a.name,
            sub: artist ? { text: artist, run: () => libNav.drillArtist(artist) } : undefined,
            meta: [year, `${ts.length} song${ts.length === 1 ? "" : "s"}`, total].filter(Boolean).join(" · "),
            // Right-click anywhere on the hero: the album's own menu, without Go to Album
            // (you are there) — CONTEXT-MENUS.md §3a.
            menu: () => albumMenu(libAlbum(albumOrder(list())), { context: `album:${a.key}`, nav: libNav, here: true }),
          };
        },
        density: true,
        groupings: [
          songsGrouping(list, {
            hideCover: true,
            numbered: true,
            selectedId: highlight ? trackId(highlight) : undefined,
            context: `album:${a.key}`,
            nav: libNav,
          }),
        ],
        defaults: { density: "lines", sortKey: "track" },
        // Full | Lib (FULL-LIB.md): Full is Apple's whole album, in place of this level.
        views: {
          options: FULL_LIB,
          active: "lib",
          to: (k) => {
            if (k !== "full") return null;
            const ts = list();
            return full.album({ libKey: a.key, songId: ts.find((t) => t.catalogId)?.catalogId, name: a.name, artist: a.artist || ts[0]?.artistName, artwork: a.artwork ?? ts[0]?.artwork });
          },
        },
      };
    };

    // artist detail (ARTIST-VIEW.md): the Search artist pane's order — a round hero, then the
    // Albums, Featured Playlists and Your Playlists shelves, then the artist's Songs as rows.
    // The playlist shelves fill in as their facts land.
    const artistDetail = (a: ArtistGroup): Context => {
      const sub = () => creditIndex(tracks()).tracksFor(a.name);
      let info: LibraryArtistInfo | null = null; // photo + featured playlists (0–2 Apple calls, saved)
      let yours: YourPlaylists | undefined; // the user's playlists with this artist (0 calls)
      let checking: CheckProgress | null = null;
      let albumList: AlbumGroup[] = []; // the Albums shelf as last drawn (a tile's index → its album)

      // The Songs rows' extra sorts (ARTIST-VIEW.md §1). Popular = Apple's top-songs order
      // (call 2 brings it with the featured playlists: no extra call), then the rest newest
      // first. Most Played = this app's own play counts (zero calls).
      let plays: Map<string, PlayCount> | undefined;
      void playCounts()
        .then((m) => {
          plays = m;
          card.reload();
        })
        .catch((e) => console.error("[library] play counts", e));
      // A library song matches a top song by catalog id, then ISRC, then title — library and
      // catalog ids can differ for the same recording. Rebuilt when the info changes.
      const matchKeys = (t: Track) => [t.catalogId, t.isrc ? `isrc:${t.isrc}` : undefined, `title:${t.title.toLowerCase()}`];
      let ranksOf: LibraryArtistInfo | null = null;
      let ranks = new Map<string, number>();
      const popularity = (t: Track): number | undefined => {
        if (ranksOf !== info) {
          ranksOf = info;
          ranks = new Map();
          (info?.topSongs ?? []).forEach((s, i) => {
            for (const k of matchKeys(s)) if (k && !ranks.has(k)) ranks.set(k, i);
          });
        }
        for (const k of matchKeys(t)) {
          const r = k ? ranks.get(k) : undefined;
          if (r !== undefined) return r;
        }
        // Not a top song: after every top song, newest first (a later date = a smaller value).
        const ms = t.releaseDate ? Date.parse(t.releaseDate) : NaN;
        return Number.isFinite(ms) ? 1e15 - ms : undefined;
      };
      const artistSongSorts: SortSpec<Track>[] = [
        { key: "popular", label: "Popular", type: "num", get: popularity },
        {
          key: "plays",
          label: "Most Played",
          type: "num",
          // Full listens lead, starts break a tie; a song never played goes last.
          get: (t) => {
            const c = plays?.get(playsKey(t));
            return c ? -(c.full * 1e6 + c.partial) : undefined;
          },
        },
      ];
      // Newest first, as the Search pane lists them; an album with no date goes last.
      const albumsShelf = (): string => {
        albumList = groupAlbums(sub()).sort((x, y) => (y.releaseDate ?? "").localeCompare(x.releaseDate ?? ""));
        const tiles = albumList
          .map((al, i) => {
            const url = artURL(al.artwork, 128);
            const cover = url
              ? `<img class="search__tile-art" src="${esc(url)}" alt="" loading="lazy" decoding="async" data-art />`
              : `<div class="search__tile-art search__tile-art--empty" aria-hidden="true">♪</div>`;
            return (
              `<div class="search__tile" data-shelf-item="album" data-shelf-idx="${i}" role="button" tabindex="0">${cover}` +
              `<span class="search__tile-name">${esc(al.name)}</span><span class="search__tile-sub">${esc(al.releaseDate?.slice(0, 4) ?? "")}</span></div>`
            );
          })
          .join("");
        return tiles ? `<div class="search__label">Albums</div><div class="search__scroller search__scroller--albums">${tiles}</div>` : "";
      };
      void libraryArtistInfo(a.name, sub().map((t) => t.catalogId))
        .then((i) => {
          info = i;
          card.reload();
        })
        .catch((e) => console.error("[library] artist info", e));
      const loadYours = () =>
        yourPlaylistsFor(a.name)
          .then((y) => {
            yours = y;
            card.reload();
          })
          .catch((e) => console.error("[library] your playlists", e));
      void loadYours();
      return {
        title: a.name,
        key: `artist:${a.name}`, // card memory (CARD-MEMORY.md §5)
        headerLabel: "Artist",
        // Until the photo is known, a song's album cover stands in (round).
        hero: () => {
          const ts = sub();
          const albums = groupAlbums(ts).length;
          return {
            cover: heroCover(info?.artwork ?? ts.find((t) => t.artwork)?.artwork, a.name, undefined, undefined, true),
            // The cover's menu: the artist's own menu, without Go to Artist (you are there).
            // The pin's snapshot carries the catalog id and photo, so it outlives the
            // artist's songs leaving the library (PINS.md).
            coverMenu: () =>
              artistMenu(
                { name: a.name, catalogId: info?.catalogId, artwork: info?.artwork, songs: artistOrder(ts), inLibrary: true },
                { context: `artist:${a.name}`, here: true },
              ),
            // The same menu anywhere on the hero, as the Search artist pane has it (his call 1A).
            menu: () =>
              artistMenu(
                { name: a.name, catalogId: info?.catalogId, artwork: info?.artwork, songs: artistOrder(sub()), inLibrary: true },
                { context: `artist:${a.name}`, here: true },
              ),
            title: a.name,
            meta: `${albums} album${albums === 1 ? "" : "s"} · ${ts.length} song${ts.length === 1 ? "" : "s"}`,
          };
        },
        shelves: () => artistShelvesHTML(info?.featuredPlaylists, yours, checking, albumsShelf()),
        // Sort / View / Search act only on the Songs rows, so they sit under this label.
        toolbarBelow: "Songs",
        // An album drills in place. A featured playlist opens as a Search pane; one of yours in
        // the Playlists card — each after the chip flight, which fetches the songs first so the
        // view arrives full (§5). "Check N more" fetches the unopened ones (§3).
        onShelf: (el) => {
          const i = Number(el.dataset.shelfIdx);
          const kind = el.dataset.shelfItem;
          if (kind === "album") {
            const al = albumList[i];
            if (al) card.drill(albumDetail(al));
          } else if (kind === "featured") {
            const p = info?.featuredPlaylists?.[i];
            const id = p?.catalogId;
            if (p && id) {
              const intent = { id, name: p.name, artwork: p.artwork, curatorName: p.curatorName };
              handOff(el, "search", () => collectionTracks("playlists", id), (ts) => requestPlaylistPane({ ...intent, tracks: ts }));
            }
          } else if (kind === "yours") {
            const p = yours?.hits[i]?.p;
            const lid = p?.libraryId;
            if (p && lid) handOff(el, "playlists", () => playlistTracks(p), (ts) => requestOpenPlaylist(lid, ts), p.trackCount);
          } else if (kind === "check" && yours && !checking) {
            checking = { done: 0, total: yours.unchecked.length };
            card.reload();
            void checkPlaylists(yours.unchecked, (pr) => {
              checking = pr;
              card.reload();
            })
              .then(loadYours)
              .finally(() => {
                checking = null;
                card.reload();
              });
          }
        },
        shelfMenu: (el) => {
          const i = Number(el.dataset.shelfIdx);
          if (el.dataset.shelfItem === "album") {
            const al = albumList[i];
            return al ? albumMenu(libAlbum(albumOrder(tracks().filter((t) => albumKey(t) === al.key))), { context: `album:${al.key}`, nav: libNav, inArtist: true }) : [];
          }
          if (el.dataset.shelfItem === "featured") {
            const p = info?.featuredPlaylists?.[i];
            const id = p?.catalogId;
            return p && id ? playlistMenu(p, () => collectionTracks("playlists", id), { context: `search-playlists:${id}`, catalog: true }) : [];
          }
          const p = el.dataset.shelfItem === "yours" ? yours?.hits[i]?.p : undefined;
          return p ? playlistMenu(p, () => playlistTracks(p), { context: `playlist:${p.libraryId}` }) : [];
        },
        density: true,
        // The Albums shelf replaces the old Albums grouping; the rows are the artist's songs.
        groupings: [
          songsGrouping(sub, {
            context: `artist:${a.name}`,
            nav: libNav,
            extraSorts: artistSongSorts,
            // The rows are every song by the artist in YOUR library (not the catalog discography).
            actionTitles: {
              play: `Play every song by ${a.name} in your library, in this order`,
              shuffle: `Shuffle every song by ${a.name} in your library`,
            },
          }),
        ],
        defaults: { density: "lines", sortKey: "release", sortDir: "desc" },
        // Full | Lib (FULL-LIB.md): Full is Apple's artist page, in place of this level.
        views: {
          options: FULL_LIB,
          active: "lib",
          to: (k) => (k === "full" ? full.artist({ name: a.name, id: info?.catalogId, artwork: info?.artwork }) : null),
        },
      };
    };

    // In-place drill nav for the library's menus: "Go to Artist/Album" pushes the same
    // context the artist/album tile would, over the user's library. Defined here (not at
    // module scope) because it closes over `card` (the drill target) and the detail-context
    // builders; `card` isn't assigned until below, but these run only on a menu click, long
    // after init. creditIndex is memoized per library array, so `artistNames` is cheap.
    // Library drills in place; every other surface routes Go-to to the catalog Search card
    // (go-to.ts). In-place vs Search is a future toggle — see docs/FUTURE-SETTINGS.md §20.
    const libNav: LibNav = {
      artistNames: (t) => creditIndex(tracks()).namesOf(t),
      drillArtist: (name) => card.drill(artistDetail({ name, albumCount: 0, songCount: 0 })),
      drillAlbum: (t) =>
        card.drill(
          albumDetail({ key: albumKey(t), name: t.albumName ?? "Unknown Album", artist: t.artistName ?? "", count: 0 }, t),
        ),
      drillGenre: (name) => card.drill(genreDetail({ name, songCount: 0, artistCount: 0, covers: [] })),
      drillSong: (t) => card.drill(songDetail(t)),
    };

    // Full | Lib (docs/features/FULL-LIB.md): Apple's whole album or artist page as a level
    // of this card, in place of the Lib level. A Full level goes back to Lib only when the
    // library holds some of it: an album by its key, or by any of its songs (catalog id, ISRC).
    const libAlbumOf = (t: Track) =>
      albumDetail({ key: albumKey(t), name: t.albumName ?? "Unknown Album", artist: t.artistName ?? "", count: 0, artwork: t.artwork, releaseDate: t.releaseDate });
    const full: FullViews = fullViews({
      card: () => card,
      songs: songsGrouping,
      heroCover,
      artURL,
      nav: libNav,
      libAlbum: (songs, libKey) => {
        const all = tracks();
        const byKey = libKey ? all.find((t) => albumKey(t) === libKey) : undefined;
        if (byKey) return libAlbumOf(byKey);
        const ids = new Set(songs.flatMap((s) => [s.catalogId, s.isrc ? `isrc:${s.isrc}` : undefined]).filter(Boolean));
        const hit = ids.size ? all.find((t) => ids.has(t.catalogId) || (t.isrc && ids.has(`isrc:${t.isrc}`))) : undefined;
        return hit ? libAlbumOf(hit) : null;
      },
      libArtist: (name) => (creditIndex(tracks()).tracksFor(name).length ? artistDetail({ name, albumCount: 0, songCount: 0 }) : null),
    });

    // ── song detail and writer detail (CREDITS.md §7.6) ──
    // A song is a LOCAL target: every fact on the level is already in hand, so it drills
    // here rather than summoning the Search card (go-to.ts, "the rule and its limit").
    // The engine wants a list at every level, and a song's natural list is its WRITERS —
    // so the level is a hero, the facts as a shelf, and one row per writer.

    const songFacts = (t: Track): string => {
      const rows: [string, string][] = [];
      if (t.albumName) rows.push(["Album", t.albumName]);
      const genres = (t.genres ?? []).filter((g) => g !== "Music");
      if (genres.length) rows.push(["Genre", genres.join(", ")]);
      if (t.releaseDate) rows.push(["Released", t.releaseDate.slice(0, 10)]);
      if (t.durationMs) rows.push(["Length", fmtClock(t.durationMs)]);
      if (t.isrc) rows.push(["ISRC", t.isrc]);
      if (!rows.length) return "";
      return `<div class="search__label">Details</div><dl class="credit__facts">${rows
        .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
        .join("")}</dl>`;
    };

    const songDetail = (t: Track): Context => {
      let credit = creditsFor(t.catalogId);
      let reading = false;
      let readFailed = false;
      if (!credit)
        void primeCredits([t.catalogId]).then(async () => {
          credit = creditsFor(t.catalogId);
          card.reload();
          // Never read: the gap is ours, so close it rather than blame Apple. One call.
          if (t.catalogId && !credit) {
            reading = true;
            card.reload();
            try {
              await fetchCredits([t.catalogId]);
            } catch {
              readFailed = true;
            }
            reading = false;
            credit = creditsFor(t.catalogId);
            card.reload();
          }
        });
      const names = () => credit?.names ?? [];
      const gap = () =>
        readFailed ? CREDITS_READ_FAILED
        : reading ? CREDITS_READING
        : credit?.state === "none" ? CREDITS_NONE
        : CREDITS_READING;
      // Credit order is the order Apple sent, and it carries meaning (the lead writer
      // leads). It is the default sort, so the rows read as Apple wrote them.
      const orderOf = (n: string) => names().indexOf(n);
      return {
        title: t.title,
        key: `song:${t.catalogId ?? trackId(t)}`, // card memory (CARD-MEMORY.md §5)
        headerLabel: "Song",
        hero: () => ({
          cover: heroCover(t.artwork, t.title),
          title: t.title,
          sub: t.artistName ? { text: t.artistName, run: () => libNav.drillArtist(t.artistName) } : undefined,
          meta: [t.albumName, t.releaseDate?.slice(0, 4), fmtClock(t.durationMs)].filter(Boolean).join(" · "),
        }),
        shelves: () => songFacts(t) + (names().length ? "" : `<p class="credit__note">${esc(gap())}</p>`),
        toolbarBelow: CREDITS_LABEL,
        density: false,
        groupings: [
          {
            key: "writers",
            label: CREDITS_LABEL,
            sorts: [
              { key: "credit", label: "Credit order", type: "num", get: orderOf },
              { key: "name", label: "Name", type: "str", get: (n: string) => n },
            ],
            list: names,
            name: (n: string) => n,
            match: (n: string, q: string) => n.toLowerCase().includes(q),
            render: (n: string, density: Density, idx: number) =>
              musicCell(density, idx, undefined, n, "Writer", { round: true }),
            open: (n: string) => writerDetail(n),
          } as Grouping<string>,
        ],
        defaults: { density: "lines", sortKey: "credit" },
      };
    };

    // Every song the app has collected that credits one writer (CREDITS.md §5.2): one
    // local join, no Apple call. A row the app holds a track for plays like any song row;
    // one it met through a web read and never materialized is a flat row.
    const writerDetail = (name: string): Context => {
      let rows: WriterSong[] = [];
      let loaded = false;
      let searching = false;
      void songsByWriter(name).then((r) => {
        rows = r;
        loaded = true;
        card.reload();
      });
      const list = () => rows;
      return {
        title: name,
        key: `writer:${name}`, // card memory (CARD-MEMORY.md §5)
        headerLabel: "Writer",
        hero: () => ({
          cover: heroCover(undefined, name, undefined, undefined, true),
          title: name,
          meta: loaded
            ? `${rows.length} song${rows.length === 1 ? "" : "s"} collected`
            : "Reading…",
        }),
        // The Apple search fills THIS level in place (the user's call 2026-09-17), so the
        // page you asked the question from is the page that answers it.
        shelves: () =>
          loaded
            ? `<p class="credit__note">${esc(WRITER_REACH)}</p>` +
              `<button type="button" class="credit__chip" data-shelf-item="writer-search" ${searching ? "disabled" : ""}>${
                searching ? "Searching…" : `Search Apple Music for “${esc(name)}”`
              }</button>` +
              `<p class="credit__note">${esc(WRITER_SEARCH_NOTE)}</p>`
            : "",
        onShelf: (el) => {
          if (el.dataset.shelfItem !== "writer-search" || searching) return;
          searching = true;
          card.reload();
          void searchAppleForWriter(name)
            .then((found) => { rows = found; })
            .finally(() => { searching = false; card.reload(); });
        },
        density: true,
        groupings: [
          {
            key: "writerSongs",
            label: "Songs",
            sorts: [
              { key: "yours", label: "Yours first", type: "num", get: (s: WriterSong) => -s.mine },
              { key: "title", label: "Title", type: "str", get: (s: WriterSong) => s.title },
              { key: "artist", label: "Artist", type: "str", get: (s: WriterSong) => s.artistName },
            ],
            list,
            name: (s: WriterSong) => s.title,
            match: (s: WriterSong, q: string) =>
              s.title.toLowerCase().includes(q) || s.artistName.toLowerCase().includes(q),
            render: (s: WriterSong, density: Density, idx: number) =>
              musicCell(density, idx, s.track?.artwork, s.title, s.artistName, {
                cid: s.catalogId,
                badge: s.track ? "" : FLAT_MARK,
              }),
            // Only the songs we hold a track for can play, so the click acts on those.
            activate: (s: WriterSong, _idx: number, items: WriterSong[]) => {
              if (!s.track) return;
              const playable = items.filter((x) => x.track).map((x) => x.track!);
              const at = playable.findIndex((x) => x === s.track);
              void playTracks(playable, Math.max(0, at), `writer:${name}`).catch((e) =>
                console.error("[library] play writer song", e),
              );
            },
            menu: (s: WriterSong) => (s.track ? songMenu(s.track, { context: `writer:${name}`, nav: libNav }) : []),
          } as Grouping<WriterSong>,
        ],
        defaults: { density: "lines", sortKey: "yours" },
      };
    };

    // ── genre detail: every song of one genre (the Genres view's drill, the Compass's row) ──
    const genreDetail = (g: GenreGroup): Context => {
      const list = () => genreTracks(tracks(), g.name);
      return {
        title: g.name,
        key: `genre:${g.name}`, // card memory (CARD-MEMORY.md §5)
        headerLabel: "Genre",
        hero: () => {
          const ts = list();
          const live = groupGenres(ts)[0];
          const total = formatTotal(ts.reduce((n, t) => n + (t.durationMs ?? 0), 0));
          return {
            cover: heroCover(undefined, g.name, live?.covers, g.name),
            title: g.name,
            meta: [`${ts.length} song${ts.length === 1 ? "" : "s"}`, `${live?.artistCount ?? 0} artist${live?.artistCount === 1 ? "" : "s"}`, total].filter(Boolean).join(" · "),
          };
        },
        density: true,
        groupings: [
          songsGrouping(list, { context: `genre:${g.name}`, nav: libNav, plays: () => rootPlays }),
          albumsGrouping(list, albumDetail, libNav),
          artistsGrouping(list, artistDetail, libNav),
        ],
        defaults: { grouping: "songs", density: "lines", sortKey: "az", sortDir: "asc" },
      };
    };

    // ♥ filter (the toolbar pill): narrows the SOURCE list, so songs, albums and artists
    // all reduce to what holds a favorite. Session state; the engine draws the pill.
    let favOnly = false;
    const source = (): Track[] => (favOnly ? tracks().filter(isLoved) : tracks());
    // The play tallies (one local read, zero Apple calls): the Plays sort and, on a filled
    // card, the Plays column (CARD-GROW.md §9a).
    let rootPlays: Map<string, PlayCount> | undefined;
    // The Pinned shelf (PINS.md): this card's kinds, above the Play / Shuffle row (9B). A
    // tile does what the card's own rows do — an album or an artist drills, a song plays.
    const pinShelfMenu = (el: HTMLElement): MenuItem[] => {
      const it = pinShelfItem(el);
      if (!it) return [];
      // Off the library (`whole`), the drill-ins go to the CATALOG pane, because this
      // card's nav can only drill what the library holds.
      return tileMenu(it, it.whole ? {} : { nav: libNav });
    };
    // One rule for every Pinned shelf (PINS.md §8.4): the pin's own verb decides, and this
    // card can open an album or an artist in place, so it says so.
    const pinShelfOpen = (el: HTMLElement) => {
      const it = pinShelfItem(el);
      if (!it) return;
      pinActivate(it, "library", {
        openAlbum: (t) => libNav.drillAlbum(t),
        openArtist: () => libNav.drillArtist(it.title),
      });
    };
    const rootContext = (): Context => ({
      title: "Library",
      density: true,
      shelves: () => pinnedShelfHTML(["album", "artist", "song"]),
      shelfDrag: pinDragRow, // the grip moves a pinned tile along the shelf (MOVABLE-ROWS.md §5.2)
      shelvesFirst: true,
      onShelf: pinShelfOpen,
      shelfMenu: pinShelfMenu,
      groupings: [
        songsGrouping(source, { context: "library", nav: libNav, plays: () => rootPlays }),
        albumsGrouping(source, albumDetail, libNav),
        artistsGrouping(source, artistDetail, libNav),
        genresGrouping(source, genreDetail),
      ],
      defaults: { grouping: "songs", density: "lines", sortKey: "az", sortDir: "asc" },
      filter: { label: "Favorites only", icon: ICON_HEART, active: () => favOnly, toggle: () => { favOnly = !favOnly; } },
    });

    // Header state for the slot picker: track root/title and replay it to late subscribers.
    let lastHeader = { title: "Library", atRoot: true };
    const headerSubs = new Set<(h: { title: string; atRoot: boolean }) => void>();
    // Card memory (CARD-MEMORY.md §5): a level's key back into its context, over the live
    // store. A name or an album that is no longer in the library resolves to null, and the
    // restore stops at the level above it.
    const resolve = (key: string): Context | null => {
      const i = key.indexOf(":");
      const kind = key.slice(0, i);
      const name = key.slice(i + 1);
      if (kind === "artist") {
        return creditIndex(tracks()).tracksFor(name).length ? artistDetail({ name, albumCount: 0, songCount: 0 }) : null;
      }
      if (kind === "album") {
        const t = tracks().find((x) => albumKey(x) === name);
        return t
          ? albumDetail({ key: name, name: t.albumName ?? "Unknown Album", artist: t.artistName ?? "", count: 0, artwork: t.artwork, releaseDate: t.releaseDate })
          : null;
      }
      if (kind === "genre") return genreTracks(tracks(), name).length ? genreDetail({ name, songCount: 0, artistCount: 0, covers: [] }) : null;
      // A song level is keyed by its catalog id, over the live store: a song no longer in
      // the library ends the restore there, as an album that has gone does.
      if (kind === "song") {
        const t = tracks().find((x) => (x.catalogId ?? trackId(x)) === name);
        return t ? songDetail(t) : null;
      }
      // A writer level needs no store: its rows are read again from the collection.
      if (kind === "writer") return name ? writerDetail(name) : null;
      // A Full level (FULL-LIB.md) is keyed by its catalog id and reads Apple's page again.
      if (kind === "full-album" || kind === "full-artist") return full.resolve(key);
      return null;
    };
    const card = initCollectionCard({
      root: host,
      storeKey: "deets.library.view",
      rootContext,
      resolve,
      onReturn: mountOpts?.onReturn,
      returnTitle: mountOpts?.returnTitle,
      onHeader: (h) => {
        lastHeader = h;
        headerSubs.forEach((cb) => cb(h));
      },
      grown: () => (host.dataset.grow as "wide" | "tall" | "full" | undefined) ?? null,
    });
    void playCounts()
      .then((m) => {
        rootPlays = m;
        if (host.dataset.grow === "full") card.reload(); // the Plays column is on screen
      })
      .catch((e) => console.error("[library] play counts", e));
    // A grow or a collapse of THIS card (CARD-GROW.md §6): the rows build again at the new
    // width — columns and the letter rail in, or out. The place in the list is kept.
    let lastGrow = host.dataset.grow;
    const unsubGrow = onGrowChange(() => {
      if (host.dataset.grow === lastGrow) return;
      lastGrow = host.dataset.grow;
      card.reload();
    });

    // ── render from the shared store + refresh-button state ──
    // The store owns loading/reloading (incl. on sync-done); we just re-render when it
    // changes. The collection card starts empty and fills when the first load lands.
    // Library rows come from the synced store only — a transient ingest (a catalog-only
    // playlist/search play) changes nothing this card shows, so it must not re-render.
    const unsubTracks = onTracksChange((why) => why === "library" && card.reload(), "library.reload");
    const unsubPins = onPinsChange(() => card.reload());
    // An artist or an album asked for from outside (the Compass, COMPASS.md §2).
    const takeDrill = () => {
      const d = takeLibraryDrill();
      if (!d) return;
      if (d.kind === "artist") libNav.drillArtist(d.name);
      else if (d.kind === "genre") libNav.drillGenre(d.name);
      else libNav.drillAlbum(d.track);
    };
    const unsubDrill = onLibraryDrill(takeDrill);
    takeDrill(); // this card was mounted BY a request
    // Card memory (CARD-MEMORY.md §4): a held request above wins, so `restore` refuses once
    // that drill is open. The library store may still be loading on a cold start: the body
    // waits (hidden) and the levels build when the first tracks land.
    if (mountOpts?.memory && card.depth() === 1) {
      if (!card.restore(mountOpts.memory)) {
        card.hold();
        const un = onTracksChange((why) => {
          if (why !== "library") return;
          un();
          card.restore(mountOpts.memory);
        }, "library.memory");
      }
    }
    const unsubFavs = onFavoritesChange(() => card.reload()); // the ♥ filter follows the mirror

    const syncUnlisten = onSyncEvent((e) => {
      if (e.phase === "start") refreshBtn?.classList.add("is-busy");
      if (e.phase === "done") {
        refreshBtn?.classList.remove("is-busy");
        console.log(`[sync] cached ${e.count}/${e.total} songs`);
      }
      if (e.phase === "error") {
        refreshBtn?.classList.remove("is-busy"); // don't spin forever on a failed sync
        console.error(`[sync] incomplete (${e.count}/${e.total} cached): ${e.message}`);
      }
    });

    // A drop on the Library card adds the songs to the library, as Add to Library does
    // (DRAG-DROP.md §3, fork 1). Not a target while the Library Add setting is off; the
    // Library's own drags don't land here.
    const unregisterDrop = registerDropTarget({
      el: host,
      over: (_under, _x, _y, p) =>
        libraryAddEnabled() && p.source !== "library" && p.kind !== "station" ? { highlight: host, drop: () => dropToLibrary(p) } : null,
    });

    const triggerSync = () => librarySync().catch((e) => console.error("[sync]", e));
    // The ⟳ also marks every saved featured-playlist list as old (ARTIST-VIEW.md §4).
    refreshBtn?.addEventListener("click", () => {
      expireArtistInfo();
      void triggerSync();
    });
    // (The startup stale-while-revalidate sync lives in initTrackStore now — once per
    // session, so remounting this card on a slot swap never re-triggers a full sync.)

    return {
      snapshot: () => card.snapshot(),
      destroy() {
        unsubTracks();
      unsubPins();
        unsubDrill();
        unsubFavs();
        unsubGrow();
        unregisterDrop();
        syncUnlisten.then((un) => un()).catch(() => {});
        card.destroy();
        host.innerHTML = "";
      },
      onHeaderChange(cb) {
        headerSubs.add(cb);
        cb(lastHeader); // replay current state immediately
        return () => headerSubs.delete(cb);
      },
    };
  },
};
