// The web demo's Diary (WEB-DEMO.md §12; the real one is src-tauri/src/diary.rs). The same
// commands, answered from this browser's localStorage, with the same rules: an album's entry
// is found by its key (catalog id, library id, then name), a note or a score marks a song
// written, a scale change alone keeps the scores, and the export text matches `export_text`.
//
// A visitor starts with sample entries (his call, 2026-09-26), so the Diary shows what it is
// for before they write a word. Honey Static — the song that plays when the demo opens — has
// no entry, so the playing-album box offers to start one.

import type { Track } from "../src/library";
import type { Album } from "../src/search";
import * as cat from "./catalog";

interface Song {
  songKey: string;
  score?: number;
  note: string;
  noteDate?: string;
  updatedAt: number;
}
interface Entry {
  id: number;
  key: string;
  album: Album;
  tracks: Track[];
  scaleMax: number;
  score?: number;
  note: string;
  reviewDate?: string;
  createdAt: number;
  updatedAt: number;
  songs: Song[];
  doneAt?: number;
  folderId?: number;
}
interface Folder {
  id: number;
  name: string;
  createdAt: number;
}
interface DiaryStore {
  v: 1;
  entries: Entry[];
  folders: Folder[];
  nextId: number;
  nextFolderId: number;
}

const KEY = "deets.demo.diary";

const albumKey = (a: Album): string =>
  a.catalogId ? `c:${a.catalogId}` : a.libraryId ? `l:${a.libraryId}` : `n:${a.title.toLowerCase()}|${a.artistName.toLowerCase()}`;
const songKeyOf = (t: Track): string => t.catalogId ?? t.libraryId ?? `pos:${t.discNumber ?? 1}-${t.trackNumber ?? 0}`;
/** A local day, `YYYY-MM-DD`, `daysAgo` before today. */
const dayOf = (daysAgo: number): string => {
  const d = new Date(Date.now() - daysAgo * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ── The sample entries ──
type SampleSong = [n: number, score: number | null, note: string];
interface Sample {
  album: string;
  scaleMax: number;
  score?: number;
  note: string;
  daysAgo: number;
  done: boolean;
  folder?: string;
  songs: SampleSong[];
}
const SAMPLES: Sample[] = [
  {
    album: "Neon Parable",
    scaleMax: 10,
    score: 8.5,
    note: "A late-night drive of a record. The synths are loud, and the songs still have room to breathe. It ends on a question, and I want to press play again.",
    daysAgo: 9,
    done: true,
    folder: "Night drives",
    songs: [
      [1, 8, "A slow start. The drums come in at 1:10, and then it moves."],
      [2, 9, "The best hook on the album."],
      [3, 7.5, ""],
      [4, 8, "It sounds like rain on a car roof."],
      [5, 7, ""],
      [6, 9.5, "My favorite. I played it three times in a row."],
      [7, 8, ""],
      [8, 9, "The perfect last song. A real question, not a fade-out."],
    ],
  },
  {
    album: "After Hours Atlas",
    scaleMax: 5,
    note: "The first half so far. Soft and low. Good music for the end of the day.",
    daysAgo: 2,
    done: false,
    songs: [
      [1, 4, "Short, and it sets the mood."],
      [2, 4.5, "The guitar in the second verse!"],
      [3, 3.5, ""],
    ],
  },
];

function seed(): DiaryStore {
  const s: DiaryStore = { v: 1, entries: [], folders: [], nextId: 1, nextFolderId: 1 };
  const now = Date.now();
  for (const x of SAMPLES) {
    const album = cat.albumByTitle(x.album);
    if (!album) continue;
    const tracks = cat.albumTracks.get(album.catalogId!) ?? [];
    let folderId: number | undefined;
    if (x.folder) {
      folderId = s.folders.find((f) => f.name === x.folder)?.id;
      if (folderId == null) {
        folderId = s.nextFolderId++;
        s.folders.push({ id: folderId, name: x.folder, createdAt: now - x.daysAgo * 864e5 });
      }
    }
    const at = now - x.daysAgo * 864e5;
    s.entries.push({
      id: s.nextId++,
      key: albumKey(album),
      album,
      tracks,
      scaleMax: x.scaleMax,
      score: x.score,
      note: x.note,
      reviewDate: dayOf(x.daysAgo),
      createdAt: at,
      updatedAt: at,
      doneAt: x.done ? at : undefined,
      folderId,
      songs: x.songs.flatMap(([n, score, note]): Song[] => {
        const t = tracks[n - 1];
        return t ? [{ songKey: songKeyOf(t), score: score ?? undefined, note, noteDate: dayOf(x.daysAgo), updatedAt: at }] : [];
      }),
    });
  }
  return s;
}

function load(): DiaryStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as DiaryStore;
      if (s && s.v === 1) return s;
    }
  } catch {
    /* a private window or a bad blob: start from the samples */
  }
  return seed();
}

const store = load();
let saveTimer = 0;
function save(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(store));
    } catch {
      /* storage full or blocked: the session still works */
    }
  }, 300);
}

const byId = (id: number): Entry => {
  const e = store.entries.find((x) => x.id === Number(id));
  if (!e) throw new Error(`diary: no entry ${id}`);
  return e;
};
const written = (s: Song) => s.score != null || s.note.trim() !== "";
const touch = (e: Entry) => {
  e.updatedAt = Date.now();
  save();
};
const scoreOf = (v: unknown): number | undefined => {
  if (v === null) return undefined;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  throw new Error("diary: a score is a number, 0 or more");
};
const dayArg = (v: unknown): string | undefined => {
  if (v === null) return undefined;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  throw new Error("diary: a date is YYYY-MM-DD");
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const full = (e: Entry, created = false) => {
  const { key: _key, ...rest } = e;
  return clone({ ...rest, created });
};

// ── The export text (diary.rs `export_text`) ──
const fmtNum = (x: number): string => {
  const s = x.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return s === "" || s === "-" ? "0" : s;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = (day: string | undefined): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? "");
  if (!m || +m[2] < 1 || +m[2] > 12) return "";
  return `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
};
function exportText(e: Entry): string {
  const scored = (s: number | undefined) => (s != null ? ` | ${fmtNum(s)}/${fmtNum(e.scaleMax)}` : "");
  const blocks: string[] = [];
  const album = [`## ${e.album.title}${e.album.artistName ? ` by ${e.album.artistName}` : ""}${scored(e.score)}`];
  const d = fmtDay(e.reviewDate);
  if (d) album.push(d);
  if (e.note.trim()) album.push(e.note.trim());
  blocks.push(album.join("\n"));
  e.tracks.forEach((t, i) => {
    const s = e.songs.find((x) => x.songKey === songKeyOf(t));
    if (!s || !written(s)) return;
    const lines = [`## ${t.trackNumber ?? i + 1}. ${t.title}${scored(s.score)}`];
    const nd = s.noteDate && s.noteDate !== e.reviewDate ? fmtDay(s.noteDate) : "";
    if (nd) lines.push(nd);
    if (s.note.trim()) lines.push(s.note.trim());
    blocks.push(lines.join("\n"));
  });
  if (e.album.catalogId) blocks.push(`https://music.apple.com/album/${e.album.catalogId}`);
  return blocks.join("\n\n");
}

type Handler = (args: any) => unknown;

export const diaryHandlers: Record<string, Handler> = {
  diary_list: () =>
    store.entries
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((e) =>
        clone({
          id: e.id,
          album: e.album,
          scaleMax: e.scaleMax,
          score: e.score,
          reviewDate: e.reviewDate,
          updatedAt: e.updatedAt,
          songCount: e.tracks.length,
          songsDone: e.songs.filter(written).length,
          doneAt: e.doneAt,
          folderId: e.folderId,
        }),
      ),
  diary_get: ({ id }) => full(byId(id)),
  diary_open: ({ album, tracks, today }: { album: Album; tracks: Track[]; today: string | null }) => {
    const key = albumKey(album);
    // A library album that learned its catalog id: its older name or library key still finds it.
    const alt = album.catalogId
      ? [albumKey({ ...album, catalogId: undefined }), albumKey({ ...album, catalogId: undefined, libraryId: undefined })]
      : [];
    let e = store.entries.find((x) => x.key === key) ?? store.entries.find((x) => alt.includes(x.key));
    const created = !e;
    if (e) {
      e.key = key;
      if (tracks.length) {
        e.album = clone(album);
        e.tracks = clone(tracks);
      }
    } else {
      const now = Date.now();
      e = { id: store.nextId++, key, album: clone(album), tracks: clone(tracks), scaleMax: 10, note: "", reviewDate: today ?? undefined, createdAt: now, updatedAt: now, songs: [] };
      store.entries.push(e);
    }
    save();
    return full(e, created);
  },
  diary_update: ({ id, patch }) => {
    const e = byId(id);
    if ("score" in patch) e.score = scoreOf(patch.score);
    if ("note" in patch) e.note = String(patch.note ?? "");
    if ("reviewDate" in patch) e.reviewDate = dayArg(patch.reviewDate);
    if ("scaleMax" in patch) {
      const max = Number(patch.scaleMax);
      if (!(Number.isFinite(max) && max > 0)) throw new Error("diary: a scale's top is a number above 0");
      e.scaleMax = max;
    }
    touch(e);
    return null;
  },
  diary_song_set: ({ entryId, songKey, patch }) => {
    const e = byId(entryId);
    let s = e.songs.find((x) => x.songKey === songKey);
    if (!s) e.songs.push((s = { songKey, note: "", updatedAt: Date.now() }));
    if ("score" in patch) s.score = scoreOf(patch.score);
    if ("note" in patch) s.note = String(patch.note ?? "");
    if ("noteDate" in patch) s.noteDate = dayArg(patch.noteDate);
    s.updatedAt = Date.now();
    touch(e);
    return null;
  },
  diary_rescale: ({ id, fromMax, toMax }) => {
    if (!(fromMax > 0 && toMax > 0)) throw new Error("diary: a scale's top is a number above 0");
    const e = byId(id);
    const k = toMax / fromMax;
    e.scaleMax = toMax;
    if (e.score != null) e.score *= k;
    for (const s of e.songs) if (s.score != null) s.score *= k;
    touch(e);
    return null;
  },
  diary_delete: ({ id }) => {
    store.entries = store.entries.filter((x) => x.id !== Number(id));
    save();
    return null;
  },
  diary_set_done: ({ id, done }) => {
    const e = byId(id);
    e.doneAt = done ? Date.now() : undefined;
    touch(e);
    return e.doneAt ?? null;
  },
  diary_export: ({ id }) => exportText(byId(id)),
  diary_folders: () => clone(store.folders.slice().sort((a, b) => a.createdAt - b.createdAt || a.id - b.id)),
  diary_folder_create: ({ name }) => {
    const n = String(name ?? "").trim();
    if (!n) throw new Error("diary: a folder needs a name");
    const id = store.nextFolderId++;
    store.folders.push({ id, name: n, createdAt: Date.now() });
    save();
    return id;
  },
  diary_folder_rename: ({ id, name }) => {
    const f = store.folders.find((x) => x.id === Number(id));
    const n = String(name ?? "").trim();
    if (f && n) f.name = n;
    save();
    return null;
  },
  diary_folder_delete: ({ id }) => {
    for (const e of store.entries) if (e.folderId === Number(id)) e.folderId = undefined;
    store.folders = store.folders.filter((x) => x.id !== Number(id));
    save();
    return null;
  },
  diary_file: ({ id, folder }) => {
    const e = byId(id);
    e.folderId = folder == null ? undefined : Number(folder);
    save();
    return null;
  },
};
