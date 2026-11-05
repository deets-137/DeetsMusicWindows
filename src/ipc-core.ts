// `@tauri-apps/api/core` with one `invoke` for the whole app. The `ipcCore` plugin in vite.config.ts
// points every `@tauri-apps/api/core` import made from src/ at this file, so the importers stay as
// they are. Two jobs: in a telemetry build it times each call (guide/LOADING-SET.md §3.1), and with
// the demo flag it answers from the demo (WEB-DEMO.md §17). A normal release passes straight through.
//
// Why not wrap the global: Tauri defines `window.__TAURI_INTERNALS__` and every property on it
// (`invoke`, `ipc`, the callback table) as read-only and not configurable, so an assignment
// throws (tested 2026-10-17). The import is the one place left.
//
// The import below is this file's own, so the plugin leaves it alone: it is the real module.

import { invoke as realInvoke } from "@tauri-apps/api/core";
import { timed } from "./ipc-timing";
import { demoMode } from "./demo-gate";

export * from "@tauri-apps/api/core";

// A promise, not a top-level await: the demo's chunk imports from src/, which imports this file.
const demo = demoMode() ? import("../demo/desktop").then((m) => m.startDemo(realInvoke)) : null;

export const invoke: typeof realInvoke = (cmd, args, options) =>
  demo ? demo.then((run) => run(cmd, args, options)) : timed(cmd, () => realInvoke(cmd, args, options));
