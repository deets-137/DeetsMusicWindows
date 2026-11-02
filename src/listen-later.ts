// Listen Later (docs/features/LISTEN-LATER.md): the one way into the Later list, "Saved for the
// Right Day". The app makes the list on first use and finds it by its role, never by its name,
// so a rename keeps working and a deleted list comes back on the next save. A full play or a skip
// can take a song out again (Settings › Playlists › Remove from Later list automatically). All local
// SQLite — zero Apple calls.

import type { MenuItem } from "./context-menu";
import type { Track } from "./library";
import type { Playlist } from "./search";
import {
  playlistsCached, playlistCreate, playlistAddTracks, playlistTracks, playlistRemovePositions, playlistReorder, localId, isLater,
  names, songs,
} from "./playlists";
import { setting } from "./settings-store";
import { onPlayEnd } from "./stats";
import { toast, type ToastHandle } from "./toast";
import { countUse } from "./use-counts";
import * as diag from "./diag";

export const LATER_NAME = "Saved for the Right Day";

/** A song's two ids. A song matches another when either id is the same. */
type Ids = { catalogId?: string; libraryId?: string };
const same = (a: Ids, b: Ids): boolean =>
  (!!a.catalogId && a.catalogId === b.catalogId) || (!!a.libraryId && a.libraryId === b.libraryId);

/** The Later list, when it exists. */
export async function laterList(): Promise<Playlist | undefined> {
  return (await playlistsCached()).find(isLater);
}

async function laterListMade(): Promise<Playlist> {
  const found = await laterList();
  if (found) return found;
  const id = await playlistCreate(LATER_NAME, "later");
  diag.log("later:made", { id });
  const made = (await playlistsCached()).find((p) => localId(p) === id);
  if (!made) throw new Error("the Later list was not stored");
  return made;
}

// One write at a time: a second save (or a removal) waits for the first, so each reads the list
// as it is, and a double click never adds a song twice.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(run: () => Promise<T>): Promise<T> {
  const next = chain.then(run, run);
  chain = next.catch(() => {});
  return next;
}

export interface SaveResult {
  list: Playlist;
  /** The songs that went in, at the end of the list. */
  added: Track[];
  /** The songs the list already held. */
  skipped: number;
}

/** Where a save came from, for the use counts (USAGE-COUNTS.md §18). */
export type SaveFrom = "menu" | "compass" | "agent";

/** Add songs to the end of the Later list, made if missing. A song it holds already is skipped.
 *  A save that added something counts one use of `from`. */
export function saveForLater(tracks: Track[], from: SaveFrom): Promise<SaveResult> {
  return serial(async () => {
    const list = await laterListMade();
    const held: Ids[] = await playlistTracks(list);
    const added = tracks.filter((t) => {
      if (held.some((h) => same(h, t))) return false;
      held.push(t);
      return true;
    });
    if (added.length) {
      await playlistAddTracks(localId(list)!, added);
      countUse(`later.save.${from}`);
    }
    diag.log("later:save", { from, added: added.length, skipped: tracks.length - added.length });
    return { list, added, skipped: tracks.length - added.length };
  });
}

/** A song taken out of the Later list, and the row it held, so Undo can put it back there. */
interface Taken { track: Track; at: number }

/** Take songs out of the Later list by their ids, not their rows: a row moves when the list is
 *  edited. Resolves to the rows that went. */
function takeFromLater(songs: Ids[]): Promise<Taken[]> {
  return serial(async () => {
    const list = await laterList();
    if (!list || !songs.length) return [];
    const ts = await playlistTracks(list);
    const taken = ts.flatMap((track, at) => (songs.some((s) => same(track, s)) ? [{ track, at }] : []));
    if (taken.length) await playlistRemovePositions(list, taken.map((t) => t.at));
    return taken;
  });
}

/** Take songs out of the Later list. Resolves to how many rows went. */
export function removeFromLater(songs: Ids[]): Promise<number> {
  return takeFromLater(songs).then((t) => t.length);
}

/** Undo a removal: each song goes back to its old row (the end when the list is shorter now).
 *  A song the list holds again is left alone. Resolves to how many went back. */
function putBack(taken: Taken[]): Promise<number> {
  return serial(async () => {
    const list = await laterList();
    if (!list) return 0;
    const held: Ids[] = await playlistTracks(list);
    let n = 0;
    for (const { track, at } of [...taken].sort((a, b) => a.at - b.at)) {
      if (held.some((h) => same(h, track))) continue;
      await playlistAddTracks(localId(list)!, [track]);
      if (at < held.length) await playlistReorder(list, held.length, at);
      held.splice(Math.min(at, held.length), 0, track);
      n++;
    }
    return n;
  });
}

const what = (ts: Track[]) => (ts.length === 1 ? names([ts[0].title]) : songs(ts.length));

/** The "Listen Later" menu row (CONTEXT-MENUS.md §2, group 2). `getTracks` resolves on pick, so
 *  an album that must fetch its songs costs nothing until the row is chosen. */
export function listenLaterItem(getTracks: () => Track[] | Promise<Track[]>): MenuItem {
  return {
    label: "Listen Later",
    run: () => void listenLater(getTracks, "menu"),
  };
}

/** Save songs and say so: the menu row, the Compass verb. */
export async function listenLater(getTracks: () => Track[] | Promise<Track[]>, from: SaveFrom): Promise<void> {
  try {
    const ts = await getTracks();
    if (!ts.length) return;
    const r = await saveForLater(ts, from);
    if (!r.added.length) {
      toast({ kind: "info", text: `Already in “${r.list.name}”.` });
      return;
    }
    const added = r.added.map((t) => ({ catalogId: t.catalogId, libraryId: t.libraryId }));
    toast({
      kind: "success",
      text: `Added ${what(r.added)} to “${r.list.name}”.`,
      actions: [{
        label: "Undo",
        run: () =>
          void removeFromLater(added)
            .then((n) => {
              countUse("later.undo");
              diag.log("later:undo", { removed: n });
            })
            .catch((e) => diag.log("later:err", { kind: "undo", e: String(e) })),
      }],
    });
  } catch (e) {
    console.error("[later] save", e);
    toast({ kind: "warn", text: "Couldn't save for later." });
  }
}

// The skip notice (LISTEN-LATER.md §9): skips close together share one toast, and its Undo puts
// back every song it names. The set clears when the toast's time is up.
const SKIP_NOTE_MS = 5000;
let skipNote: { handle: ToastHandle; taken: Taken[]; timer: number } | null = null;

function noteSkip(list: Playlist, taken: Taken[]): void {
  const prev = skipNote;
  if (prev) {
    window.clearTimeout(prev.timer);
    prev.handle.dismiss();
  }
  const all = [...(prev?.taken ?? []), ...taken];
  const handle = toast({
    kind: "info",
    text: `Took ${what(all.map((t) => t.track))} off “${list.name}”.`,
    timeout: SKIP_NOTE_MS,
    actions: [{
      label: "Undo",
      run: () => {
        if (skipNote?.handle === handle) {
          window.clearTimeout(skipNote.timer);
          skipNote = null;
        }
        void putBack(all)
          .then((n) => {
            countUse("later.undo");
            diag.log("later:undo", { kind: "skip", restored: n });
          })
          .catch((e) => diag.log("later:err", { kind: "undo-skip", e: String(e) }));
      },
    }],
  });
  const note = { handle, taken: all, timer: 0 };
  note.timer = window.setTimeout(() => {
    if (skipNote === note) skipNote = null;
  }, SKIP_NOTE_MS);
  skipNote = note;
}

// When a play ends (Settings › Rewind › Count a play at sets the full mark), the setting may take
// the song out: after a full play, or a skip (another song started before the mark). It acts when
// the play ends, so a row never vanishes while its song plays. An app close or a restart of the
// same song is neither, so the song stays. A skip says so, with Undo; a full play does not.
onPlayEnd((song, how) => {
  const mode = setting("laterRemove");
  if (how === "stop" || mode === "off") return;
  void laterList()
    .then((list) => {
      if (!list) return;
      if (mode === "here" && song.context !== `playlist:${list.libraryId}`) return;
      return takeFromLater([song]).then((taken) => {
        if (!taken.length) return;
        const id = song.catalogId ?? song.libraryId ?? "";
        if (how === "full") {
          countUse("later.auto", taken.length);
          diag.log("later:played", { id, mode });
        } else {
          countUse("later.skip", taken.length);
          diag.log("later:skipped", { id, mode });
          noteSkip(list, taken);
        }
      });
    })
    .catch((e) => diag.log("later:err", { kind: how, e: String(e) }));
});
