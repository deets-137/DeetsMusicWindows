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
 */
function syncWindowBackground(): void {
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
