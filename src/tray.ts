// Tray panel (TRAY.md) — the second webview window. Mirrors the Now Playing card
// with two sources:
//
//   1. DeetsMusic — the hub's `np` event (np-bus.ts → bridge.rs → here). Transport
//      goes back as `np_command`; "+" asks the main window to add the current track.
//   2. Windows media session — when DeetsMusic has nothing loaded and the
//      "Read Windows media" toggle is on: `win_media_now_playing` polled while the
//      panel is visible; transport/seek through the same session; volume = the
//      system master level; "+" resolves title/artist against Apple once per track
//      and adds the best match.
//
// No MusicKit here, ever. Debug: `__diag` (diag.ts) is live on this window too;
// `__tray.state()` snapshots what the panel believes.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { makeSlider } from "./slider";
import { log } from "./diag";
import { mountVinyl } from "./vinyl";
import { applyVinylAttrs, isVinylKey } from "./skin-settings";
import { onSettingsChange } from "./settings-store";
import { openContextMenu, type MenuItem } from "./context-menu";
import { initHints } from "./hint";
import type { NpState } from "./np-bus";
import type { Track } from "./library";

interface WinNowPlaying {
  present: boolean;
  playing: boolean;
  title: string;
  artist: string;
  album: string;
  appId: string;
  positionSecs: number;
  durationSecs: number;
  canSeek: boolean;
  artDataUrl?: string;
}
interface SystemVolume {
  level: number;
  muted: boolean;
}
interface Settings {
  minimizeToTray: boolean;
  readWindowsMedia: boolean;
}
interface Candidate {
  track: Track;
  inLibrary: boolean;
  score: number;
  artworkUrl?: string;
}

type Source = "deets" | "windows" | "none";

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>';
const ICON_VOL =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 5V4L8 9H4zm12.5 3a4 4 0 0 0-2.5-3.7v7.4a4 4 0 0 0 2.5-3.7zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>';
const ICON_MUTE =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 5V4L8 9H4zm17 .4L19.6 8l-2.6 2.6L14.4 8 13 9.4l2.6 2.6L13 14.6 14.4 16l2.6-2.6 2.6 2.6 1.4-1.4-2.6-2.6L21 9.4z"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** "Spotify.exe" / "MSEdge" / "Chrome" → a human label for the source badge. */
function appLabel(appId: string): string {
  const a = appId.toLowerCase();
  if (a.includes("spotify")) return "Spotify";
  if (a.includes("chrome")) return "Chrome";
  if (a.includes("msedge")) return "Edge";
  if (a.includes("firefox")) return "Firefox";
  if (a.includes("applemusic") || a.includes("apple music")) return "Apple Music";
  if (a.includes("itunes")) return "iTunes";
  if (a.includes("zune") || a.includes("mediaplayer")) return "Media Player";
  if (a.includes("vlc")) return "VLC";
  if (a.includes("tidal")) return "Tidal";
  if (a.includes("youtube")) return "YouTube Music";
  const base = appId.split(/[\\/!]/).pop() ?? appId;
  return base.replace(/\.exe$/i, "") || "Windows";
}

const fmtTime = (s: number): string => {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
};

window.addEventListener("DOMContentLoaded", () => {
  const appWindow = getCurrentWindow();
  initHints(); // the panel wears the same hover box as the window (ONBOARDING.md §1)

  const npEl = $<HTMLElement>("np");
  const art = $<HTMLElement>("np-art");
  const title = $<HTMLElement>("np-title");
  const artist = $<HTMLElement>("np-artist");
  const playBtn = $<HTMLButtonElement>("np-playpause");
  const prevBtn = $<HTMLButtonElement>("np-prev");
  const nextBtn = $<HTMLButtonElement>("np-next");
  const addBtn = $<HTMLButtonElement>("np-add");
  const timeEl = $<HTMLElement>("np-time");
  const sourceEl = $<HTMLElement>("tray-source");
  const muteBtn = $<HTMLButtonElement>("vol-mute");

  // ── state ──
  let source: Source = "none";
  let deets: NpState | null = null;
  let win: WinNowPlaying | null = null;
  let settings: Settings = { minimizeToTray: true, readWindowsMedia: true };
  let visible = false;
  let paletteKey = "";
  let seekHold = -1; // where a seek was let go, until the position reaches it
  let seekHoldUntil = 0;

  // The cover box (docs/VINYL.md): the Press record when "Show record on" is Everywhere.
  // The two rows come from the shared settings store; a change in the main window arrives
  // as a `storage` event (settings-store.ts).
  applyVinylAttrs();
  onSettingsChange((k) => {
    if (isVinylKey(k)) applyVinylAttrs();
  });
  const vinyl = mountVinyl(art, '<span class="np__art-glyph" aria-hidden="true">♪</span>');
  vinyl.suspend(true); // the panel starts hidden

  // ── palette (ALBUM-COLOR.md) — same runtime roles the NP card uses ──
  const PROPS = ["--album-bg", "--album-c1", "--album-c2"] as const;
  const clearPalette = () => {
    PROPS.forEach((p) => npEl.style.removeProperty(p));
    npEl.classList.remove("np--album");
    paletteKey = "";
  };
  const tintFrom = (template: string | undefined, catalogId: string | undefined) => {
    if (!template) return clearPalette();
    if (template === paletteKey) return;
    paletteKey = template;
    invoke<{ bg?: string; c1?: string; c2?: string } | null>("album_palette", { coverUrl: template, catalogId: catalogId ?? null })
      .then((p) => {
        if (paletteKey !== template || !p) return;
        if (p.bg) npEl.style.setProperty("--album-bg", p.bg);
        if (p.c1) npEl.style.setProperty("--album-c1", p.c1);
        if (p.c2) npEl.style.setProperty("--album-c2", p.c2);
        npEl.classList.add("np--album");
      })
      .catch(() => {});
  };

  // ── sliders ──
  const seek = makeSlider($("np-scrub"), {
    axis: "x",
    onDrag: (frac) => {
      if (source === "deets" && deets) vinyl.scrub(frac * deets.duration);
    },
    onCommit: (frac) => {
      seekHold = frac;
      seekHoldUntil = performance.now() + 1500;
      if (source === "deets" && deets) vinyl.scrub(frac * deets.duration, true);
      if (source === "deets") invoke("np_command", { cmd: { kind: "seek", value: frac } }).catch(console.error);
      else if (source === "windows" && win?.canSeek && win.durationSecs > 0)
        invoke("win_media_seek", { secs: frac * win.durationSecs }).catch(console.error);
    },
  });
  const vol = makeSlider($("vol-scrub"), {
    axis: "x",
    onDrag: (frac) => reflectVolume(frac, false),
    onCommit: (frac) => {
      if (source === "windows" || source === "none") {
        invoke<SystemVolume>("system_volume_set", { level: frac }).then(reflectSystemVolume).catch(console.error);
      } else {
        invoke("np_command", { cmd: { kind: "volume", value: frac } }).catch(console.error);
      }
    },
  });

  const reflectVolume = (level: number, muted: boolean) => {
    vol.setValue(level);
    muteBtn.innerHTML = muted || level === 0 ? ICON_MUTE : ICON_VOL;
    muteBtn.setAttribute("aria-pressed", String(muted));
  };
  const reflectSystemVolume = (v: SystemVolume) => reflectVolume(v.muted ? 0 : v.level, v.muted);

  muteBtn.addEventListener("click", () => {
    if (source === "deets") invoke("np_command", { cmd: { kind: "mute" } }).catch(console.error);
    else {
      const muted = muteBtn.getAttribute("aria-pressed") !== "true";
      invoke<SystemVolume>("system_volume_mute", { muted }).then(reflectSystemVolume).catch(console.error);
    }
  });

  // ── transport ──
  const transport = (kind: "play-pause" | "next" | "previous") => {
    if (source === "deets") invoke("np_command", { cmd: { kind } }).catch(console.error);
    else if (source === "windows") invoke("win_media_transport", { kind }).then(() => pollWindows()).catch(console.error);
  };
  playBtn.addEventListener("click", () => transport("play-pause"));
  prevBtn.addEventListener("click", () => transport("previous"));
  nextBtn.addEventListener("click", () => transport("next"));

  // ── add to library ──
  // Windows source: one resolve per (title, artist), only while the panel is visible.
  let winCandidate: Candidate | null = null;
  let winResolveKey = "";
  let adding = false;
  const setAdd = (state: "hidden" | "add" | "added" | "busy", hint = "") => {
    addBtn.hidden = state === "hidden";
    addBtn.disabled = state !== "add";
    addBtn.classList.toggle("is-busy", state === "busy");
    addBtn.innerHTML = state === "added" ? ICON_CHECK : ICON_PLUS;
    addBtn.title = hint || (state === "added" ? "In your library" : "Add to Library");
  };
  const resolveWindows = (w: WinNowPlaying) => {
    const key = `${w.title}${w.artist}`;
    if (key === winResolveKey) return;
    winResolveKey = key;
    winCandidate = null;
    setAdd("hidden");
    if (!w.title) return;
    log("tray:resolve", { title: w.title, artist: w.artist });
    invoke<Candidate[]>("bridge_resolve", { title: w.title, artist: w.artist || null, album: w.album || null })
      .then((cands) => {
        if (key !== winResolveKey) return; // moved on
        const best = cands[0];
        log("tray:resolved", cands.map((c) => ({ s: c.score, t: c.track.title, a: c.track.artistName, lib: c.inLibrary })));
        if (!best || best.score < 0.45) return setAdd("hidden");
        winCandidate = best;
        const hint = `${best.track.title} — ${best.track.artistName}`;
        setAdd(best.inLibrary ? "added" : "add", best.inLibrary ? `In your library: ${hint}` : `Add to Library: ${hint}`);
      })
      .catch((e) => {
        log("tray:resolve-failed", String(e));
        setAdd("hidden");
      });
  };
  addBtn.addEventListener("click", () => {
    if (adding) return;
    if (source === "deets") {
      adding = true;
      setAdd("busy");
      invoke("np_command", { cmd: { kind: "add-to-library" } })
        .catch((e) => log("tray:add-failed", String(e)))
        .finally(() => (adding = false));
      // np-bus republishes with inLibrary=true once the store reloads.
    } else if (source === "windows" && winCandidate) {
      adding = true;
      setAdd("busy");
      invoke("bridge_add", { track: winCandidate.track })
        .then(() => {
          winCandidate!.inLibrary = true;
          setAdd("added", `In your library: ${winCandidate!.track.title} — ${winCandidate!.track.artistName}`);
        })
        .catch((e) => {
          log("tray:add-failed", String(e));
          setAdd("add", "Add failed — try again");
        })
        .finally(() => (adding = false));
    }
  });

  // ── render ──
  /** `song` names the track (a new one slides the record); no `src` = the ♪ placeholder. */
  const setArt = (song: string, src: string | undefined) => vinyl.show(song, src || undefined);

  const renderDeets = (s: NpState) => {
    source = "deets";
    sourceEl.textContent = "DeetsMusic";
    sourceEl.hidden = false;
    playBtn.innerHTML = s.playing ? ICON_PAUSE : ICON_PLAY;
    playBtn.setAttribute("aria-label", s.playing ? "Pause" : "Play");
    playBtn.title = s.playing ? "Pause" : "Play";
    title.textContent = s.title ?? "Not playing";
    artist.textContent = s.artist ?? "";
    // The playlist's cover under "Show cover: Playlist" (PLAYLISTS.md §11); the tint stays on the album.
    const cover = s.coverUrl ?? s.artworkUrl;
    // The song's id alone names it: the title can lag a beat behind a song change.
    // A station with no title is the gap between two station songs: keep the record (card twin).
    if (!(s.station && !s.title)) {
      setArt(s.catalogId ? `deets:${s.catalogId}` : `deets:${s.station ?? ""}|${s.title ?? ""}`, cover);
    }
    vinyl.playing(s.playing);
    vinyl.position(s.currentTime, s.live ? 0 : s.duration, false); // MusicKit's whole-second count
    npEl.classList.toggle("np--live", s.live);
    prevBtn.disabled = s.live;
    nextBtn.disabled = s.live;
    // After a seek is let go, the old position arrives for a moment: hold the handle (card twin).
    if (seekHold >= 0 && performance.now() < seekHoldUntil && Math.abs(s.progress - seekHold) * s.duration > 1) {
      // still the old position
    } else {
      seekHold = -1;
      seek.setValue(s.progress);
    }
    timeEl.textContent = s.live ? "" : `${fmtTime(s.currentTime)} / ${fmtTime(s.duration)}`;
    reflectVolume(s.volume, s.muted);
    tintFrom(s.artworkTemplate, s.catalogId);
    if (!adding) {
      if (!s.catalogId) setAdd("hidden");
      else setAdd(s.inLibrary ? "added" : "add");
    }
  };

  const renderWindows = (w: WinNowPlaying) => {
    source = "windows";
    sourceEl.textContent = appLabel(w.appId);
    sourceEl.hidden = false;
    playBtn.innerHTML = w.playing ? ICON_PAUSE : ICON_PLAY;
    playBtn.setAttribute("aria-label", w.playing ? "Pause" : "Play");
    playBtn.title = w.playing ? "Pause" : "Play";
    title.textContent = w.title || "Playing";
    artist.textContent = [w.artist, w.album].filter(Boolean).join(" · ");
    setArt(`win:${w.appId}|${w.title}|${w.artist}`, w.artDataUrl);
    // Another app's position arrives only once a second and can lag, so its record turns
    // freely at 33⅓ rpm while it plays (no end to land upright on).
    vinyl.playing(w.playing);
    vinyl.position(0, 0, false);
    npEl.classList.remove("np--live");
    prevBtn.disabled = false;
    nextBtn.disabled = false;
    const frac = w.durationSecs > 0 ? w.positionSecs / w.durationSecs : 0;
    seek.setValue(frac);
    timeEl.textContent = w.durationSecs > 0 ? `${fmtTime(w.positionSecs)} / ${fmtTime(w.durationSecs)}` : "";
    clearPalette();
    resolveWindows(w);
  };

  const renderIdle = () => {
    source = "none";
    sourceEl.hidden = true;
    playBtn.innerHTML = ICON_PLAY;
    title.textContent = "Not playing";
    artist.textContent = settings.readWindowsMedia ? "" : "Windows media off";
    setArt("", undefined);
    vinyl.playing(false);
    npEl.classList.remove("np--live");
    seek.setValue(0);
    timeEl.textContent = "";
    clearPalette();
    setAdd("hidden");
    winResolveKey = "";
  };

  /** Pick the source: DeetsMusic whenever it holds a track, else Windows, else idle. */
  const render = () => {
    if (deets?.active) return renderDeets(deets);
    if (settings.readWindowsMedia && win?.present) return renderWindows(win);
    renderIdle();
  };

  // ── Windows polling (only while the panel is on screen) ──
  let pollTimer = 0;
  let polling = false;
  const pollWindows = async () => {
    if (polling) return;
    polling = true;
    try {
      if (settings.readWindowsMedia && !deets?.active) {
        win = await invoke<WinNowPlaying>("win_media_now_playing");
        if (source !== "deets") reflectSystemVolume(await invoke<SystemVolume>("system_volume_get"));
      }
      render();
    } catch (e) {
      log("tray:poll-failed", String(e));
    } finally {
      polling = false;
    }
  };
  const startPolling = () => {
    stopPolling();
    void pollWindows();
    pollTimer = window.setInterval(() => void pollWindows(), 1000);
  };
  const stopPolling = () => {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = 0;
  };

  // ── hub events ──
  listen<NpState>("np", (e) => {
    deets = e.payload;
    // The hub sends this once a second while a song plays. A hidden WebView2 window still
    // paints at full rate (ambient.ts), so a render nobody sees is a real paint: skip it.
    // `panel-shown` re-reads np_snapshot, so the panel opens on the current state.
    if (visible) render();
  });
  listen<Settings>("settings", (e) => {
    settings = e.payload;
    render();
    if (visible) startPolling();
  });
  listen<{ theme: string; skin: string }>("appearance", (e) => {
    if (e.payload.theme) document.documentElement.dataset.theme = e.payload.theme;
    if (e.payload.skin) document.documentElement.dataset.skin = e.payload.skin;
    fit();
  });
  listen("panel-shown", () => {
    visible = true;
    vinyl.suspend(false);
    log("tray:shown");
    render(); // at once, from the state kept current while hidden: no stale frame on open
    invoke<NpState>("np_snapshot").then((s) => {
      deets = s;
      render();
    });
    startPolling();
    fit();
  });
  window.addEventListener("blur", () => {
    // Release builds hide on blur (tray.rs); either way, stop polling until shown. `visible`
    // is NOT cleared here: a debug build stays on screen after a blur and must keep
    // rendering `np`; Rust says when the panel is really hidden (`panel-hidden`).
    stopPolling();
    vinyl.suspend(true);
  });
  listen("panel-hidden", () => {
    visible = false;
  });

  // ── chrome ──
  $("tray-hide").addEventListener("click", () => {
    visible = false;
    stopPolling();
    vinyl.suspend(true);
    invoke("tray_panel_hide").catch(() => appWindow.hide());
  });
  $("tray-open").addEventListener("click", () => invoke("tray_open_main").catch(console.error));

  // The window fits its content: the card's height is a skin decision (--np-cover).
  const fit = () => {
    requestAnimationFrame(() => {
      const h = document.body.scrollHeight;
      if (h > 0) invoke("tray_panel_resize", { width: 360, height: h }).catch(() => {});
    });
  };
  new ResizeObserver(fit).observe(document.body);

  // ── right-click the song (cover / title / artist), DeetsMusic source only (2026-09-15):
  //    the Now Playing card's menu minus the drills (no cards here). Add and ♥ go to the
  //    main window as np_command kinds; the link is copied here (no toast on this window).
  //    Go to Artist / Album need the main window, so they are not offered. ──
  const songMenu = (e: MouseEvent) => {
    if (source !== "deets" || !deets?.active) return; // another app's song: nothing to offer
    const s = deets;
    const items: MenuItem[] = [];
    if (s.catalogId && !s.inLibrary)
      items.push({ label: "Add to Library", run: () => void invoke("np_command", { cmd: { kind: "add-to-library" } }).catch((err) => log("tray:add-failed", String(err))) });
    if (s.loved !== null && s.loved !== undefined)
      items.push({ label: s.loved ? "Unfavorite" : "Favorite", run: () => void invoke("np_command", { cmd: { kind: "favorite" } }).catch((err) => log("tray:favorite-failed", String(err))) });
    if (s.catalogId)
      items.push({ label: "Copy Link", run: () => void navigator.clipboard.writeText(`https://music.apple.com/song/${s.catalogId}`).catch((err) => log("tray:copy-failed", String(err))) });
    if (!items.length) return;
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, items);
  };
  art.addEventListener("contextmenu", songMenu);
  title.parentElement?.addEventListener("contextmenu", songMenu);

  // ── boot ──
  invoke<Settings>("settings_get").then((s) => (settings = s)).catch(() => {});
  invoke<NpState>("np_snapshot")
    .then((s) => {
      deets = s;
      render();
    })
    .catch(() => render());
  fit();

  (window as any).__tray = {
    state: () => ({ source, deets, win, settings, visible, winCandidate }),
    poll: pollWindows,
  };
});
