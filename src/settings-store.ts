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
  /** The title bar's volume bar is a small pill that grows on click (or hover, per the
   *  menu mode) — off: the full bar shows all the time (NEXT-VERSION §20). */
  volumeShrink: boolean;
  /** Open sizes (FUTURE-SETTINGS §8a): the window size each view opens at, "WxH" in logical
   *  px. surface.ts applies them on every open; a resize by hand is not remembered. */
  sizeMini: string;
  sizePlayer: string;
  sizeMidi: string;
  sizeMax: string;
  /** Theme/skin switches animate (NEXT-VERSION §6). The OS reduced-motion preference still wins. */
  appearanceMotion: boolean;
  /** A card swap, summon or replace plays the skin's swap motion (card-swap.ts). The OS
   *  reduced-motion preference still wins. */
  cardSwapMotion: boolean;
  /** The skins' scrubber handles with their own shape and motion (Press nib, Ocean float,
   *  Glass lens, Retro-Future charged bolt). Off: the plain masked handle each skin had
   *  before 2026-09-16, no motion. `data-fancy-scrub` on <html>. */
  fancyScrubber: boolean;
  /** The skins' moving backgrounds (Ocean swell, Glass aurora, Retro-Future storm, the NP
   *  aurora): on = 30 fps, reduced = 15 fps, off = still (the storm hides). The OS
   *  reduced-motion preference still wins. src/ambient.ts applies it. */
  backgroundMotion: "on" | "reduced" | "off";
  /** Ocean only: the card edges break into grains of sand (a dark beach), or the plain soft
   *  glow. skin-settings.ts applies it as `data-ocean-edges` on <html>. */
  oceanEdges: "sand" | "soft";
  /** Ocean sand only, 0–100: how far the sand band reaches into a card (--sand-reach-min…max). */
  oceanSand: number;
  /** Glass only: the live frost. On = a real blur behind each card, the aurora drifts, and the
   *  four Glass sliders show. Off = the frost is painted into each card (no blur to redraw),
   *  the aurora holds still, and the sliders hold GLASS_LOCKED. `data-glass-fancy` on <html>. */
  glassFancy: boolean;
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
  /** Press only: the cover becomes a record that turns while music plays, a record that holds
   *  still, or the plain cover (docs/VINYL.md). skin-settings.ts applies it as `data-press-vinyl`. */
  pressVinyl: "spin" | "still" | "off";
  /** Press record only: where it shows — the stage (max, mini player view), the stage and the
   *  Now Playing card, or those and the tray panel. `data-press-vinyl-where` on <html>. */
  pressVinylWhere: "stage" | "card" | "everywhere";
  /** Press record only: the offset plate (the Press ink shadow) behind the record. Off: the record
   *  alone, as large as the box allows. `data-press-vinyl-plate` on <html>. */
  pressVinylPlate: boolean;
  /** Press record only, spin only: how fast the record turns, in turns each minute — the three
   *  real record speeds. vinyl.ts turns it into the period (docs/VINYL.md §4). */
  pressVinylSpeed: "33" | "45" | "78";
  /** Hover hints (ONBOARDING.md §1; src/hint.ts): the themed box every `title` becomes.
   *  Off = no hover text at all, of either kind. */
  hoverHints: boolean;
  /** How long the pointer rests before a hint shows. A song row waits 1.6× as long. */
  hoverHintDelay: "quick" | "normal" | "slow";
  /** The name box on a song row: on every row, only when the name is cut off, or never. */
  hoverSongNames: "always" | "cut" | "off";
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
  // ── sleep timer (NEXT-VERSION §17; sleep.ts) ──
  /** A sleep time that arms itself every day: at sunset (the time zone's sun), at a set
   *  time, or never. It pauses only if music is playing when the time comes. */
  sleepSchedule: "off" | "sun" | "clock";
  /** The set time ("HH:MM", local) for `sleepSchedule` = "clock". */
  sleepAt: string;
  /** The wind-down: over these last minutes the volume sinks to nothing, then the music
   *  pauses. 0 = a plain pause at the mark. */
  sleepWind: number;
  /** When the time runs out in the middle of a song, let the song play to its end first
   *  (the wind-down then fills the song's last minutes). Off: the mark is the silence. */
  sleepPlayOut: boolean;
  // ── home (HOME.md §4) ──
  /** How long a Home tile stays hidden after a right-click › Hide: until you clear it,
   *  or until the app closes. "session" keeps the map in memory and leaves the stored
   *  one alone, so switching back restores it. */
  homeHideLasts: "forever" | "session";
  /** The hidden Home tiles: item key → when it was hidden (epoch-ms). A tile played
   *  again after that time unhides itself. Cleared from Settings › Home. */
  homeHidden: Record<string, number>;
  // ── playback ──
  /** MusicKit's stream bitrate: auto follows the network estimate live, high pins 256 kbps,
   *  low pins 64 kbps. player.ts `applyStreamQuality`; a change starts at the next song. */
  streamQuality: "auto" | "high" | "low";
  /** Right-click "Play Now": just the song, or the song then the rest of the list (§1). Default list. */
  playNowScope: "song" | "list";
  /** The History card says which day each play was, inside the row's own subtitle line
   *  (never as a divider — the card keeps its shape). NEXT-VERSION §16. */
  historyShowDay: boolean;
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
  /** The Shuffle button is a mode that stays on (NEXT-VERSION §14 A) — off: it shuffles Up
   *  Next once (the 2026-07-02 one-shot). */
  shuffleStays: boolean;
  /** The shuffle mode's live state (no Settings row: the Now Playing button and the toolbar
   *  Shuffle set it). Persisted like Apple's. Only read while `shuffleStays` is on. */
  shuffleMode: boolean;
  /** Repeat (NEXT-VERSION §12): the Now Playing button cycles it; no Settings row. */
  repeatMode: "off" | "all" | "one";
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
  playlistCreateSummon: "always" | "notmini" | "off";
  /** Offer Export ▸ Apple Music on local playlists (PLAYLISTS.md §6). Default on. */
  playlistExport: boolean;
  /** For a song played from a playlist, the Now Playing card and the tray panel show the
   *  album cover or the playlist's saved cover (PLAYLISTS.md §11). playlist-cover.ts reads it. */
  nowPlayingCover: "album" | "playlist";
  /** How a new playlist's cover starts: its letters or a ♪ drawn in the current theme and
   *  saved, or the derived mosaic (not saved). playlists.ts `playlistCreate` reads it. */
  newPlaylistCover: "letters" | "mosaic" | "note";
  /** How far a playlist web goes, in steps from the artist (PLAYLIST-WEB.md). web.ts reads it. */
  webReach: 1 | 2 | 3;
  /** How many songs a playlist web gets (PLAYLIST-WEB.md §4). */
  webSize: 25 | 50 | 100;
  /** Which web songs come first: the ones you have (♥, played, saved), the ones you don't, or no order. */
  webPrefer: "familiar" | "discover" | "mix";
  /** A picked genre chip filters the artist's own songs too ("all"), keeps at least 5 of
   *  them ("floor"), or leaves them all ("off"). PLAYLIST-WEB.md §3. */
  webSeedFilter: "all" | "floor" | "off";
  /** Make playlist in a web: the panel shrinks into the artist row before it flies ("shrink"),
   *  or pops out as the row flies ("pop"). PLAYLIST-WEB.md §2b. */
  webMakeMotion: "shrink" | "pop";
  // ── cards ──
  /** Offer the Rewind card in the slot pickers. Auto-enabled once at 50 play starts. */
  rewindCard: boolean;
  /** The one-shot auto-enable already fired (so a later "off" sticks). */
  rewindAutoShown: boolean;
  // ── connections ──
  /** A settings change from an agent (AGENT.md §6): apply it, ask in the window each time,
   *  or refuse. Agents can never change this one. agent-settings.ts reads it. */
  agentSettings: "allow" | "ask" | "off";
  // ── updates ──
  /** When to get updates (RELEASE.md §6.3): download in the background and then ask to
   *  restart, ask before the download, or no scheduled check. updater.ts reads it. */
  updateMode: "auto" | "ask" | "off";
  /** The version "Skip this version" (or a rollback) set aside; "" = none. A newer one is offered. */
  updateSkip: string;
}

const KEY = "deets.settings";

/** The Glass slider values while Fancy Glass is off (user's call 2026-09-16). They are also the
 *  sliders' defaults, so turning Fancy Glass on starts from the same look. */
export const GLASS_LOCKED = { glassTint: 65, glassBacklight: 85, glassCanvasGlow: 40, glassCanvasDim: 10 } as const;

export const DEFAULTS: Settings = {
  alwaysOnTop: "off",
  trayView: "cards",
  menuMode: "click",
  surfaceAutoFlip: true,
  volumeShrink: false, // user's call 2026-09-16: the full bar by default
  sizeMini: "385x550", // user's numbers, desk-tested 2026-09-15: each view opens at its own floor
  sizePlayer: "405x675", // NP: 404 px wide is where the Press record stopped jittering
  sizeMidi: "495x670",
  sizeMax: "1100x820",
  appearanceMotion: true,
  cardSwapMotion: true, // user's call 2026-09-16: on by default (was off, 2026-09-15)
  fancyScrubber: true, // user's call 2026-09-16: on for now, a performance eval decides
  backgroundMotion: "on",
  oceanEdges: "soft", // user's call 2026-09-15: Soft is Ocean's true default; Sand is opt-in
  oceanSand: 15, // user's call 2026-09-15: ≈ 9px of sand when it is turned on
  glassFancy: false, // user's call 2026-09-16: the painted frost; the live blur failed on software drawing (DEBUGGING.md)
  glassTint: 65, // user's call 2026-09-16: GLASS_LOCKED, the look Glass holds with Fancy Glass off
  glassBacklight: 85,
  glassCanvasGlow: 40,
  glassCanvasDim: 10,
  pressVinyl: "off", // opt-in, like Sand
  pressVinylWhere: "everywhere", // user's call 2026-09-15 (VINYL.md 2C)
  pressVinylPlate: true,
  pressVinylSpeed: "33", // an LP: 33⅓ rpm, one turn per 1.8 s
  hoverHints: true,
  hoverHintDelay: "normal",
  hoverSongNames: "always", // user's call 2026-09-15: name the song on every row, not only cut-off ones
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
  sleepSchedule: "off",
  sleepAt: "22:00",
  sleepWind: 5, // user's call 2026-09-15: the fade fills the last minutes before the mark
  sleepPlayOut: false, // the mark is the silence unless you ask for the song's end
  homeHideLasts: "forever", // user's call 2026-09-15: a hide that dies at relaunch reads as a bug
  homeHidden: {},
  streamQuality: "auto", // user's call 2026-09-16: Auto, and ours follows the network live (AUDIO-QUALITY.md)
  playNowScope: "list", // user's call 2026-09-10: Play Now = the song, then the rest of its list
  historyShowDay: false, // user's call 2026-09-15: History looks as it always did until you ask
  dropPlayQueue: "keep", // user's call 2026-09-14: a drop on Now Playing keeps Up Next
  previousReach: "lookback",
  restoreQueue: "song", // user's call 2026-09-12: the last song back in Now Playing, paused, with its queue
  shuffleManual: "top",
  shuffleIdle: "library",
  shuffleStays: true, // user's call 2026-09-15: shuffle is a mode (NEXT-VERSION §14 A)
  shuffleMode: false,
  repeatMode: "off",
  fullPlayRule: "fraction",
  replayAuto: true,
  replayDay: "mon",
  replayKeep: false,
  playlistEagerCounts: true,
  playlistCreateSummon: "notmini", // user's call 2026-09-15: in mini the summon replaces the playlist
  playlistExport: true, // user's call 2026-09-14: on, like Add to Library
  nowPlayingCover: "album",
  newPlaylistCover: "letters", // user's call 2026-09-15
  webReach: 2, // the artist's collaborators and theirs: a real web without drifting far (PLAYLIST-WEB.md §3)
  webSize: 50, // an afternoon of music; 100 at reach 3 is where unrelated artists start to show
  webPrefer: "mix", // no lean until you pick one: a web is both a comfort list and a find
  webSeedFilter: "all", // user's call 2026-09-16: a genre pick must not leave the artist's other-genre songs clashing
  webMakeMotion: "shrink", // user's call 2026-09-16: try the shrink first; Pop out is the one-beat close
  rewindCard: false,
  rewindAutoShown: false,
  agentSettings: "ask", // user's call 2026-09-15: a runtime permission on top of the off-only gates
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
  // New playlist opens Search became a three-way choice (2026-09-15): in mini the Search card
  // takes the only slot, so it hid the playlist you had just made. A stored "on" lands on the
  // new default, which keeps the summon everywhere but mini.
  const summon = into.playlistCreateSummon as unknown;
  if (typeof summon === "boolean") into.playlistCreateSummon = summon ? "notmini" : "off";
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
  // Open sizes replaced the remembered window sizes (2026-09-15, FUTURE-SETTINGS §8a). A
  // remembered size is what made NP small, so they are removed, not copied.
  for (const k of ["mini", "midi", "max", "mini-player"]) localStorage.removeItem(`deets.surface.size.${k}`);
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

// The tray panel reads this store too (same origin, same localStorage). A save in the main
// window reaches it as a `storage` event: reload, and notify each key that changed.
window.addEventListener("storage", (e) => {
  if (e.key !== KEY) return;
  const prev = state;
  state = load();
  (Object.keys(state) as (keyof Settings)[]).forEach((k) => {
    if (prev[k] !== state[k]) listeners.forEach((cb) => cb(k));
  });
});

// Values the store does not own (Rust's Close to tray, Start with Windows, Agent control)
// changed outside the Settings card — an agent set them (agent-settings.ts). The card caches
// them, so it reads them again.
const ownedListeners = new Set<() => void>();
export function onOwnedSettingChange(cb: () => void): () => void {
  ownedListeners.add(cb);
  return () => ownedListeners.delete(cb);
}
export const notifyOwnedSettingChange = (): void => ownedListeners.forEach((cb) => cb());
