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
import { applySurface, currentSurface, type SurfaceName } from "./surface";
import { noteHandPick, THEME_OPTIONS, SKIN_OPTIONS } from "./look-schedule";
import { withAppearanceTransition } from "./appearance";

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
  kind: "choice" | "toggle" | "range" | "time";
  options?: Opt[];
  /** range: the bounds · time: minutes after midnight, on the half hour. */
  min?: number;
  max?: number;
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
const storeTime = (key: "dayStart" | "nightStart", label: string, from: number, to: number): Spec => ({
  key, label, section: "Look and feel", kind: "time", min: from, max: to,
  get: () => setting(key),
  set: (v) => setSetting(key, v),
});

/** Rust owns these (settings.json, the Run key); the card caches them, so tell it. */
const rustSettings = () => invoke<{ minimizeToTray: boolean; agentControl: boolean }>("settings_get");
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
  storeChoice("Window", "alwaysOnTop", "Keep on top", [{ value: "always", label: "Always" }, { value: "player", label: "Player" }, { value: "off", label: "Off" }]),
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
          if (v === "player") await applySurface("mini", false, "player");
          else await applySurface(v as SurfaceName, false, v === "mini" ? "cards" : undefined);
          invoke("tray_pin_main").catch(() => {}); // a deliberate pick pins a tray-popped window, as the menu does
        },
        { by: "agent" },
      ),
  },
  // ── Look and feel ──
  {
    key: "theme", label: "Theme", section: "Look and feel", kind: "choice", options: THEME_OPTIONS,
    get: () => document.documentElement.dataset.theme ?? "",
    set: (v) => pickLook("theme", v),
    note: () => (setting("lookSchedule") !== "off" ? "The look schedule is on: this pick lasts as Settings › Menu pick lasts says." : undefined),
  },
  {
    key: "skin", label: "Skin", section: "Look and feel", kind: "choice", options: SKIN_OPTIONS,
    get: () => currentSkin(),
    set: (v) => pickLook("skin", v),
    note: () => (setting("lookSchedule") !== "off" ? "The look schedule is on: this pick lasts as Settings › Menu pick lasts says." : undefined),
  },
  storeChoice("Look and feel", "lookSchedule", "Change look at", [
    { value: "sun", label: "Sunrise and sunset" }, { value: "clock", label: "Set times" }, { value: "windows", label: "Windows mode" }, { value: "off", label: "Off" },
  ]),
  storeChoice("Look and feel", "dayTheme", "Day look theme", THEME_OPTIONS),
  storeChoice("Look and feel", "daySkin", "Day look skin", SKIN_OPTIONS),
  storeChoice("Look and feel", "nightTheme", "Night look theme", THEME_OPTIONS),
  storeChoice("Look and feel", "nightSkin", "Night look skin", SKIN_OPTIONS),
  storeTime("dayStart", "Day starts at", 4 * 60, 12 * 60),
  storeTime("nightStart", "Night starts at", 15 * 60, 23 * 60 + 30),
  {
    key: "sunShift", label: "Shift sun times", section: "Look and feel", kind: "choice",
    options: MINUTES.map((v) => ({ value: String(v), label: v === 0 ? "None" : `${v > 0 ? "+" : "−"}${Math.abs(v)} min` })),
    get: () => String(setting("sunShift")),
    set: (v) => setSetting("sunShift", Number(v)),
  },
  storeChoice("Look and feel", "lookHold", "Menu pick lasts", [{ value: "next", label: "Until next change" }, { value: "always", label: "For good" }]),
  storeToggle("Look and feel", "appearanceMotion", "Animate look changes"),
  storeToggle("Look and feel", "cardSwapMotion", "Animate card swaps"),
  storeChoice("Look and feel", "backgroundMotion", "Animate backgrounds", [{ value: "on", label: "On" }, { value: "reduced", label: "Reduced" }, { value: "off", label: "Off" }]),
  storeChoice("Look and feel", "oceanEdges", "Draw card edges", [{ value: "sand", label: "Sand" }, { value: "soft", label: "Soft" }], { only: "Ocean only", note: skinNote("ocean", "Ocean") }),
  storeRange("Look and feel", "oceanSand", "Sand width", { only: "Ocean only, with Sand edges", note: skinNote("ocean", "Ocean") }),
  storeRange("Look and feel", "glassBacklight", "Backlight", { only: "Glass only", note: skinNote("glass", "Glass") }),
  storeRange("Look and feel", "glassTint", "Tint cards", { only: "Glass only", note: skinNote("glass", "Glass") }),
  storeRange("Look and feel", "glassCanvasGlow", "Canvas glow", { only: "Glass only", note: skinNote("glass", "Glass") }),
  storeRange("Look and feel", "glassCanvasDim", "Dim canvas", { only: "Glass only", note: skinNote("glass", "Glass") }),
  {
    key: "menuMode", label: "Open menus on hover", section: "Look and feel", kind: "toggle", options: ON_OFF,
    get: () => (setting("menuMode") === "hover" ? "on" : "off"),
    set: (v) => setSetting("menuMode", v === "on" ? "hover" : "click"),
  },
  storeChoice("Look and feel", "toasts", "Show notices", [{ value: "all", label: "Everything" }, { value: "failures", label: "Failures" }]),
  // ── Playback ──
  storeChoice("Playback", "playNowScope", "Play Now plays", [{ value: "song", label: "Song only" }, { value: "list", label: "Song and rest of list" }]),
  storeChoice("Playback", "dropPlayQueue", "Drop on Now Playing", [{ value: "keep", label: "Keep Up Next" }, { value: "replace", label: "Replace it" }]),
  storeChoice("Playback", "previousReach", "Previous rewinds", [{ value: "lookback", label: "The list" }, { value: "heard", label: "Played songs" }]),
  storeChoice("Playback", "restoreQueue", "Restore on launch", [{ value: "song", label: "Last song" }, { value: "queue", label: "Up Next" }, { value: "off", label: "Nothing" }]),
  storeToggle("Playback", "shuffleStays", "Button is perma-shuffle"),
  storeChoice("Playback", "shuffleManual", "Shuffle keeps picks", [{ value: "top", label: "First" }, { value: "hold", label: "In place" }, { value: "mix", label: "Mixed" }]),
  storeChoice("Playback", "shuffleIdle", "Idle shuffle plays", [{ value: "library", label: "Library" }, { value: "noop", label: "Nothing" }]),
  // ── Apple Music: the consent gates, off only ──
  {
    key: "libraryAdd", label: "Add to Library and ♥", section: "Apple Music", kind: "toggle", options: ON_OFF, offOnly: true,
    get: () => (libraryAddEnabled() ? "on" : "off"),
    set: (v) => setLibraryAddEnabled(v === "on"),
  },
  storeToggle("Apple Music", "playlistExport", "Export playlists", { offOnly: true }),
  // ── Playlists ──
  storeToggle("Playlists", "playlistEagerCounts", "Show playlist counts"),
  storeToggle("Playlists", "playlistCreateSummon", "New playlist opens Search"),
  storeChoice("Playlists", "nowPlayingCover", "Show cover", [{ value: "album", label: "Album" }, { value: "playlist", label: "Playlist" }]),
  storeChoice("Playlists", "newPlaylistCover", "New cover", [{ value: "letters", label: "Letters" }, { value: "mosaic", label: "Mosaic" }, { value: "note", label: "Note" }]),
  // ── Rewind ──
  storeToggle("Rewind", "rewindCard", "Rewind card"),
  storeChoice("Rewind", "fullPlayRule", "Count a play at", [{ value: "fraction", label: "90%" }, { value: "end", label: "End" }, { value: "scrobble", label: "Half or 4 min" }]),
  storeToggle("Rewind", "replayAuto", "Weekly Replay"),
  storeChoice("Rewind", "replayDay", "Weekly Replay day", [
    { value: "mon", label: "Mon" }, { value: "tue", label: "Tue" }, { value: "wed", label: "Wed" }, { value: "thu", label: "Thu" },
    { value: "fri", label: "Fri" }, { value: "sat", label: "Sat" }, { value: "sun", label: "Sun" },
  ]),
  storeToggle("Rewind", "replayKeep", "Keep every Replay"),
  // ── Connections ──
  rustToggle("Connections", "agentControl", "Agent control", async () => (await rustSettings()).agentControl, (on) => invoke("settings_set_agent_control", { on }), {
    offOnly: true,
    note: (v) => (v === "off" ? "Agent control is off. Only you can turn it on again, in DeetsMusic › Settings › Connections." : undefined),
  }),
  storeChoice("Connections", "agentSettings", "Agent changes settings", [{ value: "allow", label: "Allow" }, { value: "ask", label: "Ask" }, { value: "off", label: "Off" }], { readOnly: true }),
  // ── Updates ──
  storeChoice("Updates", "updateMode", "Get updates", [{ value: "auto", label: "Automatic" }, { value: "ask", label: "Ask" }, { value: "off", label: "Off" }]),
];

const SECTIONS = [...new Set(SPECS.map((s) => s.section))];

const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** What a set takes, in the words the reply and the listing show. */
function accepts(s: Spec): string {
  switch (s.kind) {
    case "range": return `${s.min}–${s.max}`;
    case "time": return `HH:MM on :00 or :30, ${clock(s.min!)}–${clock(s.max!)}`;
    default: return s.options!.map((o) => o.label).join(" | ");
  }
}

function labelOf(s: Spec, v: string): string {
  if (s.kind === "range") return `${v}%`;
  if (s.kind === "time") return v;
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
  } else {
    const m = /^(\d{1,2}):(\d{2})$/.exec(input);
    const mins = m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
    if (m && Number(m[2]) % 30 === 0 && mins >= s.min! && mins <= s.max!) return clock(mins);
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
  if (s.offOnly && v === "on") throw blocked(`Only you can turn on ${s.label}, in DeetsMusic › Settings › ${s.section}.`);

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
