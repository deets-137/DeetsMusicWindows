// The pure half of Suggest Less (docs/features/SUGGEST-LESS.md §5c): does a song match a mark?
// No DOM, no MusicKit and no invoke here, so tests/suggest-match.test.ts can pin the rule. The
// player asks it at a song change and in the queue's window, so it must answer at once: the
// marks sit in memory (suggest.ts) and the match reads only the song's own words.
//
// The order, and it stops at the first hit: the song (its id), the album (its name and its
// artist), the artist (every credited name: the artist line split and whole, and the "feat."
// part of the title, as web.rs reads it). Two artists with one name both match (accepted, §5c).

export type MarkKind = "song" | "artist" | "album";

/** The words of a song the match reads. A `Track` fits; so does a station's now-playing item. */
export interface MatchSong {
  catalogId?: string;
  libraryId?: string;
  title: string;
  artistName: string;
  albumName?: string;
  albumArtist?: string;
}

/** The marks as the match reads them: folded names, built once per change of the list. */
export interface MarkSets {
  songs: Set<string>;
  artists: Set<string>;
  /** Folded album name → the folded artists it was marked under. */
  albums: Map<string, Set<string>>;
}

export const emptySets = (): MarkSets => ({ songs: new Set(), artists: new Set(), albums: new Map() });

/** Lower case, accents removed, spaces collapsed (§5c "folded"). */
export function fold(s: string | undefined | null): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** "A, B & C" → ["A", "B", "C"]; "A x B" → ["A", "B"] (web.rs `split_names`). */
export function splitNames(line: string): string[] {
  return line
    .replace(/ x /g, ",")
    .replace(/ X /g, ",")
    .split(/[,&]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** The names inside "(feat. …)" / "[with …]" in a title (web.rs `feat_names`). */
export function featNames(title: string): string[] {
  const m = /[([](?:feat\.? |featuring |with )([^)\]]*)/i.exec(title);
  return m ? splitNames(m[1]) : [];
}

/** Every name a song credits, folded: the artist line split and whole, and the feat. part. */
export function creditedNames(s: Pick<MatchSong, "title" | "artistName">): string[] {
  const names = [...splitNames(s.artistName), s.artistName, ...featNames(s.title)];
  return [...new Set(names.map(fold).filter(Boolean))];
}

/** The key the album mark is stored under when Apple gave no album id. */
export const albumNameKey = (album: string, artist: string): string => `${fold(album)}|${fold(artist)}`;

/** Add one mark to the sets. `name` / `artist` are the mark's words (the artist's name; the
 *  album's title and its artist). A song mark is matched by its key alone. */
export function addMark(sets: MarkSets, kind: MarkKind, key: string, name?: string | null, artist?: string | null): void {
  if (kind === "song") {
    sets.songs.add(key);
    return;
  }
  if (kind === "artist") {
    const n = fold(name ?? key);
    if (n) sets.artists.add(n);
    return;
  }
  const album = fold(name);
  if (!album) return;
  const by = sets.albums.get(album) ?? new Set<string>();
  by.add(fold(artist));
  sets.albums.set(album, by);
}

/** Which mark a song matches, in §5c's order, or null. `songId`: an extra id to try (a queue
 *  row's library id resolved to its catalog id). */
export function matchSong(sets: MarkSets, s: MatchSong, songId?: string): MarkKind | null {
  for (const id of [s.catalogId, s.libraryId, songId]) if (id && sets.songs.has(id)) return "song";
  const names = sets.albums.size || sets.artists.size ? creditedNames(s) : [];
  if (sets.albums.size && s.albumName) {
    const by = sets.albums.get(fold(s.albumName));
    if (by) {
      // The album's own artist when the song says it; else any name the song credits.
      const albumArtist = fold(s.albumArtist);
      if (by.has("") || (albumArtist && by.has(albumArtist)) || names.some((n) => by.has(n))) return "album";
    }
  }
  if (sets.artists.size && names.some((n) => sets.artists.has(n))) return "artist";
  return null;
}
