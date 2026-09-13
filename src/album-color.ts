// Album Color (ALBUM-COLOR.md) — the data path for the NP aurora, plus the album-colored
// text with its contrast guard (NEXT-VERSION §7).
//
// Watches the current track and applies its real Apple palette as inline runtime
// roles (--album-bg/-c1/-c2) on the NP card, plus the .np--album presence class.
// Cache-first through the Rust enrichment layer (`album_palette`): a hit applies
// immediately; a miss leaves the theme fallback showing while the palette is
// fetched lazily, then the @property-registered transition crossfades it in.
// Clearing the props (no track / no palette) falls back to the theme roles.
//
// Text (skins that opt in via --np-album-text: 1 — Glass): the title takes Apple's
// textColor1, the subtext textColor2, the accents (scrub fill, "on" squares) c1 — each
// pushed through a WCAG guard against the WORST-CASE backdrop the rotating aurora can
// put under them (theme panel over canvas, mixed with each aurora stop at the skin's
// strength). A failing color moves only its OKLCH lightness (toward white on a dark
// backdrop, black on a light one) until it passes: 4.5:1 for text, 3:1 for accents.
// Results land as --np-title / --np-subtext / --np-accent inline on the card; their
// defaults (themes.css) are the plain theme roles, so a skin that doesn't opt in — or a
// track with no palette — looks exactly as before. Runs once per album change and once
// per theme/skin switch; pure JS math, no Apple calls.

import { invoke } from "@tauri-apps/api/core";
import { onPlayerState } from "./player";
import { getCurrent } from "./queue";
import { trackById } from "./track-store";

interface AlbumPalette {
  bg?: string; // "#rrggbb" — normalized in Rust
  c1?: string; // Apple's textColor1
  c2?: string; // Apple's textColor2
}

const PROPS = ["--album-bg", "--album-c1", "--album-c2"] as const;
const TEXT_PROPS = ["--np-title", "--np-subtext", "--np-accent"] as const;

// ── color math (sRGB ⇄ OKLCH, WCAG 2 contrast) ─────────────────────────────────
type RGB = [number, number, number]; // 0..1

function parseColor(s: string): RGB | null {
  const m = /^#([0-9a-f]{6})$/i.exec(s.trim());
  if (m) {
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const r = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(s.trim());
  if (r) return [Number(r[1]) / 255, Number(r[2]) / 255, Number(r[3]) / 255];
  return null;
}
/** Alpha of an rgba() string (1 for anything else). */
const alphaOf = (s: string): number => {
  const m = /rgba?\([^)]*[,/]\s*([\d.]+)\s*\)$/i.exec(s.trim());
  return m ? Number(m[1]) : 1;
};
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const luminance = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const hex = ([r, g, b]: RGB) =>
  "#" + [r, g, b].map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, "0")).join("");

type LCH = [number, number, number];
function toOKLCH([r, g, b]: RGB): LCH {
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(a, bb), Math.atan2(bb, a)];
}
function fromOKLCH([L, C, h]: LCH): RGB {
  const a = C * Math.cos(h);
  const bb = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  return [
    gam(clamp01(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    gam(clamp01(-1.2684380046 * l + 2.6097574011 * m - 0.6368000104 * s)),
    gam(clamp01(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  ];
}

/**
 * The guard: keep hue and chroma, move lightness away from the backdrop until every
 * backdrop clears `target`. If neither direction can reach it (a mid-grey backdrop),
 * return whichever extreme contrasts best.
 */
function guard(color: RGB, backdrops: RGB[], target: number): RGB {
  const worst = (c: RGB) => Math.min(...backdrops.map((b) => contrast(c, b)));
  if (worst(color) >= target) return color;
  const [, C, h] = toOKLCH(color);
  const darkBackdrop = backdrops.reduce((s, b) => s + luminance(b), 0) / backdrops.length < 0.18;
  const tryDir = (toWhite: boolean): { c: RGB; ratio: number } => {
    let lo = toOKLCH(color)[0];
    let hi = toWhite ? 1 : 0;
    let best: RGB = fromOKLCH([hi, C, h]);
    if (worst(best) < target) return { c: best, ratio: worst(best) }; // even the extreme fails
    for (let i = 0; i < 18; i++) { // bisect toward the least move that passes
      const mid = (lo + hi) / 2;
      const c = fromOKLCH([mid, C, h]);
      if (worst(c) >= target) { hi = mid; best = c; } else lo = mid;
    }
    return { c: best, ratio: worst(best) };
  };
  const first = tryDir(darkBackdrop);
  if (first.ratio >= target) return first.c;
  const second = tryDir(!darkBackdrop);
  return second.ratio > first.ratio ? second.c : first.c;
}

/** Watch playback and tint `card` (the .np element) with the current album's palette. */
export function watchAlbumColor(card: HTMLElement): () => void {
  let liveKey: string | null = null; // the cover the card currently reflects
  let livePalette: AlbumPalette | null = null;

  // A probe inside the card resolves any role — including the inline album props and
  // color-mix() tokens — to a computed rgb(), which is the only way JS can read them.
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  card.appendChild(probe);
  const resolve = (expr: string): string => {
    probe.style.color = expr;
    return getComputedStyle(probe).color;
  };
  const token = (name: string): string => getComputedStyle(card).getPropertyValue(name).trim();

  const clearText = () => TEXT_PROPS.forEach((p) => card.style.removeProperty(p));

  /** Recompute the guarded text roles for the live palette (or clear them). */
  const applyText = () => {
    if (token("--np-album-text") !== "1") { clearText(); return; }
    // Backdrop: the theme panel over the canvas, then each aurora stop mixed in at the
    // skin's strength. The worst case over the stops is what the text must beat.
    const canvas = parseColor(resolve("var(--canvas)")) ?? [0, 0, 0];
    const panelStr = resolve("var(--panel)");
    const panelRGB = parseColor(panelStr) ?? canvas;
    const base = mix(canvas, panelRGB, alphaOf(panelStr));
    const strength = parseFloat(token("--album-aurora-strength")) / 100 || 0.36;
    const stops = ["var(--album-bg)", "var(--album-c1)", "var(--album-c2)"]
      .map((v) => parseColor(resolve(v)))
      .filter((c): c is RGB => !!c);
    const backdrops = [base, ...stops.map((s) => mix(base, s, strength))];

    const title = parseColor(livePalette?.c1 ?? "") ?? parseColor(resolve("var(--title)"));
    const sub = parseColor(livePalette?.c2 ?? "") ?? parseColor(resolve("var(--subtext)"));
    const accent = parseColor(livePalette?.c1 ?? "") ?? parseColor(resolve("var(--title)"));
    if (!title || !sub || !accent) { clearText(); return; }
    card.style.setProperty("--np-title", hex(guard(title, backdrops, 4.5)));
    card.style.setProperty("--np-subtext", hex(guard(sub, backdrops, 4.5)));
    card.style.setProperty("--np-accent", hex(guard(accent, backdrops, 3)));
  };

  const clear = () => {
    PROPS.forEach((p) => card.style.removeProperty(p));
    card.classList.remove("np--album");
    livePalette = null;
    applyText(); // theme roles against the theme's own aurora fallback
  };

  const apply = (p: AlbumPalette) => {
    if (p.bg) card.style.setProperty("--album-bg", p.bg);
    else card.style.removeProperty("--album-bg");
    if (p.c1) card.style.setProperty("--album-c1", p.c1);
    else card.style.removeProperty("--album-c1");
    if (p.c2) card.style.setProperty("--album-c2", p.c2);
    else card.style.removeProperty("--album-c2");
    card.classList.add("np--album");
    livePalette = p;
    applyText();
  };

  const unsub = onPlayerState(() => {
    const cur = getCurrent();
    const track = trackById(cur?.catalogId ?? cur?.libraryId);
    const cover = track?.artwork?.urlTemplate ?? null;

    if (cover === liveKey) return; // same album (or still nothing) — no work
    liveKey = cover;

    if (!cover) {
      clear();
      return;
    }
    // Theme fallback shows until (unless) a palette arrives — never stall the UI.
    clear();
    const requestedKey = cover;
    invoke<AlbumPalette | null>("album_palette", {
      coverUrl: cover,
      catalogId: cur?.catalogId ?? track?.catalogId ?? null,
    })
      .then((p) => {
        if (liveKey !== requestedKey) return; // track changed while fetching — stale
        if (p) apply(p);
      })
      .catch((e) => console.warn("[album-color] palette lookup failed:", e));
  });

  // A theme or skin switch changes the backdrop (and whether the skin opts in at all):
  // re-guard the same palette. Deferred a frame so the new tokens have resolved.
  const mo = new MutationObserver(() => requestAnimationFrame(applyText));
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-skin"] });
  applyText();

  return () => {
    unsub();
    mo.disconnect();
    clear();
    probe.remove();
  };
}
