// "Show cover: Playlist" (PLAYLISTS.md §11): for a song played from a playlist, the Now
// Playing card and the tray panel show the playlist's saved cover instead of the album's.
// A saved cover is the user's own image, a drawn Letters/Note cover, or Apple's artwork
// for the playlist. A mosaic playlist has none, so it keeps the album cover. The Windows
// media overlay and the album tint always follow the album.
//
// The queue entry's context tag names the playlist: `playlist:<pid>` (the Playlists card,
// Rewind) or `search-playlists:<catalogId>` (Search). Lookups read a map built from the
// cached playlist list — zero Apple calls.

import { playlistsCached, onPlaylistsChange } from "./playlists";
import { setting, onSettingsChange } from "./settings-store";
import type { Playlist } from "./search";

let byContext = new Map<string, Playlist>();
let started = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((cb) => cb());

/** Same id rule as the Playlists card's `pid` (its context tags). */
const pid = (p: Playlist) => p.libraryId ?? p.catalogId ?? p.name;

function reload(): void {
  playlistsCached()
    .then((ps) => {
      const m = new Map<string, Playlist>();
      for (const p of ps) {
        m.set(`playlist:${pid(p)}`, p);
        if (p.catalogId) m.set(`search-playlists:${p.catalogId}`, p);
      }
      byContext = m;
      notify();
    })
    .catch((e) => console.warn("[playlist-cover] load", e));
}

function start(): void {
  if (started) return;
  started = true;
  reload();
  onPlaylistsChange(() => reload());
  onSettingsChange((k) => {
    if (k === "nowPlayingCover") notify();
  });
}

/** Fires when the answer of `playlistCoverFor` may have changed (the setting, a new cover). */
export function onPlaylistCoverChange(cb: () => void): () => void {
  start();
  subs.add(cb);
  return () => subs.delete(cb);
}

/** The playlist cover URL for a queue entry's context, at `px`; undefined when the setting
 *  is Album, the song is not from a known playlist, or the playlist has no saved cover. */
export function playlistCoverFor(context: string | undefined, px: number): string | undefined {
  if (!context || setting("nowPlayingCover") !== "playlist") return undefined;
  start();
  const t = byContext.get(context)?.artwork?.urlTemplate;
  if (!t) return undefined;
  const s = String(px);
  return t.replace("{w}", s).replace("{h}", s).replace("{f}", "jpg");
}
