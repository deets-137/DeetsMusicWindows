// Skin painting. Mirror of theme.ts: one attribute on <html>, the token sheets (skin.css)
// do the rest. The choice lives in the settings store (`skin`, RULES.md §7a); look.ts
// writes it and paints the effective value through `paintSkin`.

export { defaultSkin, type SkinName } from "./look-ids";
import type { SkinName } from "./look-ids";

const listeners = new Set<(name: SkinName) => void>();

/** Subscribe to skin switches (the Settings card shows skin-only rows). Returns an unsubscribe fn. */
export function onSkinChange(cb: (name: SkinName) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The skin on screen now (the effective one). */
export function currentSkin(): SkinName {
  return document.documentElement.dataset.skin as SkinName;
}

/** Set the attribute (no storage: the store owns the choice). */
export function paintSkin(name: SkinName): void {
  const changed = document.documentElement.dataset.skin !== name;
  document.documentElement.dataset.skin = name;
  if (changed) listeners.forEach((cb) => cb(name));
  markActive(name);
}

// Reflect the active skin onto the flyout's radio items.
function markActive(name: string): void {
  document.querySelectorAll<HTMLElement>("[data-skin-choice]").forEach((el) => {
    el.setAttribute("aria-checked", String(el.dataset.skinChoice === name));
  });
}
