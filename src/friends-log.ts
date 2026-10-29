// The Friends on DM shelf's log (docs/features/friends-shelf.md §2.2): the albums each friend
// played lately, as this app kept them from their presences. Pure: no DOM, no storage, no
// sockets — friends.ts keeps the logs and home.ts draws them; the rules live here, so a test
// can hold them.
//
// An album is one per name and artist, whatever song of it was played: the newest play wins
// its place. The same rule makes the three albums a sending app puts in its own presence.

/** One album a friend played. `catalogId` and `title` are a song of it, the tile's seed. */
export interface LogAlbum {
  album: string;
  artist: string;
  title: string;
  catalogId: string;
  artworkUrl: string | null;
  at: number;
}

/** What this app keeps for one friend. */
export interface FriendLog {
  /** When their app last spoke (a presence). The 7-day age-out counts from it. */
  heard: number;
  /** Inside the friend's hour's pause: their tiles hide, the log stays (§2.2). */
  paused?: boolean;
  albums: LogAlbum[];
}

/** Albums kept per friend (his call, 2026-10-29). */
export const LOG_MAX = 10;
/** Albums a sending app puts in its own presence (his call, 2026-10-29). */
export const SEND_MAX = 3;
/** Recent tiles on the shelf, split between friends (his call, 2026-10-29). */
export const SHELF_RECENT = 10;
/** A friend not heard from in this long is forgotten: the friend who turned sharing off while
 *  this app was shut, or whose app is too old to say so (§2.2). */
export const KEEP_MS = 7 * 86_400_000;

/** One album's identity: its name and artist, in any case. */
export const albumIdOf = (a: Pick<LogAlbum, "album" | "artist">): string =>
  `${a.album.trim().toLowerCase()}\n${a.artist.trim().toLowerCase()}`;

/** Read one entry off the wire or out of storage; null for anything the tile could not draw. */
export function asLogAlbum(raw: unknown): LogAlbum | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const album = typeof r.album === "string" ? r.album.trim() : "";
  const catalogId = typeof r.catalogId === "string" ? r.catalogId : "";
  const at = Number(r.at);
  if (!album || !catalogId || !Number.isFinite(at) || at <= 0) return null;
  return {
    album,
    artist: typeof r.artist === "string" ? r.artist : "",
    title: typeof r.title === "string" && r.title ? r.title : album,
    catalogId,
    artworkUrl: typeof r.artworkUrl === "string" && r.artworkUrl ? r.artworkUrl : null,
    at,
  };
}

/** Fold new plays into a log: one entry per album (the newest play wins), newest first, `max` kept. */
export function mergeAlbums(log: LogAlbum[], incoming: LogAlbum[], max = LOG_MAX): LogAlbum[] {
  const byId = new Map<string, LogAlbum>();
  for (const a of [...log, ...incoming]) {
    const id = albumIdOf(a);
    const was = byId.get(id);
    if (!was || a.at > was.at) byId.set(id, a);
  }
  return [...byId.values()].sort((a, b) => b.at - a.at).slice(0, max);
}

/** The logs still worth keeping: every friend heard from inside KEEP_MS. */
export function expireLogs(logs: Record<string, FriendLog>, now: number): Record<string, FriendLog> {
  const out: Record<string, FriendLog> = {};
  for (const [code, log] of Object.entries(logs)) if (now - log.heard < KEEP_MS) out[code] = log;
  return out;
}

/** The albums a sending app puts in its presence: its own log without the album playing now. */
export function recentToSend(mine: LogAlbum[], now: Pick<LogAlbum, "album" | "artist"> | null): LogAlbum[] {
  const skip = now ? albumIdOf(now) : "";
  return mine.filter((a) => albumIdOf(a) !== skip).slice(0, SEND_MAX);
}

/**
 * The shelf's right side (his call, 2026-10-29): the friends take turns. Each turn takes one
 * album from each friend, the friend with the newest album first; a friend with fewer albums
 * leaves room for the others. An album already on the shelf (playing now, or another friend's
 * turn) is passed over. With one friend, that friend's albums fill it.
 */
export function takeTurns(
  logs: { code: string; albums: LogAlbum[] }[],
  skip: ReadonlySet<string>,
  max = SHELF_RECENT,
): { code: string; album: LogAlbum }[] {
  const queues = logs
    .map((l) => ({ code: l.code, albums: l.albums.filter((a) => !skip.has(albumIdOf(a))) }))
    .filter((l) => l.albums.length)
    .sort((a, b) => b.albums[0].at - a.albums[0].at);
  const seen = new Set(skip);
  const out: { code: string; album: LogAlbum }[] = [];
  const next = queues.map(() => 0);
  let more = true;
  while (out.length < max && more) {
    more = false;
    for (let i = 0; i < queues.length && out.length < max; i++) {
      const q = queues[i];
      // A friend's next album that someone else already put on the shelf: take their one after.
      while (next[i] < q.albums.length && seen.has(albumIdOf(q.albums[next[i]]))) next[i]++;
      if (next[i] >= q.albums.length) continue;
      const album = q.albums[next[i]++];
      seen.add(albumIdOf(album));
      out.push({ code: q.code, album });
      more = true;
    }
  }
  return out;
}
