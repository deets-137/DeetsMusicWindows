---
status: built
desk_test: passed 2026-10-20
sources: [src/styles/skin.css, src/styles/themes.css, src/styles.css, src/look-ids.ts, src/metal.ts, src/skin-settings.ts, src/vinyl.ts, src/settings-card.ts, src/full-player.ts, src/full-player-layout.ts, src/drum.ts]
updated: 2026-10-21
---
# Metal — a brushed-metal skin, and the token cleanup it needs

> **Built 2026-10-20, desk test passed the same night (his word).** Opened 2026-10-19 as an idea
> in a talk with the owner ("can we chat theoretically about a mod system"). Every fork in §7 is
> closed. §6.4 and §6.7 are the as-built record.

Metal is a sixth skin. It is also the test case for skins a user downloads
([mods.md](../ideas/mods.md)): if Metal can be made from token values alone, most skins can. This doc
holds the skin and the token cleanup. The file format, the install and the safety rules are in
mods.md.

## 0. Terms

- **Theme:** the color roles (`themes.css`). **Skin:** the shape, type, space and motion
  tokens (`skin.css`). The same words as [SKINZ.md](SKINZ.md).
- **Paint token:** a token whose value is a whole CSS `background` (layers of images and
  gradients), not one color. `--panel-paint` and `--canvas-bg` are the two today.
- **Hook:** a CSS rule in our own files that stays off until a skin sets a token. Ocean's Sand
  edges are the model (`--sand-display` in `styles.css`).
- **Primitive:** a skin token that many feature tokens read (§4.4). A skin sets the primitive
  once, and every feature follows.

## 1. His calls (2026-10-19)

- **Metal is as full as the other skins, or more.** "Looking to push it further." Press has its
  record player, Glass its Canvas and Fancy Glass, Ocean its sea and Sand edges. Metal gets
  features of its own (§1c), not only a look.
- **Metal works over every theme** (was fork F2). The dark themes become dark metal, the light
  themes aluminum, each with its own accent. His example: Black & Yellow becomes dark metal
  with gold accents (§1b).
- **The cleanup first** (was fork F3): "want to ensure a good foundation". §6's order stands.

**Second round (2026-10-19, later), after the first HTML bench:**
- **The same UI pieces the app uses today.** "We don't have a volume dial anywhere and I don't
  want to add new buttons or anything." Metal restyles the existing cards and controls. No
  new control, no new card part, no VU meter, no knob, no switch (closes F1 and F5: §1c is out).
- **More elegant.** "Finely brushed stainless steel, or like a textured acrylic paint brush."
  The aggressive look of §1a (screws, chamfers, diamond plate, hazard stripes) is out. The two
  materials are compared on the dev app (§6.1).
- **Built from the code, on a Max app**, not from screenshots or a hand-made page. The first
  HTML bench was thrown away.

### 1a. The look (a draft, his to edit)

> **Part:** idea · 2026-10-19 · replaced by the second round of §1 (elegant, no new pieces)

- Dark gunmetal cards, not chrome. A brushed grain, horizontal on cards, diagonal on menus.
- A bevel on every card: a light top-left edge, a dark bottom-right edge.
- Chamfered corners, 45°, about 6 px.
- Four hex-head screws per card, one in each corner.
- Condensed all-caps headings with wide tracking, engraved into the metal.
- One hot accent: hazard orange, or the album color (ALBUM-COLOR.md) as an option.
- Motion that snaps: about 90 ms, a hard stop, no settle. A card swap is a shutter that
  slams shut.
- Raised buttons that sink when you press them.

### 1b. The six themes as metal (a draft, his to edit)

| Theme | Scheme | The metal | The accent |
|---|---|---|---|
| Black & Yellow | dark | Dark steel | Gold (his example) |
| Black & Red | dark | Blackened steel | Red anodized |
| Moonlight | dark | Gunmetal | Polished silver |
| Lilac | light | Brushed aluminum | Lilac anodized |
| Green | light | Brushed aluminum | Green anodized |
| Sepia | light | Brushed brass | Copper |

**How a theme picks its metal: the `--ink-2` pattern.** No skin × theme block exists in the
CSS today, and none is needed. `--ink-2` is a theme role that only Press prints: each theme
names which of its accents becomes Press's plate, and `:root` gives a fallback, so a theme that
never names it still prints. Metal does the same with two roles:

- `--metal`: the metal's base tone. The `:root` fallback is the theme's `--surface` mixed
  toward neutral grey (a desaturated surface reads as metal).
- `--metal-accent`: the accent metal. The fallback is the theme's accent.

Each theme can then name its own. Black & Yellow names a gold, not its flat hi-vis yellow.
**A metallic accent is a gradient, not a flat color.** A skin token builds it from
`--metal-accent`: a lighter mix, the color, a darker mix, at an angle. That gradient is what
makes a yellow read as gold, and a grey read as polished silver. It goes where Metal paints
an accent fill (an "on" square, the scrub fill), through the paint tokens of §4.2.

### 1b2. The scrubber: five ideas (a draft, his to pick, 2026-10-19)

Each restyles the existing scrubber (the song's, and the volume's, which share the slider
primitive) through the Fancy scrubber hook, as Press, Glass and Cyber do: the same piece, the
same drag and keys, a new face. "Old school app design" is the frame.

1. **The LCD window.** The track sits in a recessed, backlit display strip, a pale blue-green
   glass with a faint pixel grid, as on the brushed-metal music players of the early 2000s.
   The played part is a darker LCD bar; the handle is a small black diamond. The time could sit
   in the same window.
2. **The fader cap.** A mixing desk's fader: the track is a slot milled into the plate, and
   the handle is a machined cap with three grip ridges and a bright index line across its
   middle. The played part of the slot is polished brighter. Hover lifts the cap 1 px; a drag
   sinks it.
3. **The ball bearing.** A small polished steel ball in a V-groove. The light on it stays fixed
   while the reflection on its surface moves as it travels, so it reads as rolling. The groove
   behind it is burnished.
4. **The engraved rule.** The track is a ruler cut into the plate: fine ticks every 2 %, longer
   ones every 10 %. A thin needle in the accent rides along it, like a gauge pointer. The ticks
   it has passed are filled with the accent, as paint fills an engraving.
5. **The thumbwheel.** The handle is a short knurled wheel standing in the slot; its ridges
   scroll as it moves, as if it rolled along the track. The track is a plain milled slot.

### 1c. Metal's own features (a draft, his to pick and edit)

> **Part:** idea · 2026-10-19 · out: "no new buttons or anything" (§1, second round). Kept as a record.

Each is a Settings row under Skin settings, "Metal only", as Glass and Ocean have.

| Feature | What it does | A setting |
|---|---|---|
| **VU meter** | A needle meter on Now Playing, driven by the Sound panel's Web Audio graph (SOUND.md). Metal's answer to Press's record player. | Meter: Needle · Off |
| **Album anodizing** | The accent metal takes the album's color (ALBUM-COLOR.md), as Ocean's Album light does. | Accent: Theme · Album |
| **The light** | A specular band across the metal that moves with the pointer (the app sets `--pointer-x` / `--pointer-y`; the skin only reads them). | Light: Follow pointer · Still · Off |
| **Machined controls** | The volume as a rotary knob with a knurled edge; on / off rows as toggle switches that flip. | Controls: Machined · Flat |
| **The floor** | The page behind the cards: diamond plate or perforated steel. | Floor: Diamond plate · Perforated · Plain |
| **Fasteners** | The corner screws. | Screws: Hex · Phillips · Rivets · None |
| **The grain** | The brush direction. Circular is spun metal, as on a knob face. | Grain: Brushed · Spun |
| **Motion** | A blast-door shutter for card swaps; plates bolt in at launch. | (the skin's motion tokens) |

The VU meter and the machined controls are code, as the record player is (`src/vinyl.ts`).
The rest is values and hooks. A downloaded skin could have the values, never the code
([mods.md](../ideas/mods.md) §6.1).

## 2. How Press does it today (the evidence)

Press is one of our most distinct skins, and it is almost all values. Its look is one block of
about 100 tokens in `skin.css` (`[data-skin="press"]`). The parts that make it Press are token
values that carry rich CSS:

| Press part | The token | The value's kind |
|---|---|---|
| The offset plate | `--shadow-card`, `--shadow-panel` | A hard shadow, no blur |
| The halftone paper | `--canvas-bg`, `--canvas-bg-size` | A gradient |
| The block scrubber handle | `--scrubber-handle` | An SVG data URI |
| The trimmed edges | nine radius tokens set to `0` | Numbers |
| The press stroke | `--hover-lift`, `--nav-*`, `--swap-*`, `--fly-*`, `--boot-*` | Transforms and curves |

There are two exceptions. The Fancy scrubber is six rules in `styles.css` that draw the handle
with `::before` / `::after`, behind a setting. The record player is `src/vinyl.ts` and five
Settings rows: a feature, not a look.

The card rule paints `background: var(--panel-paint)` and `box-shadow: var(--shadow-card)`.
Both are full shorthand slots, so one token can hold many layers.

## 3. What Metal needs, against what exists

| Metal part | How | Exists now? |
|---|---|---|
| The grain | `--panel-paint`: a grain tile over a base gradient | Yes |
| The screws | More layers in `--panel-paint`: one screw image per corner, `no-repeat` | Yes |
| The card bevel | `--shadow-card`: two inset shadows and a drop shadow | Yes |
| Menus | `--menu-surface`, `--shadow-panel` | Yes |
| The snap motion | The duration, ease, swap and lift tokens | Yes |
| The font | `--font-title`, with the font in `fonts.css` | Yes |
| The chamfer | Nothing: radius only | **No** (§4.3) |
| Engraved headings | Nothing: no `text-shadow` token | **No** (§4.3) |
| Brushed buttons and chips | Nothing: the control fills are color roles | **No** (§4.2) |
| Beveled hairlines | Nothing: about 70 rules write `1px solid` | **No** (§4.1) |
| A pressed button sinking | `--hover-lift` covers hover only | **Partly** |

A catch with the chamfer: `clip-path` also cuts the outer drop shadow. A chamfered card keeps
its inset bevel, and Metal draws its drop edge in the paint layers.

## 4. The token survey (2026-10-19)

The component CSS is almost fully tokenized. In `styles.css` and the 11 files in
`src/styles/` (besides `skin.css`, `themes.css`, `palette.css`): no raw duration, no
`cubic-bezier`, no raw font size or font family, no raw shadow. The TypeScript has no raw
animation duration either. The painters read tokens (58 reads). What is left falls into four
gaps and one group that is right as it is.

### 4.1 Hairlines are not tokens

About 70 rules write `border: 1px solid var(--border)` or `var(--panel-border)`. The color is a
role, but the width and the style are fixed.

- **The change:** `--hairline-w: 1px` and `--hairline-style: solid` in the skin base, read by
  every one of those rules.
- **What it gives:** CSS has `ridge`, `groove`, `inset` and `outset` border styles. Those are
  bevels. Metal gets beveled edges on every row and chip with two values. A heavy skin gets
  2 px rules.
- **The cost:** a width change moves layout by a pixel per edge. The shots set can show it.
- **`ridge` and `groove` need 2 px.** The two tones each take half the width, so at 1 px the
  line draws solid. Metal's beveled lines are 2 px.

**What the skins do today.** The card's own edge is already a skin token,
`--panel-border-width`: Vanilla `0`, Press `1px`, Ocean `0`, Glass `1px`, Cyber `1px`. The
empty slot's rim has a width and a style token (`--empty-slot-rim-w`, `--empty-slot-rim-style:
dashed`), which is the model for §4.1. The ~70 inner lines (rows, chips, fields, menus) are
fixed in every skin: no skin can change them today.

**Would a built-in skin use it?**

| Skin | The use | Worth it? |
|---|---|---|
| Vanilla | Its cards are borderless; its inner lines separate rows | No: keep 1 px solid |
| Press | A heavier keyline (2 px) on menus and chips, to match the 4 px plate | Maybe: a look in the shots |
| Ocean | Its look is soft fills, not lines; a line's color matters more than its width | No |
| Glass | A glass edge is a light top line, a color per side, not a width | No |
| Cyber | 2 px neon traces, with the glow it already has | Maybe: a look in the shots |
| Metal | 2 px `ridge` / `groove` bevels | Yes: the reason for the token |

So the token is for Metal first. Press and Cyber are worth one look each after Step 2 (§6.3),
in the shots runner, before anything changes.

### 4.2 Paint is only on two surfaces

Theme roles are colors, and they must stay colors: about 70 `color-mix()` calls use them.
So a texture cannot go in a role. Today a texture can go only on the card (`--panel-paint`)
and on the page (`--canvas-bg`).

- **The change:** paint tokens for the other control families
  (UI-ARCHITECTURE.md §2a): `--control-paint` (buttons, squares), `--chip-paint`,
  `--menu-paint`, `--field-paint`. Each defaults to its role color.
- **What it gives:** brushed buttons, plastic chips, a paper field.
- **The cost:** one token per family, and the rule set of each family changes from
  `background-color` to `background`.

### 4.3 No hooks for edge shape and text

- **The change:** `--panel-clip` (a `clip-path`, default `none`) and `--text-engrave` (a
  heading `text-shadow`, default `none`). The Sand pattern: off until a skin sets them.

### 4.4 Feature tokens do not follow the primitives (the rearrangement)

The base skin has about 680 tokens. Only about 170 of them are aliases of another token. The
rest are raw values. So a skin that changes one idea must change it in many places:

- **Press sets nine radius tokens to `0`**, one by one. In the base, `--lib-pill-radius` is
  `999px`, `--lib-tile-radius` is `8px` and `--lib-row-art-radius` is `4px`. None of them read
  `--radius-control`.
- **A radius token added later** keeps its base value in Press until someone adds a line.
  Nothing catches the miss.
- **The Skinz Corners control** (SKINZ.md §4) writes three radius tokens. It would not reach
  the other six.

**The change:** a small set of primitives, and feature tokens that alias them in the base:

| Primitive | The feature tokens that would read it |
|---|---|
| `--shape-panel` | `--panel-radius`, `--radius-panel`, `--lib-pop-radius` |
| `--shape-control` | `--radius-control`, `--lib-tile-radius`, `--lib-row-art-radius` |
| `--shape-pill` | `--lib-pill-radius`, `--vol-pill-radius`, `--scrollbar-radius` |
| `--hairline-w`, `--hairline-style` | the 70 border rules (§4.1) |
| `--paint-*` | §4.2 |

The same pass applies to motion (the durations and curves) and to the shadows. A feature
token keeps its own name, so a skin can still change one feature alone. Only the default
moves from a raw value to a `var()`.

**What it gives:** a skin sets perhaps 40 to 60 primitives instead of 680 names. That helps
the built-in skins today (Press's nine lines become one), and it is the public API a mod
would use later.

### 4.5 Right as it is (not a gap)

- `border-radius: 50%` (about 25 rules): artists, stations and dots are round by meaning.
  A skin must not make an artist square.
- `#000` inside a `mask`: an alpha mask, not a color.
- `rgb(0 0 0 / var(--canvas-dim))`: the scrim is black by definition.
- SVG user units (`transform-origin: 100px 100px`): the viewBox's units, not layout.

## 5. Performance

- **The grain is a PNG tile.** Sand's grain is an SVG `feTurbulence` filter. A brushed grain
  needs long streaks, and a picture drawn once is cheaper to raster. Measure both, frames ÷ ms
  on `dev:built`.
- **The graphics fallback covers it** (GRAPHICS-FALLBACK.md). On WARP the grain and screw
  layers turn off. The bevel shadows stay.

## 6. The implementation scope

> **Part:** idea · 2026-10-19 · forks §7

Five steps, in order (his call: the cleanup first). Steps 1 and 2 change nothing on screen.
Each step is one change that he can test before the next one starts.

### 6.1 Step 0: the probe (no new tokens)

> **Part:** built · 2026-10-19 · dev only

**As built:** a dev-only draft over Vanilla, so no skin id and no change to Vanilla's block:
- `src/dev/metal-draft.css`: the material as values on the tokens the cards and controls
  already read (`--panel-paint`, `--shadow-card`, `--surface`, `--surface-hover`, `--border`,
  `--canvas`, the fonts, the radii), and the six themes' metal (§1b). Four small rules reach
  past the tokens, and each one names the hook the cleanup would give it: the card's layer
  blend, the floor's color under its grain, the control family's grain, and a polished face
  on the accent fills.
- `src/dev/metal-draft.ts`: draws the two textures as SVG noise (brushed steel: fine hairlines;
  acrylic: short dabs with bristle lines, lit into a relief) and adds the console handle
  `__metalDraft()`: `{ material, grain, size, swap }`, `"off"` (the skin you had comes back).
  Kept in localStorage, so a reload keeps it.
- **One Metal (his ask, 2026-10-19):** in dev, the title menu's Skin list ends with Vanilla and
  Metal, added by `metal-draft.ts`. Each is a real pick of Vanilla (stored), with the draft on
  or off; picking a built-in skin there turns the draft off.
- **The differences and the tuning in Settings (his ask):** Settings › Skin settings, while
  Metal shows: Material (Steel · Acrylic), Grain (Faint · Fine · Medium · Strong), Grain size
  (Small · Medium · Large), Cover change (Zoetrope · Off). Choice rows with `get` / `set` over
  the draft's own localStorage, so no store key exists yet. `settings-card.ts` has a dev hook
  for them (`addDevSkinRows`, `redrawDevSkinRows`), an empty list in a release build. When
  Metal is built, they become store keys with agent specs, hints and New marks.
- **The zoetrope cover change (his design):** "shrink and rotate out while another cover enters
  from the right and expands in", like pictures on a zoetrope's drum. A new token
  `--cover-swap` (skin.css base `none`: no skin changes) lets a skin move a plain cover on a
  song change; `vinyl.ts` reads it, and `zoetrope` runs the drum: the old cover goes to the
  left, turned −58° on the y axis and scaled to 0.6, fading; the next one comes from the right,
  turned +58°, and grows to the front. Previous runs it the other way. Press's record keeps its
  own slide. 0.56 s, `cubic-bezier(0.65, 0, 0.35, 1)` (the draft's `--vinyl-swap-*`). Reduced
  motion: no move, as for the record. Checked on the dev app with
  `shots/scratch/metal-zoetrope.json` (Next, then Previous back to the same song).
- **Kept inside the cover's box (his ask, after a visual review):** in Max the turning covers
  were drawn over the card edge and the Home card. The cause was not the 3D: a song change that
  also changes the theme (his app has a rule that does) runs a theme fade, a View Transition,
  and `styles.css` names `.vinyl__spin` during a fade so Press's record keeps turning; a named
  element is drawn above the page, past every clip. The draft unnames it under Metal and clips
  the box with a `clip-path`. Checked in Max (`metal-zoetrope.json`, `metal-zoetrope-who.json`
  found which elements move). When the theme changes with the song, the page's crossfade
  sits over the turn; when it does not, the turn shows on its own.
- **The thumbwheel scrubber (his pick, §1b2 idea 5):** with Fancy scrubber on, on every
  `.scrub` (the seek bar, the stage volume, the Settings ranges): a 6 px slot milled into the
  plate, a polished accent fill, and a 12 × 22 px knurled wheel lit across its middle, whose
  ridges scroll with `--slider-fill`, so it reads as rolling. It rises 8 % under the pointer
  and brightens while held. Draft rules in `metal-draft.css`; a built skin gets it through the
  Fancy scrubber hook as Press, Glass and Cyber do.
- **The LCD window (idea 1), against the code:** the face is possible through the same hook,
  but it needs two colors no theme has (the backlight and the LCD ink: two new roles, the
  `--ink-2` pattern), and the time inside the window would move the time out of its own row:
  a new layout, which §1 rules out. The LCD look without the time is the possible part.
- **The peek (his idea, built 2026-10-20 to test, "Let's test Peek"):** on the stage (Max,
  the player view), the cover sits at 72 % of its box; the previous and next covers wait behind
  it at the box's sides, 62 %, turned 30° on the drum and at 70 % brightness. The zoetrope runs
  between those spots (`--zoetrope-run` / `-turn` / `-scale` / `-fade` / `-dim`, new skin.css
  tokens that `vinyl.ts` reads; the base keeps the far-off, faded turn): the old cover settles
  where the previous one waits, the next comes forward from where it waited, and a side cover
  that changes fades in as the turn ends. The neighbors are the history's last entry and the
  queue's first, resolved by the Queue card's own helpers (`resolveEntry`, `artURL`): no Apple
  call, two more pictures. Settings › Skin settings › Peek (On · Off), shown while Cover change
  is Zoetrope. Checked in Max on the dev app (`metal-zoetrope.json`, `metal-sharp.json`).
- **The design review loop (his ask, 2026-10-20):** seven independent Fable reviewers, each
  given only frames of one skip in Max (no code, no notes), scored it 5, 5, 5, 6, 6, 6, 6. What
  each round changed, in the draft unless named:
  - the old cover retreats into its slot first and the next one waits, then comes forward
    (`--zoetrope-stagger` 0.25, a new skin.css token, base 0; his call); the two trade depth
    on the way; the old cover starts at once, without waiting for the new picture's decode
    (`vinyl.ts`); each step eases out with a 2–3 px overshoot; 0.72 s;
  - same-picture songs do not turn (`vinyl.ts`), and a side cover that matches the cover is
    left empty;
  - the row shifts one slot: the side covers change as the cover lands, the next slot's new
    cover slides in during the turn;
  - the box is 5:4 under the peek (no empty band above and below the cover);
  - the song's words, times and heart: the old words leave to the left, then the new come in
    from the right, never both at once; the Plays badge sits on the cover's corner and fades
    up as the cover lands;
  - covers get a soft shadow and a 1 px light rim; the thumbwheel is 10 × 18 px;
  - a theme change under Metal is a cut (`--theme-morph-dur: 0.01s`), not a crossfade
    through grey.
  **Where it stopped, and why:** the rest of the deductions are the app's, not the skin's,
  and each one is his call: (1) a song change that changes the theme (his Live Theming rule)
  runs the app's View Transition: a crossfade passes through grey, a cut is abrupt, and its
  snapshot freezes the page about 200 ms after the press; a color morph (the `@property`
  roles) would tween with the cover, measured at ~20 fps on an integrated GPU on 2026-09-27
  (appearance.ts); (2) the dark theme's secondary text is below 4.5:1 on the slate; (3) the
  Plays badge's place is his design (LISTENERS.md §4). The frames are cut by time, not by
  index (a 4 ms frame must not weigh like a 70 ms one).
- **His Next / Back report (2026-10-20), fixed and checked on the dev app**
  (`shots/scratch/metal-next-back.json`: Next, Next, Back, Back between different covers):
  - "it changes color first, as if the cover on top is there before it moves": the new cover
    was shown at its slot before its picture had decoded (a blank square over the waiting side
    cover). It now stays hidden until decoded, then keeps the turn's clock (`vinyl.ts`). A name
    clash hid this too: the stagger was called `wait`, the same name as the decode timeout, so
    the race never waited; renamed `stagger`.
  - "the last frames have a ghost": on Back, the slot that receives the old cover took that
    picture early and slid in a second copy beside the one still landing. The side covers now
    follow the direction: the slot that receives the old cover changes under it just after it
    lands; the slot the new cover left fills during the turn, its new neighbor sliding in from
    its own edge. The previous cover is remembered across the several syncs one song change
    fires, and a picture already on its way is not rescheduled.
  - The side covers were missing after a window change (the card is rebuilt after the surface
    attribute flips): they are looked for again after it, and whenever a cover box appears
    without them.
  - The theme change in these clips is his dev rule (the color morph), not a default; it is not
    part of Metal's own look.
- **"It gets stuck for a sec, then resumes" (his report, 2026-10-20), fixed:** the clip's change
  curve showed the cover box still for 133 ms in the middle of a Next (95 ms on Back). The old
  cover's retreat used the turn's ease-out with overshoot, so it spent its distance in the first
  ~100 ms; the next cover set off only after its wait. Now the retreat has its own curve
  (`--zoetrope-leave-ease`, a new skin.css token, base empty = the turn's; the draft:
  ease-in-out over half the turn) and the next cover sets off sooner (stagger 0.15). Measured on
  the dev app: the largest still moment is 35 ms on Next, 27 ms on Back (a frame or two); the
  turn settles at ~0.53 s. Also: the side covers load the cover's own size (480 px, the same
  address), and each neighbor's picture is decoded as soon as it is known, so a first Next does
  not wait on a download.
- **Rapid Back / Next ghosts and flickers (his report, 2026-10-20), fixed:** three faults.
  (1) A press during a turn made the arriving cover the leaving one, and its retreat started
  from the front: it jumped there for a frame. It now leaves from where it is (its computed
  transform, opacity and filter; its running animations cancelled). (2) A cover still on its
  way out was removed at once by the next press: now it fades in 120 ms. An arrival a newer
  press overtook stays hidden. (3) A side cover's pending change survived a press that made
  the slot right again, then fired and put another cover there: a slot that is already right
  cancels any pending change. Checked with `shots/scratch/metal-rapid.json` (Next, Back, Next,
  Back ~250 ms apart on the dev app): no doubled or wrong cover, one cover layer at the end.
- **Doubled edges in the side slots (his red boxes, 2026-10-20), fixed: one layer per slot.**
  Not a loading problem: a side cover showed the same picture as a cover moving through its
  slot. The giving slot (the one the new cover leaves) now empties in 80 ms the moment the turn
  starts, then its new neighbor slides in from its edge. The receiving slot takes its picture at
  once but stays invisible while the old cover is still in the box (`.np__art:has(>
  .vinyl--out) > .metal-peek[data-receiving]`); the old cover is removed as its animation ends
  and the side cover shows in that same frame. Checked with `metal-rapid.json` on the dev app.
- **The crop (his note, 2026-10-20):** a side cover's inner edge, turned toward the viewer, grew
  taller than the cover and showed as a wedge above and below it (clearest in the full player).
  The box clips to the cover's own top and bottom (`clip-path: inset(5% 0 …)`, the cover's 5 %
  inset); the sides stay open.
- **The break-it pass (DESK-TESTS.md §6.6 step 1, run 2026-10-20, late: it should have run
  first).** Three Sonnet agents, one per lens, 42 scenarios from reading the code; each checked
  against the code. Fixed:
  1. *Motion speed:* the sides and the words read the raw duration while the cover multiplies it
     by `--motion-scale`; one clock now (`turnMs`: duration × motion scale, 0 under reduced
     motion or a held or hidden window).
  2. *Hidden window:* the cover skips its turn when held, the sides and words did not (and their
     throttled timers left a slot empty); now they do not move either.
  3. *A stale receiving mark* on a slot that was already right; the mark is now set or cleared on
     every sync.
  4. *Queue edits animated the sides* (shuffle, Play Next, a dragged row), and opening the full
     player (bigger pictures) counted as a song change: a turn is now a change of song id, and
     only a sync within the turn animates; anything else updates the sides at once.
  5. *A jump doubled the landing slot* (a Queue row, a double-click): which slot receives the
     old cover now follows the turn's direction (Back only when the next slot's new picture is
     the cover just left; anything else forward, as `vinyl.ts` turns it), not a picture match.
  6. *Word copies piled up* on rapid skips (no cap), and the copy was taken before the artist
     line filled in: one copy at a time, refreshed on any change of the words that is not a new
     title.
  7. *Midi made and fetched hidden side covers:* side covers exist only on the stage.
  8. *The page-wide watcher ran on every DOM change* (a Library scroll included): at most one
     look a frame.
  9. *Show cover = Playlist:* the cover is the playlist's picture for every song, so the sides
     (album covers) hide.
  Checked with `shots/scratch/metal-breakit.json` on the dev app: a shuffle toggle runs no side
  animation; a jump two rows ahead leaves one layer, no receiving mark, no word copy; eight Next
  presses 80 ms apart end with one layer, both sides showing, no marks, no copies. Back to the
  starting song, paused through the app's own Play button (a direct `pause()` was resumed).
  **Noted, not fixed (low impact, or a neighbor's own timing):** the full player opened mid-turn
  (its cover flight measures a square cover); two songs with one title get no word fade; repeat
  all at the queue's end shows an empty next slot; a Plays count that arrives late pops in; on a
  very slow link a cover still arrives undecoded after the 300 ms wait; the word copy keeps its
  pixel place if the card is resized mid-turn; rapid skips under his dev theme-morph rule start
  and skip View Transitions.
- **Sharper (his ask):** 4 px cards and 2 px controls, every radius token Press also sets (no
  capsule pill left), crisper edges, a short contact shadow, and finer grain (0.3).
- **No diagonal reflection (his call):** "invoking old school app design". The flat brushed
  plate, lit only at its top and bottom edges.
- `main.ts` imports it only under `import.meta.env.DEV`, as the copy editor is.
- Type: Bahnschrift (Windows' DIN) over Segoe UI Variable. Both ship with Windows, so there is
  nothing to bundle; a Linux build would need a bundled face.
- The pictures: `shots/scratch/metal-draft.json` (steel over four themes, then acrylic).

When the skin is built (§6.4), the tuned values move onto tokens and `src/dev/metal-draft.*`
is deleted.

### 6.2 Step 1: the primitives (§4.4)

- Add `--shape-panel`, `--shape-control`, `--shape-pill`. Point the radius feature tokens at
  them in the base.
- Do the same for the durations, the curves and the shadows where a group shares one idea.
- Each built-in skin sets the primitive instead of the feature tokens, where the values are
  the same. Press's nine radius lines become three.
- **The check:** no pixel moves. The motion set (`docs/guide/motion.json`, all skins) and a
  still set of every skin × two themes, before and after. `npm run tokens` in the same commit.

### 6.3 Step 2: the hooks (§4.1–§4.3)

- `--hairline-w`, `--hairline-style` in the ~70 border rules.
- `--control-paint`, `--chip-paint`, `--menu-paint`, `--field-paint`, each defaulting to its
  role color.
- `--panel-clip`, `--text-engrave`, both `none`.
- A pressed state: `--press-sink` beside `--hover-lift`, default none.
- The two theme roles `--metal` and `--metal-accent` (§1b), with their `:root` fallbacks, and
  a value in each of the six themes. Nothing reads them until Step 3. `npm run tokens` runs.
- **The check:** the same before / after sets. At the defaults nothing changes.

### 6.4 Step 3: the Metal skin
> **Part:** built · 2026-10-20 · desk test passed 2026-10-20 (his word, DESK-TESTS.md §5)

**As built (2026-10-20), his calls: the cleanup first; four Settings rows.**
- **Step 1 (primitives):** the inventory showed the skins vary each shape on purpose (Glass
  rounds tiles 12 px with a pill scrollbar; Cyber squares tiles but rounds pills 2 px), so a
  shared shape primitive would move pixels in a built-in skin. The one true pair: the volume
  pill now follows the Library pill (`--vol-pill-radius: var(--lib-pill-radius)`; three skin
  lines gone, same values). Motion was already aliased by the motion pass (TOKENS.md › Motion).
- **Step 2 (hooks, off in every other skin):** `--panel-blend`, `--app-canvas-color` /
  `-blend`, `--control-paint` / `-size` / `-blend` / `--control-shadow` on the control family,
  `--accent-sheen` on the accent fills; the family's hovers change `background-color` only.
  The hairline, chamfer and engrave hooks wait for a skin that uses them.
- **Step 3 (the skin):** `metal` in `SkinName`, the title menu (hint: *Brushed steel panels
  with sharp edges. Covers turn on a drum*), the look schedule's list, the fonts list
  (Windows' Bahnschrift and Segoe UI Variable, nothing bundled), the extension's options page
  and its style copies (no texture there). `[data-skin="metal"]` in skin.css on the hooks;
  each theme's `--metal` / `--metal-floor` in themes.css from new palette paints, the shared
  light-and-shade roles, and the gold title on Black & Yellow; the stage, the peek, the badge
  and the thumbwheel in styles.css "Metal" on Metal tokens; `src/metal.ts` (the textures, the
  side covers, the word fade; from the draft). Settings › Skin settings: Material, Grain, Cover
  change, Peek (`metalMaterial`, `metalGrain`, `metalCoverChange`, `metalPeek`; agent specs,
  New marks, SETTINGS.md §3, AGENT.md). Not in the usage allow-list (a privacy call, his).
- **The dev draft is gone** (`src/dev/`, its picker items, the Settings dev hook).
- **Checked:** tsc, the unit tests, docs:check, and on the dev app the skin picked from the
  title menu: the texture drawn, the zoetrope on, both side covers, the four rows.
- **Not run yet (the desk test, 2026-10-21):** DESK-TESTS.md §6.6 on the real skin: the break-it
  pass's scripts (`metal-rapid.json`, `metal-next-back.json`, `metal-breakit.json`, cold with
  `clearCache`), the timing gate, the motion monitor; every theme × Metal (and Acrylic), Midi,
  Mini and the full player; the other five skins unchanged (the hooks are off there); the
  extension's options page; then his own look. Move the three lists to `docs/ops/checks/`.

**The plan (2026-10-19), kept as a record:**

- **The block:** `[data-skin="metal"]` in `skin.css`, values only (fork F1).
- **The assets:** the grain tile and the screw SVG, and the heading font in `fonts.css` and
  `src/styles/fonts/`.
- **The skin id is a contract.** `metal` goes in `SkinName` (`src/look-ids.ts`) and everywhere
  the other ids are listed: `src/appearance.ts`, `src/look-schedule.ts`,
  `src/settings-store.ts`, the pre-paints in `index.html` and `tray.html`, and the extension
  (`extension/install.html`, `extension/options/options.html`). A grep for `"cyber"` finds
  them. DeetsSolutions carries the ids too: a separate repo, his call when.
- **The rules engine** reaches it with no new code: `skin` is already a rule key.
- **The graphics fallback:** Metal's grain and screw layers join the heavy-effects list.
- **The build checklist** (CLAUDE.md › Working style): the Compass reaches a skin
  automatically; a Settings row for a Metal-only option (if any) gets its hint, agent spec and
  New mark.
- **The check:** the motion set runs Metal automatically (`"skin": "*"`). Every theme in
  Metal, against the §1b table. Frames ÷ ms on `dev:built` in Midi and Max, against Press. A
  desk test written into this doc.

### 6.5 Step 4: Metal's own features (§1c)

> **Part:** idea · 2026-10-19 · out (§1, second round: no new pieces). Kept as a record.

One feature at a time, in the order he picks, each with its own desk test. Each follows the
skin-settings pattern of Glass and Ocean: a Settings row shown only under Metal, a store key
with a default and its "why", an agent spec, a hover hint, a New mark.

- **The values-and-hooks features** (Album anodizing, the light, the floor, fasteners, the
  grain) are skin values behind `data-*` attributes, as Press's `data-press-vinyl` is.
- **The code features** (the VU meter, the machined controls) are modules of their own, as
  `src/vinyl.ts` is. The VU meter reads the Sound panel's graph, runs only while Now Playing
  shows it, and stops under reduced motion and on WARP. The machined controls change the
  markup of the volume and the toggles under Metal only, so each one needs the control
  family check (UI-ARCHITECTURE.md §2a) and its keyboard path.

### 6.6 Not in this scope

The `.deetsmod` file, the install, the safety checks, the marketplace page and new theme
slots. They are in [mods.md](../ideas/mods.md), and they build on Step 1's primitives.

### 6.7 The stress test and the design review loop (2026-10-20, his ask)

> **Part:** built · 2026-10-20 · desk test passed 2026-10-20: his look (his word, DESK-TESTS.md A11)

His ask: stress test Metal, have an independent Fable reviewer score the Metal implementation
only (pictures, no code), and work until it gives 9/10. Run on his dev app (Max, Black & Yellow,
his library), the method of DESK-TESTS.md §6.6. The kept lists are `docs/ops/checks/metal-*.json`
([checks/README.md](../ops/checks/README.md) §2). Frames were read by time and cropped with two scratch scripts (a crop
sheet with frame-to-frame difference images, and a score: the share of a turn's change that
its largest frame carries; a pop is one frame with a large share).

**The break-it pass (three Sonnet agents, one per lens, 44 scenarios).** Triaged against the code;
fixed:
1. *The cover and its side covers guessed the turn's direction apart and could disagree* (a
   card rebuilt by a surface change, then Previous; a picture that arrived late): two layers in
   one slot. Now the queue decides (`now-playing-card.ts` passes `back` to `vinyl.show`: after
   Previous the song left waits first in Up Next), `vinyl.ts` keeps its fallback list per window
   (it was per card), and publishes the turn it ran on the box (`data-turn` fwd · back · none,
   `data-turn-song`, `data-turn-at`, the `vinyl:turn` event); `metal.ts` follows it. A run of
   Previous presses had also made the next Next turn back (found in the frames).
2. *The sides moved while the cover stood still* (two songs, one picture; a song with no
   picture): the turn reads `none` then.
3. *Both side covers sat empty for a whole album played in order*: a side now shows the nearest
   neighbor whose cover differs (the album before, the album after), up to 60 entries, no Apple
   call.
4. *The graphics fallback left Metal's 3D turn on*: `metalCoverChange` is a rule key, and the
   built-in *If graphics fail* rule sets it Off (`GRAPHICS_OFF`, its unit test). His dev app was
   on WARP during the run and the rule did exactly that; the app was restarted through
   `app_restart` to test on the card.
5. *A side picture that was slow or failed showed as a blank slab*: a side shows only a decoded
   picture; a failure is tried again on a later sync.
6. *The word fade*: its copy is `inert` (Tab landed in it), it cancels only its own animations
   (it cut the full player's row slide), and it copies the words only under Metal.
7. *Rapid Material or Grain changes*: the texture is drawn once a frame at most. *Show cover*
   Album ⇄ Playlist updates the sides at once.

**Performance (traced on the card).** A Metal skip kept the page thread ~71 % and the GPU process
~69 % busy for a second (Metal with Cover change Off: ~15 %). The cause: the album colors are
inherited custom properties with a 600 ms transition, so every frame of the turn restyled the
card and re-rastered its brushed plate. Under the zoetrope the colors now step once, as the next
cover comes forward (`--album-fade-delay` 0.3 s, a new base token at 0 s; `--album-fade-dur` 0
in Metal): ~20–24 % and ~16–20 %. The turn's z-index keyframes moved out of the animation too.
No long task over 50 ms per skip without the shot runner's screen recording.

**The motion, by its frames.** The turn traded depth in one frame while the two covers still
overlapped (45 % of the turn's change in one frame). The front cover always overlaps both side
slots, so one cover must pass in front of another somewhere. Tried and rejected: a shared 3D
scene (the planes cut through each other and the side covers in strips: the covers overlap too
much to sit on a real cylinder) and an opacity cross (one cover showed through the other). As
built: the old cover leaves at once and carries most of its travel in its first ~100 ms
(`--zoetrope-leave` 0.24, a new token, on a strong ease-out); the next waits under it in its slot
(`--zoetrope-stagger` 0.14), opaque (it covers its own slot exactly), starts to grow ~30 ms
before it comes in front (`--zoetrope-lead` 0.06, a new token, base 0) so the cut lands on a cover
already moving, and sets off fast with its overshoot (`--zoetrope-rise`, a new token, is 0 in
Metal: no fade; the base keeps its fade-in), so the peak speed sits
at the start and the turn settles by ~460 ms. A cover still leaving when the next press lands
finishes its own path at 4× speed (it faded before, and one cover showed through another). The slot it leaves takes its new neighbor under it when `vinyl.ts` says the cover is
opaque (`vinyl:covered`), sliding in solid from past the box's edge, so no slot stands empty; a cover pushed off a receiving slot keeps
turning around the drum behind the arriving cover; the receiving mark lasts until the landed
cover is gone. Side covers sit on the drum by `translateZ` in the cover's own box (the box needs
no crop now) and wear the cover's rim and shadow, so a landing hands back pixel for pixel. The
largest frames are now the old cover's departure and the cut (~20 % each); the app's own frame
counter shows the turn painting at ~200 fps on his 244 Hz display (a sheet's repeated frames are
the screen recording, late). A cold start (cache cleared) can still hold the arriving cover up to
300 ms for its picture (the noted slow-link case, §6.1); warm, there is no still moment.

**The look (the reviewer's points, in Metal's tokens).** Steel: a second, quieter layer of short
streaks (one layer read as scan lines). Acrylic: on overlay, the bristles only inside the dabs, a
gentle relief lit low (34°) so each stroke's edge shows, its contrast 0.55 around mid-grey so
small text sits clear on it (it had been nearly the same picture
as Steel, then too loud under small text). The floor at the fine grain's
pitch, a soft shadow under each card, the title bar the same brushed floor with a dark seam, the
Play button's gold with the grain (`--accent-sheen-blend`, `--accent-sheen-size`, new base
tokens), the icon squares with a dark bottom edge, the Settings split pills, the grow bar and the
EQ knob square, the thumbwheel's ridges lit and the wheel kept on its slot at both ends.

**The review loop.** One Fable reviewer, pictures only (ten stills, the turn read by time with
difference images, a slot enlarged, four rapid presses), told the owner's recorded calls so it
scored within them. Round 1: 6. Round 2: 7. Round 3: 8. Round 4: 8.5 (the landing flash and the
"round" badge and scrollbar it reported were checked at pixel level and withdrawn). **Round 5:
9/10** ("Plainly: it is a 9"; cold and warm turns alike, every interrupted press opaque, nothing
worse). What it sees between 9 and 10 is design, not a fault, and his: the cut is the brightest
frame (the zoetrope's own overlap strip; a narrower overlap or a ~60 ms lead would halve it);
Acrylic reads as a wider brush rather than paint (a wave in each dab would change that); the
refilled side slot shows a 6–8 px bare edge for one frame on a Next.

**Efficiency (2026-10-20, his ask).** A scripted scroll in the Settings card dropped ~23 % of its
frames at 244 Hz under Metal, 0 % under Vanilla, and 0 % with Metal's paint off; no one layer
alone was the cause. The textures are now baked once into PNG bitmaps at the screen's density
(`bake` in metal-material.ts since 2026-10-21, metal.ts before; the SVG stays the paint until the bitmap is ready or if the canvas refuses
it; a move to a screen of another density bakes again): ~6–10 % dropped, pixel-identical to the
SVG (a still compared at 0 difference). What is left is the blend modes (~5 points: with them
off for a test, ~2–3 %). Taking that out means baking each theme's colors into the bitmaps and
baking again on every theme change; not done.

**What Claude decided inside his calls (for his OK):** the sides show the nearest different
cover; the cover turn's new timing and the two-frame cut; the album colors stepping with the
turn under Metal; the graphics fallback turning the zoetrope off; the texture and shadow values
above.

**Noted, not fixed:**
- Core app (not Metal): the ~75 ms from a press to the first motion is the song change itself;
  the toggle rows' dot switch; the thumbwheel's 2 px from the mute button; the window buttons.
- The texture under software drawing stays on (only the 3D turn is in the fallback); measure
  on WARP before adding a texture-off value (a new choice is his call). **BUILT 2026-10-21 (his
  ask), no new choice:** in software drawing, with *If graphics fail* on its default (Save,
  the rule that turns heavy effects off), the material is not drawn and Metal's flat colors
  stay. `gateMaterial` (metal-material.ts), wired in main.ts from gpu.ts's new
  `softwareDrawing` / `onGraphicsChange` (not from metal.ts: that pulled gpu.ts into the web
  rooms port, `tests/web-commands.test.ts`). Not measured on WARP.
- **The blends, BUILT 2026-10-21 (his ask: "cache textures … since it's quite static"):** each
  surface's texture is baked against its own color into a tint (white or black at the alpha the
  overlay would lighten or darken by), laid on with no blend mode: the plate (`--metal`), the
  floor (`--metal-floor`), the controls (`--surface`), as `--metal-tex-panel` / `-floor` /
  `-control` under `[data-metal-baked]` (skin.css, after Acrylic). Baked again on a theme,
  material, grain or screen change, cached per color; the overlay stays until the bake is
  ready or if it fails. The Play button's gold keeps its overlay (the album's ink can change
  it per song). Read on his dev app: baked, every card's and control's blend `normal`. His look
  passed 2026-10-21 ("Tested and verified"). Not measured: the scroll's dropped frames.
- The tray panel shows Metal without the texture (only the main window draws it); the extension
  copy is untouched (`extension/scripts/pack.cjs --styles-only` would rewrite its hand-made
  Metal block). **The tray, BUILT 2026-10-21:** the material moved to its own module,
  `src/metal-material.ts` (`initMetalMaterial`: the textures, the bake, the redraw on a skin,
  Material or Grain change and a screen move); metal.ts starts it in the main window and tray.ts
  in the panel's window, without the side covers' queue code. His look passed. **The
  extension, closed 2026-10-21:** its copy had no hand-made Metal block any more (re-synced in
  `fd1016e`); it differed only by this evening's edits, and `pack.cjs --styles-only` brought
  all four sheets level with the app's.
- Show cover = Playlist or a station: both side slots stay empty on the 5:4 stage. **His call
  2026-10-21: blank plates. BUILT:** a slot with no neighbor to show (a playlist's own cover, a
  station's next song, the end of the queue) is a blank sleeve, the brushed control plate with
  no picture, dimmed and turned as a side cover (`data-blank`, metal.ts `paint`; styles.css). A
  picture still loading or failed stays hidden (`data-empty`), so no blank flashes before it.
  His look passed ("Tested and verified").
- **Sepia as brushed brass: his call, BUILT 2026-10-20.** Light parchment read as wood or kraft
  paper under the brush. One block, `[data-skin="metal"][data-theme="sepia"]` in themes.css (the
  pattern of Black & Yellow's gold): `color-scheme: dark` (every light-dark() value Metal reads
  takes its dark side), the plate and floor, cream text, sand subtext, brass-gold titles and
  accent fills, light borders and scrollbars; five new paints in palette.css (`--paint-brass*`).
  Sepia is unchanged in every other skin; no new theme. The grain lifts a plate ~1.5× on screen
  (its noise averages ~0.73 there), so the base paints are set darker to render near #66542E /
  #4E4024 (measured on the still: #64532E–#6F5E36 plate, #4A3C22 floor), then a step darker
  after the readability check (below).
- **The readability check on all six Metal looks (2026-10-20, before the commit).** The first run:
  187 failure groups, nearly all on the dark metals (Moonlight 56 and Black & Red 58 were already
  failing before this work; Brass 61): the grain lifts the plates and, more, the controls, so the
  themes' own secondary text and title ink fell under 4.5:1 there. Fixed in Metal's tokens, the
  plates unchanged: dark controls step up 3 % from the plate (was 7 %), the pressed tint 5 %
  (`--picked-strength`, was 14 %), the volume tint 20 % (was 30 %), a worded header action in the
  text's ink (`--action-text-ink`, a new hook; the glyph squares keep the title), and Metal text
  roles per theme where a theme's own fall short, its hue kept (themes.css: Black & Yellow's gold
  #E8C773, Moonlight's text and subtext, Black & Red's anodized red, Lilac's and Green's subtext;
  `--paint-*` in palette.css). Brass: plate #3A3019, gold #F2D488, cream #F7EED8, sand #E8DBB6.
  The last runs: 0 failure groups in all six looks (`shots/readability/0.30.0-metal-brass-6`
  and `-7`); toasts measured mid-fade (12–21 % opacity) in earlier runs were capture timing.
- Type: the reviewer's proposals are in F7 (§7).

### 6.8 The full player with the peek (2026-10-21, his call A)

> **Part:** built · 2026-10-21 · his look test on the dev app FAILED the same day (§6.8.1); to be fixed in an evening session

**The fault (0.31.0, on live).** In the full player the cover was a tall strip under the title
band and the transport, in all six themes. The stage's peek rule (`height: 80cqw; aspect-ratio:
5 / 4`) comes after the full player's square rule at the same weight and won; `80cqw` read the
wide middle card, not the square (the box was ~750 × 950 at 1800 × 900). Found while redoing the
site's screenshots (DeetsSolutions `docs/deetsmusic-page-pass.md`).

**His call (2026-10-21):** keep the peek in the full player; size the box from the square; the
title band and the controls match the cover's width. (C, no peek in the full player, was the
other option; B, the box inside the square, was dropped: a smaller cover and the band wider
than it on both sides.)

**As built.**
- The full player's grid square is the cover, as in every skin, so the band, the scrubber, the
  times and both control rows keep its width with no rule of their own. The 5:4 box is drawn
  around it: `width: 100% / --metal-peek-cover-w`, `height: 100% / --metal-peek-cover-h`,
  centered, so the inset lands the cover on the square (styles.css, after the peek rules).
- `--metal-peek-cover-w` (0.72) and `-h` (0.9) are the one source: `--metal-peek-cover-inset` is
  now derived from them (skin.css; both in the public layer's reset list).
- A new base token, `--fp-cover-share` (1): the most of the card's width the cover may take.
  Metal's peek in Max sets it to the cover share, so the side covers fit in the card. The full
  player's `--fp-side` reads it, and full-player.ts reads it for the stacked height
  (`stackNow`), the rows' place (`rowsPlace`, a new pure `coverSide`) and the History room check.
  Each read falls back to 1, so a look with Metal's material but not its tokens (a mod) lays out
  as every other skin.
- A look change at the same size (Peek on or off, Cover change, the skin) lays out again: a
  watch on `<html>` compares the share with the one the layout was measured with
  (`measuredShare`); during the open's motion or its cover preload it waits for the landing
  check (`resizedInMotion`).
- The large cover file is asked at the cover's width, not the box's (it was 1.39 × too large).

**Measured (demo, 2026-10-21).** Cover square and the band at its width at 1800 × 900 (673 px),
1100 × 950 (503), 900 × 1400 stacked (612; the player 775 px tall, Glass 1013), 2400 × 900 (673)
and 1000 × 720 (431, nothing overflows, the scrubber's top edge takes the click). Glass
unchanged at the same sizes. Lists: `docs/ops/checks/metal-full-player.json` and
`metal-full-player-motion.json` (open and close with a frame sampler, rapid open/close,
Next/Back inside the player, Metal → Glass → Metal and Peek off/on while open, a resize through
the stacked layout, Peek off mid-flight, the small window, the material-only look, reduced
motion): every `expect` holds.

**The break-it pass:** three Sonnet agents, 45 scenarios. Fixed from it: the share changed during
the open's wait or flight (all three lenses), a surface change racing the close (the size watch
already takes it), the cover file size, the material-only look. Not real: a minimum-size clash
(the full player's rule sets `min-width: 0`), a History flicker at the threshold (its room is
measured without the column).

**Timing and the motion monitor** (DESK-TESTS.md §6.6 steps 3–5, the demo in headless Edge, so
the counts compare runs and are not the real rate). The open's frames and gaps match Glass and
Metal 0.31.0 (the largest gap 105–129 ms at the open's measure in all three). The monitor's hits
in Metal are the same parts as Glass's (the flight, the 4 px row rise; the designed hits are
part 2a of `docs/ops/checks/README.md`).

**Noted, older than this change (his to decide):**
- After Next then Back to the first song, the previous side cover stays empty (the Max stage
  too, with the player closed; at the start it was filled). **Closed 2026-10-21: demo only.**
  It came from the demo's rapid case (`mfpm-next-back`, presses 250 ms apart, the demo's fake
  MusicKit). On his dev app he pressed Next, Back, Next, Back fast in Max: both side covers
  filled (his word), and a read of the slots agreed (both painted, none waiting). The queue's
  history (`previous()` pops what `advance()` pushed) and the slot code were read and hold.
- Metal's close has a long task of about 120 ms (Metal 0.31.0 too; Glass 58 ms). **Closed
  2026-10-21: demo only.** On his dev app (WebView2, Max, 1080 × 950) three closes gave one
  long task of 50 ms (the threshold) and then none; the profile is style and layout
  ("(program)" 38 %) with no Metal function in the top list. The 120 ms was headless Edge.
- **The Queue list's box at the close, read on his dev app (2026-10-21):** in both closes the
  list keeps its full height (717 px) while it rides down with the card's top edge (208 → 718),
  then takes its resting height (207 px) in the last frame (~272 ms). The top never jumps; the
  cut is at the bottom, past the card's clip. Visible only if the Queue's scrollbar thumb
  changes size in that frame: his eye decides. **His idea, BUILT the same evening:** "It could
  animate extending and shrinking?" `queueRise` (full-player.ts) animates the list's
  `max-height` from the visible card height at one end to the other, with the slide's timing,
  so the thumb grows on the open and shrinks on the close (every skin; the Queue motion is
  shared). Read on his dev app: 717 → 399 → 248 → 217 → 207 px down the close, the largest step
  71 px in the first frames (the ease), no jump at the end (510 px in one frame before). His
  look passed the same evening ("Looks good").
- The side covers are not in the open's flight (the flight copies the cover only), so they
  appear as it lands; the same before. **Built 2026-10-21:** `makeFlight`
  (full-player.ts) copies the side slots into the flying box with the cover, open and close,
  and `sizeDrum` (metal.ts, now exported) sets the copy's drum depth for the full size, since the
  real box's resize watch has not run yet. No break-it pass (his call: he verifies it himself).
  His check passed the same evening ("Works").
- The monitor's one Metal-only hit, the Queue list's box 42 → 17 px in one frame at the end of
  the close (landscape), is on the branch head without this change: the Queue slide and clip
  commits after 0.31.0 (`78fa67c`, `f472d85`, `2c1ef97`), not the peek.

**Open:** the same run on the dev app (WebView2 on the card) at his window sizes
(`smooth.mjs --dev`, then the motion list with `"source": "dev"`): the dev app was in another
driver's hands during this sitting. The fix ships with the next release; until then the site's
demo (0.31.0) still shows the strip, while its six Metal pictures show the fix.

#### 6.8.1 His report (2026-10-21, the dev app): "a little weird", "we regressed"

> **Part:** closed · 2026-10-21 · fixed the same evening by §6.8.2 and §6.8.3, his hand test passed

He looked at the fix on his dev app, Black & Yellow, Max full player, and compared it with the
live app (0.31.0) side by side. His words: "That looks a little weird and now I feel like we
regressed." What his screenshots show:

1. **Wedges above and below the cover (his red boxes).** Grey and blue triangles stick out past
   the cover's top and bottom edges, near the middle of the cover. They are the side covers'
   inner edges: turned toward the viewer on the drum, they come out taller than the cover. This
   is the same fault as the crop note in §6.7 ("a side cover's inner edge, turned toward you,
   grew past them … clearest in the full player"). That fix set the side covers deeper on the
   drum (`--metal-drum-back`) and took the crop away.
   **The likely cause (read, not measured):** the drum's perspective is a fixed
   `--zoetrope-perspective: 900px` (skin.css; `--metal-perspective` uses it). The depth was tuned
   on the stage's cover (about 400 px). The full player's cover is now 600–750 px, so the same
   900 px gives a much stronger perspective, and the inner edge comes out taller than the
   cover. The demo checks did not catch it: they measured the cover and the band, never the
   side covers' painted edges against the cover's top and bottom.
2. **Live looked better to him (the top of screenshot 2).** On live, at his window, the 0.31.0
   rule happened to give a near-5:4 box. The cover is smaller, the side covers show more, and
   the title band and controls run wider than the cover. With the fix, the cover is larger,
   the band and controls are at the cover's width, and the side covers are thinner slivers.
   His call A (§6.8) chose the band at the cover's width. Whether the bigger cover with thin
   side covers is the regression he means, or only the wedges, is **his to say**: ask him first
   in the evening session, with live and the fix side by side at his window size.
3. The Plays badge (`3.6K Plays · 1.2K Listeners`) sits over the band's lower right corner on
   both. It is not new; check it in the same pass.

**His answer (2026-10-21, later the same day), what the regression is:** "the previous / next
albums not being as visible + the UI being smaller within the bigger card leaving more empty
space perceptually." So it is not only the wedges. Two things: the side covers show too little,
and the band and controls at the cover's width leave the card looking empty around them. Both
come from his call A (the cover from the square, the band at its width), so the fix reopens
part of call A: bring him the fork with live and the fix side by side. The wedges (item 1) stay
a fault to fix in any option.

#### 6.8.2 The drum's perspective grows with the cover (2026-10-21)

> **Part:** built · 2026-10-21 · his hand test passed the same evening ("Perfect")

**The cause, measured.** On his dev app's stage (a 226 px cover), the side covers show 14–15 px
past the cover, and the transform's math gives 15. The same math with the fixed 900 px
perspective on the full player's 673 px cover gives 9 px past it (1.4 % of the cover, 6 % on
the stage), and the side covers' inner edges come out 2.4 % taller than the cover: the wedges.
A strong perspective on a large cover pushes the outer edges back (thin slivers) and brings
the inner edges forward (wedges). This was the first half of his "not as visible".

**The fix (one option, no fork):** the perspective is at least 2.25 × the cover's width
(900 / 400, the stage cover the drum was tuned on), so every cover larger than 400 px keeps the
400 px shape: no wedge, and the side covers past the cover by the same share. A cover of 400 px
or less is unchanged (his stage today: 900 px, the same boxes, read on the dev app). The crop
was dropped: it hides more of the side covers, the opposite of what he asked.
- `src/drum.ts` (pure): `drumPerspective(base, perCover, coverW)`, `drumBack(P, scale)`;
  `tests/drum.test.ts` holds the projection (no wedge at 400, 673 and 1000 px; the same peek;
  his stage's 15 px).
- `--zoetrope-perspective-per-cover: 2.25` (skin.css base; 0 = the fixed perspective).
- metal.ts sets `--metal-perspective` and `--metal-drum-back` on each cover box from the
  side slot's width (a ResizeObserver, after layout and before paint); vinyl.ts's turn and
  metal.ts's push-off use the same rule, so a cover still lands exactly on its slot.
- `metal-full-player.json` gained a `drum` probe on each size (`noWedge`, `peekAsStage`). Not
  run (his call: he hand tests).

**What Claude decided inside the fix:** the 400 px reference (the doc's "about 400 px", not
measured on his screen); the push-off depth (140 px at the tuned size) scales with the drum.

#### 6.8.3 The title block under the cover (2026-10-21, his ask)

> **Part:** built · 2026-10-21 · his hand test passed the same evening ("Perfect")

**The band width (his call, 2026-10-21, after the test):** "band width is good as tested". His
call A stands: the band and the controls keep the cover's width. The regression of §6.8.1 is
closed by §6.8.2 and §6.8.3.

**His words:** "move the album title and artist off the cover in metal and move below";
"specifically in metal".

**As built.** In Metal's full player (Midi and Max), the title, artist and album leave the band
on the cover for their own row under it; the scrubber, the times, the transport and the volume
follow under them. There is no band any more in Metal's full player.
- A base token, `--fp-meta-below` (0; Metal 1, skin.css). full-player.ts reads it
  (`metaBelow`), measures the title block with the controls (one row more in
  `--fp-controls-h`, so the cover gives up its height in the CSS's `--fp-side`), and keeps the
  rows below in every size: the pure `rowsPlace` takes `metaBelow` (a test). The card wears
  `data-np-meta-below` while the layout says so; the close takes it off.
- styles.css: the title block in grid row 2, no band (`::before` none), no band padding, and the
  card's own inks again (`inherit`, so album-color.ts's values on `.np` hold).
- The Plays badge sits in the title block's own column, so it is off the cover too (the §6.8.1
  item 3 overlap is gone in Metal).
- A look change while the player is open (Metal to another skin) lays out again, as the cover
  share does (the watch compares both); the move snaps, with no slide.

**His report and ask (later the same evening):** the title sometimes sat on the cover again
until a hard refresh, and "Can we have zoetrope on = album title artist below like we discussed
earlier?" Both BUILT:
- The cause: when the large cover was not in memory, the open turned the layout off while it
  loaded (`apply(false)`), which took `data-np-meta-below` off, and `apply(true)` did not put it
  back. `apply(true)` now sets it from the measure. It showed only when the picture was not
  cached, so it came and went.
- The rule follows Cover change: `--fp-meta-below: 1` sits on
  `[data-skin="metal"][data-metal-cover="zoetrope"]`, not on all of Metal. With Cover change on
  another value the title block is on the band, as in every skin. The open player's look watch
  now takes `data-metal-cover` too, so the row change applies at once.

**What Claude decided inside his ask:** Midi too (he said Metal, not Max); always below, even
where the controls fit on the band before (his "off the cover"); no band behind the text
under the cover (it was there only to read over a picture); the change snaps on a look change.

**For the evening session:** reproduce on the dev app at his window (Black & Yellow, Max, the
full player open). Measure the side covers' painted top and bottom against the cover's (a rAF
probe on `.metal-peek` boxes, or crops of the frames). The fix options to bring him: a
perspective that scales with the cover (from the box's size) in place of the fixed 900 px, or
the crop back (clip the box to the cover's top and bottom). Add a probe with an `expect` for
the wedges to `docs/ops/checks/metal-full-player.json`, so it cannot pass again unseen.

## 7. Forks (all his)

Closed 2026-10-19 (§1): Metal over every theme; the cleanup first; no new pieces (F1 and F5:
Metal is values and hooks only, over the app's existing UI).

- **F6, the material.** **Closed 2026-10-20 (his call): both, as the Material row; Steel is the
  default**, with Cover change on Zoetrope and Peek on (`settings-store.ts`).
- **F4, the hairline in Press and Cyber** (§4.1). **Closed 2026-10-20:** every built-in skin
  keeps 1 px solid; no skin uses the hairline hooks yet.
- **F7, the font** (his ask, 2026-10-20). **Closed 2026-10-20: B (below).** Today `--font-title` is
  Bahnschrift (Windows' own DIN) over Segoe UI Variable, nothing bundled (skin.css, Metal). An
  independent Fable design reviewer (`model: "fable"`, no build context) looks at Metal on the
  dev app in each theme and proposes better title (and body) faces, each with its license and
  bundle size. He picks; the font then goes in `fonts.css` like the other skins'.
  **The reviewer's answer (2026-10-20, §6.7, pictures only):** Bahnschrift is the right family
  for brushed metal (Windows' own, 0 bytes); use it better before bundling anything: SemiBold
  titles at `letter-spacing: -0.01em`, and its SemiCondensed width for the uppercase section
  labels at `0.08em` (no shared token reaches those labels yet). Keep Segoe UI Variable for body
  text (a bundled body face loses Windows' hinting at 11–13 px). If a bundled title face: Barlow
  (SemiBold + Semi Condensed; SIL OFL; ~22 KB a weight), Titillium Web (SemiBold; OFL; ~18 KB),
  Archivo (SemiBold, width axis; OFL; ~28 KB).
  **The font test (2026-10-20, his ask):** the five set on his dev app (the faces injected for
  the pictures only, `shots/scratch/metal-fonts.json`; measured sizes: Barlow ~22 KB a weight,
  Titillium Web ~12 KB, Archivo's variable file 90 KB), in Black & Yellow, Lilac and Sepia, judged
  by a fresh Fable reviewer (pictures only) for uniqueness, cohesiveness and elegance, out of 10
  each: **B — Bahnschrift titles, Bahnschrift SemiCondensed labels: 7 · 9 · 8 = 24**; C — Barlow,
  Barlow Semi Condensed labels: 7 · 8 · 8 = 23; A — Bahnschrift as built: 6 · 7 · 7 = 20; D —
  Titillium Web: 7 · 6 · 5 = 18 (renders light at 1×; its labels fall under the body's weight);
  E — Archivo: 5 · 6 · 7 = 18 (no voice of its own). B wins on Windows' hinting at 1× (the
  crispest), 0 KB, one family, and the stamped-plate read of condensed DIN caps. Its tuning:
  titles 600 at −0.005em; labels at width 87.5, weight 600 (650 on the light themes), tracked
  0.10em, +0.5–1 px; tabular figures for the counts beside them; titles stay mixed case. C wins
  only if he wants Metal warmer (best on Sepia), at ~44 KB. **His pick: B, applied 2026-10-20.**
  Five new skin hooks, off in every other skin (each rule keeps its own value as the fallback):
  `--font-caps`, `--fw-caps`, `--caps-tracking`, `--caps-grow`, `--caps-stretch` on the uppercase
  labels (`.lib-shelf`, `.search__sec-title` / `__label`, `.artist-info__h`, `.ctx-menu__label`,
  `.set__head`, `.set__sub-head`, the Settings page heads, `.compass__group`, `.qcard__label`),
  `--caps-figures` on the counts beside them, `--title-tracking` on `.panel__title` and
  `.np__title`. Metal: "Bahnschrift SemiCondensed" 600 (650 on Lilac and Green), 0.10em, +0.5 px,
  tabular figures; titles −0.005em.

## 8. Probes before a build

- Step 0 (§6.1) is the first probe.
- Time the grain: PNG tile against an SVG filter, on `dev:built`, in Midi and Max.
- Check `clip-path` on a card: the bevel, the drop edge, the grow motion, the drag lift.
- Count the feature tokens each primitive would take, to size Step 1 before it starts. For
  motion the list exists: TOKENS.md › Motion (added 2026-10-19 by the motion token pass) has
  every duration and curve token, 112 of them, with the files that read each. Group those by
  idea; the shape and shadow groups still need the same list.
