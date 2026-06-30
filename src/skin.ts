// Skin switching. Mirror of theme.ts: one attribute on <html>, the
// token sheets (skin.css) do the rest. Choice persists in localStorage.

export type SkinName = "vanilla" | "desk" | "ocean" | "glass";

const STORAGE_KEY = "deets.skin";
const DEFAULT_SKIN: SkinName = "vanilla";

export function applySkin(name: SkinName): void {
  document.documentElement.dataset.skin = name;
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    /* private mode / storage disabled — skin still applies for the session */
  }
  markActive(name);
}

export function initSkin(): void {
  const saved = (localStorage.getItem(STORAGE_KEY) as SkinName | null) ?? DEFAULT_SKIN;
  document.documentElement.dataset.skin = saved;
  markActive(saved);
}

// Reflect the active skin onto the flyout's radio items.
function markActive(name: string): void {
  document.querySelectorAll<HTMLElement>("[data-skin-choice]").forEach((el) => {
    el.setAttribute("aria-checked", String(el.dataset.skinChoice === name));
  });
}
