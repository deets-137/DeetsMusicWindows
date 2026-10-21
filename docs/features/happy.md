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
| First play after the window shows | 4–12 s | 20–40 s |
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
