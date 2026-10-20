"""Frames on screen at evenly spaced moments, cropped and enlarged, plus frame-to-frame diffs.
usage: python docs/ops/checks/frames-bytime.py <frames dir> <out.png> x0 y0 x1 y1 [step_ms] [end_ms] [scale]
(COLS=n sets the columns). Needs Python with Pillow. DESK-TESTS.md §6.7."""
import sys, glob, os, re
from PIL import Image, ImageDraw, ImageChops

d, out = sys.argv[1], sys.argv[2]
x0, y0, x1, y1 = map(int, sys.argv[3:7])
step = int(sys.argv[7]) if len(sys.argv) > 7 else 33
end = int(sys.argv[8]) if len(sys.argv) > 8 else 700
scale = float(sys.argv[9]) if len(sys.argv) > 9 else 2
fs = sorted(glob.glob(os.path.join(d, "*.jpg")))
ts = [int(re.search(r"\+(-?\d+)ms", f).group(1)) for f in fs]
picks = []
for t in range(0, end + 1, step):
    i = max([k for k, v in enumerate(ts) if v <= t], default=0)
    picks.append((t, fs[i], ts[i]))
crops = []
prev = None
for t, f, ft in picks:
    c = Image.open(f).convert("RGB").crop((x0, y0, x1, y1))
    c = c.resize((int(c.width * scale), int(c.height * scale)), Image.NEAREST)
    diff = ImageChops.difference(c, prev) if prev is not None else Image.new("RGB", c.size)
    diff = diff.point(lambda v: min(255, v * 4))
    prev = c
    for im, lab in ((c, f"t{t} (frame +{ft})"), (diff, "diff")):
        ImageDraw.Draw(im).rectangle((0, 0, 150, 14), fill="black")
        ImageDraw.Draw(im).text((3, 2), lab, fill="yellow")
    crops.append((c, diff))
cw, ch = crops[0][0].size
cols = int(os.environ.get("COLS", "4"))
rows = (len(crops) + cols - 1) // cols
m = Image.new("RGB", (cw * cols, ch * 2 * rows), "white")
for i, (c, df) in enumerate(crops):
    x, y = (i % cols) * cw, (i // cols) * ch * 2
    m.paste(c, (x, y))
    m.paste(df, (x, y + ch))
m.save(out)
print(out, m.size, len(fs), "frames")
