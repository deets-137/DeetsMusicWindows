// Dev-only frame telemetry — the smoothness counterpart of perf.ts (click-to-sound).
// Gated on Vite's DEV flag like perf.ts: the installed build ships none of it.
//
// A "window" is one interaction we want buttery: a scroll, a scrub drag, a pane slide,
// a folder open, a queue drag, a menu open, an appearance switch. While at least one
// window is open, a requestAnimationFrame loop measures the gap between consecutive
// frames. Against the display's own refresh period (sampled repeatedly; see sampleHz), a gap over
// 1.5 periods is a DROPPED frame. Each window closes with one summary line:
//
//   [perf] frames scroll lib-view 812 ms · 117 frames @144 Hz · dropped 3 (2.6%) ·
//          worst 31 ms · longtasks 1 (max 28 ms)
//
// `longtasks` are the browser's own long-task entries (>50 ms on the main thread) that
// overlapped the window — the usual culprit behind a dropped frame. Separately, the
// Event Timing API reports any input whose press→paint took over two frames:
//
//   [perf] input pointerdown lib-row 41 ms (delay 3)
//
// (presses, clicks, keys and wheel only — hover events are skipped — and one line per
// painted frame, so a press/up/click trio logs once). A window's first gap runs from
// begin() itself, so the synchronous build before the first frame is counted and, when
// it alone is over budget, named as `first`.
//
// Scroll windows open themselves (a capturing scroll listener) and close 150 ms after
// the last scroll event. Everything else is begun/ended by the gesture's own code via
// `begin()` (returns the closer) or `during()` (a fixed-length window for a CSS
// transition). `__frames` on the console: `hz`, `resample()`, `begin(name)` → closer, and
// `sample(ms)` (a window of the given length whose summary resolves the promise — the
// hook for `scripts/webview-eval.mjs`).
//
// What this measures: the main thread's ability to produce a frame every period. A
// compositor-only stall (a heavy GPU blur) also delays rAF once the frame pipeline backs
// up, but a mild one can slip through — pair a suspicious skin with devtools'
// Rendering → Frame Rendering Stats.

import { invoke } from "@tauri-apps/api/core";
import { TELEMETRY } from "./telemetry-on";
import { nextPeriod } from "./frame-period";

const ON = TELEMETRY; // dev, or a VITE_PERF=1 release-shaped build (telemetry-on.ts)
const SCROLL_IDLE_MS = 150; // a scroll window closes this long after the last scroll event
const DROP_FACTOR = 1.5; // a frame gap over this × the period counts as dropped
const INPUT_SHOW_FRAMES = 2; // an input→paint over this many periods is logged
// Discrete inputs only — hover traffic (pointerover/out/enter/leave, mouseover…) shares
// the same frame and would repeat every slow line five to ten times.
const INPUT_KINDS = new Set(["pointerdown", "pointerup", "click", "keydown", "wheel", "auxclick", "dblclick"]);
const HZ_SAMPLES = 40;

interface Win {
  name: string;
  detail: string;
  t0: number;
  last: number; // last rAF timestamp seen (0 = none yet; the first gap runs from t0)
  gaps: number[];
  longTasks: number[];
  deadline?: number; // auto-closing windows (scroll, during)
  resolve?: (line: string) => void;
}

let period = 1000 / 60; // refreshed by the startup samples (sampleHz)
let sampled = false;   // has any valid refresh sample landed yet
let hz = 60;
const open = new Set<Win>();
let raf = 0;

const toLog = (line: string): void => {
  invoke("diag_flush", { text: line }).catch(() => {});
};

function tick(now: number): void {
  raf = 0;
  for (const w of open) {
    w.gaps.push(now - (w.last || w.t0)); // the first gap counts from begin(): a synchronous build shows up
    w.last = now;
    if (w.deadline !== undefined && now >= w.deadline) close(w);
  }
  if (open.size) raf = requestAnimationFrame(tick);
}

function ensureLoop(): void {
  if (!raf) raf = requestAnimationFrame(tick);
}

function close(w: Win): void {
  if (!open.delete(w)) return;
  const elapsed = Math.round(performance.now() - w.t0);
  const n = w.gaps.length;
  if (n < 2) return; // too short to say anything
  const first = Math.round(w.gaps[0]);
  const dropped = w.gaps.filter((g) => g > period * DROP_FACTOR).length;
  const worst = Math.round(Math.max(...w.gaps));
  const lt = w.longTasks.length ? ` · longtasks ${w.longTasks.length} (max ${Math.round(Math.max(...w.longTasks))} ms)` : "";
  const line =
    `[perf] frames ${w.name}${w.detail ? " " + w.detail : ""} ${elapsed} ms · ${n} frames @${hz} Hz` +
    ` · dropped ${dropped} (${((dropped / n) * 100).toFixed(1)}%) · worst ${worst} ms` +
    (first > period * DROP_FACTOR ? ` · first ${first} ms` : "") +
    lt;
  console.info(line);
  toLog(line);
  w.resolve?.(line);
}

function openWin(name: string, detail = ""): Win {
  const w: Win = { name, detail, t0: performance.now(), last: 0, gaps: [], longTasks: [] };
  open.add(w);
  ensureLoop();
  return w;
}

/** Start a window; the returned function closes it and prints the summary. */
export function begin(name: string, detail = ""): () => void {
  if (!ON) return () => {};
  const w = openWin(name, detail);
  return () => close(w);
}

/** A fixed-length window (a CSS transition): closes itself `ms` after it opens. */
export function during(name: string, ms: number, detail = ""): void {
  if (!ON) return;
  const w = openWin(name, detail);
  w.deadline = w.t0 + ms;
}

// ── automatic windows ────────────────────────────────────────────────────────
let scrollWin: Win | null = null;
const firstClass = (t: EventTarget | null): string =>
  t instanceof HTMLElement ? t.className.split(" ")[0] || t.tagName.toLowerCase() : "document";

function onScroll(e: Event): void {
  const now = performance.now();
  if (scrollWin && open.has(scrollWin)) {
    scrollWin.deadline = now + SCROLL_IDLE_MS;
    return;
  }
  scrollWin = openWin("scroll", firstClass(e.target));
  scrollWin.deadline = now + SCROLL_IDLE_MS;
}

function observeLongTasks(): void {
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) for (const w of open) if (e.startTime + e.duration >= w.t0) w.longTasks.push(e.duration);
    }).observe({ type: "longtask", buffered: false });
  } catch {
    /* not supported — the summary just lacks the longtasks tail */
  }
}

function observeInputs(): void {
  try {
    new PerformanceObserver((list) => {
      let lastFrame = -1; // pointerup + mouseup + click land in one frame: log the first only
      for (const e of list.getEntries() as PerformanceEventTiming[]) {
        if (!INPUT_KINDS.has(e.name) || e.duration < period * INPUT_SHOW_FRAMES) continue;
        const frame = e.startTime + e.duration; // the presentation time — equal for events painted together
        if (Math.abs(frame - lastFrame) < 1) continue;
        lastFrame = frame;
        const delay = Math.round(e.processingStart - e.startTime);
        const line = `[perf] input ${e.name} ${firstClass(e.target)} ${Math.round(e.duration)} ms (delay ${delay})`;
        console.info(line);
        toLog(line);
      }
    }).observe({ type: "event", buffered: false, durationThreshold: 16 } as PerformanceObserverInit);
  } catch {
    /* not supported */
  }
}

/**
 * Sample the display's refresh period. A frame gap can only ever be LONGER than the true
 * period — nothing renders faster than vsync — so busy work inflates gaps and nothing
 * deflates them. The truth therefore sits at the FAST end of the sample, not the middle.
 *
 * The median used to be taken here, once, 3 s after boot. One busy moment (a reload with a
 * profiler attached, a cold library paint) then pinned a 238 Hz display at 34 Hz for the
 * whole session, and every `dropped` verdict after it was judged against a 29 ms budget
 * instead of 4.2 ms — silently wrong, in the forgiving direction (2026-09-16). So: take a
 * low percentile, sample more than once, and only ever revise the period DOWN.
 */
const HZ_AT = [3000, 12000, 40000]; // when to sample: after launch, after settle, once warm
function sampleHz(): void {
  const gaps: number[] = [];
  let last = 0;
  const step = (now: number) => {
    if (last) gaps.push(now - last);
    last = now;
    if (gaps.length < HZ_SAMPLES) return void requestAnimationFrame(step);
    // The 20th percentile, and only ever DOWN after the first valid sample: frame-period.ts,
    // under test.
    const next = nextPeriod(gaps, period, sampled);
    if (next != null) {
      sampled = true;
      period = next;
      hz = Math.round(1000 / next);
    }
    const line = `[perf] display ${hz} Hz (period ${period.toFixed(2)} ms)`;
    console.info(line);
    toLog(line);
  };
  requestAnimationFrame(step);
}

/**
 * Which GPU actually drew this session, as one log line. `npm run dev:app -- --gpu=off`
 * pretends to be a weaker machine, and a flag that silently failed to take would make every
 * later number a lie — so the renderer string goes in the log next to the frame lines.
 * "SwiftShader", "Software" or "Basic Render Driver" means acceleration really is off; a card
 * name means it is on. WebView2 under `--gpu=off` falls back to WARP, Windows' own software
 * rasteriser, which names itself "Microsoft Basic Render Driver" (seen 2026-09-16), not SwiftShader.
 */
function logRenderer(): void {
  let name = "unknown";
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl") ?? c.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
    if (gl && dbg) name = String(gl.getParameter((dbg as { UNMASKED_RENDERER_WEBGL: number }).UNMASKED_RENDERER_WEBGL));
    const lost = gl?.getExtension("WEBGL_lose_context");
    lost?.loseContext(); // the probe must not hold a live context of its own
  } catch {
    /* no WebGL at all — leave it unknown */
  }
  const soft = /swiftshader|software|llvmpipe|basic render driver|warp/i.test(name);
  const line = `[perf] gpu ${soft ? "SOFTWARE" : "accelerated"} · ${name}`;
  console.info(line);
  toLog(line);
}

/** Install the automatic windows and the observers (dev only; call once at launch). */
export function init(): void {
  if (!ON) return;
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  observeLongTasks();
  observeInputs();
  HZ_AT.forEach((t) => window.setTimeout(sampleHz, t)); // one busy sample can no longer pin the rate
  window.setTimeout(logRenderer, 2000); // after the first paints, before the first hz line
  (window as any).__frames = {
    get hz() {
      return hz;
    },
    begin,
    resample: sampleHz, // force a fresh refresh-rate reading from the console
    sample: (ms = 1000, name = "sample"): Promise<string> =>
      new Promise((resolve) => {
        const w = openWin(name);
        w.deadline = w.t0 + ms;
        w.resolve = resolve;
      }),
  };
}
