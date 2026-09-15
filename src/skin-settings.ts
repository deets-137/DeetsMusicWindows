// Skin-only settings (Settings › Look and feel; each row shows only under its skin).
// Ocean: `oceanEdges` → `data-ocean-edges` on <html>; skin.css turns the card edges to sand.
//        `oceanSand` (0–100) → --ocean-sand, the sand band's width.
// Glass: `glassBacklight` / `glassTint` / `glassCanvasGlow` (0–100) → --glass-backlight,
//        --glass-tint (a %), --glass-canvas; `glassCanvasDim` → --glass-canvas-dim.
// Press: `pressVinyl` / `pressVinylWhere` → `data-press-vinyl` / `data-press-vinyl-where`
//        (docs/VINYL.md); the tray panel applies these two as well.
// The skin blocks in skin.css read them; other skins ignore them.

import { setting, onSettingsChange } from "./settings-store";

type SliderKey = "glassTint" | "glassBacklight" | "glassCanvasGlow" | "glassCanvasDim" | "oceanSand";
const PROPS: Record<SliderKey, [string, string]> = {
  glassTint: ["--glass-tint", "%"],
  glassBacklight: ["--glass-backlight", ""],
  glassCanvasGlow: ["--glass-canvas", ""],
  glassCanvasDim: ["--glass-canvas-dim", ""],
  oceanSand: ["--ocean-sand", ""],
};
const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
const isSlider = (k: string): k is SliderKey => k in PROPS;

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
  applyEdges();
  applyVinylAttrs();
  (Object.keys(PROPS) as SliderKey[]).forEach((k) => previewSkin(k, setting(k)));
  onSettingsChange((k) => {
    if (k === "oceanEdges") applyEdges();
    if (isVinylKey(k)) applyVinylAttrs();
    if (isSlider(k)) previewSkin(k, setting(k));
  });
}
