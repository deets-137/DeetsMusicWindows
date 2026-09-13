// Dev-only click-to-sound telemetry. Every entry point is gated on Vite's DEV flag, so
// the installed build ships none of it (no marks, no console line, nothing in the log).
//
// One play = the marks below, all in ms since the click:
//   click    — stamped BEFORE the handle builder runs, so the first stage covers the
//              transient ingest, the listener re-renders it fans out, and the queue model
//   model    — playContext entered (ingest + model + re-renders done)
//   context  — MusicKit configured (differs from `model` only on the session's first play)
//   window   — setQueue resolved (MusicKit has resolved and accepted the id list)
//   sound    — MusicKit's playbackState turned `playing` FOR THE CLICKED SONG
//   resolve  — changeToMediaAtIndex / play resolved (lands AFTER sound in practice)
// `span(name, fn)` times one synchronous step inside a stage (a listener, a render) and
// the summary lists every span ≥ 5 ms. Each mark lands in the diag ring as `perf:<mark>`;
// `sound` also prints the summary to the devtools console. `__diag.dump()` shows the raw
// marks. A click that never reaches `sound` (a second click on top, a load error) is
// logged as `perf:abandon`.

import { invoke } from "@tauri-apps/api/core";
import * as diag from "./diag";

const ON = import.meta.env.DEV;
const STALE_MS = 30_000; // a click older than this is forgotten, not attributed
const SPAN_SHOW_MS = 5; // spans under this are noise in the summary (still in the ring)

let t0 = 0; // click time; 0 = no play in flight
let targetId: string | undefined; // the clicked song's play id — `sound` must match it
let marks: Record<string, number> = {};
let meta: Record<string, unknown> = {};
let spans: { name: string; ms: number }[] = [];
// Session-level facts that ride every summary line (which key system MusicKit asked
// for, whether the DRM warm-up took, whether the descriptor form was accepted…).
const notes: Record<string, unknown> = {};

const since = (): number => Math.round(performance.now() - t0);

/** Record a session fact for the summary lines. */
export function note(key: string, value: unknown): void {
  if (ON) notes[key] = value;
}

/** A song was clicked. `where` is the context tag, `n` the list length. */
export function click(where: string, n: number): void {
  if (!ON) return;
  if (t0) abandon("superseded");
  t0 = performance.now();
  targetId = undefined;
  marks = {};
  spans = [];
  meta = { where, n };
  performance.clearResourceTimings(); // the buffer caps at ~250 entries — start it fresh per click
  armAudible();
  diag.log("perf:click", meta);
}

/** The play id the click resolved to (set once the model knows its current). */
export function target(id: string | undefined): void {
  if (ON) targetId = id;
}

/** Stamp a stage. `extra` rides into the diag line and the final summary. */
export function mark(name: string, extra?: Record<string, unknown>): void {
  if (!ON || !t0) return;
  if (since() > STALE_MS) return abandon("stale");
  marks[name] = since();
  if (extra) Object.assign(meta, extra);
  diag.log(`perf:${name}`, { ms: marks[name], ...extra });
}

/** Time one synchronous step (a listener, a render) inside the in-flight click. */
export function span<T>(name: string, fn: () => T): T {
  if (!ON || !t0) return fn();
  const s = performance.now();
  try {
    return fn();
  } finally {
    const ms = Math.round(performance.now() - s);
    spans.push({ name, ms });
    diag.log("perf:span", { name, ms });
  }
}

// The honest end of the timeline is the media element's own `playing` event — MusicKit
// flips its playbackState to `playing` a beat before audio actually flows. The player
// binds `npId` so a `playing` fired by setQueue's implicit item-0 buffering (a pos>0
// window) is not mistaken for the clicked song.
let npIdOf: () => string | undefined = () => undefined;
export function bind(npId: () => string | undefined): void {
  npIdOf = npId;
}
// MusicKit keeps its media element out of the DOM, so it is captured the first time
// MusicKit calls play() on it (a one-time patch of HTMLMediaElement.prototype.play,
// dev-only like everything here); the `playing` listener then stays on for the session.
let mediaEl: HTMLMediaElement | null = null;
let mediaPatched = false;
let disarmAudible: (() => void) | null = null; // set while a click is listening
let soundFallback: number | undefined;
const onMediaPlaying = (): void => {
  if (!t0 || !disarmAudible) return;
  if (targetId && npIdOf() !== targetId) return; // item-0 buffering, not the clicked song
  mark("audible");
  finish();
};
function armAudible(): void {
  if (!mediaPatched) {
    mediaPatched = true;
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement): Promise<void> {
      // A play() with no click in flight is MusicKit acting on its own (the question the
      // restore preload hangs on: does setQueue alone start audio?).
      if (!t0) event("mediaPlay", { outsideClick: true, muted: this.muted, volume: this.volume });
      if (mediaEl !== this) {
        mediaEl?.removeEventListener("playing", onMediaPlaying);
        mediaEl = this;
        this.addEventListener("playing", onMediaPlaying);
      }
      return originalPlay.call(this);
    };
  }
  disarmAudible = () => {}; // listening (the listener itself is persistent)
}
/** Install the media-element capture without a click (the preload probe needs it early). */
export function observeMedia(): void {
  if (!ON) return;
  armAudible();
  disarmAudible = null;
}

/** MusicKit reported `playing`. Counts only when it is the clicked song. */
export function sound(npId: string | undefined): void {
  if (!ON || !t0 || (targetId && npId !== targetId)) return;
  if (marks.sound !== undefined) return;
  mark("sound");
  if (!disarmAudible) return finish(); // no media element to listen to — MusicKit's word stands
  // `playing` normally lands within a few hundred ms; if it never comes, close out anyway.
  soundFallback = window.setTimeout(finish, 4000);
}

function finish(): void {
  if (!t0) return;
  disarmAudible?.();
  disarmAudible = null;
  if (soundFallback !== undefined) window.clearTimeout(soundFallback);
  soundFallback = undefined;
  const m = marks;
  const end = m.audible ?? m.sound;
  const seg = (a: number | undefined, b: number | undefined): string =>
    a !== undefined && b !== undefined ? `${b - a}` : "?";
  const init = m.model !== undefined && m.context !== undefined && m.context - m.model > 0 ? ` · init ${m.context - m.model}` : "";
  // `quiet` = the pre-swap pause() resolved; setQueue is measured from there when present.
  const pause = m.quiet !== undefined && m.context !== undefined ? ` · pause ${m.quiet - m.context}` : "";
  const mk = m.audible !== undefined && m.sound !== undefined ? ` (MusicKit said playing at ${m.sound})` : m.audible === undefined ? " (no `playing` event)" : "";
  const summary = `[perf] click→sound ${end} ms${mk} · model+render ${seg(0, m.model)}${init}${pause} · setQueue ${seg(m.quiet ?? m.context, m.window)} · stream ${seg(m.window, end)}`;
  console.info(summary, meta);
  const slow = spans.filter((s) => s.ms >= SPAN_SHOW_MS);
  const spanLine = slow.length ? `spans: ${slow.map((s) => `${s.name} ${s.ms}`).join(" · ")}` : "";
  if (spanLine) console.info(`[perf]   ${spanLine}`);
  const nets = requestsSinceClick();
  const netLine = nets.length
    ? `net: ${nets.map((n) => `@${n.at}+${n.ms} ${n.what}${n.kb ? ` ${n.kb}k` : ""}${n.status === 200 || n.status === 0 ? "" : ` [${n.status}]`}`).join(" · ")}`
    : "";
  if (netLine) console.info(`[perf]   ${netLine}`);
  toLog(`${summary} ${JSON.stringify({ ...meta, ...notes })}${spanLine ? " | " + spanLine : ""}${netLine ? " | " + netLine : ""}`);
  t0 = 0;
}

// MusicKit's own traffic during a click, so the `stream` stage reads request by request
// (account check, asset lookup, HLS playlists, the license, the first segment). Read
// from the browser's resource-timing buffer at `sound`, which sees every request however
// it was made (fetch, XHR, media). Our own Tauri IPC calls are left out. `at` = ms after
// the click the request started, `ms` = its duration.
const label = (url: string): string => {
  try {
    const u = new URL(url, location.href);
    const path = u.pathname.replace(/[0-9a-f]{12,}|\d{6,}/gi, "…");
    return `${u.host.replace(/\.apple\.com$/, "")}${path}`.slice(0, 70);
  } catch {
    return url.slice(0, 70);
  }
};
function requestsSinceClick(): { at: number; ms: number; what: string; status: number; kb: number }[] {
  const out: { at: number; ms: number; what: string; status: number; kb: number }[] = [];
  for (const e of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
    if (e.startTime < t0 - 5 || e.name.includes("ipc.localhost")) continue;
    out.push({
      at: Math.round(e.startTime - t0),
      ms: Math.round(e.duration),
      what: label(e.name),
      status: (e as any).responseStatus ?? 0,
      kb: Math.round((e.encodedBodySize || e.transferSize) / 1024),
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The requests MusicKit made since the in-flight click, as one string ("" without one). */
export function netSince(): string {
  if (!ON || !t0) return "";
  return requestsSinceClick().map((n) => `@${n.at}+${n.ms} ${n.what}${n.status === 200 || n.status === 0 ? "" : ` [${n.status}]`}`).join(" · ");
}

/** A one-off fact worth a dev log line outside the click timeline (a grow, a canary). */
export function event(name: string, data?: Record<string, unknown>): void {
  if (!ON) return;
  toLog(`[perf] ${name} ${JSON.stringify(data ?? {})}`);
}

/** The in-flight click will never reach `sound`. */
export function abandon(reason: string): void {
  if (!ON || !t0) return;
  disarmAudible?.();
  disarmAudible = null;
  if (soundFallback !== undefined) window.clearTimeout(soundFallback);
  soundFallback = undefined;
  const data = { reason, ms: since(), ...marks };
  diag.log("perf:abandon", data);
  toLog(`[perf] abandon ${JSON.stringify({ ...data, ...meta })}`);
  t0 = 0;
}

// One line into the rolling dev log (`diag_flush` logs a single-line text as its
// header), so a driver outside the webview — the CLI/MCP, a tail on the log — can read
// each play's result without the devtools. Dev-only like everything here.
function toLog(line: string): void {
  invoke("diag_flush", { text: line }).catch(() => {});
}
