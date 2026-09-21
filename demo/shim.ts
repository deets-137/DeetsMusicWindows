// The web demo's shim (docs/features/WEB-DEMO.md §2–3). It runs before the app's own
// main.ts and stands in for the two things a browser lacks:
//
//   - Tauri. `@tauri-apps/api` reaches Rust through one global, `window.__TAURI_INTERNALS__`
//     (invoke, the callback table, the window label). Defining that global here serves every
//     import — core, event, window, app, opener — with no alias and no change to `src/`.
//   - MusicKit. A fake with the same calls player.ts makes (musickit.ts).
//
// It also talks to the host page on deets.solutions when the app runs in its frame: a window
// resize becomes a frame resize, and a look change reaches the frame's box.
// Cross-origin network calls are refused, so the demo never reaches a live room or friend
// server.

import { handle, type Host } from "./handlers";
import { FakeMusicKit } from "./musickit";

type Cb = (payload: unknown) => void;

// ── The callback table (Tauri's transformCallback / runCallback) ──
const callbacks = new Map<number, Cb>();
let nextId = 1;
function transformCallback(cb?: Cb, once = false): number {
  const id = nextId++;
  callbacks.set(id, (p) => {
    if (once) callbacks.delete(id);
    cb?.(p);
  });
  return id;
}

// ── Events (the event plugin) ──
const listeners = new Map<string, Map<number, number>>(); // event → eventId → callback id
let nextEventId = 1;
function emitEvent(event: string, payload: unknown): void {
  const byId = listeners.get(event);
  if (!byId) return;
  for (const [eventId, cbId] of [...byId]) {
    const cb = callbacks.get(cbId);
    if (cb) queueMicrotask(() => cb({ event, id: eventId, payload }));
  }
}

// ── The host page (the frame on deets.solutions) ──
const framed = window.parent !== window;
function post(kind: string, data: Record<string, unknown> = {}): void {
  if (!framed) return;
  try {
    window.parent.postMessage({ type: "deets-demo", kind, ...data }, location.origin);
  } catch {
    /* no host */
  }
}
const host: Host = {
  resize: (w, h) => post("resize", { w, h }),
  minSize: (w, h) => post("min", { w, h }),
  emit: emitEvent,
  appearance: (p) => post("appearance", { look: p }),
};

const clone = <T>(v: T): T => (v === undefined || v === null ? v : (JSON.parse(JSON.stringify(v)) as T));

async function invoke(cmd: string, args: any = {}): Promise<unknown> {
  switch (cmd) {
    case "plugin:event|listen": {
      const eventId = nextEventId++;
      if (!listeners.has(args.event)) listeners.set(args.event, new Map());
      listeners.get(args.event)!.set(eventId, args.handler);
      return eventId;
    }
    case "plugin:event|unlisten":
      listeners.get(args.event)?.delete(args.eventId);
      return null;
    case "plugin:event|emit":
    case "plugin:event|emit_to":
      emitEvent(args.event, args.payload);
      return null;
  }
  return clone(await handle(cmd, args, host));
}

(window as any).__TAURI_INTERNALS__ = {
  invoke,
  transformCallback,
  unregisterCallback: (id: number) => callbacks.delete(id),
  runCallback: (id: number, data: unknown) => callbacks.get(id)?.(data),
  callbacks,
  convertFileSrc: (path: string) => path,
  metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
  plugins: { path: { sep: "/", delimiter: ":" } },
};
(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  unregisterListener: (event: string, eventId: number) => listeners.get(event)?.delete(eventId),
};

// ── MusicKit ──
(window as any).MusicKit = FakeMusicKit;
document.dispatchEvent(new Event("musickitloaded"));

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
