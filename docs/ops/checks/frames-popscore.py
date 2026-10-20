"""Per real frame, the mean change in a region (0–255), and the share of the whole motion's
change that the largest single frame carries, normalized by the frame's time gap.
A smooth turn spreads its change; a pop puts a large share in one frame.
usage: python docs/ops/checks/frames-popscore.py <frames dir> x0 y0 x1 y1
Needs Python with Pillow. DESK-TESTS.md §6.7."""
import sys, glob, os, re
from PIL import Image, ImageChops, ImageStat

d = sys.argv[1]
box = tuple(map(int, sys.argv[2:6]))
fs = sorted(glob.glob(os.path.join(d, "*.jpg")))
ts = [int(re.search(r"\+(-?\d+)ms", f).group(1)) for f in fs]
prev = None
rows = []
for f, t in zip(fs, ts):
    im = Image.open(f).convert("L").crop(box)
    if prev is not None:
        m = ImageStat.Stat(ImageChops.difference(im, prev[0])).mean[0]
        rows.append((t, t - prev[1], m))
    prev = (im, t)
tot = sum(r[2] for r in rows) or 1
# change per ms, so a long gap does not look like a pop
rate = [(t, dt, m, m / max(dt, 1)) for t, dt, m in rows]
worst = max(rate, key=lambda r: r[2])
print("total", round(tot, 1), "| largest frame", worst[0], "ms (gap", worst[1], "ms):", round(worst[2], 1),
      f"= {100 * worst[2] / tot:.0f}% of all change")
print(" ".join(f"{t}:{m:.0f}" for t, dt, m, _ in rate if m >= 1))
