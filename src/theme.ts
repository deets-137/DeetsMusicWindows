// Theme switching. The whole mechanism is one attribute on <html>;
// the token sheets (themes.css) do the rest. Choice persists in localStorage.

export type ThemeName = "lilac" | "green" | "sepia" | "moonlight" | "black-yellow" | "black-red";

const STORAGE_KEY = "deets.theme";

// Retired ids still sitting in a saved localStorage value, mapped to their
// successor. The 2026-08-10 rename traded four vibe names for what the
// themes actually are; without this map anyone who had picked one silently
// falls back to the default instead of keeping their choice.
// Kept in sync with the same map in skin.ts and with DeetsSolutions'
// `RETIRED` in js/controls.js — the id is a contract with stored state.
const RETIRED: Record<string, ThemeName> = {
  fairy: "lilac",
  glade: "green",
  hornet: "black-yellow",
  viper: "black-red",
};

// No saved choice: follow the OS light/dark preference, landing on Lilac
// (light) or Black & Red (dark). The skin axis reads the SAME preference,
// so a first launch lands on one of two curated pairs — Press × Lilac or
// Retro-Future × Black & Red. Mirrors DeetsSolutions' default logic.
function defaultTheme(): ThemeName {
  return prefersDark() ? "black-red" : "lilac";
}

function prefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

export function applyTheme(name: ThemeName): void {
  document.documentElement.dataset.theme = name;
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    /* private mode / storage disabled — theme still applies for the session */
  }
  markActive(name);
}

export function initTheme(): void {
  const saved = localStorage.getItem(STORAGE_KEY);
  const name = saved ? RETIRED[saved] ?? (saved as ThemeName) : defaultTheme();
  // Write back through applyTheme so a migrated id is PERSISTED, not
  // re-resolved on every launch.
  applyTheme(name);
}

// Reflect the active theme onto the flyout's radio items.
function markActive(name: string): void {
  document.querySelectorAll<HTMLElement>("[data-theme-choice]").forEach((el) => {
    el.setAttribute("aria-checked", String(el.dataset.themeChoice === name));
  });
}
