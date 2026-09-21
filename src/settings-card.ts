// Settings card (SETTINGS.md) — the hybrid's second half. The title menu keeps the
// fast switches (Theme / Skin / Surface / Account) and one "Settings…" row that
// summons this card into a slot. Everything else lives here, in one scroll with
// section headers: the rehomed toggles (Always on Top, Minimize to Tray, hover menus,
// Library Add, the Extension block) and the v1 cut of FUTURE-SETTINGS (§1 §4 §5a §5b
// §7 §8 §14 §16) plus the Rewind gate. A control lives in exactly one place.
//
// Row kinds: TOGGLE (label + dot), CHOICE (label + one split pill of up to three
// options; more than three becomes a small menu), SPLIT (label + one pill cut into
// halves — an action, an on/off, or a menu — the search pin idiom, NEXT-VERSION §1),
// RANGE (label + a slider; a drag previews, the release writes), and HTML. Any row may
// carry `when`: it shows only while that holds (the look schedule's rows, and the
// skin-only rows — UI-ARCHITECTURE.md §Skin-only settings).
// Rows read the settings store (or the module that owns the value) and re-paint on change.

import "./styles/settings.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { lastfmStatus, type LastfmStatus } from "./lastfm";
import { setting, setSetting, onSettingsChange, onOwnedSettingChange, isFreshInstall, DEFAULTS, type Settings } from "./settings-store";
import { currentSkin, onSkinChange, applySkin, defaultSkin, type SkinName } from "./skin";
import { applyTheme, defaultTheme, type ThemeName } from "./theme";
import { withAppearanceTransition } from "./appearance";
import { makeSlider } from "./slider";
import { previewSkin } from "./skin-settings";

/** Fancy Glass's hover hint. The cost is the 2026-09-16 bench (DEBUGGING.md §Fancy Glass). */
const GLASS_FANCY_HINT = "Glass only. A live blur behind the cards, a moving background, and four sliders. Without a graphics card: about 85% fewer frames";
/** The four Glass sliders show under Glass with Fancy Glass on (off holds GLASS_LOCKED). */
const glassSliders = (): boolean => currentSkin() === "glass" && setting("glassFancy");
import { libraryAddEnabled, setLibraryAddEnabled, onLibraryAddChange } from "./library-add";
import { makeDropdown, type DropdownHandle } from "./dropdown";
import { esc } from "./collection-card";
import * as diag from "./diag";
import { toast, type ToastHandle } from "./toast";
import { copyLink } from "./copy-link";
import { openContextMenu, type MenuItem } from "./context-menu";
import * as frames from "./frames";
import { enterRows } from "./pop";
import { takeSettingRequest, onSettingRequest } from "./layout-bus";
import { rowDrag } from "./row-drag";
import { registerFinder } from "./find-key";
import { sharePauseLeft, pauseSharingForAnHour } from "./presence";
import { formatFriendCode, friendsState } from "./friends";
import { copyMyKey, pasteAKey } from "./friends-panel";
import {
  sortByOrder, moveTo, onRowOrderChange, sectionsMovable, holdMs,
  resetOrder, snapshotOrders, restoreOrders, orderedScopes,
} from "./row-order";
import { checkForUpdate, rollbackTo, olderVersions, onUpdateStatus, updateStatusText, versionText, type OlderVersion } from "./updater";
import { scheduleStatus, onScheduleChange, noteHandPick, THEME_OPTIONS, SKIN_OPTIONS } from "./look-schedule";
import type { CardDef, CardInstance, MountOpts } from "./cards";
import { scrollSnapshot, applyScrollSnapshot } from "./card-memory";
import { SIZE_KEYS, sizeSeen, type SizeSlot } from "./surface";
import { restartWalk } from "./walk";
import { hiddenCount, clearHidden } from "./home";
import {
  sotdSettings, outletStatuses, refreshSotdSettings, onSotdChange,
  postLog, postLine, outletName, STATE_WORD, withdrawPickAsking, type PostRecord,
} from "./sotd";

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
type Option = { value: string; label: string };

/** More options than this and a choice becomes a small menu instead of a split pill. */
const SPLIT_MAX = 3;

interface ToggleRow {
  kind: "toggle";
  id: string;
  label: string;
  hint?: () => string | undefined;
  get: () => boolean;
  set: (on: boolean) => void;
  /** The store key, when the store holds the value: the Compass renders such a row inline (COMPASS.md §3). */
  key?: BoolKey;
}
interface ChoiceRow {
  kind: "choice";
  id: string;
  label: string;
  hint?: string;
  /** A store key — or `get`/`set` for a value another owner holds (the Rust settings). */
  key?: keyof Settings;
  get?: () => string;
  set?: (v: string) => void;
  options: Option[];
  /** Force the dropdown form even at or under SPLIT_MAX — for options whose labels are
   *  too long to sit side by side (Press › Show record on). */
  menu?: boolean;
}
/** One half of a split pill. */
type Half =
  | { type: "action"; label: string; hint?: string; run: (el: HTMLElement) => void }
  | { type: "toggle"; get: () => boolean; set: (on: boolean) => void }
  | { type: "menu"; options: Option[]; get: () => string; set: (v: string) => void };
interface SplitRow {
  kind: "split";
  id: string;
  label: string;
  hint?: () => string | undefined;
  halves: Half[];
  /** Heads the indented `sub` rows under it (its label is underlined); or is one of them. */
  group?: boolean;
  sub?: boolean;
}
/** Markup of its own (Bugs › the report fields); events are wired by data attributes. */
interface HtmlRow {
  kind: "html";
  id: string;
  html: () => string;
}
/** A sub-heading inside one section's fold (Settings regroup, 2026-09-18, fork 1C + 4A):
 *  Window keeps one fold and names its three groups. Not a setting — it is skipped by the
 *  header's count and by the Compass index. */
interface HeadRow {
  kind: "head";
  id: string;
  label: string;
}
/** `when`: the row shows only while this is true (the look schedule's rows follow its mode). */
type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];
/** A slider (Glass's Tint / Frost). A drag calls `preview` only — a store write would
 *  re-render the card under the pointer — and the release writes the store. */
interface RangeRow {
  kind: "range";
  id: string;
  label: string;
  hint?: string;
  key: NumKey;
  min: number;
  max: number;
  unit: string;
  /** The smallest move, for the drag and the arrow keys. Default 1 (Shift: ten steps). */
  step?: number;
  preview: (v: number) => void;
}
type Row = (ToggleRow | ChoiceRow | SplitRow | HtmlRow | RangeRow | HeadRow) & { when?: () => boolean };
const shown = (rows: Row[]): Row[] => rows.filter((r) => !r.when || r.when());

// ── New marks (QUICK-SETTINGS.md §10): a row or a section that is new wears the N badge
//    beside its name, in the Settings card and in the quick panel alike, until the pointer
//    first rests on it. To flag a new setting, add one line here, and never take it out:
//    a mark stays until THIS user clears it (his call 2026-09-20). A brand-new install
//    starts with every mark in this list seen (`seedNewMarks`) — nothing here is new to
//    them. The seen marks share the quick panel's `quickSeen` list, as "row:<id>" and
//    "sec:<title>". ──
const NEW_MARKS: { section: string; row?: string }[] = [
  { section: "Friends" }, // Friends, built 2026-09-20
  { section: "Sharing", row: "shareDiscord" }, // Share activity on Discord, built 2026-09-20
];
const markKey = (m: { section: string; row?: string }) => (m.row ? `row:${m.row}` : `sec:${m.section}`);
const unseen = (key: string) => !setting("quickSeen").includes(key);
const newRow = (id: string) => NEW_MARKS.some((m) => m.row === id && unseen(`row:${id}`));
const newSection = (title: string) => NEW_MARKS.some((m) => !m.row && m.section === title && unseen(`sec:${title}`));
/** The N itself, inline after a name. `key` is what the first hover marks seen. */
const newBadge = (key: string) => `<span class="new-badge" data-new-mark="${esc(key)}" aria-label="New">N</span>`;
/** Mark one New badge seen (the first hover on its row or heading). */
function seeNew(key: string): void {
  const seen = setting("quickSeen");
  if (!seen.includes(key)) setSetting("quickSeen", [...seen, key]);
}
/** On a brand-new install, mark every New mark that exists today seen: a setting that was
 *  there before the user arrived is not new to them. A mark added in a later version is. */
export function seedNewMarks(): void {
  if (!isFreshInstall()) return;
  const seen = setting("quickSeen");
  const add = NEW_MARKS.map(markKey).filter((k) => !seen.includes(k));
  if (add.length) setSetting("quickSeen", [...seen, ...add]);
}
/** Does anything in these parts still wear a New badge? (a quick panel square shows its own N then) */
export function unseenNewIn(parts: SettingsPart[]): boolean {
  return NEW_MARKS.some(
    (m) => unseen(markKey(m)) && parts.some((p) => p.title === m.section && (!m.row ? !p.rows : !p.rows || p.rows.includes(m.row))),
  );
}
/** The header's count and the Compass index both mean settings, not sub-headings. */
const settingRows = (rows: Row[]): Row[] => shown(rows).filter((r) => r.kind !== "head");
const headRow = (id: string, label: string): HeadRow => ({ kind: "head", id, label });
interface Section {
  title: string;
  rows: Row[];
  /** Extra markup after the rows (a status line, action rows); events are wired by data attributes. */
  tail?: string | (() => string);
  /** The header's row count, when the tail holds rows of its own; default `rows.length`. */
  count?: number;
  /** Open until the user folds it (About). Every other section starts collapsed. */
  defaultOpen?: boolean;
}

// Section folds (the Playlists card's fold idiom). Only a user's own fold persists, as
// title → open; a section with no entry takes its `defaultOpen`.
const FOLDS_KEY = "deets.settings.folds";
const loadFolds = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(FOLDS_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
};

const storeToggle = (id: string, label: string, key: BoolKey, hint?: () => string | undefined): ToggleRow => ({
  key,
  kind: "toggle",
  id,
  label,
  hint,
  get: () => setting(key),
  set: (on) => setSetting(key, on),
});

// ── the look schedule's rows (LOOK-SCHEDULE.md) ──
type LookKey = "dayTheme" | "daySkin" | "nightTheme" | "nightSkin" | "dayStart" | "nightStart";
const storeMenu = (key: LookKey, options: Option[]): Half => ({
  type: "menu",
  options,
  get: () => setting(key),
  set: (v) => setSetting(key, v as never),
});
/** Half-hour steps from `from` to `to` (local minutes), labelled in the user's clock format. */
const timeOptions = (from: number, to: number, step = 30): Option[] => {
  const out: Option[] = [];
  for (let m = from; m <= to; m += step) {
    const hh = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    const label = new Date(2000, 0, 1, 0, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    out.push({ value: `${hh}:${mm}`, label });
  }
  return out;
};
const scheduled = () => setting("lookSchedule") !== "off";

// ── Settings › Reset (SETTINGS.md §3): one row per group of store keys ──
// Not reset: the Rust-owned rows (Close to tray, Start with Windows), the consent gates
// (Add to Library, Export playlists, Agent control, Agent changes settings), and Updates.
interface ResetGroup {
  id: string;
  label: string;
  hint: string;
  keys: (keyof Settings)[];
  /** The theme and skin, which live outside the store (theme.ts, skin.ts). */
  look?: boolean;
}
// Settings › Tips (2026-09-15): [the gesture, why to try it]. Not a manual — the few
// habits that let a person find everything else on their own. Hover and right-click
// first; they unlock the rest. Same voice as the row hints: short, active, no jargon.
// The last note is true only while Close to tray is on (its default); the tail drops it otherwise.
const TIP_CLOSE = "Close is not quit";
const TIPS: [string, string][] = [
  ["Hover anything", "Hold the pointer on a button for a moment. A note says what it does. Every button has one."],
  ["Right-click anything", "A song, an album, a playlist, a station, the cover in Now Playing. The menu holds what you can do with it. Nothing in it can break."],
  ["Drag anything", "Songs, albums, and playlists move. Drop one on Now Playing, on the Queue, or on a playlist and see."],
  ["Click your way in", "A tile opens. The arrow at the top goes back. Sort, View, and the magnifier above a list are safe to try."],
  ["Click DeetsMusic at the top left", "The look and the size of the window live there. Try a theme, a skin, and Mini or Max. Nothing is permanent."],
  ["Press Ctrl+Space", "A bar opens at the top. Type a card, a setting, a song, an album, an artist or a playlist, and press Enter to go there. Ctrl+Space again, or Escape, closes it."],
  [TIP_CLOSE, "The × hides DeetsMusic to the tray and the music keeps playing. The tray icon brings it back."],
];

const RESET_GROUPS: ResetGroup[] = [
  { id: "look", label: "Theme and skin", hint: "The first-launch pair for your Windows light or dark mode", keys: [], look: true },
  {
    id: "schedule", label: "Look schedule", hint: "Change look at, the day and night looks, the times, and Menu pick lasts",
    keys: ["lookSchedule", "dayTheme", "daySkin", "nightTheme", "nightSkin", "dayStart", "nightStart", "sunShift", "lookHold"],
  },
  { id: "motion", label: "Motion", hint: "The three Animate rows and Fancy scrubber", keys: ["appearanceMotion", "cardSwapMotion", "backgroundMotion", "fancyScrubber"] },
  {
    id: "skinrows", label: "Skin settings", hint: "The Ocean edges and sand, Fancy Glass and its four sliders, and the Press record player",
    keys: ["oceanEdges", "oceanSand", "glassFancy", "glassCanvasGlow", "glassCanvasDim", "glassBacklight", "glassTint", "pressVinyl", "pressVinylWhere", "pressVinylPlate", "pressVinylSpeed"],
  },
  {
    id: "menus", label: "Menus, hints and notices",
    hint: "Open menus on hover, the three hover-hint rows, Show notices, and the Compass outside-click rule",
    keys: ["menuMode", "hoverHints", "hoverHintDelay", "hoverSongNames", "toasts", "compassCloseAway"],
  },
  { id: "window", label: "Window", hint: "Tray icon opens, Resize changes surface, the four open sizes, Keep on top, the Growing and drilling rows, and Keep card places on restart. Not Close to tray or Start with Windows", keys: ["trayView", "surfaceAutoFlip", "volumeShrink", "sizeMini", "sizePlayer", "sizeMidi", "sizeMax", "maxShortWindow", "alwaysOnTop", "cardGrow", "cardGrowOutside", "cardGrowPick", "cardGrowView", "cardDrill", "cardDrillBring", "cardMemoryDisk", "moveSections"] },
  {
    id: "playback", label: "Playback", hint: "Every Playback row",
    keys: ["streamQuality", "playNowScope", "dropPlayQueue", "previousReach", "restoreQueue", "shuffleStays", "shuffleMode", "repeatMode", "shuffleManual", "shuffleIdle", "historyShowDay", "pinNewAct"],
  },
  {
    id: "sharing", label: "Sharing", hint: "Share activity on DeetsMusic and on Discord, and the hour's pause that covers both",
    keys: ["shareActivityApp", "shareActivityDiscord", "sharePauseUntil", "discordRoomInvite"],
  },
  {
    id: "friends", label: "Friends", hint: "Your friend code and its key, Listen Along, and whether your box carries your room code. Not your friend list — that is a list, not a setting",
    keys: ["friendsListenAlong", "friendsRoomInvite"],
  },
  {
    id: "playlists", label: "Playlists", hint: "Every Playlists row",
    keys: ["playlistEagerCounts", "playlistAutoRefresh", "playlistCreateSummon", "nowPlayingCover", "newPlaylistCover", "webReach", "webSize", "webPrefer", "webSeedFilter", "webMakeMotion"],
  },
  {
    id: "sound", label: "Sound", hint: "The equalizer, adaptive sound and their choices. Not your saved presets",
    keys: ["soundEq", "soundEqPreset", "soundEqCustom", "soundEqMode", "soundEqPreamp", "soundEqPreampDb", "soundEqPerOutput", "soundEqOutputs", "soundAdaptive", "soundLoudness", "soundLoudTarget", "soundLoudAlbum", "soundLoudUnmeasured", "soundLowVol", "soundLowVolKey", "soundCrossfeed", "soundCrossfeedLevel", "soundReviewDays"],
  },
  { id: "sleep", label: "Sleep", hint: "Sleep every day, the time, Wind down and Play out song. Not a timer that is running", keys: ["sleepSchedule", "sleepAt", "sleepWind", "sleepPlayOut"] },
  { id: "home", label: "Home", hint: "Your other devices, hiding, and every hidden tile", keys: ["homeApple", "homeHideLasts", "homeHidden"] },
  { id: "rewind", label: "Rewind", hint: "Every Rewind row", keys: ["rewindCard", "fullPlayRule", "replayDay", "replayAuto", "replayKeep"] },
];
/** The groups the Look and feel row resets; LOOK_PARTS get their own indented rows (menus does not). */
const LOOK_AND_FEEL = ["look", "schedule", "motion", "skinrows", "menus"];
const LOOK_PARTS = ["look", "schedule", "motion", "skinrows"];
interface ResetSnapshot {
  values: Partial<Settings>;
  look?: { theme: ThemeName; skin: SkinName };
}
const snapshotOf = (groups: ResetGroup[]): ResetSnapshot => ({
  values: Object.fromEntries(groups.flatMap((g) => g.keys).map((k) => [k, setting(k)])) as Partial<Settings>,
  look: groups.some((g) => g.look)
    ? { theme: document.documentElement.dataset.theme as ThemeName, skin: currentSkin() }
    : undefined,
});
const defaultsOf = (groups: ResetGroup[]): ResetSnapshot => ({
  values: Object.fromEntries(groups.flatMap((g) => g.keys).map((k) => [k, DEFAULTS[k]])) as Partial<Settings>,
  look: groups.some((g) => g.look) ? { theme: defaultTheme(), skin: defaultSkin() } : undefined,
});
const sameSnapshot = (a: ResetSnapshot, b: ResetSnapshot): boolean =>
  JSON.stringify(a.values) === JSON.stringify(b.values) && a.look?.theme === b.look?.theme && a.look?.skin === b.look?.skin;
/** Write a snapshot: the store keys first (the schedule settles), then the theme and skin as a hand pick. */
function applySnapshot(s: ResetSnapshot): void {
  for (const k of Object.keys(s.values) as (keyof Settings)[]) setSetting(k, s.values[k] as never);
  if (!s.look) return;
  const { theme, skin } = s.look;
  const newSkin = currentSkin() !== skin;
  if (document.documentElement.dataset.theme === theme && !newSkin) return;
  noteHandPick();
  withAppearanceTransition(newSkin ? "skin" : "theme", () => { applyTheme(theme); applySkin(skin); }, {
    skin: newSkin ? skin : undefined,
    // np-bus imports this module's neighbours (agent-settings.ts does the same); load it lazily.
    after: () => void import("./np-bus").then((m) => m.publishAppearance()),
  });
}

const SETUP_CLIENTS: Option[] = [
  { value: "claude-desktop", label: "Claude Desktop" },
  { value: "claude-code", label: "Claude Code" },
  { value: "cursor", label: "Cursor" },
  { value: "other-full", label: "Other (Full)" },
  { value: "other-small", label: "Other (Small)" },
];

export const settingsCard: CardDef = {
  id: "settings",
  title: "Settings",
  mount: (host, opts) => mountSettings(host, false, opts),
};

// ── The Compass's index (COMPASS.md §3): the card's own rows, built once, inert ──
// `mountSettings(host, true)` builds the sections and returns before any Rust read,
// listener or render. Only a row's label, hint, kind, store key and options are read from
// it; a closure over the mount's own state (Close to tray, Last.fm, the report form) is
// never run. So a row is inline only when its `key` names the store.
export interface SettingEntry {
  id: string;
  label: string;
  section: string;
  hint: () => string | undefined;
  when: () => boolean;
  control?:
    | { kind: "toggle"; get: () => boolean; set: (on: boolean) => void }
    | { kind: "choice"; options: Option[]; get: () => string; set: (v: string) => void };
}
let entries: SettingEntry[] | null = null;
export function settingsRows(): SettingEntry[] {
  if (entries) return entries;
  const { sections } = mountSettings(document.createElement("div"), true);
  entries = sections.flatMap((s) =>
    s.rows
      .filter((r) => r.kind !== "html" && r.kind !== "head")
      .map((r): SettingEntry => {
        const label = r.label;
        const hint = r.kind === "choice" || r.kind === "range" ? () => r.hint : (r.hint ?? (() => undefined));
        const when = r.when ?? (() => true);
        let control: SettingEntry["control"];
        if (r.kind === "toggle" && r.key) {
          const key = r.key;
          control = { kind: "toggle", get: () => setting(key), set: (on) => setSetting(key, on) };
        } else if (r.kind === "choice" && r.key && !r.menu && r.options.length <= SPLIT_MAX) {
          const key = r.key;
          control = {
            kind: "choice",
            options: r.options,
            get: () => (r.get ? r.get() : String(setting(key))),
            set: (v) => (r.set ? r.set(v) : setSetting(key, v as never)),
          };
        }
        return { id: r.id, label, section: s.title, hint, when, control };
      }),
  );
  return entries;
}

/** One section of the quick panel (QUICK-SETTINGS.md): a Settings section by title, whole,
 *  or only the rows `rows` names (then without its tail, which speaks for the whole). */
export interface SettingsPart {
  title: string;
  rows?: string[];
}

/** The quick panel's rows (QUICK-SETTINGS.md §3): the Settings card's own sections, drawn by
 *  the same code into `host`, so a row there and a row here can never disagree. No header,
 *  no search, no folds, no section move, and it never answers a row request (the card does). */
export function mountSettingsParts(host: HTMLElement, parts: SettingsPart[]): CardInstance {
  return mountSettings(host, false, undefined, parts);
}

function mountSettings(host: HTMLElement, inert = false, mountOpts?: MountOpts, parts?: SettingsPart[]): CardInstance & { sections: Section[] } {
  // The search pill (MOVABLE-ROWS.md §10, fork S1 = 1A): the header idiom every other
  // card has, and the same slide-down field under it. It reads `settingsRows()` — the
  // Compass's own index — so there is one list of settings, not two.
  host.innerHTML = parts
    ? `<div class="set quick__rows"></div>`
    : `<header class="panel__head"><h2 class="panel__title">Settings</h2>` +
      `<button class="panel__action" type="button" data-set-search aria-expanded="false" aria-label="Search" title="Finds a setting by name">` +
      `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M11 11l3 3"/></svg></button></header>` +
      `<div class="lib-searchbar" data-frames="settings-search"><div class="lib-searchbar__inner">` +
      `<label class="lib-search"><svg class="lib-search__icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M11 11l3 3"/></svg>` +
      `<input class="lib-search__input" data-set-q type="search" placeholder="Search settings…" autocomplete="off" spellcheck="false" /></label>` +
      `</div></div><div class="panel__body set"></div>`;
  const body = host.querySelector<HTMLElement>(".set")!;
  // The quick panel has no search: detached stand-ins keep the wiring below unchanged.
  const searchBar = host.querySelector<HTMLElement>(".lib-searchbar") ?? document.createElement("div");
  const searchBtn = host.querySelector<HTMLButtonElement>("[data-set-search]") ?? document.createElement("button");
  const searchInput = host.querySelector<HTMLInputElement>("[data-set-q]") ?? document.createElement("input");
  /** The live query. A filter, so while it holds text no section can be moved (§10.5). */
  let query = "";
  let searchOpen = false;
  /** The section titles the last render drew, in the order it drew them — what a drop
   *  index means, and the list a move is written over (row-order.ts `moveTo`). */
  let shownTitles: string[] = [];

  // Minimize to Tray and the AirPlay rows live in Rust (read there before JS can
  // answer, or at connect time); cache the values here and write through.
  let minimizeToTray = true;
  let autostart = false;
  let agentControl = true;
  // Last.fm (LASTFM.md §6): the two rows live in Rust (lastfm.rs reads them per play); the
  // status line reads the account and the waiting count.
  let lastfmScrobble = true;
  let lastfmNowPlaying = true;
  let lastfm: LastfmStatus | null = null;
  let agentHistory = true;
  // AirPlay (AIRPLAY.md §7, §12): Rust reads it at connect time; a change while connected
  // reconnects in place.
  let airplayCapture: "app" | "system" = "app";
  interface RustSettings { minimizeToTray: boolean; agentControl: boolean; agentHistory: boolean; lastfmScrobble: boolean; lastfmNowPlaying: boolean; airplayCapture: "app" | "system" }
  const takeRust = (s: RustSettings) => {
    minimizeToTray = s.minimizeToTray;
    airplayCapture = s.airplayCapture;
    agentControl = s.agentControl;
    agentHistory = s.agentHistory;
    lastfmScrobble = s.lastfmScrobble;
    lastfmNowPlaying = s.lastfmNowPlaying;
  };
  const lastfmLine = (): string => {
    const s = lastfm;
    if (!s) return "…";
    if (!s.available) return "Last.fm is not in this build";
    if (s.reconnect) return "Last.fm needs you to connect again, in the title menu › Account. Your plays wait";
    if (!s.connected) return "Not connected. Connect in the title menu › Account";
    const waiting = s.waiting ? ` · ${s.waiting} waiting to send` : "";
    return `Connected as ${s.name}${waiting}`;
  };
  // ── Song of the Day (docs/integrations/DeetsOTD.md §8.4) ──
  // The five Rust-owned rows and the outlet states are read live from sotd.ts, which already
  // mirrors them and redraws this card when they change — so the card caches nothing of its own.
  const on = () => sotdSettings().sotd;
  const outletOf = (name: string) => outletStatuses().find((o) => o.outlet === name);
  let hookOpen = false; // the paste field is showing
  let hookDraft = "";
  let hookSay = ""; // what the check answered, under the field
  let hookBusy = false;

  /** Write one Rust-owned Song of the Day row, then let sotd.ts tell every card. */
  const setRust = (cmd: string, args: Record<string, unknown>) => {
    invoke(cmd, args)
      .then(() => refreshSotdSettings())
      .catch((e) => {
        console.error(`[settings] ${cmd}`, e);
        toast({ kind: "warn", text: "Couldn't save that." });
      });
  };

  /** Check the pasted webhook and store it. It posts nothing. */
  const checkHook = () => {
    if (hookBusy) return;
    if (!hookDraft.trim()) {
      hookSay = "Paste the webhook link first.";
      render();
      return;
    }
    hookBusy = true;
    hookSay = "Asking Discord…";
    render();
    invoke("outlet_connect", { outlet: "discord", input: hookDraft.trim() })
      .then(() => {
        hookOpen = false;
        hookDraft = "";
        hookSay = "";
        return refreshSotdSettings();
      })
      .catch((e) => {
        hookSay = String(e);
      })
      .finally(() => {
        hookBusy = false;
        render();
      });
  };

  const discordHalves = (): Half[] => {
    const c = outletOf("discord");
    const halves: Half[] = [
      {
        type: "action",
        get label() {
          return hookOpen ? (hookBusy ? "Checking" : "Check") : c?.connected ? "Change" : "Set up";
        },
        hint: "Asks Discord what the webhook is. It posts nothing",
        run: () => {
          if (hookOpen) checkHook();
          else {
            hookOpen = true;
            hookSay = "";
            render();
          }
        },
      },
    ];
    if (c?.connected) {
      halves.push({
        type: "action",
        label: "Remove",
        hint: "Forgets the webhook here. Delete it in Discord to stop it working",
        run: () => {
          invoke("outlet_disconnect", { outlet: "discord" })
            .then(() => refreshSotdSettings())
            .catch((e) => console.error("[settings] outlet disconnect", e));
        },
      });
      halves.push({
        type: "toggle",
        get: () => !!c.on,
        set: (o) => {
          invoke("outlet_set_on", { outlet: "discord", on: o })
            .then(() => refreshSotdSettings())
            .catch((e) => console.error("[settings] outlet on", e));
        },
      });
    }
    return halves;
  };

  // What has left the app (docs/integrations/DeetsOTD.md §10.7). A user-facing record, in the My-reports
  // idiom: a bordered group with a heading and a Copy square. It holds names and states only
  // — never a webhook link, a token or a message id.
  let postRecords: PostRecord[] = [];
  // It scrolls at five rows (owner, 2026-09-18), so every record can be in the DOM; the cap
  // is only there to keep a years-old journal from building thousands of rows at once.
  const LOG_CAP = 200;
  const loadPostLog = () =>
    void postLog()
      .then((rs) => {
        postRecords = rs;
        if (alive) render();
      })
      .catch((e) => console.warn("[settings] post log", e));

  const postLogHTML = (): string => {
    if (!on()) return "";
    if (!postRecords.length) {
      return `<div class="set__status">Nothing has been posted from this PC yet.</div>`;
    }
    // One row per send, in the My-reports row shape: the song and its state as a tag, the
    // time as a second tag, the outlet and any reason in the row's own hover hint, and
    // Withdraw as a `set__half` where there is really something to pull.
    const rows = postRecords
      .slice(0, LOG_CAP)
      .map((r) => {
        const when = r.at ? new Date(r.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
        const tip = `${outletName(r.outlet)} · ${r.at ? new Date(r.at).toLocaleString() : "no time recorded"}${r.error ? ` · ${r.error}` : ""}`;
        const pull =
          r.state === "sent"
            ? `<div class="set__split"><button class="set__half" type="button" data-withdraw-log="${r.pickId}" ` +
              `title="Takes the post down. Your pick stays">Withdraw</button></div>`
            : "";
        return (
          `<div class="set__row set__row--choice" title="${esc(tip)}">` +
          `<span class="set__label">${esc(r.title)}<span class="set__tag">${esc(STATE_WORD[r.state] ?? r.state)}</span>` +
          `<span class="set__tag">${esc(when)}</span></span>${pull}</div>`
        );
      })
      .join("");
    const count = `<span class="set__tag">${postRecords.length}</span>`;
    return (
      `<div class="set__group"><div class="set__group-head"><span>What has left this PC${count}</span>` +
      `<button class="panel__action" type="button" data-sotd-copy aria-label="Copy this record" ` +
      `title="Copies every line to the clipboard, newest first">` +
      `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect>` +
      `<path d="M5 15V5a2 2 0 0 1 2-2h8"></path></svg></button></div>` +
      `<div class="set__group-scroll app-scroll">${rows}</div></div>`
    );
  };

  /** The one status line under the section. Never the webhook link: it is a credential. */
  const discordLine = (): string => {
    if (!on()) return "Off. Your picks and your webhook are kept";
    const c = outletOf("discord");
    if (!c?.connected) return "Discord: not set up. Your picks stay on this PC";
    if (c.error) {
      const gone = c.error.includes("no longer exists");
      return gone ? "Discord: the webhook no longer exists. Set it up again" : `Discord: the last post failed: ${c.error}`;
    }
    const place = c.whereTo ? `the “${c.whereTo}” webhook` : "your channel";
    return c.on ? `Discord: posts through ${place}` : `Discord: set up, but turned off`;
  };

  let setupClient = "claude-code"; // the app "Copy setup for" copies for
  let older: OlderVersion[] = []; // Roll back's menu (updater.ts, one request per session)
  let rollTarget = "";
  let alive = true; // the versions request can answer after the card is gone

  const flash = (el: HTMLElement, text: string) => {
    const was = el.textContent;
    el.textContent = text;
    window.setTimeout(() => (el.textContent = was), 1200);
  };
  // ── Window › the open sizes (FUTURE-SETTINGS §8a): a W × H menu and Set current ──
  // The open size is the size a view's own button (and the tray, and the launch) sets.
  const SIZE_PRESETS: Record<SizeSlot, string[]> = {
    mini: ["385x550", "420x620", "455x700"],
    player: ["405x675", "460x720", "540x800"],
    midi: ["495x670", "540x780", "600x900"],
    // 2026-09-17 (STAGE-COLUMN.md §5): 1100 × 950 is the default — the first height at which
    // EVERY skin shows the full-width square cover AND the Queue's 2.5 rows (Press needs 948),
    // and it still fits a 1920 × 1080 work area. 1400 × 1000 is the wide option that also fits
    // 1080p; 960 × 700 stays as the compact one, where the cover shrinks (still square).
    max: ["960x750", "1100x950", "1400x1000"],
  };
  const sizeLabel = (v: string) => v.replace("x", " × ");
  const sizeRow = (id: string, label: string, hint: string, slot: SizeSlot): Row => {
    const key = SIZE_KEYS[slot];
    return {
      kind: "split", id, label,
      hint: () => hint,
      halves: [
        {
          type: "menu",
          // A size saved by Set current that is not one of the three leads the list.
          get options() {
            const cur = setting(key);
            const presets = SIZE_PRESETS[slot];
            return (presets.includes(cur) ? presets : [cur, ...presets]).map((v) => ({ value: v, label: sizeLabel(v) }));
          },
          get: () => setting(key),
          set: (v) => setSetting(key, v),
        },
        {
          type: "action", label: "Set current", hint: "Saves the size this view has now, or had last",
          run: (el) => {
            // The view on screen, or the size it had earlier in this session. The Settings
            // card cannot be open while NP shows, so its row reads the remembered one.
            const v = sizeSeen(slot);
            if (!v) return flash(el, "Open it first");
            setSetting(key, v); // the card re-renders; the menu shows the new size
          },
        },
      ],
    };
  };
  const versionLabel = () => `Version ${versionText()}`.trim();
  const copyFrom = (el: HTMLElement, text: Promise<string>) =>
    text.then((t) => navigator.clipboard.writeText(t).then(() => flash(el, "Copied"), () => console.log(t)));

  // ── Bugs › the report form (src-tauri/src/report.rs, LOGGING.md §The report form) ──
  // The card re-renders on any setting change, so the typed text lives here, not in the DOM.
  interface ReportView {
    code: string;
    kind: string;
    title: string;
    at: number;
    url: string;
    state?: string | null; // at the last Refresh
    newReply?: boolean;
  }
  // The worker's post states as My reports shows them ("gone": the post no longer exists).
  const STATE_LABEL: Record<string, string> = {
    new: "New", open: "Open", planned: "Planned", fixed: "Fixed", wontfix: "Won't fix", closed: "Closed", gone: "Removed",
  };
  let refreshing = false;
  let closeArmed: string | null = null; // Close → "Sure?" → sends; disarms after CLOSE_ARM_MS
  let closeTimer = 0;
  const CLOSE_ARM_MS = 3000;
  // Refresh is the only request My reports makes (TOASTS.md §5: its failures are warn toasts).
  const refreshReports = async () => {
    if (refreshing) return;
    refreshing = true;
    render();
    try {
      reports = await invoke<ReportView[]>("report_refresh");
    } catch (e) {
      toast({ kind: "warn", text: String(e) });
    } finally {
      refreshing = false;
      if (alive) render();
    }
  };
  const closeReport = async (code: string) => {
    window.clearTimeout(closeTimer);
    if (closeArmed !== code) {
      closeArmed = code;
      closeTimer = window.setTimeout(() => {
        closeArmed = null;
        if (alive) render();
      }, CLOSE_ARM_MS);
      render();
      return;
    }
    closeArmed = null;
    try {
      reports = await invoke<ReportView[]>("report_close", { code });
    } catch (e) {
      toast({ kind: "warn", text: String(e) });
    }
    if (alive) render();
  };
  const REPORT_AREAS: Option[] = [
    { value: "playback", label: "Playback" },
    { value: "signin", label: "Sign-in" },
    { value: "library", label: "Library or playlists" },
    { value: "airplay", label: "AirPlay" },
    { value: "updates", label: "Updates" },
    { value: "other", label: "Something else" },
  ];
  const TITLE_WORDS = 10; // the worker's cap
  const draft = { title: "", body: "", area: "other", attach: true };
  let preview: string | null = null; // the log text on show — and the text a bug sends — while open
  let reportStatus = "";
  let sentUrl = "";
  let sending = false;
  let reports: ReportView[] = []; // My reports: report.rs keeps them in reports.json
  const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

  // Flush first, so the front end's last events are in the file the tail is cut from.
  const logFor = async (area: string): Promise<string> => {
    await diag.flush();
    return invoke<string>("report_log", { area });
  };
  const loadPreview = async () => {
    preview = await logFor(draft.area).catch(() => "");
    if (alive) render();
  };
  // Repainted in place, so a message never rebuilds the fields under the cursor.
  const paintReport = () => {
    const el = body.querySelector<HTMLElement>("#set-report-status");
    if (!el) return;
    el.hidden = !reportStatus;
    el.innerHTML = esc(reportStatus) + (sentUrl ? ` <span class="set__link">${esc(sentUrl)}</span>` : "");
  };
  const say = (text: string, url = "") => {
    reportStatus = text;
    sentUrl = url;
    paintReport();
  };

  const sendReport = async (kind: "issue" | "suggestion") => {
    if (sending) return;
    if (!draft.title.trim()) return say("Add a title.");
    if (words(draft.title) > TITLE_WORDS) return say(`Keep the title to ${TITLE_WORDS} words or fewer.`);
    if (!draft.body.trim()) return say("Add the details.");
    sending = true;
    say(kind === "issue" ? "Sending the bug…" : "Sending the suggestion…");
    try {
      // The text the user saw in Preview; without Preview, the same cut taken now.
      const log = kind === "issue" && draft.attach ? (preview ?? (await logFor(draft.area))) : null;
      const r = await invoke<ReportView>("report_send", { kind, title: draft.title, body: draft.body, log });
      reports = [r, ...reports.filter((x) => x.code !== r.code)];
      draft.title = "";
      draft.body = "";
      preview = null;
      reportStatus = "Sent. Keep this link. It is the only way back to your report:";
      sentUrl = r.url;
      if (alive) render();
      // TOASTS.md §5: sticky with an action, so it shows under every tier. Never the link in
      // the text: toast text reaches the log, and the code is a credential.
      toast({
        kind: "success",
        sticky: true,
        text: `${kind === "issue" ? "Bug" : "Suggestion"} sent. Copy the link to find it again.`,
        actions: [{ label: "Copy link", run: () => void copyLink(r.url) }],
      });
    } catch (e) {
      say(String(e));
    } finally {
      sending = false;
    }
  };

  // Settings › Reset: Reset asks first (Confirm / Cancel); a confirmed reset offers Undo.
  // The snapshot is taken at Confirm, so a change made while the question showed is undone too.
  let resetAsk: ToastHandle | null = null;
  const RESET_UNDO_MS = 6000;
  const resetRow = (label: string, hint: string, groups: ResetGroup[], id: string, nest?: "group" | "sub"): Row => ({
    kind: "split", id, label, group: nest === "group", sub: nest === "sub",
    hint: () => hint,
    halves: [
      {
        type: "action", label: "Reset", hint: "Asks first. You can undo it after",
        run: (el) => {
          if (sameSnapshot(snapshotOf(groups), defaultsOf(groups))) return flash(el, "Default");
          resetAsk?.dismiss();
          resetAsk = toast({
            kind: "info",
            sticky: true,
            text: `Reset ${label} to the defaults?`,
            actions: [
              {
                label: "Confirm",
                run: () => {
                  resetAsk = null;
                  const before = snapshotOf(groups);
                  applySnapshot(defaultsOf(groups));
                  toast({
                    kind: "success",
                    text: `${label} reset to the defaults.`,
                    timeout: RESET_UNDO_MS,
                    actions: [{ label: "Undo", run: () => applySnapshot(before) }],
                  });
                },
              },
              { label: "Cancel", run: () => (resetAsk = null) },
            ],
          });
        },
      },
    ],
  });

  // Settings › Reset: the orders you set by hand (MOVABLE-ROWS.md §4.4, fork 7 = Reset
  // groups + a toast, the owner 2026-09-20). It is not a settings key, so it cannot ride
  // RESET_GROUPS' snapshot — it asks and undoes in the same shape instead.
  const orderResetRow: Row = {
    kind: "split", id: "reset-roworder", label: "Row order",
    hint: () => "Every section you moved by hand — in Settings, Home, Radio and Playlists — and the order of your pinned items",
    halves: [
      {
        type: "action", label: "Reset", hint: "Asks first. You can undo it after",
        run: (el) => {
          if (!orderedScopes().length) return flash(el, "Default");
          resetAsk?.dismiss();
          resetAsk = toast({
            kind: "info",
            sticky: true,
            text: "Put every row and section back in its built-in order?",
            actions: [
              {
                label: "Confirm",
                run: () => {
                  resetAsk = null;
                  const before = snapshotOrders();
                  void resetOrder();
                  toast({
                    kind: "success",
                    text: "Row order reset to the built-in order.",
                    timeout: RESET_UNDO_MS,
                    actions: [{ label: "Undo", run: () => void restoreOrders(before) }],
                  });
                },
              },
              { label: "Cancel", run: () => (resetAsk = null) },
            ],
          });
        },
      },
    ],
  };

  const sections: Section[] = [
    // Labels: one short active statement each; the hint (hover) only where a word is
    // missing. Section names are the shortest noun that groups the rows.
    {
      // Tips (2026-09-15): the gestures nothing on screen announces — right-click, drag,
      // the title menu, hover. Static text in the row shape; no controls, no count badge.
      title: "Tips",
      rows: [
        {
          // The first-run walk again (ONBOARDING.md §4). A user who skipped it, or who read
          // it before the library had loaded, has no other way back: `onboardingStep` is 0
          // and nothing on screen offers the sprites.
          kind: "split", id: "tour", label: "Show the tour again",
          hint: () => "Deets and Happy walk you through the app, the way they did on the first launch",
          halves: [
            {
              type: "action", label: "Show",
              run: () => void restartWalk(),
            },
          ],
        },
      ],
      tail: () =>
        TIPS.filter(([what]) => what !== TIP_CLOSE || minimizeToTray)
          .map(([what, how]) => `<div class="set__tip"><span class="set__label">${esc(what)}</span><span class="set__tip-what">${esc(how)}</span></div>`)
          .join(""),
    },
    {
      // Window (Settings regroup 2026-09-18, fork 1C + 4A): ONE fold, three sub-headings.
      // Nine of its rows are about cards, not the window — the groups say so out loud.
      title: "Window",
      rows: [
        headRow("g-window", "Window"),
        {
          kind: "toggle",
          id: "tray",
          label: "Close to tray",
          hint: () => "× hides the window. The tray icon opens it again",
          get: () => minimizeToTray,
          set: (on) => {
            minimizeToTray = on;
            invoke("settings_set_minimize_to_tray", { on }).catch((e) => console.error("[settings] tray", e));
          },
        },
        {
          kind: "choice", id: "trayview", label: "Tray icon opens", key: "trayView",
          hint: "A click on the tray icon. Player: Now Playing only",
          options: [{ value: "cards", label: "Mini" }, { value: "player", label: "Player" }],
        },
        {
          kind: "toggle",
          id: "autostart",
          label: "Start with Windows",
          hint: () => "Starts in the tray at sign-in",
          get: () => autostart,
          set: (on) => {
            autostart = on;
            invoke<boolean>("autostart_set", { on })
              .then((v) => { autostart = v; render(); })
              .catch((e) => console.error("[settings] autostart", e));
          },
        },
        storeToggle("autoflip", "Resize changes surface", "surfaceAutoFlip", () => "On: a window made narrow or short becomes the surface that fits it. Off: the window resizes inside the current surface, and each one keeps its own floor"),
        storeToggle("volshrink", "Shrink volume bar", "volumeShrink", () => "On: a small pill in the title bar that grows when you click it, or hover, as the menus open. A window thinner than 455 px uses the small pill anyway"),
        {
          kind: "choice", id: "aot", label: "Keep on top", key: "alwaysOnTop",
          hint: "The window stays above other windows. Player: only while it shows the player",
          options: [{ value: "always", label: "Always" }, { value: "player", label: "Player" }, { value: "off", label: "Off" }],
        },
        headRow("g-sizes", "Window sizes"),
        sizeRow("sizemini", "Mini opens at", "The window size for Mini. Set current saves the size it has now or had last", "mini"),
        sizeRow("sizeplayer", "Player opens at", "The window size for Player, the player alone. Set current saves the size it had last", "player"),
        sizeRow("sizemidi", "Midi opens at", "The window size for Midi. Set current saves the size it has now or had last", "midi"),
        sizeRow("sizemax", "Max opens at", "The window size for Max. Set current saves the size it has now or had last", "max"),
        {
          kind: "choice", id: "maxshort", label: "Max window when short", key: "maxShortWindow",
          hint: "Max needs height for the album cover and the queue rows. Dragged under 745 px tall it becomes Midi, or it stops there. Becomes Midi needs Resize changes surface on",
          options: [{ value: "flip", label: "Becomes Midi" }, { value: "floor", label: "Stops at floor" }],
        },
        // ── Card grow (CARD-GROW.md §8) + card memory (CARD-MEMORY.md §7) ──
        // `Compass closes on outside click` left this group on 2026-09-18: it is neither a
        // window nor a card, only another outside-click rule. It is now under
        // Menus, hints and notices.
        headRow("g-cards", "Growing and drilling"),
        storeToggle("cardgrow", "Grow cards from edges", "cardGrow", () => "Click the gap beside a card to open it over its neighbor. Hover a card's title for the button"),
        storeToggle("cardgrowoutside", "Collapse on outside click", "cardGrowOutside", () => "A click outside a grown card collapses it. Pin holds it open"),
        {
          kind: "choice", id: "cardgrowpick", label: "Grown card on a new pick", key: "cardGrowPick",
          hint: "Pick another card in a grown card's title: it keeps the size, or collapses first",
          options: [{ value: "keep", label: "Keeps size" }, { value: "collapse", label: "Collapses" }],
        },
        {
          kind: "choice", id: "cardgrowview", label: "Keep view when grown", key: "cardGrowView",
          hint: "A card that grows keeps the view you are in; the tile size still follows the card's size",
          options: [{ value: "keep", label: "Keep" }, { value: "size", label: "Per size" }],
        },
        {
          kind: "choice", id: "carddrill", label: "Card on drill", key: "cardDrill",
          hint: "A drill opens in the card you are reading, and Back returns it; or it is summoned into another slot",
          options: [{ value: "inplace", label: "In place" }, { value: "summon", label: "Summon" }],
        },
        storeToggle("carddrillbring", "Bring a card already open", "cardDrillBring", () => "A drill whose card is already on screen: bring it to the card you are reading, or open it where it sits"),
        storeToggle("cardmemorydisk", "Keep card places on restart", "cardMemoryDisk", () => "Opens each card where you left it, also after you restart DeetsMusic"),
        // Movable rows (MOVABLE-ROWS.md fork 6). The row is here, beside the other
        // card-shape gestures, and not under Playback: it changes how a card is arranged.
        storeToggle("movesections", "Move sections by holding", "moveSections", () => "Hold a section header for a moment, then drag it where you want it. A click still opens and closes the section. New sections appear at the end"),
      ],
    },
    // Look and feel became four sections on 2026-09-18 (fork 1C). RESET_GROUPS had split it
    // this way for months; only the card disagreed. The names match the Reset rows exactly.
    {
      title: "Look schedule",
      tail: () => (scheduled() ? `<div class="set__status" id="set-look-status" aria-live="polite"></div>` : ""),
      rows: [
        {
          kind: "choice", id: "lookschedule", label: "Change look at", key: "lookSchedule",
          hint: "Changes between a day look and a night look. Sun times come from your time zone, not your location",
          options: [
            { value: "sun", label: "Sunrise and sunset" }, { value: "clock", label: "Set times" },
            { value: "windows", label: "Windows mode" }, { value: "off", label: "Off" },
          ],
        },
        {
          kind: "split", id: "lookday", label: "Day look", when: scheduled,
          hint: () => "The theme and skin for the day",
          halves: [storeMenu("dayTheme", THEME_OPTIONS), storeMenu("daySkin", SKIN_OPTIONS)],
        },
        {
          kind: "split", id: "looknight", label: "Night look", when: scheduled,
          hint: () => "The theme and skin for the night",
          halves: [storeMenu("nightTheme", THEME_OPTIONS), storeMenu("nightSkin", SKIN_OPTIONS)],
        },
        {
          kind: "split", id: "looktimes", label: "Day runs", when: () => setting("lookSchedule") === "clock",
          hint: () => "From the first time to the second. The night look shows at all other times",
          halves: [storeMenu("dayStart", timeOptions(4 * 60, 12 * 60)), storeMenu("nightStart", timeOptions(15 * 60, 23 * 60 + 30))],
        },
        {
          kind: "choice", id: "sunshift", label: "Shift sun times", key: "sunShift", when: () => setting("lookSchedule") === "sun",
          hint: "Moves sunrise and sunset. Use it when the look changes too early or too late where you are",
          get: () => String(setting("sunShift")),
          set: (v) => setSetting("sunShift", Number(v)),
          options: [-60, -45, -30, -15, 0, 15, 30, 45, 60].map((v) => ({
            value: String(v),
            label: v === 0 ? "None" : `${v > 0 ? "+" : "−"}${Math.abs(v)} min`,
          })),
        },
        {
          kind: "choice", id: "lookhold", label: "Menu pick lasts", key: "lookHold", when: scheduled,
          hint: "A theme or skin you pick from the title menu while the schedule is on. For good: the schedule turns off",
          options: [{ value: "next", label: "Until next change" }, { value: "always", label: "For good" }],
        },
      ],
    },
    {
      title: "Motion",
      rows: [
        storeToggle("motion", "Animate look changes", "appearanceMotion", () => "Theme and skin changes play the launch animation. Off: they change at once"),
        storeToggle("cardswap", "Animate card swaps", "cardSwapMotion", () => "Cards move to their new places in the skin's own motion. Off: they change at once"),
        storeToggle("fancyscrub", "Fancy scrubber", "fancyScrubber", () => "Each skin's own playhead: the Press nib, the Ocean float, the Glass lens, the charged bolt. Off: a plain handle"),
        {
          kind: "choice", id: "bgmotion", label: "Animate backgrounds", key: "backgroundMotion",
          hint: "The moving Ocean, Glass, and Cyber backgrounds. Reduced: fewer updates, less CPU. Off: they hold still",
          options: [{ value: "on", label: "On" }, { value: "reduced", label: "Reduced" }, { value: "off", label: "Off" }],
        },
      ],
    },
    {
      // Every row here is gated on one skin, so the whole section is not drawn under a skin
      // that sets nothing (Cyber today).
      title: "Skin settings",
      rows: [
        {
          kind: "choice", id: "oceanedges", label: "Draw card edges", key: "oceanEdges",
          hint: "Ocean only. Sand: the card edges break into grains, like a dark beach",
          options: [{ value: "sand", label: "Sand" }, { value: "soft", label: "Soft" }],
          when: () => currentSkin() === "ocean",
        },
        {
          kind: "range", id: "oceansand", label: "Sand width", key: "oceanSand", min: 0, max: 100, unit: "%",
          hint: "Ocean only. How far the sand reaches into each card",
          preview: (v) => previewSkin("oceanSand", v),
          when: () => currentSkin() === "ocean" && setting("oceanEdges") === "sand",
        },
        // Glass: Fancy Glass first (it shows the sliders), then the layers in paint order, back
        // to front — the background (glow, then its dim), then the card (backlight, then tint).
        {
          ...storeToggle("glassfancy", "Fancy Glass", "glassFancy", () => GLASS_FANCY_HINT),
          when: () => currentSkin() === "glass",
        },
        {
          kind: "range", id: "glasscanvas", label: "Canvas glow", key: "glassCanvasGlow", min: 0, max: 100, unit: "%",
          hint: "Glass only. How brightly the colors glow on the background. The cards do not change",
          preview: (v) => previewSkin("glassCanvasGlow", v),
          when: glassSliders,
        },
        {
          kind: "range", id: "glassdim", label: "Dim canvas", key: "glassCanvasDim", min: 0, max: 100, unit: "%",
          hint: "Glass only. Darkens the space between the cards. The cards stay as bright",
          preview: (v) => previewSkin("glassCanvasDim", v),
          when: glassSliders,
        },
        {
          kind: "range", id: "glassbacklight", label: "Backlight", key: "glassBacklight", min: 0, max: 100, unit: "%",
          hint: "Glass only. A light behind each card, under its tint",
          preview: (v) => previewSkin("glassBacklight", v),
          when: glassSliders,
        },
        {
          kind: "range", id: "glasstint", label: "Tint cards", key: "glassTint", min: 0, max: 100, unit: "%",
          hint: "Glass only. The card color over the backlight. Less tint: more glow",
          preview: (v) => previewSkin("glassTint", v),
          when: glassSliders,
        },
        {
          kind: "choice", id: "pressvinyl", label: "Record player", key: "pressVinyl",
          hint: "Press only. The cover becomes a record. Spin: it turns while music plays",
          options: [{ value: "spin", label: "Spin" }, { value: "still", label: "Still" }, { value: "off", label: "Off" }],
          when: () => currentSkin() === "press",
        },
        {
          kind: "choice", id: "pressvinylwhere", label: "Show record on", key: "pressVinylWhere", menu: true,
          hint: "Press only. Stage: the big cover in max and the player view. Everywhere adds the tray panel",
          options: [{ value: "stage", label: "Stage" }, { value: "card", label: "Stage + card" }, { value: "everywhere", label: "Everywhere" }],
          when: () => currentSkin() === "press" && setting("pressVinyl") !== "off",
        },
        {
          kind: "choice", id: "pressvinylspeed", label: "Spin speed", key: "pressVinylSpeed",
          hint: "Press only. How fast the record turns, in turns each minute. 33⅓ is an LP, 45 a single",
          options: [{ value: "33", label: "33⅓" }, { value: "45", label: "45" }, { value: "78", label: "78" }],
          when: () => currentSkin() === "press" && setting("pressVinyl") === "spin",
        },
        {
          kind: "toggle", id: "pressvinylplate", label: "Show record plate", key: "pressVinylPlate",
          hint: () => "Press only. The offset ink behind the record. Off: only the record, a little larger",
          get: () => setting("pressVinylPlate"),
          set: (on) => setSetting("pressVinylPlate", on),
          when: () => currentSkin() === "press" && setting("pressVinyl") !== "off",
        },
      ],
    },
    {
      title: "Menus, hints and notices",
      rows: [
        {
          kind: "toggle",
          id: "hover",
          label: "Open menus on hover",
          get: () => setting("menuMode") === "hover",
          set: (on) => setSetting("menuMode", on ? "hover" : "click"),
        },
        {
          kind: "toggle",
          id: "hints",
          key: "hoverHints",
          label: "Show hover hints",
          hint: () => "Rest the pointer on a control and a small box says what it does",
          get: () => setting("hoverHints"),
          set: (on) => setSetting("hoverHints", on),
        },
        {
          kind: "choice", id: "hintdelay", label: "Hints appear after", key: "hoverHintDelay",
          hint: "How long the pointer rests first. A song row always waits a little longer than a button",
          options: [{ value: "quick", label: "A moment" }, { value: "normal", label: "A pause" }, { value: "slow", label: "A while" }],
          when: () => setting("hoverHints"),
        },
        {
          kind: "choice", id: "hintsongs", label: "Name songs on hover", key: "hoverSongNames",
          hint: "The box gives the full song and artist on a row. Cut off: it stays quiet when the name already fits",
          options: [{ value: "always", label: "Always" }, { value: "cut", label: "Cut off" }, { value: "off", label: "Never" }],
          when: () => setting("hoverHints"),
        },
        {
          kind: "choice", id: "toasts", label: "Show notices", key: "toasts",
          hint: "Everything: confirmations too. Failures: only when an action couldn't do what it said",
          options: [{ value: "all", label: "Everything" }, { value: "failures", label: "Failures" }],
        },
        // From Window, 2026-09-18: it is an outside-click rule, not a window rule.
        storeToggle("compassaway", "Compass closes on outside click", "compassCloseAway", () => "A click outside the Ctrl+Space bar closes it. Off: only Ctrl+Space, Escape, the compass button, or a pick closes it"),
      ],
    },
    {
      // The Home card (HOME.md §4, §9, §10). The hide rows, and the one switch that
      // turns off every Apple call Home makes.
      title: "Home",
      rows: [
        storeToggle(
          "homeapple",
          "Follow your other devices",
          "homeApple",
          () => "Home asks Apple what you played and added elsewhere, and what your artists released",
        ),
        {
          kind: "choice", id: "homehide", label: "Hiding lasts", key: "homeHideLasts",
          hint: "Right-click a Home tile and Hide to take it off the card",
          options: [{ value: "forever", label: "Until cleared" }, { value: "session", label: "This session" }],
        },
        {
          kind: "split", id: "homehidden", label: "Hidden tiles",
          hint: () => "Puts every hidden tile back on Home. Playing one again also brings it back",
          halves: [
            {
              type: "action",
              label: "Clear",
              run: () => {
                clearHidden();
                render();
              },
            },
          ],
        },
      ],
      tail: () => {
        const n = hiddenCount();
        return `<div class="set__status">${n === 0 ? "Nothing hidden on Home" : `${n} tile${n === 1 ? "" : "s"} hidden on Home`}</div>`;
      },
    },
    {
      title: "Playback",
      rows: [
        {
          kind: "choice", id: "streamquality", label: "Stream quality", key: "streamQuality",
          hint: "Auto follows your network speed; High is 256 kbps and Low is 64 kbps, from the next song",
          options: [{ value: "auto", label: "Auto" }, { value: "high", label: "High" }, { value: "low", label: "Low" }],
        },
        {
          kind: "choice", id: "playnow", label: "Play Now plays", key: "playNowScope",
          hint: "The right-click action",
          options: [{ value: "song", label: "Song only" }, { value: "list", label: "Song and rest of list" }],
        },
        {
          kind: "choice", id: "pinnewact", label: "New pins open on click", key: "pinNewAct",
          hint: "The verb a new pin starts with. Change any pin with its own On Click row. Songs and stations are played on click",
          options: [{ value: "open", label: "Open" }, { value: "play", label: "Play" }, { value: "shuffle", label: "Shuffle" }],
        },
        {
          kind: "choice", id: "dropplay", label: "Drop on Now Playing", key: "dropPlayQueue",
          hint: "Songs dragged onto Now Playing play at once; Up Next can stay after them",
          options: [{ value: "keep", label: "Keep Up Next" }, { value: "replace", label: "Replace it" }],
        },
        {
          kind: "choice", id: "previous", label: "Previous rewinds", key: "previousReach",
          hint: "The list: the songs above the one you clicked",
          options: [{ value: "lookback", label: "The list" }, { value: "heard", label: "Played songs" }],
        },
        {
          kind: "choice", id: "restorequeue", label: "Restore on launch", key: "restoreQueue",
          hint: "Last song shows in Now Playing, paused; Up Next parks it at the top of the queue",
          options: [{ value: "song", label: "Last song" }, { value: "queue", label: "Up Next" }, { value: "off", label: "Nothing" }],
        },
        {
          kind: "toggle", id: "shufflestays", label: "Shuffle button stays on", key: "shuffleStays",
          hint: () => "The Shuffle button turns shuffle on until you press it again. Off: it shuffles Up Next once",
          get: () => setting("shuffleStays"),
          set: (on) => setSetting("shuffleStays", on),
        },
        {
          kind: "choice", id: "shufflemanual", label: "Shuffle keeps picks", key: "shuffleManual",
          hint: "Where songs you queued by hand land",
          options: [{ value: "top", label: "First" }, { value: "hold", label: "In place" }, { value: "mix", label: "Mixed" }],
        },
        {
          kind: "choice", id: "shuffleidle", label: "Idle shuffle plays", key: "shuffleIdle",
          hint: "Shuffle with nothing playing",
          options: [{ value: "library", label: "Library" }, { value: "noop", label: "Nothing" }],
        },
        storeToggle("historyday", "Show the day in History", "historyShowDay", () => "Each row says Today, Yesterday or the date, next to the artist"),
      ],
    },
    {
      // Sound (SOUND.md; Settings regroup 2026-09-18, fork 2A). The Sound panel keeps the LIVE
      // controls — the two on/off switches, the three part switches, the curve, the presets and
      // the two Clear actions. The set-once preferences are here, which is the app's own rule
      // and what `agent-settings.ts` and Reset have said all along.
      title: "Sound",
      rows: [
        headRow("g-eq", "Equalizer"),
        {
          kind: "choice", id: "eqpreamp", label: "Avoid distortion", key: "soundEqPreamp",
          hint: "How a boost is kept from distorting. Limiter only turns down just the loudest moments; the others lower the whole song",
          options: [
            { value: "limiter", label: "Limiter only" }, { value: "needed", label: "When needed" },
            { value: "always", label: "Always" }, { value: "manual", label: "By hand" },
          ],
        },
        {
          kind: "range", id: "eqpreampdb", label: "Lower the song by", key: "soundEqPreampDb",
          min: -24, max: 6, unit: " dB", step: 0.5,
          hint: "By hand only. How much the song is turned down before the equalizer. The limiter catches anything left",
          preview: () => {}, // the graph reads the store; the release writes it
          when: () => setting("soundEqPreamp") === "manual",
        },
        storeToggle("eqperoutput", "Remember each output", "soundEqPerOutput", () => "On: headphones, speakers and AirPlay speakers each remember their own preset"),
        headRow("g-adaptive", "Adaptive sound"),
        {
          kind: "choice", id: "loudtarget", label: "Match songs to", key: "soundLoudTarget",
          hint: "How loud songs are made. Standard is Apple's Sound Check level (−16 LUFS), Louder is −14, Quieter is −18",
          get: () => String(setting("soundLoudTarget")),
          set: (v) => setSetting("soundLoudTarget", Number(v)),
          options: [{ value: "-16", label: "Standard" }, { value: "-14", label: "Louder" }, { value: "-18", label: "Quieter" }],
        },
        storeToggle("loudalbum", "Keep albums together", "soundLoudAlbum", () => "On: when you play an album in order, all its songs move by the same amount, so a quiet song stays quiet"),
        {
          kind: "choice", id: "loudunmeasured", label: "Songs not measured get", key: "soundLoudUnmeasured",
          hint: "A song is measured the first time you hear it. Until then: move it by your songs' usual amount, or leave it as it is",
          options: [{ value: "median", label: "Usual amount" }, { value: "none", label: "No change" }],
        },
        {
          kind: "choice", id: "lowvolkey", label: "Follow the volume of", key: "soundLowVolKey",
          hint: "App + Windows: counts the DeetsMusic volume and the Windows volume together",
          options: [{ value: "both", label: "App + Windows" }, { value: "app", label: "App only" }],
        },
        {
          kind: "choice", id: "crossfeedlevel", label: "Blend amount", key: "soundCrossfeedLevel",
          hint: "How much of each side goes into the other",
          options: [{ value: "light", label: "Light" }, { value: "medium", label: "Medium" }, { value: "strong", label: "Strong" }],
        },
        {
          kind: "choice", id: "soundreview", label: "Ask to keep after", key: "soundReviewDays",
          hint: "When to ask whether the effects are worth keeping, counted from the first time one was turned on",
          get: () => String(setting("soundReviewDays")),
          set: (v) => setSetting("soundReviewDays", Number(v)),
          options: [{ value: "3", label: "3 days" }, { value: "7", label: "7 days" }, { value: "14", label: "14 days" }, { value: "0", label: "Never" }],
        },
      ],
    },
    {
      // Sleep (NEXT-VERSION §17; Settings regroup 2026-09-18, fork 2A). The sleep panel keeps
      // the dial, the two end chips, Off and the status line — a running timer is a live thing.
      // The schedule and the wind-down are preferences, so they are here.
      title: "Sleep",
      rows: [
        {
          kind: "choice", id: "sleepsched", label: "Sleep every day", key: "sleepSchedule",
          hint: "Arms a sleep time every day. It pauses only if music is playing when the time comes",
          options: [{ value: "off", label: "Off" }, { value: "sun", label: "Sunset" }, { value: "clock", label: "At a time" }],
        },
        {
          kind: "choice", id: "sleepat", label: "Sleep at", key: "sleepAt", menu: true,
          hint: "The time the daily sleep timer runs out",
          options: timeOptions(0, 23 * 60 + 45, 15),
          when: () => setting("sleepSchedule") === "clock",
        },
        {
          kind: "choice", id: "sleepwind", label: "Wind down", key: "sleepWind",
          hint: "Over these last minutes the volume sinks to nothing, then the music pauses. Off: a plain pause at the time",
          get: () => String(setting("sleepWind")),
          set: (v) => setSetting("sleepWind", Number(v)),
          menu: true,
          options: [0, 1, 2, 5, 10, 15, 30].map((m) => ({ value: String(m), label: m ? `${m} min` : "Off" })),
        },
        storeToggle("sleepplayout", "Play out song", "sleepPlayOut", () => "The song that is playing when the time comes finishes first. Off: the time is the silence"),
      ],
    },
    {
      // AIRPLAY.md §7: the one preference. Never a live action (the Play on panel is that).
      title: "AirPlay",
      rows: [
        {
          kind: "choice", id: "airplaysend", label: "Send to speaker",
          hint: "DeetsMusic only: the speaker plays your music and this PC goes quiet. All PC sound: every app's sound, and this PC keeps playing",
          options: [{ value: "app", label: "DeetsMusic only" }, { value: "system", label: "All PC sound" }],
          get: () => airplayCapture,
          set: (v) => {
            airplayCapture = v as "app" | "system";
            invoke("settings_set_airplay_capture", { v }).catch((e) => console.error("[settings] airplay", e));
          },
        },
      ],
    },
    {
      // The two actions that write to the user's Apple account; Apple has no undo from here.
      // The one-time notices point here (requestSetting). The ♥ rides Add to Library's consent.
      title: "Apple Music",
      rows: [
        {
          kind: "toggle",
          id: "libraryadd",
          label: "Add to Library and ♥",
          hint: () => "Can't remove from library via DeetsMusic",
          get: () => libraryAddEnabled(),
          set: (on) => setLibraryAddEnabled(on),
        },
        storeToggle("addsquareowned", "Show ✓ on songs you have", "addSquareOwned", () => "On: the + on a song row turns into a ✓ when the song is already in your library. Off: no button"),
        storeToggle("playlistexport", "Export playlists", "playlistExport", () => "Can't rename, reorder, or delete on Apple Music via DeetsMusic"),
      ],
    },
    {
      // Last.fm (LASTFM.md §6). The connect lives in the title menu › Account, beside Apple
      // Music; these rows pause what a connected account receives.
      title: "Last.fm",
      tail: () => `<div class="set__status" id="set-lastfm-status">${esc(lastfmLine())}</div>`,
      rows: [
        {
          kind: "toggle",
          id: "lastfmscrobble",
          label: "Scrobble plays",
          hint: () => "Sends each song to your Last.fm profile once you hear half of it or 4 minutes",
          get: () => lastfmScrobble,
          set: (on) => {
            lastfmScrobble = on;
            invoke("settings_set_lastfm_scrobble", { on }).catch((e) => console.error("[settings] lastfm scrobble", e));
            render();
          },
        },
        {
          kind: "toggle",
          id: "lastfmnowplaying",
          label: "Show now playing",
          hint: () => "Your Last.fm profile shows the song while it plays",
          get: () => lastfmNowPlaying,
          set: (on) => {
            lastfmNowPlaying = on;
            invoke("settings_set_lastfm_now_playing", { on }).catch((e) => console.error("[settings] lastfm now playing", e));
            render();
          },
        },
      ],
    },
    // ── Sharing + Discord (FRIENDS.md §8.5.1) ──
    // Sharing holds the CONSENT, Discord holds the plumbing, and they sit beside the other
    // service sections. "Who can see what I play" is one decision, so its rows are adjacent
    // and the pause covers all of them (D11). Every switch here starts Off (§8.5.3).
    {
      title: "Sharing",
      tail: () => {
        const left = sharePauseLeft();
        if (left) return `<div class="set__status">Paused for another ${Math.max(1, Math.round(left / 60000))} min. Nothing is shared meanwhile.</div>`;
        const said: string[] = [];
        if (setting("shareActivityApp")) said.push("Your friends see what you play.");
        if (setting("shareActivityDiscord")) said.push("Your Discord profile shows the song, the artist, the album and a progress bar.");
        return said.length
          ? `<div class="set__status">${said.join(" ")}</div>`
          : `<div class="set__status">Nothing is shared. With these off, DeetsMusic never opens either connection at all.</div>`;
      },
      rows: [
        // The two "Share activity on …" rows are adjacent ON PURPOSE (§8.5.1): "who can
        // see what I play" is one decision with two answers, and a person must be able to
        // read both without leaving the row they are on.
        storeToggle(
          "shareApp",
          "Share activity on DeetsMusic",
          "shareActivityApp",
          () => "The friends you added see the song, the artist and the cover while you listen. Only people whose code you added, and who added yours",
        ),
        storeToggle(
          "shareDiscord",
          "Share activity on Discord",
          "shareActivityDiscord",
          () => "Your Discord profile reads “Listening to DeetsMusic” with the song under it. Needs the Discord app open on this PC, and its Activity Privacy switch on",
        ),
        {
          kind: "split", id: "sharepause",
          get label() {
            const left = sharePauseLeft();
            return left ? `Sharing paused · ${Math.max(1, Math.round(left / 60000))} min left` : "Pause sharing for an hour";
          },
          hint: () => "Stops every sharing row above at once, then turns them back on by itself. Your settings are kept",
          halves: [
            {
              type: "action",
              get label() {
                return sharePauseLeft() ? "Resume" : "Pause";
              },
              hint: "Takes effect at once",
              run: () => {
                if (sharePauseLeft()) setSetting("sharePauseUntil", 0);
                else pauseSharingForAnHour();
                render();
              },
            },
          ],
        },
      ],
    },
    {
      // Friends' own plumbing, beside Discord's, for the same reason: Sharing holds the
      // consent, a named section holds the connection (FRIENDS.md §8.5.1). The friend
      // LIST is not here — a list is not a setting, and it lives in the people panel.
      title: "Friends",
      tail: () =>
        `<div class="set__status">Your friend code is <b>${esc(formatFriendCode(friendsState().me))}</b>. ` +
        `A friend adds it, you add theirs, and then you can see each other — one code on its own shows nothing.</div>`,
      rows: [
        storeToggle(
          "friendslisten",
          "Let friends listen along",
          "friendsListenAlong",
          () =>
            "A friend presses your box and hears what you hear. It starts a room only they can listen in — they cannot skip, seek or change the queue. You get one notice when somebody joins",
        ),
        storeToggle(
          "friendsroominvite",
          "Put my room code on my box",
          "friendsRoomInvite",
          () =>
            "While you host a room, your friends' boxes carry its code so they can join it. The code is the only gate on a room, so this is its own switch",
        ),
        {
          // §2a, fork 1a-A. Moving to a new PC, and the warning that the key IS you. A
          // split row, the shape "Pause sharing for an hour" uses one section up.
          kind: "split", id: "friendskey", label: "Your key",
          hint: () =>
            "The key behind your friend code. Copy it to keep the same code on another PC. Anybody who has it can be you, so it goes nowhere but DeetsMusic",
          halves: [
            { type: "action", label: "Copy my key", hint: "Puts it on the clipboard, with a warning", run: () => copyMyKey() },
            { type: "action", label: "Paste a key", hint: "Replaces this PC's friend code with the key on the clipboard", run: () => pasteAKey() },
          ],
        },
      ],
    },
    {
      // The service section: the connection itself. The Song of the Day webhook moved here
      // on 2026-09-20 (M1/D9) — the same three controls, re-parented, with no change to
      // `outlet.rs`, `discord.rs` or the stored file.
      title: "Discord",
      rows: [
        {
          kind: "split", id: "sotddiscord", label: "Connect a Discord SOTD channel",
          hint: () => "One channel's webhook, used by Song of the Day. Anyone who has the link can post there",
          halves: discordHalves(),
        },
        {
          // The setup field and its steps. An html row, so the field keeps what is typed
          // while the card redraws around it (the report form's shape).
          kind: "html", id: "sotdhook",
          when: () => hookOpen,
          html: () =>
            `<div class="set__group">` +
            `<label class="set__field"><input class="set__input" data-sotd="hook" type="text" spellcheck="false" ` +
            `placeholder="Paste the webhook link" value="${esc(hookDraft)}" /></label>` +
            `<div class="set__status">In Discord: the channel's gear › Integrations › Webhooks › New Webhook › ` +
            `Copy Webhook URL. You need the Manage Webhooks permission. If you do not have it, ask a server admin to send you the link.</div>` +
            (hookSay ? `<div class="set__status">${esc(hookSay)}</div>` : "") +
            `</div>`,
        },
        {
          kind: "html", id: "sotdpostas",
          when: () => !!outletOf("discord")?.connected,
          html: () =>
            `<label class="set__field"><input class="set__input" data-sotd="postas" type="text" maxlength="80" ` +
            `placeholder="${esc(outletOf("discord")?.defaultName || "Post as")}" value="${esc(sotdSettings().sotdPostAs)}" /></label>`,
        },
        storeToggle(
          "discordroominvite",
          "Let my profile invite people to my room",
          "discordRoomInvite",
          () => "While you host a listening room, your Discord card carries a Listen Along button. The button holds the room code, so anyone who sees your profile can join",
        ),
        // The record of what has left the app. Last in the section: it is a thing you check,
        // not a thing you set.
        { kind: "html", id: "sotdlog", html: postLogHTML },
      ],
    },
    {
      title: "Playlists",
      rows: [
        storeToggle("eagercounts", "Show playlist counts", "playlistEagerCounts", () => "One small request per playlist, once"),
        storeToggle("autorefresh", "Refresh playlists by themselves", "playlistAutoRefresh", () => "Re-reads a playlist when you open it, and once a day. Each playlist keeps its own setting"),
        {
          kind: "choice", id: "createsummon", label: "New playlist opens Search", key: "playlistCreateSummon",
          hint: "Puts the Search card beside the new playlist. Mini shows one card, so Search would hide it",
          options: [{ value: "notmini", label: "Not in mini" }, { value: "always", label: "Always" }, { value: "off", label: "Never" }],
        },
        {
          kind: "choice", id: "npcover", label: "Cover while playing", key: "nowPlayingCover",
          hint: "For a song played from a playlist: the cover shown in Now Playing, in mini and in the tray panel",
          options: [{ value: "album", label: "Album" }, { value: "playlist", label: "Playlist" }],
        },
        {
          kind: "choice", id: "newcover", label: "New cover", key: "newPlaylistCover",
          hint: "How a new playlist's cover starts. Letters and Note keep the theme you made it in",
          options: [{ value: "letters", label: "Letters" }, { value: "mosaic", label: "Mosaic" }, { value: "note", label: "Note" }],
        },
        {
          kind: "choice", id: "webreach", label: "Web reach", key: "webReach",
          hint: "1 reaches the artist's collaborators. Each step reaches one circle further",
          get: () => String(setting("webReach")),
          set: (v) => setSetting("webReach", Number(v) as 1 | 2 | 3),
          options: [1, 2, 3].map((n) => ({ value: String(n), label: String(n) })),
        },
        {
          kind: "choice", id: "websize", label: "Web size", key: "webSize",
          hint: "Songs in a new web playlist",
          get: () => String(setting("webSize")),
          set: (v) => setSetting("webSize", Number(v) as 25 | 50 | 100),
          options: [25, 50, 100].map((n) => ({ value: String(n), label: String(n) })),
        },
        {
          kind: "choice", id: "webprefer", label: "Web prefers songs", key: "webPrefer",
          hint: "Familiar puts your songs first. Discover puts songs you don't have first",
          options: [{ value: "familiar", label: "Familiar" }, { value: "discover", label: "Discover" }, { value: "mix", label: "Mix" }],
        },
        {
          kind: "choice", id: "webseedfilter", label: "Web genre chips filter", key: "webSeedFilter",
          hint: "Web only leaves the artist's songs unfiltered. Keep 5 keeps at least five",
          options: [{ value: "all", label: "All songs" }, { value: "floor", label: "Keep 5" }, { value: "off", label: "Web only" }],
        },
        {
          kind: "choice", id: "webmakemotion", label: "Web panel closes", key: "webMakeMotion",
          hint: "Pop out closes the web panel at once while the artist flies to the playlist",
          options: [{ value: "shrink", label: "Shrink to chip" }, { value: "pop", label: "Pop out" }],
        },
      ],
    },
    {
      // What you played: the Rewind card, what counts as a play, and the weekly Replay (1B).
      title: "Rewind",
      rows: [
        storeToggle("rewind", "Rewind card", "rewindCard", () =>
          setting("rewindAutoShown") ? "Your listening, ranked" : "Shows after 50 plays",
        ),
        {
          kind: "choice", id: "fullplay", label: "Count a play at", key: "fullPlayRule",
          hint: "When a song counts as played through, for Rewind",
          options: [{ value: "fraction", label: "90%" }, { value: "end", label: "End" }, { value: "scrobble", label: "Half or 4 min" }],
        },
        {
          kind: "split", id: "replay", label: "Weekly Replay",
          hint: () => "A playlist of the past week's most-played songs, made on this day",
          halves: [
            {
              type: "menu",
              options: [
                { value: "mon", label: "Mon" }, { value: "tue", label: "Tue" }, { value: "wed", label: "Wed" }, { value: "thu", label: "Thu" },
                { value: "fri", label: "Fri" }, { value: "sat", label: "Sat" }, { value: "sun", label: "Sun" },
              ],
              get: () => setting("replayDay"),
              set: (v) => setSetting("replayDay", v as Settings["replayDay"]),
            },
            { type: "toggle", get: () => setting("replayAuto"), set: (on) => setSetting("replayAuto", on) },
          ],
        },
        storeToggle("replaykeep", "Keep every Replay", "replayKeep", () => "Each week gets its own dated playlist in a Replay folder. Off: one playlist, replaced weekly"),
      ],
    },
    {
      // Song of the Day (docs/integrations/DeetsOTD.md §8.4). The first row is the whole feature; every
      // other row shows only while it is on. Five of the six live in Rust (settings.rs) —
      // Rust is what enforces them, for an agent and for a timer with no window up.
      title: "Song of the Day",
      tail: () => `<div class="set__status" id="set-sotd-status">${esc(discordLine())}</div>`,
      rows: [
        {
          kind: "choice", id: "sotd", label: "Song of the Day", get: () => (sotdSettings().sotd ? "on" : "off"),
          hint: "Mark one song a day. With no outlet set up it stays on this PC and posts nothing",
          set: (v) => setRust("settings_set_sotd", { on: v === "on" }),
          options: [{ value: "on", label: "On" }, { value: "off", label: "Off" }],
        },
        { ...storeToggle("sotdsuggest", "Suggest today's pick", "sotdSuggest", () =>
          "Puts the song you played most today at the head of the Home shelf. You still choose",
        ), when: on },
        {
          kind: "choice", id: "sotdday", label: "Day starts at",
          hint: "A song marked before this hour counts for the day before",
          get: () => String(sotdSettings().sotdDayStart),
          set: (v) => setRust("settings_set_sotd_day_start", { hour: Number(v) }),
          options: [{ value: "0", label: "Midnight" }, { value: "5", label: "5 AM" }],
          when: on,
        },
        {
          kind: "choice", id: "sotdlimit", label: "Picks per day",
          hint: "At the limit, Mark becomes Replace Today's Pick",
          get: () => String(sotdSettings().sotdPicksPerDay),
          set: (v) => setRust("settings_set_sotd_picks_per_day", { n: Number(v) }),
          options: [{ value: "1", label: "1" }, { value: "2", label: "2" }, { value: "0", label: "No limit" }],
          when: on,
        },
        {
          kind: "choice", id: "sotdpost", label: "Post my picks", menu: true,
          hint: "When a marked song goes out to the outlets you turned on",
          get: () => sotdSettings().sotdPostMode,
          set: (v) => setRust("settings_set_sotd_post_mode", { mode: v }),
          options: [
            { value: "ask", label: "Ask each time" },
            { value: "now", label: "Right away" },
            { value: "time", label: "At a set time" },
          ],
          when: on,
        },
        {
          kind: "choice", id: "sotdat", label: "Post at", menu: true,
          hint: "The time the day's picks go out. It always falls inside the day they belong to",
          get: () => sotdSettings().sotdPostAt,
          set: (v) => setRust("settings_set_sotd_post_at", { at: v }),
          options: timeOptions(0, 23 * 60 + 45, 15),
          when: () => on() && sotdSettings().sotdPostMode === "time",
        },
        // The webhook moved to Settings › Discord (FRIENDS.md §8.5.2): a service's connection
        // belongs under the service's name. These rows are about PICKS, so they stayed. The
        // line below is the pointer, and it opens the row it names.
        {
          kind: "split", id: "sotdoutlet", label: "Where picks go",
          hint: () => "The one outlet a pick goes to. Set it up in Settings › Discord",
          halves: [
            {
              type: "action",
              get label() {
                return outletOf("discord")?.connected ? "Discord" : "Not set up";
              },
              hint: "Opens the Discord section",
              run: () => focusRow("sotddiscord"),
            },
          ],
          when: on,
        },
      ],
    },
    {
      // Outside programs that drive DeetsMusic: agents (AGENT-SETUP.md), then the browser
      // extension's bridge status and install page (EXTENSION.md).
      title: "Connections",
      count: 5,
      tail: `<div class="set__status" id="set-agent-status">…</div>
        <div class="set__status" id="set-ext-status">Extension bridge off</div>
        <button class="set__row set__action" type="button" data-action="ext-install" title="Opens the install page in your browser"><span class="set__label">Extension install guide</span></button>`,
      rows: [
        {
          kind: "split", id: "agent", label: "Agent control",
          hint: () => "Lets a CLI or an AI app drive DeetsMusic on this PC",
          halves: [
            {
              type: "action", label: "Guide", hint: "Opens the setup guide in your browser",
              run: () => { invoke("agent_open_guide").catch((err) => console.error("[agent] guide", err)); },
            },
            {
              type: "toggle",
              get: () => agentControl,
              set: (on) => {
                agentControl = on;
                invoke("settings_set_agent_control", { on }).catch((e) => console.error("[settings] agent", e));
                render();
              },
            },
          ],
        },
        // AGENT.md §6: a runtime permission for agent settings changes. Agents can't change it.
        {
          kind: "choice", id: "agentsettings", label: "Agent changes settings", key: "agentSettings",
          hint: "An AI app or the command line changing these settings. Ask: DeetsMusic asks you each time",
          options: [{ value: "allow", label: "Allow" }, { value: "ask", label: "Ask" }, { value: "off", label: "Off" }],
        },
        // LOCAL-DATA.md §9: agents may read what you played (the sql tool, the library sorts, history).
        {
          kind: "toggle",
          id: "agenthistory",
          label: "Agents read play history",
          hint: () => "Lets a connected agent see what you played, when, and what you skipped",
          get: () => agentHistory,
          set: (on) => {
            agentHistory = on;
            invoke("settings_set_agent_history", { on }).catch((e) => console.error("[settings] agent history", e));
            render();
          },
        },
        // AGENT-SETUP.md: pick the app, then copy its exact setup text.
        {
          kind: "split", id: "setup", label: "Copy setup for",
          hint: () => "Copies the exact text for that app",
          halves: [
            { type: "menu", options: SETUP_CLIENTS, get: () => setupClient, set: (v) => { setupClient = v; render(); } },
            { type: "action", label: "Copy", run: (el) => copyFrom(el, invoke<string>("agent_setup_text", { client: setupClient })) },
          ],
        },
      ],
    },
    {
      // The updater (RELEASE.md §6.3–6.5): when to update, a manual check, and a rollback.
      title: "Updates",
      tail: `<div class="set__status" id="set-update-status"></div>`,
      rows: [
        {
          kind: "choice", id: "updatemode", label: "Get updates", key: "updateMode",
          hint: "Automatic: downloads in the background, then asks to restart. Ask: asks before the download",
          options: [{ value: "auto", label: "Automatic" }, { value: "ask", label: "Ask" }, { value: "off", label: "Off" }],
        },
        {
          kind: "split", id: "updatecheck", label: "Check for updates",
          hint: () => "Asks music-api.deets.solutions for a newer version",
          halves: [
            {
              type: "action", label: "Check now",
              run: (el) => { flash(el, "Checking"); void checkForUpdate(true); },
            },
          ],
        },
        {
          kind: "split", id: "rollback", label: "Roll back",
          hint: () => (older.length ? "Installs an earlier version. Your library and settings stay" : "No earlier version to roll back to yet"),
          halves: [
            {
              type: "menu",
              get options() {
                return older.length ? older.map((v) => ({ value: v.version, label: v.version })) : [{ value: "", label: "None" }];
              },
              get: () => rollTarget,
              set: (v) => { rollTarget = v; render(); },
            },
            {
              type: "action", label: "Install", hint: "Downloads that version, then asks to restart",
              run: (el) => {
                if (!rollTarget) return flash(el, "None");
                flash(el, "Getting");
                void rollbackTo(rollTarget);
              },
            },
          ],
        },
      ],
    },
    {
      // Back to the defaults: one row per Settings section, Look and feel with its parts
      // indented under it, then every group at once (RESET_GROUPS).
      title: "Reset",
      rows: [
        resetRow("Look and feel", "The theme and skin, and every row of the four look sections", RESET_GROUPS.filter((g) => LOOK_AND_FEEL.includes(g.id)), "reset-lookfeel", "group"),
        ...RESET_GROUPS.filter((g) => LOOK_PARTS.includes(g.id)).map((g) => resetRow(g.label, g.hint, [g], `reset-${g.id}`, "sub")),
        ...RESET_GROUPS.filter((g) => !LOOK_AND_FEEL.includes(g.id)).map((g) => resetRow(g.label, g.hint, [g], `reset-${g.id}`)),
        orderResetRow,
        resetRow("Everything", "Every row in this list, in one step", RESET_GROUPS, "reset-all"),
      ],
    },
    {
      title: "Bugs",
      // The labelled rows, plus one per saved report.
      get count() {
        return 5 + reports.length;
      },
      rows: [
        // The number a report sends (report.rs `meta.version`), where a user looks when
        // something goes wrong (FUTURE-SETTINGS §23). paintUpdate keeps the label current.
        {
          kind: "split", id: "version",
          get label() {
            return versionLabel();
          },
          hint: () => "The version a bug report sends",
          halves: [
            { type: "action", label: "Copy", hint: "Copies the version to the clipboard", run: (el) => copyFrom(el, Promise.resolve(versionText())) },
          ],
        },
        // The report form (report.rs): title, details, the bug type that picks the log cut,
        // Attach log + its preview, then Send as a bug or a suggestion.
        {
          kind: "html", id: "report-title",
          html: () =>
            `<label class="set__field"><input class="set__input" data-report="title" type="text" maxlength="120" ` +
            `placeholder="Title, in ${TITLE_WORDS} words or fewer" value="${esc(draft.title)}" /></label>`,
        },
        {
          kind: "html", id: "report-body",
          html: () =>
            `<label class="set__field"><textarea class="set__input set__textarea" data-report="body" maxlength="4000" ` +
            `placeholder="What happened, and what did you expect?">${esc(draft.body)}</textarea></label>`,
        },
        {
          kind: "split", id: "reportarea", label: "What went wrong",
          hint: () => "Picks the part of the log a bug report sends",
          halves: [
            {
              type: "menu", options: REPORT_AREAS,
              get: () => draft.area,
              set: (v) => {
                draft.area = v;
                if (preview !== null) void loadPreview();
                else render();
              },
            },
          ],
        },
        {
          kind: "split", id: "reportlog", label: "Attach log",
          hint: () => "Bug reports only. Preview shows the exact text that is sent",
          halves: [
            {
              type: "toggle",
              get: () => draft.attach,
              set: (on) => {
                draft.attach = on;
                if (!on) preview = null;
                render();
              },
            },
            {
              type: "action",
              get label() {
                return preview === null ? "Preview" : "Hide";
              },
              run: () => {
                if (preview === null) void loadPreview();
                else { preview = null; render(); }
              },
            },
          ],
        },
        {
          kind: "html", id: "report-preview",
          html: () => (preview === null ? "" : `<pre class="set__preview">${esc(preview || "The log is empty.")}</pre>`),
        },
        {
          kind: "split", id: "reportsend", label: "Send",
          hint: () => "Sends the title and details to support.deets.solutions with the app version",
          halves: [
            { type: "action", label: "Bug", hint: "Sends a bug report, with the log if Attach log is on", run: () => void sendReport("issue") },
            { type: "action", label: "Suggestion", hint: "Sends a suggestion. It never carries the log", run: () => void sendReport("suggestion") },
          ],
        },
        {
          kind: "html", id: "report-status",
          html: () => `<div class="set__status" id="set-report-status" aria-live="polite" hidden></div>`,
        },
        // LOGGING.md: the rolling log file the app always writes.
        {
          kind: "split", id: "log", label: "App log",
          hint: () => "The log file the app writes on this PC",
          halves: [
            {
              type: "action", label: "Open folder",
              run: () => {
                diag.flush(); // so the file the user is about to read has the front end's last events
                invoke("log_open_folder").catch((err) => console.error("[log] folder", err));
              },
            },
            { type: "action", label: "Copy", hint: "Copies the recent log to the clipboard", run: (el) => copyFrom(el, invoke<string>("bridge_log")) },
          ],
        },
        // My reports: the codes this install sent (support.md: no contact details, so a lost
        // code is a lost thread).
        {
          kind: "html", id: "myreports",
          html: () =>
            reports.length === 0
              ? ""
              : // One bordered group: a heading (the card headers' refresh square) over its report rows.
                `<div class="set__group"><div class="set__group-head"><span>My reports</span>` +
                `<button class="panel__action${refreshing ? " is-busy" : ""}" type="button" data-report-refresh${refreshing ? " disabled" : ""} ` +
                `aria-label="Refresh my reports" title="Asks support.deets.solutions for each report's status">` +
                `<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline>` +
                `<polyline points="1 20 1 14 7 14"></polyline>` +
                `<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg></button></div>` +
                reports
                  .map((r) => {
                    const tip = `${r.kind === "issue" ? "Bug" : "Suggestion"} · ${new Date(r.at * 1000).toLocaleDateString()}`;
                    const tag = r.state ? `<span class="set__tag">${esc(STATE_LABEL[r.state] ?? r.state)}</span>` : "";
                    const dot = r.newReply ? `<span class="set__new" title="New reply">•</span>` : "";
                    const done = r.state === "closed" || r.state === "gone";
                    const close = done
                      ? ""
                      : `<button class="set__half" type="button" data-report-close="${esc(r.code)}" title="Closes the post on the support page">${closeArmed === r.code ? "Sure?" : "Close"}</button>`;
                    return (
                      `<div class="set__row set__row--choice" data-report-row="${esc(r.code)}" title="${esc(tip)}"><span class="set__label">${esc(r.title)}${tag}${dot}</span>` +
                      `<div class="set__split"><button class="set__half" type="button" data-report-open="${esc(r.code)}">Open</button>` +
                      `<button class="set__half" type="button" data-report-copy="${esc(r.url)}">Copy link</button>${close}</div></div>`
                    );
                  })
                  .join("") +
                `</div>`,
        },
      ],
    },
    {
      // Trademark + non-affiliation notice (RELEASE.md §7, Apple's third-party guidelines).
      title: "About",
      rows: [],
      defaultOpen: true,
      tail: () =>
        `<div class="set__status" id="set-about-version">${esc(versionLabel())}</div>` +
        `<div class="set__status">Apple Music is a trademark of Apple Inc. ` +
        `DeetsMusic is not affiliated with or endorsed by Apple.</div>` +
        `<div class="set__status">The log stays on this PC unless you send a bug with Attach log on. ` +
        `The app contacts Apple, music-api.deets.solutions for its access key and updates, and ` +
        `support.deets.solutions when you send a report. It sends no listening history, ` +
        `unless you connect Last.fm: then the songs you hear go to Last.fm.</div>`,
    },
  ];

  if (inert) return { destroy() {}, sections };

  const byId = (id: string): Row | undefined => sections.flatMap((s) => s.rows).find((r) => r.id === id);

  // A choice with more than SPLIT_MAX options is a one-half split: a menu.
  const menuOf = (r: ChoiceRow): Half => ({
    type: "menu",
    options: r.options,
    get: () => (r.get ? r.get() : String(setting(r.key!))),
    set: (v) => (r.set ? (r.set(v), render()) : setSetting(r.key!, v as never)),
  });
  const halvesOf = (r: Row): Half[] | undefined =>
    r.kind === "split" ? r.halves : r.kind === "choice" && (r.menu || r.options.length > SPLIT_MAX) ? [menuOf(r)] : undefined;

  const halfHTML = (id: string, h: Half, i: number): string => {
    const at = `data-row="${id}" data-half="${i}"`;
    if (h.type === "action") {
      const tip = h.hint ? ` title="${esc(h.hint)}"` : "";
      return `<button class="set__half" type="button" ${at}${tip}>${esc(h.label)}</button>`;
    }
    if (h.type === "toggle") {
      const on = h.get();
      return `<button class="set__half set__half--toggle" type="button" role="switch" ${at} aria-checked="${on}">${on ? "On" : "Off"}</button>`;
    }
    const cur = h.options.find((o) => o.value === h.get())?.label ?? "";
    return `<span class="set__menu-wrap"><button class="set__half set__half--menu" type="button" ${at} aria-haspopup="menu" aria-expanded="false">${esc(cur)}<span class="set__caret" aria-hidden="true">▾</span></button></span>`;
  };

  // The row requestSetting opened (a toast's [Settings] button) carries `is-flash`. A
  // negative animation-delay keeps the fade's clock when a later render rebuilds the row.
  let flashId: string | null = null;
  let flashAt = 0;
  const flashOf = (id: string): { cls: string; style: string } =>
    id === flashId
      ? { cls: " is-flash", style: ` style="animation-delay: -${Math.round(performance.now() - flashAt)}ms"` }
      : { cls: "", style: "" };

  // The hint rides the row as a hover tooltip (`title`) — the labels stand on their own.
  const rowHTML = (r: Row): string => {
    if (r.kind === "html") return r.html();
    if (r.kind === "head") return `<h4 class="set__sub-head">${esc(r.label)}</h4>`;
    const hint = r.kind === "choice" || r.kind === "range" ? r.hint : r.hint?.();
    const tip = hint ? ` title="${esc(hint)}"` : "";
    const label = `<span class="set__label">${esc(r.label)}${newRow(r.id) ? newBadge(`row:${r.id}`) : ""}</span>`;
    const fx = flashOf(r.id);
    const mark = ` data-set-row="${r.id}"${fx.style}`;
    if (r.kind === "range") {
      const v = setting(r.key);
      const fill = ((v - r.min) / (r.max - r.min)) * 100;
      return (
        `<div class="set__row set__row--range${fx.cls}"${mark}${tip}>${label}` +
        `<div class="set__range scrub" role="slider" tabindex="0" data-range="${r.id}" aria-label="${esc(r.label)}" ` +
        `aria-valuemin="${r.min}" aria-valuemax="${r.max}" aria-valuenow="${v}" style="--slider-fill: ${fill}%">` +
        `<div class="scrub__track"><div class="scrub__fill"></div></div><span class="scrub__handle" aria-hidden="true"></span></div>` +
        `<span class="set__range-val">${v}${esc(r.unit)}</span></div>`
      );
    }
    if (r.kind === "toggle") {
      return `<button class="set__row set__row--toggle${fx.cls}" type="button" role="switch" data-row="${r.id}"${mark} aria-checked="${r.get()}"${tip}>${label}<span class="set__dot" aria-hidden="true"></span></button>`;
    }
    const halves = halvesOf(r);
    if (halves) {
      const sub = r.kind !== "split" ? "" : r.sub ? " set__row--sub" : r.group ? " set__row--group" : "";
      return `<div class="set__row set__row--choice${sub}${fx.cls}"${mark}${tip}>${label}<div class="set__split">${halves.map((h, i) => halfHTML(r.id, h, i)).join("")}</div></div>`;
    }
    const choice = r as ChoiceRow;
    const cur = choice.get ? choice.get() : String(setting(choice.key!));
    const opts = choice.options
      .map((o) => `<button class="set__half" type="button" data-row="${choice.id}" data-value="${esc(o.value)}" aria-pressed="${o.value === cur}">${esc(o.label)}</button>`)
      .join("");
    return `<div class="set__row set__row--choice${fx.cls}"${mark}${tip}>${label}<div class="set__split" role="radiogroup" aria-label="${esc(choice.label)}">${opts}</div></div>`;
  };

  // ── menu halves: a small menu portaled to <body> (a card's backdrop-filter under
  //    Glass would trap a fixed panel, and the scrolling body would clip an absolute
  //    one — the AirPlay panel's reasons). Rebuilt on every render. ──
  let menus: { dd: DropdownHandle; panel: HTMLElement; obs: MutationObserver }[] = [];
  const dropMenus = () => {
    menus.forEach((m) => { m.dd.destroy(); m.obs.disconnect(); m.panel.remove(); });
    menus = [];
  };
  const wireMenus = () => {
    body.querySelectorAll<HTMLElement>(".set__half--menu").forEach((trigger) => {
      const half = halvesOf(byId(trigger.dataset.row!)!)?.[Number(trigger.dataset.half)];
      if (half?.type !== "menu") return;
      const cur = half.get();
      const panel = document.createElement("div");
      panel.className = "set__menu";
      panel.hidden = true;
      panel.setAttribute("role", "menu");
      panel.innerHTML = half.options
        .map((o) => `<button class="set__menu-row" type="button" role="menuitemradio" data-value="${esc(o.value)}" aria-checked="${o.value === cur}"><span>${esc(o.label)}</span><span class="set__dot" aria-hidden="true"></span></button>`)
        .join("");
      document.body.appendChild(panel);

      // Hang under the trigger, right edges aligned; flip above near the bottom.
      const place = () => {
        if (panel.hidden) return;
        const r = trigger.getBoundingClientRect();
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        const gap = parseFloat(getComputedStyle(panel).marginTop) || 0;
        const w = panel.offsetWidth;
        const h = panel.offsetHeight;
        panel.style.left = `${Math.max(gap, Math.min(r.right - w, vw - w - gap))}px`;
        panel.style.top = `${r.bottom + gap + h > vh ? Math.max(0, r.top - h - 2 * gap) : r.bottom}px`;
      };
      const obs = new MutationObserver(place);
      obs.observe(panel, { attributes: true, attributeFilter: ["hidden"] });

      const dd = makeDropdown({ root: trigger.parentElement!, trigger, panel });
      panel.addEventListener("click", (e) => {
        const row = (e.target as HTMLElement).closest<HTMLElement>("[data-value]");
        if (!row) return;
        dd.close();
        half.set(row.dataset.value!);
      });
      menus.push({ dd, panel, obs });
    });
  };
  // ── range rows: rebuilt on every render; a drag previews, the release writes the store ──
  const rangeOf = (el: HTMLElement): RangeRow | undefined => {
    const r = byId(el.dataset.range ?? "");
    return r?.kind === "range" ? r : undefined;
  };
  const wireRanges = () => {
    body.querySelectorAll<HTMLElement>(".set__range").forEach((el) => {
      const r = rangeOf(el);
      if (!r) return;
      const out = el.nextElementSibling;
      const step = r.step ?? 1;
      const valueAt = (frac: number) => {
        const raw = r.min + frac * (r.max - r.min);
        return Math.round(Math.round(raw / step) * step * 100) / 100; // a half-step must not drift
      };
      makeSlider(el, {
        axis: "x",
        onDrag: (frac) => {
          const v = valueAt(frac);
          r.preview(v);
          el.setAttribute("aria-valuenow", String(v));
          if (out) out.textContent = `${v}${r.unit}`;
        },
        onCommit: (frac) => setSetting(r.key, valueAt(frac)),
      });
    });
  };

  // The panel is fixed; a scroll of the card would leave it behind — close instead.
  const closeMenus = () => menus.forEach((m) => m.dd.close());
  body.addEventListener("scroll", closeMenus, { passive: true });
  window.addEventListener("resize", closeMenus);

  // ── section folds: the header is a button; a collapsed section renders no rows ──
  const folds = loadFolds();
  const isOpen = (s: Section) => folds[s.title] ?? !!s.defaultOpen;
  /** What the render draws: a section with a match is open for as long as the query holds,
   *  and every fold comes back exactly as it was when the field is cleared (§10.3). */
  const openNow = (s: Section) => (query ? true : isOpen(s));
  const saveFolds = () => {
    try {
      localStorage.setItem(FOLDS_KEY, JSON.stringify(folds));
    } catch {
      /* storage unavailable — the fold still works for the session */
    }
  };
  const toggleSection = (title: string) => {
    const s = sections.find((x) => x.title === title);
    if (!s) return;
    const was = isOpen(s);
    frames.during("fold", 250, was ? "close" : "open");
    folds[title] = !was;
    saveFolds();
    render();
    // The opened section's rows slide in under its header (src/pop.ts); a close stays instant.
    // By title, not by index: a section with every row gated off is not drawn at all.
    const drawn = body.querySelector(`.set__section[data-sec="${CSS.escape(title)}"]`);
    if (!was) enterRows([...(drawn?.children ?? [])].slice(1));
  };
  /** The hover hint that teaches the gesture, on every section header while the row is on
   *  (ONBOARDING.md ledger). With the row off there is no hint, because there is no move. */
  const MOVE_HINT = sectionsMovable()
    ? ' title="Click to open or close. Hold to move this section. New sections appear at the end"'
    : "";
  // ── the search (§10) ────────────────────────────────────────────────────────
  // Every space-separated word must hit this row's own text: its label, its section's
  // title, or its hint — the same rule the collection engine's `match` uses, so "tray min"
  // finds Minimize to Tray. A row `when` has gated off is never matched: it cannot be
  // shown, so a hit on it is a dead end (§10.4).
  const rowText = (s: Section, r: Row): string => {
    if (r.kind === "html") return ""; // markup, no label and no hint: never a match
    const hint = r.kind === "choice" || r.kind === "range" ? r.hint : r.kind === "head" ? undefined : r.hint?.();
    return `${r.label} ${s.title} ${hint ?? ""}`.toLowerCase();
  };
  const matchRow = (s: Section, r: Row): boolean => {
    const text = rowText(s, r);
    return query.split(/\s+/).every((w) => text.includes(w));
  };
  /** The rows a section draws now: its own, or only the ones the query hits. A sub-heading
   *  is dropped while searching — it names a group that is no longer whole. */
  const rowsOf = (s: Section): Row[] =>
    query ? shown(s.rows).filter((r) => r.kind !== "head" && matchRow(s, r)) : shown(s.rows);

  const headHTML = (s: Section, count = s.count ?? settingRows(s.rows).length): string => {
    const open = openNow(s);
    return (
      `<h3 class="set__head${open ? "" : " is-collapsed"}"><button class="set__fold" type="button" data-fold="${esc(s.title)}" aria-expanded="${open}"${MOVE_HINT}>` +
      `<svg class="lib-shelf__chev" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>` +
      `<span>${esc(s.title)}</span>${newSection(s.title) ? newBadge(`sec:${s.title}`) : ""}` +
      `${count ? `<span class="lib-shelf__count">${count}</span>` : ""}</button></h3>`
    );
  };

  const render = () => {
    dropMenus();
    // A report field being typed in survives the rebuild: its focus and caret come back.
    const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    const field = active && body.contains(active) ? (active.dataset.report ?? active.dataset.sotd) : undefined;
    const caret = field ? [active!.selectionStart ?? 0, active!.selectionEnd ?? 0] : null;
    const rangeFocus = active && body.contains(active) ? active.dataset.range : undefined; // a key step keeps focus
    const tailOf = (s: Section) => (typeof s.tail === "function" ? s.tail() : s.tail ?? "");
    if (parts) {
      // The quick panel: each part under a plain sub-heading, always open, in the order
      // the panel asked for. A part with nothing to show is left out, heading and all.
      body.innerHTML = parts
        .map((p) => {
          const s = sections.find((x) => x.title === p.title);
          if (!s) return "";
          // A sub-heading that repeats the section's name (Window's first) would read twice.
          const rows = shown(s.rows).filter(
            (r) => (!p.rows || p.rows.includes(r.id)) && !(r.kind === "head" && r.label === s.title),
          );
          const inside = rows.map(rowHTML).join("") + (p.rows ? "" : tailOf(s));
          if (!inside) return "";
          const fresh = !p.rows && newSection(s.title) ? newBadge(`sec:${s.title}`) : "";
          return `<section class="set__section" data-sec="${esc(s.title)}"><h4 class="set__sub-head">${esc(s.title)}${fresh}</h4>${inside}</section>`;
        })
        .join("");
    } else {
    // The sections this render draws, in the user's own order (MOVABLE-ROWS.md §2): the
    // rank list sorts them, and a section it does not name keeps the built-in place and
    // falls to the end (fork 3A). The array literal is the built-in order.
    const drawn = sortByOrder(
      "settings.sections",
      sections
        // A section whose every row is gated off shows nothing at all — no empty header.
        // Skin settings under Cyber is the case that made this necessary (2026-09-18).
        // While the field holds text, a section with no matching row goes the same way.
        .filter((s) => (query ? rowsOf(s).length > 0 : settingRows(s.rows).length > 0 || !!tailOf(s))),
      (s) => s.title,
    );
    shownTitles = drawn.map((s) => s.title);
    body.innerHTML = drawn
      .map((s, i) => {
        // The tail is markup, not indexed rows, so a filtered section never shows it.
        const inside = openNow(s) ? rowsOf(s).map(rowHTML).join("") + (query ? "" : tailOf(s)) : "";
        const count = query ? rowsOf(s).length : undefined;
        return `<section class="set__section" data-sec="${esc(s.title)}" data-idx="${i}">${headHTML(s, count)}${inside}</section>`;
      })
      .join("");
    }
    if (field && caret) {
      const el = body.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        `[data-report="${field}"], [data-sotd="${field}"]`,
      );
      el?.focus({ preventScroll: true });
      el?.setSelectionRange(caret[0], caret[1]);
    }
    if (rangeFocus) body.querySelector<HTMLElement>(`[data-range="${rangeFocus}"]`)?.focus({ preventScroll: true });
    paintReport();
    wireMenus();
    wireRanges();
    refreshExtension();
    paintUpdate();
    paintLook();
    markScrollable();
  };
  // Settings › Look schedule status line: which look shows and until when (look-schedule.ts).
  const paintLook = () => {
    const el = body.querySelector<HTMLElement>("#set-look-status");
    if (el) el.textContent = scheduleStatus();
  };
  // Settings › Updates status line: repainted in place on every update-state change, so a
  // download's progress never rebuilds the rows (or closes an open menu).
  const paintUpdate = () => {
    const el = body.querySelector<HTMLElement>("#set-update-status");
    if (el) el.textContent = updateStatusText();
    // The version arrives from Rust after boot; the Bugs row and the About line follow it.
    const row = body.querySelector<HTMLElement>(`[data-set-row="version"] .set__label`);
    if (row) row.textContent = versionLabel();
    const about = body.querySelector<HTMLElement>("#set-about-version");
    if (about) about.textContent = versionLabel();
  };
  // The scrollbar thumb fades in only while the rows outgrow the card (settings.css).
  const markScrollable = () => body.classList.toggle("is-scrollable", body.scrollHeight > body.clientHeight + 1);
  const scrollObserver = new ResizeObserver(markScrollable); // a window resize or surface switch
  scrollObserver.observe(body);

  // ── extension block (EXTENSION.md): bridge status + the agent status line ──
  interface BridgeInfo { port: number | null }
  const refreshExtension = () => {
    const el = body.querySelector<HTMLElement>("#set-ext-status");
    const ag = body.querySelector<HTMLElement>("#set-agent-status");
    if (!el && !ag) return;
    invoke<BridgeInfo>("bridge_info")
      .then((b) => {
        if (el) el.textContent = b.port ? `Extension bridge on 127.0.0.1:${b.port}` : "Extension bridge off (no free port)";
        if (ag) ag.textContent = !agentControl ? "Off" : b.port ? `Ready at 127.0.0.1:${b.port}` : "Off (no free port)";
      })
      .catch((e) => console.warn("[bridge] info", e));
  };

  body.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const fold = t.closest<HTMLElement>("[data-fold]")?.dataset.fold;
    if (fold !== undefined) {
      // The click that trails a section drag is not a fold (MOVABLE-ROWS.md §4.2).
      if (sections_drag.consumeClick()) return;
      toggleSection(fold);
      return;
    }
    const action = t.closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action === "ext-install") {
      invoke("bridge_open_install_page").catch((err) => console.error("[bridge] install page", err));
      return;
    }
    // My reports: Open (the browser, report.rs checks the code is one it saved) / Copy link.
    const openCode = t.closest<HTMLElement>("[data-report-open]")?.dataset.reportOpen;
    if (openCode) {
      invoke("report_open", { code: openCode })
        .then(() => {
          // Open marks the owner replies seen (report.rs): the dot goes.
          const r = reports.find((x) => x.code === openCode);
          if (r?.newReply && alive) { r.newReply = false; render(); }
        })
        .catch((err) => console.error("[report] open", err));
      return;
    }
    if (t.closest("[data-report-refresh]")) {
      void refreshReports();
      return;
    }
    const closeCode = t.closest<HTMLElement>("[data-report-close]")?.dataset.reportClose;
    if (closeCode) {
      void closeReport(closeCode);
      return;
    }
    const copyBtn = t.closest<HTMLElement>("[data-report-copy]");
    if (copyBtn) {
      void copyFrom(copyBtn, Promise.resolve(copyBtn.dataset.reportCopy ?? ""));
      return;
    }
    // A split half (menu halves open through their dropdown, which stops the click).
    const halfEl = t.closest<HTMLElement>("[data-half]");
    if (halfEl?.dataset.row) {
      const half = halvesOf(byId(halfEl.dataset.row)!)?.[Number(halfEl.dataset.half)];
      if (half?.type === "action") half.run(halfEl);
      else if (half?.type === "toggle") half.set(!half.get());
      return;
    }
    const opt = t.closest<HTMLElement>("[data-value]");
    if (opt?.dataset.row && opt.dataset.value !== undefined) {
      const r = byId(opt.dataset.row);
      if (r?.kind === "choice") {
        if (r.set) { r.set(opt.dataset.value); render(); }
        else setSetting(r.key!, opt.dataset.value as never);
      }
      return;
    }
    const toggle = t.closest<HTMLElement>(".set__row--toggle");
    if (toggle?.dataset.row) {
      const r = byId(toggle.dataset.row);
      if (r?.kind === "toggle") r.set(!r.get());
    }
  });

  // A New badge goes the first time the pointer rests on its row, or anywhere in its
  // section (QUICK-SETTINGS.md §10, his call: hover, not a press). Every open copy redraws.
  body.addEventListener("mouseover", (e) => {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>("[data-set-row]")?.querySelector<HTMLElement>("[data-new-mark]")?.dataset.newMark;
    if (row) seeNew(row);
    const sec = t.closest<HTMLElement>(".set__section")?.querySelector<HTMLElement>(":scope > .set__head [data-new-mark], :scope > .set__sub-head [data-new-mark]")?.dataset.newMark;
    if (sec) seeNew(sec);
  });

  // My reports › right-click: the row's buttons, plus Clear (this PC only; the post stays).
  // Close sends at once: picking it from the menu is the confirming step.
  body.addEventListener("contextmenu", (e) => {
    const code = (e.target as HTMLElement).closest<HTMLElement>("[data-report-row]")?.dataset.reportRow;
    const r = code ? reports.find((x) => x.code === code) : undefined;
    if (!code || !r) return;
    e.preventDefault();
    e.stopPropagation();
    const done = r.state === "closed" || r.state === "gone";
    const items: MenuItem[] = [
      {
        label: "Open",
        run: () =>
          void invoke("report_open", { code })
            .then(() => {
              if (r.newReply && alive) { r.newReply = false; render(); }
            })
            .catch((err) => console.error("[report] open", err)),
      },
      { label: "Copy link", run: () => void copyLink(r.url) },
      ...(done ? [] : [{ label: "Close", run: () => { closeArmed = code; void closeReport(code); } }]),
      {
        label: "Clear",
        run: () =>
          void invoke<ReportView[]>("report_clear", { code })
            .then((list) => {
              reports = list;
              if (alive) render();
            })
            .catch((err) => console.error("[report] clear", err)),
      },
    ];
    openContextMenu(e.clientX, e.clientY, items);
  });

  // The report fields write to the draft as the user types (render rebuilds them from it).
  // A focused slider: arrows step 1 (Shift: 10), Home / End jump to the ends.
  body.addEventListener("keydown", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".set__range");
    const r = el ? rangeOf(el) : undefined;
    if (!r) return;
    const one = r.step ?? 1;
    const step = e.shiftKey ? one * 10 : one;
    const delta = ({ ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step } as Record<string, number>)[e.key];
    const to = e.key === "Home" ? r.min : e.key === "End" ? r.max : delta === undefined ? null : Math.round((setting(r.key) + delta) * 100) / 100;
    if (to === null) return;
    e.preventDefault();
    setSetting(r.key, Math.max(r.min, Math.min(r.max, to)));
  });
  body.addEventListener("input", (e) => {
    const f = e.target as HTMLInputElement | HTMLTextAreaElement;
    // Song of the Day: the webhook field is a draft until Check; Post as writes on change.
    if (f.dataset.sotd === "hook") {
      hookDraft = f.value;
      return;
    }
    if (f.dataset.sotd === "postas") return;
    if (f.dataset.report === "title") draft.title = f.value;
    else if (f.dataset.report === "body") draft.body = f.value;
    else return;
    if (sending) return;
    if (f.dataset.report === "title" && words(draft.title) > TITLE_WORDS) say(`Keep the title to ${TITLE_WORDS} words or fewer.`);
    else if (reportStatus && !sentUrl) say("");
  });
  body.addEventListener("keydown", (e) => {
    const f = e.target as HTMLInputElement;
    if (e.key !== "Enter" || f?.dataset?.sotd !== "hook") return;
    e.preventDefault();
    checkHook();
  });
  body.addEventListener("change", (e) => {
    const f = e.target as HTMLInputElement;
    if (f?.dataset?.sotd !== "postas") return;
    setRust("settings_set_sotd_post_as", { name: f.value });
  });
  // A mark, an outlet change or a Song of the Day row set from anywhere else.
  const unsubSotd = onSotdChange(() => {
    if (!alive) return;
    loadPostLog(); // a post, a withdraw or a failure changed the record
    render();
    const el = body.querySelector<HTMLElement>("#set-sotd-status");
    if (el) el.textContent = discordLine();
  });
  loadPostLog();
  body.addEventListener("click", (e) => {
    // Withdraw, straight from the record: the same question the picks board asks.
    const pull = (e.target as HTMLElement).closest<HTMLElement>("[data-withdraw-log]");
    if (pull?.dataset.withdrawLog) {
      e.stopPropagation();
      withdrawPickAsking(Number(pull.dataset.withdrawLog));
      return;
    }
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-sotd-copy]");
    if (!btn) return;
    e.stopPropagation();
    void copyFrom(btn, Promise.resolve(postRecords.map(postLine).join("\n")));
  });

  invoke<ReportView[]>("report_list")
    .then((r) => {
      if (!alive) return;
      reports = r;
      render();
    })
    .catch((e) => console.warn("[report] list", e));

  // Re-paint on any change, whoever made it (the store, the Library Add module, the
  // Rust setting we cached). A full re-render is cheap here — a dozen rows.
  const unsubStore = onSettingsChange(render);
  const unsubSkin = onSkinChange(() => render()); // skin-only rows come and go
  const unsubLibAdd = onLibraryAddChange(render);
  // An agent set a value Rust owns (agent-settings.ts): read the cached ones again.
  const unsubOwned = onOwnedSettingChange(() => {
    invoke<RustSettings>("settings_get")
      .then((s) => { takeRust(s); if (alive) render(); })
      .catch((e) => console.warn("[settings] get", e));
    invoke<boolean>("autostart_get")
      .then((v) => { autostart = v; if (alive) render(); })
      .catch((e) => console.warn("[settings] autostart", e));
  });
  const unsubUpdate = onUpdateStatus(paintUpdate);
  const unsubLook = onScheduleChange(paintLook);
  void olderVersions().then((v) => {
    if (!alive) return;
    older = v;
    rollTarget = v[0]?.version ?? "";
    render();
  });
  invoke<RustSettings>("settings_get")
    .then((s) => { takeRust(s); render(); })
    .catch((e) => console.warn("[settings] get", e));
  // The Last.fm status line: repainted in place when a send, a connect or a disconnect lands.
  const paintLastfm = () =>
    void lastfmStatus()
      .then((s) => {
        lastfm = s;
        const el = body.querySelector<HTMLElement>("#set-lastfm-status");
        if (el && alive) el.textContent = lastfmLine();
      })
      .catch((e) => console.warn("[settings] lastfm", e));
  const lastfmUnlisten = listen("lastfm-changed", paintLastfm);
  paintLastfm();
  invoke<boolean>("autostart_get")
    .then((v) => { autostart = v; render(); })
    .catch((e) => console.warn("[settings] autostart", e));

  // ── requestSetting (layout-bus.ts): unfold the row's section, scroll to the row, highlight it ──
  const focusRow = (id: string) => {
    const s = sections.find((x) => x.rows.some((r) => r.id === id));
    if (!s) return;
    // A request names one row: the search that hid the rest is over (§10.3).
    if (query) {
      query = "";
      searchInput.value = "";
      searchOpen = false;
      paintSearch();
    }
    if (!isOpen(s)) {
      folds[s.title] = true; // an unfold like the user's own: it persists
      saveFolds();
    }
    flashId = id;
    flashAt = performance.now();
    render();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    body.querySelector<HTMLElement>(`[data-set-row="${id}"]`)?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  };
  const takeRequest = () => {
    if (parts) return; // a toast's [Settings] opens the card; the quick panel never takes it
    const id = takeSettingRequest();
    if (id) focusRow(id);
  };
  const unsubRequest = onSettingRequest(takeRequest); // a request while this card is on-screen

  // ── moving a section (MOVABLE-ROWS.md §4) ───────────────────────────────────
  // The header IS the grip: hold it still and it lifts; click it and it folds, exactly as
  // it always did (fork 6, the owner 2026-09-20). Any movement before the hold fires drops
  // the press, so a scroll that starts on a header is never stolen.
  let foldBefore: { title: string; open: boolean } | null = null;
  const sections_drag = rowDrag({
    root: body,
    label: "settings",
    rowAt: (target) => {
      // Not while the field holds text: a filtered list has no order to save (§10.5).
      if (parts || query || !sectionsMovable()) return null; // the quick panel has no order to move
      if (!target.closest("[data-fold]")) return null; // the header only, never a row
      const el = target.closest<HTMLElement>(".set__section");
      const idx = el?.dataset.idx;
      if (!el || idx === undefined) return null;
      const title = el.dataset.sec!;
      return {
        row: el,
        index: Number(idx),
        list: body,
        count: shownTitles.length,
        measure: true, // sections are as tall as their rows — never uniform
        hold: holdMs(),
        // Fork 5A: the section shuts as it lifts, so one header-sized block travels and
        // the list under it does not jump about. It opens again on the drop.
        begin: () => {
          foldBefore = { title, open: isOpen(sections.find((x) => x.title === title)!) };
          if (foldBefore.open) {
            folds[title] = false;
            render();
          }
        },
        done: (to) => {
          const back = foldBefore;
          foldBefore = null;
          const finish = () => {
            if (back?.open) {
              folds[back.title] = true;
              saveFolds();
              render();
              const el2 = body.querySelector(`.set__section[data-sec="${CSS.escape(back.title)}"]`);
              if (el2) enterRows([...el2.children].slice(1));
            } else {
              render();
            }
          };
          if (to == null) return finish();
          void moveTo("settings.sections", shownTitles, title, to).then(finish);
        },
      };
    },
  });

  // ── the search bar (§10) ────────────────────────────────────────────────────
  const paintSearch = () => {
    searchBar.classList.toggle("is-open", searchOpen);
    searchBtn.setAttribute("aria-expanded", String(searchOpen));
    searchBtn.classList.toggle("is-active", !!query);
  };
  /** Open the field and put the caret in it — the pill, and Ctrl+F (fork S3 = 9B). */
  const openSearch = () => {
    searchOpen = true;
    paintSearch();
    searchInput.focus();
    searchInput.select();
  };
  const closeSearch = () => {
    searchOpen = false;
    const had = !!query;
    query = "";
    searchInput.value = "";
    paintSearch();
    if (had) render(); // the folds come back exactly as they were
  };
  searchBtn.addEventListener("click", () => (searchOpen ? closeSearch() : openSearch()));
  searchInput.addEventListener("input", () => {
    query = searchInput.value.trim().toLowerCase();
    paintSearch();
    render();
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeSearch();
    }
  });
  const unsubFind = parts ? () => {} : registerFinder(host, openSearch);

  // Another card's move, or a Reset, repaints this one.
  const unsubOrder = onRowOrderChange(() => { if (alive) render(); });

  render();
  takeRequest(); // this card was mounted BY a request
  // Card memory (CARD-MEMORY.md §5): the scroll place. The open sections have their own store
  // (FOLDS_KEY), and a row request above wins — it scrolls to its own row.
  applyScrollSnapshot(body, mountOpts?.memory);

  return {
    sections,
    snapshot: () => scrollSnapshot(body),
    destroy() {
      alive = false;
      unsubStore();
      unsubSotd();
      unsubSkin();
      unsubLibAdd();
      unsubOwned();
      unsubUpdate();
      unsubLook();
      void lastfmUnlisten.then((un) => un());
      unsubRequest();
      unsubOrder();
      unsubFind();
      sections_drag.destroy();
      dropMenus();
      window.removeEventListener("resize", closeMenus);
      scrollObserver.disconnect();
      host.innerHTML = "";
    },
  };
}
