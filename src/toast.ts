// Toasts — the app's one transient-notice primitive (docs/TOASTS.md; the design
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
//
// Tiers (`setting("toasts")`): "failures" = warn + error + notices · "all" = every
// kind · "off" = nothing. A gated call returns an inert handle (`shown: false`), and
// the console/diag logging at the call site is untouched — diag stays the source of
// truth for what happened (every call logs `toast` or `toast:muted`).
//
// Stack: newest nearest the edge it grew from, capped at 3. Past the cap the oldest
// TIMED toast yields first; sticky ones go only when nothing timed is left.
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
}

export interface ToastHandle {
  /** Retire the toast now (a "Reconnecting…" that dies on reconnect). */
  dismiss(): void;
  /** Rewrite the text in place (a countdown, a progress line). */
  update(text: string): void;
  /** False when the tier or a `dismissKey` already at "off" swallowed the call. */
  readonly shown: boolean;
}

const CAP = 3;
const DEFAULT_MS = 3200;
const MIN_RESUME_MS = 400; // leaving the hover with almost no time left still reads
const REAP_FALLBACK_MS = 600; // transitionend lost (reduced motion, display:none) → reap anyway

const INERT: ToastHandle = { dismiss() {}, update() {}, shown: false };

let host: HTMLElement | null = null;
function ensureHost(): HTMLElement {
  if (host) return host;
  host = document.createElement("div");
  host.className = "toast-host";
  host.setAttribute("aria-live", "polite");
  document.body.appendChild(host);
  return host;
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

/** Does the current tier let this call through? */
function admitted(kind: ToastKind, notice: boolean): boolean {
  const tier = setting("toasts");
  if (tier === "off") return false;
  if (tier === "all") return true;
  return notice || kind === "warn" || kind === "error";
}

/** Show a toast. See the header for the contract. */
export function toast(opts: ToastOptions): ToastHandle {
  const kind: ToastKind = opts.kind && KINDS.includes(opts.kind) ? opts.kind : "info";
  const notice = !!opts.dismissKey;
  const sticky = notice || (opts.sticky ?? kind === "error");
  const text = String(opts.text ?? "");

  if (notice && noticeOff(opts.dismissKey!)) {
    diag.log("toast:muted", { kind, text, why: "notice-off", key: opts.dismissKey });
    return INERT;
  }
  if (!admitted(kind, notice)) {
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

  const dismiss = (): void => {
    if (gone) return;
    gone = true;
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
    el.classList.add("toast--out");
    const reap = (): void => el.remove();
    el.addEventListener("transitionend", reap, { once: true });
    window.setTimeout(reap, REAP_FALLBACK_MS);
  };

  // Buttons: the caller's actions, then Don't show again (notices), then Dismiss (sticky).
  const buttons: ToastAction[] = [...(opts.actions ?? [])];
  if (notice) buttons.push({ label: "Don't show again", run: () => silenceNotice(opts.dismissKey!) });
  if (sticky && !buttons.some((b) => b.label === "Dismiss")) buttons.push({ label: "Dismiss" });
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

  // Past the cap the oldest timed toast yields; sticky ones only when nothing timed is left.
  // DOM order is oldest-first; CSS decides which end is the edge.
  const live = (): HTMLElement[] =>
    [...h.children].filter((c): c is HTMLElement => c instanceof HTMLElement && !c.classList.contains("toast--out"));
  while (live().length >= CAP) {
    const kids = live();
    const victim = kids.find((k) => k.querySelector(".toast__bar")) ?? kids[0];
    victim.remove();
  }
  h.appendChild(el);

  return {
    dismiss,
    update: (t: string) => {
      p.textContent = String(t ?? "");
    },
    shown: true,
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
