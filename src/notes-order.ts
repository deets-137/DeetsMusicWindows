// Which note an About cell shows (LISTENERS.md §8.2 item 3, his calls 2026-10-17). Pure, so the
// order is a unit test (tests/notes-order.test.ts).
//
// The song before its album, then Apple before Last.fm: Apple's part about the song (from a
// track-by-track album note), Last.fm's song wiki, Apple's album note, Last.fm's album wiki.
// The source row (*Notes from*, `notesSource`, §8.4) keeps one source or none, and the order
// inside it. Apple's two steps wait on album notes (ideas/album-notes.md); until then they are
// never given, and the cell runs Last.fm's two.

export type NotesSource = "both" | "apple" | "lastfm" | "none";
export type NoteFrom = "apple" | "lastfm";
export type NoteOf = "song" | "album";

/** What each source has. A missing or empty text is "nothing there". */
export interface NoteCandidates {
  appleSong?: string;
  lastfmSong?: string;
  appleAlbum?: string;
  lastfmAlbum?: string;
}

export interface Note {
  text: string;
  from: NoteFrom;
  of: NoteOf;
}

const STEPS: { key: keyof NoteCandidates; from: NoteFrom; of: NoteOf }[] = [
  { key: "appleSong", from: "apple", of: "song" },
  { key: "lastfmSong", from: "lastfm", of: "song" },
  { key: "appleAlbum", from: "apple", of: "album" },
  { key: "lastfmAlbum", from: "lastfm", of: "album" },
];

/** The first note the source row allows, or null (the cell stays empty). */
export function pickNote(c: NoteCandidates, source: NotesSource): Note | null {
  if (source === "none") return null;
  for (const s of STEPS) {
    if (source !== "both" && source !== s.from) continue;
    const text = c[s.key]?.trim();
    if (text) return { text, from: s.from, of: s.of };
  }
  return null;
}

/** Does the song page still need the album's Last.fm facts for its About? Only when no step
 *  before the album's Last.fm wiki can fill the cell, and the row allows Last.fm (§8.3). */
export function needsAlbumWiki(c: NoteCandidates, source: NotesSource): boolean {
  if (source !== "both" && source !== "lastfm") return false;
  const before = pickNote({ appleSong: c.appleSong, lastfmSong: c.lastfmSong, appleAlbum: c.appleAlbum }, source);
  return !before;
}
