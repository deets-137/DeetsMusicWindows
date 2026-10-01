// Dev-only launch timeline (DEBUGGING.md §Launch, 2026-09-29). Each start-up writes one line:
//
//   [perf] launch module 142 · handler 160→301 · late 575 · library 512 · queue 488 ·
//          ready 530 · lift 1790 · configured 1150 · warm 1420 (ms from navigation start)
//
// Every number is `performance.now()`, so it counts from the main page's navigation start,
// not from the exe start: the exe start → navigation part is Rust and WebView2, read from the
// process start time (DEBUGGING.md §Launch has the recipe). The page's parts:
//   module     main.ts's own body starts (every import has been evaluated)
//   handler    the DOMContentLoaded handler: begin → end (the critical path)
//   late       the parts that start under the launch cover are all done (main.ts `later`)
//   library    the library store's first load is in (track-store.ts)
//   queue      the last session's queue is restored
//   ready      `main_ready` returned: Rust has shown the window
//   lift       the cover's lift has ended (`deets:boot-done`)
//   configured MusicKit is configured (player.ts)
//   warm       the DRM module is warm: the first click pays neither cost
// Gated on TELEMETRY like frames.ts: the installed build ships none of it. `window.__launch`
// holds the same numbers for a script.

import { invoke } from "@tauri-apps/api/core";
import { TELEMETRY } from "./telemetry-on";
import { mark } from "./marks";

const ORDER = ["module", "handler:begin", "handler:end", "late", "library", "queue", "ready", "lift", "configured", "warm"] as const;
type Name = (typeof ORDER)[number];
const at: Partial<Record<Name, number>> = {};
let written = false;

if (TELEMETRY) (window as unknown as { __launch?: typeof at }).__launch = at;

/** Note a launch moment (the first time only). */
export function launchMark(name: Name): void {
  if (!TELEMETRY || at[name] !== undefined) return;
  at[name] = Math.round(performance.now());
  mark(`launch:${name}`);
  // The line waits for the lift and the warm-up; a warm-up that never comes (no developer
  // token) is cut off 10 s after the lift.
  if (name === "lift") window.setTimeout(write, 10_000);
  if (at.lift !== undefined && at.warm !== undefined) write();
}

function write(): void {
  if (written) return;
  written = true;
  const n = (k: Name) => (at[k] === undefined ? "–" : String(at[k]));
  const line =
    `[perf] launch module ${n("module")} · handler ${n("handler:begin")}→${n("handler:end")} · late ${n("late")} · ` +
    `library ${n("library")} · queue ${n("queue")} · ready ${n("ready")} · lift ${n("lift")} · ` +
    `configured ${n("configured")} · warm ${n("warm")} (ms from navigation start)`;
  invoke("diag_flush", { text: line }).catch(() => {});
}
