// Skin switching. Mirror of theme.ts: one attribute on <html>, the
// token sheets (skin.css) do the rest. Choice persists in localStorage.

export type SkinName = "vanilla" | "press" | "ocean" | "glass" | "retro-future";

const STORAGE_KEY = "deets.skin";

// Retired ids still sitting in a saved localStorage value, mapped to their
// successor — same contract as theme.ts's RETIRED. Desk was retired when
// Press landed (2026-08-10); CyberStorm kept its idiom and only changed name.
const RETIRED: Record<string, SkinName> = {
  desk: "press",
  cyberstorm: "retro-future",
};

// No saved choice: the skin follows the OS light/dark preference too —
// Press on light (ink on stock wants a light stock), Retro-Future on dark.
// Pairs with theme.ts's default so a first launch lands on a curated combo.
function defaultSkin(): SkinName {
  return prefersDark() ? "retro-future" : "press";
}

function prefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

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
  const saved = localStorage.getItem(STORAGE_KEY);
  const name = saved ? RETIRED[saved] ?? (saved as SkinName) : defaultSkin();
  // Write back through applySkin so a migrated id is PERSISTED, not
  // re-resolved on every launch.
  applySkin(name);
}

// Reflect the active skin onto the flyout's radio items.
function markActive(name: string): void {
  document.querySelectorAll<HTMLElement>("[data-skin-choice]").forEach((el) => {
    el.setAttribute("aria-checked", String(el.dataset.skinChoice === name));
  });
}
