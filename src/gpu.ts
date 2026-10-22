// Graphics fallback (GRAPHICS-FALLBACK.md): is the window drawn by the graphics card, or in
// software? WebView2 draws with WARP (Windows' software rasteriser) when its GPU process came
// back without the card, after a driver update or a driver crash (2026-09-29). Then the heavy
// effects cost a whole CPU core, and only a restart gets the card back.
//
// This module ships in the release bundle. It reads the WebGL renderer name and sets the
// `graphics` fact ("accelerated" | "software"). The built-in rule that holds Reduce motion on is
// in rules-eval.ts (`row:graphicsFallback`), made by the *If graphics fail* row.
//
// Three reads (§4): once after the first paints, after each `gpu-process-failed` from Rust
// (src-tauri/src/gpu.rs), and every 5 minutes as the safety net.
//
// Getting the card back (§10, his calls 2026-10-20): in software, Rust watches Windows'
// adapter changes and says when a hardware adapter works again (`gpu-adapters`). Then the app
// restarts by itself while its window cannot be seen, between two songs if music plays, and
// comes back hidden or minimized, playing on. On screen, a toast asks. The rule is gpu-rules.ts.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { registerFact, registerChipText } from "./rules";
import { isSoftwareRenderer } from "./rules-eval";
import { quietAction, tellNoCard, type Card, type QuietState } from "./gpu-rules";
import { rendererName } from "./gpu-probe";
import { setting, onSettingsChange } from "./settings-store";
import { toast, type ToastHandle } from "./toast";
import { flushForRestart, saveNow } from "./queue-persist";
import { onPlayerState, onPlayerProgress, pausePlayback, playPause, isPlayingNow } from "./player";
import * as queue from "./queue";
import { inRoom } from "./room";
import { outputKind } from "./sound";
import { updateStatus } from "./updater";
import * as diag from "./diag";

const FIRST_READ_MS = 2000; // after the first paints
const TIMER_MS = 5 * 60_000; // the interval Apple health uses
const AFTER_EVENT_MS = [3000, 10_000]; // the new GPU process needs a moment to come up
/** Silence must last this long before a silent restart: a buffering song reads as not playing
 *  for a moment, and a restart then would stop the music (break-it pass, 2026-10-20). */
const SILENT_MS = 10_000;
const QUIET_LOG_KEY = "deets.gpu.quietRestarts"; // when each quiet restart ran (ms), for the guards
/** A start this soon after a quiet restart IS that restart's start (§10.5 Guards). */
const RESTART_START_MS = 2 * 60_000;
/** At most this many quiet restarts a day: a PC that stays in software (a blocked driver) while
 *  docks or remote sessions keep changing the adapters must not restart again and again. */
const DAILY_CAP = 2;
const NO_CARD_KEY = "deets.gpu.noCardTold"; // the no-card toast, once per install (§10.6)

type Graphics = "accelerated" | "software";

let graphics: Graphics | undefined; // undefined until the first read: no fact, so no rule holds
let startedSoftware = false;
let card: Card = "unknown";
let tried = false;
let windowState: "shown" | "tray" | "min" = "shown";
let playing = false;
let armed = false; // restart when the next song starts
let restarting = false;
let silentTimer: number | undefined;
const subs = new Set<() => void>();
let notice: ToastHandle | null = null;
let toldReady = false; // the card-is-back toast, once per software spell

const store = {
  get: (k: string): string | null => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null): void => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* storage off: the guards last this session only */
    }
  },
};

/** The quiet restarts of the last 24 h, newest last. */
function quietLog(): number[] {
  try {
    const list = JSON.parse(store.get(QUIET_LOG_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((t): t is number => typeof t === "number" && Date.now() - t < 86_400_000) : [];
  } catch {
    return [];
  }
}
const capped = (): boolean => quietLog().length >= DAILY_CAP;

/** The window is drawn in software now (WARP). Metal's material reads it (metal.ts). */
export const softwareDrawing = (): boolean => graphics === "software";
/** Call back when the renderer changes. */
export function onGraphicsChange(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

function setGraphics(now: Graphics, name: string, why: "start" | "event" | "timer"): void {
  if (now === graphics) return;
  graphics = now;
  diag.log("gpu:renderer", { name, soft: now === "software", why });
  subs.forEach((cb) => cb());
  if (now === "software") void invoke("gpu_watch_adapters").catch((e) => console.error("[gpu] watch", e));
  else {
    // Not expected in the same session (§1). If it happens, the rule stops by itself, and a later
    // fall starts over: a new card answer, a new toast.
    notice?.dismiss();
    notice = null;
    armed = false;
    card = "unknown";
    tried = false;
    toldReady = false;
  }
  decide();
}

/** Read the renderer and update the fact. "unknown" counts as accelerated at start (his call,
 *  2026-10-11): the effects never turn off on a guess. A later read that finds no name keeps the
 *  value: a GPU process still starting gives none (break-it pass, 2026-10-20). */
function read(why: "start" | "event" | "timer"): void {
  const name = rendererName();
  if (why !== "start" && name === "unknown") return;
  const now: Graphics = isSoftwareRenderer(name) ? "software" : "accelerated";
  if (why === "start") {
    startedSoftware = now === "software";
    // A quiet restart that came back on software again: no second one until a new change.
    const log = quietLog();
    const last = log.length ? log[log.length - 1] : undefined;
    tried = startedSoftware && (capped() || (last !== undefined && Date.now() - last < RESTART_START_MS));
    // A PC with no working card says so at once, not after the watch's settle (§10.9).
    if (startedSoftware) void invoke<CardAnswer>("gpu_card_ready").then((a) => onCard(a, "start")).catch(() => {});
  }
  setGraphics(now, name, why);
}

interface CardAnswer {
  ready: boolean;
  name: string | null;
  events: number;
}

function onCard(a: CardAnswer | null, why: "start" | "watch"): void {
  if (!a) return; // a build with no answer (the web demo)
  card = a.ready ? "ready" : "none";
  if (a.events > 0 && !capped()) tried = false; // a new adapter change: the guard starts over
  diag.log("gpu:adapters", { ready: a.ready, name: a.name, events: a.events, why });
  if (tellNoCard({ mode: setting("graphicsFallback"), startedSoftware, card, toldBefore: store.get(NO_CARD_KEY) === "1" })) {
    store.set(NO_CARD_KEY, "1");
    const reduces = setting("graphicsFallback") === "save";
    toast({
      kind: "info",
      sticky: true,
      text: reduces
        ? "DeetsMusic draws in software on this PC, so it keeps motion low."
        : "DeetsMusic draws in software on this PC, so it may feel slow. Settings › Motion › Reduce motion helps.",
      actions: [button("OK")],
    });
  }
  decide();
}

/** A toast button, with its press in the log (§6): toast.ts logs no button of its own. */
const button = (label: string, run: () => void = () => {}) => ({
  label,
  run: () => {
    diag.log("gpu:toast", { button: label });
    run();
  },
});

/** Typed text a restart would lose: a focused text field that holds something. */
function typing(): boolean {
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null;
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return el.value.trim() !== "";
  if (el instanceof HTMLInputElement) return /^(text|search|)$/.test(el.type) && el.value.trim() !== "";
  return el.isContentEditable && (el.textContent ?? "").trim() !== "";
}

/** Something a restart would break (§10.5 Guards): a listening room, an AirPlay speaker (playing
 *  or paused: its session would drop), an update that downloads or waits to install, typed text. */
function busy(): boolean {
  const update = updateStatus()?.state;
  return inRoom() || outputKind() === "airplay" || update === "downloading" || update === "ready" || typing();
}

const state = (over: Partial<QuietState> = {}): QuietState => ({
  mode: setting("graphicsFallback"), graphics, card, window: windowState, playing, tried, busy: busy(), ...over,
});

/** Ask the rule (gpu-rules.ts) and act on its answer. */
function decide(): void {
  if (restarting) return;
  const action = quietAction(state());
  armed = action === "songStart";
  if (action !== "now") {
    window.clearTimeout(silentTimer);
    silentTimer = undefined;
  }
  if (action === "now") {
    // Silence must hold for a while first (SILENT_MS): then ask again.
    if (silentTimer === undefined)
      silentTimer = window.setTimeout(() => {
        silentTimer = undefined;
        if (!isPlayingNow() && quietAction(state({ playing: false })) === "now") void quietRestart("now");
        else decide();
      }, SILENT_MS);
  } else if (action === "toast") tellReady();
}

/** The toast (§10.6): the window is on screen and the card is back. Once per software spell. */
function tellReady(): void {
  if (toldReady) return;
  toldReady = true;
  notice = toast({
    kind: "warn",
    sticky: true,
    text: "The graphics card is back. Restart to use it. DeetsMusic also restarts by itself when its window is hidden.",
    actions: [button("Restart now", () => void restart()), button("Later")],
  });
}

/** Restart now (the toast): music plays on where it was, as with an update. */
async function restart(): Promise<void> {
  if (restarting) return;
  restarting = true;
  const play = isPlayingNow();
  await flushForRestart(play);
  diag.flush();
  try {
    await invoke("app_restart", { why: "graphics card ready again" });
  } catch (e) {
    restarting = false;
    await saveNow();
    toast({ kind: "warn", text: "Couldn't restart DeetsMusic. Close it and open it again." });
    console.error("[gpu] restart", e);
  }
}

/** The quiet restart (§10.5): the window is hidden or minimized, and comes back the same way. */
async function quietRestart(moment: "now" | "songStart"): Promise<void> {
  if (restarting) return;
  restarting = true;
  armed = false;
  const play = moment === "songStart";
  if (play) await pausePlayback("graphicsRestart"); // the new song waits for the new start
  await flushForRestart(play);
  // The waits above give the user time to act: check again before the restart (break-it pass).
  const still = quietAction(state({ playing: play }));
  if (still !== moment) return undo(play, `changed: ${still}`);
  store.set(QUIET_LOG_KEY, JSON.stringify([...quietLog(), Date.now()]));
  diag.log("gpu:quietRestart", { moment, playing: play, window: windowState, renderer: rendererName() });
  diag.flush();
  try {
    await invoke("app_restart_quiet", { window: windowState === "min" ? "min" : "tray" });
  } catch (e) {
    store.set(QUIET_LOG_KEY, JSON.stringify(quietLog().slice(0, -1)));
    console.error("[gpu] quiet restart", e);
    await undo(play, "failed");
  }
}

/** A quiet restart that did not happen: the music plays on if it played, and no later start
 *  reads the restart marks. */
async function undo(play: boolean, why: string): Promise<void> {
  diag.log("gpu:quietRestart", { cancelled: why });
  await saveNow();
  if (play && !isPlayingNow()) await playPause("graphicsRestart").catch(() => {});
  restarting = false;
  decide();
}

/** The main window: on screen, hidden in the tray, or minimized (ambient.ts reads it the same way). */
function watchWindow(): void {
  const win = getCurrentWindow();
  let seq = 0;
  const check = async () => {
    const mine = ++seq;
    let next: typeof windowState = "shown";
    try {
      const [visible, minimized] = await Promise.all([win.isVisible(), win.isMinimized()]);
      next = !visible ? "tray" : minimized ? "min" : "shown";
    } catch {
      return;
    }
    if (mine !== seq || next === windowState) return;
    windowState = next;
    decide();
  };
  void win.onResized(check);
  void win.onFocusChanged(check);
  void listen("main-visibility", check);
  void check();
}

/** Playing or not, and the next song's start while a song-start restart is armed (F2 A). A new
 *  song is a new id, or the same song again from the top (repeat one, a one-song queue). */
function watchPlayback(): void {
  const idOf = () => {
    const c = queue.getCurrent();
    return c ? (c.catalogId ?? c.libraryId ?? "") : "";
  };
  let lastId = idOf();
  let lastAt = 0;
  const songStarted = (why: string) => {
    if (!armed || restarting) return;
    // A guard that appeared since it armed (a room, AirPlay, a shown window) wins.
    if (quietAction(state({ playing: true })) !== "songStart") return decide();
    diag.log("gpu:songStart", { why });
    void quietRestart("songStart");
  };
  onPlayerState((s) => {
    const id = idOf();
    const changed = id !== lastId;
    lastId = id;
    if (s.playing !== playing) {
      playing = s.playing;
      if (!armed) decide();
    }
    if (changed && s.playing) songStarted("next");
  });
  onPlayerProgress((p) => {
    if (lastAt > 5 && p.currentTime < 2 && idOf() === lastId) songStarted("again");
    lastAt = p.currentTime;
  });
}

/** main.ts, in the late group with the other Rulez facts. */
export function initGpu(): void {
  registerFact("graphics", () => graphics, {
    seam: (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  });
  // The rule chip's words beside its two rows (RULES.md §9).
  registerChipText("graphicsFallback", {
    name: "If graphics fail",
    bolt: (t) =>
      t === "key:glassCanvas"
        ? "The graphics card stopped, so the canvas shows Aurora until the card is back. Your own setting comes back then."
        : "The graphics card stopped, so this is on until the card is back. Your own setting comes back then.",
    hand: () => "Effects are back until DeetsMusic restarts. Press to turn them off again.",
  });
  watchWindow();
  watchPlayback();
  onSettingsChange((k) => {
    if (k === "graphicsFallback") decide();
  });
  window.setTimeout(() => read("start"), FIRST_READ_MS);
  window.setInterval(() => {
    read("timer");
    if (graphics !== "software") return;
    void invoke("gpu_watch_adapters").catch(() => {}); // a watch that failed starts again
    decide(); // a guard (a room, typed text, an update) may have ended
  }, TIMER_MS);
  void listen<{ kind: number; exitCode: number | null }>("gpu-process-failed", (e) => {
    diag.log("gpu:processFailed", { kind: e.payload.kind, exitCode: e.payload.exitCode });
    // The effects go off at once (§10.4 item 3); the reads give them back if the new GPU
    // process is on the card.
    setGraphics("software", "(process failed)", "event");
    AFTER_EVENT_MS.forEach((ms) => window.setTimeout(() => read("event"), ms));
  });
  void listen<CardAnswer>("gpu-adapters", (e) => onCard(e.payload, "watch"));
}
