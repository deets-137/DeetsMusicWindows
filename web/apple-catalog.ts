// The Apple catalog normalizers for a web build (docs/features/WebRooms.md §9.3 C). The app's own
// normalizers are in Rust (src-tauri/src/apple.rs, "Catalog normalizers"); a browser has no
// Rust, so this file is their TypeScript twin. The two MUST give the same model for the same
// Apple JSON: tests/web-catalog.test.ts and the Rust test `web_twin_fixture` both read
// tests/fixtures/apple-catalog.json and must both produce tests/fixtures/apple-catalog.expected.json.
// Change one side, change the other, or the pre-push check fails.
//
// Pure: no DOM, no MusicKit, no imports with side effects, so Node's test runner loads it.
// Each function follows its Rust namesake line for line. Rust's `skip_serializing_if =
// "Option::is_none"` becomes a key that is left out, never one set to `undefined`.

import type { Artwork, Track } from "../src/library";
import type { Album, Artist, ArtistDetail, NamedRef, Playlist, SearchResults } from "../src/search";
import type { Station } from "../src/radio";

type Json = any;

const str = (v: Json): string | undefined => (typeof v === "string" ? v : undefined);
/** Rust's `as_u64()`: a whole number that is not negative. */
const u64 = (v: Json): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined);
const bool = (v: Json): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const at = (v: Json, ...path: (string | number)[]): Json => path.reduce((o, k) => (o == null ? undefined : o[k]), v);
const strings = (v: Json): string[] => (Array.isArray(v) ? v.filter((g) => typeof g === "string") : []);

/** Copy only the keys whose value is not `undefined` (Rust leaves a `None` out). */
function defined<T extends object>(o: T): T {
  const out: any = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

export function artworkFrom(v: Json): Artwork | undefined {
  const url = str(at(v, "url"));
  if (url === undefined) return undefined;
  const textColors = ["textColor1", "textColor2", "textColor3", "textColor4"].map((k) => str(at(v, k))).filter((c): c is string => c !== undefined);
  return defined({
    urlTemplate: url,
    width: u64(at(v, "width")) ?? 0,
    height: u64(at(v, "height")) ?? 0,
    bgColor: str(at(v, "bgColor")),
    textColors: textColors.length ? textColors : undefined,
  }) as Artwork;
}

export function trackFromCatalogSong(v: Json): Track {
  const a = at(v, "attributes");
  const pp = at(a, "playParams");
  const id = str(at(v, "id"));
  const playId = str(at(pp, "id"));
  return defined({
    catalogId: id,
    title: str(at(a, "name")) ?? "",
    artistName: str(at(a, "artistName")) ?? "",
    albumName: str(at(a, "albumName")),
    artwork: artworkFrom(at(a, "artwork")),
    durationMs: u64(at(a, "durationInMillis")),
    trackNumber: u64(at(a, "trackNumber")),
    discNumber: u64(at(a, "discNumber")),
    genres: strings(at(a, "genreNames")),
    contentRating: str(at(a, "contentRating")),
    hasLyrics: bool(at(a, "hasLyrics")) ?? false,
    isrc: str(at(a, "isrc")),
    composer: str(at(a, "composerName")),
    previewUrl: str(at(a, "previews", 0, "url")),
    releaseDate: str(at(a, "releaseDate")),
    // No playParams = Apple will not play it yet (model.rs `Track::unreleased`). Rust leaves
    // `false` out, so this does too.
    unreleased: pp == null ? true : undefined,
    playParams: defined({
      id: playId ?? id,
      catalogId: playId,
      kind: str(at(pp, "kind")),
      isLibrary: false,
    }),
  }) as Track;
}

export function albumFromCatalog(v: Json): Album {
  const a = at(v, "attributes");
  return defined({
    catalogId: str(at(v, "id")),
    title: str(at(a, "name")) ?? "",
    artistName: str(at(a, "artistName")) ?? "",
    artwork: artworkFrom(at(a, "artwork")),
    genres: strings(at(a, "genreNames")),
    releaseDate: str(at(a, "releaseDate")),
    trackCount: u64(at(a, "trackCount")),
  }) as Album;
}

export function artistFromCatalog(v: Json): Artist {
  const a = at(v, "attributes");
  const genres = strings(at(a, "genreNames"));
  return defined({
    catalogId: str(at(v, "id")),
    name: str(at(a, "name")) ?? "",
    artwork: artworkFrom(at(a, "artwork")),
    genres: genres.length ? genres : undefined, // Rust: skip_serializing_if = "Vec::is_empty"
  }) as Artist;
}

export function playlistFromCatalog(v: Json): Playlist {
  const a = at(v, "attributes");
  return defined({
    catalogId: str(at(v, "id")),
    globalId: str(at(a, "playParams", "globalId")),
    name: str(at(a, "name")) ?? "",
    // Catalog playlists nest description as { standard, short }.
    description: str(at(a, "description", "standard")),
    curatorName: str(at(a, "curatorName")),
    artwork: artworkFrom(at(a, "artwork")),
    canEdit: false,
    isPublic: true,
    lastModified: str(at(a, "lastModifiedDate")),
  }) as Playlist;
}

export function stationFromCatalog(v: Json): Station {
  const a = at(v, "attributes");
  const pp = at(a, "playParams");
  const id = str(at(v, "id")) ?? "";
  const notes = at(a, "editorialNotes");
  return defined({
    id,
    name: str(at(a, "name")) ?? "",
    artwork: artworkFrom(at(a, "artwork")),
    isLive: bool(at(a, "isLive")) ?? false,
    tagline: str(at(notes, "short")) ?? str(at(notes, "standard")),
    contentRating: str(at(a, "contentRating")),
    url: str(at(a, "url")),
    playParams: defined({ id: str(at(pp, "id")) ?? id, kind: str(at(pp, "kind")), isLibrary: false }),
  }) as Station;
}

// ── The command bodies (apple.rs: catalog_search, catalog_collection_tracks, catalog_artist,
// catalog_related), from an Apple reply to our model. The fetching is web/handlers.ts. ──

const bucket = (results: Json, key: string): Json[] => {
  const d = at(results, key, "data");
  return Array.isArray(d) ? d : [];
};

/** The reply of `/v1/catalog/{sf}/search` → `SearchResults`. */
export function searchResultsFrom(body: Json): SearchResults {
  const r = at(body, "results");
  return {
    songs: bucket(r, "songs").map(trackFromCatalogSong),
    albums: bucket(r, "albums").map(albumFromCatalog),
    artists: bucket(r, "artists").map(artistFromCatalog),
    playlists: bucket(r, "playlists").map(playlistFromCatalog),
    stations: bucket(r, "stations").map(stationFromCatalog),
  };
}

/** The five shippable search categories (SEARCH.md); music videos are never requested. */
export const SEARCH_TYPES = ["songs", "albums", "artists", "playlists", "stations"] as const;

/** A collection's track items (the first page plus any `next` pages) → `Track[]`. Music videos
 *  are skipped. A pre-release album's unreleased songs carry the album's date. */
export function collectionTracksFrom(kind: "albums" | "playlists", body: Json, items: Json[]): Track[] {
  const albumDate = kind === "albums" ? str(at(body, "data", 0, "attributes", "releaseDate")) : undefined;
  return items
    .filter((v) => str(at(v, "type")) === "songs")
    .map((v) => {
      const t = trackFromCatalogSong(v);
      if (t.unreleased && t.releaseDate === undefined && albumDate !== undefined) t.releaseDate = albumDate;
      return t;
    });
}

/** The views merged into the Albums shelf, in order (apple.rs `ALBUM_VIEWS`). */
export const ALBUM_VIEWS = ["full-albums", "singles", "live-albums"] as const;
/** `Album.kind` for each of ALBUM_VIEWS (apple.rs `ALBUM_KINDS`). */
const ALBUM_KINDS = ["album", "single", "live"] as const;
export const APPEARS_VIEW = "appears-on-albums";

/** The reply of `/v1/catalog/{sf}/artists/{id}?views=…` → `ArtistDetail`. `whole`: a view read
 *  to its end (apple.rs `whole_view`), in place of the first 10 the reply holds. */
export function artistDetailFrom(body: Json, whole: Record<string, Json[]> = {}): ArtistDetail {
  const a = at(body, "data", 0);
  const view = (name: string): Json[] => {
    if (whole[name]) return whole[name];
    const d = at(a, "views", name, "data");
    return Array.isArray(d) ? d : [];
  };
  // One release can sit in two views: it shows once, in the first.
  const seen = new Set<string>();
  const keep = (v: Json) => {
    const id = str(at(v, "id"));
    if (id === undefined) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  };
  // Each release carries the view it came from, for the shelf's filter (ARTIST-VIEW.md §12).
  const albums = ALBUM_VIEWS.flatMap((name, i) => view(name).map((v) => [v, ALBUM_KINDS[i]] as const))
    .filter(([v]) => keep(v))
    .map(([v, kind]) => ({ ...albumFromCatalog(v), kind }));
  return {
    artist: artistFromCatalog(a),
    albums,
    appearsOn: view(APPEARS_VIEW).filter(keep).map(albumFromCatalog),
    topSongs: view("top-songs").filter((v) => str(at(v, "type")) === "songs").map(trackFromCatalogSong),
    featuredPlaylists: view("featured-playlists").map(playlistFromCatalog),
  };
}

/** The reply of `/v1/catalog/{sf}/{kind}/{id}?include={rel}` → the first related resource. */
export function relatedFrom(body: Json, rel: string): NamedRef | null {
  const node = at(body, "data", 0, "relationships", rel, "data", 0);
  const id = str(at(node, "id"));
  if (id === undefined) return null;
  return defined({ id, name: str(at(node, "attributes", "name")) ?? "", releaseDate: str(at(node, "attributes", "releaseDate")) });
}
