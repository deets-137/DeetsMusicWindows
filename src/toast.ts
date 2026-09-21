// Toasts — the app's one transient-notice primitive (docs/architecture/TOASTS.md; the design
// history is FUTURE-SETTINGS §18). A port of the Deets.Solutions toast
// (DeetsSolutions/js/toast.js): same API, same four kinds, same traffic-light
// stripe, same hover-holds-the-clock behaviour. What is new here: the `toasts`
// setting gates which kinds show, `dismissKey` makes a one-time notice, and the
// host moves with the surface (bottom-centre in mini/midi, top-right in max —
// CSS, styles/toast.css).
//
//   toast({ kind, text, sticky, timeout, actions, dismissKey }) → { dismiss, update, shown }
//
//   kind        "info" | "success" | "warn" | "error" (default "info"). Color + ARIA only.
//   text        the message. Callers own their copy; this module ships none.
//   sticky      no timer; stays until a button is pressed. DEFAULT: true for `error`,
//               false otherwise (an error is something the user must see; a warn is a
//               routine failure with nothing to do). A sticky toast always ends with a
//               Dismiss button, after any actions the caller gave.
//   timeout     ms for timed toasts (default 3200; hover pauses the clock).
//   actions     [{ label, run? }] — buttons; any press runs `run`, then dismisses.
//   dismissKey  a localStorage key → a one-time NOTICE: sticky, shows under the
//               `failures` tier whatever its kind, adds a "Don't show again" button
//               that writes "off" to the key, and never shows once that is written.
//   onceKey     a notice that shows ONCE (2026-09-14): sticky, shows under every tier,
//               ends with "Got it", and ANY button press writes "off" to the key.
//
// Tiers (`setting("toasts")`): "failures" = warn + error + notices · "all" = every
// kind. There is no "off" (removed 2026-09-14): a failure must always reach the user.
// A toast that ASKS — sticky with the caller's own actions — shows under every tier,
// because a muted question would stop the action it gates. A gated call returns an inert handle (`shown: false`), and
// the console/diag logging at the call site is untouched — diag stays the source of
// truth for what happened (every call logs `toast` or `toast:muted`).
//
// Stack: newest nearest the edge it grew from, capped at 3. Past the cap the oldest
// TIMED toast yields first. A sticky toast is never destroyed to make room: when every
// live toast is sticky, the arrival WAITS (the queue, TOASTS.md §4a). That is what makes
// "a question always shows" and "an Undo always shows" true — before the queue, the
// oldest sticky was removed with its buttons and their closures unrun.
// Main window only: the tray panel and the extension popup keep the console.

import { setting } from "./settings-store";
import * as diag from "./diag";
import "./styles/toast.css";

export type ToastKind = "info" | "success" | "warn" | "error";

export interface ToastAction {
  label: string;
  run?: () => void;
}

export interface ToastOptions {
  kind?: ToastKind;
  text: string;
  sticky?: boolean;
  timeout?: number;
  actions?: ToastAction[];
  dismissKey?: string;
  /** A notice that shows ONCE: any button press silences the key. Ends with "Got it". */
  onceKey?: string;
  /**
   * Queue rank, and how long this toast may wait when the stack is full. DEFAULT: "ask"
   * for a sticky toast carrying the caller's own actions, "offer" for everything else —
   * so no call site needs to say it unless it wants the other answer. An "ask" jumps
   * ahead of offers in the queue and is DROPPED rather than shown late; an "offer" waits
   * as long as it must. Only sticky toasts ever queue, so this is inert on a timed one.
   */
  priority?: ToastPriority;
}

/** What a queued toast is: a question that goes stale, or an offer that does not. */
export type ToastPriority = "ask" | "offer";

export interface ToastHandle {
  /** Retire the toast now (a "Reconnecting…" that dies on reconnect). */
  dismiss(): void;
  /** Rewrite the text in place (a countdown, a progress line). */
  update(text: string): void;
  /** False when the tier or a `dismissKey` already at "off" swallowed the call. */
  readonly shown: boolean;
  /** True while it waits for a slot: it is admitted, but not on screen yet (§4a.3). */
  readonly queued: boolean;
}

const CAP = 3;
const DEFAULT_MS = 3200;
const MIN_RESUME_MS = 400; // leaving the hover with almost no time left still reads
const REAP_FALLBACK_MS = 600; // transitionend lost (reduced motion, display:none) → reap anyway

const INERT: ToastHandle = { dismiss() {}, update() {}, shown: false, queued: false };

// The queue's own bounds (§4a.4). Failures arrive without bound, so every layer caps itself.
const QUEUE_CAP = 10; // a user holding three notices plus ten waiting learns nothing from a fourteenth
const ASK_WAIT_MS = 30_000; // a question answered after you forgot you asked it acts on a stale intent

/** The log copy drops every “quoted” name — LOGGING.md §Ids, never titles. */
const strip = (t: string): string => t.replace(/“[^”]*”/g, "“…”");

let host: HTMLElement | null = null;
function ensureHost(): HTMLElement {
  if (host) return host;
  const h = document.createElement("div");
  h.className = "toast-host";
  h.setAttribute("aria-live", "polite");
  document.body.appendChild(h);
  host = h;
  // mini/midi: the stack hangs under the Now Playing card so the song stays readable.
  // Its bottom edge moves with the surface and the window, so it is measured, not a
  // token; CSS falls back to the titlebar when there is no card (and max ignores it).
  const np = document.querySelector<HTMLElement>('[data-slot="np"]');
  const place = (): void => {
    const r = np?.getBoundingClientRect();
    if (r && r.height > 0) h.style.setProperty("--toast-top", `${Math.round(r.bottom)}px`);
    else h.style.removeProperty("--toast-top");
  };
  place();
  if (np) new ResizeObserver(place).observe(np);
  window.addEventListener("resize", place);
  return h;
}

const KINDS: readonly ToastKind[] = ["info", "success", "warn", "error"];

/** Is the notice under `key` silenced ("Don't show again" pressed)? */
export function noticeOff(key: string): boolean {
  try {
    return localStorage.getItem(key) === "off";
  } catch {
    return false;
  }
}

function silenceNotice(key: string): void {
  try {
    localStorage.setItem(key, "off");
  } catch {
    /* storage disabled — silenced for the session only */
  }
}

// ── the sticky queue (TOASTS.md §4a) ─────────────────────────────────────────────────
// Only STICKY toasts queue. A timed toast's information is momentary — "Link copied."
// arriving eight seconds late is worse than not arriving — so timed toasts keep exactly
// the old behaviour. Admission: room under the cap → show it; full with a timed toast
// live → evict the oldest timed one; full with every live toast sticky → wait here.

interface Queued {
  /** A question (stale-able) rather than an offer: it jumps the line and it expires. */
  readonly ask: boolean;
  /** Live text — `update()` rewrites it while it waits, so what shows is current. */
  readonly text: string;
  readonly logged: string;
  readonly noticeKey?: string;
  /** Put the built element in the host. */
  place(): void;
  /** Tell the handle it is no longer waiting. */
  dequeued(): void;
  wait?: number;
}

const queue: Queued[] = [];

/** Toasts on screen. One already retiring does not hold a slot. */
const liveToasts = (h: HTMLElement): HTMLElement[] =>
  [...h.children].filter((c): c is HTMLElement => c instanceof HTMLElement && !c.classList.contains("toast--out"));

/** Take `q` out of the queue: it never appears. Every drop is traceable, by design. */
function unqueue(q: Queued, why: string): void {
  const i = queue.indexOf(q);
  if (i < 0) return;
  queue.splice(i, 1);
  if (q.wait !== undefined) window.clearTimeout(q.wait);
  diag.log("toast:dropped", { text: q.logged, why });
}

/** A slot freed (a dismiss, a press, a timer): show what has been waiting longest. */
function drain(h: HTMLElement): void {
  while (queue.length && liveToasts(h).length < CAP) {
    const q = queue.shift()!;
    if (q.wait !== undefined) window.clearTimeout(q.wait);
    // A notice silenced from another instance while it waited must not appear (§4a.3).
    if (q.noticeKey && noticeOff(q.noticeKey)) {
      diag.log("toast:dropped", { text: q.logged, why: "notice-off" });
      continue;
    }
    q.dequeued();
    diag.log("toast:dequeued", { text: q.logged });
    q.place();
  }
}

// Observers see EVERY call — before the tier and notice gates — so a consumer that is
// not the user (the agent reply, np-bus.ts) learns of a failure the user has muted.
type ToastObserver = (t: { kind: ToastKind; text: string }) => void;
const observers = new Set<ToastObserver>();
/** Watch every toast call (muted ones too). Returns the unsubscribe. */
export function onToast(fn: ToastObserver): () => void {
  observers.add(fn);
  return () => observers.delete(fn);
}

/** Does the current tier let this call through? A question (`asks`) always does. */
function admitted(kind: ToastKind, notice: boolean, asks: boolean): boolean {
  if (asks || setting("toasts") === "all") return true;
  return notice || kind === "warn" || kind === "error";
}

/** Show a toast. See the header for the contract. */
export function toast(opts: ToastOptions): ToastHandle {
  const kind: ToastKind = opts.kind && KINDS.includes(opts.kind) ? opts.kind : "info";
  const noticeKey = opts.onceKey ?? opts.dismissKey;
  const notice = !!noticeKey;
  const sticky = notice || (opts.sticky ?? kind === "error");
  const text = String(opts.text ?? "");
  // The log copy drops every “quoted” name — playlists, songs, artists, stations, speakers
  // (LOGGING.md §Ids, never titles; a bug report sends these lines). Callers quote names.
  const logged = strip(text);
  // A failure the user was told about (or would have been, under a muted tier) belongs in
  // the log file too — it is the line a bug report starts from. A question (sticky with the
  // caller's actions: the red delete confirm) is not a failure; its `toast` line below is enough.
  // An Undo (Settings › Reset) is admitted like a question: a muted one would lose the undo.
  const asks = (sticky && !!opts.actions?.length) || !!opts.actions?.some((a) => a.label === "Undo");
  if (!asks && kind === "error") diag.error("toast", { text: logged });
  else if (!asks && kind === "warn") diag.warn("toast", { text: logged });
  observers.forEach((fn) => {
    try {
      fn({ kind, text });
    } catch (e) {
      console.error("[toast] observer", e);
    }
  });

  if (notice && noticeOff(noticeKey!)) {
    diag.log("toast:muted", { kind, text, why: "notice-off", key: noticeKey });
    return INERT;
  }
  if (!admitted(kind, notice, asks)) {
    diag.log("toast:muted", { kind, text, why: `tier-${setting("toasts")}` });
    return INERT;
  }
  diag.log("toast", { kind, text, sticky, notice });

  const h = ensureHost();
  const el = document.createElement("div");
  el.className = `toast toast--${kind}`;
  el.setAttribute("role", kind === "error" ? "alert" : "status");

  const p = document.createElement("p");
  p.className = "toast__text";
  p.textContent = text;
  el.appendChild(p);

  let gone = false;
  let timer: number | undefined;
  let deadline = 0;
  let remaining = 0;
  let current = text; // `update()` rewrites this; the queue reads it at dequeue
  let mine: Queued | null = null; // this toast's queue entry, while it waits

  const dismiss = (): void => {
    if (gone) return;
    gone = true;
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
    // Still waiting: leave the queue instead. This is the "Reconnecting…" case — the cause
    // cleared while it waited, so it must never appear (§4a.3).
    if (mine) {
      unqueue(mine, "dismissed");
      mine = null;
      return;
    }
    el.classList.add("toast--out");
    const reap = (): void => el.remove();
    el.addEventListener("transitionend", reap, { once: true });
    window.setTimeout(reap, REAP_FALLBACK_MS);
    drain(h); // the slot is free the moment it starts leaving
  };

  // Buttons: the caller's actions, then the notice's own close ("Got it" for a once-notice,
  // "Don't show again" for a dismissKey notice), then Dismiss (any other sticky toast).
  const buttons: ToastAction[] = [...(opts.actions ?? [])];
  if (opts.onceKey) buttons.push({ label: "Got it" });
  else if (notice) buttons.push({ label: "Don't show again", run: () => silenceNotice(noticeKey!) });
  // A question that brings its own Cancel (the delete confirm) or Later (the update offer)
  // needs no Dismiss beside it.
  if (sticky && !opts.onceKey && !buttons.some((b) => b.label === "Dismiss" || b.label === "Cancel" || b.label === "Later")) buttons.push({ label: "Dismiss" });
  if (buttons.length) {
    const row = document.createElement("div");
    row.className = "toast__actions";
    for (const a of buttons) {
      if (!a?.label) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "toast__btn";
      b.textContent = a.label;
      b.addEventListener("click", () => {
        try {
          a.run?.();
        } catch (e) {
          console.error("[toast] action", e);
        }
        if (opts.onceKey) silenceNotice(opts.onceKey); // any press: it has been seen
        dismiss();
      });
      row.appendChild(b);
    }
    el.appendChild(row);
  }

  if (!sticky) {
    const ms = opts.timeout && opts.timeout > 0 ? opts.timeout : DEFAULT_MS;
    const bar = document.createElement("div");
    bar.className = "toast__bar";
    bar.style.animationDuration = `${ms}ms`;
    el.appendChild(bar);
    remaining = ms;
    deadline = Date.now() + ms;
    timer = window.setTimeout(dismiss, ms);
    // Hover holds the clock: CSS pauses the bar, this pauses the reap.
    el.addEventListener("mouseenter", () => {
      if (gone || timer === undefined) return;
      window.clearTimeout(timer);
      timer = undefined;
      remaining = Math.max(MIN_RESUME_MS, deadline - Date.now());
    });
    el.addEventListener("mouseleave", () => {
      if (gone || timer !== undefined) return;
      deadline = Date.now() + remaining;
      timer = window.setTimeout(dismiss, remaining);
    });
  }

  // Past the cap a TIMED toast yields (`.toast__bar` is the timer bar). DOM order is
  // oldest-first; CSS decides which end is the edge. A timed arrival with nothing timed to
  // evict goes one over the cap for its few seconds rather than take a question's place —
  // before the queue it took `kids[0]`, which is how a question could be destroyed unread.
  const place = (): void => {
    while (liveToasts(h).length >= CAP) {
      const victim = liveToasts(h).find((k) => k.querySelector(".toast__bar"));
      if (!victim) break;
      victim.remove();
    }
    h.appendChild(el);
  };

  const ask = (opts.priority ?? (asks ? "ask" : "offer")) === "ask";
  const kids = liveToasts(h);
  if (sticky && kids.length >= CAP && !kids.some((k) => k.querySelector(".toast__bar"))) {
    // Identical text does not queue twice (§4a.4). The repeating-failure case is the real
    // overflow risk, and one line saying it once is the whole of its information.
    if (kids.some((k) => k.querySelector(".toast__text")?.textContent === current) || queue.some((q) => q.text === current)) {
      diag.log("toast:dupe", { text: logged });
      return INERT;
    }
    if (queue.length >= QUEUE_CAP) {
      diag.log("toast:dropped", { text: logged, why: "queue-full" });
      return INERT;
    }
    const q: Queued = {
      ask,
      get text() {
        return current;
      },
      get logged() {
        return strip(current);
      },
      noticeKey,
      place,
      dequeued: () => (mine = null),
    };
    // An ask jumps the line: behind the asks already waiting, ahead of every offer. What
    // gates an action is never stuck behind two harmless offers.
    let at = queue.length;
    if (ask) {
      at = 0;
      for (let i = 0; i < queue.length; i++) if (queue[i].ask) at = i + 1;
    }
    queue.splice(at, 0, q);
    mine = q;
    // An ask is dropped rather than shown late; an offer waits as long as it must.
    if (ask)
      q.wait = window.setTimeout(() => {
        unqueue(q, "stale");
        mine = null;
      }, ASK_WAIT_MS);
    diag.log("toast:queued", { text: logged, ask, at, waiting: queue.length });
  } else {
    place();
  }

  return {
    dismiss,
    update: (t: string) => {
      current = String(t ?? "");
      p.textContent = current;
    },
    shown: true,
    get queued() {
      return mine !== null;
    },
  };
}

// Console handle (prod too, like __diag — it costs nothing and lets a bug report
// say "run __toast.demo() and tell me what you see"). DEBUGGING.md §Toasts.
(window as any).__toast = {
  push: toast,
  /** One of each kind, so every theme × skin × surface can be eyeballed in one call. */
  demo(): void {
    toast({ kind: "info", text: "Info — a fact the UI can't show elsewhere." });
    toast({ kind: "success", text: "Success — link copied." });
    toast({ kind: "warn", text: "Warn — a routine failure, nothing to do." });
    toast({ kind: "error", text: "Error — sticky until you press Dismiss." });
  },
  /**
   * The queue (TOASTS.md §4a.7): push `n` sticky toasts. Three show, the rest wait.
   * `__toast.queue(4)` is step 1 of the desk test; `__toast.queue(4, "ask")` makes them
   * questions, which jump the line and expire after 30 s.
   */
  queue(n = 4, priority?: ToastPriority): ToastHandle[] {
    return Array.from({ length: n }, (_, i) =>
      toast({ kind: "info", sticky: true, text: `Sticky ${i + 1} of ${n}.`, priority }),
    );
  },
  /** How many are waiting, and what they are. */
  waiting(): { ask: boolean; text: string }[] {
    return queue.map((q) => ({ ask: q.ask, text: q.text }));
  },
  /** A one-time notice, keyed for the test run only (clear with __toast.reset()). */
  notice(): ToastHandle {
    return toast({ kind: "info", text: "Notice — Don't show again silences this key.", dismissKey: "deets.notice.demo" });
  },
  reset(): void {
    try {
      localStorage.removeItem("deets.notice.demo");
    } catch {
      /* storage disabled */
    }
  },
};
