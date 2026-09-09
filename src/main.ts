import { getCurrentWindow } from "@tauri-apps/api/window";
import { applyTheme, initTheme, type ThemeName } from "./theme";
import { applySkin, initSkin, type SkinName } from "./skin";
import { applySurface, fullSurface, initSurface, type SurfaceName } from "./surface";
import { initStorm } from "./storm";
import { initArtworkHeal } from "./artwork-heal";
import { libraryAddEnabled, setLibraryAddEnabled } from "./library-add";
import { connect, disconnect, isConnected } from "./apple";
import { initTrackStore } from "./track-store";
import { initLayout } from "./layout";
import { getVolume, setVolume, toggleMute, isMuted } from "./player";
import { initMediaSession } from "./media-session";
import { initNpBus, publishAppearance } from "./np-bus";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { makeSlider } from "./slider";
import { makeDropdown, setDropdownMode, type DropdownMode } from "./dropdown";

// Wire the custom traffic lights to the OS window. The titlebar drag is
// handled declaratively by data-tauri-drag-region on .drag-region in index.html.
const appWindow = getCurrentWindow();

window.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initSkin();
  initSurface();
  initStorm(); // storm-layer position re-roll; inert unless the skin opts in
  initArtworkHeal(); // retry cover <img>s that fail to load (sleep/wake, network blips)
  initMediaSession(); // Windows media keys + the SMTC flyout (no-op if the runtime declines)
  initNpBus(); // tray panel + extension hub (TRAY.md / EXTENSION.md)

  // ── Menu mode (click vs hover) — one setting drives every dropdown. The dropdown
  //    primitive owns the cross-instance fan-out (setDropdownMode); here we own the
  //    persistence + the Hover-Menu toggle UI. ──
  const MENU_MODE_KEY = "deets.menuMode";
  const initialMode: DropdownMode = localStorage.getItem(MENU_MODE_KEY) === "hover" ? "hover" : "click";
  setDropdownMode(initialMode); // seed the primitive's global mode before any dropdown is made
  const applyMenuMode = (m: DropdownMode) => {
    setDropdownMode(m);
    try {
      localStorage.setItem(MENU_MODE_KEY, m);
    } catch {
      /* storage disabled — still applies for the session */
    }
  };

  // ── Window controls ──────────────────────────────────────────
  document.getElementById("tl-min")?.addEventListener("click", () => appWindow.minimize());
  document.getElementById("tl-max")?.addEventListener("click", () => appWindow.toggleMaximize());
  document.getElementById("tl-close")?.addEventListener("click", () => appWindow.close());

  // ── Always on Top (toggle row; choice persists like the theme) ──
  const AOT_KEY = "deets.alwaysOnTop";
  const aotToggle = document.getElementById("aot-toggle");
  const applyAlwaysOnTop = (on: boolean) => {
    appWindow.setAlwaysOnTop(on).catch((e) => console.error("[aot]", e));
    aotToggle?.setAttribute("aria-checked", String(on));
    try {
      localStorage.setItem(AOT_KEY, String(on));
    } catch {
      /* storage disabled — still applies for the session */
    }
  };
  applyAlwaysOnTop(localStorage.getItem(AOT_KEY) === "true"); // re-apply on launch
  aotToggle?.addEventListener("click", (e) => {
    e.stopPropagation(); // keep the menu open so the dot feedback is visible
    applyAlwaysOnTop(aotToggle.getAttribute("aria-checked") !== "true");
  });

  // ── Settings menu (mode follows the Hover-Menu setting; submenus stay hover) ──
  const settingsRoot = document.querySelector<HTMLElement>(".settings");
  const trigger = document.getElementById("settings-trigger");
  const menu = document.getElementById("settings-menu");
  if (!settingsRoot || !trigger || !menu) return;

  const settingsDropdown = makeDropdown({ root: settingsRoot, trigger, panel: menu });
  const close = () => settingsDropdown.close();

  // ── Hover-Menu toggle: flips click ↔ hover for every dropdown at once ──
  const hoverToggle = document.getElementById("hover-toggle");
  hoverToggle?.setAttribute("aria-checked", String(initialMode === "hover"));
  hoverToggle?.addEventListener("click", (e) => {
    e.stopPropagation(); // keep the menu open so the dot feedback is visible
    const next: DropdownMode = hoverToggle.getAttribute("aria-checked") === "true" ? "click" : "hover";
    hoverToggle.setAttribute("aria-checked", String(next === "hover"));
    applyMenuMode(next);
  });

  // ── Library Add: reveals the "Add to Library" right-click item (default off; the
  //    module owns persistence, menus read the flag at build time — no fan-out). ──
  const libraryAddToggle = document.getElementById("libraryadd-toggle");
  libraryAddToggle?.setAttribute("aria-checked", String(libraryAddEnabled()));
  libraryAddToggle?.addEventListener("click", (e) => {
    e.stopPropagation(); // keep the menu open so the dot feedback is visible
    const next = libraryAddToggle.getAttribute("aria-checked") !== "true";
    setLibraryAddEnabled(next);
    libraryAddToggle.setAttribute("aria-checked", String(next));
  });

  // ── Minimize to Tray: × hides the window instead of quitting (TRAY.md; default on;
  //    the Rust side owns it because the close policy runs before any JS can answer). ──
  const trayToggle = document.getElementById("tray-toggle");
  interface BackendSettings { minimizeToTray: boolean; readWindowsMedia: boolean }
  invoke<BackendSettings>("settings_get")
    .then((s) => trayToggle?.setAttribute("aria-checked", String(s.minimizeToTray)))
    .catch((e) => console.warn("[settings] get", e));
  trayToggle?.addEventListener("click", (e) => {
    e.stopPropagation(); // keep the menu open so the dot feedback is visible
    const next = trayToggle.getAttribute("aria-checked") !== "true";
    trayToggle.setAttribute("aria-checked", String(next));
    invoke("settings_set_minimize_to_tray", { on: next }).catch((err) => console.error("[settings] tray", err));
  });

  // ── Extension flyout: bridge status + install guide + bridge log (EXTENSION.md).
  //    No pairing code: the bridge trusts the extension's Origin header. ──
  interface BridgeInfo { port: number | null; token: string; ports: number[] }
  const extStatus = document.getElementById("ext-status");
  invoke<BridgeInfo>("bridge_info")
    .then((b) => {
      if (extStatus) extStatus.textContent = b.port ? `Bridge on 127.0.0.1:${b.port}` : "Bridge off (no free port)";
    })
    .catch((e) => console.warn("[bridge] info", e));
  const flash = (el: HTMLElement | null, text: string) => {
    if (!el) return;
    const was = el.textContent;
    el.textContent = text;
    window.setTimeout(() => (el.textContent = was), 1200);
  };
  document.getElementById("ext-install")?.addEventListener("click", (e) => {
    e.stopPropagation();
    invoke("bridge_open_install_page").catch((err) => console.error("[bridge] install page", err));
  });
  document.getElementById("ext-log")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const btn = e.currentTarget as HTMLElement;
    invoke<string>("bridge_log").then((text) =>
      navigator.clipboard.writeText(text).then(
        () => flash(btn, "Copied"),
        () => console.log(text),
      ),
    );
  });

  // Theme choices.
  document.querySelectorAll<HTMLElement>("[data-theme-choice]").forEach((el) => {
    el.addEventListener("click", () => {
      applyTheme(el.dataset.themeChoice as ThemeName);
      publishAppearance(); // tray panel + extension popup follow
      close();
    });
  });

  // Skin choices (same pattern as Theme).
  document.querySelectorAll<HTMLElement>("[data-skin-choice]").forEach((el) => {
    el.addEventListener("click", () => {
      applySkin(el.dataset.skinChoice as SkinName);
      publishAppearance();
      close();
    });
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
  const setAccount = (state: AcctState, note?: string) => {
    if (acctIcon) acctIcon.innerHTML = state === "in" ? ICON_CHECK : state === "out" ? ICON_X : ICON_SPINNER;
    if (acctBtn) {
      acctBtn.dataset.state = state === "loading" ? acctBtn.dataset.state ?? "out" : state;
      acctBtn.toggleAttribute("disabled", state === "loading");
    }
    if (acctStatus) {
      acctStatus.textContent =
        note ?? (state === "in" ? "Connected" : state === "out" ? "Not connected" : "Working…");
    }
  };
  isConnected().then((c) => setAccount(c ? "in" : "out"));

  acctBtn?.addEventListener("click", async () => {
    const wasIn = await isConnected();
    setAccount("loading", wasIn ? "Disconnecting…" : "Continue sign-in in your browser…");
    try {
      if (wasIn) await disconnect();
      else await connect();
      setAccount((await isConnected()) ? "in" : "out");
    } catch (e) {
      console.error("[account] auth error", e);
      setAccount((await isConnected()) ? "in" : "out", `Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  // ── Shared library store: one load, read by every card ──
  initTrackStore();

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
    const ICON_VOL =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 5V4L8 9H4zm12.5 3a4 4 0 0 0-2.5-3.7v7.4a4 4 0 0 0 2.5-3.7zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>';
    const ICON_MUTE =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 5V4L8 9H4zm17 .4L19.6 8l-2.6 2.6L14.4 8 13 9.4l2.6 2.6L13 14.6 14.4 16l2.6-2.6 2.6 2.6 1.4-1.4-2.6-2.6L21 9.4z"/></svg>';

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

    // Shared dropdown mechanism; shouldStayOpen keeps it up through a drag.
    makeDropdown({
      root: volRoot, trigger: volPill, panel: volPanel,
      shouldStayOpen: () => slider.dragging,
    });

    volMute.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMute();
      reflect(getVolume());
    });
  }
});
