// How often a mirrored Apple playlist re-reads its songs (docs/PLAYLIST-REFRESH.md).
//
// The bug this closes: `apple_playlist_tracks` is cache-first with no time check, and the
// once-per-session sync evicts a playlist only when its flat-list JSON changed. Apple
// rewrites New Music Mix every Friday without changing one attribute we read, so the card
// served last week's songs until you pressed ⟳ — which drops EVERY playlist's cache.
//
// There is no scheduler and no timer that fires while the app is shut. Each covered
// playlist carries a `fetched_at` stamp, and "due" is arithmetic both triggers compute, so
// the two paths can never disagree:
//   Daily         — the stamp is before the most recent local midnight.
//   Weekly · Fri  — the stamp is before the most recent local Friday midnight.
//   Off           — never.
// Trigger 1 is the open (lazy, so an opened playlist is never stale). Trigger 2 is a day
// change while the app runs (so the overview is right before you click anything), noticed
// the way playlist-expiry.ts notices one: a check a minute after launch, then hourly,
// comparing the local calendar date — never a midnight timer, which dies on sleep, on a
// clock change and on a timezone change.
//
// Two different things happen, and they are not the same risk (§5). An Apple MIRROR is
// re-read: the cache is a cache, so nothing is lost. An exported LOCAL playlist is only
// PEEKED: one read, and a sticky toast offers the new songs. "Re-read a cache" and
// "silently add songs to my playlist" are different promises, and only the first is safe to
// make while nobody is watching (D9).

import type { Playlist } from "./search";
import {
  playlistsCached,
  playlistGetAppleSongs,
  playlistAddTracks,
  playlistRefetch,
  refreshRows,
  refreshStamp,
  notifyPlaylistsChanged,
  names,
  songs,
  type RefreshRow,
} from "./playlists";
import type { Track } from "./library";
import { setting } from "./settings-store";
import { toast } from "./toast";
import * as diag from "./diag";

export type RefreshMode = "daily" | "weekly" | "off";

/** A playlist's choice, resolved: either its stored row or its kind's default. */
export interface RefreshChoice {
  mode: RefreshMode;
  /** 0..6, `Date.getDay()` order (0 = Sunday). Weekly only. */
  weekday: number;
  /** True when this came from the kind's default, not from a stored choice. */
  fallback: boolean;
}

const FIRST_CHECK_MS = 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;
/** At most this many refetches at one day change (D10). The rest wait for their open,
 *  which costs nothing extra. */
const MAX_PER_CHECK = 25;
const DEFAULT_WEEKDAY = 5; // Friday — the day Apple rewrites the mixes

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

let rows = new Map<string, RefreshRow>();
let loaded = false;
let started = false;
let lastDay = "";

const dayKey = (d = new Date()): string => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Is this playlist covered at all (D3)? Every Apple mirror, and a local playlist that has
 *  been exported at least once — a local-only playlist has no remote copy to read. */
export function covered(p: Playlist): boolean {
  if (!p.libraryId) return false;
  if (p.source === "apple") return true;
  return !!p.exportedAppleId;
}

/** The default for a playlist with no stored row (D2, D8). `catalog` and `smart` are the
 *  ones Apple's own machinery rewrites with no attribute change — which is the whole bug —
 *  so they are the ones on Daily. Your own Apple playlists bump `lastModifiedDate` when you
 *  edit them, and the sync already evicts on that, so they need nothing. */
function defaultFor(p: Playlist): RefreshMode {
  if (p.source !== "apple") return "off"; // an exported local playlist: read-and-offer, so never by default
  return p.kind === "catalog" || p.kind === "smart" ? "daily" : "off";
}

/** What this playlist is set to, stored choice first. */
export function choiceOf(p: Playlist): RefreshChoice {
  const row = p.libraryId ? rows.get(p.libraryId) : undefined;
  const mode = row?.mode;
  if (mode === "daily" || mode === "weekly" || mode === "off") {
    return { mode, weekday: row?.weekday ?? DEFAULT_WEEKDAY, fallback: false };
  }
  return { mode: defaultFor(p), weekday: DEFAULT_WEEKDAY, fallback: true };
}

/** The badge on the parent menu row: `Daily`, `Weekly · Fri`, `Off`. */
export function choiceLabel(c: RefreshChoice): string {
  if (c.mode === "daily") return "Daily";
  if (c.mode === "off") return "Off";
  return `Weekly · ${WEEKDAYS[c.weekday] ?? WEEKDAYS[DEFAULT_WEEKDAY]}`;
}

/** The most recent local midnight, in ms. */
function midnight(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The most recent local midnight of `weekday`, in ms. Today counts when today IS that
 *  weekday: a Friday mix is due on Friday morning, not the Friday after. */
function weeklyMidnight(weekday: number, now = Date.now()): number {
  const d = new Date(midnight(now));
  const back = (d.getDay() - weekday + 7) % 7;
  d.setDate(d.getDate() - back);
  return d.getTime();
}

/** Is this playlist due a read? Arithmetic only — no clock of its own. */
export function isDue(p: Playlist, now = Date.now()): boolean {
  const c = choiceOf(p);
  if (c.mode === "off") return false;
  const at = (p.libraryId ? rows.get(p.libraryId)?.fetchedAt : null) ?? null;
  if (at == null) return true; // never read: the first open is the first read
  return at < (c.mode === "daily" ? midnight(now) : weeklyMidnight(c.weekday, now));
}

/** Load the stored rows once (and again after a set). */
export async function loadRefreshRows(): Promise<void> {
  try {
    const list = await refreshRows();
    rows = new Map(list.map((r) => [r.key, r]));
    loaded = true;
  } catch (e) {
    console.error("[refresh] rows", e);
  }
}

/** Call after `refreshSet`, so the badge and the next due check read the new choice. */
export const reloadRefreshRows = loadRefreshRows;

// ── The work ─────────────────────────────────────────────────────────────────

/** Re-read one mirror. Returns how many songs are new, or null when the read failed —
 *  and on a failure the old cache AND the old stamp both stay, so the next trigger tries
 *  again rather than waiting another day. */
async function refetchMirror(p: Playlist): Promise<number | null> {
  try {
    const r = await playlistRefetch(p.libraryId!);
    const row = rows.get(p.libraryId!);
    rows.set(p.libraryId!, {
      key: p.libraryId!,
      mode: row?.mode ?? "default",
      weekday: row?.weekday ?? null,
      fetchedAt: Date.now(),
    });
    return r.added;
  } catch (e) {
    console.error("[refresh] refetch", e);
    diag.warn("playlist:refresh", { failed: p.libraryId, why: String(e) });
    return null;
  }
}

/** One peeked local playlist, waiting for the user to press. */
interface Peek {
  p: Playlist;
  tracks: Track[];
}

/** Read an exported local playlist's Apple copy WITHOUT writing (D9). */
async function peekLocal(p: Playlist): Promise<Peek | null> {
  try {
    const r = await playlistGetAppleSongs(p, true);
    const tracks = r.tracks ?? [];
    return tracks.length ? { p, tracks } : null;
  } catch (e) {
    console.error("[refresh] peek", e);
    diag.warn("playlist:refresh", { peekFailed: p.libraryId, why: String(e) });
    return null;
  }
}

/** The offer (§7.2). ONE sticky toast per check, never one per playlist: the stack caps at
 *  3 and sticky toasts hold it, so a toast each would evict the others. It is a question,
 *  so it shows under every tier and waits in the queue rather than being destroyed. */
function offer(peeks: Peek[]): void {
  if (!peeks.length) return;
  const one = peeks.length === 1;
  const text = one
    ? `“${peeks[0].p.name}” has ${songs(peeks[0].tracks.length)} on Apple Music.`
    : peeks.length <= 3
      ? `${names(peeks.map((k) => `“${k.p.name}” (${k.tracks.length})`))} have new songs on Apple Music.`
      : `${peeks.length} playlists have new songs on Apple Music.`;
  diag.log("playlist:refresh", { offer: peeks.map((k) => k.p.libraryId), songs: peeks.reduce((n, k) => n + k.tracks.length, 0) });
  toast({
    kind: "info",
    sticky: true,
    text,
    actions: [
      {
        label: one ? "Get them" : "Get them all",
        run: () => void take(peeks),
      },
    ],
  });
}

/** [Get them]: write the songs already in hand. No second Apple read (§5.1). A DISMISSED
 *  offer never stamps, so the next check offers again — a silently forgotten offer would be
 *  worse than a repeated one. */
async function take(peeks: Peek[]): Promise<void> {
  let failed = 0;
  let added = 0;
  for (const k of peeks) {
    const id = Number(/^local:(\d+)$/.exec(k.p.libraryId ?? "")?.[1]);
    if (!Number.isFinite(id)) continue;
    try {
      await playlistAddTracks(id, k.tracks);
      await refreshStamp(k.p.libraryId!);
      added += k.tracks.length;
    } catch (e) {
      console.error("[refresh] take", e);
      failed++;
    }
  }
  await loadRefreshRows();
  notifyPlaylistsChanged();
  diag.log("playlist:refresh", { took: added, failed });
  if (failed) toast({ kind: "warn", text: failed === 1 ? "Couldn't add the songs to one playlist." : `Couldn't add the songs to ${failed} playlists.` });
  else toast({ kind: "success", text: `Added ${songs(added)}.` });
}

/** Trigger 1 (D5): a due playlist reads on the way in, before its rows draw. So an opened
 *  playlist is never stale. Returns true when it refetched, so the caller can redraw. */
export async function refreshOnOpen(p: Playlist): Promise<boolean> {
  if (!setting("playlistAutoRefresh")) return false;
  if (!loaded) await loadRefreshRows();
  if (!covered(p) || !isDue(p)) return false;
  if (p.source !== "apple") {
    // An exported local playlist is read and OFFERED, never written (D9).
    const peek = await peekLocal(p);
    await refreshStamp(p.libraryId!).catch(() => {});
    await loadRefreshRows();
    if (peek) offer([peek]);
    return false;
  }
  diag.log("playlist:refresh", { open: p.libraryId });
  const added = await refetchMirror(p);
  if (added === null) {
    toast({ kind: "warn", text: `Couldn't re-read “${p.name}” from Apple Music.` });
    return false;
  }
  if (added > 0) toast({ kind: "success", text: `“${p.name}” has ${songs(added)}.` });
  return true;
}

/** Trigger 2 (D5): every due playlist refreshes by itself, so the overview is right before
 *  you click anything. At most 25 refetches (D10), in sequence — the rest are left to the
 *  on-open trigger, which costs nothing extra. */
async function check(force = false): Promise<void> {
  if (!setting("playlistAutoRefresh")) return;
  const today = dayKey();
  if (!force && today === lastDay) return;
  lastDay = today;
  await loadRefreshRows();

  let all: Playlist[];
  try {
    all = await playlistsCached();
  } catch (e) {
    console.error("[refresh] list", e);
    return;
  }
  const due = all.filter((p) => covered(p) && isDue(p));
  if (!due.length) return;

  const mirrors = due.filter((p) => p.source === "apple").slice(0, MAX_PER_CHECK);
  const locals = due.filter((p) => p.source !== "apple");
  diag.log("playlist:refresh", { fire: today, due: due.length, mirrors: mirrors.length, locals: locals.length });

  // Mirrors: refetch, and count the ones whose songs really changed.
  const changed: { p: Playlist; added: number }[] = [];
  for (const p of mirrors) {
    const added = await refetchMirror(p);
    if (added !== null && added > 0) changed.push({ p, added });
  }

  // Exported locals: read and hold; nothing is written (D9).
  const peeks: Peek[] = [];
  for (const p of locals) {
    const peek = await peekLocal(p);
    await refreshStamp(p.libraryId!).catch(() => {});
    if (peek) peeks.push(peek);
  }

  await loadRefreshRows();
  if (changed.length) notifyPlaylistsChanged();

  // §7.1 — one timed toast for the mirrors. Due, refetched and nothing changed is SILENT:
  // a daily "nothing changed" line is noise.
  if (changed.length === 1) {
    toast({ kind: "success", text: `“${changed[0].p.name}” has ${songs(changed[0].added)}.` });
  } else if (changed.length > 1) {
    toast({ kind: "success", text: `${changed.length} playlists updated.` });
  }
  offer(peeks);
}

/** Run the day-change check now, whatever the date says (the Compass verb). */
export const checkPlaylistRefreshNow = (): Promise<void> => check(true);

// Console handle, like __toast and __diag (DEBUGGING.md). Read-only but for `check()`,
// which is the Compass verb "Refresh playlists now" by another name. It is what makes the
// §10 desk test drivable from outside the window.
(window as any).__refresh = {
  /** Every playlist that is DUE right now, and why. */
  due: async (): Promise<{ key: string; name: string; mode: RefreshMode; at: number | null }[]> => {
    await loadRefreshRows();
    const all = await playlistsCached();
    return all
      .filter((p) => covered(p) && isDue(p))
      .map((p) => ({ key: p.libraryId!, name: p.name, mode: choiceOf(p).mode, at: rows.get(p.libraryId!)?.fetchedAt ?? null }));
  },
  /** Every covered playlist: what it is set to, and when it was last read. */
  all: async (): Promise<{ key: string; name: string; kind?: string; mode: RefreshMode; set: boolean; at: string | null; due: boolean }[]> => {
    await loadRefreshRows();
    const all = await playlistsCached();
    return all.filter(covered).map((p) => {
      const c = choiceOf(p);
      const at = rows.get(p.libraryId!)?.fetchedAt ?? null;
      return { key: p.libraryId!, name: p.name, kind: p.kind, mode: c.mode, set: !c.fallback, at: at ? new Date(at).toLocaleString() : null, due: isDue(p) };
    });
  },
  /** The stored rows, raw. */
  rows: async (): Promise<RefreshRow[]> => {
    await loadRefreshRows();
    return [...rows.values()];
  },
  /** Run the day-change check now, whatever the date says. */
  check: (): Promise<void> => check(true),
};

/** Start the checks (main.ts, once). */
export function initPlaylistRefresh(): void {
  if (started) return;
  started = true;
  // lastDay stays EMPTY, so the check a minute after launch always runs: the app may have
  // been shut for days, and every stamp is then old. Only the hourly ticks and the
  // visibility check after that compare dates and no-op on the same day.
  diag.log("playlist:refresh", { arm: "check", firstMs: FIRST_CHECK_MS, everyMs: CHECK_EVERY_MS, on: setting("playlistAutoRefresh") });
  void loadRefreshRows();
  window.setTimeout(() => {
    void check();
    window.setInterval(() => void check(), CHECK_EVERY_MS);
  }, FIRST_CHECK_MS);
  // A laptop that slept through midnight catches up here, the way look-schedule.ts
  // re-ticks after a resume.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void check();
  });
}
