// Skin-only settings (Settings › Skin settings; each row shows only under its skin).
// Ocean: `oceanEdges` → `data-ocean-edges` on <html>; skin.css turns the card edges to sand.
//        `oceanSand` (0–100) → --ocean-sand, the sand band's width.
//        `oceanCardOpacity` (0–100) → --ocean-card-opacity, how solid the sunken cards are.
//        `oceanLight` (0–100) → --ocean-light, the album light. ocean.ts reads the key itself
//        (it paints the neon crests only above 0); this file never imports ocean.ts, since the
//        tray panel imports this one.
// Glass: `glassBacklight` / `glassTint` / `glassCanvasGlow` (0–100) → --glass-backlight,
//        --glass-tint (a %), --glass-canvas; `glassCanvasDim` → --glass-canvas-dim.
//        `glassFancy` → `data-glass-fancy`; off publishes GLASS_LOCKED instead of the sliders.
// Press: `pressVinyl` / `pressVinylWhere` → `data-press-vinyl` / `data-press-vinyl-where`
//        (docs/features/VINYL.md); the tray panel applies these two as well.
// The skin blocks in skin.css read them; other skins ignore them.

import { setting, onSettingsChange, GLASS_LOCKED } from "./settings-store";

type SliderKey = "glassTint" | "glassBacklight" | "glassCanvasGlow" | "glassCanvasDim" | "oceanSand" | "oceanCardOpacity" | "oceanLight";
const PROPS: Record<SliderKey, [string, string]> = {
  glassTint: ["--glass-tint", "%"],
  glassBacklight: ["--glass-backlight", ""],
  glassCanvasGlow: ["--glass-canvas", ""],
  glassCanvasDim: ["--glass-canvas-dim", ""],
  oceanSand: ["--ocean-sand", ""],
  oceanCardOpacity: ["--ocean-card-opacity", ""],
  oceanLight: ["--ocean-light", ""],
};
const OCEAN_SLIDERS: SliderKey[] = ["oceanSand", "oceanCardOpacity", "oceanLight"];
const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
const isSlider = (k: string): k is SliderKey => k in PROPS;
/** The value a slider publishes: a Glass slider holds its locked value while Fancy Glass is off. */
const sliderValue = (k: SliderKey): number =>
  !OCEAN_SLIDERS.includes(k) && !setting("glassFancy") ? GLASS_LOCKED[k as keyof typeof GLASS_LOCKED] : setting(k);

/** Show a skin slider value without writing the store (a slider drag). */
export function previewSkin(key: SliderKey, v: number): void {
  const [prop, unit] = PROPS[key];
  document.documentElement.style.setProperty(prop, `${clamp(v)}${unit}`);
}

/** Press "Record player": the two attributes the vinyl CSS reads. */
export function applyVinylAttrs(): void {
  document.documentElement.dataset.pressVinyl = setting("pressVinyl");
  document.documentElement.dataset.pressVinylWhere = setting("pressVinylWhere");
  document.documentElement.dataset.pressVinylPlate = setting("pressVinylPlate") ? "on" : "off";
}
const VINYL_KEYS: string[] = ["pressVinyl", "pressVinylWhere", "pressVinylPlate"];
/** A change to one of the record rows. */
export const isVinylKey = (k: string): boolean => VINYL_KEYS.includes(k);

export function initSkinSettings(): void {
  const applyEdges = () => {
    document.documentElement.dataset.oceanEdges = setting("oceanEdges");
  };
  // Fancy scrubber (UI-ARCHITECTURE §3 SCRUBBERS): off = every skin's plain masked handle.
  const applyScrubber = () => {
    document.documentElement.dataset.fancyScrub = setting("fancyScrubber") ? "on" : "off";
  };
  const applyGlassFancy = () => {
    document.documentElement.dataset.glassFancy = setting("glassFancy") ? "on" : "off";
  };
  applyEdges();
  applyScrubber();
  applyGlassFancy();
  applyVinylAttrs();
  const applySliders = () => (Object.keys(PROPS) as SliderKey[]).forEach((k) => previewSkin(k, sliderValue(k)));
  applySliders();
  onSettingsChange((k) => {
    if (k === "oceanEdges") applyEdges();
    if (k === "fancyScrubber") applyScrubber();
    if (isVinylKey(k)) applyVinylAttrs();
    if (k === "glassFancy") {
      applyGlassFancy();
      applySliders();
    }
    if (isSlider(k)) previewSkin(k, sliderValue(k));
  });
}
