// The card registry — the foundation of the swappable-slot system (see
// docs/architecture/SURFACES-AND-CARDS.md). Every card is a self-contained, mountable module: it
// builds its own markup into a host element and returns a handle that tears it down
// (so a slot can swap cards without leaking listeners). The layout manager (Phase 2)
// mounts cards into slots from a persisted assignment; for now main.ts mounts the same
// three into their fixed positions.

import { nowPlayingCard } from "./now-playing-card";
import { homeCard } from "./home-card";
import { libraryCard } from "./library-card";
import { queueCard } from "./qcard";
import { playlistsCard } from "./playlists-card";
import { searchCard } from "./search-card";
import { historyCard } from "./history-card";
import { rewindCard } from "./rewind-card";
import { radioCard } from "./radio-card";
import { settingsCard } from "./settings-card";
import { diaryCard } from "./diary-card";

export type CardId = "home" | "now-playing" | "library" | "queue" | "playlists" | "search" | "history" | "rewind" | "radio" | "settings" | "diary";

export interface CardInstance {
  /** Tear down: drop every listener and clear the host. Called when a slot swaps cards. */
  destroy(): void;
  /**
   * Optional — drilling cards (collection-card) report header state so a slot can show
   * the picker only at root and mirror the live title. Non-drilling cards omit it (always
   * "at root"). Declared now; the Phase 2 picker consumes it. Returns an unsubscribe fn.
   */
  onHeaderChange?(cb: (h: { title: string; atRoot: boolean }) => void): () => void;
  /** Card memory (CARD-MEMORY.md): where the card is — keys and view state, never data or DOM.
   *  The layout reads it just before `destroy()` and gives it back on the next mount. */
  snapshot?(): unknown;
}

/** What the layout hands a card at mount. */
export interface MountOpts {
  /** The snapshot this card left at its last destroy (CARD-MEMORY.md §4). A held request wins over it. */
  memory?: unknown;
  /**
   * The drill swap (CARD-GROW.md §14): the next level this card opens is the one a grown card's
   * drill asked for. Back on that level calls this; true = the layout brought the first card
   * back (the card is being destroyed), false = do a plain Back.
   */
  onReturn?: () => boolean;
  /** The card the return goes to, for the Back button's hint. */
  returnTitle?: string;
}

export interface CardDef {
  id: CardId;
  /** Default header label (used by the slot chrome + the picker). */
  title: string;
  /** Build markup into `host` and wire it up; return a handle to tear it down. */
  mount(host: HTMLElement, opts?: MountOpts): CardInstance;
}

/** Cards available to slots. Playlists/Search join here as they're built. */
export const registry: Partial<Record<CardId, CardDef>> = {
  home: homeCard,
  "now-playing": nowPlayingCard,
  library: libraryCard,
  queue: queueCard,
  playlists: playlistsCard,
  search: searchCard,
  history: historyCard,
  rewind: rewindCard,
  radio: radioCard,
  diary: diaryCard,
  settings: settingsCard,
};
