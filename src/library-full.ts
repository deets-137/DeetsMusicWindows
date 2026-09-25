// The Library's Full view (docs/features/FULL-LIB.md). An album or an artist drilled from the
// Library shows only YOUR songs (the Lib view). The "Full | Lib" chips in the card head swap
// that level for Apple's whole album or artist page, in the same card: the engine's
// `replace`, so Back still goes to where the drill came from.
//
// These are collection-card levels, not Search panes, so Sort, View, Search, the grown
// card's columns, multi-select and card memory all work on them. The rows end in the Add
// square with the ✓ mark on a song you have (fork 4A). A drill always opens Lib (fork 3A):
// Full is the only thing here that asks Apple, and only on the press.
//
// Apple calls (all memory-only, session caches in search.ts):
//   Full album  — the song → album hop (1, memoized) + the album's songs (1, cached).
//                 An album opened from an artist's shelf already has its id: 1.
//   Full artist — the artist's page (1, cached). The id is the one the Lib artist view
//                 saved in `artist_catalog` (0), else 1 hop.
// Card memory keys each level by its catalog id, so a restore re-reads through the caches.

import type { Artwork, Track } from "./library";
import type { CollectionCardHandle, Context, Grouping, SortSpec, ViewOption } from "./collection-card";
import type { LibNav, SongOpts } from "./library-card";
import { catalogRelated, collectionTracks, artistDetail, type ArtistDetail } from "./search";
import { libraryArtistInfo, yourPlaylistsFor, checkPlaylists, artistShelvesHTML, type YourPlaylists, type CheckProgress } from "./artist-view";
import { creditIndex } from "./artist-credit";
import { tracks } from "./track-store";
import { albumMenu, artistMenu, playlistMenu } from "./media-menu";
import { handOff } from "./handoff";
import { requestPlaylistPane } from "./go-to";
import { requestOpenPlaylist, playlistTracks } from "./playlists";
import { formatTotal, esc } from "./collection-card";
import * as diag from "./diag";

/** The two chips, Full first (the owner's words, 2026-09-24). */
export const FULL_LIB: ViewOption[] = [
  { key: "full", label: "Full", title: "Shows the whole album or artist from Apple Music" },
  { key: "lib", label: "Lib", title: "Shows only the songs in your library" },
];
const withOff = (off: () => string | undefined): ViewOption[] => FULL_LIB.map((o) => (o.key === "lib" ? { ...o, off } : o));

export interface FullDeps {
  card: () => CollectionCardHandle;
  songs: (list: () => Track[], o: SongOpts) => Grouping<Track>;
  heroCover: (art: Artwork | undefined, name: string, mosaic?: string[], seed?: string, round?: boolean) => string;
  artURL: (art: Artwork | undefined, px: number) => string | null;
  /** The Lib level of the album these songs belong to; null when none of them is yours.
   *  `libKey`: the album the Lib level came from, when the Full view was opened from it. */
  libAlbum: (songs: Track[], libKey?: string) => Context | null;
  /** The Lib level of an artist; null when no song by the name is yours. */
  libArtist: (name: string) => Context | null;
  /** The Library's own drills, for a song's level and a genre. */
  nav: LibNav;
}

export interface AlbumSource {
  albumId?: string;
  songId?: string;
  name: string;
  artist?: string;
  artwork?: Artwork;
  releaseDate?: string;
  libKey?: string;
}
export interface ArtistSource {
  name: string;
  id?: string;
  albumId?: string;
  artwork?: Artwork;
}

export interface FullViews {
  album(src: AlbumSource): Context;
  artist(src: ArtistSource): Context;
  /** Card memory: a `full-album:` / `full-artist:` key back into its level. */
  resolve(key: string): Context | null;
}

const yearOf = (d?: string) => d?.slice(0, 4);
const inLibrary = (name: string) => creditIndex(tracks()).tracksFor(name).length > 0;

export function fullViews(deps: FullDeps): FullViews {
  const reload = () => deps.card().reload();

  // The Full view's menus: "Go to Album" and "Go to Artist" stay in the Full view (a song
  // there may not be yours, so the Lib album would be empty). A name → one of its song ids,
  // noted as the menu is built, is the artist's seed.
  const seeds = new Map<string, string>();
  const nav: LibNav = {
    artistNames: (t) => {
      const names = creditIndex([t]).namesOf(t);
      if (t.catalogId) for (const n of names) seeds.set(n, t.catalogId);
      return names;
    },
    drillArtist: (name) => deps.card().drill(artist({ name }, seeds.get(name))),
    drillAlbum: (t) => deps.card().drill(album({ songId: t.catalogId, name: t.albumName ?? "Album", artist: t.artistName, artwork: t.artwork })),
    drillGenre: (name) => deps.nav.drillGenre(name),
    drillSong: (t) => deps.nav.drillSong(t),
  };

  function album(src: AlbumSource): Context {
    let id = src.albumId;
    let songs: Track[] | null = null;
    let failed: string | null = null;
    let grouping: Grouping<Track> | null = null;
    const rows = () => songs ?? [];
    const group = () =>
      (grouping ??= deps.songs(rows, { hideCover: true, numbered: true, context: `search-albums:${id ?? ""}`, nav, mark: true }));
    void (async () => {
      try {
        if (!id && src.songId) id = (await catalogRelated("songs", src.songId, "albums"))?.id;
        if (!id) {
          failed = "Apple Music has no copy of this album.";
          return;
        }
        grouping = null; // the queue tag carries the id
        songs = await collectionTracks("albums", id);
      } catch (e) {
        failed = "Could not read the album from Apple Music.";
        console.error("[library] full album", e);
      } finally {
        diag.log("library:full", { kind: "album", id: id ?? null, n: songs?.length ?? 0, failed: !!failed });
        reload();
      }
    })();
    const name = () => songs?.[0]?.albumName ?? src.name;
    const artistName = () => songs?.[0]?.artistName ?? src.artist ?? "";
    const lib = () => (songs ? deps.libAlbum(songs, src.libKey) : src.libKey ? deps.libAlbum([], src.libKey) : null);
    return {
      get title() {
        return name();
      },
      get key() {
        return id ? `full-album:${id}` : undefined;
      },
      headerLabel: "Album",
      hero: () => {
        const ts = rows();
        const art = ts[0]?.artwork ?? src.artwork;
        const year = yearOf(ts.find((t) => t.releaseDate)?.releaseDate ?? src.releaseDate);
        const total = formatTotal(ts.reduce((n, t) => n + (t.durationMs ?? 0), 0));
        const who = artistName();
        return {
          cover: deps.heroCover(art, name()),
          title: name(),
          // The artist in the Full view too: Apple's page, through the album's own relationship.
          sub: who ? { text: who, run: () => deps.card().drill(artist({ name: who, albumId: id })) } : undefined,
          meta: songs ? [year, `${ts.length} song${ts.length === 1 ? "" : "s"}`, total].filter(Boolean).join(" · ") : undefined,
          menu: id
            ? () =>
                albumMenu(
                  { title: name(), artistName: who, artwork: art, catalogId: id, known: rows(), whole: () => collectionTracks("albums", id!), catalog: true },
                  { context: `search-albums:${id}`, here: true },
                )
            : undefined,
        };
      },
      get groupings() {
        return [group()];
      },
      density: true,
      get emptyText() {
        return failed ?? (songs ? "No songs." : "Loading…");
      },
      defaults: { density: "lines", sortKey: "track" },
      views: {
        options: withOff(() => (songs === null && !src.libKey ? "Loading…" : lib() ? undefined : "None of these songs are in your library")),
        active: "full",
        to: (k) => (k === "lib" ? lib() : null),
      },
    };
  }

  function artist(src: ArtistSource, seedSong?: string): Context {
    let id = src.id;
    let d: ArtistDetail | null = null;
    let failed: string | null = null;
    let yours: YourPlaylists | undefined;
    let checking: CheckProgress | null = null;
    let grouping: Grouping<Track> | null = null;
    const top = () => d?.topSongs ?? [];
    const popular: SortSpec<Track> = {
      key: "popular",
      label: "Popular",
      type: "num",
      get: (t) => {
        const i = top().indexOf(t);
        return i < 0 ? undefined : i;
      },
    };
    const group = () =>
      (grouping ??= deps.songs(top, {
        context: `search-artist:${id ?? ""}`,
        nav,
        mark: true,
        extraSorts: [popular],
        actionTitles: {
          play: `Play ${src.name}'s Top Songs from Apple Music, in this order`,
          shuffle: `Shuffle ${src.name}'s Top Songs from Apple Music`,
        },
      }));
    const loadYours = () =>
      yourPlaylistsFor(d?.artist.name ?? src.name)
        .then((y) => {
          yours = y;
          reload();
        })
        .catch((e) => console.error("[library] full artist, your playlists", e));
    void (async () => {
      try {
        if (!id && src.albumId) id = (await catalogRelated("albums", src.albumId, "artists"))?.id;
        if (!id && seedSong) id = (await catalogRelated("songs", seedSong, "artists"))?.id;
        if (!id) {
          // A Library artist: the id the Lib view saved (0 calls once known), else 1 hop.
          const ids = creditIndex(tracks()).tracksFor(src.name).map((t) => t.catalogId);
          if (ids.some(Boolean)) id = (await libraryArtistInfo(src.name, ids))?.catalogId;
        }
        if (!id) {
          failed = "Apple Music has no page for this artist.";
          return;
        }
        grouping = null; // the queue tag carries the id
        d = await artistDetail(id);
        void loadYours();
      } catch (e) {
        failed = "Could not read the artist from Apple Music.";
        console.error("[library] full artist", e);
      } finally {
        diag.log("library:full", { kind: "artist", id: id ?? null, n: d?.topSongs.length ?? 0, failed: !!failed });
        reload();
      }
    })();
    const name = () => d?.artist.name ?? src.name;
    // Newest first, as the Lib view and the Search pane list them.
    let albumList: ArtistDetail["albums"] = [];
    const albumsShelf = (): string => {
      albumList = [...(d?.albums ?? [])].sort((x, y) => (y.releaseDate ?? "").localeCompare(x.releaseDate ?? ""));
      const tiles = albumList
        .map((al, i) => {
          const url = deps.artURL(al.artwork, 128);
          const cover = url
            ? `<img class="search__tile-art" src="${esc(url)}" alt="" loading="lazy" decoding="async" data-art />`
            : `<div class="search__tile-art search__tile-art--empty" aria-hidden="true">♪</div>`;
          return (
            `<div class="search__tile" data-shelf-item="album" data-shelf-idx="${i}" role="button" tabindex="0">${cover}` +
            `<span class="search__tile-name">${esc(al.title)}</span><span class="search__tile-sub">${esc(yearOf(al.releaseDate) ?? "")}</span></div>`
          );
        })
        .join("");
      return tiles ? `<div class="search__label">Albums</div><div class="search__scroller search__scroller--albums">${tiles}</div>` : "";
    };
    return {
      get title() {
        return name();
      },
      get key() {
        return id ? `full-artist:${id}` : undefined;
      },
      headerLabel: "Artist",
      hero: () => ({
        cover: deps.heroCover(d?.artist.artwork ?? src.artwork, name(), undefined, undefined, true),
        title: name(),
        meta: d?.artist.genres?.[0],
        menu: id
          ? () => artistMenu({ name: name(), catalogId: id, artwork: d?.artist.artwork ?? src.artwork, songs: top(), inLibrary: inLibrary(name()) }, { context: `search-artist:${id}`, here: true })
          : undefined,
      }),
      shelves: () => (d ? artistShelvesHTML(d.featuredPlaylists, yours, checking, albumsShelf()) : ""),
      toolbarBelow: "Top Songs",
      onShelf: (el) => {
        const i = Number(el.dataset.shelfIdx);
        const kind = el.dataset.shelfItem;
        if (kind === "album") {
          const al = albumList[i];
          if (al?.catalogId)
            deps.card().drill(album({ albumId: al.catalogId, name: al.title, artist: al.artistName || name(), artwork: al.artwork, releaseDate: al.releaseDate }));
        } else if (kind === "featured") {
          const p = d?.featuredPlaylists[i];
          const pid = p?.catalogId;
          if (p && pid) {
            const intent = { id: pid, name: p.name, artwork: p.artwork, curatorName: p.curatorName };
            handOff(el, "search", () => collectionTracks("playlists", pid), (ts) => requestPlaylistPane({ ...intent, tracks: ts }));
          }
        } else if (kind === "yours") {
          const p = yours?.hits[i]?.p;
          const lid = p?.libraryId;
          if (p && lid) handOff(el, "playlists", () => playlistTracks(p), (ts) => requestOpenPlaylist(lid, ts), p.trackCount);
        } else if (kind === "check" && yours && !checking) {
          checking = { done: 0, total: yours.unchecked.length };
          reload();
          void checkPlaylists(yours.unchecked, (pr) => {
            checking = pr;
            reload();
          })
            .then(loadYours)
            .finally(() => {
              checking = null;
              reload();
            });
        }
      },
      shelfMenu: (el) => {
        const i = Number(el.dataset.shelfIdx);
        if (el.dataset.shelfItem === "album") {
          const al = albumList[i];
          const aid = al?.catalogId;
          return al && aid
            ? albumMenu(
                { title: al.title, artistName: al.artistName, artwork: al.artwork, catalogId: aid, known: [], whole: () => collectionTracks("albums", aid), catalog: true },
                { context: `search-albums:${aid}`, inArtist: true },
              )
            : [];
        }
        if (el.dataset.shelfItem === "featured") {
          const p = d?.featuredPlaylists[i];
          const pid = p?.catalogId;
          return p && pid ? playlistMenu(p, () => collectionTracks("playlists", pid), { context: `search-playlists:${pid}`, catalog: true }) : [];
        }
        const p = el.dataset.shelfItem === "yours" ? yours?.hits[i]?.p : undefined;
        return p ? playlistMenu(p, () => playlistTracks(p), { context: `playlist:${p.libraryId}` }) : [];
      },
      get groupings() {
        return [group()];
      },
      density: true,
      get emptyText() {
        return failed ?? (d ? "No songs." : "Loading…");
      },
      defaults: { density: "lines", sortKey: "popular" },
      views: {
        options: withOff(() => (inLibrary(name()) ? undefined : "No songs by this artist are in your library")),
        active: "full",
        to: (k) => (k === "lib" ? deps.libArtist(name()) : null),
      },
    };
  }

  const resolve = (key: string): Context | null => {
    if (key.startsWith("full-album:")) return album({ albumId: key.slice(11), name: "Album" });
    if (key.startsWith("full-artist:")) return artist({ name: "Artist", id: key.slice(12) });
    return null;
  };

  return { album, artist, resolve };
}
