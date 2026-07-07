// "Go to Artist" / "Go to Album" — shared drill-in verbs (SEARCH.md). A sibling of the
// other menu-item builders (startStationItem, addSongToLibraryItem, addToPlaylistItem):
// a card spreads these into its menu array and drops nulls with `.filter(Boolean)`.
//
// The catalog detail panes live in the Search card (its `.spane` stack + fillArtist/
// fillCollection + the memoized resolve in search.ts). Rather than duplicate that
// surface per card, a drill from ANYWHERE summons the Search card (requestCard) and
// hands it the intent over this bus; the search card runs its own `drillRelated`
// (open pane immediately → resolve id → fill). So resolution + caching stay in one
// place and these builders are dumb: emit intent + summon.

import { requestCard } from "./layout-bus";
import type { MenuItem } from "./context-menu";

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

/** Search-card side: subscribe to drill intents. Returns an unsubscribe fn. */
export function onDrillRequest(cb: Cb): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

function requestDrill(intent: DrillIntent): void {
  // Ensure the detail surface is on-screen. requestCard mounts Search synchronously
  // (registering its subscriber) if absent, or no-ops if already visible — either way
  // the subscriber is live before we emit.
  requestCard("search");
  subs.forEach((cb) => cb(intent));
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

/** "Go to Album" from a song's catalog id — `null` without one. */
export function goToAlbumItem(songCatalogId?: string | null, albumName?: string): MenuItem | null {
  if (!songCatalogId) return null;
  return {
    label: "Go to Album",
    run: () => requestDrill({ srcKind: "songs", srcId: songCatalogId, rel: "albums", name: albumName || "Album" }),
  };
}
