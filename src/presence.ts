// Discord Rich Presence — what the card says, and when (docs/FRIENDS.md §8).
//
// Your Discord profile reads "Listening to DeetsMusic", with the song, the artist, the
// album, the cover and a progress bar under it — the shape §8.4a measured against the real
// client on 2026-09-20. The pipe itself is `src-tauri/src/presence.rs`; this file is the
// policy, and it lives here because the switches that decide it live here.
//
// **Private by default** (§8.5.3). `shareActivityDiscord` starts Off, and while it is Off
// this module calls nothing at all — so the pipe is never opened, and Discord is never told
// the app is running. *Pause sharing for an hour* is the same silence with a clock on it.
//
// The lifecycle table is §8.9, and it is the whole feature: what your profile says about
// you right now is visible to other people, so a wrong answer is not a cosmetic bug.

import { invoke } from "@tauri-apps/api/core";
import { onPlayerState, onPlayerProgress, type PlayerState, type PlayerProgress } from "./player";
import { setting, onSettingsChange } from "./settings-store";
import { onRoomChange, roomState } from "./room";
import * as queue from "./queue";
import * as diag from "./diag";

/** Discord rate-limits RPC updates (about five in twenty seconds). A settled song change
 *  fires at once — nobody changes song twice in four seconds on purpose — and a run of
 *  skips coalesces into one update on the trailing edge (§8.9). */
const MIN_GAP_MS = 4000;
/** How long a pause may last before the card comes down (B1, D15). A doorbell should not
 *  blank your profile and bring it back; a walk away is no longer true. */
const PAUSE_CLEAR_MS = 60_000;

/** Discord's own caps. A longer string is refused, so it is cut here instead. */
const CAP = 128;
const cut = (s: string, n = CAP) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Apple's artwork URLs end in `<w>x<h>bb.jpg`; the card draws a square, so ask for 512.
 *  Discord's media proxy fetches it itself — no upload, no extra Apple call (§8.4a). */
const bigArt = (url?: string): string | undefined =>
  url ? url.replace(/\/\d+x\d+bb\.jpg$/, "/512x512bb.jpg") : undefined;

let state: PlayerState = { playing: false, repeat: "off", shuffle: false };
let progress: PlayerProgress = { progress: 0, currentTime: 0, duration: 0 };

let lastSentAt = 0;
let lastKey = ""; // the song identity last SENT, so a re-render never re-sends
let showing = false; // a card is up (or Discord is absent and we think one is)
let trailing: number | undefined; // the coalescer's trailing-edge timer
let pauseTimer: number | undefined; // the clear-after-a-pause timer

/** Off, or paused for an hour: the two ways to be silent (§8.5.1). */
const paused = (): boolean => Date.now() < (setting("sharePauseUntil") || 0);
const sharing = (): boolean => setting("shareActivityDiscord") && !paused();

/** The song identity — a card is re-sent when THIS changes, not when a render happens. */
const keyOf = (s: PlayerState): string =>
  s.station ? `station:${s.station.id}` : `${s.title ?? ""}|${s.artist ?? ""}|${s.album ?? ""}`;

/** The Apple Music link for the song on now, or nothing for a station or an upload. */
function link(): string | undefined {
  const id = currentCatalogId();
  return id ? `https://music.apple.com/song/${id}` : undefined;
}

/** The catalog id of what plays, taken the way the now-playing bus takes it (np-bus.ts):
 *  the queue's current entry, which carries it even before MusicKit reports the item. */
const currentCatalogId = (): string | undefined => queue.getCurrent()?.catalogId ?? undefined;

/** The activity, whole (§8.7.1). Null when there is nothing to show. */
function activity(): Record<string, unknown> | null {
  const title = state.title ?? state.station?.name;
  if (!title) return null;
  const url = link();
  const live = !!state.station?.live;
  const act: Record<string, unknown> = {
    // Measured 2026-09-20 (§8.4a): type 2 reads "Listening to". `status_display_type` is
    // KEPT by Discord and ignored by today's client — it is sent because it costs nothing
    // and a later client may put the song on the headline, which is what it asks for.
    type: 2,
    status_display_type: 2,
    details: cut(title),
    state: cut(state.artist ?? state.station?.name ?? "DeetsMusic"),
  };
  // Three text lines on a Listening card: details, state, then large_text — so the album
  // is the third line, not a tooltip (§8.4a).
  const art = bigArt(state.artworkUrl);
  if (art) act.assets = { large_image: art, large_text: cut(state.album ?? title) };
  // The progress bar. A live station has no length, so it gets none rather than a bar
  // that lies; a paused song keeps the bar it had, because we do not re-send on a pause.
  if (!live && progress.duration > 0 && state.playing) {
    const start = Date.now() - Math.max(0, progress.currentTime) * 1000;
    act.timestamps = { start: Math.round(start), end: Math.round(start + progress.duration * 1000) };
  }
  if (url) {
    // The text itself becomes the link, which spends no button slot (§8.7.1).
    act.details_url = url;
    act.state_url = url;
  }
  const buttons: { label: string; url: string }[] = [];
  if (url) buttons.push({ label: "Play on Apple Music", url });
  // Listen Along carries the room CODE, and the code is the only gate on the room — so it
  // rides its own switch, not the fact of hosting (§8.5.3).
  const room = roomState();
  if (room.isHost && room.code && setting("discordRoomInvite")) {
    buttons.push({ label: "Listen Along", url: `https://rooms.deets.solutions/j/${room.code}` });
  }
  if (buttons.length) act.buttons = buttons;
  return act;
}

function sendNow(reason: string): void {
  const act = activity();
  if (!act) return;
  lastSentAt = Date.now();
  lastKey = keyOf(state);
  void invoke<boolean>("presence_set", { activity: act })
    .then((sent) => {
      showing = sent;
      // `sent: false` is Discord not running — the ordinary state of most PCs, and not an
      // error (§8.9). It is logged once per change, never retried in a loop.
      diag.log("presence:set", { why: reason, song: act.details, sent });
    })
    .catch((e) => console.error("[presence] set", e));
}

/** Send, or schedule the trailing edge when Discord's rate limit is close. */
function push(reason: string): void {
  if (!sharing()) return;
  window.clearTimeout(trailing);
  const wait = MIN_GAP_MS - (Date.now() - lastSentAt);
  if (wait <= 0) return sendNow(reason);
  trailing = window.setTimeout(() => sendNow(`${reason}+coalesced`), wait);
}

function clearCard(why: string): void {
  window.clearTimeout(trailing);
  window.clearTimeout(pauseTimer);
  pauseTimer = undefined;
  lastKey = "";
  if (!showing) return;
  showing = false;
  diag.log("presence:clear", { why });
  void invoke("presence_clear").catch((e) => console.error("[presence] clear", e));
}

/** Sharing went off, or the hour's pause started: close the pipe outright, at once. A
 *  privacy switch that takes a minute to take effect is not a privacy switch (§8.9). */
function stop(why: string): void {
  window.clearTimeout(trailing);
  window.clearTimeout(pauseTimer);
  pauseTimer = undefined;
  lastKey = "";
  showing = false;
  diag.log("presence:off", { why });
  void invoke("presence_close").catch((e) => console.error("[presence] close", e));
}

export function initPresence(): void {
  onPlayerState((s) => {
    const was = state;
    state = s;
    if (!sharing()) return;
    const key = keyOf(s);

    if (!s.playing) {
      // A pause holds the card for about a minute, then takes it down (B1). The arm, the
      // fire and the cancel are all logged — CLAUDE.md checklist item 6.
      if (was.playing && pauseTimer === undefined) {
        diag.log("presence:pause-arm", { ms: PAUSE_CLEAR_MS });
        pauseTimer = window.setTimeout(() => {
          pauseTimer = undefined;
          clearCard("paused");
        }, PAUSE_CLEAR_MS);
      }
      return;
    }

    // Playing again inside the minute: nothing was cleared, so nothing is re-sent — the
    // quiet case §8.9 names, and the reason a pause does not blank the profile.
    if (pauseTimer !== undefined) {
      window.clearTimeout(pauseTimer);
      pauseTimer = undefined;
      diag.log("presence:pause-cancel", {});
      if (key === lastKey && showing) return;
    }
    if (key === lastKey && showing) return; // a re-render is not a change
    push("song");
  });

  onPlayerProgress((p) => {
    progress = p;
  });

  // The switches. Off and the hour's pause both close the pipe at once; switching back on
  // puts the card up again without waiting for the next song.
  let wasSharing = sharing();
  let wasInvite = setting("discordRoomInvite");
  onSettingsChange(() => {
    const now = sharing();
    const invite = setting("discordRoomInvite");
    if (now !== wasSharing) {
      wasSharing = now;
      if (!now) stop(setting("shareActivityDiscord") ? "paused for an hour" : "sharing off");
      else if (state.playing) push("sharing on");
    } else if (now && invite !== wasInvite) {
      // The invite button appears or goes while the same song plays.
      push("invite switch");
    }
    wasInvite = invite;
  });

  // Hosting started or ended: the Listen Along button follows the room, and it must GO the
  // moment the room does — a dead code in a profile is an invitation to nothing.
  let wasHosting = roomState().isHost && !!roomState().code;
  onRoomChange((r) => {
    const hosting = r.isHost && !!r.code;
    if (hosting !== wasHosting) {
      wasHosting = hosting;
      if (sharing() && setting("discordRoomInvite") && state.playing) push("room");
    }
  });

  // Quitting: the pipe closing would drop the card anyway, so this is belt and braces for
  // the case where the window goes but the process lingers (§8.9).
  window.addEventListener("beforeunload", () => {
    if (showing) void invoke("presence_close").catch(() => {});
  });

  // An hour's pause ends by itself. One timer, armed only while a pause runs.
  window.setInterval(() => {
    const until = setting("sharePauseUntil") || 0;
    if (!until || Date.now() < until) return;
    setPauseOver();
  }, 30_000);
}

/** The pause ran out: clear the key so the rows read "on" again, and put the card back. */
function setPauseOver(): void {
  // Written through the store so every card's row repaints (settings-store.ts).
  void import("./settings-store").then(({ setSetting }) => {
    setSetting("sharePauseUntil", 0);
    if (sharing() && state.playing) push("pause over");
  });
}

/** Settings › Sharing: "Pause sharing for an hour" (D11 — it covers every sharing row). */
export function pauseSharingForAnHour(): void {
  void import("./settings-store").then(({ setSetting }) => {
    setSetting("sharePauseUntil", Date.now() + 60 * 60 * 1000);
  });
}

/** How long the pause has left, for the row's own label. Null when none runs. */
export function sharePauseLeft(): number | null {
  const until = setting("sharePauseUntil") || 0;
  return until > Date.now() ? until - Date.now() : null;
}
