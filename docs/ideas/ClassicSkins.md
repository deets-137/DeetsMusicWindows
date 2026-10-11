---
status: idea
desk_test: none
sources: [src/surface.ts, src/sound.ts, src/styles.css, src-tauri/tauri.conf.json]
updated: 2026-10-10
---
# Classic skins — Winamp `.wsz` skins for a small player

> **An idea, opened 2026-10-10** in a talk with the owner ("a theoretical chat"), after he
> looked at the Winamp Skin Museum (skins.webamp.org). Nothing is decided and nothing is
> built. Every fork in §8 is his. Do not tell a user the app does this.

## 0. Terms

- **Classic skin (`.wsz`):** a ZIP file of bitmap pictures (`main.bmp`, `cbuttons.bmp`,
  `titlebar.bmp`, `posbar.bmp`, `volume.bmp`, `numbers.bmp`, `text.bmp`, `shufrep.bmp`,
  `playpaus.bmp`, `monoster.bmp`, `eqmain.bmp`, `pledit.bmp` and others) and a few text files:
  `pledit.txt` (the playlist colors), `viscolor.txt` (24 visualizer colors), `region.txt`
  (the outline of a shaped window).
- **Modern skin (`.wal`):** Winamp 3 / 5 skins with their own script language (MAKI). Out of
  scope here; far more work.
- **Webamp:** a rebuild of Winamp 2 in the browser, MIT license, repo
  `github.com/captbaritone/webamp`. Its `packages/skin-database` runs skins.webamp.org.
- **The Museum:** skins.webamp.org, a searchable archive of classic skins.

## 1. The core fact

A classic skin is **not a theme**. It is a set of sprite sheets for **one fixed layout**.
Winamp decides where each control sits; the skin gives only the pictures. The main window is
always 275 × 116 px, and the Play button is always at the same pixel place.

Our Mini is a card layout from tokens, 385 × 550 at its smallest (`MIN_SIZES` in
`surface.ts`), with the cover at its center. Nothing in a `.wsz` maps onto it. So "Winamp
skins for the Mini player" means **a new player window in Winamp's layout** that draws any
classic skin. A skin cannot restyle the existing Mini.

## 2. What maps onto DeetsMusic

| Winamp part | Ours |
|---|---|
| Previous / Play / Pause / Stop / Next | the transport |
| The position bar | the scrubber |
| The volume slider | the volume |
| Shuffle / Repeat | shuffle and repeat |
| The time digits (`numbers.bmp`, `nums_ex.bmp`) | the song time |
| The scrolling title (`text.bmp`, a bitmap font) | the title and artist |
| The EQ window (10 bands + preamp, `eqmain.bmp`) | the Equalizer (SOUND.md). Ours is a free list of bands, so the classic EQ would set ten fixed ones. |
| The playlist window (`pledit.bmp`, `pledit.txt`) | the Queue |
| The visualizer (`viscolor.txt`) | possible: `sound.ts` already makes Web Audio analysers |
| Window shade (275 × 14) | a one-line bar player |
| Eject | open Search or Compass (a choice) |
| The skin's title bar, with minimize and close | the real title bar: our window has no OS frame (`decorations: false`) |

## 3. What does not fit

- **No cover.** The classic window has no place for album art. DeetsMusic is built around the
  cover. This is the largest mismatch.
- **The bitmap font.** `text.bmp` has uppercase Latin letters, digits and some symbols.
  Accents, CJK and emoji need a fallback font (Webamp does this).
- **Balance, kbps / kHz, mono / stereo.** Apple's stream gives no balance control. These show
  fixed values or are hidden.
- **The visualizer costs.** The Web Audio graph runs only when a feature needs it
  (`sound.ts`, the `needed` test near line 78). A visualizer keeps it on while music plays.
  That touches the sound chain (AUDIO-QUALITY.md) and needs a measurement first.
- **Size.** 275 × 116 is very small on a high-DPI screen. The window needs whole-number
  scaling (2×, 3×) with `image-rendering: pixelated`, like Webamp's double size.

## 4. How it could be built

- **Webamp itself does not fit.** It is a whole player with its own `<audio>` element.
  MusicKit plays DRM audio through its own path, so Webamp cannot play our music.
- **Our own renderer, with Webamp as the reference (MIT, credited):**
  - Open the ZIP with a small library. Chromium decodes BMP natively. File names in skins
    vary in case; match them without case.
  - Use Webamp's table of sprite positions for each part.
  - Draw with CSS sprites; wire each hit region to the existing player calls.
  - A missing bitmap falls back to **our own drawn default**. Nullsoft's base skin is not
    ours to ship.
- **Rust:** only the window (its size, an optional shaped outline from `region.txt`) and a
  folder for the user's skins.
- **It is a surface,** not a row: its own window size, keyboard keys, right-click menus and
  memory (SURFACES-AND-CARDS.md §5, the eight systems).

## 5. A smaller first step: a theme from a skin

`pledit.txt` gives five colors (normal text, current text, normal background, selected
background, the font name) and `viscolor.txt` gives 24. They can fill the Skinz theme slots
(SKINZ.md) as a "theme from a classic skin", the way the Album theme takes its colors from the
cover. It needs no new window and no sprite work. The classic window can come later.

## 6. Rights and the name

- **Each skin is its author's artwork.** Most were shared freely; few carry a clear license.
- **A skin the user loads** (drag and drop, a file picker) is like a media player opening a
  file: the user's choice and the user's file.
- **Skins shipped in the app, or a Museum browser inside the app,** need a check of the
  Museum's terms first, and probably a word with its maintainer.
- **The name.** "Winamp" is a trademark; the Webamp README says the Winamp name and interface
  are likely Nullsoft's property. Call the feature "classic skins (.wsz)", never "Winamp mode".

## 7. Not checked yet

The Museum's pages render in the browser, so a plain fetch read only the title (2026-10-10).
Not confirmed: the number of skins, a public API for other apps, the Museum's terms of use,
and how it handles a takedown. Read these before fork 2 is decided.

## 8. The forks (his)

1. **What it is:** a full classic set (the main window, and optional EQ and Queue windows) ·
   the main window only · the colors only, as a theme (§5).
2. **Where the skins come from:** the user loads files · a link out to the Museum · a
   browser inside the app (needs §6 and §7 first).
3. **Where it lives:** a new surface beside Mini · a Mini view (like the player view) · a
   separate small window of its own.
4. **The visualizer:** in the first version · later, after the sound-chain measurement.
5. **Eject:** Search · Compass · hidden.

## 9. Reading of value (2026-10-10)

It fits the power-user side of the app (Rulez, Skinz) and has a strong nostalgia pull. The
theme (§5) is cheap. The full classic window is roughly the size of a new surface, and it
drops the cover, which is the center of the app's identity today.
