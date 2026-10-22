"""Make the Happy skin's drawing templates (docs/features/happy.md §5).

For each piece: <name>.png, a blank strip at true size to draw on, and <name>.guide.png,
the same strip at 10x with a pixel grid, the cell borders, a floor line and a faint
reference sprite for scale. Run: python make_templates.py <repo>
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

REPO = Path(sys.argv[1])
SPR = REPO / "src/assets/sprites"
OUT = REPO / "art-template/happy"
OUT.mkdir(parents=True, exist_ok=True)
Z = 10  # guide zoom

try:
    FONT = ImageFont.truetype("segoeui.ttf", 14)
    FONT_B = ImageFont.truetype("segoeuib.ttf", 16)
except OSError:
    FONT = FONT_B = ImageFont.load_default()

happy_ref = Image.open(SPR / "happy/walk_side.png").crop((0, 0, 32, 32))
deets_ref = Image.open(SPR / "deets/walk_side.png").crop((0, 0, 32, 64))

# name, frame w, frame h, frames, reference sprite (or None), facing note, what it is for
PIECES = [
    # Happy, the cover pushes (§1.1)
    ("happy/run_side", 32, 32, 6, happy_ref, "faces left", "running: to the cover and back to the grass"),
    ("happy/push_head_side", 32, 32, 4, happy_ref, "faces left", "the head push"),
    ("happy/stand_up_side", 40, 48, 3, happy_ref, "faces left", "the stand: getting up on his hind legs"),
    ("happy/stand_push_side", 40, 48, 4, happy_ref, "faces left", "the stand: pushing with his front legs"),
    # Happy, fetch (§1.5)
    ("happy/run_ball_side", 32, 32, 6, happy_ref, "faces left", "fetch: running back with the ball in his mouth"),
    ("happy/drop_ball_side", 32, 32, 3, happy_ref, "faces left", "fetch: dropping the ball at Deets' feet"),
    ("happy/keep_ball_down", 32, 32, 2, happy_ref, "faces you", "fetch: keeping the ball, sitting, facing you"),
    # Deets, fetch (§1.5)
    ("deets/throw_side", 32, 64, 4, deets_ref, "faces left", "fetch: wind-up, throw, follow-through"),
    ("deets/watch_side", 32, 64, 2, deets_ref, "faces left", "fetch: waiting for Happy (a small idle bob)"),
    # The scenery (§1.2)
    ("scene/sun", 48, 48, 1, None, "", "the sun's disc"),
    ("scene/sun_rays", 80, 80, 1, None, "", "the rays; the app turns and pulses them (radiate)"),
    ("scene/moon", 40, 40, 1, None, "", "the moon"),
    ("scene/cloud_small", 48, 24, 1, None, "", "a small cloud"),
    ("scene/cloud_medium", 72, 32, 1, None, "", "a medium cloud"),
    ("scene/cloud_large", 112, 40, 1, None, "", "a large cloud"),
    # The ball: the scrubber's playhead and the fetch ball (§1.3)
    ("scene/tennis_ball", 12, 12, 8, None, "", "the tennis ball; 8 frames of one roll (the seam turning)"),
    ("scene/ball_small", 4, 4, 1, None, "", "the fetch ball: in flight, in a mouth, in a hand"),
    # Deets' speech bubble (§1.5): a 9-slice, the app stretches the middle to fit the words
    ("scene/bubble", 15, 15, 1, None, "", "the speech bubble: 5 px corners, the middle stretches"),
    ("scene/bubble_tail", 7, 6, 1, None, "", "the bubble's tail, pointing down to Deets"),
]


def guide(name, fw, fh, n, ref, facing, note):
    pad_top, pad_side = 56, 20
    W, H = fw * n * Z, fh * Z
    img = Image.new("RGBA", (W + 2 * pad_side, H + pad_top + 40), (250, 248, 243, 255))
    d = ImageDraw.Draw(img)
    ox, oy = pad_side, pad_top
    d.text((ox, 10), f"{name}  ·  {n} frame{'s' if n > 1 else ''} of {fw}×{fh}  ·  {facing}".rstrip(" ·"), fill=(40, 36, 30), font=FONT_B)
    d.text((ox, 32), note, fill=(110, 101, 90), font=FONT)
    # checker so transparent reads as transparent
    for y in range(fh):
        for x in range(fw * n):
            c = (255, 255, 255, 255) if (x + y) % 2 == 0 else (240, 240, 240, 255)
            d.rectangle([ox + x * Z, oy + y * Z, ox + (x + 1) * Z - 1, oy + (y + 1) * Z - 1], fill=c)
    # faint reference sprite in each cell, feet on the floor line
    if ref is not None:
        r = ref.resize((ref.width * Z, ref.height * Z), Image.NEAREST)
        a = r.getchannel("A").point(lambda v: int(v * 0.22))
        r.putalpha(a)
        for i in range(n):
            img.alpha_composite(r, (ox + i * fw * Z + (fw * Z - r.width) // 2, oy + H - r.height))
    # pixel grid
    for x in range(fw * n + 1):
        d.line([ox + x * Z, oy, ox + x * Z, oy + H], fill=(205, 200, 190), width=1)
    for y in range(fh + 1):
        d.line([ox, oy + y * Z, ox + W, oy + y * Z], fill=(205, 200, 190), width=1)
    # every 8 px a darker line, to count
    for x in range(0, fw * n + 1, 8):
        d.line([ox + x * Z, oy, ox + x * Z, oy + H], fill=(170, 164, 152), width=1)
    for y in range(0, fh + 1, 8):
        d.line([ox, oy + y * Z, ox + W, oy + y * Z], fill=(170, 164, 152), width=1)
    # cell borders and frame numbers
    for i in range(n + 1):
        d.line([ox + i * fw * Z, oy - 4, ox + i * fw * Z, oy + H + 4], fill=(233, 144, 43), width=3)
    if n > 1:
        for i in range(n):
            d.text((ox + i * fw * Z + 4, oy + H + 8), str(i + 1), fill=(233, 144, 43), font=FONT_B)
    # floor line for sprites
    if ref is not None:
        d.line([ox, oy + H - 1, ox + W, oy + H - 1], fill=(107, 176, 74), width=3)
    return img


for name, fw, fh, n, ref, facing, note in PIECES:
    p = OUT / f"{name}.png"
    p.parent.mkdir(parents=True, exist_ok=True)
    if not p.exists():  # never overwrite a drawing
        Image.new("RGBA", (fw * n, fh), (0, 0, 0, 0)).save(p)
    guide(name, fw, fh, n, ref, facing, note).save(OUT / f"{name}.guide.png")

# The grass: his placeholder, cropped to the strip, kept as the v1 tile.
src = Path(sys.argv[2]) if len(sys.argv) > 2 else None
if src and src.exists():
    g = Image.open(src).convert("RGBA")
    rows = [y for y in range(g.height) if any(g.getpixel((x, y))[3] for x in range(g.width))]
    tile = g.crop((0, rows[0], g.width, g.height))
    (OUT / "scene").mkdir(exist_ok=True)
    tile.save(OUT / "scene/grass_tile.png")
    # a preview: three tiles side by side at 4x, to see the seam
    prev = Image.new("RGBA", (tile.width * 3, tile.height), (207, 232, 247, 255))
    for i in range(3):
        prev.alpha_composite(tile, (i * tile.width, 0))
    prev.resize((prev.width * 4, prev.height * 4), Image.NEAREST).save(OUT / "scene/grass_tile.preview.png")
    print("grass", tile.size)

print("done", len(PIECES))
