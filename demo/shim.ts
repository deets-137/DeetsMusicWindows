// The web demo's shim (docs/features/WEB-DEMO.md §2–3). It runs before the app's own
// main.ts and stands in for the two things a browser lacks:
//
//   - Tauri. The shared stand-in (web/tauri-shim.ts) defines the two globals that
//     `@tauri-apps/api` reads, and sends every command to the demo's handlers.
//   - MusicKit. A fake with the same calls player.ts makes (musickit.ts).
//
// It also talks to the host page on deets.solutions when the app runs in its frame: a window
// resize becomes a frame resize, and a look change reaches the frame's box.
// Cross-origin network calls are refused, so the demo never reaches a live room or friend
// server. Apple's covers and previews load as images and audio, not as fetches.

import { handle, queuedSong, type Host } from "./handlers";
import { FakeMusicKit, onNowPlaying, type NowPlaying } from "./musickit";
import { installTauri } from "../web/tauri-shim";
import { replayed } from "./latency";

// `replayed`: the owner's waits, only when the shots runner asks (latency.ts; LOADING-SET.md §3.3).
const tauri = installTauri((cmd, args) => replayed(cmd, () => handle(cmd, args, host)));

// ── The host page (the frame on deets.solutions) ──
const framed = window.parent !== window;
function post(kind: string, data: Record<string, unknown> = {}): void {
  // No frame: the shots runner (scripts/shots.mjs) may stand in as the host, so a clip can
  // follow the app's own window resizes (SHOTS.md §5c).
  if (!framed) return void (window as { __deetsDemoHost?: (kind: string, data: unknown) => void }).__deetsDemoHost?.(kind, data);
  try {
    window.parent.postMessage({ type: "deets-demo", kind, ...data }, location.origin);
  } catch {
    /* no host */
  }
}
const host: Host = {
  resize: (w, h) => post("resize", { w, h }),
  minSize: (w, h) => post("min", { w, h }),
  emit: (event, payload) => tauri.emit(event, payload),
  appearance: (p) => post("appearance", { look: p }),
};

// ── MusicKit ──
(window as any).MusicKit = FakeMusicKit;
document.dispatchEvent(new Event("musickitloaded"));

// The song now playing goes to the host page, which keeps Apple's "Listen on Apple Music"
// badge for that song beside the frame (WEB-DEMO.md §15.5): Apple's previews may be played
// only next to a store link.
// Before the first Play, the panel names the song the saved queue opens on.
const tellHost = (np: NowPlaying | null) =>
  post("nowplaying", { song: np && { title: np.title, artist: np.artist, album: np.album, playing: np.playing, url: `https://music.apple.com/song/${np.id}` } });
onNowPlaying(tellHost);
const opening = queuedSong();
if (opening) tellHost({ id: opening.catalogId!, title: opening.title, artist: opening.artistName, album: opening.albumName ?? "", playing: false });

// ── No live servers from a demo ──
const sameOrigin = (url: string): boolean => {
  try {
    const u = new URL(url, location.href);
    return u.protocol === "data:" || u.protocol === "blob:" || u.origin === location.origin;
  } catch {
    return false;
  }
};
const realFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!sameOrigin(url)) return Promise.reject(new TypeError("Failed to fetch"));
  return realFetch(input, init);
};
class OfflineSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 3;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  constructor(public url: string) {
    super();
    setTimeout(() => {
      const err = new Event("error");
      this.onerror?.(err);
      this.dispatchEvent(err);
      const close = new CloseEvent("close", { code: 1006 });
      this.onclose?.(close);
      this.dispatchEvent(close);
    }, 0);
  }
  send(): void {}
  close(): void {}
}
(window as any).WebSocket = OfflineSocket;

post("ready");
