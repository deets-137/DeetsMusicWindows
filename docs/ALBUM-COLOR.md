# DeetsMusic — Album Color (the radiant Now-Playing aurora)

> How the current track's artwork tints the player. The Now Playing card grows an
> **aurora sourced from the album's own palette** that **rotates as if a light is
> sweeping the art**. Read this before touching `now-playing-card.ts`, the skin base, or
> the roadmap #7 palette plumbing. Status legend: ✅ decided · 🔵 open (my call unless you
> red-line). Siblings: [UI-ARCHITECTURE](UI-ARCHITECTURE.md) (the token tiers + doctrine),
> [SURFACES-AND-CARDS](SURFACES-AND-CARDS.md) (surfaces/cards), [HANDOFF](HANDOFF.md)
> (roadmap #7 = the data path this rides).

---

## What it is

Glass's aurora today is a **canvas** effect (`--canvas-bg`: three theme-accent radial blobs
refracted by every panel). Album color is a **different, localized** thing: an aurora
**scoped to the Now Playing card**, sourced from the **current track's artwork palette**
instead of the theme's accent roles, with its **origin at the cover** and a slow **rotation**
so the color appears to circle / highlight the art.

- **Replace, card-scoped** ✅ — inside the NP card the album owns the aurora; every other
  panel (Library / Queue) keeps the theme aurora untouched. No album → the NP card falls
  back to a theme-accent aurora (indistinguishable from a normal panel).
- **Skin-general capability** ✅ — not glass-only. The `[data-skin]` base ships a default
  expression so *every* skin renders it; each skin may override to its idiom. Glass is the
  flagship (the frost refracts it).
- **Surface scope:** midi for now ✅ — the NP card only exists in midi today; the CSS gates on
  the NP card, effectively midi-only. max/mini inherit or redefine when they're built.

---

## The fourth tier: runtime album roles

Album color is a **runtime, per-track** value, so it cannot live in the palette / theme /
skin CSS files (those are static). It becomes a **fourth source that sits above theme**:

- **JS sets runtime album roles as inline custom props on the NP card element** (scoped to
  the card, not `<html>`):
  - `--album-bg`  — Apple `Artwork.bgColor` (the art's dominant field)
  - `--album-c1`  — Apple `textColor1` (primary accent hue)
  - `--album-c2`  — Apple `textColor2` (secondary accent hue)
- **Theme declares the fallbacks** so the props are never empty (in `themes.css`, once, as
  roles): `--album-bg: var(--surface); --album-c1: var(--go); --album-c2: var(--stop);`.
  With no album loaded, the aurora is theme-accent-sourced — i.e. today's glass, localized.
- **A presence class** `.np--album` (or `[data-album="on"]`) toggles when a real palette is
  applied, in case a skin wants to render the album and no-album cases differently.

**Doctrine preserved:** no skin or theme ever *names* an album hex. JS injects the runtime
values; the theme owns the fallback; the skin owns only the *expression* (geometry / motion /
how far it bleeds). Album color is a **role source**, exactly like a theme — just a dynamic
one. (See [UI-ARCHITECTURE §2–3](UI-ARCHITECTURE.md).)

---

## Data path (rides roadmap #7)

This is **the first consumer of #7's per-album palette plumbing** — build them together.

1. Apple's `Artwork` carries `bgColor` + `textColor1..4` (hex, no `#`). We use `bgColor` +
   `textColor1` + `textColor2` (see stops below).
2. **Keyed by cover-art URL** (an album's tracks share one cover — one fetch per album),
   cached. On track change the NP card:
   - **cache hit** → apply the three props (with a CSS transition = crossfade).
   - **miss** → apply theme fallback immediately, fetch the palette lazily (catalog
     `Artwork`), cache, then crossfade in.
   - **unavailable** (no catalog match) → stay on theme fallback.
3. Cache + lazy-fetch live with #7's palette cache (keyed by cover URL), not a batch
   pre-fetch — consistent with "catalog data is demand-driven."

---

## The aurora (a skin capability)

- **Base default** (in the `[data-skin]` base block, scoped to the NP card) renders the
  album aurora so every skin gets it: a radial gradient stack **originating at the cover**,
  built from the `--album-*` roles, on a layer *behind* the card content.
- **Per-skin override**: a skin restyles the same layer in its idiom without naming a color —
  **glass** refracts it through `--panel-backdrop` (its frost already saturates the aurora);
  a flat skin (vanilla) shows it as a soft radial bloom; desk/ocean can tune strength/shape.
- **Placement:** the aurora is a `::before` (or a dedicated child) on the NP card, absolutely
  positioned, `z` below the cover/text, clipped to the card radius. Its gradient origin is
  aligned to the **cover's center** (the cover is a fixed `--np-cover` square in the strip).

### Colors → stops ✅ (2–3 colors)

Innermost stop at the cover, fading outward:

```
radial-gradient(at <cover-center>,
  color-mix(in srgb, var(--album-bg) S%, transparent)  0%,     /* dominant field, at the art */
  color-mix(in srgb, var(--album-c1) S%, transparent)  45%,    /* primary accent */
  transparent 78%)
+ an offset second blob from var(--album-c2) for depth (optional third color)
```

`S` = `--album-aurora-strength` (a skin token, default e.g. `36%`). **Contrast safety** ✅:
every stop is a `color-mix(... , transparent)` and may additionally mix toward `--surface`,
so a blown-out Apple `bgColor` can't nuke legibility on dark themes (moonlight / hornet).

---

## Motion — the rotating highlight ✅

The album stops **orbit the cover's center**, so the color reads as a light sweeping the art.

- Implement as a **slow `rotate()` on the aurora layer** (the gradient stack lives on a
  `::before` that spins ~360° over a long period), *not* a positional drift. Keep the cover
  itself static — only the color layer behind/around it rotates.
- **Crossfade on track change**: transition the `--album-*` props (and/or opacity-swap two
  aurora layers) so switching albums dissolves rather than cuts.
- **Reduced motion**: `prefers-reduced-motion` freezes the rotation (static aurora); the
  crossfade may stay (it's not vestibular).
- Tokens: `--album-spin-dur` (rotation period), `--album-fade-dur` (crossfade), both skin.

---

## Text & accent ✅

- **Keep theme text roles** — the NP title/artist stay `--title`/`--text`. The frost (glass)
  or low `S` (flat skins) mutes the aurora enough that theme text stays legible across all 4
  themes regardless of Apple's palette. We do **not** adopt Apple's `textColors` for copy.
- 🔵 **Optional later:** route `--album-c1` into the NP scrubber fill (`--go` within the card
  only) for an album-tinted scrubber. Off by default; easy add once the roles exist.

---

## Tokens introduced

| Token | Tier | Meaning |
|---|---|---|
| `--album-bg` / `--album-c1` / `--album-c2` | **runtime role** | per-track palette; JS-set on the NP card, theme fallback |
| `--album-aurora-strength` | skin | alpha/mix strength of the aurora stops |
| `--album-spin-dur` | skin | rotation period of the highlight |
| `--album-fade-dur` | skin | crossfade duration on track change |

Theme (`themes.css`) declares the **fallbacks** for the three runtime roles; skins declare
the three skin tokens (base defaults + per-skin overrides). No album hex anywhere.

---

## Decisions

**Closed ✅**
- Replace (card-scoped), not stacked with the theme aurora.
- 2–3 colors: `bgColor` + `textColor1` (+ `textColor2` offset).
- Motion = the aurora **rotates** around the cover (highlight sweep); crossfade on track
  change; reduced-motion freezes it.
- Keep theme text roles; no Apple `textColors` for copy.
- Contrast: `color-mix` toward transparent (+ optionally `--surface`), gated by a strength
  token. "Fine for now."
- **Skin-general**: base default expression + per-skin overrides; glass is the flagship.

**Open 🔵**
- **Default-on for all skins vs. glass-first.** Recommend: base default **on** for every skin
  (truly "available for every skin"), with glass tuned first and the other skins' expressions
  refined as we polish. Alternative: ship glass's expression only, base no-op, others opt in
  later.
- **Global user toggle** ("tint the player with album art" on/off) — a natural future
  setting; defaults on. Record in [FUTURE-SETTINGS](FUTURE-SETTINGS.md) when built.
- Optional scrubber accent tint (above).

---

## Risks / verify

- **Listener/fetch on track change** — the palette lookup must be cheap and cache-first; a
  miss must not stall the crossfade (apply fallback first, fade in on arrival).
- **Rotation cost** — a spinning `::before` with `backdrop-filter` (glass) is the priciest
  combo; verify it's smooth in WebView2 at the NP card size. Prefer transforming a single
  layer over animating gradient stops.
- **Gate correctness** — the aurora must be scoped so it never leaks onto Library/Queue
  panels; verify the theme fallback path renders identically to a normal panel when no album
  is loaded.
- **Doctrine canary** — grep the skin/theme blocks: the only literal colors introduced must
  be *runtime* (JS-set) — no hex added to any CSS file.
