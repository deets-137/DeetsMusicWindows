"""First drafts of the Happy skin's new frames, made from the DeetsLife art (docs/features/happy.md §5).

The owner's permission (2026-10-21): copy and modify the DeetsLife drawings, non-destructively.
This reads ../DeetsLife/game/assets/sprites/ and writes into art-template/happy/ only.
Each draft is a starting point for his hand; a strip he has drawn is never overwritten
(a file that is not fully transparent and not in DRAFTS_OK is skipped).

Run: python art-template/happy/make_drafts.py <repo> <DeetsLife repo> [only]
`only` (a part of a strip's name, e.g. "stand") writes just the strips it matches.
"""
import math
import sys
from pathlib import Path
from PIL import Image

REPO, LIFE = Path(sys.argv[1]), Path(sys.argv[2])
ONLY = sys.argv[3] if len(sys.argv) > 3 else ""
SRC = LIFE / "game/assets/sprites"
OUT = REPO / "art-template/happy"

# The DeetsLife palette, read from the sprites.
SKIN = (173, 128, 88, 255)        # Deets' hand
GREEN = (29, 71, 57, 255)         # Deets' sweater
GREEN_D = (16, 41, 33, 255)       # Deets' arm
FUR = (173, 128, 88, 255)
TONGUE = {(143, 102, 176), (181, 105, 177)}
# The tennis ball (new): light, mid, shade, seam.
BALL_L, BALL_M, BALL_S, SEAM = (222, 238, 96, 255), (190, 212, 58, 255), (146, 168, 40, 255), (246, 248, 232, 255)
CLEAR = (0, 0, 0, 0)

BALL_SMALL = [  # 4x4, the fetch ball (in flight, in a mouth, in a hand)
    ".LL.",
    "LWLM",
    "MLWS",
    ".SS.",
]
BALL_KEY = {"L": BALL_L, "M": BALL_M, "S": BALL_S, "W": SEAM}


def load(name):
    return Image.open(SRC / name).convert("RGBA")


def stamp(im, pattern, x0, y0):
    for dy, row in enumerate(pattern):
        for dx, ch in enumerate(row):
            if ch in BALL_KEY and 0 <= x0 + dx < im.width and 0 <= y0 + dy < im.height:
                im.putpixel((x0 + dx, y0 + dy), BALL_KEY[ch])


def strip(frames):
    w, h = frames[0].size
    s = Image.new("RGBA", (w * len(frames), h), CLEAR)
    for i, f in enumerate(frames):
        s.alpha_composite(f, (i * w, 0))
    return s


def blank(p):
    if not p.exists():
        return True
    im = Image.open(p).convert("RGBA")
    return im.getchannel("A").getbbox() is None


def save(name, im):
    if ONLY not in name:
        return
    p = OUT / f"{name}.png"
    if blank(p) or (OUT / f"{name}.draft").exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        im.save(p)
        (OUT / f"{name}.draft").write_text("A first draft by Claude from the DeetsLife art. Delete this file once you redraw the strip.\n")
        print("draft", name, im.size)
    else:
        print("kept his drawing", name)


def frames_of(im, w):
    return [im.crop((i * w, 0, (i + 1) * w, im.height)) for i in range(im.width // w)]


def mouth(frame):
    """The row of the mouth line and its left column: the black run at the head's front."""
    for y in range(10, 18):
        for x in range(0, 8):
            if frame.getpixel((x, y))[:3] == (0, 0, 0) and frame.getpixel((x, y))[3]:
                return x, y
    return 3, 14


def no_tongue(frame):
    for y in range(frame.height):
        for x in range(frame.width):
            if frame.getpixel((x, y))[:3] in TONGUE:
                frame.putpixel((x, y), CLEAR)


def with_ball_side(frame):
    f = frame.copy()
    no_tongue(f)
    mx, my = mouth(f)
    stamp(f, BALL_SMALL, mx - 2, my - 1)
    return f


def shift_region(frame, box, dx, dy):
    """Move the pixels in box by (dx, dy); the place they left goes clear."""
    f = frame.copy()
    part = frame.crop(box)
    x0, y0, x1, y1 = box
    for y in range(y0, y1):
        for x in range(x0, x1):
            f.putpixel((x, y), CLEAR)
    f.alpha_composite(part, (x0 + dx, y0 + dy))
    return f


def fill_gaps(f, rows, cols, color):
    """Close a one-column seam left by a shift: a clear pixel with fur on both sides."""
    for y in rows:
        for x in cols:
            if f.getpixel((x, y))[3] == 0 and f.getpixel((x - 1, y))[3] and f.getpixel((x + 1, y))[3]:
                f.putpixel((x, y), color)


def line(im, p0, p1, color, r=1.5):
    (x0, y0), (x1, y1) = p0, p1
    n = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 1
    for i in range(n + 1):
        t = i / n
        cx, cy = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        for y in range(int(cy - r), int(cy + r) + 1):
            for x in range(int(cx - r), int(cx + r) + 1):
                if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r and 0 <= x < im.width and 0 <= y < im.height:
                    im.putpixel((x, y), color)


# ---- Happy -----------------------------------------------------------------
idle = load("happy/idle_side.png")
walk = frames_of(load("happy/walk_side.png"), 32)
sit_down = load("happy/sit_down.png")

# Borrowed as they are: the rest pose (sitting, facing you) and the standing side pose.
save("happy/sit_down", sit_down.copy())
save("happy/idle_side", idle.copy())

# The head push: the head drops and pushes forward, the body leans in.
HEAD = (0, 0, 17, 16)
p1 = shift_region(idle, HEAD, -1, 3)
p2 = shift_region(idle, HEAD, -2, 5)
p2 = shift_region(p2, (15, 0, 32, 24), -1, 0)  # the body leans after the head
fill_gaps(p1, range(14, 20), range(1, 30), FUR)
fill_gaps(p2, range(14, 24), range(1, 30), FUR)
save("happy/push_head_side", strip([p1, p2, p2.copy(), p1.copy()]))

# The stand (40x48): he rises onto his hind legs and pushes the cover with his front paws, a step
# at a time. Faces left; the paws' tip reaches column 4, 16 px ahead of the frame's middle.
SHADE = (143, 102, 75, 255)
STAND_W, STAND_H = 40, 48


def rect(im, x0, y0, x1, y1, color):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if 0 <= x < im.width and 0 <= y < im.height:
                im.putpixel((x, y), color)


def upright(reach, step=0, bob=0):
    """Standing on his hind legs. `reach`: how far the front legs come out ahead of the chest;
    `step`: which hind leg is up (0 none, 1 the near one, 2 the far one); `bob`: the upper body
    down by this many px."""
    f = Image.new("RGBA", (STAND_W, STAND_H), CLEAR)
    # the far hind leg (behind, in shade), then the haunch, then the near leg
    up = (1, 0) if step == 2 else (0, 1) if step == 1 else (0, 0)
    rect(f, 21, 40 - 2 * up[0], 24, 45 - 2 * up[0], SHADE)
    rect(f, 19 + up[0], 46 - 2 * up[0], 24, 47 - 2 * up[0], SHADE)
    rect(f, 16, 33, 25, 41, FUR)
    rect(f, 16, 38, 16, 41, SHADE)
    rect(f, 16, 41 - 2 * up[1], 19, 45 - 2 * up[1], FUR)
    rect(f, 13 + up[1], 46 - 2 * up[1], 19, 47 - 2 * up[1], SHADE)
    # the tail, out behind
    rect(f, 26, 30, 28, 32, SHADE)
    b = bob
    # the far front leg (in shade, a row lower), the chest, the near front leg
    rect(f, 16 - reach, 26 + b, 17, 27 + b, SHADE)
    rect(f, 16, 18 + b, 25, 36, FUR)
    f.putpixel((25, 18 + b), CLEAR)
    rect(f, 16, 27 + b, 16, 34, SHADE)
    rect(f, 16 - reach, 23 + b, 17, 25 + b, FUR)
    rect(f, 16 - reach, 23 + b, 17 - reach, 25 + b, SHADE)  # the paw
    # the head, from the side pose, over the chest's top
    f.alpha_composite(idle.crop((3, 5, 17, 17)), (10, 8 + b))
    return f


stand_crouch = Image.new("RGBA", (STAND_W, STAND_H), CLEAR)
stand_crouch.alpha_composite(idle, (4, 16))
rise = stand_crouch.rotate(-35, resample=Image.NEAREST, center=(29, 47))  # about his hind feet
save("happy/stand_up_side", strip([stand_crouch, rise, upright(4)]))
save("happy/stand_push_side", strip([upright(12, 1), upright(12, 0, 1), upright(12, 2), upright(12, 0, 1)]))

# Fetch: the walk with the ball in his mouth; the drop; keeping it (sitting, facing you).
save("happy/run_ball_side", strip([with_ball_side(f) for f in walk]))
d1 = with_ball_side(idle)
d2 = shift_region(with_ball_side(idle), HEAD, 0, 2)
fill_gaps(d2, range(14, 20), range(1, 30), FUR)
d3 = shift_region(idle, HEAD, 0, 2)
fill_gaps(d3, range(14, 20), range(1, 30), FUR)
stamp(d3, BALL_SMALL, 0, 28)
save("happy/drop_ball_side", strip([d1, d2, d3]))

k1 = sit_down.copy()
no_tongue(k1)
stamp(k1, BALL_SMALL, 14, 12)
k2 = shift_region(k1, (6, 3, 26, 16), 1, 0)   # a cheeky head tilt
save("happy/keep_ball_down", strip([k1, k2]))

# ---- Deets -----------------------------------------------------------------
d_idle = load("deets/idle_side.png")


def no_arm(im):
    f = im.copy()
    for y in range(23, 36):
        for x in range(14, 18):
            f.putpixel((x, y), GREEN)
    return f


body = no_arm(d_idle)
SHOULDER = (16, 22)
poses = [  # hand position per frame; Deets faces left, so the throw goes left
    ((22, 15), True),   # wind-up: the arm back and up, the ball in hand
    ((18, 9), True),    # over the head
    ((6, 19), False),   # release: the arm forward, the ball gone
    ((9, 30), False),   # follow-through
]
throw = []
for hand, holds in poses:
    f = body.copy()
    line(f, SHOULDER, hand, GREEN_D)
    hx, hy = hand
    for y in range(hy - 1, hy + 1):
        for x in range(hx - 1, hx + 1):
            f.putpixel((x, y), SKIN)
    if holds:
        stamp(f, BALL_SMALL, hx - 2, hy - 4)
    throw.append(f)
save("deets/throw_side", strip(throw))

# Waiting: a one-pixel breath, the upper body down, the legs still.
w2 = shift_region(d_idle, (0, 0, 32, 36), 0, 1)
save("deets/watch_side", strip([d_idle.copy(), w2]))

# ---- The tennis ball: 8 frames of one roll, 12x12 ---------------------------
def tennis(angle, size=12):
    im = Image.new("RGBA", (size, size), CLEAR)
    c = (size - 1) / 2
    R = size / 2 - 0.3
    a, b = 0.62, 0.38   # the seam: two lobes, the classic tennis-ball curve
    seam = []
    for i in range(400):
        t = i / 400 * 2 * math.pi
        x = a * math.cos(t) + b * math.cos(3 * t)
        y = a * math.sin(t) - b * math.sin(3 * t)
        z = 2 * math.sqrt(a * b) * math.sin(2 * t)
        n = math.sqrt(x * x + y * y + z * z)
        seam.append((x / n, y / n, z / n))
    tilt = 0.5
    for py in range(size):
        for px in range(size):
            dx, dy = (px - c) / R, (py - c) / R
            rr = dx * dx + dy * dy
            if rr > 1:
                continue
            dz = math.sqrt(1 - rr)
            # undo the roll (about the screen's normal) and a fixed tilt, to find the ball's own point
            x = dx * math.cos(angle) + dy * math.sin(angle)
            y = -dx * math.sin(angle) + dy * math.cos(angle)
            z = dz
            y, z = y * math.cos(tilt) - z * math.sin(tilt), y * math.sin(tilt) + z * math.cos(tilt)
            near = min((x - sx) ** 2 + (y - sy) ** 2 + (z - sz) ** 2 for sx, sy, sz in seam)
            light = -0.55 * dx - 0.65 * dy + 0.5 * dz
            if near < 0.018:
                col = SEAM if light > -0.1 else BALL_M
            elif light > 0.35:
                col = BALL_L
            elif light > -0.15:
                col = BALL_M
            else:
                col = BALL_S
            im.putpixel((px, py), col)
    return im


save("scene/tennis_ball", strip([tennis(-k * math.pi / 4) for k in range(8)]))


# ---- Placeholders for his drawings: the sun, the rays, the moon, the clouds, the bubble ----
def disc(im, cx, cy, r, color):
    for y in range(im.height):
        for x in range(im.width):
            if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r:
                im.putpixel((x, y), color)


SUN_RIM, SUN_FACE, SUN_HI = (255, 176, 46, 255), (255, 214, 74, 255), (255, 240, 160, 255)
sun = Image.new("RGBA", (48, 48), CLEAR)
disc(sun, 24, 24, 20, SUN_RIM)
disc(sun, 24, 24, 18, SUN_FACE)
disc(sun, 18, 17, 5, SUN_HI)
save("scene/sun", sun)

rays = Image.new("RGBA", (80, 80), CLEAR)
RAY = (255, 226, 120, 200)
for k in range(12):
    a = k * math.pi / 6
    for d in range(28, 37):
        for w in (-1, 0, 1):
            x = 40 + d * math.cos(a) - w * math.sin(a)
            y = 40 + d * math.sin(a) + w * math.cos(a)
            if 0 <= int(x) < 80 and 0 <= int(y) < 80:
                rays.putpixel((int(x), int(y)), RAY)
save("scene/sun_rays", rays)

MOON, MOON_SHADE = (241, 235, 208, 255), (214, 205, 172, 255)
moon = Image.new("RGBA", (40, 40), CLEAR)
disc(moon, 20, 20, 16, MOON)
cut = Image.new("RGBA", (40, 40), CLEAR)
disc(cut, 27, 15, 14, (0, 0, 0, 255))
for y in range(40):
    for x in range(40):
        if cut.getpixel((x, y))[3]:
            moon.putpixel((x, y), CLEAR)
disc(moon, 12, 24, 2.2, MOON_SHADE)
disc(moon, 16, 31, 1.6, MOON_SHADE)
save("scene/moon", moon)

CLOUD, CLOUD_SHADE = (255, 255, 255, 255), (214, 228, 240, 255)


def cloud(w, h, puffs):
    im = Image.new("RGBA", (w, h), CLEAR)
    for cx, cy, r in puffs:
        disc(im, cx, cy + 1.5, r, CLOUD_SHADE)
    for cx, cy, r in puffs:
        disc(im, cx, cy, r - 0.5, CLOUD)
    return im


save("scene/cloud_small", cloud(48, 24, [(12, 15, 8), (24, 11, 10), (36, 15, 8)]))
save("scene/cloud_medium", cloud(72, 32, [(14, 21, 10), (30, 14, 13), (46, 16, 12), (60, 22, 9)]))
save("scene/cloud_large", cloud(112, 40, [(16, 27, 11), (34, 18, 15), (56, 14, 17), (78, 19, 14), (96, 27, 11)]))

INK, PAPER = (43, 38, 32, 255), (255, 253, 248, 255)
bubble = Image.new("RGBA", (15, 15), CLEAR)
for y in range(15):
    for x in range(15):
        # a rounded box: the corner cut by 2, the outline 1 px of ink
        cx = min(x, 14 - x)
        cy = min(y, 14 - y)
        if cx + cy < 2:
            continue
        edge = cx == 0 or cy == 0 or cx + cy == 2
        bubble.putpixel((x, y), INK if edge else PAPER)
save("scene/bubble", bubble)
tail = Image.new("RGBA", (7, 6), CLEAR)
for y in range(6):
    for x in range(7):
        half = 3 - y * 0.6
        if abs(x - 3) <= half:
            edge = abs(x - 3) > half - 1 or y == 5
            tail.putpixel((x, y), INK if edge else PAPER)
for x in range(1, 6):
    tail.putpixel((x, 0), PAPER)  # opens into the bubble above
save("scene/bubble_tail", tail)
small = Image.new("RGBA", (4, 4), CLEAR)
stamp(small, BALL_SMALL, 0, 0)
save("scene/ball_small", small)
