// Temporary web playlists (PLAYLIST-WEB.md §10): the check that deletes the ones past their
// time. A web playlist made with Temp carries its days; its time is the later of its creation
// and its last play, plus the days (Rust computes it). The check runs a minute after launch
// (the restored queue's context is known by then) and then once an hour. It never deletes the
// playlist that plays now. One toast with Undo covers all that went at a check. Local SQL
// only: zero Apple calls.

import { invoke } from "@tauri-apps/api/core";
import * as queue from "./queue";
import { toast } from "./toast";
import { notifyPlaylistsChanged } from "./playlists";
import * as diag from "./diag";

/** A deleted playlist, whole (playlists.rs `ExpiredPlaylist`): Undo sends it back. */
interface ExpiredPlaylist {
  id: number;
  name: string;
  description?: string | null;
  cover?: string | null;
  folderId?: number | null;
  expireDays: number;
  tracks: string[];
}

const FIRST_CHECK_MS = 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;
let started = false;

async function check(): Promise<void> {
  const playing = queue.getCurrent()?.context ?? null;
  let gone: ExpiredPlaylist[];
  try {
    gone = await invoke<ExpiredPlaylist[]>("playlists_expire", { playing });
  } catch (e) {
    console.error("[expiry] check", e);
    diag.warn("web:expiry", { check: String(e) });
    return;
  }
  if (!gone.length) return;
  for (const p of gone) diag.log("web:expiry", { fire: p.id, days: p.expireDays, songs: p.tracks.length });
  notifyPlaylistsChanged();
  toast({
    kind: "info",
    text: gone.length === 1 ? `Deleted the expired web playlist “${gone[0].name}”.` : `Deleted ${gone.length} expired web playlists.`,
    actions: [{ label: "Undo", run: () => void undo(gone) }],
  });
}

async function undo(gone: ExpiredPlaylist[]): Promise<void> {
  let failed = 0;
  for (const p of gone) {
    try {
      const id = await invoke<number>("playlist_restore", { playlist: p });
      diag.log("web:expiry", { undo: p.id, as: id });
    } catch (e) {
      console.error("[expiry] undo", e);
      failed++;
    }
  }
  notifyPlaylistsChanged();
  if (failed) toast({ kind: "warn", text: failed === 1 ? "Couldn't bring back one web playlist." : `Couldn't bring back ${failed} web playlists.` });
}

/** Start the check (main.ts, once). */
export function initPlaylistExpiry(): void {
  if (started) return;
  started = true;
  diag.log("web:expiry", { arm: "check", firstMs: FIRST_CHECK_MS, everyMs: CHECK_EVERY_MS });
  window.setTimeout(() => {
    void check();
    window.setInterval(() => void check(), CHECK_EVERY_MS);
  }, FIRST_CHECK_MS);
}
