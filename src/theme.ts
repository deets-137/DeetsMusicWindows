// Theme switching. The whole mechanism is one attribute on <html>;
// the token sheets (themes.css) do the rest. Choice persists in localStorage.

export type ThemeName = "fairy" | "sepia" | "moonlight";

const STORAGE_KEY = "deets.theme";
const DEFAULT_THEME: ThemeName = "fairy";

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
  const saved = (localStorage.getItem(STORAGE_KEY) as ThemeName | null) ?? DEFAULT_THEME;
  document.documentElement.dataset.theme = saved;
  markActive(saved);
}

// Reflect the active theme onto the flyout's radio items.
function markActive(name: string): void {
  document.querySelectorAll<HTMLElement>("[data-theme-choice]").forEach((el) => {
    el.setAttribute("aria-checked", String(el.dataset.themeChoice === name));
  });
}
