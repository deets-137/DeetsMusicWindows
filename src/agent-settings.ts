// Agent settings (AGENT.md §6) — the window's half of the bridge's /settings route: list,
// get, and set the values the Settings card edits, in the card's own words.
//
// Rules (decided 2026-09-15):
//  - Settings › Connections › Agent changes settings (`agentSettings`): Allow applies a set
//    at once, Ask shows a question in the window every time, Off refuses (403).
//  - The consent gates (Add to Library and ♥, Export playlists, Agent control) are OFF ONLY:
//    an agent may turn them off, never on (2B). `agentSettings` itself is read-only.
//  - A set shows a quiet info toast, like every agent write (§5, 3A).
//  - Theme, skin and surface are keys too; a theme or skin set counts as a hand pick.
//
// The rows mirror settings-card.ts: a new card row joins SPECS as well (SETTINGS.md §5).

import { invoke } from "@tauri-apps/api/core";
import { setting, setSetting, notifyOwnedSettingChange, type Settings } from "./settings-store";
import { toast } from "./toast";
import { libraryAddEnabled, setLibraryAddEnabled } from "./library-add";
import { applyTheme, type ThemeName } from "./theme";
import { applySkin, currentSkin, type SkinName } from "./skin";
import { applySurface, currentSurface, MIN_SIZES, SIZE_KEYS, type SurfaceName, type SizeSlot } from "./surface";
import { noteHandPick, THEME_OPTIONS, SKIN_OPTIONS } from "./look-schedule";
import { withAppearanceTransition } from "./appearance";
import { presetOptions, selectPreset } from "./sound";

type Opt = { value: string; label: string };
type Reply = Record<string, unknown>;
type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];

// The same reply shapes as agent-writes.ts (bridge.rs maps `blocked:` → 403, `unknown:` → 400).
const waiting = (message: string): Reply => ({ ok: true, pending: "user", message });
const blocked = (why: string) => new Error(`blocked: ${why}`);
const unknown = (why: string) => new Error(`unknown: ${why}`);

interface Spec {
  key: string;
  label: string;
  section: string;
  kind: "choice" | "toggle" | "range" | "time" | "size";
  /** size: the view whose minimum a set is checked against. */
  slot?: SizeSlot;
  options?: Opt[];
  /** range: the bounds · time: minutes after midnight, on the half hour. */
  min?: number;
  max?: number;
  /** time: the minute step (default 30; the sleep time takes 15). */
  step?: number;
  /** "Ocean only", "Glass only": the row shows in the card only then. */
  only?: string;
  /** A consent gate (§5): an agent may turn it off, never on. */
  offOnly?: boolean;
  /** Agents read it, never set it. */
  readOnly?: boolean;
  /** The stored value as text ("on" / "off" for a toggle). */
  get: () => string | Promise<string>;
  set: (v: string) => void | Promise<void>;
  /** A sentence the reply adds after a set to this value. */
  note?: (v: string) => string | undefined;
}

const ON_OFF: Opt[] = [{ value: "on", label: "On" }, { value: "off", label: "Off" }];

const storeChoice = (section: string, key: keyof Settings, label: string, options: Opt[], extra: Partial<Spec> = {}): Spec => ({
  key, label, section, kind: "choice", options,
  get: () => String(setting(key)),
  set: (v) => setSetting(key, v as never),
  ...extra,
});
const storeToggle = (section: string, key: BoolKey, label: string, extra: Partial<Spec> = {}): Spec => ({
  key, label, section, kind: "toggle", options: ON_OFF,
  get: () => (setting(key) ? "on" : "off"),
  set: (v) => setSetting(key, v === "on"),
  ...extra,
});
const storeRange = (section: string, key: NumKey, label: string, extra: Partial<Spec> = {}): Spec => ({
  key, label, section, kind: "range", min: 0, max: 100,
  get: () => String(setting(key)),
  set: (v) => setSetting(key, Number(v)),
  ...extra,
});
const storeTime = (key: "dayStart" | "nightStart" | "sleepAt", label: string, from: number, to: number, section = "Look schedule"): Spec => ({
  key, label, section, kind: "time", min: from, max: to,
  get: () => setting(key),
  set: (v) => setSetting(key, v),
});
/** An open size (FUTURE-SETTINGS §8a): "WxH" in px. surface.ts resizes the window when the
 *  set is for the view that shows. */
const storeSize = (slot: SizeSlot, label: string): Spec => ({
  key: SIZE_KEYS[slot], label, section: "Window", kind: "size", slot,
  get: () => setting(SIZE_KEYS[slot]),
  set: (v) => setSetting(SIZE_KEYS[slot], v),
});

/** Rust owns these (settings.json, the Run key); the card caches them, so tell it. */
/** The Song of the Day rows Rust owns (settings.rs). Same call as `rustSettings`, its own
 *  shape: they are read and written one row at a time, like Last.fm's. */
const sotdRust = () =>
  invoke<{ sotd: boolean; sotdDayStart: number; sotdPicksPerDay: number; sotdPostMode: string; sotdPostAt: string }>("settings_get");
const rustSettings = () =>
  invoke<{ minimizeToTray: boolean; agentControl: boolean; agentHistory: boolean; lastfmScrobble: boolean; lastfmNowPlaying: boolean; airplayCapture: "app" | "system" }>("settings_get");
const rustToggle = (section: string, key: string, label: string, get: () => Promise<boolean>, set: (on: boolean) => Promise<unknown>, extra: Partial<Spec> = {}): Spec => ({
  key, label, section, kind: "toggle", options: ON_OFF,
  get: async () => ((await get()) ? "on" : "off"),
  set: async (v) => {
    await set(v === "on");
    notifyOwnedSettingChange();
  },
  ...extra,
});

/** A theme or skin set from outside the title menu: the same hand pick, transition and publish. */
function pickLook(kind: "theme" | "skin", v: string): void {
  noteHandPick();
  withAppearanceTransition(kind, () => (kind === "theme" ? applyTheme(v as ThemeName) : applySkin(v as SkinName)), {
    skin: kind === "skin" ? (v as SkinName) : undefined,
    by: "agent", // the slower cover (UX-COVERUPS §6b)
    // np-bus imports this module (through agent-writes); load it lazily, not at the top.
    after: () => void import("./np-bus").then((m) => m.publishAppearance()),
  });
}

const skinNote = (skin: SkinName, name: string) => () => (currentSkin() === skin ? undefined : `It shows while ${name} is the skin.`);
const MINUTES = [-60, -45, -30, -15, 0, 15, 30, 45, 60];

const SPECS: Spec[] = [
  // ── Window ──
  rustToggle("Window", "closeToTray", "Close to tray", async () => (await rustSettings()).minimizeToTray, (on) => invoke("settings_set_minimize_to_tray", { on }), {
    note: (v) => (v === "off" ? "The × button now quits DeetsMusic, and that stops these tools until DeetsMusic starts again." : undefined),
  }),
  storeChoice("Window", "trayView", "Tray icon opens", [{ value: "cards", label: "Mini" }, { value: "player", label: "Player" }]),
  rustToggle("Window", "startWithWindows", "Start with Windows", () => invoke<boolean>("autostart_get"), (on) => invoke<boolean>("autostart_set", { on })),
  storeToggle("Window", "surfaceAutoFlip", "Resize changes surface"),
  storeToggle("Window", "volumeShrink", "Shrink volume bar"),
  storeSize("mini", "Mini opens at"),
  storeSize("player", "Player opens at"),
  storeSize("midi", "Midi opens at"),
  storeSize("max", "Max opens at"),
  storeChoice("Window", "maxShortWindow", "Max window when short", [{ value: "flip", label: "Becomes Midi" }, { value: "floor", label: "Stops at floor" }]),
  storeChoice("Window", "alwaysOnTop", "Keep on top", [{ value: "always", label: "Always" }, { value: "player", label: "Player" }, { value: "off", label: "Off" }]),
  storeToggle("Window", "cardGrow", "Grow cards from edges"),
  storeToggle("Window", "moveSections", "Move sections by holding"),
  storeToggle("Sharing", "shareActivityDiscord", "Share activity on Discord"),
  storeToggle("Sharing", "shareActivityApp", "Share activity on DeetsMusic"),
  storeToggle("Discord", "discordRoomInvite", "Let my profile invite people to my room"),
  storeToggle("Friends", "friendsListenAlong", "Let friends listen along"),
  storeToggle("Friends", "friendsRoomInvite", "Put my room code on my box"),
  storeToggle("Window", "cardGrowOutside", "Collapse on outside click"),
  storeToggle("Menus, hints and notices", "compassCloseAway", "Compass closes on outside click"),
  storeChoice("Window", "cardGrowPick", "Grown card on a new pick", [{ value: "keep", label: "Keeps size" }, { value: "collapse", label: "Collapses" }]),
  storeChoice("Window", "cardDrill", "Card on drill", [{ value: "inplace", label: "In place" }, { value: "summon", label: "Summon" }]),
  storeToggle("Window", "cardDrillBring", "Bring a card already open"),
  storeChoice("Window", "cardGrowView", "Keep view when grown", [{ value: "keep", label: "Keep" }, { value: "size", label: "Per size" }]),
  storeToggle("Window", "cardMemoryDisk", "Keep card places on restart"),
  {
    key: "surface", label: "Surface", section: "Window", kind: "choice",
    options: [{ value: "mini", label: "Mini" }, { value: "player", label: "Mini player" }, { value: "midi", label: "Midi" }, { value: "max", label: "Max" }],
    get: () => (currentSurface() === "mini" && document.documentElement.dataset.mini === "player" ? "player" : currentSurface()),
    // Under the agent's slower cover (UX-COVERUPS §6b): the resize and the card recompose run
    // while it is opaque. Returns at once, so a theme or skin sent next joins the same cover.
    set: (v) =>
      withAppearanceTransition(
        "surface",
        async () => {
          if (v === "player") await applySurface("mini", "player");
          else await applySurface(v as SurfaceName, v === "mini" ? "cards" : undefined);
          invoke("tray_pin_main").catch(() => {}); // a deliberate pick pins a tray-popped window, as the menu does
        },
        { by: "agent" },
      ),
  },
  // ── Theme and skin, Look schedule, Motion, Skin settings, Menus ──
  {
    key: "theme", label: "Theme", section: "Theme and skin", kind: "choice", options: THEME_OPTIONS,
    get: () => document.documentElement.dataset.theme ?? "",
    set: (v) => pickLook("theme", v),
    note: () => (setting("lookSchedule") !== "off" ? "The look schedule is on: this pick lasts as Settings › Menu pick lasts says." : undefined),
  },
  {
    key: "skin", label: "Skin", section: "Theme and skin", kind: "choice", options: SKIN_OPTIONS,
    get: () => currentSkin(),
    set: (v) => pickLook("skin", v),
    note: () => (setting("lookSchedule") !== "off" ? "The look schedule is on: this pick lasts as Settings › Menu pick lasts says." : undefined),
  },
  storeChoice("Look schedule", "lookSchedule", "Change look at", [
    { value: "sun", label: "Sunrise and sunset" }, { value: "clock", label: "Set times" }, { value: "windows", label: "Windows mode" }, { value: "off", label: "Off" },
  ]),
  storeChoice("Look schedule", "dayTheme", "Day look theme", THEME_OPTIONS),
  storeChoice("Look schedule", "daySkin", "Day look skin", SKIN_OPTIONS),
  storeChoice("Look schedule", "nightTheme", "Night look theme", THEME_OPTIONS),
  storeChoice("Look schedule", "nightSkin", "Night look skin", SKIN_OPTIONS),
  storeTime("dayStart", "Day starts at", 4 * 60, 12 * 60, "Look schedule"),
  storeTime("nightStart", "Night starts at", 15 * 60, 23 * 60 + 30, "Look schedule"),
  // ── Sound (SOUND.md): the equalizer and DeetsAdaptiveSound. The two master switches are
  //    off only: every effect ships off (Apple DPLA §3.3.6.D), and turning one on is the user's
  //    own choice in the Sound panel, not an agent's. ──
  storeToggle("Sound", "soundEq", "Equalizer", { offOnly: true }),
  {
    key: "soundEqPreset", label: "Equalizer preset", section: "Sound", kind: "choice",
    get options() {
      return presetOptions().map((p) => ({ value: p.id, label: p.name }));
    },
    get: () => setting("soundEqPreset"),
    set: (v) => selectPreset(v),
  },
  storeChoice("Sound", "soundEqMode", "Equalizer view", [{ value: "graphic", label: "Sliders" }, { value: "parametric", label: "Dots" }]),
  storeChoice("Sound", "soundEqPreamp", "Avoid distortion", [{ value: "limiter", label: "Limiter only" }, { value: "needed", label: "When needed" }, { value: "always", label: "Always" }, { value: "manual", label: "By hand" }]),
  storeToggle("Sound", "soundEqPerOutput", "Remember each output"),
  storeToggle("Sound", "soundAdaptive", "Adaptive sound", { offOnly: true }),
  storeToggle("Sound", "soundLoudness", "Match loudness"),
  storeChoice("Sound", "soundLoudTarget", "Match songs to", [[-16, "Standard"], [-14, "Louder"], [-18, "Quieter"]].map(([v, l]) => ({ value: String(v), label: `${l} (${v} LUFS)` })), {
    get: () => String(setting("soundLoudTarget")),
    set: (v) => setSetting("soundLoudTarget", Number(v)),
  }),
  storeToggle("Sound", "soundLoudAlbum", "Keep albums together"),
  storeChoice("Sound", "soundLoudUnmeasured", "Songs not measured get", [{ value: "median", label: "Usual amount" }, { value: "none", label: "No change" }]),
  storeChoice("Sound", "soundLowVol", "Fuller at low volume", [{ value: "off", label: "Off" }, { value: "gentle", label: "Gentle" }, { value: "full", label: "Full" }]),
  storeChoice("Sound", "soundLowVolKey", "Follow the volume of", [{ value: "both", label: "App + Windows" }, { value: "app", label: "App only" }]),
  storeChoice("Sound", "soundCrossfeed", "Headphone crossfeed", [{ value: "auto", label: "Auto" }, { value: "always", label: "Always" }, { value: "off", label: "Off" }]),
  storeChoice("Sound", "soundCrossfeedLevel", "Blend amount", [{ value: "light", label: "Light" }, { value: "medium", label: "Medium" }, { value: "strong", label: "Strong" }]),
  storeChoice("Sound", "soundReviewDays", "Ask to keep after", [7, 14, 3, 0].map((d) => ({ value: String(d), label: d ? `${d} days` : "Never" })), {
    get: () => String(setting("soundReviewDays")),
    set: (v) => setSetting("soundReviewDays", Number(v)),
  }),
  // ── Rooms (ROOMS.md §8): the guest controls a room YOU host starts with. The room you
  // are in is the panel's (a live change is a room command, not a setting), and the name
  // and the worker address are text, which this route has no kind for (AGENT.md §6). ──
  ...(["playPause", "skip", "seek", "add", "changeQueue"] as const).map((which): Spec => ({
    key: `roomGuests.${which}`,
    label: {
      playPause: "Guests may start and stop",
      skip: "Guests may skip",
      seek: "Guests may seek",
      add: "Guests may add songs",
      changeQueue: "Guests may change Up Next",
    }[which],
    section: "Rooms",
    kind: "choice",
    options: [{ value: "everyone", label: "Everyone" }, { value: "host", label: "Host only" }],
    get: () => String((setting("roomGuestControls") as Record<string, string>)[which] ?? "everyone"),
    set: (v) => setSetting("roomGuestControls", { ...setting("roomGuestControls"), [which]: v }),
    note: (v) =>
      which === "playPause" && v === "host"
        ? "A guest's Pause still stops their own app; it just does not stop the room (ROOMS.md §12.3)."
        : undefined,
  })),
  // ── Sleep (NEXT-VERSION §17): the schedule and the wind-down; a running timer is the panel's ──
  storeChoice("Sleep", "sleepSchedule", "Sleep every day", [{ value: "off", label: "Off" }, { value: "sun", label: "Sunset" }, { value: "clock", label: "At a time" }], {
    note: (v) => (v === "off" ? undefined : "It pauses only if music is playing at that time."),
  }),
  { ...storeTime("sleepAt", "Sleep at", 0, 23 * 60 + 45, "Sleep"), step: 15 },
  storeToggle("Sleep", "sleepPlayOut", "Play out song"),
  storeChoice("Sleep", "sleepWind", "Wind down", [0, 1, 2, 5, 10, 15, 30].map((m) => ({ value: String(m), label: m ? `${m} min` : "Off" })), {
    get: () => String(setting("sleepWind")),
    set: (v) => setSetting("sleepWind", Number(v)),
  }),
  {
    key: "sunShift", label: "Shift sun times", section: "Look schedule", kind: "choice",
    options: MINUTES.map((v) => ({ value: String(v), label: v === 0 ? "None" : `${v > 0 ? "+" : "−"}${Math.abs(v)} min` })),
    get: () => String(setting("sunShift")),
    set: (v) => setSetting("sunShift", Number(v)),
  },
  storeChoice("Look schedule", "lookHold", "Menu pick lasts", [{ value: "next", label: "Until next change" }, { value: "always", label: "For good" }]),
  storeToggle("Motion", "appearanceMotion", "Animate look changes"),
  storeToggle("Motion", "cardSwapMotion", "Animate card swaps"),
  storeToggle("Motion", "fancyScrubber", "Fancy scrubber"),
  storeChoice("Motion", "backgroundMotion", "Animate backgrounds", [{ value: "on", label: "On" }, { value: "reduced", label: "Reduced" }, { value: "off", label: "Off" }]),
  storeRange("Skin settings", "oceanCardOpacity", "Card opacity", { only: "Ocean only", note: skinNote("ocean", "Ocean") }),
  storeChoice("Skin settings", "oceanEdges", "Draw card edges", [{ value: "sand", label: "Sand" }, { value: "soft", label: "Soft" }], { only: "Ocean only", note: skinNote("ocean", "Ocean") }),
  storeRange("Skin settings", "oceanSand", "Sand width", { only: "Ocean only, with Sand edges", note: skinNote("ocean", "Ocean") }),
  storeToggle("Skin settings", "glassFancy", "Fancy Glass", { only: "Glass only", note: skinNote("glass", "Glass") }),
  storeRange("Skin settings", "glassBacklight", "Backlight", { only: "Glass only, with Fancy Glass on", note: skinNote("glass", "Glass") }),
  storeRange("Skin settings", "glassTint", "Tint cards", { only: "Glass only, with Fancy Glass on", note: skinNote("glass", "Glass") }),
  storeRange("Skin settings", "glassCanvasGlow", "Canvas glow", { only: "Glass only, with Fancy Glass on", note: skinNote("glass", "Glass") }),
  storeRange("Skin settings", "glassCanvasDim", "Dim canvas", { only: "Glass only, with Fancy Glass on", note: skinNote("glass", "Glass") }),
  storeChoice("Skin settings", "pressVinyl", "Record player", [{ value: "spin", label: "Spin" }, { value: "still", label: "Still" }, { value: "off", label: "Off" }], { only: "Press only", note: skinNote("press", "Press") }),
  storeChoice("Skin settings", "pressVinylWhere", "Show record on", [{ value: "stage", label: "Stage" }, { value: "card", label: "Stage + card" }, { value: "everywhere", label: "Everywhere" }], { only: "Press only, with Record player on", note: skinNote("press", "Press") }),
  storeChoice("Skin settings", "pressVinylSpeed", "Spin speed", [{ value: "33", label: "33⅓" }, { value: "45", label: "45" }, { value: "78", label: "78" }], { only: "Press only, with Record player on Spin", note: skinNote("press", "Press") }),
  storeToggle("Skin settings", "pressVinylPlate", "Show record plate", { only: "Press only, with Record player on", note: skinNote("press", "Press") }),
  {
    key: "menuMode", label: "Open menus on hover", section: "Menus, hints and notices", kind: "toggle", options: ON_OFF,
    get: () => (setting("menuMode") === "hover" ? "on" : "off"),
    set: (v) => setSetting("menuMode", v === "on" ? "hover" : "click"),
  },
  storeChoice("Menus, hints and notices", "toasts", "Show notices", [{ value: "all", label: "Everything" }, { value: "failures", label: "Failures" }]),
  // ── Playback ──
  storeChoice("Playback", "streamQuality", "Stream quality", [{ value: "auto", label: "Auto" }, { value: "high", label: "High" }, { value: "low", label: "Low" }]),
  storeChoice("Playback", "playNowScope", "Play Now plays", [{ value: "song", label: "Song only" }, { value: "list", label: "Song and rest of list" }]),
  storeChoice("Playback", "pinNewAct", "New pins open on click", [{ value: "open", label: "Open" }, { value: "play", label: "Play" }, { value: "shuffle", label: "Shuffle" }]),
  storeChoice("Playback", "dropPlayQueue", "Drop on Now Playing", [{ value: "keep", label: "Keep Up Next" }, { value: "replace", label: "Replace it" }]),
  storeChoice("Playback", "previousReach", "Previous rewinds", [{ value: "lookback", label: "The list" }, { value: "heard", label: "Played songs" }]),
  storeChoice("Playback", "restoreQueue", "Restore on launch", [{ value: "song", label: "Last song" }, { value: "queue", label: "Up Next" }, { value: "off", label: "Nothing" }]),
  storeToggle("Playback", "shuffleStays", "Shuffle button stays on"),
  storeChoice("Playback", "shuffleManual", "Shuffle keeps picks", [{ value: "top", label: "First" }, { value: "hold", label: "In place" }, { value: "mix", label: "Mixed" }]),
  storeToggle("Playback", "historyShowDay", "Show the day in History"),
  // ── AirPlay (AIRPLAY.md §7) ──
  {
    key: "airplaySend", label: "Send to speaker", section: "AirPlay", kind: "choice",
    options: [{ value: "app", label: "DeetsMusic only" }, { value: "system", label: "All PC sound" }],
    get: async () => (await rustSettings()).airplayCapture,
    set: async (v) => {
      await invoke("settings_set_airplay_capture", { v });
      notifyOwnedSettingChange();
    },
  },
  storeChoice("Playback", "shuffleIdle", "Idle shuffle plays", [{ value: "library", label: "Library" }, { value: "noop", label: "Nothing" }]),
  // ── Home (HOME.md §9, §10): the one switch over every Apple call the card makes. The
  //    hide rows stay out — a hide is the user's own gesture on a tile. ──
  storeToggle("Home", "homeApple", "Follow your other devices"),
  // ── Apple Music: the consent gates, off only ──
  {
    key: "libraryAdd", label: "Add to Library and ♥", section: "Apple Music", kind: "toggle", options: ON_OFF, offOnly: true,
    get: () => (libraryAddEnabled() ? "on" : "off"),
    set: (v) => setLibraryAddEnabled(v === "on"),
  },
  storeToggle("Apple Music", "addSquareOwned", "Show ✓ on songs you have"),
  storeToggle("Apple Music", "playlistExport", "Export playlists", { offOnly: true }),
  // ── Last.fm (LASTFM.md §6): both write to the user's Last.fm profile, so off only, like the
  //    Apple Music gates. The connect itself is the browser's, never an agent's. ──
  rustToggle("Last.fm", "lastfmScrobble", "Scrobble plays", async () => (await rustSettings()).lastfmScrobble, (on) => invoke("settings_set_lastfm_scrobble", { on }), { offOnly: true }),
  rustToggle("Last.fm", "lastfmNowPlaying", "Show now playing", async () => (await rustSettings()).lastfmNowPlaying, (on) => invoke("settings_set_lastfm_now_playing", { on }), { offOnly: true }),
  // ── Playlists ──
  storeToggle("Playlists", "playlistEagerCounts", "Show playlist counts"),
  storeToggle("Playlists", "playlistAutoRefresh", "Refresh playlists by themselves"),
  storeChoice("Playlists", "playlistCreateSummon", "New playlist opens Search", [{ value: "notmini", label: "Not in mini" }, { value: "always", label: "Always" }, { value: "off", label: "Never" }]),
  storeChoice("Playlists", "nowPlayingCover", "Show cover", [{ value: "album", label: "Album" }, { value: "playlist", label: "Playlist" }]),
  storeChoice("Playlists", "newPlaylistCover", "New cover", [{ value: "letters", label: "Letters" }, { value: "mosaic", label: "Mosaic" }, { value: "note", label: "Note" }]),
  storeChoice("Playlists", "webReach", "Web reach", [1, 2, 3].map((n) => ({ value: String(n), label: String(n) })), {
    get: () => String(setting("webReach")),
    set: (v) => setSetting("webReach", Number(v) as 1 | 2 | 3),
  }),
  storeChoice("Playlists", "webSize", "Web size", [25, 50, 100].map((n) => ({ value: String(n), label: String(n) })), {
    get: () => String(setting("webSize")),
    set: (v) => setSetting("webSize", Number(v) as 25 | 50 | 100),
  }),
  storeChoice("Playlists", "webMakeMotion", "Web panel closes", [{ value: "shrink", label: "Shrink to chip" }, { value: "pop", label: "Pop out" }]),
  storeChoice("Playlists", "webSeedFilter", "Web genre chips filter", [{ value: "all", label: "All songs" }, { value: "floor", label: "Keep 5" }, { value: "off", label: "Web only" }]),
  storeChoice("Playlists", "webPrefer", "Web prefers songs", [{ value: "familiar", label: "Familiar" }, { value: "discover", label: "Discover" }, { value: "mix", label: "Mix" }]),
  // No Settings row: the web panel's Keep · Temp row under Make playlist (PLAYLIST-WEB.md §10).
  storeChoice("Playlists", "webTempDays", "Temp web playlist days", [1, 3, 5, 7, 30].map((n) => ({ value: String(n), label: String(n) })), {
    get: () => String(setting("webTempDays")),
    set: (v) => setSetting("webTempDays", Number(v) as 1 | 3 | 5 | 7 | 30),
  }),
  // ── Rewind ──
  storeToggle("Rewind", "rewindCard", "Rewind card"),
  storeChoice("Rewind", "fullPlayRule", "Count a play at", [{ value: "fraction", label: "90%" }, { value: "end", label: "End" }, { value: "scrobble", label: "Half or 4 min" }]),
  storeToggle("Rewind", "replayAuto", "Weekly Replay"),
  storeChoice("Rewind", "replayDay", "Weekly Replay day", [
    { value: "mon", label: "Mon" }, { value: "tue", label: "Tue" }, { value: "wed", label: "Wed" }, { value: "thu", label: "Thu" },
    { value: "fri", label: "Fri" }, { value: "sat", label: "Sat" }, { value: "sun", label: "Sun" },
  ]),
  storeToggle("Rewind", "replayKeep", "Keep every Replay"),
  // ── Song of the Day (docs/integrations/DeetsOTD.md §8.8) ──
  // Five rows live in Rust; the sixth (the suggestion) is a view preference in the store.
  // The switch itself is OFF ONLY: an agent may take the feature away, never give it (§5 2B).
  // The webhook link has no spec at all — no route reads or writes a secret.
  rustToggle("Song of the Day", "sotd", "Song of the Day", async () => (await sotdRust()).sotd, (on) => invoke("settings_set_sotd", { on }), {
    offOnly: true,
    note: (v) => (v === "off" ? "Song of the Day is off. Only you can turn it on again, in DeetsMusic › Settings › Song of the Day." : undefined),
  }),
  storeToggle("Song of the Day", "sotdSuggest", "Suggest today's pick"),
  {
    key: "sotdDayStart", label: "Day starts at", section: "Song of the Day", kind: "choice",
    options: [{ value: "0", label: "Midnight" }, { value: "5", label: "5 AM" }],
    get: async () => String((await sotdRust()).sotdDayStart),
    set: async (v) => {
      await invoke("settings_set_sotd_day_start", { hour: Number(v) });
      notifyOwnedSettingChange();
    },
  },
  {
    key: "sotdPicksPerDay", label: "Picks per day", section: "Song of the Day", kind: "choice",
    options: [{ value: "1", label: "1" }, { value: "2", label: "2" }, { value: "0", label: "No limit" }],
    get: async () => String((await sotdRust()).sotdPicksPerDay),
    set: async (v) => {
      await invoke("settings_set_sotd_picks_per_day", { n: Number(v) });
      notifyOwnedSettingChange();
    },
  },
  {
    key: "sotdPostMode", label: "Post my picks", section: "Song of the Day", kind: "choice",
    options: [{ value: "ask", label: "Ask each time" }, { value: "now", label: "Right away" }, { value: "time", label: "At a set time" }],
    get: async () => (await sotdRust()).sotdPostMode,
    set: async (v) => {
      await invoke("settings_set_sotd_post_mode", { mode: v });
      notifyOwnedSettingChange();
    },
  },
  {
    key: "sotdPostAt", label: "Post at", section: "Song of the Day", kind: "time", min: 0, max: 23 * 60 + 45, step: 15,
    get: async () => (await sotdRust()).sotdPostAt,
    set: async (v) => {
      await invoke("settings_set_sotd_post_at", { at: v });
      notifyOwnedSettingChange();
    },
  },
  // ── Connections ──
  rustToggle("Connections", "agentControl", "Agent control", async () => (await rustSettings()).agentControl, (on) => invoke("settings_set_agent_control", { on }), {
    offOnly: true,
    note: (v) => (v === "off" ? "Agent control is off. Only you can turn it on again, in DeetsMusic › Settings › Connections." : undefined),
  }),
  storeChoice("Connections", "agentSettings", "Agent changes settings", [{ value: "allow", label: "Allow" }, { value: "ask", label: "Ask" }, { value: "off", label: "Off" }], { readOnly: true }),
  // LOCAL-DATA.md §9: a privacy gate, so off only, like Agent control.
  rustToggle("Connections", "agentHistory", "Agents read play history", async () => (await rustSettings()).agentHistory, (on) => invoke("settings_set_agent_history", { on }), {
    offOnly: true,
    note: (v) => (v === "off" ? "Play history is hidden from agents now. Only you can turn it on again, in DeetsMusic › Settings › Connections." : undefined),
  }),
  // ── Updates ──
  storeChoice("Updates", "updateMode", "Get updates", [{ value: "auto", label: "Automatic" }, { value: "ask", label: "Ask" }, { value: "off", label: "Off" }]),
];

const SECTIONS = [...new Set(SPECS.map((s) => s.section))];

const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** What a set takes, in the words the reply and the listing show. */
function accepts(s: Spec): string {
  switch (s.kind) {
    case "range": return `${s.min}–${s.max}`;
    case "time": return `HH:MM on ${s.step === 15 ? ":00, :15, :30 or :45" : ":00 or :30"}, ${clock(s.min!)}–${clock(s.max!)}`;
    case "size": return `W×H in px, at least ${MIN_SIZES[s.slot!].w}×${MIN_SIZES[s.slot!].h}`;
    default: return s.options!.map((o) => o.label).join(" | ");
  }
}

function labelOf(s: Spec, v: string): string {
  if (s.kind === "range") return `${v}%`;
  if (s.kind === "time") return v;
  if (s.kind === "size") return v.replace("x", " × ");
  return s.options!.find((o) => o.value === v)?.label ?? v;
}

async function rowOf(s: Spec): Promise<Reply> {
  const value = await s.get();
  return {
    key: s.key,
    label: s.label,
    section: s.section,
    value,
    valueLabel: labelOf(s, value),
    accepts: accepts(s),
    only: s.only,
    limit: s.readOnly ? "read-only" : s.offOnly ? "off only" : undefined,
  };
}

/** A key, or a row label ("Keep on top"): frontier models pass either. */
function find(key: unknown): Spec {
  const k = String(key ?? "").trim();
  if (!k) throw unknown("give key: a setting key from list settings, e.g. alwaysOnTop");
  // Spaces, case and punctuation don't count: "keepontop", "Keep on top", "keep-on-top".
  const flat = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const want = flat(k);
  const hit = SPECS.find((s) => flat(s.key) === want || flat(s.label) === want);
  if (hit) return hit;
  const near = SPECS.filter((s) => flat(s.key).includes(want) || flat(s.label).includes(want)).map((s) => s.key);
  throw unknown(`no setting ${JSON.stringify(k)}${near.length ? ` — did you mean ${near.slice(0, 5).join(", ")}?` : " — list settings first"}`);
}

const norm = (x: string) =>
  x.toLowerCase().replace(/−/g, "-").replace(/\s+/g, "").replace(/min$/, "").replace(/^\+/, "");

/** The stored value a set means, or a 400 that lists what the setting takes. */
function parse(s: Spec, raw: string): string {
  const input = raw.trim();
  if (s.kind === "toggle") {
    const t = input.toLowerCase();
    if (["on", "true", "yes"].includes(t)) return "on";
    if (["off", "false", "no"].includes(t)) return "off";
  } else if (s.kind === "choice") {
    const n = norm(input);
    const hit = s.options!.find((o) => norm(o.value) === n || norm(o.label) === n);
    if (hit) return hit.value;
  } else if (s.kind === "range") {
    const v = Number(input.replace(/%$/, ""));
    if (input && Number.isInteger(v) && v >= s.min! && v <= s.max!) return String(v);
  } else if (s.kind === "size") {
    // "600x640", "600 x 640", "600×640"
    const m = /^(\d{3,4})\s*[x×]\s*(\d{3,4})$/i.exec(input);
    const min = MIN_SIZES[s.slot!];
    if (m && Number(m[1]) >= min.w && Number(m[2]) >= min.h) return `${Number(m[1])}x${Number(m[2])}`;
  } else {
    const m = /^(\d{1,2}):(\d{2})$/.exec(input);
    const mins = m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
    if (m && Number(m[2]) % (s.step ?? 30) === 0 && mins >= s.min! && mins <= s.max!) return clock(mins);
  }
  throw unknown(`${s.key} (${s.label}) takes ${accepts(s)}`);
}

/** GET /settings[?section=]: every row, or one section's. */
export async function settingsList(payload: any): Promise<Reply> {
  const want = String(payload?.section ?? "").trim().toLowerCase();
  const specs = want ? SPECS.filter((s) => s.section.toLowerCase() === want) : SPECS;
  if (want && !specs.length) throw unknown(`no section ${JSON.stringify(payload.section)} — sections: ${SECTIONS.join(", ")}`);
  return { settings: await Promise.all(specs.map(rowOf)) };
}

/** POST /settings: list · get · set. */
export async function settingsWrite(payload: any): Promise<Reply> {
  const action = String(payload?.action ?? "");
  if (action === "list") return settingsList(payload);
  if (action !== "get" && action !== "set") throw unknown(`settings action ${JSON.stringify(action)}: use list, get, or set`);
  const s = find(payload?.key);
  if (action === "get") return { row: await rowOf(s) };

  if (s.readOnly) throw blocked(`Only you can change ${s.label}, in DeetsMusic › Settings › ${s.section}.`);
  const v = parse(s, String(payload?.value ?? ""));
  const cur = await s.get();
  if (cur === v) return { ok: true, message: `${s.label} is already ${labelOf(s, v)}.` };
  // The Sound switches live in the title bar's Sound panel, not in Settings.
  const where = s.section === "Sound" ? "the Sound panel in the title bar" : `Settings › ${s.section}`;
  if (s.offOnly && v === "on") throw blocked(`Only you can turn on ${s.label}, in DeetsMusic › ${where}.`);

  const mode = setting("agentSettings");
  if (mode === "off") throw blocked("Agent changes settings is off in DeetsMusic › Settings › Connections.");
  const what = `${s.label} to ${labelOf(s, v)}`;
  const note = s.note?.(v);
  const tail = note ? ` ${note}` : "";
  if (mode === "ask") {
    toast({
      kind: "info",
      sticky: true,
      text: `An agent wants to set ${what}.`,
      actions: [
        { label: "Allow", run: () => void Promise.resolve(s.set(v)).catch((e) => console.error("[agent] setting", e)) },
        { label: "Not now" },
      ],
    });
    return waiting(`DeetsMusic asked the user to allow setting ${what}. Tell them to answer the question in DeetsMusic; it applies when they press Allow, so don't send it again.${tail}`);
  }
  await s.set(v);
  toast({ kind: "info", text: `An agent set ${what}.` });
  return { ok: true, message: `${s.label} is ${labelOf(s, v)}.${tail}` };
}
