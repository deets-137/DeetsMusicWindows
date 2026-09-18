// Apple health — the one place that tells the user why Apple Music stopped working
// (TOASTS.md §Apple health). Every failure path (a play, MusicKit's own error dialog,
// a sign-in) asks here instead of raising its own toast, so one cause gets one toast,
// named in the user's terms, with the one button that fixes it.
//
// Bounded, because failures arrive without bound: Rust caches the check (60 s, forced
// checks ≥ 10 s apart) and refetches the developer token at most once per 10 min; this
// module keeps one toast per cause and rechecks every 5 min only while an Apple-side
// problem lasts, then stops.

import { listen } from "@tauri-apps/api/event";
import { toast, type ToastAction, type ToastHandle, type ToastKind } from "./toast";
import { checkApple, requestSignIn, type AppleHealth } from "./apple";
import { walkActive } from "./walk";
import * as diag from "./diag";

/** none · app = Apple refuses DeetsMusic · offline · signin = the user's sign-in expired · signedOut */
export type Trouble = "none" | "app" | "offline" | "signin" | "signedOut";

const RECHECK_MS = 5 * 60 * 1000;

const COPY: Record<Exclude<Trouble, "none">, { kind: ToastKind; text: string; action: ToastAction }> = {
  // Not the user's fault and not theirs to fix: say so, and say the app keeps trying.
  app: {
    kind: "error",
    text: "Apple Music isn't responding to DeetsMusic right now. Your account is fine. DeetsMusic keeps trying.",
    action: { label: "Try now", run: () => void check(true, true, "tryNow") },
  },
  offline: {
    kind: "warn",
    text: "DeetsMusic can't reach Apple Music. Check your internet connection.",
    action: { label: "Try again", run: () => void check(true, true, "tryNow") },
  },
  signin: {
    kind: "error",
    text: "Apple Music signed you out. Sign in again to keep listening.",
    action: { label: "Sign in", run: requestSignIn },
  },
  signedOut: {
    kind: "warn",
    text: "Sign in to Apple Music to play songs.",
    action: { label: "Sign in", run: requestSignIn },
  },
};

let current: Trouble = "none";
let handle: ToastHandle | null = null;
let recheck = 0;
const listeners = new Set<(t: Trouble) => void>();

export const trouble = (): Trouble => current;

/** The Account row follows this (main.ts). Called at once with the current state. */
export function onTrouble(fn: (t: Trouble) => void): () => void {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}

function troubleOf(h: AppleHealth): Trouble {
  if (h.app === "unreachable") return "offline";
  if (h.app !== "ok") return "app";
  if (h.signin === "expired") return "signin";
  if (h.signin === "none") return "signedOut";
  return "none";
}

/**
 * Set the state. A toast shows when the cause changes, or when `force` (a user action
 * just hit the same wall: they should see why, even if they dismissed it before).
 * `quiet` skips the sign-in toasts only (a sign-in in progress owns those messages);
 * an Apple-side problem still shows, because the sign-in cannot explain it.
 */
export function show(t: Trouble, force = false, source = "show", quiet = false): void {
  const was = current;
  current = t;
  if (t !== was || force) {
    handle?.dismiss();
    handle = null;
    // The first-run walk owns "you are signed out" while it is on screen: its step 1 says
    // the same thing with the same button, and one cause must raise one notice (TOASTS.md).
    // A user who has ever signed in never sees the walk, so they get this sticky as before.
    const owned = t === "signedOut" && walkActive();
    if (t !== "none" && !owned && !(quiet && (t === "signin" || t === "signedOut"))) {
      const c = COPY[t];
      handle = toast({
        kind: c.kind,
        text: c.text,
        sticky: true,
        actions: [{ label: c.action.label, run: () => { handle = null; c.action.run?.(); } }],
      });
    } else if (t === "none" && (was === "app" || was === "offline")) {
      toast({ kind: "success", text: "Apple Music is working again." });
    }
  }
  window.clearTimeout(recheck);
  if (t === "app" || t === "offline") recheck = window.setTimeout(() => void check(true, false, "recheck"), RECHECK_MS);
  if (t !== was) {
    (t === "none" ? diag.log : diag.warn)("apple:trouble", { t, was, source });
    listeners.forEach((fn) => fn(t));
  }
}

// Rust saw a 403 on a /v1/me call (apple.rs log_failure, at most once a minute): the saved
// sign-in token is refused — typically a dead token at launch, found by the library sync.
// Name it now instead of letting the sync fail quietly.
void listen("apple-signin-rejected", () => void check(false, false, "rust403"));

/** Forget any trouble without a toast (after a deliberate sign-out). */
export function reset(): void {
  show("none", false, "reset", true);
}

/**
 * Ask Rust which token Apple rejects (healing the developer token if it can) and show
 * the result. Returns the cause and whether the developer token was swapped.
 */
export async function check(
  fresh = false,
  force = false,
  source = "check",
  quiet = false,
): Promise<{ trouble: Trouble; healed: boolean }> {
  try {
    const h = await checkApple(fresh);
    const t = troubleOf(h);
    show(t, force, source, quiet);
    return { trouble: t, healed: h.healed };
  } catch (e) {
    diag.warn("apple:checkFailed", { err: String(e), source });
    return { trouble: current, healed: false };
  }
}
