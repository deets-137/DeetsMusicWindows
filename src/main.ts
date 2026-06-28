import { getCurrentWindow } from "@tauri-apps/api/window";
import { applyTheme, initTheme, type ThemeName } from "./theme";
import { connect, disconnect, isConnected } from "./apple";
import { initLibraryCard } from "./library-card";

// Wire the custom traffic lights to the OS window. The titlebar drag is
// handled declaratively by data-tauri-drag-region on .drag-region in index.html.
const appWindow = getCurrentWindow();

window.addEventListener("DOMContentLoaded", () => {
  initTheme();

  // ── Window controls ──────────────────────────────────────────
  document.getElementById("tl-min")?.addEventListener("click", () => appWindow.minimize());
  document.getElementById("tl-max")?.addEventListener("click", () => appWindow.toggleMaximize());
  document.getElementById("tl-close")?.addEventListener("click", () => appWindow.close());

  // ── Settings menu (click to open; submenu reveals on hover) ──
  const trigger = document.getElementById("settings-trigger");
  const menu = document.getElementById("settings-menu");
  if (!trigger || !menu) return;

  const open = () => {
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
  };
  const close = () => {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();          // don't let the document handler immediately close it
    menu.hidden ? open() : close();
  });

  // Theme choices.
  document.querySelectorAll<HTMLElement>("[data-theme-choice]").forEach((el) => {
    el.addEventListener("click", () => {
      applyTheme(el.dataset.themeChoice as ThemeName);
      close();
    });
  });

  // Dismiss: click outside, or Escape.
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== trigger) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
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

  // ── Library card: sort / search / view + cache render + sync ──
  initLibraryCard();

  // ── Now Playing: play/pause icon toggle (cosmetic until playback is wired) ──
  const playBtn = document.getElementById("np-playpause");
  if (playBtn) {
    const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>';
    const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>';
    let playing = false;
    playBtn.addEventListener("click", () => {
      playing = !playing;
      playBtn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
      playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    });
  }
});
