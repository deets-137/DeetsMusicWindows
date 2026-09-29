// Friends — the people you added, what they are playing, and Listen Along.
// Design doc: docs/integrations/FRIENDS.md (§3 the row, §5 the transport, §5.1 the cost rules, §7 the
// Rooms tie-in). The worker is `../DeetsMusicFriends`; this file mirrors its protocol by
// hand, the way `room.ts` mirrors the rooms worker's — they are separate builds, on purpose.
//
// **The shape.** One socket to your own Durable Object, which you push a song up when the
// song changes, and one socket to each friend's, which is broadcast to. Nobody polls, and
// there is no heartbeat — the two rules that keep this inside the Cloudflare free tier.
//
// **The seven cost rules of §5.1, and where each one is:**
//   1. No heartbeat, ever              — nothing here runs on a timer but the reconnect.
//   2. Coalesce song changes           — `push()`, COALESCE_MS.
//   3. Sleep with the window           — `windowAsleep()`, the hidden-and-paused rule.
//   4. Presence in the attachment      — the worker's job (friends.js), not ours.
//   5. Reading is a side effect        — `friendsState()` reads what the sockets delivered.
//   6. A cap of 50 friends             — `friends.rs`, MAX_FRIENDS, enforced both ends.
//   7. One reconnect policy, no storm  — BACKOFF_MS, and one timer per connection.
//
// **Sharing and watching are different switches.** *Share what I play* governs the HOME
// socket: with it off, nothing you play leaves this PC, and the panel says so on its face.
// Watching is separate, because reading a friend's row is what the feature is; a person
// who shares nothing can still see their friends, and their friends see an empty row.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { busy, busyOver, causeOf } from "./busy";
import * as diag from "./diag";
import { onPlayerProgress, onPlayerState, type PlayerProgress, type PlayerState } from "./player";
import * as queue from "./queue";
import {
  DEFAULT_CONTROLS,
  inRoom,
  joinRoom,
  roomName,
  roomState,
  startRoom,
  type GuestControls,
} from "./room";
import { effective, onSettingsChange, ownSetting, setting, setSetting } from "./settings-store";
import { toast } from "./toast";
import { plainError } from "./plain-error";
import { judgeKey, pinsForWorker } from "./friend-pin";

/** A friends-list write failed: the words for a person, and the raw text in the ring. */
function friendFailed(what: string, e: unknown, fallback: string): void {
  diag.warn("friends:failed", { what, e: String(e) });
  toast({ kind: "warn", text: plainError(e, fallback) });
}

/** The name the panel and the busy toast use. Nobody has to know what a worker is. */
const SERVICE = "Friends";
const FRIENDS_URL_DEFAULT = "https://musicfriends.deets.solutions";

/** What this app speaks. The worker's hello carries its own `minV` (protocol.js). */
const PROTOCOL_V = 1;

/**
 * §5.1 rule 2. A settled song change goes at once; a run of skips down a playlist sends
 * once, when the skipping stops. Twenty seconds, because incoming messages are billed
 * 20:1 and a skipping run is the only thing that ever approaches that.
 */
const COALESCE_MS = 20_000;

/**
 * §5.1 rule 3. Hidden AND paused for this long sends one "stopped" and then says nothing
 * until something plays again.
 */
const SLEEP_MS = 5 * 60_000;

/**
 * §5.1 rule 7. Gentler than the rooms worker's, on purpose: a room is a live conversation
 * where half a second matters, and a friend's row is not. The last value repeats, so a
 * long outage costs one attempt every five minutes rather than a storm.
 */
const BACKOFF_MS = [2_000, 5_000, 15_000, 60_000, 300_000];

/** A friend's song, as their app sent it and the worker rebuilt it (sanitize.js). */
export interface FriendPresence {
  catalogId: string | null;
  title: string;
  artist: string;
  album: string;
  artworkUrl: string | null;
  durationMs: number | null;
  startedAt: number;
  playing: boolean;
  /** Their room code, when they host one and their own switch allows it. */
  room: string | null;
  at: number;
}

/** One box in the panel (§3). */
export interface FriendRow {
  code: string;
  /** What YOU called them. Local, and never sent anywhere. */
  name: string;
  /** What they call themselves, when they are online. */
  theirName: string;
  online: boolean;
  /** Have they added you back? Until they do, there is nothing to show (§3, mutual add). */
  allowed: boolean;
  presence: FriendPresence | null;
}

export interface FriendsState {
  /** Your own code. Empty until the first mint. */
  me: string;
  /** Is your own socket up? False means nobody can see you right now. */
  connected: boolean;
  /** Is *Share what I play* on, and not inside the hour's pause? */
  sharing: boolean;
  rows: FriendRow[];
}

const OFF: FriendsState = { me: "", connected: false, sharing: false, rows: [] };
let state: FriendsState = { ...OFF };

const listeners = new Set<(s: FriendsState) => void>();
export function onFriendsChange(cb: (s: FriendsState) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export const friendsState = (): FriendsState => state;

function emit(): void {
  state = { ...state, rows: rowsNow() };
  for (const cb of listeners) cb(state);
}

// ── settings ─────────────────────────────────────────────────────────────────

const baseUrl = (): string => (setting("friendsUrl") || FRIENDS_URL_DEFAULT).trim().replace(/\/+$/, "");
const socketUrl = (of: string, as: "home" | "watch"): string =>
  `${baseUrl().replace(/^http/, "ws")}/f/${of}/ws?as=${as}&me=${state.me}`;

/** Off, or inside the hour's pause: the two ways to be silent (§8.5.1, D11). The pause is a
 *  rule since 2026-09-26 (RULES.md §13): while it runs, the effective switch reads off. */
const sharing = (): boolean => effective("shareActivityApp");

// ── one connection ───────────────────────────────────────────────────────────

/**
 * A socket and everything it needs to come back. One of these per friend, plus one for
 * your own home socket, and each owns exactly one timer — which is what §5.1 rule 7 means
 * by "never a reconnect storm".
 */
interface Link {
  of: string;
  role: "home" | "watch";
  ws: WebSocket | null;
  ready: boolean;
  attempt: number;
  timer?: number;
  /** What this friend's row shows. Held here so a reconnect does not blank the row. */
  presence: FriendPresence | null;
  theirName: string;
  /** False after a `denied`: they have not added you back. */
  allowed: boolean;
}

const links = new Map<string, Link>();
const homeKey = "\0home";

function rowsNow(): FriendRow[] {
  return listCache.map((f) => {
    const link = links.get(f.code);
    return {
      code: f.code,
      name: f.name,
      theirName: link?.theirName ?? "",
      online: !!link?.ready && !!link?.allowed,
      allowed: link?.allowed ?? true,
      presence: link?.presence ?? null,
    };
  });
}

function connect(of: string, role: "home" | "watch"): void {
  if (!state.me) return;
  const key = role === "home" ? homeKey : of;
  let link = links.get(key);
  if (!link) {
    link = { of, role, ws: null, ready: false, attempt: 0, presence: null, theirName: "", allowed: true };
    links.set(key, link);
  }
  window.clearTimeout(link.timer);
  link.timer = undefined;
  // Supersede rather than stack. The old socket's own close handler is what schedules a
  // retry, so it is disarmed here before the new one exists (the lesson of ROOMS.md §18.3).
  const previous = link.ws;
  link.ws = null;
  link.ready = false;
  try {
    previous?.close(1000, "superseded");
  } catch {
    /* already gone */
  }

  let ws: WebSocket;
  try {
    ws = new WebSocket(socketUrl(of, role));
  } catch (e) {
    diag.warn("friends:socket", { of, role, e: String(e) });
    return retry(link);
  }
  link.ws = ws;

  ws.addEventListener("message", (event) => {
    if (link.ws !== ws) return; // a superseded socket may not speak (ROOMS.md §18.3)
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    void handle(link, ws, message);
  });

  ws.addEventListener("close", (event) => {
    if (link.ws !== ws) return; // a superseded close must not null the LIVE socket
    link.ws = null;
    link.ready = false;
    // 1008 is the worker refusing us — a bad signature, or a key that is not this code.
    // Retrying that is a loop that can never succeed, so it stops and says so once.
    if (event.code === 1008) {
      diag.warn("friends:refused", { of: link.of, role: link.role, why: event.reason });
      link.allowed = false;
      return emit();
    }
    emit();
    retry(link);
  });

  ws.addEventListener("error", () => {
    if (link.ws === ws) diag.warn("friends:error", { of: link.of, role: link.role });
  });
}

function retry(link: Link): void {
  window.clearTimeout(link.timer);
  const wait = BACKOFF_MS[Math.min(link.attempt, BACKOFF_MS.length - 1)];
  link.attempt++;
  // Only the HOME socket's failure is worth a sentence: it is the one that means "nobody
  // can see you". One friend's socket failing is that friend's row going quiet, which the
  // row already shows.
  if (link.role === "home" && link.attempt === 3) busy(SERVICE, "gone");
  link.timer = window.setTimeout(() => connect(link.of, link.role), wait);
}

async function handle(link: Link, ws: WebSocket, message: Record<string, unknown>): Promise<void> {
  switch (message.t) {
    case "hello": {
      const minV = Number(message.minV ?? 1);
      if (PROTOCOL_V < minV) {
        link.allowed = false;
        toast({ kind: "warn", text: "Update DeetsMusic to use Friends.", sticky: true });
        try {
          ws.close(1000, "old app");
        } catch {
          /* already gone */
        }
        return;
      }
      // The proof. The key never leaves Rust: what comes back is a signature over the
      // worker's own nonce (friends.rs::friend_sign).
      const nonce = String(message.nonce ?? "");
      const me = await invoke<{ code: string; publicKey: string }>("friend_me");
      const sig = await invoke<string>("friend_sign", { nonce });
      if (link.ws !== ws) return;
      send(ws, {
        t: "auth",
        pub: me.publicKey,
        sig,
        name: roomName() || "Listener",
        // `keys`: the pinned keys, so the worker also refuses a watcher under a friend's
        // code with another key (§19). An old worker ignores the field.
        ...(link.role === "home" ? { friends: listCache.map((f) => f.code), keys: pinsForWorker(listCache) } : {}),
      });
      return;
    }
    case "ready": {
      link.ready = true;
      link.attempt = 0;
      link.allowed = true;
      if (link.role === "home") {
        state = { ...state, connected: true };
        busyOver(SERVICE);
        diag.log("friends:home", { friends: listCache.length });
        // The first push is the current song, so a friend who is already watching does
        // not wait for the next one.
        push("connected", true);
      }
      return emit();
    }
    case "presence": {
      // A song under this friend's code from a key that is not theirs is dropped, and the
      // row shows nothing rather than what a stranger chose to show (§19).
      if (!trusted(link.of, message.key, "presence")) {
        link.presence = null;
        return emit();
      }
      link.allowed = true;
      link.theirName = String(message.name ?? "");
      link.presence = (message.presence as FriendPresence | null) ?? null;
      return emit();
    }
    case "offline": {
      link.presence = null;
      return emit();
    }
    case "denied": {
      // They have not added you back. It is not an error and gets no toast — the row
      // says "Waiting for them to add you", which is the honest and actionable version.
      link.allowed = false;
      link.presence = null;
      return emit();
    }
    // Somebody pressed Listen Along on your row (§7.3). Your own switch answers it; this
    // is the one place a friend's action reaches your app.
    case "ask": {
      const from = String(message.from ?? "");
      if (!trusted(from, message.key, "ask")) return; // never a room for a stranger (§19)
      return answerListenAlong(from, String(message.name ?? "a friend"));
    }
    // Their answer, or a host inviting you by name (§7.1). Both carry a room code.
    case "answer":
    case "invite":
      if (!trusted(link.of, message.key, String(message.t))) return;
      return arriveAtRoom(message);
    case "error":
      diag.warn("friends:worker", { why: String(message.why ?? "") });
      return;
    default:
      return;
  }
}

function send(ws: WebSocket | null, message: Record<string, unknown>): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(message));
  } catch {
    /* already gone */
  }
}

const home = (): Link | undefined => links.get(homeKey);

// ── what you are playing ─────────────────────────────────────────────────────

let player: PlayerState = { playing: false, repeat: "off", shuffle: false };
/** The song's length lives on the progress bus, not the state bus (player.ts). */
let progress: PlayerProgress = { progress: 0, currentTime: 0, duration: 0 };
let lastKey = "";
let lastSentAt = 0;
let trailing: number | undefined;
let sleepTimer: number | undefined;
let asleep = false;

const keyOf = (s: PlayerState): string =>
  s.station ? `station:${s.station.id}` : `${s.title ?? ""}|${s.artist ?? ""}|${s.album ?? ""}`;

/** The window cannot be seen: minimized, or hidden to the tray. `ambient.ts` already
 *  answers this question for the skins' loops, so the answer is read, not asked again. */
const windowAsleep = (): boolean => document.documentElement.dataset.ambient === "paused";

/** What your friends see. Null is a real value: it is "here, and playing nothing". */
function mine(): Record<string, unknown> | null {
  const title = player.title ?? player.station?.name;
  if (!title) return null;
  const room = roomState();
  return {
    catalogId: queue.getCurrent()?.catalogId ?? null,
    title,
    artist: player.artist ?? player.station?.name ?? "",
    album: player.album ?? "",
    artworkUrl: player.artworkUrl ?? null,
    durationMs: player.station?.live ? null : Math.round(progress.duration * 1000) || null,
    // Where the song really began, so a friend's row can say "2 minutes in" rather than
    // "just now" for a song you are half way through.
    startedAt: Date.now() - Math.max(0, progress.currentTime) * 1000,
    playing: player.playing,
    // The room code is the only thing here that carries power, so it rides the same
    // switch the Discord button does — hosting alone is not consent to publish the code.
    room: room.isHost && room.code && effective("friendsRoomInvite") ? room.code : null,
  };
}

function sendNow(why: string): void {
  const link = home();
  if (!link?.ready) return;
  lastSentAt = Date.now();
  const presence = asleep ? null : mine();
  lastKey = presence ? keyOf(player) : "";
  send(link.ws, { t: "presence", presence, name: roomName() || "Listener" });
  diag.log("friends:push", { why, song: presence ? String(presence.title) : null });
}

/** Send, or schedule the trailing edge. §5.1 rule 2. */
function push(why: string, now = false): void {
  if (!sharing()) return;
  window.clearTimeout(trailing);
  const wait = now ? 0 : COALESCE_MS - (Date.now() - lastSentAt);
  if (wait <= 0) return sendNow(why);
  trailing = window.setTimeout(() => sendNow(`${why}+coalesced`), wait);
}

/** Sharing went off, or the hour's pause began: one empty presence and the socket goes. */
function stopSharing(why: string): void {
  window.clearTimeout(trailing);
  const link = home();
  if (link?.ready) send(link.ws, { t: "presence", presence: null });
  diag.log("friends:sharing-off", { why });
  closeLink(homeKey);
  state = { ...state, connected: false, sharing: false };
  emit();
}

function closeLink(key: string): void {
  const link = links.get(key);
  if (!link) return;
  window.clearTimeout(link.timer);
  const ws = link.ws;
  link.ws = null;
  link.ready = false;
  links.delete(key);
  try {
    ws?.close(1000, "done");
  } catch {
    /* already gone */
  }
}

// ── Listen Along (§7, his design 2026-09-20) ─────────────────────────────────

/** Who asked, so their answer can be matched when the room is ready. */
let asking: { code: string; at: number } | null = null;

/**
 * Press Listen Along on a friend's box. Two roads, and the friend's app picks:
 *   - they host a room already → they send that code back, and you join it AS IT IS,
 *     with whatever guest controls they chose when they started it;
 *   - they host none → their app starts one with host-only controls and sends that.
 */
export function listenAlong(code: string): void {
  const link = links.get(code);
  if (!link?.ready) {
    toast({ kind: "info", text: "They are not online right now." });
    return;
  }
  asking = { code, at: Date.now() };
  send(link.ws, { t: "ask", kind: "listen" });
  diag.log("friends:ask", { of: code });
  toast({ kind: "info", text: "Asking to listen along…" });
}

/**
 * Somebody pressed Listen Along on you. Their app gets a room code or a reason, and you
 * get one toast that says it happened — no prompt to answer (his call, 2026-09-20:
 * silent means uninterrupted, not invisible, and the member list still shows them).
 */
async function answerListenAlong(from: string, theirName: string): Promise<void> {
  const link = home();
  if (!link?.ready) return;
  const friend = listCache.find((f) => f.code === from);
  const name = friend?.name || theirName;

  if (!effective("friendsListenAlong")) {
    send(link.ws, { t: "answer", to: from, room: null, why: "off" });
    diag.log("friends:listen-refused", { from, why: "off" });
    return;
  }

  try {
    // Already hosting: hand over the room you have. Starting a second one would move you
    // out of the room your other friends are already in.
    if (roomState().isHost && roomState().code) {
      send(link.ws, { t: "answer", to: from, room: roomState().code });
    } else if (inRoom()) {
      // A guest in somebody else's room cannot hand it out — the code is the host's to
      // give, and a guest passing it on is exactly the door §8.5.3 refuses to open.
      send(link.ws, { t: "answer", to: from, room: null, why: "guest" });
      diag.log("friends:listen-refused", { from, why: "guest" });
      return;
    } else {
      // A room made for listening along is a room nobody can steer but you (his design):
      // every guest control on "host", so the person who pressed the button simply hears
      // what you hear.
      const locked: GuestControls = { playPause: "host", skip: "host", seek: "host", add: "host", changeQueue: "host" };
      // `keepPlaying`: the room starts from where you are, and your music never stops (his
      // call, 2026-09-26 — it used to pause you at 0:00 and wait for Play).
      await startRoom(locked, { keepPlaying: true });
      if (!roomState().code) {
        send(link.ws, { t: "answer", to: from, room: null, why: "failed" });
        return;
      }
      send(link.ws, { t: "answer", to: from, room: roomState().code });
    }
    diag.log("friends:listen-allowed", { from });
    toast({ kind: "info", text: `${name} is listening along.` });
  } catch (e) {
    diag.warn("friends:listen-failed", { from, e: String(e) });
    send(link.ws, { t: "answer", to: from, room: null, why: "failed" });
  }
}

/** Their answer arrived, or a host invited you by name (§7.1). */
function arriveAtRoom(message: Record<string, unknown>): void {
  const from = String(message.from ?? "");
  const room = message.room ? String(message.room) : "";
  const friend = listCache.find((f) => f.code === from);
  const name = friend?.name || String(message.name ?? "A friend");

  if (message.t === "answer") {
    // Only an answer we asked for, and only for a minute. An unasked "answer" is either
    // a very late reply or somebody being clever; neither should move your player.
    if (!asking || asking.code !== from || Date.now() - asking.at > 60_000) {
      diag.warn("friends:answer-unasked", { from });
      return;
    }
    asking = null;
    if (!room) {
      const why = String(message.why ?? "no");
      toast({
        kind: "info",
        text:
          why === "guest"
            ? `${name} is in somebody else's room, so there is nothing to join yet.`
            : `${name} is not letting people listen along right now.`,
      });
      return;
    }
    diag.log("friends:listen-joining", { from });
    void joinRoom(room);
    return;
  }

  // An INVITE is not something you asked for, so it asks before it moves anything — the
  // rule the `deetsmusic://room?code=…` link already follows (rooms.rs).
  if (!room) return;
  toast({
    kind: "info",
    sticky: true,
    text: `${name} asked you to listen along.`,
    actions: [
      { label: "Join", run: () => void joinRoom(room) },
      { label: "Not now" },
    ],
  });
}

/** The host's panel: invite a friend by name, so nothing is pasted (§7.1). */
export function inviteToRoom(code: string): void {
  const link = home();
  const room = roomState();
  if (!link?.ready || !room.isHost || !room.code) return;
  send(link.ws, { t: "invite", to: code, room: room.code });
  diag.log("friends:invite", { to: code });
  const friend = listCache.find((f) => f.code === code);
  toast({ kind: "info", text: `Asked ${friend?.name || "them"} to listen along.` });
}

// ── the list ─────────────────────────────────────────────────────────────────

interface StoredFriend {
  code: string;
  name: string;
  addedAt: number;
  /** Their full public key, pinned on first sight (friends.rs::friend_pin, §19). */
  key?: string;
}
let listCache: StoredFriend[] = [];

// ── the key pin (FRIENDS.md §19, 2026-09-29) ─────────────────────────────────

/** Codes already warned about this launch: one toast per friend, never one per message. */
const keyWarned = new Set<string>();

/**
 * May a message under `code` that carries `key` be acted on? The first key seen is pinned
 * (in memory at once, on disk in the background); a different key after that is dropped.
 * A code that is not on your list is left to the rules that already guard it.
 */
function trusted(code: string, key: unknown, where: string): boolean {
  const friend = listCache.find((f) => f.code === code);
  if (!friend) return true;
  const verdict = judgeKey(friend.key, key);
  if (verdict === "legacy" || verdict === "trust") return true;
  if (verdict === "pin") {
    friend.key = String(key).trim();
    void pinKey(friend, friend.key);
    return true;
  }
  keyChanged(friend, where);
  return false;
}

async function pinKey(friend: StoredFriend, key: string): Promise<void> {
  try {
    const answer = await invoke<string>("friend_pin", { code: friend.code, key });
    if (answer === "changed") {
      // The file held another key than the cache: the file wins, and this one is not trusted.
      friend.key = undefined;
      await reloadList();
      keyChanged(friend, "pin");
      return;
    }
    diag.log("friends:key-pinned", { of: friend.code, answer });
    // The worker learns the pin too, so it refuses a watcher under this code with another key.
    const link = home();
    if (answer === "pinned" && link?.ready) {
      send(link.ws, { t: "friends", list: listCache.map((f) => f.code), keys: pinsForWorker(listCache) });
    }
  } catch (e) {
    // A key that does not hash to the code: the worker should never send one. Unpin it.
    if (friend.key === key) friend.key = undefined;
    diag.warn("friends:key-pin-failed", { of: friend.code, e: String(e) });
  }
}

function keyChanged(friend: StoredFriend, where: string): void {
  if (keyWarned.has(friend.code)) return;
  keyWarned.add(friend.code);
  diag.warn("friends:key-changed", { of: friend.code, where });
  const name = friend.name || "a friend";
  toast({
    kind: "warn",
    sticky: true,
    text: `A different key is using ${name}'s friend code, so DeetsMusic ignores it. If you know ${name} changed keys, remove ${name} and add them again.`,
  });
}

async function reloadList(): Promise<void> {
  listCache = await invoke<StoredFriend[]>("friend_list");
  // A friend who was removed loses their socket; one who was added gets one.
  for (const key of [...links.keys()]) {
    if (key !== homeKey && !listCache.some((f) => f.code === key)) closeLink(key);
  }
  if (state.me) {
    for (const f of listCache) if (!links.has(f.code)) connect(f.code, "watch");
  }
  // The home socket carries the list, so the worker can tell who may watch you.
  const link = home();
  if (link?.ready) send(link.ws, { t: "friends", list: listCache.map((f) => f.code), keys: pinsForWorker(listCache) });
  emit();
}

/**
 * Add a code to your list. `said` replaces the toast: a room member who already added you
 * (FRIENDS.md §18) is not "waiting", so the room's path passes its own sentence, or null
 * for none.
 */
export async function addFriend(code: string, name: string, said?: string | null): Promise<boolean> {
  try {
    await ensureIdentity(); // adding somebody is the clearest "I want a friend code"
    await invoke("friend_add", { code, name });
    await reloadList();
    const text = said === undefined ? `${name || "They"} will appear here once they add you back.` : said;
    if (text) toast({ kind: "info", text });
    return true;
  } catch (e) {
    friendFailed("add", e, "Couldn't add that friend. Try again.");
    return false;
  }
}

export async function renameFriend(code: string, name: string): Promise<void> {
  await invoke("friend_rename", { code, name }).catch((e) => friendFailed("rename", e, "Couldn't rename that friend. Try again."));
  await reloadList();
}

export async function removeFriend(code: string): Promise<void> {
  await invoke("friend_remove", { code }).catch((e) => friendFailed("remove", e, "Couldn't remove that friend. Try again."));
  keyWarned.delete(code); // removing drops the pin (§19), so a later change warns again
  await reloadList();
}

/** §2a, *Copy my key*. The caller shows the warning that the key IS you. */
export const exportKey = (): Promise<string> => invoke<string>("friend_key_export");

/** §2a, *Paste a key*. It replaces this PC's identity, so every socket restarts. */
export async function importKey(key: string): Promise<boolean> {
  try {
    const me = await invoke<{ code: string }>("friend_key_import", { keyB64: key });
    for (const key of [...links.keys()]) closeLink(key);
    state = { ...state, me: me.code, connected: false };
    await reloadList();
    if (sharing()) connect(state.me, "home");
    toast({ kind: "info", text: `Your friend code is now ${formatFriendCode(me.code)}.` });
    return true;
  } catch (e) {
    friendFailed("importKey", e, "Couldn't use that key. Your friend code did not change.");
    return false;
  }
}

/** `K7QM-4XHT`, the form the panel shows — the room code's shape (ROOMS.md §6). */
export const formatFriendCode = (code: string): string =>
  code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

/** The invite link, the road `deetsmusic://room?code=…` already travels (§3, fork 2C). */
export const friendInviteLink = (): string => `deetsmusic://friend?code=${state.me}`;

// ── start ────────────────────────────────────────────────────────────────────

/**
 * Mint the key if this PC has none, and bring the sockets up. Called when Friends is
 * actually wanted: the panel opening, adding somebody, or a launch that already has
 * friends or sharing on.
 *
 * **It is deliberately NOT called on every launch.** Minting is lazy in Rust so that a
 * person who never opens Friends never has an identity, and a startup that asked for the
 * code would quietly undo that.
 */
export async function ensureIdentity(): Promise<void> {
  if (state.me) return;
  try {
    const me = await invoke<{ code: string }>("friend_me");
    state = { ...state, me: me.code, sharing: sharing() };
  } catch (e) {
    diag.warn("friends:no-key", { e: String(e) });
    return;
  }
  await reloadList();
  if (sharing()) connect(state.me, "home");
}

export async function initFriends(): Promise<void> {
  // The list needs no key, so it is read first — and it is what decides whether this
  // launch wants an identity at all.
  await reloadList();
  state = { ...state, sharing: sharing() };
  if (listCache.length || sharing()) await ensureIdentity();

  onPlayerProgress((p) => {
    progress = p;
  });

  onPlayerState((s) => {
    const was = player;
    player = s;
    if (!sharing()) return;

    if (s.playing) {
      // Awake again: cancel the sleep and say what is playing.
      window.clearTimeout(sleepTimer);
      sleepTimer = undefined;
      if (asleep) {
        asleep = false;
        return push("awake", true);
      }
      if (keyOf(s) === lastKey) return; // a re-render is not a change
      return push("song");
    }

    // §5.1 rule 3. Hidden and paused is somebody who walked away; it sends ONE "stopped"
    // and then nothing at all until something plays.
    if (was.playing && sleepTimer === undefined) {
      diag.log("friends:sleep-arm", { ms: SLEEP_MS });
      sleepTimer = window.setTimeout(() => {
        sleepTimer = undefined;
        if (!windowAsleep()) return;
        asleep = true;
        diag.log("friends:sleep", {});
        sendNow("asleep");
      }, SLEEP_MS);
    }
  });

  // The switches. Off and the hour's pause both take the home socket down at once; back
  // on puts it up without waiting for the next song.
  let wasSharing = sharing();
  onSettingsChange(() => {
    const now = sharing();
    state = { ...state, sharing: now };
    if (now === wasSharing) return emit();
    wasSharing = now;
    // Switching sharing on is a reason to have an identity, so this is one of the three
    // doors that mints one.
    if (now) void ensureIdentity().then(() => connect(state.me, "home"));
    else stopSharing(ownSetting("shareActivityApp") ? "paused for an hour" : "sharing off");
  });

  // Hosting started or ended: the room code in your presence follows the room, and it
  // must GO the moment the room does — a dead code on a friend's row joins nothing.
  let wasHosting = roomState().isHost && !!roomState().code;
  onRoomHostChange((hosting) => {
    if (hosting === wasHosting) return;
    wasHosting = hosting;
    if (sharing()) push("room", true);
  });
  // The invite switch, by hand or by a rule (Focus): the code goes or comes at once, for the
  // same reason, not at the next song.
  let wasInvite = effective("friendsRoomInvite");
  onSettingsChange((k) => {
    if (k !== "friendsRoomInvite" || effective(k) === wasInvite) return;
    wasInvite = effective(k);
    if (sharing() && wasHosting) push("roomInvite", true);
  });

  // A `deetsmusic://friend?code=…` link. It fills the panel's field; the person presses
  // Add. Nothing is added by a link (friends.rs::handle_link).
  void listen<string>("friend-invite", (event) => {
    pendingInvite = event.payload;
    for (const cb of inviteListeners) cb(event.payload);
  });

  // An hour's pause ends by itself. One timer, and it only ever writes when a pause ran.
  window.setInterval(() => {
    const until = setting("sharePauseUntil") || 0;
    if (until && Date.now() >= until) setSetting("sharePauseUntil", 0);
  }, 30_000);
}

/** The room module has no "am I hosting" event of its own, so this is the small one. */
function onRoomHostChange(cb: (hosting: boolean) => void): void {
  void import("./room").then(({ onRoomChange }) => {
    onRoomChange((r) => cb(r.isHost && !!r.code));
  });
}

/** A code that arrived by link while the panel was shut, so it is there when it opens. */
let pendingInvite = "";
const inviteListeners = new Set<(code: string) => void>();
export function takePendingInvite(): string {
  const code = pendingInvite;
  pendingInvite = "";
  return code;
}
export function onFriendInvite(cb: (code: string) => void): () => void {
  inviteListeners.add(cb);
  return () => inviteListeners.delete(cb);
}

/** Exported for the panel's "they can't steer it" line, so the shape lives in one place. */
export const LISTEN_ALONG_CONTROLS: GuestControls = {
  ...DEFAULT_CONTROLS,
  playPause: "host",
  skip: "host",
  seek: "host",
  add: "host",
  changeQueue: "host",
};

/** The busy toast's other caller: a fetch that failed with a status we can read. */
export function friendsBusy(status: number | null): void {
  busy(SERVICE, causeOf(status));
}
