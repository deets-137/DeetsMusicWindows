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

import { setting } from "./settings-store";
import { librarySync, onSyncEvent, type Track, type Artwork } from "./library";
import { creditIndex } from "./artist-credit";
import { tracks, onTracksChange } from "./track-store";
import { playTracks, queueTracksNext, queueTracksLater } from "./player";
import { addToPlaylistItem, requestOpenPlaylist, playlistTracks } from "./playlists";
import { startStationItem, startArtistStationItem } from "./start-station";
import { favoriteItem, isLoved, onFavoritesChange } from "./favorites";
import { goToArtistItem, goToAlbumItem, requestPlaylistPane } from "./go-to";
import { copySongLinkItem, copyAlbumLinkFromSongItem } from "./copy-link";
import { initCollectionCard, esc, type Context, type Grouping, type SortSpec, type Density, type ActionTitles, formatTotal } from "./collection-card";
import type { MenuItem } from "./context-menu";
import type { CardDef } from "./cards";
import { registerDropTarget } from "./row-drag";
import { dropToLibrary } from "./drop-actions";
import { libraryAddEnabled } from "./library-add";
import { mosaicHTML } from "./mosaic";
import {
  libraryArtistInfo, expireArtistInfo, yourPlaylistsFor, checkPlaylists, artistShelvesHTML, playlistShelfMenu,
  playCounts, type LibraryArtistInfo, type YourPlaylists, type CheckProgress, type PlayCount,
} from "./artist-view";
import { handOff } from "./handoff";
import { collectionTracks } from "./search";

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
const albumKey = (t: Track) => {
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

function rowHTML(idx: number, title: string, sub: string, thumb?: string, selected = false, badge = ""): string {
  const art = thumb ? thumb : "";
  // `badge` (a source sigil) rides the row's trailing edge (right-aligned via CSS).
  return `<div class="lib-row${thumb ? " lib-row--art" : ""}${selected ? " is-selected" : ""}" data-idx="${idx}">${art}<div class="lib-row__text"><span class="lib-row__title">${esc(
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
  opts: { round?: boolean; hideCover?: boolean; selected?: boolean; badge?: string; mosaic?: string[]; mosaicSeed?: string; num?: number } = {},
): string {
  const { round = false, hideCover = false, selected = false, badge = "", mosaic, mosaicSeed, num } = opts;
  // `num` (an album's track number) takes the cover's slot on a line row.
  const slot = num !== undefined ? `<span class="lib-row__num">${num}</span>` : hideCover ? undefined : rowThumb(art, round, primary, mosaic, mosaicSeed);
  return density === "lines"
    ? rowHTML(idx, primary, sub, slot, selected, badge)
    : tileHTML(idx, tileCover(art, px(density), round, primary, mosaic, mosaicSeed), primary, sub, selected, badge);
}

// ── sort specs (per grouping) ────────────────────────────────────────────────────
// "Added Date" negates the rank so ascending (the default ↑) puts the MOST
// recently added first; the ↓ arrow flips to oldest-first.
const recency = (rank: number | undefined) => (rank == null ? undefined : -rank);
const songSorts: SortSpec<Track>[] = [
  { key: "az", label: "A–Z", type: "str", get: (t) => t.title },
  { key: "release", label: "Release Date", type: "str", get: (t) => t.releaseDate },
  { key: "added", label: "Added Date", type: "num", get: (t) => recency(t.addedRank) },
];
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

// ── right-click menu (Play Now / Play Next / Add to Queue) ───────────────────────
// One builder for songs and albums: a song is a 1-track list; an album is its tracks
// in disc/track order. "Play Now" plays the list from the top (a song → just that song;
// an album → the whole album as the new context). Next/Later insert without a rebuild.
export const albumOrder = (ts: Track[]): Track[] =>
  [...ts].sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0));
/** An artist's songs in album order: albums oldest first, each in disc/track order (a drag). */
const artistOrder = (ts: Track[]): Track[] =>
  [...ts].sort(
    (a, b) =>
      (a.releaseDate ?? "").localeCompare(b.releaseDate ?? "") ||
      (a.albumName ?? "").localeCompare(b.albumName ?? "") ||
      (a.discNumber ?? 1) - (b.discNumber ?? 1) ||
      (a.trackNumber ?? 0) - (b.trackNumber ?? 0),
  );

/**
 * In-place drill navigation for a card's right-click menus. When passed to `trackMenu`
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
}

// The album's dominant credited artist (mode of each track's leading credit) — the
// "Go to Artist" target for an album tile, where a per-track featured guest shouldn't
// win. Always a credited name, so it resolves to a real library artist group.
function dominantArtist(items: Track[], nav: LibNav): string | undefined {
  const counts = new Map<string, number>();
  for (const t of items) {
    const primary = nav.artistNames(t)[0];
    if (primary) counts.set(primary, (counts.get(primary) ?? 0) + 1);
  }
  let best: string | undefined;
  let top = 0;
  for (const [name, c] of counts) if (c > top) { top = c; best = name; }
  return best;
}

// The "Go to Artist" / "Go to Album" verbs for a menu — in-place over the library when
// `nav` is present, else the catalog drill-in (Search). A song (1-track list) can go to
// its album; an album (longer list) can only go to its artist.
function goToItems(items: Track[], nav?: LibNav): (MenuItem | null)[] {
  const first = items[0];
  if (!first) return [];
  if (!nav) {
    return [
      goToArtistItem("songs", first.catalogId, first.artistName),
      items.length === 1 ? goToAlbumItem(first.catalogId, first.albumName) : null,
    ];
  }
  let artistItem: MenuItem | null;
  if (items.length > 1) {
    const dom = dominantArtist(items, nav);
    artistItem = dom ? { label: "Go to Artist", run: () => nav.drillArtist(dom) } : null;
  } else {
    const names = nav.artistNames(first);
    artistItem =
      names.length === 0
        ? null
        : names.length === 1
          ? { label: "Go to Artist", run: () => nav.drillArtist(names[0]) }
          : { label: "Go to Artist", sub: () => names.map((n) => ({ label: n, run: () => nav.drillArtist(n) })) };
  }
  const albumItem =
    items.length === 1 && first.albumName ? { label: "Go to Album", run: () => nav.drillAlbum(first) } : null;
  return [artistItem, albumItem];
}

/** The list a song sits in, for "Play Now → the song, then the list" (SETTINGS.md / §1). */
export interface ListFrom {
  items: Track[];
  idx: number;
}

export function trackMenu(items: Track[], context?: string, nav?: LibNav, listFrom?: ListFrom): MenuItem[] {
  const err = (what: string) => (e: unknown) => console.error(`[library] ${what}`, e);
  // Play Now scope: the song then the rest of its list (default — the same play a
  // left-click does), or just the song(s). Only a single song inside a list can widen.
  const playNow =
    listFrom && items.length === 1 && setting("playNowScope") === "list"
      ? () => playTracks(listFrom.items, listFrom.idx, context)
      : () => playTracks(items, 0, context);
  return [
    { label: "Play Now", run: () => void playNow().catch(err("play now")) },
    { label: "Play Next", run: () => void queueTracksNext(items, context).catch(err("play next")) },
    { label: "Add to Queue", run: () => void queueTracksLater(items, context).catch(err("add to queue")) },
    addToPlaylistItem(() => items),
    ...goToItems(items, nav),
    // One song → its own link; a longer list is an album tile → the album's link,
    // resolved from any of its songs that has a catalog id.
    items.length === 1
      ? copySongLinkItem(items[0].catalogId)
      : copyAlbumLinkFromSongItem(items.find((t) => t.catalogId)?.catalogId),
    // A station seeds from ONE song — a longer list is an album, which has no station.
    ...(items.length === 1 ? [startStationItem("songs", items[0].catalogId)] : []),
    // ♥ — one song only (an album has no favorite here); null without consent/catalog id.
    ...(items.length === 1 ? [favoriteItem(items[0])] : []),
  ].filter(Boolean) as MenuItem[];
}

// ── groupings ─────────────────────────────────────────────────────────────────
interface SongOpts {
  hideCover?: boolean; // album detail: every track shares the cover, so omit it
  numbered?: boolean; // album detail: track number in the cover's slot, length as the subline
  selectedId?: string; // highlight this track (e.g. drilled-in)
  context?: string; // queue-origin tag for entries played from this list
  nav?: LibNav; // in-place "Go to Artist/Album" (Library only)
  extraSorts?: SortSpec<Track>[]; // appended to the Sort menu (the artist view's Popular / Most Played)
  actionTitles?: ActionTitles; // hover text for the Play / Shuffle row (what the list is)
}
function songsGrouping(list: () => Track[], o: SongOpts = {}): Grouping<Track> {
  return {
    key: "songs",
    label: "Songs",
    sorts: [...(o.numbered ? trackSorts : songSorts), ...(o.extraSorts ?? [])],
    list,
    name: (t) => t.title,
    match: (t, q) =>
      t.title.toLowerCase().includes(q) ||
      t.artistName.toLowerCase().includes(q) ||
      (t.albumName?.toLowerCase().includes(q) ?? false),
    render: (t, density, idx) =>
      musicCell(density, idx, t.artwork, t.title, o.numbered && density === "lines" ? fmtClock(t.durationMs) : t.artistName, {
        hideCover: o.hideCover,
        num: o.numbered && density === "lines" ? (t.trackNumber ?? idx + 1) : undefined,
        selected: !!o.selectedId && trackId(t) === o.selectedId,
        badge: explicitBadge(t),
      }),
    isSelected: o.selectedId ? (t) => trackId(t) === o.selectedId : undefined,
    // Click a song → play it and queue the rest of THIS list from here, in the
    // current sort order (the engine hands us the live sorted view).
    activate: (_t, idx, items) =>
      playTracks(items, idx, o.context).catch((e) => console.error("[library] play", e)),
    playAll: o.actionTitles ?? true, // the Play / Shuffle row (NEXT-VERSION §13)
    // Right-click → act on this song; Play Now's scope (just it, or it then the list)
    // is the setting (SETTINGS.md / FUTURE-SETTINGS §1).
    menu: (t, idx, items) => trackMenu([t], o.context, o.nav, { items, idx }),
    drag: (t) => ({ source: "library", kind: "song", tracks: () => [t], context: o.context }),
    // Multi-select (NEXT-VERSION §19). Keyed by the SONG, so a sort, a filter or a sync
    // keeps the picks. The set's menu is the ordinary track menu over many songs, which
    // is where "Add to Playlist ▸ New Playlist…" builds a list from a hand-picked set.
    pick: {
      id: trackId,
      menu: (ts) => trackMenu(ts, o.context, o.nav),
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
    menu: (a) => trackMenu(albumOrder(list().filter((t) => albumKey(t) === a.key)), `album:${a.key}`, nav),
    drag: (a) => ({
      source: "library",
      kind: "album",
      count: a.count,
      tracks: () => albumOrder(list().filter((t) => albumKey(t) === a.key)),
      context: `album:${a.key}`,
    }),
  };
}

function artistsGrouping(list: () => Track[], openDetail: (a: ArtistGroup) => Context): Grouping<ArtistGroup> {
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
    menu: (a) =>
      [
        startArtistStationItem(
          a.name,
          creditIndex(list())
            .tracksFor(a.name)
            .map((t) => t.catalogId),
        ),
      ].filter(Boolean) as MenuItem[],
    drag: (a) => ({
      source: "library",
      kind: "artist",
      count: a.songCount,
      tracks: () => artistOrder(creditIndex(list()).tracksFor(a.name)),
      context: `artist:${a.name}`,
    }),
  };
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
  mount(host) {
    host.innerHTML = HEAD;
    const refreshBtn = host.querySelector<HTMLElement>("#library-refresh");

    // `tracks` is the shared store's live accessor — no per-card copy of the library.
    // detail contexts (filter live over the current cache via closures)
    // album detail: track number order feels right for an album, so default to it
    const albumDetail = (a: AlbumGroup, highlight?: Track): Context => {
      const list = () => tracks().filter((t) => albumKey(t) === a.key);
      return {
        title: a.name,
        headerLabel: "Album",
        // The hero: cover, name, the artist as a tappable subtitle (→ artist detail), and
        // year · songs · length. Read live so a sync that adds a track updates the line.
        hero: () => {
          const ts = list();
          const artist = a.artist || ts[0]?.artistName || "";
          const year = (a.releaseDate ?? ts.find((t) => t.releaseDate)?.releaseDate)?.slice(0, 4);
          const total = formatTotal(ts.reduce((n, t) => n + (t.durationMs ?? 0), 0));
          return {
            cover: heroCover(a.artwork ?? ts[0]?.artwork, a.name),
            title: a.name,
            sub: artist ? { text: artist, run: () => libNav.drillArtist(artist) } : undefined,
            meta: [year, `${ts.length} song${ts.length === 1 ? "" : "s"}`, total].filter(Boolean).join(" · "),
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
            const c = plays?.get(t.libraryId ?? t.catalogId ?? "");
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
        headerLabel: "Artist",
        // Until the photo is known, a song's album cover stands in (round).
        hero: () => {
          const ts = sub();
          const albums = groupAlbums(ts).length;
          return {
            cover: heroCover(info?.artwork ?? ts.find((t) => t.artwork)?.artwork, a.name, undefined, undefined, true),
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
            return al ? trackMenu(albumOrder(tracks().filter((t) => albumKey(t) === al.key)), `album:${al.key}`, libNav) : [];
          }
          if (el.dataset.shelfItem === "featured") {
            const id = info?.featuredPlaylists?.[i]?.catalogId;
            return id ? playlistShelfMenu(() => collectionTracks("playlists", id), `search-playlists:${id}`, true) : [];
          }
          const p = el.dataset.shelfItem === "yours" ? yours?.hits[i]?.p : undefined;
          return p ? playlistShelfMenu(() => playlistTracks(p), `playlist:${p.libraryId}`, false) : [];
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
    };

    // ♥ filter (the toolbar pill): narrows the SOURCE list, so songs, albums and artists
    // all reduce to what holds a favorite. Session state; the engine draws the pill.
    let favOnly = false;
    const source = (): Track[] => (favOnly ? tracks().filter(isLoved) : tracks());
    const rootContext = (): Context => ({
      title: "Library",
      density: true,
      groupings: [
        songsGrouping(source, { context: "library", nav: libNav }),
        albumsGrouping(source, albumDetail, libNav),
        artistsGrouping(source, artistDetail),
      ],
      defaults: { grouping: "songs", density: "lines", sortKey: "az", sortDir: "asc" },
      filter: { label: "Favorites only", icon: ICON_HEART, active: () => favOnly, toggle: () => { favOnly = !favOnly; } },
    });

    // Header state for the slot picker: track root/title and replay it to late subscribers.
    let lastHeader = { title: "Library", atRoot: true };
    const headerSubs = new Set<(h: { title: string; atRoot: boolean }) => void>();
    const card = initCollectionCard({
      root: host,
      storeKey: "deets.library.view",
      rootContext,
      onHeader: (h) => {
        lastHeader = h;
        headerSubs.forEach((cb) => cb(h));
      },
    });

    // ── render from the shared store + refresh-button state ──
    // The store owns loading/reloading (incl. on sync-done); we just re-render when it
    // changes. The collection card starts empty and fills when the first load lands.
    // Library rows come from the synced store only — a transient ingest (a catalog-only
    // playlist/search play) changes nothing this card shows, so it must not re-render.
    const unsubTracks = onTracksChange((why) => why === "library" && card.reload(), "library.reload");
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
      destroy() {
        unsubTracks();
        unsubFavs();
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
