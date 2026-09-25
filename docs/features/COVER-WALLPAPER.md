---
status: built
desk_test: open
sources: [src/wallpaper.ts, src/wallpaper-worker.ts, src-tauri/src/wallpaper.rs, src/album-color.ts, src/album-slots.ts, src/styles/skin.css, src/styles.css, src/settings-card.ts, src/settings-store.ts]
updated: 2026-09-25
---
# DeetsMusic — Cover Wallpaper (the Glass canvas as a picture: covers or your own)

> Under the Glass skin, the canvas behind the cards shows a picture made from the album covers:
> the current album's cover large, and the next albums in the queue as tiles around it. An
> aurora colored from the album glows over the picture. The picture changes when the album
> changes. Read with [ALBUM-COLOR.md](ALBUM-COLOR.md) (the palette and the NP aurora),
> [PLAYLISTS.md](PLAYLISTS.md) §11 (the mosaic worker) and
> [UI-ARCHITECTURE.md](../architecture/UI-ARCHITECTURE.md) (the canvas tokens).
> Status: ✅ decided · 🔵 open · ⬜ later.

---

## As built (2026-09-24) — read this first

> **Part:** built · 2026-09-24 · desk test §6 open

Where this section and the design below disagree, this section is the code.

- **Files.** `src/wallpaper.ts` (the layout, the slots, the fades, the colors, Choose / drop),
  `src/wallpaper-worker.ts` (the soft copy), `src-tauri/src/wallpaper.rs` (the user picture on
  disk and the `wallpaper` link scheme), `paletteFromPixels` in `album-slots.ts`. The layer is
  `<div class="wallpaper">` in index.html, before `.aurora`.
- **1A and 1B are both in.** 1A is the **Tiles** row's first choice, **One cover** (the cover
  alone, `cover`-fitted to the window). Four choices make the Tiles row a small menu, not a
  pill. **His call at the desk test (2026-09-24): the mosaic stays the default (Tiles: Some),
  and One cover stays as a choice.**
- **The layout (§3.2) is a grid, not the worker's cut-the-rectangle rule.** A grid of square
  cells covers the canvas (centered, overhanging the edges a little). The anchor takes a k × k
  block, k ≥ 2, `--wallpaper-anchor-share` (0.6) of the short side, at
  `--wallpaper-anchor-rise` (0.3) down the free rows. The other cells join into 1×1, 2×1, 1×2
  and 2×2 tiles until there are about as many as the Tiles row asks (a few more when the grid
  cannot join enough). Why: the cut rule made thin strips around a large anchor; the grid keeps
  every tile near square. The tiles are ordered nearest to the anchor first, so the queue's
  next album sits next to the playing one. The seed is the size and the count (§3.1).
- **The picture set.** The queue's upcoming entries, then the rest of the plan, then history
  newest first; distinct covers; the anchor excluded. Fewer than the slots: the set repeats.
- **The sharp copy** loads Apple's cover links directly as each tile's background, at fetch
  steps 120 / 240 / 480 / 720 / 1000 / 1400 px (the tile's size × the display scale). Every new
  picture is decoded before its fade starts (at most 3 s).
- **The soft copy** is drawn at a quarter of the canvas size, blurred by `--wallpaper-blur`
  (28 px) and saturated by `--glass-frost-sat`, from the same links (the HTTP cache serves
  them). It is not drawn with Fancy Glass on. It sits in `--glass-frost-paint` as its own layer,
  between the aurora copy and the ground. Glass always carries that layer (a transparent stand-in
  when there is none), so the layer count never changes and a change can crossfade.
- **The swap (his call 2026-09-24, after the first look: "the center tile is the one getting
  replaced every time").** On an album change the new album grows out of its tile into the
  center, AND the old center album shrinks into that tile: the two trade places, and nothing
  leaves the mosaic. A jump to an album with no tile sends the old one to the nearest tile that
  is no longer wanted; with none free, it fades out. A moving cover flies at full opacity, above
  the other tiles (the tiles no longer clip). The swapped-out album is history, so at the next
  album change its tile goes to a queue album, as before.
- **The fades.** Tiles: `element.animate` (opacity + `--wallpaper-tile-scale`, or a grow from the
  anchor's old tile box). The whole layer (in, out, a new size, a new count, a new picture): an
  opacity fade of `--wallpaper-fade-dur`. The cards' frost and the aurora colors: for one fade,
  `<html data-wall-fade>` turns on a `background-image` transition on `.panel` and
  `.aurora__blob` (styles.css), which Chromium draws as a crossfade. Only inside that window, so
  a slider drag or a look change never waits on it. Reduced motion: every fade is a snap.
- **The aurora colors (§3.4).** New tokens in the Glass block: `--canvas-go` / `--canvas-stop` /
  `--canvas-pause` (the theme's go / stop / pause by default). The aurora blobs and the frost's
  aurora copy read them. `wallpaper.ts` sets them on `<html>`: the rim (the most colorful) on go,
  the halo on stop, the rest on pause. The NP card's own `--album-*` props are untouched.
- **The dim (row 7).** `[data-wallpaper]` with Fancy Glass off locks `--glass-dim` to
  `--wallpaper-canvas-dim` (15, his desk-test value, 2026-09-25). Fancy Glass on keeps the slider.
- **A user picture (§8).** Choose (the Picture row's action) or a file dropped on the row. The
  page resizes it to at most 2560 px and reads its colors from a 48 × 48 copy
  (`paletteFromPixels`: twelve hue bins weighted by chroma; the three heaviest). `wallpaper_set`
  (async, off the UI thread) writes `wallpaper.jpg` and `wallpaper.json` in the app data folder;
  the settings key `glassPicture` holds the stamp. The page shows
  `http://wallpaper.localhost/<stamp>`.
- **Hidden window.** `data-ambient="paused"` (ambient.ts): nothing is drawn; the change is drawn
  once on show.
- **Telemetry.** `diag.log`: `wallpaper:draw` (why, mode, tiles, changed slots, ms, size),
  `wallpaper:soft` (tiles, ms, KB), `wallpaper:soft-failed`, `wallpaper:picture`, `wallpaper:off`.
  `[perf] frames wallpaper` for each fade (enter, leave, tiles, frost).
- **Diffusion** (his ask, 2026-09-24: "so it doesn't feel as sharp / high res"; his calls: a soft
  blur, as a slider). A `filter: blur()` on `.wallpaper__set`, 0–100% of
  `--wallpaper-diffusion-max` (20 px); default 30 (≈ 6 px). The set is static between changes,
  so the blur is drawn once, and again only while a fade runs. The picture runs
  `--wallpaper-bleed` (48 px) past the window on every side, so the blur never darkens the
  window's edge. Fancy Glass's live frost blurs the diffused layer. The cards' soft copy
  (28 px) is already softer than any Diffusion value, so it does not change.
- **Settings rows** (Skin settings, Glass only, before Fancy Glass): Canvas, Tiles (Covers),
  Picture (Picture), Diffusion (Covers or Picture), Aurora color (Covers or Picture). Each wears the New badge. A row a choice
  reveals now slides in through `enterRows` — this applies to every Settings row that a choice
  shows (Sand width, the Press record rows too).

### Decided inside his calls (for his review)
- The layout is a grid of near-square cells (above), not the cut-the-rectangle rule.
- 1A lives in the Tiles row as "One cover", not in the Canvas pill.
- The four Glass canvas rows sit at the top of the Glass rows, before Fancy Glass.
- The Tiles row, Picture row and Aurora color row each wear the New badge, like Canvas.
- Diffusion: the row sits after Picture, before Aurora color; 100% = 20 px; default 30% (the
  "about 6 px" of the option he picked); it is not locked with Fancy Glass off; it wears the New
  badge; the Skin settings reset group resets it.
- Tokens, to tune at the desk test: anchor 0.6 of the short side, 0.3 down; tile fade 0.9 s,
  scale 1.04; layer and frost fade 0.8 s; blur 28 px; the locked dim 35 (he set it to 15 at the
  desk test, 2026-09-25).
- A queue shorter than the tile count repeats its covers instead of leaving tiles empty.
- The reset group "Skin settings" now resets Canvas, Tiles and Aurora color. It does not remove
  the chosen picture file.
- No toast on a good picture choice (the canvas changes); the two failure toasts reuse the
  playlist cover's words.
- An agent can set the three pills but cannot choose the picture.

---

## 0. Terms

- **Canvas** — the app background behind the cards. `.app-body` paints `--app-canvas-bg`.
  Glass sets that to `none` and paints its **aurora** (three blobs, `--aurora-1..3`) on the
  `.aurora` layer.
- **Frost** — what a Glass card shows through itself. Two forms (skin.css, Glass block):
  - **Painted** (Fancy Glass off, the default). Each card paints its own copy of the canvas
    (`--glass-frost-paint`), pinned to the window with `background-attachment: fixed`. **No
    blur.** The sliders are locked to `GLASS_LOCKED` (settings-store.ts).
  - **Live** (Fancy Glass on). A real `backdrop-filter` blur. It fails on WARP (no GPU).
- **Wallpaper** — the picture this doc adds. **Sharp copy** = what the gaps show. **Soft copy** =
  the same picture blurred, which the cards paint.
- **Anchor** — the album that plays now. **Tiles** — the other albums in the picture.

## 1. Decisions (the owner, 2026-09-24)

| # | Fork | Choice |
|---|---|---|
| 1 | Layout | ✅ **B — mosaic**: the anchor large, the queue's next albums as tiles around it. **A — one cover alone** gets built too, for a side-by-side desk test (§6). He suggested the mosaic because one picture might not fill the screen. |
| 2 | The aurora | ✅ **B — keep it, colored from the album**, over the wallpaper. |
| 3 | When it redraws | ✅ **B — when the album changes**, with a crossfade. A queue edit alone does not redraw. |
| 4 | Scope | ✅ **A — Glass only**, one row in Skin settings. |
| 5 | Tile count | ✅ **A Settings pill "Few \| Some \| Many"** = 6 / 12 / 20, default Some (12). |
| 6 | Tile motion | ✅ **A gentle animation** when a picture enters or leaves the mosaic (§3.5). |
| T | Motion shape | ✅ **A — tiles stay in place.** An album still in the set keeps its tile. Only the tiles that change animate (§3.5). |
| 7 | Dim with the wallpaper (Fancy Glass off) | ✅ **B — a higher locked value** while the wallpaper is on. The value is set at the desk test. |
| 8 | Nothing playing | ✅ **B — back to the plain aurora**, with a gentle animation. |
| 9 | The row | ✅ Replaced by U1: one pill **"Canvas: Aurora \| Covers \| Picture"**, default Aurora (the toggle "Show covers behind cards" was chosen first, then folded into the pill). |
| U1 | User picture: the row | ✅ **A — the Canvas pill** (row 9). Picture shows a Choose button below the pill; a file dropped on the row works too. |
| U2 | User picture: skins | ✅ **A — Glass only**, like the covers. |
| U3 | User picture: how many | ✅ **A — one picture.** A set is ⬜ later. |
| U4 | User picture: aurora color | ✅ **A — from the picture** (a local color reader, 0 API calls), **and a Settings row** so the user can pick the theme colors instead (B). |
| U5 | User picture: fit | ✅ **A — fill the window, centered.** A focal point is ⬜ later. |

## 2. What exists already (read 2026-09-24)

- **The drawing.** `mosaic-worker.ts` draws up to 100 covers into one JPEG in a worker. It
  fetches from Apple's image server, which answers `Access-Control-Allow-Origin: *` with a long
  max-age, so the webview's HTTP cache serves repeats. `mosaic.ts` runs it only in idle time
  and only while the window shows. The result is an object URL in memory. It is never saved,
  so no picture made from Apple's artwork is stored. The wallpaper keeps all of these rules.
- **The layout.** `layout()` in the worker cuts a **square** into tiles, seeded so one seed
  always gives the same picture. The window is not square (mini 480×864, max wide), so the
  wallpaper needs a rectangle layout (§3.2).
- **The palette.** `lookupPalette()` (album-color.ts) reads the Rust cache first, then asks
  Apple once (`album_palette`). The NP card and the Ocean sea already share one promise per
  cover. The wallpaper is a third reader of the same promise: **0 new Apple calls** when the NP
  card is open, and at most 1 per new album when it is not.
- **The covers.** Queue and history tracks carry `artwork.urlTemplate` already. **0 API calls**
  to know the tiles.

## 3. The design

### 3.1 The picture set
- **Anchor**: the current track's cover (`currentCover()`).
- **Tiles**: the next distinct albums in the queue, in queue order. If the queue gives fewer
  than the layout needs, fill from history, newest first. Duplicate albums count once.
- **Tile count**: the Tiles pill (row 5): 6 / 12 / 20, default 12.
- **Seed**: the window size and the tile count, not the album. The slots stay fixed while the
  albums move through them (T-A, §3.5).

### 3.2 The layout (1B)
- The anchor sits at the window's upper-center, where the Glass aurora's brightest blob is
  now. It is the largest tile, sized by the window's short side.
- The tiles fill the rest with the worker's cut-the-rectangle rule, extended from a square to
  a `w × h` rectangle. The layout reads the window size at draw time. A window resize redraws
  (debounced), because a stretched picture looks wrong.
- **1A** is the same code with a tile count of 0: the anchor alone, `cover`-fitted to the
  window. §6 compares the two.

### 3.3 The two copies
- The **sharp copy** is a new `.wallpaper` layer, under `.aurora`, in the canvas. It holds
  **one element per tile** (the layout's rectangles, `position: absolute`), so one tile can
  animate alone (§3.5). A baked picture cannot do that.
- The **soft copy** is one baked picture. The worker draws the same layout, then blurs it
  (`ctx.filter = "blur(…)"`). One object URL comes back. Under the blur, the moment when the
  cards change is not visible, so the soft copy crossfades as a whole.
- The **soft copy** joins `--glass-frost-paint` as its bottom layer, with the same
  `--glass-frost-layer` geometry (`fixed`), so each card shows a blurred picture that lines
  up with the one in the gaps. This keeps the painted frost at zero cost per frame: nothing
  redraws when a list scrolls.
- Under Fancy Glass, the live frost blurs the tile layer itself. The soft copy is not needed.
- The blur radius is a skin token (`--wallpaper-blur`), read by JS and passed to the worker.

### 3.4 The aurora over it (2B)
- The canvas aurora stops read `--album-c1` / `--album-c2` / `--album-bg` instead of
  `--go` / `--stop` / `--pause` while the wallpaper is on. Today those props are set on the NP
  card only (`watchAlbumColor`). The wallpaper sets them on `<html>` through the same
  `auroraSlots()` rule, so the NP card and the canvas agree.
- `--glass-frost-paint` has its own copy of the three gradients. Both copies change together
  (the comment in skin.css already asks for this).
- No album → the theme stops come back. The canvas is exactly today's Glass.

### 3.5 When it redraws (3B)
- Redraw when the **anchor's album** changes. A new song on the same album, or a queue edit,
  does not redraw. The tiles can go stale during one album. That is accepted.
- **Tiles stay in place (T-A).** The slots are fixed for the window size and the tile count.
  On an album change, the albums are matched to the slots:
  - an album still in the set keeps its slot, and does not move;
  - the new anchor fades and grows into the anchor slot (from its old tile, if it had one);
  - the old anchor fades out;
  - a new album fades into each empty slot.
  Usually 2–3 tiles move. The motion is an opacity + small scale fade
  (`--wallpaper-tile-dur`, `--wallpaper-tile-ease`, `--wallpaper-tile-scale`, skin tokens).
- The cards' soft copy crossfades as a whole (`--wallpaper-fade-dur`). The old object URL is
  revoked after the fade ends.
- A change of the tile count or the window size redraws the slots, with one crossfade of the
  whole layer.
- Reduced motion: every fade becomes a snap.
- A minimized or tray-hidden window draws nothing. It draws once on show if the album
  changed while hidden.
- **Nothing plays (row 8):** the wallpaper fades out gently and the plain theme aurora comes
  back (`--wallpaper-fade-dur`). The next play fades it in again.

### 3.6 Legibility
- The gaps show the sharp picture under the canvas dim (`.app-body::after`). The cards show
  the soft copy under the tint and backlight.
- With Fancy Glass off, the dim and the tint are locked (`GLASS_LOCKED`: dim 10, tint 65).
  While the wallpaper (covers or picture) is on, the dim locks to a higher value (row 7): 15,
  his desk-test value (§6, step 8).

### 3.7 The settings (4A, rows 5, 9, U1, U4)
Three rows in Skin settings, Glass only:
- **Canvas** — pill `Aurora | Covers | Picture`, default Aurora. Picture shows a Choose
  button below the pill (the row reveals it through `enterRows`).
- **Tiles** — pill `Few | Some | Many` (6 / 12 / 20), default Some. Shows only with Covers.
- **Aurora color** — two values, from the picture or from the theme, default from the
  picture. Shows with Covers and with Picture. 🔵 its label and pill words (§7).
- The build checklist applies: the key gets a default with its "why", a spec in
  `agent-settings.ts`, a line in AGENT.md, a line in `NEW_MARKS`, a hover hint in the
  ONBOARDING.md ledger, and a Compass entry (automatic for a store-backed row).
- `diag.log` the draw: album id, tile count, draw ms, both copies' sizes.
- `dataset.frames` on the crossfade so frames.ts times it.

## 4. Cost
- **API**: 0 calls for the covers. The palette shares the existing cache and promise.
- **Network**: tile images from Apple's CDN, at the worker's `FETCH_PX` steps, mostly cached.
- **Memory**: two JPEGs at the window size (about 1–2 MB decoded each at max), plus the
  outgoing pair during a fade.
- **CPU**: one draw per album change, in a worker, in idle time.
- **GPU**: one more static layer under the aurora. The painted frost stays a static
  background. Measure on `npm run dev:built` (§6).

## 5. Risks
- **The mini window** shows a narrow strip of the canvas. The anchor must sit where that strip
  sees it.
- **Tile edges under the painted frost.** Tile seams in the soft copy can show as lines through a
  card. The blur must be wide enough to erase them.
- **Busy art.** Some covers are text-heavy. The dim and the aurora must hold text contrast in
  the gaps (the headers that sit on the canvas).

## 6. Desk test (open — built 2026-09-24)

> **Part:** built · 2026-09-24 · not yet desk-tested

A Rust file was added, so restart the dev runner (`npm run dev:app`) before the test.

1. Glass, Fancy Glass off, mini window. Settings › Skin settings › Canvas › **Covers**. Play an
   album with a long mixed queue behind it: the canvas fades to the cover, large at the upper
   center, with twelve tiles around it; the aurora takes the album's colors; the cards show a
   blurred copy that lines up with the gaps. Set Tiles to **One cover** (1A), then back to Some
   (1B). Does 1A fill the screen well enough? The answer decides whether One cover is dropped or
   kept (§7).
2. The same in max. Then turn on Fancy Glass: the cards blur the tiles live.
3. Skip to the next song on the same album: nothing moves. Skip to a new album: the new cover
   grows out of its tile into the center while the old center cover shrinks into that tile —
   they trade places. The rest stay. Jump to an album far down the queue: the old center cover
   goes to the nearest tile that changes.
4. Tiles: Few, then Many — the layer crossfades to the new layout. Resize the window: after a
   moment the layer crossfades to the new size.
5. Stop playback so nothing plays (clear the queue): the wallpaper fades out and the plain
   aurora comes back. Play again: it fades in.
6. Canvas › **Picture**: the Choose row slides in. Choose a photo: the canvas fades to it, the
   aurora takes its colors. Drop another image file on the row: it replaces the first. Drop a
   text file: "… is not an image DeetsMusic can read." Restart the app: the picture is still there.
7. Aurora color › Theme: the glow goes back to the theme's colors over the picture. Cover: back.
7a. Diffusion: drag it from 0 to 100. At 0 the covers are sharp; at 30 (the default) they read
    soft; at 100 they are a wash of color. The window's edges never go dark. Pick the default.
8. Read every card's text over the loudest cover you own. Set the locked dim
   (`--wallpaper-canvas-dim`) to the value that reads well (row 7). **Done 2026-09-25: 15.**
9. Minimize the window, skip to a new album, restore: the new album is drawn once on show.
10. `npm run dev:built`: `[perf] frames` for a library scroll, wallpaper on vs off.
11. Reduced motion on: every change is a snap.
12. Switch to another skin and back: the wallpaper leaves with Glass and comes back with it.

## 7. Open forks (for the owner)
- ✅ Every fork in §1 is closed (2026-09-24).
- ✅ **1A vs 1B** — closed at the desk test, 2026-09-24: the mosaic (1B) is the default, and the
  single cover (1A) stays as the Tiles row's "One cover" choice. Before that, the owner: **build both**,
  he picks at the end.
- ✅ **The Aurora color row's words** — label "Aurora color", pill `Cover | Theme` (the owner,
  2026-09-24). "Cover" names the album cover under Covers and the chosen picture under Picture.

## 8. User pictures (U1–U5, 2026-09-24)

The Canvas pill's **Picture** value shows one picture the user chooses. What exists and what
is new:
- **Pick and drop**: the playlist cover already takes a file (`<input type="file">`, and a
  drop on the collection card) and draws it through a canvas (`setCoverFromFile`,
  playlists-card.ts). The wallpaper can reuse that path.
- **The frost**: the two-copy pipeline (§3.3) works on any picture.
- **The aurora colors**: Apple gives the album palette (`album_palette`). A user picture has no
  palette, and no local color extractor exists yet. One would be small (sample the picture at
  a low size, rank by OKLCH chroma with `rankByColor`'s rule), with 0 API calls.
- **Storage**: the user's own file, so the storage rule for Apple artwork does not apply. A
  resized JPEG in the app data folder, not the database.

The shape, inside the choices:
- **Choose / drop**: the picture is resized to at most 2560 px on its long side, saved as a JPEG
  in the app data folder (one file, replaced on each choice) through an `async` command with
  `spawn_blocking` (CLAUDE.md › Conventions). The settings key holds only a stamp, so the
  cached URL changes when the picture changes.
- **Fit (U5A)**: `cover`, centered. No tiles, no per-tile motion. Choosing a new picture
  crossfades (`--wallpaper-fade-dur`).
- **The two copies**: the same pipeline (§3.3), with one tile that fills the window.
- **Aurora color (U4)**: a new `pictureSlots()` beside `auroraSlots()` in album-slots.ts reads
  the picture at a low size and picks three colors by the same OKLCH rules. It runs once per
  chosen picture. The result is saved beside the picture, so a restart does not read it again.
  The Aurora color row can pick the theme colors instead.
- **Nothing plays**: a user picture stays. Row 8 (back to the aurora) is about the covers,
  which have nothing to show without a song.
- **No picture chosen yet** and the pill on Picture: the plain aurora, and the Choose button.
- ⬜ Later: a set of pictures (U3B), a focal point (U5B).
