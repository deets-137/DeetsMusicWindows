// The settings store — one typed object under `deets.settings`, the single source
// for every user preference the Settings card edits (SETTINGS.md). Modules that
// USED to own a key (Always on Top, menu mode) migrate in on first load; modules
// with their own state (Library Add, the Rust minimize-to-tray) are NOT here — the
// card talks to them directly.
//
// Read sites call `setting("x")` at the moment they act (no fan-out needed); things
// that must react live (the window's always-on-top, the dropdown mode, the Rewind
// gate in the layout) subscribe with `onSettingsChange`.

import type { ThemeName } from "./theme";
import type { SkinName } from "./skin";

export interface Settings {
  // ── window ──
  /** Keep the window above others: always, only while it shows the player, or never.
   *  Was a boolean until 2026-09-14 (migrated: true → always). main.ts applies it. */
  alwaysOnTop: "always" | "player" | "off";
  /** What a click on the tray icon pops: mini with its card, or the player. main.ts reads it. */
  trayView: "cards" | "player";
  /** Every dropdown opens on hover instead of click (FUTURE-SETTINGS §9 is the per-menu future). */
  menuMode: "click" | "hover";
  /** Free resize flips the surface past its band (FUTURE-SETTINGS §8). Off = clamp only. */
  surfaceAutoFlip: boolean;
  /** Theme/skin switches animate (NEXT-VERSION §6). The OS reduced-motion preference still wins. */
  appearanceMotion: boolean;
  /** The skins' moving backgrounds (Ocean swell, Glass aurora, Retro-Future storm, the NP
   *  aurora): on = 30 fps, reduced = 15 fps, off = still (the storm hides). The OS
   *  reduced-motion preference still wins. src/ambient.ts applies it. */
  backgroundMotion: "on" | "reduced" | "off";
  /** Ocean only: the card edges break into grains of sand (a dark beach), or the plain soft
   *  glow. skin-settings.ts applies it as `data-ocean-edges` on <html>. */
  oceanEdges: "sand" | "soft";
  /** Ocean sand only, 0–100: how far the sand band reaches into a card (--sand-reach-min…max). */
  oceanSand: number;
  /** Glass only, 0–100: how much theme color fills a card (0 = clear, the background glows
   *  through; 100 = solid). skin-settings.ts publishes it as --glass-tint. */
  glassTint: number;
  /** Glass only, 0–100: the light behind each card, under its tint (50 = the default glow).
   *  skin-settings.ts publishes it as --glass-backlight. */
  glassBacklight: number;
  /** Glass only, 0–100: how brightly the aurora glows on the background (50 = the skin's own
   *  strength, 100 = double). skin-settings.ts publishes it as --glass-canvas. */
  glassCanvasGlow: number;
  /** Glass only, 0–100: darkens the canvas between the cards; the cards keep their brightness
   *  (their frost undoes the dim). skin-settings.ts publishes it as --glass-canvas-dim. */
  glassCanvasDim: number;
  /** Which toasts show (TOASTS.md): failures = warn + error + the one-time notices;
   *  all = every kind, confirmations included. No "off": a failure always shows. */
  toasts: "failures" | "all";
  // ── look schedule (LOOK-SCHEDULE.md; look-schedule.ts applies it) ──
  /** What changes the look between day and night: sun times from the time zone, set times,
   *  the Windows light/dark mode, or nothing. */
  lookSchedule: "off" | "sun" | "clock" | "windows";
  dayTheme: ThemeName;
  daySkin: SkinName;
  nightTheme: ThemeName;
  nightSkin: SkinName;
  /** Set times ("HH:MM", local): the day look starts at dayStart, the night look at nightStart. */
  dayStart: string;
  nightStart: string;
  /** Minutes added to sunrise and sunset (negative = earlier). */
  sunShift: number;
  /** A theme or skin picked by hand: holds until the next change, or turns the schedule off. */
  lookHold: "next" | "always";
  // ── playback ──
  /** Right-click "Play Now": just the song, or the song then the rest of the list (§1). Default list. */
  playNowScope: "song" | "list";
  /** A drop on the Now Playing card: play it and keep Up Next after it, or replace Up Next
   *  as Play Now does (DRAG-DROP.md §3). */
  dropPlayQueue: "keep" | "replace";
  /** What Previous may rewind into: the parked list above the click, or only heard songs (§4). */
  previousReach: "lookback" | "heard";
  /** At launch: bring back last session's song as Now Playing (paused) + Up Next + Previous,
   *  only the queue (song parked at the top of Up Next, Now Playing idle), or nothing. */
  restoreQueue: "song" | "queue" | "off";
  /** Where manual picks land on a one-shot shuffle (§5a). */
  shuffleManual: "top" | "hold" | "mix";
  /** Shuffle with nothing playing: play the whole library shuffled, or do nothing (§5b). */
  shuffleIdle: "library" | "noop";
  /** When a play counts as listened-through (§7). */
  fullPlayRule: "fraction" | "end" | "scrobble";
  /** Make the weekly Replay playlist automatically (NEXT-VERSION §4). */
  replayAuto: boolean;
  /** The weekday the weekly Replay is made (first launch on/after it). */
  replayDay: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  /** Each week gets its own dated Replay (off = one rolling playlist, replaced weekly). */
  replayKeep: boolean;
  // ── library & playlists ──
  /** Backfill missing playlist song counts on the overview (§14). */
  playlistEagerCounts: boolean;
  /** New Playlist summons the Search card beside it (§16). */
  playlistCreateSummon: boolean;
  /** Offer Export ▸ Apple Music on local playlists (PLAYLISTS.md §6). Default on. */
  playlistExport: boolean;
  // ── cards ──
  /** Offer the Rewind card in the slot pickers. Auto-enabled once at 50 play starts. */
  rewindCard: boolean;
  /** The one-shot auto-enable already fired (so a later "off" sticks). */
  rewindAutoShown: boolean;
  // ── updates ──
  /** When to get updates (RELEASE.md §6.3): download in the background and then ask to
   *  restart, ask before the download, or no scheduled check. updater.ts reads it. */
  updateMode: "auto" | "ask" | "off";
  /** The version "Skip this version" (or a rollback) set aside; "" = none. A newer one is offered. */
  updateSkip: string;
}

const KEY = "deets.settings";

export const DEFAULTS: Settings = {
  alwaysOnTop: "off",
  trayView: "cards",
  menuMode: "click",
  surfaceAutoFlip: true,
  appearanceMotion: true,
  backgroundMotion: "on",
  oceanEdges: "soft", // user's call 2026-09-15: Soft is Ocean's true default; Sand is opt-in
  oceanSand: 15, // user's call 2026-09-15: ≈ 9px of sand when it is turned on
  glassTint: 55, // today's Glass look (55% surface)
  glassBacklight: 50, // user's call 2026-09-15: a cool 50%, a glow that is not garish
  glassCanvasGlow: 50, // the aurora as the skin writes it
  glassCanvasDim: 0, // no dim: today's look
  toasts: "all", // user's call 2026-09-13: Everything by default
  lookSchedule: "off",
  dayTheme: "lilac", // the two first-launch pairs (theme.ts / skin.ts defaults)
  daySkin: "press",
  nightTheme: "black-red",
  nightSkin: "retro-future",
  dayStart: "07:00",
  nightStart: "19:00",
  sunShift: 0,
  lookHold: "next", // user's call 2026-09-15: a hand pick holds until the next change
  playNowScope: "list", // user's call 2026-09-10: Play Now = the song, then the rest of its list
  dropPlayQueue: "keep", // user's call 2026-09-14: a drop on Now Playing keeps Up Next
  previousReach: "lookback",
  restoreQueue: "song", // user's call 2026-09-12: the last song back in Now Playing, paused, with its queue
  shuffleManual: "top",
  shuffleIdle: "library",
  fullPlayRule: "fraction",
  replayAuto: true,
  replayDay: "mon",
  replayKeep: false,
  playlistEagerCounts: true,
  playlistCreateSummon: true,
  playlistExport: true, // user's call 2026-09-14: on, like Add to Library
  rewindCard: false,
  rewindAutoShown: false,
  updateMode: "auto", // user's call 2026-09-14: download in the background, then ask to restart
  updateSkip: "",
};

/** Keys that lived on their own before the store (2026-09-10); read once, then owned here. */
function migrate(into: Partial<Settings>): void {
  const aot = localStorage.getItem("deets.alwaysOnTop");
  if (aot !== null && into.alwaysOnTop === undefined) into.alwaysOnTop = aot === "true" ? "always" : "off";
  // Keep on top became a three-way choice (2026-09-14).
  const stored = into.alwaysOnTop as unknown;
  if (typeof stored === "boolean") into.alwaysOnTop = stored ? "always" : "off";
  const mode = localStorage.getItem("deets.menuMode");
  if (mode !== null && into.menuMode === undefined) into.menuMode = mode === "hover" ? "hover" : "click";
  const eager = localStorage.getItem("deets.playlists.eagerCounts");
  if (eager !== null && into.playlistEagerCounts === undefined) into.playlistEagerCounts = eager !== "off";
  // Show notices lost its "off" choice (2026-09-14): a failure must always show.
  if ((into.toasts as string | undefined) === "off") into.toasts = "failures";
  // Draw card edges: the wave edge and the smooth fade were both dropped (2026-09-15); they
  // were defaults, not picks, so they fall back to the skin's own Soft.
  const edges = into.oceanEdges as string | undefined;
  if (edges === "waves" || edges === "fade") into.oceanEdges = "soft";
  // Glass: "Backlight" first scaled the aurora; that slider became Canvas glow and Backlight
  // is now the light behind each card (2026-09-15). A stored value moves with its meaning.
  if (into.glassBacklight !== undefined && into.glassCanvasGlow === undefined) {
    into.glassCanvasGlow = into.glassBacklight;
    delete into.glassBacklight;
  }
}

function load(): Settings {
  let stored: Partial<Settings> = {};
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) stored = JSON.parse(raw) as Partial<Settings>;
  } catch {
    /* corrupt or unavailable — defaults */
  }
  migrate(stored);
  return { ...DEFAULTS, ...stored };
}

let state: Settings = load();
const listeners = new Set<(changed: keyof Settings) => void>();

/** Read one setting (always current). */
export function setting<K extends keyof Settings>(key: K): Settings[K] {
  return state[key];
}

/** Write one setting, persist, and notify subscribers. No-op if unchanged. */
export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  if (state[key] === value) return;
  state = { ...state, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage disabled — still applies for the session */
  }
  listeners.forEach((cb) => cb(key));
}

/** Subscribe to changes; the callback gets the key that changed. Returns an unsubscribe fn. */
export function onSettingsChange(cb: (changed: keyof Settings) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
