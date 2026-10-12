// Graphics fallback (GRAPHICS-FALLBACK.md): is the window drawn by the graphics card, or in
// software? WebView2 draws with WARP (Windows' software rasteriser) when its GPU process came
// back without the card, after a driver update or a driver crash (2026-09-29). Then the heavy
// effects cost a whole CPU core, and only a restart gets the card back.
//
// This module ships in the release bundle. It reads the WebGL renderer name, sets the
// `graphics` fact ("accelerated" | "software"), and shows the toast once per session. The
// built-in rule that holds the effects off is in rules-eval.ts (`row:graphicsFallback`), made
// by the *If graphics fail* row.
//
// Three reads (§4): once after the first paints, after each `gpu-process-failed` from Rust
// (src-tauri/src/gpu.rs), and every 5 minutes as the safety net.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { registerFact, registerChipText, holdForSession } from "./rules";
import { isSoftwareRenderer } from "./rules-eval";
import { rendererName } from "./gpu-probe";
import { setting } from "./settings-store";
import { toast, type ToastHandle } from "./toast";
import { flushForRestart } from "./queue-persist";
import * as diag from "./diag";

const FIRST_READ_MS = 2000; // after the first paints
const TIMER_MS = 5 * 60_000; // the interval Apple health uses
const AFTER_EVENT_MS = [3000, 10_000]; // the new GPU process needs a moment to come up
const RULE_ID = "row:graphicsFallback";

type Graphics = "accelerated" | "software";

let graphics: Graphics | undefined; // undefined until the first read: no fact, so no rule holds
const subs = new Set<() => void>();
let notice: ToastHandle | null = null;
let told = false; // once per session

/** Read the renderer and update the fact. "unknown" counts as accelerated (his call,
 *  2026-10-11): the effects never turn off on a guess. */
function read(why: "start" | "event" | "timer"): void {
  const name = rendererName();
  const now: Graphics = isSoftwareRenderer(name) ? "software" : "accelerated";
  if (now === graphics) return;
  const was = graphics;
  graphics = now;
  diag.log("gpu:renderer", { name, soft: now === "software", why });
  subs.forEach((cb) => cb());
  if (now === "software") tell();
  else if (was === "software") {
    // Not expected in the same session (§1). If it happens, the rule stops by itself; the toast goes.
    notice?.dismiss();
    notice = null;
  }
}

/** A toast button, with its press in the log (§6): toast.ts logs no button of its own. */
const button = (label: string, run: () => void = () => {}) => ({
  label,
  run: () => {
    diag.log("gpu:toast", { button: label });
    run();
  },
});

async function restart(): Promise<void> {
  await flushForRestart();
  diag.flush();
  try {
    await invoke("app_restart", { why: "graphics fell back to software" });
  } catch (e) {
    toast({ kind: "warn", text: "Couldn't restart DeetsMusic. Close it and open it again." });
    console.error("[gpu] restart", e);
  }
}

/** The toast (§5): a sticky question whose Later is the close, once per session. */
function tell(): void {
  const mode = setting("graphicsFallback");
  if (mode === "off" || told) return;
  told = true;
  notice =
    mode === "save"
      ? toast({
          kind: "warn",
          sticky: true,
          text: "The graphics card stopped, so DeetsMusic draws in software. Some effects are off to keep it smooth. Restart to get them back.",
          actions: [button("Restart now", () => void restart()), button("Turn effects on", () => holdForSession(RULE_ID)), button("Later")],
        })
      : toast({
          kind: "warn",
          sticky: true,
          text: "The graphics card stopped, so DeetsMusic draws in software and may feel slow. Restart to fix it.",
          actions: [button("Restart now", () => void restart()), button("Later")],
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
  // The rule chip's words beside the five rows (RULES.md §9).
  registerChipText("graphicsFallback", {
    name: "If graphics fail",
    bolt: (t) =>
      t === "key:glassCanvas"
        ? "The graphics card stopped, so the canvas shows Aurora until DeetsMusic restarts. Your own setting comes back then."
        : "The graphics card stopped, so this is off until DeetsMusic restarts. Your own setting comes back then.",
    hand: () => "Effects are back until DeetsMusic restarts. Press to turn them off again.",
  });
  window.setTimeout(() => read("start"), FIRST_READ_MS);
  window.setInterval(() => read("timer"), TIMER_MS);
  void listen<{ kind: number; exitCode: number | null }>("gpu-process-failed", (e) => {
    diag.log("gpu:processFailed", { kind: e.payload.kind, exitCode: e.payload.exitCode });
    AFTER_EVENT_MS.forEach((ms) => window.setTimeout(() => read("event"), ms));
  });
}
