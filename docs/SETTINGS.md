# DeetsMusic — Settings (the hybrid: title menu + Settings card)

> Built 2026-09-10 (branch `release-prep`). Code: `src/settings-store.ts` (the store),
> `src/settings-card.ts` + `src/styles/settings.css` (the card), the `Settings…` row in
> `index.html` / `main.ts`. Sibling docs: [FUTURE-SETTINGS.md](FUTURE-SETTINGS.md) (the
> ledger these rows came from), [UI-ARCHITECTURE.md](UI-ARCHITECTURE.md) §4 (the old
> title-menu toggle pattern, now retired for preferences).

## 1. Shape — the hybrid (user's pick)

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
the close policy runs before any JS can answer. (v1 has no AirPlay rows; the v2 row is
Rust-owned too — [AIRPLAY.md](AIRPLAY.md) §7.) A
`ChoiceRow` with `get`/`set` instead of `key` is how a Rust-owned choice renders.

## 3. The rows (v1 cut)

Labels are one short active statement; a choice row reads as a sentence completed by the
chosen pill. Hints ride the row as a hover tooltip only. Default first.

| Section | Row (hint) | Key | Values | Read site |
|---|---|---|---|---|
| Tips | Six static two-line notes (the gesture, then why to try it): hover anything · right-click anything · drag anything · click your way in · the title menu · close is not quit (2026-09-15). Habits, not a manual — the menus list their own verbs. No controls, no count badge; first section, starts collapsed | `TIPS` in `settings-card.ts` | — | `.set__tip` (settings.css). The in-app half of [ONBOARDING.md](ONBOARDING.md) |
| Window | Close to tray (× hides the window. The tray icon opens it again) | Rust | on / off | `tray.rs` close policy |
| Window | Tray icon opens (A click on the tray icon. Player: Now Playing only) — pills *Mini* / *Player* (2026-09-14) | `trayView` | **cards** / player | `main.ts` `tray-pop` → `applySurface("mini", view)` |
| Window | Start with Windows (Starts in the tray at sign-in) | Rust (HKCU Run key, `autostart_get` / `autostart_set`; seeded once on the first installed run) | on / off | `lib.rs` `--tray` launch → `tray::start_hidden` |
| Window | Resize changes surface (§8) | `surfaceAutoFlip` | on / off | `surface.ts` ResizeObserver |
| Window | Mini opens at (The window size for Mini. Set current saves the size it has now or had last) × a `W × H` menu + *Set current* (2026-09-15, §8a) | `sizeMini` | **360x560** | `surface.ts` `openSize` / `applySize` |
| Window | NP opens at (The window size for NP, the player alone. Set current saves the size it had last) | `sizePlayer` | **520x560** | same |
| Window | Midi opens at (The window size for Midi. Set current saves the size it has now or had last) | `sizeMidi` | **480x864** | same |
| Window | Max opens at (The window size for Max. Set current saves the size it has now or had last) | `sizeMax` | **1100x820** | same |
| Window | Keep on top (The window stays above other windows. Player: only while it shows the player) — pills *Always* / *Player* / *Off* (was a toggle until 2026-09-14; a stored `true` migrates to always) | `alwaysOnTop` | **off** / always / player | `main.ts` (subscribes to the setting and to `onSurfaceChange`; `isPlayerView()`) |
| Window | Grow cards from edges (Click the gap beside a card to open it over its neighbor. Hover a card's title for the button) (2026-09-16, [CARD-GROW.md](CARD-GROW.md) §8) | `cardGrow` | **on** / off | `card-grow.ts` `enabled()`: off = no zones, no button, no menu items; a grow on screen collapses at once |
| Window | Collapse on outside click (A click outside a grown card collapses it. Pin holds it open) | `cardGrowOutside` | **on** / off | `card-grow.ts` (the document pointerdown listener; the Pin button shows only while this is on) |
| Window | Grown card on card pick (Pick another card in a grown card's title: it keeps the size, or collapses first) — pills *Keep* / *Collapse* | `cardGrowPick` | **keep** / collapse | `layout.ts` `setSlot` |
| Window | Keep view when grown (A card that grows keeps the view you are in; the tile size still follows the card's size) — pills *Keep* / *Per size* (2026-09-17, [CARD-GROW.md](CARD-GROW.md) §13a) | `cardGrowView` | **keep** / size | `collection-card.ts` `reload()` on a size change |
| Window | Card on drill (A drill opens in the card you are reading, and Back returns it; or it is summoned into another slot) — pills *In place* / *Summon* (2026-09-17, [CARD-GROW.md](CARD-GROW.md) §15; replaced `cardGrowDrill`, whose `swap` reads as `inplace`) | `cardDrill` | **inplace** / summon | `layout.ts` `drillSlot` + `drillInPlace` + `returnFrom` |
| Window | Bring a card already open (A drill whose card is already on screen: bring it to the card you are reading, or open it where it sits) | `cardDrillBring` | on / **off** | `layout.ts` `drillSlot` (`visibleSlotOf`) |
| Window | Keep card places on restart (Opens each card where you left it, also after you restart DeetsMusic) (2026-09-17, [CARD-MEMORY.md](CARD-MEMORY.md) §7); last row of Window | `cardMemoryDisk` | on / **off** | `card-memory.ts` (the map is in memory either way; on = it is also written to `deets.cardMemory`) |
| Look and feel | Change look at (Changes between a day look and a night look. Sun times come from your time zone, not your location) — menu *Sunrise and sunset* / *Set times* / *Windows mode* / *Off* (2026-09-15) | `lookSchedule` | **off** / sun / clock / windows | `look-schedule.ts` ([LOOK-SCHEDULE.md](LOOK-SCHEDULE.md)); the rows below show only while it is on |
| Look and feel | Day look · Night look — split: theme menu \| skin menu | `dayTheme` `daySkin` · `nightTheme` `nightSkin` | **lilac press** · **black-red cyber** | `look-schedule.ts` `applyLook` |
| Look and feel | Day runs (set times only) — split: start menu \| end menu, half-hour steps | `dayStart` · `nightStart` | **07:00** · **19:00** | `look-schedule.ts` `planClock` |
| Look and feel | Shift sun times (sun only) — menu −60…+60 min | `sunShift` | **0** | `look-schedule.ts` `planSun` |
| Look and feel | Menu pick lasts — pills *Until next change* / *For good* | `lookHold` | **next** / always | `look-schedule.ts` `noteHandPick` (main.ts Theme/Skin clicks) |
| Look and feel | Animate look changes (Theme and skin changes play the launch animation. Off: they change at once) — also the launch fade | `appearanceMotion` | on / off | `appearance.ts` (`withAppearanceTransition`, the launch cover's veil → wait → lift, UX-COVERUPS.md §6a) and `boot-cover.ts`; OS reduced motion still snaps |
| Look and feel | Animate card swaps (Cards move to their new places in the skin's own motion. Off: they change at once) — default **on** (was off until 2026-09-16) | `cardSwapMotion` | on / off | `card-swap.ts` from `layout.ts` `setSlot` (picker swap, summon, replace); skin tokens `--swap-*`; OS reduced motion still snaps; [CARD-SWAP.md](CARD-SWAP.md) |
| Look and feel | Animate backgrounds (The moving Ocean, Glass, and Cyber backgrounds. Reduced: fewer updates, less CPU. Off: they hold still) | `backgroundMotion` | on / reduced / off | `ambient.ts` → `data-bg-motion` on `<html>`: reduced sets `--ambient-fps: 15` (skin.css), off pauses the loops and hides the storm (styles.css); OS reduced motion still wins |
| Look and feel | Draw card edges (Ocean only. Sand: the card edges break into grains, like a dark beach) — pills *Sand* / *Soft*; shows only while Ocean is the skin (2026-09-15; a stored `waves` or `fade` from the dropped versions migrates to soft) | `oceanEdges` | **soft** / sand | `skin-settings.ts` → `data-ocean-edges` on `<html>`; UI-ARCHITECTURE.md §Sand edges |
| Look and feel | Sand width (Ocean only. How far the sand reaches into each card) — slider 0–100% (2026-09-15); shows only while Ocean is the skin and Draw card edges is Sand | `oceanSand` | **15** / 0–100 | `skin-settings.ts` → `--ocean-sand` on `<html>` → Ocean `--sand-reach` = 4px…40px |
| Look and feel | Fancy Glass (Glass only. A live blur behind the cards, a moving background, and four sliders. Without a graphics card: about 85% fewer frames) — toggle (2026-09-16); shows only while Glass is the skin | `glassFancy` | **off** / on | `skin-settings.ts` → `data-glass-fancy` on `<html>`. Off: skin.css paints the frost into each card (`--glass-frost-paint`, pinned with `background-attachment: fixed`), the aurora holds still (`--aurora-drift: none`), and the four sliders publish `GLASS_LOCKED` (65 / 85 / 40 / 10). On: the live `backdrop-filter`, the drift, the stored sliders. Measured: DEBUGGING.md §Fancy Glass and the Ocean swell |
| Look and feel | Canvas glow (Glass only. How brightly the colors glow on the background. The cards do not change) — slider 0–100% (2026-09-15; was named Backlight for an hour — a stored `glassBacklight` migrates here; a Frost cards blur slider was dropped the same day); the four Glass sliders show only with Fancy Glass on (2026-09-16) | `glassCanvasGlow` | **40** / 0–100 | `skin-settings.ts` → `--glass-canvas` → Glass `--glass-glow` scales the `--aurora-*` stops (50 = as written, 100 = double, capped at 100%) |
| Look and feel | Dim canvas (Glass only. Darkens the space between the cards. The cards stay as bright) — slider 0–100% (2026-09-15); shows only while Glass is the skin | `glassCanvasDim` | **10** / 0–100 | `skin-settings.ts` → `--glass-canvas-dim` → Glass `--canvas-dim` (100 → 0.9) paints `.app-body::after`; the frost's `brightness(1 / (1 − dim))` undoes it inside the cards |
| Look and feel | Backlight (Glass only. A light behind each card, under its tint) — slider 0–100% (2026-09-15); shows only while Glass is the skin | `glassBacklight` | **85** / 0–100 | `skin-settings.ts` → `--glass-backlight` → Glass `--glass-light` → the card's `--panel-paint` glow + the outer halo in `--shadow-card` |
| Look and feel | Tint cards (Glass only. The card color over the backlight. Less tint: more glow) — slider 0–100% (2026-09-15); shows only while Glass is the skin | `glassTint` | **65** / 0–100 | `skin-settings.ts` → `--glass-tint` on `<html>` → Glass `--panel` mix, painted as the last inset shadow over the backlight (skin.css) |
| Look and feel | Record player (Press only. The cover becomes a record. Spin: it turns while music plays) — pills *Spin* / *Still* / *Off* (2026-09-15); shows only while Press is the skin | `pressVinyl` | **off** / spin / still | `skin-settings.ts` → `data-press-vinyl` on `<html>`; `vinyl.ts` — [VINYL.md](VINYL.md) |
| Look and feel | Show record on (Press only. Stage: the big cover in max and the player view. Everywhere adds the tray panel) — pills *Stage* / *Stage + card* / *Everywhere* (2026-09-15); shows only under Press with Record player on | `pressVinylWhere` | **everywhere** / stage / card | `skin-settings.ts` → `data-press-vinyl-where` → skin.css `--vinyl-stage` / `-strip` / `-tray`; the tray panel reads the store through a `storage` event |
| Look and feel | Spin speed (Press only. How fast the record turns, in turns each minute. 33⅓ is an LP, 45 a single) — pills *33⅓* / *45* / *78* (2026-09-15); shows only under Press with Record player on Spin | `pressVinylSpeed` | **33** / 45 / 78 | `vinyl.ts` `turnS()` → the turn period; the song-follow math is unchanged — [VINYL.md](VINYL.md) §4 |
| Look and feel | Show record plate (Press only. The offset ink behind the record. Off: only the record, a little larger) — toggle (2026-09-15); shows only under Press with Record player on | `pressVinylPlate` | **on** / off | `skin-settings.ts` → `data-press-vinyl-plate` → `--vinyl-plate-shadow: none`, `--vinyl-inset: 0px` |
| Look and feel | Open menus on hover | `menuMode` | click / hover | `main.ts` → `setDropdownMode` |
| Look and feel | Show hover hints — the themed hint box ([ONBOARDING.md](ONBOARDING.md) §1a). Off silences the written hints AND the row hints | `hoverHints` | bool | `hint.ts` |
| Look and feel | Hints appear after — *A moment* 250 ms / *A pause* 600 / *A while* 1100. A song row always waits 1.6× this. Hidden while Show hover hints is off | `hoverHintDelay` | quick / normal / slow | `hint.ts` `DELAY` |
| Look and feel | Name songs on hover — the two-line box on a list row: *Always* / *Cut off* (only when the ellipsis really cut the name) / *Never*. Hidden while Show hover hints is off | `hoverSongNames` | always / cut / off | `hint.ts` `rowHint()` |
| Look and feel | Show notices ([TOASTS.md](TOASTS.md)) — *Everything* / *Failures* (Off removed 2026-09-14) | `toasts` | all / failures | `toast.ts` `admitted()` at every call; a question toast always shows |
| Playback | Play Now plays (§1) — pills *Song only* / *Song and rest of list* | `playNowScope` | **list** / song | `library-card.ts` `trackMenu` (needs the row's list) |
| Playback | Drop on Now Playing — pills *Keep Up Next* / *Replace it* (2026-09-14) | `dropPlayQueue` | **keep** / replace | `drop-actions.ts` `dropToPlay` → `player.playTracksKeepQueue` (top of Up Next + jump); an Up Next row moves to the top first (`qcard.ts`). DRAG-DROP.md §3 |
| Playback | Previous rewinds (§4) — *The list* / *Played songs* | `previousReach` | lookback / heard | `queue.ts` `setContext` (heard = no parked lookback) |
| Playback | Restore on launch (2026-09-12) — *Last song* / *Up Next* / *Nothing* | `restoreQueue` | song / queue / off | `queue-persist.ts` (blob in the cache db's `meta`; song = Now Playing paused + Up Next + Previous, queue = song parked atop Up Next, Now Playing idle) |
| Playback | Button is perma-shuffle (NEXT-VERSION §14, 2026-09-15) — toggle: the Shuffle button is a mode; off = it shuffles Up Next once | `shuffleStays` | **on** / off | `player.ts` `toggleShuffle` / `isShuffleOn`; the mode's state is `shuffleMode` (no row; Reset › Playback clears it), repeat's is `repeatMode` (no row, NEXT-VERSION §12) |
| Playback | Shuffle keeps picks (§5a) — *First* / *In place* / *Mixed* | `shuffleManual` | top / hold / mix | `queue.ts` `shuffleUpcoming` |
| Playback | Stream quality (Auto follows your network speed; High is 256 kbps and Low is 64 kbps, from the next song) — *Auto* / *High* / *Low* (2026-09-16) | `streamQuality` | **auto** / high / low | `player.ts` `applyStreamQuality`: sets `music.bitrate` after configure, on a change, and (Auto) on Chromium's `navigator.connection` change, with a 0.5 / 1 Mbps gap. [AUDIO-QUALITY.md](AUDIO-QUALITY.md) §4.1 |
| Playback | Idle shuffle plays (§5b) — *Library* / *Nothing* | `shuffleIdle` | library / noop | `player.ts` `shuffleQueue` |
| Playback | Show the day in History (Each row says Today, Yesterday or the date, next to the artist) — toggle (2026-09-15) | `historyShowDay` | on / **off** | `history-card.ts` — the day joins the row's subtitle line; never a divider ([QUEUE.md](QUEUE.md)) |
| Apple Music | Add to Library and ♥ (Can't remove from library via DeetsMusic) | module | on / off | `library-add.ts` (menus + the NP square + the row squares of `add-square.ts`); the ♥ (`favorites.ts`) rides the same consent, hence the label (2026-09-14) |
| Apple Music | Show ✓ on songs you have (On: the + on a song row turns into a ✓ when the song is already in your library. Off: no button) — toggle (2026-09-17) | `addSquareOwned` | on / **off** | `add-square.ts` `stateOf` — the row squares in Search, Playlists, Queue, History ([SEARCH.md § Add-to-Library square](SEARCH.md)) |
| Apple Music | Export playlists (Can't rename, reorder, or delete on Apple Music via DeetsMusic) — 2026-09-14 | `playlistExport` | on / off | `playlist-export.ts` `exportItem` (hides Export ▸) — [PLAYLISTS.md §6](PLAYLISTS.md) |
| Last.fm | Scrobble plays (Sends each song to your Last.fm profile once you hear half of it or 4 minutes) — 2026-09-16. Status line under the rows: the account and the waiting count | Rust `lastfmScrobble` (`settings_set_lastfm_scrobble`) | **on** / off | `lastfm.rs` `lastfm_heard` — [LASTFM.md §6](LASTFM.md) |
| Last.fm | Show now playing (Your Last.fm profile shows the song while it plays) — 2026-09-16 | Rust `lastfmNowPlaying` (`settings_set_lastfm_now_playing`) | **on** / off | `lastfm.rs` `now_playing` |
| Home | Hiding lasts (Right-click a Home tile and Hide to take it off the card) — pills *Until cleared* / *This session* (2026-09-15) | `homeHideLasts` | **forever** / session | `home.ts` `hiddenMap` — [HOME.md §5](HOME.md) |
| Home | Hidden tiles (Puts every hidden tile back on Home. Playing one again also brings it back) — a *Clear* action; the section's status line counts them | `homeHidden` (key → hidden-at ms) | **{}** | `home.ts` `clearHidden` / `hiddenCount` |
| Playlists | Show playlist counts (§14) (One small request per playlist, once) | `playlistEagerCounts` | on / off | `playlists-card.ts` backfill |
| Playlists | New playlist opens Search (Puts the Search card beside the new playlist. Mini shows one card, so Search would hide it) — pills *Not in mini* / *Always* / *Never* (three-way 2026-09-15; was a toggle, `true` → **notmini**) | `playlistCreateSummon` | **notmini** / always / off | `playlists-card.ts` `createAndEnter`, against `currentSurface()` |
| Playlists | Show cover (For a song from a playlist, in Now Playing and the tray panel) — *Album* / *Playlist* (2026-09-15) | `nowPlayingCover` | **album** / playlist | `playlist-cover.ts` `playlistCoverFor` → `now-playing-card.ts`, `np-bus.ts` → `tray.ts` — [PLAYLISTS.md §11](PLAYLISTS.md) |
| Playlists | Web reach (1 reaches the artist's collaborators. Each step reaches one circle further) — *1* / *2* / *3* (2026-09-16) | `webReach` | 1 / **2** / 3 | `web.ts` → `web_build` — [PLAYLIST-WEB.md](PLAYLIST-WEB.md) |
| Playlists | Web size (Songs in a new web playlist) — *25* / *50* / *100* (2026-09-16) | `webSize` | 25 / **50** / 100 | `web.ts` `pickSongs` — [PLAYLIST-WEB.md §4](PLAYLIST-WEB.md) |
| Playlists | Close on Make (Pop out closes the web panel at once while the artist flies to the playlist) — *Shrink to chip* / *Pop out* (2026-09-16) | `webMakeMotion` | **shrink** / pop | `web.ts` `shrinkInto` + `handoff.ts` — [PLAYLIST-WEB.md §2b](PLAYLIST-WEB.md) |
| Playlists | **No Settings row** (user's call 2026-09-17): the web panel's Temp \| N days button remembers the days; every new web starts on Temp | `webTempDays` | 1 / 3 / 5 / **7** / 30 | `web.ts` `renderLife` → `playlist_create(expire_days)`; the check in `playlist-expiry.ts` — [PLAYLIST-WEB.md §10](PLAYLIST-WEB.md) |
| Playlists | Genres for Webbing (Web only leaves the artist's songs unfiltered. Keep 5 keeps at least five) — *All songs* / *Keep 5* / *Web only* (2026-09-16) | `webSeedFilter` | **all** / floor / off | `web.ts` `pickSongs` — [PLAYLIST-WEB.md §3–4](PLAYLIST-WEB.md) |
| Playlists | Web prefers (Familiar puts your songs first. Discover puts songs you don't have first) — *Familiar* / *Discover* / *Mix* (2026-09-16) | `webPrefer` | familiar / discover / **mix** | `web.ts` `pickSongs` — [PLAYLIST-WEB.md §4](PLAYLIST-WEB.md) |
| Playlists | New cover (How a new playlist's cover starts. Letters and Note keep the theme you made it in) — *Letters* / *Mosaic* / *Note* (2026-09-15) | `newPlaylistCover` | **letters** / mosaic / note | `playlists.ts` `playlistCreate` → `cover-art.ts` — [PLAYLISTS.md §11](PLAYLISTS.md) |
| Rewind | Rewind card (Shows after 50 plays → Your listening, ranked) | `rewindCard` (+ `rewindAutoShown`) | off / on | `layout.ts` pool (§4 below) |
| Rewind | Count a play at (§7) — *90%* / *End* / *Half or 4 min* | `fullPlayRule` | fraction / end (99%) / scrobble | `stats.ts` `listenedThrough` |
| Rewind | Weekly Replay — day menu (*Mon … Sun*) + on/off (A playlist of the past week's most-played songs, made on this day) | `replayDay` + `replayAuto` | mon / … · on / off | `replay.ts` `lastDue` / `runWeeklyReplay` (boot) |
| Rewind | Keep every Replay (Each week gets its own dated playlist in a Replay folder. Off: one playlist, replaced weekly) | `replayKeep` | off / on | `replay.ts` `runWeeklyReplay` |
| Connections | Agent changes settings (An AI app or the command line changing these settings. Ask: DeetsMusic asks you each time) — *Allow* / *Ask* / *Off* (2026-09-15); agents can't change it | `agentSettings` | **ask** / allow / off | `agent-settings.ts` `settingsWrite` — [AGENT.md §6](AGENT.md) |
| Connections | Agents read play history (Lets a connected agent see what you played, when, and what you skipped) — 2026-09-16 | Rust `agentHistory` (`settings_set_agent_history`) | **on** / off (agents: off only) | `bridge.rs` `/query`, `/songs`, `/history` — [LOCAL-DATA.md §9](LOCAL-DATA.md) |
| Connections | Agent control (Lets a CLI or an AI app drive DeetsMusic on this PC) — Guide + on/off · Copy setup for (Claude Desktop / Claude Code / Cursor / Other) · agent status · extension bridge status · Extension install guide | Rust `agentControl` | on / off | `bridge.rs` gate (403) — [AGENT-SETUP.md](AGENT-SETUP.md); `bridge_info` / `bridge_open_install_page` ([EXTENSION.md](EXTENSION.md)) |
| Updates | Get updates (Automatic: downloads in the background, then asks to restart. Ask: asks before the download) — *Automatic* / *Ask* / *Off* (2026-09-14) | `updateMode` (+ `updateSkip`) | **auto** / ask / off | `updater.ts` `initUpdater` tick + `checkForUpdate` — [RELEASE.md §6.3](RELEASE.md) |
| Updates | Check for updates — Check now · Roll back — version menu + Install · the status line (version, progress, ready) | — | — | `update_check` / `update_versions` (one request per session) / `rollbackTo`; `onUpdateStatus` repaints the line |
| Reset | Look and feel (theme and skin + every Look and feel row) with indented parts: Theme and skin · Look schedule · Motion · Skin settings (`set__row--sub`); then Window · Playback · Playlists · Rewind · Everything — each row a *Reset* button (2026-09-15; Menus, hints and notices — Open menus on hover, the three hover-hint rows and Show notices — resets only with Look and feel or Everything) | `RESET_GROUPS` in `settings-card.ts` (theme and skin: `defaultTheme()` / `defaultSkin()`, the first-launch pair) | `DEFAULTS` | Reset → sticky toast *Confirm* / *Cancel* → a timed toast with *Undo* (the snapshot is taken at Confirm). A group already at its defaults flashes *Default*. Not reset: Close to tray, Start with Windows, the consent gates, Agent changes settings, Updates. Theme and skin change under the look animation as a hand pick (`noteHandPick`) |
| Bugs | App log — Open folder · Copy | — | — | `log_open_folder` (+ `diag.flush()` first; LOGGING.md) / `bridge_log` |
| About | Apple trademark notice · privacy notice (open by default) | — | — | — |

**Sections regrouped 2026-09-14** (Window / Look and feel / Home / Playback / Apple Music /
Playlists / Rewind / Connections / Bugs / About; Home joined 2026-09-15). Every section but About starts folded; a fold persists
by section title (`deets.settings.folds`), so renamed sections start folded once.

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
4. Update the table above and the source entry in FUTURE-SETTINGS.md.
   Add the key to its group in `RESET_GROUPS` (`settings-card.ts`), unless it is a consent
   gate or Rust owns it.
5. Agents ([AGENT.md §6](AGENT.md)): add the row to `SPECS` in `src/agent-settings.ts`, with the
   card's label, section and choices. A consent gate (like Add to Library) takes
   `offOnly: true`; a value agents must never change takes `readOnly: true`.
