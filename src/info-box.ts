// The Last.fm facts boxes beside a hero (LISTENERS.md §6 the artist's, §7 the album's).
//
// One box idiom for both (his sketch, 2026-10-12): a 2×2 grid of sections, each a
// shelf-style header over its facts; the right column right-aligned. The artist's: Tags ·
// Listening Stats / On tour · Links. The album's: Tags · Listening Stats / About (the first
// two sentences of Last.fm's wiki) · Links. A missing section leaves its cell empty.
//
// Every view that draws an artist or album hero draws it: the Library's Lib and Full levels
// through `Hero.aside`, the Search panes into their `[data-artist-info]` holder. Nothing shows
// until Last.fm answers "have", and nothing with the box's row off (`showArtistInfo`,
// `showAlbumInfo`). On a narrow card the box folds under one *Artist Info* / *Album Info*
// line, closed by default, the last choice kept (`infoBoxOpen` in listeners.ts); on a wide
// card it is always open (styles.css, a container query on the hero). A right-click inside a
// box opens its own small menu (info-box-menu.ts). The hints are ONBOARDING.md §1.

import { esc } from "./collection-card";
import { fmtCount, infoBoxOpen, type AlbumInfo, type ArtistInfo } from "./listeners";
import { wikiSentences } from "./lastfm-names";
import { setting } from "./settings-store";

export const ARTIST_INFO_HINTS = {
  tags: "What Last.fm listeners call this artist",
  tour: "On tour now, says Last.fm",
  counts: "Plays and listeners of this artist on Last.fm",
  lastfm: "Opens the artist's page on Last.fm",
  toggle: "Shows or hides Last.fm's facts about this artist",
} as const;

export const ALBUM_INFO_HINTS = {
  tags: "What Last.fm listeners call this album",
  about: "From the album's wiki on Last.fm",
  counts: "Plays and listeners of this album on Last.fm",
  lastfm: "Opens the album's page on Last.fm",
  toggle: "Shows or hides Last.fm's facts about this album",
} as const;

/** How many tags a box shows: Last.fm's calls give five. */
const TAGS_MAX = 5;
/** How many sentences of the wiki About shows (his call, 2026-10-13). */
const ABOUT_SENTENCES = 2;

type Hints = { tags: string; counts: string; lastfm: string; toggle: string };

const sec = (where: string, head: string, body: string) =>
  `<div class="artist-info__sec artist-info__sec--${where}"><div class="artist-info__h">${head}</div>${body}</div>`;

function tagsSec(tags: string[], h: Hints): string {
  const chips = tags
    .slice(0, TAGS_MAX)
    .map((t) => `<span class="artist-info__tag" title="${h.tags}">${esc(t)}</span>`)
    .join("");
  return chips ? sec("tags", "Tags", `<div class="artist-info__tags">${chips}</div>`) : "";
}

function statsSec(plays: number, listeners: number, h: Hints): string {
  return sec(
    "stats",
    "Listening Stats",
    `<div class="artist-info__counts" title="${h.counts}">` +
      `<span class="artist-info__count"><b>${fmtCount(plays)}</b>Plays</span>` +
      `<span class="artist-info__count"><b>${fmtCount(listeners)}</b>Listeners</span></div>`,
  );
}

function linksSec(url: string | undefined, h: Hints): string {
  return url
    ? sec("links", "Links", `<button class="artist-info__link" type="button" data-artist-lastfm data-url="${esc(url)}" title="${h.lastfm}">Last.fm ↗</button>`)
    : "";
}

/** The wrap: the fold line, the fold, the box. `kind` names the box for its line, its menu
 *  and its Settings row; `url` rides along for the menu's *Open Last.fm*. */
function boxHTML(kind: "artist" | "album", url: string | undefined, h: Hints, sections: string): string {
  const open = infoBoxOpen();
  const line = kind === "artist" ? "Artist Info" : "Album Info";
  return (
    `<div class="artist-info-wrap" data-open="${open ? 1 : 0}" data-info-box="${kind}"${url ? ` data-url="${esc(url)}"` : ""}>` +
    `<button class="artist-info__toggle" type="button" data-artist-info-toggle aria-expanded="${open}" title="${h.toggle}"><span class="artist-info__h">${line}</span></button>` +
    `<div class="artist-info__fold"><div class="artist-info__fold-in"><div class="artist-info artist-info--${kind}">${sections}</div></div></div></div>`
  );
}

/** Under reduced motion, a box that is still on its way holds its place, empty, so the cover
 *  starts on the left and nothing moves when the facts land (his call, 2026-10-13). With motion
 *  the hero draws centered and the box slides in (hero-slide.ts). */
function pendingBoxHTML(kind: "artist" | "album"): string {
  if (!setting(kind === "artist" ? "showArtistInfo" : "showAlbumInfo")) return "";
  let still = false;
  try {
    still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    /* motion on */
  }
  return still ? `<div class="artist-info-wrap" data-info-box="${kind}" data-info-pending aria-hidden="true"></div>` : "";
}

export function artistInfoHTML(i: ArtistInfo | null | undefined): string {
  if (i === undefined) return pendingBoxHTML("artist"); // still on its way
  if (!i || i.state !== "have") return "";
  const h = ARTIST_INFO_HINTS;
  const tour = i.onTour
    ? sec("tour", "On tour", `<span class="artist-info__tour" title="${h.tour}"><span class="artist-info__dot" aria-hidden="true"></span>Touring now</span>`)
    : "";
  return boxHTML("artist", i.url, h, tagsSec(i.tags, h) + statsSec(i.playcount, i.listeners, h) + tour + linksSec(i.url, h));
}

export function albumInfoHTML(i: AlbumInfo | null | undefined): string {
  if (i === undefined) return pendingBoxHTML("album"); // still on its way
  if (!i || i.state !== "have") return "";
  const h = ALBUM_INFO_HINTS;
  const text = i.wiki ? wikiSentences(i.wiki, ABOUT_SENTENCES) : "";
  // The About text is clamped to a fixed number of lines in a box of a fixed height, so a
  // long summary and a short one draw the same box (his ask, 2026-10-13).
  const about = text ? sec("about", "About", `<p class="artist-info__about" title="${h.about}">${esc(text)}</p>`) : "";
  return boxHTML("album", i.url, h, tagsSec(i.tags, h) + statsSec(i.playcount, i.listeners, h) + about + linksSec(i.url, h));
}
