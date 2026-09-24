// The album palette's pure color math, shared by the NP card (album-color.ts) and the
// tray window (tray.ts). No player, queue or store imports: the tray window loads this
// file on its own, and must not start a second player.

export interface AlbumPalette {
  bg?: string; // "#rrggbb" — normalized in Rust
  c1?: string; // Apple's textColor1
  c2?: string; // Apple's textColor2
}

// ── color math (sRGB ⇄ OKLCH) ──────────────────────────────────────────────────
export type RGB = [number, number, number]; // 0..1

export function parseColor(s: string): RGB | null {
  const m = /^#([0-9a-f]{6})$/i.exec(s.trim());
  if (m) {
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const r = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(s.trim());
  if (r) return [Number(r[1]) / 255, Number(r[2]) / 255, Number(r[3]) / 255];
  return null;
}
export const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export type LCH = [number, number, number];
export function toOKLCH([r, g, b]: RGB): LCH {
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(a, bb), Math.atan2(bb, a)];
}
export function fromOKLCH([L, C, h]: LCH): RGB {
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

// ── the album's color, by colorfulness ─────────────────────────────────────────

/** The palette's colors, most colorful first (OKLCH chroma). Apple's names say nothing
 *  about which one is vivid (see auroraSlots), so every "the album's color" reads this. */
export function rankByColor(p: AlbumPalette): { s: string; chroma: number }[] {
  return [p.bg, p.c1, p.c2]
    .flatMap((s) => {
      const rgb = s ? parseColor(s) : null;
      return rgb ? [{ s: s!, chroma: toOKLCH(rgb)[1] }] : [];
    })
    .sort((a, b) => b.chroma - a.chroma);
}

/** THE album color: the most colorful of the three (ALBUM-COLOR.md §The album's one color).
 *  An all-grey cover gives its least-grey color, so it stays grey. The aurora's rim (the NP
 *  card, the tray panel) and the Ocean's glow and neon all show this one. */
export function albumColor(p: AlbumPalette | null | undefined): string | undefined {
  return p ? rankByColor(p)[0]?.s : undefined;
}

// ── the aurora's stops ─────────────────────────────────────────────────────────

/** Below this OKLCH chroma a color reads as grey on the aurora. */
const GREY_CHROMA = 0.04;

/**
 * The aurora's three stops, by what shows: the `--album-bg` stop sits under the cover
 * and is hidden, `--album-c1` is the visible rim, `--album-c2` the outer halo and the
 * orbiting highlight. Apple's roles do not map onto that: its `bg` is the art's main
 * field, vivid as often as dark, and its text colors are near grey on about half the
 * library (677 of 1,368 cached palettes, 2026-09-20). Assigned by name, a lilac cover
 * hid its lilac under the art and glowed grey. So the stops go by colorfulness: the
 * most colorful on the rim, the next on the halo — or the rim's own color again when
 * the next is grey — and the least under the cover. An all-grey cover stays grey.
 * The NP text roles still read Apple's c1 / c2 (album-color.ts applyText); only the
 * glow is ranked.
 */
export function auroraSlots(p: AlbumPalette): [string | undefined, string | undefined, string | undefined] {
  const [first, second, third] = rankByColor(p);
  if (!first) return [undefined, undefined, undefined];
  const halo = second && (second.chroma >= GREY_CHROMA || first.chroma < GREY_CHROMA) ? second.s : first.s;
  return [third?.s ?? second?.s, first.s, halo];
}
