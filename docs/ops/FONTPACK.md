---
status: built
desk_test: passed 2026-11-04
sources: [scripts/fontpack.py]
updated: 2026-11-04
---
# Fontpack — a font from sheets drawn in Krita

`scripts/fontpack.py` makes blank sheets for Krita. It then reads the drawn sheets and builds a
TTF and a WOFF2. The script is a tool for this PC. It is not part of the app, and the app does
not load it.

Install what it needs once:

```bash
python -m pip install fonttools brotli pillow numpy potracer
```

`potracer` is under the GPL. That applies to the tool. It does not apply to a font you make.

## 1. The steps

1. Start a font. Keep the folder outside this repo, because the drawings are large:

   ```bash
   python scripts/fontpack.py new "C:\Users\Aditya Sundaram\Documents\DeetsFonts\deets-hand" --family "Deets Hand"
   ```

2. Open a sheet from `templates\` in Krita. Add a new paint layer. Draw on it in black.
3. Save your work as `.kra`, then use File › Export to save a PNG into `drawn\` with the same
   name as the template. You can leave the guides on. The build ignores them.
4. Build:

   ```bash
   python scripts/fontpack.py build "C:\Users\Aditya Sundaram\Documents\DeetsFonts\deets-hand"
   ```

5. Read the `check:` lines. Open `out\proof.html` to see the font at real sizes.
6. Redraw a letter, export, and build again. Only changed cells are traced again.

You do not need all the sheets to start. A build uses the sheets that exist and skips empty
cells. It lists what is missing.

## 2. The folder

| Path | What it holds |
|---|---|
| `font.json` | the family, style, weight, guide heights, version, designer and license |
| `spacing.json` | sidebearings and kerning (§4) |
| `templates\` | the blank sheets |
| `drawn\` | your PNG exports |
| `out\` | the TTF, the WOFF2, `proof.html`, `fontface.css` |
| `.cache\` | traced cells; safe to delete |

## 3. The sheets

Each sheet is 7000 × 4000 px: 7 × 4 cells of 1000 × 1000 px. One pixel is one font unit, so a
cell is one em. Do not scale or crop a sheet. The build refuses a sheet of another size.

| Sheet | Holds |
|---|---|
| `1-capitals` | A–Z |
| `2-lowercase` | a–z |
| `3-digits` | 0–9 and common punctuation |
| `4-symbols` | the rest of ASCII, and € £ ¢ © ® ™ ° × · • |
| `5-quotes-letters` | curly quotes, dashes, …, ¡ ¿ « », ß æ œ ø and similar letters |
| `6-accents` | the 12 accents (the grave is on sheet 4) |

The lines in a cell, from the top: cap height, x-height, baseline (the strongest line). The
bottom edge of the cell is the descender limit.

- **Ink:** anything darker than mid gray is ink. The blue guides are paler, so they drop out.
- **Transparent paper:** this counts as white.
- **Heights:** the build keeps each drawing's height in the cell. It moves a drawing only left
  or right.
- **Guide heights:** change `xHeight` or `capHeight` in `font.json`, then run `sheets`. This
  replaces `templates\` only. It never touches `drawn\`.

**Accents.** Draw an accent where it sits on a lowercase letter: above the x-height, or below
the baseline for ¸ and ˛. The build then composes the accented letters from the base letter and
the accent, and it raises the accent for capitals and tall letters. A redraw of `e` changes
é, è and ê too. For í and ĵ it uses the dotless ı and ȷ.

## 4. Spacing and kerning

The build reads all spacing from `spacing.json`, so a rebuild never loses it.

```json
{
  "default": { "lsb": 50, "rsb": 50 },
  "space": 260,
  "glyphs": {
    "HIMN": { "lsb": 70, "rsb": 70 },
    "M": { "rsb": 60 }
  },
  "kerning": { "A V": -80, "T o": -70 }
}
```

- `lsb` and `rsb` are the left and right sidebearings, in font units.
- A key in `glyphs` can hold many letters. A later key overrides an earlier one.
- An accented letter takes its base letter's spacing and kerning.
- The starter values suit a hand without serifs. A hand with serifs needs smaller values.

**With FontForge.** Open the TTF from `out\`, set the spacing and kerning there, and generate a
TTF. Then copy the values back:

```bash
python scripts/fontpack.py pull "C:\Users\Aditya Sundaram\Documents\DeetsFonts\deets-hand" "C:\path\to\edited.ttf"
```

`pull` replaces `glyphs` and `kerning` in `spacing.json`. It reads spacing only. A curve edited
in FontForge stays in that file, and the next build does not have it. Fix a curve in Krita, or
treat the FontForge file as the final one.

## 5. Put the font in the app

1. Copy the WOFF2 to `src/styles/fonts/`.
2. Copy the rule from `out\fontface.css` to `src/styles/fonts.css`.
3. Name the family in a skin's `--font-title` or `--font-body` in `src/styles/skin.css`. Keep
   fallback fonts after it.
4. With one weight, set `--fw-title: 400`, or the browser fakes a bold.

A bundled font needs no CSP change (`font-src` holds `'self'`). A user cannot load a font file
yet: that is `ideas/mods.md` §6.3.

## 6. Limits

- The font has no hinting. Test it at the size you will use.
- The font has no ligatures and no alternate letters.
- There is one font per folder. A pack is one folder for each font.

## 7. Desk test

1. Run `new`, and open a sheet in Krita. The sheet opens at 7000 × 4000 px.
2. Draw n, o, H and O, and export both sheets. Run `build`.
3. The report lists the four letters and the missing ones. `proof.html` shows them.
4. Change a sidebearing in `spacing.json`, and build. The proof shows the change.
5. Change one letter in FontForge and run `pull`. Build. The spacing stays.

The script passed a full run on 2026-11-04 on sheets filled from Liberation Serif: 144 drawn
glyphs, 169 composed letters, RGBA and 16-bit gray exports, a speck, a stroke over a cell edge
and `pull` from its own TTF. A real Krita export and a FontForge file have not been tried.

Marked desk tested 2026-11-04 (his call: not a priority now). Steps 1 to 5 run on real sheets when
the first font starts.
