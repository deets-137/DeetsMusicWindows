# DeetsMusic — UI Architecture

> How the front-end is structured. Read this before adding a theme, a skin, or a
> new view. The guiding rule: **the UI references semantic tokens only — never a
> raw hex, never a hardcoded px or font name.**

---

## 1. The three token tiers

Styling is split into three orthogonal layers. Each lives in its own file under
`src/styles/` and is `@import`ed (in this order) by `src/styles.css`.

| Tier | File | Holds | Selector | Lever |
|---|---|---|---|---|
| **Palette** | `palette.css` | raw named hexes (`--paint-dewy-lilac`) | `:root` | the box of crayons |
| **Theme** | `themes.css` | color *roles* → palette | `[data-theme="…"]` | recolor the app |
| **Skin** | `skin.css` | everything non-color: type, size, radius, spacing, geometry | `[data-skin="…"]` | reshape/retype the app |

Both are set on `<html>`: `<html data-theme="lilac" data-skin="press">`.
Theme and skin are **independent** — any theme works with any skin.

### Why palette is separate from theme
Palette names a color once (`--paint-lemon-chrome: #F6C700`). Themes map *roles*
to those names. A color used by two roles is defined once; a theme is just a
short mapping block, easy to read and diff.

---

## 2. Color roles (theme)

The complete set the UI is allowed to reference:

| Role | Meaning |
|---|---|
| `--canvas` | app background / wallpaper |
| `--go` | traffic light: **maximize** (`+`) — green family |
| `--stop` | traffic light: **close** (`×`) — red family |
| `--pause` | traffic light: **minimize** (`−`) — yellow family |
| `--traffic-glyph` | the `+ − ×` sigil stroke, drawn *on* the light fills — so its contrast is theme-owned, not a skin literal |
| `--title` | app title + headings |
| `--text` | primary text |
| `--subtext` | secondary / dim text |
| `--surface` | floating panel background (menus, popovers) — distinct from canvas |
| `--surface-hover` | highlighted / hovered row inside a panel |
| `--border` | hairline panel edge (kept as low-alpha so it reads on any canvas) |
| `--glint` | light catching a glass edge (the Glass lens playhead). White in every theme via `light-dark()`, dimmer on dark ones; declared once on `:root`, never remapped by a theme (2026-09-16) |
| `--ink-2` | the **second plate** — one spot color printed slightly out of register behind cards and menus. Only the Press skin prints it, but the *choice* is the theme's: which of its own accents survives as a solid 4px block on that theme's stock. `:root` falls back to `--go`, so a theme that never names it still prints. |

Traffic-light role names are deliberately function-named (`go/stop/pause`) not
color-named, so a theme can shade them to fit its canvas without the names lying.

Each theme also declares `color-scheme: light|dark` (so native controls, the
scrollbar corner, and autofill match) and a few non-table roles every block maps:
`--surface` / `--surface-hover`, `--border`, `--panel-border`, and `--scrollbar` /
`--scrollbar-hover`.

### Themes that ship today
- **`lilac`** — twilight-lilac canvas, twilight-plum headings, with magenta + gold fae accents.
- **`green`** — lilac's structure in chartreuse: dewy chartreuse canvas, forest-green title,
  moss/sage type, fern + foxglove + gold traffic lights (gold reuses lemon-chrome).
- **`sepia`** — warm parchment + amber, vibe pulled from the harness "Sepia Dreams".
- **`moonlight`** — dark mode: deep slate-blue canvas, slate blue-gray type (bright→dim),
  monochrome traffic lights (moonlight white→gray).
- **`black-yellow`** — Noir Gold: near-black canvas, hi-vis yellow title, warm-white
  body, monochrome-yellow traffic lights (no green/red), gold hairline borders.
- **`black-red`** — black-yellow's structure in red (cyber villain): reuses pitch/onyx surfaces,
  siren-red title, ash-white body, monochrome-red traffic lights (siren/blood/ember), red
  hairline borders.

### Add a theme
1. Add any new paints to `palette.css`.
2. Add a `[data-theme="yourname"] { … }` block in `themes.css` mapping **every color
   role** (the table above + the non-table roles noted there), set `color-scheme`, and
   pick a `--traffic-glyph` that reads on your light fills.
3. Add the theme name to the `THEMES` array in `swatch.html` to preview it.

---

## 3. Skin tokens

- **SCRUBBERS (2026-09-16, NEXT-VERSION §21).** Every `.scrub` handle has two layers. The
  *plain* handle is a `--title` box masked by the skin's `--scrubber-handle` SVG (Press block,
  Ocean lens swell, Glass ring, Cyber bolt). With **Settings › Look and feel › Fancy
  scrubber** on (`data-fancy-scrub="on"` on `<html>`, default on), the skin's own playhead
  draws over it in `styles.css` §Fancy scrubbers: the **Press I-beam** (a stroke with a bar
  top and bottom; thickens under the hand and takes the `--ink-2` plate shadow), the **Ocean
  float** (a teardrop; bobs and sends a ripple ring while playing, dips while held), the
  **Glass hollow lens** (a clear centre, a lit rim, a specular dot that drifts while playing;
  swells under the hand; no backdrop-filter) and the **charged bolt** (breathes a glow while
  playing, burns tight while held, flickers on release). The first three are 14 px
  (`--scrub-fancy-size`). Gates: `data-playing` on `<html>` (main.ts) for every loop; `data-dragging` /
  `data-released` on the slider (slider.ts) for the hand states; reduced motion stops all of
  it. Loops move transform, opacity and, for the bolt, a drop-shadow only. Tokens:
  `--scrub-nib-w / -hover-w / -flag`, `--scrub-bob-dur`, `--scrub-sheen-dur`,
  `--scrub-lens-scale`, `--scrub-breathe-dur`. The title-bar volume bar has no handle by
  design. A performance eval on `dev:built` is the next step.
- **Transport motion:** `--sh-cross-dur` / `--sh-cross-gap` (Shuffle's press run: the two
  arrows swing apart to parallel and re-cross) and `--rp-loop-dur` (Repeat's one full turn on
  the press that lands on *one*). Motion is skin, so a skin can slow, quicken or flatten both
  without touching a component. The "on" mode square FILLS (`--picked` + a `--title` border)
  rather than only changing hue: `--np-accent` falls back to `--title`, which is the square's
  own off colour, so a hue-only signal drew nothing in any skin that does not opt into
  `--np-album-text` (NEXT-VERSION.md §14).

### Structure: a shared base + per-skin deltas
`skin.css` opens with a **`[data-skin]` base block** that defines *every* token —
these values **are Vanilla**. Each named skin (`[data-skin="press"]`, `…="ocean"`)
then overrides **only what it changes**. They have equal specificity, base is
declared first, so a skin's overrides win by source order — and a skin may still
override *any* base token. `data-skin` selects one value at a time (a skin does
**not** inherit from the `vanilla` block), which is exactly why the shared defaults
live in the attribute-present `[data-skin]` selector.

**`vanilla`** is the reference skin: it *is* the base, so its block is (almost) empty.
The sanctioned exception: a **vanilla-only expression** other skins shouldn't inherit
(today: the editorial title underline) lives in the `vanilla` block with the base as
the no-op — the same opt-in doctrine as `--hover-lift` / `--panel-backdrop`.

> **The authoritative token list is the code, not this doc.** The `[data-skin]` base
> block in `skin.css` defines every skin token once, with a comment; `themes.css` does
> the same for color roles. This section is the *map*. The *list* is
> **[TOKENS.md](TOKENS.md)**, generated from those files by `npm run tokens` (2026-09-16):
> every role and token, its base value, its comment, and which skins override it, plus the
> overrides no base token declares. It cannot rot: the release check fails when it is stale.

The base defines, among others:

- **Type:** `--font-title` (Liberation Serif), `--font-body` (Liberation Sans),
  `--fs-title / --fs-text / --fs-subtext`, `--fw-*`, `--lh-text`
- **Geometry:** `--midi-w` (480), `--midi-h` (864), `--titlebar-h`, `--traffic-*`,
  `--icon-sm / -md / -lg` (SVG-glyph wrappers)
- **Shape:** `--radius-panel`, `--radius-control`, `--panel-radius`
- **Spacing:** `--space-1 … --space-5`
- **Card fill:** `--panel` (which theme surface the cards use; always a plain color) +
  `--shadow-card`; `--panel-paint` is what the card box actually paints (base `var(--panel)`;
  Glass paints its backlight, Ocean's sand paints nothing); `--panel-backdrop` is the
  frosted-glass blur behind a panel (base `none`; Glass opts in)
- **Skin-only settings layers:** `--canvas-dim` (black over the canvas, under the cards) and
  `--sand-display` / `--sand-reach` / `--sand-ink` (the card's `::before` / `::after`) — see
  *Skin-only settings* below
- **Menu material:** `--menu-surface` / `--menu-backdrop` — the same pair for the
  *floating* tier (menus, flyouts, popovers, ctx-menu, pickers); base = opaque
  `var(--surface)` + no frost, Glass opts in
- **Hover hints:** `--hint-max-w` / `--hint-row-max-w` / `--hint-pad-x` / `--hint-pad-y` /
  `--hint-radius` / `--hint-gap` / `--hint-fs` / `--hint-shift` — the geometry of the one
  hover box (`src/hint.ts`, ONBOARDING.md §1a). It wears the *menu material* above, so a
  skin usually sets none of these; the radius rides `--radius-control`, so squaring a skin's
  controls squares the hint with them
- **Canvas pattern:** `--canvas-bg` / `--canvas-bg-size` / `--canvas-bg-repeat`, and
  `--app-canvas-bg` (what `.app-body` paints; `none` when the skin draws a moving layer)
- **Ambient layers:** `--ocean-*`, `--aurora-*`, `--storm-*`, and `--ambient-fps` (the step
  rate of every endless decorative loop) — see *Ambient layers: the cost rules* below
- **Nav motion:** `--nav-dur`, `--nav-ease`, `--nav-at-center / -left / -right`, `--nav-off-opacity`
- **Micro-motion:** `--dur-fast / -med / -spin`, `--ease-ui`, and `--hover-lift` —
  the transform interactive rows/tiles take on hover (base `none`; a skin opts in)
- **Focus:** `--focus-ring-w` / `--focus-ring-off` (one knob for every focus outline)
- **Library rows/tiles:** `--lib-tile-small / -large / -radius`, `--lib-grid-gap`,
  `--lib-pill-radius`, and `--lib-row-art` / `--lib-row-art-radius` (the density-line
  mini-cover — **the Queue card's rows read these too**, so both song lists share one
  shape + density)

### A skin never names a color — even for surfaces
`--panel` is the key example. "Does this skin lift cards off the canvas?" is a
**skin** decision; the *color* of that surface is a **theme** one. So the skin points
`--panel` at a theme **role** — Vanilla `var(--canvas)` (flush), Press `var(--surface)`
(printed stock) — or **derives** one without naming a hex: Ocean
`color-mix(in srgb, var(--surface), black 18%)` (recessed/darker). The theme always
owns the actual color. Same rule for the canvas pattern and soft borders: their tint
is `var(--border)`, a theme role.

**Glass is the doctrine taken to the limit.** It needs translucency and a colorful
backdrop — both still derived, never named. Panels are `color-mix(--surface 55%,
transparent)` (an *alpha* of a theme role), and the "aurora" the frost refracts is built
from the theme's **accent roles** (`--go` / `--stop` / `--pause`) at low alpha — so Glass
recolors itself per theme (mint/magenta/gold on lilac, all-yellow on black-yellow) without a
single hex. The one thing a token couldn't express was the *blur* itself, so that became
a new primitive: `--panel-backdrop`.

### Nav motion is tokenized, not hardcoded
`.coll-pane` reads its per-position transform/opacity from `--nav-at-*` /
`--nav-off-opacity`, so a skin reshapes the **whole drill-in motion** with values
only — no rule edits. Vanilla slides (`translateX`), Press stamps (the same slide, but
fast and hard-eased at both ends), Ocean sinks (`translateY`), Glass fades/scales.
`prefers-reduced-motion` still disables it.

### Skins that ship today
- **`vanilla`** — the reference, **hidden from the picker since 2026-09-10** (the block stays:
  it is the base, and a saved `vanilla` still applies): flush **borderless** cards (spacing/typography carry the
  grouping) with an **editorial underline** under the app + card titles (`--title-underline`
  tokens, vanilla-only opt-in; behavior toggle is
  [FUTURE-SETTINGS §11](FUTURE-SETTINGS.md)), horizontal slide, Liberation type.
- **`press`** — a risograph print shop; ink on stock, not light on glass. Opaque `--surface`
  cards with a printed `--panel-border` keyline, **every radius trimmed to 0**, and — instead
  of a shadow — a **second plate** printed slightly out of register: a hard `4px 4px 0
  var(--ink-2)` block (menus go one step further, 5px). Blur radius is `0` in every shadow
  here on purpose; a soft edge would break the illusion. The stock is a fine **halftone
  screen** (`--panel-border` dots on a 7px pitch — at that size it reads as paper tooth, not
  as a pattern). The hover-lift moves on **both axes** (`translate(-1px, -1px)`, the only skin
  that does): the sheet slides up-left off its ink, *widening* the misregistration to 5px
  rather than floating above it. Mono body sizes down a step (14 → 13px) with extra leading,
  since Plex Mono runs wide at the 480px midi width. Anton (title, one weight — `--fw-title`
  drops to 400) + IBM Plex Mono (body). **Retired the `desk` skin** it replaced; a saved
  `desk` id migrates via `RETIRED` in `skin.ts`.
- **`ocean`** — deep/abyssal: recessed soft-edged cards (`color-mix`) on a surface of three
  rolling **SVG wave trains** (the ocean layer, below), a sink/rise nav, Cinzel (title) +
  Spectral (body). Optional **sand card edges** with a width slider (§Sand edges; off by default).
  Pairs best with light themes (its black-mix cards + shadows are faint on dark canvases — a
  per-theme `--surface-sunken` role is the documented upgrade if Ocean needs true depth there).
- **`glass`** — frosted glassmorphism: translucent panels (`color-mix` alpha of `--surface`)
  with a real `backdrop-filter` blur (`--panel-backdrop`) over a per-theme accent "aurora"
  whose blobs **drift** (the **aurora layer**: one `.aurora__blob` box per gradient, each
  moved by `transform` along its own `--aurora-drift-N-x/-y`, oversized by `--aurora-slack`
  so the drift never drags a gradient's cut edge into view; the extension pages paint the
  same stack still, from `--canvas-bg`),
  **frosted menus** (the `--menu-surface` / `--menu-backdrop` pair — milkier than panels, 65%
  vs 55%, for text legibility), a glass-ring scrubber handle (evenodd hollow), rounded glass
  chips, a fade/scale nav, light sans title. See the doctrine note above for how it stays
  hex-free. Four Settings sliders tune it — Canvas glow, Dim canvas, Backlight (a glow inside
  each card), Tint cards (§Glass's sliders); the other intensity numbers are catalogued in
  [FUTURE-SETTINGS §12](FUTURE-SETTINGS.md) (skin-specific). Open upgrade: a `--highlight` theme role for a true white sheen.
- **`cyber`** — electric/futuristic: two lightning bolts slow-draw down the canvas
  behind the cards (the **storm layer**, below), smoked-glass panels (86% `--canvas` mix —
  a bolt passing behind a card glows through dimly) with a hard 1px edge and no soft shadow,
  a faint `--border` circuit grid, square corners everywhere, a skew-snap nav jolt
  (`skewX` in the `--nav-at-*` transforms), a lightning-bolt scrubber handle, Orbitron
  (title) + Rajdhani 500 (body). Storm dials are catalogued in
  [FUTURE-SETTINGS §13](FUTURE-SETTINGS.md) (skin-specific). Pairs best with dark themes
  (moonlight / black-yellow / black-red), where the bolts read as light.
  **Named Retro-Future until 2026-09-17** (CyberStorm before that); saved `retro-future` and
  `cyberstorm` ids migrate via `RETIRED` in `skin.ts`, the pre-paints, `settings-store.ts` (day/night
  skin) and the extension. DeetsSolutions and the hosted sign-in (DeetsSupport `signin.js`) were renamed the same day.

### Ambient layers: the cost rules (2026-09-13)
The ocean, aurora, and storm layers (and the Now Playing aurora spin) loop forever, so their
per-frame cost is the app's idle CPU. Measured before these rules: Ocean 46%, Glass 205%,
Cyber 200% of one core at idle; after: 12 / 20 / 17 (DEBUGGING.md has the table).
1. **Animate only `transform` and `opacity`, on plain boxes.** Then the compositor moves
   finished layers and the main thread paints nothing. SVG child transforms,
   `background-position`, and `stroke-dashoffset` all repaint every frame.
2. **Step every loop at `--ambient-fps`** (`steps(round(<dur> * var(--ambient-fps) / 1s))`,
   divided by the keyframe segment count). The compositor otherwise draws at the display
   rate, and everything under a translucent card redraws with it. `steps()` replaces the
   easing, so an eased loop samples its curve into keyframes (`ocean-bob`, `aurora-drift`).
3. **Pause while the window cannot be seen.** `src/ambient.ts` sets `data-ambient="paused"`
   when the window is minimized or hidden; a new loop joins the selector in `styles.css`.
   WebView2 does not fire `visibilitychange` for either state.

### The ocean layer (opt-in rolling swell)
The same opt-in doctrine as the storm layer, for a *surface* rather than strokes: a
`<div class="ocean">` in `.app-body` behind the bento, holding three wave trains. Inert
unless a skin flips `--ocean-display` (only Ocean does). Each train is a `.ocean__bob` box
around a `.ocean__roll` box; the roll's `::before` (fill) and `::after` (crest) are masked by
SVG tile data URLs (`--swell-fill` / `--swell-crest` in `styles.css`). The fill masks
roughly double the GPU cost per frame (measured), so avoid adding more masked trains.

Each tile is **one full sine period** — `M0 c Q W/4 (c−a) W/2 c T W c`, the `T`
mirroring the `Q` — so the curve's **value and tangent** both match at the tile edge and
the horizontal seam is invisible. Each train paints an **opaque `--canvas` fill** beneath
its hairline crest, so a nearer swell *occludes* the ones behind it instead of three
see-through lines crossing. Atmospheric perspective is three skin tokens: `--ocean-ink-1`
is full `--border`, `-2` / `-3` mix it toward `--canvas` (70% / 45%), so far waves recede
into haze.

Motion is split across **two elements** so the transforms compose rather than overwrite:
`ocean-roll` translates the roll box (linear), `ocean-bob` the wrapping bob box (a sine
sampled into keyframes, alternate). Per-layer distances come from `--roll-dist` / `--bob-amp`, resolved
*inside* the shared keyframes per element. Each train rolls an **integer number of its own
tile width** per 16s loop (144 = 3×48, 128 = 2×64, 80 = 1×80), nearest fastest, so the wrap
never shows; the middle train bobs counter-phase so the sea breathes rather than pumps, and
9s·2 vs 16s never sync (LCM 144s). The roll box is oversized +320px and shifted −160px so a
full roll never drags its own edge into view; the mask origin (`160px 8px`) puts the tile
grid back at the body corner.

This **replaced** a radial-gradient version, where the scallop arcs crossed at tile corners
and scattered chevron artifacts across the canvas — the reason the tiles are SVG paths. It
then replaced an inline `<svg>` with `<pattern>` fills, whose moving children repainted
every frame (rule 1 above).
Under `prefers-reduced-motion` the ocean stays *visible* and merely stops (unlike the storm,
which hides: a motionless sea is still a sea, a half-drawn bolt reads as a bug).

### Skin-only settings (2026-09-15)
A skin can expose its own knobs as Settings rows. They sit in Settings › Look and feel and
show **only while that skin is active**. Today: Ocean's *Draw card edges* + *Sand width*
(§Sand edges), Glass's *Canvas glow*, *Dim canvas*, *Backlight*, *Tint cards* (§Glass's
sliders), and Press's *Record player*, *Show record on*, *Spin speed*, *Show record plate* (§Press's record
player). This supersedes the "future skin options surface" in FUTURE-SETTINGS §12–13.

**The path of one value:** the store (`settings-store.ts`) → `src/skin-settings.ts` writes it
onto `<html>` (a choice as a `data-` attribute, a 0–100 slider as a custom property) → the
skin's block in `skin.css` reads it. Other skins never read it, so the value can stay stored
while another skin is on. `initSkinSettings()` runs in `main.ts` right after `initSkin()`,
before the first paint, so a card never flashes the default look.

**Rules**
- **The CSS fallback is the default.** Every read is `var(--prop, <default>)`, with the same
  value as `DEFAULTS` in the store. So the tray panel and the extension pages, which load the
  skin tokens but not the store, show the default look.
- **Base stays inert.** A new capability gets a no-op token in the `[data-skin]` base block
  (`--panel-paint: var(--panel)`, `--canvas-dim: 0`, `--sand-display: none`); only the skin
  block or a `:root[data-skin="x"][data-attr="v"]` rule turns it on.
- **Keep `--panel` a plain color.** `album-color.ts` resolves it for the NP contrast guard. A
  skin that paints something else as the card background uses `--panel-paint`.
- **Static, not animated.** Masks, gradients, and shadows that do not move cost only a
  composite over the ambient layers. A moving addition follows the ambient cost rules above.
- **Rows in paint order.** A skin's rows go back to front (background first, then the card),
  so the list reads as the picture builds up. Hint text starts with "<Skin> only."

**Checklist: add a skin-only setting**
1. `settings-store.ts` — a typed key (a union for a choice, `number` 0–100 for a slider) with a
   comment naming the skin; a default in `DEFAULTS`; a `migrate()` line when a value is renamed
   or dropped.
2. `skin-settings.ts` — a choice: set `data-…` in `initSkinSettings`. A slider: one `PROPS`
   entry (`key: ["--prop", unit]`); `previewSkin` and the launch/change wiring then cover it.
3. `skin.css` — the base token (inert) and the skin's read with its fallback. A 0–100 value is
   mapped in CSS (`calc(var(--prop, 50) / 50)`, a min…max range, a cap), never in TS.
4. `settings-card.ts` — the row in Look and feel with `when: () => currentSkin() === "x"`
   (add `&& setting(…)` for a row that depends on another). A range row passes
   `preview: (v) => previewSkin(key, v)`. Label style: DEETS settings-label rules.
5. Docs — a row in SETTINGS.md §3, the key in AGENT.md (*Values* and the skin-only list), and
   the skin's section in this doc.

### Sand edges (Ocean, 2026-09-15)
Settings › Look and feel › **Draw card edges** (`oceanEdges`: **soft** / sand; Soft is the skin's own look). The row shows
only while Ocean is the skin (the settings card's `when` rule + `onSkinChange` in `skin.ts`).
`src/skin-settings.ts` sets `data-ocean-edges` on `<html>`. The idea: a dark beach — the
card's edge breaks into grains of sand over the swell.
- **How:** `.panel` paints `--panel-paint` (base: `var(--panel)`); under Sand it is
  `transparent`. Two static pseudo layers sit under the card content (`z-index: -1`;
  `position: relative` on `.panel` anchors them):
  - `::before` paints `--panel` through a 4-layer mask. Bottom up: x and y edge ramps
    intersect into a rim fade; a dense grain tile (~90% dots) intersects it; a solid core rect
    (inset `--sand-reach`) is added. The grains thin and fade toward the edge.
  - `::after` paints `--sand-ink` specks: a full box minus the core rect gives the rim band;
    a sparse speck tile (~12% dots, another seed) intersects it.
- **Grain tiles:** 128px SVG `feTurbulence` noise, alpha thresholded by a discrete
  `feFuncA`, so each grain is a crisp dot. Density is the `tableValues` count (styles.css): grains ~90% dots, specks ~12% (made denser
  at the desk, same day).
- **Width:** Settings › **Sand width** (`oceanSand` 0–100, default 15 ≈ 9px; shown only while Sand
  is on) → `--ocean-sand` → `--sand-reach` between `--sand-reach-min` 4px and `--sand-reach-max`
  40px (skin.css). A wide band reaches past the 12px card padding, so text can sit on sand.
- **Kept opaque:** `--panel` itself, because `album-color.ts` resolves it for the contrast guard.
- **Dropped under Sand:** `--shadow-card` (an outer shadow traces the hard box edge) and the
  pane fill (`--spane-bg: transparent`; Ocean panes fade on nav, so no mask is needed).
- **Cost:** static masks over the moving swell; the compositor blends, nothing repaints.
- **History (same day, at the desk):** a rolling wave line on the top edge ("I don't like
  waves"), then a smooth transparent fade; both dropped. Saved `waves` / `fade` migrate to `soft`.

### Glass's sliders (2026-09-15)
Settings › Look and feel › **Canvas glow**, **Dim canvas**, **Backlight**, **Tint cards**
(`glassCanvasGlow` / `glassCanvasDim` / `glassBacklight` / `glassTint`, 0–100, range rows shown
only under Glass). The goal: radiant
cards over a deep background. `src/skin-settings.ts` writes `--glass-backlight`, `--glass-tint`
(a %), `--glass-canvas`, and `--glass-canvas-dim` as inline custom properties on `<html>`, at launch and on change; a
slider drag previews them without a store write. The Glass block reads them in one
"layers, back to front" section, and the rows and this list use the same order:
- **Canvas glow:** `--glass-glow: calc(var(--glass-canvas, 50) / 50)` multiplies every
  `--aurora-*` color stop (`min(100%, 50% * var(--glass-glow))`): 0 = a plain deep canvas,
  100 = double. The cards do not change.
- **Dim canvas** (`glassCanvasDim`, default 0): `.app-body::after` (last child, z 0: over the
  aurora, under the bento) paints black at `--canvas-dim` = 0–0.9. The cards' frost samples
  that dim too, so `--panel-backdrop` adds `brightness(calc(1 / (1 - var(--glass-dim))))`,
  which multiplies it back out: only the space between the cards darkens. The card halo is
  painted with the card (above the dim), so it stays bright. The 0.9 cap bounds the restore
  at ×10.
- **Backlight:** `--glass-light` (0–1). The card box's `--panel-paint` (its background) is a
  radial glow of `--go` / `--stop` / `--pause` at up to 60 / 40 / 30% × light, and
  `--shadow-card` adds an outer halo of `--go`.
- **Tint cards:** `--panel: color-mix(… var(--surface) var(--glass-tint, 55%), transparent)`,
  painted as the LAST `--shadow-card` entry, `inset 0 0 0 100vmax var(--panel)`. A box paints
  background, then inset shadows (last listed lowest), then content — so the tint is an opacity
  layer over the backlight, under the top sheen. `--panel` stays a plain color for album-color.ts.
Other skins never read these properties. Menus keep their own 90% `--menu-surface`. A Frost
cards (blur) slider was built first and dropped the same day; the blur is a fixed 14px again.

### Press's record player (2026-09-15)
Settings › Look and feel › **Record player** (Spin / Still / Off), **Show record on**, **Spin speed**
(33⅓ / 45 / 78 rpm), **Show record plate**. The cover box (`.np__art`, in the Now Playing card and the tray panel) holds its art in a
slot from `src/vinyl.ts`: a plate that never turns, the art that turns (one Web Animation, the
compositor's), and a sheen that never turns. The place decides the look: skin.css sets
`--vinyl-stage` / `--vinyl-strip` / `--vinyl-tray` (1 or 0) from the rows; styles.css hands one to
`.np__art` as `--vinyl`, and the record rules sit in `@container style(--vinyl: 1)`. At 0 the slot
draws the old square cover (`transform: none !important` beats the animation). The cover box is a
size container so the record is a centered square of `100cqmin`. Geometry, ink and slide timing
are `--vinyl-*` tokens (base inert, Press values). The angle follows the song, each disc starts and
ends upright at any of the three speeds, and a song change slides the discs as Web Animations — [VINYL.md](VINYL.md), with its
dev telemetry (`[perf] vinyl …`, `__vinyl.sample`) in §8.

### The storm layer (opt-in decorative strokes)
A reusable primitive, same opt-in doctrine as `--panel-backdrop`: a `<div class="storm">`
in `.app-body` behind the bento, holding two strikes. Each strike is
`.storm__strike > .storm__hold > svg > path.storm__bolt`. Everything about it is tokens:
`--storm-display` (base `none` — the layer is inert, its animation never runs),
`--storm-ink` (a theme **role**, so bolts recolor per theme), `--storm-glow`, `--storm-w`,
`--storm-cycle-1/-2`, and — the trick that keeps geometry in the skin tier —
**`--storm-path-1/-2` applied via CSS `d: path(...)`** (Chromium supports it), so a future
skin could reuse the layer for rain / falling stars / scan lines with no markup change.
The reveal is a **wipe** (since 2026-09-13; it was a `stroke-dashoffset` draw, which
re-rendered the `drop-shadow` glow every frame — rule 1 above). The bolt is painted once;
`storm-strike` slides the clipping strike box down from above while `storm-hold` slides the
inner box up by the same amount, so the bolt stays still and the clip edge reveals it top to
bottom. Both run the same cycle and step count, so they stay locked. The visible difference:
the leading edge is straight, and a fork appears as the wipe passes it instead of growing out.
To restore the path draw, revert this layer (git history before 2026-09-13's ambient change).
Unequal per-bolt cycle durations make the two strikes drift out of phase forever. Each bolt
is a **forked channel** — a main trunk plus one or two branches — authored as a *single
continuous subpath*: at each fork the path darts out to the branch tip and **retraces the
same line back** to the trunk. That mattered for the old dash draw (`stroke-dasharray`
restarts at every subpath); the wipe does not need it, but the geometry is kept. The one
non-CSS piece is **position randomness**: `src/storm.ts` re-rolls each strike's `--storm-x`
(+ a `scaleX` mirror) on the strike box's `animationiteration` — the loop seam, where
opacity is 0, so the jump is never seen. `prefers-reduced-motion` hides the layer outright (a frozen half-drawn bolt reads
as a bug).

### Add a skin
Add a `[data-skin="yourname"] { … }` block in `skin.css` overriding only the tokens
you change. Switch with `data-skin` on `<html>`. **No color belongs here** — point a
slot at a theme role or `color-mix` a role; never a raw hex. Bundle any new fonts in
`fonts.css` (SIL OFL, like Liberation). Add the name to `SkinName` in `src/skin.ts`
and a `.flyout__item` to the Skin row in `index.html`.

---

## 4. The frameless window & titlebar

The OS frame is disabled (`decorations: false` in `tauri.conf.json`) and we draw
our own chrome.

- **Surfaces:** mini-player · **midi-player** (480×864, current scaffold) · full window.
- **Titlebar** (`.titlebar` in `index.html`): app title (left) + a right cluster
  (`.chrome-right`) holding the **sleep timer** clock (NEXT-VERSION §17), the **volume
  pill** (it grows in place on hover and scrubs there, NEXT-VERSION §20 — no flyout since
  2026-09-16) and the traffic lights in Windows' order (minimize, maximize, close).
- **Drag:** the bar carries `data-tauri-drag-region`, which makes it the OS drag
  handle. Interactive children (the buttons) opt out automatically by *not*
  carrying the attribute. `--webkit-app-region` is **not** used — Tauri's attribute
  is the supported path.
- **Traffic lights:** `+` maximize / `−` minimize / `×` close, colored
  `--go` / `--pause` / `--stop`. Glyphs always visible for now.

### Settings menu (the title is the trigger)
The `DeetsMusic` title is a `<button>` that **opts out of the drag region** and
opens a settings menu (`src/main.ts`). The menu is a list of rows; each row can own a
hover-reveal **flyout**. Today there's one row, **Theme**, whose flyout lists the
available themes and applies one on click via `src/theme.ts` (persisted to
`localStorage`, re-applied on launch). An **Account** row holds Apple Music sign-in
(✓/✗ + spinner) — wired in `src/apple.ts` (see
[DATA-ARCHITECTURE.md](DATA-ARCHITECTURE.md) §2). **Since 2026-09-10 the menu holds
only Theme / Skin / Surface / Account and one `Settings…` row that summons the Settings
card; every preference toggle below moved there — see [SETTINGS.md](SETTINGS.md). The
pattern is kept here as history.** A row can also be a **toggle**
(`.menu__row--toggle`, a `<button role="menuitemcheckbox">`): **Always on Top** flips
`appWindow.setAlwaysOnTop()` and shows a right-aligned **dot** (`.menu__dot`) when
active — the same selection indicator the theme flyout uses; the choice persists
(`localStorage` `deets.alwaysOnTop`) and re-applies on launch (needs the
`core:window:allow-set-always-on-top` capability). **Hover-Menu** is a second toggle
(`localStorage` `deets.menuMode`, default off/click) — see the dropdown primitive below.
A **Skin** row mirrors Theme exactly (flyout of `[data-skin-choice]` items, wired in
`src/skin.ts` — `applySkin`/`initSkin`, `localStorage` `deets.skin`); further settings
slot in the same way. Because the title is now interactive, the **draggable zone is the
middle `.drag-region`** between the title and the lights, not the whole bar.

**One dropdown open at a time (2026-09-16).** A trigger's click stops propagation, so no other open
dropdown sees a "click away". Opening a dropdown therefore closes every other open one itself
(reason `away`, so `shouldStayOpen` still vetoes), except a dropdown whose root or panel holds the
new trigger (a panel inside a panel, like the AirPlay square in the volume panel). Found when the
sleep panel stayed open on top of a just-opened Sound panel.

**One dropdown primitive for every menu** (`src/dropdown.ts`, `makeDropdown`): the settings
menu, the sleep timer's panel, the AirPlay "Play on" panel, and the **slot-card pickers** share a single open/close/dismiss
mechanism (outside-click + Escape, `aria-expanded`, an optional `shouldStayOpen` veto so a
volume drag can't close the panel under itself, a `disabled` veto the picker uses to go
inert off-root, and an `onOpen` hook). The slot picker's `onOpen` fits the menu to the window
on every open (2026-09-14, `layout.ts` `fit`): a list taller than the room under the title
goes to two columns (`.slot-picker__menu--cols`), scrolls if even that doesn't fit, and
shifts left past the right edge. Each call takes a `root` (the hover region — must contain both trigger and
panel), a `trigger`, and a `panel`. **Menu mode lives in the primitive:** every live dropdown
registers in a module-level set, and `setDropdownMode("click"|"hover")` fans a change out to
all of them — so the **Hover-Menu** toggle (in `main.ts`, which owns the persistence) flips
every dropdown at once. `makeDropdown` returns a handle with **`destroy()`** (unregisters +
drops its document listeners) so a card swapped out of a slot doesn't leak. Scope is
**top-level triggers only** — nested sub-flyouts (Theme/Skin/Account) stay hover-reveal
regardless. Click always works even in hover mode (it pins the panel open/closed).

### Panels & the bento (home screen)
The content area is a **bento grid** of **panels**. Three altitudes:
- **Panel** — the primitive (`.panel`): a rounded-rect surface with optional
  `.panel__head` (title + action slot) and a scrolling `.panel__body`.
- **Card** — a **mountable module** in the card registry (`src/cards.ts`), built into a slot
  at runtime; each card owns its markup (the `index.html` panels are empty hosts). Cards:
  `now-playing` (live transport), `library` (real synced songs + a header **refresh** action,
  `.panel__action`), `queue`, `playlists`, `search`, `history`. The midi bento has an **anchored**
  Now Playing slot + **two swappable content slots** whose **title is a card picker** — see
  [SURFACES-AND-CARDS.md](SURFACES-AND-CARDS.md) and **§4a** for the collection-card controls.
- **Screen** — a composition of cards in the grid (`data-screen="home"`). Future *surfaces*
  (mini/midi/max) will gate the whole bento off a `data-surface` attribute (the card system's
  Phase 3 seam).

**Layout is slot/span-based:** the bento is a 2-col grid of `.panel` hosts
(`data-slot="np|left|right"`); `data-span="wide"` spans both columns. The home is `auto / 1fr`
rows — Now Playing is a short wide strip up top, the two content slots are tall columns that
**scroll individually** (the body scrolls, the bento frame stays put).

**Panels under Vanilla** are invisible groupers: `--panel` = `--canvas` (fill matches the
background) and `--panel-border-width` = `0` — no edge, no shadow; the bento gap, panel
padding, and card titles do the structuring (Glass is the one skin that opts back into a
`1px` edge). Ocean's sand edges below are the first such layer. The fill is a **skin** token now
(`--panel` points at a theme role — Press `--surface`, Ocean a `color-mix` of it), the
edge color (`--panel-border`) stays **theme**, and `--panel-border-width` / `--panel-radius`
/ `--panel-pad` / `--shadow-card` are **skin** — so Press/Ocean restyle panels into real
cards (distinct fill + a printed plate or a drop shadow) with **no markup change**. Note: rounded +
exotic borders (gradient/wavy) can't use CSS `border` (border-image ignores
`border-radius`) — such a skin draws the edge on a `::before` masked/SVG layer instead.

**Scrubber handle is skin-swappable:** the Now Playing handle is a `--title`-filled
box masked by the `--scrubber-handle` SVG token (a `url(<data-uri>)`), so the shape is
arbitrary yet still themes via `--title` and sizes via `--scrubber-handle-size`. Skins
override the token only: Vanilla a circle, Ocean a water droplet, Press a trimmed block.
The masked SVG must be drawn **centered in its viewBox** — `mask: center` centers the
box, not the ink, so an off-center path floats above/below the rail (Ocean's lens path
spans y = 5→19 of 0–24 for this reason).

**One slider primitive for seek + volume** (`src/slider.ts`, `makeSlider`): a single
pointer-capture loop maps a drag to a `0..1` fraction along one axis and publishes it
as the `--slider-fill` CSS prop. The markup is the shared `.scrub` block —
`.scrub__track` / `.scrub__fill` / `.scrub__handle` — horizontal by default, `.scrub--v`
flips it vertical (fill grows bottom→top). The seek bar uses `axis: "x"` → `seekToFraction`;
the volume slider uses `axis: "y"` → `setVolume`. `setValue(frac)` lets external state
(live playback progress) drive the fill and is a no-op while the user is dragging.

**Volume pill** (`.vol` in `.chrome-right`): a level-meter capsule the height of a
traffic light that drops a flyout on hover (with a 150 ms close-grace; click also
toggles it, like the settings menu). The pill's fill is a **tinted `--title`** wash
(`color-mix` at `--vol-fill-strength`, a skin token) sweeping under a constant `Vol.`
label — the translucency preserves the surface's light/dark polarity, so the label
stays legible over both filled and empty halves in every theme. The flyout holds a
**mute toggle** (speaker glyph, swapped muted/unmuted) above a vertical `.scrub`.
The audio side is `music.volume` (0..1) — app-side software gain on our own stream,
*not* the system volume — persisted in `localStorage` (`deets.volume` / `deets.muted`)
and re-applied on the next `initPlayer` (the MusicKit instance only exists after first
play, so `setVolume` stores early and pushes the level on init). See
[DATA-ARCHITECTURE.md](DATA-ARCHITECTURE.md) for the player module.

### 4a. The collection card (navigable browser engine)
`src/collection-card.ts` is a **reusable, context-aware browser** that the Library
card drives today and the Playlists card will reuse. The card markup is just chrome
+ a mount point: a `.panel__head` (with a `.panel__back` chevron + `.panel__title` +
optional `.panel__action`) and an empty `.coll-body`. The engine renders everything
inside `.coll-body` and is fed a **root context** (`src/library-card.ts` builds the
Library's). Styles live under the "Library card" / "collection card" blocks in
`styles.css`; the class prefix is still `lib-*` (shared with any card the engine runs).

**Contexts → groupings → sorts.** A **context** has a title, one or more
**groupings**, and whether density applies. A **grouping** declares its own sort
specs, a live `list()` accessor, a `match()` for search, a `render(item, density,
idx)`, an optional `open(item)` that returns a **child context** to drill into, an
optional `activate(item, i, items)` (the leaf click — play), and an optional
`menu(item, i, items)` that returns the item's **right-click actions** (see below).
Because each context carries its own controls, the **Sort/View pills re-render per
level** — and the View pill auto-hides when neither grouping nor density is
meaningful (e.g. a future playlists overview). Library's contexts:
- **Library** (root): groupings **Songs / Albums / Artists**.
- **Album** (drilled from an album, or from a song): that album's tracks, density-only;
  covers omitted (they'd all match). A song click drills here and **highlights** the
  clicked track (`.is-selected` border) and scrolls it into view.
- **Artist** (drilled from an artist): that artist's **Albums + Songs**.

**Toolbar.** Three fully-rounded pills — **Sort · View · Search** (width **40/40/20**).
Sort/View open popovers (`.lib-pop`) that are **portaled to `<body>`** and
fixed-positioned under their pill (same pattern as the right-click menu below) so they
can **overflow the card** — the pane's transform + the clipping viewport would otherwise
trap an in-card popover. Position clamps to the live viewport (flips above the pill when
there's no room below); dismissal is outside-press / Escape / scroll / resize. **Search**
is an icon pill that
**slides an inline search bar down** below the pills (`grid-rows 0fr→1fr`), pushing the
list down. Search is case-insensitive **substring** on title/artist/album; its pill
lights while a query is active. Density = `lines` / `small` / `large` squares
(`lines` rows carry a mini cover — round for artists — except inside an album).

**An empty pane keeps the shape of a filled one (2026-09-15).** A pane with no rows used to
shrink-wrap its hero (`.lib-empty` was a centred grid) and drop the Play / Shuffle row, so the
first song to arrive moved three things at once. Now `.lib-empty` is a plain block, the hero
holds the full width, and `actionsHTML` draws the Play / Shuffle row **disabled** at a count of
0 (`--disabled-alpha`). A context that takes a drop (`dropInto` — an open playlist) draws its
`emptyText` as one **row-shaped slot** with a dashed rim (`.lib-empty__slot`, tokens
`--empty-slot-rim-w` / `-style` / `-alpha`): the ♪ box sits where the first row's mini-cover
will, and a drag over the pane lights the slot itself instead of the whole view. A filter that
matches nothing still shows the plain centred "No matches." line.

**One shared cell.** Every collection card (Library, Playlists) renders each item
through **`musicCell`** (`src/library-card.ts`) — the single builder that picks line
row vs grid tile by density and composes the artwork + text. At *every* density it shows
a **primary** line (song/album/artist name) and a **sub** line (artist / count); large
tiles are just bigger covers, not fewer labels. Keeping the row-vs-tile + density choice
in one place is deliberate: it used to be copy-pasted per grouping, so the same
"title missing at large density" bug lived in every card independently.

**Right-click menu.** A grouping's `menu(item)` returns `MenuItem[]`; the engine adds
**one delegated `contextmenu` listener** on `.coll-viewport`, resolves the row → its
item, and opens a cursor-anchored popover (`src/context-menu.ts`, `openContextMenu`;
`openContextMenuUnder` is the element-anchored dropdown twin — e.g. the Playlists
**+ New Playlist** field). Items come in three species (2026-07-02): **actions**
(`{ label, run, disabled? }`), **text inputs** (`InputItem` — Enter commits, every
dismiss is a cancel), and **submenus** (`SubmenuItem` — a `›` row opening a side
**flyout** in the settings-menu grammar, but **JS-latched** rather than `:hover` so a
flyout text field survives typing; it side-flips near the right edge, clamps + scrolls
vertically, and its `sub()` items resolve lazily on first open — Add to Playlist ▸ is
the first tenant). The popover is a themed HTML element (`.ctx-menu`, mirrors the
settings flyout) **confined to the window** — chosen over a native OS menu precisely so
themes/skins apply; the trade is it can't overflow the window edges, so position is
**clamped to the live viewport** (`clientWidth/Height`, never the fixed 480×864 —
correct under resize / fullscreen / miniplayer) and it closes on outside-press / Escape /
outside-scroll / resize (scrolls **inside** the menu — a long flyout — don't dismiss).
Library wires it on **Songs** and **Albums** (Play Now · Play Next · Add to Queue ·
Add to Playlist ▸ — see [DATA-ARCHITECTURE](DATA-ARCHITECTURE.md) / [QUEUE.md](QUEUE.md) /
[PLAYLISTS.md](PLAYLISTS.md) for the action sides); Artists declare no `menu`, so they
fall through. The right-clicked row carries `.is-context` (same outline as
`.is-selected`) while its menu is open.

**Navigation = a push/pop pane stack.** `.coll-body` holds a clipping
`.coll-viewport`; each context is a `.coll-pane` (absolute, `data-pos`
center/left/right). Drilling in **slides** the current pane left while the child
slides in from the right; back reverses it. Only the header is fixed chrome (the
title updates, the back chevron shows when drilled). The slide is **skin-tokened**
(`--nav-dur` / `--nav-ease`) and respects `prefers-reduced-motion` (instant). Scroll
position is **saved per frame and restored on back** (and a background sync re-render
keeps your place); the restore runs *after* the pane mounts (doing it while detached
silently no-ops — a bug we hit and fixed).

> **Gotcha that bit us twice:** the view element's density CSS hook MUST NOT reuse the
> `data-density` attribute that the density *buttons* use — the click handler's
> `closest("[data-density]")` then matches the list container and swallows every tile
> click as a no-op. The view uses `data-grid`; buttons use `data-density`.

> **"Added Date" is a rank, not a date.** `library/songs` returns no per-song
> `dateAdded` (only library albums/playlists do), so the backend fetches songs with
> `sort=dateAdded` and stores each row's position as `Track.addedRank`. The card sorts
> on it, **negated so the default ↑ surfaces most-recently-added first**; an album's
> rank is its **most-recent** track. See [DATA-ARCHITECTURE §3](DATA-ARCHITECTURE.md).
> **Album identity:** albums group on album-name + **cover-art URL** (an album's tracks
> all share one cover), so featured-/various-artist tracks stay unified and the album
> shows its *dominant* track artist; the real library/catalog album id arrives via
> on-demand catalog access (Search card / lazy enrichment), not a batch pre-fetch.

**Everything is client-side.** The card already pulls the whole library into memory
(`libraryTracks(0, 100000)`), so search, multi-key sort, and **album grouping**
(`groupAlbums` — group cached tracks by album-name + cover-art URL; dominant track
artist as the label; release = earliest, added = latest) all run in TS — no SQL/FTS. Albums are
**derived from songs**, not a separate sync; swapping in a real `albums_page` later
is invisible to the UI. Revisit only if we virtualize or the library gets huge.

**State persists** (`localStorage` key `deets.library.view`) like the theme — sort
key/dir, grouping, density survive restarts; the search query is session-only.
Square tiles render Apple artwork by filling the `{w}x{h}` URL template
(`Track.artwork`); tiles with no art fall back to a `♪` glyph. Tile sizing is
token-driven (`--lib-tile-small/large`, `--lib-grid-gap`, `--lib-pill-radius` in the
skin), so a skin can reshape the grid with no markup change.

**Scrollbars — the rule (2026-09-16).** Every element that scrolls wears the app's bar. It is
opt-in: `::-webkit-scrollbar` styles only the selectors that name it, and nothing warns when a
new scroller is missed (the Sound panel shipped with the grey OS bar). A new scroller adds the
`app-scroll` class (styles.css, next to the Library's rule); the older scrollers keep their own
selectors and draw the same bar from the same tokens.

The card's scrolling body uses **our own scrollbar** instead of the OS one — styled
via the `::-webkit-scrollbar` pseudo-elements (WebView2 is Chromium). Its **color is
a theme role** (`--scrollbar` / `--scrollbar-hover` in `themes.css`) and its
width/radius are skin tokens (`--scrollbar-w` / `--scrollbar-radius`). Scoped to the
scrolling `.lib-view`; widen the selector to theme every scroll region the same way.

**Settings card (2026-09-14):** `scrollbar-gutter: stable` keeps the bar's space, so opening a
section never narrows the rows (it jittered). The thumb fades in only while the rows outgrow
the card: `settings-card.ts` sets `is-scrollable` after each render and on resize, and the
thumb color is a registered `@property --set-thumb` that transitions on `--dur-med`
(`settings.css`; snaps under reduced motion). Copy the pattern to another card if it jitters.

### Long lists: rows are relayout boundaries

`.lib-list` is a **block** stack (not a flex column) and every art row (`.lib-row--art`)
carries `contain: size layout` with a pinned height, `--lib-row-h` — a skin token because the
natural height is the skin's title + artist stack (46px base, 49px on Press / Cyber).
Measured 2026-09-13 (DEBUGGING.md §Reviewing the telemetry): a cold pass through the
3,895-row Library dropped ~80% of frames because each batch of lazy covers loading dirtied
layout, and a flex column re-lays out every child when one is dirty (140–200 ms a frame).
With the boundary, layout stops at the row. Keep it when restyling rows: a row's height must
stay pinned by the token, and a new row voice that changes the type stack needs its own
`--lib-row-h`. Rows without art keep their natural height.

### Long lists: windowing (`src/collection-window.ts`, 2026-09-13)

A pane whose list is longer than `WINDOW_MIN` (200) and whose grouping is not `mixed`
(shelf headers among rows — Playlists overview, Radio root) renders only the rows near the
viewport. The engine hands the view to `windowView()`; smaller panes render whole, exactly
as before. Design record + measurements: [LIBRARY-VIRTUALIZATION.md](LIBRARY-VIRTUALIZATION.md).

- **Shape:** `[hero?] [top spacer] rows… [bottom spacer]`. The spacers (`.lib-spacer`,
  `grid-column: 1 / -1` in grids) hold the true scroll height; a zero-height spacer is
  `display: none` so a grid adds no gap for it. The slice starts and ends on a whole grid
  row, so auto-placement lines up under the spacer.
- **Geometry is measured, never tokened:** row pitch (distance between two rendered rows),
  column count (`gridTemplateColumns` of the computed style), and the hero's extent (the
  first item's offset when the slice starts at 0). A skin switch or a column-count change
  re-measures on the next frame (a `MutationObserver` on `<html>`'s `data-skin` /
  `data-theme` / `data-surface` + a `ResizeObserver` on the view) and restores the place by
  **row + fraction**, so the same first row stays visible when 46 px rows become 49 px.
- **Inside the head block the anchor is px, not a row (2026-09-15).** A row anchor reads as
  "row 0" for every scroll position above the first row, so the restore set `scrollTop` to
  the head's new height and scrolled the hero, the Play / Shuffle row and the shelves out of
  view — a skin switch at the top of a card jumped 0 → 47 px. `prime()` now keeps the px
  offset into the head (clamped to its new height) whenever the scroll was inside it, and it
  also runs when only `heroH` changed, not just the pitch or the column count.
- **Edge patch:** a pass removes rows that left the range and inserts the missing edge as
  one HTML string. Visible nodes are never re-created — hover, `is-context`, loaded covers
  survive, and an `<img>` is never reused for another item. A plain scroll frame renders
  only the visible rows + 2 (`URGENT_ROWS`) synchronously (scroll events fire before paint,
  so no blank frame even on End) and fills the buffer — one viewport, min `MIN_BUFFER_PX`
  1200 px each side — `FILL_PAUSE_MS` after the scroll pauses.
- **Rebuild** (sort, search, density, sync): the current height is folded into the bottom
  spacer *before* any node is removed, so scrollTop never clamps and no scroll event fires
  (one would dismiss the open Sort/View pop). Programmatic scrolls (`scrollTo`, `reveal`)
  `prime()` the geometry first for the same reason.
- **`overflow-anchor: none`** (`.lib-view--windowed`) is mandatory and the engine resets
  `className` per render, so the windower re-adds the class before every mutation —
  with anchoring on, one forced layout let Chromium move scrollTop by ~2.7k px.
- **Every finder searches the model and reveals by index** — `reveal(i, block)` — never
  the DOM (`Grouping.isSelected` feeds the selected-row reveal). WebView2's native Ctrl+F
  bar sees only rendered rows of a windowed list; the Search pill is the app's find.
- **Tiles are one height per row:** `.lib-tile__meta` is pinned to two `--lib-tile-lh`
  lines (a tile with a badge subrow used to run a pixel or two taller).
- Debug readout: `view.dataset.win` = `cols×pitch+hero`; `[perf] frames window a-b` logs a
  pass that cost ≥ 4 ms.

### Detail hero (album / playlist)

A drilled album or playlist opens on a **hero**: the cover big (`--hero-cover`, 180px
base), the name in the title face, an optional subtitle and a muted meta line
("2016 · 17 songs · 1 hr 2 min" / "24 songs · 1 hr 32 min · Yours"). Decided 2026-09-13:

- **It rides inside the scrolling view**, as the first block above the rows (in grid
  densities it spans every column like a shelf), so it scrolls away — a bento card body is
  ~350px tall and a pinned hero would leave three rows.
- **The card header shows the kind** ("Album", "Playlist") while drilled, via
  `Context.headerLabel`; the hero owns the name. Without a hero the header shows the title
  as before.
- **An album's artist is the subtitle**, tappable with a › glyph (`data-hero-sub` → the
  hero's `sub.run`, which drills the Library's artist detail in place). Playlists have no
  subtitle; their source ("Yours" / the curator) ends the meta line.
- **Album rows drop the mini cover** (every row shares it) and show the track number in the
  cover's slot (`.lib-row__num`) with the length as the subline; a "Track Order" sort leads
  and is the default. **Playlist rows keep the cover** — each song is from a different album.

The contract is `Context.hero?: () => Hero` (`{ cover, title, sub?, meta? }`), a function so
async facts (a playlist's tracks landing, then `card.reload()`) fill the meta line on the
next render. `heroCover()` in `library-card.ts` builds the cover slot (real cover, the 2×2
mosaic, or ♪) at 2× the token size. The Search card's catalog album / playlist panes render
the same `.lib-hero` markup themselves (they don't use the engine); the artist subtitle
there hops via the album's own `artists` relationship.

**Artist views (2026-09-15, [ARTIST-VIEW.md](ARTIST-VIEW.md))** also open on a hero: a round
photo (`heroCover(…, round)`, `--hero-artist-radius`), the name, and counts (Library) or the
genre (Search). Under it, `Context.shelves` draws Featured Playlists / Your Playlists
scrollers inside the block the windower measures; shelf tiles carry `data-shelf-item` and
route to `Context.onShelf` / `Context.shelfMenu`. `Context.toolbarBelow` (a section label)
moves the Sort / View / Search row from the pane top into the scroll, under the shelves; the
engine keeps that head block's nodes across renders that don't change the hero or shelves, and
the windower keeps a hero whose HTML is unchanged.

### 4b. The Queue card (Qcard) & drag-to-reorder
The Qcard (`src/qcard.ts`) is a small **standalone** renderer (not the collection-card
engine) in the Playlists slot — Now Playing + Up Next, re-rendered (`body.innerHTML = …`)
on every queue/track/state change. Up Next rows support left-click/Enter to jump, a
right-click menu, and **drag-to-reorder**.

The drag is **whole-row press-and-drag** (a quick click still jumps; hold + move past a ~6px
threshold drags) with **insertion-line** feedback — no neighbour reflow, so it's cheap for
long queues. Two things make it work:
- **Render is suspended mid-drag.** Because `render()` rebuilds all rows, a queue/track change
  arriving during a drag would destroy the dragged element — so a `dragging` flag short-circuits
  `render()` (coalescing into one deferred rebuild on drop). A reusable pattern for any
  imperative interaction layered over a re-rendering view.
- **Uniform-height arithmetic.** Rows are equal height and flush, so the drop index is
  `round((pointerY − firstTop) / rowH)` — no `getBoundingClientRect` on the transformed row.
- **Two scroll coordinate systems (this bit us twice).** The dragged row is *in-flow* — its slot
  scrolls with the content — so to keep it pinned under the pointer during auto-scroll its
  transform **adds** the scroll delta (`+ (scrollTop − startScroll)`). The insertion line is an
  *absolute child of the same scrolling list*, which **also** scrolls with content, so it takes a
  **plain content coordinate** (`firstTop + ins·rowH`, no scroll term). Compensating the line the
  same way as the row double-shifts it off-screen; not compensating the row lets it slide away.
  Also: `.qrow--dragging`'s transform must beat `.qrow:hover` on specificity (`:hover:not(--dragging)`),
  or a hovered dragged row snaps back and rubber-bands.
On drop it moves the **model** (`queue.move`) then `reconcileUpcoming()` reflects it into
MusicKit gaplessly (see [QUEUE.md](QUEUE.md)). Tokens: `--drag-lift`, `--drop-line-w` (skin);
the line + lift colors are theme roles.

### Window-control wiring
`src/main.ts` calls `@tauri-apps/api/window`:
`minimize()`, `toggleMaximize()`, `close()`. These are state-changing calls, so
they require explicit permissions in `src-tauri/capabilities/default.json`
(`core:window:allow-minimize`, `…allow-toggle-maximize`, `…allow-close`,
`…allow-start-dragging`, etc.). `core:default` alone is not enough.

---

## 5. Front-end ↔ back-end seam (for later)

The UI is built against **mock data / a stub player interface** so it has no Apple
dependency yet. Playback wires in later behind a thin `player` interface
(play/pause/seek/nowPlaying/queue…) — swapping the stub for MusicKit JS should not
touch any view. Keep that boundary clean: views call the interface, never MusicKit
directly.

---

## File map

```
index.html              home markup (titlebar, settings menu, bento cards)
swatch.html             color reference — every role, every theme, read live; plus
                        live skin × theme mini-mockups (one-page demo)
src/styles.css          imports tokens, then app rules (chrome, menu, panels, lists)
src/styles/fonts.css    @font-face for bundled fonts (Liberation; Press/Ocean/Cyber faces)
src/styles/palette.css  Tier 1 — raw paints
src/styles/themes.css   Tier 2 — color roles per theme
src/styles/skin.css     Tier 3 — [data-skin] base + press/ocean/glass/cyber deltas (type/geometry/motion)
src/styles/fonts/       bundled font files (Liberation TTFs + NOTICE; skin WOFF2s)
src/main.ts             window controls, settings menu, account, menu-mode; calls initTheme/initSkin/initLayout()
src/cards.ts            card registry + CardDef/CardInstance (the mountable-card contract)
src/layout.ts           midi layout: anchored Now Playing + 2 swappable slots + title-menu picker
src/now-playing-card.ts Now Playing transport card (extracted from main.ts)
src/playlists-card.ts   Playlists card — overview → detail on the engine; New Playlist (+),
                        remove-track, empty-only delete (PLAYLISTS.md)
src/dropdown.ts         dropdown primitive + menu-mode fan-out (setDropdownMode, destroy)
src/hint.ts             hover-hint primitive — adopts every `title` into one themed box,
                        plus the two-line song/artist hint on list rows (ONBOARDING.md §1a)
src/theme.ts            theme switch + localStorage persistence (RETIRED id migration, OS-preference default)
src/skin.ts             skin switch + localStorage persistence (mirror of theme.ts)
src/storm.ts            storm-layer position re-roll (Cyber bolts; inert otherwise)
src/apple.ts            Apple Music auth bridge (connect/disconnect/status)
src/library.ts          cache reads + sync trigger + sync-event subscription + types
src/collection-card.ts  reusable navigable browser engine (contexts, groupings,
                        Sort/View/Search toolbar, push/pop pane-slide nav)
src/library-card.ts     Library's contexts/groupings (Songs/Albums/Artists +
                        album & artist drill-in); wires data load + sync; calls the engine
src-tauri/tauri.conf.json          frameless window @ 480×864
src-tauri/capabilities/default.json  window-control permissions
```

> Back-end (auth, model, provider, SQLite cache) is documented separately in
> [DATA-ARCHITECTURE.md](DATA-ARCHITECTURE.md).
