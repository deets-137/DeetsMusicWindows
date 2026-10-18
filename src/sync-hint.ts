// The Library ⟳'s hover hint while a sync runs (ideas/apple-calls.md §4, his words
// 2026-10-17). Pure: library.ts keeps the state from the `library-sync` events, the Library
// card writes the words to the ⟳'s `title`, and a click while it spins shows them at once.

/** Where the running sync is. `start`: no page yet. `reading`: songs arrive. `finishing`:
 *  the songs are in, and the artist pass and the heal still hold the lock. */
export interface SyncStatus {
  stage: "start" | "reading" | "finishing";
  /** Which pass sends the pages. A full pass counts every song read; an incremental pass
   *  counts only the new songs it found. */
  kind?: "full" | "incremental";
  fetched?: number;
  total?: number;
}

/** The ⟳'s hint when no sync runs. */
export const IDLE_HINT = "Reads your library from Apple Music again";

const fmt = (n: number) => n.toLocaleString();

/** The ⟳'s hint for a sync status; `null` = no sync runs. */
export function syncHint(s: SyncStatus | null): string {
  if (!s) return IDLE_HINT;
  if (s.stage === "finishing") return "Finishing up your library…";
  if (s.stage === "reading" && s.kind === "incremental") {
    const n = s.fetched ?? 0;
    return n > 0 ? `Checking for new songs… ${fmt(n)} new` : "Checking for new songs…";
  }
  if (s.stage === "reading" && s.fetched != null && s.total) {
    return `Reading your library… ${fmt(s.fetched)} of ${fmt(s.total)} songs`;
  }
  return "Reading your library…";
}

/** The status after one `library-sync` event. `idle` (the lock's release) gives `null`. */
export function nextSyncStatus(
  s: SyncStatus | null,
  e: { phase: string; kind?: "full" | "incremental"; fetched?: number; total?: number },
): SyncStatus | null {
  switch (e.phase) {
    case "start":
      return { stage: "start" };
    case "progress": {
      // A full pass's last page: the songs are in, the artist pass runs before `done`.
      const full = e.kind !== "incremental";
      const all = full && e.total != null && e.fetched != null && e.fetched >= e.total;
      return { stage: all ? "finishing" : "reading", kind: e.kind, fetched: e.fetched, total: e.total };
    }
    case "done":
    case "error":
      return { ...(s ?? {}), stage: "finishing" };
    case "idle":
      return null;
    default:
      return s;
  }
}
