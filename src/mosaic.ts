// The derived playlist cover (PLAYLISTS.md §11): up to MOSAIC_MAX distinct track covers
// drawn into ONE picture per playlist. Memory only — never saved, so no picture made from
// Apple's artwork is stored. The rules that keep it light:
//
//   - drawn in a worker (mosaic-worker.ts), up to DRAWS_AT_ONCE playlists at a time;
//   - only in idle time (requestIdleCallback);
//   - only while the window shows (a minimized or tray-hidden window draws nothing);
//   - only once its slot is on screen (IntersectionObserver), or when it was on the first
//     screen of a card at the last launch (`warmMosaics`, below).
//
// Until then the slot shows the ♪ placeholder. The playlist's id seeds the layout and
// the tile order, so every playlist keeps its own picture across sessions.
//
// Drawn at the size on screen (UX-COVERUPS.md §7.4 part 2, 2026-10-17). The probe showed a
// cold mosaic's time is its downloads: one 480 px picture served the 36 px row, the tile and
// the hero, so a row's mosaic fetched three 480 px covers. Now each slot asks for the ladder
// step its class shows (art-size.ts): a row 96, a tile 192, a hero 480. The worker fetches its
// tiles on the same ladder, so a row's mosaic reuses the covers the rows already loaded.

import { log } from "./diag";
import { mark } from "./marks";
import type { Timing } from "./mosaic-worker";
import { ROW_PX, TILE_PX, HERO_PX } from "./art-size";

export const MOSAIC_MAX = 100;
/** Draws in flight at once (§7.4 part 5: one at a time waited up to 891 ms in the queue). */
const DRAWS_AT_ONCE = 3;
/** The picture size a slot class shows, on the ladder. */
const SIZE_OF: Record<string, number> = {
  "lib-row__art": ROW_PX,
  "lib-tile__cover": TILE_PX,
  "search__tile-art": TILE_PX,
  "lib-hero__cover": HERO_PX,
};

interface Job {
  urls: string[];
  seed: string;
  px: number;
}

const ready = new Map<string, string>(); // key → object URL
const latest = new Map<string, string>(); // seed@px → the key it shows now (to free a superseded picture)
const jobs = new Map<string, Job>();
const known = new Map<string, Job>(); // every key asked for this session (the warm list reads it)
const failed = new Set<string>();
const waiting: string[] = []; // keys whose slot was on screen, oldest first
const seenAt = new Map<string, number>(); // when each waiting key's slot came on screen (the probe)
const watched = new WeakSet<Element>();
let inFlight = 0;
let idleQueued = false;
let scanQueued = false;
let worker: Worker | null = null;
const pending = new Map<number, (blob: Blob | null, timing?: Timing) => void>();
let io: IntersectionObserver | null = null;
let nextId = 0;

function keyOf(seed: string, urls: string[], px: number): string {
  const s = `${seed}\n${px}\n${urls.join("\n")}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16)}-${urls.length}-${px}`;
}

/** The slot markup for a playlist's derived cover. `cls` is the slot class (row, tile,
 *  hero); `seed` is the playlist's id; `px` the picture's size when the class alone does not
 *  say it (a large tile). The picture, when drawn, replaces the ♪ in place. */
export function mosaicHTML(cls: string, urls: string[], seed: string, px?: number): string {
  const list = urls.slice(0, MOSAIC_MAX);
  const size = px ?? SIZE_OF[cls] ?? TILE_PX;
  const key = keyOf(seed, list, size);
  known.set(key, { urls: list, seed, px: size });
  const url = ready.get(key);
  // `data-fade`: a picture that is ready now shows at once; artwork-heal.ts fades one that is not.
  if (url) return `<div class="${cls} ${cls}--mosaic" aria-hidden="true"><img src="${url}" alt="" decoding="async" data-fade /></div>`;
  if (!failed.has(key)) {
    jobs.set(key, { urls: list, seed, px: size });
    scheduleScan();
  }
  return `<div class="${cls} ${cls}--empty" data-mosaic="${key}" aria-hidden="true">♪</div>`;
}

/** The picture for `key` is drawn (or failed): a held reveal can stop waiting for it. */
export function mosaicSettled(key: string): boolean {
  return ready.has(key) || failed.has(key);
}

/** Wait for `key`'s picture: drawn (true) or failed (false). Asks for the draw now, ahead of
 *  the queue (a slot on a held first screen, reveal.ts). */
export function whenMosaic(key: string): Promise<boolean> {
  if (ready.has(key)) return Promise.resolve(true);
  if (failed.has(key) || !jobs.has(key)) return Promise.resolve(false);
  if (!waiting.includes(key)) {
    waiting.unshift(key);
    seenAt.set(key, performance.now());
  }
  pump();
  return new Promise((r) => {
    const list = settleCbs.get(key) ?? [];
    list.push(r);
    settleCbs.set(key, list);
  });
}
const settleCbs = new Map<string, ((ok: boolean) => void)[]>();

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
    else if (!waiting.includes(key) && jobs.has(key)) {
      waiting.push(key);
      seenAt.set(key, performance.now());
    }
  }
  pump();
}

function pump(): void {
  if (idleQueued || inFlight >= DRAWS_AT_ONCE || !waiting.length || document.hidden) return;
  idleQueued = true;
  requestIdleCallback(
    () => {
      idleQueued = false;
      while (inFlight < DRAWS_AT_ONCE && waiting.length && !document.hidden) {
        const key = waiting.shift()!;
        const job = jobs.get(key);
        if (!job || ready.has(key)) continue;
        draw(key, job);
      }
    },
    { timeout: 500 },
  );
}
document.addEventListener("visibilitychange", pump);

function draw(key: string, job: Job): void {
  const id = ++nextId;
  inFlight++;
  const started = performance.now();
  // The probe (UX-COVERUPS.md §7.4.1): how long the slot waited in the queue before its draw
  // began, then the worker's split of the draw.
  const waited = Math.round(started - (seenAt.get(key) ?? started));
  seenAt.delete(key);
  const split = (t?: Timing) =>
    t
      ? {
          tiles: Math.round(t.tilesMs), fetch: Math.round(t.fetchMs), slowest: Math.round(t.slowestFetchMs),
          decode: Math.round(t.decodeMs), paint: Math.round(t.drawMs), encode: Math.round(t.encodeMs),
          px: t.px, kb: Math.round(t.kb), failed: t.failed,
        }
      : {};
  let settled = false;
  const done = (blob: Blob | null, timing?: Timing) => {
    if (settled) return;
    settled = true;
    pending.delete(id);
    inFlight--;
    jobs.delete(key);
    if (!blob) {
      failed.add(key);
      log("mosaic:failed", { covers: job.urls.length, size: job.px, waited, ...split(timing) });
    } else {
      const url = URL.createObjectURL(blob);
      ready.set(key, url);
      const slot = `${job.seed}@${job.px}`;
      const old = latest.get(slot);
      if (old && old !== key) {
        const u = ready.get(old);
        if (u) URL.revokeObjectURL(u);
        ready.delete(old);
      }
      latest.set(slot, key);
      fill(key);
      mark("mosaic:drawn", `${job.seed}@${job.px}`); // the strip names it (LOADING-SET.md §3.3)
      log("mosaic:drawn", { covers: job.urls.length, size: job.px, ms: Math.round(performance.now() - started), waited, ...split(timing) });
    }
    settleCbs.get(key)?.forEach((cb) => cb(!!blob));
    settleCbs.delete(key);
    pump();
  };
  try {
    if (!worker) {
      worker = new Worker(new URL("./mosaic-worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (e: MessageEvent<{ id: number; blob: Blob | null; timing?: Timing }>) => pending.get(e.data.id)?.(e.data.blob, e.data.timing);
      worker.onerror = () => {
        [...pending.values()].forEach((cb) => cb(null));
        worker = null;
      };
    }
  } catch (e) {
    console.warn("[mosaic] worker", e);
    done(null);
    return;
  }
  pending.set(id, done);
  // The canvas ground: the same role the ♪ placeholder sits on.
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--surface-hover").trim();
  worker.postMessage({ id, urls: job.urls, seed: job.seed, size: job.px, bg });
}

/** Swap every on-screen ♪ slot for this key to the drawn picture. The `<img>` goes in with
 *  `data-fade`, so it fades on its own image's load (artwork-heal.ts), never blank. */
function fill(key: string): void {
  const url = ready.get(key);
  if (!url) return;
  document.querySelectorAll<HTMLElement>(`[data-mosaic="${key}"]`).forEach((el) => {
    const cls = el.classList[0];
    el.classList.remove(`${cls}--empty`);
    el.classList.add(`${cls}--mosaic`);
    el.removeAttribute("data-mosaic");
    el.innerHTML = `<img src="${url}" alt="" decoding="async" data-fade />`;
  });
}

// ── Mosaics ready before the card opens (UX-COVERUPS.md §7.4 part 3) ──────────
// A card's reveal (reveal.ts) records the mosaics of its first screen: which playlist, which
// cover URLs, which size. At idle after the next launch those are drawn, in reading order,
// DRAWS_AT_ONCE at a time, so the card opens with its pictures ready. Only the cover URLs are
// kept (Apple's own addresses, as the cached playlist rows hold them), never a picture.
const WARM_KEY = "deets.mosaic.warm";
const WARM_CAP = 12;

/** A card's first screen showed these mosaic keys, in reading order. */
export function rememberFirstScreen(card: string, keys: string[]): void {
  const list = keys.map((k) => known.get(k)).filter((j): j is Job => !!j).slice(0, WARM_CAP);
  try {
    const all = JSON.parse(localStorage.getItem(WARM_KEY) ?? "{}") as Record<string, Job[]>;
    if (list.length) all[card] = list;
    else delete all[card];
    localStorage.setItem(WARM_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: the next launch draws on sight, as before */
  }
}

/** At idle after launch: draw the mosaics last seen on each card's first screen. */
export function warmMosaics(): void {
  let all: Record<string, Job[]> = {};
  try {
    all = JSON.parse(localStorage.getItem(WARM_KEY) ?? "{}") as Record<string, Job[]>;
  } catch {
    return;
  }
  let n = 0;
  for (const list of Object.values(all)) {
    if (!Array.isArray(list)) continue;
    for (const j of list) {
      if (!j || !Array.isArray(j.urls) || typeof j.seed !== "string" || typeof j.px !== "number") continue;
      const key = keyOf(j.seed, j.urls, j.px);
      if (ready.has(key) || failed.has(key) || waiting.includes(key)) continue;
      jobs.set(key, j);
      known.set(key, j);
      waiting.push(key);
      seenAt.set(key, performance.now());
      n++;
    }
  }
  if (n) log("mosaic:warm", { n });
  pump();
}
