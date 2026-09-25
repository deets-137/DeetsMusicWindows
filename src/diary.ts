// The Diary's data (docs/features/DIARY.md). Thin wrappers over diary.rs, plus the number
// and date rules the card and its toast share. All local: nothing here calls Apple.

import { invoke } from "@tauri-apps/api/core";
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
}

type Listener = () => void;
const subs = new Set<Listener>();
/** Any write: the shelf and an open entry redraw. */
export function onDiaryChange(cb: Listener): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}
const changed = <T>(v: T): T => {
  subs.forEach((cb) => cb());
  return v;
};

export const diaryList = (): Promise<DiarySummary[]> => invoke<DiarySummary[]>("diary_list");
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
