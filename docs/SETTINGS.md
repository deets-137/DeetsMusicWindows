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
- **The Settings card hosts every preference.** One scroll, section headers, two row
  kinds: a **toggle** (label + dot, the title-menu idiom) and a **choice** (label over a
  segmented row of pills). It is a normal registry card (`CardId "settings"`), so it can
  also be picked from any slot's title picker.
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

| Section | Row | Key | Values (default first) | Read site |
|---|---|---|---|---|
Labels are one short active statement; a choice row reads as a sentence completed by the
chosen pill. Hints ride the row as a hover tooltip only. Default first.

| Section | Row (hint) | Key | Values | Read site |
|---|---|---|---|---|
| Window | Keep on top (The window stays above other windows) | `alwaysOnTop` | off / on | `main.ts` (subscribes) |
| Window | Close to tray (× hides the window. The tray icon opens it again) | Rust | on / off | `tray.rs` close policy |
| Window | Start with Windows (Starts in the tray at sign-in) | Rust (HKCU Run key, `autostart_get` / `autostart_set`; seeded once on the first installed run) | on / off | `lib.rs` `--tray` launch → `tray::start_hidden` |
| Window | Resize changes surface (§8) | `surfaceAutoFlip` | on / off | `surface.ts` ResizeObserver |
| Look and feel | Animate look changes (Theme and skin switches fade into each other. Off: they change at once) | `appearanceMotion` | on / off | `appearance.ts` (`withAppearanceTransition`; OS reduced motion still snaps) |
| Look and feel | Animate backgrounds (The moving Ocean, Glass, and Retro-Future backgrounds. Reduced: fewer updates, less CPU. Off: they hold still) | `backgroundMotion` | on / reduced / off | `ambient.ts` → `data-bg-motion` on `<html>`: reduced sets `--ambient-fps: 15` (skin.css), off pauses the loops and hides the storm (styles.css); OS reduced motion still wins |
| Look and feel | Open menus on hover | `menuMode` | click / hover | `main.ts` → `setDropdownMode` |
| Look and feel | Show notices ([TOASTS.md](TOASTS.md)) — *Everything* / *Failures* (Off removed 2026-09-14) | `toasts` | all / failures | `toast.ts` `admitted()` at every call; a question toast always shows |
| Playback | Play Now plays (§1) — pills *Song only* / *Song and rest of list* | `playNowScope` | **list** / song | `library-card.ts` `trackMenu` (needs the row's list) |
| Playback | Previous rewinds (§4) — *The list* / *Played songs* | `previousReach` | lookback / heard | `queue.ts` `setContext` (heard = no parked lookback) |
| Playback | Restore on launch (2026-09-12) — *Last song* / *Up Next* / *Nothing* | `restoreQueue` | song / queue / off | `queue-persist.ts` (blob in the cache db's `meta`; song = Now Playing paused + Up Next + Previous, queue = song parked atop Up Next, Now Playing idle) |
| Playback | Shuffle keeps picks (§5a) — *First* / *In place* / *Mixed* | `shuffleManual` | top / hold / mix | `queue.ts` `shuffleUpcoming` |
| Playback | Idle shuffle plays (§5b) — *Library* / *Nothing* | `shuffleIdle` | library / noop | `player.ts` `shuffleQueue` |
| Apple Music | Add to Library and ♥ (Can't remove from library via DeetsMusic) | module | on / off | `library-add.ts` (menus + the NP square + the Search row squares); the ♥ (`favorites.ts`) rides the same consent, hence the label (2026-09-14) |
| Apple Music | Export playlists (Can't rename, reorder, or delete on Apple Music via DeetsMusic) — 2026-09-14 | `playlistExport` | on / off | `playlist-export.ts` `exportItem` (hides Export ▸) — [PLAYLISTS.md §6](PLAYLISTS.md) |
| Playlists | Show playlist counts (§14) (One small request per playlist, once) | `playlistEagerCounts` | on / off | `playlists-card.ts` backfill |
| Playlists | New playlist opens Search (§16) | `playlistCreateSummon` | on / off | `playlists-card.ts` `createAndEnter` |
| Rewind | Rewind card (Shows after 50 plays → Your listening, ranked) | `rewindCard` (+ `rewindAutoShown`) | off / on | `layout.ts` pool (§4 below) |
| Rewind | Count a play at (§7) — *90%* / *End* / *Half or 4 min* | `fullPlayRule` | fraction / end (99%) / scrobble | `stats.ts` `listenedThrough` |
| Rewind | Weekly Replay — day menu (*Mon … Sun*) + on/off (A playlist of the past week's most-played songs, made on this day) | `replayDay` + `replayAuto` | mon / … · on / off | `replay.ts` `lastDue` / `runWeeklyReplay` (boot) |
| Rewind | Keep every Replay (Each week gets its own dated playlist in a Replay folder. Off: one playlist, replaced weekly) | `replayKeep` | off / on | `replay.ts` `runWeeklyReplay` |
| Connections | Agent control (Lets a CLI or an AI app drive DeetsMusic on this PC) — Guide + on/off · Copy setup for (Claude Desktop / Claude Code / Cursor / Other) · agent status · extension bridge status · Extension install guide | Rust `agentControl` | on / off | `bridge.rs` gate (403) — [AGENT-SETUP.md](AGENT-SETUP.md); `bridge_info` / `bridge_open_install_page` ([EXTENSION.md](EXTENSION.md)) |
| Bugs | App log — Open folder · Copy | — | — | `log_open_folder` (+ `diag.flush()` first; LOGGING.md) / `bridge_log` |
| About | Apple trademark notice · privacy notice (open by default) | — | — | — |

**Sections regrouped 2026-09-14** (Window / Look and feel / Playback / Apple Music / Playlists /
Rewind / Connections / Bugs / About). Every section but About starts folded; a fold persists
by section title (`deets.settings.folds`), so renamed sections start folded once.

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
