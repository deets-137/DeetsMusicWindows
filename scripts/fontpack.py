#!/usr/bin/env python3
"""fontpack: turn sheets drawn in Krita into a real font (TTF + WOFF2).

  python scripts/fontpack.py new    <folder> --family "Deets Hand"
  python scripts/fontpack.py sheets <folder>             # remake the sheets after a guide change
  python scripts/fontpack.py build  <folder>             # drawn/*.png -> out/
  python scripts/fontpack.py pull   <folder> <font.ttf>  # spacing + kerning from FontForge

The whole method, the folder and the file formats: docs/ops/FONTPACK.md.
Needs: pip install fonttools brotli pillow numpy potracer
"""
import argparse
import hashlib
import html
import json
import re
import sys
import unicodedata
from pathlib import Path

import numpy as np
import potrace
from fontTools import agl
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

Image.MAX_IMAGE_PIXELS = None

# One pixel on a sheet is one font unit, so a cell is exactly one em.
CELL = 1000
COLS, ROWS = 7, 4
INK_LEVEL = 128        # darker than this is ink; the guides are far paler, so they drop out
SPECK_AREA = 150       # a closed shape smaller than this (square units) is a speck, not a stroke
CURVE_ERROR = 1.0      # how far (font units) a TrueType curve may sit from the traced curve
TRACE_KEY = "potrace-v1-a1.0-t0.4"   # change this when the trace settings change: it clears the cache

GUIDE = (190, 212, 242)       # pale blue: the cell lines and the x-height, cap and descender lines
BASELINE = (150, 185, 235)    # stronger blue: the line letters sit on
LABEL = (175, 200, 235)

SHEETS = {
    "1-capitals": "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "2-lowercase": "abcdefghijklmnopqrstuvwxyz",
    "3-digits": "0123456789.,:;!?'\"-()/&+=@#*",
    "4-symbols": "$%<>[]\\^_`{|}~€£¢©®™°×·•",
    "5-quotes-letters": "‘’“”‚„–—…¡¿«»ßæœøÆŒØıȷŁłðÐþÞ",
    "6-accents": "´ˆ˜¯˘˙¨˚˝ˇ¸˛",
}

# A combining mark from Unicode decomposition -> the drawn accent that stands for it.
MARKS = {
    "\u0300": "`", "\u0301": "´", "\u0302": "ˆ", "\u0303": "˜", "\u0304": "¯", "\u0306": "˘",
    "\u0307": "˙", "\u0308": "¨", "\u030a": "˚", "\u030b": "˝", "\u030c": "ˇ", "\u0327": "¸",
    "\u0328": "˛",
}
BELOW_MARKS = {"\u0327", "\u0328"}
DOTLESS = {"i": "ı", "j": "ȷ"}
ALIASES = {"-": ["\u00ad", "\u2010"]}   # a drawn glyph that also answers to these code points

PROOF_LINES = [
    "hamburgefonstiv",
    "nnonn HHOHH noon HOOH nonon",
    "AV To Ty LT r. f’ We Yo",
    "The quick brown fox jumps over the lazy dog",
    "SPHINX OF BLACK QUARTZ, JUDGE MY VOW 0123456789",
    "Beyoncé · Björk · Sigur Rós · Dvořák — Señorita (Live, 2019)",
]
PROOF_SIZES = [72, 40, 24, 16, 13, 11]

STARTER_SPACING = {
    "default": {"lsb": 50, "rsb": 50},
    "space": 260,
    "glyphs": {
        "BDEFHIJKLMNPRUbhijklmnpru": {"lsb": 70},
        "CGOQSacdeoqs": {"lsb": 40},
        "ATVWXYZftvwxyz": {"lsb": 15},
        "HIJMNUdghijlmnqu": {"rsb": 70},
        "BDOPQRSbcdeopqs": {"rsb": 40},
        "ACEFGKLTVWXYZfkrtvwxyz": {"rsb": 15},
    },
    "kerning": {},
}


def fail(message):
    print(f"fontpack: {message}", file=sys.stderr)
    sys.exit(1)


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_config(folder):
    path = folder / "font.json"
    if not path.exists():
        fail(f"no font.json in {folder}. Start with: fontpack.py new <folder> --family \"Name\"")
    cfg = read_json(path)
    if cfg["ascender"] - cfg["descender"] != CELL:
        fail(f"ascender minus descender must be {CELL} (one cell); it is "
             f"{cfg['ascender'] - cfg['descender']}")
    return cfg


def glyph_name(char):
    code = ord(char)
    return agl.UV2AGL.get(code, f"uni{code:04X}")


def label_font(size):
    here = Path(__file__).resolve().parent.parent
    for path in (here / "src/styles/fonts/LiberationSerif-Regular.ttf",
                 Path("C:/Windows/Fonts/segoeui.ttf")):
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size)


# ---------- the sheets ----------

def make_sheets(folder, cfg):
    out = folder / "templates"
    out.mkdir(exist_ok=True)
    (folder / "drawn").mkdir(exist_ok=True)
    big, small = label_font(90), label_font(30)
    asc = cfg["ascender"]
    lines = [(asc - cfg["capHeight"], GUIDE), (asc - cfg["xHeight"], GUIDE), (asc, BASELINE)]
    for name, chars in SHEETS.items():
        img = Image.new("RGB", (COLS * CELL, ROWS * CELL), "white")
        pen = ImageDraw.Draw(img)
        for i, char in enumerate(chars):
            x, y = (i % COLS) * CELL, (i // COLS) * CELL
            pen.rectangle([x, y, x + CELL - 1, y + CELL - 1], outline=GUIDE, width=2)
            for line_y, colour in lines:
                pen.line([x, y + line_y, x + CELL, y + line_y], fill=colour, width=3)
            pen.text((x + 18, y + 6), char, fill=LABEL, font=big)
            pen.text((x + CELL - 130, y + 12), f"{ord(char):04X}", fill=LABEL, font=small)
        img.save(out / f"{name}.png", optimize=True)
    print(f"sheets: {len(SHEETS)} in {out}")


def cmd_new(args):
    folder = Path(args.folder)
    if (folder / "font.json").exists():
        fail(f"{folder} already holds a font. Use `sheets` or `build`.")
    folder.mkdir(parents=True, exist_ok=True)
    cfg = {
        "family": args.family, "style": args.style, "weight": args.weight,
        "ascender": 800, "descender": -200,
        "xHeight": args.x_height, "capHeight": args.cap_height,
        "version": "1.000", "designer": "", "license": "",
    }
    write_json(folder / "font.json", cfg)
    write_json(folder / "spacing.json", STARTER_SPACING)
    make_sheets(folder, cfg)
    print(f"next: open templates\\*.png in Krita, draw on a new layer, export to drawn\\ "
          f"with the same name, then run: fontpack.py build \"{folder}\"")


def cmd_sheets(args):
    folder = Path(args.folder)
    make_sheets(folder, load_config(folder))


# ---------- reading and tracing ----------

def read_ink(path):
    """A Krita export -> a bool array, True where there is ink. Transparent counts as paper."""
    img = Image.open(path)
    if img.size != (COLS * CELL, ROWS * CELL):
        fail(f"{path.name} is {img.size[0]} x {img.size[1]} px; it must be "
             f"{COLS * CELL} x {ROWS * CELL}. Do not scale or crop the sheet in Krita.")
    if img.mode.startswith("I"):           # a 16-bit grayscale export
        return (np.asarray(img, dtype=np.float64) / 257.0) < INK_LEVEL
    rgba = img.convert("RGBA")
    paper = Image.new("RGBA", img.size, "white")
    paper.alpha_composite(rgba)
    return np.asarray(paper.convert("L")) < INK_LEVEL


def polygon_area(contour):
    points = [contour["start"]] + [seg[-1] for seg in contour["segs"]]
    total = 0.0
    for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1]):
        total += x0 * y1 - x1 * y0
    return total / 2


def trace_cell(ink, asc):
    """A cell -> contours in font units (y up, baseline at 0), and the count of specks dropped."""
    def to_font(point):
        return [round(point.x, 2), round(asc - point.y, 2)]

    # potracer treats True as paper, and keeps the image's top-down y.
    path = potrace.Bitmap(~ink).trace(turdsize=2, alphamax=1.0, opticurve=True, opttolerance=0.4)
    contours = []
    for curve in path:
        segs = []
        for seg in curve.segments:
            if seg.is_corner:
                segs.append([to_font(seg.c)])
                segs.append([to_font(seg.end_point)])
            else:
                segs.append([to_font(seg.c1), to_font(seg.c2), to_font(seg.end_point)])
        contours.append({"start": to_font(curve.start_point), "segs": segs})
    kept = [c for c in contours if abs(polygon_area(c)) >= SPECK_AREA]
    return kept, len(contours) - len(kept)


def traced(ink, asc, cache):
    """The trace is the slow part, so an unchanged cell comes from the cache."""
    key = hashlib.sha1(np.packbits(ink).tobytes() + f"{TRACE_KEY}:{asc}".encode()).hexdigest()
    path = cache / f"{key}.json"
    if path.exists():
        saved = read_json(path)
        return saved["contours"], saved["specks"]
    contours, specks = trace_cell(ink, asc)
    write_json(path, {"contours": contours, "specks": specks})
    return contours, specks


def draw_contours(contours, pen, dx=0.0):
    for contour in contours:
        x, y = contour["start"]
        pen.moveTo((x + dx, y))
        for seg in contour["segs"]:
            points = [(px + dx, py) for px, py in seg]
            if len(points) == 1:
                pen.lineTo(points[0])
            else:
                pen.curveTo(*points)
        pen.closePath()


def ink_bounds(contours):
    pen = BoundsPen(None)
    draw_contours(contours, pen)
    return pen.bounds


def read_drawings(folder, cfg):
    """Every drawn cell, as {char: contours}, and the warnings the owner should read."""
    cache = folder / ".cache"
    cache.mkdir(exist_ok=True)
    drawn, warnings = {}, []
    known = {f"{name}.png" for name in SHEETS}
    for file in sorted((folder / "drawn").glob("*.png")):
        if file.name not in known:
            warnings.append(f"{file.name}: not a sheet name, so it was skipped")
    for name, chars in SHEETS.items():
        path = folder / "drawn" / f"{name}.png"
        if not path.exists():
            continue
        sheet = read_ink(path)
        for i, char in enumerate(chars):
            x, y = (i % COLS) * CELL, (i // COLS) * CELL
            cell = sheet[y:y + CELL, x:x + CELL]
            if not cell.any():
                continue
            if cell[0].any() or cell[-1].any() or cell[:, 0].any() or cell[:, -1].any():
                warnings.append(f"{char} ({name}): ink touches the cell edge, so a stroke is cut "
                                "or a neighbor came in")
            contours, specks = traced(cell, cfg["ascender"], cache)
            if specks:
                warnings.append(f"{char} ({name}): removed {specks} speck(s)")
            if contours:
                drawn[char] = contours
    return drawn, warnings


# ---------- spacing ----------

def spacing_for(chars, spacing):
    """Later keys win, so a one-letter entry overrides a group above it."""
    default = spacing.get("default", {})
    result = {c: {"lsb": default.get("lsb", 50), "rsb": default.get("rsb", 50)} for c in chars}
    for key, values in spacing.get("glyphs", {}).items():
        for char in key:
            if char in result:
                result[char].update({k: v for k, v in values.items() if k in ("lsb", "rsb")})
    return result


def place_glyphs(drawn, spacing):
    """Put each drawing on its sidebearings -> {char: (contours, dx, advance, xMin, xMax)}."""
    sides = spacing_for(drawn, spacing)
    placed = {}
    for char, contours in drawn.items():
        x_min, _, x_max, _ = ink_bounds(contours)
        dx = sides[char]["lsb"] - x_min
        advance = round((x_max - x_min) + sides[char]["lsb"] + sides[char]["rsb"])
        placed[char] = (contours, dx, advance, x_min + dx, x_max + dx)
    return placed


def composed_chars(placed, cfg):
    """Accented letters built from a drawn base and a drawn accent, so they follow any redraw.
    -> {char: (base, mark, x offset, y offset)}."""
    rise_caps = cfg["capHeight"] - cfg["xHeight"]
    result = {}
    for code in list(range(0x00C0, 0x0180)) + list(range(0x01CD, 0x01DD)):
        char = chr(code)
        parts = unicodedata.normalize("NFD", char)
        if len(parts) != 2 or parts[1] not in MARKS or char in placed:
            continue
        base, combining = parts
        below = combining in BELOW_MARKS
        if not below:
            base = DOTLESS.get(base, base) if DOTLESS.get(base, base) in placed else base
        mark = MARKS[combining]
        if base not in placed or mark not in placed:
            continue
        _, _, _, base_min, base_max = placed[base]
        _, _, _, mark_min, mark_max = placed[mark]
        if combining == "\u0328":            # an ogonek hangs from the right of the letter
            dx = base_max - mark_max
        else:
            dx = (base_min + base_max) / 2 - (mark_min + mark_max) / 2
        dy = 0
        if not below:
            top = ink_bounds(placed[base][0])[3]
            if base.isupper():
                dy = rise_caps
            elif top > cfg["xHeight"] + 80:  # an ascender: lift the accent clear of it
                dy = top - cfg["xHeight"]
        result[char] = (base, mark, round(dx), round(dy))
    return result


def kerning_rules(spacing, placed, composed):
    """Kerning pairs as feature text. An accented letter kerns like its base."""
    family = {}
    for char, (base, *_rest) in composed.items():
        family.setdefault(base, []).append(char)
    rules = []
    for key, value in spacing.get("kerning", {}).items():
        pair = key.split()
        if len(pair) != 2 or pair[0] not in placed or pair[1] not in placed:
            continue
        for left in [pair[0]] + family.get(pair[0], []):
            for right in [pair[1]] + family.get(pair[1], []):
                rules.append(f"  pos {glyph_name(left)} {glyph_name(right)} {int(value)};")
    return rules


# ---------- building ----------

def outline_glyph(contours, dx):
    """Outlines -> a TrueType glyph. TrueType wants the outer shape clockwise."""
    biggest = max(contours, key=lambda c: abs(polygon_area(c)))
    pen = TTGlyphPen(None)
    draw_contours(contours, Cu2QuPen(pen, CURVE_ERROR, reverse_direction=polygon_area(biggest) > 0), dx)
    return pen.glyph()


def notdef_glyph(cfg):
    pen = TTGlyphPen(None)
    left, right, top = 60, 440, cfg["capHeight"]
    for points in ([(left, 0), (left, top), (right, top), (right, 0)],
                   [(left + 50, 50), (right - 50, 50), (right - 50, top - 50), (left + 50, top - 50)]):
        pen.moveTo(points[0])
        for point in points[1:]:
            pen.lineTo(point)
        pen.closePath()
    return pen.glyph()


def build_font(cfg, placed, composed, spacing):
    glyphs = {".notdef": notdef_glyph(cfg), "space": TTGlyphPen(None).glyph()}
    advances = {".notdef": 500, "space": int(spacing.get("space", 260))}
    cmap = {0x20: "space", 0xA0: "space"}
    for char, (contours, dx, advance, _, _) in placed.items():
        name = glyph_name(char)
        glyphs[name] = outline_glyph(contours, dx)
        advances[name] = advance
        cmap[ord(char)] = name
        for alias in ALIASES.get(char, []):
            cmap[ord(alias)] = name
    for char, (base, mark, dx, dy) in composed.items():
        name = glyph_name(char)
        pen = TTGlyphPen(glyphs)
        pen.addComponent(glyph_name(base), (1, 0, 0, 1, 0, 0))
        pen.addComponent(glyph_name(mark), (1, 0, 0, 1, dx, dy))
        glyphs[name] = pen.glyph()
        advances[name] = placed[base][2]
        cmap[ord(char)] = name

    fb = FontBuilder(CELL, isTTF=True)
    fb.setupGlyphOrder(list(glyphs))
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    glyf = fb.font["glyf"]
    fb.setupHorizontalMetrics({n: (advances[n], getattr(glyf[n], "xMin", 0)) for n in glyphs})

    family, style = cfg["family"], cfg["style"]
    plain = style in ("Regular", "Bold")
    ps_name = re.sub(r"[^A-Za-z0-9-]", "", f"{family}-{style}")
    names = {
        "familyName": family if plain else f"{family} {style}",
        "styleName": style if plain else "Regular",
        "uniqueFontIdentifier": f"{cfg['version']};{ps_name}",
        "fullName": f"{family} {style}",
        "psName": ps_name,
        "version": f"Version {cfg['version']}",
    }
    if not plain:
        names["typographicFamily"], names["typographicSubfamily"] = family, style
    if cfg.get("designer"):
        names["designer"] = cfg["designer"]
    if cfg.get("license"):
        names["licenseDescription"] = cfg["license"]
    fb.setupNameTable(names)

    asc, desc = cfg["ascender"], cfg["descender"]
    y_max = max([asc] + [getattr(g, "yMax", 0) for g in glyf.glyphs.values()])
    y_min = min([desc] + [getattr(g, "yMin", 0) for g in glyf.glyphs.values()])
    bold = cfg["weight"] >= 700
    fb.setupHorizontalHeader(ascent=asc, descent=desc)
    fb.setupOS2(
        version=4, usWeightClass=cfg["weight"], fsType=0,
        sTypoAscender=asc, sTypoDescender=desc, sTypoLineGap=0,
        usWinAscent=y_max, usWinDescent=-y_min,
        sxHeight=cfg["xHeight"], sCapHeight=cfg["capHeight"],
        fsSelection=(0x20 if bold else 0x40) | 0x80,   # bold or regular, plus USE_TYPO_METRICS
    )
    fb.setupPost()
    fb.font["head"].macStyle = 1 if bold else 0
    fb.font["head"].fontRevision = float(cfg["version"])

    rules = kerning_rules(spacing, placed, composed)
    if rules:
        fea = "languagesystem DFLT dflt;\nlanguagesystem latn dflt;\nfeature kern {\n"
        addOpenTypeFeaturesFromString(fb.font, fea + "\n".join(rules) + "\n} kern;\n")
    return fb.font, ps_name, len(rules)


def write_proof(out, cfg, ps_name, chars):
    family = html.escape(cfg["family"])
    rows = []
    for size in PROOF_SIZES:
        for line in PROOF_LINES if size >= 16 else PROOF_LINES[3:]:
            rows.append(f'<p style="font-size:{size}px">{html.escape(line)}</p>')
        rows.append(f'<small>{size} px</small>')
    all_chars = html.escape("".join(sorted(chars)))
    (out / "proof.html").write_text(f"""<!DOCTYPE html>
<meta charset="utf-8"><title>{family} proof</title>
<style>
@font-face {{ font-family: "Proof"; src: url("{ps_name}.woff2") format("woff2"); }}
body {{ margin: 0; font-family: "Proof", serif; }}
section {{ padding: 24px 32px; }}
.dark {{ background: #16181d; color: #eceff4; }}
p {{ margin: 6px 0; line-height: 1.3; }}
small {{ display: block; margin: 2px 0 18px; font: 11px system-ui; opacity: .55; }}
.all {{ font-size: 40px; line-height: 1.4; word-break: break-all; }}
</style>
<section>{''.join(rows)}</section>
<section class="dark">{''.join(rows)}</section>
<section class="all">{all_chars}</section>
""", encoding="utf-8")


def write_css(out, cfg, ps_name):
    (out / "fontface.css").write_text(f"""/* {cfg['family']} {cfg['style']}: copy the file to src/styles/fonts/ and this rule to fonts.css. */
@font-face {{
  font-family: "{cfg['family']}";
  font-style: normal;
  font-weight: {cfg['weight']};
  font-display: swap;
  src: url("./fonts/{ps_name}.woff2") format("woff2");
}}
""", encoding="utf-8")


def report_missing(label, wanted, have):
    missing = [c for c in wanted if c not in have]
    print(f"{label}: {len(wanted) - len(missing)} of {len(wanted)}"
          + (f"; missing {' '.join(missing)}" if missing else ""))


def cmd_build(args):
    folder = Path(args.folder)
    cfg = load_config(folder)
    spacing = read_json(folder / "spacing.json")
    drawn, warnings = read_drawings(folder, cfg)
    if not drawn:
        fail(f"no drawings found in {folder / 'drawn'}. Export each sheet there as PNG, "
             "with the name of its template.")
    placed = place_glyphs(drawn, spacing)
    composed = composed_chars(placed, cfg)
    font, ps_name, kern_count = build_font(cfg, placed, composed, spacing)

    out = folder / "out"
    out.mkdir(exist_ok=True)
    font.save(out / f"{ps_name}.ttf")
    web = TTFont(out / f"{ps_name}.ttf")
    web.flavor = "woff2"
    web.save(out / f"{ps_name}.woff2")
    write_proof(out, cfg, ps_name, set(placed) | set(composed))
    write_css(out, cfg, ps_name)

    ascii_chars = [chr(c) for c in range(33, 127)]
    other = [c for chars in SHEETS.values() for c in chars if c not in ascii_chars]
    report_missing("basic set", ascii_chars, placed)
    report_missing("second set", other, placed)
    print(f"accented letters built: {len(composed)}; kerning pairs: {kern_count}")
    for warning in warnings:
        print(f"check: {warning}")
    print(f"wrote {out / (ps_name + '.ttf')} and .woff2 "
          f"({(out / (ps_name + '.woff2')).stat().st_size // 1024} KB); open {out / 'proof.html'}")


# ---------- reading spacing back from FontForge ----------

def kerning_from(font):
    """Every kerning pair in a font, from GPOS and from an old `kern` table."""
    pairs = {}
    if "GPOS" in font:
        table = font["GPOS"].table
        indices = {i for rec in table.FeatureList.FeatureRecord if rec.FeatureTag == "kern"
                   for i in rec.Feature.LookupListIndex}
        for index in sorted(indices):
            for sub in table.LookupList.Lookup[index].SubTable:
                sub = getattr(sub, "ExtSubTable", sub)
                if sub.LookupType != 2:
                    continue
                if sub.Format == 1:
                    for left, pair_set in zip(sub.Coverage.glyphs, sub.PairSet):
                        for rec in pair_set.PairValueRecord:
                            value = getattr(rec.Value1, "XAdvance", 0) if rec.Value1 else 0
                            pairs.setdefault((left, rec.SecondGlyph), value)
                else:
                    seconds = {}
                    for glyph in font.getGlyphOrder():
                        seconds.setdefault(sub.ClassDef2.classDefs.get(glyph, 0), []).append(glyph)
                    for left in sub.Coverage.glyphs:
                        row = sub.Class1Record[sub.ClassDef1.classDefs.get(left, 0)]
                        for number, rec in enumerate(row.Class2Record):
                            value = getattr(rec.Value1, "XAdvance", 0) if rec.Value1 else 0
                            if value:
                                for right in seconds.get(number, []):
                                    pairs.setdefault((left, right), value)
    if "kern" in font:
        for sub in font["kern"].kernTables:
            for pair, value in sub.kernTable.items():
                pairs.setdefault(pair, value)
    return pairs


def cmd_pull(args):
    folder = Path(args.folder)
    load_config(folder)
    spacing_path = folder / "spacing.json"
    spacing = read_json(spacing_path)
    font = TTFont(args.font)
    glyph_set, metrics = font.getGlyphSet(), font["hmtx"].metrics
    by_name = {}
    for code, name in font.getBestCmap().items():
        by_name.setdefault(name, chr(code))
    sheet_chars = {c for chars in SHEETS.values() for c in chars}

    sides = {}
    for name, char in by_name.items():
        if char not in sheet_chars:
            continue
        pen = BoundsPen(glyph_set)
        glyph_set[name].draw(pen)
        if pen.bounds:
            sides[char] = {"lsb": round(pen.bounds[0]),
                           "rsb": round(metrics[name][0] - pen.bounds[2])}
    kerning = {}
    for (left, right), value in kerning_from(font).items():
        a, b = by_name.get(left), by_name.get(right)
        if value and a in sheet_chars and b in sheet_chars:
            kerning[f"{a} {b}"] = int(value)
    if not sides:
        fail(f"{args.font} has no glyphs from the sheets, so spacing.json was not changed")
    spacing["glyphs"] = sides
    spacing["kerning"] = kerning
    if "space" in glyph_set:
        spacing["space"] = metrics["space"][0]
    write_json(spacing_path, spacing)
    print(f"spacing.json: {len(sides)} glyphs, {len(kerning)} kerning pairs from {args.font}")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Turn sheets drawn in Krita into a font.")
    commands = parser.add_subparsers(dest="command", required=True)

    new = commands.add_parser("new", help="start a font: its folder, settings and blank sheets")
    new.add_argument("folder")
    new.add_argument("--family", required=True)
    new.add_argument("--style", default="Regular")
    new.add_argument("--weight", type=int, default=400)
    new.add_argument("--x-height", type=int, default=500)
    new.add_argument("--cap-height", type=int, default=700)
    new.set_defaults(run=cmd_new)

    sheets = commands.add_parser("sheets", help="remake the blank sheets from font.json")
    sheets.add_argument("folder")
    sheets.set_defaults(run=cmd_sheets)

    build = commands.add_parser("build", help="build the font from drawn/*.png")
    build.add_argument("folder")
    build.set_defaults(run=cmd_build)

    pull = commands.add_parser("pull", help="copy spacing and kerning from a font into spacing.json")
    pull.add_argument("folder")
    pull.add_argument("font")
    pull.set_defaults(run=cmd_pull)

    args = parser.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()
