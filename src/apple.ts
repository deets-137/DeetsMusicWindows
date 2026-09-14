// Apple Music auth bridge (frontend half).
//
// Auth runs in the user's default browser via a Rust loopback server (the in-app
// webview can't open OAuth popups). This module just drives the Rust commands;
// the Music User Token lives in Rust and never enters the renderer.

import { invoke } from "@tauri-apps/api/core";

export async function isConnected(): Promise<boolean> {
  try {
    return await invoke<boolean>("apple_connection_status");
  } catch {
    return false;
  }
}

export async function disconnect(): Promise<void> {
  await invoke("apple_disconnect");
}

/** Dev-only: dump a raw sample of the library to dev-dumps/. Returns a summary. */
export async function dumpLibrary(): Promise<string> {
  return invoke<string>("apple_dump_library");
}

/** Why a sign-in failed, in terms the Account UI can explain (main.ts). */
export type SignInFailure = "timeout" | "rejected" | "cancelled" | "unavailable" | "offline" | "ports" | "other";

export class SignInError extends Error {
  constructor(readonly code: SignInFailure, message: string) {
    super(message);
  }
}

type AuthStatus = { state: "idle" | "pending" | "captured" } | { state: "failed"; reason: string };

/**
 * Open the system browser to sign in, then poll Rust's sign-in status until the page
 * delivers a NEW token or reports a failure. Polling the status (not "is a token
 * present") matters for a re-sign-in over an expired token, which is still present.
 *
 * The page is the hosted one (DATA-ARCHITECTURE §2a) when its Worker answers, else the
 * loopback page; `local` asks for the loopback page outright (the Account row's link).
 */
export async function connect(local = false, timeoutMs = devSignInTimeout() ?? 5 * 60 * 1000): Promise<void> {
  // Pass the active theme/skin so the browser sign-in page matches the app.
  const theme = document.documentElement.dataset.theme ?? "lilac";
  const skin = document.documentElement.dataset.skin ?? "press";
  try {
    await invoke("apple_begin_auth", { theme, skin, local }); // checks the app token, opens the browser
  } catch (e) {
    const msg = String(e);
    const code: SignInFailure =
      msg === "apple-unavailable" ? "unavailable" : msg === "offline" ? "offline" : /in use/i.test(msg) ? "ports" : "other";
    throw new SignInError(code, msg);
  }
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1200));
    const s = await invoke<AuthStatus>("apple_auth_status");
    if (s.state === "captured") return;
    if (s.state === "failed") {
      const code: SignInFailure = /unauthori[sz]ed|forbidden/i.test(s.reason)
        ? "rejected"
        : /cancel|closed|denied/i.test(s.reason)
          ? "cancelled"
          : s.reason === "timeout"
            ? "timeout"
            : "other";
      throw new SignInError(code, s.reason);
    }
  }
  throw new SignInError("timeout", "Timed out waiting for browser sign-in");
}

/** Stop the sign-in in progress (the Account button clicked again while it waits). The
 *  pending `connect()` then rejects with code "cancelled" and reason "cancelled". */
export const cancelSignIn = (): Promise<void> => invoke("apple_cancel_auth");

/** Rust's bounded health check (apple.rs `apple_check`): which token Apple rejects. */
export interface AppleHealth {
  app: "ok" | "rejected" | "unreachable" | "missing";
  signin: "ok" | "expired" | "none" | "unknown";
  healed: boolean;
}

export const checkApple = (fresh = false): Promise<AppleHealth> => invoke<AppleHealth>("apple_check", { fresh });

/** Ask the Account flow (main.ts) to start a sign-in — the "Sign in" toast button. */
export function requestSignIn(): void {
  window.dispatchEvent(new Event("deets:sign-in"));
}

/** Dev-only test seam: `localStorage["deets.dev.signInTimeoutMs"]` shortens the sign-in
 *  wait, to reach the timeout toast in seconds (DEBUGGING.md §Toasts). Release: none. */
function devSignInTimeout(): number | undefined {
  if (!import.meta.env.DEV) return undefined;
  try {
    const ms = Number(localStorage.getItem("deets.dev.signInTimeoutMs"));
    return ms > 0 ? ms : undefined;
  } catch {
    return undefined;
  }
}
