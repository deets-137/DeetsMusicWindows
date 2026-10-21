// The Last.fm facts boxes beside a hero (LISTENERS.md §6 the artist's, §7 the album's, §8 the
// song's on Song Credits: Tags · Listening Stats / About · Links, the About by `pickNote`).
//
// One box idiom for both (his sketch, 2026-10-12): a 2×2 grid of sections, each a
// shelf-style header over its facts; the right column right-aligned. The artist's: Tags ·
// Listening Stats / On tour · Links. The album's: Tags · Listening Stats / About (the first
// two sentences of Last.fm's wiki) · Links. A missing section leaves its cell empty.
//
// Every view that draws an artist or album hero draws it: the Library's Lib and Full levels
// through `Hero.aside`, the Search panes into their `[data-artist-info]` holder. Nothing shows
// until Last.fm answers "have" (an album's box also when Apple's notes fill its About,
// features/album-notes.md), and nothing with the box's row off (`showArtistInfo`, `showAlbumInfo`). On a narrow card the box folds under one *Artist Info* / *Album Info*
// line, closed by default, the last choice kept (`infoBoxOpen` in listeners.ts); on a wide
// card it is always open (styles.css, a container query on the hero). A right-click inside a
// box opens its own small menu (info-box-menu.ts). The hints are ONBOARDING.md §1.

import { esc } from "./collection-card";
import { fmtCount, infoBoxOpen, type AlbumInfo, type ArtistInfo, type ListenCount } from "./listeners";
import { noteText, wikiSentences } from "./lastfm-names";
import { pickNote, type Note, type NoteFrom, type NoteOf } from "./notes-order";
import { setting } from "./settings-store";
import { shortText, songPart } from "./album-notes-parse";
import type { AlbumNotes } from "./album-notes";
import { motionReduced } from "./motion";

export const ARTIST_INFO_HINTS = {
  tags: "What Last.fm listeners call this artist",
  tour: "On tour now, says Last.fm",
  counts: "Plays and listeners of this artist on Last.fm. In Max, click to show them large",
  lastfm: "Opens the artist's page on Last.fm",
  toggle: "Shows or hides Last.fm's facts about this artist",
} as const;

export const ALBUM_INFO_HINTS = {
  tags: "What Last.fm listeners call this album",
  counts: "Plays and listeners of this album on Last.fm. In Max, click to show them large",
  lastfm: "Opens the album's page on Last.fm",
  toggle: "Shows or hides the facts about this album from Last.fm and Apple Music",
} as const;

export const SONG_INFO_HINTS = {
  tags: "What Last.fm listeners call this song",
  counts: "Plays and listeners of this song on Last.fm. In Max, click to show them large",
  lastfm: "Opens the song's page on Last.fm",
  toggle: "Shows or hides Last.fm's facts about this song",
} as const;

/** The About cell's hint names where its words come from (LISTENERS.md §8.3). */
export const ABOUT_HINTS: Record<NoteFrom, Record<NoteOf, string>> = {
  lastfm: { song: "From the song's wiki on Last.fm", album: "From the album's wiki on Last.fm" },
  apple: { song: "From Apple Music's notes on the album, about this song", album: "From Apple Music's notes on this album" },
};

/** How many tags a box shows: Last.fm's calls give five. */
const TAGS_MAX = 5;
/** How many sentences of the wiki About shows (his call, 2026-10-13). */
const ABOUT_SENTENCES = 2;

type Hints = { tags: string; counts: string; lastfm: string; toggle: string };
type Kind = "artist" | "album" | "song";
const KEY_OF: Record<Kind, "showArtistInfo" | "showAlbumInfo" | "showSongInfo"> = {
  artist: "showArtistInfo",
  album: "showAlbumInfo",
  song: "showSongInfo",
};
const LINE_OF: Record<Kind, string> = { artist: "Artist Info", album: "Album Info", song: "Song Info" };

const sec = (where: string, head: string, body: string) =>
  `<div class="artist-info__sec artist-info__sec--${where}"><div class="artist-info__h">${head}</div>${body}</div>`;

function tagsSec(tags: string[], h: Hints): string {
  const chips = tags
    .slice(0, TAGS_MAX)
    .map((t) => `<span class="artist-info__tag" title="${h.tags}">${esc(t)}</span>`)
    .join("");
  return chips ? sec("tags", "Tags", `<div class="artist-info__tags">${chips}</div>`) : "";
}

/** The stats cell. In Max a click on it presents the counts over the whole card
 *  (`data-present`, present.ts; PresentationMode.md); elsewhere it is plain text. */
function statsSec(plays: number, listeners: number, h: Hints): string {
  return sec(
    "stats",
    "Listening Stats",
    `<div class="artist-info__counts" data-present title="${h.counts}">` +
      `<span class="artist-info__count"><b>${fmtCount(plays)}</b>Plays</span>` +
      `<span class="artist-info__count"><b>${fmtCount(listeners)}</b>Listeners</span></div>`,
  );
}

function linksSec(url: string | undefined, h: Hints): string {
  return url
    ? sec("links", "Links", `<button class="artist-info__link" type="button" data-artist-lastfm data-url="${esc(url)}" title="${h.lastfm}">Last.fm ↗</button>`)
    : "";
}

/** The About cell: the note `pickNote` chose, its first sentences, a hint naming its source.
 *  On the song page an album's note is headed *About the album* (his call, 2026-10-17).
 *  `full`: the album whose full Apple note a click opens (features/album-notes.md §2), on every
 *  surface; the cell is then a press, as Listening Stats is in Max. */
function aboutSec(note: Note | null, onSong: boolean, full?: string): string {
  if (!note) return "";
  const text = wikiSentences(note.text, ABOUT_SENTENCES);
  if (!text) return "";
  const head = onSong && note.of === "album" ? "About the album" : "About";
  const opens = full && note.from === "apple" && note.of === "album" ? ` data-notes="${esc(full)}" role="button" tabindex="0"` : "";
  return sec("about", head, `<p class="artist-info__about"${opens} title="${ABOUT_HINTS[note.from][note.of]}">${esc(text)}</p>`);
}

/** Apple's short note, when the notes landed and say something. */
const appleShort = (n: AlbumNotes | null | undefined) => (n?.state === "have" ? shortText(n.short) : undefined);

/** The names a box was asked by: presentation mode re-reads the counts under them. A song's
 *  box carries its key and title too (`song`, `title`). */
type Names = { artist: string; album?: string; song?: string; title?: string };

const attr = (name: string, v: string | undefined) => (v ? ` data-${name}="${esc(v)}"` : "");

/** The wrap: the fold line, the fold, the box. `kind` names the box for its line, its menu
 *  and its Settings row; `url` rides along for the menu's *Open Last.fm*; `names` for
 *  presentation mode. */
function boxHTML(kind: Kind, url: string | undefined, h: Hints, sections: string, names?: Names): string {
  const open = infoBoxOpen();
  const line = LINE_OF[kind];
  const named = names ? attr("artist", names.artist) + attr("album", names.album) + attr("song", names.song) + attr("title", names.title) : "";
  return (
    `<div class="artist-info-wrap" data-open="${open ? 1 : 0}" data-info-box="${kind}"${url ? ` data-url="${esc(url)}"` : ""}${named}>` +
    `<button class="artist-info__toggle" type="button" data-artist-info-toggle aria-expanded="${open}" title="${h.toggle}"><span class="artist-info__h">${line}</span></button>` +
    `<div class="artist-info__fold"><div class="artist-info__fold-in"><div class="artist-info artist-info--${kind}">${sections}</div></div></div></div>`
  );
}

/** Under reduced motion, a box that is still on its way holds its place, empty, so the cover
 *  starts on the left and nothing moves when the facts land (his call, 2026-10-13). With motion
 *  the hero draws centered and the box slides in (hero-slide.ts). */
function pendingBoxHTML(kind: Kind): string {
  if (!setting(KEY_OF[kind])) return "";
  let still = false;
  try {
    still = motionReduced();
  } catch {
    /* motion on */
  }
  return still ? `<div class="artist-info-wrap" data-info-box="${kind}" data-info-pending aria-hidden="true"></div>` : "";
}

export function artistInfoHTML(i: ArtistInfo | null | undefined, name?: string): string {
  if (i === undefined) return pendingBoxHTML("artist"); // still on its way
  if (!i || i.state !== "have") return "";
  const h = ARTIST_INFO_HINTS;
  const tour = i.onTour
    ? sec("tour", "On tour", `<span class="artist-info__tour" title="${h.tour}"><span class="artist-info__dot" aria-hidden="true"></span>Touring now</span>`)
    : "";
  return boxHTML("artist", i.url, h, tagsSec(i.tags, h) + statsSec(i.playcount, i.listeners, h) + tour + linksSec(i.url, h), name ? { artist: name } : undefined);
}

/**
 * The album's box. `i`: Last.fm's facts; `notes`: Apple's editorial notes (features/album-notes.md),
 * `undefined` while either is on its way. The box draws when either source has something: Last.fm's
 * tags and counts, or Apple's short note in the About (Apple first, then Last.fm's wiki, by
 * *Notes from*). A missing section leaves its cell empty.
 */
export function albumInfoHTML(i: AlbumInfo | null | undefined, artist?: string, album?: string, notes?: AlbumNotes | null): string {
  if (!setting("showAlbumInfo")) return "";
  const have = i?.state === "have";
  // The About text is clamped to a fixed number of lines in a box of a fixed height, so a
  // long summary and a short one draw the same box (his ask, 2026-10-13). Its source follows
  // *Notes from* (LISTENERS.md §8.4).
  const note = pickNote({ appleAlbum: appleShort(notes), lastfmAlbum: have ? noteText(i!.wiki) : undefined }, setting("notesSource"));
  const full = notes?.state === "have" && notes.standard ? notes.albumId : undefined;
  const about = aboutSec(note, false, full);
  // Still on its way: the place is held (reduced motion) until both have answered or one has
  // something to show.
  if (!have && !about) return i === undefined || notes === undefined ? pendingBoxHTML("album") : "";
  const h = ALBUM_INFO_HINTS;
  const url = have ? i!.url : undefined;
  const facts = have ? tagsSec(i!.tags, h) + statsSec(i!.playcount, i!.listeners, h) : "";
  const names = artist && album ? { artist, album } : undefined;
  return boxHTML("album", url, h, facts + about + linksSec(url, h), names);
}

/**
 * The song's box on its page, Song Credits (LISTENERS.md §8). `i` is the song's Last.fm
 * answer; `album` the album's Last.fm facts when the song page asked for them (only when
 * nothing before the album's wiki fills the About, `needsAlbumWiki`). A song Last.fm does not
 * know draws an About-only box when its album has a note, and no box without one.
 */
export function songInfoHTML(
  i: ListenCount | null | undefined,
  t: { key: string; artist: string; title: string },
  album?: AlbumInfo | null,
  notes?: AlbumNotes | null,
): string {
  if (i === undefined) return pendingBoxHTML("song"); // still on its way
  if (!setting("showSongInfo")) return "";
  const have = i?.state === "have";
  const h = SONG_INFO_HINTS;
  // Apple's two steps (features/album-notes.md): the song's own part of a track-by-track note,
  // then the album's short note (LISTENERS.md §8.2 item 3).
  const apple = notes?.state === "have" ? notes : undefined;
  const note = pickNote(
    {
      appleSong: apple?.standard ? songPart(apple.standard, t.title) : undefined,
      lastfmSong: have ? noteText(i.wiki) : undefined,
      appleAlbum: appleShort(apple),
      lastfmAlbum: album?.state === "have" ? noteText(album.wiki) : undefined,
    },
    setting("notesSource"),
  );
  const about = aboutSec(note, true);
  if (!have && !about) return "";
  const url = have ? i.url : undefined;
  const facts = have ? tagsSec(i.tags ?? [], h) + statsSec(i.playcount, i.listeners, h) : "";
  return boxHTML("song", url, h, facts + about + linksSec(url, h), { artist: t.artist, song: t.key, title: t.title });
}
