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
  paintHooks(); // before the listeners, so they read the new hooks
  if (changed) listeners.forEach((cb) => cb(name));
  markActive(name);
}

// The hooks (skin.css "hooks", mods.md §10.1): a rule that belongs to one look asks for its
// hook, never for a skin by name. Each `--hook-<name>` token the skin sets is copied onto <html>
// as `data-hook-<name>`; `none` (the base) leaves the attribute off. The copy is synchronous, so
// a skin switch and its hooks land in the same frame (and the first frame is under the launch
// cover anyway). A skin's own setting may change a hook (a variant block in skin.css), so any
// other attribute change on <html> reads them again.
export const HOOKS = ["scrub", "material", "sea", "record", "wallpaper", "scene"] as const;
export type HookName = (typeof HOOKS)[number];

const root = document.documentElement;
const hookKey = (h: HookName) => `hook${h[0].toUpperCase()}${h.slice(1)}`;

/** A hook's value now ("" when the skin leaves it off). */
export function hook(h: HookName): string {
  return root.dataset[hookKey(h)] ?? "";
}

function paintHooks(): void {
  const cs = getComputedStyle(root);
  for (const h of HOOKS) {
    const v = cs.getPropertyValue(`--hook-${h}`).trim();
    const key = hookKey(h);
    const want = v && v !== "none" ? v : undefined;
    if (root.dataset[key] === want) continue;
    if (want === undefined) delete root.dataset[key];
    else root.dataset[key] = want;
  }
}

paintHooks();
new MutationObserver((records) => {
  if (records.some((r) => !r.attributeName?.startsWith("data-hook-"))) paintHooks();
}).observe(root, { attributes: true });
// The stylesheet may land after this module in dev (Vite injects it): read once more then.
window.addEventListener("load", paintHooks, { once: true });

// Reflect the active skin onto the flyout's radio items.
function markActive(name: string): void {
  document.querySelectorAll<HTMLElement>("[data-skin-choice]").forEach((el) => {
    el.setAttribute("aria-checked", String(el.dataset.skinChoice === name));
  });
}
