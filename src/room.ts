// Listening rooms — the app's side of DeetsMusicRooms (docs/integrations/ROOMS.md).
//
// A room is a shared queue and clock that several DeetsMusic apps follow. Each app
// plays the songs through its own MusicKit and its own Apple Music subscription:
// NO AUDIO PASSES BETWEEN APPS. What travels is song ids, a queue and one clock.
//
// This file is the connection and the follower:
//   - the WebSocket, its reconnect with backoff, and the clock offset (§5.4)
//   - the room state store the panel renders from (§1)
//   - the RoomBridge player.ts calls, so every transport click, queue edit and play
//     in a room becomes a room command instead of a local one (§10)
//   - follower mode: the room says WHEN each song starts; this makes the local
//     player agree (§9.3)
//
// The app never moves to the next song on its own in a room: at the local song end it
// goes silent and waits for the room, because two apps drifting would each skip (§5.5).

import { invoke } from "@tauri-apps/api/core";
import { roomTag } from "./room-friend-rules";
import { setting, setSetting } from "./settings-store";
import * as queue from "./queue";
import type { TrackHandle } from "./queue";
import { trackById, addTransientTracks } from "./track-store";
import type { Track } from "./library";
import {
  setRoomBridge,
  roomEnter,
  roomExit,
  roomShow,
  roomHold,
  roomResumeAt,
  roomPositionMs,
  roomHasSong,
  roomPlayingSame,
  isPlayingNow,
  roomStationLoad,
  roomStationHas,
  roomStationGoTo,
  roomStationQueue,
  roomLive,
  onRoomStationItems,
  setRoomStationRow,
  type RoomBridge,
  type RoomStationSong,
} from "./player";
import type { Station } from "./radio";
import { applyChange, editTail, gather, tailOf, topUpOf } from "./room-list";
import { toast } from "./toast";
import { busy, busyOver, causeOf } from "./busy";
import * as diag from "./diag";
import { plainError } from "./plain-error";
import { WEB_ROOMS } from "./platform";
import { netNote } from "./net-feed";

// ── the wire (mirrors DeetsMusicRooms/src/protocol.js, its own repo) ─────────

/** What this app speaks. The worker turns away anything below its own `minV` (§5.1). */
const PROTOCOL_V = 1;

export interface RoomEntry {
  entryId: string;
  catalogId: string;
  isrc: string | null;
  title: string;
  artist: string;
  album: string;
  artworkUrl: string | null;
  durationMs: number;
  addedBy: { memberId: string; name: string } | null;
  addedAt: number;
}

export type Permission = "everyone" | "host";
export interface GuestControls {
  playPause: Permission;
  skip: Permission;
  seek: Permission;
  add: Permission;
  changeQueue: Permission;
}
export const DEFAULT_CONTROLS: GuestControls = {
  playPause: "everyone",
  skip: "everyone",
  seek: "everyone",
  add: "everyone",
  changeQueue: "everyone",
};

interface Transport {
  current: RoomEntry | null;
  playing: boolean;
  startedAt: number | null;
  pausedPosition: number;
  leadUntil: number | null;
  leadPosition: number;
  // No `epoch`. The worker still writes one, but a single WebSocket delivers in order,
  // so the only staleness that exists is CROSS-socket — and `connect()` now closes that
  // at the source. Comparing an epoch here would guard nothing and would oblige every
  // future broadcast to bump it or silently freeze the transport (ROOMS.md §18.4).
}

export interface RoomMember {
  memberId: string;
  name: string;
  isHost: boolean;
  joinedAt: number;
  /** Their room tag, when they have a friend code (FRIENDS.md §18.5). An older app sends none. */
  tag?: string;
  /** "web" for a member listening on deets.solutions (WebRooms.md §4); absent = the app. */
  client?: string;
}

/**
 * The long list's numbers (ROOMS.md §21). The KEEPER's app holds the full list L, in play
 * order with the first song included; the room was given `fed` of it (its window), and the
 * rest, L[fed..], is the tail. `len` is L's length. The worker stores only these numbers.
 */
export interface RoomListInfo {
  keeper: string | null;
  rev: number;
  len: number;
  fed: number;
}
const NO_LIST: RoomListInfo = { keeper: null, rev: 0, len: 0, fed: 0 };

/** A station in the room (§21.8): the keeper is its feeder. */
export interface RoomStation {
  id: string;
  name: string;
  artworkUrl: string | null;
  live: boolean;
  /** A song, artist or genre station: another member can take over its feed. */
  shareable: boolean;
  by: { memberId: string; name: string } | null;
}

/** A member offered you their friend code (FRIENDS.md §18). The worker sends it to you alone. */
export interface FriendOffer {
  from: string;
  name: string;
  code: string;
}

/** What the panel draws. `phase` is the whole story of the connection. */
export interface RoomState {
  phase: "off" | "starting" | "joining" | "in" | "reconnecting";
  code: string;
  isHost: boolean;
  memberId: string;
  hostName: string;
  hostConnected: boolean;
  guestControls: GuestControls;
  members: RoomMember[];
  current: RoomEntry | null;
  /** The whole Up Next: the room's window, then the keeper's tail (§21.2). */
  upcoming: RoomEntry[];
  /** How many of `upcoming` are the room's window (the rest is the keeper's tail). */
  windowLen: number;
  /** Who holds the full list and tops the window up (§21): a member id, or "". */
  keeper: string;
  /** A station in the room, fed by the keeper (§21.8). */
  station: RoomStation | null;
  /** What the room played, oldest first: the worker keeps the last 50 (ROOMS.md §5.2). The
   *  web History card reads it (WebRooms.md §9.3 E). */
  history: RoomEntry[];
  playing: boolean;
  /** Set while this app stopped listening but the room plays on (§8, §12.3). */
  stopped: boolean;
  error: string;
}

const OFF: RoomState = {
  phase: "off",
  code: "",
  isHost: false,
  memberId: "",
  hostName: "",
  hostConnected: true,
  guestControls: { ...DEFAULT_CONTROLS },
  members: [],
  current: null,
  upcoming: [],
  windowLen: 0,
  keeper: "",
  station: null,
  history: [],
  playing: false,
  stopped: false,
  error: "",
};

/**
 * A web host's room code and host token, kept in the TAB's sessionStorage (WebRooms.md §3
 * rule 8): a reload comes back as the host inside the worker's 60 s grace window, and a closed
 * tab forgets it, so the room ends 60 s later as when an app host quits. The app keeps the
 * token in memory only, as before.
 */
const WEB_HOST_KEY = "deets.room.host";
function keepWebHost(code: string, token: string): void {
  if (!WEB_ROOMS) return;
  try {
    sessionStorage.setItem(WEB_HOST_KEY, JSON.stringify({ code, token }));
  } catch {
    /* storage refused: a reload then ends the room, as closing the tab does */
  }
}
function forgetWebHost(): void {
  if (!WEB_ROOMS) return;
  try {
    sessionStorage.removeItem(WEB_HOST_KEY);
  } catch {
    /* nothing kept */
  }
}

// ── module state ─────────────────────────────────────────────────────────────

/**
 * Where the worker lives when `roomsUrl` is empty. A custom domain, never a
 * workers.dev name, so a later move stays a route change on Cloudflare rather
 * than an app release — the rule music-api.deets.solutions follows for the mint.
 */
const ROOMS_URL_DEFAULT = "https://rooms.deets.solutions";

/** The name the busy toast uses — what the panel is called, not what the worker is
 *  called (FRIENDS.md §5.2, and `src/busy.ts`). */
const SERVICE = "DeetsRooms";

/** Correct the local player when it is this far from the room (§9.3). */
const DRIFT_MS = 1750;
/** At most one correction this often, so a busy machine is not fought (§9.3). */
const DRIFT_GAP_MS = 5000;
/** The reconnect backoff, in order. The last value repeats. */
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];

let state: RoomState = { ...OFF };
let socket: WebSocket | null = null;
let hostToken = "";
/** serverNow − Date.now() at the last message: the room's clock in our terms (§5.4). */
let clockOffset = 0;
let attempt = 0;
let reconnectTimer: number | undefined;
let closing = false;
/** The entry the local player is on, so a state that changes nothing costs nothing. */
let playingEntryId = "";
let lastDriftFix = 0;
/** The queue this app had before it joined; it returns on leave (§9.4). */
let ownQueue: queue.QueueSnapshot | null = null;
/** "Stop listening" (§12.3): the room plays on, this app does not. */
let stopped = false;
/** The last transport the room sent: the drift tick and Listen again read it. */
let lastTransport: Transport | null = null;
/**
 * A room made from music that is PLAYING (Listen Along, FRIENDS.md §16.2): until this time,
 * and until the room itself plays, the follower leaves the local player alone. Without it the
 * empty first state and the held seed each pause the host mid-song (found 2026-09-26). 0 = off.
 */
let keepPlayingUntil = 0;
/** The worker's scheduled-start lead (DeetsMusicRooms protocol.js LEAD_MS). */
const ROOM_LEAD_MS = 1500;

// ── the long list (ROOMS.md §21) ─────────────────────────────────────────────
// The room's Up Next is a WINDOW of up to MAX_WINDOW songs. The keeper's app holds the full
// list and tops the window up when it runs low; every member gets the rest (the tail) in
// packets the worker relays and never stores. A click on a 4,000-song Library is one window
// and ~14 packets, where it used to be one message the worker refused as too large.

/** The room's window (DeetsMusicRooms protocol.js MAX_WINDOW). */
const MAX_WINDOW = 100;
/** Top the window up when it holds this many songs or fewer. */
const TOPUP_AT = 50;
/** Entries per list packet: ~300 real entries are ~120 KB, under the worker's 256 KB. */
const PACKET_SIZE = 300;
/** The longest list a room carries (his Library is 4,046). */
const MAX_LIST = 10_000;
/** Ask the keeper for the list again when ours is still behind after this long. */
const LIST_WANT_MS = 2000;
/** A jump this near the top walks there by removes and Next; further down replays the list. */
const JUMP_BY_REMOVES = 4;

/**
 * This app's copy of the list: L[offset..], at version `rev`. The keeper holds it from 0;
 * a member holds the tail it was sent. `assembling` gathers the parts of a whole-list send.
 */
let list: { rev: number; offset: number; items: RoomEntry[] } = { rev: 0, offset: 0, items: [] };
let assembling: { rev: number; offset: number; parts: number; got: Map<number, RoomEntry[]> } | null = null;
/** The room's list numbers from the last state. */
let listInfo: RoomListInfo = { ...NO_LIST };
/** A top-up in flight: the `fed` it asked for, so the next state does not send it twice. */
let pendingFed = 0;
let listWantTimer: number | undefined;
/** The host's app held the list before its connection dropped: take it back on return (§21.4). */
let reclaim = false;

const isKeeper = (): boolean => !!state.memberId && listInfo.keeper === state.memberId;

/** Ids for this app's list entries: unique in the room, and short (each one rides every packet). */
function mintIds(entries: Record<string, unknown>[]): RoomEntry[] {
  const prefix = Math.random().toString(36).slice(2, 8);
  return entries.map((e, i) => ({ ...(e as object), entryId: `${prefix}${i.toString(36)}` }) as RoomEntry);
}

/** The tail as this app knows it: L[fed..] when our copy is the room's version. */
const tailNow = (): RoomEntry[] => tailOf(list, listInfo);

/** Send the tail (or the whole list from `from`) in packets, to one member or to everyone. */
function sendList(to?: string): void {
  if (!isKeeper()) return;
  const from = Math.max(listInfo.fed, list.offset);
  const tail = list.items.slice(from - list.offset);
  if (!tail.length) return;
  const parts = Math.ceil(tail.length / PACKET_SIZE);
  for (let part = 0; part < parts; part++) {
    send({
      type: "list",
      op: "set",
      rev: list.rev,
      part,
      parts,
      offset: from + part * PACKET_SIZE,
      len: list.offset + list.items.length,
      entries: tail.slice(part * PACKET_SIZE, (part + 1) * PACKET_SIZE),
      ...(to ? { to } : {}),
    });
  }
  diag.log("room:listSend", { rev: list.rev, songs: tail.length, parts, to: to ? "one" : "all" });
}

/** The keeper changed the list: the change goes out first, then the numbers, so members
 *  have the packet before the state that names its version. */
function listChanged(packet: Record<string, unknown>): void {
  send({ type: "list", rev: list.rev, base: list.rev - 1, ...packet });
  send({ type: "listMeta", list: { rev: list.rev, len: list.offset + list.items.length, fed: listInfo.fed } });
}

/** Keeper: fill the room's window from the list when it runs low. */
function maybeTopUp(windowLen: number): void {
  if (!isKeeper() || state.station) return;
  if (pendingFed && listInfo.fed >= pendingFed) pendingFed = 0;
  if (pendingFed) return;
  const next = topUpOf(list, listInfo, windowLen, MAX_WINDOW, TOPUP_AT);
  if (!next) return;
  pendingFed = next.fed;
  diag.log("room:topUp", { songs: next.entries.length, fed: pendingFed, len: list.offset + list.items.length });
  send({
    type: "topUp",
    entries: next.entries,
    list: { rev: list.rev, len: list.offset + list.items.length, fed: pendingFed },
    start: !state.current,
  });
}

/**
 * Play `entries` as the room's new list, from its first song: this app becomes the keeper.
 * The window goes in the replace; the rest goes out in packets.
 */
function playList(entries: Record<string, unknown>[], seed = false): void {
  const items = mintIds(entries.slice(0, MAX_LIST));
  if (!items.length) return;
  const rev = Math.max(list.rev, listInfo.rev) + 1;
  list = { rev, offset: 0, items };
  assembling = null;
  pendingFed = 0;
  const fed = Math.min(items.length, MAX_WINDOW);
  // The worker answers with the state that names us keeper; `sendList` reads these numbers.
  listInfo = { keeper: state.memberId, rev, len: items.length, fed };
  send({
    type: "add",
    entries: items.slice(0, fed),
    list: { rev, len: items.length, fed },
    ...(seed ? { where: "end", seed: true } : { replace: true }),
  });
  diag.log("room:list", { rev, songs: items.length, seed });
  sendList();
}

/** A list packet from the keeper. A whole-list send arrives in parts; a change applies on its base. */
function applyPacket(p: any): void {
  if (isKeeper()) return;
  const rev = Number(p.rev);
  if (p.op === "set") {
    const got = gather(assembling, {
      rev,
      part: Number(p.part),
      parts: Number(p.parts),
      offset: Number(p.offset),
      entries: (p.entries ?? []) as RoomEntry[],
    });
    assembling = got.assembly;
    if (!got.done) return;
    list = got.done;
  } else {
    const next = applyChange(list, {
      op: p.op,
      rev,
      base: Number(p.base),
      entries: p.entries as RoomEntry[] | undefined,
      entryId: p.entryId,
      toIndex: typeof p.toIndex === "number" ? p.toIndex : undefined,
    });
    if (!next) return void wantList(); // missed one: ask for it all
    list = next;
  }
  diag.log("room:listGot", { rev, op: p.op, songs: list.items.length });
  redraw();
}

/** Our copy is behind the room's: ask the keeper once things settle. */
function wantList(): void {
  window.clearTimeout(listWantTimer);
  listWantTimer = window.setTimeout(() => {
    if (!inRoom() || isKeeper() || list.rev === listInfo.rev || listInfo.len <= listInfo.fed) return;
    diag.log("room:listWant", { have: list.rev, want: listInfo.rev });
    send({ type: "listWant" });
  }, LIST_WANT_MS);
}

/** Keeper: a change to the tail, asked by a member or by this app (§21.2). */
function keeperEdit(op: string, entryId: string, toIndex?: number): void {
  if (!isKeeper()) return;
  const edit = editTail(list, listInfo.fed, op, entryId, toIndex);
  if (edit.kind === "none") return;
  // Play from here: the list from this song on becomes the room's new list.
  if (edit.kind === "jump") return playList(edit.from as unknown as Record<string, unknown>[]);
  list = edit.copy;
  listChanged(edit.packet);
  if (edit.top) send({ type: "add", entries: [edit.top], where: "next" });
}

/** Keeper: songs added at the end while the list has a tail (his call 2A). */
function keeperAppend(entries: RoomEntry[]): void {
  if (!isKeeper() || !entries.length) return;
  const room = MAX_LIST - list.items.length;
  const add = entries.slice(0, Math.max(0, room));
  if (!add.length) return;
  list = { ...list, rev: list.rev + 1, items: [...list.items, ...add] };
  listChanged({ op: "append", entries: add });
}

/** A tail change from this app: the keeper does it, anyone else asks the keeper. */
function tailEdit(op: "remove" | "move" | "top" | "jump", entry: RoomEntry, toIndex?: number): void {
  if (isKeeper()) return keeperEdit(op, entry.entryId, toIndex);
  send({ type: "tailEdit", op, entryId: entry.entryId, ...(toIndex !== undefined ? { toIndex } : {}) });
}

// ── a station in the room (ROOMS.md §21.8) ───────────────────────────────────
// The member who starts a station is its FEEDER (the keeper while it plays); the host keeps
// the host role (his call, 2026-10-16). The feeder's MusicKit holds the station queue and
// knows the next song before it plays (§21.7); it sends that song to the room's window, so
// every member starts it together at the song boundary. Documented MusicKit only.

/** The longest a station reload may take before the feeder gives up and tries again. */
const FEED_LOAD_MS = 8000;
/** How long the feeder waits for MusicKit's refill after moving onto a song. */
const FEED_REFILL_MS = 4000;
/** A failed restart tries again after this, while the room is still dry, this many times. */
const FEED_RETRY_MS = 3000;
const FEED_TRIES = 3;
let feedTries = 0;
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
    p.then(
      (v) => {
        window.clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** The last station song this app fed, so a repeated refill event does not send it twice. */
let fedKey = "";
/** A station restart in flight (the room ran dry, or this app just took over the feed). */
let feedRestarting = false;
/** The live broadcast this app tuned in to, so each state does not tune in again. */
let liveOn = "";

const amFeeder = (): boolean => !!state.station && !state.station.live && isKeeper();

function stationOf(s: RoomStation): Station {
  return {
    id: s.id,
    name: s.name,
    isLive: s.live,
    artwork: s.artworkUrl ? { urlTemplate: s.artworkUrl, width: 0, height: 0 } : undefined,
  };
}

function entryOfSong(s: RoomStationSong): Record<string, unknown> | null {
  if (!s.durationMs) return null;
  return {
    catalogId: s.catalogId,
    isrc: s.isrc,
    title: s.title,
    artist: s.artistName,
    album: s.albumName,
    artworkUrl: s.artworkUrl,
    durationMs: s.durationMs,
  };
}

/** Start a station in the room: this app becomes its feeder (§21.8). */
async function startStation(s: Station): Promise<void> {
  const station = {
    id: s.id,
    name: s.name,
    artworkUrl: s.artwork?.urlTemplate ?? null,
    live: s.isLive,
  };
  diag.log("room:feeder", { on: true, id: s.id, live: s.isLive });
  wireFeed();
  if (s.isLive) {
    send({ type: "add", replace: true, entries: [], station });
    return;
  }
  try {
    const songs = await roomStationLoad(s);
    const entries = mintIds(songs.slice(0, 2).map(entryOfSong).filter((e): e is Record<string, unknown> => !!e));
    if (!entries.length) throw new Error("the station sent no songs");
    fedKey = `${entries.length - 1}:${String(entries[entries.length - 1].catalogId)}`;
    list = { rev: 0, offset: 0, items: [] };
    send({ type: "add", replace: true, entries, station });
  } catch (e) {
    diag.warn("room:feederFailed", { id: s.id, e: String(e) });
    toast({ kind: "warn", text: `Couldn't start “${s.name}” in the room.` });
  }
}

/**
 * Feeder: send the station's next song to the room when the window is empty (§21.7: MusicKit
 * keeps one song ahead of where it is). Runs on each room state and on MusicKit's refill.
 */
function feedLookAhead(): void {
  if (!amFeeder() || feedRestarting || state.windowLen > 0 || !state.current) return;
  const { songs } = roomStationQueue();
  const at = songs.findIndex((x) => x?.catalogId === state.current?.catalogId);
  if (at < 0) return; // the room plays a song from outside the station (a break-out)
  const next = songs[at + 1];
  const entry = next ? entryOfSong(next) : null;
  if (!next || !entry) return; // MusicKit's refill has not landed yet: its event calls us again
  const key = `${at + 1}:${next.catalogId}`;
  if (key === fedKey) return;
  fedKey = key;
  diag.log("room:feed", { id: next.catalogId, late: false });
  send({ type: "topUp", entries: mintIds([entry]) });
}

/**
 * Feeder: the room ran dry while a station is on — two skips beat MusicKit's refill, a song
 * added during the station played out, or this app just took over the feed (§21.4). Load the
 * station again and start its next song in the room.
 */
/**
 * The restart drives MusicKit, so it waits its turn behind the follower's steps: run side by
 * side, one's pause cut off the other's play (AbortError, the two-app desk run, 2026-10-16).
 */
function queueRestartFeed(): void {
  following = following.then(() => restartFeed()).catch((e) => diag.warn("room:follow", { e: String(e) }));
}

async function restartFeed(): Promise<void> {
  if (!amFeeder() || feedRestarting || state.current || !state.station) return;
  feedRestarting = true;
  try {
    // Two quick skips: MusicKit's station queue holds the last song the room played, and
    // usually the one after it. If not yet, move MusicKit onto that last song: its own refill
    // (one song ahead, on each position change, §21.7) then fetches the next one.
    const last = state.history[state.history.length - 1]?.catalogId;
    const after = (): RoomStationSong | undefined => {
      const { songs } = roomStationQueue();
      const at = last ? songs.findIndex((x) => x?.catalogId === last) : -1;
      return at >= 0 ? (songs.slice(at + 1).find((x) => !!x && !!entryOfSong(x)) ?? undefined) : undefined;
    };
    let ready = after();
    if (!ready && last && roomStationHas(last)) {
      await roomStationGoTo(last);
      for (let waited = 0; !ready && waited < FEED_REFILL_MS; waited += 250) {
        await sleep(250);
        ready = after();
      }
    }
    if (ready) {
      if (!amFeeder() || state.current) return;
      fedKey = `${roomStationQueue().songs.indexOf(ready)}:${ready.catalogId}`;
      diag.log("room:feed", { id: ready.catalogId, late: true, held: true });
      send({ type: "topUp", entries: mintIds([entryOfSong(ready)!]), start: true });
      feedTries = 0;
      return;
    }
    // The station queue is gone (a song added during the station replaced it): load it again.
    // MusicKit's setQueue can stall while a play it was asked for is still pending (seen
    // 2026-10-16), so it gets a time limit and the next state tries again.
    const songs = await withTimeout(roomStationLoad(stationOf(state.station)), FEED_LOAD_MS);
    const entries = mintIds(songs.slice(0, 2).map(entryOfSong).filter((e): e is Record<string, unknown> => !!e));
    if (!entries.length || !amFeeder()) return;
    fedKey = `${entries.length - 1}:${String(entries[entries.length - 1].catalogId)}`;
    diag.log("room:feed", { id: String(entries[0].catalogId), late: true });
    send({ type: "topUp", entries, start: true });
    feedTries = 0;
  } catch (e) {
    diag.warn("room:feederFailed", { id: state.station?.id, e: String(e), tries: feedTries + 1 });
    // Still dry and still ours: try again shortly rather than leave the room silent — but a
    // few times only, since each reload asks Apple for the station's songs.
    if (++feedTries < FEED_TRIES) window.setTimeout(queueRestartFeed, FEED_RETRY_MS);
    else toast({ kind: "warn", text: `Couldn't start “${state.station?.name ?? "the station"}” in the room.` });
  } finally {
    feedRestarting = false;
  }
}

/** MusicKit's refill event, wired the first time this app feeds a station. */
let feedWired = false;
function wireFeed(): void {
  if (feedWired) return;
  feedWired = true;
  onRoomStationItems(() => feedLookAhead());
}

const listeners = new Set<(s: RoomState) => void>();
/** Subscribe to the room state. The panel and the title bar item render from this. */
export function onRoomChange(cb: (s: RoomState) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function emit(): void {
  state = { ...state, stopped };
  listeners.forEach((cb) => cb(state));
}

export const roomState = (): RoomState => state;
export const inRoom = (): boolean => state.phase === "in" || state.phase === "reconnecting";

/** The room's clock in this app's terms. */
const roomNow = (): number => Date.now() + clockOffset;

function baseUrl(): string {
  const raw = (setting("roomsUrl") || ROOMS_URL_DEFAULT).trim();
  return raw.replace(/\/+$/, "");
}
function socketUrl(code: string): string {
  return `${baseUrl().replace(/^http/, "ws")}/room/${code}/ws`;
}

/** Any case, with or without the dash, with the misread letters mapped (§6). */
export function normalizeCode(raw: string): string | null {
  const cleaned = (raw ?? "")
    .toUpperCase()
    .replace(/[\s\-_]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(cleaned) ? cleaned : null;
}
/** `K7QM-4XHT`, the form the panel shows. */
export const formatCode = (code: string): string =>
  code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

/** The name this app joins under. Empty until the member types one. */
export const roomName = (): string => setting("roomName").trim();
export function setRoomName(name: string): void {
  setSetting("roomName", name.slice(0, 24));
}

// ── start / join / leave ─────────────────────────────────────────────────────

/**
 * Start a room from what this app is playing now (§7).
 *
 * `controls` overrides the stored guest controls for THIS room only, without changing
 * what the panel's pills say for the next one. Friends' Listen Along passes a host-only
 * set, so the person who pressed the button simply hears what you hear (FRIENDS.md §7).
 */
export async function startRoom(controls?: GuestControls, opts?: { keepPlaying?: boolean }): Promise<void> {
  if (inRoom()) return;
  // Listen Along's room (FRIENDS.md §16.2, his call 2026-09-26): "you are not interrupted".
  // Read BEFORE anything changes: whether you play, and where you are in the song.
  const keep = !!opts?.keepPlaying;
  const wasPlaying = keep && isPlayingNow();
  const atMs = keep ? roomPositionMs() : 0;
  state = { ...OFF, phase: "starting" };
  emit();
  try {
    const response = await fetch(`${baseUrl()}/room`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: roomName() || "Host", guestControls: controls ?? storedControls() }),
    });
    if (!response.ok) {
      // The status number is not the user's problem (FRIENDS.md §5.2). `busy` turns a 429
      // or the kill switch into one sentence that also says the music is unaffected; the
      // number itself stays in the log, where it is useful. It replaces the raw
      // "the rooms server answered 429" this line used to put on screen.
      diag.warn("room:failed", { where: "start", status: response.status });
      busy(SERVICE, causeOf(response.status));
      teardown("failed");
      return;
    }
    const made = (await response.json()) as { code?: string; hostToken?: string };
    if (!made.code || !made.hostToken) throw new Error("the rooms server sent no code");
    hostToken = made.hostToken;
    keepWebHost(made.code, made.hostToken);
    diag.log("room:start", { code: made.code });
    // The room takes the host's current song and Up Next (§7). READ THEM FIRST: `connect`
    // resolves on the first state message, and that message's `writeModel` has already
    // replaced this app's queue with the room's — which on a new room is empty. Reading
    // the queue after the connection therefore seeds the room with nothing, and the room
    // sits idle for ever (the 2026-09-18 log: `room:in` with no `add` after it).
    const current = queue.getCurrent();
    const seed = entriesFrom([...(current ? [current] : []), ...queue.getUpcoming()]);
    // Only when the room's first song IS the one you are on: `entriesFrom` drops a song the
    // others cannot play, and a position means nothing on another song.
    const fromHere = keep && !!current?.catalogId && (seed[0] as { catalogId?: string } | undefined)?.catalogId === current.catalogId;
    if (wasPlaying && fromHere) keepPlayingUntil = Date.now() + 10_000; // before connect: its first state is empty
    await connect(made.code, true);
    diag.log("room:seed", { songs: seed.length, keep: wasPlaying });
    // `seed: true` fills the room WITHOUT starting it (DeetsMusicRooms room.js: a plain
    // first add auto-advances and sets playing). The host's own Play is what starts a
    // room — otherwise the room is already playing before the host has pressed anything,
    // and their Play button is really a Pause button (the owner's call, 2026-09-18).
    // A long Up Next goes as the window plus the list (§21.2): the host keeps the list.
    if (seed.length) playList(seed as Record<string, unknown>[], true);
    // Listen Along starts FROM WHERE YOU ARE. The room's start is one lead away, so it is set
    // one lead ahead: when the lead ends, the room and your music are at the same place, and
    // `step` only lines them up. Paused, it holds at your position instead of 0:00.
    if (fromHere) {
      send({ type: "seek", positionMs: Math.round(atMs + (wasPlaying ? ROOM_LEAD_MS : 0)) });
      if (wasPlaying) send({ type: "play" });
    }
  } catch (e) {
    fail("Couldn't start a room.", e);
  }
}

/** Join by code, from the panel or from a `deetsmusic://room?code=…` link (§1). */
export async function joinRoom(rawCode: string): Promise<void> {
  const code = normalizeCode(rawCode);
  if (!code) {
    toast({ kind: "warn", text: "That is not a room code. A code is 8 letters and numbers." });
    return;
  }
  if (inRoom()) leaveRoom();
  hostToken = "";
  state = { ...OFF, phase: "joining", code };
  emit();
  try {
    await connect(code, false);
  } catch (e) {
    fail("Couldn't join that room.", e);
  }
}

/**
 * The web port after a reload: back into the room this tab hosts, with its host token, so
 * the room is not lost to a reload (WebRooms.md §3 rule 8). True when there was one.
 */
export function resumeWebHost(): boolean {
  if (!WEB_ROOMS || inRoom()) return false;
  let kept: { code?: string; token?: string } | null = null;
  try {
    kept = JSON.parse(sessionStorage.getItem(WEB_HOST_KEY) ?? "null");
  } catch {
    kept = null;
  }
  const code = kept?.code && normalizeCode(kept.code);
  if (!code || !kept?.token) return false;
  hostToken = kept.token;
  state = { ...OFF, phase: "joining", code };
  emit();
  diag.log("room:resume-host", { code });
  connect(code, true).catch((e) => fail("Couldn't get back into your room.", e));
  return true;
}

/** Leave (a guest) or end it (the host, §7). The app's own queue comes back (§9.4). */
export function leaveRoom(): void {
  if (!socket) return;
  closing = true;
  try {
    send({ type: "leave" });
    socket.close(1000, "left");
  } catch {
    /* already gone */
  }
  teardown("left");
}

/** The host's End room (§7). */
export function endRoom(): void {
  if (!state.isHost) return;
  closing = true;
  send({ type: "end" });
  teardown("ended");
}

/**
 * This app's room tag for `code`, or none (FRIENDS.md §18.5). `friend_code` never mints:
 * joining a room is not a door that makes a friend code.
 */
async function joinTag(code: string): Promise<string> {
  try {
    const me = await invoke<string | null>("friend_code");
    return me ? await roomTag(code, me) : "";
  } catch {
    return "";
  }
}

async function connect(code: string, asHost: boolean): Promise<void> {
  closing = false;
  ownQueue ??= queue.snapshot(); // saved once, even across a reconnect (§9.4)
  await roomEnter();
  const tag = await joinTag(code);
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    // Supersede whatever is still open BEFORE the new socket exists. Its own close
    // listener settles the `connect()` that waits on it, so no caller is left awaiting
    // for ever — which is why the guards below cannot simply return early (§18.3).
    const previous = socket;
    socket = null;
    if (previous) {
      diag.log("room:supersede", { code });
      try {
        previous.close();
      } catch {
        /* already gone */
      }
    }
    const ws = new WebSocket(socketUrl(code));
    socket = ws;
    ws.addEventListener("open", () => {
      send({
        type: "join",
        v: PROTOCOL_V,
        name: roomName() || (asHost ? "Host" : "Listener"),
        ...(hostToken ? { hostToken } : {}),
        ...(tag ? { tag } : {}),
        // The app's member list marks a web member (WebRooms.md §4). An older worker ignores it.
        ...(WEB_ROOMS ? { client: "web" } : {}),
      });
    });
    ws.addEventListener("message", (event) => {
      // A message already queued on the event loop when this socket was superseded still
      // arrives. The live socket owns the state; this one only settles its own promise
      // (§18.3). `close` is guarded for the same reason, and for a second one: without it
      // the old socket's close ran `onClose`, which nulled the NEW socket and scheduled a
      // reconnect on top of a connection that was already coming up.
      if (ws !== socket) return;
      onMessage(String(event.data));
      if (!settled && state.phase === "in") {
        settled = true;
        attempt = 0;
        // Back in. Clear the busy floor, so the NEXT outage is told about at once rather
        // than swallowed by a window that began during this one.
        busyOver(SERVICE);
        resolve();
      }
    });
    ws.addEventListener("error", () => {
      if (!settled) {
        settled = true;
        reject(new Error("the rooms server could not be reached"));
      }
    });
    ws.addEventListener("close", (event) => {
      if (!settled) {
        settled = true;
        reject(new Error(event.reason || "the rooms server closed the connection"));
      }
      if (ws !== socket) return;
      onClose(code);
    });
  });
}

function onClose(code: string): void {
  if (socket && socket.readyState === WebSocket.OPEN) return;
  socket = null;
  if (closing || state.phase === "off") return;
  // The host's app reconnects with its host token; a guest simply comes back (§7).
  // The host held the list: once back in, it takes it from whoever fed it meanwhile (§21.4).
  if (state.isHost && isKeeper() && !state.station) reclaim = true;
  state = { ...state, phase: "reconnecting" };
  emit();
  const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  attempt += 1;
  diag.log("room:reconnect", { code, attempt, wait });
  netNote({ kind: "drop", what: "room" });
  // Not on the first retry — a flaky second is not a busy service — and never per retry
  // after that, because `busy` has its own ten-minute floor (FRIENDS.md §5.2, rule 1).
  if (attempt === 3) busy(SERVICE, "gone");
  window.clearTimeout(reconnectTimer);
  reconnectTimer = window.setTimeout(() => {
    connect(code, state.isHost).catch(() => onClose(code));
  }, wait);
}

function onMessage(raw: string): void {
  let message: any;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  switch (message.type) {
    case "state":
      applyState(message);
      return;
    case "denied":
      toast({ kind: "info", text: "The host keeps that control in this room." });
      diag.log("room:denied", { command: message.command, reason: message.reason });
      return;
    case "kicked":
      closing = true;
      toast({ kind: "info", text: "The host removed you from the room." });
      teardown("kicked");
      return;
    case "ended":
      closing = true;
      toast({ kind: "info", text: "The room ended." });
      teardown(message.reason === "host-left" ? "host-left" : "ended");
      return;
    case "error":
      if (message.code === "old-app") {
        closing = true;
        toast({ kind: "warn", text: "Update DeetsMusic to join this room.", sticky: true });
        teardown("old-app");
        return;
      }
      if (message.code === "full") {
        closing = true;
        toast({ kind: "warn", text: "That room is full." });
        teardown("full");
        return;
      }
      // A friend offer that did not go: the member left, or a worker from before the
      // offer existed (it answers "unknown-command"). room-friends.ts says which.
      if (message.code === "no-member" || message.code === "bad-code" || message.code === "unknown-command") {
        offerFailedListeners.forEach((cb) => cb(String(message.code)));
      }
      diag.warn("room:error", { code: message.code });
      // The worker refused a change: say so, never leave a click doing nothing (2026-10-16,
      // a 4,000-song click refused as too large with no sign, ROOMS.md §21.1).
      if (message.code === "rate") toast({ kind: "warn", text: "That was too fast for the room. Try again in a few seconds." });
      else if (message.code === "too-large" || message.code === "bad-packet" || message.code === "bad-json" || message.code === "bad-message") {
        toast({ kind: "warn", text: "The room didn't take that change. Try again." });
      }
      return;
    case "list":
      applyPacket(message);
      return;
    case "listWant":
      // A member's copy is behind, or a member just joined: send them the list (§21.2).
      sendList(typeof message.from === "string" ? message.from : undefined);
      return;
    case "tailEdit":
      if (typeof message.entryId === "string") keeperEdit(String(message.op), message.entryId, typeof message.toIndex === "number" ? message.toIndex : undefined);
      return;
    case "tailAdd":
      keeperAppend(Array.isArray(message.entries) ? (message.entries as RoomEntry[]) : []);
      return;
    case "friendOffer":
      if (typeof message.from !== "string" || typeof message.code !== "string") return;
      diag.log("room:friend-offer-in", { from: message.from });
      offerListeners.forEach((cb) =>
        cb({ from: message.from, name: String(message.name ?? ""), code: message.code }),
      );
      return;
    default:
      return;
  }
}

// ── add a member as a friend (FRIENDS.md §18) ────────────────────────────────

const offerListeners = new Set<(offer: FriendOffer) => void>();
const offerFailedListeners = new Set<(code: string) => void>();
/** A member sent you their friend code. room-friends.ts decides what it does. */
export function onFriendOffer(cb: (offer: FriendOffer) => void): () => void {
  offerListeners.add(cb);
  return () => offerListeners.delete(cb);
}
/** The worker refused an offer this app sent: `no-member`, `bad-code` or `unknown-command`. */
export function onFriendOfferFailed(cb: (code: string) => void): () => void {
  offerFailedListeners.add(cb);
  return () => offerFailedListeners.delete(cb);
}
/** Send your friend code to ONE member. The worker relays it to them and nobody else. */
export function sendFriendOffer(to: string, code: string): void {
  send({ type: "friendOffer", to, code });
  diag.log("room:friend-offer-out", { to });
}

function fail(text: string, e: unknown): void {
  diag.warn("room:failed", { text, e: String(e) });
  toast({ kind: "warn", text: `${text} ${plainError(e, "Check your connection, then try again.")}` });
  teardown("failed");
}

/** Back to the app's own player: the saved queue returns, paused (§9.4). */
function teardown(why: string): void {
  window.clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  try {
    socket?.close();
  } catch {
    /* already gone */
  }
  socket = null;
  hostToken = "";
  forgetWebHost();
  playingEntryId = "";
  stopped = false;
  keepPlayingUntil = 0;
  // The long list and the station (§21) end with the room.
  window.clearTimeout(listWantTimer);
  list = { rev: 0, offset: 0, items: [] };
  assembling = null;
  listInfo = { ...NO_LIST };
  windowEntries = [];
  pendingFed = 0;
  tailTracksRev = -1;
  reclaim = false;
  fedKey = "";
  liveOn = "";
  setRoomStationRow(null);
  diag.log("room:left", { why });
  roomHold().catch(() => {});
  roomExit();
  setRoomBridge(null);
  if (ownQueue) {
    queue.restore(ownQueue, true);
    ownQueue = null;
  }
  state = { ...OFF };
  emit();
}

function send(message: Record<string, unknown>): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(message));
  } catch (e) {
    diag.warn("room:send", { type: message.type, e: String(e) });
  }
}

// ── the room state lands ─────────────────────────────────────────────────────

/** The room's window from the last state (the tail is this app's own copy, `list`). */
let windowEntries: RoomEntry[] = [];

function applyState(message: any): void {
  clockOffset = Number(message.serverNow) - Date.now();
  const transport = message.transport as Transport;
  lastTransport = transport; // the drift tick and Listen again read it
  windowEntries = (message.queue?.upcoming ?? []) as RoomEntry[];
  const wasKeeper = isKeeper();
  const info = message.queue?.list as Partial<RoomListInfo> | undefined;
  listInfo = info ? { ...NO_LIST, ...info } : { ...NO_LIST };
  const station = (message.queue?.station ?? null) as RoomStation | null;

  const first = state.phase !== "in";
  state = {
    ...state,
    phase: "in",
    code: message.meta.code,
    isHost: !!message.you?.isHost,
    memberId: message.you?.memberId ?? "",
    hostName: message.meta.hostName,
    hostConnected: message.hostConnected !== false,
    guestControls: { ...DEFAULT_CONTROLS, ...(message.meta.guestControls ?? {}) },
    members: message.members ?? [],
    current: transport.current,
    upcoming: windowEntries,
    windowLen: windowEntries.length,
    keeper: listInfo.keeper ?? "",
    station,
    history: (message.queue?.history ?? []) as RoomEntry[],
    playing: transport.playing,
    error: "",
  };
  if (first) {
    setRoomBridge(bridge);
    diag.log("room:in", { code: state.code, host: state.isHost });
  }
  // A late joiner never had the room's earlier songs as current or upcoming, so their names
  // come from the entries themselves, as the queue's do (the web History card reads them).
  if (state.history.length) addTransientTracks(state.history.map(trackOf));
  if (isKeeper() !== wasKeeper) diag.log("room:keeper", { on: isKeeper(), rev: listInfo.rev, have: list.rev });
  // Our copy of the list is behind the room's (a missed packet, a reconnect): ask again.
  if (!isKeeper() && listInfo.len > listInfo.fed && list.rev !== listInfo.rev) wantList();
  // Took over the list (§21.4) holding an older copy than the room's: the songs past the
  // window are lost with the keeper that had them, so the room's numbers say so.
  if (isKeeper() && !wasKeeper && !station && list.rev !== listInfo.rev && listInfo.len > listInfo.fed) {
    diag.warn("room:listLost", { have: list.rev, want: listInfo.rev });
    send({ type: "listMeta", list: { rev: listInfo.rev, len: listInfo.fed, fed: listInfo.fed } });
  }
  // The host is back with the list again: it keeps it from here (his call 4A, §21.4).
  if (reclaim && state.isHost && !isKeeper() && !station && list.rev === listInfo.rev) {
    reclaim = false;
    send({ type: "takeList" });
  }
  redraw(false);
  setRoomStationRow(station && !station.live ? stationOf(station) : null);
  maybeTopUp(windowEntries.length);
  if (amFeeder()) {
    wireFeed();
    if (!state.current) queueRestartFeed();
    else feedLookAhead();
  }
  void follow(transport);
}

/** Up Next = the window, then the tail; the model and the panel follow. */
function redraw(emitOnly = true): void {
  if (emitOnly && !inRoom()) return;
  const upcoming = [...windowEntries, ...tailNow()];
  state = { ...state, upcoming, windowLen: windowEntries.length };
  writeModel(state.current, upcoming);
  emit();
}

/** Tail tracks already given to the track store, by list version: a state message must not
 *  re-add 4,000 tracks each time. */
let tailTracksRev = -1;

/**
 * The room's queue becomes this app's queue model, so Now Playing, Up Next and the
 * Queue card show the room with no card of their own. The entries carry their own
 * metadata, so a song this library never saw still reads properly.
 */
function writeModel(current: RoomEntry | null, upcoming: RoomEntry[]): void {
  const all = [...(current ? [current] : []), ...upcoming];
  const tail = tailNow();
  if (tail.length && tailTracksRev !== list.rev) {
    tailTracksRev = list.rev;
    addTransientTracks(tail.map(trackOf));
  }
  addTransientTracks([...(current ? [current] : []), ...windowEntries].map(trackOf));
  const handles: TrackHandle[] = all.map((entry) => ({
    catalogId: entry.catalogId,
    // Room plays count everywhere, and this context marks them (§9.5).
    context: `room:${state.code}`,
  }));
  queue.setRoomQueue(handles);
}

function trackOf(entry: RoomEntry): Track {
  return {
    catalogId: entry.catalogId,
    title: entry.title,
    artistName: entry.artist,
    albumName: entry.album || undefined,
    durationMs: entry.durationMs,
    genres: [],
    hasLyrics: false,
    isrc: entry.isrc ?? undefined,
    artwork: entry.artworkUrl
      ? { urlTemplate: entry.artworkUrl, width: 0, height: 0 }
      : undefined,
  };
}

/** Where the room says the song should be, right now (§5.5). */
function expectedPosition(t: Transport): number {
  if (!t.current) return 0;
  if (!t.playing || t.startedAt === null) return t.pausedPosition;
  const now = roomNow();
  if (t.leadUntil !== null && now < t.leadUntil) return t.leadPosition;
  return Math.max(0, now - t.startedAt);
}

// ── follower mode (§9.3) ─────────────────────────────────────────────────────

let following: Promise<void> = Promise.resolve();
function follow(t: Transport): Promise<void> {
  // One at a time: two state messages inside a buffer would fight over MusicKit.
  following = following.then(() => step(t)).catch((e) => {
    diag.warn("room:follow", { e: String(e) });
  });
  return following;
}

async function step(t: Transport): Promise<void> {
  if (!inRoom()) return;
  if (stopped) return; // this app is not listening; the room plays on (§12.3)

  // A Listen Along room made from music that is playing (FRIENDS.md §16.2): leave the local
  // player alone until the room plays — the empty first state and the held seed would each
  // pause it — then, on the song MusicKit already plays, line up without a reload.
  if (keepPlayingUntil) {
    const starting = t.playing && t.current;
    if (!starting && Date.now() < keepPlayingUntil) return;
    keepPlayingUntil = 0;
    if (starting && roomPlayingSame(t.current!.catalogId)) {
      const entryId = t.current!.entryId;
      playingEntryId = entryId;
      const startsIn = t.leadUntil ? t.leadUntil - roomNow() : 0;
      diag.log("room:kept", { id: t.current!.catalogId, startsIn: Math.round(startsIn) });
      if (startsIn > 0) await sleep(startsIn);
      const live = lastTransport;
      if (!inRoom() || stopped || playingEntryId !== entryId || !live?.playing || live.current?.entryId !== entryId) return;
      await roomResumeAt(expectedPosition(live)); // seeks only when off; the song never stopped
      settle(entryId);
      return;
    }
  }

  // A live broadcast (§21.8): no songs and no shared clock. Each member tunes in on their
  // own app; Pause is "Stop listening" here, as under a host-only Play/pause.
  const live = state.station?.live ? state.station : null;
  if (live) {
    if (liveOn !== live.id) {
      liveOn = live.id;
      playingEntryId = "";
      await roomLive(stationOf(live));
    }
    return;
  }
  liveOn = "";

  const entry = t.current;
  if (!entry) {
    playingEntryId = "";
    await roomHold();
    return;
  }

  const handle: TrackHandle = { catalogId: entry.catalogId, context: `room:${state.code}` };
  const position = expectedPosition(t);

  // A new song: feed MusicKit this song ALONE and start it at the room's moment.
  if (entry.entryId !== playingEntryId) {
    playingEntryId = entry.entryId;
    const startsIn = t.playing && t.leadUntil ? t.leadUntil - roomNow() : 0;
    diag.log("room:song", { id: entry.catalogId, startsIn: Math.round(startsIn), at: Math.round(position) });
    // The feeder's MusicKit holds the station queue, which already has this song: move onto
    // it rather than load it alone, or the station (and its next song) would be lost (§21.8).
    if (amFeeder() && roomStationHas(entry.catalogId)) await roomStationGoTo(entry.catalogId);
    // Buffer during the lead, then play on the room's moment (§5.5).
    await roomShow(handle, position, false);
    if (!t.playing) return;
    if (startsIn > 0) await sleep(startsIn);
    if (!inRoom() || stopped || playingEntryId !== entry.entryId) return;
    // Read the room AGAIN, do not trust the captured `t`. `follow()` serialises, so a
    // pause that arrives during the lead is queued BEHIND this sleeping step: on the old
    // code the sleeper woke, started sound from stale transport, and only then did the
    // queued step hold it — a blip of music you had already cancelled (ROOMS.md §18.2).
    // `settle()` re-reads for the same reason. A seek during the lead now lands on the
    // NEW position, which is the behaviour change that comes with this.
    const live = lastTransport;
    if (!live?.playing || live.current?.entryId !== entry.entryId) {
      diag.log("room:leadDropped", { id: entry.catalogId, playing: !!live?.playing });
      return;
    }
    await roomResumeAt(expectedPosition(live));
    settle(entry.entryId);
    return;
  }

  if (!t.playing) {
    await roomHold();
    return;
  }
  if (!roomHasSong()) {
    // The local player has nothing loaded (a song ended locally and went silent, or a
    // reconnect): put the room's song back and start it where the room is. `roomResumeAt`
    // does BOTH now — it re-feeds when MusicKit holds nothing — so the old
    // `roomShow(…, false)` before it is gone: it fed the song PAUSED, and a paused
    // descriptor feed leaves `nowPlayingItem` null, which is what this branch tests.
    // The two of them took turns doing nothing (2026-09-18).
    await roomResumeAt(position);
    return;
  }
  // The room plays this song and the app already holds it. Line the position up AND start
  // again if this app is paused: a pause→play in the room lands here with the song still
  // loaded but the local player held. `correcting` is for the drift tick alone — passing it
  // here left the app paused for ever, because a paused player sends no progress tick, so
  // the drift check never ran to get it back (§9.3).
  await roomResumeAt(position);
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * One catch-up after a song starts. `setQueue` alone fetches nothing (player.ts: no
 * lookup, no licence, no bytes), so the lead schedules the start but does not buffer it:
 * each app's own play takes its own moment, and two apps can begin up to about a second
 * apart. That is under the drift threshold, so nothing would ever correct it. This looks
 * SETTLE_MS after the start and lines the app up with the room to within a quarter of a
 * second.
 *
 * A seek lands LATE by the time the player needs to start again after it (measured
 * 2026-09-26: one correction of −335 ms still left the app ~400 ms behind). So after a
 * correction it looks again, up to SETTLE_TRIES times, and aims ahead by what the last one
 * missed. The position is the <audio> clock (player.ts `preciseMs`), not MusicKit's whole
 * second, or none of this could see under a second.
 */
const SETTLE_MS = 1400;
const SETTLE_TOLERANCE_MS = 250;
const SETTLE_TRIES = 3;
function settle(entryId: string, tries = 0, aheadMs = 0): void {
  window.setTimeout(() => {
    if (!inRoom() || stopped || playingEntryId !== entryId || !lastTransport?.playing) return;
    const expected = expectedPosition(lastTransport);
    const local = roomPositionMs();
    const off = local - expected; // negative: behind the room
    if (local <= 0 || Math.abs(off) < SETTLE_TOLERANCE_MS) return;
    // The first try aims at the room; a later one adds what the one before landed short.
    const ahead = tries === 0 ? 0 : Math.max(0, Math.min(1500, aheadMs - off));
    diag.log("room:settle", { off: Math.round(off), try: tries + 1, ahead: Math.round(ahead) });
    void roomResumeAt(expectedPosition(lastTransport) + ahead, true, SETTLE_TOLERANCE_MS);
    if (tries + 1 < SETTLE_TRIES) settle(entryId, tries + 1, ahead);
  }, SETTLE_MS);
}

/**
 * The drift check (§9.3). player.ts calls this on every progress tick while a room is
 * on: if the local position is more than DRIFT_MS from the room's, seek — at most one
 * correction per DRIFT_GAP_MS, so a slow machine is corrected, not fought.
 */
export function roomDriftTick(): void {
  if (!inRoom() || stopped || !state.playing || !state.current) return;
  const now = Date.now();
  if (now - lastDriftFix < DRIFT_GAP_MS) return;
  const expected = expectedPositionFromState();
  if (expected === null) return;
  const local = roomPositionMs();
  if (local <= 0) return;
  const off = Math.abs(local - expected);
  if (off < DRIFT_MS) return;
  lastDriftFix = now;
  diag.log("room:drift", { off: Math.round(off), local: Math.round(local), expected: Math.round(expected) });
  void roomResumeAt(expected, true);
}

function expectedPositionFromState(): number | null {
  if (!lastTransport?.current) return null;
  return expectedPosition(lastTransport);
}

// ── "Stop listening" (§12.3) ─────────────────────────────────────────────────

/**
 * A guest's Pause never greys out, whatever the host allows. When the host keeps
 * Play/pause, Pause stops THIS app and leaves the room's clock running; Play (Listen
 * again) re-joins at the room's position, the same path as a late join.
 */
export function stopListening(): void {
  if (!inRoom() || stopped) return;
  stopped = true;
  playingEntryId = "";
  liveOn = ""; // Listen again tunes back in to a live broadcast
  diag.log("room:stopListening", {});
  void roomHold();
  emit();
}
export function listenAgain(): void {
  if (!inRoom() || !stopped) return;
  stopped = false;
  playingEntryId = "";
  diag.log("room:listenAgain", {});
  emit();
  if (lastTransport) void follow(lastTransport);
}
export const isStopped = (): boolean => stopped;

/** May this member use the control, or is it the host's (§8)? */
export function may(which: keyof GuestControls): boolean {
  if (!inRoom()) return true;
  return state.isHost || state.guestControls[which] === "everyone";
}

/** The host's pills in the panel (§8). */
export function setControls(patch: Partial<GuestControls>): void {
  if (!state.isHost) return;
  send({ type: "setControls", guestControls: patch });
  setSetting("roomGuestControls", { ...storedControls(), ...patch });
}
function storedControls(): GuestControls {
  return { ...DEFAULT_CONTROLS, ...(setting("roomGuestControls") as Partial<GuestControls>) };
}

/** The host's Remove on a member row (§1). */
export function removeMember(memberId: string): void {
  if (!state.isHost) return;
  send({ type: "kick", memberId });
}

/** The invite link the panel copies (§1). */
/** The app's link opens the app. The web port's is the rooms worker's /j/ page, which offers
 *  the app AND "Listen in your browser" (WebRooms.md §1). */
export const inviteLink = (): string => (WEB_ROOMS ? `${baseUrl()}/j/${state.code}` : `deetsmusic://room?code=${state.code}`);

// ── the bridge player.ts calls (§10) ─────────────────────────────────────────

/** What the last `entriesFrom` left out, and why (the toast says which, §21.6). */
let dropped = { noCatalog: 0, noLength: 0 };

/** Build room entries from queue handles, with what the track store knows. */
function entriesFrom(handles: readonly TrackHandle[]): unknown[] {
  const out: unknown[] = [];
  dropped = { noCatalog: 0, noLength: 0 };
  for (const handle of handles) {
    const id = handle.catalogId;
    // No catalog id: Apple sends some library songs without one — songs it no longer links
    // to its catalog (11 in his library, 2026-10-16). The others could not play them (§5.3).
    if (!id) {
      dropped.noCatalog++;
      continue;
    }
    const track = trackById(id);
    if (!track?.durationMs) {
      dropped.noLength++; // the room's clock needs a length
      continue;
    }
    out.push({
      catalogId: id,
      isrc: track.isrc,
      title: track.title,
      artist: track.artistName,
      album: track.albumName ?? "",
      artworkUrl: track.artwork?.urlTemplate ?? null,
      durationMs: track.durationMs,
    });
  }
  return out;
}

/**
 * What was dropped on the way in: songs the room cannot carry (§5.3). His words for the
 * catalog case (2026-10-16, ROOMS.md §21.6); the old "only in your library" was wrong for
 * songs that come from Apple.
 */
function noteDropped(sent: number): void {
  const { noCatalog, noLength } = dropped;
  if (!noCatalog && !noLength) return;
  diag.log("room:dropped", { noCatalog, noLength, sent });
  const parts: string[] = [];
  if (noCatalog) {
    parts.push(
      noCatalog === 1
        ? "1 song isn't in Apple's catalog anymore"
        : `${noCatalog} songs aren't in Apple's catalog anymore`,
    );
  }
  if (noLength) parts.push(noLength === 1 ? "1 song has no length yet" : `${noLength} songs have no length yet`);
  const total = noCatalog + noLength;
  toast({
    kind: "info",
    text: sent === 0
      ? `${parts.join(" and ")}, so the room can't play ${total === 1 ? "it" : "them"}.`
      : `${parts.join(" and ")}, so the room skipped ${total === 1 ? "it" : "them"}.`,
  });
}

const bridge: RoomBridge = {
  playPause(): void {
    // Pause is always here, whatever the host allows (§12.3).
    if (stopped) return listenAgain();
    // A live broadcast has no room clock to pause: Pause stops this app (§21.8).
    if (state.station?.live) return stopListening();
    if (may("playPause")) {
      send({ type: state.playing ? "pause" : "play" });
      return;
    }
    // The host keeps Play/pause: Pause stops THIS app and the room plays on; Play is
    // the room's to give, so say so rather than sending a command that comes back denied.
    if (state.playing) return stopListening();
    toast({ kind: "info", text: "The host starts the music in this room." });
  },
  next(): void {
    send({ type: "next" });
  },
  previous(): void {
    send({ type: "previous" });
  },
  seekSeconds(seconds: number): void {
    send({ type: "seek", positionMs: Math.max(0, Math.round(seconds * 1000)) });
  },
  playHandles(handles: readonly TrackHandle[], startIndex: number): void {
    const wanted = handles.slice(startIndex);
    const entries = entriesFrom(wanted);
    noteDropped(entries.length);
    if (!entries.length) return;
    if (!may("changeQueue")) {
      toast({ kind: "info", text: "The host keeps that control in this room." });
      return;
    }
    // The list goes as a window plus packets; this app keeps it (§21.2).
    playList(entries as Record<string, unknown>[]);
  },
  enqueue(handles: readonly TrackHandle[], where: "next" | "later"): void {
    const entries = entriesFrom(handles);
    noteDropped(entries.length);
    if (!entries.length) return;
    // The keeper adding at the end puts the songs on its own list when there is a tail.
    if (where === "later" && isKeeper() && tailNow().length) {
      keeperAppend(mintIds(entries as Record<string, unknown>[]));
      return;
    }
    // "end" with a tail is relayed to the keeper by the worker (his call 2A).
    send({ type: "add", entries: entries.slice(0, MAX_WINDOW), where: where === "next" ? "next" : "end" });
  },
  insertAt(_at: number, handles: readonly TrackHandle[]): void {
    // The room's add takes "next" or "end"; a drop between two rows lands at the top.
    bridge.enqueue(handles, "next");
  },
  jumpTo(index: number): void {
    const entry = state.upcoming[index];
    if (!entry) return;
    // Further down: play the list from that song, so this app keeps it (§21.2). One remove
    // per skipped song would pass the worker's 20 commands in 10 s from the 20th song on.
    if (index >= JUMP_BY_REMOVES) {
      if (!may("changeQueue")) {
        toast({ kind: "info", text: "The host keeps that control in this room." });
        return;
      }
      playList(state.upcoming.slice(index).map(({ entryId: _id, ...rest }) => rest));
      return;
    }
    // Remove the songs before it, then Next: the room walks to the song you picked.
    for (const skipped of state.upcoming.slice(0, index)) {
      send({ type: "remove", entryId: skipped.entryId });
    }
    send({ type: "next" });
  },
  removeAt(index: number): void {
    const entry = state.upcoming[index];
    if (!entry) return;
    if (index >= state.windowLen) return tailEdit("remove", entry);
    send({ type: "remove", entryId: entry.entryId });
  },
  moveTo(index: number, to: "top" | "bottom"): void {
    const entry = state.upcoming[index];
    if (!entry) return;
    if (index >= state.windowLen) {
      // A tail song to the top goes into the window; to the bottom stays in the tail.
      if (to === "top") return tailEdit("top", entry);
      return tailEdit("move", entry, Number.MAX_SAFE_INTEGER);
    }
    if (to === "bottom" && tailNow().length) {
      // The bottom of the FULL list is the keeper's: out of the window, then added at the end.
      send({ type: "remove", entryId: entry.entryId });
      send({ type: "add", entries: [entry], where: "end" });
      return;
    }
    send({ type: "move", entryId: entry.entryId, toIndex: to === "top" ? 0 : state.windowLen - 1 });
  },
  station(s: Station): boolean {
    // The web port has no feeder (its MusicKit plays the room's songs one at a time).
    if (WEB_ROOMS) {
      toast({
        kind: "info",
        text: "A station cannot play in a room. Leave the room first.",
        actions: [{ label: "Leave room", run: () => leaveRoom() }],
      });
      return false;
    }
    // A station replaces Up Next, so it follows Change the queue (§21.8).
    if (!may("changeQueue")) {
      toast({ kind: "info", text: "The host keeps that control in this room." });
      return false;
    }
    void startStation(s);
    return false; // the room plays it; the caller's radio mode stays off
  },
};
