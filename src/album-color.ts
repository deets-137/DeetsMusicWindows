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
import { auroraSlots, fromOKLCH, lin, parseColor, toOKLCH, type AlbumPalette, type RGB } from "./album-slots";

const PROPS = ["--album-bg", "--album-c1", "--album-c2"] as const;
const TEXT_PROPS = ["--np-title", "--np-subtext", "--np-accent"] as const;

// ── WCAG 2 contrast (the OKLCH math is in album-slots.ts) ───────────────────────
/** Alpha of an rgba() string (1 for anything else). */
const alphaOf = (s: string): number => {
  const m = /rgba?\([^)]*[,/]\s*([\d.]+)\s*\)$/i.exec(s.trim());
  return m ? Number(m[1]) : 1;
};
const luminance = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const hex = ([r, g, b]: RGB) =>
  "#" + [r, g, b].map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, "0")).join("");

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

// One lookup per cover however many watchers ask (the NP card and the Ocean sea both do, in
// the same player tick): a miss asks Apple once, and the second asker shares that promise.
const inFlight = new Map<string, Promise<AlbumPalette | null>>();
/** The palette for a cover: the Rust cache first, then one Apple lookup (`album_palette`). */
export function lookupPalette(coverUrl: string, catalogId: string | null): Promise<AlbumPalette | null> {
  let p = inFlight.get(coverUrl);
  if (!p) {
    p = invoke<AlbumPalette | null>("album_palette", { coverUrl, catalogId }).finally(() => inFlight.delete(coverUrl));
    inFlight.set(coverUrl, p);
  }
  return p;
}

/** The current song's cover and catalog id, the key both palette watchers use. */
export function currentCover(): { cover: string | null; catalogId: string | null } {
  const cur = getCurrent();
  const track = trackById(cur?.catalogId ?? cur?.libraryId);
  return { cover: track?.artwork?.urlTemplate ?? null, catalogId: cur?.catalogId ?? track?.catalogId ?? null };
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
    const slots = auroraSlots(p);
    PROPS.forEach((prop, i) => {
      if (slots[i]) card.style.setProperty(prop, slots[i]!);
      else card.style.removeProperty(prop);
    });
    card.classList.add("np--album");
    livePalette = p;
    applyText();
  };

  const unsub = onPlayerState(() => {
    const { cover, catalogId } = currentCover();

    if (cover === liveKey) return; // same album (or still nothing) — no work
    liveKey = cover;

    if (!cover) {
      clear();
      return;
    }
    // Theme fallback shows until (unless) a palette arrives — never stall the UI.
    clear();
    const requestedKey = cover;
    lookupPalette(cover, catalogId)
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
