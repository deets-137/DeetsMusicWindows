// The Network panel's feed (docs/features/speedtest.md §8): the modules that see a network
// event tell it here, and net.ts keeps the minutes. No imports, so the player, AirPlay, Rooms,
// Friends and the fetch wrap can call it without a cycle. A note before net.ts listens is lost
// (the first seconds of a launch): the panel's history starts when the app does anyway.

/** The AirPlay session's running counts, as airplay_status gives them. */
export interface AirplayStats {
  speaker: string;
  rttMs: number;
  rttP95Ms: number;
  packets: number;
  resends: number;
  starved: number;
}

export type NetNote =
  /** A mid-song pause to load, or a song end that played nothing, and how long. */
  | { kind: "stall"; s: number }
  /** A Rooms or Friends (home) socket closed and must reconnect. */
  | { kind: "drop"; what: "room" | "friends" }
  /** Each AirPlay poll (2 s while connected); null = no speaker now. */
  | { kind: "airplay"; stats: AirplayStats | null }
  /** A song piece the fetch wrap timed. */
  | { kind: "piece"; kbps: number };

const subs = new Set<(n: NetNote) => void>();

export function netNote(n: NetNote): void {
  for (const f of subs) {
    try {
      f(n);
    } catch {
      /* the panel's fault must never reach the caller (the player, a socket) */
    }
  }
}

export function onNetNote(f: (n: NetNote) => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}
