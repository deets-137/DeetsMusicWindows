// Press "Record player" (docs/features/VINYL.md). The cover box keeps its art in a slot (.vinyl):
// a plate that does not turn, and the art that turns (.vinyl__spin). CSS decides whether
// the slot looks like a record in this place (--vinyl on .np__art: the skin, the rows and
// the surface); everywhere else it draws the plain square cover. The Now Playing card and the
// tray panel both use it.
//
// The angle follows the song, not the clock (§4): angle = 360° × position ÷ period, and the
// period is one turn at the Spin speed row's rate (33⅓, 45 or 78 rpm) stretched so the song
// lasts a whole number of turns — each disc starts upright and ends upright. A song change slides the old disc out and the new one in (§5).
// Both motions are Web Animations with plain values, so the compositor runs them: a song
// change is exactly when MusicKit keeps the main thread busy.
//
// A jump is always visible; a speed change of a few percent never is. So a disc starts at 0°
// when its sound starts, and after that it only speeds up or slows down to stay on the song.
// It snaps only for a real seek (§4 "Corrections").

import { invoke } from "@tauri-apps/api/core";
import { setting, onSettingsChange } from "./settings-store";
import { TELEMETRY } from "./telemetry-on";
import { spinEasing } from "./spin-steps";
import { displayHz, onDisplayHz } from "./display-hz";

// Dev-only telemetry (VINYL.md §Telemetry), gated on Vite's DEV flag like frames.ts: a
// `[perf] vinyl snap …` line for every jump and one `[perf] vinyl song …` summary per song,
// in the console and the dev log. `__vinyl.sample(ms)` returns the disc's error, row by row.
const TEL = TELEMETRY; // dev, or a VITE_PERF=1 release-shaped build (telemetry-on.ts)
const telLine = (line: string): void => {
  if (!TEL) return;
  console.info(line);
  invoke("diag_flush", { text: line }).catch(() => {});
};
type Sampler = (ms: number) => Promise<unknown[]>;
const samplers: Sampler[] = []; // newest last: the card in the main window, the disc in the tray panel
declare global {
  interface Window {
    __vinyl?: { readonly discs: number; sample: (ms?: number, i?: number) => Promise<unknown[]> };
  }
}
if (TEL) {
  window.__vinyl = {
    get discs() {
      return samplers.length;
    },
    /** Rows every 100 ms: [position s, disc error ms (+ = disc behind), rate, play state]. */
    sample: (ms = 3000, i = samplers.length - 1) => samplers[i]?.(ms) ?? Promise.resolve(["no disc"]),
  };
}

const RPM: Record<string, number> = { "16": 50 / 3, "33": 100 / 3, "45": 45, "78": 78 }; // the four record speeds
/** One turn, in seconds, at the speed the row asks for (16⅔ rpm = 3.6 s, 33⅓ rpm = 1.8 s). */
const turnS = (): number => 60 / (RPM[setting("pressVinylSpeed")] ?? RPM["16"]);
const SEEK_S = 1.5; // an exact reading this far from the disc is a seek: snap to it…
const SNAP_MIN_DEG = 50; // …but only when the disc is this far off; less is a speed change.
// An angle, not a time: 50° is 250 ms of a 33⅓ turn and 107 ms of a 78 rpm turn.
const RATE_CAP = 0.05; // anything smaller is closed by running up to 5% fast or slow…
const CATCH_MS = 1500; // …over about this long
const DECODE_WAIT_MS = 300; // the longest a slide waits for the new cover to decode
const NEXT_SONG_WAIT_MS = 600; // how long a jump back to 0 waits for the new song's cover
const STALE_S = 2; // just after a song change, a reading past this is still the old song…
const STALE_MS = 1500; // …for this long (then it is a resume at a saved position)
const SEEK_LAND_MS = 1500; // after a scrub, readings far from where it was let go are the old position…
const SEEK_NEAR_S = 1; // …until one lands within this of it

const root = document.documentElement;
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const spinWanted = () => root.dataset.skin === "press" && setting("pressVinyl") === "spin" && !reduced();

/** The period for a song: one turn at the chosen speed, stretched so the song lasts a whole
 *  number of turns. Every speed keeps that rule, so a disc always starts and ends upright. */
export const periodFor = (duration: number, turn = turnS()): number =>
  duration > 0 ? duration / Math.max(1, Math.round(duration / turn)) : turn;

/** A CSS time token ("0.42s" / "420ms") in ms. */
const ms = (v: string): number => {
  const n = parseFloat(v);
  if (!isFinite(n)) return 0;
  return v.trim().endsWith("ms") ? n : n * 1000;
};

export interface Vinyl {
  /** Show a song's cover. `song` is its identity (a new one slides); no `src` = the ♪ placeholder. */
  /** `back`: the turn runs as Previous (the caller asks the queue); undefined: vinyl.ts guesses. */
  show(song: string, src: string | undefined, back?: boolean): void;
  playing(on: boolean): void;
  /** The play position in seconds. `duration` 0 = no end (a live station): the disc turns freely.
   *  `exact`: a real clock (the audio element); false = MusicKit's whole-second count. */
  position(sec: number, duration: number, exact: boolean): void;
  /** The scrubber is dragged to `sec` (the disc follows the hand); `done` when it is let go. */
  scrub(sec: number, done?: boolean): void;
  /** The window cannot be seen: hold the disc still. */
  suspend(on: boolean): void;
  destroy(): void;
}

// Which way a song change turns, for every mount in this window: a return to the song before is
// Previous. Module-wide, so a card rebuilt by a surface change still knows (the break-it pass,
// 2026-10-20: per mount, the first Previous after a rebuild turned forward), and a second mount
// on the same change gets the same answer.
const turns = { recent: [] as string[], last: null as { song: string; back: boolean } | null };
function turnBack(next: string, known?: boolean): boolean {
  if (turns.last?.song === next) return turns.last.back;
  const r = turns.recent;
  // The caller's answer (the queue) wins; the list is the fallback for a station or a jump.
  const back = known ?? (r.length >= 2 && r[r.length - 2] === next);
  if (back) r.pop();
  else r.push(next);
  if (r.length > 20) r.shift();
  turns.last = { song: next, back };
  return back;
}

export function mountVinyl(box: HTMLElement, glyph: string): Vinyl {
  let slot: HTMLElement | null = null;
  let song: string | null = null;
  let src: string | undefined;
  let gen = 0; // bumps on every song change: a slide still waiting on a decode checks it
  let anim: Animation | null = null;
  let easing = ""; // the easing `anim` has: the Spin FPS row's steps, or linear (spin-steps.ts)
  let period = turnS();
  let dur = 0;
  let pos = 0; // the best position now, in seconds
  let lastRaw = -1; // the last reading as given
  let exactNow = false; // the last reading came from a real clock
  let isPlaying = false;
  let moved = false; // the reading has moved since the song started or play resumed
  let started = false; // this disc has turned since its song (or a scrub) began
  let scrubbing = false;
  let suspended = false;
  let shownAt = 0; // performance.now() of the last song change
  let seekTo = -1; // where a scrub was let go, until MusicKit reports it (−1 = none)
  let seekUntil = 0;
  let posAt = 0; // performance.now() when `pos` was last read

  // Telemetry for the current song (dev only; see the top of the file).
  const freshTel = () => ({
    start: "",
    snaps: [] as string[],
    worstErr: 0,
    maxRate: 1,
    minRate: 1,
    stale: 0,
    seekHeld: 0,
    zeroHeld: 0,
    scrubs: 0,
  });
  let tel = freshTel();
  const deg = (t: number, pMs: number) => Math.round((((t % pMs) + pMs) % pMs) / pMs * 360);
  /** The signed error now: + = the disc is behind the song. */
  const errNow = (a: Animation, pMs: number): number => {
    const running = a.playState === "running" && isPlaying;
    const want = ((pos + (running ? (performance.now() - posAt) / 1000 : 0)) * 1000) % pMs;
    let err = want - (Number(a.currentTime ?? 0) % pMs);
    if (err > pMs / 2) err -= pMs;
    else if (err < -pMs / 2) err += pMs;
    return err;
  };
  const songSummary = () => {
    if (!TEL || !tel.start) return;
    const a = anim;
    const pMs = period * 1000;
    const left = a ? ` · left at ${deg(Number(a.currentTime ?? 0), pMs)}°` : "";
    const turns = dur > 0 ? Math.round(dur / period) : 0;
    // How much of a turn one frame of this display carries: 3.3° at 33⅓ rpm on a 60 Hz panel,
    // 7.8° at 78 rpm. A 120 or 144 Hz panel draws the same turn in smaller steps.
    const hz = window.__frames?.hz ?? 60;
    const rpm = (60 / period).toFixed(1);
    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    telLine(
      `[perf] vinyl song ${dur > 0 ? fmt(dur) : "live"} · period ${pMs.toFixed(1)} ms${turns ? ` (${turns} turns)` : ""}` +
        ` · ${rpm} rpm, ${(360 / (period * hz)).toFixed(1)}°/frame @${hz} Hz` +
        ` · start ${tel.start} · snaps ${tel.snaps.length}${tel.snaps.length ? ` (${tel.snaps.join(", ")})` : ""}` +
        ` · nudge worst ${Math.round(tel.worstErr)} ms, rate ${tel.minRate.toFixed(3)}–${tel.maxRate.toFixed(3)}` +
        ` · held stale ${tel.stale} · seek ${tel.seekHeld} · zero ${tel.zeroHeld} · scrubs ${tel.scrubs}${left}`,
    );
  };
  const noteSnap = (reason: string, a: Animation, pMs: number) => {
    if (!TEL) return;
    const e = Math.round(errNow(a, pMs));
    tel.snaps.push(`${reason} ${e} ms`);
    telLine(`[perf] vinyl snap ${reason} · err ${e} ms · at ${pos.toFixed(2)} s`);
  };
  let pending: { sec: number; duration: number; exact: boolean } | null = null; // a jump to 0 held for show()
  let pendingTimer = 0;

  // Whole-second readings (MusicKit's count rounds down). A reading of N means the song is in
  // [N, N+1), and a count one higher than the last reading means it crossed N after that
  // reading. Each bounds the offset φ = position − clock; the bounds intersect down to a few ms.
  // Readings that cannot all be true mean a seek or a stall: restart from the new one.
  let phiLo = -Infinity;
  let phiHi = Infinity;
  let lastCountAt = 0;
  let lastCount = -1;
  const resetClock = () => {
    phiLo = -Infinity;
    phiHi = Infinity;
    lastCount = -1;
  };
  const estimate = (whole: number): { sec: number; seek: boolean } => {
    const t = performance.now() / 1000;
    const lo = whole - t;
    let hi = whole + 1 - t;
    if (lastCount >= 0 && whole === lastCount + 1) hi = Math.min(hi, whole - lastCountAt);
    let seek = false;
    if (Math.max(phiLo, lo) > Math.min(phiHi, hi)) {
      seek = lastCount >= 0;
      phiLo = lo;
      phiHi = hi;
    } else {
      phiLo = Math.max(phiLo, lo);
      phiHi = Math.min(phiHi, hi);
    }
    lastCount = whole;
    lastCountAt = t;
    return { sec: (phiLo + phiHi) / 2 + t, seek };
  };

  const build = (s: string | undefined): HTMLElement => {
    const el = document.createElement("div");
    el.className = s ? "vinyl" : "vinyl vinyl--glyph";
    if (s) {
      el.innerHTML = '<div class="vinyl__plate"></div><div class="vinyl__spin"><img alt="" data-art /></div>';
      const img = el.querySelector("img")!;
      img.decoding = "async";
      img.src = s;
    } else {
      el.innerHTML = glyph;
    }
    return el;
  };
  // Slots sit under the station chip, which the card appends to the box.
  const place = (el: HTMLElement) => box.insertBefore(el, box.querySelector(".np__station"));
  const spinEl = () => slot?.querySelector<HTMLElement>(".vinyl__spin") ?? null;
  const held = () => suspended || root.dataset.ambient === "paused";
  const isRecordHere = () => getComputedStyle(box).getPropertyValue("--vinyl").trim() === "1";
  // A skin may move a plain cover on a song change too (--cover-swap, base `none`): `zoetrope`
  // is the Metal draft's (docs/features/metal.md §6.1). The record's own slide wins where it shows.
  const coverSwap = () => getComputedStyle(box).getPropertyValue("--cover-swap").trim() || "none";

  const setDuration = (duration: number) => {
    const d = duration > 0 && isFinite(duration) ? duration : 0;
    if (d === dur) return;
    dur = d;
    period = periodFor(d);
  };

  /** `snap`: why the disc may jump to the position (a seek); false = it only changes speed. */
  const sync = (why: false | "seek" | "count" | "zero" = false) => {
    let snap = why;
    const el = spinEl();
    if (!el || !spinWanted()) {
      anim?.cancel();
      anim = null;
      return;
    }
    const pMs = period * 1000;
    const target = (pos * 1000) % pMs;
    // The Spin FPS row: n steps a turn at a rate that divides the display's (VINYL.md §12).
    const want = spinEasing(period, displayHz(), Number(setting("pressVinylFps")) || 120);
    if (!anim || (anim.effect as KeyframeEffect | null)?.target !== el) {
      anim = el.animate([{ transform: "rotate(0turn)" }, { transform: "rotate(1turn)" }], {
        duration: pMs,
        iterations: Infinity,
        easing: want,
      });
      easing = want;
      anim.pause();
      anim.currentTime = started ? target : 0;
    } else {
      if (anim.effect?.getTiming().duration !== pMs) anim.effect?.updateTiming({ duration: pMs });
      if (easing !== want) {
        anim.effect?.updateTiming({ easing: want });
        easing = want;
      }
    }
    if (scrubbing) return;
    // A seek that leaves the disc nearly right is not worth a visible hop (the log showed a
    // "seek" snap of 40 ms at a station song change): close it by speed instead.
    if (snap && started && Math.abs(errNow(anim, pMs)) / pMs * 360 < SNAP_MIN_DEG) snap = false;
    const live = dur <= 0;
    // A song's disc waits at 0° until its sound starts: the exact clock moves. A count can't say
    // that soon enough, so then the play flag alone starts it.
    // A resume (this disc already turned) starts on the play flag at once: the sound is
    // already there, and waiting a report for the clock to move left it ~260 ms behind.
    const run = isPlaying && !held() && (live || moved || !exactNow || started);
    if (!run) {
      if (anim.playState === "running") anim.pause(); // keeps its angle: no jump on pause
      if (snap && !live) {
        noteSnap(snap, anim, pMs);
        anim.currentTime = target;
      }
      return;
    }
    if (anim.playState !== "running") {
      // First start of this song: from 0° (or from the position, when it resumes mid-song).
      if (!started && !live) {
        anim.currentTime = pos < SEEK_S ? (exactNow ? target : 0) : target;
        if (TEL) tel.start = `${deg(Number(anim.currentTime), pMs)}° ${exactNow ? "exact" : "count"} at ${pos.toFixed(2)} s`;
      } else if (snap && !live) {
        noteSnap(snap, anim, pMs);
        anim.currentTime = target;
      }
      started = true;
      anim.playbackRate = 1;
      anim.play();
      return;
    }
    if (live) return;
    if (snap) {
      noteSnap(snap, anim, pMs);
      anim.currentTime = target;
      anim.updatePlaybackRate(1);
      return;
    }
    const now = Number(anim.currentTime ?? 0) % pMs;
    let err = target - now;
    if (err > pMs / 2) err -= pMs;
    else if (err < -pMs / 2) err += pMs;
    const rate = 1 + Math.max(-RATE_CAP, Math.min(RATE_CAP, err / CATCH_MS));
    anim.updatePlaybackRate(rate);
    if (TEL) {
      tel.worstErr = Math.max(tel.worstErr, Math.abs(err));
      tel.maxRate = Math.max(tel.maxRate, rate);
      tel.minRate = Math.min(tel.minRate, rate);
    }
  };

  const sample: Sampler = async (ms) => {
    const rows: unknown[] = [];
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const a = anim;
      if (!a) rows.push(["no animation", pos.toFixed(2)]);
      else {
        const pMs = period * 1000;
        const running = a.playState === "running" && isPlaying;
        const p = pos + (running ? (performance.now() - posAt) / 1000 : 0);
        rows.push([+p.toFixed(2), Math.round(errNow(a, pMs)), +a.playbackRate.toFixed(3), a.playState]);
      }
      await new Promise((r) => window.setTimeout(r, 100));
    }
    return rows;
  };
  if (TEL) samplers.push(sample);

  // A cover's stacking order during a turn, set now or after `ms`; a newer call drops a pending
  // one (a rapid press turns the arriving cover into the leaving one).
  const stackTimers = new WeakMap<HTMLElement, number>();
  const stack = (e: HTMLElement, z: number, ms = 0) => {
    window.clearTimeout(stackTimers.get(e));
    if (ms <= 0) { e.style.zIndex = String(z); return; }
    stackTimers.set(e, window.setTimeout(() => { e.style.zIndex = String(z); }, ms));
  };
  /** Slide `old` out and `el` in, once `el`'s cover is decoded (or DECODE_WAIT_MS passed). */
  const slide = (old: HTMLElement, el: HTMLElement, back: boolean) => {
    const mine = gen;
    old.classList.add("vinyl--out");
    el.style.opacity = "0"; // hidden until it can move in whole
    const img = el.querySelector("img");
    const decoded = img ? img.decode().catch(() => {}) : Promise.resolve();
    const wait = new Promise((r) => window.setTimeout(r, DECODE_WAIT_MS));
    // The zoetrope's old cover retreats first and needs nothing from the new picture, so it
    // starts at once: waiting for the decode left a still moment after the press (the review).
    // The new cover waits in its slot meanwhile (--zoetrope-stagger), time enough to decode.
    const now = !isRecordHere() && coverSwap() === "zoetrope";
    void (now ? Promise.resolve() : Promise.race([decoded, wait])).then(() => {
      el.style.opacity = "";
      if (mine !== gen || !old.isConnected) return; // a newer change already cleared it
      const cs = getComputedStyle(box);
      const x = parseFloat(cs.getPropertyValue("--vinyl-x")) || 0;
      const y = parseFloat(cs.getPropertyValue("--vinyl-y")) || 0;
      const travel = (parseFloat(cs.getPropertyValue("--vinyl-swap-travel")) || 110) / 100;
      const fade = parseFloat(cs.getPropertyValue("--vinyl-swap-fade")) || 0;
      const scale = parseFloat(cs.getPropertyValue("--motion-scale")) || 1;
      const duration = ms(cs.getPropertyValue("--vinyl-swap-dur")) * scale;
      const easing = cs.getPropertyValue("--vinyl-swap-ease").trim() || "ease-in-out";
      const d = back ? -1 : 1;
      if (!isRecordHere() && coverSwap() === "zoetrope") {
        // Two songs from one album share a cover: turning a picture onto itself reads as a
        // glitch (the design review, metal.md §6.1), so the cover simply stays.
        const pic = (e: HTMLElement) => e.querySelector("img")?.src ?? "";
        if (pic(old) && pic(old) === pic(el)) { old.remove(); return; }
        // Covers on a drum: the old one shrinks and turns away to the left, the next comes in
        // from the right, turned, and grows to the front. Back runs it the other way. The box
        // clips it (the draft's clip-path); a theme fade must not lift it out (metal-draft.css).
        // Where the turn starts and ends is the skin's (--zoetrope-*): far off and faded by
        // default; with the draft's peek, exactly where the side covers wait, dimmed as they are.
        const num = (p: string, dflt: number) => { const v = parseFloat(cs.getPropertyValue(p)); return Number.isFinite(v) ? v : dflt; };
        const run = old.offsetWidth * num("--zoetrope-run", 0.5) * d;
        const turn = num("--zoetrope-turn", 58) * d;
        const small = num("--zoetrope-scale", 0.6);
        const away = num("--zoetrope-fade", 0);
        const dim = `brightness(${num("--zoetrope-dim", 1)})`;
        // A cover set back on the drum shows at `s` at depth P − P / s: the same transform as
        // Metal's side covers (styles.css "Metal"), so a cover lands exactly on its slot.
        // A cover set back on the drum shows at `s` at depth P − P / s: the same transform as
        // Metal's side covers (styles.css "Metal"), so a cover lands exactly on its slot.
        const P = num("--zoetrope-perspective", 900);
        const drum = (dx: number, deg: number, s: number) =>
          `perspective(${P}px) translateX(${dx}px) translateZ(${s >= 1 ? 0 : P - P / s}px) rotateY(${deg}deg)`;
        // --zoetrope-stagger (0–1): how long the next cover waits in its slot while the old one
        // retreats first (his call, 2026-10-20: the next cover must not land on top of the old
        // one). 0 (the base): both move together.
        const stagger = Math.min(0.8, Math.max(0, num("--zoetrope-stagger", 0)));
        const back = Math.min(1, Math.max(0.1, num("--zoetrope-leave", stagger + 0.35))); // the share of the turn the old cover takes to reach its slot
        const front = { transform: drum(0, 0, 1), opacity: 1, filter: "brightness(1)" };
        const behind = (dx: number, deg: number) => ({ transform: drum(dx, deg, small), opacity: away, filter: dim });
        // The retreat has its own curve (--zoetrope-leave-ease; empty: the turn's): an ease-out
        // spent the retreat in its first ~100 ms, and the screen then stood still until the next
        // cover set off, which read as the turn sticking (his report, 2026-10-20).
        const leave = cs.getPropertyValue("--zoetrope-leave-ease").trim() || easing;
        const lead = Math.min(0.3, Math.max(0, num("--zoetrope-lead", 0))); // the share of its move it grows under the old cover first
        const rise = Math.min(0.9, Math.max(0, num("--zoetrope-rise", 0.35))); // the share of its move the arriving cover fades in over
        // A press during a turn: the cover that was arriving leaves from where it is now, not
        // from the front (it jumped there for a frame: his report, rapid Back / Next).
        const at = getComputedStyle(old);
        const from = {
          transform: at.transform === "none" ? front.transform : at.transform,
          opacity: Number(at.opacity),
          filter: at.filter === "none" ? front.filter : at.filter,
        };
        old.getAnimations().forEach((a) => a.cancel());
        old.style.opacity = "";
        // The stacking order never changes during a turn: the arriving cover is on top from its
        // first frame, faded in over its own slot (below). The two traded depth mid-turn before
        // (a z-index keyframe, then a timer), and the arriving cover jumped in front of the
        // leaving one in one frame while they still overlapped (the stress test's frames,
        // 2026-10-20); a z-index keyframe also kept the whole turn off the compositor.
        stack(old, 2);
        old
          .animate(
            [{ ...from, easing: leave }, { ...behind(-run, -turn), offset: back }, behind(-run, -turn)],
            { duration, fill: "forwards" },
          )
          .finished.then(() => old.remove(), () => old.remove());
        // The next cover shows only once its picture is decoded, then leaves its slot: shown
        // before, it was a blank square over the waiting side cover, which seemed to change
        // color before anything moved (his report, 2026-10-20). Until then the side cover holds
        // the slot. It keeps to the turn's clock: what is left of the wait, then the move.
        el.style.opacity = "0";
        const t0 = performance.now();
        void Promise.race([decoded, wait]).then(() => {
          if (mine !== gen || !el.isConnected) return; // a newer press took over: it stays hidden
          el.style.opacity = "";
          const late = performance.now() - t0;
          const hold = Math.max(0, duration * stagger - late);
          const move = Math.max(duration * (1 - stagger), duration * 0.4);
          // It waits under the old cover, then comes in front the moment it leaves its slot. The
          // front cover always overlaps both side slots, so some cover must pass another: with the
          // old one home and dimmed by then, only the strip where the two side covers meet changes
          // (Metal, --zoetrope-rise 0; the design review, round 2). A skin with --zoetrope-rise
          // above 0 fades it in on top over that share of its move instead.
          // it starts to grow a frame or two before it comes in front, so the cut lands on a cover
          // already on its way (one interval doubled its size: the design review, round 4)
          stack(el, 1);
          stack(el, 3, hold + move * lead);
          // the moment it is opaque over its slot, on its own clock: the skin swaps that slot's
          // picture under it then (metal.ts; a timer of its own ran ahead under load: the stress test)
          window.setTimeout(() => {
            if (mine === gen && el.isConnected) box.dispatchEvent(new CustomEvent("vinyl:covered", { bubbles: true }));
          }, hold + move * Math.max(rise, lead));
          el.animate(
            rise > 0
              ? [{ ...behind(run, turn), opacity: 0, easing }, { opacity: 1, offset: Math.max(rise, lead) }, front]
              : [{ ...behind(run, turn), easing }, front],
            { duration: move, delay: hold, fill: "backwards" },
          );
        });
        return;
      }
      const w = old.offsetWidth * travel * x * d;
      const h = old.offsetHeight * travel * y * d;
      old
        .animate([{ transform: "translate(0px, 0px)", opacity: 1 }, { transform: `translate(${w}px, ${h}px)`, opacity: fade }], {
          duration,
          easing,
          fill: "forwards",
        })
        .finished.then(() => old.remove(), () => old.remove());
      el.animate([{ transform: `translate(${-w}px, ${-h}px)`, opacity: fade }, { transform: "translate(0px, 0px)", opacity: 1 }], {
        duration,
        easing,
        fill: "backwards",
      });
    });
  };

  // The skin, the window's visibility (ambient.ts) and the row can each start or stop the spin.
  const observer = new MutationObserver(() => sync());
  observer.observe(root, { attributes: true, attributeFilter: ["data-skin", "data-ambient"] });
  const unsubSettings = onSettingsChange((k) => {
    if (k === "pressVinyl") sync();
    // A new speed gives the song a new period. The disc's angle then means something else, so
    // let it jump to where the song says; a small difference still closes by speed alone.
    if (k === "pressVinylSpeed") {
      period = periodFor(dur);
      sync("seek");
    }
    if (k === "pressVinylFps") sync();
  });
  // A move to a monitor at another rate changes the steps (display-hz.ts).
  const unsubHz = onDisplayHz(() => sync());

  box.replaceChildren();
  slot = build(undefined);
  place(slot);

  const vinyl: Vinyl = {
    show(next, s, dir) {
      if (TEL && !(next === song && s === src)) {
        const short = (v: string | undefined) => (v ? v.replace(/^https?:\/\/[^/]+\/.*\/([^/]{0,24})[^/]*$/, "…$1") : "none");
        telLine(
          `[perf] vinyl show ${song ?? "(start)"} → ${next} · ${next === song ? "cover swap" : "new song"} · src ${short(s)}` +
            ` · at ${Math.round(performance.now() - shownAt)} ms after the last`,
        );
      }
      if (next === song) {
        if (s === src) return;
        // Same song, another cover URL (MusicKit caught up, or Show cover flipped): swap it once
        // the new one is decoded, so the disc never blanks.
        src = s;
        const img = slot?.querySelector("img");
        if (img && s) {
          const pre = new Image();
          pre.src = s;
          void pre.decode().catch(() => {}).then(() => {
            if (src === s && img.isConnected) img.src = s;
          });
        } else {
          const el = build(s);
          slot?.remove();
          slot = el;
          place(el);
          sync();
        }
        return;
      }
      const back = turnBack(next, dir);

      songSummary();
      tel = freshTel();
      gen++;
      window.clearTimeout(pendingTimer);
      pendingTimer = 0;
      setDuration(pending?.duration ?? 0);
      pending = null;
      resetClock();
      const old = slot;
      song = next;
      src = s;
      pos = 0;
      lastRaw = -1;
      moved = false;
      started = false;
      shownAt = performance.now();
      anim = null; // the leaving disc keeps its own animation until it is removed
      // A quick run of skips. Under the zoetrope a cover still on its way out fades from where it
      // is: removed at once, it popped (his report, 2026-10-20: rapid Back / Next).
      const fadeOut = !isRecordHere() && coverSwap() === "zoetrope" && !reduced();
      // It finishes its own way to its slot at four times the speed instead of fading: a fade
      // showed one cover through another when a press landed mid-turn (the design review, round 3).
      box.querySelectorAll<HTMLElement>(".vinyl--out").forEach((e) => {
        const runs = e.getAnimations();
        if (!fadeOut || !runs.length) { e.remove(); return; }
        runs.forEach((a) => a.updatePlaybackRate(4));
        window.setTimeout(() => e.remove(), 400); // its own end removes it sooner (slide)
      });
      const el = build(s);
      slot = el;
      place(el);
      // The zoetrope does not turn a picture onto itself (two songs from one album); a record does.
      const samePic = !isRecordHere() && coverSwap() === "zoetrope" && !!s && old?.querySelector("img")?.src === s;
      const turned = !samePic && !!(old && old.querySelector("img") && s && !held() && !reduced() && (isRecordHere() || coverSwap() !== "none"));
      if (turned) slide(old!, el, back);
      else old?.remove();
      // The turn as it ran, for the skin's side covers (metal.ts): one answer for the cover and
      // its neighbors, where each guessed the direction alone and could disagree (the break-it pass).
      box.dataset.turn = turned ? (back ? "back" : "fwd") : "none";
      box.dataset.turnSong = next;
      box.dataset.turnAt = String(performance.now());
      box.dispatchEvent(new CustomEvent("vinyl:turn", { bubbles: true }));
      sync();
    },
    playing(on) {
      if (on === isPlaying) return;
      isPlaying = on;
      moved = false;
      resetClock(); // the clock stopped or started: old bounds no longer hold
      sync();
    },
    position(sec, duration, exact) {
      if (!isFinite(sec) || scrubbing) return;
      // A scrub was let go: MusicKit keeps reporting the old position until the seek lands.
      if (seekTo >= 0) {
        if (performance.now() < seekUntil && Math.abs(sec - seekTo) > SEEK_NEAR_S) {
          tel.seekHeld++;
          return;
        }
        seekTo = -1;
      }
      // Just after a song change, a reading well into a song is the old song still reporting.
      if (sec > STALE_S && lastRaw < 0 && performance.now() - shownAt < STALE_MS) {
        tel.stale++;
        return;
      }
      // A jump back to the start is usually the next song reporting before its cover arrives.
      // Hold the old disc where it is; show() takes the new song's duration. With no show()
      // in time it was a seek to the start, and it applies then.
      if (lastRaw - sec > 2 && sec < 1.5) {
        pending = { sec, duration, exact };
        tel.zeroHeld++;
        if (!pendingTimer) {
          pendingTimer = window.setTimeout(() => {
            pendingTimer = 0;
            const p = pending;
            pending = null;
            if (!p) return;
            lastRaw = -1;
            resetClock();
            pos = p.sec;
            vinyl.position(p.sec, p.duration, p.exact);
            sync("zero");
          }, NEXT_SONG_WAIT_MS);
        }
        return;
      }
      setDuration(duration);
      if (lastRaw >= 0 && sec !== lastRaw) moved = true;
      const firstReading = lastRaw < 0;
      const prevPos = pos;
      lastRaw = sec;
      exactNow = exact;
      posAt = performance.now();
      if (exact) {
        pos = sec;
        resetClock();
        // A big step on a real clock is a seek (media keys, the tray, an agent): snap.
        const step = Math.abs(sec - prevPos);
        sync(!firstReading && started && step >= SEEK_S && step < dur ? "seek" : false);
        return;
      }
      if (!isPlaying) {
        pos = sec;
        sync();
        return;
      }
      const est = estimate(sec);
      pos = est.sec;
      sync(est.seek && started ? "count" : false);
    },
    scrub(sec, done = false) {
      pos = Math.max(0, sec);
      if (done) {
        scrubbing = false;
        moved = false;
        lastRaw = -1;
        resetClock();
        seekTo = pos;
        seekUntil = performance.now() + SEEK_LAND_MS;
        posAt = performance.now();
        tel.scrubs++;
        sync();
        return;
      }
      scrubbing = true;
      started = true;
      sync();
      if (anim) {
        if (anim.playState === "running") anim.pause();
        anim.currentTime = (pos * 1000) % (period * 1000);
      }
    },
    suspend(on) {
      if (on === suspended) return;
      suspended = on;
      sync();
    },
    destroy() {
      songSummary();
      const i = samplers.indexOf(sample);
      if (i >= 0) samplers.splice(i, 1);
      anim?.cancel();
      window.clearTimeout(pendingTimer);
      observer.disconnect();
      unsubSettings();
      unsubHz();
    },
  };
  return vinyl;
}
