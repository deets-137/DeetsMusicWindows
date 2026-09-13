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

import * as diag from "./diag";

const ON = import.meta.env.DEV;
const STALE_MS = 30_000; // a click older than this is forgotten, not attributed
const SPAN_SHOW_MS = 5; // spans under this are noise in the summary (still in the ring)

let t0 = 0; // click time; 0 = no play in flight
let targetId: string | undefined; // the clicked song's play id — `sound` must match it
let marks: Record<string, number> = {};
let meta: Record<string, unknown> = {};
let spans: { name: string; ms: number }[] = [];

const since = (): number => Math.round(performance.now() - t0);

/** A song was clicked. `where` is the context tag, `n` the list length. */
export function click(where: string, n: number): void {
  if (!ON) return;
  if (t0) abandon("superseded");
  t0 = performance.now();
  targetId = undefined;
  marks = {};
  spans = [];
  meta = { where, n };
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

/** MusicKit reported `playing`. Counts only when it is the clicked song. */
export function sound(npId: string | undefined): void {
  if (!ON || !t0 || (targetId && npId !== targetId)) return;
  mark("sound");
  const m = marks;
  const seg = (a: number | undefined, b: number | undefined): string =>
    a !== undefined && b !== undefined ? `${b - a}` : "?";
  const init = m.model !== undefined && m.context !== undefined && m.context - m.model > 0 ? ` · init ${m.context - m.model}` : "";
  console.info(
    `[perf] click→sound ${m.sound} ms · model+render ${seg(0, m.model)}${init} · setQueue ${seg(m.context, m.window)} · stream ${seg(m.window, m.sound)}`,
    meta,
  );
  const slow = spans.filter((s) => s.ms >= SPAN_SHOW_MS);
  if (slow.length) console.info(`[perf]   spans: ${slow.map((s) => `${s.name} ${s.ms}`).join(" · ")}`);
  t0 = 0;
}

/** The in-flight click will never reach `sound`. */
export function abandon(reason: string): void {
  if (!ON || !t0) return;
  diag.log("perf:abandon", { reason, ms: since(), ...marks });
  t0 = 0;
}
