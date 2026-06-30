// The card registry — the foundation of the swappable-slot system (see
// docs/SURFACES-AND-CARDS.md). Every card is a self-contained, mountable module: it
// builds its own markup into a host element and returns a handle that tears it down
// (so a slot can swap cards without leaking listeners). The layout manager (Phase 2)
// mounts cards into slots from a persisted assignment; for now main.ts mounts the same
// three into their fixed positions.

import { nowPlayingCard } from "./now-playing-card";
import { libraryCard } from "./library-card";
import { queueCard } from "./qcard";
import { playlistsCard } from "./playlists-card";

export type CardId = "now-playing" | "library" | "queue" | "playlists" | "search";

export interface CardInstance {
  /** Tear down: drop every listener and clear the host. Called when a slot swaps cards. */
  destroy(): void;
  /**
   * Optional — drilling cards (collection-card) report header state so a slot can show
   * the picker only at root and mirror the live title. Non-drilling cards omit it (always
   * "at root"). Declared now; the Phase 2 picker consumes it. Returns an unsubscribe fn.
   */
  onHeaderChange?(cb: (h: { title: string; atRoot: boolean }) => void): () => void;
}

export interface CardDef {
  id: CardId;
  /** Default header label (used by the slot chrome + the picker). */
  title: string;
  /** Build markup into `host` and wire it up; return a handle to tear it down. */
  mount(host: HTMLElement): CardInstance;
}

/** Cards available to slots. Playlists/Search join here as they're built. */
export const registry: Partial<Record<CardId, CardDef>> = {
  "now-playing": nowPlayingCard,
  library: libraryCard,
  queue: queueCard,
  playlists: playlistsCard,
};
