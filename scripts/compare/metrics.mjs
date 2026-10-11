// The judge's rules (music-app-comp.md §17.3, §1.4, §12): deetsmeter events → timings →
// medians, spreads and marks. Pure: no files, no processes. tests/compare-metrics.test.ts.

/** A row whose spread is over this is NOISY and is not quoted (§1.4). */
export const NOISY_SPREAD = 0.08;

/** The floor of each kind of number (§12): a change smaller than this is no change. */
export const FLOORS = { screen: 8, sound: 10, fps: "3%", drop: 0.5, start: "5%" };

/**
 * One entry per input event: what happened after it, before the next input.
 * - `changeMs`: the first frame that changed in the input's probe. With no probe the whole
 *   region is the measure, and a window that animates on its own changes on every frame
 *   (§17.9), so an input without a probe gets null.
 * - `soundMs`: the first `sound-on` (a start after silence, or after a gap; audio.rs).
 * - `stopMs`: the first `sound-off` (the old sound's end), for a Next.
 */
export function inputTimings(events) {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const inputs = sorted.filter((e) => e.ev === "input");
  return inputs.map((inp, k) => {
    const t = inp.t;
    const next = k + 1 < inputs.length ? inputs[k + 1].t : Infinity;
    const inside = (e) => e.t > t && e.t < next;
    const first = (pred) => sorted.find((e) => inside(e) && pred(e));
    // Typed text is timed from its LAST key: the one a search result waits on (§2.3). A
    // change while the query was still being typed is not the result.
    const end = inp.kind === "text" ? sorted.find((e) => e.ev === "input-end" && e.step === inp.step && e.t >= t) : undefined;
    const t0 = end?.t ?? t;
    const ms = (e) => (e ? (e.t - t) / 1000 : null);
    const change = inp.probe ? first((e) => e.ev === "frame" && e.t > t0 && e.probes?.[inp.probe]?.c === true) : undefined;
    const sound = first((e) => e.ev === "sound-on");
    const settled = inp.probe ? first((e) => e.ev === "settled" && e.probe === inp.probe) : undefined;
    const motionAt = settled?.last_change ?? null;
    return {
      // The sensor names an untagged step "s07-key": a helper press (a clear), never a row.
      tag: inp.tag && !/^s\d+-\w+$/.test(inp.tag) ? inp.tag : null,
      name: inp.name ?? null,
      t,
      callMs: inp.call_us != null ? inp.call_us / 1000 : null,
      changeMs: change ? (change.t - t0) / 1000 : null,
      // Settled before the last key (the results were already up): 0, "done by the last key".
      settledMs: motionAt != null ? Math.max(0, (motionAt - t0) / 1000) : null,
      ...(change && motionAt != null && motionAt > change.t ? motion(sorted, inp.probe, change.t, motionAt, hzOf(sorted)) : {}),
      soundMs: ms(sound),
      soundGapMs: sound?.gap_ms ?? null,
      stopMs: ms(first((e) => e.ev === "sound-off")),
    };
  });
}

/**
 * A start (§4 scenes 1–2, §17.3): `close` → `gone` (the quit), `launch` → `shown` (the
 * window), → the first frame where the `content` probe is not one flat colour (content), →
 * the last change before the probe went quiet (settled).
 *
 * Frames count only from the moment the new window was surely on top: `shown` when it was
 * lifted there and opened inside the region (it reopens where it was closed), else
 * `placed`. Before that the region shows whatever was under it (the first Apple restart,
 * 2026-10-10, timed the Claude app's frames). Content already up at that moment reads as
 * that moment: no earlier time can be seen.
 */
export function startTimings(events, probe = "content") {
  const s = [...events].sort((a, b) => a.t - b.t);
  const launch = s.find((e) => e.ev === "launch");
  const close = s.find((e) => e.ev === "input" && e.kind === "close");
  const gone = s.find((e) => e.ev === "gone");
  const out = { quitMs: close && gone ? (gone.t - close.t) / 1000 : null, windowMs: null, contentMs: null, settledMs: null };
  if (!launch) return out;
  const shown = s.find((e) => e.ev === "shown" && e.t > launch.t);
  if (!shown) return out;
  out.windowMs = (shown.t - launch.t) / 1000;
  const placed = s.find((e) => e.ev === "placed" && e.t >= shown.t);
  const same = (a, b) => a && b && a.every((v, i) => Math.abs(v - b[i]) <= 2);
  const from = shown.lifted && placed && same(shown.frame, placed.frame) ? shown.t : placed?.t;
  if (from == null) return out;
  // Content is the first frame of the LAST not-flat stretch before the settle: Windows fades
  // a new window in over what was under it (about 90 ms of "not flat"), and Apple's then
  // stays one black colour for seconds while it loads (2026-10-10).
  const settled = s.find((e) => e.ev === "settled" && e.probe === probe && e.t > from);
  const until = settled?.t ?? Infinity;
  const pf = s.filter((e) => e.ev === "frame" && e.t >= from && e.t <= until && e.probes?.[probe]?.flat !== undefined);
  let lastFlat = -1;
  pf.forEach((e, i) => {
    if (e.probes[probe].flat) lastFlat = i;
  });
  const content = pf.slice(lastFlat + 1).find((e) => e.probes[probe].flat === false);
  if (content) out.contentMs = (content.t - launch.t) / 1000;
  if (settled && content) out.settledMs = (Math.max(settled.last_change ?? from, content.t) - launch.t) / 1000;
  return out;
}

/** The display rate of the run (the sensor's `output` event). */
const hzOf = (sorted) => sorted.find((e) => e.ev === "output")?.hz ?? null;

/**
 * The motion window of a gesture (§17.3): from its first change to its last change before
 * the probe went quiet. Only frames that changed the probe count; a screen that does not move
 * gives no frames, so fps is never read outside this window.
 * - `fps`: changed frames ÷ the window's length.
 * - `dropPct`: the share of gaps over 1.5 display periods (a frame the app did not deliver).
 * - `p99Ms`: the 99th percentile of the gaps between changed frames.
 */
export function motion(sorted, probe, from, to, hz) {
  const times = sorted.filter((e) => e.ev === "frame" && e.t >= from && e.t <= to && e.probes?.[probe]?.c === true).map((e) => e.t);
  if (times.length < 2) return { fps: null, dropPct: null, p99Ms: null, frames: times.length };
  const gaps = times.slice(1).map((v, i) => (v - times[i]) / 1000);
  const period = hz ? 1000 / hz : null;
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  return {
    frames: times.length,
    fps: (times.length - 1) / ((to - from) / 1e6),
    dropPct: period ? (gaps.filter((g) => g > 1.5 * period).length / gaps.length) * 100 : null,
    p99Ms: quantile(sortedGaps, 0.99),
  };
}

/** The tag without its trailing count: "next2" → "next". Repeats of one press pool. */
export const tagKind = (tag) => (tag ?? "").replace(/\d+$/, "");

/** The value at fraction p of a sorted list, interpolated. */
function quantile(s, p) {
  if (!s.length) return NaN;
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

/** Median, range, quartiles and spread of a sample. Spread = (max − min) ÷ median (§1.4). */
export function summarize(values) {
  const s = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return { n: 0, median: null, min: null, max: null, q1: null, q3: null, spread: null, noisy: false };
  const median = quantile(s, 0.5);
  const spread = median > 0 ? (s[s.length - 1] - s[0]) / median : 0;
  return {
    n: s.length,
    median,
    min: s[0],
    max: s[s.length - 1],
    q1: quantile(s, 0.25),
    q3: quantile(s, 0.75),
    spread,
    noisy: s.length > 1 && spread > NOISY_SPREAD,
  };
}

/**
 * The §12 mark of `cur` against `prev` for a number where lower is better (every timing).
 * ▲ an upgrade, ▼ a regression, = no change (also when either side is NOISY, the ranges
 * overlap, or the move is inside the tool's floor). Under 5 samples the ranges are min..max
 * (the worst of the better run beats the best of the worse); from 5, median ± the IQR.
 */
export function mark(prev, cur, floor, higherBetter = false) {
  if (!prev?.n || !cur?.n || prev.noisy || cur.noisy) return "=";
  // A floor written "3%" is a share of the median (fps, §12); a number is in the row's unit.
  const f = typeof floor === "string" ? (parseFloat(floor) / 100) * prev.median : floor;
  if (Math.abs(cur.median - prev.median) <= f) return "=";
  const range = (r) => (Math.min(prev.n, cur.n) >= 5 ? [r.median - (r.q3 - r.q1), r.median + (r.q3 - r.q1)] : [r.min, r.max]);
  const [pLo, pHi] = range(prev);
  const [cLo, cHi] = range(cur);
  const lower = cHi < pLo;
  const higher = cLo > pHi;
  if (lower) return higherBetter ? "▼" : "▲";
  if (higher) return higherBetter ? "▲" : "▼";
  return "=";
}

/**
 * The scene's rows from the passes of one app: `passes` is a list of inputTimings() results.
 * Each row names a metric ("play → sound"), its kind (for the floor) and its summary.
 */
export function sceneRows(passes, { motion = [] } = {}) {
  const pools = new Map();
  const add = (metric, kind, v) => {
    if (v == null) return;
    if (!pools.has(metric)) pools.set(metric, { kind, values: [] });
    pools.get(metric).values.push(v);
  };
  for (const pass of passes) {
    for (const x of pass) {
      const k = tagKind(x.tag);
      if (!k) continue;
      add(`${k} → screen`, "screen", x.changeMs);
      add(`${k} → settled`, "screen", x.settledMs);
      // fps, dropped and p99 only for a gesture that MOVES the screen (a scroll); results
      // that appear are a first change and a settle, not a motion.
      if (motion.includes(k)) {
        add(`${k} fps`, "fps", x.fps);
        add(`${k} dropped %`, "drop", x.dropPct);
        add(`${k} p99 frame`, "screen", x.p99Ms);
      }
      add(`${k} → sound`, "sound", x.soundMs);
    }
  }
  return [...pools].map(([metric, { kind, values }]) => ({ metric, kind, unit: UNITS[kind], higherBetter: kind === "fps", ...summarize(values) }));
}

const UNITS = { screen: "ms", sound: "ms", fps: "fps", drop: "%", start: "ms" };

/** The start scene's rows from the passes of one app: each pass is a startTimings() result. */
export function startRows(passes, prefix = "start") {
  const rows = [
    ["close → gone", "quitMs"],
    [`${prefix} → window`, "windowMs"],
    [`${prefix} → content`, "contentMs"],
    [`${prefix} → settled`, "settledMs"],
  ];
  return rows
    .map(([metric, k]) => ({ metric, kind: "start", unit: "ms", higherBetter: false, ...summarize(passes.map((p) => p[k])) }))
    .filter((r) => r.n > 0);
}

/** Machine-wide CPU use (0–1) between two os.cpus() readings: the idle gate (§3, §12.1). */
export function cpuBusy(before, after) {
  let busy = 0;
  let all = 0;
  for (let i = 0; i < Math.min(before.length, after.length); i++) {
    const a = before[i].times;
    const b = after[i].times;
    const total = (b.user - a.user) + (b.nice - a.nice) + (b.sys - a.sys) + (b.irq - a.irq) + (b.idle - a.idle);
    all += total;
    busy += total - (b.idle - a.idle);
  }
  return all > 0 ? busy / all : 0;
}
