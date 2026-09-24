---
status: shipped
shipped_in: 0.14.0
desk_test: passed 2026-09-23
sources: [src/ocean.ts, src/ocean-texture.ts, src/ocean-worker.ts, src/styles.css, src/styles/skin.css, index.html, src/skin-settings.ts, src/settings-card.ts]
updated: 2026-09-23
---
# DeetsMusic — The Ocean sea

The sea behind the cards in the Ocean skin: a heavy swell in perspective, deep and ominous,
that heaves with the music, a glow of the album's color from the deep, and a ripple when you
play or drop. It replaced the three masked wave trains. UI-ARCHITECTURE.md §The ocean layer
has the engine; this doc has the intent, the decisions and the desk test.

Terms: **swell** = the long, slow waves. **Band** = one depth of the swell (far, middle, near),
which rolls at its own speed. **Heave** = the swell rising with the song's loudness.

## 1. Why it was redone (2026-09-22)
- The old swell was three grids of hairline waves at one size, so the "far" shades gave no
  depth.
- Six full-window masked layers moved all the time. Without a graphics card the swell was
  Ocean's whole idle cost (DEBUGGING.md §Fancy Glass and the Ocean swell).
- What he liked and wanted kept: the deep, ominous, powerful feel, and the sunken cards.

## 2. His decisions
**2026-09-22, first round** (built, then replaced): caustic light in the album's colors under
see-through cards, a Water clarity slider, and a Fancy Ocean toggle. **His word at the desk:**
"looks more like a swimming pool now. i prefered the older ocean that felt deep, ominous, and
powerful."

**2026-09-23, second round** (built):
| Fork | Choice |
|---|---|
| The sea | **The old swell, made heavier**: taller, slower swells, far rows crowding toward a horizon, the water darkest at the bottom; the pool light is gone |
| The cards | **A slider, "Card opacity", default solid**: "the old cards were designed to be sunken to give that deep ocean feel" |
| Kept | **The swell heaves with the music**, **ripples on play + drop**, **album color as a glow from the deep** |
| Dropped | The Fancy Ocean toggle, and the caustics |
| Heave with every Sound effect off | **Hold calm** (2026-09-22; the room heads' rule: nothing faked, nothing extra routed) |

## 3. As built
**Layers** (`index.html` `.ocean`, back to front): the water (`--ocean-deep`: `--ocean-water-top`
at the horizon to `--ocean-water-bottom`, 22% darker, at the bottom), the far band, the middle
band, the near band, the glow, the ripples. Each band is a heave box › a bob box › a roll box,
so the three transforms compose.

**The rows** (`seaRows` in ocean-texture.ts). From the top of the sea, the first gap is 6 px and
each gap is 1.1× the last, so the rows crowd at the horizon and spread toward the bottom
(about 29 rows on an 820 px sea). With depth `t` (0 at the top, 1 at the bottom): crest
height 0.8 + 20·t^1.5 px, wavelength 40 + 300·t^1.2 px, steepness 0.45 + 0.35·t, line brightness
0.18 + 0.82·t^0.8 (far rows fade into haze). A row belongs to the far band above t = 0.3, the
middle band to t = 0.62, the near band below.

**One row** (`swellLayer`). The crest is a Gerstner wave: sharp at the top, broad in the trough,
the shape of a heavy sea. The crests rise and fall along the row in sets. Under the crest the
wave's body is painted in the water's own color at that height, darkest just under the crest
(`--ocean-trough` 0.35 on dark water, `--ocean-trough-light` 0.12 on light water, where more
read as sand dunes), so a nearer swell hides the water behind it. The crest line is
`--ocean-swell-ink` with a faint light above it. The ink is a `light-dark()` pair: on a light
theme, the border lifted 20% toward the title color; on a dark theme, the border sunk 45% toward
the canvas (the lifted ink glowed on dark water, 2026-09-23). The ripples use the same ink. Every row has a whole number of waves across
its band's tile (360 / 720 / 1200 px), so the tile repeats sideways with no seam.

**Painting and moving.** `ocean.ts` sends each band to `ocean-worker.ts` (about 60 ms for all
three at 820 px) and sets the PNG as a plain background (`repeat-x`, the sea's full height). A
theme change, a height change of 24 px or more (after 300 ms) or a new display scale repaints.
Each band is one tile wider than the body and rolls right by one tile per loop (90 / 90 / 100 s,
so the near swell moves fastest), and bobs (1 / −2 / 3 px). There are no masks: the compositor
only moves finished layers.

**Glow from the deep.** The album's color as `--ocean-glow-color` on `.ocean`. That is
`albumColor()`, the most colorful of Apple's three (ALBUM-COLOR.md §The album's one color;
before 2026-09-23 it took `textColor1` by name, which is near grey on half the library). It is: a wide ellipse rising from below the bottom edge, at 0.28
opacity. `asGlow()` keeps the hue, caps the chroma at 0.14 and holds the lightness in the middle.
No album: no glow. A new album fades in over 2.4 s (a registered `@property`). The palette comes
through `lookupPalette` (album-color.ts), shared with the Now Playing card, so a cover costs one
lookup.

**Heave.** `onMeter` hops (every 100 ms, only while the Sound graph is routed) → loudness in dB
→ a ~1 s average against a ~12 s average → `--ocean-breath` (−1…1) on `.ocean`, written every
third hop. The bands rise up to 1.5 / 5 / 10 px over 1.1 s, and the glow swells by half.
Silence below −60 dB, a pause or a 600 ms gap in the hops returns it to 0. `ocean:heave` in
the diag log marks each on and off.

**Ripples.** `onPlayIntent` (player.ts: a play, a jump, a station, Next, Previous) ripples at
the last pointer-up if it was within 1.2 s, so an agent play makes no ripple. `onDragLand`
(row-drag.ts: a drop on a target, or a move within a list) ripples at the drop point. A drop
that also plays makes one ripple, not two (500 ms / 48 px). Each ripple is two rings in the
crest ink, flattened to 0.32 of their width like a ring seen on the water, 520 px wide at the
end, over 3.4 s.

**Cards.** Ocean's `--panel` is the old sunken fill at `oceanCardOpacity` percent (default 100:
solid, as before). Panes paint nothing and the stuck list bar blurs the rows under it, so a
lower opacity reads cleanly. Sand edges keep working: their fill is `--panel`.

**Gates.** Animate backgrounds Off, reduced motion or a hidden window: no heave and no ripples,
and the bands hold still. Reduced sets the bands to 15 steps a second.

## 4. Decided inside his choices (to review at the desk)
- The row numbers in §3 (gap growth, crest height, wavelength, steepness, haze).
- The water colors: 10% `--border` at the horizon, 22% black at the bottom. On a light theme the
  bottom turns a grey tone of the canvas.
- The crest ink: `--border` with 20% `--title`.
- The glow strength (0.28) and shape; no glow without an album.
- The ripple rings are the crest ink, not the album color, so they stay dark with the sea.
- Next and Previous count as plays for the ripple; Play/Pause does not. A reorder inside a list
  ripples, like a drop on another card.

## 5. Desk test
1. Pick Ocean. Within about a second the swell fades in: haze-thin rows at the top, tall
   sharp swells at the bottom, each band rolling at its own speed.
2. The cards are solid and sunken, as before. Settings › Skin settings › Card opacity: drag it
   down. The swell shows through the cards. The row wears an N until you hover it.
3. Play a song from a list. Two flat rings spread across the water from the row you clicked.
4. Drag a song onto the Queue. One ripple spreads from the drop point.
5. Play songs from two albums with different covers. A glow of the cover's color rises from the
   bottom and changes over ~2.4 s.
6. Turn on an EQ (Sound panel). While a song plays, the near swell heaves with the music. Pause:
   it settles. Turn every effect off: the sea stays calm.
7. Make the window much taller or shorter. After a moment the rows are repainted for the height.
8. Switch to a dark theme and to a light theme. The sea reads as deep water on both.
9. Settings › Animate backgrounds › Off: everything holds still, and no ripples. Minimize and
   restore: it continues from where it stopped.
10. Sand edges on: the grains still frame each card.

## 6. Open
- Bench Ocean idle and scroll on `dev:built`, with the GPU and with `--gpu=off`, against the
  old rows in `scripts/perf-history.csv`. If the cost is still high without a graphics card, say
  so in the Animate backgrounds hint.
- **Perf check the album light (his ask, 2026-09-23): open.** Bench it at 0 and at 100 the
  same way: six more layers (two per band); only the lit three show outside a crossfade. Also
  with a song playing and a Sound effect on (the heave and the pulse), and across a run of
  album changes (each one repaints three neon images in the worker). His word so far: "seems
  similar in weight to prior".
  - **First read, `dev:app` with DevTools open** (not honest for graphics; trend only). Idle,
    Black-Yellow, album light 65, no music, 244 Hz display: 10 s = 2,394 frames, 4 dropped
    (0.2%), worst 21 ms, no long tasks. Busy per thread: the page 0.8%, the GPU process 2.3–3.4%,
    the compositor 5.2%, Viz 2.8%. The page does nothing at idle; the sea is compositor work.
  - **Recheck:** one heaviness row (22:21) read the dev renderer at 1,625 MB and 75% CPU. It fell
    during a storm of page reloads from another session's saves (the page was 0 minutes old, heap
    486 MB), so it is not the sea's cost. Run the heaviness sampler for an hour on a quiet page
    to rule it out.

## 7. Album light
> **Part:** built · 2026-09-23 · desk test open

**His ask (2026-09-23):** "add the album color heavier underneath the waves", with a slider: at
the maximum "it feels like neon lines and glows", and at the minimum it is the sea of §3.

**His forks:**
| Fork | Choice |
|---|---|
| At the maximum | **Neon crests + a stronger deep glow**, both on the one slider |
| Which rows | **All, near brightest**: the far rows stay dim haze, so the depth holds |
| With the music | **Pulses with the heave** (so only while a Sound effect is on) |
| The row | **"Album light", default 0**, under Card opacity, with the N badge |

**As built.**
- `oceanLight` (0–100) → `--ocean-light` on `<html>` → `--ocean-lit` (0–1) on `.ocean`.
- **The neon.** Each band's roll box holds two `.ocean__neon` layers. With the light above 0,
  `paintNeon` (ocean.ts) has the worker paint the band again in neon mode (`neonColumn`,
  ocean-texture.ts), with the band's rows and seed, so the crests are the same crests. It paints
  only the lines: a core, then a bloom (σ 2–9 px, wider on the near rows). The bloom reaches
  further above the crest than below it. Each row's body erases the light behind it, so a nearer
  swell still hides the rows behind it. A new image goes on each band's unlit layer, and then all
  three bands swap at once: a crossfade over `--ocean-breath-dur`. It repaints on a new album, and
  on each repaint of the bands (theme, height, scale). At 0 nothing is painted. No album: the
  neon fades out.
- **The colors** (`asNeon`). The hue of `albumColor()`, the same color as the glow. The chroma is scaled ×1.5, up to 0.2, so a grey
  cover stays grey. On dark water, the bloom is at L 0.72 and the core is lifted toward white
  (L 0.92). On light water, the bloom is at L 0.62 and the core is deeper (L 0.45), because a
  bright line vanishes on pale water.
- **Brightness.** The neon's opacity is `--ocean-lit` × (1 + heave × `--ocean-neon-pulse` 0.35).
  The glow from the deep goes from `--ocean-glow` 0.28 to `--ocean-light-glow` 0.7, and its
  ellipse grows by `--ocean-light-reach` 35% taller. A slider drag eases over the heave's 1.1 s.
- **Cost.** No masks. The neon layers are plain images, each its own layer (`will-change:
  opacity`), and they roll with their band. The tray panel does not load ocean.ts:
  skin-settings.ts never imports it; the Settings row calls `setAlbumLight` on a drag.
- Log: `ocean:light` (on / off), `ocean:neon` (the paint time).

**Decided inside his choices (to review at the desk):**
- The neon numbers above: bloom width and strength (0.55), core width (1.3× the crest line),
  lightness per water, the chroma boost, the pulse 0.35, the glow 0.7 and the reach 35%.
- The crossfade uses the heave's 1.1 s, not the glow's 2.4 s: one opacity carries both the
  slider and the pulse.
- The ripples keep the crest ink, also at full album light.
- The hint: "Ocean only. How strongly the album's color lights the sea. High: the waves glow
  like neon".

**Desk test.**
1. Ocean, a song playing. Settings › Skin settings › Album light wears an N. At 0 the sea is as
   before.
2. Drag it up. Within about a second, the crest lines take the album's color and the glow rises
   from the bottom. At 100 the lines read as neon with a bloom. The far rows stay faint.
3. A nearer swell still hides the lit lines behind it. There is no light through a wave's body.
4. Play a song from a different album. The lines crossfade to the new color.
5. Turn on an EQ. Loud parts brighten the lines (below 100 most visibly). Every effect off: the
   lines stay steady.
6. A grey or black-and-white cover gives grey-white lines, not a random hue.
7. Switch to a light theme. The lines are deeper and still readable. Back to dark: bright again.
8. Resize the window much taller. After the bands repaint, the neon lies on the new crests.
9. Stop playback so no album shows: the neon fades out.
10. The tray panel still opens quickly (it does not load the sea).
