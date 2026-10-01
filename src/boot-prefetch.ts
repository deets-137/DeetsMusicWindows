// The launch reads, asked for first (DEBUGGING.md §Launch, 2026-09-29). main.ts imports this
// module FIRST, so its calls are the first ones any module makes: the database thread takes
// jobs in arrival order (db_thread.rs), so the library is its first job, not the tenth.
//
// A call made in a page task leaves the page only when that task ends (measured: the calls of
// the module evaluation and of the DOMContentLoaded handler all reached Rust together, about
// 50 ms after the handler). So the gain is the ORDER here, and the handler's own length
// (main.ts moves the parts the window does not need to after it, `later`): the database works
// while the page runs those parts.
//
// Each read is taken ONCE, by the module that used to make it (track-store.ts, queue-persist.ts).
// A second load (a sync's reload) calls Rust again, as before.

import { invoke } from "@tauri-apps/api/core";
import type { Page, Track } from "./library";

type Heals = { healed: [string, string][]; none: string[] };
type Reads = {
  library: Promise<Page<Track>>;
  seen: Promise<Track[]>;
  heals: Promise<Heals>;
  queue: Promise<string | null>;
};

// `limit` as track-store.ts loadTracks asks: the whole library in one page.
const reads: Partial<Reads> = {
  library: invoke<Page<Track>>("library_tracks", { offset: 0, limit: 100000 }),
  seen: invoke<Track[]>("seen_tracks"),
  heals: invoke<Heals>("catalog_heals"),
  queue: invoke<string | null>("queue_state_get"),
};
// A read that nobody takes (a unit test, a page that never boots) must not report an
// unhandled rejection; the taker sees the same rejection on its own `await`.
for (const p of Object.values(reads)) p?.catch(() => {});

/** The launch read of `key`, once; undefined after it was taken (call Rust yourself). */
export function takeBootRead<K extends keyof Reads>(key: K): Reads[K] | undefined {
  const p = reads[key];
  delete reads[key];
  return p;
}
