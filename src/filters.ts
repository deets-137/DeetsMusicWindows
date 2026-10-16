// Filter rules — the live half (docs/features/filter-rules.md). The pure core is filter-eval.ts;
// the store and the one read are Rust's (filter.rs).
//
// Three jobs:
// 1. The store: the saved filters, and the ones that are Rulez Playlists (a filter with a
//    playlist). Read once, again on every `filters-changed` (a save, or a hand edit to a Rulez
//    Playlist's songs: Rust records Keep and Never in the same transaction as the edit).
// 2. The pool: the library's songs (the page holds them) and the other sources' songs (one
//    Rust read), each with the facts the rule reads. The songs are checked in slices, so a long
//    library never holds the page for one long task (§13.1a).
// 3. The passes: a Live Rulez Playlist is made again when a fact it reads changes; Daily and
//    Weekly on the day change. One pass at a time, changes joined over 2 s, none while a
//    library sync runs, and a pass that started before a hand edit writes nothing (§13.1a).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Track } from "./library";
import { onSyncBusy } from "./library";
import { onTracksChange, tracks } from "./track-store";
import { isLoved, onFavoritesChange } from "./favorites";
import { matchOf, onSuggestChange } from "./suggest";
import { onDiaryChange } from "./diary";
import { onSotdChange } from "./sotd";
import { onPinsChange } from "./pins";
import { notifyPlaylistsChanged, onPlaylistsChange, playlistCreate } from "./playlists";
import { onPlayerState } from "./player";
import { getCurrent } from "./queue";
import { windowStart } from "./rewind";
import { evalCond, type Cond, type FactId, type Facts } from "./rules-eval";
import {
  DEFAULT_REFRESH, REMOTE_FACTS, isDue, makesLoop, missingOf, pickSongs, readsOf, remoteOf, trackFacts, trackKey,
  type FilterRow, type FilterRule, type Refresh, type Song, type SourceId, type Window,
} from "./filter-eval";
import * as diag from "./diag";

// ── the store ──────────────────────────────────────────────────

interface RawRow {
  id: string;
  rule: FilterRule;
  playlistId: number | null;
  refresh: Refresh | null;
  keep: string[];
  never: string[];
  version: number;
  madeAt: number | null;
}

let rows: FilterRow[] = [];
let loaded: Promise<void> | null = null;
const subs = new Set<() => void>();
export function onFiltersChange(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

async function load(): Promise<void> {
  try {
    const raw = await invoke<RawRow[]>("filters_list");
    rows = raw.map((r) => ({ ...r, rule: { ...r.rule, id: r.id } }));
  } catch (e) {
    diag.warn("filter:load", { e: String(e) });
  }
  subs.forEach((cb) => cb());
  arm();
}
/** The saved filters, in their order. */
export const filterRows = (): readonly FilterRow[] => rows;
export const filterRow = (id: string): FilterRow | undefined => rows.find((r) => r.rule.id === id);
export const rulezRowOf = (playlistId: number): FilterRow | undefined => rows.find((r) => r.playlistId === playlistId);
export const filtersReady = (): Promise<void> => (loaded ??= load());

export const newFilterId = (): string => `f:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Save a filter (new or changed). A Rulez Playlist runs a pass at once. */
export async function saveFilter(rule: FilterRule): Promise<void> {
  const row = filterRow(rule.id);
  if (row?.playlistId != null && makesLoop(rows, row.playlistId, rule.sources)) throw new Error("A Rulez Playlist cannot read itself, even through another one.");
  await invoke<number>("filter_save", { id: rule.id, rule });
  diag.log("ui:act", { do: "filter", what: row ? "save" : "new", id: rule.id });
  await load();
  if (row?.playlistId != null) kick("rule", [rule.id]);
}

export async function deleteFilter(id: string): Promise<void> {
  await invoke<void>("filter_delete", { id });
  diag.log("ui:act", { do: "filter", what: "delete", id });
  await load();
  notifyPlaylistsChanged(); // a Rulez Playlist's songs stay, as an ordinary playlist
}

/** A filter becomes a Rulez Playlist: a local playlist (role `rulez`), Live by default (his
 *  call), made at once. Returns the playlist's id. */
export async function makeRulezPlaylist(rule: FilterRule, name: string): Promise<number> {
  const named = { ...rule, name };
  await invoke<number>("filter_save", { id: named.id, rule: named });
  const pid = await playlistCreate(name, "rulez");
  await invoke<void>("filter_attach", { id: named.id, playlistId: pid, refresh: DEFAULT_REFRESH });
  diag.log("ui:act", { do: "filter", what: "rulezPlaylist", id: named.id, playlist: pid });
  await load();
  await runNow([named.id], "made");
  return pid;
}

export async function setRefresh(id: string, refresh: Refresh): Promise<void> {
  await invoke<void>("filter_set_refresh", { id, refresh });
  diag.log("ui:act", { do: "filter", what: "refresh", id, refresh });
  await load();
  if (refresh === "live") kick("refresh", [id]);
}

/** The editor's Undo on a Keep or Never song. */
export async function setLists(id: string, keep: string[], never: string[]): Promise<void> {
  await invoke<void>("filter_set_lists", { id, keep, never });
  await load();
  kick("lists", [id]);
}

// ── the pool ───────────────────────────────────────────────────

interface ReadOut {
  pool: { key: string; from: string; track: Track }[];
  facts: Record<string, Record<string, unknown>>;
  ms: number;
}

const WINDOWS: Window[] = ["day", "week", "month", "year", "ytd"];
/** The facts Rust sends only where a song has a value: the rest are 0, false or []. A score,
 *  a date and a Last.fm count stay missing (filter-rules.md §13.4). */
const FILL: Partial<Record<FactId, unknown>> = {
  plays: 0, finishes: 0, skips: 0, inLibrary: false, inDiary: false, sotd: false, pinned: false, inPlaylist: [],
  ...Object.fromEntries(WINDOWS.flatMap((w) => {
    const W = w === "ytd" ? "Ytd" : w[0].toUpperCase() + w.slice(1);
    return [[`plays${W}`, 0], [`minutes${W}`, 0]];
  })),
};

export interface Pool {
  songs: Song[];
  /** How many songs of the pool have no value for each fact the rule reads (§13.4). */
  missing: Map<FactId, number>;
  /** The Rust read's time, for the log. */
  readMs: number;
}

/** The songs of a rule's sources, each with the facts the rule reads. `keys`: songs that need
 *  facts too (a Rulez Playlist's songs now, for Keep). One Rust read at most; none when the
 *  rule reads only the library and the songs' own facts. */
export async function poolFor(rule: Pick<FilterRule, "if" | "sources" | "order" | "limit">, keys: string[] = []): Promise<Pool> {
  const reads = readsOf(rule);
  const remote = remoteOf(rule);
  const library = rule.sources.includes("library");
  const others = rule.sources.filter((s) => s !== "library");
  let out: ReadOut = { pool: [], facts: {}, ms: 0 };
  if (others.length || remote.length) {
    const since = Object.fromEntries(WINDOWS.map((w) => [w, windowStart(w)]));
    out = await invoke<ReadOut>("filter_read", { req: { sources: others, facts: remote, since, library, keys } });
  }
  const loved = reads.has("loved");
  const less = reads.has("lessMarked");
  const songOf = (key: string, t: Track): Song => {
    const facts: Facts = trackFacts(t);
    for (const f of remote) {
      const v = out.facts[f]?.[key] ?? FILL[f];
      if (v !== undefined) (facts as Record<string, unknown>)[f] = v;
    }
    if (loved) facts.loved = isLoved(t);
    if (less) facts.lessMarked = matchOf(t) ?? "none";
    return { key, track: t, facts };
  };
  const songs: Song[] = [];
  if (library) {
    for (const t of tracks()) {
      const key = trackKey(t);
      if (key && !t.unreleased) songs.push(songOf(key, t));
    }
  }
  for (const p of out.pool) songs.push(songOf(p.key, p.track));
  return { songs, missing: missingOf(songs, rule), readMs: out.ms };
}

/** Facts for songs outside the pool (a Rulez Playlist's songs now): the same fill. */
function songsOf(list: Track[], pool: Pool): Song[] {
  const byKey = new Map(pool.songs.map((s) => [s.key, s]));
  return list.flatMap((t) => {
    const key = trackKey(t);
    if (!key) return [];
    return [byKey.get(key) ?? { key, track: t, facts: trackFacts(t) }];
  });
}

const SLICE = 2000;
const yieldFrame = () => new Promise<void>((r) => setTimeout(r, 0));
/** The songs that pass, checked in slices of 2,000 with the page free between them (§13.1a):
 *  a 20,000-song pool took 17–28 ms as one task. */
async function passing(songs: readonly Song[], c: Cond | undefined): Promise<Song[]> {
  if (!c) return [...songs];
  const out: Song[] = [];
  for (let i = 0; i < songs.length; i += SLICE) {
    if (i) await yieldFrame();
    for (let j = i; j < Math.min(i + SLICE, songs.length); j++) if (evalCond(c, songs[j].facts, { songs: true })) out.push(songs[j]);
  }
  return out;
}

/** A Library filter: the keys of the library songs that pass, and the pool's missing counts. */
export async function libraryKeys(c: Cond | undefined): Promise<{ keys: Set<string>; total: number; missing: Map<FactId, number> }> {
  const pool = await poolFor({ if: c, sources: ["library"], order: { by: "hand", dir: "asc" } });
  const pass = await passing(pool.songs, c);
  return { keys: new Set(pass.map((s) => s.key)), total: pool.songs.length, missing: pool.missing };
}

// ── the passes (Rulez Playlists) ───────────────────────────────

const DAY_MS = 86_400_000;
let timer = 0;
let running = false;
let again = false;
let syncing = false;
const want = new Set<string>(); // the rows a kick asked for; empty = every Live one

/** Ask for a pass, joined with the other asks of the next 2 s. `ids`: only these rows. */
function kick(why: string, ids?: string[]): void {
  if (ids) ids.forEach((id) => want.add(id));
  else want.add("*");
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void runLive(why), 2000);
}

const liveRows = () => rows.filter((r) => r.playlistId != null && r.refresh === "live");

async function runLive(why: string): Promise<void> {
  const all = want.has("*");
  const ids = [...want].filter((x) => x !== "*");
  want.clear();
  const picked = rows.filter((r) => r.playlistId != null && (ids.includes(r.rule.id) || (all && r.refresh === "live")));
  if (picked.length) await runNow(picked.map((r) => r.rule.id), why);
}

/** One pass for each of these rows, now (single flight: a pass asked for during one runs after it). */
async function runNow(ids: string[], why: string): Promise<void> {
  if (syncing || running) {
    ids.forEach((id) => want.add(id));
    again = true;
    return;
  }
  running = true;
  try {
    for (const id of ids) {
      const row = filterRow(id);
      if (row?.playlistId != null) await pass(row, why);
    }
  } finally {
    running = false;
    if (again && !syncing) {
      again = false;
      kick("again");
    }
  }
}

async function pass(row: FilterRow, why: string): Promise<void> {
  const t0 = performance.now();
  const id = row.playlistId!;
  try {
    const current = await invoke<Track[]>("local_playlist_tracks", { id });
    const nowKeys = current.map((t) => trackKey(t) ?? "");
    const pool = await poolFor(row.rule, nowKeys.filter(Boolean));
    const keep = new Set(row.keep);
    const never = new Set(row.never);
    const passed = await passing(pool.songs, row.rule.if);
    const currentSongs = songsOf(current, pool);
    // A kept song passes whatever the rule says; pickSongs adds it from the playlist.
    // Random: one order per day and version, so a Live pass does not reshuffle (§3).
    const seed = Math.floor(Date.now() / DAY_MS) * 1000 + row.version;
    const keys = pickSongs(passed, { ...row.rule, if: undefined }, { keep, never, current: currentSongs, seed });
    const same = keys.length === nowKeys.length && keys.every((k, i) => k === nowKeys[i]);
    const byKey = new Map([...currentSongs, ...pool.songs].map((s) => [s.key, s.track]));
    const tracksOut = same ? null : keys.map((k) => byKey.get(k)!).filter(Boolean);
    const wrote = await invoke<boolean>("filter_write", { id: row.rule.id, version: row.version, tracks: tracksOut });
    const ms = Math.round(performance.now() - t0);
    diag.log("rulezPlaylist", {
      do: "pass", why, id: row.rule.id, playlist: id, pool: pool.songs.length, pass: passed.length,
      songs: keys.length, was: nowKeys.length, changed: !same, wrote, readMs: pool.readMs, ms,
    });
    if (!wrote) {
      // A hand edit or a rule edit came in while this pass ran: read the store, then again.
      await load();
      want.add(row.rule.id);
      again = true;
      return;
    }
    if (!same) notifyPlaylistsChanged(id);
    await load();
  } catch (e) {
    diag.warn("rulezPlaylist", { do: "pass", id: row.rule.id, e: String(e) });
  }
}

// ── when a pass runs: the seams (Live) and the day change (Daily, Weekly) ──

/** Which facts a change touches, so a Live rule that reads none of them is left alone. */
const PLAY_FACTS: FactId[] = ["plays", "finishes", "skips", "lastPlayedDays", ...WINDOWS.flatMap((w) => {
  const W = w === "ytd" ? "Ytd" : w[0].toUpperCase() + w.slice(1);
  return [`plays${W}`, `minutes${W}`] as FactId[];
})];
const readsAny = (r: FilterRow, facts: FactId[], sources: (s: SourceId) => boolean): boolean => {
  const reads = readsOf(r.rule);
  return facts.some((f) => reads.has(f)) || r.rule.sources.some(sources);
};
/** Kick the Live rows that read one of these facts or sources. */
function seam(why: string, facts: FactId[], sources: (s: SourceId) => boolean = () => false): void {
  const hit = liveRows().filter((r) => readsAny(r, facts, sources));
  if (hit.length) kick(why, hit.map((r) => r.rule.id));
}

let armed = false;
let unsubs: (() => void)[] = [];
let lastSong = "";
/** Watch the seams only while a Live Rulez Playlist exists (§13.1a: no Live, no work). */
function arm(): void {
  const live = liveRows().length > 0;
  if (live === armed) return;
  armed = live;
  if (!live) {
    unsubs.forEach((u) => u());
    unsubs = [];
    diag.log("rulezPlaylist", { do: "off" });
    return;
  }
  diag.log("rulezPlaylist", { do: "arm", live: liveRows().length });
  const ALL_TRACK_FACTS = [...readsOfTrack];
  unsubs = [
    onTracksChange((why) => why === "library" && seam("library", ALL_TRACK_FACTS, (s) => s === "library" || s === "seen"), "rulez-playlists"),
    onFavoritesChange(() => seam("loved", ["loved"], (s) => s === "loved")),
    onSuggestChange(() => seam("suggest", ["lessMarked"])),
    onDiaryChange(() => seam("diary", ["diaryScore", "inDiary"], (s) => s === "diary")),
    onSotdChange(() => seam("sotd", ["sotd"], (s) => s === "sotd")),
    onPinsChange(() => seam("pins", ["pinned"], (s) => s === "pins")),
    onPlaylistsChange((rowid) => {
      // Our own write tells the cards; it is not a change to read again.
      if (rowid != null && rows.some((r) => r.playlistId === rowid)) return;
      seam("playlists", ["inPlaylist"], (s) => s.startsWith("playlist:"));
    }),
    onPlayerState(() => {
      // A new song started: the last one's play is in the log now.
      const key = currentKey();
      if (key === lastSong) return;
      lastSong = key;
      seam("play", PLAY_FACTS, (s) => s === "history" || s.startsWith("rewind:"));
    }),
  ];
  kick("arm"); // the library may have changed while the app was shut
}
const readsOfTrack = new Set<FactId>(["title", "artist", "album", "albumArtist", "composer", "genre", "year", "length", "explicit", "lyrics", "addedRank", "inLibrary", "addedDays"]);
const currentKey = (): string => {
  const c = getCurrent();
  return c?.catalogId ?? c?.libraryId ?? "";
};

/** Daily and Weekly: a check a minute after start, then hourly, and when the window shows. */
function dayTick(): void {
  const due = rows.filter((r) => r.playlistId != null && isDue(r.refresh, r.madeAt));
  if (due.length) void runNow(due.map((r) => r.rule.id), "due");
}

let started = false;
export function initFilters(): void {
  if (started) return;
  started = true;
  loaded = load();
  void listen("filters-changed", () => void load());
  onSyncBusy((busy) => {
    syncing = busy;
    if (!busy && again) {
      again = false;
      kick("sync done");
    }
  });
  window.setTimeout(dayTick, 60_000);
  window.setInterval(dayTick, 3_600_000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && dayTick());
}

/** Make a Rulez Playlist again now (its menu's *Refresh now*). */
export const refreshNow = (id: string): Promise<void> => runNow([id], "hand");

/** The remote facts set, for the panel's note. */
export const isRemoteFact = (f: FactId): boolean => REMOTE_FACTS.has(f);
