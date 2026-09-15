// The derived playlist cover (PLAYLISTS.md §11): up to MOSAIC_MAX distinct track covers
// drawn into ONE picture per playlist. Memory only — never saved, so no picture made from
// Apple's artwork is stored. The rules that keep it light:
//
//   - drawn in a worker (mosaic-worker.ts), one playlist at a time;
//   - only in idle time (requestIdleCallback);
//   - only while the window shows (a minimized or tray-hidden window draws nothing);
//   - only once its slot is on screen (IntersectionObserver).
//
// Until then the slot shows the ♪ placeholder. The playlist's id seeds the layout and
// the tile order, so every playlist keeps its own picture across sessions.

import { log } from "./diag";

export const MOSAIC_MAX = 100;
/** One picture serves the row (72), the tile (≤300) and the hero (360, 2× its token). */
const SIZE = 480;

const ready = new Map<string, string>(); // key → object URL
const latest = new Map<string, string>(); // seed → the key it shows now (to free a superseded picture)
const jobs = new Map<string, { urls: string[]; seed: string }>();
const failed = new Set<string>();
const waiting: string[] = []; // keys whose slot was on screen, oldest first
const watched = new WeakSet<Element>();
let busy = false;
let scanQueued = false;
let worker: Worker | null = null;
let io: IntersectionObserver | null = null;
let nextId = 0;

function keyOf(seed: string, urls: string[]): string {
  const s = `${seed}\n${urls.join("\n")}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16)}-${urls.length}`;
}

/** The slot markup for a playlist's derived cover. `cls` is the slot class (row, tile,
 *  hero); `seed` is the playlist's id. The picture, when drawn, replaces the ♪ in place. */
export function mosaicHTML(cls: string, urls: string[], seed: string): string {
  const list = urls.slice(0, MOSAIC_MAX);
  const key = keyOf(seed, list);
  const url = ready.get(key);
  if (url) return `<div class="${cls} ${cls}--mosaic" aria-hidden="true"><img src="${url}" alt="" decoding="async" /></div>`;
  if (!failed.has(key)) {
    jobs.set(key, { urls: list, seed });
    scheduleScan();
  }
  return `<div class="${cls} ${cls}--empty" data-mosaic="${key}" aria-hidden="true">♪</div>`;
}

function scheduleScan(): void {
  if (scanQueued) return;
  scanQueued = true;
  requestAnimationFrame(() => {
    scanQueued = false;
    io ??= new IntersectionObserver(onSeen, { rootMargin: "200px" });
    document.querySelectorAll<HTMLElement>("[data-mosaic]").forEach((el) => {
      if (watched.has(el)) return;
      watched.add(el);
      io!.observe(el);
    });
  });
}

function onSeen(entries: IntersectionObserverEntry[]): void {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    io?.unobserve(e.target);
    const key = (e.target as HTMLElement).dataset.mosaic;
    if (!key) continue;
    if (ready.has(key)) fill(key);
    else if (!waiting.includes(key) && jobs.has(key)) waiting.push(key);
  }
  pump();
}

function pump(): void {
  if (busy || !waiting.length || document.hidden) return;
  busy = true;
  requestIdleCallback(
    () => {
      const key = waiting.shift();
      const job = key ? jobs.get(key) : undefined;
      if (!key || !job || ready.has(key)) {
        busy = false;
        pump();
        return;
      }
      if (document.hidden) {
        waiting.unshift(key);
        busy = false;
        return;
      }
      draw(key, job);
    },
    { timeout: 2000 },
  );
}
document.addEventListener("visibilitychange", pump);

function draw(key: string, job: { urls: string[]; seed: string }): void {
  const id = ++nextId;
  const started = performance.now();
  const done = (blob: Blob | null) => {
    busy = false;
    jobs.delete(key);
    if (!blob) {
      failed.add(key);
      log("mosaic:failed", { covers: job.urls.length });
    } else {
      const url = URL.createObjectURL(blob);
      ready.set(key, url);
      const old = latest.get(job.seed);
      if (old && old !== key) {
        const u = ready.get(old);
        if (u) URL.revokeObjectURL(u);
        ready.delete(old);
      }
      latest.set(job.seed, key);
      fill(key);
      log("mosaic:drawn", { covers: job.urls.length, ms: Math.round(performance.now() - started) });
    }
    pump();
  };
  try {
    worker ??= new Worker(new URL("./mosaic-worker.ts", import.meta.url), { type: "module" });
  } catch (e) {
    console.warn("[mosaic] worker", e);
    done(null);
    return;
  }
  worker.onmessage = (e: MessageEvent<{ id: number; blob: Blob | null }>) => {
    if (e.data.id === id) done(e.data.blob);
  };
  worker.onerror = () => done(null);
  // The canvas ground: the same role the ♪ placeholder sits on.
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--surface-hover").trim();
  worker.postMessage({ id, urls: job.urls, seed: job.seed, size: SIZE, bg });
}

/** Swap every on-screen ♪ slot for this key to the drawn picture. */
function fill(key: string): void {
  const url = ready.get(key);
  if (!url) return;
  document.querySelectorAll<HTMLElement>(`[data-mosaic="${key}"]`).forEach((el) => {
    const cls = el.classList[0];
    el.classList.remove(`${cls}--empty`);
    el.classList.add(`${cls}--mosaic`);
    el.removeAttribute("data-mosaic");
    el.innerHTML = `<img src="${url}" alt="" decoding="async" />`;
  });
}
