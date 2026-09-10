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
  key: keyof Settings;
  options: { value: string; label: string }[];
}
type Row = ToggleRow | ChoiceRow;
interface Section {
  title: string;
  rows: Row[];
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

  // Minimize to Tray lives in Rust (the close policy runs before JS can answer);
  // cache the value here and write through.
  let minimizeToTray = true;

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
  ];

  // The hint rides the row as a hover tooltip (`title`) — the labels stand on their own.
  const rowHTML = (r: Row): string => {
    const hint = r.kind === "toggle" ? r.hint?.() : r.hint;
    const tip = hint ? ` title="${esc(hint)}"` : "";
    const label = `<span class="set__label">${esc(r.label)}</span>`;
    if (r.kind === "toggle") {
      return `<button class="set__row set__row--toggle" type="button" role="switch" data-row="${r.id}" aria-checked="${r.get()}"${tip}>${label}<span class="set__dot" aria-hidden="true"></span></button>`;
    }
    const cur = String(setting(r.key));
    const pills = r.options
      .map((o) => `<button class="set__pill" type="button" data-row="${r.id}" data-value="${esc(o.value)}" aria-pressed="${o.value === cur}">${esc(o.label)}</button>`)
      .join("");
    return `<div class="set__row set__row--choice"${tip}>${label}<div class="set__seg" role="radiogroup" aria-label="${esc(r.label)}">${pills}</div></div>`;
  };

  const render = () => {
    body.innerHTML =
      sections
        .map((s) => `<section class="set__section"><h3 class="set__head">${esc(s.title)}</h3>${s.rows.map(rowHTML).join("")}</section>`)
        .join("") +
      `<section class="set__section"><h3 class="set__head">Extension</h3>
        <div class="set__status" id="set-ext-status">Bridge off</div>
        <button class="set__row set__action" type="button" data-action="ext-install" title="Opens the install page in your browser"><span class="set__label">Install guide</span></button>
        <button class="set__row set__action" type="button" data-action="ext-log" title="Copies the bridge log to the clipboard"><span class="set__label">Copy log</span></button>
      </section>`;
    refreshExtension();
  };

  // ── extension block (EXTENSION.md): bridge status + the two actions ──
  interface BridgeInfo { port: number | null }
  const refreshExtension = () => {
    const el = body.querySelector<HTMLElement>("#set-ext-status");
    if (!el) return;
    invoke<BridgeInfo>("bridge_info")
      .then((b) => { el.textContent = b.port ? `Bridge on 127.0.0.1:${b.port}` : "Bridge off (no free port)"; })
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
      if (r?.kind === "choice") setSetting(r.key, pill.dataset.value as never);
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
  invoke<{ minimizeToTray: boolean }>("settings_get")
    .then((s) => { minimizeToTray = s.minimizeToTray; render(); })
    .catch((e) => console.warn("[settings] get", e));

  render();

  return {
    destroy() {
      unsubStore();
      unsubLibAdd();
      host.innerHTML = "";
    },
  };
}
