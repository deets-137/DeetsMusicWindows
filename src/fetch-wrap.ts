// The fetch wrap (docs/features/speedtest.md §5.3, his call 2026-10-16; built 2026-10-19). Apple's
// song server sends no `Timing-Allow-Origin` (§5.2), so Resource Timing alone has each song
// piece's time but not its size. The wrap reads the size from the one header the page may read
// (`Content-Length`, CORS-safelisted) and the time from Resource Timing, and the Network panel
// gets each piece's speed at zero extra requests.
//
// The rules (§5.3): it never reads, clones or tees a body; it never changes a request or a
// response; it hands MusicKit the same Response object `fetch` gave; it keeps no byte of a song.
// Every URL but Apple's song server goes straight to the original `fetch` after one host test.
// A throw in our part counts a fault and logs one diag line; after FAULTS_MAX the wrap stands
// aside for the session (it passes every call straight through). `deets.dev.fetchWrap = "off"`
// in DevTools, then a reload, never installs it: the switch for the A/B runs (§6.2).
//
// Imported first by main.ts, so it sits under MusicKit (loaded later, player.ts) and under the
// license watch (license-watch.ts wraps on top of this one, at initPlayer).

import * as diag from "./diag";
import { isSongUrl, pieceKbps, pushRing } from "./net-rules";
import { netNote } from "./net-feed";
import { TELEMETRY } from "./telemetry-on";

const RING = 50;
const FAULTS_MAX = 3;
/** A Resource Timing entry belongs to the piece whose fetch started within this many ms. */
const MATCH_MS = 50;
/** A piece still waiting for its timing after this long is dropped from the wait list. */
const WAIT_MS = 60_000;

interface Piece {
  url: string;
  /** performance.now() at the fetch call. */
  at: number;
  /** Content-Length; 0 when the server sent none. */
  bytes: number;
  status: number;
  /** startTime → responseEnd from Resource Timing; null until it arrives. */
  ms: number | null;
}

const OFF = (() => {
  try {
    return localStorage.getItem("deets.dev.fetchWrap") === "off";
  } catch {
    return false;
  }
})();

/** The last RING pieces, for the panel's hint and the perf line. */
const ring: Piece[] = [];
/** Pieces whose Resource Timing entry has not come yet. */
const waiting: Piece[] = [];
/** Song entries Resource Timing saw that no wrapped fetch made (an XHR, a media element): a
 *  count, so the perf line can say the wrap missed them. */
let unseen = 0;
let on = false;
let faults = 0;
/** Our own time inside the wrap, ms, and the calls it covers (§6.2: under 0.1 ms per call). */
let costMs = 0;
let calls = 0;

function fault(where: string, e: unknown): void {
  faults++;
  diag.warn("fetchwrap:fault", { where, e: String(e).slice(0, 120), faults });
  if (faults >= FAULTS_MAX && on) {
    on = false;
    diag.warn("fetchwrap:off", { faults });
  }
}

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

function noteReply(url: string, at: number, r: Response): void {
  const len = Number(r.headers.get("content-length"));
  const piece: Piece = { url, at, bytes: Number.isFinite(len) && len > 0 ? len : 0, status: r.status, ms: null };
  pushRing(ring, piece, RING);
  pushRing(waiting, piece, RING);
}

function onEntries(list: PerformanceObserverEntryList): void {
  const t0 = performance.now();
  try {
    for (const e of list.getEntries() as PerformanceResourceTiming[]) {
      if (!isSongUrl(e.name)) continue;
      // The closest waiting piece of the same URL (a song is many range reads of one URL).
      let best = -1;
      let gap = MATCH_MS;
      for (let i = 0; i < waiting.length; i++) {
        const p = waiting[i];
        const d = Math.abs(p.at - e.startTime);
        if (p.url === e.name && d <= gap) {
          gap = d;
          best = i;
        }
      }
      if (best < 0) {
        unseen++;
        continue;
      }
      const p = waiting.splice(best, 1)[0];
      p.ms = Math.max(0, e.responseEnd - e.startTime);
      const kbps = pieceKbps(p.bytes, p.ms);
      if (kbps !== null) netNote({ kind: "piece", kbps });
    }
    const old = t0 - WAIT_MS;
    while (waiting.length && waiting[0].at < old) waiting.shift();
  } catch (e) {
    fault("timing", e);
  }
  costMs += performance.now() - t0;
}

function install(): void {
  if (OFF || typeof window === "undefined" || typeof window.fetch !== "function") return;
  if (typeof PerformanceObserver === "undefined") return;
  const original = window.fetch;
  on = true;
  window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (!on) return original.call(this ?? window, input, init);
    const t0 = performance.now();
    let url = "";
    try {
      const u = urlOf(input);
      if (isSongUrl(u)) url = u;
    } catch (e) {
      fault("url", e);
    }
    calls++;
    costMs += performance.now() - t0;
    const p = original.call(this ?? window, input, init);
    if (!url) return p;
    // Our own branch: it reads one header off the same Response, and its own rejection is
    // swallowed here. MusicKit gets `p` itself, so its errors and its Response are untouched.
    p.then(
      (r) => {
        const t1 = performance.now();
        try {
          noteReply(url, t0, r);
        } catch (e) {
          fault("reply", e);
        }
        costMs += performance.now() - t1;
      },
      () => {},
    );
    return p;
  } as typeof window.fetch;
  try {
    new PerformanceObserver(onEntries).observe({ type: "resource" });
  } catch (e) {
    fault("observe", e);
  }
}

install();

/** What the wrap saw since `t` (performance.now()), for the `[perf] fetchwrap` line per song
 *  start (§6.3). Null when the wrap is not installed. */
export function fetchWrapSince(t: number): Record<string, unknown> | null {
  if (OFF && !on && !calls) return { off: true };
  const pieces = ring.filter((p) => p.at >= t);
  const timed = pieces.filter((p) => p.ms !== null);
  return {
    on,
    pieces: pieces.length,
    timed: timed.length,
    bytes: pieces.reduce((a, p) => a + p.bytes, 0),
    ms: Math.round(timed.reduce((a, p) => a + (p.ms ?? 0), 0)),
    unseen,
    faults,
    costPerCallMs: calls ? +(costMs / calls).toFixed(4) : 0,
  };
}

/** The last pieces, newest last: the Stream row's hint. */
export const songPieces = (): readonly Piece[] => ring;

declare global {
  interface Window {
    /** Dev only: the fetch wrap's pieces and counters (speedtest.md §6). `__fetchWrap.stats()`. */
    __fetchWrap?: { stats: () => Record<string, unknown> | null; pieces: () => readonly Piece[] };
  }
}
if (TELEMETRY) window.__fetchWrap = { stats: () => fetchWrapSince(0), pieces: () => ring };
