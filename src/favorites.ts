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
import { catalogRelated, type Playlist } from "./search";

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

// ── Albums and playlists (CONTEXT-MENUS.md §3b, his calls F1A F2A F3A, 2026-09-24) ──
// The same set, keyed `album:{id}` / `playlist:{id}` (favorites.rs), plus `albumsong:{id}`
// for a Library album, which knows only its songs: the first song with a catalog id stands
// for the album, so its menu reads the state with no song → album lookup. A menu reads the
// set; a hero, when it opens, asks Apple once per install (`reconcileAlbum` /
// `reconcilePlaylist`). An album or playlist never asked reads "Favorite" — pressing it on
// one already loved only loves it again.

/** An album as the ♥ sees it: its catalog id, its first song's catalog id, or both. */
export interface AlbumFav {
  id?: string;
  seed?: string;
  name: string;
}
/** A playlist as the ♥ sees it: one of Apple's (catalog id) or a library one (`p.` id). */
export interface PlaylistFav {
  kind: "playlists" | "library-playlists";
  id: string;
  name: string;
}

/** How Apple rates this playlist: a library one by its `p.` id, one of Apple's by its catalog
 *  id. A playlist made in DeetsMusic has no Apple rating, so no ♥ (his call F3A). */
export function playlistFav(p: Playlist): PlaylistFav | undefined {
  if (p.source === "local") return undefined;
  if (p.libraryId?.startsWith("p.")) return { kind: "library-playlists", id: p.libraryId, name: p.name };
  if (p.catalogId) return { kind: "playlists", id: p.catalogId, name: p.name };
  return undefined;
}

const albumKeys = (a: AlbumFav): string[] =>
  [a.id && `album:${a.id}`, a.seed && `albumsong:${a.seed}`].filter((k): k is string => !!k);
const isAlbumLoved = (a: AlbumFav): boolean => albumKeys(a).some((k) => loved.has(k));
const albumKnown = (a: AlbumFav): boolean => albumKeys(a).some((k) => known.has(k));
const playlistKey = (p: PlaylistFav): string => `playlist:${p.id}`;

/** The album's catalog id: its own, or its first song's album (one session-cached hop). */
async function albumId(a: AlbumFav): Promise<string | undefined> {
  if (a.id) return a.id;
  if (!a.seed) return undefined;
  return (await catalogRelated("songs", a.seed, "albums"))?.id;
}

/** Flip the set now; roll back and say so if Apple refuses (as `setLoved`). */
async function flip(keys: string[], on: boolean, name: string, write: () => Promise<unknown>): Promise<void> {
  const was = keys.map((k) => loved.has(k));
  keys.forEach((k) => (on ? loved.add(k) : loved.delete(k), known.add(k)));
  emit();
  try {
    await write();
  } catch (e) {
    keys.forEach((k, i) => (was[i] ? loved.add(k) : loved.delete(k)));
    emit();
    toast({ kind: "warn", text: `Couldn't update Favorites for “${name}”.` });
    throw e;
  }
}

/** ♥ / un-♥ an album. A Library album finds its catalog id first. */
export async function setAlbumLoved(a: AlbumFav, on: boolean): Promise<void> {
  const id = await albumId(a);
  if (!id) {
    toast({ kind: "warn", text: `Couldn't find “${a.name}” on Apple Music.` });
    return;
  }
  const full = { ...a, id };
  await flip(albumKeys(full), on, a.name, () =>
    invoke("favorite_collection_set", { kind: "albums", id, alias: a.seed ?? null, loved: on }),
  );
}

export async function setPlaylistLoved(p: PlaylistFav, on: boolean): Promise<void> {
  await flip([playlistKey(p)], on, p.name, () =>
    invoke("favorite_collection_set", { kind: p.kind, id: p.id, alias: null, loved: on }),
  );
}

/** The album hero opened: ask Apple once per install whether it is loved. */
export function reconcileAlbum(a: AlbumFav): void {
  if (!ready || !libraryAddEnabled() || albumKnown(a)) return;
  const k = albumKeys(a)[0];
  if (!k || asked.has(k)) return;
  asked.add(k);
  void albumId(a)
    .then((id) =>
      id
        ? invoke<boolean>("favorite_collection_reconcile", { kind: "albums", id, alias: a.seed ?? null }).then((on) => {
            albumKeys({ ...a, id }).forEach((key) => (on ? loved.add(key) : loved.delete(key), known.add(key)));
            if (on) emit();
          })
        : undefined,
    )
    .catch((e) => console.warn("[favorites] album reconcile", e));
}

/** The playlist hero opened: ask Apple once per install whether it is loved. */
export function reconcilePlaylist(p: PlaylistFav): void {
  const k = playlistKey(p);
  if (!ready || !libraryAddEnabled() || known.has(k) || asked.has(k)) return;
  asked.add(k);
  invoke<boolean>("favorite_collection_reconcile", { kind: p.kind, id: p.id, alias: null })
    .then((on) => {
      known.add(k);
      if (on) {
        loved.add(k);
        emit();
      }
    })
    .catch((e) => console.warn("[favorites] playlist reconcile", e));
}

/** Favorite / Unfavorite for an album, or null when not offered (gate off, no id at all). */
export function albumFavoriteItem(a: AlbumFav): MenuItem | null {
  if (!libraryAddEnabled() || (!a.id && !a.seed)) return null;
  const on = isAlbumLoved(a);
  return {
    label: on ? "Unfavorite" : "Favorite",
    run: () => void setAlbumLoved(a, !on).catch((e) => console.error("[favorites] album", e)),
  };
}

/** Favorite / Unfavorite for a playlist, or null (gate off, or no Apple rating: F3A). */
export function playlistFavoriteItem(p: PlaylistFav | undefined): MenuItem | null {
  if (!p || !libraryAddEnabled()) return null;
  const on = loved.has(playlistKey(p));
  return {
    label: on ? "Unfavorite" : "Favorite",
    run: () => void setPlaylistLoved(p, !on).catch((e) => console.error("[favorites] playlist", e)),
  };
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
