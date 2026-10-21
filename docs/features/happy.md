---
status: idea
desk_test: none
sources: [src/styles/skin.css, src/styles/themes.css, src/look-ids.ts, src/walk.ts, src/assets/sprites/happy/]
updated: 2026-10-21
---
# Happy — the reference skin

> **An idea, opened 2026-10-21.** The owner narrates the skin piece by piece. Every fork is his.
> Nothing is built. Do not tell a user the app has this skin.

**Happy is the seventh skin, named for Happy, the puppy on deets.solutions and in the first-run
walk** (ONBOARDING.md §4). It is the most complete skin, and the **reference** for every skin
after it. Its rules (his words, 2026-10-21):

- It uses every part of the public layer (mods.md §10, §11): roles, primitives, hooks, slots.
- It is built on the public layer only, so a mod author can do everything Happy does.
- A future mod reads this doc to learn which tokens and details a skin can use.
- "We're going all the heck out on this one."

## 0. Terms

- **Public layer:** the tokens a mod may set: theme roles, primitives, hooks, slots (mods.md §10).
- **Slot:** a place where a skin gives a value or a file, and the app draws it (mods.md §11).
- **Happy:** the dog sprite, 32×32, brown with a light muzzle (`src/assets/sprites/happy/`:
  `idle_down`, `sit_side`, `walk_side` with 4 frames). Pixel art, drawn at 2× with
  `image-rendering: pixelated`.

## 1. His narration

> **Part:** idea · 2026-10-21

Each piece he gives is recorded here in order, in his words where they matter.

### 1.1 The cover change: Happy moves the album (2026-10-21)

When the album changes, Happy moves the old cover out and the new one comes in. Three ways,
picked at random:

1. **The head push.** Happy pushes the old cover out with his head while the new one fills in.
2. **The rope.** Happy comes out from behind the album and runs the way the cover goes, with a
   rope in his mouth, and drags the cover out.
3. **The stand.** Happy gets up on his hind legs and pushes the album out with his front legs,
   and the new one appears.

### 1.2 The canvas: grass, a sun or a moon, clouds, the sky (2026-10-21)

- Grass along the bottom of the window.
- A sun at the top right. It can sit a little over the top-right card and radiates light. At
  night, a moon.
- Clouds in the canvas. Some overlap the cards, tastefully.
- The sky is blue by day and dark at night. A setting gives a sunrise or sunset gradient. A
  further setting makes the sky follow the time of day.

### 1.3 The scrubber: a tennis ball (2026-10-21)

The playhead on the song's progress bar is a tennis ball.

### 1.4 The font: bubbly (2026-10-21)

He asked for a list of bubbly fonts to talk over (§2.4). **His pick (2026-10-21): Baloo 2 for
titles, Quicksand for body, Pixelify Sans for the skin's own words** (Deets' speech bubble, §1.5).

### 1.5 Fetch: Deets and Happy play at the bottom (2026-10-21)

- The Deets sprite plays with Happy at the bottom of the window, on the grass. Deets throws a
  pixel ball and Happy fetches it.
- Deets has a speech bubble in Pixelify Sans:
  - **"Good boy!"** when Happy brings the ball back.
  - **"Gundu..."** when Happy comes back without the ball, or does not give it back.

### 1.6 The grass (2026-10-21)

His placeholder, `Documents/grass placeholder 1.png` (128×72, the grass in the bottom 17 rows:
moss-green tufts over dark soil). Cropped to a 128×17 tile for v1
(`art-template/happy/scene/grass_tile.png`). Three tiles in a row show no clear seam.

### 1.7 His calls on the first forks (2026-10-21)

- **H1 a:** Happy scales in whole steps to about a third of the cover's height.
- **H2 a:** pixel-art grass, sun, moon, clouds and ball over a smooth sky gradient.
- **H3 b:** the scenery overlaps the card edges, and a card opacity row lets the sky show
  through, as Ocean's does. "I can hand draw if you make a template first": the templates are §5.
- **H4:** Baloo 2, Quicksand, Pixelify Sans (§1.4).

### 1.8 His calls on fetch, and the rest pose (2026-10-21)

- **H5 b:** fetch walks over the bottom cards' lower edge, as the first-run walk does.
- **H6 a:** a round now and then, at random. "Try to match the timing of DeetsSolutions but with
  more breathing room, maybe one animation every 30 s."
- **H7 a:** one Happy. He leaves fetch, does the push at the cover, and comes back, "done
  elegantly and seamlessly".
- **The rest pose:** "When Happy's not up to anything, he can sit facing the camera next to
  Deets." DeetsLife has this pose (`happy/sit_down`, tongue out).
- **The art:** "Pull DeetsLife from GitHub, there should be more drawings for you to borrow
  from. You have permission to non-destructively copy and modify them with care and
  precision." DeetsLife was up to date with GitHub (4e67600). §5.1 lists what was borrowed.

### 1.9 v1, and what comes after (2026-10-21)

- **F5 b** (mods.md §8): every skin is held to the public layer, the built-in six too.
- **The first round of fetch comes 10 s after the window shows**; the 25–40 s between rounds
  stands. The other drafts in §2.1a and §2.3 (the Sky row, the odds, the bottom-left corner)
  stand as written.
- **v1 is §1.1 to §1.8.** "Once we have an MVP built, I plan to work on card corners / edges,
  motions, and the title bar piece." Those are v2.

**The build order:** (1) every skin onto the public layer, pixel for pixel (mods.md §10.1);
(2) the slots Happy uses and the `happy` skin id; (3) the canvas; (4) the tennis-ball
scrubber; (5) the cover pushes; (6) fetch. Step 1 is proved by pictures before step 2 starts.

## 2. The public layer Happy needs

> **Part:** idea · 2026-10-21

For each piece in §1: the role, primitive, hook or slot it uses, and whether it exists today
(mods.md §9 is the baseline). A piece that needs a new public token adds it here first.

| Piece | Public token or slot | Exists today? |
|---|---|---|
| The three cover pushes | `--cover-swap` picks a named cover change (vinyl.ts runs it). New values: `happy-head`, `happy-rope`, `happy-stand`, and `random`, which picks one of a list | The token yes (Metal's `zoetrope`); the values no |
| Happy's frames for the pushes | A **sprite slot**: a strip per pose, its frame count and speed. A mod gives its own strips, so any mod can have a mascot | No |
| The rope | Drawn by the app from Happy's mouth to the cover's edge, in a theme ink | No |
| The sky | New theme roles for the sky stops (day, sunrise, sunset, night), so a theme mod recolors the sky | No |
| The sky follows the time | The sunrise equation in `look-schedule.ts` (used by the look schedule and the sleep timer's Sunset) | Yes |
| The sun, the moon | **Ornament anchors** (mods.md §11) with an image; the rays are a motion preset (`radiate`) | No |
| The clouds | Ornament anchors at card edges, and a `drift` motion preset on the canvas | No |
| The grass | An image slot on the window's bottom edge (a repeating strip) | No (`--app-canvas-color` takes a fill, not an edge strip) |
| The tennis ball | A **playhead slot** on the Fancy scrubber (an image, and a roll: it turns as it moves, like Metal's `--metal-wheel-roll`) | The Fancy scrubber yes, per skin in styles.css; the slot no |
| The font | `--font-title` Baloo 2, `--font-body` Quicksand, a new `--font-skin` Pixelify Sans; bundled WOFF2 in `fonts.css` | The tokens yes, `--font-skin` no |
| The card opacity row | A skin slider like `oceanCardOpacity` (`skin-settings.ts`); in the public layer as one `--card-opacity` primitive, so any mod gets the row | Ocean's own yes; the primitive no |
| Fetch: Deets, Happy, the ball | The sprite slot (as the pushes), a **scene** of named actors on the floor line, run by the app | No |
| Deets' speech bubble | A 9-slice image slot, the words from the skin's own strings in `--font-skin` | No |

### 2.1 What follows from his words (no fork)

- **Random, but never the same push twice in a row.** A random pick that repeats reads as broken.
- **Direction:** the cover leaves the way the song moves: Next goes left, Previous goes right,
  as Metal's turn does.
- **Where:** the same places as Metal's cover change (vinyl.ts's plain cover: Now Playing, the
  Mini player, the full player). A cover too small for Happy to read uses the plain change.
- **Reduced motion:** a plain cross-fade with no sprite, through `motionReduced()`.
- **The clouds and the sun never cross text or controls.** They overlap card edges and corners
  only. A cloud over a song title fails the user first rule.
- **The new frames are his to draw**, as with the car and the hourglass. §5 has the templates.
- **One ball.** The fetch ball is the scrubber's tennis ball, drawn once (`scene/tennis_ball`).
- **Quicksand at weight 500 or more** in the body: it is thin at 400 at small sizes (§2.4).
- **The card opacity row starts at 80**, Ocean's default (his call for Ocean, 2026-10-11).
- **Reduce motion and the graphics fallback stop fetch** and leave Deets and Happy standing.

### 2.1a Fetch, as it follows from H5 b, H6 a, H7 a (a draft for him to edit)

**At rest.** Deets stands facing you (`deets/idle_down`) in the window's bottom-left corner.
Happy sits beside him, on the side Deets throws to, facing you (`happy/sit_down`).

- **They never take a click.** The pointer goes through them to the row underneath.
- **The card under them gets end padding** the height of the pair, so its last row can always
  scroll clear of them. Nothing is lost under them for good.

**The timing** (the site's `walkers.js`, with more room):

| | The site | Happy (draft) |
|---|---|---|
| First play after the window shows | 4–12 s | 10 s (his call, 2026-10-21) |
| Between plays | 12–30 s | 25–40 s, about one every 30 s |
| The sprite cycle | 7 fps, `steps(4)` | the same (it belongs to the art) |
| Walk speed | 70 px/s | 70 px/s; Happy's run 140 px/s, the walk frames at 10 fps |
| A hidden window | skips its turn | skips its turn |

**A round** (6–8 s):

1. Deets throws (`deets/throw_side`). The ball (`scene/ball_small`) flies to the right in an
   arc and lands at a random place along the bottom.
2. Happy runs to it, picks it up, and runs back with it (`happy/run_ball_side`).
3. The end, by chance (the odds are a draft):
   - **70 %:** he drops it at Deets' feet (`happy/drop_ball_side`). Deets: **"Good boy!"**
   - **15 %:** he comes back without it. It stays where it landed. Deets: **"Gundu..."** The next
     round starts with Happy fetching it.
   - **15 %:** he sits facing you with the ball and keeps it (`happy/keep_ball_down`). Deets:
     **"Gundu..."** He drops it before the next round.
4. Happy sits again. The bubble shows for about 1.6 s, in Pixelify Sans (`--font-skin`).

**One Happy at a cover change (H7 a):**

1. A cover change arrives, at rest or in a round. If he carries the ball, he drops it where he
   stands.
2. He dashes off the nearer window edge at a run (about 0.25 s).
3. The push starts at the cover as he leaves. Each push starts with Happy coming from behind or
   beside the cover, so two Happys never show at once. The cover starts to move within
   0.3 s (Metal's color delay, `--album-fade-delay`, is the precedent). The music never waits.
4. After the push he sits by the cover for about 1.5 s. **Another change in that time:** he
   stays and does the next push from there. Fast Next presses never send him back and forth.
5. He goes behind the cover, runs back in from the window edge, and sits beside Deets. A ball
   left out is fetched in the next round. Deets waits through all of it (`deets/watch_side`).

### 2.2 The new frames

The list and sizes are in §5 and `art-template/happy/README.md`.

### 2.3 The Sky row (a draft for him to edit)

Settings › Skin settings › **Sky**: *Follow the time* · Day · Sunrise · Sunset · Night.
*Follow the time* moves through all four from the sun's times where you are, and shows the moon
at night.

### 2.4 Bubbly fonts (the list he asked for)

All free to bundle (SIL OFL, Chewy Apache 2.0); the license of each is checked before a build.

**Titles (bubbly):**
- **Fredoka** — round, soft, very bubbly at 600–700. Variable, 300–700. Reads well at medium size.
- **Baloo 2** — chunky and friendly. Variable, 400–800. Has Devanagari.
- **Grandstander** — a picture-book feel. Variable, 100–900.
- **Sniglet** — round and plump. 400 and 800.
- **Lilita One** — heavy and bold. One weight; titles only.
- **Chewy** — cartoon. One weight; titles only.
- **Coiny** — very round, almost inflated. One weight; titles only.
- **Modak** — fully inflated. One weight; large titles only.

**Body (round ends, readable small):**
- **Nunito** — round ends, clear at 11–12 px. Variable, 200–1000.
- **Varela Round** — clean and calm. One weight.
- **M PLUS Rounded 1c** — round, 7 weights, with Japanese (a large file).
- **Quicksand** — round and geometric; thin at small sizes.

**Pixel (to match the Happy sprite):**
- **Pixelify Sans** — a readable pixel face. Variable, 400–700.
- **Silkscreen** — small pixel capitals, for labels.

A song title in a script the font lacks falls back to the system font.

## 3. Forks (all his)

H1 to H4 are closed (§1.7); H5 to H7 (§1.8).

- **H8, the size of the pair on the grass. Closed 2026-10-21: a (his call).** 2× in Max (Deets
  128 px tall, Happy 64 px, as the site and the first-run walk), 1.5× in Midi and Mini. The
  scale is whole device pixels, so the pixels stay sharp at 125 % and 150 % Windows scaling.

## 4. Probes before a build

- Rapid Next presses: a push in progress must not queue up behind the next one (DESK-TESTS.md
  §6.6).
- The license of each bundled font, and its file size.
- The sky stops against each theme's text contrast where a card is translucent (H3 b).
- Fetch's draw cost on `dev:built`, and on WARP (DEBUGGING.md § graphics).

## 5. The drawing templates

> **Part:** built · 2026-10-21

His ask: "I can hand draw if you make a template first." In `art-template/happy/`
(`README.md` there is the full table):

- For each piece, `<name>.png` is a blank, transparent strip at true size to draw on, and
  `<name>.guide.png` is the same at 10×: a pixel grid, the frame borders and numbers, the floor
  line, and today's Happy or Deets drawn faintly for scale.
- Happy: `run_side`, `run_rope_side`, `push_head_side` (32×32); `stand_up_side`,
  `stand_push_side` (40×48, for the height when he stands); `run_ball_side`, `drop_ball_side`,
  `keep_ball_side` (32×32).
- Deets: `throw_side`, `watch_side` (32×64).
- The scene: `sun` 48×48, `sun_rays` 80×80, `moon` 40×40, three clouds (48×24, 72×32,
  112×40), `tennis_ball` 12×12 × 8 frames of one roll, the speech `bubble` (a 9-slice, 5 px
  corners) and its tail, and his `grass_tile` (128×17).
- The sizes and frame counts are a first guess for him to change. `make_templates.py` makes
  them again and never overwrites a drawing.

### 5.1 Drafts from DeetsLife (2026-10-21)

> **Part:** built · 2026-10-21

`make_drafts.py` reads `../DeetsLife/game/assets/sprites/` (read only) and writes first drafts
into `art-template/happy/`. Each draft has a `.draft` file beside it; when he redraws a strip
and deletes that file, the script never touches the strip again.

- **Borrowed as they are:** `happy/sit_down` (the rest pose) and `happy/idle_side`. DeetsLife
  also has `idle_up`, `sit_up`, `walk_down`, `walk_up` for Happy and Deets, and a third dog,
  Lucky; none is needed yet.
- **Drafts:** `happy/push_head_side` (the head drops 5 px and the body leans in),
  `happy/run_ball_side` (the walk with the ball, the tongue taken out), `happy/drop_ball_side`,
  `happy/keep_ball_down` (sitting, the ball in his mouth), `deets/throw_side` (the arm redrawn in
  four places in the sweater's arm color), `deets/watch_side` (a one-pixel breath),
  `scene/ball_small` (4×4) and `scene/tennis_ball` (12×12, 8 frames, drawn from a 3D seam).
- **His to draw:** `stand_up_side`, `stand_push_side` (a new pose, not a change to one),
  `run_side` (v1 can use the walk, faster), the sun, moon, clouds and the bubble.
- The DeetsMusic copies of `walk_side`, `sit_side` and `idle_down` match DeetsLife's byte for
  byte.
- **Placeholders (2026-10-21):** `make_drafts.py` also draws a sun, rays, a moon, three clouds
  and the speech bubble as `.draft` placeholders, so v1 shows them until he draws his own.

## 6. The build, where it stands (2026-10-21, paused at his word)

> **Part:** built, not run · 2026-10-21 · on `happy-thirtytwo`

He paused the session here ("commit and push where you are"). Everything below typechecks,
`npm test` (377) and `docs:check` pass. **Nothing has run in the app yet**: the demo check could
not load while a game held the CPU, and the dev app was not started.

**Step 1, every skin on the public layer (mods.md §10.1): built.**
- The hooks: `--hook-scrub | material | sea | record | wallpaper | scene` in skin.css; skin.ts
  copies each onto `<html>` as `data-hook-*` (`hook()` reads one). The 40 rules in styles.css and
  the 6 in themes.css that named a skin now select on a hook (same specificity); metal.ts,
  ocean.ts, vinyl.ts and wallpaper.ts read hooks; the tray paints them through `paintSkin`.
- The 41 names a skin set that the base lacked are declared in the base as `initial` (the
  same as unset). `scripts/skin-resolve.mjs` proves no token value changed in any of the 25
  skin contexts against HEAD.
- docs:check 33 (*public layer*): a skin block sets only base names or theme roles; HOOKS
  matches the base; no other sheet or script names a skin (Settings rows excepted); a raw base
  value of a kind a mod sets reads a token, or is listed in `scripts/skin-raw-base.txt`.
- The runtime proof is `docs/ops/checks/public-layer.json` (each skin's hooks and one hooked
  style): **not run yet.**

**Step 2 onward, the Happy skin: built, not run.**
- `happy` in `SkinName`, the title menu (hint drafted: *Happy the puppy on the grass under a
  sky. He moves the covers for you*), the look schedule, the font warm-up. Fonts bundled:
  Baloo 2, Quicksand, Pixelify Sans (variable, latin + latin-ext, OFL; NOTICE.txt).
- skin.css: the public scene and sprite tokens (`--scene-*`, `--pet-*`, `--friend-*`,
  `--bubble*`, `--scrub-ball*`, `--card-opacity`, `--font-skin`, `--vinyl-swap-delay`,
  `--vinyl-swap-in-travel`), then the Happy block. palette.css / themes.css: the sky roles
  (`--sky-day … --sky-night-low`, one natural sky in every theme) and `--bubble-ink`.
- styles.css "Scene": the two layers, the sky, the sun and rays, the clouds, the grass, the
  sprites, the bubble, the rope, the ball playhead; `.app-body` gains `--scene-floor` below.
- `src/sky-phase.ts` (pure, `tests/sky-phase.test.ts`), `src/scene.ts` (placing, the sky),
  `src/pet.ts` (rest, fetch, the three pushes, the handover). `npm run happy:art` copies the
  drawings into `src/assets/skins/happy/`.
- Settings › Skin settings: *Sky* (`happySky`) and *Card opacity* (`happyCardOpacity`, 80):
  store, agent specs, AGENT.md, SETTINGS.md, New marks; `happySky` is NOT_REPORTED for now, as
  Metal's rows; his call is to send both (USAGE-COUNTS.md §1 item 11, with the worker deploy). vinyl.ts: the plain slide takes the delay and the in-place fill;
  slider.ts publishes `--slider-frac`.

**Next session:**
1. Start the dev app, switch to Happy, read the `scene:*` / `pet:*` diag lines, fix what breaks.
2. Run `public-layer.json` (and the six skins by eye) with the CPU free.
3. The extension's options page and style copies; DeetsSolutions' skin list (another repo).
4. The full desk test with the break-it pass (DESK-TESTS.md §6.6), then hand over.

**For him to look at first** (decided inside his calls, all tunable tokens): the edge clouds
reach a little over the cards (`--scene-cloud-over` 0.12). The sky colors (one natural sky, or
tinted per theme) are open.

**First look on the web demo (2026-10-21, his report and his calls):**
- Fixed: Deets drew at 64 art px wide (his frames are 32 × 64; `--friend-*-w` now says so), so he
  looked stretched and the throw and watch strips showed two of him; a pose played once stopped
  one frame past its last and vanished (`scene-frames-once`); the bubble's pop-in replaced its
  centering (`translate`), and at rest by the window's edge it lost its left half (pet.ts keeps it
  inside the window, `--tail-x` points the tail at his head). Then his call: no tail, just the
  bubble (Happy sets no `--bubble-tail`; a mod still can).
- Clouds (his ask: more, and less regular): scene.ts makes them. `--scene-far-clouds` 9 at
  scattered heights in the top 60 %, each its own size (40 % small, 35 % medium, 25 % large),
  speed (the small ones slower and paler) and start; `--scene-edge-clouds` 4, taking turns between
  the left and right columns' outer edges, two on a card in its upper and lower halves. One
  seeded draw a session, so a resize keeps them.
- The sky behind the title bar (his call): the body and the scene layers reach up over the title
  bar (`overflow: clip` + `overflow-clip-margin`), the sky starts at the window's top, the title
  bar sits over it with no fill (a first dark shade, `--scene-titlebar-scrim`, was replaced: see
  the readability check below). The sun sits in the window's top-right corner (`--scene-sun-inset` 2 art px), its lower
  part over the top-right card's corner (his call: it may cover that corner).
- The sun makes way (his ask): a pointer within 1.3 × its radius sends it up behind the window's
  top when the pointer comes from below (the card's ⟳), or out past the right edge when it comes
  from the title bar; a third of its radius stays in sight. It comes home past 1.9 × the radius,
  or when the pointer leaves the window (`--scene-sun-away-dur`, `--scene-sun-back-dur`).
  `scene:sun-away` / `scene:sun-home` in the diag ring. The sun had never drawn: a `background`
  shorthand on `.scene__sun i` reset its picture (now longhands).
- Happy at the cover, smoother (his ask: "when he's mid run, mid stride"), pet.ts `onTurn`:
  - Back pushed the wrong way: pet.ts set `--vinyl-x: 1` for Back and vinyl.ts flips Back too, so
    the cover went left while he pushed right. `--vinyl-x` is now always -1 (Next: left; Back: right).
  - The slide's shape is set before any await (a first strip load came after vinyl.ts read it).
  - He moves with the cover, frame by frame (the leaving cover's own transform), not on his own
    clock: vinyl.ts starts the slide when the new cover decodes, up to 300 ms later.
  - He never fades in standing still. Head and stand: he runs in past the card's edge on the
    cover's trailing side (the layer clips to the card). Rope: he runs out from behind the cover
    (the cover's box hides him, his narration §1.1), stands with the rope taut until the cover
    moves, then runs with it. A fast press: he runs from where he is, facing where he goes.
  - Every run's stride keeps pace with its speed (`strideFps`), so his feet never slide.
  - The rope's pull takes him past the card's edge: from there he goes straight back to the
    grass (the old 0.42 s walk back over ~350 px is gone). After a sit he runs off past the
    nearer card edge instead of fading.
  - Leaving the grass mid-run he keeps his direction (no turn on the spot); the dash eases in.
  - The stand gets a longer lead (`STAND_LEAD_MS` 450, the rise at 12 fps) and a press from the
    grass adds `DASH_MS` to the lead, so the grass Happy is gone before he shows by the cover.
  His test on the web demo: smooth, but his art looked softened. Cause: his layer (`.pet-push`)
  sits in the card, outside `.scene`, so the scene's `image-rendering: pixelated` never reached
  him. Now `.pet-push .scene__actor` has it too.
- Never cut by the card (his call, 2026-10-21: "he shouldn't fully detach from the card but
  when he's sitting down, he can sit over the border"). The card crop is gone. In Max the cover
  nearly fills the card (about 20 px of card beside it), so a crop switched on or off while he
  overlapped an edge popped part of him. Now:
  - He comes out from behind the cover: only the cover's box hides him then, and that clip is
    set or cleared only while no part of him is over the cover. Head and stand: out past the
    trailing edge, a turn, then the head press (0.1 s) or the rise. Rope: he waits behind the
    cover (no lead now) and runs out with it, the rope showing once his back clears the edge;
    he stops with part of him still on the card (`ropeEnd`) and sits there over the border.
  - He leaves by running a short way (0.8 of his width) toward the nearer card edge as he fades.
  - His card rides over its neighbors while he is out (`.panel:has(> .pet-push)`).
  His test: looks great.
- The title bar's readability on the sky (his ask: keep the colors, raise readability). Read on
  the web demo from the theme roles, title / icons, contrast with the old shade:

  | Theme | Day | Dawn | Dusk | Night | On its card |
  |---|---|---|---|---|---|
  | Lilac | 3.4 / 2.0 | 3.6 / 2.1 | 1.4 / 1.2 | 1.4 / 2.4 | 9.8 / 5.6 |
  | Green | 3.2 / 1.9 | 3.4 / 2.0 | 1.3 / 1.3 | 1.5 / 2.5 | 10.4 / 6.0 |
  | Sepia | 3.4 / 1.8 | 3.7 / 1.9 | 1.4 / 1.3 | 1.4 / 2.6 | 11.6 / 6.1 |
  | Moonlight | 3.2 / 1.9 | 3.0 / 1.8 | 7.8 / 4.5 | 15.1 / 8.8 | 13.0 / 7.5 |
  | Black & Yellow | 2.7 / 2.3 | 2.5 / 2.2 | 6.5 / 5.6 | 12.7 / 10.8 | 13.4 / 11.5 |
  | Black & Red | ~1.2 / 1.7 | ~1.1 / 1.8 | ~2.9 / 1.5 | 5.5 / 2.8 | high |

  The light themes' dark ink failed on dusk and night, the dark themes' light ink on day, the
  icons nearly everywhere; the shade hurt the light themes. The fix keeps every ink color and the
  clear sky: each word and icon on the sky gets a crisp one-pixel edge in its theme's card color
  (`--canvas`) and a soft one past it (`--scene-titlebar-halo`, a filter), the color the ink was
  made for. The volume pill and the window buttons keep their own fill. Checked by eye in the
  demo on each theme's hardest sky (Lilac night, Sepia dusk, Moonlight day, Black & Red day):
  all read.
