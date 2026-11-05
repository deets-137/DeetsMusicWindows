/// <reference path="./env.d.ts" />
// Demo mode in the desktop app (docs/features/WEB-DEMO.md §17): the web demo's handlers and fake
// MusicKit, without its shim. Tauri's globals are read-only here, so src/ipc-core.ts sends each
// command to the function `startDemo` returns. Loaded only with the demo flag (demo-gate.ts).

import { openUrl } from "@tauri-apps/plugin-opener";
import { handle, queuedSong, type Host } from "./handlers";
import { FakeMusicKit, onNowPlaying } from "./musickit";
import { leaveDemo } from "../src/demo-gate";
import badgeUrl from "./listen-on-apple-music.svg?url";
import "./desktop.css";

type Invoke = (cmd: string, args?: any, options?: any) => Promise<any>;

/** What still reaches real Rust: the window, the tray, the log, system sound. Nothing here reads
 *  or writes the user's data, and every other command stays in the demo's handlers. */
const REAL = new Set([
  "main_ready", "main_minimize", "main_unsnap", "tray_place_main", "tray_pin_main", "tray_open_main",
  "tray_panel_hide", "tray_panel_resize", "np_publish", "appearance_publish", "agent_reply",
  "log_event", "diag_flush", "csp_blocked", "display_hz", "gpu_watch_adapters", "gpu_card_ready",
  "app_restart", "app_restart_quiet", "audio_output", "system_volume_get", "system_volume_set",
  "system_volume_mute", "win_media_transport", "win_media_seek", "win_media_now_playing",
]);

/** Two commands the handlers leave null, read here with no null check. */
const EMPTY: Record<string, unknown> = { filters_list: [], usage_health: { pending: null, library: null } };

/** The handlers' window calls are for the frame on the site. The real window needs none of them. */
const host: Host = { resize() {}, minSize() {}, emit() {}, appearance() {} };

const clone = <T>(v: T): T => (v === undefined || v === null ? v : (JSON.parse(JSON.stringify(v)) as T));

// ── Apple's badge, on the cover: a preview must sit near a store link (§15.1) ──
const SONG_URL = "https://music.apple.com/song/";
let songId: string | undefined = queuedSong()?.catalogId;

const badge = document.createElement("a");
badge.className = "demo-badge";
badge.href = "#";
badge.append(Object.assign(document.createElement("img"), { src: badgeUrl, alt: "Listen on Apple Music" }));
badge.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (songId) void openUrl(SONG_URL + songId);
});

/** The card remounts on a surface or layout change, so the badge is put back when it is gone. */
function placeBadge(): void {
  const art = document.getElementById("np-art");
  if (art && songId && badge.parentElement !== art) art.append(badge);
  else if (!songId) badge.remove();
}
const BADGE_CHECK_MS = 1000;

export function startDemo(real: Invoke): Invoke {
  // MusicKit's own script is still in index.html and may load after this: its write is dropped.
  Object.defineProperty(window, "MusicKit", { configurable: true, get: () => FakeMusicKit, set() {} });
  document.dispatchEvent(new Event("musickitloaded"));

  onNowPlaying((np) => {
    songId = np?.id ?? songId;
    placeBadge();
  });
  window.setInterval(placeBadge, BADGE_CHECK_MS);

  return async (cmd, args, options) => {
    if (cmd === "apple_disconnect") return leaveDemo();
    if (REAL.has(cmd)) return real(cmd, args, options);
    if (cmd in EMPTY) return clone(EMPTY[cmd]);
    return clone(await handle(cmd, args, host));
  };
}
