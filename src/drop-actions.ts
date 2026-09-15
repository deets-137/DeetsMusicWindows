// What a drop does (DRAG-DROP.md §3) — the writes behind each drop target, so the cards
// only decide WHERE the pointer is. Each one resolves the payload's songs at the drop
// (a Search album fetches only now) and speaks through the toasts the menus use: a
// `success` after the write (Everything tier), a `warn` on failure. An Apple write keeps
// its own question and notices.

import type { Track } from "./library";
import type { Playlist } from "./search";
import type { DragPayload } from "./row-drag";
import { playTracks, playTracksKeepQueue, queueTracksAt, queueStationAfter } from "./player";
import { setting } from "./settings-store";
import * as queue from "./queue";
import { playlistInsertTracks, addToApple, names, songs } from "./playlists";
import { addDroppedToLibrary } from "./library-add";
import { toast } from "./toast";

/** “Song” for one, “12 songs” for more. */
const what = (ts: Track[]) => (ts.length === 1 ? names([ts[0].title]) : songs(ts.length));

const resolve = (p: DragPayload): Promise<Track[]> => Promise.resolve(p.tracks());

/** The Queue card: into Up Next at `at` (0 = next). Nothing playing → the songs start.
 *  A station (2026-09-15) has no place among the songs: wherever it lands it becomes the
 *  station return and plays once the queue runs dry (player.ts queueStationAfter). */
export function dropToQueue(p: DragPayload, at: number): void {
  const wasPlaying = !!queue.getCurrent();
  if (p.kind === "station") {
    const s = p.station;
    if (!s) return;
    queueStationAfter(s)
      .then(() => {
        if (wasPlaying) toast({ kind: "success", text: `“${s.name}” plays after the queue.` });
      })
      .catch((e) => console.error("[drop] queue station", e)); // playStation raises its own toast
    return;
  }
  resolve(p)
    .catch((e) => {
      toast({ kind: "warn", text: "Couldn't add to the queue." }); // the fetch failed; queueTracksAt says its own
      throw e;
    })
    .then((ts) => {
      if (!ts.length) return;
      return queueTracksAt(at, ts, p.context).then(() => {
        if (wasPlaying) toast({ kind: "success", text: `Added ${what(ts)} to Up Next.` });
      });
    })
    .catch((e) => console.error("[drop] queue", e));
}

/** The Now Playing card: play at once. Settings › Playback › Drop on Now Playing decides Up
 *  Next: kept after the dropped songs (default), or replaced as Play Now does. */
export function dropToPlay(p: DragPayload): void {
  const keep = setting("dropPlayQueue") === "keep";
  const play = (ts: Track[]) => (keep ? playTracksKeepQueue(ts, p.context) : playTracks(ts, 0, p.context));
  const go = p.play ?? (() => resolve(p).then((ts) => (ts.length ? play(ts) : undefined)));
  go().catch((e) => console.error("[drop] play", e)); // playTracks raises its own toasts
}

/** A local playlist: at authored position `at`, or the end when null. */
export function dropToPlaylist(pl: Playlist, p: DragPayload, at: number | null): void {
  resolve(p)
    .then((ts) => {
      if (!ts.length) return;
      return playlistInsertTracks(pl, at, ts).then(() =>
        toast({ kind: "success", text: `Added ${what(ts)} to “${pl.name}”.` }),
      );
    })
    .catch((e) => {
      console.error("[drop] playlist", e);
      toast({ kind: "warn", text: "Couldn't add to the playlist." });
    });
}

/** The user's own Apple playlist: at the end, through the menu's question (§10.9). */
export function dropToApplePlaylist(pl: Playlist, p: DragPayload): void {
  addToApple(pl, () => resolve(p));
}

/** The Library card: Add to Library, the menu's behavior. */
export function dropToLibrary(p: DragPayload): void {
  resolve(p)
    .then((ts) => addDroppedToLibrary(ts, p.albumId))
    .then((added) => {
      if (!added) toast({ kind: "info", text: "Those songs are already in your library." });
    })
    .catch((e) => console.error("[drop] library", e)); // addToLibrary raises its own warn
}
