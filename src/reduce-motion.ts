// Reduce motion (GRAPHICS-FALLBACK.md §10.4, his calls 2026-10-20): the catch-all switch for
// every animation and heavy effect.
//
// On when Windows asks for reduced motion (always, whatever the row holds), when the Settings ›
// Motion row is On, or when the graphics rule holds the key on while the window draws in
// software. On, it sets `data-motion="reduced"` on <html> (every transition becomes a fade or a
// cut; motion.ts reads it) and the `motionReduced` fact, which makes the built-in rule
// `row:reduceMotion` hold the heavy keys off (rules-eval.ts REDUCED_OFF).

import { emit } from "@tauri-apps/api/event";
import { effective, onSettingsChange } from "./settings-store";
import { registerFact, registerChipText } from "./rules";
import * as diag from "./diag";

// `typeof`: a unit test that loads a module importing this one has no matchMedia.
const os: Pick<MediaQueryList, "matches" | "addEventListener"> =
  typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false, addEventListener: () => {} };

/** Windows asks for reduced motion: the row reads On and is locked (his call, F3). */
export const windowsReduced = (): boolean => os.matches;

let on: boolean | undefined;
const subs = new Set<() => void>();

function apply(why: "start" | "windows" | "setting"): void {
  const now = os.matches || effective("reduceMotion");
  if (now === on) return;
  on = now;
  const root = document.documentElement;
  if (now) root.dataset.motion = "reduced";
  else delete root.dataset.motion;
  diag.log("motion:reduced", { on: now, windows: os.matches, why });
  subs.forEach((cb) => cb());
  // The tray panel is its own page: it follows this window's switch (tray.ts).
  void emit("motion-reduced", now).catch(() => {});
}

/** main.ts, with the other Rulez facts (before gpu.ts, whose rule sets the key). */
export function initReduceMotion(): void {
  registerFact("motionReduced", () => on, {
    seam: (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  });
  // The chip beside each held row (RULES.md §9).
  registerChipText("reduceMotion", {
    name: "Reduce motion",
    bolt: () => "Reduce motion is on, so this is off. Your own setting comes back when Reduce motion is off.",
    hand: () => "Your pick holds until DeetsMusic restarts. Press to give it back to Reduce motion.",
  });
  os.addEventListener("change", () => apply("windows"));
  // The row, and the graphics rule's overlay on the key: both reach here as a change of the key.
  onSettingsChange((k) => {
    if (k === "reduceMotion") apply("setting");
  });
  apply("start");
}
