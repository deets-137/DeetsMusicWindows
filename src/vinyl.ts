// Press "Record player" (docs/VINYL.md). The cover box keeps its art in a slot (.vinyl):
// a plate, the art that turns (.vinyl__spin), and a sheen that does not. CSS decides whether
// the slot looks like a record in this place (--vinyl on .np__art: the skin, the rows and
// the surface); everywhere else it draws the plain square cover. The Now Playing card and the
// tray panel both use it.
//
// The angle follows the song, not the clock (§4): angle = 360° × position ÷ period, and the
// period is 1.8 s (33⅓ rpm) stretched so the song lasts a whole number of turns — each disc
// starts upright and ends upright. A song change slides the old disc out and the new one in (§5).
// Both motions are Web Animations with plain values, so the compositor runs them: a song
// change is exactly when MusicKit keeps the main thread busy.
//
// A jump is always visible; a speed change of a few percent never is. So a disc starts at 0°
// when its sound starts, and after that it only speeds up or slows down to stay on the song.
// It snaps only for a real seek (§4 "Corrections").

import { invoke } from "@tauri-apps/api/core";
import { setting, onSettingsChange } from "./settings-store";

// Dev-only telemetry (VINYL.md §Telemetry), gated on Vite's DEV flag like frames.ts: a
// `[perf] vinyl snap …` line for every jump and one `[perf] vinyl song …` summary per song,
// in the console and the dev log. `__vinyl.sample(ms)` returns the disc's error, row by row.
const TEL = import.meta.env.DEV;
const telLine = (line: string): void => {
  if (!TEL) return;
  console.info(line);
  invoke("diag_flush", { text: line }).catch(() => {});
};
type Sampler = (ms: number) => Promise<unknown[]>;
const samplers: Sampler[] = []; // newest last: the card in the main window, the disc in the tray panel
if (TEL) {
  (window as unknown as { __vinyl: unknown }).__vinyl = {
    get discs() {
      return samplers.length;
    },
    /** Rows every 100 ms: [position s, disc error ms (+ = disc behind), rate, play state]. */
    sample: (ms = 3000, i = samplers.length - 1) => samplers[i]?.(ms) ?? Promise.resolve(["no disc"]),
  };
}

const TURN_S = 1.8; // one turn at 33⅓ rpm
const SEEK_S = 1.5; // an exact reading this far from the disc is a seek: snap to it…
const SNAP_MIN_MS = 250; // …but only when the disc is this far off; less is a speed change
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

/** The period for a song: 1.8 s, stretched so the song lasts a whole number of turns. */
export const periodFor = (duration: number): number =>
  duration > 0 ? duration / Math.max(1, Math.round(duration / TURN_S)) : TURN_S;

/** A CSS time token ("0.42s" / "420ms") in ms. */
const ms = (v: string): number => {
  const n = parseFloat(v);
  if (!isFinite(n)) return 0;
  return v.trim().endsWith("ms") ? n : n * 1000;
};

export interface Vinyl {
  /** Show a song's cover. `song` is its identity (a new one slides); no `src` = the ♪ placeholder. */
  show(song: string, src: string | undefined): void;
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

export function mountVinyl(box: HTMLElement, glyph: string): Vinyl {
  let slot: HTMLElement | null = null;
  let song: string | null = null;
  let src: string | undefined;
  let gen = 0; // bumps on every song change: a slide still waiting on a decode checks it
  const recent: string[] = []; // songs shown, newest last — a return to the one before is Previous
  let anim: Animation | null = null;
  let period = TURN_S;
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
    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    telLine(
      `[perf] vinyl song ${dur > 0 ? fmt(dur) : "live"} · period ${pMs.toFixed(1)} ms${turns ? ` (${turns} turns)` : ""}` +
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
      el.innerHTML = '<div class="vinyl__plate"></div><div class="vinyl__spin"><img alt="" data-art /></div><div class="vinyl__sheen"></div>';
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
    if (!anim || (anim.effect as KeyframeEffect | null)?.target !== el) {
      anim = el.animate([{ transform: "rotate(0turn)" }, { transform: "rotate(1turn)" }], {
        duration: pMs,
        iterations: Infinity,
        easing: "linear",
      });
      anim.pause();
      anim.currentTime = started ? target : 0;
    } else if (anim.effect?.getTiming().duration !== pMs) {
      anim.effect?.updateTiming({ duration: pMs });
    }
    if (scrubbing) return;
    // A seek that leaves the disc nearly right is not worth a visible hop (the log showed a
    // "seek" snap of 40 ms at a station song change): close it by speed instead.
    if (snap && started && Math.abs(errNow(anim, pMs)) < SNAP_MIN_MS) snap = false;
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

  /** Slide `old` out and `el` in, once `el`'s cover is decoded (or DECODE_WAIT_MS passed). */
  const slide = (old: HTMLElement, el: HTMLElement, back: boolean) => {
    const mine = gen;
    old.classList.add("vinyl--out");
    el.style.opacity = "0"; // hidden until it can move in whole
    const img = el.querySelector("img");
    const decoded = img ? img.decode().catch(() => {}) : Promise.resolve();
    const wait = new Promise((r) => window.setTimeout(r, DECODE_WAIT_MS));
    void Promise.race([decoded, wait]).then(() => {
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
  });

  box.replaceChildren();
  slot = build(undefined);
  place(slot);

  const vinyl: Vinyl = {
    show(next, s) {
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
      const back = recent.length >= 2 && recent[recent.length - 2] === next;
      if (back) recent.pop();
      else recent.push(next);
      if (recent.length > 20) recent.shift();

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
      box.querySelectorAll(".vinyl--out").forEach((e) => e.remove()); // a quick run of skips
      const el = build(s);
      slot = el;
      place(el);
      if (old && old.querySelector("img") && s && !held() && !reduced() && isRecordHere()) {
        slide(old, el, back);
      } else {
        old?.remove();
      }
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
    },
  };
  return vinyl;
}
