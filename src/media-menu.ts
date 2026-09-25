// The right-click menus for media (docs/architecture/CONTEXT-MENUS.md). One builder per
// media type — song, album, artist, playlist, station, and a list or picked set — and every
// card calls these. A card never writes its own list of media rows: it passes its own rows
// (Move to Top, Refresh, Stop Station) and its take-away rows (Remove, Hide, Delete), and
// the builder puts them in their fixed place. Before 2026-09-23 six cards built their song
// menus by hand, and each one drifted (a missing Pin, ♥ or Mark, rows in another order).
//
// The row order, the same in every menu (§2). A row that does not apply is left out; the
// groups never change places:
//   1 Play      Play Now · Play Next · Add to Queue
//   2 File      Add to Playlist ▸
//   3 Go to     Go to Artist · Go to Album · Go to Playlist · Song Credits
//   4 Seed      Start Station · Start a Web · Copy Link
//   5 Keep      Add to Library · Add to Diary (albums) · Favorite · Mark as Song of the Day · On Click ▸ · Pin
//   6 The card's own rows
//   7 Take away (last): Remove · Hide · Delete
//
// A tile shows "Go to" its own kind (fork 2B): an album tile has Go to Album, an artist tile
// Go to Artist. A song has no song view, so it goes to its artist and album only.

import { invoke } from "@tauri-apps/api/core";
import type { MenuItem } from "./context-menu";
import type { Artwork, Track } from "./library";
import type { LibNav } from "./library-card";
import type { Playlist } from "./search";
import type { Station } from "./radio";
import type { HomeItem } from "./home";
import { artistDetail, catalogRelated, materializeTrack } from "./search";
import { addTransientTracks } from "./track-store";
import { playTracks, queueTracksNext, queueTracksLater, playStation, queueStationAfter, setShuffleMode } from "./player";
import { shuffleInPlace } from "./queue";
import { addToPlaylistItem, requestOpenPlaylist } from "./playlists";
import { requestDrillCard, requestLibraryDrill, requestDiaryAlbum } from "./layout-bus";
import { goToArtistItem, goToAlbumItem, goToAlbumPaneItem, songCreditsItem, requestPlaylistPane, requestArtistPane } from "./go-to";
import { copySongLinkItem, copyAlbumLinkItem, copyAlbumLinkFromSongItem, copyArtistLinkItem, copyPlaylistLinkItem, copyStationLinkItem } from "./copy-link";
import { startStationItem, startArtistStationItem } from "./start-station";
import { startWebItem, type WebSeed } from "./web";
import { addSongToLibraryItem, addAlbumFromSongsItem, addAlbumToLibraryItem, addPlaylistToLibraryItem } from "./library-add";
import { favoriteItem, albumFavoriteItem, playlistFavoriteItem, playlistFav } from "./favorites";
import { markItem } from "./sotd";
import { pinRows, pinItem, pinActItem, songKey, isPinned, setPin, clearPin } from "./pins";
import { albumKey, pid } from "./rewind";
import { picksText } from "./row-pick";
import { setting } from "./settings-store";

type Row = MenuItem | null | undefined | false;

/** Join the groups in their fixed order and drop the rows that do not apply. */
const join = (...groups: Row[][]): MenuItem[] => groups.flat().filter(Boolean) as MenuItem[];

const err = (what: string) => (e: unknown) => console.error(`[menu] ${what}`, e);

/** Where a menu opens: what every builder needs from its card. */
export interface Where {
  /** The queue-origin tag for anything played from this menu. */
  context?: string;
  /** The Library's in-place drills. Absent: the drills go to the Search card's panes. */
  nav?: LibNav;
  /** Group 6: the card's own rows. */
  own?: Row[];
  /** Group 7: the take-away rows (Remove, Hide, Delete) — always last (fork 1A). */
  away?: Row[];
}

/** The list a song sits in, for "Play Now → the song, then the list" (SETTINGS.md / §1). */
export interface ListFrom {
  items: Track[];
  idx: number;
}

/** Group 1 over a list: play it, play it next, queue it. `catalog`: the songs come from
 *  Apple and join the store first, as a Search play does. */
export function playRows(
  load: () => Track[] | Promise<Track[]>,
  context: string | undefined,
  opts: { catalog?: boolean; label?: string; now?: (ts: Track[]) => Promise<void>; shuffle?: boolean } = {},
): MenuItem[] {
  const run = (how: "now" | "shuffle" | "next" | "later") => () =>
    void Promise.resolve(load())
      .then((ts) => {
        if (!ts.length) return;
        if (opts.catalog) {
          addTransientTracks(ts);
          ts.forEach(materializeTrack);
        }
        if (how === "now") return opts.now ? opts.now(ts) : playTracks(ts, 0, context);
        // The Shuffle button's rule (runListAction): with "Shuffle stays on" it turns the mode on.
        if (how === "shuffle") {
          if (setting("shuffleStays")) setShuffleMode(true);
          return playTracks(shuffleInPlace(ts.slice()), 0, context);
        }
        return how === "next" ? queueTracksNext(ts, context) : queueTracksLater(ts, context);
      })
      .catch(err(`play ${how}`));
  return [
    { label: opts.label ?? "Play Now", run: run("now") },
    // Albums and playlists (his call 3A, 2026-09-24): the hero's Shuffle, in every menu.
    opts.shuffle && { label: "Shuffle", run: run("shuffle") },
    { label: "Play Next", run: run("next") },
    { label: "Add to Queue", run: run("later") },
  ].filter(Boolean) as MenuItem[];
}

// ── song ──────────────────────────────────────────────────────────────────────

export interface SongWhere extends Where {
  /** Group 1 in place of the default. `null`: no Play group (the song that is playing). */
  play?: Row[] | null;
  /** Play Now plays the song and then the rest of this list, when Settings says so. */
  listFrom?: ListFrom;
  /** The song comes from Apple: it joins the store before it plays (Search). */
  catalog?: boolean;
  /** The entry's catalog id, where the track is not resolved yet (a Queue or History row). */
  catalogId?: string;
  /** Rows above group 1 — only the Song of the Day suggestion, whose Mark is why it exists. */
  lead?: Row[];
}

/** Go to the song's artist and album, and its credits (group 3). */
function songGoTo(t: Track | undefined, cid: string | undefined, nav?: LibNav): Row[] {
  if (nav && t) {
    const names = nav.artistNames(t);
    const artist: Row =
      names.length === 0
        ? null
        : names.length === 1
          ? { label: "Go to Artist", run: () => nav.drillArtist(names[0]) }
          : { label: "Go to Artist", sub: () => names.map((n) => ({ label: n, run: () => nav.drillArtist(n) })) };
    // A nav means this card drills locally, so Song Credits stays here too (go-to.ts).
    return [
      artist,
      t.albumName ? { label: "Go to Album", run: () => nav.drillAlbum(t) } : null,
      t.catalogId ? { label: "Song Credits", run: () => nav.drillSong(t) } : null,
    ];
  }
  return [goToArtistItem("songs", cid, t?.artistName), goToAlbumItem(cid, t?.albumName), songCreditsItem(t)];
}

/** One song's menu. `t` may be undefined only where a row is still resolving (Queue,
 *  History): the rows that need the track then leave themselves out. */
export function songMenu(t: Track | undefined, w: SongWhere): MenuItem[] {
  const cid = t?.catalogId ?? w.catalogId;
  // An unreleased song (his call 3A, 2026-09-24): Apple will not play, add or link it yet,
  // so only Go to Artist. Apple does resolve the artist of a song that is not out.
  if (t?.unreleased) return join(songGoTo(t, cid, w.nav).slice(0, 1));
  let play: Row[] = [];
  if (w.play !== undefined) play = w.play ?? [];
  else if (t) {
    const lf = w.listFrom;
    const now = lf && setting("playNowScope") === "list" ? () => playTracks(lf.items, lf.idx, w.context) : undefined;
    play = playRows(() => [t], w.context, { catalog: w.catalog, now });
  }
  return join(
    w.lead ?? [],
    play,
    [t ? addToPlaylistItem(() => [t]) : null],
    songGoTo(t, cid, w.nav),
    [
      startStationItem("songs", cid),
      startWebItem(() => (t ? { kind: "song", track: t } : null), !!t?.catalogId),
      copySongLinkItem(cid),
    ],
    [
      t ? addSongToLibraryItem(t) : null,
      favoriteItem(t),
      t ? markItem([t], w.context) : null,
      // A song row pins the song, wherever it sits — inside an album view too (fork 3A).
      ...(t ? pinRows(songKey(t), "song", t) : []),
    ],
    w.own ?? [],
    w.away ?? [],
  );
}

// ── album ─────────────────────────────────────────────────────────────────────

export interface AlbumSubject {
  title: string;
  artistName?: string;
  artwork?: Artwork;
  /** The album's OWN catalog id (a Search result, a Home "New" tile). */
  catalogId?: string;
  /** The songs known without a fetch ([] for a Search result). */
  known: Track[];
  /** The whole album, fetched on the press (an album the library does not hold). */
  whole?: () => Promise<Track[]>;
  /** The songs come from Apple: they join the store before they play. */
  catalog?: boolean;
  /** The pin key, where the tile has its own (Home, a Pinned shelf). `null`: no Pin row
   *  (a release that is not out has no songs to keep). Absent: `album:<albumKey>`. */
  pinKey?: string | null;
}

export interface AlbumWhere extends Where {
  /** Inside this album's artist view: Go to Artist would go where you are. */
  inArtist?: boolean;
  /** Inside the Diary: Add to Diary would open where you are. */
  inDiary?: boolean;
  /** The album's own view (its hero): Go to Album would go where you are. */
  here?: boolean;
}

/** The album's dominant credited artist (mode of each song's leading credit) — the Library
 *  "Go to Artist" target, where a featured guest on one song should not win. */
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

/** Pin rows for an album. A Search album holds no songs until they load: its key comes from
 *  the album's own cover (the rule `albumKey` applies to a song), and the songs load on the press. */
function albumPinRows(a: AlbumSubject): Row[] {
  if (a.pinKey === null) return [];
  if (a.known.length) return pinRows(a.pinKey ?? `album:${albumKey(a.known[0])}`, "album", a.known);
  const whole = a.whole;
  if (!whole) return [];
  const art = a.artwork?.urlTemplate;
  const key = a.pinKey ?? `album:${a.title} ${art ?? a.artistName ?? ""}`;
  const on = isPinned(key);
  return [
    pinActItem(key, "album"),
    {
      label: on ? "Unpin" : "Pin",
      run: () =>
        void (on
          ? clearPin(key)
          : whole().then((ts) => (ts.length ? setPin(`album:${albumKey(ts[0])}`, "album", ts) : undefined))
        ).catch(err("album pin")),
    },
  ];
}

export function albumMenu(a: AlbumSubject, w: AlbumWhere): MenuItem[] {
  const load = a.whole ?? (() => a.known);
  const seed = a.known.find((t) => t.catalogId);
  const first = a.known[0];
  let goArtist: Row;
  let goAlbum: Row;
  if (w.nav && first) {
    const nav = w.nav;
    const dom = dominantArtist(a.known, nav);
    goArtist = dom ? { label: "Go to Artist", run: () => nav.drillArtist(dom) } : null;
    goAlbum = { label: "Go to Album", run: () => nav.drillAlbum(first) };
  } else {
    goArtist = a.catalogId ? goToArtistItem("albums", a.catalogId, a.artistName) : goToArtistItem("songs", seed?.catalogId, a.artistName);
    goAlbum = a.catalogId
      ? goToAlbumPaneItem({ id: a.catalogId, name: a.title, artwork: a.artwork, artistName: a.artistName })
      : goToAlbumItem(seed?.catalogId, a.title);
  }
  if (w.inArtist) goArtist = null;
  if (w.here) goAlbum = null;
  const genres = [...new Set(a.known.flatMap((t) => t.genres ?? []))];
  const webSeed = (): WebSeed => ({
    kind: "album",
    album: { title: a.title, artistName: a.artistName ?? first?.artistName ?? "", artwork: a.artwork ?? first?.artwork, genres, catalogId: a.catalogId },
    songId: seed?.catalogId,
  });
  return join(
    playRows(load, w.context, { catalog: a.catalog, shuffle: true }),
    [addToPlaylistItem(load)],
    [goArtist, goAlbum],
    [
      // An album has no station of its own (Apple seeds stations from songs and artists).
      startWebItem(webSeed, !!(a.catalogId || seed?.catalogId)),
      a.catalogId ? copyAlbumLinkItem(a.catalogId) : copyAlbumLinkFromSongItem(seed?.catalogId),
    ],
    [
      a.catalogId ? addAlbumToLibraryItem(a.catalogId, () => Promise.resolve(load())) : addAlbumFromSongsItem(a.known),
      // The Diary (DIARY.md §2, his call 5C): opens the album's entry, making it the first time.
      !w.inDiary && {
        label: "Add to Diary",
        run: () =>
          requestDiaryAlbum({
            album: {
              title: a.title,
              artistName: a.artistName ?? first?.artistName ?? "",
              artwork: a.artwork ?? first?.artwork,
              catalogId: a.catalogId ?? undefined,
            },
            tracks: load,
          }),
      },
      // ♥ (his call F2A, 2026-09-24): every album menu; the state is what the mirror knows.
      albumFavoriteItem({ id: a.catalogId ?? undefined, seed: seed?.catalogId, name: a.title }),
      ...albumPinRows(a),
    ],
    w.own ?? [],
    w.away ?? [],
  );
}

// ── artist ────────────────────────────────────────────────────────────────────

export interface ArtistSubject {
  name: string;
  /** The artist's own catalog id (Search, a pin's snapshot). A Library artist has none. */
  catalogId?: string;
  artwork?: Artwork;
  /** Songs known without a fetch, in play order. */
  songs?: Track[];
  /** The library holds this artist: Go to Artist opens the Library artist view. */
  inLibrary?: boolean;
  /** The songs to play when the library holds none (a Home tile's own loader). */
  whole?: () => Promise<Track[]>;
}

export interface ArtistWhere extends Where {
  /** The menu of the artist view itself (its hero): no Go to Artist. */
  here?: boolean;
}

/** Apple's top songs for an artist off the library (fork 4A): one memoized read, on the press. */
const topSongs = (id: string) => () => artistDetail(id).then((d) => d.topSongs);

export function artistMenu(a: ArtistSubject, w: ArtistWhere): MenuItem[] {
  const songs = a.songs ?? [];
  const seedIds = songs.map((t) => t.catalogId);
  const seedId = seedIds.find(Boolean);
  // What plays: the library's songs, else the tile's own loader, else Apple's top songs.
  const load: (() => Track[] | Promise<Track[]>) | null =
    a.inLibrary && songs.length ? () => songs : a.whole ?? (a.catalogId ? topSongs(a.catalogId) : songs.length ? () => songs : null);
  const catalog = !(a.inLibrary && songs.length);
  // The catalog id, on the press, for an artist known only by name: the Library's saved
  // row first (zero calls once the artist view was opened), else one song → artist hop.
  let idOnce: Promise<string | null> | null = null;
  const resolveId = (): Promise<string | null> =>
    (idOnce ??= a.catalogId
      ? Promise.resolve(a.catalogId)
      : !seedId
        ? Promise.resolve(null)
        : a.inLibrary
          ? invoke<{ catalogId?: string } | null>("library_artist_info", { name: a.name, songId: seedId, featured: false }).then((i) => i?.catalogId ?? null)
          : catalogRelated("songs", seedId, "artists").then((r) => r?.id ?? null));
  let go: Row = null;
  if (!w.here) {
    const nav = w.nav;
    if (nav && a.inLibrary) go = { label: "Go to Artist", run: () => nav.drillArtist(a.name) };
    else if (a.inLibrary) go = { label: "Go to Artist", run: () => requestLibraryDrill({ kind: "artist", name: a.name }) };
    else if (a.catalogId) {
      const id = a.catalogId;
      go = { label: "Go to Artist", run: () => requestArtistPane({ id, name: a.name }) };
    } else go = goToArtistItem("songs", seedId, a.name);
  }
  return join(
    load ? playRows(load, w.context, { catalog }) : [],
    [load ? addToPlaylistItem(load) : null],
    [go],
    [
      a.catalogId ? startStationItem("artists", a.catalogId) : startArtistStationItem(a.name, seedIds),
      startWebItem(
        () => resolveId().then((id): WebSeed | null => (id ? { kind: "artist", artist: { name: a.name, catalogId: id, artwork: a.artwork } } : null)),
        !!(a.catalogId || seedId),
      ),
      copyArtistLinkItem(a.catalogId, seedId ? resolveId : undefined),
    ],
    pinRows(`artist:${a.name}`, "artist", { name: a.name, artwork: a.artwork, catalogId: a.catalogId }),
    w.own ?? [],
    w.away ?? [],
  );
}

// ── playlist ──────────────────────────────────────────────────────────────────

export interface PlaylistWhere extends Where {
  /** How this card opens the playlist in place (the Playlists card drills). */
  open?: () => void;
  /** The songs come from Apple: they join the store before they play. */
  catalog?: boolean;
  /** Rows above group 1 — only Rename, the field you type into (PLAYLISTS.md §10.2). */
  lead?: Row[];
  /** The playlist's own view (its hero): Go to Playlist would go where you are. */
  here?: boolean;
}

export function playlistMenu(p: Playlist, load: () => Track[] | Promise<Track[]>, w: PlaylistWhere): MenuItem[] {
  let open: Row = null;
  if (w.here) open = null;
  else if (w.open) open = { label: "Go to Playlist", run: w.open };
  else if (p.libraryId) {
    const id = p.libraryId;
    open = { label: "Go to Playlist", run: () => { requestDrillCard("playlists"); requestOpenPlaylist(id); } };
  } else if (p.catalogId) {
    const id = p.catalogId;
    open = { label: "Go to Playlist", run: () => requestPlaylistPane({ id, name: p.name, artwork: p.artwork, curatorName: p.curatorName }) };
  }
  return join(
    w.lead ?? [],
    playRows(load, w.context, { catalog: w.catalog, shuffle: true }),
    [addToPlaylistItem(load, p.libraryId)], // a playlist can't bulk-add to itself
    [open],
    [copyPlaylistLinkItem(p)],
    [
      addPlaylistToLibraryItem(p),
      playlistFavoriteItem(playlistFav(p)),
      // One of Apple's (Search) keeps a snapshot, so its pinned tile draws (pins.ts).
      ...pinRows(`playlist:${pid(p)}`, "playlist", p.libraryId ? undefined : p),
    ],
    w.own ?? [],
    w.away ?? [],
  );
}

// ── station ───────────────────────────────────────────────────────────────────

export interface StationWhere extends Where {
  /** Play Now in place of `playStation` (a card that redraws after it). */
  play?: () => void;
}

export function stationMenu(s: Station, w: StationWhere): MenuItem[] {
  return join(
    [
      { label: "Play Now", run: w.play ?? (() => void playStation(s).catch(err("play station"))) },
      { label: "Add to Queue", run: () => void queueStationAfter(s).catch(err("queue station")) },
    ],
    [copyStationLinkItem(s.url)],
    [pinItem(`station:${s.id}`, "station", s)],
    w.own ?? [],
    w.away ?? [],
  );
}

// ── a tile (Home's shelves, every Pinned shelf) ────────────────────────────────

export interface TileWhere extends Where {
  /** Rows above group 1 (the Song of the Day suggestion's Mark). */
  lead?: Row[];
}

/** A Home tile or a pinned tile: the menu of the kind it is. The tile's own context tag and
 *  pin key carry through, so a play and a pin name the tile, as they always did. */
export function tileMenu(it: HomeItem, w: Omit<TileWhere, "context">): MenuItem[] {
  const list = it.tracks();
  const known = Array.isArray(list) ? list : [];
  const where = { ...w, context: it.context };
  switch (it.kind) {
    case "station":
      return it.station ? stationMenu(it.station, where) : [];
    case "playlist": {
      if (it.playlist) {
        const p = it.playlist;
        return playlistMenu(p, () => Promise.resolve(it.tracks()), where);
      }
      if (!it.catalogId || !it.whole) return [];
      // One of Apple's playlists, pinned from Search: the tile is its snapshot (pins.ts).
      const p: Playlist = { name: it.title, catalogId: it.catalogId, artwork: it.art, curatorName: it.sub, canEdit: false, isPublic: true };
      return playlistMenu(p, it.whole, where);
    }
    case "album":
      return albumMenu(
        {
          title: it.title,
          artistName: it.artistName ?? (it.whole ? it.sub : known[0]?.artistName),
          artwork: it.art,
          catalogId: it.catalogId,
          known,
          whole: it.whole,
          // A tile built from a catalog album (the "New" shelf) may be a release that is
          // not out: no songs to keep, so no Pin row. It never had one.
          pinKey: it.catalogId ? null : it.key,
        },
        where,
      );
    case "artist":
      return artistMenu(
        { name: it.title, artwork: it.art, catalogId: it.catalogId, songs: known, inLibrary: !it.whole, whole: it.whole },
        where,
      );
    case "song":
      return known[0] ? songMenu(known[0], where) : [];
  }
  return [];
}

// ── a list, or a picked set ───────────────────────────────────────────────────

export interface SetWhere extends Where {
  /** Group 1 in place of the default (History plays its rows by handle; Queue has none). */
  play?: Row[];
  /** A playlist's own rows: it can't bulk-add to itself. */
  exclude?: string;
  catalog?: boolean;
}

/** Several picked rows (§19): play, queue or file them all, then the card's own rows. */
export function setMenu(load: () => Track[] | Promise<Track[]>, n: number, noun: string, w: SetWhere): MenuItem[] {
  return listMenu(load, { ...w, label: `Play ${picksText(n, noun)}` });
}

/** A list that is no one album, artist or playlist (a genre): play it, queue it, file it. */
export function listMenu(load: () => Track[] | Promise<Track[]>, w: SetWhere & { label?: string }): MenuItem[] {
  return join(
    w.play ?? playRows(load, w.context, { catalog: w.catalog, label: w.label }),
    [addToPlaylistItem(load, w.exclude)],
    w.own ?? [],
    w.away ?? [],
  );
}
