"""First drafts of the Happy skin's new frames, made from the DeetsLife art (docs/features/happy.md §5).

The owner's permission (2026-10-21): copy and modify the DeetsLife drawings, non-destructively.
This reads ../DeetsLife/game/assets/sprites/ and writes into art-template/happy/ only.
Each draft is a starting point for his hand; a strip he has drawn is never overwritten
(a file that is not fully transparent and not in DRAFTS_OK is skipped).

Run: python art-template/happy/make_drafts.py <repo> <DeetsLife repo>
"""
import math
import sys
from pathlib import Path
from PIL import Image

REPO, LIFE = Path(sys.argv[1]), Path(sys.argv[2])
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
small = Image.new("RGBA", (4, 4), CLEAR)
stamp(small, BALL_SMALL, 0, 0)
save("scene/ball_small", small)
