# Happy skin — drawing templates

The art for the Happy skin ([docs/features/happy.md](../../docs/features/happy.md) §5).

## How to use

- **Draw on `<name>.png`.** It is a blank, transparent strip at the true pixel size. Open it in
  Aseprite, Piskel or any pixel editor and zoom in.
- **Look at `<name>.guide.png`** beside it. It is the same strip at 10× with a pixel grid
  (a darker line every 8 px), the frame borders and numbers in orange, the floor line in green,
  and today's Happy or Deets drawn faintly for scale.
- **Keep the size.** The app reads each strip by its frame size. Ask before you change one.
- **Side poses face left**, as the walk does. The app mirrors them for the right.
- **Feet on the bottom row** of each frame, so the sprite stands on the floor line.
- Any colors. Keep the same file names, so a new drawing drops in.

## Drafts from DeetsLife

Some strips already hold a **first draft**, made by `make_drafts.py` from the DeetsLife art
(`../DeetsLife/game/assets/sprites/`, his permission, 2026-10-21). A draft has a `<name>.draft`
file beside it. Redraw the strip as you like, then delete the `.draft` file: from then on,
`make_drafts.py` never touches that strip. Two poses are borrowed as they are: `happy/sit_down`
(the rest pose, facing you) and `happy/idle_side`.

## The files

| File | Frame | Frames | State | For |
|---|---|---|---|---|
| `happy/sit_down` | 32×32 | 1 | DeetsLife, as is | resting next to Deets, facing you |
| `happy/idle_side` | 32×32 | 1 | DeetsLife, as is | standing, side-on |
| `happy/run_side` | 32×32 | 6 | blank (v1 uses the walk, faster) | the rope: running out from behind the cover |
| `happy/run_rope_side` | 32×32 | 6 | blank (or the app draws the rope from his mouth on `run_side`) | the rope: running with the rope in his mouth |
| `happy/push_head_side` | 32×32 | 4 | draft | the head push |
| `happy/stand_up_side` | 40×48 | 3 | blank, yours | the stand: getting up on his hind legs |
| `happy/stand_push_side` | 40×48 | 4 | blank, yours | the stand: pushing with his front legs |
| `happy/run_ball_side` | 32×32 | 4 | draft (the walk with the ball) | fetch: running back with the ball |
| `happy/drop_ball_side` | 32×32 | 3 | draft | fetch: dropping the ball at Deets' feet |
| `happy/keep_ball_down` | 32×32 | 2 | draft | fetch: keeping the ball, sitting, facing you ("Gundu...") |
| `deets/throw_side` | 32×64 | 4 | draft | fetch: wind-up, over the head, release, follow-through |
| `deets/watch_side` | 32×64 | 2 | draft (a one-pixel breath) | fetch: waiting for Happy |
| `scene/ball_small` | 4×4 | 1 | draft | the fetch ball: in flight, in a mouth, in a hand |
| `scene/sun` | 48×48 | 1 | blank | the sun's disc |
| `scene/sun_rays` | 80×80 | 1 | blank | the rays; the app turns and pulses them |
| `scene/moon` | 40×40 | 1 | blank | the moon |
| `scene/cloud_small` | 48×24 | 1 | blank | a small cloud |
| `scene/cloud_medium` | 72×32 | 1 | blank | a medium cloud |
| `scene/cloud_large` | 112×40 | 1 | blank | a large cloud |
| `scene/tennis_ball` | 12×12 | 8 | draft (drawn from a 3D seam) | the scrubber's ball: one roll, the seam turning |
| `scene/bubble` | 15×15 | 1 | blank | Deets' speech bubble: 5 px corners, the middle stretches |
| `scene/bubble_tail` | 7×6 | 1 | blank | the bubble's tail, pointing down |
| `scene/grass_tile` | 128×17 | 1 | **his placeholder** | cropped from `grass placeholder 1.png`; it repeats along the bottom (`grass_tile.preview.png` shows three in a row) |

`python art-template/happy/make_drafts.py . ../DeetsLife` makes the drafts again.

The sizes and frame counts are a first guess. Change them in `make_templates.py` and run it
again (`python art-template/happy/make_templates.py . "../grass placeholder 1.png"`).
It writes a blank strip only where none exists, so it never overwrites a drawing; to resize a
strip, delete its blank `.png` first.
