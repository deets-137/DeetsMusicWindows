// The settings store — one typed object under `deets.settings`, the single source
// for every user preference the Settings card edits (SETTINGS.md). Modules that
// USED to own a key (Always on Top, menu mode) migrate in on first load; modules
// with their own state (Library Add, the Rust minimize-to-tray) are NOT here — the
// card talks to them directly.
//
// Read sites call `setting("x")` at the moment they act (no fan-out needed); things
// that must react live (the window's always-on-top, the dropdown mode, the Rewind
// gate in the layout) subscribe with `onSettingsChange`.

export interface Settings {
  // ── window ──
  alwaysOnTop: boolean;
  /** Every dropdown opens on hover instead of click (FUTURE-SETTINGS §9 is the per-menu future). */
  menuMode: "click" | "hover";
  /** Free resize flips the surface past its band (FUTURE-SETTINGS §8). Off = clamp only. */
  surfaceAutoFlip: boolean;
  /** Theme/skin switches animate (NEXT-VERSION §6). The OS reduced-motion preference still wins. */
  appearanceMotion: boolean;
  // ── playback ──
  /** Right-click "Play Now": just the song, or the song then the rest of the list (§1). Default list. */
  playNowScope: "song" | "list";
  /** What Previous may rewind into: the parked list above the click, or only heard songs (§4). */
  previousReach: "lookback" | "heard";
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
  // ── cards ──
  /** Offer the Rewind card in the slot pickers. Auto-enabled once at 50 play starts. */
  rewindCard: boolean;
  /** The one-shot auto-enable already fired (so a later "off" sticks). */
  rewindAutoShown: boolean;
}

const KEY = "deets.settings";

export const DEFAULTS: Settings = {
  alwaysOnTop: false,
  menuMode: "click",
  surfaceAutoFlip: true,
  appearanceMotion: true,
  playNowScope: "list", // user's call 2026-09-10: Play Now = the song, then the rest of its list
  previousReach: "lookback",
  shuffleManual: "top",
  shuffleIdle: "library",
  fullPlayRule: "fraction",
  replayAuto: true,
  replayDay: "mon",
  replayKeep: false,
  playlistEagerCounts: true,
  playlistCreateSummon: true,
  rewindCard: false,
  rewindAutoShown: false,
};

/** Keys that lived on their own before the store (2026-09-10); read once, then owned here. */
function migrate(into: Partial<Settings>): void {
  const aot = localStorage.getItem("deets.alwaysOnTop");
  if (aot !== null && into.alwaysOnTop === undefined) into.alwaysOnTop = aot === "true";
  const mode = localStorage.getItem("deets.menuMode");
  if (mode !== null && into.menuMode === undefined) into.menuMode = mode === "hover" ? "hover" : "click";
  const eager = localStorage.getItem("deets.playlists.eagerCounts");
  if (eager !== null && into.playlistEagerCounts === undefined) into.playlistEagerCounts = eager !== "off";
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
