// Agent writes (AGENT.md §5) — the main window's half of the bridge's write routes:
// /library, /playlist, /folder, /queue/edit, /update. Each runs the functions the UI's own
// menus run, so the cards refresh through their change buses and the toasts match.
//
// Rules (decided 2026-09-14):
//  - An Apple-account write follows the app's own consent. The setting is off → refused
//    (`blocked:` → 403). The one-time notice was already seen → it runs. Never tried → a
//    sticky question in the window and an immediate `pending` reply that points the user to
//    it; Allow silences the notice and runs the write.
//  - A playlist delete always asks in the window first.
//  - Every other playlist, folder, library, or update-policy write shows a quiet info toast
//    (it shows only under Show notices › Everything). Queue edits show none: the Queue card
//    already shows them, as it does for play and queue.

import type { Track } from "./library";
import type { Playlist } from "./search";
import { toast, noticeOff, onToast } from "./toast";
import { setting, setSetting } from "./settings-store";
import * as queue from "./queue";
import { resolveEntry } from "./queue-rows";
import { jumpToUpcoming, reconcileUpcoming, removeFromQueue } from "./player";
import { materializeTrack } from "./search";
import {
  playlistsCached, playlistCreate, playlistAddTracks, playlistRemoveTrack, playlistReorder, playlistRename,
  playlistDelete, playlistSetCover, playlistImport, playlistTracks, applePlaylistAdd, applePlaylistsSync,
  addToApple, foldersList, folderCreate, folderRename, folderDelete, folderAssign, isReplay, songs,
  notifyPlaylistsChanged, APPLE_ADD_KEY,
} from "./playlists";
import { makeNew, sendNew, getNew, EXPORT_NOTICE_KEY } from "./playlist-export";
import { libraryAddEnabled, addToLibrary, alreadyInLibrary, ADD_NOTICE_KEY } from "./library-add";
import { setLoved } from "./favorites";
import { checkForUpdate, download, offerRestart, olderVersions, rollbackTo, updateStatus, type UpdateStatus } from "./updater";
import { invoke } from "@tauri-apps/api/core";
import { settingsList, settingsWrite } from "./agent-settings";
import { agentGrow } from "./card-grow";

type Reply = Record<string, unknown>;

const done = (message: string, extra: Reply = {}): Reply => ({ ok: true, message, ...extra });
/** The reply when the user must answer in the window first (AGENT.md §5: reply at once). */
const waiting = (message: string): Reply => ({ ok: true, pending: "user", message });
const blocked = (why: string) => new Error(`blocked: ${why}`);
const unknown = (why: string) => new Error(`unknown: ${why}`);
const said = (text: string) => toast({ kind: "info", text });

const ASK_AGAIN = "DeetsMusic asked the user to allow this. Tell them to answer the question in DeetsMusic, then try again.";

/** Ask in the window before a first-time Apple write. Allow silences `key` and runs `run`. */
function askFirst(key: string, text: string, run: () => Promise<unknown>): Reply {
  toast({
    kind: "info",
    sticky: true,
    text,
    actions: [
      {
        label: "Allow",
        run: () => {
          try {
            localStorage.setItem(key, "off");
          } catch {
            /* storage unavailable — it asks again next time */
          }
          void run().catch((e) => console.error("[agent] allowed write", e));
        },
      },
      { label: "Not now" },
    ],
  });
  return waiting(ASK_AGAIN);
}

/** The playing song, or the tracks the bridge resolved. */
function tracksOf(payload: any): Track[] {
  if (payload?.current) {
    const cur = queue.getCurrent();
    const t = cur ? resolveEntry(cur) : undefined;
    if (!t) throw unknown("nothing is playing");
    return [t];
  }
  const ts = (payload?.tracks ?? []) as Track[];
  if (!ts.length) throw unknown("no songs to add");
  ts.forEach(materializeTrack);
  return ts;
}

const quoted = (ts: Track[]) => (ts.length === 1 ? `“${ts[0].title}”` : songs(ts.length));

// ── /library ─────────────────────────────────────────────────────────────────

async function library(payload: any): Promise<Reply> {
  if (!libraryAddEnabled()) throw blocked("Add to Library is off in DeetsMusic › Settings › Apple Music.");
  const action = String(payload?.action ?? "");
  const tracks = tracksOf(payload);
  const albumId: string | undefined = payload?.albumId;

  if (action === "add") {
    const fresh = albumId ? tracks : tracks.filter((t) => t.catalogId && !alreadyInLibrary(t));
    if (!fresh.length) return done("Already in the library (or not in the Apple Music catalog).");
    const what = albumId ? "the album" : quoted(fresh);
    const run = () =>
      albumId
        ? addToLibrary("albums", [albumId], fresh)
        : addToLibrary("songs", fresh.map((t) => t.catalogId!), fresh);
    if (!noticeOff(ADD_NOTICE_KEY))
      return askFirst(ADD_NOTICE_KEY, `An agent wants to add ${what} to your library. DeetsMusic can't remove it; use the Music app.`, run);
    await run();
    return done(`Added ${what} to the library.`);
  }

  if (action === "favorite" || action === "unfavorite") {
    if (albumId || tracks.length !== 1) throw unknown("favorite takes one song: song:… or current");
    const t = tracks[0];
    if (!t.catalogId) throw unknown(`“${t.title}” is not in the Apple Music catalog`);
    const on = action === "favorite";
    const run = async () => {
      await setLoved(t, on);
      said(on ? `An agent added “${t.title}” to Favorites.` : `An agent removed “${t.title}” from Favorites.`);
    };
    // The ♥ rides Add to Library's consent (favorites.ts).
    if (!noticeOff(ADD_NOTICE_KEY))
      return askFirst(ADD_NOTICE_KEY, `An agent wants to ${on ? "add" : "remove"} “${t.title}” ${on ? "to" : "from"} Favorites on Apple Music.`, run);
    await run();
    return done(on ? `Favorited “${t.title}”.` : `Unfavorited “${t.title}”.`);
  }
  throw unknown(`library action ${JSON.stringify(action)}: use add, favorite, or unfavorite`);
}

// ── /playlist ────────────────────────────────────────────────────────────────

const localNum = (p: Playlist): number | null => {
  const m = /^local:(\d+)$/.exec(p.libraryId ?? "");
  return m ? Number(m[1]) : null;
};

async function findPlaylist(id: unknown): Promise<{ p: Playlist; all: Playlist[] }> {
  const key = String(id ?? "").trim().replace(/^playlist:/, "");
  if (!key) throw unknown("give playlist: a playlist:… id (list playlists first)");
  const all = await playlistsCached();
  const p = all.find((x) => x.libraryId === key || x.catalogId === key);
  if (!p) throw unknown(`no playlist ${JSON.stringify(id)} among your playlists — list playlists first`);
  return { p, all };
}

function mustBeLocal(p: Playlist, all: Playlist[], what: string): number {
  const n = localNum(p);
  if (n != null) return n;
  const local = all.find((x) => x.exportedAppleId && x.exportedAppleId === p.libraryId);
  if (local) throw unknown(`“${p.name}” is the Apple Music copy of playlist:${local.libraryId}; ${what} that one`);
  throw unknown(`“${p.name}” is an Apple Music playlist; DeetsMusic can only ${what} its own playlists (import it first)`);
}

function handMade(p: Playlist): void {
  if (isReplay(p)) throw unknown(`“${p.name}” is a Replay, made from listening; it can't be edited by hand`);
}

/** A 1-based row number from the listing → the stored position. */
function row(v: unknown, count: number, name: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > count) throw unknown(`row ${JSON.stringify(v)} is not in “${name}” (1–${count})`);
  return n - 1;
}

/** Square-crop and shrink a data URL to the stored cover size, like the file picker does. */
function squareCover(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const SIDE = 512;
      const c = document.createElement("canvas");
      c.width = SIDE;
      c.height = SIDE;
      const ctx = c.getContext("2d");
      if (!ctx) return reject(new Error("no canvas"));
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, SIDE, SIDE);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(unknown("that file is not an image DeetsMusic can read"));
    img.src = dataUrl;
  });
}

/** Run an export-style flow and return the toasts it raised: those ARE its result. */
async function captured(run: () => Promise<void>): Promise<string> {
  const texts: string[] = [];
  const off = onToast((t) => void texts.push(t.text));
  try {
    await run();
  } finally {
    off();
  }
  return texts.join(" ") || "Done.";
}

async function playlist(payload: any): Promise<Reply> {
  const action = String(payload?.action ?? "");

  if (action === "create") {
    const name = String(payload?.value ?? "").trim();
    if (!name) throw unknown("give value: the new playlist's name");
    const id = await playlistCreate(name);
    said(`An agent made the playlist “${name}”.`);
    return done(`Created playlist:local:${id}  ${name}`, { playlist: `playlist:local:${id}` });
  }

  const { p, all } = await findPlaylist(payload?.playlist);

  switch (action) {
    case "add": {
      const tracks = tracksOf(payload);
      const n = localNum(p);
      if (n != null) {
        handMade(p);
        await playlistAddTracks(n, tracks);
        said(`An agent added ${quoted(tracks)} to “${p.name}”.`);
        return done(`Added ${quoted(tracks)} to “${p.name}”.`);
      }
      if (p.source !== "apple" || !p.canEdit) throw unknown(`“${p.name}” is not your playlist; DeetsMusic can't add to it`);
      mustBeLocalIfLinked(p, all);
      if (!setting("playlistExport")) throw blocked("Adding to Apple Music playlists is off in DeetsMusic › Settings › Apple Music.");
      if (!noticeOff(APPLE_ADD_KEY))
        return askFirst(APPLE_ADD_KEY, `An agent wants to add ${quoted(tracks)} to “${p.name}” on Apple Music. DeetsMusic can't remove songs from it afterwards.`, async () => addToApple(p, () => tracks));
      const r = await applePlaylistAdd(p, tracks);
      said(`An agent added ${songs(r.added)} to “${p.name}” on Apple Music.`);
      const failed = r.failed ? ` Couldn't add ${songs(r.failed)}.` : "";
      const skipped = r.skippedTitles.length ? ` ${songs(r.skippedTitles.length)} aren't in the Apple Music catalog.` : "";
      return done(`Added ${songs(r.added)} to “${p.name}” on Apple Music.${failed}${skipped}`);
    }
    case "remove": {
      mustBeLocal(p, all, "edit");
      handMade(p);
      const tracks = await playlistTracks(p);
      const at = row(payload?.index, tracks.length, p.name);
      await playlistRemoveTrack(p, at);
      said(`An agent removed “${tracks[at].title}” from “${p.name}”.`);
      return done(`Removed “${tracks[at].title}” from “${p.name}”.`);
    }
    case "move": {
      mustBeLocal(p, all, "edit");
      handMade(p);
      const tracks = await playlistTracks(p);
      const from = row(payload?.index, tracks.length, p.name);
      const to = row(payload?.to, tracks.length, p.name);
      await playlistReorder(p, from, to);
      said(`An agent moved “${tracks[from].title}” in “${p.name}”.`);
      return done(`Moved “${tracks[from].title}” to row ${to + 1} of “${p.name}”.`);
    }
    case "rename": {
      mustBeLocal(p, all, "rename");
      handMade(p);
      const name = String(payload?.value ?? "").trim();
      if (!name) throw unknown("give value: the new name");
      await playlistRename(p, name);
      said(`An agent renamed “${p.name}” to “${name}”.`);
      return done(`Renamed “${p.name}” to “${name}”.`);
    }
    case "delete": {
      mustBeLocal(p, all, "delete");
      const count = p.trackCount ?? (await playlistTracks(p)).length;
      const onApple = !!p.exportedAppleId && all.some((m) => m.source === "apple" && m.libraryId === p.exportedAppleId);
      toast({
        kind: "error",
        sticky: true,
        text:
          `An agent wants to delete “${p.name}” and its ${songs(count)}. This can't be undone.` +
          (onApple ? " Its copy on Apple Music stays and will show in your list." : ""),
        actions: [
          {
            label: "Delete",
            run: () =>
              void playlistDelete(p).catch((e) => {
                console.error("[agent] delete", e);
                toast({ kind: "warn", text: `Couldn't delete “${p.name}”.` });
              }),
          },
          { label: "Cancel" },
        ],
      });
      return waiting("DeetsMusic asked the user to confirm the delete. Tell them to answer the question in DeetsMusic. Nothing is deleted until they press Delete.");
    }
    case "cover": {
      mustBeLocal(p, all, "change the cover of");
      const image = payload?.image as string | null | undefined;
      if (image == null) {
        await playlistSetCover(p, null);
        said(`An agent removed the cover of “${p.name}”.`);
        return done(`Removed the cover of “${p.name}”.`);
      }
      await playlistSetCover(p, await squareCover(image));
      said(`An agent changed the cover of “${p.name}”.`);
      return done(`Changed the cover of “${p.name}”.`);
    }
    case "export":
    case "new_copy": {
      mustBeLocal(p, all, "export");
      if (!setting("playlistExport")) throw blocked("Export playlists is off in DeetsMusic › Settings › Apple Music.");
      const after = () => void applePlaylistsSync(false).then(notifyPlaylistsChanged).catch((e) => console.warn("[agent] mirror sync", e));
      const copy = p.exportedAppleId ? all.find((m) => m.source === "apple" && m.libraryId === p.exportedAppleId) : undefined;
      const run = () => (action === "export" && copy ? sendNew(p, after) : makeNew(p, !!p.exportedAppleId, after));
      if (!noticeOff(EXPORT_NOTICE_KEY))
        return askFirst(EXPORT_NOTICE_KEY, `An agent wants to copy “${p.name}” to Apple Music. DeetsMusic can't rename, reorder, or delete it there; use the Music app.`, run);
      return done(await captured(run));
    }
    case "get_songs": {
      mustBeLocal(p, all, "update");
      if (!setting("playlistExport")) throw blocked("Export playlists is off in DeetsMusic › Settings › Apple Music.");
      if (!p.exportedAppleId) throw unknown(`“${p.name}” has no copy on Apple Music`);
      return done(await captured(() => getNew(p, () => {})));
    }
    case "import": {
      if (p.source !== "apple") throw unknown(`“${p.name}” is already a DeetsMusic playlist`);
      const r = await playlistImport(p);
      said(`An agent copied “${p.name}” into a playlist you can edit.`);
      return done(`Copied “${p.name}” to playlist:local:${r.id}.`, { playlist: `playlist:local:${r.id}` });
    }
    case "folder": {
      const name = String(payload?.value ?? "").trim();
      if (!name) throw unknown("give value: a folder name, or none");
      if (name.toLowerCase() === "none") {
        await folderAssign(p, null);
        said(`An agent took “${p.name}” out of its folder.`);
        return done(`“${p.name}” is not in a folder now.`);
      }
      const f = (await foldersList()).find((x) => x.name.toLowerCase() === name.toLowerCase());
      const fid = f?.id ?? (await folderCreate(name));
      await folderAssign(p, fid);
      said(`An agent put “${p.name}” in the folder “${f?.name ?? name}”.`);
      return done(`Put “${p.name}” in the folder “${f?.name ?? name}”${f ? "" : " (new folder)"}.`);
    }
    default:
      throw unknown(`playlist action ${JSON.stringify(action)}`);
  }
}

/** A linked Apple copy is hidden from Add to Playlist (§6 "one row"): add to its local playlist. */
function mustBeLocalIfLinked(p: Playlist, all: Playlist[]): void {
  const local = all.find((x) => x.exportedAppleId && x.exportedAppleId === p.libraryId);
  if (local) throw unknown(`“${p.name}” is the Apple Music copy of playlist:${local.libraryId}; add to that one`);
}

// ── /folder ──────────────────────────────────────────────────────────────────

async function folder(payload: any): Promise<Reply> {
  const action = String(payload?.action ?? "");
  const folders = await foldersList();
  if (action === "list") {
    const lists = await playlistsCached();
    return {
      folders: folders.map((f) => ({
        name: f.name,
        playlists: lists.filter((p) => p.folderId === f.id),
      })),
    };
  }
  const name = String(payload?.name ?? "").trim();
  if (!name) throw unknown("give name: the folder's name");
  if (action === "create") {
    if (folders.some((f) => f.name.toLowerCase() === name.toLowerCase())) return done(`The folder “${name}” already exists.`);
    await folderCreate(name);
    said(`An agent made the folder “${name}”.`);
    return done(`Created the folder “${name}”.`);
  }
  const f = folders.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!f) throw unknown(`no folder named ${JSON.stringify(name)} — list folders first`);
  if (action === "rename") {
    const to = String(payload?.value ?? "").trim();
    if (!to) throw unknown("give new_name");
    await folderRename(f.id, to);
    said(`An agent renamed the folder “${f.name}” to “${to}”.`);
    return done(`Renamed the folder “${f.name}” to “${to}”.`);
  }
  if (action === "delete") {
    await folderDelete(f.id);
    said(`An agent deleted the folder “${f.name}”. Its playlists are not in a folder now.`);
    return done(`Deleted the folder “${f.name}”. Its playlists stay.`);
  }
  throw unknown(`folder action ${JSON.stringify(action)}: use list, create, rename, or delete`);
}

// ── /queue/edit ──────────────────────────────────────────────────────────────

async function queueEdit(payload: any): Promise<void> {
  const action = String(payload?.action ?? "");
  const up = queue.getUpcoming();
  if (!up.length) throw unknown("Up Next is empty");
  const i = rowOfQueue(payload?.index, up.length);
  switch (action) {
    case "remove":
      return removeFromQueue(i);
    case "move": {
      const to = rowOfQueue(payload?.to, up.length);
      queue.move(i, to); // model first → the Queue card re-renders; then MusicKit, as a drag does
      return reconcileUpcoming();
    }
    case "jump":
      return jumpToUpcoming(i);
    default:
      throw unknown(`queue edit ${JSON.stringify(action)}: use remove, move, or jump`);
  }
}

function rowOfQueue(v: unknown, count: number): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > count) throw unknown(`Up Next has no row ${JSON.stringify(v)} (1–${count}) — list the queue first`);
  return n - 1;
}

// ── /update ──────────────────────────────────────────────────────────────────

const RESTART_NOTE =
  " The restart installs it and stops this agent's DeetsMusic tools; the agent app must restart them afterwards.";

async function updateGet(): Promise<Reply> {
  const s = updateStatus() ?? (await invoke<UpdateStatus>("update_status"));
  return { ...s, mode: setting("updateMode"), skip: setting("updateSkip") };
}

async function update(payload: any): Promise<Reply> {
  const action = String(payload?.action ?? "");
  const value = String(payload?.value ?? "").trim();
  switch (action) {
    case "status":
      return updateGet();
    case "check": {
      const s = await checkForUpdate(true);
      if (!s) throw new Error("couldn't reach the update server");
      return updateGet();
    }
    case "install": {
      let s = updateStatus();
      if (!s?.version || s.rollback || s.state === "error" || s.state === "idle") s = await checkForUpdate(true);
      if (!s) throw new Error("couldn't reach the update server");
      if (!s.version) return done(`DeetsMusic ${s.current} is up to date.`);
      if (s.state === "ready") offerRestart(s);
      else if (s.state !== "downloading") void download();
      return waiting(
        `DeetsMusic ${s.version} ${s.state === "ready" ? "is ready" : "is downloading"}. DeetsMusic asks the user to restart when it is ready; tell them to answer that question in DeetsMusic.${RESTART_NOTE}`,
      );
    }
    case "rollback": {
      const versions = await olderVersions();
      if (!value) return { versions };
      if (!versions.some((v) => v.version === value))
        throw unknown(`${JSON.stringify(value)} is not a version you can roll back to (${versions.map((v) => v.version).join(", ") || "none"})`);
      void rollbackTo(value);
      return waiting(`DeetsMusic is getting ${value}. When it is ready, DeetsMusic asks the user to restart; tell them to answer that question in DeetsMusic.${RESTART_NOTE}`);
    }
    case "mode": {
      const labels: Record<string, string> = { auto: "Automatic", ask: "Ask", off: "Off" };
      if (!labels[value]) throw unknown("mode takes auto, ask, or off");
      setSetting("updateMode", value as "auto" | "ask" | "off");
      said(`An agent set Get updates to ${labels[value]}.`);
      return done(`Get updates is ${labels[value]}.`);
    }
    case "skip": {
      if (!value) throw unknown("skip takes a version, or none");
      const v = value.toLowerCase() === "none" ? "" : value;
      setSetting("updateSkip", v);
      said(v ? `An agent skipped DeetsMusic ${v}.` : "An agent cleared the skipped update.");
      return done(v ? `Skipping ${v}.` : "No version is skipped.");
    }
    default:
      throw unknown(`update action ${JSON.stringify(action)}`);
  }
}

/** np-bus.ts routes the write kinds here. Null = not a write kind. */
export function runAgentWrite(kind: string, payload: any): Promise<unknown> | null {
  switch (kind) {
    case "library": return library(payload);
    case "playlist": return playlist(payload);
    case "folder": return folder(payload);
    case "queue-edit": return queueEdit(payload).then(() => null);
    case "update-get": return updateGet();
    case "update": return update(payload);
    case "settings-get": return settingsList(payload); // AGENT.md §6 (agent-settings.ts)
    case "settings": return settingsWrite(payload);
    case "grow-get": return agentGrow({ action: "state" }); // CARD-GROW.md; a test handle
    case "grow": return agentGrow(payload);
    default: return null;
  }
}
