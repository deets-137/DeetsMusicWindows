// The first-run walk (docs/features/ONBOARDING.md §4) — how the app explains itself to a stranger.
//
// Deets (32×64) and Happy (32×32), the sprites from deets.solutions, travel to the control
// each step names, stand under it, and a speech card holds the sentence. Five steps, decided
// with the owner on 2026-09-18:
//
//   1  Sign in to Apple Music          (the Account row in the DeetsMusic menu)
//   2  Click DeetsMusic                (the wordmark IS the menu button)
//   3  Click a section title            (every card title is a picker)
//   4  Ctrl + Space opens the DeetsBar  (go anywhere, search anything, reach settings)
//   5  You're set! Explore!             (no target, no gesture — the send-off)
//      Hover, not right-click: hover hints are on by default and cover every control,
//      so it is the gesture that pays off on the very next thing they point at.
//
// The sentences are the owner's own words (2026-09-18). He names the control exactly as it
// reads on screen — "Click DeetsMusic", not "this name" — so there is one thing to look at
// and one thing to press. Keep that when editing: name the control, do not describe it.
//
// Three rules the owner set, and why each one is here:
//
//   The GESTURE advances a step, not a button. A step you clicked past taught nothing, so
//   the walk watches for the real thing happening — the menu opening, a picker opening, the
//   bar opening — and moves on when it does.
//
//   NEXT arrives only once WE have failed. The button is not on the card; it appears after
//   NUDGE_MS of a step waiting. Its presence is an admission that the pointing was not
//   obvious enough, so it must not be the first thing offered.
//
//   The SPRITES travel (option A). A flash on a control 600 px from the sprite pulls no
//   harder than a hint box, and every step here points at the top of the window while the
//   toast host sits at the bottom in midi. So the card leaves the toast host and rides with
//   Deets. It keeps the toast's material and button idiom (§2a control families) through the
//   --walk-card-* aliases; nothing about the toast primitive changed.
//
// State is `onboardingStep` in settings (the NEXT step to show; 0 = over). Not a localStorage
// once-key: it survives a localStorage clear, the agent can read it, and Settings › Tips can
// hand it back to a user who skipped. settings-store.ts decides ONCE, at first load, whether
// this install has ever been used, so an upgrade never sees the walk.
//
// While the walk owns step 1, apple-health.ts stays quiet about `signedOut` — one cause, one
// notice (TOASTS.md). A user who has ever signed in gets the health sticky instead and no walk.
//
// Testing: `npm run dev:fresh` (a stranger) or `npm run dev:fresh:in` (first-run UI, already
// signed in, so the walk opens at step 2). ONBOARDING.md §5.

import { setting, setSetting } from "./settings-store";
import { isConnected } from "./apple";
import * as diag from "./diag";
import "./styles/walk.css";

import deetsIdle from "./assets/sprites/deets/idle_down.png";
import deetsWalk from "./assets/sprites/deets/walk_side.png";
import happySit from "./assets/sprites/happy/sit_side.png";
import happyWalk from "./assets/sprites/happy/walk_side.png";

/** How long a step waits before it admits we were not obvious and offers Next. */
const NUDGE_MS = 9000;
/** A target that has not appeared yet (a card still mounting) is retried this often. */
const FIND_MS = 200;
/** Give up looking for a target after this long and place the card anyway — never trap the user. */
const FIND_CAP_MS = 6000;
/** How often to re-check that the screen is clear enough to move to the next stop. */
const CLEAR_MS = 150;

interface Stop {
  /** 1-based, and the value stored in `onboardingStep`. */
  n: number;
  text: string;
  /** The control this step names. Missing = no target (the send-off). */
  target?: () => HTMLElement | null;
  /** Subscribe to the gesture; call `done` when it happens. Returns the unsubscribe. */
  gesture?: (done: () => void) => () => void;
  /** Said while this step's own panel is open, in place of `text`. The step has already
   *  advanced by then and is only waiting for the panel to close, so this is the line that
   *  tells them HOW to close it. Short: it has to fit beside the sprites (see `aside`). */
  openText?: string;
  /** Label for the button that ends the walk on the last step. */
  finish?: string;
}

/** Watch one element's attribute and fire when it takes a value. */
function onAttr(el: Element, attr: string, value: string, done: () => void): () => void {
  const o = new MutationObserver(() => {
    if (el.getAttribute(attr) === value) done();
  });
  o.observe(el, { attributes: true, attributeFilter: [attr] });
  return () => o.disconnect();
}

/** Watch the whole page for an element matching `sel` (the selector excludes hidden ones). */
function onAppear(sel: string, done: () => void): () => void {
  const hit = (): boolean => !!document.querySelector(sel);
  if (hit()) {
    done();
    return () => {};
  }
  const o = new MutationObserver(() => {
    if (hit()) done();
  });
  o.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden"] });
  return () => o.disconnect();
}

/** The left card's title — every mounted card title is a picker (layout.ts makePicker). */
const firstCardTitle = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-slot="left"] .panel__title.is-pickable') ??
  document.querySelector<HTMLElement>(".panel__title.is-pickable");

const STOPS: Stop[] = [
  {
    n: 1,
    text: "Sign in to Apple Music. Click DeetsMusic, then Sign in. Your library fills up after that.",
    target: () => document.querySelector<HTMLElement>("#settings-trigger"),
    // Not the click: the sign-in happens in the browser and comes back minutes later.
    // main.ts fires this once Apple has accepted the account.
    gesture: (done) => {
      window.addEventListener("deets:signed-in", done);
      return () => window.removeEventListener("deets:signed-in", done);
    },
  },
  {
    n: 2,
    text: "Click DeetsMusic. Themes, skins, the window size, your account and Settings are all in here.",
    target: () => document.querySelector<HTMLElement>("#settings-trigger"),
    gesture: (done) => {
      const el = document.querySelector<HTMLElement>("#settings-trigger");
      return el ? onAttr(el, "aria-expanded", "true", done) : () => {};
    },
  },
  {
    n: 3,
    text: "Click a section title to see a dropdown of the cards you can put in that spot.",
    target: firstCardTitle,
    gesture: (done) => onAppear(".slot-picker__menu:not([hidden])", done),
  },
  {
    n: 4,
    text: "Press Ctrl + Space. The DeetsBar opens everywhere: go anywhere, search anything, and reach settings and functions too.",
    openText: "Esc or Ctrl + Space to close again!",
    target: () => document.querySelector<HTMLElement>("#compass-open"),
    gesture: (done) => onAppear("#compass:not([hidden])", done),
  },
  {
    n: 5,
    text: "You're set! Explore! Click around — and hover anything you are curious about.",
    finish: "Let's go",
  },
];

let live = false;

/** The open menu, picker, Compass or context menu — or null when the screen is clear.
 *  Returned, not just counted, because Deets steps aside AROUND it (see `aside`). */
function busyEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    "#settings-menu:not([hidden]), .slot-picker__menu:not([hidden]), #compass:not([hidden]), .ctx-menu",
  );
}

/** Does the walk own the screen right now? apple-health.ts asks before its own toast. */
export function walkActive(): boolean {
  return live;
}

/** Start the walk at the stored step. Safe to call when there is nothing to do. */
export async function initWalk(): Promise<void> {
  if (live) return;
  const at = setting("onboardingStep");
  if (!at || at < 1 || at > STOPS.length) return;
  run(await past1(at));
}

/** Show the walk again from the start (Settings › Tips). */
export async function restartWalk(): Promise<void> {
  if (live) return;
  setSetting("onboardingStep", 1);
  // Every New badge comes back too: the quick panel's squares and the cog (QUICK-SETTINGS.md
  // §8, §11), and each new setting's row, section and pill mark (§10, §10a). His call
  // 2026-09-25; before, the tour kept the "row:" / "sec:" marks seen.
  setSetting("quickSeen", []);
  run(await past1(1));
}

/**
 * Step 1 asks for a sign-in. Skip it when there already is one: its gesture
 * (`deets:signed-in`) would never fire, and the user would sit through NUDGE_MS to reach a
 * Next button for something they have already done. This is also what makes
 * `npm run dev:fresh:in` open at step 2 (ONBOARDING.md §5).
 */
async function past1(at: number): Promise<number> {
  if (at !== 1) return at;
  try {
    return (await isConnected()) ? 2 : 1;
  } catch {
    return 1; // Rust did not answer — ask for the sign-in rather than skip it
  }
}

function run(from: number): void {
  live = true;
  diag.log("walk:start", { step: from });

  const layer = document.createElement("div");
  layer.className = "walk";
  const stop = document.createElement("div");
  stop.className = "walk__stop";
  stop.style.setProperty("--walk-deets-idle", `url("${deetsIdle}")`);
  stop.style.setProperty("--walk-deets-walk", `url("${deetsWalk}")`);
  stop.style.setProperty("--walk-happy-sit", `url("${happySit}")`);
  stop.style.setProperty("--walk-happy-walk", `url("${happyWalk}")`);
  stop.innerHTML =
    '<div class="walk__pair">' +
    '<div class="walk__sprite walk__deets" aria-hidden="true"></div>' +
    '<div class="walk__sprite walk__happy" aria-hidden="true"></div>' +
    "</div>" +
    '<div class="walk__card" role="dialog" aria-live="polite" aria-label="Getting started">' +
    '<span class="walk__step"></span>' +
    '<p class="walk__text"></p>' +
    '<div class="walk__actions"></div>' +
    "</div>";
  layer.appendChild(stop);
  document.body.appendChild(layer);

  const card = stop.querySelector<HTMLElement>(".walk__card")!;
  const stepEl = stop.querySelector<HTMLElement>(".walk__step")!;
  const textEl = stop.querySelector<HTMLElement>(".walk__text")!;
  const actions = stop.querySelector<HTMLElement>(".walk__actions")!;

  let at = from;
  let lastX = 0;
  let stopWatch: (() => void) | null = null;
  // The gesture has fired and we are only waiting for the menu to close. Without this the
  // sprites walk BACK to the old target the moment the menu shuts, then walk off again.
  let advancing = false;
  let marked: HTMLElement | null = null;
  let cleanup: (() => void) | null = null;
  const timers: number[] = [];
  const clearTimers = (): void => {
    while (timers.length) window.clearTimeout(timers.pop()!);
  };
  const later = (fn: () => void, delay: number): void => {
    timers.push(window.setTimeout(fn, delay));
  };

  const unmark = (): void => {
    marked?.classList.remove("walk-target");
    marked = null;
  };

  function onKey(e: KeyboardEvent): void {
    // Escape skips the walk — but NOT while a menu, picker or the DeetsBar is open. That
    // Escape belongs to the panel, and step 4's own line asks for it by name ("Esc or
    // Ctrl + Space to close again!"). Without this guard, doing what the card says would
    // shut the panel AND end the walk in one press.
    //
    // This listener is in the CAPTURE phase for that reason. In the bubble phase the panel
    // has already closed by the time the event reaches the window, so `busyEl()` reads null
    // and the guard never fires — measured, not guessed (2026-09-18).
    if (e.key === "Escape" && !busyEl()) end("escape");
  }

  function end(why: string): void {
    if (!live) return;
    live = false;
    clearTimers();
    cleanup?.();
    cleanup = null;
    unmark();
    stopWatch?.();
    stopWatch = null;
    setSetting("onboardingStep", 0);
    diag.log("walk:end", { why, step: at });
    card.style.opacity = "0";
    window.setTimeout(() => layer.remove(), 300);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", reposition);
  }

  function tokenPx(token: string): number {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token));
    return Number.isFinite(v) ? v : 8;
  }

  function tokenMs(token: string): number {
    const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return 750;
    return v.endsWith("ms") ? n : n * 1000;
  }

  function place(x: number, y: number): void {
    stop.dataset.way = x >= lastX ? "right" : "left";
    lastX = x;
    stop.style.left = `${x}px`;
    stop.style.top = `${y}px`;
  }

  /** Put the group under (or over) the target, and face the way we travelled. */
  function reposition(): void {
    delete stop.dataset.tuck; // the card comes back: we are naming a control again
    const full = STOPS[at - 1]?.text;
    if (full && textEl.textContent !== full) textEl.textContent = full;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const w = stop.offsetWidth || 0;
    const h = stop.offsetHeight || 0;
    if (!marked) {
      // No target: the middle of the window, no pointer.
      stop.dataset.point = "none";
      place(Math.round((vw - w) / 2), Math.round((vh - h) / 2));
      return;
    }
    const r = marked.getBoundingClientRect();
    const gap = tokenPx("--walk-gap");
    const edge = tokenPx("--space-2");
    // Under the target if there is room, else above it. Everything the walk names sits at
    // the top of the window, so "under" is the normal case.
    const below = r.bottom + gap + h <= vh;
    stop.dataset.point = below ? "up" : "down";
    const y = below ? r.bottom + gap : Math.max(0, r.top - gap - h);
    // Line the pointer up with the middle of the target, then keep the whole group on screen.
    const want = r.left + r.width / 2 - w / 2;
    const x = Math.max(edge, Math.min(want, vw - w - edge));
    const point = Math.max(tokenPx("--space-3"), r.left + r.width / 2 - x);
    stop.style.setProperty("--walk-point-x", `${Math.round(point)}px`);
    place(Math.round(x), Math.round(y));
  }

  /**
   * Somewhere clear of `r` for the group at its current size, or null when nothing fits.
   * Tried in order: beside the panel (right, then left), then under it, then over it.
   */
  function spot(r: DOMRect): { x: number; y: number } | null {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const w = stop.offsetWidth || 0;
    const h = stop.offsetHeight || 0;
    const gap = tokenPx("--walk-gap");
    const edge = tokenPx("--space-2");
    const clampX = (x: number): number => Math.max(edge, Math.min(x, vw - w - edge));
    const clampY = (y: number): number => Math.max(edge, Math.min(y, vh - h - edge));
    if (vw - r.right >= w + gap + edge) return { x: vw - w - edge, y: clampY(r.top) };
    if (r.left >= w + gap + edge) return { x: edge, y: clampY(r.top) };
    if (vh - r.bottom >= h + gap + edge) return { x: clampX(lastX), y: r.bottom + gap };
    if (r.top >= h + gap + edge) return { x: clampX(lastX), y: r.top - gap - h };
    return null;
  }

  /**
   * A menu is open. Get out of its way (owner's call 2026-09-18: the sprites sat on top of
   * the menu the step had just told him to open, and it read as clutter).
   *
   * Deets drops his pointer — he is no longer naming a control, he is waiting — and walks
   * to the first clear spot. When nothing fits he **tucks**: the speech card hides and the
   * two sprites alone go looking again. That is the DeetsBar in midi, which spans the width
   * and most of the height; the sentence is not what you need while the bar is open, the
   * bar is. Only if even the sprites cannot clear it do they take the far bottom corner.
   */
  function aside(panel: HTMLElement): void {
    const r = panel.getBoundingClientRect();
    delete stop.dataset.tuck; // always try at full size first
    let p = spot(r);
    if (!p) {
      // Tucked. A step with an `openText` keeps a one-line card BESIDE the sprites — losing
      // the way out of a panel we asked them to open would be the wrong thing to drop. Every
      // other step drops the card: its sentence has already done its work.
      const line = STOPS[at - 1]?.openText;
      if (line) textEl.textContent = line;
      stop.dataset.tuck = line ? "msg" : "1";
      p = spot(r);
    }
    if (!p) {
      // Nothing clears it. Take the bottom corner away from the panel's own middle.
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const edge = tokenPx("--space-2");
      const w = stop.offsetWidth || 0;
      const h = stop.offsetHeight || 0;
      p = { x: r.left + r.width / 2 > vw / 2 ? edge : Math.max(edge, vw - w - edge), y: Math.max(edge, vh - h - edge) };
    }
    stop.dataset.point = "none";
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (x === Math.round(lastX) && y === Math.round(parseFloat(stop.style.top) || 0)) return; // already clear
    stepAway(() => place(x, y));
  }

  /** Move with the legs running, then stand still again. */
  function stepAway(move: () => void): void {
    stop.dataset.move = "walk";
    move();
    later(() => delete stop.dataset.move, tokenMs("--walk-travel"));
  }

  /** Follow the screen: step aside while a panel is open, come back when it closes. */
  function watchScreen(): () => void {
    let wasBusy: HTMLElement | null = null;
    let queued = false;
    const react = (): void => {
      queued = false;
      if (!live) return;
      const panel = busyEl();
      if (panel === wasBusy) return;
      wasBusy = panel;
      if (panel) aside(panel);
      else if (marked && !advancing) stepAway(reposition); // still waiting: go back and point
    };
    const o = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(react);
    });
    o.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden"] });
    return () => o.disconnect();
  }

  /** Wait for the target to exist (a card may still be mounting), then show the step. */
  function findTarget(s: Stop, then: (el: HTMLElement | null) => void): void {
    if (!s.target) return then(null);
    const t0 = Date.now();
    const look = (): void => {
      const el = s.target!();
      if (el) return then(el);
      if (Date.now() - t0 > FIND_CAP_MS) {
        diag.warn("walk:noTarget", { step: s.n });
        return then(null);
      }
      later(look, FIND_MS);
    };
    look();
  }

  /** Do not walk off while a menu the user just opened is still on screen. */
  function whenClear(then: () => void): void {
    const tick = (): void => {
      if (!live) return;
      if (busyEl()) return later(tick, CLEAR_MS);
      then();
    };
    tick();
  }

  function show(n: number): void {
    at = n;
    advancing = false;
    const s = STOPS[n - 1];
    clearTimers();
    cleanup?.();
    cleanup = null;
    unmark();

    stepEl.textContent = `Step ${n} of ${STOPS.length}`;
    textEl.textContent = s.text;
    actions.replaceChildren();
    if (s.finish) actions.appendChild(button(s.finish, "walk__btn", () => end("finished")));
    actions.appendChild(button("Skip the tour", "walk__btn walk__btn--skip", () => end("skipped")));

    findTarget(s, (el) => {
      if (!live) return;
      marked = el;
      el?.classList.add("walk-target");
      // Replay the card's arrival now that its text has changed.
      card.style.animation = "none";
      void card.offsetWidth;
      card.style.animation = "";
      reposition();
      if (!s.gesture) return;
      const advance = once(() => {
        advancing = true;
        whenClear(() => step(n + 1));
      });
      cleanup = s.gesture(advance);
      // We pointed. If they have not moved by now, the pointing was not good enough —
      // offer the way out rather than leave them stuck (owner's call 2026-09-18).
      later(() => {
        if (!live || at !== n) return;
        diag.log("walk:nudge", { step: n });
        actions.prepend(button("Next", "walk__btn walk__btn--next", advance));
      }, NUDGE_MS);
    });
  }

  function step(n: number): void {
    if (!live) return;
    if (n > STOPS.length) return end("finished");
    setSetting("onboardingStep", n);
    diag.log("walk:step", { step: n });
    // Walk, then stand: the legs run for the length of the travel, then stop.
    stepAway(() => show(n));
  }

  window.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", reposition);
  const unwatch = watchScreen();
  stopWatch = unwatch;
  show(at);
}

function once(fn: () => void): () => void {
  let spent = false;
  return () => {
    if (spent) return;
    spent = true;
    fn();
  };
}

function button(label: string, cls: string, run: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = label;
  b.addEventListener("click", run);
  return b;
}
