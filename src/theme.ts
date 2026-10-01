// Theme painting. The whole mechanism is one attribute on <html>; the token sheets
// (themes.css) do the rest. The choice lives in the settings store (`theme`, RULES.md §7a);
// look.ts writes it and paints the effective value through `paintTheme`.

export { defaultTheme, type ThemeName } from "./look-ids";
import type { ThemeName } from "./look-ids";

/** Set the attribute (no storage: the store owns the choice). */
export function paintTheme(name: ThemeName): void {
  document.documentElement.dataset.theme = name;
  markActive(name);
  syncWindowBackground();
}

/**
 * Paint the NATIVE window in the theme's canvas color. During an animated resize
 * (surface.ts) the frame can outrun the page by a frame; the strip that shows is then
 * canvas, not white. Reads the body's computed background so the role resolves.
 *
 * Not while the launch cover holds the hidden window (`data-boot` hold / wait, 2026-09-29):
 * the read forces a whole style pass on a page still being built, and `main_ready` gives the
 * window this same color when it shows it (boot-cover.ts: the launch's one read). A tray pop
 * before that asks with `force` (main.ts).
 */
export function syncWindowBackground(force = false): void {
  const boot = document.documentElement.dataset.boot;
  if (!force && (boot === "hold" || boot === "wait")) return;
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(getComputedStyle(document.body).backgroundColor);
  if (!m) return;
  import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) => getCurrentWindow().setBackgroundColor([Number(m[1]), Number(m[2]), Number(m[3])]))
    .catch(() => { /* not in a Tauri window (a browser tab) — nothing to paint */ });
}

// Reflect the active theme onto the flyout's radio items.
function markActive(name: string): void {
  document.querySelectorAll<HTMLElement>("[data-theme-choice]").forEach((el) => {
    el.setAttribute("aria-checked", String(el.dataset.themeChoice === name));
  });
}
