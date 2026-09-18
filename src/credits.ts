// Writer credits, front-end side (docs/CREDITS.md §7).
//
// Rust collects Apple's `composerName` on every song read (credits.rs). This module is the
// read side: a memory map the hover hint can ask SYNCHRONOUSLY, and the two async reads the
// song pane needs. No Apple call is made here — every answer comes from what the app has
// already read.
//
// Why a memory map: the hint fires on hover, and a hover cannot wait for a round trip. So a
// miss returns undefined at once and quietly asks Rust for that id; the next hover over the
// same row has it. Rows are asked for in batches on an animation frame, because a pointer
// crossing a list would otherwise fire one call per row.

import { invoke } from "@tauri-apps/api/core";
import type { Track } from "./library";

export interface SongCredit {
  /**
   * "have" — Apple sent credits. "none" — we read the song and Apple sent none.
   * A song `creditsFor` returns `undefined` for is the third state: never read. Only that
   * one is ours to fix, and the song level fixes it with `fetchCredits` (CREDITS.md §8).
   */
  state: "have" | "none";
  /** Apple's line, as sent: "JENNIE, Daniel Aged, Deb Never, Romil Hemnani, Jelli & Saya Gray". */
  composer: string;
  /** The same line split into names, for the clickable chips. */
  names: string[];
}

export interface WriterSong {
  catalogId: string;
  title: string;
  artistName: string;
  /** 3 loved, 2 played, 1 in your library, 0 seen only. */
  mine: number;
  /** The stored track, when the app holds one — the row plays only then. */
  track?: Track;
}

// ── The copy (CREDITS.md §7.7) ───────────────────────────────────────────────
// Every line the song and writer levels can show lives here, so the Library level and
// the Search pane say exactly the same thing. Change it once.

/** The section label. Apple's one field carries all three, so the title says all three. */
export const CREDITS_LABEL = "Writers, Producers, & Composers";

/** Apple was asked and had nothing. Not our gap — so the line says whose it is. */
export const CREDITS_NONE = "Apple Music returned no credits for this song.";

/** We have never read this song. Ours to fix, and we are fixing it. */
export const CREDITS_READING = "Reading credits from Apple Music…";

/** The read ran and still found nothing new. */
export const CREDITS_READ_FAILED = "Couldn't read credits from Apple Music. Try again later.";

/** On a writer level, once its songs have loaded: what this list is and is not. */
export const WRITER_REACH =
  "Songs DeetsMusic has read so far. The list grows as you listen and build webs — it is not everything they wrote.";

/** Under the Apple search button on a writer level. */
export const WRITER_SEARCH_NOTE = "Searches write credit and artist credit";

/** A writer level with no songs at all — only reachable if the song's own row is gone. */
export const WRITER_EMPTY = "Nothing collected for this writer yet.";

/** The trailing mark on a row the app knows of but holds no track for. */
export const FLAT_MARK = '<span class="credit__flat" title="Credited, but DeetsMusic holds no track for it yet">credited</span>';

/** A song we asked about and Rust had nothing for: never ask again this session. */
const NONE = Symbol("no credit");
const cache = new Map<string, SongCredit | typeof NONE>();
const wanted = new Set<string>();
let frame = 0;

/** Ask Rust for everything queued, once per frame. */
function drain(): void {
  frame = 0;
  const ids = [...wanted];
  wanted.clear();
  if (!ids.length) return;
  void invoke<Record<string, SongCredit>>("credits_for", { catalogIds: ids })
    .then((got) => {
      for (const id of ids) cache.set(id, got[id] ?? NONE);
    })
    .catch(() => {
      // A failed read is not a fact about the song: forget it, so a later hover retries.
      for (const id of ids) cache.delete(id);
    });
}

/**
 * The credits for one song, or undefined when we do not hold them YET. Synchronous, for
 * the hover hint. A miss queues the id, so the answer is there next time.
 */
export function creditsFor(catalogId?: string | null): SongCredit | undefined {
  if (!catalogId) return undefined;
  const hit = cache.get(catalogId);
  if (hit === NONE) return undefined;
  if (hit) return hit;
  wanted.add(catalogId);
  if (!frame) frame = requestAnimationFrame(drain);
  return undefined;
}

/** Fill the map for a list of songs up front (the song pane, a list about to be shown). */
export async function primeCredits(catalogIds: (string | null | undefined)[]): Promise<void> {
  const ids = catalogIds.filter((id): id is string => !!id && !cache.has(id));
  if (!ids.length) return;
  try {
    const got = await invoke<Record<string, SongCredit>>("credits_for", { catalogIds: ids });
    for (const id of ids) cache.set(id, got[id] ?? NONE);
  } catch {
    /* the pane falls back to "not collected yet" */
  }
}

/** Every song we have collected that credits this writer, yours first. No Apple call. */
export function songsByWriter(name: string): Promise<WriterSong[]> {
  return invoke<WriterSong[]>("songs_by_writer", { name }).catch(() => []);
}

/**
 * Read these songs from Apple now, for their credits. **One Apple call per 300 songs.**
 *
 * The only path that spends a call, and only where the gap is ours: a song we have never
 * read. Apple answering "no credits" is written down too, so this never runs twice for the
 * same song. Resolves to how many came back with credits.
 */
export async function fetchCredits(catalogIds: (string | null | undefined)[]): Promise<number> {
  const ids = catalogIds.filter((id): id is string => !!id);
  if (!ids.length) return 0;
  for (const id of ids) cache.delete(id); // the answer is about to change
  const n = await invoke<number>("credits_fetch", { catalogIds: ids });
  await primeCredits(ids);
  return n;
}

/**
 * Ask Apple for songs credited to this name, so the writer level fills out (§7.5).
 *
 * It is a plain catalog search, which Apple answers on the write credit AND the artist
 * credit. Every result rides `cache_tracks` on the way back, so the credits are collected
 * without a second call. Resolves to how many songs the writer level holds afterwards.
 */
export async function searchAppleForWriter(name: string): Promise<WriterSong[]> {
  const { searchCatalog } = await import("./search");
  await searchCatalog(name, ["songs"]).catch(() => undefined);
  return songsByWriter(name);
}
