// Add-to-Library (FAVORITES.md). A deliberate, gated write: ➕ add a catalog song or
// album to the user's iCloud Music Library over the MUT we already hold. Apple is
// add-only — there is no remove counterpart — so the action is gated behind the
// "Library Add" settings toggle (the deliberate consent) and then runs silently: on
// success the track simply appears in the Library card.
//
// This module owns the toggle flag, the invoke wrapper, and the shared menu-item
// builders (siblings of `addToPlaylistItem` in playlists.ts). Callers spread a builder
// into their menu array; it returns `null` when it shouldn't offer (toggle off, already
// in the library, or no catalog id), and the caller drops nulls with `.filter(Boolean)`.

import { invoke } from "@tauri-apps/api/core";
import type { Track } from "./library";
import type { MenuItem } from "./context-menu";
import { inLibrary, loadTracks } from "./track-store";

// ── the "Library Add" setting (mirrors deets.alwaysOnTop / deets.menuMode) ──
const KEY = "deets.libraryAdd";
let enabled = localStorage.getItem(KEY) === "on"; // default off — opt-in consent
export const libraryAddEnabled = (): boolean => enabled;
export function setLibraryAddEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* storage disabled — still applies for the session */
  }
}

// ── the write ──
// POST to Apple, then reload the shared store so the Library card reflects the add
// (the graduated rows now query as source='library'). `tracks` are the rows to reflect
// locally: the one song, or an album's fetched tracks (fork A).
async function addToLibrary(kind: "songs" | "albums", ids: string[], tracks: Track[]): Promise<void> {
  await invoke("apple_add_to_library", { kind, ids, tracks });
  await loadTracks();
}

// A track actually in the library shouldn't offer "Add" (it'd be a no-op). We test REAL
// membership against the synced store — NOT the mere presence of a libraryId: a mirror
// playlist's tracks all carry a library-relationship id even when the song isn't in the
// user's library (e.g. an added editorial playlist), so keying off libraryId alone wrongly
// hid the action inside those playlists.
const alreadyInLibrary = (t: Track): boolean => inLibrary(t.catalogId) || inLibrary(t.libraryId);

/**
 * "Add to Library" for one song. Returns `null` when the toggle is off, the track is
 * already in the library, or it has no catalog id (catalog-less uploads can't be added).
 */
export function addSongToLibraryItem(t: Track): MenuItem | null {
  if (!enabled || alreadyInLibrary(t) || !t.catalogId) return null;
  return {
    label: "Add to Library",
    run: () =>
      void addToLibrary("songs", [t.catalogId!], [t]).catch((e) =>
        console.error("[library-add] song", e),
      ),
  };
}

/**
 * "Add to Library" for a whole album (fork A): adds the album resource by catalog id and
 * graduates its tracks locally so they appear right away. `getTracks` resolves lazily on
 * pick (usually already cached from enrichment / a drill-in). Returns `null` when the
 * toggle is off or there's no catalog id.
 */
export function addAlbumToLibraryItem(catalogId: string, getTracks: () => Promise<Track[]>): MenuItem | null {
  if (!enabled || !catalogId) return null;
  return {
    label: "Add to Library",
    run: () =>
      void getTracks()
        .then((ts) => addToLibrary("albums", [catalogId], ts))
        .catch((e) => console.error("[library-add] album", e)),
  };
}
