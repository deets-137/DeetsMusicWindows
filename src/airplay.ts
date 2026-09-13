// AirPlay (docs/AIRPLAY.md): the "Play on" dropdown behind the AirPlay square.
// Two squares exist — the titlebar Vol. pill's panel (mini/midi) and the stage
// volume row (max); CSS shows exactly one per surface. Both mount through
// `mountAirplay` and share this module's one state, so whichever is visible
// reads the same thing.
//
// Rust owns the session (airplay.rs). This file polls `airplay_status` only
// while a panel is open or a speaker is connected, takes the app's one volume
// slider over for the speaker while connected (player.setVolumeSink), and keeps
// every word in the panel plain: "Play on", "This computer", "Playing on X".

import { invoke } from "@tauri-apps/api/core";
import { makeDropdown, type DropdownHandle } from "./dropdown";
import { setVolumeSink, reflectExternalVolume } from "./player";
import { esc } from "./collection-card";

export interface Speaker {
  name: string;
  ip: string;
  port: number;
}
interface SpeakerInfo extends Speaker {
  model: string;
}
interface Connected {
  speaker: Speaker;
  seconds: number;
  latencyMs: number;
  volume: number | null;
}
interface Status {
  connected: Connected | null;
  connecting: string | null;
  error: string | null;
  lastSpeaker: Speaker | null;
  speakers: SpeakerInfo[];
  firewallSeeded: boolean;
}

const api = {
  scan: () => invoke<SpeakerInfo[]>("airplay_scan"),
  connect: (speaker: Speaker) => invoke<void>("airplay_connect", { speaker }),
  disconnect: () => invoke<void>("airplay_disconnect"),
  status: () => invoke<Status>("airplay_status"),
  volume: (pct: number) => invoke<void>("airplay_volume", { pct }),
  firewallPrompt: () => invoke<void>("airplay_firewall_prompt"),
};

// ── one state, many panels ──

let status: Status = { connected: null, connecting: null, error: null, lastSpeaker: null, speakers: [], firewallSeeded: true };
let scanning = false;
let busy = false;
/** A note shown in the state line for a moment (the firewall sentence, a failure). */
let note: string | null = null;
const panels = new Set<() => void>();
const repaint = () => panels.forEach((p) => p());

const sameSpeaker = (a: Speaker | null | undefined, b: Speaker | null | undefined) => !!a && !!b && a.ip === b.ip && a.port === b.port;
const fmtDelay = (ms: number) => `${(ms / 1000).toFixed(1)} s behind`;

// ── volume takeover (AIRPLAY.md decision 4): while connected, the app slider
//    drives the speaker's volume and follows Siri / the touch surface ──
let volTimer = 0;
let volHeldUntil = 0; // a drag owns the slider for a moment; the poll must not yank it back
let takenOver = false;
const applyTakeover = (c: Connected | null) => {
  if (c && !takenOver) {
    takenOver = true;
    setVolumeSink(
      (v) => {
        volHeldUntil = Date.now() + 2000;
        window.clearTimeout(volTimer);
        volTimer = window.setTimeout(() => api.volume(v * 100).catch((e) => console.warn("[airplay] volume", e)), 120);
      },
      c.volume == null ? undefined : c.volume / 100,
    );
  } else if (!c && takenOver) {
    takenOver = false;
    setVolumeSink(null);
  } else if (c && c.volume != null && Date.now() > volHeldUntil) {
    reflectExternalVolume(c.volume / 100);
  }
};

// ── the poll: 1 s while a panel is open, 2 s while connected, else off ──
let openPanels = 0;
let pollTimer = 0;
const refresh = async () => {
  try {
    const s = await api.status();
    const wasConnected = !!status.connected;
    status = s;
    applyTakeover(s.connected);
    if (wasConnected && !s.connected && s.error) note = s.error; // "Lost Living Room."
    if (!s.firewallSeeded && !note) note = null;
  } catch (e) {
    console.warn("[airplay] status", e);
  }
  repaint();
  schedule();
};
const schedule = () => {
  window.clearTimeout(pollTimer);
  const ms = openPanels > 0 ? 1000 : status.connected || status.connecting ? 2000 : 0;
  if (ms) pollTimer = window.setTimeout(() => void refresh(), ms);
};

const scan = async () => {
  if (scanning) return;
  scanning = true;
  repaint();
  try {
    status.speakers = await api.scan();
  } catch (e) {
    console.warn("[airplay] scan", e);
  } finally {
    scanning = false;
    repaint();
  }
};

const connect = async (sp: Speaker) => {
  if (busy) return;
  busy = true;
  note = null;
  status.error = null;
  status.connecting = sp.name;
  repaint();
  try {
    if (!status.firewallSeeded) {
      note = "Windows needs to let the speaker talk back to DeetsMusic. Click Yes on the next prompt.";
      repaint();
      await api.firewallPrompt().catch((e) => console.warn("[airplay] firewall", e));
      status.firewallSeeded = true;
      note = null;
    }
    await api.connect(sp);
  } catch (e) {
    note = String(e);
  } finally {
    busy = false;
    status.connecting = null;
    await refresh();
  }
};

const disconnect = async () => {
  if (busy) return;
  busy = true;
  repaint();
  try {
    await api.disconnect();
  } catch (e) {
    note = String(e);
  } finally {
    busy = false;
    await refresh();
  }
};

/** Boot: learn whether a session survived a reload and start following it. */
export function initAirplay(): void {
  void refresh();
}

// ── a panel on one square ──

export interface AirplayMount {
  destroy(): void;
}

/**
 * Wrap `square` (an AirPlay button) in a positioned root and hang the "Play on"
 * panel off it. The square's `data-state` (idle / connecting / on) drives the glyph.
 */
export function mountAirplay(square: HTMLElement): AirplayMount {
  const root = document.createElement("div");
  root.className = "ap-root";
  square.replaceWith(root);
  root.appendChild(square);
  square.hidden = false;
  square.setAttribute("aria-haspopup", "true");
  square.setAttribute("aria-expanded", "false");

  const panel = document.createElement("div");
  panel.className = "ap";
  panel.hidden = true;
  panel.setAttribute("role", "menu");
  panel.setAttribute("aria-label", "Play on");
  // Portaled to <body>: a card's backdrop-filter (Glass) makes the card a stacking context,
  // so a panel inside it was painted under the next card and its frost saw only its own card.
  document.body.appendChild(panel);

  // Hang the fixed panel under the square, right edges aligned; flip above when it would
  // run off the bottom. The gap is the panel's own margin (a skin token), read back here.
  const place = () => {
    if (panel.hidden) return;
    const r = square.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const gap = parseFloat(getComputedStyle(panel).marginTop) || 0;
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const left = Math.max(gap, Math.min(r.right - w, vw - w - gap));
    const below = r.bottom;
    const top = below + gap + h > vh ? Math.max(0, r.top - h - 2 * gap) : below;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  };

  const render = () => {
    const c = status.connected;
    square.dataset.state = c ? "on" : status.connecting ? "connecting" : "idle";
    square.title = c ? `Playing on ${c.speaker.name}` : "AirPlay";

    // The list: This computer, then every speaker found; the last-used speaker
    // shows even before a scan finds it.
    const rows: { sp: Speaker | null; model: string }[] = [{ sp: null, model: "" }];
    const seen = new Set<string>();
    for (const s of status.speakers) {
      rows.push({ sp: s, model: s.model });
      seen.add(`${s.ip}:${s.port}`);
    }
    if (status.lastSpeaker && !seen.has(`${status.lastSpeaker.ip}:${status.lastSpeaker.port}`)) {
      rows.splice(1, 0, { sp: status.lastSpeaker, model: "Last used" });
    }
    const current = c?.speaker ?? null;
    const rowHTML = rows
      .map(({ sp, model }, i) => {
        const on = sp ? sameSpeaker(sp, current) : !current && !status.connecting;
        const pending = sp ? status.connecting === sp.name : false;
        const name = sp ? sp.name : "This computer";
        return `<button class="ap__row" type="button" role="menuitemradio" data-i="${i}" aria-checked="${on}" data-pending="${pending}">
          <span class="ap__name">${esc(name)}</span>${model ? `<span class="ap__model">${esc(model)}</span>` : ""}<span class="ap__dot" aria-hidden="true"></span>
        </button>`;
      })
      .join("");

    let state: string;
    if (note) state = note;
    else if (status.connecting) state = `Connecting to ${status.connecting}…`;
    else if (c) state = `Playing on ${c.speaker.name} and this computer · ${fmtDelay(c.latencyMs)}`;
    else if (scanning) state = "Looking for speakers…";
    else if (status.speakers.length === 0) state = "No speakers found";
    else state = "";

    panel.innerHTML = `<div class="ap__head">Play on</div>${rowHTML}
      <div class="ap__state"${note && !c ? ' data-tone="note"' : ""}>${esc(state)}</div>
      <button class="ap__row ap__row--scan" type="button" data-scan${scanning ? " disabled" : ""}><span class="ap__name">${scanning ? "Scanning…" : "Scan again"}</span></button>`;
    (panel as HTMLElement & { _rows?: typeof rows })._rows = rows;
    place(); // the row count changes the height (a scan result, a flip above)
  };
  panels.add(render);
  render();

  panel.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-scan]")) {
      void scan();
      return;
    }
    const row = t.closest<HTMLElement>(".ap__row[data-i]");
    if (!row) return;
    const rows = (panel as HTMLElement & { _rows?: { sp: Speaker | null }[] })._rows ?? [];
    const pick = rows[Number(row.dataset.i)];
    if (!pick) return;
    if (pick.sp) {
      if (!sameSpeaker(pick.sp, status.connected?.speaker)) void connect(pick.sp);
    } else if (status.connected || status.connecting) {
      void disconnect();
    }
  });

  let wasOpen = false;
  const dropdown: DropdownHandle = makeDropdown({
    root,
    trigger: square,
    panel,
    shouldStayOpen: () => busy,
  });
  // The dropdown primitive owns open/close; watch the panel to run the scan and the poll.
  const observer = new MutationObserver(() => {
    const open = !panel.hidden;
    if (open === wasOpen) return;
    wasOpen = open;
    openPanels += open ? 1 : -1;
    if (open) {
      place();
      note = null;
      void refresh();
      void scan();
    } else {
      schedule();
    }
  });
  observer.observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  window.addEventListener("resize", place);

  return {
    destroy() {
      observer.disconnect();
      window.removeEventListener("resize", place);
      panel.remove(); // it lives on <body>, so it does not leave with the card's host
      if (wasOpen) openPanels -= 1;
      panels.delete(render);
      dropdown.destroy();
      schedule();
    },
  };
}
