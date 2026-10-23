"""`python scripts/icons.py` — every DeetsMusic icon from the owner's drawings
(docs/ideas/whitelabel.md §10.6, docs/ops/IDENTITY.md §3.3). Needs Python 3 with Pillow.

Sources (icon-template/): deets-head-32.png (his 32 canvas), deets-head-16.png (his 16) and
deets-city-600.png (his Discord server icon: the head on the Skyline1 city, 2026-10-16). In the
600 px art the head is 18 x 15 cells of 20 px at (120, 165) and the city is 5 px cells. A city
frame is a square crop of the art shrunk to its size (the city averaged, as Discord shows it
small), with his head laid on top pixel-true, so the face never blurs. The head alone is
nearest-neighbor only. Every .ico frame is read back and compared.

Writes:
- src-tauri/icons/icon.ico: the exe's icon (Explorer, Alt+Tab, a window without identity).
  16 and 20 the head alone (a city is unreadable there); 24 and up the city.
- src-tauri/icons/tray.ico: the tray and a window's small icon (app_icon.rs). The head alone,
  filling the box (his words: the tray stays the head; the frames fill it like the Beta's).
- src-tauri/identity/Assets/: the identity package's logos (IDENTITY.md §3.1), one PNG per
  exact size, so the taskbar draws each 1:1.
- src-tauri/icons/{32x32, 64x64, 128x128, 128x128@2x, icon}.png, app-icon.png (1024),
  mcpb/icon.png (256): the city. extension/icons/: the head alone (the browser toolbar).
- src-tauri/icons/signin/: the sign-in page's mark, the city at 48 CSS px per screen density,
  and its tab icon (the head).
Not here: icons-beta/ (its look is open), icon.icns (macOS). After it: `npm run signin:assets`
copies app-icon.png and the sign-in marks to the sign-in page; a build picks up both .ico files
(build.rs watches).
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
T = ROOT / "icon-template"
d32 = Image.open(T / "deets-head-32.png").convert("RGBA")
d16 = Image.open(T / "deets-head-16.png").convert("RGBA")
head = d32.crop(d32.getbbox())  # the head alone, 18 x 15 at 1:1
HX, HY = 120, 165  # the head's top-left in the 600 px city art; its cells are 20 px

# The art, with its own black ground carried on below, so a crop may reach past the bottom.
city_art = Image.new("RGBA", (600, 700), (0, 0, 0, 255))
city_art.alpha_composite(Image.open(T / "deets-city-600.png").convert("RGBA"))


def centered(img, size):
    c = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    c.alpha_composite(img, ((size - img.width) // 2, (size - img.height) // 2))
    return c


def grow(img, k):
    return img.resize((img.width * k, img.height * k), Image.NEAREST)


def city(size, x0=60, y0=45, span=480):
    """The span x span crop at (x0, y0), at `size` px, with his head on top pixel-true.

    The default crop holds the head at 18/24 of the width, so the 24 frame has it 1:1, the
    32 at x4/3, the 48 at x2 (option C, his pick)."""
    k = size / span
    small = Image.BOX if size < span else Image.NEAREST
    f = city_art.crop((x0, y0, x0 + span, y0 + span)).resize((size, size), small)
    cell = 20 * k  # one head pixel, in frame pixels
    h = head.resize((round(18 * cell), round(15 * cell)), Image.NEAREST)
    f.alpha_composite(h, (round((HX - x0) * k), round((HY - y0) * k)))
    return f


def city_frame(size):
    if size == 30:
        return city(30, 0, 5, 600)  # the whole art: the head 1:1 (no crop puts it on whole pixels)
    if size == 36:
        return city(36, 120, 105, 360)  # the head x2 edge to edge (his 150 % pick), the city above
    return city(size)


# The exe's icon: one frame per size Windows asks for.
ico = {
    16: d16,  # Explorer's small icon: his hand-drawn 16
    20: centered(d16, 20),
    **{s: city_frame(s) for s in (24, 30, 32, 36, 40, 48, 64, 256)},
}

# The tray and the small window icon: the head alone, as large as each box takes.
tray = {
    16: d16,  # 16 x 15, his own
    20: centered(head, 20),  # 18 x 15, 1:1
    24: centered(head.resize((24, 20), Image.NEAREST), 24),  # x4/3
    30: centered(head.resize((30, 25), Image.NEAREST), 30),  # x5/3
    32: centered(grow(d16, 2), 32),  # his 16 x2: 32 x 30
    36: centered(grow(head, 2), 36),  # x2: 36 x 30
}

# The identity package's logos (IDENTITY.md §3.1): the taskbar, Start and the media flyout pick
# the one made for their size. Below 24 the head alone, like the .ico.
logo_sizes = (16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256)
logos = {s: (tray[s] if s in (16, 20) else city_frame(s)) for s in logo_sizes}
assets = ROOT / "src-tauri/identity/Assets"
assets.mkdir(parents=True, exist_ok=True)
for s, im in logos.items():
    im.save(assets / f"Square44x44Logo.targetsize-{s}_altform-unplated.png")
    im.save(assets / f"Square44x44Logo.targetsize-{s}.png")
city(44).save(assets / "Square44x44Logo.scale-100.png")
city(88).save(assets / "Square44x44Logo.scale-200.png")
city(150).save(assets / "Square150x150Logo.scale-100.png")
city(300).save(assets / "Square150x150Logo.scale-200.png")
city(50).save(assets / "StoreLogo.scale-100.png")

files = {
    "src-tauri/icons/32x32.png": city_frame(32),
    "src-tauri/icons/64x64.png": city_frame(64),
    "src-tauri/icons/128x128.png": city(128),
    "src-tauri/icons/128x128@2x.png": city(256),
    "src-tauri/icons/icon.png": city(512),
    "app-icon.png": city(1024),
    # The browser toolbar shows 16 at 100 % and 32 at 200 %, so 32 is his 16 x2 (the same look).
    "extension/icons/icon16.png": d16,
    "extension/icons/icon32.png": grow(d16, 2),
    "extension/icons/icon48.png": grow(centered(head, 24), 2),  # the extensions page
    "extension/icons/icon128.png": grow(d32, 4),  # the details page and the store
    "mcpb/icon.png": city(256),  # Claude Desktop's extension list
}
for rel, im in files.items():
    im.save(ROOT / rel)

# The hosted sign-in page's mark (DeetsSupport; `npm run signin:assets` copies them): the city
# at 48 CSS px (the head x2 at 100 %), one file per screen density for the page's srcset, so no
# browser rescales it. The tab's icon is his 16 x2: a city is unreadable at tab size, as in
# icon.ico. Apple's Access Request keeps app-icon.png.
SIGNIN_MARK = 48
SIGNIN_DENSITIES = (1, 1.25, 1.5, 1.75, 2, 2.5, 3)
signin = ROOT / "src-tauri/icons/signin"
signin.mkdir(exist_ok=True)
for density in SIGNIN_DENSITIES:
    city(round(SIGNIN_MARK * density)).save(signin / f"mark-{round(SIGNIN_MARK * density)}.png")
grow(d16, 2).save(signin / "favicon.png")


def write_ico(frames, rel):
    order = sorted(frames)
    out = ROOT / rel
    frames[order[-1]].save(out, format="ICO", sizes=[(s, s) for s in order], append_images=[frames[s] for s in order[:-1]])
    back = Image.open(out)
    for s in order:
        back.size = (s, s)
        frame = back.copy().convert("RGBA")
        assert frame.size == (s, s) and frame.tobytes() == frames[s].tobytes(), f"{rel} frame {s} differs"
    return ", ".join(map(str, order))


print(f"[icons] icon.ico ({write_ico(ico, 'src-tauri/icons/icon.ico')}), every frame read back")
print(f"[icons] tray.ico ({write_ico(tray, 'src-tauri/icons/tray.ico')}), every frame read back")
print(f"[icons] {len(files)} PNGs; {len(logos)} identity logos in src-tauri/identity/Assets")
print(f"[icons] sign-in: {len(SIGNIN_DENSITIES)} marks and the tab icon in src-tauri/icons/signin")

# `--site <DeetsSolutions>`: the site's two icons at the exact size they are shown, one file
# per screen density (srcset 1x / 1.5x / 2x), so no browser rescales pixel art. The head at a
# whole-number scale, centered: the DeetsMusic page (72 CSS px) and the home card (56).
if "--site" in sys.argv:
    site = Path(sys.argv[sys.argv.index("--site") + 1]) / "assets" / "deetsmusic"
    site_icons = {72: {1: 4, 1.5: 6, 2: 8}, 56: {1: 3, 1.5: 4, 2: 6}}
    for css, scales in site_icons.items():
        for density, k in scales.items():
            size = round(css * density)
            centered(grow(head, k), size).save(site / f"icon-{size}.png")
            print(f"[icons] site icon-{size}.png: {css} px at {density}x, the head x{k}")
