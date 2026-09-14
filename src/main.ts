import { getCurrentWindow } from "@tauri-apps/api/window";
import { applyTheme, initTheme, type ThemeName } from "./theme";
import { applySkin, initSkin, type SkinName } from "./skin";
import { applySurface, fullSurface, initSurface, type SurfaceName } from "./surface";
import { initStorm } from "./storm";
import { initAmbient } from "./ambient";
import { initArtworkHeal } from "./artwork-heal";
import { setting, onSettingsChange } from "./settings-store";
import { requestCard } from "./layout-bus";
import { cancelSignIn, connect, disconnect, isConnected, SignInError } from "./apple";
import * as health from "./apple-health";
import * as diag from "./diag";
import { initTrackStore } from "./track-store";
import { initLayout } from "./layout";
import { getVolume, setVolume, toggleMute, isMuted, onVolumeChange, warmPlayer, noteSignedIn, clearMusicKitSignIn } from "./player";
import { toast } from "./toast";
import { ICON_VOL, ICON_MUTE } from "./volume-icons";
import { initNpBus, publishAppearance } from "./np-bus";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { makeSlider } from "./slider";
import { makeDropdown, setDropdownMode, type DropdownMode } from "./dropdown";
import { initAirplay, mountAirplay } from "./airplay";
import { withAppearanceTransition } from "./appearance";
import * as frames from "./frames";
import { initFavorites } from "./favorites";
import { initQueuePersist } from "./queue-persist";
import { runWeeklyReplay } from "./replay";
import type { CardId } from "./cards";

// Wire the custom traffic lights to the OS window. The titlebar drag is
// handled declaratively by data-tauri-drag-region on .drag-region in index.html.
const appWindow = getCurrentWindow();

window.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initSkin();
  initSurface();
  initStorm(); // storm-layer position re-roll; inert unless the skin opts in
  initAmbient(); // pause the skins' decorative loops while the window is minimized / in the tray
  initArtworkHeal(); // retry cover <img>s that fail to load (sleep/wake, network blips)
  // File drops belong to the page (tauri.conf.json `dragDropEnabled: false`, for the playlist
  // cover). A drop no element took must not navigate the webview to the file.
  window.addEventListener("dragover", (e) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
  });
  window.addEventListener("drop", (e) => e.preventDefault());
  initNpBus(); // tray panel + extension hub + Windows media session (TRAY.md / EXTENSION.md / smtc.rs)

  // ── Menu mode (click vs hover) — one setting drives every dropdown. The dropdown
  //    primitive owns the cross-instance fan-out (setDropdownMode); here we own the
  //    persistence + the Hover-Menu toggle UI. ──
  setDropdownMode(setting("menuMode")); // seed the primitive's global mode before any dropdown is made

  // ── Window controls ──────────────────────────────────────────
  document.getElementById("tl-min")?.addEventListener("click", () => appWindow.minimize());
  document.getElementById("tl-max")?.addEventListener("click", () => appWindow.toggleMaximize());
  document.getElementById("tl-close")?.addEventListener("click", () => appWindow.close());

  // ── Settings that act on the window / the dropdown primitive: applied here on
  //    launch and whenever the Settings card changes them (SETTINGS.md). ──
  const applyAlwaysOnTop = (on: boolean) => appWindow.setAlwaysOnTop(on).catch((e) => console.error("[aot]", e));
  applyAlwaysOnTop(setting("alwaysOnTop")); // re-apply on launch
  onSettingsChange((k) => {
    if (k === "alwaysOnTop") applyAlwaysOnTop(setting("alwaysOnTop"));
    if (k === "menuMode") setDropdownMode(setting("menuMode") as DropdownMode);
  });

  // ── Settings menu (mode follows the Hover-Menu setting; submenus stay hover) ──
  const settingsRoot = document.querySelector<HTMLElement>(".settings");
  const trigger = document.getElementById("settings-trigger");
  const menu = document.getElementById("settings-menu");
  if (!settingsRoot || !trigger || !menu) return;

  const settingsDropdown = makeDropdown({ root: settingsRoot, trigger, panel: menu });
  const close = () => settingsDropdown.close();

  // ── Settings… → summon the Settings card into a slot (the hybrid, SETTINGS.md). ──
  document.getElementById("settings-open")?.addEventListener("click", () => {
    requestCard("settings");
    close();
  });

  // Theme choices — a color crossfade (appearance.ts); the menu closes inside the
  // transition so the old snapshot never catches it half-closed.
  document.querySelectorAll<HTMLElement>("[data-theme-choice]").forEach((el) => {
    el.addEventListener("click", () => {
      // `after` runs inside the transition's update callback, AFTER applyTheme — a publish
      // outside it would read the attributes before they flip and report the OLD theme.
      withAppearanceTransition("theme", () => applyTheme(el.dataset.themeChoice as ThemeName), {
        after: () => {
          close();
          publishAppearance(); // tray panel + extension popup follow (they snap)
        },
      });
    });
  });

  // Skin choices (same pattern as Theme) — the incoming skin's own entrance.
  document.querySelectorAll<HTMLElement>("[data-skin-choice]").forEach((el) => {
    el.addEventListener("click", () => {
      const skin = el.dataset.skinChoice as SkinName;
      withAppearanceTransition("skin", () => applySkin(skin), {
        skin,
        after: () => {
          close();
          publishAppearance();
        },
      });
    });
  });

  // Keyboard shortcuts (NEXT-VERSION §5): summon a card. Fixed set; ignored while a
  // text field has focus. Rebinding is deferred (FUTURE-SETTINGS).
  const SHORTCUTS: Record<string, CardId> = { k: "search", q: "queue", l: "library", p: "playlists", ",": "settings" };
  document.addEventListener("keydown", (e) => {
    if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("input, textarea, [contenteditable]")) return;
    const id = SHORTCUTS[e.key.toLowerCase()];
    if (!id) return;
    e.preventDefault();
    requestCard(id);
  });

  // Surface choices (same pattern). A deliberate pick also pins a tray-popped window
  // (it stops hiding on blur) — the user has made it theirs.
  document.querySelectorAll<HTMLElement>("[data-surface-choice]").forEach((el) => {
    el.addEventListener("click", () => {
      void applySurface(el.dataset.surfaceChoice as SurfaceName);
      invoke("tray_pin_main").catch(() => {});
      close();
    });
  });

  // Tray left-click (TRAY.md §1): go mini, then let Rust anchor + show the window at
  // the click. Order matters — the anchor needs the mini size, so we resize first.
  void listen("tray-pop", () => {
    applySurface("mini", true)
      .catch((e) => console.error("[tray] mini", e))
      .then(() => invoke("tray_place_main"))
      .catch((e) => console.error("[tray] place", e));
  });
  // Tray menu "Open DeetsMusic": the real app — back to the full surface (midi/max) at
  // its own remembered size; Rust then restores the pre-pop position and pins it.
  void listen("tray-open", () => {
    applySurface(fullSurface())
      .catch((e) => console.error("[tray] full", e))
      .then(() => invoke("tray_place_main"))
      .catch((e) => console.error("[tray] place", e));
  });

  // ── Account (Apple Music — loopback browser auth) ────────────
  const acctStatus = document.getElementById("account-status");
  const acctBtn = document.getElementById("account-action");
  const acctIcon = document.getElementById("account-icon");

  const ICON_CHECK =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_X =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const ICON_SPINNER = '<span class="account__spinner"></span>';

  type AcctState = "in" | "out" | "loading";
  // `fallback`: the hosted sign-in is waiting in the browser; offer the loopback page
  // under the note (DATA-ARCHITECTURE §2a fork 5 — a Worker outage or a blocked domain).
  const setAccount = (state: AcctState, note?: string, fallback?: () => void) => {
    if (acctIcon) acctIcon.innerHTML = state === "in" ? ICON_CHECK : state === "out" ? ICON_X : ICON_SPINNER;
    if (acctBtn) {
      acctBtn.dataset.state = state === "loading" ? acctBtn.dataset.state ?? "out" : state;
      acctBtn.toggleAttribute("disabled", state === "loading");
    }
    if (acctStatus) {
      acctStatus.textContent =
        note ?? (state === "in" ? "Connected" : state === "out" ? "Not connected" : "Working…");
      if (fallback) {
        const link = document.createElement("button");
        link.type = "button";
        link.className = "account__link";
        link.textContent = "Browser page didn't load? Use local sign-in";
        link.addEventListener("click", fallback);
        acctStatus.append(link);
      }
    }
  };
  // The row follows Apple health too (apple-health.ts): a token on disk only means the
  // user signed in once, not that Apple still accepts it. An expired sign-in reads as
  // signed out (the button signs in); an Apple-side problem keeps "Connected" and says so.
  let acctTrouble: health.Trouble = "none";
  const paintAccount = async (note?: string) => {
    const hasToken = await isConnected();
    if (!hasToken) return setAccount("out", note);
    if (acctTrouble === "signin") return setAccount("out", note ?? "Sign-in expired");
    const troubleNote =
      acctTrouble === "app" ? "Connected · Apple Music isn't responding" : acctTrouble === "offline" ? "Connected · Offline" : undefined;
    setAccount("in", note ?? troubleNote);
  };
  health.onTrouble((t) => {
    acctTrouble = t;
    void paintAccount();
  });

  // Sign-in failures in plain words, each with the button that helps (TOASTS.md §Apple
  // health). The flyout is usually closed by the time a sign-in ends, so the toast is
  // the visible half; the raw reason stays in the console and the log.
  const signInFailed = (e: unknown) => {
    const retry = [{ label: "Try again", run: () => void signIn() }];
    const code = e instanceof SignInError ? e.code : "other";
    diag.warn("account:signInFailed", { code, reason: e instanceof Error ? e.message : String(e) });
    if (code === "unavailable") health.show("app", true, "signin");
    else if (code === "offline") health.show("offline", true, "signin");
    else if (code === "timeout")
      // A hosted sign-in that never returned (the link was not followed, or the scheme is not
      // registered — DATA-ARCHITECTURE §2a) ends here too, so the local page is offered next to Try again.
      toast({ kind: "error", text: "Sign-in didn't finish in time.", actions: [...retry, { label: "Use local sign-in", run: () => void signIn(true) }] });
    else if (code === "ports") toast({ kind: "warn", text: "Another sign-in page is still open. Close it, then try again.", actions: retry });
    else if (code === "rejected")
      // Apple said Unauthorized: an Apple-side problem gets its own toast; otherwise say it plainly.
      void health.check(true, true, "signin", true).then((r) => {
        if (r.trouble !== "app" && r.trouble !== "offline")
          toast({ kind: "warn", text: "Apple Music didn't accept the sign-in. Try again in a few minutes.", actions: retry });
      });
    else toast({ kind: "warn", text: "Sign-in didn't finish. Try again.", actions: retry });
  };

  // One sign-in at a time owns the row: the fallback link starts a second `connect()`
  // while the first still polls, and both resolve on the same capture. Only the newest
  // paints, resets health, or toasts; the older one returns quietly.
  let signInSeq = 0;
  let signInPending = false;
  const signIn = async (local = false) => {
    const mine = ++signInSeq;
    signInPending = true;
    setAccount("loading", "Continue in your browser, or click again to cancel.", local ? undefined : () => void signIn(true));
    acctBtn?.removeAttribute("disabled"); // the second click cancels (below)
    try {
      await connect(local);
      if (mine !== signInSeq) return;
      signInPending = false;
      noteSignedIn(); // the first playback failure after this gets the subscription hint
      health.reset();
      await paintAccount();
      // The user is usually still in the browser; this says the app took the token
      // (`all` tier, TOASTS.md §5).
      toast({ kind: "success", text: "Sign-in complete! Enjoy!" });
    } catch (e) {
      if (mine !== signInSeq) return;
      signInPending = false;
      // The user's own cancel: back to the row as it was, no toast.
      if (e instanceof SignInError && e.message === "cancelled") return void (await paintAccount());
      console.error("[account] sign-in failed", e);
      await paintAccount("Sign-in didn't finish");
      signInFailed(e);
    }
  };
  const cancelPending = async () => {
    signInPending = false;
    try {
      await cancelSignIn();
    } catch (e) {
      console.error("[account] cancel failed", e);
    }
  };

  const signOut = async () => {
    setAccount("loading", "Disconnecting…");
    try {
      await disconnect();
      clearMusicKitSignIn(); // MusicKit's own copy too (no Apple logout call)
      health.reset();
      await paintAccount();
    } catch (e) {
      console.error("[account] sign-out failed", e);
      await paintAccount();
      toast({ kind: "warn", text: "Couldn't sign out. Try again." });
    }
  };

  acctBtn?.addEventListener("click", async () => {
    if (signInPending) return void cancelPending();
    const signedIn = (await isConnected()) && acctTrouble !== "signin";
    void (signedIn ? signOut() : signIn());
  });
  window.addEventListener("deets:sign-in", () => void signIn()); // the "Sign in" toast button
  void paintAccount();

  // No developer token at all (a first run offline, or the mint's KILL switch —
  // RELEASE.md §7): Rust logged it at setup and every Apple call will fail with the
  // same text, but the window looks fine. Say so once, at launch (TOASTS.md). Local,
  // zero-cost: the command reads the static the setup step resolved.
  invoke<string>("apple_developer_token").catch((e) => {
    console.warn("[boot] no developer token:", e);
    toast({ kind: "error", text: "Can't reach the token service. Check your connection and restart DeetsMusic." });
  });

  // Remote notice (support.md): the Worker's CONFIG `notice` rides the /token response,
  // so an outage message reaches installs without a release. It refreshes when the token
  // does (about weekly). Shown once per distinct text; "Don't show again" silences that text.
  invoke<{ notice?: unknown }>("apple_remote_config")
    .then((cfg) => {
      const text = typeof cfg?.notice === "string" ? cfg.notice.trim() : "";
      if (!text) return;
      let h = 5381;
      for (const ch of text) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
      toast({ kind: "info", text, dismissKey: `deets.notice.remote.${h.toString(36)}` });
    })
    .catch((e) => console.warn("[boot] remote config:", e));

  // ── Shared library store: one load, read by every card ──
  initTrackStore();
  void initFavorites(); // the ♥ mirror (favorites.ts) — local, zero Apple calls
  void initQueuePersist(); // last session's song + Up Next + Previous, per Settings › Restore on launch
  // Warm MusicKit + the DRM module at idle so the session's first click pays neither
  // (player.ts warmPlayer; measured ~1 s + ~0.6–1.3 s on the click before this).
  window.setTimeout(warmPlayer, 1500);
  frames.init(); // dev-only frame telemetry (frames.ts): scroll / scrub / slide / drag windows

  // The weekly Replay (replay.ts): once per week on/after the chosen day, after the
  // store has had a moment to load so the ranking can resolve titles.
  window.setTimeout(() => void runWeeklyReplay().catch((e) => console.warn("[replay] weekly", e)), 8000);

  // ── Cards + layout: mount Now Playing (anchored top) + the two swappable content slots
  //    from the persisted assignment, and wire each slot's title picker. ──
  initLayout();

  // ── Volume: titlebar pill (level meter) + hover flyout + vertical slider ──
  const volRoot = document.getElementById("vol");
  const volPill = document.getElementById("vol-pill");
  const volPanel = document.getElementById("vol-panel");
  const volScrub = document.querySelector<HTMLElement>("#vol-scrub");
  const volMute = document.getElementById("vol-mute");
  if (volRoot && volPill && volPanel && volScrub && volMute) {
    // Paint a 0..1 level into the pill fill, the slider handle, and the glyph.
    const reflect = (v: number) => {
      const pct = (Math.max(0, Math.min(1, v)) * 100).toFixed(2);
      volPill.style.setProperty("--vol-pill-fill", `${pct}%`);
      slider.setValue(v);
      volMute.innerHTML = isMuted() || v === 0 ? ICON_MUTE : ICON_VOL;
      volMute.setAttribute("aria-pressed", String(isMuted()));
    };

    const slider = makeSlider(volScrub, {
      axis: "y",
      onDrag: (frac) => { setVolume(frac); reflect(getVolume()); },
      onCommit: (frac) => { setVolume(frac); reflect(getVolume()); },
    });

    reflect(getVolume()); // seed from the persisted level
    onVolumeChange(() => reflect(getVolume())); // the stage row, tray, agent routes

    // Shared dropdown mechanism; shouldStayOpen keeps it up through a drag —
    // or while the nested "Play on" panel is open.
    const volAirplay = document.getElementById("vol-airplay");
    makeDropdown({
      root: volRoot, trigger: volPill, panel: volPanel,
      shouldStayOpen: () => slider.dragging || volAirplay?.getAttribute("aria-expanded") === "true",
    });
    if (volAirplay) mountAirplay(volAirplay);
    initAirplay();

    volMute.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMute();
      reflect(getVolume());
    });
  }
});
