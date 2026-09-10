import { getCurrentWindow } from "@tauri-apps/api/window";
import { applyTheme, initTheme, type ThemeName } from "./theme";
import { applySkin, initSkin, type SkinName } from "./skin";
import { applySurface, fullSurface, initSurface, type SurfaceName } from "./surface";
import { initStorm } from "./storm";
import { initArtworkHeal } from "./artwork-heal";
import { setting, onSettingsChange } from "./settings-store";
import { requestCard } from "./layout-bus";
import { connect, disconnect, isConnected } from "./apple";
import { initTrackStore } from "./track-store";
import { initLayout } from "./layout";
import { getVolume, setVolume, toggleMute, isMuted, onVolumeChange } from "./player";
import { ICON_VOL, ICON_MUTE } from "./volume-icons";
import { initNpBus, publishAppearance } from "./np-bus";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { makeSlider } from "./slider";
import { makeDropdown, setDropdownMode, type DropdownMode } from "./dropdown";
import { initAirplay, mountAirplay } from "./airplay";

// Wire the custom traffic lights to the OS window. The titlebar drag is
// handled declaratively by data-tauri-drag-region on .drag-region in index.html.
const appWindow = getCurrentWindow();

window.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initSkin();
  initSurface();
  initStorm(); // storm-layer position re-roll; inert unless the skin opts in
  initArtworkHeal(); // retry cover <img>s that fail to load (sleep/wake, network blips)
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
