// Settings card (SETTINGS.md) — the hybrid's second half. The title menu keeps the
// fast switches (Theme / Skin / Surface / Account) and one "Settings…" row that
// summons this card into a slot. Everything else lives here, in one scroll with
// section headers: the rehomed toggles (Always on Top, Minimize to Tray, hover menus,
// Library Add, the Extension block) and the v1 cut of FUTURE-SETTINGS (§1 §4 §5a §5b
// §7 §8 §14 §16) plus the Rewind gate. A control lives in exactly one place.
//
// Two row kinds: TOGGLE (label + dot) and CHOICE (label over segmented pills). Rows
// read the settings store (or the module that owns the value) and re-paint on change.

import "./styles/settings.css";
import { invoke } from "@tauri-apps/api/core";
import { setting, setSetting, onSettingsChange, type Settings } from "./settings-store";
import { libraryAddEnabled, setLibraryAddEnabled, onLibraryAddChange } from "./library-add";
import { esc } from "./collection-card";
import * as diag from "./diag";
import type { CardDef, CardInstance } from "./cards";

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

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
  options: { value: string; label: string }[];
}
type Row = ToggleRow | ChoiceRow;
interface Section {
  title: string;
  rows: Row[];
  /** Extra markup after the rows (a status line, action rows); events are wired by data attributes. */
  tail?: string;
}

const storeToggle = (id: string, label: string, key: BoolKey, hint?: () => string | undefined): ToggleRow => ({
  kind: "toggle",
  id,
  label,
  hint,
  get: () => setting(key),
  set: (on) => setSetting(key, on),
});

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

  const sections: Section[] = [
    // Labels: one short active statement each; the hint (hover) only where a word is
    // missing. Section names are the shortest noun that groups the rows.
    {
      title: "Window",
      rows: [
        storeToggle("aot", "Keep on top", "alwaysOnTop", () => "The window stays above other windows"),
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
          kind: "toggle",
          id: "hover",
          label: "Open menus on hover",
          get: () => setting("menuMode") === "hover",
          set: (on) => setSetting("menuMode", on ? "hover" : "click"),
        },
        storeToggle("autoflip", "Resize changes surface", "surfaceAutoFlip", () => "Off: the window resizes inside the current surface"),
        storeToggle("motion", "Animate look changes", "appearanceMotion", () => "Theme and skin switches fade into each other. Off: they change at once"),
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
          kind: "choice", id: "previous", label: "Previous rewinds", key: "previousReach",
          hint: "The list: the songs above the one you clicked",
          options: [{ value: "lookback", label: "The list" }, { value: "heard", label: "Played songs" }],
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
        {
          kind: "choice", id: "fullplay", label: "Count a play at", key: "fullPlayRule",
          hint: "When a song counts as played through, for Rewind",
          options: [{ value: "fraction", label: "90%" }, { value: "end", label: "End" }, { value: "scrobble", label: "Half or 4 min" }],
        },
        storeToggle("replayauto", "Make a Replay each week", "replayAuto", () => "A playlist of the past week's most-played songs, made for you"),
        {
          kind: "choice", id: "replayday", label: "Replay day", key: "replayDay",
          hint: "The day the weekly Replay is made",
          options: [
            { value: "mon", label: "Mon" }, { value: "tue", label: "Tue" }, { value: "wed", label: "Wed" }, { value: "thu", label: "Thu" },
            { value: "fri", label: "Fri" }, { value: "sat", label: "Sat" }, { value: "sun", label: "Sun" },
          ],
        },
        storeToggle("replaykeep", "Keep every Replay", "replayKeep", () => "Each week gets its own dated playlist in a Replay folder. Off: one playlist, replaced weekly"),
      ],
    },
    {
      title: "Library",
      rows: [
        {
          kind: "toggle",
          id: "libraryadd",
          label: "Add to Library",
          hint: () => "Can't remove from library via DeetsMusic",
          get: () => libraryAddEnabled(),
          set: (on) => setLibraryAddEnabled(on),
        },
        storeToggle("eagercounts", "Show playlist counts", "playlistEagerCounts", () => "One small request per playlist, once"),
        storeToggle("createsummon", "New playlist opens Search", "playlistCreateSummon"),
      ],
    },
    {
      title: "Cards",
      rows: [
        storeToggle("rewind", "Rewind card", "rewindCard", () =>
          setting("rewindAutoShown") ? "Your listening, ranked" : "Shows after 50 plays",
        ),
      ],
    },
    {
      title: "Extension",
      rows: [],
      // EXTENSION.md: bridge status + the two actions.
      tail: `<div class="set__status" id="set-ext-status">Bridge off</div>
        <button class="set__row set__action" type="button" data-action="ext-install" title="Opens the install page in your browser"><span class="set__label">Install guide</span></button>
        <button class="set__row set__action" type="button" data-action="ext-log" title="Copies the recent app log to the clipboard"><span class="set__label">Copy log</span></button>`,
    },
    {
      title: "Agents",
      rows: [
        {
          kind: "toggle",
          id: "agent",
          label: "Agent control",
          hint: () => "Lets a CLI or an AI app drive DeetsMusic on this PC",
          get: () => agentControl,
          set: (on) => {
            agentControl = on;
            invoke("settings_set_agent_control", { on }).catch((e) => console.error("[settings] agent", e));
            refreshExtension();
          },
        },
      ],
      // AGENT-SETUP.md: the live line, the per-client setup copy, the guide.
      tail: `<div class="set__status" id="set-agent-status">…</div>
        <div class="set__row set__row--choice" title="Copies the exact text for that app"><span class="set__label">Copy setup for</span><div class="set__seg">
          <button class="set__pill" type="button" data-setup="claude-desktop">Claude Desktop</button>
          <button class="set__pill" type="button" data-setup="claude-code">Claude Code</button>
          <button class="set__pill" type="button" data-setup="cursor">Cursor</button>
          <button class="set__pill" type="button" data-setup="other">Other</button>
        </div></div>
        <button class="set__row set__action" type="button" data-action="agent-guide" title="Opens the setup guide in your browser"><span class="set__label">Open guide</span></button>`,
    },
    {
      title: "Bugs",
      rows: [],
      // LOGGING.md: the rolling log file the app always writes; the report form and
      // "My reports" (support.md) join this section next.
      tail: `<button class="set__row set__action" type="button" data-action="log-folder" title="Shows the log file the app writes on this PC"><span class="set__label">Open log folder</span></button>`,
    },
  ];

  // The hint rides the row as a hover tooltip (`title`) — the labels stand on their own.
  const rowHTML = (r: Row): string => {
    const hint = r.kind === "toggle" ? r.hint?.() : r.hint;
    const tip = hint ? ` title="${esc(hint)}"` : "";
    const label = `<span class="set__label">${esc(r.label)}</span>`;
    if (r.kind === "toggle") {
      return `<button class="set__row set__row--toggle" type="button" role="switch" data-row="${r.id}" aria-checked="${r.get()}"${tip}>${label}<span class="set__dot" aria-hidden="true"></span></button>`;
    }
    const cur = r.get ? r.get() : String(setting(r.key!));
    const pills = r.options
      .map((o) => `<button class="set__pill" type="button" data-row="${r.id}" data-value="${esc(o.value)}" aria-pressed="${o.value === cur}">${esc(o.label)}</button>`)
      .join("");
    return `<div class="set__row set__row--choice"${tip}>${label}<div class="set__seg" role="radiogroup" aria-label="${esc(r.label)}">${pills}</div></div>`;
  };

  const render = () => {
    body.innerHTML =
      sections
        .map((s) => `<section class="set__section"><h3 class="set__head">${esc(s.title)}</h3>${s.rows.map(rowHTML).join("")}${s.tail ?? ""}</section>`)
        .join("");
    refreshExtension();
  };

  // ── extension block (EXTENSION.md): bridge status + the two actions ──
  interface BridgeInfo { port: number | null }
  const refreshExtension = () => {
    const el = body.querySelector<HTMLElement>("#set-ext-status");
    const ag = body.querySelector<HTMLElement>("#set-agent-status");
    if (!el && !ag) return;
    invoke<BridgeInfo>("bridge_info")
      .then((b) => {
        if (el) el.textContent = b.port ? `Bridge on 127.0.0.1:${b.port}` : "Bridge off (no free port)";
        if (ag) ag.textContent = !agentControl ? "Off" : b.port ? `Ready at 127.0.0.1:${b.port}` : "Off (no free port)";
      })
      .catch((e) => console.warn("[bridge] info", e));
  };
  const flash = (el: HTMLElement, text: string) => {
    const was = el.textContent;
    el.textContent = text;
    window.setTimeout(() => (el.textContent = was), 1200);
  };

  const byId = (id: string): Row | undefined => sections.flatMap((s) => s.rows).find((r) => r.id === id);

  body.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const action = t.closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action === "ext-install") {
      invoke("bridge_open_install_page").catch((err) => console.error("[bridge] install page", err));
      return;
    }
    if (action === "agent-guide") {
      invoke("agent_open_guide").catch((err) => console.error("[agent] guide", err));
      return;
    }
    if (action === "log-folder") {
      diag.flush(); // so the file the user is about to read has the front end's last events
      invoke("log_open_folder").catch((err) => console.error("[log] folder", err));
      return;
    }
    const setup = t.closest<HTMLElement>("[data-setup]");
    if (setup?.dataset.setup) {
      invoke<string>("agent_setup_text", { client: setup.dataset.setup }).then((text) =>
        navigator.clipboard.writeText(text).then(() => flash(setup, "Copied"), () => console.log(text)),
      );
      return;
    }
    if (action === "ext-log") {
      const label = t.closest<HTMLElement>("[data-action]")!.querySelector<HTMLElement>(".set__label")!;
      invoke<string>("bridge_log").then((text) =>
        navigator.clipboard.writeText(text).then(() => flash(label, "Copied"), () => console.log(text)),
      );
      return;
    }
    const pill = t.closest<HTMLElement>(".set__pill");
    if (pill?.dataset.row && pill.dataset.value !== undefined) {
      const r = byId(pill.dataset.row);
      if (r?.kind === "choice") {
        if (r.set) { r.set(pill.dataset.value); render(); }
        else setSetting(r.key!, pill.dataset.value as never);
      }
      return;
    }
    const toggle = t.closest<HTMLElement>(".set__row--toggle");
    if (toggle?.dataset.row) {
      const r = byId(toggle.dataset.row);
      if (r?.kind === "toggle") r.set(!r.get());
    }
  });

  // Re-paint on any change, whoever made it (the store, the Library Add module, the
  // Rust setting we cached). A full re-render is cheap here — a dozen rows.
  const unsubStore = onSettingsChange(render);
  const unsubLibAdd = onLibraryAddChange(render);
  invoke<{ minimizeToTray: boolean; agentControl: boolean }>("settings_get")
    .then((s) => { minimizeToTray = s.minimizeToTray; agentControl = s.agentControl; render(); })
    .catch((e) => console.warn("[settings] get", e));
  invoke<boolean>("autostart_get")
    .then((v) => { autostart = v; render(); })
    .catch((e) => console.warn("[settings] autostart", e));

  render();

  return {
    destroy() {
      unsubStore();
      unsubLibAdd();
      host.innerHTML = "";
    },
  };
}
