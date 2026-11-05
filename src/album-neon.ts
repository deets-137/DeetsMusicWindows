// The album light's roles on an element (ALBUM-COLOR.md § The album light). No player and no
// queue here, so the tray panel can use it without the page's playback modules. The colors are
// worked out in album-slots.ts; the watcher and the wave are album-light.ts.

import { isDark, type Neon, type RGB } from "./album-slots";

// Any CSS color (color-mix, oklch, var) → sRGB, through a 1×1 canvas: the computed style of a
// color-mix is `color(srgb …)`, which the album parser does not read.
const swatch = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
swatch.canvas.width = swatch.canvas.height = 1;
export function toRGB(css: string): RGB | null {
  swatch.clearRect(0, 0, 1, 1);
  swatch.fillStyle = "#000";
  swatch.fillStyle = css;
  swatch.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = swatch.getImageData(0, 0, 1, 1).data;
  return a ? [r / 255, g / 255, b / 255] : null;
}

/** Is the ground under this element's cards dark? */
export function groundIsDark(el: HTMLElement): boolean {
  const c = toRGB(getComputedStyle(el).getPropertyValue("--canvas").trim());
  return c ? isDark(c) : true;
}

/** Put the roles on `el`, or take them off: the skin's tokens then fall back to the theme. */
export function setNeon(el: HTMLElement, n: Neon | null): void {
  if (!n) {
    ["--album-neon-core", "--album-neon-bloom", "--album-neon-2"].forEach((p) => el.style.removeProperty(p));
    return;
  }
  el.style.setProperty("--album-neon-core", n.core);
  el.style.setProperty("--album-neon-bloom", n.bloom);
  el.style.setProperty("--album-neon-2", n.second);
}
