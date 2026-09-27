// Theme and skin ids: the retired ones, and the first-launch pair (RULES.md §7a). A pure
// module with no imports, so the settings store can migrate the old keys at load without a
// cycle through theme.ts / skin.ts. The pre-paints in index.html and tray.html carry the
// same maps inline (they run before any module); keep all three in sync, and DeetsSolutions'
// `RETIRED` in js/controls.js — the id is a contract with stored state.

export type ThemeName = "lilac" | "green" | "sepia" | "moonlight" | "black-yellow" | "black-red";
export type SkinName = "vanilla" | "press" | "ocean" | "glass" | "cyber";

// The 2026-08-10 rename traded four vibe names for what the themes actually are.
export const RETIRED_THEMES: Record<string, ThemeName> = {
  fairy: "lilac",
  glade: "green",
  hornet: "black-yellow",
  viper: "black-red",
};
// Desk was retired when Press landed (2026-08-10); CyberStorm kept its idiom and only changed
// name, to Retro-Future and then to Cyber (2026-09-17).
export const RETIRED_SKINS: Record<string, SkinName> = {
  desk: "press",
  cyberstorm: "cyber",
  "retro-future": "cyber",
};

function prefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

// No saved choice: follow the OS light/dark preference, so a first launch lands on one of two
// curated pairs — Press × Lilac or Cyber × Black & Red. Settings › Reset › Theme and skin
// returns to it too. Mirrors DeetsSolutions' default logic.
export const defaultTheme = (): ThemeName => (prefersDark() ? "black-red" : "lilac");
export const defaultSkin = (): SkinName => (prefersDark() ? "cyber" : "press");

export const resolveTheme = (id: string | null | undefined): ThemeName | null => (id ? RETIRED_THEMES[id] ?? (id as ThemeName) : null);
export const resolveSkin = (id: string | null | undefined): SkinName | null => (id ? RETIRED_SKINS[id] ?? (id as SkinName) : null);
