# DeetsMusic — WeatherSkin (weather-reactive dynamic skin + theme)

> The weather outside restyles the player: an **animated canvas** (gradient sky + a particle
> layer — falling rain, tumbling snow, a real moon), **fonts and motion that shift per
> condition**, and a companion **Weather theme** that recolors the roles to match. Rides the
> same `WeatherSnapshot` as [DeetsWeather](DeetsWeather.md) — **zero new API surface**; this
> is a *second consumer* of `weather.rs`. Read with [UI-ARCHITECTURE](UI-ARCHITECTURE.md)
> (token tiers, skin doctrine) and [ALBUM-COLOR.md](ALBUM-COLOR.md) (the runtime-value
> precedent this extends). Status: ✅ decided · 🔵 open · ⬜ later.

---

## 0. How it fits (reuse, don't reinvent)

```
weather.rs (DeetsWeather §1) → WeatherSnapshot ──→ JS weather-skin driver (src/weather-skin.ts)
                                                        │
                        ┌───────────────────────────────┼──────────────────────────────┐
                        ▼                               ▼                              ▼
              <html data-weather="…"          runtime props on <html>          <canvas> particle
                    data-daylight="…">        --wx-intensity / --wx-wind       layer (rain/snow/
                        │                     / --wx-cloud                     fog/flash)
          ┌─────────────┴─────────────┐
          ▼                           ▼
   [data-skin="weather"]       [data-theme="weather"]
   type · motion · sky ·       color roles branch on
   geometry per condition      [data-weather] / [data-daylight]
```

- **One driver, three outputs:** `src/weather-skin.ts` reads the snapshot and (1) sets the
  `data-weather` / `data-daylight` attributes, (2) sets the continuous runtime props, (3)
  runs the particle canvas. CSS does the rest.
- **Everything downstream is the existing machinery.** Canvas pattern (`--canvas-bg` /
  `--canvas-anim`), nav motion (`--nav-at-*`), fonts (`--font-title/-body`), scrubber mask
  (`--scrubber-handle`), hover-lift — all already tokenized, so a condition is just a
  different value set. No component rule changes.
- **DeetsWeather dependency is soft.** The attribute plumbing works with a **dev override**
  (force `data-weather` by hand) before `weather.rs` exists — build/demo the whole skin
  first, wire live data when the WeatherKit token risk (DeetsWeather §1) is retired.

---

## 1. The third axis: `data-weather` + `data-daylight` ✅

Two new attributes on `<html>`, sibling to `data-theme` / `data-skin`, **owned by JS**:

| Attribute | Values | Source |
|---|---|---|
| `data-weather` | `clear` · `clouds` · `rain` · `storm` · `snow` · `fog` | `WeatherSnapshot` condition bucket (same curated `conditionCode` mapping as DeetsWeather §2; unknown → `clouds`) |
| `data-daylight` | `day` · `golden` · `night` | sun times in the snapshot; **`golden`** = a window (~40 min) around sunrise/sunset |

- **Skin and theme stay independent axes** ✅ — the signature architectural move:
  - **`data-skin="weather"`** — shapes react: fonts, sky animation, particles, motion per
    condition. Colors still come from whatever theme is active (rain on hornet = golden rain).
  - **`data-theme="weather"`** — colors react: the role table (`--canvas`, `--title`,
    `--text`, traffic lights, `--surface`, …) branches on `[data-weather]`/`[data-daylight]`.
    Works under any skin (weather-colored Desk is legitimate).
  - **The full experience = both.** The Skin/Theme flyouts stay as they are; "Weather" is
    simply a new entry in each. ⬜ Later nicety: picking the weather *skin* offers to bring
    the theme along (one-tap pairing), never forces it.
- **Attributes are set even when neither is active** (cheap, invisible) so switching to
  weather skin/theme reacts instantly. If no snapshot is available (no location, fetch
  failed, WeatherKit not yet built): **fall back to `clear` + real local clock time** for
  daylight — the skin degrades to a handsome day/night skin, never a broken one.
- **Dev override / vibe lock** ✅ — `localStorage` `deets.weather.force` (e.g. `"storm/night"`)
  short-circuits the driver. Ships as the dev tool for building scenes; graduates to a user
  "lock the vibe" setting later ([FUTURE-SETTINGS](FUTURE-SETTINGS.md) candidate).

### Continuous runtime props (the album-color pattern)
Buckets pick the **scene**; these **tune** it. JS sets them on `<html>`; themes declare
fallbacks so they're never empty (same doctrine as `--album-*`):

| Prop | From | Drives |
|---|---|---|
| `--wx-intensity` `0..1` | `precipitationIntensity` (normalized) | particle density, sky heaviness |
| `--wx-wind` `-1..1` | `windSpeed` + direction | particle angle/drift speed, sky drift rate |
| `--wx-cloud` `0..1` | `cloudCover` | canvas dimming / gradient flattening |

Doctrine intact: JS injects *values*, the theme owns color, the skin owns expression — **no
hex enters any CSS file**.

---

## 2. The animated canvas ✅ (hybrid: CSS sky + `<canvas>` particles)

Two layers behind the bento, different tech for different jobs:

### 2a. The sky — pure CSS, existing tokens
Per condition × daylight, the weather skin overrides `--canvas-bg` / `--canvas-anim` (the
same levers Ocean's `wave-roll` and Glass's `aurora-drift` already use): slow-drifting
gradient stacks. Colors are **theme roles / color-mixes only** — under the weather theme the
sky gets true weather color; under fairy it's a fairy-tinted sky. Golden hour is a warm
`color-mix` pass over whatever scene is active — sunset *through* rain works.

### 2b. The weather — a `<canvas>` particle layer (new primitive ⚠️)
A fixed-position `<canvas>` between the CSS canvas and the bento (`z` below panels; Glass
isn't concurrent — weather *is* the skin — but panels with translucent fills would refract
it, which is correct). First non-DOM render layer in the app, so it gets rules:

- **Scenes:** rain = streaks angled by `--wx-wind`, density by `--wx-intensity`; snow =
  tumbling flakes with per-flake sway; fog = large soft alpha blobs drifting; storm = rain +
  occasional full-canvas lightning flash (randomized 20–90 s, a 2-frame brightness pop);
  clear-day = sparse dust-mote shimmer; **clear-night = starfield + the real moon** (see 2c).
- **Perf budget (hard rules):** single rAF loop; particle cap (~150 at 480×864, scaled by
  area if the window grows); pause the loop entirely on `visibilitychange`/minimize
  (stewardship — same instinct as API caching); target: no measurable idle-CPU rise vs
  Ocean's CSS waves. Verify in WebView2 before polishing.
- **Colors from CSS:** the canvas reads its draw colors from the computed theme roles
  (`getComputedStyle` on theme/weather change only — **never per frame**) so particles theme
  correctly everywhere.
- **`prefers-reduced-motion`:** render one static frame (rain streaks frozen mid-fall reads
  fine); lightning flashes off. Same doctrine as nav motion.

### 2c. The moon ✅ (the gem)
`forecastDaily` carries `moonPhase` — clear-night draws the **actual current moon**, phase
correct, as part of the particle layer's static backdrop. Cheap (one arc-masked circle),
and the single strongest "this thing is alive" signal in the feature.

---

## 3. Type & vibes per condition ✅

`--font-title` / `--font-body` (+ weight/tracking/size tokens) swap per `[data-weather]`.
**Small curated additions** ✅: reuse bundled faces where they fit; add **2–3 new OFL faces**
(~40–80 KB each, woff2, bundled in `fonts.css` like the rest). Working sketch — faces marked
**(new)** are the additions, final picks at build time 🔵:

| Scene | Title face | Body | Motion/geometry notes |
|---|---|---|---|
| clear · day | geometric sunny sans **(new)** | Karla (bundled) | brightest sky, mote shimmer, standard nav |
| clear · night | thin elegant serif **(new)** | Spectral (bundled) | starfield + moon, slower nav, dimmer sky |
| clouds | Karla-led, muted | Karla | flat soft sky, gentle drift |
| rain | Spectral (bundled — bookish) | Spectral | angled streaks; **Ocean's droplet scrubber handle reused** |
| storm | Cinzel (bundled — dramatic) | Spectral | dark churn, lightning; heavier title weight |
| snow | soft rounded sans **(new)** | Karla | pale sky, slow tumble, airier spacing |
| fog | wide-tracked airy sans (one of the above, tracked out) | Karla | alpha veils, lowest-contrast sky |

Also per-scene where it earns it: `--nav-dur`/ease (storm snappier, snow/fog dreamier),
`--radius-*` nudges (snow rounder), `--scrubber-handle` swaps (rain droplet; ⬜ snowflake,
sun, moon variants later).

---

## 4. The Weather theme ✅ (companion, in `themes.css`)

A normal `[data-theme="weather"]` block whose roles branch on the attributes —
structurally it's ~7 sub-blocks (`[data-theme="weather"][data-weather="rain"] { … }`), each
a short role mapping like any theme. New paints (rain-blues, storm-slates, snow-pales,
golden-hour ambers, night-inks) go in `palette.css` **as named paints** — this is where
weather color legitimately lives; the skin never names one.

- Each sub-block maps **every** role (canvas, title/text/subtext, traffic lights + glyph,
  surface/hover, border, panel-border, scrollbar) and sets `color-scheme` (night/storm dark,
  snow/clear-day light — native controls follow the weather 🌗).
- `data-daylight` modulates within a condition (clear-day vs clear-night are effectively two
  palettes; golden layers a warm cast).
- Add to `THEMES` in `swatch.html` — the swatch page becomes the scene-design tool (force
  `data-weather` per row) 🔵 worth a small swatch upgrade to preview the matrix.

---

## 5. Live behavior

- **Re-poll on the DeetsWeather cache TTL** (~10–15 min; shared cache — the skin and the
  station read the same snapshot). On bucket change, the attributes flip and **CSS
  transitions crossfade** the sky/colors (register the animatable props with `@property`
  like the album aurora); the particle layer cross-dissolves scenes (fade out old emitter,
  fade in new — ~2 s). Weather change mid-session should feel like weather changing, not a
  page reload.
- **Daylight flips on a clock timer** (sun times are known from the snapshot — no extra
  fetch): schedule the `day → golden → night` transitions locally. Golden hour arrives on
  time even if the weather fetch is stale.
- **Synergy, not conflict, with album color:** the NP album aurora is a card-scoped layer
  and continues to work over any weather scene (album halo over a rain canvas is the
  intended look).

---

## 6. MVP staging ✅ (4 scenes first)

**Phase 1 — the rails + 4 scenes:** attribute driver with dev override · CSS skies ·
particle canvas primitive (rain + motes + starfield/moon) · fonts · weather theme sub-blocks
for **clear-day, clear-night, clouds, rain** · daylight timer + golden hour. Covers ~90% of
real days and exercises *every* mechanism. Buildable entirely on the dev override — live
WeatherKit wiring can land before or after, independently.

**Phase 2 — the drama:** storm (lightning), snow, fog scenes on the proven rails; scrubber
variants; vibe-lock setting.

**⬜ Later:** forecast-aware transitions (pre-darken as the front approaches, riding
`forecastNextHour` — the visual twin of DeetsWeather's rain interlude); one-tap skin+theme
pairing; mini/max surface expressions.

---

## Tokens & files introduced

| Thing | Tier / place |
|---|---|
| `data-weather`, `data-daylight` | runtime attributes on `<html>` (JS-owned) |
| `--wx-intensity` / `--wx-wind` / `--wx-cloud` | runtime props, theme-declared fallbacks |
| `[data-skin="weather"]` block(s) | `skin.css` — per-scene type/sky/motion/geometry |
| `[data-theme="weather"]` sub-blocks | `themes.css` (+ new named paints in `palette.css`) |
| `src/weather-skin.ts` | driver: snapshot → attributes/props, daylight timer, particle canvas, dev override |
| `#wx-canvas` | the particle `<canvas>`, fixed, below the bento |
| 2–3 new OFL faces | `src/styles/fonts.css` + `fonts/` + NOTICE, like existing bundles |

---

## Decisions

**Closed ✅**
- **Color ownership = companion Weather theme**: skin reacts in shape/type/motion, a paired
  `weather` theme reacts in color; both key off the same attributes; axes stay independent;
  full experience = both. Weather hexes live in `palette.css` as paints — never in the skin.
- **Canvas = hybrid**: CSS gradient sky on existing `--canvas-bg`/`--canvas-anim` tokens +
  a new `<canvas>` particle primitive with hard perf rules (rAF pause on hidden, particle
  cap, reduced-motion static frame, colors read from theme roles on change not per frame).
- **Fonts = small curated additions**: reuse Spectral/Cinzel/Karla; bundle 2–3 new OFL faces.
- **MVP = 4 scenes** (clear-day, clear-night + moon, clouds, rain); storm/snow/fog phase 2.
- Rides DeetsWeather's `weather.rs`/`WeatherSnapshot`/cache unchanged; **dev override**
  decouples build order from the WeatherKit token risk.
- `data-daylight` with a **golden-hour** state, driven by a local clock timer off sun times.
- Moon phase rendered on clear nights.

**Open 🔵**
- Final font picks for the 2–3 new faces (clear-day geometric, night thin serif, snow
  rounded) — choose at build time against real scenes.
- Bucket mapping details (which `conditionCode`s land in `clouds` vs `fog` vs `storm`) —
  share the curated table with DeetsWeather §2 or keep a skin-specific one (recommend
  **shared**, one table in `weather.rs`).
- Swatch-page upgrade to preview the condition × daylight matrix.
- Golden-hour window length (~40 min?) and whether it applies to overcast scenes (recommend
  yes, muted).

---

## Risks / verify

- **Particle canvas perf in WebView2** — the new primitive; verify rain at cap + a
  translucent panel over it stays smooth at 480×864 before designing more scenes. It's the
  WeatherSkin equivalent of the album-aurora rotation-cost check.
- **WeatherKit plumbing** — inherited from DeetsWeather §1 (token shape / Service ID). The
  dev override means this never blocks the skin build, but live mode waits on it.
- **Theme sub-block sprawl** — 7-ish role blocks is real CSS; keep each as terse as the
  existing themes and lean on shared paints. Resist per-scene one-off roles.
- **Legibility across scenes** — storm/night palettes must keep `--text`/`--subtext`
  passing on their canvases; the swatch page is the check.
- **Crossfade correctness** — bucket flips mid-session must transition (test with the dev
  override toggling scenes); `@property`-register what needs to animate.
- **Doctrine canary** — grep `skin.css` after build: zero new hex; all weather color is in
  `palette.css`/`themes.css` or runtime props.
