// Last.fm — the Account flyout's second row (docs/LASTFM.md §4). Rust does the work
// (lastfm.rs): the connect, now playing, the scrobble queue. This module paints the row,
// starts and cancels the connect, and says how it ended. The scrobble trigger itself is
// stats.ts `lastfmHeard`.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as diag from "./diag";
import { toast } from "./toast";

export interface LastfmStatus {
  /** The build carries a Last.fm API key. */
  available: boolean;
  connected: boolean;
  name: string | null;
  /** Last.fm refused the saved session (error 9): connect again; the plays wait. */
  reconnect: boolean;
  /** Plays heard long enough and not yet sent. */
  waiting: number;
}

type AuthStatus =
  | { state: "idle" | "pending" }
  | { state: "connected"; name: string }
  | { state: "failed"; reason: string };

export const lastfmStatus = (): Promise<LastfmStatus> => invoke<LastfmStatus>("lastfm_status");

// The same sigils as the Apple row (main.ts); the colors come from `.account__btn[data-state]`.
const ICON_CHECK =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_X =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_SPINNER = '<span class="account__spinner"></span>';

/** A connect waits this long for Allow; Rust gives up at the same time (AUTH_TTL). */
const CONNECT_MS = 5 * 60 * 1000 + 5000;
const POLL_MS = 1000;

export function initLastfm(): void {
  const btn = document.getElementById("lastfm-action") as HTMLButtonElement | null;
  const icon = document.getElementById("lastfm-icon");
  const note = document.getElementById("lastfm-status");
  if (!btn || !icon || !note) return;

  let pending = false;
  let seq = 0;
  let reconnectToasted = false;

  const paint = async (override?: string) => {
    let s: LastfmStatus;
    try {
      s = await lastfmStatus();
    } catch (e) {
      diag.warn("lastfm:status", { e: String(e) });
      return;
    }
    if (pending) {
      btn.dataset.state = btn.dataset.state ?? "out";
      btn.disabled = false; // the second click cancels
      icon.innerHTML = ICON_SPINNER;
      note.textContent = "Click Allow in your browser, or click again to cancel.";
      return;
    }
    const inState = s.connected && !s.reconnect;
    btn.dataset.state = inState ? "in" : "out";
    btn.disabled = !s.available;
    icon.innerHTML = inState ? ICON_CHECK : ICON_X;
    btn.title = !s.available
      ? "Last.fm is not in this build of DeetsMusic"
      : inState
        ? "Disconnects Last.fm. Songs you hear stop going to your profile"
        : "Connects your Last.fm account in your browser. Songs you hear go to your Last.fm profile";
    note.textContent = "";
    if (override) note.textContent = override;
    else if (!s.available) note.textContent = "Not in this build";
    else if (s.reconnect) note.textContent = "Last.fm needs you to connect again. Your plays wait.";
    else if (!s.connected) note.textContent = "Not connected";
    else {
      // The name opens the profile: the user sees the plays land, and Last.fm gets its credit.
      note.append("Connected as ");
      const link = document.createElement("button");
      link.type = "button";
      link.className = "account__link account__link--inline";
      link.textContent = s.name ?? "";
      link.title = "Opens your Last.fm profile in your browser";
      link.addEventListener("click", () => void invoke("lastfm_open_profile").catch((e) => diag.warn("lastfm:profile", { e: String(e) })));
      note.append(link);
      if (s.waiting > 0) note.append(` · ${s.waiting} waiting`);
    }
  };

  const failed = (reason: string) => {
    const retry = [{ label: "Try again", run: () => void connect() }];
    diag.warn("lastfm:connectFailed", { reason });
    if (reason === "timeout") toast({ kind: "error", text: "Last.fm connect didn't finish in time.", actions: retry });
    else if (reason === "offline") toast({ kind: "warn", text: "Can't reach Last.fm. Check your connection, then try again.", actions: retry });
    else toast({ kind: "warn", text: "Last.fm connect didn't finish. Try again.", actions: retry });
  };

  const connect = async () => {
    const mine = ++seq;
    pending = true;
    await paint();
    try {
      await invoke("lastfm_begin_auth");
    } catch (e) {
      if (mine !== seq) return;
      pending = false;
      await paint("Connect didn't finish");
      return failed(String(e));
    }
    const start = Date.now();
    while (Date.now() - start < CONNECT_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (mine !== seq) return;
      const s = await invoke<AuthStatus>("lastfm_auth_status");
      if (s.state === "connected") {
        pending = false;
        diag.log("lastfm:connected", {});
        await paint();
        toast({ kind: "success", text: `Last.fm connected. Songs you hear now go to ${s.name}.` });
        return;
      }
      if (s.state === "failed") {
        pending = false;
        // The user's own cancel: the row as it was, no toast.
        if (s.reason === "cancelled") return void (await paint());
        await paint("Connect didn't finish");
        return failed(s.reason);
      }
    }
    pending = false;
    await invoke("lastfm_cancel_auth").catch(() => {});
    await paint("Connect didn't finish");
    failed("timeout");
  };

  const disconnect = async () => {
    try {
      await invoke("lastfm_disconnect");
    } catch (e) {
      diag.warn("lastfm:disconnect", { e: String(e) });
      toast({ kind: "warn", text: "Couldn't disconnect Last.fm. Try again." });
    }
    await paint();
  };

  btn.addEventListener("click", async () => {
    if (pending) {
      seq++; // the loop above stops painting
      pending = false;
      await invoke("lastfm_cancel_auth").catch(() => {});
      return void (await paint());
    }
    const s = await lastfmStatus();
    void (s.connected && !s.reconnect ? disconnect() : connect());
  });

  // Rust says the queue or the session changed (a send, a connect, a refused session).
  void listen("lastfm-changed", () => void paint());
  void listen("lastfm-reconnect", () => {
    if (reconnectToasted) return;
    reconnectToasted = true;
    toast({
      kind: "warn",
      sticky: true,
      text: "Last.fm stopped accepting DeetsMusic. Connect again to send your plays. They wait until then.",
      actions: [{ label: "Connect", run: () => void connect() }],
    });
  });
  void paint();
}
