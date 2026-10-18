// The refresh rate of the monitor this window is on, from Windows' display mode (display.rs;
// VINYL.md §12). The Press record's Spin FPS row needs the exact rate: the dev-only rAF sample
// in frames.ts reads 244 for a 240 Hz display. The main window and the tray panel each read
// their own monitor. null until Windows answers (the web builds never do).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

let hz: number | null = null;
const subs = new Set<() => void>();

const set = (v: number | null | undefined) => {
  if (!v || v === hz) return;
  hz = v;
  for (const fn of subs) fn();
};

let label = "";
try {
  label = getCurrentWindow().label;
} catch {
  /* no Tauri window: the rate stays unknown */
}
invoke<number | null>("display_hz").then(set, () => {});
// Rust says when this window's rate changes: a move to another monitor, or a display mode
// change seen at the next focus. Every window hears the event; the label says whose it is.
listen<{ label: string; hz: number }>("display-hz", (e) => {
  if (e.payload.label === label) set(e.payload.hz);
}).catch(() => {});

/** The display's rate in Hz, or null when not known. */
export const displayHz = (): number | null => hz;

/** Call `fn` when the rate changes. Returns the unsubscribe. */
export function onDisplayHz(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}
