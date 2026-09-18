// "Go to Artist" / "Go to Album" — shared drill-in verbs (SEARCH.md). A sibling of the
// other menu-item builders (startStationItem, addSongToLibraryItem, addToPlaylistItem):
// a card spreads these into its menu array and drops nulls with `.filter(Boolean)`.
//
// **The rule, and its limit** (restated 2026-09-17 after it was misapplied).
//
// The app has TWO drill systems, and which one a verb belongs to depends on whether the
// target needs an Apple id hop:
//
//  • A CATALOG target (an artist, an album or a playlist we hold only a name for) needs a
//    `?include=` hop to resolve, and that resolve is memoized in search.ts. Those panes live
//    in the Search card (its `.spane` stack + fillArtist / fillCollection). Rather than
//    duplicate that surface per card, a drill from ANYWHERE summons the Search card
//    (requestCard) and hands it the intent over this bus; the search card runs its own
//    `drillRelated` (open pane → resolve id → fill). Resolution and caching stay in one
//    place, and these builders stay dumb: emit intent + summon.
//
//  • A LOCAL target — one answered from data the app already holds, at zero Apple calls —
//    belongs to the collection-card engine instead, which Library, Playlists and Radio all
//    run on: a stack of `Context` levels with its own hero, rows, Back, slide and card
//    memory. The Library drills artist, album and genre this way (`LibNav`), and the song
//    pane too (CREDITS.md §7.6): `drillSong` in a card that has a nav, the Search pane in a
//    card that does not.
//
// So a menu builder here that has a nav in hand should prefer it. `goToItems` in
// library-card.ts is the reference: it branches on `nav` before it reaches for this bus.

import { requestDrillCard } from "./layout-bus";
import type { MenuItem } from "./context-menu";
import type { Artwork, Track } from "./library";

export interface DrillIntent {
  /** The SOURCE resource we hop FROM. */
  srcKind: "songs" | "albums";
  srcId: string;
  /** The relationship to follow. */
  rel: "artists" | "albums";
  /** Shown as the pane title until the resolved name arrives. */
  name: string;
}

type Cb = (intent: DrillIntent) => void;
const subs = new Set<Cb>();
// The intent waits here until a Search card takes it (CARD-GROW.md §14.5): a card mounted BY
// the request takes it on mount, one already on screen through the subscription. A skin with
// an out step mounts the card after the swap plays, so an emit alone would be lost. An old
// request is dropped, so it cannot open a pane much later.
const HOLD_TTL_MS = 5000;
let pendingDrill: { intent: DrillIntent; at: number } | null = null;

/** Search-card side: subscribe to drill intents. Returns an unsubscribe fn. */
export function onDrillRequest(cb: Cb): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

/** Search-card side: take the waiting drill intent (null when none, or too old). */
export function takeDrillRequest(): DrillIntent | null {
  const p = pendingDrill;
  pendingDrill = null;
  return p && Date.now() - p.at < HOLD_TTL_MS ? p.intent : null;
}

function requestDrill(intent: DrillIntent): void {
  pendingDrill = { intent, at: Date.now() };
  requestDrillCard("search");
  if (pendingDrill) subs.forEach((cb) => cb(intent));
  pendingDrill = null;
}

/**
 * "Go to Artist" from a song's or album's catalog id — `null` (self-suppresses) when
 * there's no catalog id, e.g. an uploaded library track. For an album menu, pass the
 * album's kind so the hop follows the album's own artist relationship.
 */
export function goToArtistItem(
  kind: "songs" | "albums",
  catalogId?: string | null,
  fallbackName?: string,
): MenuItem | null {
  if (!catalogId) return null;
  return {
    label: "Go to Artist",
    run: () => requestDrill({ srcKind: kind, srcId: catalogId, rel: "artists", name: fallbackName || "Artist" }),
  };
}

/** A catalog playlist to open as a Search pane (a Featured Playlists tile on the Library
 *  artist view, ARTIST-VIEW.md §5). The tile already knows the playlist: no id hop. */
export interface PlaylistPaneIntent {
  id: string;
  name: string;
  artwork?: Artwork;
  curatorName?: string;
  /** The playlist's songs, when the caller fetched them already (the chip flight). */
  tracks?: Track[];
}
const paneSubs = new Set<(intent: PlaylistPaneIntent) => void>();
let pendingPane: { intent: PlaylistPaneIntent; at: number } | null = null;

/** Search-card side: subscribe to catalog playlist panes. Returns an unsubscribe fn. */
export function onPlaylistPaneRequest(cb: (intent: PlaylistPaneIntent) => void): () => void {
  paneSubs.add(cb);
  return () => paneSubs.delete(cb);
}

/** Search-card side: take the waiting playlist pane (null when none, or too old). */
export function takePlaylistPaneRequest(): PlaylistPaneIntent | null {
  const p = pendingPane;
  pendingPane = null;
  return p && Date.now() - p.at < HOLD_TTL_MS ? p.intent : null;
}

/** Summon the Search card and open a catalog playlist pane there. */
export function requestPlaylistPane(intent: PlaylistPaneIntent): void {
  pendingPane = { intent, at: Date.now() };
  requestDrillCard("search");
  if (pendingPane) paneSubs.forEach((cb) => cb(intent));
  pendingPane = null;
}

/** "Go to Album" from a song's catalog id — `null` without one. */
export function goToAlbumItem(songCatalogId?: string | null, albumName?: string): MenuItem | null {
  if (!songCatalogId) return null;
  return {
    label: "Go to Album",
    run: () => requestDrill({ srcKind: "songs", srcId: songCatalogId, rel: "albums", name: albumName || "Album" }),
  };
}

// ── The song pane (CREDITS.md §7) ────────────────────────────────────────────
// A song is the one thing every card lists and no card could open. It rides the same bus
// as the catalog playlist pane above: the caller already holds the Track, so there is no
// id hop — the pane opens full.

export interface SongPaneIntent {
  track: Track;
}
const songSubs = new Set<(intent: SongPaneIntent) => void>();
let pendingSong: { intent: SongPaneIntent; at: number } | null = null;

/** Search-card side: subscribe to song panes. Returns an unsubscribe fn. */
export function onSongPaneRequest(cb: (intent: SongPaneIntent) => void): () => void {
  songSubs.add(cb);
  return () => songSubs.delete(cb);
}

/** Search-card side: take the waiting song pane (null when none, or too old). */
export function takeSongPaneRequest(): SongPaneIntent | null {
  const p = pendingSong;
  pendingSong = null;
  return p && Date.now() - p.at < HOLD_TTL_MS ? p.intent : null;
}

export function requestSongPane(intent: SongPaneIntent): void {
  pendingSong = { intent, at: Date.now() };
  requestDrillCard("search");
  if (pendingSong) songSubs.forEach((cb) => cb(intent));
  pendingSong = null;
}

/**
 * "Song Credits" — opens the song pane, whose first section is the writers.
 * `null` without a catalog id (an uploaded library track has no credits to show).
 */
export function songCreditsItem(track?: Track | null): MenuItem | null {
  if (!track?.catalogId) return null;
  return { label: "Song Credits", run: () => requestSongPane({ track }) };
}
