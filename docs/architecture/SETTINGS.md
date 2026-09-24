---
status: foundation
desk_test: none
sources: [src/settings-store.ts, src/settings-card.ts, src/styles/settings.css, src/agent-settings.ts]
updated: 2026-09-20
---
# DeetsMusic — Settings: the machinery

> **Looking for what a setting does?** [SETTINGS-INVENTORY.md](SETTINGS-INVENTORY.md) is the
> user-facing catalogue — every control, where it is, and what each choice means. It is written
> as a wiki page. **This** doc holds the machinery: the store, the row kinds, the keys and their
> owners, the read sites, the Reset groups, and how to add a setting.
>
> **Wording pass 2026-09-18**: five labels changed. Old → new: *Button is perma-shuffle* →
> **Shuffle button stays on** · *Show cover* → **Cover while playing** · *Genres for Webbing* →
> **Web genre chips filter** · *Close on Make* → **Web panel closes** · *Other (Sm)* →
> **Other (Small)** · *NP opens at* → **Player opens at**. **A second pass the same day**
> (ASD-STE100 read of every label): *Web genre chip filters* → **Web genre chips filter** (a
> four-word noun cluster; the last word is now the verb) · *Grown card on card pick* → **Grown
> card on a new pick**, pills *Keep* / *Collapse* → **Keeps size** / **Collapses** · *Web prefers*
> → **Web prefers songs** (a transitive verb needs its object) · *Songs not measured yet* →
> **Songs not measured get**. Values and store keys unchanged. From that read: the surface that shows the player alone was
> **NP** in the Surface menu, **Player** in the tray row, and **Player (NP)** in Settings and the
> Compass — one thing under three names. **BUILT 2026-09-18: it is "Player" everywhere**, the
> Mini | Player halves are equal (`flex: 1` each — 3/1 then 2/1 were both too narrow for the
> word) with the labels centred over an out-of-flow radio dot (an in-flow dot slot made the flyout too wide), and `np` stays a Compass synonym so the old habit still finds it. Still open: **web** is a coined noun across five Playlists rows that the
> card never defines.
> The Playlists rail groups became
> *Made Here* · Your Apple Playlists · Apple Mixes · **Apple Replays** · **Saved from Apple Music**.
> **The §3 table was brought up to date the same day**: the four open sizes were wrong, and the
> rows for Shrink volume bar, Compass closes on outside click, Max window when short, Fancy
> scrubber and AirPlay were missing. §3a is new, for the settings whose controls live in a
> title-bar panel (Sound, the sleep timer, rooms) and the keys with no control at all. Every key
> in `DEFAULTS` now appears in this doc.

## 0. Shape — the hybrid (user's pick)

> Built 2026-09-10 (branch `release-prep`). Code: `src/settings-store.ts` (the store),
> `src/settings-card.ts` + `src/styles/settings.css` (the card), the `Settings…` row in
> `index.html` / `main.ts`. Sibling docs: [FUTURE-SETTINGS.md](../FUTURE-SETTINGS.md) (the
> ledger these rows came from), [UI-ARCHITECTURE.md](UI-ARCHITECTURE.md) §4 (the old
> title-menu toggle pattern, now retired for preferences).


- **The title menu keeps the fast switches**: Theme › · Skin › · Surface › · Account ›,
  plus one row, **Settings…**, that summons the Settings card into a content slot
  (`requestCard("settings")` — the same least-recently-touched/flip mechanics as the
  queue button; in mini it lands in the left slot).
- **The Settings card hosts every preference.** One scroll, section headers, and these row
  kinds: a **toggle** (label + dot, the title-menu idiom), a **choice** (label + a split pill;
  more than three options becomes a small menu), a **split** (one pill cut into halves: an
  action, an on/off, or a menu), a **range** (label + a slider + its value, 2026-09-15), and
  **html** (markup of its own). Any row can carry **`when`**, so it shows only while a
  condition holds (§3 *Skin rows and range rows*). It is a normal registry card
  (`CardId "settings"`), so it can also be picked from any slot's title picker.
- **Rule: a control lives in exactly one place.** Nothing is duplicated between the menu
  and the card; the AirPlay dropdown (when built) keeps only live actions.

## 2. The store — `deets.settings`

One JSON object under a single `localStorage` key, typed as `Settings` in
`settings-store.ts`. `setting(key)` reads; `setSetting(key, v)` writes + persists +
notifies; `onSettingsChange(cb)` subscribes (the callback gets the key). Read sites call
`setting()` at the moment they act; only things that must react live subscribe (the
window's always-on-top and the dropdown mode in `main.ts`, the Rewind gate in
`layout.ts`, the card itself).

**Migrated in on first load** (read once, then owned by the store): `deets.alwaysOnTop`,
`deets.menuMode`, `deets.playlists.eagerCounts`.

**Not in the store** (the card talks to the owner directly): **Library Add** — its own
module (`library-add.ts`, `deets.libraryAdd`, with `onLibraryAddChange`); **Minimize to
Tray** — Rust `settings.json` (`settings_get` / `settings_set_minimize_to_tray`), because
the close policy runs before any JS can answer. **AirPlay** — *Send to speaker* is Rust-owned too ([AIRPLAY.md](../integrations/AIRPLAY.md) §7). A
`ChoiceRow` with `get`/`set` instead of `key` is how a Rust-owned choice renders.

## 3. The rows of the Settings card

Every row of the card, with the key behind it. The controls that are settings but live in a
title-bar panel instead are §3a. Labels are one short active statement; a choice row reads as a sentence completed by the
chosen pill. Hints ride the row as a hover tooltip only. Default first.

**The sections (twenty-one, since the regroup of 2026-09-18 and Song of the Day the same day).**
Tips · Window · Look schedule · Motion · Skin settings · Menus, hints and notices · Home ·
Playback · Sound · Sleep · AirPlay · Apple Music · Last.fm · Playlists · Rewind ·
**Song of the Day** · Connections · Updates · Reset · Bugs · About.
Look and feel was one fold until that day; `RESET_GROUPS` had treated it as four for months and
the card now agrees. **Window keeps one fold** and names its three groups with a `.set__sub-head`
sub-heading — *Window*, *Window sizes*, *Growing and drilling* — because nine of its rows are
about cards, not about the window. Sound does the same with *Equalizer* and *Adaptive sound*.
A sub-heading is not a setting: it is left out of the header's count and out of the Compass.

A section whose every row is gated off is **not drawn at all** — no empty header. Skin settings
under Cyber is the case (Cyber sets nothing of its own).

**The sections can be reordered, and the card has a search bar (2026-09-20).** Hold a section
header for 400 ms and drag it; the order lives in the `row_order` table, not in localStorage
beside the folds. The header's search button filters the card in place, over the same
`settingsRows()` index the Compass reads, and while the field holds text no section can be
moved. Both are [MOVABLE-ROWS.md](../features/MOVABLE-ROWS.md) §13; Settings › Reset › *Row order* is the
way back.

Folds persist by section **title** (`deets.settings.folds`), so a renamed or new section starts
folded once for a user who had folded the old one. Harmless; say it in the release note.

| Section | Row (hint) | Key | Values | Read site |
|---|---|---|---|---|
| Tips | Six static two-line notes (the gesture, then why to try it): hover anything · right-click anything · drag anything · click your way in · the title menu · close is not quit (2026-09-15). Habits, not a manual — the menus list their own verbs. No controls, no count badge; first section, starts collapsed | `TIPS` in `settings-card.ts` | — | `.set__tip` (settings.css). The in-app half of [ONBOARDING.md](../features/ONBOARDING.md) |
| Window | Close to tray (× hides the window. The tray icon opens it again) | Rust | on / off | `tray.rs` close policy |
| Window | Tray icon opens (A click on the tray icon. Player: Now Playing only) — pills *Mini* / *Player* (2026-09-14) | `trayView` | **cards** / player | `main.ts` `tray-pop` → `applySurface("mini", view)` |
| Window | Start with Windows (Starts in the tray at sign-in) | Rust (HKCU Run key, `autostart_get` / `autostart_set`; seeded once on the first installed run) | on / off | `lib.rs` `--tray` launch → `tray::start_hidden` |
| Window | Resize changes surface (§8) | `surfaceAutoFlip` | on / off | `surface.ts` ResizeObserver |
| Window | Mini opens at (The window size for Mini. Set current saves the size it has now or had last) × a `W × H` menu + *Set current* (2026-09-15, §8a) | `sizeMini` | **385x550** | `surface.ts` `openSize` / `applySize` |
| Window | Player opens at (The window size for Player, the player alone. Set current saves the size it had last) | `sizePlayer` | **405x675** (404 px wide is where the Press record stopped jittering) | same |
| Window | Midi opens at (The window size for Midi. Set current saves the size it has now or had last) | `sizeMidi` | **495x670** | same |
| Window | Max opens at (The window size for Max. Set current saves the size it has now or had last) | `sizeMax` | **1100x950** (2026-09-17: the tallest skin's need for a square cover AND the Queue's 2.5 rows, and it still fits a 1080p work area) | same |
| Window | Shrink volume bar (On: a small pill in the title bar that grows when you click it, or hover, as the menus open. A window thinner than 455 px uses the small pill anyway) — toggle (NEXT-VERSION §20) | `volumeShrink` | on / **off** | `main.ts` / the title bar volume; the thin-window rule overrides it |
| Menus, hints and notices | Compass closes on outside click (A click outside the Ctrl+Space bar closes it. Off: only Ctrl+Space, Escape, the compass button, or a pick closes it) — toggle (2026-09-17, [COMPASS.md](../features/COMPASS.md) §4) | `compassCloseAway` | **on** / off | `compass.ts` (the document pointerdown listener) |
| Window | Max window when short (A Max window dragged shorter than the stage column can hold) — pills *Becomes Midi* / *Stops at floor* (2026-09-17, [STAGE-COLUMN.md](../cards/STAGE-COLUMN.md) §5) | `maxShortWindow` | **flip** / floor | `surface.ts`; only *flip* needs `surfaceAutoFlip` on |
| Window | Keep on top (The window stays above other windows. Player: only while it shows the player) — pills *Always* / *Player* / *Off* (was a toggle until 2026-09-14; a stored `true` migrates to always) | `alwaysOnTop` | **off** / always / player | `main.ts` (subscribes to the setting and to `onSurfaceChange`; `isPlayerView()`) |
| Window | Grow cards from edges (Click the gap beside a card to open it over its neighbor. Hover a card's title for the button) (2026-09-16, [CARD-GROW.md](../cards/CARD-GROW.md) §8) | `cardGrow` | **on** / off | `card-grow.ts` `enabled()`: off = no zones, no button, no menu items; a grow on screen collapses at once |
| Window | Collapse on outside click (A click outside a grown card collapses it. Pin holds it open) | `cardGrowOutside` | **on** / off | `card-grow.ts` (the document pointerdown listener; the Pin button shows only while this is on) |
| Window | Grown card on a new pick (Pick another card in a grown card's title: it keeps the size, or collapses first) — pills *Keeps size* / *Collapses* | `cardGrowPick` | **keep** / collapse | `layout.ts` `setSlot` |
| Window | Keep view when grown (A card that grows keeps the view you are in; the tile size still follows the card's size) — pills *Keep* / *Per size* (2026-09-17, [CARD-GROW.md](../cards/CARD-GROW.md) §13a) | `cardGrowView` | **keep** / size | `collection-card.ts` `reload()` on a size change |
| Window | Card on drill (A drill opens in the card you are reading, and Back returns it; or it is summoned into another slot) — pills *In place* / *Summon* (2026-09-17, [CARD-GROW.md](../cards/CARD-GROW.md) §15; replaced `cardGrowDrill`, whose `swap` reads as `inplace`) | `cardDrill` | **inplace** / summon | `layout.ts` `drillSlot` + `drillInPlace` + `returnFrom` |
| Window | Bring a card already open (A drill whose card is already on screen: bring it to the card you are reading, or open it where it sits) | `cardDrillBring` | on / **off** | `layout.ts` `drillSlot` (`visibleSlotOf`) |
| Sharing | Share activity on Discord (Your Discord profile reads “Listening to DeetsMusic” with the song under it. Needs the Discord app open on this PC, and its Activity Privacy switch on) (2026-09-20, [FRIENDS.md](../integrations/FRIENDS.md) §8.10) | `shareActivityDiscord` | on / **off** | `presence.ts` — off means the pipe to Discord is never opened at all |
| Sharing | Pause sharing for an hour (Stops every sharing row above at once, then turns them back on by itself. Your settings are kept) — the label counts down and the half becomes Resume | `sharePauseUntil` | ms, **0** | `presence.ts` (D11: one pause covers every sharing row) |
| Discord | Connect (One channel's webhook, used by Song of the Day) + the paste field + Post as + the post log — **moved here from Song of the Day on 2026-09-20** ([FRIENDS.md](../integrations/FRIENDS.md) §8.5.2) | `sotd-outlets.json` (Rust) | not connected | `outlet.rs` / `discord.rs`, both unchanged by the move |
| Discord | Let my profile invite people to my room (While you host a listening room, your Discord card carries a Listen Along button. The button holds the room code, so anyone who sees your profile can join) | `discordRoomInvite` | on / **off** | `presence.ts` — its own switch, because the button publishes the CODE, not just the fact of hosting |
| Window | Move sections by holding (Hold a section header for a moment, then drag it where you want it. A click still opens and closes the section. New sections appear at the end) (2026-09-20, [MOVABLE-ROWS.md](../features/MOVABLE-ROWS.md) §13.1); under *Growing and drilling* | `moveSections` | **on** / off | `row-order.ts` `sectionsMovable()`, read by the four cards' drag wiring. Off leaves a pinned tile's grip bar working — that is a control, not a hold |
| Window | Keep card places on restart (Opens each card where you left it, also after you restart DeetsMusic) (2026-09-17, [CARD-MEMORY.md](../cards/CARD-MEMORY.md) §7); last row of Window | `cardMemoryDisk` | on / **off** | `card-memory.ts` (the map is in memory either way; on = it is also written to `deets.cardMemory`) |
| Look schedule | Change look at (Changes between a day look and a night look. Sun times come from your time zone, not your location) — menu *Sunrise and sunset* / *Set times* / *Windows mode* / *Off* (2026-09-15) | `lookSchedule` | **off** / sun / clock / windows | `look-schedule.ts` ([LOOK-SCHEDULE.md](../features/LOOK-SCHEDULE.md)); the rows below show only while it is on |
| Look schedule | Day look · Night look — split: theme menu \| skin menu | `dayTheme` `daySkin` · `nightTheme` `nightSkin` | **lilac press** · **black-red cyber** | `look-schedule.ts` `applyLook` |
| Look schedule | Day runs (set times only) — split: start menu \| end menu, half-hour steps | `dayStart` · `nightStart` | **07:00** · **19:00** | `look-schedule.ts` `planClock` |
| Look schedule | Shift sun times (sun only) — menu −60…+60 min | `sunShift` | **0** | `look-schedule.ts` `planSun` |
| Look schedule | Menu pick lasts — pills *Until next change* / *For good* | `lookHold` | **next** / always | `look-schedule.ts` `noteHandPick` (main.ts Theme/Skin clicks) |
| Motion | Animate look changes (Theme and skin changes play the launch animation. Off: they change at once) — also the launch fade | `appearanceMotion` | on / off | `appearance.ts` (`withAppearanceTransition`, the launch cover's veil → wait → lift, UX-COVERUPS.md §6a) and `boot-cover.ts`; OS reduced motion still snaps |
| Motion | Animate card swaps (Cards move to their new places in the skin's own motion. Off: they change at once) — default **on** (was off until 2026-09-16) | `cardSwapMotion` | on / off | `card-swap.ts` from `layout.ts` `setSlot` (picker swap, summon, replace); skin tokens `--swap-*`; OS reduced motion still snaps; [CARD-SWAP.md](../cards/CARD-SWAP.md) |
| Motion | Fancy scrubber (Each skin's own playhead: the Press nib, the Ocean float, the Glass lens, the charged bolt. Off: a plain handle) — toggle (2026-09-16) | `fancyScrubber` | **on** / off | `data-fancy-scrub` on `<html>`; a performance eval decides whether it stays on by default |
| Motion | Animate backgrounds (The moving Ocean, Glass, and Cyber backgrounds. Reduced: fewer updates, less CPU. Off: they hold still) | `backgroundMotion` | on / reduced / off | `ambient.ts` → `data-bg-motion` on `<html>`: reduced sets `--ambient-fps: 15` (skin.css), off pauses the loops and hides the storm (styles.css); OS reduced motion still wins |
| Skin settings | Card opacity (Ocean only. How solid the sunken cards are. Lower: the sea shows through) — slider 0–100% (2026-09-23); shows only while Ocean is the skin | `oceanCardOpacity` | **100** / 0–100 | `skin-settings.ts` → `--ocean-card-opacity` on `<html>` → Ocean `--panel` at that percent. OCEAN.md |
| Skin settings | Album light (Ocean only. How strongly the album's color lights the sea. High: the waves glow like neon) — slider 0–100% (2026-09-23); shows only while Ocean is the skin | `oceanLight` | **0** / 0–100 | `skin-settings.ts` → `--ocean-light` on `<html>` (the neon's opacity, the glow's strength and reach); `ocean.ts` reads the key and paints the neon crests only above 0. OCEAN.md §7 |
| Skin settings | Draw card edges (Ocean only. Sand: the card edges break into grains, like a dark beach) — pills *Sand* / *Soft*; shows only while Ocean is the skin (2026-09-15; a stored `waves` or `fade` from the dropped versions migrates to soft) | `oceanEdges` | **soft** / sand | `skin-settings.ts` → `data-ocean-edges` on `<html>`; UI-ARCHITECTURE.md §Sand edges |
| Skin settings | Sand width (Ocean only. How far the sand reaches into each card) — slider 0–100% (2026-09-15); shows only while Ocean is the skin and Draw card edges is Sand | `oceanSand` | **15** / 0–100 | `skin-settings.ts` → `--ocean-sand` on `<html>` → Ocean `--sand-reach` = 4px…40px |
| Skin settings | Fancy Glass (Glass only. A live blur behind the cards, a moving background, and four sliders. Without a graphics card: about 85% fewer frames) — toggle (2026-09-16); shows only while Glass is the skin | `glassFancy` | **off** / on | `skin-settings.ts` → `data-glass-fancy` on `<html>`. Off: skin.css paints the frost into each card (`--glass-frost-paint`, pinned with `background-attachment: fixed`), the aurora holds still (`--aurora-drift: none`), and the four sliders publish `GLASS_LOCKED` (65 / 85 / 40 / 10). On: the live `backdrop-filter`, the drift, the stored sliders. Measured: DEBUGGING.md §Fancy Glass and the Ocean swell |
| Skin settings | Canvas glow (Glass only. How brightly the colors glow on the background. The cards do not change) — slider 0–100% (2026-09-15; was named Backlight for an hour — a stored `glassBacklight` migrates here; a Frost cards blur slider was dropped the same day); the four Glass sliders show only with Fancy Glass on (2026-09-16) | `glassCanvasGlow` | **40** / 0–100 | `skin-settings.ts` → `--glass-canvas` → Glass `--glass-glow` scales the `--aurora-*` stops (50 = as written, 100 = double, capped at 100%) |
| Skin settings | Dim canvas (Glass only. Darkens the space between the cards. The cards stay as bright) — slider 0–100% (2026-09-15); shows only while Glass is the skin | `glassCanvasDim` | **10** / 0–100 | `skin-settings.ts` → `--glass-canvas-dim` → Glass `--canvas-dim` (100 → 0.9) paints `.app-body::after`; the frost's `brightness(1 / (1 − dim))` undoes it inside the cards |
| Skin settings | Backlight (Glass only. A light behind each card, under its tint) — slider 0–100% (2026-09-15); shows only while Glass is the skin | `glassBacklight` | **85** / 0–100 | `skin-settings.ts` → `--glass-backlight` → Glass `--glass-light` → the card's `--panel-paint` glow + the outer halo in `--shadow-card` |
| Skin settings | Tint cards (Glass only. The card color over the backlight. Less tint: more glow) — slider 0–100% (2026-09-15); shows only while Glass is the skin | `glassTint` | **65** / 0–100 | `skin-settings.ts` → `--glass-tint` on `<html>` → Glass `--panel` mix, painted as the last inset shadow over the backlight (skin.css) |
| Skin settings | Record player (Press only. The cover becomes a record. Spin: it turns while music plays) — pills *Spin* / *Still* / *Off* (2026-09-15); shows only while Press is the skin | `pressVinyl` | **off** / spin / still | `skin-settings.ts` → `data-press-vinyl` on `<html>`; `vinyl.ts` — [VINYL.md](../features/VINYL.md) |
| Skin settings | Show record on (Press only. Stage: the big cover in max and the player view. Everywhere adds the tray panel) — pills *Stage* / *Stage + card* / *Everywhere* (2026-09-15); shows only under Press with Record player on | `pressVinylWhere` | **everywhere** / stage / card | `skin-settings.ts` → `data-press-vinyl-where` → skin.css `--vinyl-stage` / `-strip` / `-tray`; the tray panel reads the store through a `storage` event |
| Skin settings | Spin speed (Press only. How fast the record turns, in turns each minute. 33⅓ is an LP, 45 a single) — pills *33⅓* / *45* / *78* (2026-09-15); shows only under Press with Record player on Spin | `pressVinylSpeed` | **33** / 45 / 78 | `vinyl.ts` `turnS()` → the turn period; the song-follow math is unchanged — [VINYL.md](../features/VINYL.md) §4 |
| Skin settings | Show record plate (Press only. The offset ink behind the record. Off: only the record, a little larger) — toggle (2026-09-15); shows only under Press with Record player on | `pressVinylPlate` | **on** / off | `skin-settings.ts` → `data-press-vinyl-plate` → `--vinyl-plate-shadow: none`, `--vinyl-inset: 0px` |
| Menus, hints and notices | Open menus on hover | `menuMode` | click / hover | `main.ts` → `setDropdownMode` |
| Menus, hints and notices | Show hover hints — the themed hint box ([ONBOARDING.md](../features/ONBOARDING.md) §1a). Off silences the written hints AND the row hints | `hoverHints` | bool | `hint.ts` |
| Menus, hints and notices | Hints appear after — *A moment* 250 ms / *A pause* 600 / *A while* 1100. A song row always waits 1.6× this. Hidden while Show hover hints is off | `hoverHintDelay` | quick / normal / slow | `hint.ts` `DELAY` |
| Menus, hints and notices | Name songs on hover — the two-line box on a list row: *Always* / *Cut off* (only when the ellipsis really cut the name) / *Never*. Hidden while Show hover hints is off | `hoverSongNames` | always / cut / off | `hint.ts` `rowHint()` |
| Menus, hints and notices | Show notices ([TOASTS.md](TOASTS.md)) — *Everything* / *Failures* (Off removed 2026-09-14) | `toasts` | all / failures | `toast.ts` `admitted()` at every call; a question toast always shows |
| Playback | Play Now plays (§1) — pills *Song only* / *Song and rest of list* | `playNowScope` | **list** / song | `media-menu.ts` `songMenu` (needs the row's list) |
| Playback | Drop on Now Playing — pills *Keep Up Next* / *Replace it* (2026-09-14) | `dropPlayQueue` | **keep** / replace | `drop-actions.ts` `dropToPlay` → `player.playTracksKeepQueue` (top of Up Next + jump); an Up Next row moves to the top first (`qcard.ts`). DRAG-DROP.md §3 |
| Playback | Previous rewinds (§4) — *The list* / *Played songs* | `previousReach` | lookback / heard | `queue.ts` `setContext` (heard = no parked lookback) |
| Playback | Restore on launch (2026-09-12) — *Last song* / *Up Next* / *Nothing* | `restoreQueue` | song / queue / off | `queue-persist.ts` (blob in the cache db's `meta`; song = Now Playing paused + Up Next + Previous, queue = song parked atop Up Next, Now Playing idle) |
| Playback | Button is perma-shuffle (NEXT-VERSION §14, 2026-09-15) — toggle: the Shuffle button is a mode; off = it shuffles Up Next once | `shuffleStays` | **on** / off | `player.ts` `toggleShuffle` / `isShuffleOn`; the mode's state is `shuffleMode` (no row; Reset › Playback clears it), repeat's is `repeatMode` (no row, NEXT-VERSION §12) |
| Playback | Shuffle keeps picks (§5a) — *First* / *In place* / *Mixed* | `shuffleManual` | top / hold / mix | `queue.ts` `shuffleUpcoming` |
| Playback | Stream quality (Auto follows your network speed; High is 256 kbps and Low is 64 kbps, from the next song) — *Auto* / *High* / *Low* (2026-09-16) | `streamQuality` | **auto** / high / low | `player.ts` `applyStreamQuality`: sets `music.bitrate` after configure, on a change, and (Auto) on Chromium's `navigator.connection` change, with a 0.5 / 1 Mbps gap. [AUDIO-QUALITY.md](../features/AUDIO-QUALITY.md) §4.1 |
| Playback | Idle shuffle plays (§5b) — *Library* / *Nothing* | `shuffleIdle` | library / noop | `player.ts` `shuffleQueue` |
| Playback | Show the day in History (Each row says Today, Yesterday or the date, next to the artist) — toggle (2026-09-15) | `historyShowDay` | on / **off** | `history-card.ts` — the day joins the row's subtitle line; never a divider ([QUEUE.md](../features/QUEUE.md)) |
| Sound | *Equalizer* group — Avoid distortion (How a boost is kept from distorting. Limiter only turns down just the loudest moments; the others lower the whole song) — menu *Limiter only* / *When needed* / *Always* / *By hand* (2026-09-18; the panel has this row too) | `soundEqPreamp` | **limiter** / needed / always / manual | `sound-dsp.ts` ([SOUND.md](../features/SOUND.md) §2.1a) |
| Sound | Lower the song by (By hand only. How much the song is turned down before the equalizer. The limiter catches anything left) — a slider, −24…+6 dB in half-steps; shows only while Avoid distortion is *By hand*. The panel's own control for this key is a ± stepper; the card's slider keeps the same half-decibel step (arrows step one, Shift ten), so the two agree | `soundEqPreampDb` | **0**, −24…+6 | same |
| Sound | Remember each output (On: headphones, speakers and AirPlay speakers each remember their own preset) | `soundEqPerOutput` | **on** / off | `sound.ts` on output change; the outputs it has remembered are listed in the panel's own fold |
| Sound | *Adaptive sound* group — Match songs to (How loud songs are made. Standard is Apple's Sound Check level) — pills *Standard* / *Louder* / *Quieter* | `soundLoudTarget` | −16 / **−14** / −18 (default −14 since 2026-09-18) | `sound-loudness.ts` |
| Sound | Keep albums together (On: when you play an album in order, all its songs move by the same amount, so a quiet song stays quiet) | `soundLoudAlbum` | **on** / off | same |
| Sound | Songs not measured get (A song is measured the first time you hear it. Until then: move it by your songs' usual amount, or leave it as it is) — pills *Usual amount* / *No change* | `soundLoudUnmeasured` | **median** / none | same |
| Sound | Follow the volume of (App + Windows: counts the DeetsMusic volume and the Windows volume together) — pills *App + Windows* / *App only* | `soundLowVolKey` | **both** / app | `sound-worklet.ts` |
| Sound | Blend amount (How much of each side goes into the other) — pills *Light* / *Medium* / *Strong* | `soundCrossfeedLevel` | light / **medium** / strong | `sound-dsp.ts` |
| Sound | Ask to keep after (When to ask whether the effects are worth keeping, counted from the first time one was turned on) — menu *3 days* / *7 days* / *14 days* / *Never* | `soundReviewDays` | **7** / 14 / 3 / 0 | `sound-panel.ts` ([SOUND.md](../features/SOUND.md) §7); the panel's footer has the same pill, and the question itself — Keep / Turn all off — is live and only there |
| Sleep | Sleep every day (Arms a sleep time every day. It pauses only if music is playing when the time comes) — pills *Off* / *Sunset* / *At a time* (2026-09-18; the sleep panel has this row too) | `sleepSchedule` | **off** / sun / clock | `sleep.ts` arm-at-boot + the daily tick |
| Sleep | Sleep at (The time the daily sleep timer runs out) — a menu of the whole day in quarter hours; shows only while Sleep every day is *At a time*. The panel's ‹ › move in 15-minute steps, so the card's menu does too | `sleepAt` | **22:00** | same |
| Sleep | Wind down (Over these last minutes the volume sinks to nothing, then the music pauses. Off: a plain pause at the time) — menu *Off* / 1 / 2 / 5 / 10 / 15 / 30 min | `sleepWind` | **5** / 0 = a plain pause | `sleep.ts` → `setDuck` gain factor |
| Sleep | Play out song (The song that is playing when the time comes finishes first. Off: the time is the silence) | `sleepPlayOut` | on / **off** | `sleep.ts` at the mark |
| AirPlay | Send to speaker (DeetsMusic only: the speaker plays your music and this PC goes quiet. All PC sound: every app’s sound, and this PC keeps playing) — pills *DeetsMusic only* / *All PC sound* (2026-09-17) | Rust `airplayCapture` (`settings_set_airplay_capture`) | **app** / system | the shared sender crate — [AIRPLAY.md](../integrations/AIRPLAY.md) §9a; a `ChoiceRow` with `get`/`set`, the Rust-owned form |
| Apple Music | Add to Library and ♥ (Can't remove from library via DeetsMusic) | module | on / off | `library-add.ts` (menus + the NP square + the row squares of `add-square.ts`); the ♥ (`favorites.ts`) rides the same consent, hence the label (2026-09-14) |
| Apple Music | Show ✓ on songs you have (On: the + on a song row turns into a ✓ when the song is already in your library. Off: no button) — toggle (2026-09-17) | `addSquareOwned` | on / **off** | `add-square.ts` `stateOf` — the row squares in Search, Playlists, Queue, History ([SEARCH.md § Add-to-Library square](../features/SEARCH.md)) |
| Apple Music | Export playlists (Can't rename, reorder, or delete on Apple Music via DeetsMusic) — 2026-09-14 | `playlistExport` | on / off | `playlist-export.ts` `exportItem` (hides Export ▸) — [PLAYLISTS.md §6](../features/PLAYLISTS.md) |
| Last.fm | Scrobble plays (Sends each song to your Last.fm profile once you hear half of it or 4 minutes) — 2026-09-16. Status line under the rows: the account and the waiting count | Rust `lastfmScrobble` (`settings_set_lastfm_scrobble`) | **on** / off | `lastfm.rs` `lastfm_heard` — [LASTFM.md §6](../integrations/LASTFM.md) |
| Last.fm | Show now playing (Your Last.fm profile shows the song while it plays) — 2026-09-16 | Rust `lastfmNowPlaying` (`settings_set_lastfm_now_playing`) | **on** / off | `lastfm.rs` `now_playing` |
| Home | Hiding lasts (Right-click a Home tile and Hide to take it off the card) — pills *Until cleared* / *This session* (2026-09-15) | `homeHideLasts` | **forever** / session | `home.ts` `hiddenMap` — [HOME.md §5](../features/HOME.md) |
| Home | Hidden tiles (Puts every hidden tile back on Home. Playing one again also brings it back) — a *Clear* action; the section's status line counts them | `homeHidden` (key → hidden-at ms) | **{}** | `home.ts` `clearHidden` / `hiddenCount` |
| Playlists | Show playlist counts (§14) (One small request per playlist, once) | `playlistEagerCounts` | on / off | `playlists-card.ts` backfill |
| Playlists | New playlist opens Search (Puts the Search card beside the new playlist. Mini shows one card, so Search would hide it) — pills *Not in mini* / *Always* / *Never* (three-way 2026-09-15; was a toggle, `true` → **notmini**) | `playlistCreateSummon` | **notmini** / always / off | `playlists-card.ts` `createAndEnter`, against `currentSurface()` |
| Playlists | Cover while playing (For a song played from a playlist: the cover shown in Now Playing, in mini and in the tray panel) — *Album* / *Playlist* (2026-09-15; renamed 2026-09-18) | `nowPlayingCover` | **album** / playlist | `playlist-cover.ts` `playlistCoverFor` → `now-playing-card.ts`, `np-bus.ts` → `tray.ts` — [PLAYLISTS.md §11](../features/PLAYLISTS.md) |
| Playlists | Web reach (1 reaches the artist's collaborators. Each step reaches one circle further) — *1* / *2* / *3* (2026-09-16) | `webReach` | 1 / **2** / 3 | `web.ts` → `web_build` — [PLAYLIST-WEB.md](../features/PLAYLIST-WEB.md) |
| Playlists | Web size (Songs in a new web playlist) — *25* / *50* / *100* (2026-09-16) | `webSize` | 25 / **50** / 100 | `web.ts` `pickSongs` — [PLAYLIST-WEB.md §4](../features/PLAYLIST-WEB.md) |
| Playlists | Web panel closes (Pop out closes the web panel at once while the artist flies to the playlist) — *Shrink to chip* / *Pop out* (2026-09-16) | `webMakeMotion` | **shrink** / pop | `web.ts` `shrinkInto` + `handoff.ts` — [PLAYLIST-WEB.md §2b](../features/PLAYLIST-WEB.md) |
| Playlists | **No Settings row** (user's call 2026-09-17): the web panel's Temp \| N days button remembers the days; every new web starts on Temp | `webTempDays` | 1 / 3 / 5 / **7** / 30 | `web.ts` `renderLife` → `playlist_create(expire_days)`; the check in `playlist-expiry.ts` — [PLAYLIST-WEB.md §10](../features/PLAYLIST-WEB.md) |
| Playlists | Web genre chips filter (Web only leaves the artist's songs unfiltered. Keep 5 keeps at least five) — *All songs* / *Keep 5* / *Web only* (2026-09-16) | `webSeedFilter` | **all** / floor / off | `web.ts` `pickSongs` — [PLAYLIST-WEB.md §3–4](../features/PLAYLIST-WEB.md) |
| Playlists | Web prefers songs (Familiar puts your songs first. Discover puts songs you don't have first) — *Familiar* / *Discover* / *Mix* (2026-09-16) | `webPrefer` | familiar / discover / **mix** | `web.ts` `pickSongs` — [PLAYLIST-WEB.md §4](../features/PLAYLIST-WEB.md) |
| Playlists | New cover (How a new playlist's cover starts. Letters and Note keep the theme you made it in) — *Letters* / *Mosaic* / *Note* (2026-09-15) | `newPlaylistCover` | **letters** / mosaic / note | `playlists.ts` `playlistCreate` → `cover-art.ts` — [PLAYLISTS.md §11](../features/PLAYLISTS.md) |
| Rewind | Rewind card (Shows after 50 plays → Your listening, ranked) | `rewindCard` (+ `rewindAutoShown`) | off / on | `layout.ts` pool (§4 below) |
| Rewind | Count a play at (§7) — *90%* / *End* / *Half or 4 min* | `fullPlayRule` | fraction / end (99%) / scrobble | `stats.ts` `listenedThrough` |
| Rewind | Weekly Replay — day menu (*Mon … Sun*) + on/off (A playlist of the past week's most-played songs, made on this day) | `replayDay` + `replayAuto` | mon / … · on / off | `replay.ts` `lastDue` / `runWeeklyReplay` (boot) |
| Rewind | Keep every Replay (Each week gets its own dated playlist in a Replay folder. Off: one playlist, replaced weekly) | `replayKeep` | off / on | `replay.ts` `runWeeklyReplay` |
| Song of the Day (2026-09-18, [DeetsOTD.md](../integrations/DeetsOTD.md) §8.4) | Song of the Day (Mark one song a day. With no outlet set up it stays on this PC and posts nothing) | `sotd` — **Rust** | **on** / off | `sotd/mod.rs`, and every row below it |
| Song of the Day | Suggest today's pick (Puts the song you played most today at the head of the Home shelf. You still choose) | `sotdSuggest` — the store | **off** / on | `sotd.ts` `suggestionTile` |
| Song of the Day | Day starts at (A song marked before this hour counts for the day before) | `sotdDayStart` — **Rust** | **5 AM** / Midnight | `sotd/mod.rs` `day_of` |
| Song of the Day | Picks per day (At the limit, Mark becomes Replace Today's Pick) | `sotdPicksPerDay` — **Rust** | **1** / 2 / No limit (0) | `sotd/mod.rs` `pick_mark` |
| Song of the Day | Post my picks (When a marked song goes out to the outlets you turned on) | `sotdPostMode` — **Rust** | **Ask each time** / Right away / At a set time | `sotd/outbox.rs` `after_mark` |
| Song of the Day | Post at (shows on *At a set time*) | `sotdPostAt` — **Rust** | **20:00** | `sotd/outbox.rs` `rearm` |
| Song of the Day | **What has left this PC** — the record of every post, newest first, with a Copy square (2026-09-18, [DeetsOTD.md](../integrations/DeetsOTD.md) §10.6) | no key — read from `pick_posts` | — | `sotd/mod.rs` `post_log` |
| Song of the Day | Discord — Set up / Change · Remove · on/off, then Post as | `<app_data>/sotd-outlets.json` (DPAPI), + `sotdPostAs` — **Rust** | not set up | `sotd/discord.rs` |
| Connections | Agent changes settings (An AI app or the command line changing these settings. Ask: DeetsMusic asks you each time) — *Allow* / *Ask* / *Off* (2026-09-15); agents can't change it | `agentSettings` | **ask** / allow / off | `agent-settings.ts` `settingsWrite` — [AGENT.md §6](../integrations/AGENT.md) |
| Connections | Agents read play history (Lets a connected agent see what you played, when, and what you skipped) — 2026-09-16 | Rust `agentHistory` (`settings_set_agent_history`) | **on** / off (agents: off only) | `bridge.rs` `/query`, `/songs`, `/history` — [LOCAL-DATA.md §9](../integrations/LOCAL-DATA.md) |
| Connections | Agent control (Lets a CLI or an AI app drive DeetsMusic on this PC) — Guide + on/off · Copy setup for (Claude Desktop / Claude Code / Cursor / Other) · agent status · extension bridge status · Extension install guide | Rust `agentControl` | on / off | `bridge.rs` gate (403) — [AGENT-SETUP.md](../integrations/AGENT-SETUP.md); `bridge_info` / `bridge_open_install_page` ([EXTENSION.md](../integrations/EXTENSION.md)) |
| Updates | Get updates (Automatic: downloads in the background, then asks to restart. Ask: asks before the download) — *Automatic* / *Ask* / *Off* (2026-09-14) | `updateMode` (+ `updateSkip`) | **auto** / ask / off | `updater.ts` `initUpdater` tick + `checkForUpdate` — [RELEASE.md §6.3](../ops/RELEASE.md) |
| Updates | Check for updates — Check now · Roll back — version menu + Install · the status line (version, progress, ready) | — | — | `update_check` / `update_versions` (one request per session) / `rollbackTo`; `onUpdateStatus` repaints the line |
| Reset | Look and feel (theme and skin + every Look and feel row) with indented parts: Theme and skin · Look schedule · Motion · Skin settings (`set__row--sub`); then Window · Playback · Playlists · Rewind · Everything — each row a *Reset* button (2026-09-15; Menus, hints and notices — Open menus on hover, the three hover-hint rows and Show notices — resets only with Look and feel or Everything) | `RESET_GROUPS` in `settings-card.ts` (theme and skin: `defaultTheme()` / `defaultSkin()`, the first-launch pair) | `DEFAULTS` | Reset → sticky toast *Confirm* / *Cancel* → a timed toast with *Undo* (the snapshot is taken at Confirm). A group already at its defaults flashes *Default*. Not reset: Close to tray, Start with Windows, the consent gates, Agent changes settings, Updates. Theme and skin change under the look animation as a hand pick (`noteHandPick`) |
| Bugs | App log — Open folder · Copy | — | — | `log_open_folder` (+ `diag.flush()` first; LOGGING.md) / `bridge_log` |
| About | Apple trademark notice · privacy notice (open by default) | — | — | — |

**The fifteen sections, in order** (regrouped 2026-09-14; Home joined 2026-09-15, Tips
2026-09-15, AirPlay and Last.fm 2026-09-16): Tips · Window · Look and feel · Home · Playback ·
AirPlay · Apple Music · Last.fm · Playlists · Rewind · Connections · Updates · Reset · Bugs ·
About. **Tips and About start open**; every other section starts folded, and a fold persists by
section title (`deets.settings.folds`), so a renamed section starts folded once.

**There is no Sound section** — the Sound panel owns those rows (§3a) — but Settings › Reset
does carry a *Sound* group. That mismatch is known and open.

A choice row with more than `SPLIT_MAX` (3) options draws as a dropdown instead of pills;
`menu: true` forces the dropdown at three or fewer, for labels too long to sit side by side
(Press › *Show record on*, 2026-09-15).

**Skin rows and range rows** (2026-09-15): a row with `when` shows only while it holds; the
skin rows test `currentSkin()` and the card re-renders on `onSkinChange`. A skin row's hint
starts with "<Skin> only." The skin rows sit at the end of the skin-neutral Look and feel
rows, grouped per skin; a skin's sliders are ordered as their layers paint, back to front
(Glass: Fancy Glass, which shows the rest, then Canvas glow, Dim canvas, Backlight, Tint cards; Press: Record player, then Show record
on, Spin speed and Show record plate, which need it on), so the list reads top to bottom as
the picture builds up. The range kind (a slider) reuses `slider.ts` and the `.scrub` markup.
A drag calls the row's `preview` only (a store write re-renders the card under the pointer);
the release writes the store. A focused slider steps with the arrow keys (Shift: 10) and
jumps with Home / End. **To add a skin-only setting**, follow the checklist in
[UI-ARCHITECTURE.md](UI-ARCHITECTURE.md) §3 *Skin-only settings*.

**Open Settings at a row** (`requestSetting(rowId)`, `layout-bus.ts`): summons the card,
unfolds the row's section, scrolls the row to the middle, and highlights it (`is-flash`,
`--set-flash-dur`; reduced motion holds the wash, then snaps off). The one-time notices of
Add to Library and Export use it through their **[Settings]** button.

**Play Now default changed 2026-09-10 to "Song and rest of list"** — the same play a
left-click does; "Song only" is the opt-in interjection. (FUTURE-SETTINGS §1 records the
original split.)

## 3a. Settings the Settings card does not hold

These are real, persisted preferences in the same store, but their controls live in a title-bar
panel because they are set while you listen, not while you configure. The Settings card has no
row for any of them.

**Sound and Sleep are now in BOTH places (2026-09-18, his call).** The regroup first moved their
set-once rows into Settings › Sound and Settings › Sleep and took them out of the panels. That was
undone the same day: **someone who opens a panel for the first time is not going to go looking in
the Settings card**, so the panels keep every control they had. The card has the same preferences
as real rows, so the Compass can reach them (`compass.ts` builds its Settings rows from
`settingsRows()`, the card — not from `SPECS`) and a reader of Settings can see them.

**This is safe because there is no second copy of the state.** Both controls call `setSetting` on
the same key, and both repaint from `onSettingsChange`. There is nothing to synchronise and
nothing that can drift; turn Blend amount in the panel and the card row is already showing
Strong. The tables below mark each duplicated row.

It is a deliberate exception to "a control lives in exactly one place"
([SETTINGS-INVENTORY.md](SETTINGS-INVENTORY.md)). The rule now reads: one place, unless a panel
and the card serve different moments — the panel while you listen, the card while you configure.
Rooms is NOT such a case: a live change there is a room command, not a setting.

### Sound — `sound-panel.ts`, applied by `sound.ts` ([SOUND.md](../features/SOUND.md))

Two tabs on one Web Audio graph. **Every effect ships off** (Apple DPLA §3.3.6.D, SOUND.md §0).

| Row | Key | Values | Read site |
|---|---|---|---|
| Equalizer | `soundEq` | on / **off** | `sound.ts` graph gate |
| The preset | `soundEqPreset` | **flat** / a built-in id / `custom` / `u:…` | `sound-presets.ts` |
| The edited bands, until saved | `soundEqCustom` | — | same |
| Presets you saved, by id | `soundEqUser` | **{}** | same |
| The curve editor | `soundEqMode` | **graphic** (sliders) / parametric (dots) | `sound-panel.ts` |
| Avoid distortion | `soundEqPreamp` | **limiter** / needed / always / manual | `sound-dsp.ts` (SOUND.md §2.1a) | **Also a row of Settings › Sound (§3), 2026-09-18.**
| Lower the song by (dB, for *manual*) | `soundEqPreampDb` | **0**, −24…+6 | same | **Also a row of Settings › Sound (§3), 2026-09-18.**
| Remember each output | `soundEqPerOutput` | **on** / off | `sound.ts` on output change | **Also a row of Settings › Sound (§3), 2026-09-18.**
| Output key → preset id | `soundEqOutputs` | **{}** | same |
| Output key → its name when last seen | `soundOutputNames` | **{}** | the panel's output list |
| Adaptive sound (the switch over the three parts) | `soundAdaptive` | on / **off** | `sound.ts` |
| Part A — Match loudness | `soundLoudness` | **on** / off (on since 2026-09-18; was off) | `sound-loudness.ts` |
| Part A — target, in LUFS | `soundLoudTarget` | −16 (Apple Sound Check) / **−14** / −18 (−14 since 2026-09-18; was −16) | same | **Also a row of Settings › Sound (§3), 2026-09-18.**
| Part A — keep an album together | `soundLoudAlbum` | **on** / off | same | **Also a row of Settings › Sound (§3), 2026-09-18.**
| Part A — a song never measured | `soundLoudUnmeasured` | **median** / none | same | **Also a row of Settings › Sound (§3), 2026-09-18.**
| Part B — Fuller at low volume | `soundLowVol` | off / **gentle** / full | `sound-worklet.ts` |
| Part B — what it follows | `soundLowVolKey` | **both** (app × Windows) / app | same | **Also a row of Settings › Sound (§3), 2026-09-18.**
| Part C — Headphone crossfeed | `soundCrossfeed` | **auto** / always / off | `sound-dsp.ts` |
| Part C — how much | `soundCrossfeedLevel` | light / **medium** / strong | same | **Also a row of Settings › Sound (§3), 2026-09-18.**
| Days before the "keep it?" question | `soundReviewDays` | **7** / 14 / 3 / 0 (never) | `sound-panel.ts` (SOUND.md §7) | **Also a row of Settings › Sound (§3), 2026-09-18.**
| When an effect was first turned on (epoch ms) | `soundFirstOn` | **0** | same — internal, no control |
| The review was answered *Keep* | `soundReviewed` | **false** | same — internal, no control |

Turning `soundAdaptive` on turns Match loudness on with it (`soundLoudness` defaults on since
2026-09-18): a person who turns Adaptive sound on expects it to do something, and this is its
most audible part. From 2026-09-17 to 2026-09-18 it defaulted off inside the off parent, with
songs measured meanwhile so a later switch-on had gains ready; the review of 2026-09-18 found
that on the owner's install it had changed 3 of 106 song starts. Every effect still ships off,
because `soundAdaptive` does.

### Sleep timer — the title-bar panel in `index.html`, driven by `sleep.ts`

| Row | Key | Values | Read site |
|---|---|---|---|
| Every day | `sleepSchedule` | **off** / sun (sunset from the time zone) / clock | `sleep.ts` arm-at-boot + the daily tick |
| The set time, for *clock* | `sleepAt` | **22:00** | same |
| Wind down (the last minutes fade to nothing) | `sleepWind` | **5**, 0 = a plain pause | `sleep.ts` → `setDuck` gain factor |
| Play out song | `sleepPlayOut` | on / **off** | `sleep.ts` at the mark |

**All four are also rows of Settings › Sleep (§3), 2026-09-18**, and Reset gained a **Sleep** group
for them — it had none, which was the mismatch fork 2 asked about.

The dial, *Off*, *End of song* and *End of Up Next* are live actions, not stored settings.

### Listening rooms — `room-panel.ts`, `room.ts` ([ROOMS.md](../integrations/ROOMS.md))

| Row | Key | Values | Read site |
|---|---|---|---|
| Your name | `roomName` | **""** → *Listener*, or *Host* for a room you start | `room.ts` join / create |
| Guests may (five permissions) | `roomGuestControls` | each **everyone** / host | `room.ts` §8; the host's last choice is the next room's default |
| The worker address | `roomsUrl` | **""** = `rooms.deets.solutions` | **Dev-only, no control** — set from the DevTools console, read at the next launch (ROOMS.md §16.3) |

Pause is never in `roomGuestControls`: a guest's Pause never greys out (ROOMS.md §12.3). Under
*Host only* it stops that guest's own app instead.

### Other keys with no control anywhere

| Key | What it is | Who writes it |
|---|---|---|
| `shuffleMode` | Shuffle is on right now (only read while `shuffleStays` is on; persisted like Apple's) | The Now Playing and toolbar Shuffle buttons |
| `repeatMode` | **off** / all / one | The Now Playing repeat button |
| `webTempDays` | A temporary web playlist's life, in days | The web panel's **Temp \| N days** button (PLAYLIST-WEB.md §10) |
| `onboardingStep` | The NEXT first-run step to show, 1-based; **0** = the walk is over | `walk.ts`; Settings › Tips writes 1 to offer it again. A settings key, not a localStorage once-key (owner's call 2026-09-18), so it survives a localStorage clear and the agent can read it |
| `rewindAutoShown` | The 50-play one-shot already fired, so a later "off" sticks | `stats.ts` (§4) |
| `updateSkip` | The version *Skip this version* set aside | `updater.ts` |
| `homeHidden` | Hidden Home tiles: item key → hidden-at ms | `home.ts`; *Clear* in Settings › Home |
| `soundFirstOn`, `soundReviewed` | See the Sound table above | `sound-panel.ts` |

## 4. The Rewind gate

The Rewind card is **hidden until it has something to show**: `rewindCard` defaults off,
and `stats.ts` flips it on **once**, at **50 play starts** (seeded from the durable
`play_event_count` at boot, then counted per `recordStart`). `rewindAutoShown` records
that the one-shot fired, so a later manual "off" sticks. The flip raises an `info` toast
under the *Everything* tier ([TOASTS.md](TOASTS.md)); the card appears in the pickers
either way, and the row's hint changes from "Appears by itself after 50 plays" to a
description.

`layout.ts` filters Rewind out of the picker pool while the setting is off. If the
setting goes off while a slot shows Rewind, that slot falls back to an unplaced card (or
its composition default) and the slots remount so every picker re-reads the pool.

## 5. Adding a setting

1. Add the key + default to `Settings` / `DEFAULTS` in `settings-store.ts`.
2. Read it with `setting("key")` at the acting site (subscribe only if it must apply live).
3. Add a row to the right section in `settings-card.ts` (`storeToggle(...)` for booleans,
   a `choice` row for enums). Label in sentence case; the hint is optional.
4. Update §3 (or §3a, for a panel-owned setting) and the source entry in
   FUTURE-SETTINGS.md. Add the control to [SETTINGS-INVENTORY.md](SETTINGS-INVENTORY.md) —
   the user-facing catalogue — and give it a glossary entry there if it introduces a word.
   Add the key to its group in `RESET_GROUPS` (`settings-card.ts`), unless it is a consent
   gate or Rust owns it.
5. Agents ([AGENT.md §6](../integrations/AGENT.md)): add the row to `SPECS` in `src/agent-settings.ts`, with the
   card's label, section and choices. A consent gate (like Add to Library) takes
   `offOnly: true`; a value agents must never change takes `readOnly: true`.
