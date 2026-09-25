// The Diary's data (docs/features/DIARY.md). Thin wrappers over diary.rs, plus the number
// and date rules the card and its toast share. All local: nothing here calls Apple.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "./toast";
import { catalogRelated } from "./search";
import type { Track } from "./library";
import type { Album } from "./search";

export interface DiarySong {
  songKey: string;
  score?: number;
  note: string;
  noteDate?: string;
  updatedAt: number;
}

export interface DiaryEntry {
  id: number;
  album: Album;
  tracks: Track[];
  scaleMax: number;
  score?: number;
  note: string;
  reviewDate?: string;
  createdAt: number;
  updatedAt: number;
  songs: DiarySong[];
  /** Only on the `diaryOpen` that made the entry (the first-time grow, DIARY.md §4a). */
  created?: boolean;
  /** When it was marked done (ms); absent = in progress (DIARY.md §9). */
  doneAt?: number;
  /** The user folder it is filed in; absent = none. */
  folderId?: number;
}

export interface DiaryFolder {
  id: number;
  name: string;
  createdAt: number;
}

export interface DiarySummary {
  id: number;
  album: Album;
  scaleMax: number;
  score?: number;
  reviewDate?: string;
  updatedAt: number;
  songCount: number;
  songsDone: number;
  doneAt?: number;
  folderId?: number;
}

type Listener = () => void;
const subs = new Set<Listener>();
/** Any write: the shelf and an open entry redraw. */
export function onDiaryChange(cb: Listener): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}
const changed = <T>(v: T): T => {
  cached = null;
  subs.forEach((cb) => cb());
  return v;
};

// An agent's write (DIARY.md §10) happens in Rust; it says so with `diary-changed`.
const outside = new Set<Listener>();
/** A write from outside the window (an agent, the CLI): an open entry reads itself again. */
export function onDiaryOutside(cb: Listener): () => void {
  outside.add(cb);
  return () => outside.delete(cb);
}
void listen("diary-changed", () => {
  changed(undefined);
  outside.forEach((cb) => cb());
}).catch((e) => console.warn("[diary] listen", e));

export const diaryList = (): Promise<DiarySummary[]> =>
  invoke<DiarySummary[]>("diary_list").then((l) => {
    cached = l;
    return l;
  });

// The last list read, for the Compass (it builds rows synchronously). Dropped on any write;
// `diaryCachedList` reads again when it is gone.
let cached: DiarySummary[] | null = null;
export function diaryCachedList(): DiarySummary[] {
  if (!cached) void diaryList().catch(() => {});
  return cached ?? [];
}

/** The export text (diary.rs `export_text`, DIARY.md §10): one format for the menu, the Compass,
 *  the CLI and the agent. */
export const diaryExport = (id: number): Promise<string> => invoke<string>("diary_export", { id });

/** A library album has no album catalog id — only its songs do. One song → album hop
 *  (memoized in search.ts) finds it, so the export can end with the album's link. Unchanged
 *  when no song has a catalog id or the hop fails. */
export async function withAlbumId(album: Album, tracks: Track[]): Promise<Album> {
  if (album.catalogId) return album;
  const seed = tracks.find((t) => t.catalogId)?.catalogId;
  if (!seed) return album;
  try {
    const ref = await catalogRelated("songs", seed, "albums");
    return ref?.id ? { ...album, catalogId: ref.id } : album;
  } catch {
    return album;
  }
}

/** Export: the entry's text onto the clipboard (his ask, 2026-09-24), with a toast either way.
 *  An entry made before its album knew its catalog id learns it here, once. */
export function copyDiaryExport(id: number): Promise<void> {
  return diaryGet(id)
    .then(async (e) => {
      if (e.album.catalogId) return;
      const a = await withAlbumId(e.album, e.tracks);
      if (a.catalogId) await invoke("diary_open", { album: a, tracks: e.tracks, today: null });
    })
    .catch(() => {})
    .then(() => diaryExport(id))
    .then((text) => navigator.clipboard.writeText(text))
    .then(
      () => void toast({ kind: "success", text: "Diary entry copied." }),
      (e) => {
        console.error("[diary] export", e);
        toast({ kind: "warn", text: "Couldn't copy the Diary entry." });
      },
    );
}
export const diaryGet = (id: number): Promise<DiaryEntry> => invoke<DiaryEntry>("diary_get", { id });

/** Open (or make) the album's entry. A new entry's review date starts today (fork 8B). */
export const diaryOpen = (album: Album, tracks: Track[]): Promise<DiaryEntry> =>
  invoke<DiaryEntry>("diary_open", { album, tracks, today: today() }).then(changed);

/** The album's own fields. A key present with `null` clears it. */
export interface EntryPatch {
  score?: number | null;
  note?: string;
  reviewDate?: string | null;
  scaleMax?: number;
}
export const diaryUpdate = (id: number, patch: EntryPatch): Promise<void> =>
  invoke<void>("diary_update", { id, patch }).then(changed);

export interface SongPatch {
  score?: number | null;
  note?: string;
  noteDate?: string | null;
}
export const diarySongSet = (entryId: number, songKey: string, patch: SongPatch): Promise<void> =>
  invoke<void>("diary_song_set", { entryId, songKey, patch }).then(changed);

export const diaryRescale = (id: number, fromMax: number, toMax: number): Promise<void> =>
  invoke<void>("diary_rescale", { id, fromMax, toMax }).then(changed);

export const diaryDelete = (id: number): Promise<void> => invoke<void>("diary_delete", { id }).then(changed);

// ── Done and folders (DIARY.md §9) ──

/** Mark an entry done or in progress again. Resolves to the new `doneAt` (null = in progress).
 *  The one place a finish happens, so what later hangs off it has one hook: `onDiaryDone`. */
export async function diarySetDone(id: number, done: boolean): Promise<number | null> {
  const at = await invoke<number | null>("diary_set_done", { id, done });
  changed(undefined);
  doneSubs.forEach((cb) => cb(id, done));
  return at;
}
const doneSubs = new Set<(id: number, done: boolean) => void>();
/** Be told when an entry is marked done or in progress (the triggers still to come, §9). */
export function onDiaryDone(cb: (id: number, done: boolean) => void): () => void {
  doneSubs.add(cb);
  return () => doneSubs.delete(cb);
}

export const diaryFolders = (): Promise<DiaryFolder[]> => invoke<DiaryFolder[]>("diary_folders");
export const diaryFolderCreate = (name: string): Promise<number> => invoke<number>("diary_folder_create", { name }).then(changed);
export const diaryFolderRename = (id: number, name: string): Promise<void> => invoke<void>("diary_folder_rename", { id, name }).then(changed);
export const diaryFolderDelete = (id: number): Promise<void> => invoke<void>("diary_folder_delete", { id }).then(changed);
/** File an entry in a folder, or take it out (`null`). One folder per entry. */
export const diaryFile = (id: number, folder: number | null): Promise<void> => invoke<void>("diary_file", { id, folder }).then(changed);

/** A song's key inside its entry: the catalog id, else the library id, else its place. */
export const songKeyOf = (t: Track): string =>
  t.catalogId ?? t.libraryId ?? `pos:${t.discNumber ?? 1}-${t.trackNumber ?? 0}`;

// ── numbers (his call 7B: a score is the number the user typed) ──

/** Read what the user typed: any finite number 0 or more ("7", "2.6767", ".5", "7,5").
 *  "" = cleared. NaN = not a number. */
export function parseScore(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  if (!s) return null;
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return NaN;
  return Number(s);
}

/** A score or a scale top, as text: up to four places, no trailing zeros (7, 7.5, 2.6767, 3.3333). */
export const fmtNum = (x: number): string => String(Number(x.toFixed(4)));

/** "7.5/10"; "" with no score. */
export const fmtScore = (score: number | undefined, max: number): string =>
  score == null ? "" : `${fmtNum(score)}/${fmtNum(max)}`;

// ── dates (the user's local day, as text) ──

const pad = (n: number) => String(n).padStart(2, "0");
/** Today on the user's calendar, `YYYY-MM-DD`. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** "Sep 24, 2026" for a `YYYY-MM-DD` day, in the user's locale. */
export function fmtDay(day: string | undefined): string {
  const [y, m, d] = (day ?? "").split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
