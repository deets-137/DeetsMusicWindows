// A card's first screen — one reveal in reading order (UX-COVERUPS.md §7, his design 2026-10-16).
//
// Terms (§7): the FIRST SCREEN is the tiles whose box is inside the card's visible list area
// when the level's data is drawn (a tile cut by the bottom edge counts). A tile is READY when
// its picture can show at once: a cover loaded and decoded, a mosaic drawn, a cover that
// failed, or a slot with no picture. The REVEAL is the moment the first screen shows. The CAP
// is the longest a card holds. A LATE cover is one not ready at the reveal.
//
// One primitive for every card: `reveal()` hides a body (it keeps its box, so its tiles have
// a layout and their covers load), waits for the level's data (`loading`), then for each
// first-screen tile to be ready, at most `--reveal-cap` from the start. A press or a wheel on
// the card ends the hold at once. Then the first-screen tiles enter as one diagonal wave
// (reveal-wave.ts) over `--reveal-span`; tiles below the first screen show with no motion.
// Reduced motion: the same hold, then the screen shows at once.
//
// At launch (§7.5) the launch cover is the reveal: a reveal that starts under it holds
// nothing and plays no wave; its readiness joins the cover's wait (`bootReadiness`).
//
// The setting (§7.12, Settings › Cards › Cover load animations): a card in `instantCards` never
// holds and plays no wave, and its covers show the frame they load, with no square and no fade
// (his W2 B, 2026-10-17).

import { setting, onSettingsChange } from "./settings-store";
import { tokenMs } from "./boot-cover";
import { waveDelays } from "./reveal-wave";
import { whenMosaic, rememberFirstScreen } from "./mosaic";
import { onLateArt } from "./artwork-heal";
import { mark } from "./marks";
import * as frames from "./frames";
import * as diag from "./diag";
import { hideHintIn } from "./hint";

export { REVEAL_CARDS } from "./reveal-wave";

export interface RevealOpts {
  /** The card id (`instantCards`, the logs). */
  card: string;
  /** What holds: hidden (its box kept) until the reveal. */
  body: HTMLElement;
  /** The card's panel: a press or a wheel on it ends the hold; it wears `data-instant`. */
  root?: HTMLElement;
  /** The visible area the first screen is read against (default: `body`). */
  view?: HTMLElement;
  /** The tiles, in any order (the wave sorts them by their boxes). */
  tiles: () => HTMLElement[];
  /** The level's data is still on its way: hold, and never show its empty state. */
  loading?: () => boolean;
  /** The cap and span tokens (default `--reveal-cap`, `--reveal-span`). */
  capToken?: string;
  spanToken?: string;
  /** What this reveal is (an open, a drill, a view): for the log only. */
  why?: string;
  /** Called at the reveal, before the wave. */
  onReveal?: () => void;
}

export interface Reveal {
  /** The data may have landed: look again (an engine render calls this). */
  check(): void;
  /** Drop the hold with no wave (a level swapped away or drilled past). */
  cancel(): void;
  /** Settles at the reveal (or the cancel). */
  done: Promise<void>;
}

const reduced = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const underBoot = (): boolean => !!document.documentElement.dataset.boot && document.documentElement.dataset.boot !== "lift";

export const isInstant = (card: string): boolean => setting("instantCards").includes(card);

/** A card's panel wears `data-instant` while it is instant (W2 B: all loading motion off):
 *  artwork-heal.ts then lets its covers show the frame they load. */
function markInstant(root: HTMLElement | undefined, card: string): void {
  root?.toggleAttribute("data-instant", isInstant(card));
}
onSettingsChange((k) => {
  if (k !== "instantCards") return;
  document.querySelectorAll<HTMLElement>("[data-mounted]").forEach((el) => markInstant(el, el.dataset.mounted ?? ""));
});

// ── the launch (§7.5) ────────────────────────────────────────────────────────
const bootWaits = new Set<Promise<void>>();
/** The first-screen readiness of each card that started its reveal under the launch cover. */
export function bootReadiness(): Promise<void>[] {
  return [...bootWaits];
}

// ── late covers (§7.13: `reveal:late`, a late cover's time after its reveal) ──
const revealedAt = new WeakMap<HTMLElement, { at: number; card: string }>();
const LATE_WINDOW_MS = 10_000;
onLateArt((img) => {
  let el: HTMLElement | null = img.parentElement;
  while (el) {
    const r = revealedAt.get(el);
    if (r) {
      const ms = Math.round(performance.now() - r.at);
      if (ms <= LATE_WINDOW_MS) diag.log("reveal:late", { card: r.card, ms });
      return;
    }
    el = el.parentElement;
  }
});

/** The first-screen tiles: their box meets the view, under a sticky bar, and inside the
 *  sideways scroller that holds them (a shelf tile scrolled out to the right never counts). */
function firstScreen(view: HTMLElement, tiles: HTMLElement[]): HTMLElement[] {
  // A held level opens at its place; a row scrolled under a sticky bar is not seen, so the
  // area starts under it (the engine's `.lib-cols` / `.lib-view-bar`, once they stick).
  const vr = view.getBoundingClientRect();
  const stuck = view.querySelector<HTMLElement>(":scope > .lib-cols, :scope > .lib-view-bar");
  const sr = stuck?.getBoundingClientRect();
  const top = sr && sr.top <= vr.top + 1 ? sr.bottom : vr.top;
  return tiles.filter((t) => {
    if (t === stuck) return true;
    const r = t.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    if (r.bottom <= top || r.top >= vr.bottom || r.right <= vr.left || r.left >= vr.right) return false;
    const sc = t.parentElement?.closest<HTMLElement>(".search__scroller");
    if (sc && view.contains(sc)) {
      const s = sc.getBoundingClientRect();
      if (r.right <= s.left || r.left >= s.right) return false;
    }
    return true;
  });
}

/** One picture's readiness: loaded and decoded, or failed. */
function imgReady(img: HTMLImageElement): Promise<void> {
  const decode = () => (img.naturalWidth ? img.decode().catch(() => {}) : Promise.resolve());
  if (img.complete) return decode();
  return new Promise<void>((r) => {
    const go = () => {
      img.removeEventListener("load", go);
      img.removeEventListener("error", go);
      void decode().then(r);
    };
    img.addEventListener("load", go);
    img.addEventListener("error", go);
  });
}

/** A tile's readiness: every cover in it ready, every mosaic slot in it drawn (or failed). */
function tileReady(tile: HTMLElement): Promise<void> {
  const waits: Promise<unknown>[] = [];
  const imgs = tile.matches("img") ? [tile as HTMLImageElement] : [...tile.querySelectorAll<HTMLImageElement>("img")];
  for (const img of imgs) {
    // A lazy cover in a hidden body may not start: ask for it now.
    if (img.loading === "lazy") img.loading = "eager";
    waits.push(imgReady(img));
  }
  const slots = tile.matches("[data-mosaic]") ? [tile] : [...tile.querySelectorAll<HTMLElement>("[data-mosaic]")];
  for (const slot of slots) {
    const key = slot.dataset.mosaic ?? "";
    waits.push(
      whenMosaic(key).then(async (ok) => {
        const img = ok ? slot.querySelector<HTMLImageElement>("img") : null;
        if (img) await imgReady(img);
      }),
    );
  }
  return Promise.all(waits).then(() => {});
}

/** The mosaic keys a first screen shows, for the next launch's warm-up (mosaic.ts). */
function mosaicKeys(tiles: HTMLElement[]): string[] {
  const keys: string[] = [];
  for (const t of tiles) {
    t.querySelectorAll<HTMLElement>("[data-mosaic]").forEach((el) => el.dataset.mosaic && keys.push(el.dataset.mosaic));
    if (t.matches("[data-mosaic]") && t.dataset.mosaic) keys.push(t.dataset.mosaic);
  }
  return keys;
}

/** Run the diagonal wave over `tiles` (§7.2).
 *
 *  Each tile starts its entry when its turn comes, not all at once with a delay. An animation
 *  of opacity and transform puts the tile in a layer of its own, and every layer is drawn
 *  when its animation starts, delay or no delay: started together, the whole first screen was
 *  drawn in the wave's first frame, a 38–91 ms frame on his dev app (desk test, 2026-10-17).
 *  Until its turn a tile waits at opacity 0 (`reveal-pre`), which costs no drawing. */
function wave(card: string, tiles: HTMLElement[], spanMs: number): void {
  if (reduced() || !tiles.length) return;
  const d = waveDelays(
    tiles.map((t) => {
      const r = t.getBoundingClientRect();
      return { top: r.top, left: r.left, height: r.height };
    }),
    spanMs,
  );
  const queue = tiles.map((t, i) => ({ t, at: d[i].delay })).sort((a, b) => a.at - b.at);
  queue.forEach(({ t }) => {
    t.classList.remove("pop-enter", "reveal-in");
    t.classList.add("reveal-pre");
  });
  const start = (t: HTMLElement) => {
    t.classList.remove("reveal-pre");
    t.classList.add("reveal-in");
    const end = (e: AnimationEvent) => {
      if (e.target !== t) return;
      t.classList.remove("reveal-in");
      t.removeEventListener("animationend", end);
    };
    t.addEventListener("animationend", end);
  };
  const t0 = performance.now();
  let next = 0;
  const step = () => {
    const now = performance.now() - t0;
    while (next < queue.length && queue[next].at <= now) start(queue[next++].t);
    if (next < queue.length) requestAnimationFrame(step);
  };
  step();
  // A frame loop the page stops (a hidden window) must not leave tiles at opacity 0.
  window.setTimeout(() => {
    while (next < queue.length) start(queue[next++].t);
  }, spanMs + 250);
  frames.during("reveal", spanMs + tokenMs("--pop-in"), card);
}

const live = new WeakMap<HTMLElement, Reveal>();
/** The reveal holding `body` now, if any (a render nudges it with `check`). */
export const revealOf = (body: HTMLElement): Reveal | undefined => live.get(body);

const NONE: Reveal = { check: () => {}, cancel: () => {}, done: Promise.resolve() };

/** Hold `body` until its first screen is ready (or the cap, or a press), then reveal it. */
export function reveal(o: RevealOpts): Reveal {
  markInstant(o.root, o.card);
  live.get(o.body)?.cancel();
  const t0 = performance.now();
  const boot = underBoot();
  if (isInstant(o.card)) {
    // An instant card: no hold, no wave. Its data still arrives as it does (no empty flash is
    // its own: the card shows what it has).
    return NONE;
  }
  const view = o.view ?? o.body;
  const cap = tokenMs(o.capToken ?? "--reveal-cap");
  const span = tokenMs(o.spanToken ?? "--reveal-span");
  let settled = false;
  let waiting = false; // the pictures' wait has started (the data is in)
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => (resolveDone = r));
  if (!boot) {
    o.body.setAttribute("data-reveal-hold", "");
    hideHintIn(o.body); // the held rows are invisible: their hint goes with them (V2)
  }
  mark("reveal:hold", o.card);

  const unwatch = () => {
    window.clearTimeout(capTimer);
    o.root?.removeEventListener("pointerdown", onPress, { capture: true });
    o.root?.removeEventListener("wheel", onPress, { capture: true });
  };
  const finish = () => {
    unwatch();
    live.delete(o.body);
    o.body.removeAttribute("data-reveal-hold");
    resolveDone();
  };
  const go = (why: "ready" | "cap" | "press") => {
    if (settled) return;
    settled = true;
    const tiles = firstScreen(view, o.tiles());
    const notReady = tiles.filter((t) => t.querySelector("img[data-art-wait], [data-mosaic]") || t.matches("img[data-art-wait]")).length;
    const ms = Math.round(performance.now() - t0);
    finish();
    o.onReveal?.();
    revealedAt.set(o.body, { at: performance.now(), card: o.card });
    rememberFirstScreen(o.card, mosaicKeys(tiles));
    mark("reveal:go", `${why} ${tiles.length - notReady}/${tiles.length}`);
    diag.log("reveal", { card: o.card, why: o.why ?? "open", ms, go: why, n: tiles.length, late: notReady, boot });
    if (!boot) wave(o.card, tiles, span);
  };
  const onPress = () => go("press");
  const capTimer = window.setTimeout(() => go("cap"), cap);
  // A press under the launch cover is not the user taking the card: the cover blocks it.
  if (!boot) {
    o.root?.addEventListener("pointerdown", onPress, { capture: true });
    o.root?.addEventListener("wheel", onPress, { capture: true, passive: true });
  }

  const waitPictures = () => {
    if (waiting || settled) return;
    if (o.loading?.()) return; // the data is not in: a render will call `check` again
    waiting = true;
    // One frame for the layout, so the boxes are the ones that will show.
    requestAnimationFrame(() => {
      if (settled) return;
      const tiles = firstScreen(view, o.tiles());
      void Promise.all(tiles.map(tileReady)).then(() => go("ready"));
    });
  };
  const handle: Reveal = {
    check: waitPictures,
    cancel: () => {
      if (settled) return;
      settled = true;
      finish();
      mark("reveal:go", "cancel");
    },
    done,
  };
  live.set(o.body, handle);
  if (boot) {
    bootWaits.add(done);
    void done.then(() => bootWaits.delete(done));
  }
  waitPictures();
  return handle;
}

// ── Search: the words at once, the pictures as one wave per section (§7.10, his S2 A) ──
// A search answer is the reply to typing, so its words never wait. Each section's new covers
// (`data-art-held`: hidden, and kept from artwork-heal.ts's own fade) wait until the covers of
// its own first screen are loaded and decoded, at most `--search-reveal-cap`, then fade in
// left to right over `--search-reveal-span`. A cover after the cap fades alone when it lands.
// A cover that was already on screen (kept by the keyed patch) is never held.

export interface PictureWave {
  /** Show every section now (↓ or Enter into the results). */
  releaseAll(): void;
  /** Drop the holds with no wave (a newer answer, the card leaving). */
  cancel(): void;
}

export function revealPictures(card: string, sections: HTMLElement[], cells: string): PictureWave {
  if (isInstant(card) || !sections.length) return { releaseAll: () => {}, cancel: () => {} };
  const t0 = performance.now();
  const cap = tokenMs("--search-reveal-cap");
  const span = tokenMs("--search-reveal-span");
  const open: (() => void)[] = [];
  const all = sections.map((sec) => {
    const held = [...sec.querySelectorAll<HTMLImageElement>("img[data-art]")].filter((img) => !(img.complete && img.naturalWidth));
    held.forEach((img) => img.setAttribute("data-art-held", ""));
    let done = false;
    const release = (why: "ready" | "cap" | "keys" | "cancel") => {
      if (done) return;
      done = true;
      const scroller = sec.querySelector<HTMLElement>(".search__scroller") ?? sec;
      const first = firstScreen(scroller, [...sec.querySelectorAll<HTMLElement>(cells)]);
      const ready = first.filter((c) => [...c.querySelectorAll<HTMLImageElement>("img[data-art-held]")].every((i) => i.complete && i.naturalWidth));
      const d = waveDelays(
        ready.map((c) => {
          const r = c.getBoundingClientRect();
          return { top: r.top, left: r.left, height: r.height };
        }),
        span,
      );
      // Each first-screen cover keeps its square until its turn, then fades in (a delayed
      // fade held it at opacity 0 the whole delay: square, blank, picture; desk test
      // 2026-10-17). Every other held cover lets go now: loaded, it shows; not yet, it keeps
      // its square and fades alone when it lands (artwork-heal.ts).
      const turns: { img: HTMLImageElement; at: number }[] = [];
      if (why !== "cancel" && !reduced())
        ready.forEach((c, i) =>
          c.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
            if (held.includes(img)) turns.push({ img, at: d[i].delay });
          }),
        );
      const waitingTurn = new Set(turns.map((x) => x.img));
      held.forEach((img) => !waitingTurn.has(img) && img.removeAttribute("data-art-held"));
      turns.sort((a, b) => a.at - b.at);
      const fadeIn = (img: HTMLImageElement) => {
        img.removeAttribute("data-art-held");
        img.classList.add("art-in");
        img.addEventListener("animationend", () => img.classList.remove("art-in"), { once: true });
      };
      const s0 = performance.now();
      let next = 0;
      const step = () => {
        const now = performance.now() - s0;
        while (next < turns.length && turns[next].at <= now) fadeIn(turns[next++].img);
        if (next < turns.length) requestAnimationFrame(step);
      };
      step();
      window.setTimeout(() => {
        while (next < turns.length) fadeIn(turns[next++].img);
      }, span + 250);
      const late = first.length - ready.length;
      if (why !== "cancel") {
        diag.log("reveal", { card, why: "search", section: sec.dataset.key ?? "", ms: Math.round(performance.now() - t0), go: why, n: first.length, late });
        revealedAt.set(sec, { at: performance.now(), card });
      }
    };
    open.push(() => release("keys"));
    if (!held.length) {
      release("ready");
      return release;
    }
    // The first screen's held covers, loaded and decoded, or the cap.
    requestAnimationFrame(() => {
      const scroller = sec.querySelector<HTMLElement>(".search__scroller") ?? sec;
      const first = firstScreen(scroller, [...sec.querySelectorAll<HTMLElement>(cells)]);
      const imgs = first.flatMap((c) => [...c.querySelectorAll<HTMLImageElement>("img[data-art-held]")]);
      imgs.forEach((img) => img.loading === "lazy" && (img.loading = "eager"));
      void Promise.all(imgs.map(imgReady)).then(() => release("ready"));
    });
    window.setTimeout(() => release("cap"), cap);
    return release;
  });
  return {
    releaseAll: () => open.forEach((f) => f()),
    cancel: () => all.forEach((f) => f("cancel")),
  };
}

