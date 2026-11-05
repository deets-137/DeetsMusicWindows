---
status: shipped
shipped_in: 0.4.3
desk_test: open
sources: [src/album-slots.ts, src/album-color.ts, src/album-neon.ts, src/album-light.ts]
updated: 2026-11-05
---
# DeetsMusic — Album Color (the radiant Now-Playing aurora)

> How the current track's artwork tints the player. The Now Playing card grows an
> **aurora sourced from the album's own palette** that **rotates as if a light is
> sweeping the art**. Read this before touching `now-playing-card.ts`, the skin base, or
> the roadmap #7 palette plumbing. Status legend: ✅ decided · 🔵 open (my call unless you
> red-line). Siblings: [UI-ARCHITECTURE](../architecture/UI-ARCHITECTURE.md) (the token tiers + doctrine),
> [SURFACES-AND-CARDS](../architecture/SURFACES-AND-CARDS.md) (surfaces/cards), [HANDOFF](../HANDOFF.md)
> (roadmap #7 = the data path this rides).
>
> **Status: BUILT on the theme-fallback path (2026-07-01), glass-only.** The runtime
> roles + fallbacks (`themes.css` `:root`), the skin knobs (`--album-aurora-display` /
> `-strength` / `-reach`, `--album-spin-dur` / `--album-fade-dur`), the cover-anchored
> rotating halo (`.np__aurora` in `styles.css` + one line in `now-playing-card.ts`), the
> `@property`-registered crossfade, and reduced-motion freeze are all live. **Pending
> item #3 (catalog enrichment):** the JS that applies real Apple palettes + the
> `.np--album` presence class — until then the aurora is theme-accent-sourced.

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
one. (See [UI-ARCHITECTURE §2–3](../architecture/UI-ARCHITECTURE.md).)

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
4. **The next song, one ahead.**
   > **Part:** built · 2026-10-10 · desk test open (ideas/WORKERS.md §5.3, his call)

   A miss used to start only when the song did, so the colors changed a beat after it. Now,
   1.5 s after the queue settles (`onQueueChange`, so fast Next presses make one lookup),
   `album-color.ts` reads `peekNext()` and asks `lookupPalette` for that song's cover: the
   cache, or the one call its start would make anyway. It also loads the cover into the web
   view's image cache at `stageArtPx()`, the size the NP card asks for (Apple's image
   server, not an API call). It skips the cover when *Show cover: Playlist* puts the
   playlist's cover on screen, and skips both when the next song has the current cover.
   A call is wasted only when the queue changes before that song plays. It runs only while
   an NP card watches (`watchAlbumColor`), so a surface with no NP card makes no lookups it
   did not make before. Log: `albumColor:prefetch` on / off, `albumColor:next` per lookup.

   **Desk test.** Restart not needed (front end only). Queue two songs from two albums you
   have not played in DeetsMusic. Let the first play for 2 s, then press Next: the aurora
   and the album text change with the song, not after it. `deetsmusic diag` shows one
   `albumColor:next` before the press. Press Next five times fast: one `albumColor:next`
   after the last press, not five.

---

## The aurora (a skin capability)

- **Base default** (in the `[data-skin]` base block, scoped to the NP card) renders the
  album aurora so every skin gets it: a radial gradient stack **originating at the cover**,
  built from the `--album-*` roles, on a layer *behind* the card content.
- **Per-skin override**: a skin restyles the same layer in its idiom without naming a color —
  **glass** refracts it through `--panel-backdrop` (its frost already saturates the aurora);
  a flat skin (vanilla) shows it as a soft radial bloom; press/ocean can tune strength/shape.
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
so a blown-out Apple `bgColor` can't nuke legibility on dark themes (moonlight / black-yellow).

**The stops are filled by colorfulness, not by Apple's names (2026-09-20).** The
`--album-bg` stop sits under the cover and is hidden; `--album-c1` is the visible rim;
`--album-c2` is the halo and the orbiting highlight. Apple's `bgColor` is the art's main
field — vivid as often as dark — and its `textColor1/2` are near grey on 677 of 1,368 cached
palettes. Filled by name, a lilac cover (The Chainsmokers, *So Far So Good*: bg `#bc92ec`,
c1 `#19191a`, c2 `#24202c`) hid its lilac under the art and glowed grey. `auroraSlots`
(`src/album-slots.ts`) ranks the three by OKLCH chroma: the most colorful goes on the rim,
the next on the halo (or the rim's color again when the next is grey, chroma < 0.04), and the
least under the cover. An all-grey cover stays grey. The NP card and the tray panel both
use it. The NP text (below) still reads Apple's `c1` / `c2` as named.

---

## The album's one color (the rule for every new use)
> **Part:** built · 2026-09-23

**When a feature needs "the album's color" (one color), it calls `albumColor(palette)` from
`src/album-slots.ts`.** Never pick `c1`, `c2` or `bg` by name. `albumColor` returns the most
colorful of the three by OKLCH chroma (`rankByColor`, the same ranking as `auroraSlots`), so it
is the color on the NP aurora's rim. An all-grey cover gives its least-grey color, so the
feature stays grey instead of inventing a hue.

- **Why:** Apple's names do not say which color is vivid. `textColor1` is near grey on about half
  the library (see above), so a pick by name makes a lilac cover glow grey.
- **Get the palette** through `lookupPalette(cover, catalogId)` (album-color.ts), with
  `currentCover()` as the key. A cover then costs one Apple lookup, however many features ask.
- **Shape it after the pick:** each feature sets its own lightness and chroma cap for its
  backdrop (the Ocean's `asGlow` / `asNeon`). Scale the chroma; never raise it from zero.
- **Users today:** the NP aurora and the tray panel (the rim, via `auroraSlots`), the Ocean's
  glow from the deep and its neon crests (OCEAN.md §3, §7), the album light on the Press and Cyber
  card edges (below), and the Rulez fact *Album color* (`albumWords`, RULEZ.md §11, 2026-09-27).
  The Album theme (SKINZ.md §12) is the next.
- **The exception:** text keeps Apple's `c1` / `c2` by name (§Text & accent), because Apple chose
  them to read on that cover.

---

## The album light (Press and Cyber card edges)
> **Part:** built · 2026-11-05 · desk test open

His design, 2026-11-05. **Press:** the whole screen lights in neon: the plate and the card edges
are lit. The line itself, never the area between the cards. **Cyber:** the thin card edges take the
album's primary color and the bolts take its secondary. In both, the more colorful color is the
primary. A new album's color turns in around each card, a pinwheel in one direction, over 1.2 s.

**The colors.** `albumNeon(palette, darkGround)` (album-slots.ts) ranks by `auroraSlots`: the
primary is the rim, the secondary the halo, which is the primary again when the next color is
grey. Each goes through `asNeon` (Ocean's math, moved here): a bloom and a lifted core on a dark
ground, both deeper on a light ground. **An all-grey cover lights white** (his call): on a dark
ground the core stands in for the bloom, and no hue is invented. On his 6,044 cached palettes,
34 % have two real colors, 31 % one, and 34 % are all grey (2026-11-05), so most covers show one
color.

**The tokens.** JS sets three roles on `<html>`: `--album-neon-core`, `--album-neon-bloom`,
`--album-neon-2`. With none set, each skin falls back to the plain look.

| Token | Tier | Job |
|---|---|---|
| `--hook-light` | hook | Names the skin's slider: `pressLight`, `cyberLight`. A skin without it is untouched |
| `--album-lit` | skin | 0 to 1. Each skin points it at its slider. Ocean sets it on `.ocean` |
| `--card-edge` | skin | A card's own border. Unset it falls back to `--panel-border`, which chips and menus share |
| `--plate-core`, `--plate-bloom` | skin | Press: the plate's bands, mixed from `--ink-2` by `--album-lit` |
| `--storm-album` | runtime | Cyber: the color a bolt strikes in, set on its strike box |
| `--album-wave-dur` | skin | The turn, 1.2 s |

**Press.** `--shadow-card` is three hard bands in the plate's 4 px: 1 px bloom, 2 px core, 1 px
bloom. Negative spreads start all three at the plate's own corner, so the plain plate has the
shape it always had. There is no blur, so nothing reaches the gap and `--grow-clip-pad` stays 6 px. The thin line
takes the primary as well (his call: one color on Press). `--vinyl-plate-shadow` is the same bands.
Menus keep `--shadow-panel` in `--ink-2`.

**Cyber.** `--card-edge` takes the bloom. A bolt takes `--album-neon-2` at its loop seam
(`storm.ts`, opacity 0), so a bolt on screen finishes in its old color and the color never redraws
its glow in view. The bolts keep their glow: they are behind the cards.

**The wave** (`album-light.ts`, styles.css § The album wave). It began top down and became a
pinwheel on each card (his ask, 2026-11-05): clockwise from 12 o'clock, all cards at once, 1.2 s,
constant speed. CSS cannot wipe a color along a border, so it is the bolts' method, turned: a copy
of a card's edges in the new color sits in a hold box; a strike box, a half plane about the card's
center, turns and clips it, and the hold box turns back by the same amount. One box covers half a
circle, so each card has two, behind fixed clips: the right half runs the first 180°, the left the
rest. Only `transform` moves. The Press record's plate has its own wheel. At the end the real
cards take the roles and the copies go, in one frame.
The copies read the same token expressions as the cards: the skins declare them on
`:is([data-skin="…"], [data-skin="…"] .album-wave)`, so the copies work them out from the host's
own roles, and the two cannot differ.

**No wave:** at launch; on a theme or skin change; on a slider drag; with Reduce motion; with the
window hidden; with *Spin in new colors* off; while a card is in motion (the color changes at once).
A card that starts moving, a size change of the cards' area or a skin change ends a running wave.
CSS motion fires an event; a grow and the full player run from script and fire none, so a class
change on a card, a new child of `.bento`, `data-surface` and a ResizeObserver on the bento and each
card catch them. A drill does not end it: `is-drill-swap` changes a card's inside, not its box. A theme change does not
end a wave: Live Theming changes the theme with the album, so the wave goes on in the color for
that ground. A new album during a wave waits for it, then turns in; rapid Next keeps only the last, so
nothing pops. A same-color cover changes nothing.

**Where else.** The tray panel takes the roles from its own palette (no wave, `album-neon.ts`
carries no player). The grand opening's preview player uses `watchAlbumLight(box, source)`.

**Settings** (Skin settings): *Album light* on Press (`pressLight`) and on Cyber (`cyberLight`),
0–100, **0: off by default** (his call, 2026-11-05, until the 1.4 polish); each skin keeps its own value. *Spin in new colors* (`albumWave`), on, shows on both
while the slider is above 0. The toggle is a reported usage key. Skin settings now shows under
Cyber.

**Log:** `albumLight:watch`, `albumLight:color` (on / off), `albumLight:wave` (`why`: done, next, moved, look,
late, off; `cards`, `ms`). Frames: `album-wave`. Mark: `albumLight:wave`.

**Desk test.** No restart for the front end. The agent part ran on the dev app 2026-11-05
(WORKLOG.md, `docs/ops/checks/album-wave-probe.mjs`, `album-wave-cases.mjs`). He tried it the same
day: "looks pretty good". Stress test done the same day (WORKLOG.md). Open: the polish, 125 % and
150 % display scale, a menu that overhangs a card edge during a turn.
1. Press, dark theme, a song plays, Album light up. The plate and thin line show the album's neon on every card,
   and the gaps stay plain.
2. Press Next to another album. The new color turns in around each card, clockwise, in 1.2 s.
3. Press Next five times fast. No stuck copy, and the last album's color stays.
4. Cyber: the thin edges take the primary. The next bolt strikes in the secondary.
5. A black and white album lights white. A theme change repaints with no wave.
6. Album light at 0: the plain skin. Drag it up: the color follows the drag.
7. *Spin in new colors* off: the color changes at once.
8. During a wave, swap a card and open a menu. Nothing stays out of place.

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

**Closed (build, 2026-07-01)**
- **Glass-first** (user call, on seeing it live on Ocean): the base ships a **no-op**
  (`--album-aurora-display: none`); glass opts in. Other skins get their expressions in a
  later polish pass by flipping the token + tuning strength/reach.
- **Halo geometry** (user call): the aurora is sized by the **cover**, not the card — a
  `--album-aurora-reach` (cover-widths) halo centered on the art, brightest at the rim, with
  the `--album-c2` blob orbiting just outside it. It radiates from and highlights the cover
  rather than washing the whole card.

**Open 🔵**
- **Global user toggle** ("tint the player with album art" on/off) — a natural future
  setting; defaults on. Record in [FUTURE-SETTINGS](../FUTURE-SETTINGS.md) when built.
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
