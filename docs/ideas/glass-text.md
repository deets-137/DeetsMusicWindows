---
status: idea
desk_test: none
sources: [src/styles/skin.css, src/styles.css, docs/ops/checks/layers.mjs, scripts/webview-eval.mjs]
updated: 2026-11-01
---
# Glass text: sharp text on smooth glass

**An idea (2026-11-01), investigated with him; nothing is built.** He said the Glass skin looks
low DPI: the text and the card corners are not as sharp as he expected. This doc records why,
the probes that showed it, and the route he chose: canvas-drawn lists first, our own GPU
renderer only if it comes to it.

**The terms.**
- *ClearType:* Windows' sharp text smoothing. It mixes red, green and blue at each edge pixel on
  their own, so a letter's edge shows color fringes when magnified.
- *Grey smoothing:* one shade of grey at each edge pixel. Softer at 100 % scaling.
- *A layer:* a picture Chromium draws once and the GPU then moves or blends. A list that scrolls
  on the GPU is a layer (`will-change: scroll-position`, the `--scroller-layer` token).
- *Opaque:* nothing shows through. *See-through:* the canvas or aurora shows through.

## 1. His calls (2026-11-01)

1. **Start with canvas-drawn lists** (§5). If it comes to it, later consider our own GPU
   renderer (§6).
2. **Not now.** Design and build in a later sitting.
3. The two directions inside today's CSS (a solid list base with a frost glaze; a list layer
   only while it scrolls) **cost too much** (his words: "both of these seem to have too many
   costs"). See §4.

## 2. What we found

His main screen is 3440 × 1440 at 100 % scaling (96 DPI). His second screen is 1080 × 1920,
portrait. At 100 %, the kind of smoothing decides how sharp text looks.

**Almost no Glass text gets ClearType.** In one screenshot of the dev app (Glass, Black & Red,
Fancy Glass off, Canvas covers), the Queue's opaque now-playing row had ClearType, and all text
on the glass had grey smoothing (0 % of bright text pixels with color fringes).

**The rule.** Chromium can draw ClearType only where the text is drawn into a layer with an
opaque pixel behind it. A see-through layer is drawn before the GPU knows what is behind it, and
the GPU blends it with one alpha per pixel, not three. So text on a see-through layer is grey.
This is a limit of how GPUs blend layers, not a Chromium setting.

**What makes the Glass cards layers** (`docs/ops/checks/layers.mjs` lists them):

| Source | Where | Effect |
|---|---|---|
| The aurora blobs' `will-change: transform` | `.aurora__blob`, full window | everything above them becomes a layer (`Overlap`), even with Fancy Glass off, when the blobs do not move |
| The album aurora's spin | `.np__aurora::before`, 1099 px square, 30 s loop | Chromium cannot know where a turning layer goes, so every card drawn after it becomes a layer |
| The lists' scroll layers | `--scroller-layer: scroll-position` | his call 2026-10-11 for smooth scrolling (skin.css says the price is grey list text) |
| Fancy Glass on | `backdrop-filter` on each card | each card is a layer by nature; no fix inside Chromium |

**The probes** (each was a style added to the dev app for a moment and then removed):

| Probe | ClearType pixels (Library row / Settings row) |
|---|---|
| Today | 0 % / 0 % |
| Aurora spin paused only | 0 % / 0 % |
| All three sources off | 65 % / 57 % |
| Blobs flat, list layers off, Now Playing card drawn last (`z-index`), spin on | 65 % / 57 % |
| List layer kept, solid opaque list background | 65 % on the Library list |
| List layer kept, solid base + a 35 % frost glaze above it that does not scroll | 45 % |
| Opaque background on each row in a see-through list | 0 % (rows split into layers) |
| Opaque canvas (`alpha: false`), own layer, gradient behind the text | 56 % |
| See-through canvas, own layer | 3 % |

**The corner.** The card edge is 1 px of the theme red at 30 % on an 18 px radius. At 100 %
scaling a thin, bright curved line shows steps. The layers do not change it.

**The font.** Glass uses the base `--font-body`, "Liberation Sans". It is installed on his PC
only; a user without it gets Arial. Both look thin and jagged at 100 %. The skin's comment asks
for "a crisp, light modern sans".

## 3. What Liquid Glass does (Apple, WWDC 2025)

Apple has not published the code; this is what Apple said and what the devices show.
1. It bends the content behind it near the edge (a lens), and is almost clear in the middle.
2. The edge is a light, not a line: a specular highlight that fades around the curve.
3. It adapts its tint, shadow and symbol color to the content behind it.
4. **Glass is only the navigation layer** (bars, sidebars, controls, menus), floating over the
   content. Lists and text are the content layer, and are not glass. Content scrolls under the
   glass.
5. macOS has used only grey smoothing since 2018. The text is sharp from 2–3× pixel density.

Our Glass skin does the reverse: it puts the lists on the glass. WebView2 (Edge 156) accepts SVG
filters in `backdrop-filter` (`CSS.supports` checked 2026-11-01), so a real lens can be drawn.

## 4. Inside today's CSS (both turned down)

- **Solid base, glass glaze:** the list layer gets a solid base made from the card's frost
  colors, and a faint frost copy above the list that does not scroll. ClearType and smooth
  scroll both hold (probe above). Cost: under a list the glass is a solid base with a glow; the
  glaze lowers text contrast.
- **The layer only while scrolling:** add the layer on the first wheel turn, drag or key, remove
  it about 1 s after. Cost: the first frame is drawn the slow way, the text is grey while it
  moves, and it visibly sharpens when the list stops.
- His idea, a transparent content box above the glass card, is the same two cases: as one
  layer it is sharp but scrolls the slow way (24–56 % of frames dropped at 240 Hz, 2026-10-11);
  as its own layer it scrolls smoothly with grey text.

## 5. Canvas-drawn lists (his first route)

**The idea.** A canvas made with `getContext("2d", { alpha: false })` is an opaque layer, so its
text keeps ClearType over any picture we draw, not only a solid color (probe: 56 %). We know
everything behind a card: the aurora's gradients, the theme roles, the album colors, the
wallpaper picture and the frost. So the canvas draws an exact copy of the glass behind the
list, then the rows on top, in one opaque layer, and redraws on each scroll frame. About 20
rows are visible, so a redraw should be cheap.

**Start with one list** (the Library) and measure before any other list moves.

**What a canvas list must do that the DOM gives today** (SURFACES-AND-CARDS.md §5, the eight
systems): right-click menus (`media-menu.ts`), arrow keys (`list-keys.ts`), Ctrl / Shift picks
(`row-pick.ts`), drag and drop (`row-drag.ts`), hover hints (`hint.ts`), hover and focus marks,
cover art, the windowing (LIBRARY-VIRTUALIZATION.md), screen-reader access, card memory.

**The open questions** (forks for the design sitting):
- C1. **Who owns the scroll.** If the browser scrolls an invisible DOM list on the GPU while the
  canvas redraws on the main thread, the canvas can lag one frame. Options: the canvas owns the
  scroll (wheel, keys, the scrollbar) and the DOM rows follow it from the same frame; or the DOM
  scrolls and the canvas follows (the lag risk).
- C2. **The DOM's part.** Keep an invisible DOM list on top for hit-testing, menus, keys, drags
  and the screen reader (text `color: transparent`), or rebuild those for the canvas.
- C3. **The glass copy.** Draw the frost in the canvas from the same tokens (one source of
  truth: read the computed `--aurora-*` and `--canvas-*` values), and redraw on a theme, album or
  wallpaper change, with the crossfade the CSS has today.
- C4. **The cost gate.** `src/frames.ts` must show no drop at 240 Hz on a fast scroll of the
  3,895-row library, on `dev:built` (CLAUDE.md, graphics rules). The probe has not measured it.
- C5. **Motion.** Rows that enter (`enterRows`), the hover lift, a drag's lift: canvas versions,
  or the DOM layer draws the moving row and the canvas leaves a gap.

## 6. Our own GPU renderer (only if it comes to it)

A native renderer (Direct3D or wgpu) redraws the whole frame every frame: canvas, then glass
(blur, lens, rim), then **the text last onto the finished frame**. With dual-source blending the
shader gives a separate alpha per color channel, so text is ClearType over moving glass. Glyphs
come from DirectWrite's ClearType coverage, kept in a texture.

- **Also gives:** a real lens from a signed distance field, a rim light instead of a 1 px line,
  corners drawn by math at sub-pixel precision.
- **Limits that stay:** text that turns or scales cannot be ClearType while it moves; the
  portrait screen's sub-pixels run top to bottom (per-monitor settings, or grey there).
- **What stays:** a hidden WebView2 for MusicKit playback (the `--hidden` launch plays already);
  the Rust back end, SQLite, the bridge and MCP, AirPlay, Last.fm, the workers.
- **What is rewritten:** the front end (about 80,000 lines of TypeScript and 10,600 of CSS on
  2026-11-01) on a toolkit: GPUI (Zed's), Slint or Iced, or our own layout. Built from nothing:
  UI Automation, IME, selection, scroll physics, hints, focus.
- **What splits off:** Web Rooms, the web demo, the shots runner and the copy editor reuse the
  TypeScript UI in a browser today.

## 7. Small pieces, any route

These help whichever route is built. Each is his call before it is built.
- **The aurora blobs** lose `will-change` while Fancy Glass is off (they do not move then).
- **The Now Playing card drawn above the other cards**, so the album aurora's spin stops
  splitting the window. Its glow and drop shadow then draw over the next cards' edges: his look.
- **The font (fork):** Segoe UI Variable Text for Glass (Metal uses it), or keep Liberation Sans.
- **Grey text contrast (probe):** Chromium's `--text-contrast` / `--text-gamma` through WebView2's
  browser arguments may firm up grey text everywhere, including Fancy Glass. Not confirmed that
  WebView2 takes them; needs a dev app restart to test.
- **The rim:** a highlight that fades around the corner, from theme roles, in place of the 1 px
  line.

## 8. Ruled out

- An opaque background on each row (probe: no ClearType).
- The frost pinned to the window (`background-attachment: fixed`) inside a list: every scroll
  step repaints, the frame drops of 2026-10-11.
- Drawing at 2× and scaling down: blurrier text, 4× the drawing (reasoned, not probed).
- Electron or CEF in place of WebView2: the same Chromium compositor, the same rule.
