// `@tauri-apps/api/core` with a timed `invoke` (guide/LOADING-SET.md §3.1). Telemetry builds
// only: the `ipcTiming` plugin in vite.config.ts points every `@tauri-apps/api/core` import made
// from src/ at this file, so the 58 importers stay as they are. A release never loads it.
//
// Why not wrap the global: Tauri defines `window.__TAURI_INTERNALS__` and every property on it
// (`invoke`, `ipc`, the callback table) as read-only and not configurable, so an assignment
// throws (tested 2026-10-17). The import is the one place left.
//
// The import below is this file's own, so the plugin leaves it alone: it is the real module.

import { invoke as realInvoke } from "@tauri-apps/api/core";
import { timed } from "./ipc-timing";

export * from "@tauri-apps/api/core";

export const invoke: typeof realInvoke = (cmd, args, options) => timed(cmd, () => realInvoke(cmd, args, options));
