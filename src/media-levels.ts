// The album and artist levels (ARTIST-VIEW.md §10.1, FULL-LIB.md). One builder per page, two
// data sources: your library (Lib) and Apple's page (Full). The builder owns the parts and
// where they sit — the hero and its menus, the facts box, the shelves, the rows, the sorts,
// Full | Lib — and a source supplies only the data. So a part added to one level is on the
// other too (the facts box was missing from Full until 2026-10-12, his find).
//
// The levels are collection-card levels (`Context`), card-agnostic: a card makes its own set
// with `mediaLevels(deps)` and its own engine handle. Today that card is the Library; the
// Search card's Apple panes come next (§10, one step at a time).
//
// Full | Lib stays a swap, not a filter (his call, 2026-10-13): the chips replace the level
// through the engine's `replace`, so Back still goes to where the drill came from. A drill
// always opens Lib (FULL-LIB.md fork 3A); Full is the only thing here that asks Apple, and
// only on the press.
//
// Apple calls (all memory-only, session caches in search.ts):
//   Full album  — the song → album hop (1, memoized) + the album's songs (1, cached).
//                 An album opened from an artist's shelf already has its id: 1.
//   Full artist — the artist's page (1, cached). The id is the one the Lib artist view
//                 saved in `artist_catalog` (0), else 1 hop.
//   Lib artist  — the photo and featured playlists (0–2, saved).
// Card memory keys each Full level by its catalog id, so a restore re-reads through the caches.
//
// The facts box arrives in place: `heroAside`, never a card reload (the flicker, LISTENERS.md
// §6b). Each level asks once, by the names it opened with; a Full level restored by its id
// asks when Apple has told it the artist's name.

import type { Artwork, Track } from "./library";
import { TILE_PX } from "./art-size";
import type { Playlist } from "./search";
import type { CollectionCardHandle, Context, Density, Grouping, SortSpec, ViewOption, ViewSwitch } from "./collection-card";
import { formatTotal, esc } from "./collection-card";
import type { LibNav, SongOpts } from "./library-card";
import type { MenuItem } from "./context-menu";
import { catalogRelated, collectionTracks, artistDetail, searchCatalog, materializeTrack, type Album, type ArtistDetail } from "./search";
import { notesFor, notesNow, type NotesRef } from "./album-notes";
import { foldName, shortText, songPart } from "./album-notes-parse";
import type { NotesViewData } from "./present";
import { playTracks } from "./player";
import {
  creditsFor, primeCredits, songsByWriter, fetchCredits, searchAppleForWriter,
  CREDITS_LABEL, CREDITS_NONE, CREDITS_READING, CREDITS_READ_FAILED,
  WRITER_REACH, WRITER_SEARCH_NOTE, FLAT_MARK,
  type WriterSong,
} from "./credits";
import { comingMark, releaseAt } from "./release";
import {
  libraryArtistInfo, yourPlaylistsFor, checkPlaylists, artistShelvesHTML, artistInfoHTML, playCounts,
  type LibraryArtistInfo, type YourPlaylists, type CheckProgress, type PlayCount,
} from "./artist-view";
import { albumInfoFor, albumInfoNow, artistInfoFor, artistInfoNow, songInfoFor, songInfoKey, songInfoNow, type ArtistInfo } from "./listeners";
import { albumInfoHTML, songInfoHTML } from "./info-box";
import { needsAlbumWiki } from "./notes-order";
import { noteText } from "./lastfm-names";
import { setting } from "./settings-store";
import { creditIndex } from "./artist-credit";
import { tracks, addTransientTracks } from "./track-store";
import { reconcileAlbum, reconcilePlaylist, type AlbumFav } from "./favorites";
import { albumMenu, artistMenu, playlistMenu, songMenu, type ArtistSubject } from "./media-menu";
import { handOff } from "./handoff";
import { requestPlaylistPane } from "./go-to";
import { requestOpenPlaylist, playlistTracks } from "./playlists";
import { type AlbumGroup, albumKey, groupAlbums, albumOrder, artistOrder, libAlbum, artURL, trackId, playsKey, fmtClock } from "./library-model";
import * as diag from "./diag";

/** The two chips, Full first (the owner's words, 2026-09-24). */
export const FULL_LIB: ViewOption[] = [
  { key: "full", label: "Full", title: "Shows the whole album or artist from Apple Music" },
  { key: "lib", label: "Lib", title: "Shows only the songs in your library" },
];
const withOff = (off: () => string | undefined): ViewOption[] => FULL_LIB.map((o) => (o.key === "lib" ? { ...o, off } : o));

export interface LevelDeps {
  card: () => CollectionCardHandle;
  songs: (list: () => Track[], o: SongOpts) => Grouping<Track>;
  heroCover: (art: Artwork | undefined, name: string, mosaic?: string[], seed?: string, round?: boolean) => string;
  /** The shared row cell (library-card.ts `musicCell`), for the rows that are not songs. */
  cell: typeof import("./library-card").musicCell;
  /** A genre, from a Lib row's Go to Genre: the Library's own view. The Library opens it in
   *  place; any other card summons the Library (his call, 2026-10-13). */
  genre: (name: string) => void;
  /** Apple's playlists open in this card (the Search card). Absent: in the Search card,
   *  after the chip flight (the Library, ARTIST-VIEW.md §5). */
  playlistsHere?: boolean;
}

/** An Apple playlist (a Search result, a Featured tile): what the caller knows already. */
export interface PlaylistSource {
  id: string;
  name: string;
  artwork?: Artwork;
  curatorName?: string;
  /** Its songs, when the caller fetched them already (the chip flight): no second fetch. */
  tracks?: Track[];
}

/** A Full album: what the caller knows before Apple answers. */
export interface AlbumSource {
  albumId?: string;
  songId?: string;
  name: string;
  artist?: string;
  artwork?: Artwork;
  releaseDate?: string;
  /** The Lib album this Full level came from (its `albumKey`), for the way back to Lib. */
  libKey?: string;
  /** The song the drill came from: its row is lit (his call, 2026-10-13). */
  highlight?: Track;
}
/** A Full artist. `name` is "" when a restore opens it by its id alone. */
export interface ArtistSource {
  name: string;
  id?: string;
  albumId?: string;
  artwork?: Artwork;
  /** False: `name` is only shown until Apple answers (a song's whole credit, "A & B"), so
   *  Last.fm and Your Playlists wait for Apple's own name. */
  named?: boolean;
}

export interface MediaLevels {
  /** The drills of a Lib row's menus, in this card: an artist, an album, a song in place, a
   *  genre through `deps.genre`. The Library's root and genre rows use it too. */
  nav: LibNav;
  libAlbum(a: AlbumGroup, highlight?: Track): Context;
  libArtist(name: string): Context;
  fullAlbum(src: AlbumSource): Context;
  fullArtist(src: ArtistSource, seedSong?: string): Context;
  /** Apple's playlist page (his call 2026-10-13: its own builder; the Playlists card keeps its own). */
  playlist(src: PlaylistSource): Context;
  /** The song level (CREDITS.md §7.6): the facts and one row per writer. */
  song(t: Track): Context;
  /** The writer level: every song the app has collected that credits the name. */
  writer(name: string): Context;
  /** Card memory: a level's key (`album:`, `artist:`, `full-album:`, `full-artist:`,
   *  `apple-playlist:`, `song:`, `writer:`) back into its level; null when it is gone. */
  resolve(key: string): Context | null;
}

// ── the album page ──────────────────────────────────────────────────────────────

/** One album level's data: everything the album builder does not decide. */
interface AlbumData {
  key: () => string | undefined;
  name: () => string;
  artist: () => string;
  artwork: () => Artwork | undefined;
  releaseDate: () => string | undefined;
  songs: () => Track[];
  /** False while the songs are on their way: the meta line waits. */
  ready: () => boolean;
  /** The names the facts box asks Last.fm by: [artist, album]. */
  lfm: () => [string, string];
  /** How Apple's notes name this album (features/album-notes.md): its catalog id, or a catalog song
   *  of it. Null while it is not known yet (a Full level before its read). */
  notes: () => NotesRef | null;
  /** The full note's songs and plays: Apple's whole album where it can be read, else these. */
  noteSongs: () => Pick<NotesViewData, "songs" | "play" | "menu">;
  /** The ♥ question (asked once per install, favorites.ts); null until it can be asked. */
  fav: () => AlbumFav | null;
  /** The hero's subtitle: the artist's own level, in this card. */
  openArtist: (who: string) => void;
  hasMenu: () => boolean;
  menu: () => MenuItem[];
  /** The rows' options (the context tag, the nav, the ✓ mark, the lit song). */
  rows: () => SongOpts;
  emptyText?: () => string | undefined;
  views: ViewSwitch;
  /** Reads the songs (Full). The level redraws when it ends. */
  load?: () => Promise<void>;
}

/** An artist level's data: everything the artist builder does not decide. */
interface ArtistData {
  key: () => string | undefined;
  name: () => string;
  /** The name is the artist's own (a restore by id opens nameless until Apple answers). */
  named: () => boolean;
  artwork: () => Artwork | undefined;
  meta: () => string | undefined;
  hasMenu: () => boolean;
  subject: () => ArtistSubject;
  menuContext: () => string;
  /** The shelves are drawn (Full waits for the page). */
  ready: () => boolean;
  featured: () => Playlist[] | undefined;
  /** Apple's top songs, most popular first: the Popular sort. */
  topSongs: () => Track[];
  songs: () => Track[];
  rows: () => SongOpts;
  /** The label over the rows, under which Sort / View / Search sit. */
  rowsLabel: string;
  albums: () => ShelfAlbum[];
  /** Releases by others the artist is on (Full only): the shelf under the rows. */
  appearsOn?: () => ShelfAlbum[];
  emptyText?: () => string | undefined;
  defaults: NonNullable<Context["defaults"]>;
  views: ViewSwitch;
  load: () => Promise<void>;
}
interface ShelfAlbum {
  name: string;
  artwork?: Artwork;
  releaseDate?: string;
  open?: () => void;
  menu: () => MenuItem[];
}

const yearOf = (d?: string) => d?.slice(0, 4);

/** Apple's songs join the store before they play, as the Library's Full rows do
 *  (library-card.ts `joinStore`): the play's stats resolve to the song. */
const joinStore = (ts: Track[]) => {
  const out = ts.filter((t) => !t.unreleased);
  addTransientTracks(out);
  out.forEach(materializeTrack);
};

/** A bold name in a full note that is no song of its album (*“BOMBAY”*, features/album-notes.md
 *  §4): one catalog search by the artist and the name, at the click. A song whose name folds to
 *  it and whose artist line holds the album's artist plays alone. False: nothing matched. */
async function playElsewhere(artist: string, name: string): Promise<boolean> {
  const want = foldName(name);
  if (!want) return false;
  const res = await searchCatalog(`${artist} ${name.replace(/[“”"]/g, "")}`, ["songs"]).catch(() => null);
  const who = foldName(artist);
  const hit = res?.songs.find((s) => foldName(s.title) === want && (!who || foldName(s.artistName).includes(who)));
  if (!hit) return false;
  joinStore([hit]);
  await playTracks([hit], 0, "search").catch((e) => console.error("[notes] play elsewhere", e));
  return true;
}
const inLibrary = (name: string) => creditIndex(tracks()).tracksFor(name).length > 0;
const songCount = (n: number) => `${n} song${n === 1 ? "" : "s"}`;

export function mediaLevels(deps: LevelDeps): MediaLevels {
  const card = () => deps.card();

  // In-place drill nav for the Lib rows' menus: "Go to Artist/Album" pushes the same level an
  // artist or album tile would, over the user's library, in this card's stack. creditIndex is
  // memoized per library array, so `artistNames` is cheap. A genre is the Library's view.
  const libNav: LibNav = {
    artistNames: (t) => creditIndex(tracks()).namesOf(t),
    drillArtist: (name) => card().drill(libArtistLevel(name)),
    drillAlbum: (t) =>
      card().drill(libAlbumLevel({ key: albumKey(t), name: t.albumName ?? "Unknown Album", artist: t.albumArtist || t.artistName || "", count: 0 }, t)),
    drillGenre: (name) => deps.genre(name),
    drillSong: (t) => card().drill(songLevel(t)),
  };

  /** An artist by name from a song: the Lib level when the library holds them, else Apple's
   *  page through the song (one memoized hop). */
  const artistFrom = (name: string, seedSong?: string): Context =>
    inLibrary(name) ? libArtistLevel(name) : fullArtistLevel({ name }, seedSong);

  /** A song list's grouping, made again only when its options change (Full learns its id). */
  const songRows = (list: () => Track[], opts: () => SongOpts) => {
    let grouping: Grouping<Track> | null = null;
    let made = "";
    return () => {
      const o = opts();
      const sig = `${o.context ?? ""}\u0001${o.selectedId ?? ""}`;
      if (!grouping || sig !== made) {
        grouping = deps.songs(list, o);
        made = sig;
      }
      return grouping;
    };
  };

  function albumLevel(d: AlbumData): Context {
    let lfmAsked = false;
    const askLfm = () => {
      askNotes();
      const [who, what] = d.lfm();
      if (lfmAsked || !who || !what || albumInfoNow(who, what)) return;
      lfmAsked = true;
      // It slides in beside the cover when it lands, in place (hero-slide.ts).
      void albumInfoFor(who, what).then(() => card().heroAside(ctx));
    };
    // Apple's notes (features/album-notes.md): asked beside Last.fm, with the box's row on. A Full
    // level asks once its read named the album (the read kept the notes: no call).
    let notesAsked = false;
    const askNotes = () => {
      const ref = d.notes();
      if (notesAsked || !ref || !setting("showAlbumInfo") || notesNow(ref) !== undefined) return;
      notesAsked = true;
      void notesFor(ref).then(() => card().heroAside(ctx));
    };
    /** The notes as the box reads them: `undefined` while a Full level has not named its album. */
    const notesHere = () => {
      const ref = d.notes();
      return ref ? notesNow(ref) : undefined;
    };
    const group = songRows(d.songs, () => ({ ...d.rows(), hideCover: true, numbered: true }));
    const ctx: Context = {
      get title() {
        return d.name();
      },
      get key() {
        return d.key();
      },
      opens: "album",
      headerLabel: "Album",
      loading: () => !d.ready(), // the drill holds for its songs (UX-COVERUPS.md §7.1)
      // The row turned on while this album shows: ask again (LISTENERS.md §8.11).
      asideRefresh: () => {
        lfmAsked = false;
        notesAsked = false;
        askLfm();
      },
      // The full note's view (present.ts `openNotes`): the songs a mention plays.
      notesView: () => ({
        title: d.name(),
        artist: d.artist(),
        ...d.noteSongs(),
        playElsewhere: (name) => playElsewhere(d.artist(), name),
      }),
      // The hero: cover, name, the artist as a tappable subtitle (→ the artist level), and
      // year · songs · length. Read live, so a sync that adds a song updates the line.
      hero: () => {
        const ts = d.songs();
        const who = d.artist();
        const fav = d.fav();
        if (fav) reconcileAlbum(fav);
        const total = formatTotal(ts.reduce((n, t) => n + (t.durationMs ?? 0), 0));
        const [lw, la] = d.lfm();
        // A pre-release album reads "Coming 09/25" in place of the year (his call 1A,
        // 2026-09-24; an unreleased song carries the album's own date, apple.rs), and the
        // count says how many songs are out.
        const date = ts.find((t) => t.unreleased)?.releaseDate ?? d.releaseDate();
        const at = releaseAt(date);
        const year = at > Date.now() ? comingMark(new Date(at)) : yearOf(date);
        const out = ts.filter((t) => !t.unreleased).length;
        const count = out < ts.length ? `${out} of ${ts.length} songs out` : songCount(ts.length);
        return {
          cover: deps.heroCover(d.artwork(), d.name()),
          title: d.name(),
          sub: who ? { text: who, run: () => d.openArtist(who) } : undefined,
          meta: d.ready() ? [year, count, total].filter(Boolean).join(" · ") : undefined,
          // Right-click anywhere on the hero: the album's own menu, without Go to Album
          // (you are there) — CONTEXT-MENUS.md §3a.
          menu: d.hasMenu() ? d.menu : undefined,
          aside: lw && la ? albumInfoHTML(albumInfoNow(lw, la), lw, la, notesHere()) : undefined,
        };
      },
      get groupings() {
        return [group()];
      },
      density: true,
      get emptyText() {
        return d.emptyText?.();
      },
      defaults: { density: "lines", sortKey: "track" },
      views: d.views,
    };
    askLfm();
    if (d.load) {
      const loaded = d.load();
      // A Full | Lib switch waits for it, so the level arrives once, full (FULL-LIB.md §5).
      ctx.ready = () => loaded;
      void loaded.finally(() => {
        askLfm();
        card().reload(ctx);
      });
    }
    return ctx;
  }

  function artistLevel(d: ArtistData): Context {
    let yours: YourPlaylists | undefined; // the user's playlists with this artist (0 calls)
    let checking: CheckProgress | null = null;
    let albumList: ShelfAlbum[] = []; // the Albums shelf as last drawn (a tile's index → its album)
    let appearsList: ShelfAlbum[] = []; // the Appears On shelf, the same way

    // The rows' extra sorts (ARTIST-VIEW.md §1). Popular = Apple's top-songs order, then the
    // rest newest first. Most Played = this app's own play counts (zero calls).
    let plays: Map<string, PlayCount> | undefined;
    // A song matches a top song by catalog id, then ISRC, then title — library and catalog
    // ids can differ for the same recording. Rebuilt when the top list changes.
    const matchKeys = (t: Track) => [t.catalogId, t.isrc ? `isrc:${t.isrc}` : undefined, `title:${t.title.toLowerCase()}`];
    let ranksOf: Track[] | null = null;
    let ranks = new Map<string, number>();
    const popularity = (t: Track): number | undefined => {
      const top = d.topSongs();
      if (ranksOf !== top) {
        ranksOf = top;
        ranks = new Map();
        top.forEach((s, i) => {
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
    // A song's plays: the sum over every copy of it in your library (any of the match keys).
    // Apple's top song is often another release of a song you hold (a single, an EP), with
    // its own catalog id, so a Full row found almost none of your plays; and you may hold the
    // song twice (OUTLINE on the single and the EP, the plays on the EP), so every copy
    // counts, not the first one a key finds (desk test 2026-10-13).
    let twinsOf: Track[] | null = null;
    let twins = new Map<string, Track[]>();
    const twinsFor = (t: Track): Track[] => {
      const mine = creditIndex(tracks()).tracksFor(d.name());
      if (twinsOf !== mine) {
        twinsOf = mine;
        twins = new Map();
        for (const s of mine)
          for (const k of matchKeys(s)) {
            if (!k) continue;
            const list = twins.get(k);
            if (list) list.push(s);
            else twins.set(k, [s]);
          }
      }
      const all = new Set<Track>();
      for (const k of matchKeys(t)) for (const s of (k && twins.get(k)) || []) all.add(s);
      return [...all];
    };
    const playsOf = (t: Track): PlayCount | undefined => {
      const copies = twinsFor(t);
      // A Lib row is one of your copies: it keeps its own count, as before. Only an Apple row
      // (Full) adds up the copies it stands for.
      if (!copies.length || copies.includes(t)) return plays?.get(playsKey(t));
      let full = 0;
      let partial = 0;
      for (const s of copies) {
        const c = plays?.get(playsKey(s));
        if (c) {
          full += c.full;
          partial += c.partial;
        }
      }
      return full || partial ? { id: playsKey(t), full, partial } : undefined;
    };
    const sorts: SortSpec<Track>[] = [
      { key: "popular", label: "Popular", type: "num", get: popularity },
      {
        key: "plays",
        label: "Most Played",
        type: "num",
        // His ask (2026-10-23), as the Library's Plays: the tally is this app's own.
        hint: "Most Played counts only listens on DeetsMusic, not on Apple Music",
        // Full listens lead, starts break a tie; a song never played goes last.
        get: (t) => {
          const c = playsOf(t);
          return c ? -(c.full * 1e6 + c.partial) : undefined;
        },
      },
    ];
    const group = songRows(d.songs, () => ({ ...d.rows(), extraSorts: sorts }));

    // The Last.fm facts box beside the hero (LISTENERS.md §6): one call per artist, cached a
    // month; nothing until it answers, nothing with the row off. Known this session: drawn
    // in the first paint. Else it slides in beside the photo when it lands, in place.
    let lfm: ArtistInfo | null | undefined;
    let lfmFor = "";
    // Asked once, by the first name the level knows: Apple's spelling of it, landing later,
    // never asks Last.fm a second time.
    const askLfm = () => {
      const n = d.name();
      if (!d.named() || lfmFor) return;
      lfmFor = n;
      lfm = artistInfoNow(n);
      if (!lfm)
        void artistInfoFor(n).then((i) => {
          if (lfmFor !== n) return;
          lfm = i;
          card().heroAside(ctx);
        });
    };
    let yoursFor = "";
    const loadYours = () => {
      const n = d.name();
      return yourPlaylistsFor(n)
        .then((y) => {
          yours = y;
          card().reload(ctx);
        })
        .catch((e) => console.error("[levels] your playlists", e));
    };
    let yoursLoaded: Promise<unknown> = Promise.resolve();
    const askYours = () => {
      if (!d.named() || yoursFor) return;
      yoursFor = d.name();
      yoursLoaded = loadYours();
    };

    // Newest first, as the Search pane lists them; an album with no date goes last.
    const newestFirst = (list: ShelfAlbum[]) => list.sort((x, y) => (y.releaseDate ?? "").localeCompare(x.releaseDate ?? ""));
    const albumTiles = (kind: "album" | "appears", list: ShelfAlbum[], label: string): string => {
      const tiles = list
        .map((al, i) => {
          const url = artURL(al.artwork, TILE_PX);
          const cover = url
            ? `<img class="search__tile-art" src="${esc(url)}" alt="" loading="lazy" decoding="async" data-art />`
            : `<div class="search__tile-art search__tile-art--empty" aria-hidden="true">♪</div>`;
          return (
            `<div class="search__tile" data-shelf-item="${kind}" data-shelf-idx="${i}" role="button" tabindex="0">${cover}` +
            `<span class="search__tile-name">${esc(al.name)}</span><span class="search__tile-sub">${esc(yearOf(al.releaseDate) ?? "")}</span></div>`
          );
        })
        .join("");
      return tiles ? `<div class="search__label">${label}</div><div class="search__scroller search__scroller--albums">${tiles}</div>` : "";
    };
    // Albums, singles and EPs, and live albums in one shelf (his call, 2026-10-26).
    const albumsShelf = (): string => albumTiles("album", (albumList = newestFirst(d.albums())), "Albums");
    // Appears On: the last thing on the page, under the rows (his call, 2026-10-26).
    const appearsShelf = (): string => {
      const html = albumTiles("appears", (appearsList = newestFirst(d.appearsOn?.() ?? [])), "Appears On");
      return html ? `<div class="lib-shelves lib-shelves--foot">${html}</div>` : "";
    };
    const shelfAlbum = (kind: string | undefined, i: number) => (kind === "album" ? albumList[i] : kind === "appears" ? appearsList[i] : undefined);

    const ctx: Context = {
      get title() {
        return d.name();
      },
      get key() {
        return d.key();
      },
      opens: "artist",
      headerLabel: "Artist",
      loading: () => !d.ready(), // the drill holds for its shelves, inside the cap (§7.11 part 5)
      // The row turned on while this artist shows: ask again (LISTENERS.md §8.11).
      asideRefresh: () => {
        if (lfm) return;
        lfmFor = "";
        askLfm();
      },
      hero: () => {
        // The artist's own menu, without Go to Artist (you are there): on a left-click of the
        // photo, and on a right-click anywhere on the hero (his calls, 2026-10-13 and 1A).
        // The pin's snapshot carries the catalog id and photo, so it outlives the artist's
        // songs leaving the library (PINS.md).
        const menu = d.hasMenu() ? () => artistMenu(d.subject(), { context: d.menuContext(), here: true }) : undefined;
        return {
          cover: deps.heroCover(d.artwork(), d.name(), undefined, undefined, true),
          coverMenu: menu,
          menu,
          title: d.name(),
          meta: d.meta(),
          aside: artistInfoHTML(lfm, lfmFor || d.name()),
        };
      },
      shelves: () => (d.ready() ? artistShelvesHTML(d.featured(), yours, checking, albumsShelf()) : ""),
      footer: () => (d.ready() ? appearsShelf() : ""),
      // Sort / View / Search act only on the rows, so they sit under this label.
      toolbarBelow: d.rowsLabel,
      // An album drills in place. A featured playlist opens as a Search pane; one of yours in
      // the Playlists card — each after the chip flight, which fetches the songs first so the
      // view arrives full (§5). "Check N more" fetches the unopened ones (§3).
      onShelf: (el) => {
        const i = Number(el.dataset.shelfIdx);
        const kind = el.dataset.shelfItem;
        if (kind === "album" || kind === "appears") {
          shelfAlbum(kind, i)?.open?.();
        } else if (kind === "featured") {
          const p = d.featured()?.[i];
          const id = p?.catalogId;
          if (p && id) {
            const intent = { id, name: p.name, artwork: p.artwork, curatorName: p.curatorName };
            if (deps.playlistsHere) card().drill(playlistLevel(intent));
            else handOff(el, "search", () => collectionTracks("playlists", id), (ts) => requestPlaylistPane({ ...intent, tracks: ts }));
          }
        } else if (kind === "yours") {
          const p = yours?.hits[i]?.p;
          const lid = p?.libraryId;
          if (p && lid) handOff(el, "playlists", () => playlistTracks(p), (ts) => requestOpenPlaylist(lid, ts), p.trackCount);
        } else if (kind === "check" && yours && !checking) {
          checking = { done: 0, total: yours.unchecked.length };
          card().reload(ctx);
          void checkPlaylists(yours.unchecked, (pr) => {
            checking = pr;
            card().reload(ctx);
          })
            .then(loadYours)
            .finally(() => {
              checking = null;
              card().reload(ctx);
            });
        }
      },
      shelfMenu: (el) => {
        const i = Number(el.dataset.shelfIdx);
        const kind = el.dataset.shelfItem;
        if (kind === "album" || kind === "appears") return shelfAlbum(kind, i)?.menu() ?? [];
        if (kind === "featured") {
          const p = d.featured()?.[i];
          const id = p?.catalogId;
          return p && id ? playlistMenu(p, () => collectionTracks("playlists", id), { context: `search-playlists:${id}`, catalog: true }) : [];
        }
        const p = kind === "yours" ? yours?.hits[i]?.p : undefined;
        return p ? playlistMenu(p, () => playlistTracks(p), { context: `playlist:${p.libraryId}` }) : [];
      },
      get groupings() {
        return [group()];
      },
      density: true,
      get emptyText() {
        return d.emptyText?.();
      },
      defaults: d.defaults,
      views: d.views,
    };
    askLfm();
    askYours();
    const playsLoaded = playCounts()
      .then((m) => {
        plays = m;
        card().reload(ctx);
      })
      .catch((e) => console.error("[levels] play counts", e));
    const loaded = d.load();
    void loaded.finally(() => {
      askLfm();
      askYours();
      card().reload(ctx);
    });
    // A Full | Lib switch waits for the page and for the local reads that would redraw it just
    // after (the play counts, Your Playlists), so the level arrives once, full (FULL-LIB.md §5).
    // The Last.fm box is not waited for: it slides in beside the photo when it lands.
    const settled = Promise.all([playsLoaded, loaded.finally(() => yoursLoaded)]);
    ctx.ready = () => settled;
    return ctx;
  }

  // ── the Lib sources: your library, zero Apple calls for the rows ──

  function libAlbumLevel(a: AlbumGroup, highlight?: Track): Context {
    const list = () => tracks().filter((t) => albumKey(t) === a.key);
    const artist = () => a.artist || list()[0]?.artistName || "";
    const context = `album:${a.key}`;
    return albumLevel({
      key: () => context, // card memory (CARD-MEMORY.md §5)
      name: () => a.name,
      artist,
      artwork: () => a.artwork ?? list()[0]?.artwork,
      releaseDate: () => a.releaseDate ?? list().find((t) => t.releaseDate)?.releaseDate,
      songs: list,
      ready: () => true,
      lfm: () => [artist(), a.name],
      // Apple's notes by the album's first catalog song (the hop, once; Rust keeps the pair).
      notes: () => {
        const songId = albumOrder(list()).find((t) => t.catalogId)?.catalogId;
        return songId ? { songId } : {};
      },
      // The full note's songs: Apple's whole album (one call, kept for the session), so a song
      // you do not have is a mention too. A mention plays your copy in this album when you have
      // it, else Apple's album from it.
      noteSongs: () => {
        const mine = () => albumOrder(list());
        const songId = mine().find((t) => t.catalogId)?.catalogId;
        const albumId = () => (songId ? notesNow({ songId })?.albumId : undefined);
        const copyIn = (lib: Track[], t: Track) =>
          lib.findIndex((x) => x === t || (!!t.catalogId && x.catalogId === t.catalogId) || (!!t.isrc && x.isrc === t.isrc));
        return {
          songs: async () => {
            const id = albumId();
            return id ? await collectionTracks("albums", id).catch(() => mine()) : mine();
          },
          play: (t, all) => {
            const lib = mine();
            const i = copyIn(lib, t);
            if (i >= 0) return void playTracks(lib, i, context).catch((e) => console.error("[notes] play", e));
            joinStore(all);
            void playTracks(all, Math.max(0, all.indexOf(t)), `search-albums:${albumId() ?? ""}`).catch((e) => console.error("[notes] play", e));
          },
          menu: (t, all) => {
            const lib = mine();
            const i = copyIn(lib, t);
            return i >= 0
              ? songMenu(lib[i], { context, nav: libNav, listFrom: { items: lib, idx: i } })
              : songMenu(t, { context: `search-albums:${albumId() ?? ""}`, nav: fullNav, listFrom: { items: all, idx: Math.max(0, all.indexOf(t)) }, catalog: true });
          },
        };
      },
      // The seed is the album's first song, as `albumMenu` picks it.
      fav: () => ({ seed: albumOrder(list()).find((t) => t.catalogId)?.catalogId, name: a.name }),
      openArtist: (who) => libNav.drillArtist(who),
      hasMenu: () => true,
      menu: () => albumMenu(libAlbum(albumOrder(list())), { context, nav: libNav, here: true }),
      rows: () => ({ selectedId: highlight ? trackId(highlight) : undefined, context, nav: libNav }),
      // Full | Lib (FULL-LIB.md): Full is Apple's whole album, in place of this level.
      views: {
        options: FULL_LIB,
        active: "lib",
        to: (k) => {
          if (k !== "full") return null;
          const ts = list();
          return fullAlbumLevel({
            libKey: a.key,
            songId: ts.find((t) => t.catalogId)?.catalogId,
            name: a.name,
            artist: artist(),
            artwork: a.artwork ?? ts[0]?.artwork,
            highlight,
          });
        },
      },
    });
  }

  function libArtistLevel(name: string): Context {
    const sub = () => creditIndex(tracks()).tracksFor(name);
    let info: LibraryArtistInfo | null = null; // photo + featured playlists (0–2 Apple calls, saved)
    const context = `artist:${name}`;
    return artistLevel({
      key: () => context, // card memory (CARD-MEMORY.md §5)
      name: () => name,
      named: () => true,
      // Until the photo is known, a song's album cover stands in (round).
      artwork: () => info?.artwork ?? sub().find((t) => t.artwork)?.artwork,
      meta: () => {
        const ts = sub();
        const albums = groupAlbums(ts).length;
        return `${albums} album${albums === 1 ? "" : "s"} · ${songCount(ts.length)}`;
      },
      hasMenu: () => true,
      subject: () => ({ name, catalogId: info?.catalogId, artwork: info?.artwork, songs: artistOrder(sub()), inLibrary: true }),
      menuContext: () => context,
      ready: () => true,
      featured: () => info?.featuredPlaylists,
      topSongs: () => info?.topSongs ?? [],
      songs: sub,
      // The rows are every song by the artist in YOUR library (not the catalog discography).
      rows: () => ({
        context,
        nav: libNav,
        actionTitles: {
          play: `Play every song by ${name} in your library, in this order`,
          shuffle: `Shuffle every song by ${name} in your library`,
        },
      }),
      rowsLabel: "Songs",
      albums: () =>
        groupAlbums(sub()).map((al) => ({
          name: al.name,
          artwork: al.artwork,
          releaseDate: al.releaseDate,
          open: () => card().drill(libAlbumLevel(al)),
          menu: () =>
            albumMenu(libAlbum(albumOrder(tracks().filter((t) => albumKey(t) === al.key))), { context: `album:${al.key}`, nav: libNav, inArtist: true }),
        })),
      defaults: { density: "lines", sortKey: "release", sortDir: "desc" },
      // Full | Lib (FULL-LIB.md): Full is Apple's artist page, in place of this level.
      views: {
        options: FULL_LIB,
        active: "lib",
        to: (k) => (k === "full" ? fullArtistLevel({ name, id: info?.catalogId, artwork: info?.artwork }) : null),
      },
      load: () =>
        libraryArtistInfo(name, sub().map((t) => t.catalogId))
          .then((i) => {
            info = i;
          })
          .catch((e) => console.error("[levels] artist info", e)),
    });
  }

  // ── the Full sources: Apple's page ──

  // The Full view's menus: "Go to Album" and "Go to Artist" stay in the Full view (a song
  // there may not be yours, so the Lib album would be empty). A name → one of its song ids,
  // noted as the menu is built, is the artist's seed.
  const seeds = new Map<string, string>();
  const fullNav: LibNav = {
    artistNames: (t) => {
      const names = creditIndex([t]).namesOf(t);
      if (t.catalogId) for (const n of names) seeds.set(n, t.catalogId);
      return names;
    },
    drillArtist: (name) => card().drill(fullArtistLevel({ name }, seeds.get(name))),
    drillAlbum: (t) =>
      card().drill(fullAlbumLevel({ songId: t.catalogId, name: t.albumName ?? "Album", artist: t.artistName, artwork: t.artwork, highlight: t })),
    drillGenre: (name) => deps.genre(name),
    drillSong: (t) => card().drill(songLevel(t)),
  };

  /** The Lib level of an album the library holds some of: by its key, or by any of its songs
   *  (catalog id, ISRC). Null when none of them is yours. */
  const libAlbumFor = (songs: Track[], libKey?: string): Context | null => {
    const all = tracks();
    const byKey = libKey ? all.find((t) => albumKey(t) === libKey) : undefined;
    const ids = new Set(songs.flatMap((s) => [s.catalogId, s.isrc ? `isrc:${s.isrc}` : undefined]).filter(Boolean));
    const hit = byKey ?? (ids.size ? all.find((t) => ids.has(t.catalogId) || (t.isrc && ids.has(`isrc:${t.isrc}`))) : undefined);
    return hit ? libAlbumOf(hit) : null;
  };
  const libAlbumOf = (t: Track, highlight?: Track) =>
    libAlbumLevel(
      { key: albumKey(t), name: t.albumName ?? "Unknown Album", artist: t.artistName ?? "", count: 0, artwork: t.artwork, releaseDate: t.releaseDate },
      highlight,
    );

  function fullAlbumLevel(src: AlbumSource): Context {
    let id = src.albumId;
    let songs: Track[] | null = null;
    let failed: string | null = null;
    const rows = () => songs ?? [];
    const name = () => songs?.[0]?.albumName ?? src.name;
    const artistName = () => songs?.[0]?.artistName ?? src.artist ?? "";
    const lib = () => (songs ? libAlbumFor(songs, src.libKey) : src.libKey ? libAlbumFor([], src.libKey) : null);
    // The lit song: the drill's song, found among Apple's rows by catalog id, then ISRC.
    const lit = (): string | undefined => {
      const h = src.highlight;
      if (!h || !songs) return undefined;
      const hit = songs.find((s) => (h.catalogId && s.catalogId === h.catalogId) || (h.isrc && s.isrc === h.isrc));
      return hit ? trackId(hit) : undefined;
    };
    return albumLevel({
      key: () => (id ? `full-album:${id}` : undefined),
      name,
      artist: artistName,
      // The cover it opened with first (the Lib one): a Full | Lib switch keeps the same hero.
      artwork: () => src.artwork ?? songs?.[0]?.artwork,
      releaseDate: () => rows().find((t) => t.releaseDate)?.releaseDate ?? src.releaseDate,
      songs: rows,
      ready: () => songs !== null,
      // Asked by the names the level opened with (the Lib level's own, so its answer is
      // shared), else by the songs' once they land.
      lfm: () => [src.artist || artistName(), src.name || name()],
      // Apple's notes by the album's id, once the read named it: the read kept them (no call).
      notes: () => (songs || failed ? (id ? { albumId: id } : {}) : null),
      noteSongs: () => {
        const ctxTag = `search-albums:${id ?? ""}`;
        return {
          songs: async () => rows(),
          play: (t, all) => {
            joinStore(all);
            void playTracks(all, Math.max(0, all.indexOf(t)), ctxTag).catch((e) => console.error("[notes] play", e));
          },
          menu: (t, all) => songMenu(t, { context: ctxTag, nav: fullNav, listFrom: { items: all, idx: Math.max(0, all.indexOf(t)) }, catalog: true }),
        };
      },
      fav: () => (id && songs ? { id, seed: songs.find((t) => t.catalogId)?.catalogId, name: name() } : null),
      // The artist in the Full view too: Apple's page, through the album's own relationship.
      // The song's credit may name several artists: Apple's own name answers Last.fm.
      openArtist: (who) => card().drill(fullArtistLevel({ name: who, albumId: id, named: false })),
      hasMenu: () => !!id,
      menu: () =>
        albumMenu(
          { title: name(), artistName: artistName(), artwork: songs?.[0]?.artwork ?? src.artwork, catalogId: id, known: rows(), whole: () => collectionTracks("albums", id!), catalog: true },
          { context: `search-albums:${id}`, here: true },
        ),
      rows: () => ({ context: `search-albums:${id ?? ""}`, nav: fullNav, mark: true, selectedId: lit() }),
      emptyText: () => failed ?? (songs ? "No songs." : "Loading…"),
      views: {
        options: withOff(() => (songs === null && !src.libKey ? "Loading…" : lib() ? undefined : "None of these songs are in your library")),
        active: "full",
        to: (k) => (k === "lib" ? lib() : null),
      },
      load: async () => {
        try {
          if (!id && src.songId) id = (await catalogRelated("songs", src.songId, "albums"))?.id;
          if (!id) {
            failed = "Apple Music has no copy of this album.";
            return;
          }
          songs = await collectionTracks("albums", id);
        } catch (e) {
          failed = "Couldn't read the album from Apple Music.";
          console.error("[levels] full album", e);
        } finally {
          diag.log("library:full", { kind: "album", id: id ?? null, n: songs?.length ?? 0, failed: !!failed });
        }
      },
    });
  }

  function fullArtistLevel(src: ArtistSource, seedSong?: string): Context {
    let id = src.id;
    let d: ArtistDetail | null = null;
    let failed: string | null = null;
    const top = () => d?.topSongs ?? [];
    const name = () => d?.artist.name ?? (src.name || "Artist");
    // An Apple album tile: it drills to the Full album in place. An Appears On release is
    // another artist's, so the album keeps its own artist name.
    const shelfAlbum = (al: Album): ShelfAlbum => {
      const aid = al.catalogId;
      return {
        name: al.title,
        artwork: al.artwork,
        releaseDate: al.releaseDate,
        open: aid
          ? () => card().drill(fullAlbumLevel({ albumId: aid, name: al.title, artist: al.artistName || name(), artwork: al.artwork, releaseDate: al.releaseDate }))
          : undefined,
        menu: () =>
          aid
            ? albumMenu(
                { title: al.title, artistName: al.artistName, artwork: al.artwork, catalogId: aid, known: [], whole: () => collectionTracks("albums", aid), catalog: true },
                { context: `search-albums:${aid}`, inArtist: true },
              )
            : [],
      };
    };
    return artistLevel({
      key: () => (id ? `full-artist:${id}` : undefined),
      name,
      named: () => !!d || (!!src.name && src.named !== false),
      // The photo it opened with first (the Lib one): a Full | Lib switch keeps the same hero.
      artwork: () => src.artwork ?? d?.artist.artwork,
      meta: () => d?.artist.genres?.[0],
      hasMenu: () => !!id,
      subject: () => ({ name: name(), catalogId: id, artwork: d?.artist.artwork ?? src.artwork, songs: top(), inLibrary: inLibrary(name()) }),
      menuContext: () => `search-artist:${id}`,
      ready: () => !!d,
      featured: () => d?.featuredPlaylists,
      topSongs: top,
      songs: top,
      rows: () => ({
        context: `search-artist:${id ?? ""}`,
        nav: fullNav,
        mark: true,
        actionTitles: {
          play: `Play ${name()}'s Top Songs from Apple Music, in this order`,
          shuffle: `Shuffle ${name()}'s Top Songs from Apple Music`,
        },
      }),
      rowsLabel: "Top Songs",
      albums: () => (d?.albums ?? []).map(shelfAlbum),
      appearsOn: () => (d?.appearsOn ?? []).map(shelfAlbum),
      emptyText: () => failed ?? (d ? "No songs." : "Loading…"),
      defaults: { density: "lines", sortKey: "popular" },
      views: {
        options: withOff(() => (inLibrary(name()) ? undefined : "No songs by this artist are in your library")),
        active: "full",
        to: (k) => (k === "lib" && inLibrary(name()) ? libArtistLevel(name()) : null),
      },
      load: async () => {
        try {
          if (!id && src.albumId) id = (await catalogRelated("albums", src.albumId, "artists"))?.id;
          if (!id && seedSong) id = (await catalogRelated("songs", seedSong, "artists"))?.id;
          if (!id && src.name) {
            // A Library artist: the id the Lib view saved (0 calls once known), else 1 hop.
            const ids = creditIndex(tracks()).tracksFor(src.name).map((t) => t.catalogId);
            if (ids.some(Boolean)) id = (await libraryArtistInfo(src.name, ids))?.catalogId;
          }
          if (!id) {
            failed = "Apple Music has no page for this artist.";
            return;
          }
          d = await artistDetail(id);
        } catch (e) {
          failed = "Couldn't read the artist from Apple Music.";
          console.error("[levels] full artist", e);
        } finally {
          diag.log("library:full", { kind: "artist", id: id ?? null, n: d?.topSongs.length ?? 0, failed: !!failed });
        }
      },
    });
  }

  // ── Apple's playlist page ──
  // His call (2026-10-13): its own builder here; the Playlists card's playlist level (edit,
  // reorder, cover menus) stays its own, a merge is a later project. The rows keep the
  // playlist's order, and a row's Go to stays among Apple's pages (`fullNav`).
  function playlistLevel(src: PlaylistSource): Context {
    let songs: Track[] | null = src.tracks ? [...src.tracks] : null;
    let failed: string | null = null;
    const rows = () => songs ?? [];
    const context = `search-playlists:${src.id}`;
    const order: SortSpec<Track> = {
      key: "order",
      label: "Playlist Order",
      type: "num",
      get: (t) => {
        const i = rows().indexOf(t);
        return i < 0 ? undefined : i;
      },
    };
    const group = songRows(rows, () => ({
      context,
      nav: fullNav,
      mark: true,
      extraSorts: [order],
      actionTitles: { play: "Play the playlist in order", shuffle: "Shuffle the playlist" },
    }));
    const subject = () => ({ catalogId: src.id, name: src.name, artwork: src.artwork, curatorName: src.curatorName, canEdit: false, isPublic: true }) as Playlist;
    const ctx: Context = {
      title: src.name,
      key: `apple-playlist:${src.id}`,
      headerLabel: "Playlist",
      hero: () => {
        const ts = rows();
        // The ♥ state: asked once per install, the first time this hero draws (F1A).
        reconcilePlaylist({ kind: "playlists", id: src.id, name: src.name });
        const out = ts.filter((t) => !t.unreleased).length;
        const count = out < ts.length ? `${out} of ${ts.length} songs out` : songCount(ts.length);
        const total = formatTotal(ts.reduce((n, t) => n + (t.durationMs ?? 0), 0));
        return {
          cover: deps.heroCover(src.artwork ?? ts[0]?.artwork, src.name),
          title: src.name,
          meta: songs ? [count, total, src.curatorName ?? "Apple Music"].filter(Boolean).join(" · ") : undefined,
          // Right-click anywhere on the hero: the playlist's own menu, without its Go to row.
          menu: () => playlistMenu(subject(), () => rows(), { context, catalog: true, here: true }),
        };
      },
      get groupings() {
        return [group()];
      },
      density: true,
      get emptyText() {
        return failed ?? (songs ? "No songs." : "Loading…");
      },
      defaults: { density: "lines", sortKey: "order" },
    };
    if (!songs)
      void collectionTracks("playlists", src.id)
        .then((ts) => {
          songs = ts;
        })
        .catch((e) => {
          failed = "Couldn't read the playlist from Apple Music.";
          console.error("[levels] apple playlist", e);
        })
        .finally(() => card().reload(ctx));
    return ctx;
  }

  // ── the song level and the writer level (CREDITS.md §7.6) ──
  // A song's natural list is its WRITERS, so the level is a hero, the facts as a shelf, and
  // one row per writer (his call 2026-10-13: rows in every card, not the Search pane's chips).
  // A song the app met off the library (a Search row) is kept here by its id, so card memory
  // can open its level again in this session.
  const seenSongs = new Map<string, Track>();
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

  function songLevel(t: Track): Context {
    const id = t.catalogId ?? trackId(t);
    seenSongs.set(id, t);
    let credit = creditsFor(t.catalogId);
    let reading = false;
    let readFailed = false;
    if (!credit)
      void primeCredits([t.catalogId]).then(async () => {
        credit = creditsFor(t.catalogId);
        card().reload();
        // Never read: the gap is ours, so close it rather than blame Apple. One call.
        if (t.catalogId && !credit) {
          reading = true;
          card().reload();
          try {
            await fetchCredits([t.catalogId]);
          } catch {
            readFailed = true;
          }
          reading = false;
          credit = creditsFor(t.catalogId);
          card().reload();
        }
      });
    const names = () => credit?.names ?? [];
    const gap = () =>
      readFailed ? CREDITS_READ_FAILED
      : reading ? CREDITS_READING
      : credit?.state === "none" ? CREDITS_NONE
      : CREDITS_READING;
    // Credit order is the order Apple sent, and it carries meaning (the lead writer leads).
    // It is the default sort, so the rows read as Apple wrote them.
    const orderOf = (n: string) => names().indexOf(n);
    // The song facts box (LISTENERS.md §8): the song's Last.fm answer, then the album's facts
    // only when nothing before the album's wiki fills the About (`needsAlbumWiki`). Each lands
    // in place beside the cover (hero-slide.ts), as the album's box does.
    // The album is asked only once the song has an answer ("have" or "none"): not with the row
    // off (null), not after a failure or while the song's call is out (undefined) — a box that
    // cannot draw asked Last.fm for nothing (a test of this box, 2026-10-17).
    const who = t.artistName ?? "";
    // Apple's notes on the song's album (features/album-notes.md), by the song: its own part of a
    // track-by-track note, then the album's short note, come before Last.fm's album wiki. The
    // album's Last.fm facts wait for them, so a cell Apple fills asks Last.fm nothing more.
    const notesRef: NotesRef = t.catalogId ? { songId: t.catalogId } : {};
    const appleNotes = () => {
      const n = notesNow(notesRef);
      return n?.state === "have" ? n : undefined;
    };
    const albumWanted = (s: ReturnType<typeof songInfoNow>) => {
      if (!s || !who || !t.albumName || notesNow(notesRef) === undefined) return false;
      const n = appleNotes();
      return needsAlbumWiki(
        {
          appleSong: n?.standard ? songPart(n.standard, t.title) : undefined,
          lastfmSong: s.state === "have" ? noteText(s.wiki) : undefined,
          appleAlbum: shortText(n?.short),
        },
        setting("notesSource"),
      );
    };
    const albumFacts = () => (albumWanted(songInfoNow(t)) ? albumInfoNow(who, t.albumName!) : undefined);
    let notesAsked = false;
    const askLfm = () => {
      if (!setting("showSongInfo")) return;
      if (!notesAsked && notesNow(notesRef) === undefined) {
        notesAsked = true;
        void notesFor(notesRef).then(() => {
          card().heroAside(ctx);
          askAlbum();
        });
      }
      if (songInfoNow(t) !== undefined) return void askAlbum();
      void songInfoFor(t).then(() => {
        card().heroAside(ctx);
        askAlbum();
      });
    };
    const askAlbum = () => {
      if (!albumWanted(songInfoNow(t)) || albumInfoNow(who, t.albumName!) !== undefined) return;
      void albumInfoFor(who, t.albumName!).then(() => card().heroAside(ctx));
    };
    const ctx: Context = {
      title: t.title,
      key: `song:${id}`, // card memory (CARD-MEMORY.md §5)
      headerLabel: "Song",
      hero: () => ({
        cover: deps.heroCover(t.artwork, t.title),
        title: t.title,
        sub: t.artistName ? { text: t.artistName, run: () => card().drill(artistFrom(t.artistName, t.catalogId)) } : undefined,
        meta: [t.albumName, t.releaseDate?.slice(0, 4), fmtClock(t.durationMs)].filter(Boolean).join(" · "),
        aside: songInfoHTML(songInfoNow(t), { key: songInfoKey(t), artist: who, title: t.title }, albumFacts(), notesNow(notesRef)),
      }),
      // The row turned on while this song shows (LISTENERS.md §8.11): ask again.
      asideRefresh: () => {
        notesAsked = false;
        askLfm();
      },
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
          render: (n: string, density: Density, idx: number) => deps.cell(density, idx, undefined, n, "Writer", { round: true }),
          open: (n: string) => writerLevel(n),
        } as Grouping<string>,
      ],
      defaults: { density: "lines", sortKey: "credit" },
    };
    askLfm();
    return ctx;
  }

  // Every song the app has collected that credits one writer (CREDITS.md §5.2): one local
  // join, no Apple call. A row the app holds a track for plays like any song row; one it met
  // through a web read and never materialized is a flat row.
  function writerLevel(name: string): Context {
    let rows: WriterSong[] = [];
    let loaded = false;
    let searching = false;
    void songsByWriter(name).then((r) => {
      rows = r;
      loaded = true;
      card().reload();
    });
    const list = () => rows;
    return {
      title: name,
      key: `writer:${name}`, // card memory (CARD-MEMORY.md §5)
      headerLabel: "Writer",
      hero: () => ({
        cover: deps.heroCover(undefined, name, undefined, undefined, true),
        title: name,
        meta: loaded ? `${rows.length} song${rows.length === 1 ? "" : "s"} collected` : "Reading…",
      }),
      // The Apple search fills THIS level in place (the user's call 2026-09-17), so the page
      // you asked the question from is the page that answers it.
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
        card().reload();
        void searchAppleForWriter(name)
          .then((found) => {
            rows = found;
          })
          .finally(() => {
            searching = false;
            card().reload();
          });
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
          match: (s: WriterSong, q: string) => s.title.toLowerCase().includes(q) || s.artistName.toLowerCase().includes(q),
          render: (s: WriterSong, density: Density, idx: number) =>
            deps.cell(density, idx, s.track?.artwork, s.title, s.artistName, {
              cid: s.catalogId,
              badge: s.track ? "" : FLAT_MARK,
            }),
          // Only the songs we hold a track for can play, so the click acts on those.
          activate: (s: WriterSong, _idx: number, items: WriterSong[]) => {
            if (!s.track) return;
            const playable = items.filter((x) => x.track).map((x) => x.track!);
            const at = playable.findIndex((x) => x === s.track);
            void playTracks(playable, Math.max(0, at), `writer:${name}`).catch((e) => console.error("[levels] play writer song", e));
          },
          menu: (s: WriterSong) => (s.track ? songMenu(s.track, { context: `writer:${name}`, nav: libNav }) : []),
        } as Grouping<WriterSong>,
      ],
      defaults: { density: "lines", sortKey: "yours" },
    };
  }

  const resolve = (key: string): Context | null => {
    const i = key.indexOf(":");
    const kind = key.slice(0, i);
    const rest = key.slice(i + 1);
    // A song level is keyed by its catalog id: the library's copy, else one this session met
    // (a Search row). A song no longer in either ends the restore there.
    if (kind === "song") {
      const t = tracks().find((x) => (x.catalogId ?? trackId(x)) === rest) ?? seenSongs.get(rest);
      return t ? songLevel(t) : null;
    }
    // A writer level needs no store: its rows are read again from the collection.
    if (kind === "writer") return rest ? writerLevel(rest) : null;
    // An Apple playlist reads its songs again (the session cache answers a recent one).
    if (kind === "apple-playlist") return rest ? playlistLevel({ id: rest, name: "Playlist" }) : null;
    // A Lib level reads the live store: a name or an album no longer in the library resolves
    // to null, and the restore stops at the level above it.
    if (kind === "artist") return inLibrary(rest) ? libArtistLevel(rest) : null;
    if (kind === "album") {
      const t = tracks().find((x) => albumKey(x) === rest);
      return t ? libAlbumOf(t) : null;
    }
    // A Full level is keyed by its catalog id and reads Apple's page again.
    if (kind === "full-album") return fullAlbumLevel({ albumId: rest, name: "Album" });
    if (kind === "full-artist") return fullArtistLevel({ name: "", id: rest });
    return null;
  };

  return {
    nav: libNav,
    libAlbum: libAlbumLevel,
    libArtist: libArtistLevel,
    fullAlbum: fullAlbumLevel,
    fullArtist: fullArtistLevel,
    playlist: playlistLevel,
    song: songLevel,
    writer: writerLevel,
    resolve,
  };
}
