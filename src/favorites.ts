// ♥ Favorites (FAVORITES.md, NEXT-VERSION §3) — the front-end half of the love rating.
//
// One in-memory set of loved catalog ids, seeded from the Rust mirror at boot and kept
// in step by three feeds: our own writes (optimistic flip → PUT/DELETE → roll back on
// error), Apple's generated "Favorite Songs" playlist (seeded in Rust whenever its
// tracks are fetched; the Playlists card triggers that once per session), and a
// batched ratings read for ids the mirror has never seen (`reconcile`). Menus and the
// Now Playing ♥ read `isLoved` synchronously and subscribe to `onFavoritesChange`.
//
// Gate: the ♥ is an account write, so it rides the same consent as Add to Library
// (the Library Add toggle) — one switch for "DeetsMusic may write to my Apple account".

import { invoke } from "@tauri-apps/api/core";
import type { Track } from "./library";
import type { MenuItem } from "./context-menu";
import { libraryAddEnabled } from "./library-add";
import { toast } from "./toast";

const loved = new Set<string>();
const known = new Set<string>(); // every id the mirror holds a row for (loved or not)
const asked = new Set<string>(); // ids already sent to reconcile this session
let ready = false;

const listeners = new Set<() => void>();
export function onFavoritesChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const emit = () => listeners.forEach((cb) => cb());

/** Load the mirror once at boot (zero Apple calls). Safe to call again after a seed. */
export async function initFavorites(): Promise<void> {
  try {
    const [l, k] = await Promise.all([
      invoke<string[]>("favorites_cached"),
      invoke<string[]>("favorites_known"),
    ]);
    loved.clear();
    l.forEach((id) => loved.add(id));
    k.forEach((id) => known.add(id));
    ready = true;
    emit();
  } catch (e) {
    console.warn("[favorites] load", e);
  }
}

/** Is the ♥ offered for this track at all? (consent on, has a catalog id) */
export const favoriteOffered = (t: Track | undefined): t is Track =>
  !!t?.catalogId && libraryAddEnabled();

export const isLoved = (t: Track | undefined): boolean => !!t?.catalogId && loved.has(t.catalogId);

/** ♥ or un-♥. Optimistic: the set flips now, Apple is told, a failure flips it back. */
export async function setLoved(t: Track, on: boolean): Promise<void> {
  const id = t.catalogId;
  if (!id) throw new Error("track has no catalog id");
  const was = loved.has(id);
  if (on) loved.add(id);
  else loved.delete(id);
  known.add(id);
  emit();
  try {
    await invoke("favorite_set", { track: t, loved: on });
  } catch (e) {
    if (was) loved.add(id);
    else loved.delete(id);
    emit();
    // The ♥ just flipped back; say why (TOASTS.md). Every ♥ path (menus, Now Playing) lands here.
    toast({ kind: "warn", text: `Couldn't update Favorites for “${t.title}”.` });
    throw e;
  }
}

export const toggleLoved = (t: Track): Promise<void> => setLoved(t, !isLoved(t));

/**
 * Ask Apple about the tracks on screen the mirror has never seen — a ♥ set on the
 * phone before Favorite Songs caught up. Batched (100 ids per call in Rust), each id
 * asked at most once per install, so a card render costs at most one small read and
 * usually none. Fire-and-forget; the change bus repaints when answers land.
 */
export function reconcile(tracks: Track[]): void {
  if (!ready || !libraryAddEnabled()) return;
  const ids: string[] = [];
  for (const t of tracks) {
    const id = t.catalogId;
    if (!id || known.has(id) || asked.has(id)) continue;
    asked.add(id);
    ids.push(id);
  }
  if (!ids.length) return;
  invoke<{ loved: string[]; unloved: string[] }>("favorites_reconcile", { ids })
    .then((r) => {
      r.loved.forEach((id) => { loved.add(id); known.add(id); });
      r.unloved.forEach((id) => { loved.delete(id); known.add(id); });
      if (r.loved.length) emit();
    })
    .catch((e) => console.warn("[favorites] reconcile", e));
}

/** The shared right-click item: Favorite / Unfavorite, or null when not offered. */
export function favoriteItem(t: Track | undefined): MenuItem | null {
  if (!favoriteOffered(t)) return null;
  const on = isLoved(t);
  return {
    label: on ? "Unfavorite" : "Favorite",
    run: () => void setLoved(t, !on).catch((e) => console.error("[favorites] set", e)),
  };
}
