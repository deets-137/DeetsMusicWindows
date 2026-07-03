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

Both are set on `<html>`: `<html data-theme="fairy" data-skin="vanilla">`.
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

Traffic-light role names are deliberately function-named (`go/stop/pause`) not
color-named, so a theme can shade them to fit its canvas without the names lying.

Each theme also declares `color-scheme: light|dark` (so native controls, the
scrollbar corner, and autofill match) and a few non-table roles every block maps:
`--surface` / `--surface-hover`, `--border`, `--panel-border`, and `--scrollbar` /
`--scrollbar-hover`.

### Themes that ship today
- **`fairy`** — twilight-lilac canvas, twilight-plum headings, with magenta + gold fae accents.
- **`glade`** — fairy's structure in chartreuse: dewy chartreuse canvas, forest-green title,
  moss/sage type, fern + foxglove + gold traffic lights (gold reuses lemon-chrome).
- **`sepia`** — warm parchment + amber, vibe pulled from the harness "Sepia Dreams".
- **`moonlight`** — dark mode: deep slate-blue canvas, slate blue-gray type (bright→dim),
  monochrome traffic lights (moonlight white→gray).
- **`hornet`** — black & yellow (Noir Gold): near-black canvas, hi-vis yellow title, warm-white
  body, monochrome-yellow traffic lights (no green/red), gold hairline borders.
- **`viper`** — hornet's structure in black & red (cyber villain): reuses pitch/onyx surfaces,
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

### Structure: a shared base + per-skin deltas
`skin.css` opens with a **`[data-skin]` base block** that defines *every* token —
these values **are Vanilla**. Each named skin (`[data-skin="desk"]`, `…="ocean"`)
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
> the same for color roles. This section is the *map* — read those two files for the
> complete, current set. (We deliberately don't keep a separate catalog file — it would
> duplicate the base block and rot.)

The base defines, among others:

- **Type:** `--font-title` (Liberation Serif), `--font-body` (Liberation Sans),
  `--fs-title / --fs-text / --fs-subtext`, `--fw-*`, `--lh-text`
- **Geometry:** `--midi-w` (480), `--midi-h` (864), `--titlebar-h`, `--traffic-*`,
  `--icon-sm / -md / -lg` (SVG-glyph wrappers)
- **Shape:** `--radius-panel`, `--radius-control`, `--panel-radius`
- **Spacing:** `--space-1 … --space-5`
- **Card fill:** `--panel` (which theme surface the cards use) + `--shadow-card`;
  `--panel-backdrop` is the frosted-glass blur behind a panel (base `none`; Glass opts in)
- **Menu material:** `--menu-surface` / `--menu-backdrop` — the same pair for the
  *floating* tier (menus, flyouts, popovers, ctx-menu, pickers); base = opaque
  `var(--surface)` + no frost, Glass opts in
- **Canvas pattern:** `--canvas-bg` / `--canvas-bg-size` / `--canvas-bg-repeat` / `--canvas-anim`
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
`--panel` at a theme **role** — Vanilla `var(--canvas)` (flush), Desk `var(--surface)`
(raised paper) — or **derives** one without naming a hex: Ocean
`color-mix(in srgb, var(--surface), black 18%)` (recessed/darker). The theme always
owns the actual color. Same rule for the canvas pattern and soft borders: their tint
is `var(--border)`, a theme role.

**Glass is the doctrine taken to the limit.** It needs translucency and a colorful
backdrop — both still derived, never named. Panels are `color-mix(--surface 55%,
transparent)` (an *alpha* of a theme role), and the "aurora" the frost refracts is built
from the theme's **accent roles** (`--go` / `--stop` / `--pause`) at low alpha — so Glass
recolors itself per theme (mint/magenta/gold on fairy, all-yellow on hornet) without a
single hex. The one thing a token couldn't express was the *blur* itself, so that became
a new primitive: `--panel-backdrop`.

### Nav motion is tokenized, not hardcoded
`.coll-pane` reads its per-position transform/opacity from `--nav-at-*` /
`--nav-off-opacity`, so a skin reshapes the **whole drill-in motion** with values
only — no rule edits. Vanilla slides (`translateX`), Desk drops (`scale`), Ocean
sinks (`translateY`). `prefers-reduced-motion` still disables it.

### Skins that ship today
- **`vanilla`** — the reference: flush **borderless** cards (spacing/typography carry the
  grouping) with an **editorial underline** under the app + card titles (`--title-underline`
  tokens, vanilla-only opt-in; behavior toggle is
  [FUTURE-SETTINGS §11](FUTURE-SETTINGS.md)), horizontal slide, Liberation type.
- **`desk`** — light/airy notebook: raised paper cards (`--surface`) with a drop shadow on a
  dot grid (tinted `--panel-border` so it actually reads), **paper-label controls** (square
  pills, not capsules), an **airier** page (panel-scoped padding/gap up a step), **photo-corner**
  covers (3px) on a **cut-paper radius ladder** (3px covers → 6px cards/menus → 7px pills;
  menus get a sticky-note shadow), a 1px **hover-lift** on rows, a **tilted paper drag**
  (`--drag-lift` rotates the picked-up queue row; fatter pencil drop-line), a drop-onto nav,
  Comic Sans MS (title; bundled Comic Neue fallback — Caveat retired) + Karla (body).
- **`ocean`** — deep/abyssal: recessed soft-edged cards (`color-mix`) on a surface of three
  rolling-wave frequencies (`wave-roll`), a sink/rise nav, Cinzel (title) + Spectral (body).
  Pairs best with light themes (its black-mix cards + shadows are faint on dark canvases — a
  per-theme `--surface-sunken` role is the documented upgrade if Ocean needs true depth there).
- **`glass`** — frosted glassmorphism: translucent panels (`color-mix` alpha of `--surface`)
  with a real `backdrop-filter` blur (`--panel-backdrop`) over a per-theme accent "aurora"
  whose blobs **drift** (`aurora-drift`, px offsets on layers **oversized +128px** so the
  drift never drags a gradient's cut edge into view — see the skin.css comment),
  **frosted menus** (the `--menu-surface` / `--menu-backdrop` pair — milkier than panels, 65%
  vs 55%, for text legibility), a glass-ring scrubber handle (evenodd hollow), rounded glass
  chips, a fade/scale nav, light sans title. See the doctrine note above for how it stays
  hex-free. Intensity numbers are catalogued in [FUTURE-SETTINGS §12](FUTURE-SETTINGS.md)
  (skin-specific). Open upgrade: a `--highlight` theme role for a true white sheen.
- **`cyberstorm`** — electric/futuristic: two lightning bolts slow-draw down the canvas
  behind the cards (the **storm layer**, below), smoked-glass panels (86% `--canvas` mix —
  a bolt passing behind a card glows through dimly) with a hard 1px edge and no soft shadow,
  a faint `--border` circuit grid, square corners everywhere, a skew-snap nav jolt
  (`skewX` in the `--nav-at-*` transforms), a lightning-bolt scrubber handle, Orbitron
  (title) + Rajdhani 500 (body). Storm dials are catalogued in
  [FUTURE-SETTINGS §13](FUTURE-SETTINGS.md) (skin-specific). Pairs best with dark themes
  (moonlight / hornet / viper), where the bolts read as light.

### The storm layer (opt-in decorative strokes)
A reusable primitive, same opt-in doctrine as `--panel-backdrop`: an inline
`<svg class="storm">` in `.app-body` behind the bento, holding two bare
`<path class="storm__bolt" pathLength="1">` elements. Everything about it is tokens:
`--storm-display` (base `none` — the layer is inert, its animation never runs),
`--storm-ink` (a theme **role**, so bolts recolor per theme), `--storm-glow`, `--storm-w`,
`--storm-cycle-1/-2`, and — the trick that keeps geometry in the skin tier —
**`--storm-path-1/-2` applied via CSS `d: path(...)`** (Chromium supports it), so a future
skin could reuse the layer for rain / falling stars / scan lines with no markup change.
`pathLength="1"` normalizes every path, so the top-to-bottom draw is a plain
`stroke-dashoffset: 1→0` in the shared `storm-strike` keyframes; unequal per-bolt cycle
durations make the two strikes drift out of phase forever. Each bolt is a **forked
channel** — a main trunk plus one or two branches — but authored as a *single continuous
subpath*: at each fork the path darts out to the branch tip and **retraces the same line
back** to the trunk before continuing down, so the branches appear to grow out mid-strike.
This is deliberate, not fussiness: a branch **can't** be a separate `M` subpath, because
`stroke-dasharray` restarts at every subpath, so each fork would reveal on its own schedule
and the bolt would draw as disconnected fragments instead of one clean top-down wipe. The
retrace keeps the whole bolt one path, so the draw-on stays clean (branches inherit the
trunk's stroke width — tapered forks would need separate `<path>` children). The one
non-CSS piece is
**position randomness**: `src/storm.ts` re-rolls each bolt's `--storm-x` (+ a `scaleX`
mirror) on `animationiteration` — the loop seam, where opacity is 0, so the jump is never
seen. `prefers-reduced-motion` hides the layer outright (a frozen half-drawn bolt reads
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
  (`.chrome-right`) holding the **volume pill** and the traffic lights.
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
[DATA-ARCHITECTURE.md](DATA-ARCHITECTURE.md) §2). A row can also be a **toggle**
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

**One dropdown primitive for every menu** (`src/dropdown.ts`, `makeDropdown`): the settings
menu, the volume flyout, and the **slot-card pickers** share a single open/close/dismiss
mechanism (outside-click + Escape, `aria-expanded`, an optional `shouldStayOpen` veto so a
volume drag can't close the panel under itself, and a `disabled` veto the picker uses to go
inert off-root). Each call takes a `root` (the hover region — must contain both trigger and
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
`1px` edge). The fill is a **skin** token now
(`--panel` points at a theme role — Desk `--surface`, Ocean a `color-mix` of it), the
edge color (`--panel-border`) stays **theme**, and `--panel-border-width` / `--panel-radius`
/ `--panel-pad` / `--shadow-card` are **skin** — so Desk/Ocean restyle panels into real
cards (distinct fill + drop shadow, no border) with **no markup change**. Note: rounded +
exotic borders (gradient/wavy) can't use CSS `border` (border-image ignores
`border-radius`) — such a skin draws the edge on a `::before` masked/SVG layer instead.

**Scrubber handle is skin-swappable:** the Now Playing handle is a `--title`-filled
box masked by the `--scrubber-handle` SVG token (a `url(<data-uri>)`), so the shape is
arbitrary yet still themes via `--title` and sizes via `--scrubber-handle-size`. Skins
override the token only: Vanilla a circle, Ocean a water droplet, Desk a paper chit.
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

The card's scrolling body uses **our own scrollbar** instead of the OS one — styled
via the `::-webkit-scrollbar` pseudo-elements (WebView2 is Chromium). Its **color is
a theme role** (`--scrollbar` / `--scrollbar-hover` in `themes.css`) and its
width/radius are skin tokens (`--scrollbar-w` / `--scrollbar-radius`). Scoped to the
scrolling `.lib-view`; widen the selector to theme every scroll region the same way.

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
src/styles/fonts.css    @font-face for bundled fonts (Liberation; Desk/Ocean skin faces)
src/styles/palette.css  Tier 1 — raw paints
src/styles/themes.css   Tier 2 — color roles per theme
src/styles/skin.css     Tier 3 — [data-skin] base + vanilla/desk/ocean deltas (type/geometry/motion)
src/styles/fonts/       bundled font files (Liberation TTFs + NOTICE; skin WOFF2s)
src/main.ts             window controls, settings menu, account, menu-mode; calls initTheme/initSkin/initLayout()
src/cards.ts            card registry + CardDef/CardInstance (the mountable-card contract)
src/layout.ts           midi layout: anchored Now Playing + 2 swappable slots + title-menu picker
src/now-playing-card.ts Now Playing transport card (extracted from main.ts)
src/playlists-card.ts   Playlists card — overview → detail on the engine; New Playlist (+),
                        remove-track, empty-only delete (PLAYLISTS.md)
src/dropdown.ts         dropdown primitive + menu-mode fan-out (setDropdownMode, destroy)
src/theme.ts            theme switch + localStorage persistence
src/skin.ts             skin switch + localStorage persistence (mirror of theme.ts)
src/storm.ts            storm-layer position re-roll (CyberStorm bolts; inert otherwise)
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
