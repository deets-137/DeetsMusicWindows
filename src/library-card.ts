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

import { librarySync, onSyncBusy, onSyncEvent, onSyncStatus, syncBusy, syncStatus, type Track, type Artwork } from "./library";
import { syncHint } from "./sync-hint";
import { showHintNow } from "./hint";
import { creditIndex } from "./artist-credit";
import { tracks, onTracksChange, noCatalogCopy, addTransientTracks, tracksLoaded } from "./track-store";
import { materializeTrack } from "./search";
import { playTracks, shuffledStart } from "./player";
import { onLibraryDrill, onLibraryFilter, takeLibraryDrill, takeLibraryFilter } from "./layout-bus";
import { drawFilterPanel, emptyRule, type FilterState, type PanelHost } from "./filter-panel";
import { filterRow, filtersReady, libraryKeys, onFiltersChange } from "./filters";
import { trackKey } from "./filter-eval";
import { onSuggestChange } from "./suggest";
import { onDiaryChange } from "./diary";
import { isLoved, onFavoritesChange } from "./favorites";
import { songMenu, albumMenu, artistMenu, listMenu, setMenu, tileMenu } from "./media-menu";
import { initCollectionCard, esc, type Context, type Grouping, type SortSpec, type Density, type ActionTitles, type ColumnMode, type ColumnSpec, formatTotal } from "./collection-card";
import { onGrowChange } from "./card-grow";
import type { MenuItem } from "./context-menu";
import type { CardDef } from "./cards";
import { registerDropTarget } from "./row-drag";
import { dropToLibrary } from "./drop-actions";
import { libraryAddEnabled } from "./library-add";
import { mosaicHTML } from "./mosaic";
import { expireArtistInfo, playCounts, type PlayCount } from "./artist-view";
import { pinActivate, pinnedShelfHTML, pinShelfItem, onPinsChange, pinDragRow } from "./pins";
import { addSquareHTML, markCellHTML } from "./add-square";
import { unreleasedHint } from "./release";
import { type AlbumGroup, albumKey, groupAlbums, albumOrder, artistOrder, libAlbum, artURL, trackId, playsKey, fmtClock } from "./library-model";
import { mediaLevels } from "./media-levels";
import * as diag from "./diag";
import { ROW_PX, TILE_PX, HERO_PX } from "./art-size";

// ── derived models ────────────────────────────────────────────────────────────
// The album model and its pure helpers live in library-model.ts (shared with the album and
// artist levels, media-levels.ts); the ones other modules import from here are re-exported.
export { albumKey, albumOrder, artistOrder, libAlbum, fmtClock };
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
  const url = artURL(art, ROW_PX);
  if (url) return `<img class="lib-row__art${r}" src="${esc(url)}" alt="" loading="lazy" decoding="async" data-art />`;
  if (mosaic?.length) return mosaicHTML("lib-row__art", mosaic, seed ?? name);
  return `<div class="lib-row__art${r} lib-row__art--empty" aria-hidden="true">${round ? esc(initials(name)) : "♪"}</div>`;
}
function tileCover(art: Artwork | undefined, px: number, round: boolean, name: string, mosaic?: string[], seed?: string): string {
  const r = round ? " lib-tile__cover--round" : "";
  const url = artURL(art, px);
  if (url) return `<img class="lib-tile__cover${r}" src="${esc(url)}" alt="" loading="lazy" decoding="async" data-art />`;
  if (mosaic?.length) return mosaicHTML("lib-tile__cover", mosaic, seed ?? name, px);
  return `<div class="lib-tile__cover${r} lib-tile__cover--empty" aria-hidden="true">${round ? esc(initials(name)) : "♪"}</div>`;
}
// The cover-size ladder (art-size.ts): a small tile takes the tile step, a large one the hero step.
const px = (density: Density) => (density === "large" ? HERO_PX : TILE_PX);

/** The detail hero's cover (a real cover, a mosaic, or the ♪ placeholder). Fetched at the
 *  ladder's hero step (art-size.ts), over 2× the token size, so it stays crisp on a HiDPI
 *  panel. `round` = an artist's photo. */
export function heroCover(art: Artwork | undefined, name: string, mosaic?: string[], seed?: string, round = false): string {
  const cls = round ? "lib-hero__cover lib-hero__cover--round" : "lib-hero__cover";
  const url = artURL(art, HERO_PX);
  if (url) return `<img class="${cls}" src="${esc(url)}" alt="${esc(name)}" decoding="async" data-art />`;
  if (mosaic?.length) return mosaicHTML(cls, mosaic, seed ?? name);
  return `<div class="${cls} lib-hero__cover--empty" aria-hidden="true">${round ? esc(initials(name)) : "♪"}</div>`;
}


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
/** This app's own play tallies (zero Apple calls): most played first under the default ↑. */
const playsSort = (plays: () => Map<string, PlayCount> | undefined): SortSpec<Track> => ({
  key: "plays",
  label: "Plays",
  type: "num",
  // His ask (2026-10-23): the tally is this app's own; plays in Apple's app never reach it.
  hint: "Plays counts only listens on DeetsMusic, not on Apple Music",
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
// tallies are known). An album's list (`numbered`) leads with the mark column (no header:
// the ♥ square in the Lib view; + / ✓ / ♥ in the Full view, CARD-GROW.md §9b) and the track
// number, and drops the Album and ♥ columns: every row shares the album, and the mark is the ♥.
const HEART_MARK =
  '<svg class="lib-row__heart-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/></svg>';
const END = "lib-cols__cell--end";
function songColumns(cols: ColumnMode, o: SongOpts, list: () => Track[]): ColumnSpec[] {
  // The # column is as wide as the album's widest number, so the gap on each side of a
  // number is the card's column gap (his ask, 2026-10-01). The "#↑" header may be wider:
  // it spills left into the mark column's empty header (styles.css).
  const digits = o.numbered ? String(Math.max(1, ...list().map((t, i) => t.trackNumber ?? i + 1))).length : 0;
  const specs: ColumnSpec[] = [
    ...(o.numbered
      ? [
          { key: "mark", label: "", width: "var(--grow-col-mark)" },
          { key: "lead", label: "#", sortKey: "track", width: `calc(${digits} * var(--grow-col-num-digit))`, cls: `${END} lib-cols__cell--spill` },
        ]
      : [{ key: "lead", label: "", width: "auto" }]),
    { key: "title", label: "Title", sortKey: "az", width: "minmax(0, 2fr)" },
    { key: "artist", label: "Artist", sortKey: "artist", width: "minmax(0, 1.3fr)" },
    ...(o.hideCover ? [] : [{ key: "album", label: "Album", sortKey: "album", width: "minmax(0, 1.3fr)" }]),
    { key: "time", label: "Length", sortKey: "time", width: "var(--grow-col-time)", cls: END },
    ...(o.numbered ? [] : [{ key: "heart", label: "♥", width: "var(--grow-col-heart)", cls: "lib-cols__cell--center" }]),
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
  const lead = o.numbered
    ? `<span class="lib-row__mark">${markCellHTML(t, !!o.mark)}</span><span class="lib-row__num lib-row__cell--end">${t.trackNumber ?? idx + 1}</span>`
    : rowThumb(t.artwork, false, t.title);
  const cells = [
    lead,
    `<span class="lib-row__cell lib-row__title">${esc(t.title)}${explicitBadge(t)}${o.mark && !o.numbered ? markSquare(t) : ""}</span>`,
    `<span class="lib-row__cell lib-row__artist">${esc(t.artistName)}</span>`,
    ...(o.hideCover ? [] : [`<span class="lib-row__cell lib-row__album">${esc(t.albumName ?? "")}</span>`]),
    `<span class="lib-row__cell lib-row__cell--end lib-row__time">${fmtClock(t.durationMs)}</span>`,
    ...(o.numbered ? [] : [`<span class="lib-row__cell lib-row__cell--center lib-row__heart">${isLoved(t) ? HEART_MARK : ""}</span>`]),
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
// A library song with no catalog copy (heal.rs) wears the same dim: it cannot play either.
const NO_COPY_HINT = "Apple Music has no copy of this song now. DeetsMusic looks again in 7 days";
const dimUnreleased = (html: string, t: Track, mark: boolean): string =>
  mark && t.unreleased
    ? html.replace('class="lib-row', `aria-disabled="true" title="${esc(unreleasedHint(t))}" class="lib-row is-unreleased`)
    : noCatalogCopy(t)
      ? html.replace('class="lib-row', `aria-disabled="true" title="${NO_COPY_HINT}" class="lib-row is-unreleased`)
      : html;

/** Apple's songs join the store before they play (FAVORITES.md): the session's transient set
 *  and the durable row, so the play's stats resolve to the song. */
const joinStore = (ts: Track[]) => {
  const out = ts.filter((t) => !t.unreleased);
  addTransientTracks(out);
  out.forEach(materializeTrack);
};

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
    columns: (cols) => songColumns(cols, o, list),
    isSelected: o.selectedId ? (t) => trackId(t) === o.selectedId : undefined,
    // Click a song → play it and queue the rest of THIS list from here, in the
    // current sort order (the engine hands us the live sorted view). Apple's rows (`mark`)
    // join the store first, as a Search play always did (playTracks drops the unreleased).
    activate: (_t, idx, items) => {
      if (o.mark) joinStore(items);
      playTracks(items, idx, o.context).catch((e) => console.error("[library] play", e));
    },
    playAll: o.actionTitles ?? true, // the Play / Shuffle row (NEXT-VERSION §13)
    // Right-click → act on this song; Play Now's scope (just it, or it then the list)
    // is the setting (SETTINGS.md / FUTURE-SETTINGS §1).
    menu: (t, idx, items) => songMenu(t, { context: o.context, nav: o.nav, listFrom: { items, idx }, catalog: o.mark }),
    drag: (t) => ({ source: "library", kind: "song", tracks: () => [t], context: o.context }),
    // Multi-select (NEXT-VERSION §19). Keyed by the SONG, so a sort, a filter or a sync
    // keeps the picks. The set's menu is the ordinary track menu over many songs, which
    // is where "Add to Playlist ▸ New Playlist…" builds a list from a hand-picked set.
    pick: {
      id: trackId,
      can: o.mark ? (t) => !t.unreleased : undefined, // an unreleased song is never picked (SEARCH.md)
      menu: (ts) => setMenu(() => ts, ts.length, "song", { context: o.context, catalog: o.mark }),
      drag: (ts) => ({ source: "library", kind: "song", count: ts.length, tracks: () => ts, context: o.context }),
      play: (ts, start) => {
        if (o.mark) joinStore(ts);
        void playTracks(ts, start, o.context).catch((e) => console.error("[library] play picked", e));
      },
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
      play: (as) => void playTracks(...shuffledStart(albumsTracks(as, list)), "albums:picked").catch((e) => console.error("[library] play albums", e)),
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
      play: (as) => void playTracks(...shuffledStart(artistsTracks(as, list)), "artists:picked").catch((e) => console.error("[library] play artists", e)),
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
      play: (gs) => void playTracks(...shuffledStart(gs.flatMap((g) => genreTracks(list(), g.name))), "genres:picked").catch((e) => console.error("[library] play genres", e)),
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
    <div class="coll-views" data-coll-views hidden></div>
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

    // The album, artist, song and writer levels (media-levels.ts, ARTIST-VIEW.md §10.1): one
    // builder per page, shared with the Search card. Their Go to drills stay in this card (a
    // Lib row pushes the same level its tile would); a genre is this card's own view, so it
    // opens here. `card` is assigned below; these run only on a press, long after init.
    const levels = mediaLevels({
      card: () => card,
      songs: songsGrouping,
      heroCover,
      cell: musicCell,
      genre: (name) => card.drill(genreDetail({ name, songCount: 0, artistCount: 0, covers: [] })),
    });
    const libNav: LibNav = levels.nav;

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
          albumsGrouping(list, (a) => levels.libAlbum(a), libNav),
          artistsGrouping(list, (a) => levels.libArtist(a.name), libNav),
        ],
        defaults: { grouping: "songs", density: "lines", sortKey: "az", sortDir: "asc" },
      };
    };

    // ♥ filter (the toolbar pill): narrows the SOURCE list, so songs, albums and artists
    // all reduce to what holds a favorite. Session state; the engine draws the pill.
    let favOnly = false;
    // The Filter (the third pop; features/filter-rules.md §13.3): a condition asked of each song.
    // `passKeys` = the songs that pass, null with no condition. Session state, as the ♥ pill;
    // it narrows the SOURCE list too, so albums, artists and genres follow it.
    let fState: FilterState = { rule: emptyRule(), savedId: null, result: null };
    let passKeys: Set<string> | null = null;
    let fGen = 0;
    let keepNextOpen = false; // the next open of the panel keeps the rule in force (*Edit the rule*)
    const recheck = async () => {
      const g = ++fGen;
      const c = fState.rule.if;
      if (!c) passKeys = null;
      else {
        try {
          const r = await libraryKeys(c);
          if (g !== fGen) return; // a newer check started
          passKeys = r.keys;
          fState = { ...fState, result: { shown: r.keys.size, total: r.total, missing: r.missing } };
        } catch (e) {
          diag.warn("filter:check", { e: String(e) });
          return;
        }
      }
      card.rulePop.mark(!!c);
      card.reload();
      card.rulePop.redraw();
    };
    const panelHost: PanelHost = {
      state: () => fState,
      apply: (rule, savedId) => {
        fState = { rule, savedId, result: null };
        card.rulePop.redraw(); // "Counting…" at once
        void recheck();
      },
    };
    const source = (): Track[] => {
      const all = favOnly ? tracks().filter(isLoved) : tracks();
      const keys = passKeys;
      return keys ? all.filter((t) => keys.has(trackKey(t) ?? "")) : all;
    };
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
    // The first read of the library: the reveal holds until it lands (UX-COVERUPS.md §7.1).
    let tracksIn = false;
    const rootContext = (): Context => ({
      title: "Library",
      density: true,
      loading: () => !tracksIn,
      // A first sync (a sign-in on a fresh install) says how far it is in the empty card, in
      // the ⟳'s own words, instead of "Nothing here yet." (2026-10-23, his pick).
      get emptyText() {
        const s = syncStatus();
        return s && !tracks().length ? syncHint(s) : undefined;
      },
      shelves: () => pinnedShelfHTML(["album", "artist", "song"]),
      shelfDrag: pinDragRow, // the grip moves a pinned tile along the shelf (MOVABLE-ROWS.md §5.2)
      shelvesFirst: true,
      onShelf: pinShelfOpen,
      shelfMenu: pinShelfMenu,
      groupings: [
        songsGrouping(source, { context: "library", nav: libNav, plays: () => rootPlays }),
        albumsGrouping(source, (a) => levels.libAlbum(a), libNav),
        artistsGrouping(source, (a) => levels.libArtist(a.name), libNav),
        genresGrouping(source, genreDetail),
      ],
      defaults: { grouping: "songs", density: "lines", sortKey: "az", sortDir: "asc" },
      filter: { label: "Favorites only", icon: ICON_HEART, active: () => favOnly, toggle: () => { favOnly = !favOnly; } },
      rulePop: {
        label: "Filter", title: "Shows only the songs a rule picks: a genre, a year, songs you loved, and more",
        active: () => !!fState.rule.if,
        draw: (panel) => drawFilterPanel(panel, panelHost),
        // A Rulez Playlist made or edited here is done once the panel shuts: the next open starts
        // fresh, for a new rule (his call, 2026-10-16). A saved filter you use stays in force.
        // *Edit the rule* opens on its playlist on purpose, so that one open keeps it.
        opening: () => {
          if (keepNextOpen) return void (keepNextOpen = false);
          if (fState.savedId && filterRow(fState.savedId)?.playlistId != null) panelHost.apply(emptyRule(), null);
        },
      },
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
      if (kind === "genre") return genreTracks(tracks(), name).length ? genreDetail({ name, songCount: 0, artistCount: 0, covers: [] }) : null;
      // An album, an artist (Lib or Full, FULL-LIB.md), a song, a writer, an Apple playlist:
      // the levels module reads its own keys.
      return levels.resolve(key);
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
    void tracksLoaded().then(() => {
      tracksIn = true;
      card.reload();
    });
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
    // Only while the store is still EMPTY does a retry wait for it: with tracks in hand, a key
    // that did not resolve is gone for good (the album left the library), and the listener
    // that stayed armed rebuilt the root on the next library notify — at the remembered
    // scroll, over the query the user had typed and the rows they had picked (2026-09-29).
    if (mountOpts?.memory && card.depth() === 1) {
      if (!card.restore(mountOpts.memory) && tracks().length === 0) {
        card.hold();
        const un = onTracksChange((why) => {
          if (why !== "library") return;
          un();
          card.restore(mountOpts.memory);
        }, "library.memory");
      }
    }
    const unsubFavs = onFavoritesChange(() => card.reload()); // the ♥ filter follows the mirror
    // A filter in force follows what it reads: the library, loved, Suggest Less, the Diary.
    // (A sync's reload is above; this one checks again first, then reloads.)
    const refilter = () => void (fState.rule.if && recheck());
    const unsubRefilter = [
      onTracksChange((why) => why === "library" && refilter(), "library.filter"),
      onFavoritesChange(refilter),
      onSuggestChange(refilter),
      onDiaryChange(refilter),
      onFiltersChange(() => card.rulePop.redraw()), // a save, a rename, a hand edit's Keep / Never
    ];
    // A saved filter asked for from outside (a Rulez Playlist's *Edit the rule*, the Compass):
    // put it in force at the root and open the panel on it.
    const takeFilter = () => {
      const id = takeLibraryFilter();
      if (!id) return;
      void filtersReady().then(() => {
        const row = filterRow(id);
        if (!row) return;
        card.toRoot();
        panelHost.apply(JSON.parse(JSON.stringify(row.rule)), id);
        keepNextOpen = !card.rulePop.isOpen(); // this open shows the rule it was asked for (an open panel just redraws)
        requestAnimationFrame(() => card.rulePop.open());
      });
    };
    const unsubFilter = onLibraryFilter(takeFilter);
    takeFilter(); // this card was mounted BY a request

    // The ⟳ spins while any sync holds the lock, the launch's and the ⟳'s own alike, from
    // the lock to its release (library.ts `onSyncBusy`; a card that mounts mid-sync spins too).
    const unsubBusy = onSyncBusy((b) => refreshBtn?.classList.toggle("is-busy", b));
    // Its hover hint says what runs and how far (sync-hint.ts); hint.ts takes the new words
    // while the box is up, so the count moves under a resting pointer.
    // The empty card shows the same words (rootContext's emptyText), so it redraws with them.
    let emptyWords = "";
    const unsubStatus = onSyncStatus((s) => {
      const words = syncHint(s);
      if (refreshBtn && refreshBtn.dataset.hint !== words) refreshBtn.title = words;
      const shown = !tracks().length && s ? words : "";
      if (shown !== emptyWords) {
        emptyWords = shown;
        card.reload();
      }
    });
    const syncUnlisten = onSyncEvent((e) => {
      if (e.phase === "done") console.log(`[sync] cached ${e.count}/${e.total} songs`);
      if (e.phase === "error") console.error(`[sync] incomplete (${e.count}/${e.total} cached): ${e.message}`);
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
      // A sync runs (the ⟳ spins): Rust would refuse the click, so it does not go out
      // (ideas/apple-calls.md §4). Logged, not a console error: the refusal is expected.
      // The click shows the hint at once and the ⟳ dips once: the answer sits on the control.
      if (syncBusy()) {
        diag.log("library:refreshBusy", syncStatus());
        if (refreshBtn) {
          showHintNow(refreshBtn);
          refreshBtn.classList.remove("is-nudged");
          void refreshBtn.offsetWidth; // a second click while it dips starts the dip again
          refreshBtn.classList.add("is-nudged");
          const off = (e: AnimationEvent) => {
            if (e.animationName !== "action-nudge") return; // not the glyph's spin
            refreshBtn.classList.remove("is-nudged");
            refreshBtn.removeEventListener("animationend", off);
          };
          refreshBtn.addEventListener("animationend", off);
        }
        return;
      }
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
        unsubRefilter.forEach((u) => u());
        unsubFilter();
        unsubGrow();
        unregisterDrop();
        syncUnlisten.then((un) => un()).catch(() => {});
        unsubBusy();
        unsubStatus();
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
