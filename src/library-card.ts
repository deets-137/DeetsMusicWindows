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
import { playTracks, queueTracksNext, queueTracksLater } from "./player";
import { addToPlaylistItem } from "./playlists";
import { startStationItem, startArtistStationItem } from "./start-station";
import { goToArtistItem, goToAlbumItem } from "./go-to";
import { initCollectionCard, esc, type Context, type Grouping, type SortSpec, type Density } from "./collection-card";
import type { MenuItem } from "./context-menu";
import type { CardDef } from "./cards";

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
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
function rowThumb(art: Artwork | undefined, round: boolean, name: string): string {
  const r = round ? " lib-row__art--round" : "";
  const url = artURL(art, 72);
  if (url) return `<img class="lib-row__art${r}" src="${esc(url)}" alt="" loading="lazy" data-art />`;
  return `<div class="lib-row__art${r} lib-row__art--empty" aria-hidden="true">${round ? esc(initials(name)) : "♪"}</div>`;
}
function tileCover(art: Artwork | undefined, px: number, round: boolean, name: string): string {
  const r = round ? " lib-tile__cover--round" : "";
  const url = artURL(art, px);
  if (url) return `<img class="lib-tile__cover${r}" src="${esc(url)}" alt="" loading="lazy" data-art />`;
  return `<div class="lib-tile__cover${r} lib-tile__cover--empty" aria-hidden="true">${round ? esc(initials(name)) : "♪"}</div>`;
}
const px = (density: Density) => (density === "large" ? 300 : 160);

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
  opts: { round?: boolean; hideCover?: boolean; selected?: boolean; badge?: string } = {},
): string {
  const { round = false, hideCover = false, selected = false, badge = "" } = opts;
  return density === "lines"
    ? rowHTML(idx, primary, sub, hideCover ? undefined : rowThumb(art, round, primary), selected, badge)
    : tileHTML(idx, tileCover(art, px(density), round, primary), primary, sub, selected, badge);
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

export function trackMenu(items: Track[], context?: string, nav?: LibNav): MenuItem[] {
  const err = (what: string) => (e: unknown) => console.error(`[library] ${what}`, e);
  return [
    { label: "Play Now", run: () => void playTracks(items, 0, context).catch(err("play now")) },
    { label: "Play Next", run: () => void queueTracksNext(items, context).catch(err("play next")) },
    { label: "Add to Queue", run: () => void queueTracksLater(items, context).catch(err("add to queue")) },
    addToPlaylistItem(() => items),
    ...goToItems(items, nav),
    // A station seeds from ONE song — a longer list is an album, which has no station.
    ...(items.length === 1 ? [startStationItem("songs", items[0].catalogId)] : []),
  ].filter(Boolean) as MenuItem[];
}

// ── groupings ─────────────────────────────────────────────────────────────────
interface SongOpts {
  hideCover?: boolean; // album detail: every track shares the cover, so omit it
  selectedId?: string; // highlight this track (e.g. drilled-in)
  context?: string; // queue-origin tag for entries played from this list
  nav?: LibNav; // in-place "Go to Artist/Album" (Library only)
}
function songsGrouping(list: () => Track[], o: SongOpts = {}): Grouping<Track> {
  return {
    key: "songs",
    label: "Songs",
    sorts: songSorts,
    list,
    name: (t) => t.title,
    match: (t, q) =>
      t.title.toLowerCase().includes(q) ||
      t.artistName.toLowerCase().includes(q) ||
      (t.albumName?.toLowerCase().includes(q) ?? false),
    render: (t, density, idx) =>
      musicCell(density, idx, t.artwork, t.title, t.artistName, {
        hideCover: o.hideCover,
        selected: !!o.selectedId && trackId(t) === o.selectedId,
      }),
    // Click a song → play it and queue the rest of THIS list from here, in the
    // current sort order (the engine hands us the live sorted view).
    activate: (_t, idx, items) =>
      playTracks(items, idx, o.context).catch((e) => console.error("[library] play", e)),
    // Right-click → act on just this song (Play Now plays only it; see docs/FUTURE-SETTINGS).
    menu: (t) => trackMenu([t], o.context, o.nav),
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
  };
}

// ── the card ────────────────────────────────────────────────────────────────────
// The card owns its header markup (back chevron + title + refresh) and the engine's
// .coll-body mount point, so it can be mounted into any slot.
const HEAD = `
  <header class="panel__head">
    <button class="panel__back" id="library-back" type="button" aria-label="Back" hidden>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
    <h2 class="panel__title">Library</h2>
    <button class="panel__action" id="library-refresh" type="button" aria-label="Refresh library">
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
    const albumDetail = (a: AlbumGroup, highlight?: Track): Context => ({
      title: a.name,
      density: true,
      groupings: [
        songsGrouping(() => tracks().filter((t) => albumKey(t) === a.key), {
          hideCover: true,
          selectedId: highlight ? trackId(highlight) : undefined,
          context: `album:${a.key}`,
          nav: libNav,
        }),
      ],
      defaults: { density: "lines", sortKey: "az" },
    });

    const artistDetail = (a: ArtistGroup): Context => {
      const sub = () => creditIndex(tracks()).tracksFor(a.name);
      return {
        title: a.name,
        density: true,
        groupings: [albumsGrouping(sub, albumDetail, libNav), songsGrouping(sub, { context: `artist:${a.name}`, nav: libNav })],
        defaults: { grouping: "albums", density: "small", sortKey: "release", sortDir: "desc" },
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

    const rootContext = (): Context => ({
      title: "Library",
      density: true,
      groupings: [
        songsGrouping(tracks, { context: "library", nav: libNav }),
        albumsGrouping(tracks, albumDetail, libNav),
        artistsGrouping(tracks, artistDetail),
      ],
      defaults: { grouping: "songs", density: "lines", sortKey: "az", sortDir: "asc" },
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
    const unsubTracks = onTracksChange(() => card.reload());

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

    const triggerSync = () => librarySync().catch((e) => console.error("[sync]", e));
    refreshBtn?.addEventListener("click", triggerSync);
    // (The startup stale-while-revalidate sync lives in initTrackStore now — once per
    // session, so remounting this card on a slot swap never re-triggers a full sync.)

    return {
      destroy() {
        unsubTracks();
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
