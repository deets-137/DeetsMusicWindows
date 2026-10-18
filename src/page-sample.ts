// The page sample: what grows INSIDE the page (DEBUGGING.md § The page sample, his calls
// 2026-10-17). Dev telemetry: everything here sits behind `TELEMETRY` (on in `dev:app` and
// `dev:app -- --built`, compiled out of a release; release-check 5 fails a bundle that carries
// `page:sample`).
//
// One sample per song start (his call), never on a clock: the counts below, logged to the ring
// as `page:sample` (so it sits beside the songs and clicks before it) and sent to Rust, which
// answers the newest one on `/health` under `page` for the heaviness sampler.
//
// Timers have no browser API, so this module wraps setTimeout / setInterval / their clears and
// requestAnimationFrame at launch. main.ts imports it right after boot-prefetch, before any other
// module can start a timer. Each new timer reads one stack and is filed under the line that
// made it. In a `--built` bundle that line is a column in a minified chunk, so the sample reads
// the chunk's source map (vite.config.ts writes a hidden one for VITE_PERF builds) and names the
// source line instead.

import { invoke } from "@tauri-apps/api/core";
import { TELEMETRY } from "./telemetry-on";
import * as diag from "./diag";
import { setSongHook, songCounts, watchedSets } from "./page-counts";
import { decodeMappings, lookup, type MapLines } from "./source-map-lite";

type Kind = "interval" | "timeout";
/** Live timers: id → kind and the raw `url:line:col` of the line that made it. */
const live = new Map<number, { kind: Kind; at: string }>();
/** requestAnimationFrame calls per second, for the last 10 s. */
const rafBuckets = new Array<number>(10).fill(0);
let rafSec = 0;

// Stack line 0 is "Error", 1 is `caller`, 2 the wrapper, 3 the code that asked for the timer.
// A fixed depth, because in a built bundle this module shares its chunk with the caller.
function caller(): string {
  const line = new Error().stack?.split("\n")[3] ?? "";
  const m = /\(?([^\s()]+):(\d+):(\d+)\)?\s*$/.exec(line);
  return m ? `${m[1]}:${m[2]}:${m[3]}` : "?";
}

function bumpRaf(): void {
  const s = Math.floor(performance.now() / 1000);
  if (s !== rafSec) {
    for (let t = Math.max(rafSec + 1, s - 9); t <= s; t++) rafBuckets[t % 10] = 0;
    rafSec = s;
  }
  rafBuckets[s % 10]++;
}

function install(): void {
  const w = window as unknown as Record<string, unknown>;
  const realTimeout = window.setTimeout.bind(window);
  const realInterval = window.setInterval.bind(window);
  const realClearTimeout = window.clearTimeout.bind(window);
  const realClearInterval = window.clearInterval.bind(window);
  const realRaf = window.requestAnimationFrame.bind(window);
  w.setTimeout = (fn: TimerHandler, ms?: number, ...args: unknown[]): number => {
    const at = caller();
    let id = 0;
    const run = typeof fn === "function" ? (...a: unknown[]) => { live.delete(id); (fn as (...x: unknown[]) => void)(...a); } : fn;
    id = realTimeout(run, ms, ...args);
    live.set(id, { kind: "timeout", at });
    return id;
  };
  w.setInterval = (fn: TimerHandler, ms?: number, ...args: unknown[]): number => {
    const at = caller();
    const id = realInterval(fn, ms, ...args);
    live.set(id, { kind: "interval", at });
    return id;
  };
  // The two clears share one id space in the browser, so each removes either kind.
  w.clearTimeout = (id?: number): void => {
    if (id !== undefined) live.delete(id);
    realClearTimeout(id);
  };
  w.clearInterval = (id?: number): void => {
    if (id !== undefined) live.delete(id);
    realClearInterval(id);
  };
  w.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    bumpRaf();
    return realRaf(cb);
  };
}

// ── naming a timer's line ─────────────────────────────────────────────────────

/** A raw stack location → `src/x.ts:line`. Dev serves source paths; a built chunk goes through
 *  its source map. */
const named = new Map<string, string>();
const maps = new Map<string, Promise<SourceMap | null>>();
type SourceMap = { sources: string[]; lines: MapLines };

function mapFor(url: string): Promise<SourceMap | null> {
  let p = maps.get(url);
  if (!p) {
    p = fetch(`${url}.map`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { sources: string[]; mappings: string } | null) => (j ? { sources: j.sources, lines: decodeMappings(j.mappings) } : null))
      .catch(() => null);
    maps.set(url, p);
  }
  return p;
}

/** The last path part from `src/` (or `node_modules/`) on, without a query. */
const tidy = (path: string): string => {
  const p = path.replace(/[?#].*$/, "");
  const i = Math.max(p.lastIndexOf("/src/"), p.lastIndexOf("/node_modules/"));
  return i >= 0 ? p.slice(i + 1) : p.replace(/^.*\//, "");
};

async function nameOf(raw: string): Promise<string> {
  const hit = named.get(raw);
  if (hit) return hit;
  const m = /^(.*):(\d+):(\d+)$/.exec(raw);
  let out = raw;
  if (m) {
    const [, url, line, col] = m;
    if (/\/assets\/[^/]+\.js$/.test(url.replace(/[?#].*$/, ""))) {
      const map = await mapFor(url);
      const at = map ? lookup(map.lines, Number(line), Number(col)) : null;
      out = map && at ? `${tidy(map.sources[at.src] ?? "?")}:${at.line}` : `${tidy(url)}:${line}:${col}`;
    } else out = `${tidy(url)}:${line}`;
  }
  named.set(raw, out);
  return out;
}

/** The 3 lines that hold the most live timers of one kind, as `file:line ×n`. */
async function top(kind: Kind): Promise<{ n: number; top: string[] }> {
  const byRaw = new Map<string, number>();
  for (const t of live.values()) if (t.kind === kind) byRaw.set(t.at, (byRaw.get(t.at) ?? 0) + 1);
  const byName = new Map<string, number>();
  for (const [raw, n] of byRaw) {
    const name = await nameOf(raw);
    byName.set(name, (byName.get(name) ?? 0) + n);
  }
  let n = 0;
  byRaw.forEach((c) => (n += c));
  const best = [...byName].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, c]) => `${name} x${c}`);
  return { n, top: best };
}

// ── the sample ────────────────────────────────────────────────────────────────

type HeapInfo = { usedJSHeapSize: number; totalJSHeapSize: number };
const mb = (b: number): number => Math.round(b / 104857.6) / 10;

/** One sample (counts only: never a title, an artist or an id; `/health` has no token). */
export async function pageSample(): Promise<Record<string, unknown>> {
  const heap = (performance as Performance & { memory?: HeapInfo }).memory;
  let running = 0, paused = 0, finished = 0, held = 0;
  for (const a of document.getAnimations()) {
    if (a.playState === "running") running++;
    else if (a.playState === "paused") paused++;
    else if (a.playState === "finished") {
      finished++;
      const fill = a.effect?.getTiming().fill;
      if (fill === "forwards" || fill === "both") held++;
    }
  }
  bumpRaf(); // rolls the buckets to now; the extra 1 is this read
  const sets: Record<string, number> = {};
  watchedSets().forEach((s, name) => (sets[name] = s.size));
  const [intervals, timeouts] = await Promise.all([top("interval"), top("timeout")]);
  const slots = [...document.querySelectorAll<HTMLElement>("[data-slot]")].filter((el) => el.childElementCount > 0 && el.offsetParent !== null).length;
  return {
    heapMB: heap ? mb(heap.usedJSHeapSize) : null,
    heapTotalMB: heap ? mb(heap.totalJSHeapSize) : null,
    dom: document.getElementsByTagName("*").length,
    imgs: document.images.length,
    canvases: document.getElementsByTagName("canvas").length,
    anims: { running, paused, finished, held },
    intervals: intervals.n,
    intervalTop: intervals.top,
    timeouts: timeouts.n,
    timeoutTop: timeouts.top,
    raf10s: rafBuckets.reduce((a, b) => a + b, 0) - 1,
    sets,
    ...songCounts(),
    upMin: Math.round(performance.now() / 6000) / 10,
    surface: document.documentElement.dataset.surface ?? "",
    slots,
    visible: document.visibilityState === "visible",
  };
}

let busy = false;
async function take(why: string): Promise<void> {
  if (busy) return; // a sample still naming its timers: the next song takes the next one
  busy = true;
  try {
    const s = await pageSample();
    diag.log("page:sample", { why, ...s });
    await invoke("page_sample_publish", { sample: s });
  } catch (e) {
    diag.log("page:sampleErr", { e: String(e) });
  } finally {
    busy = false;
  }
}

declare global {
  interface Window {
    /** The page sample on demand (DEBUGGING.md § The page sample). Telemetry builds only. */
    __pageSample?: { read: () => Promise<Record<string, unknown>>; take: () => Promise<void> };
  }
}

if (TELEMETRY && typeof window !== "undefined") {
  install();
  setSongHook(() => void take("song"));
  window.__pageSample = { read: pageSample, take: () => take("hand") };
}
