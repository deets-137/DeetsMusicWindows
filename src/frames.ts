// Dev-only frame telemetry — the smoothness counterpart of perf.ts (click-to-sound).
// Gated on Vite's DEV flag like perf.ts: the installed build ships none of it.
//
// A "window" is one interaction we want buttery: a scroll, a scrub drag, a pane slide,
// a folder open, a queue drag, a menu open, an appearance switch. While at least one
// window is open, a requestAnimationFrame loop measures the gap between consecutive
// frames. Against the display's own refresh period (sampled at startup), a gap over
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
// Scroll windows open themselves (a capturing scroll listener) and close 150 ms after
// the last scroll event. Everything else is begun/ended by the gesture's own code via
// `begin()` (returns the closer) or `during()` (a fixed-length window for a CSS
// transition). `__frames` on the console: `hz`, `begin(name)` → closer, and
// `sample(ms)` (a window of the given length whose summary resolves the promise — the
// hook for `scripts/webview-eval.mjs`).
//
// What this measures: the main thread's ability to produce a frame every period. A
// compositor-only stall (a heavy GPU blur) also delays rAF once the frame pipeline backs
// up, but a mild one can slip through — pair a suspicious skin with devtools'
// Rendering → Frame Rendering Stats.

import { invoke } from "@tauri-apps/api/core";

const ON = import.meta.env.DEV;
const SCROLL_IDLE_MS = 150; // a scroll window closes this long after the last scroll event
const DROP_FACTOR = 1.5; // a frame gap over this × the period counts as dropped
const INPUT_SHOW_FRAMES = 2; // an input→paint over this many periods is logged
const HZ_SAMPLES = 40;

interface Win {
  name: string;
  detail: string;
  t0: number;
  last: number; // last rAF timestamp seen (0 = none yet)
  gaps: number[];
  longTasks: number[];
  deadline?: number; // auto-closing windows (scroll, during)
  resolve?: (line: string) => void;
}

let period = 1000 / 60; // refreshed by the startup sample
let hz = 60;
const open = new Set<Win>();
let raf = 0;

const toLog = (line: string): void => {
  invoke("diag_flush", { text: line }).catch(() => {});
};

function tick(now: number): void {
  raf = 0;
  for (const w of open) {
    if (w.last) w.gaps.push(now - w.last);
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
  const dropped = w.gaps.filter((g) => g > period * DROP_FACTOR).length;
  const worst = Math.round(Math.max(...w.gaps));
  const lt = w.longTasks.length ? ` · longtasks ${w.longTasks.length} (max ${Math.round(Math.max(...w.longTasks))} ms)` : "";
  const line =
    `[perf] frames ${w.name}${w.detail ? " " + w.detail : ""} ${elapsed} ms · ${n} frames @${hz} Hz` +
    ` · dropped ${dropped} (${((dropped / n) * 100).toFixed(1)}%) · worst ${worst} ms${lt}`;
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
      for (const e of list.getEntries() as PerformanceEventTiming[]) {
        if (e.duration < period * INPUT_SHOW_FRAMES) continue;
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

// The display's refresh period: the median gap over a short idle rAF run. Sampled
// once, after the launch work has settled, so a 144 Hz panel is not read as 60.
function sampleHz(): void {
  const gaps: number[] = [];
  let last = 0;
  const step = (now: number) => {
    if (last) gaps.push(now - last);
    last = now;
    if (gaps.length < HZ_SAMPLES) return void requestAnimationFrame(step);
    gaps.sort((a, b) => a - b);
    const med = gaps[Math.floor(gaps.length / 2)];
    if (med > 2 && med < 100) {
      period = med;
      hz = Math.round(1000 / med);
    }
    const line = `[perf] display ${hz} Hz (period ${period.toFixed(2)} ms)`;
    console.info(line);
    toLog(line);
  };
  requestAnimationFrame(step);
}

/** Install the automatic windows and the observers (dev only; call once at launch). */
export function init(): void {
  if (!ON) return;
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  observeLongTasks();
  observeInputs();
  window.setTimeout(sampleHz, 3000); // after warmPlayer (1.5 s) and the launch renders
  (window as any).__frames = {
    get hz() {
      return hz;
    },
    begin,
    sample: (ms = 1000, name = "sample"): Promise<string> =>
      new Promise((resolve) => {
        const w = openWin(name);
        w.deadline = w.t0 + ms;
        w.resolve = resolve;
      }),
  };
}
