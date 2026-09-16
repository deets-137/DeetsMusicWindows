# Press record player (vinyl cover)

Designed and built 2026-09-15 (`src/vinyl.ts`). Press only. Desk-tested in four rounds the same
day (§9); the telemetry and the trace recipe that found each fault are in §8.

**Terms.**
- **Cover box**: `.np__art`, the cover square in the Now Playing card (`now-playing-card.ts`)
  and in the tray panel (`tray.html`).
- **Stage**: the large cover in max and in the mini player view (`data-mini="player"`).
- **Strip**: the small cover in the Now Playing card in mini (card view) and midi.
- **Disc** (or record): the album cover cut into a record.
- **Slot**: the `.vinyl` element in the cover box that holds one disc.
- **Position**: the play time in the song, in seconds.
- **Period**: the time for one turn of the disc.
- **Count**: MusicKit's `currentPlaybackTime`, whole seconds rounded down.
- **Audio clock**: `currentTime` of MusicKit's `<audio id="apple-music-player">`, exact.

## 1. Decisions

| # | Fork | Pick |
|---|------|------|
| 1 | What is the disc | **A**: the whole cover is the disc (grooves, sheen, spindle hole) |
| 2 | Where it shows | **C** as a row: Stage / Stage + card / Everywhere (tray panel included) |
| 3 | Speed | **B**: true 33⅓ rpm at full frame rate. An optimization session follows |
| 4 | Control | **A**: a three-way pill (Spin / Still / Off). It does not follow "Animate backgrounds" |
| 5 | Song change | **B**: the old disc slides out and fades, and the new disc slides in |
| 6 | Seek | **A**: the angle follows the position. A scrubber drag turns the disc (a scratch) |
| 7 | Previous | **A**: the slide goes the other way |
| — | Plate (added after test 1) | a toggle row removes the offset plate, so only the record shows |

## 2. Settings rows (Look and feel, Press only)

| Row | Key | Control | Default | Hint |
|-----|-----|---------|---------|------|
| Record player | `pressVinyl` | Spin · Still · Off | **Off** | Press only. The cover becomes a record. Spin: it turns while music plays |
| Show record on | `pressVinylWhere` | Stage · Stage + card · Everywhere | **Everywhere** | Press only. Stage: the big cover in max and the player view. Everywhere adds the tray panel |
| Show record plate | `pressVinylPlate` | toggle | **On** | Press only. The offset ink behind the record. Off: only the record, a little larger |

- Row 1 shows under Press. Rows 2–3 also need Record player ≠ Off (the Sand width pattern).
- `skin-settings.ts` `applyVinylAttrs()` writes `data-press-vinyl`, `data-press-vinyl-where` and
  `data-press-vinyl-plate` (on | off) on `<html>`; `isVinylKey(k)` names the three keys.
- All three keys are in the **Skin settings** Reset group (`settings-card.ts`, id `skinrows`) and
  in `agent-settings.ts` (`storeChoice` ×2, `storeToggle` ×1, `only: "Press only…"`).
- **The tray panel** reads the same settings store: same origin, same localStorage. A save in the
  main window reaches it as a `storage` event (`settings-store.ts` reloads and notifies each
  changed key). No Rust change. `tray.ts` calls `applyVinylAttrs` on start and on change.

## 3. The look (1A)

A slot (`.vinyl`) holds, bottom to top:

1. **Plate** (`.vinyl__plate`). A circle that never turns. It carries `--vinyl-plate-shadow` (Press:
   `4px 4px 0 var(--ink-2)`, the card's offset ink). On a layer that never turns, it is drawn once.
2. **Spin** (`.vinyl__spin`). The `<img>` and two pseudo layers; this is what turns.
   - One mask cuts both edges: `radial-gradient(circle closest-side, …)` — transparent inside
     `--vinyl-hole` (the spindle hole), opaque to the rim, transparent past it.
   - `::before`: the label ring at `--vinyl-label` (33%), `--vinyl-ring-w`, `--vinyl-ring-ink` at
     `--vinyl-ring-alpha`.
   - `::after`: the grooves, a `repeating-radial-gradient` (`--vinyl-groove-pitch`,
     `--vinyl-groove-w`, `--vinyl-groove-ink` at `--vinyl-groove-alpha`), masked to start at the label.
3. **Sheen** (`.vinyl__sheen`). A `conic-gradient` with two opposite lobes (`--vinyl-sheen-from`,
   `--vinyl-sheen-spread`, `--vinyl-sheen-ink` at `--vinyl-sheen-alpha`). It **does not turn**: a fixed
   light over a turning disc is what reads as a record.

- **Shape.** The cover box is a size container (`container-type: size`). The stage box is not always
  square — the card's width caps it — so the slot is a square of `calc(100cqmin − 2 × --vinyl-inset)`,
  centered with `inset: 0; margin: auto`. (Test 1: without this the plate drew as an oval, off center.)
- **Plate off** (`data-press-vinyl-plate="off"`): `--vinyl-plate-shadow: none`, `--vinyl-inset: 0px`.
- In record mode the cover box's `--surface-hover` fill goes transparent
  (`color-mix(… calc((1 − var(--vinyl)) × 100%) …)`), so the corners show the card.
- The ♪ placeholder slot (`.vinyl--glyph`) is never a record (`.np__art:has(> .vinyl--glyph)` → `--vinyl: 0`).
- **Still**: the same layers, no spin. **Reduced motion**: no spin (`transform: none !important`), no slide.
- Tokens: every `--vinyl-*` value sits in the base block of `skin.css` (inert: the three place
  switches are 0); Press sets the inset, plate shadow and slide timing. All colors are theme roles.

### How CSS gates it

- `skin.css`: under Press with Record player Spin or Still, `--vinyl-stage: 1`; plus `--vinyl-strip: 1`
  unless "Stage"; plus `--vinyl-tray: 1` with "Everywhere".
- `styles.css`: `.np__art` takes `--vinyl` from its place — `var(--vinyl-strip)` by default,
  `var(--vinyl-stage)` on the stage, `var(--vinyl-tray)` under `[data-window="tray"]`. The slide axis
  rides along: `--vinyl-x: 1; --vinyl-y: 0` on the stage, `0 / 1` elsewhere.
- The record rules sit in `@container style(--vinyl: 1)`. Under `style(--vinyl: 0)` the spin is
  `transform: none !important`, which beats the Web Animation, so a place with the plain cover shows
  the old square cover exactly.

## 4. The angle

**Rule 1: the angle follows the position, not the clock.**

    angle = 360° × position ÷ period

**Rule 2: round the turns per song, so the disc starts AND ends upright.**

    turns  = max(1, round(duration ÷ 1.8 s))      (33⅓ rpm = 1.8 s per turn)
    period = duration ÷ turns                      (vinyl.ts periodFor)

At 0 s the angle is 0°; at `duration` it is `turns × 360°`, upright. The speed change is under half
a turn per song (under 0.5% for 3 minutes). **Rule 3:** no duration (a live station) → 1.8 s, free.

**The driver.** One Web Animation per disc (`rotate 0turn → 1turn`, infinite, `duration = period`),
run by the compositor. `sync()` compares the animation time with `position mod period`.

### Clocks (measured 2026-09-15)

- **The count is whole seconds, rounded down** (3 while the audio clock read 3.145), and
  `playbackTimeDidChange` fires about every 265 ms. Taken as exact, it snapped the disc about a
  second into each song (test 2).
- **The audio clock is exact**, but MusicKit makes the `<audio>` element only while a song plays.
- **The Now Playing card** sends the audio clock (`exact: true`) whenever the element exists — even
  when it disagrees with the count, which lags at a song change — and the count otherwise.
- **The tray panel** only has the count (`NpState.currentTime`, `exact: false`). A report of N means
  the song is in [N, N+1); a count one higher than the last report means it crossed N after that
  report. Each report bounds φ = position − clock; the bounds intersect to a few ms (`estimate()`).
- **Windows media** in the tray panel: that app's position lags, so its record turns freely (Rule 3).

### Corrections — a jump is always visible, a few percent of speed never is

| Case | What the disc does |
|------|-------------------|
| A new song | Waits at 0°. Starts when the audio clock moves (card) or on the play flag (count only). |
| Playing, small error | Speed only: `rate = 1 + err ÷ 1500 ms`, capped at ±5%. |
| Pause | Stops where it is. |
| Resume (disc already turned) | Starts on the play flag at once. |
| Scrubber drag | Follows the hand (`currentTime` set directly). |
| Scrub let go | Ignores readings more than 1 s from the release point for up to 1.5 s (the old position). |
| Exact reading ≥ 1.5 s from the last | A seek (media keys, the tray panel, an agent): **snap**, reason `seek`. |
| Counts that cannot all be true | A seek or a stall: **snap**, reason `count`. |
| Jump back to < 1.5 s | Held 600 ms for a song change; if none comes, **snap**, reason `zero`. |
| Any snap with the disc < 250 ms off | Not a snap: speed only (`SNAP_MIN_MS`). |
| Reading > 2 s within 1.5 s of a song change | The old song still reporting: ignored. |
| Window hidden or minimized | Held still (`data-ambient="paused"`, watched by `vinyl.ts`); tray: `suspend()`. |

## 5. Song change: the slide (5B, 7A)

| Place | Forward (Next, natural advance, a new play) | Back (Previous) |
|-------|------|------|
| Stage | old disc out to the **right**, new disc in from the **left** | reversed |
| Strip | old disc out **down**, new disc in from the **top** | reversed |
| Tray panel | as the strip | reversed |

- **The song key** decides a slide (the cover URL does not): `song:<catalogId|libraryId>` from the
  queue entry, or `station:<id>|<title>` on radio. The tray panel uses `deets:<catalogId>`.
  (Test 1: a key built from the entry AND MusicKit's lagging title slid twice per change.)
- **Radio gaps**: a station report with no title is the gap between two station songs; the card and
  the tray panel keep the record that is up. (Test 4: record → ♪ → record, 143 ms apart.)
- **Direction**: `vinyl.ts` keeps the last 20 song keys; a return to the one before the current is Back.
- **Motion**: two Web Animations with pixel values (`transform` + `opacity`), so the compositor runs
  them while MusicKit keeps the main thread busy. The new slot stays hidden until its cover decodes
  (`img.decode()`, at most 300 ms). Distance = the slot size × `--vinyl-swap-travel` (110%); timing
  `--vinyl-swap-dur` × `--motion-scale`, `--vinyl-swap-ease`; far-end opacity `--vinyl-swap-fade`.
- The old disc keeps turning as it leaves. The cover box clips both (`overflow: hidden`).
- A quick run of skips removes a disc that is still leaving, at once.
- A new cover URL for the same song (MusicKit catching up, Show cover flipped) swaps the image
  after it decodes, with no slide.
- No slide when: the place shows the plain cover, reduced motion, the window is hidden, or either
  side is the ♪ placeholder.

## 6. The scrubber hold (test 3)

After a seek is let go, MusicKit reports the old position for a moment, so the scrubber handle
jumped back before it jumped forward (it predates the record; the record made it visible). The Now
Playing card and the tray panel now hold the handle at the release point until a report lands within
1 s of it, for up to 1.5 s.

## 7. Parts

| File | Role |
|------|------|
| `src/vinyl.ts` | `mountVinyl(box, glyph)` → `show / playing / position(sec, duration, exact) / scrub / suspend / destroy`; the slots, the angle driver, the slide, the telemetry |
| `src/now-playing-card.ts` | mounts it on `#np-art`; song key, radio gap; the audio clock; scrubber drag + hold |
| `src/tray.ts` | mounts it on the tray cover; count readings; Windows media turns freely; held while hidden |
| `src/skin-settings.ts` | `applyVinylAttrs`, `isVinylKey` |
| `src/settings-store.ts` | the three keys; the `storage` listener (the tray panel) |
| `src/settings-card.ts`, `src/agent-settings.ts` | the three rows; the Reset group |
| `src/styles.css` | §Record player: the place → `--vinyl`, the size container, the layers |
| `src/styles/skin.css` | the `--vinyl-*` tokens; the Press switches and values |

## 8. Debugging (dev only)

### Telemetry — `src/vinyl.ts`

Gated on Vite's DEV flag like `frames.ts`; each line goes to the console and the dev log
(`%APPDATA%\com.deetsmusic.dev\deetsmusic.log`) through `diag_flush`.

- `[perf] vinyl show <old key> → <new key> · new song | cover swap · src <file> · at <ms> after the last`
  — every change of what the cover box shows. Two lines for one Next is a double slide; a
  `→ station:<id>|` line with `src none` is a radio gap. `(start)` is a fresh mount of the card
  (a page reload or a surface change), not a slide; its `ms` figure is meaningless.
- `[perf] vinyl snap <seek|count|zero> · err <ms> · at <s>` — every jump, with how far off the disc was.
- `[perf] vinyl song <duration> · period <ms> (<turns> turns) · start <angle>° exact|count at <s> ·
  snaps N (…) · nudge worst <ms>, rate <min>–<max> · held stale / seek / zero · scrubs · left at <angle>°`
  — one per song, when the next song replaces it. After a natural song end `left at` should be near 0°
  (a skip leaves at any angle).
- `__vinyl.sample(ms)` / `__vinyl.discs` — rows every 100 ms from the newest disc:
  `[position s, error ms (+ = disc behind), rate, play state]`. Steady play reads ±2 ms, rate 1.000.

Read: `grep "\[perf\] vinyl" "%APPDATA%\com.deetsmusic.dev\deetsmusic.log" | tail -20`.

### The angle trace — what the eye sees

The telemetry reports what the driver believes. To see what is on screen, sample the computed
`transform` of the newest `.vinyl__spin` every 50 ms with `scripts/webview-eval.mjs`, next to the audio
clock and the slot count, while pressing the card's own buttons (the app's queue stays right):

```js
// in node scripts/webview-eval.mjs "(async()=>{ … })()"
const spins = [...document.querySelectorAll('.vinyl__spin')], s = spins.at(-1);
const m = new DOMMatrix(getComputedStyle(s).transform);
const angle = Math.round(Math.atan2(m.b, m.a) * 180 / Math.PI);
const a = document.getElementById('apple-music-player');
row = [t, angle, a?.currentTime, a?.paused, spins.length];
// press: document.querySelector('.np__controls [aria-label="Next"]').click()
//        document.getElementById('np-playpause').click()
```

Reading it: steady play moves about 10° per 50 ms (200°/s). A flat angle while the audio clock moves is
a late start; a step that is not ~10° is a snap; the slot count going 2 → 1 → 2 is a double slide.

### Clock probes

- Count vs audio clock: sample `MusicKit.getInstance().currentPlaybackTime` next to
  `document.getElementById('apple-music-player').currentTime` (found the whole-second count).
- Report cadence: listen to `playbackTimeDidChange` and log `performance.now()` per event (~265 ms).
- No `<audio>` element while nothing plays: that is normal (MusicKit makes it per play).

### Pitfalls

- A save in another session (or yours) reloads the dev page; an eval running then fails with
  "Execution context was destroyed", and a Rust change takes the CDP port down while it rebuilds.
  Wait for port 9222 (`netstat -ano | grep ":9222 "`), then run it again.
- A reload stops the song; press Play (the card's button) before a trace.
- The `deetsmusic` MCP tools drive the INSTALLED app, not the dev app — drive the dev page's buttons.

## 9. Desk tests (2026-09-15)

| Round | Reported | Found | Fix |
|-------|----------|-------|-----|
| 1 | Plate is an oval; Next drops frames / jitters | Stage box not square; key built from entry + lagging title slid twice; old disc snapped to 0° before leaving; CSS slide with `var()` keyframes ran on the busy main thread; cover decoded during the slide | `100cqmin` square; entry-only key; hold a jump to 0 for 600 ms; WAAPI slide in px; wait for `img.decode()`; **Show record plate** row |
| 2 | Play, it starts, then jumps (1–2 s in); sometimes starts at 90° | Count is whole seconds, rounded down; the change tick lands up to 265 ms late; `<audio>` missing at a start → a wide estimate | Audio clock in the card; bounded estimate in the tray; start at 0° and correct by speed only; snap only for a real seek |
| 3 | Scrub: rotates, then scrubber flickers and spin goes back | MusicKit reports the old position until the seek lands | Hold the disc and the scrubber handle at the release point |
| 5 | Jitters without a stop in a small NP window (2026-09-15) | Not the disc at all: the transport row's `fit()` read the live `column-gap`, which the stacked rule zeroes, so a width near its threshold flipped the row every frame (fixed in `61b1ae1`). A narrow NP sat at that width | The row reads `--np-bottom-gap` instead; NP's window floor is 404 px wide, the width the user measured as steady. **No CSS change to the disc** |
| 4 | Sporadic, on the first play of a run | Radio gaps (no title, no cover) read as new songs; a 40 ms "seek" snap; a 260 ms late resume; a 7° turn on the early play flag | Keep the record through a radio gap; snap only ≥ 250 ms off; resume on the flag; trust the audio clock whenever it exists |

## 10. Open items

- **Apple artwork rules: checked 2026-09-15.**
  - Apple Developer Program License Agreement §3.3.6.D (MusicKit): "You may not, and You may not
    permit Your end users to, download, upload, or modify any MusicKit Content … unless otherwise
    permitted by Apple in the Documentation". "MusicKit Content" = "music, video, and/or graphical
    content rendered through the MusicKit APIs" — album art is inside that.
  - The same section makes the Apple Music Identity Guidelines binding. They have no artwork rule;
    "Do not modify, angle, animate, rotate, or tilt" is about the Apple Music **badge**.
  - The Apple Music API Artwork documentation gives no display rule.
  - Reading: the record is a display effect. No image file is changed, saved or uploaded; the
    `<img>` is Apple's own URL, and turning the row Off shows the cover as sent. This is the same
    reading the app already relies on for the round artist hero, the Rewind rounds and the
    memory-only mosaic (PLAYLISTS.md §11.3). The word "modify" is broad and Apple does not define
    it, so the risk is not zero. Keep the default **Off**, so a record is only ever the user's pick.
- **Frame cost (the optimization session).** A full-rate spin keeps the window drawing at the display
  rate (238 Hz on the desk PC) while music plays. Measure with `frames.ts` and the heaviness sampler,
  on the stage and in the strip.
- **Cover drag: checked 2026-09-15 (user).** The drag image is the record version of the cover on a
  Press card background, moving as the translucent drag chip. Kept as is.
- **Double slide seen once (test 1) before the show telemetry existed**; not seen since. If it comes
  back, the `[perf] vinyl show` lines name the two keys.
