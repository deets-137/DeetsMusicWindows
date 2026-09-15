// Launch cover (UX-COVERUPS.md §6, 2026-09-15). The main window starts hidden
// (tauri.conf.json `visible: false`). The page paints behind an opaque --canvas cover
// (`<html data-boot>` in index.html), then asks Rust to show the window (`main_ready`,
// which also gives the window the canvas color, so its first frame is never white).
// Once the window shows, the cover fades and the cards rise into place (skin tokens
// --boot-*). The stages, on <html data-boot>:
//   hold — clicks are blocked: the last session's queue is not restored yet, and a Play
//          press now would start the library from the top.
//   wait — restored; clicks pass while the library and the window size finish.
//   lift — the fade runs; the attribute is removed when it ends.
// Ready = queue restored + library loaded + window at its surface size, or CAP_MS.
// Rust shows the window after 3 s whatever happens (tray.rs `reveal_fallback`), and CSS
// lifts the cover at --boot-safety, so a page error cannot leave a hidden or blank window.
// Snaps (no fade) under reduced motion or with Animate look changes off.

import { invoke } from "@tauri-apps/api/core";
import { setting } from "./settings-store";
import * as frames from "./frames";
import * as diag from "./diag";

const CAP_MS = 2500;

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** A time token ("0.8s" / "70ms") in ms. appearance.ts reads the same tokens. */
export function tokenMs(name: string): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 0;
  return v.endsWith("ms") ? n : n * 1000;
}

/** The page ground as [r, g, b], for the window's own background. */
function canvasRgb(): [number, number, number] | null {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(getComputedStyle(document.body).backgroundColor);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

export const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

/** Boot (main.ts), after the cards mount. `restored` ends the click block. */
export function runBootCover(restored: Promise<unknown>, ready: Promise<unknown>[]): void {
  const root = document.documentElement;
  const t0 = performance.now();
  void restored.finally(() => {
    if (root.dataset.boot === "hold") root.dataset.boot = "wait";
  });
  let capped = false;
  const cap = new Promise<void>((r) =>
    window.setTimeout(() => {
      capped = true;
      r();
    }, CAP_MS),
  );
  void Promise.race([Promise.allSettled([restored, ...ready]), cap]).then(async () => {
    try {
      await invoke("main_ready", { color: canvasRgb() });
    } catch (e) {
      console.warn("[boot] main_ready", e);
    }
    diag.log("boot:ready", { ms: Math.round(performance.now() - t0), capped });
    if (!setting("appearanceMotion") || reducedMotion()) {
      delete root.dataset.boot;
      return;
    }
    // The window's first shown frames carry the full cover, not a fade already half run.
    await nextFrame();
    await nextFrame();
    const end = frames.begin("boot");
    root.dataset.boot = "lift";
    const slots = document.querySelectorAll(".bento > .panel").length;
    const total = tokenMs("--boot-dur") + tokenMs("--boot-stagger") * Math.max(0, slots - 1);
    window.setTimeout(() => {
      end();
      if (root.dataset.boot === "lift") delete root.dataset.boot;
    }, total + 50);
  });
}
