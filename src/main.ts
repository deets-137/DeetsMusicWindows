import { getCurrentWindow } from "@tauri-apps/api/window";
import { applyTheme, initTheme, type ThemeName } from "./theme";
import { applySkin, initSkin, type SkinName } from "./skin";
import { connect, disconnect, isConnected } from "./apple";
import { initTrackStore } from "./track-store";
import { initLibraryCard } from "./library-card";
import { initQcard } from "./qcard";
import { playPause, nextTrack, prevTrack, onPlayerState, onPlayerProgress, seekToFraction } from "./player";

// Wire the custom traffic lights to the OS window. The titlebar drag is
// handled declaratively by data-tauri-drag-region on .drag-region in index.html.
const appWindow = getCurrentWindow();

window.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initSkin();

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

  // Skin choices (same pattern as Theme).
  document.querySelectorAll<HTMLElement>("[data-skin-choice]").forEach((el) => {
    el.addEventListener("click", () => {
      applySkin(el.dataset.skinChoice as SkinName);
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

  // ── Shared library store: one load, read by both cards ──
  initTrackStore();

  // ── Library card: sort / search / view + cache render + sync ──
  initLibraryCard();

  // ── Queue card (Qcard): mirrors the queue model in the Playlists slot ──
  initQcard();

  // ── Now Playing: real playback via MusicKit (state-driven icon + label) ──
  const playBtn = document.getElementById("np-playpause");
  if (playBtn) {
    const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>';
    const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>';
    const npArt = document.getElementById("np-art");
    const npTitle = document.getElementById("np-title");
    const npArtist = document.getElementById("np-artist");

    // Drive the icon, title/artist, and cover from actual playback state.
    onPlayerState((s) => {
      playBtn.innerHTML = s.playing ? ICON_PAUSE : ICON_PLAY;
      playBtn.setAttribute("aria-label", s.playing ? "Pause" : "Play");
      if (npTitle) npTitle.textContent = s.title ?? "Not playing";
      if (npArtist) npArtist.textContent = s.artist ?? "";
      if (npArt) {
        npArt.innerHTML = s.artworkUrl
          ? `<img src="${s.artworkUrl}" alt="" />`
          : "♪";
      }
    });

    playBtn.addEventListener("click", () => {
      playPause().catch((e) => console.error("[player] play/pause failed:", e));
    });

    // ── Prev / Next (native skip within MusicKit's fed window) ──
    const prevBtn = document.querySelector<HTMLElement>('.np__controls [aria-label="Previous"]');
    const nextBtn = document.querySelector<HTMLElement>('.np__controls [aria-label="Next"]');
    prevBtn?.addEventListener("click", () => {
      prevTrack().catch((e) => console.error("[player] prev failed:", e));
    });
    nextBtn?.addEventListener("click", () => {
      nextTrack().catch((e) => console.error("[player] next failed:", e));
    });

    // ── Scrubber: live progress + drag-to-seek ──
    const npScrub = document.querySelector<HTMLElement>(".np__scrub");
    const npTrack = npScrub?.querySelector<HTMLElement>(".np__track");
    if (npScrub) {
      let scrubbing = false;
      const setFill = (frac: number) => {
        const pct = Math.max(0, Math.min(1, frac)) * 100;
        npScrub.style.setProperty("--np-progress", `${pct.toFixed(2)}%`);
      };
      const fracAt = (clientX: number) => {
        const rect = (npTrack ?? npScrub).getBoundingClientRect();
        return rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
      };

      // Live progress drives the fill — unless the user is mid-drag.
      onPlayerProgress((p) => {
        if (!scrubbing) setFill(p.progress);
      });

      npScrub.addEventListener("pointerdown", (e) => {
        scrubbing = true;
        npScrub.setPointerCapture(e.pointerId);
        setFill(fracAt(e.clientX));
      });
      npScrub.addEventListener("pointermove", (e) => {
        if (scrubbing) setFill(fracAt(e.clientX));
      });
      npScrub.addEventListener("pointerup", (e) => {
        if (!scrubbing) return;
        scrubbing = false;
        const frac = fracAt(e.clientX);
        setFill(frac);
        seekToFraction(frac).catch((err) => console.error("[player] seek failed:", err));
      });
    }
  }
});
