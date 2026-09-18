// Listening rooms — the app's side of DeetsMusicRooms (docs/ROOMS.md).
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
  type RoomBridge,
} from "./player";
import { toast } from "./toast";
import * as diag from "./diag";

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
  epoch: number;
}

export interface RoomMember {
  memberId: string;
  name: string;
  isHost: boolean;
  joinedAt: number;
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
  upcoming: RoomEntry[];
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
  playing: false,
  stopped: false,
  error: "",
};

// ── module state ─────────────────────────────────────────────────────────────

/**
 * Where the worker lives when `roomsUrl` is empty. A custom domain, never a
 * workers.dev name, so a later move stays a route change on Cloudflare rather
 * than an app release — the rule music-api.deets.solutions follows for the mint.
 */
const ROOMS_URL_DEFAULT = "https://rooms.deets.solutions";

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

/** Start a room from what this app is playing now (§7). */
export async function startRoom(): Promise<void> {
  if (inRoom()) return;
  state = { ...OFF, phase: "starting" };
  emit();
  try {
    const response = await fetch(`${baseUrl()}/room`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: roomName() || "Host", guestControls: storedControls() }),
    });
    if (!response.ok) throw new Error(`the rooms server answered ${response.status}`);
    const made = (await response.json()) as { code?: string; hostToken?: string };
    if (!made.code || !made.hostToken) throw new Error("the rooms server sent no code");
    hostToken = made.hostToken;
    diag.log("room:start", { code: made.code });
    // The room takes the host's current song and Up Next (§7). READ THEM FIRST: `connect`
    // resolves on the first state message, and that message's `writeModel` has already
    // replaced this app's queue with the room's — which on a new room is empty. Reading
    // the queue after the connection therefore seeds the room with nothing, and the room
    // sits idle for ever (the 2026-09-18 log: `room:in` with no `add` after it).
    const current = queue.getCurrent();
    const seed = entriesFrom([...(current ? [current] : []), ...queue.getUpcoming()]);
    await connect(made.code, true);
    diag.log("room:seed", { songs: seed.length });
    if (seed.length) send({ type: "add", entries: seed, where: "end" });
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

async function connect(code: string, asHost: boolean): Promise<void> {
  closing = false;
  ownQueue ??= queue.snapshot(); // saved once, even across a reconnect (§9.4)
  await roomEnter();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(socketUrl(code));
    socket = ws;
    ws.addEventListener("open", () => {
      send({
        type: "join",
        v: PROTOCOL_V,
        name: roomName() || (asHost ? "Host" : "Listener"),
        ...(hostToken ? { hostToken } : {}),
      });
    });
    ws.addEventListener("message", (event) => {
      onMessage(String(event.data));
      if (!settled && state.phase === "in") {
        settled = true;
        attempt = 0;
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
      onClose(code);
    });
  });
}

function onClose(code: string): void {
  if (socket && socket.readyState === WebSocket.OPEN) return;
  socket = null;
  if (closing || state.phase === "off") return;
  // The host's app reconnects with its host token; a guest simply comes back (§7).
  state = { ...state, phase: "reconnecting" };
  emit();
  const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  attempt += 1;
  diag.log("room:reconnect", { code, attempt, wait });
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
      diag.warn("room:error", { code: message.code });
      return;
    default:
      return;
  }
}

function fail(text: string, e: unknown): void {
  diag.warn("room:failed", { text, e: String(e) });
  toast({ kind: "warn", text: `${text} ${String(e instanceof Error ? e.message : e)}` });
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
  playingEntryId = "";
  stopped = false;
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

function applyState(message: any): void {
  clockOffset = Number(message.serverNow) - Date.now();
  const transport = message.transport as Transport;
  lastTransport = transport; // the drift tick and Listen again read it
  const upcoming = (message.queue?.upcoming ?? []) as RoomEntry[];

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
    upcoming,
    playing: transport.playing,
    error: "",
  };
  if (first) {
    setRoomBridge(bridge);
    diag.log("room:in", { code: state.code, host: state.isHost });
  }
  writeModel(transport.current, upcoming);
  emit();
  void follow(transport);
}

/**
 * The room's queue becomes this app's queue model, so Now Playing, Up Next and the
 * Queue card show the room with no card of their own. The entries carry their own
 * metadata, so a song this library never saw still reads properly.
 */
function writeModel(current: RoomEntry | null, upcoming: RoomEntry[]): void {
  const all = [...(current ? [current] : []), ...upcoming];
  addTransientTracks(all.map(trackOf));
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
    // Buffer during the lead, then play on the room's moment (§5.5).
    await roomShow(handle, position, false);
    if (!t.playing) return;
    if (startsIn > 0) await sleep(startsIn);
    if (!inRoom() || stopped || playingEntryId !== entry.entryId) return;
    await roomResumeAt(expectedPosition(t));
    settle(entry.entryId);
    return;
  }

  if (!t.playing) {
    await roomHold();
    return;
  }
  if (!roomHasSong()) {
    // The local player has nothing loaded (a song ended locally and went silent, or a
    // reconnect): put the room's song back and start it where the room is.
    await roomShow(handle, position, false);
    await roomResumeAt(expectedPosition(t));
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
 * once, SETTLE_MS after the start, and lines the app up with the room to within a quarter
 * of a second.
 */
const SETTLE_MS = 1400;
const SETTLE_TOLERANCE_MS = 250;
function settle(entryId: string): void {
  window.setTimeout(() => {
    if (!inRoom() || stopped || playingEntryId !== entryId || !lastTransport?.playing) return;
    const expected = expectedPosition(lastTransport);
    const local = roomPositionMs();
    if (local <= 0 || Math.abs(local - expected) < SETTLE_TOLERANCE_MS) return;
    diag.log("room:settle", { off: Math.round(local - expected) });
    void roomResumeAt(expectedPosition(lastTransport), true);
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
export const inviteLink = (): string => `deetsmusic://room?code=${state.code}`;

// ── the bridge player.ts calls (§10) ─────────────────────────────────────────

/** Build room entries from queue handles, with what the track store knows. */
function entriesFrom(handles: readonly TrackHandle[]): unknown[] {
  const out: unknown[] = [];
  for (const handle of handles) {
    const id = handle.catalogId;
    if (!id) continue; // a library-only song has no id the others can play (§5.3)
    const track = trackById(id);
    if (!track?.durationMs) continue;
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

/** What was dropped on the way in: songs the room cannot carry (§5.3). */
function noteDropped(asked: number, sent: number): void {
  if (sent >= asked) return;
  toast({
    kind: "info",
    text:
      sent === 0
        ? "Those songs are only in your library, so the room cannot play them."
        : `${asked - sent} of those songs are only in your library, so the room left them out.`,
  });
}

const bridge: RoomBridge = {
  playPause(): void {
    // Pause is always here, whatever the host allows (§12.3).
    if (stopped) return listenAgain();
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
    const list = handles.slice(startIndex);
    const entries = entriesFrom(list);
    noteDropped(list.length, entries.length);
    if (!entries.length) return;
    send({ type: "add", entries, replace: true });
  },
  enqueue(handles: readonly TrackHandle[], where: "next" | "later"): void {
    const entries = entriesFrom(handles);
    noteDropped(handles.length, entries.length);
    if (!entries.length) return;
    send({ type: "add", entries, where: where === "next" ? "next" : "end" });
  },
  insertAt(_at: number, handles: readonly TrackHandle[]): void {
    // The room's add takes "next" or "end"; a drop between two rows lands at the top.
    bridge.enqueue(handles, "next");
  },
  jumpTo(index: number): void {
    const entry = state.upcoming[index];
    if (!entry) return;
    // Remove the songs before it, then Next: the room walks to the song you picked.
    for (const skipped of state.upcoming.slice(0, index)) {
      send({ type: "remove", entryId: skipped.entryId });
    }
    send({ type: "next" });
  },
  removeAt(index: number): void {
    const entry = state.upcoming[index];
    if (entry) send({ type: "remove", entryId: entry.entryId });
  },
  moveTo(index: number, to: "top" | "bottom"): void {
    const entry = state.upcoming[index];
    if (!entry) return;
    send({ type: "move", entryId: entry.entryId, toIndex: to === "top" ? 0 : state.upcoming.length - 1 });
  },
  station(): boolean {
    // A station has no song list the other apps can follow (§10).
    toast({
      kind: "info",
      text: "A station cannot play in a room. Leave the room first.",
      actions: [{ label: "Leave room", run: () => leaveRoom() }],
    });
    return false;
  },
};
