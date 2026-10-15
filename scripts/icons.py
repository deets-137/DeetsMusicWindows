"""`python scripts/icons.py` — every DeetsMusic icon from the owner's two drawings
(docs/ideas/whitelabel.md §10.6). Needs Python 3 with Pillow (`pip install pillow`).

Sources: icon-template/deets-head-32.png (his 32 canvas) and deets-head-16.png (his 16).
Scaling is nearest-neighbor only, so every pixel stays one of his; a size that is not a whole
multiple of a drawing gets its own rule below. Every .ico frame is read back and compared.

Writes: src-tauri/icons/{icon.ico, 32x32, 64x64, 128x128, 128x128@2x, icon}.png,
app-icon.png (1024), extension/icons/icon{16,32,48,128}.png, mcpb/icon.png (256).
Not here: icons-beta/ (scripts/beta-icon.ps1, its look is open), the Square*Logo set (the
Store, unused by NSIS), icon.icns (macOS). After it: `npm run signin:assets` copies
app-icon.png to the sign-in page; a build picks up the .ico (build.rs watches it).
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
d32 = Image.open(ROOT / "icon-template/deets-head-32.png").convert("RGBA")
d16 = Image.open(ROOT / "icon-template/deets-head-16.png").convert("RGBA")
head = d32.crop(d32.getbbox())  # the head alone, 18 x 15 at 1:1


def centered(img, size):
    c = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    c.alpha_composite(img, ((size - img.width) // 2, (size - img.height) // 2))
    return c


def grow(img, k):
    return img.resize((img.width * k, img.height * k), Image.NEAREST)


i24 = centered(head, 24)

# The .ico: one frame per size Windows asks for (app_icon.rs loads them by size).
ico = {
    16: d16,  # the tray and title bar at 100 %: his hand-drawn 16
    20: centered(d16, 20),  # 125 %: his 16, centered
    24: i24,  # the taskbar at 100 % and the tray at 150 %: the head 1:1, centered
    30: centered(head, 30),  # the taskbar at 125 %: no whole-number scale fits, so the head 1:1
    32: d32,  # his canvas
    36: centered(grow(head, 2), 36),  # the taskbar at 150 %: the head x2, edge to edge (his pick)
    48: grow(i24, 2),  # 32 -> 48 is no whole number, so the 24 x2
    64: grow(d32, 2),
    256: grow(d32, 8),
}

files = {
    "src-tauri/icons/32x32.png": d32,
    "src-tauri/icons/64x64.png": grow(d32, 2),
    "src-tauri/icons/128x128.png": grow(d32, 4),
    "src-tauri/icons/128x128@2x.png": grow(d32, 8),
    "src-tauri/icons/icon.png": grow(d32, 16),
    "app-icon.png": grow(d32, 32),
    # The browser toolbar shows 16 at 100 % and 32 at 200 %, so 32 is his 16 x2 (the same look).
    "extension/icons/icon16.png": d16,
    "extension/icons/icon32.png": grow(d16, 2),
    "extension/icons/icon48.png": grow(i24, 2),  # the extensions page
    "extension/icons/icon128.png": grow(d32, 4),  # the details page and the store
    "mcpb/icon.png": grow(d32, 8),  # Claude Desktop's extension list
}
for rel, im in files.items():
    im.save(ROOT / rel)

order = sorted(ico)
out = ROOT / "src-tauri/icons/icon.ico"
ico[order[-1]].save(out, format="ICO", sizes=[(s, s) for s in order], append_images=[ico[s] for s in order[:-1]])

back = Image.open(out)
for s in order:
    back.size = (s, s)
    frame = back.copy().convert("RGBA")
    assert frame.size == (s, s) and frame.tobytes() == ico[s].tobytes(), f"icon.ico frame {s} differs"
print(f"[icons] {len(files)} PNGs + icon.ico ({', '.join(map(str, order))}), every frame read back")
