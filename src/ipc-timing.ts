// The command recorder: the round trip of every Tauri command, and the load time of every
// cover (docs/guide/LOADING-SET.md §3.1). Dev telemetry: everything here sits behind
// `TELEMETRY`, so a release carries none of it (release-check 5 fails a bundle that holds
// `__ipcTiming`).
//
// Every front-end command goes through `invoke` from @tauri-apps/api/core. In a telemetry build
// the `ipcTiming` plugin (vite.config.ts) points that import, for every file in src/, at
// ipc-core.ts, whose `invoke` calls `timed` here; no call site changes. Wrapping the global
// `window.__TAURI_INTERNALS__.invoke` cannot work: Tauri makes it read-only (2026-10-17).
//
// Per command: the COLD round trip (the first call of this page life) and the WARM ones (every
// later call). A round trip ends when the promise settles, resolve or reject. Every call also
// marks the page clock (`ipc:<cmd>:begin` / `:end`, marks.ts), so a strip names each wait.
//
// Covers: an `img[data-art]` (the marker artwork-heal.ts uses) from the network. Apple's server
// sends no `Timing-Allow-Origin`, so only the Resource Timing `duration` is there. A load under
// HIT_MS, or a load with no entry at all (the memory cache makes none), is a cache hit.
//
// The log gets one block every 5 minutes and on close, with only the values new since the last
// block; a command with no new calls writes nothing. `scripts/latency-profile.mjs` reads it:
//   INFO  diag: [perf] ipc+art 300 s
//       [perf] ipc playlists_cached cold 14 · warm 3,2,4,9,3
//       [perf] ipc apple_playlist_counts warm 210 · failed 1
//       [perf] art miss 212,340,95 · hits 41

import { TELEMETRY } from "./telemetry-on";
import { mark } from "./marks";

/** The newest warm values kept per command (and per block), and the newest cover misses. */
const RING = 50;
const ART_RING = 200;
/** A cover that loads faster than this came from the cache (LOADING-SET.md §3.1). */
const HIT_MS = 8;
/** A loaded cover with no Resource Timing entry after this long came from the memory cache. */
const ART_GRACE_MS = 1000;
const FLUSH_EVERY_MS = 5 * 60 * 1000;
/** Not timed: the log writes themselves (this module's own block is one), fire and forget. */
const SKIP = new Set(["diag_flush", "log_event"]);

type Cmd = {
  /** The first call's round trip; undefined until it settles. */
  cold?: number;
  coldLogged: boolean;
  /** The newest warm round trips, for the console handle. */
  warm: number[];
  /** Warm round trips since the last block (at most RING), and how many fell off. */
  fresh: number[];
  dropped: number;
  /** Failed calls since the last block, and in this page life. */
  freshFailed: number;
  failed: number;
  calls: number;
};

const cmds = new Map<string, Cmd>();
const art = { misses: [] as number[], hits: 0, freshMisses: [] as number[], freshHits: 0, dropped: 0 };
let lastBlock = 0;
let seq = 0;

type Internals = { invoke: (cmd: string, args?: unknown, options?: unknown) => Promise<unknown> };
declare global {
  interface Window {
    /** Tauri's bridge (set by Tauri, or by web/tauri-shim.ts and the demo); only `invoke` here,
     *  for the block's own write, which must not pass through `timed`. */
    __TAURI_INTERNALS__?: Internals;
    __ipcTiming?: {
      /** Per command: the cold round trip, the newest warm ones, the call and fail counts. */
      commands: () => Record<string, { cold?: number; warm: number[]; calls: number; failed: number }>;
      /** The newest cover misses (ms) and the hit count, this page life. */
      art: () => { misses: number[]; hits: number };
      /** The block the next flush would write (null: nothing new). */
      pending: () => string | null;
      flush: () => void;
    };
  }
}

function push(list: number[], v: number, cap: number): boolean {
  list.push(v);
  if (list.length <= cap) return false;
  list.shift();
  return true;
}

function settle(cmd: string, ms: number, ok: boolean): void {
  let c = cmds.get(cmd);
  if (!c) cmds.set(cmd, (c = { coldLogged: false, warm: [], fresh: [], dropped: 0, freshFailed: 0, failed: 0, calls: 0 }));
  c.calls++;
  if (!ok) {
    c.failed++;
    c.freshFailed++;
  }
  // The cold value is the first call to SETTLE. Two first calls at once both count as cold
  // waits, but only one value is the page life's first; the other is warm.
  if (c.cold === undefined) c.cold = ms;
  else {
    push(c.warm, ms, RING);
    if (push(c.fresh, ms, RING)) c.dropped++;
  }
}

/** One command's round trip, timed (ipc-core.ts calls it for every `invoke`). */
export function timed<T>(cmd: string, run: () => Promise<T>): Promise<T> {
  if (!TELEMETRY || SKIP.has(cmd)) return run();
  const id = String(++seq);
  const t0 = performance.now();
  mark(`ipc:${cmd}:begin`, id);
  const end = (ok: boolean) => {
    settle(cmd, Math.round(performance.now() - t0), ok);
    mark(`ipc:${cmd}:end`, id);
  };
  let p: Promise<T>;
  try {
    p = run();
  } catch (e) {
    end(false);
    throw e;
  }
  p.then(() => end(true), () => end(false));
  return p;
}

// ── Covers ───────────────────────────────────────────────────────────────────
// The load event and the Resource Timing entry arrive in either order, and the browser's buffer
// fills at ~250 entries (perf.ts clears it per click). So an observer keeps the newest entries
// by URL, and each loaded cover waits up to ART_GRACE_MS for its entry.
const entries = new Map<string, number>();
const loaded: { url: string; at: number }[] = [];

function artLoaded(ms: number | undefined): void {
  if (ms === undefined || ms < HIT_MS) {
    art.hits++;
    art.freshHits++;
    return;
  }
  const v = Math.round(ms);
  push(art.misses, v, ART_RING);
  if (push(art.freshMisses, v, ART_RING)) art.dropped++;
}

function drainLoaded(): void {
  const now = performance.now();
  for (let i = 0; i < loaded.length; ) {
    const l = loaded[i];
    const ms = entries.get(l.url);
    if (ms !== undefined || now - l.at > ART_GRACE_MS) {
      entries.delete(l.url); // a later load of the same URL is a new entry, or a hit
      artLoaded(ms);
      loaded.splice(i, 1);
    } else i++;
  }
}

function watchCovers(): void {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries() as PerformanceResourceTiming[]) {
      if (e.initiatorType !== "img") continue;
      entries.set(e.name, e.duration);
      if (entries.size > 500) entries.delete(entries.keys().next().value!);
    }
    drainLoaded();
  }).observe({ type: "resource", buffered: false });
  document.addEventListener(
    "load",
    (ev) => {
      const img = ev.target;
      if (!(img instanceof HTMLImageElement) || !img.hasAttribute("data-art")) return;
      const url = img.currentSrc || img.src;
      if (!url.startsWith("http")) return; // a mosaic blob or a data: picture is drawn here
      loaded.push({ url, at: performance.now() });
    },
    true, // load does not bubble; the capture phase sees every image
  );
  window.setInterval(drainLoaded, ART_GRACE_MS);
}

// ── The block ────────────────────────────────────────────────────────────────
function block(): string | null {
  drainLoaded();
  const lines: string[] = [];
  for (const [cmd, c] of [...cmds].sort((a, b) => a[0].localeCompare(b[0]))) {
    const parts: string[] = [];
    if (!c.coldLogged && c.cold !== undefined) parts.push(`cold ${c.cold}`);
    if (c.fresh.length) parts.push(`warm ${c.fresh.join(",")}`);
    if (!parts.length) continue;
    if (c.dropped) parts.push(`dropped ${c.dropped}`);
    if (c.freshFailed) parts.push(`failed ${c.freshFailed}`);
    lines.push(`[perf] ipc ${cmd} ${parts.join(" · ")}`);
  }
  if (art.freshMisses.length || art.freshHits) {
    const parts = [`miss ${art.freshMisses.join(",") || "-"}`, `hits ${art.freshHits}`];
    if (art.dropped) parts.push(`dropped ${art.dropped}`);
    lines.push(`[perf] art ${parts.join(" · ")}`);
  }
  if (!lines.length) return null;
  const secs = Math.round((performance.now() - lastBlock) / 1000);
  return [`[perf] ipc+art ${secs} s`, ...lines].join("\n");
}

function flush(): void {
  const text = block();
  if (!text) return;
  for (const c of cmds.values()) {
    if (c.cold !== undefined) c.coldLogged = true;
    c.fresh = [];
    c.dropped = 0;
    c.freshFailed = 0;
  }
  art.freshMisses = [];
  art.freshHits = 0;
  art.dropped = 0;
  lastBlock = performance.now();
  // Straight to the file (as perf.ts does), so the block keeps its own head line.
  window.__TAURI_INTERNALS__?.invoke("diag_flush", { text }).catch(() => {});
}

function install(): void {
  if (typeof document === "undefined") return; // a unit test
  watchCovers();
  window.setInterval(flush, FLUSH_EVERY_MS);
  window.addEventListener("beforeunload", flush);
  window.__ipcTiming = {
    commands: () =>
      Object.fromEntries([...cmds].map(([k, c]) => [k, { cold: c.cold, warm: [...c.warm], calls: c.calls, failed: c.failed }])),
    art: () => ({ misses: [...art.misses], hits: art.hits }),
    pending: block,
    flush,
  };
}

if (TELEMETRY) install();
