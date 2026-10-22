// The Metal skin's material (docs/features/metal.md): the card, page and control textures,
// drawn as SVG noise from Settings › Skin settings (Material: finely brushed stainless steel or
// thick acrylic paint; Grain) and published on <html> as --metal-texture / --metal-texture-fine.
// Drawn only under Metal. Its own module (2026-10-21) so the tray panel's window draws it too
// (tray.ts) without the side covers' queue code; metal.ts starts it in the main window.
import { hook, onSkinChange } from "./skin";
import { setting, onSettingsChange } from "./settings-store";

const GRAIN = { faint: 0.15, fine: 0.3, medium: 0.5, strong: 0.75 } as const;
const TILE = 480; // px of one texture tile: the draft's Medium grain size (his pick: Grain size stays fixed)

const svg = (s: string) => `data:image/svg+xml,${encodeURIComponent(s)}`; // the SVG's address; `url()` at the use

// Brushed stainless: noise stretched along x into fine hairlines, grey, its contrast set by
// `grain` around mid-grey so the overlay blend leaves the metal's own tone.
// Two layers: long hairlines the width of the tile, and shorter streaks (about an eighth of it)
// of their own brightness laid over them, so the lines end and vary as a brushed sheet does;
// one layer alone read as even scan lines (the design review, 2026-10-20). The short layer is the
// quieter one: at equal weight the two pitches beat into a faint hatch (round 2).
function steel(grain: number, px: number): string {
  const slope = 0.16 + grain * 1.2, b = (0.5 - slope / 2).toFixed(3);
  const f = (c: string) => `<feFunc${c} type="linear" slope="${slope.toFixed(3)}" intercept="${b}"/>`;
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"><filter id="f" x="0" y="0" width="100%" height="100%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${(0.6 / px).toFixed(5)} 0.9" numOctaves="2" seed="11" stitchTiles="stitch" result="a"/>` +
    `<feTurbulence type="fractalNoise" baseFrequency="${(8 / px).toFixed(5)} 0.42" numOctaves="2" seed="3" stitchTiles="stitch" result="s"/>` +
    `<feComposite in="a" in2="s" operator="arithmetic" k1="0" k2="0.62" k3="0.42" k4="-0.02"/>` +
    `<feColorMatrix type="saturate" values="0"/><feComponentTransfer>${f("R")}${f("G")}${f("B")}<feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>` +
    `</filter><rect width="${px}" height="${px}" filter="url(#f)"/></svg>`);
}

// Acrylic: short, overlapping dabs with the bristle lines inside them, lit from the top left
// into a relief, its contrast cut to 0.55 around mid-grey (a flat patch lit at 34° is sin 34° ≈
// 0.56) for the overlay blend: the low light draws the stroke edges, not brighter streaks under
// small text (the design review, round 4).
// The relief is strong enough to read as paint next to Steel (at Fine it barely differed), and
// the bristle lines live inside the dabs (the product term), so strokes start and end instead of
// running the tile's width as corduroy (the design review, rounds 1 and 2, 2026-10-20).
function acrylic(grain: number, px: number): string {
  const lift = (1.8 + grain * 3).toFixed(2); // a low light (34°) draws each stroke's edge, so the paint reads at this gentle relief
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"><filter id="f" x="0" y="0" width="100%" height="100%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${(3 / px).toFixed(5)} ${(7 / px).toFixed(5)}" numOctaves="3" seed="5" stitchTiles="stitch" result="s"/>` +
    `<feTurbulence type="fractalNoise" baseFrequency="${(1.5 / px).toFixed(5)} 0.3" numOctaves="2" seed="9" stitchTiles="stitch" result="b"/>` +
    `<feComposite in="s" in2="b" operator="arithmetic" k1="0.9" k2="0.42" k3="0.08" k4="0" result="h"/>` +
    `<feDiffuseLighting in="h" surfaceScale="${lift}" diffuseConstant="1" lighting-color="#fff" result="l"><feDistantLight azimuth="235" elevation="34"/></feDiffuseLighting>` +
    `<feComponentTransfer in="l"><feFuncR type="linear" slope="0.55" intercept="0.192"/><feFuncG type="linear" slope="0.55" intercept="0.192"/><feFuncB type="linear" slope="0.55" intercept="0.192"/><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>` +
    `</filter><rect width="${px}" height="${px}" filter="url(#f)"/></svg>`);
}

// The software-drawing gate (GRAPHICS-FALLBACK.md): the main window says when the window is
// drawn in software and the *If graphics fail* row lets the rule turn heavy effects off; the
// material is then not drawn (Metal's flat colors stay). The tray's window has no gate.
let gateOff: () => boolean = () => false;
/** Hand the material a gate (metal.ts, from gpu.ts): `off()` true = draw nothing; `watch`
 *  calls back when it may have changed. */
export function gateMaterial(off: () => boolean, watch: (cb: () => void) => void): void {
  gateOff = off;
  watch(() => paintMaterial());
}

const PROPS = ["--metal-texture", "--metal-texture-fine", "--metal-size", "--metal-size-fine", "--metal-tex-panel", "--metal-tex-floor", "--metal-tex-control"];

/** Draw the material on <html> (under Metal only; the base skin tokens are inert elsewhere). */
function paintMaterial(): void {
  const root = document.documentElement;
  const run = ++painted;
  if (hook("material") !== "metal" || gateOff()) {
    PROPS.forEach((p) => root.style.removeProperty(p));
    delete root.dataset.metalBaked;
    return;
  }
  const grain = GRAIN[setting("metalGrain")] ?? GRAIN.fine;
  const draw = setting("metalMaterial") === "acrylic" ? acrylic : steel;
  const fine = Math.round(TILE / 2);
  const coarse = draw(grain, TILE), small = draw(grain * 0.8, fine);
  // The SVG paints at once; the baked bitmaps take its place when ready (bake, below).
  if (!baked.has(`${coarse}|${dpr()}`)) root.style.setProperty("--metal-texture", `url("${coarse}")`);
  if (!baked.has(`${small}|${dpr()}`)) root.style.setProperty("--metal-texture-fine", `url("${small}")`);
  root.style.setProperty("--metal-size", `${TILE}px`);
  root.style.setProperty("--metal-size-fine", `${fine}px`);
  void Promise.all([bake(coarse, TILE), bake(small, fine)]).then(async ([a, b]) => {
    if (run !== painted) return; // a newer material, grain, skin or screen took over
    if (a) root.style.setProperty("--metal-texture", `url("${a.url}")`);
    if (b) root.style.setProperty("--metal-texture-fine", `url("${b.url}")`);
    if (!a || !b) return;
    // The tints: each surface's texture baked against its own color, laid on with no blend.
    const [panel, floor, control] = await Promise.all([
      tint(a, baseOf("--metal")), tint(b, baseOf("--metal-floor")), tint(b, baseOf("--surface")),
    ]);
    if (run !== painted) return;
    if (!panel || !floor || !control) { delete root.dataset.metalBaked; return; } // the overlay stays
    root.style.setProperty("--metal-tex-panel", `url("${panel}")`);
    root.style.setProperty("--metal-tex-floor", `url("${floor}")`);
    root.style.setProperty("--metal-tex-control", `url("${control}")`);
    root.dataset.metalBaked = "";
  });
}

// The tints (2026-10-21, his ask: the skin is static, so cache its look). The grey texture was
// laid on each surface with `overlay`, and a blend mode is drawn again on every raster: with the
// textures baked, the blends were what was left of Metal's dropped frames in a scroll (~6–10 %
// against ~2–3 % with them off; metal.md §6.7). A tint is the same light and shade as a picture
// of its own: where the overlay lightens the base, white at the alpha that lightens it as much;
// where it darkens, black. Laid on with no blend, it matches the overlay on that base; on a
// nearby one (a control's hover) it is within a step. Baked again on a theme, material, grain
// or screen change, never while the page moves.
/** A base color as 0–1 channels, read from a probe (a theme value may be a color-mix). */
function baseOf(token: string): [number, number, number] {
  const probe = document.createElement("i");
  probe.style.cssText = `position:absolute;visibility:hidden;background-color:var(${token})`;
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).backgroundColor;
  probe.remove();
  const n = (c.match(/[\d.]+/g) ?? []).map(Number);
  // "rgb(r, g, b)" in 0–255, or "color(srgb r g b)" in 0–1
  return c.startsWith("color(") ? [n[0] ?? 0.5, n[1] ?? 0.5, n[2] ?? 0.5] : [(n[0] ?? 128) / 255, (n[1] ?? 128) / 255, (n[2] ?? 128) / 255];
}
const overlay = (b: number, t: number) => (b < 0.5 ? 2 * b * t : 1 - 2 * (1 - b) * (1 - t));
const tinted = new Map<string, string>(); // `${texture url}|${base}` → blob: URL
async function tint(tex: Baked, base: [number, number, number]): Promise<string | null> {
  const key = `${tex.url}|${base.map((v) => v.toFixed(3)).join(",")}`;
  const have = tinted.get(key);
  if (have) return have;
  try {
    const { width, height, data } = tex.pixels;
    const out = new ImageData(width, height);
    const o = out.data;
    const lum = (base[0] + base[1] + base[2]) / 3;
    for (let i = 0; i < data.length; i += 4) {
      const t = data[i] / 255; // the texture is grey
      const d = (overlay(base[0], t) - base[0] + overlay(base[1], t) - base[1] + overlay(base[2], t) - base[2]) / 3;
      const a = d > 0 ? d / Math.max(1e-3, 1 - lum) : -d / Math.max(1e-3, lum);
      const v = d > 0 ? 255 : 0;
      o[i] = o[i + 1] = o[i + 2] = v;
      o[i + 3] = Math.round(Math.min(1, a) * 255);
    }
    const cv = document.createElement("canvas");
    cv.width = width;
    cv.height = height;
    cv.getContext("2d")!.putImageData(out, 0, 0);
    const blob = await new Promise<Blob | null>((ok) => cv.toBlob(ok, "image/png"));
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    tinted.set(key, url);
    if (tinted.size > 24) { const [k, v] = tinted.entries().next().value as [string, string]; tinted.delete(k); URL.revokeObjectURL(v); }
    return url;
  } catch {
    return null;
  }
}

// Each texture is baked once into a bitmap at the screen's pixel density (the efficiency pass,
// 2026-10-20): as SVG noise filters, every textured card re-rastered them as content moved,
// and a scroll in Settings dropped ~23 % of its frames at 244 Hz against 0 % with the paint
// off. A bitmap blends like any picture. The SVG is kept as the paint until the bitmap is
// ready, and if the canvas refuses it. Baked bitmaps are kept per texture and density (a
// handful at most: two materials × four grains × two sizes), so going back is instant.
let painted = 0;
interface Baked { url: string; pixels: ImageData }
const baked = new Map<string, Baked>(); // `${svg}|${dpr}` → the bitmap and its pixels (the tints read them)
const dpr = () => Math.max(1, Math.round((window.devicePixelRatio || 1) * 100) / 100);
async function bake(src: string, css: number): Promise<Baked | null> {
  const key = `${src}|${dpr()}`;
  const have = baked.get(key);
  if (have) return have;
  try {
    const px = Math.round(css * dpr());
    const im = new Image(px, px);
    im.src = src;
    await im.decode();
    const cv = document.createElement("canvas");
    cv.width = cv.height = px;
    const g = cv.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(im, 0, 0, px, px);
    const blob = await new Promise<Blob | null>((ok) => cv.toBlob(ok, "image/png"));
    if (!blob) return null;
    const out = { url: URL.createObjectURL(blob), pixels: g.getImageData(0, 0, px, px) };
    baked.set(key, out);
    if (baked.size > 16) { const [k, v] = baked.entries().next().value as [string, Baked]; baked.delete(k); URL.revokeObjectURL(v.url); }
    return out;
  } catch {
    return null; // the SVG stays the paint
  }
}

/** The material alone: the textures on <html>, drawn again on a skin change, a Material or
 *  Grain change and a move to a screen of another density. The main window (metal.ts) and the
 *  tray panel's window (tray.ts) call it; the tray showed Metal without its texture before. */
export function initMetalMaterial(): void {
  paintMaterial();
  // a move to a screen of another density bakes the textures again at its scale
  const watchDpr = () => matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener("change", () => { paintMaterial(); watchDpr(); }, { once: true });
  watchDpr();
  onSkinChange(() => paintMaterial());
  // A theme names its own metal, floor and control colors: the tints are baked again for them
  // (cached per color, so a theme seen before is instant).
  let theming = 0;
  new MutationObserver(() => {
    cancelAnimationFrame(theming);
    theming = requestAnimationFrame(paintMaterial);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  // A run of Material or Grain changes (arrow keys held on the row, the Compass cycling a choice)
  // draws the texture once a frame at most, not once a step (the break-it pass, 2026-10-20).
  let painting = 0;
  onSettingsChange((k) => {
    if (k === "metalMaterial" || k === "metalGrain") {
      cancelAnimationFrame(painting);
      painting = requestAnimationFrame(paintMaterial);
    }
  });
}
