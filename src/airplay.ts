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
import { enterRows } from "./pop";
import { setAirplayOutput } from "./sound";

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
let outputSpeaker = "";
const applyTakeover = (c: Connected | null) => {
  // Sound (SOUND.md §2.2): the output is the speaker while one plays, so its preset and the
  // panel's words follow it.
  const name = c?.speaker.name ?? "";
  if (name !== outputSpeaker) {
    outputSpeaker = name;
    setAirplayOutput(c ? name : null);
  }
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
  /** The "Play on" panel (portaled to <body>): a parent dropdown counts clicks in it as inside. */
  readonly panel: HTMLElement;
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
  panel.className = "ap pop";
  panel.dataset.frames = "airplay"; // the dropdown's [perf] frames menu line
  panel.hidden = true;
  panel.setAttribute("role", "menu");
  panel.setAttribute("aria-label", "Play on");
  // Portaled to <body>: a card's backdrop-filter (Glass) makes the card a stacking context,
  // so a panel inside it was painted under the next card and its frost saw only its own card.
  document.body.appendChild(panel);

  // The fixed parts are built once. Speaker rows are kept by key and updated in place, so a
  // repaint (the 1 s poll, a scan result) never rebuilds the panel under the pointer, and a
  // new speaker slides in while the height follows it.
  // The title row carries the scan as a refresh square (the Library / Playlists Sync button).
  panel.innerHTML =
    `<div class="ap__head"><span class="ap__title">Play on</span>` +
    `<button class="panel__action ap__scan" type="button" data-scan aria-label="Scan for speakers" title="Scan for speakers">` +
    `<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline>` +
    `<polyline points="1 20 1 14 7 14"></polyline>` +
    `<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg></button></div>` +
    `<div class="ap__list"></div><div class="ap__state"></div>`;
  const list = panel.querySelector<HTMLElement>(".ap__list")!;
  const stateEl = panel.querySelector<HTMLElement>(".ap__state")!;
  const scanBtn = panel.querySelector<HTMLButtonElement>("[data-scan]")!;
  const rowEls = new Map<string, HTMLButtonElement>();
  const speakerOf = new Map<string, Speaker | null>();
  const keyOf = (sp: Speaker | null) => (sp ? `${sp.ip}:${sp.port}` : "this");
  const setText = (el: Element, text: string) => {
    if (el.textContent !== text) el.textContent = text;
  };

  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const token = (name: string) => getComputedStyle(panel).getPropertyValue(name).trim();
  const tokenMs = (name: string) => {
    const v = token(name);
    const n = parseFloat(v);
    return Number.isFinite(n) ? (v.endsWith("ms") ? n : n * 1000) : 0;
  };

  // The height moves from `from` to the new content's height instead of jumping.
  let grow: Animation | null = null;
  const animateHeight = (from: number) => {
    grow?.cancel();
    grow = null;
    panel.classList.remove("is-growing");
    if (panel.hidden || !from || reduced()) return;
    const to = panel.offsetHeight;
    if (Math.abs(to - from) < 1) return;
    panel.classList.add("is-growing");
    const a = panel.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: tokenMs("--pop-grow"),
      easing: token("--pop-ease") || "ease",
    });
    grow = a;
    a.onfinish = () => {
      if (grow !== a) return;
      grow = null;
      panel.classList.remove("is-growing");
    };
  };

  // Hang the fixed panel under the square, right edges aligned; flip above when it would
  // run off the bottom. The side is chosen on open and only changes when the panel no longer
  // fits below, so it doesn't jump between sides while it grows. Above, it is anchored by its
  // bottom edge, so the growth goes up. The gap is the panel's own margin (a skin token).
  let above = false;
  const place = (decide = false) => {
    if (panel.hidden) return;
    const r = square.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const gap = parseFloat(getComputedStyle(panel).marginTop) || 0;
    const w = panel.offsetWidth;
    const h = panel.scrollHeight + (panel.offsetHeight - panel.clientHeight); // the final height, even mid-grow
    const fitsBelow = r.bottom + gap + h <= vh;
    if (decide || (!above && !fitsBelow)) above = !fitsBelow;
    panel.toggleAttribute("data-above", above);
    panel.style.left = `${Math.max(gap, Math.min(r.right - w, vw - w - gap))}px`;
    if (above) {
      panel.style.top = "auto";
      panel.style.bottom = `${Math.max(0, vh - r.top + gap)}px`;
    } else {
      panel.style.bottom = "auto";
      panel.style.top = `${r.bottom}px`;
    }
  };

  const render = () => {
    const from = panel.hidden ? 0 : panel.offsetHeight; // before the rows change (mid-grow: the current height)
    const c = status.connected;
    square.dataset.state = c ? "on" : status.connecting ? "connecting" : "idle";
    square.title = c ? `Playing on ${c.speaker.name}` : "Plays on a speaker or TV on your network";

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
    const keys = new Set(rows.map((r) => keyOf(r.sp)));
    for (const [k, el] of rowEls) {
      if (keys.has(k)) continue;
      el.remove();
      rowEls.delete(k);
      speakerOf.delete(k);
    }
    const fresh: HTMLElement[] = [];
    rows.forEach(({ sp, model }, i) => {
      const k = keyOf(sp);
      let el = rowEls.get(k);
      if (!el) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "ap__row";
        row.setAttribute("role", "menuitemradio");
        row.dataset.key = k;
        row.innerHTML = `<span class="ap__name"></span><span class="ap__model"></span><span class="ap__dot" aria-hidden="true"></span>`;
        rowEls.set(k, row);
        fresh.push(row);
        el = row;
      }
      speakerOf.set(k, sp);
      el.setAttribute("aria-checked", String(sp ? sameSpeaker(sp, current) : !current && !status.connecting));
      el.dataset.pending = String(sp ? status.connecting === sp.name : false);
      setText(el.querySelector(".ap__name")!, sp ? sp.name : "This computer");
      const modelEl = el.querySelector<HTMLElement>(".ap__model")!;
      setText(modelEl, model);
      modelEl.hidden = !model;
      if (list.children[i] !== el) list.insertBefore(el, list.children[i] ?? null);
    });

    let state: string;
    if (note) state = note;
    else if (status.connecting) state = `Connecting to ${status.connecting}…`;
    else if (c) state = `Playing on ${c.speaker.name} and this computer · ${fmtDelay(c.latencyMs)}`;
    else if (scanning) state = "Looking for speakers…";
    else if (status.speakers.length === 0) state = "No speakers found";
    else state = "";

    setText(stateEl, state);
    if (note && !c) stateEl.dataset.tone = "note";
    else delete stateEl.dataset.tone;
    scanBtn.disabled = scanning;
    scanBtn.classList.toggle("is-busy", scanning); // spins while a scan runs

    if (panel.hidden) return;
    enterRows(fresh); // a speaker found while the panel shows slides in
    animateHeight(from);
    place(); // the height changed (a scan result, a note) — and it may no longer fit below
  };
  panels.add(render);
  render();

  panel.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-scan]")) {
      void scan();
      return;
    }
    const k = t.closest<HTMLElement>(".ap__row[data-key]")?.dataset.key;
    if (!k || !speakerOf.has(k)) return;
    const sp = speakerOf.get(k)!;
    if (sp) {
      if (!sameSpeaker(sp, status.connected?.speaker)) void connect(sp);
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
      place(true);
      enterRows(list.children); // every row, one after another
      note = null;
      void refresh();
      void scan();
    } else {
      schedule();
    }
  });
  observer.observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  const onResize = () => place(true);
  window.addEventListener("resize", onResize);

  return {
    panel,
    destroy() {
      observer.disconnect();
      grow?.cancel();
      window.removeEventListener("resize", onResize);
      panel.remove(); // it lives on <body>, so it does not leave with the card's host
      if (wasOpen) openPanels -= 1;
      panels.delete(render);
      dropdown.destroy();
      schedule();
    },
  };
}
