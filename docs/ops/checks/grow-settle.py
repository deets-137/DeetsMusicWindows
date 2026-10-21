"""Nothing may change after a grow's motion has ended (CARD-GROW.md §21.5).

For every recorded step of a shots run (the `<clip>.sN-*` frame folders), compare the motion's
LAST frame (the last one before onset + --dur) with the frame SETTLE ms after the motion, and fail
the step when they differ (mean change over the window above --limit grey levels): the motion
must end on the picture that stays. A jump at the end (a layer swapped for the card's own paint)
shows here; a check that starts after the end does not see it.

Why: on 2026-10-20 the grow's shell drew Glass's window-pinned Canvas covers in the wrong place,
and they jumped when the card's own paint came back (+418 -> +440 ms, after a 340 ms open). The
owner saw it in two clicks; 47 clips passed, because their probes read state, not pixels, no clip
used Glass with covers, and a 90 % change mark does not see a late change that is small in time.

usage: python docs/ops/checks/grow-settle.py <run folder> [--dur 340] [--after 60] [--settle 300] [--limit 0.8]
  --dur     the motion's length (ms from the change's onset); the last frame before it is compared
  --after   ms past the motion's end where the settle window starts
  --settle  ms after that for the settled frame
  --limit   mean change (0-255) that fails a step
Needs Python with Pillow. Frames are named NNN_+Tms.jpg (T from the input); the step's onset is
read from <clip>.frames.json (changes[].onset)."""
import glob, json, os, re, sys
from PIL import Image, ImageChops, ImageStat

args = sys.argv[1:]
if not args or args[0].startswith("--"):
    print(__doc__)
    sys.exit(2)
run = args[0]


def opt(name, default):
    return float(args[args.index(name) + 1]) if name in args else default


DUR, AFTER, SETTLE, LIMIT = opt("--dur", 340), opt("--after", 60), opt("--settle", 300), opt("--limit", 0.8)
# A step fails only when the change is also SPREAD: more than this share of the window's pixels
# moved by more than SPREAD_GREY levels.
# Calibrated 2026-10-20: the covers jump moved 12.8 % of the window, a late cover load 2.0 %.
SPREAD, SPREAD_GREY = opt("--spread", 0.06), opt("--spread-grey", 6)

bad = seen = 0
for fj in sorted(glob.glob(os.path.join(run, "*.frames.json"))):
    clip = os.path.basename(fj)[: -len(".frames.json")]
    onsets = {c["step"]: c.get("onset") for c in json.load(open(fj)).get("changes", []) if c}
    for d in sorted(glob.glob(os.path.join(run, clip + ".s*"))):
        if not os.path.isdir(d):
            continue
        m = re.search(r"\.s(\d+)-", d)
        step = int(m.group(1)) if m else None
        onset = onsets.get(step) or 0
        fs = sorted(glob.glob(os.path.join(d, "*.jpg")))
        ts = [int(re.search(r"\+(-?\d+)ms", f).group(1)) for f in fs]
        end = onset + DUR
        a = max((i for i, t in enumerate(ts) if t < end), default=None)
        # The recorder sends a frame only when the picture changes: the settled picture is the
        # LAST frame inside the window (none after the motion = nothing changed = the motion's
        # last frame). The first frame after the window can be anything later (a hover hint, the
        # song's time, a turning record).
        b = max((i for i, t in enumerate(ts) if t <= end + AFTER + SETTLE), default=None)
        if a is None or b is None:
            print(f"skip  {clip} step {step}: no frame before +{int(end)} ms")
            continue
        seen += 1
        x, y = Image.open(fs[a]).convert("L"), Image.open(fs[b]).convert("L")
        diff = ImageChops.difference(x, y)
        mean = ImageStat.Stat(diff).mean[0]
        # How much of the picture moved: a jump of the card's paint touches most of it; a cover
        # that loads late touches one tile (data arriving, reported, not failed).
        spread = ImageStat.Stat(diff.point(lambda v: 255 if v > SPREAD_GREY else 0)).mean[0] / 255
        late = mean > LIMIT and spread > SPREAD
        bad += late
        box = diff.point(lambda v: 255 if v > 24 else 0).getbbox()
        tag = "LATE" if late else ("load" if mean > LIMIT else "ok  ")
        print(f"{tag}  {clip} step {step}: +{ts[a]} vs +{ts[b]} ms · mean change {mean:.2f} · spread {spread:.1%}" + (f" · box {box}" if mean > LIMIT else ""))
print(f"\n{seen} steps · {bad} late")
sys.exit(1 if bad else 0)
