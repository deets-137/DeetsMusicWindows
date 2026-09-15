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
import { setting, setSetting, onSettingsChange, onOwnedSettingChange, type Settings } from "./settings-store";
import { currentSkin, onSkinChange } from "./skin";
import { makeSlider } from "./slider";
import { previewSkin } from "./skin-settings";
import { libraryAddEnabled, setLibraryAddEnabled, onLibraryAddChange } from "./library-add";
import { makeDropdown, type DropdownHandle } from "./dropdown";
import { esc } from "./collection-card";
import * as diag from "./diag";
import { toast } from "./toast";
import { copyLink } from "./copy-link";
import { openContextMenu, type MenuItem } from "./context-menu";
import * as frames from "./frames";
import { enterRows } from "./pop";
import { takeSettingRequest, onSettingRequest } from "./layout-bus";
import { checkForUpdate, rollbackTo, olderVersions, onUpdateStatus, updateStatusText, versionText, type OlderVersion } from "./updater";
import { scheduleStatus, onScheduleChange, THEME_OPTIONS, SKIN_OPTIONS } from "./look-schedule";
import type { CardDef, CardInstance } from "./cards";

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
}
/** Markup of its own (Bugs › the report fields); events are wired by data attributes. */
interface HtmlRow {
  kind: "html";
  id: string;
  html: () => string;
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
  preview: (v: number) => void;
}
type Row = (ToggleRow | ChoiceRow | SplitRow | HtmlRow | RangeRow) & { when?: () => boolean };
const shown = (rows: Row[]): Row[] => rows.filter((r) => !r.when || r.when());
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
const timeOptions = (from: number, to: number): Option[] => {
  const out: Option[] = [];
  for (let m = from; m <= to; m += 30) {
    const hh = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    const label = new Date(2000, 0, 1, 0, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    out.push({ value: `${hh}:${mm}`, label });
  }
  return out;
};
const scheduled = () => setting("lookSchedule") !== "off";

const SETUP_CLIENTS: Option[] = [
  { value: "claude-desktop", label: "Claude Desktop" },
  { value: "claude-code", label: "Claude Code" },
  { value: "cursor", label: "Cursor" },
  { value: "other-full", label: "Other (Full)" },
  { value: "other-small", label: "Other (Sm)" },
];

export const settingsCard: CardDef = {
  id: "settings",
  title: "Settings",
  mount: (host) => mountSettings(host),
};

function mountSettings(host: HTMLElement): CardInstance {
  host.innerHTML = `<header class="panel__head"><h2 class="panel__title">Settings</h2></header><div class="panel__body set"></div>`;
  const body = host.querySelector<HTMLElement>(".panel__body")!;

  // Minimize to Tray and the AirPlay rows live in Rust (read there before JS can
  // answer, or at connect time); cache the values here and write through.
  let minimizeToTray = true;
  let autostart = false;
  let agentControl = true;
  let setupClient = "claude-code"; // the app "Copy setup for" copies for
  let older: OlderVersion[] = []; // Roll back's menu (updater.ts, one request per session)
  let rollTarget = "";
  let alive = true; // the versions request can answer after the card is gone

  const flash = (el: HTMLElement, text: string) => {
    const was = el.textContent;
    el.textContent = text;
    window.setTimeout(() => (el.textContent = was), 1200);
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

  const sections: Section[] = [
    // Labels: one short active statement each; the hint (hover) only where a word is
    // missing. Section names are the shortest noun that groups the rows.
    {
      title: "Window",
      rows: [
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
        storeToggle("autoflip", "Resize changes surface", "surfaceAutoFlip", () => "Off: the window resizes inside the current surface"),
        {
          kind: "choice", id: "aot", label: "Keep on top", key: "alwaysOnTop",
          hint: "The window stays above other windows. Player: only while it shows the player",
          options: [{ value: "always", label: "Always" }, { value: "player", label: "Player" }, { value: "off", label: "Off" }],
        },
      ],
    },
    {
      title: "Look and feel",
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
          kind: "choice", id: "sunshift", label: "Shift sun times", when: () => setting("lookSchedule") === "sun",
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
        storeToggle("motion", "Animate look changes", "appearanceMotion", () => "Theme and skin changes play the launch animation. Off: they change at once"),
        storeToggle("cardswap", "Animate card swaps", "cardSwapMotion", () => "Cards move to their new places in the skin's own motion. Off: they change at once"),
        {
          kind: "choice", id: "bgmotion", label: "Animate backgrounds", key: "backgroundMotion",
          hint: "The moving Ocean, Glass, and Retro-Future backgrounds. Reduced: fewer updates, less CPU. Off: they hold still",
          options: [{ value: "on", label: "On" }, { value: "reduced", label: "Reduced" }, { value: "off", label: "Off" }],
        },
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
        // Glass: the layers in paint order, back to front — the background (glow, then its
        // dim), then the card (its backlight, then the tint over it).
        {
          kind: "range", id: "glasscanvas", label: "Canvas glow", key: "glassCanvasGlow", min: 0, max: 100, unit: "%",
          hint: "Glass only. How brightly the colors glow on the background. The cards do not change",
          preview: (v) => previewSkin("glassCanvasGlow", v),
          when: () => currentSkin() === "glass",
        },
        {
          kind: "range", id: "glassdim", label: "Dim canvas", key: "glassCanvasDim", min: 0, max: 100, unit: "%",
          hint: "Glass only. Darkens the space between the cards. The cards stay as bright",
          preview: (v) => previewSkin("glassCanvasDim", v),
          when: () => currentSkin() === "glass",
        },
        {
          kind: "range", id: "glassbacklight", label: "Backlight", key: "glassBacklight", min: 0, max: 100, unit: "%",
          hint: "Glass only. A light behind each card, under its tint",
          preview: (v) => previewSkin("glassBacklight", v),
          when: () => currentSkin() === "glass",
        },
        {
          kind: "range", id: "glasstint", label: "Tint cards", key: "glassTint", min: 0, max: 100, unit: "%",
          hint: "Glass only. The card color over the backlight. Less tint: more glow",
          preview: (v) => previewSkin("glassTint", v),
          when: () => currentSkin() === "glass",
        },
        {
          kind: "toggle",
          id: "hover",
          label: "Open menus on hover",
          get: () => setting("menuMode") === "hover",
          set: (on) => setSetting("menuMode", on ? "hover" : "click"),
        },
        {
          kind: "choice", id: "toasts", label: "Show notices", key: "toasts",
          hint: "Everything: confirmations too. Failures: only when an action couldn't do what it said",
          options: [{ value: "all", label: "Everything" }, { value: "failures", label: "Failures" }],
        },
      ],
    },
    {
      title: "Playback",
      rows: [
        {
          kind: "choice", id: "playnow", label: "Play Now plays", key: "playNowScope",
          hint: "The right-click action",
          options: [{ value: "song", label: "Song only" }, { value: "list", label: "Song and rest of list" }],
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
          kind: "choice", id: "shufflemanual", label: "Shuffle keeps picks", key: "shuffleManual",
          hint: "Where songs you queued by hand land",
          options: [{ value: "top", label: "First" }, { value: "hold", label: "In place" }, { value: "mix", label: "Mixed" }],
        },
        {
          kind: "choice", id: "shuffleidle", label: "Idle shuffle plays", key: "shuffleIdle",
          hint: "Shuffle with nothing playing",
          options: [{ value: "library", label: "Library" }, { value: "noop", label: "Nothing" }],
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
        storeToggle("playlistexport", "Export playlists", "playlistExport", () => "Can't rename, reorder, or delete on Apple Music via DeetsMusic"),
      ],
    },
    {
      title: "Playlists",
      rows: [
        storeToggle("eagercounts", "Show playlist counts", "playlistEagerCounts", () => "One small request per playlist, once"),
        storeToggle("createsummon", "New playlist opens Search", "playlistCreateSummon"),
        {
          kind: "choice", id: "npcover", label: "Show cover", key: "nowPlayingCover",
          hint: "For a song from a playlist, in Now Playing and the tray panel",
          options: [{ value: "album", label: "Album" }, { value: "playlist", label: "Playlist" }],
        },
        {
          kind: "choice", id: "newcover", label: "New cover", key: "newPlaylistCover",
          hint: "How a new playlist's cover starts. Letters and Note keep the theme you made it in",
          options: [{ value: "letters", label: "Letters" }, { value: "mosaic", label: "Mosaic" }, { value: "note", label: "Note" }],
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
      // Outside programs that drive DeetsMusic: agents (AGENT-SETUP.md), then the browser
      // extension's bridge status and install page (EXTENSION.md).
      title: "Connections",
      count: 4,
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
        `support.deets.solutions when you send a report. It sends no listening history.</div>`,
    },
  ];

  const byId = (id: string): Row | undefined => sections.flatMap((s) => s.rows).find((r) => r.id === id);

  // A choice with more than SPLIT_MAX options is a one-half split: a menu.
  const menuOf = (r: ChoiceRow): Half => ({
    type: "menu",
    options: r.options,
    get: () => (r.get ? r.get() : String(setting(r.key!))),
    set: (v) => (r.set ? (r.set(v), render()) : setSetting(r.key!, v as never)),
  });
  const halvesOf = (r: Row): Half[] | undefined =>
    r.kind === "split" ? r.halves : r.kind === "choice" && r.options.length > SPLIT_MAX ? [menuOf(r)] : undefined;

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
    const hint = r.kind === "choice" || r.kind === "range" ? r.hint : r.hint?.();
    const tip = hint ? ` title="${esc(hint)}"` : "";
    const label = `<span class="set__label">${esc(r.label)}</span>`;
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
      return `<div class="set__row set__row--choice${fx.cls}"${mark}${tip}>${label}<div class="set__split">${halves.map((h, i) => halfHTML(r.id, h, i)).join("")}</div></div>`;
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
      const valueAt = (frac: number) => Math.round(r.min + frac * (r.max - r.min));
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
    if (!was) enterRows([...(body.querySelectorAll(".set__section")[sections.indexOf(s)]?.children ?? [])].slice(1));
  };
  const headHTML = (s: Section): string => {
    const open = isOpen(s);
    const count = s.count ?? shown(s.rows).length;
    return (
      `<h3 class="set__head${open ? "" : " is-collapsed"}"><button class="set__fold" type="button" data-fold="${esc(s.title)}" aria-expanded="${open}">` +
      `<svg class="lib-shelf__chev" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>` +
      `<span>${esc(s.title)}</span>${count ? `<span class="lib-shelf__count">${count}</span>` : ""}</button></h3>`
    );
  };

  const render = () => {
    dropMenus();
    // A report field being typed in survives the rebuild: its focus and caret come back.
    const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    const field = active && body.contains(active) ? active.dataset.report : undefined;
    const caret = field ? [active!.selectionStart ?? 0, active!.selectionEnd ?? 0] : null;
    const rangeFocus = active && body.contains(active) ? active.dataset.range : undefined; // a key step keeps focus
    const tailOf = (s: Section) => (typeof s.tail === "function" ? s.tail() : s.tail ?? "");
    body.innerHTML =
      sections
        .map((s) => `<section class="set__section">${headHTML(s)}${isOpen(s) ? shown(s.rows).map(rowHTML).join("") + tailOf(s) : ""}</section>`)
        .join("");
    if (field && caret) {
      const el = body.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-report="${field}"]`);
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
  // Settings › Look and feel status line: which look shows and until when (look-schedule.ts).
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
    const step = e.shiftKey ? 10 : 1;
    const delta = ({ ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step } as Record<string, number>)[e.key];
    const to = e.key === "Home" ? r.min : e.key === "End" ? r.max : delta === undefined ? null : setting(r.key) + delta;
    if (to === null) return;
    e.preventDefault();
    setSetting(r.key, Math.max(r.min, Math.min(r.max, to)));
  });
  body.addEventListener("input", (e) => {
    const f = e.target as HTMLInputElement | HTMLTextAreaElement;
    if (f.dataset.report === "title") draft.title = f.value;
    else if (f.dataset.report === "body") draft.body = f.value;
    else return;
    if (sending) return;
    if (f.dataset.report === "title" && words(draft.title) > TITLE_WORDS) say(`Keep the title to ${TITLE_WORDS} words or fewer.`);
    else if (reportStatus && !sentUrl) say("");
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
    invoke<{ minimizeToTray: boolean; agentControl: boolean }>("settings_get")
      .then((s) => { minimizeToTray = s.minimizeToTray; agentControl = s.agentControl; if (alive) render(); })
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
  invoke<{ minimizeToTray: boolean; agentControl: boolean }>("settings_get")
    .then((s) => { minimizeToTray = s.minimizeToTray; agentControl = s.agentControl; render(); })
    .catch((e) => console.warn("[settings] get", e));
  invoke<boolean>("autostart_get")
    .then((v) => { autostart = v; render(); })
    .catch((e) => console.warn("[settings] autostart", e));

  // ── requestSetting (layout-bus.ts): unfold the row's section, scroll to the row, highlight it ──
  const focusRow = (id: string) => {
    const s = sections.find((x) => x.rows.some((r) => r.id === id));
    if (!s) return;
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
    const id = takeSettingRequest();
    if (id) focusRow(id);
  };
  const unsubRequest = onSettingRequest(takeRequest); // a request while this card is on-screen

  render();
  takeRequest(); // this card was mounted BY a request

  return {
    destroy() {
      alive = false;
      unsubStore();
      unsubSkin();
      unsubLibAdd();
      unsubOwned();
      unsubUpdate();
      unsubLook();
      unsubRequest();
      dropMenus();
      window.removeEventListener("resize", closeMenus);
      scrollObserver.disconnect();
      host.innerHTML = "";
    },
  };
}
