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
//
// Feedback (TOASTS.md): a failed add is a timed warn. The FIRST add ever raises a
// one-time notice (`deets.notice.addOneWay`): no undo from here, and where to turn the
// action off — its [Settings] button opens Settings › Apple Music at this row. Any press
// silences it (2026-09-14). Later adds confirm with a timed success (Everything tier).

import { invoke } from "@tauri-apps/api/core";
import type { Track } from "./library";
import type { MenuItem } from "./context-menu";
import { inLibrary, loadTracks } from "./track-store";
import { catalogRelated } from "./search";
import { toast, noticeOff } from "./toast";
import { requestSetting } from "./layout-bus";

export const ADD_NOTICE_KEY = "deets.notice.addOneWay";
const NOTICE_KEY = ADD_NOTICE_KEY;

// ── the "Library Add" setting (mirrors deets.alwaysOnTop / deets.menuMode) ──
const KEY = "deets.libraryAdd";
let enabled = localStorage.getItem(KEY) !== "off"; // default ON (2026-09-10; was opt-in)
export const libraryAddEnabled = (): boolean => enabled;
const toggleListeners = new Set<() => void>();
/** Fires when the Library Add toggle flips (the Now Playing "+" square shows/hides live). */
export function onLibraryAddChange(cb: () => void): () => void {
  toggleListeners.add(cb);
  return () => toggleListeners.delete(cb);
}
export function setLibraryAddEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* storage disabled — still applies for the session */
  }
  toggleListeners.forEach((cb) => cb());
}

/** Would "Add to Library" be offered for this track right now? (toggle on, not in the
 *  library, has a catalog id) — the visibility rule for the Now Playing "+" square. */
export function libraryAddOffered(t: Track): boolean {
  return enabled && !!t.catalogId && !alreadyInLibrary(t);
}

// ── the write ──
// POST to Apple, then reload the shared store so the Library card reflects the add
// (the graduated rows now query as source='library'). `tracks` are the rows to reflect
// locally: the one song, or an album's fetched tracks (fork A). Ids ride the URL, so a
// dropped playlist's songs go 100 at a time.
const ADD_BATCH = 100;
export async function addToLibrary(kind: "songs" | "albums", ids: string[], tracks: Track[]): Promise<void> {
  try {
    if (kind === "albums" || ids.length <= ADD_BATCH) await invoke("apple_add_to_library", { kind, ids, tracks });
    else
      for (let i = 0; i < ids.length; i += ADD_BATCH)
        await invoke("apple_add_to_library", { kind, ids: ids.slice(i, i + ADD_BATCH), tracks: tracks.slice(i, i + ADD_BATCH) });
  } catch (e) {
    toast({ kind: "warn", text: `Couldn't add the ${kind === "albums" ? "album" : "song"} to your library.` });
    throw e;
  }
  const what = kind === "albums" ? "Album added" : "Added";
  if (!noticeOff(NOTICE_KEY)) {
    toast({
      kind: "info",
      text: `${what}. DeetsMusic can't remove it; use the Music app. Turn this off in Settings › Apple Music.`,
      onceKey: NOTICE_KEY,
      actions: [{ label: "Settings", run: () => requestSetting("libraryadd") }],
    });
  } else {
    toast({ kind: "success", text: `${what} to your library.` });
  }
  await loadTracks();
}

/**
 * Direct add of one song — the tray panel's "+" (via np-bus). NOT gated by the
 * Library Add toggle: that toggle reveals a right-click item, whereas pressing an
 * explicit "+" IS the consent. Rejects catalog-less rows the same way the menu does.
 */
export async function addTrackToLibrary(t: Track): Promise<void> {
  if (!t.catalogId) throw new Error("track has no catalog id");
  if (alreadyInLibrary(t)) return;
  await addToLibrary("songs", [t.catalogId], [t]);
}

// A track actually in the library shouldn't offer "Add" (it'd be a no-op). We test REAL
// membership against the synced store — NOT the mere presence of a libraryId: a mirror
// playlist's tracks all carry a library-relationship id even when the song isn't in the
// user's library (e.g. an added editorial playlist), so keying off libraryId alone wrongly
// hid the action inside those playlists.
export const alreadyInLibrary = (t: Track): boolean => inLibrary(t.catalogId) || inLibrary(t.libraryId);

/**
 * A drop on the Library card (DRAG-DROP.md §3) — the menu's behavior: gated by the toggle,
 * no question, the one-time notice after the first add. `albumId` adds a catalog album as
 * the album; otherwise songs already in the library and uploads are skipped. Resolves
 * false when there was nothing to add.
 */
export async function addDroppedToLibrary(tracks: Track[], albumId?: string): Promise<boolean> {
  if (!enabled) return false;
  if (albumId) {
    await addToLibrary("albums", [albumId], tracks);
    return true;
  }
  const fresh = tracks.filter((t) => t.catalogId && !alreadyInLibrary(t));
  if (!fresh.length) return false;
  await addToLibrary("songs", fresh.map((t) => t.catalogId!), fresh);
  return true;
}

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
/**
 * "Add to Library" for the album a LIST is — the album-shaped menus every card builds
 * through `trackMenu` (Home's shelves, the Pinned shelves, Playlists, Queue, History).
 * Until 2026-09-20 an album could be added from the Search card alone, because Apple adds
 * an album by its OWN id and a list of songs carries none.
 *
 * The id is resolved LAZILY, on pick: one `songs → albums` hop, the same one `wholeAlbum()`
 * makes and memoized beside it in search.ts, so a tile the user has already played or
 * drilled costs no call at all. If the hop fails the songs themselves are added, which is
 * the outcome the user asked for either way.
 *
 * Null when the toggle is off, when no song of the list carries a catalog id, or when the
 * library already holds every song — that last rule is what keeps the row off every album
 * tile on the Library card, where the answer is always "you have it".
 */
export function addAlbumFromSongsItem(items: Track[]): MenuItem | null {
  if (!enabled || !items.length) return null;
  const seed = items.find((t) => t.catalogId);
  if (!seed?.catalogId) return null;
  if (items.every(alreadyInLibrary)) return null;
  return {
    label: "Add to Library",
    run: () =>
      void catalogRelated("songs", seed.catalogId!, "albums")
        .then((ref) => {
          if (ref) return addToLibrary("albums", [ref.id], items);
          const fresh = items.filter((t) => t.catalogId && !alreadyInLibrary(t));
          return fresh.length ? addToLibrary("songs", fresh.map((t) => t.catalogId!), fresh) : undefined;
        })
        .catch((e) => console.error("[library-add] album from songs", e)),
  };
}

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
