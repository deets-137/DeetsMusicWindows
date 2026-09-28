---
status: designed
desk_test: none
sources: [src/walk.ts, src/settings-store.ts, src/rules.ts, src/layout.ts]
updated: 2026-09-28
---
# DeetsMusic — Hop in: the welcome screen and the Cruisin / Pro pick

**Hop in is the first screen of a new install.** It asks one question: Cruisin or Pro. The pick
pre-sets settings once. Then the first-run walk (ONBOARDING.md §4) goes on from it. The Recipes
section in Settings and the Rulez gate are in [RULEZ.md §16](RULEZ.md); this doc is the screen
and the two presets.

**The terms.** *Cruisin* is a listener who wants the app to play and stay out of the way. *Pro*
is a user who wants every feature on and a styled app, and who takes a little less polish for
it. The names are his.

## 1. His calls (2026-09-28)

1. **No mode.** The pick is a starting point. After it, every setting is an ordinary setting.
   The one thing the pick keeps on is a gate: the Rulez card is offered in the card picker only
   under Pro (RULEZ.md §16.1). Under Cruisin your own rules keep running, and Ctrl + Space still
   opens the Rulez card.
2. **A welcome screen before sign-in.** One screen, not several. It is the one exception to
   ONBOARDING.md §4.6.
3. **The Deets and Happy sprites stand on it** (ONBOARDING.md §4.1), so the walk starts from the
   same place.
4. **After the pick** (updated in the second round, 2026-09-28):
   - **Pro:** the sign-in step, then a walk of its own that points at the Pro parts: the Rulez
     card, Discord activity, and the styled look. The stops are §4.
   - **Cruisin:** the whole walk, as today (ONBOARDING.md §4.0).
5. **Cruisin = today's defaults.** A skip, an upgrade and a Cruisin pick all land on the same
   settings, so nothing changes for anyone who is here today.
6. **Pro = his own settings**, "everything on", more styled: **group A of §3, as drafted**
   (second round). Groups B–D stay out.
7. **Pro's heavy looks need a graphics card** (second round). `glassFancy` and `oceanLight` are
   set only when the app finds one; on a PC without one, Pro leaves them at the default.
8. **The screen's words are a placeholder for now:** the question is *Why are you here?*
9. **Each choice has a small picture.** A click on it shows more of that look (§4).
10. **The Settings row: App Mode**, pills **Cruisin | Pro**, in its own section at the very top
    of Settings, above Tips. The Recipes section comes right after Tips (RULEZ.md §16).
11. **Picking again** shows a confirm, then applies the preset over your settings. The row
    carries an info icon whose hover box lists what Pro sets. **The list is read from the preset
    file**, so it follows every change to the preset as we build, and never drifts.
12. **Not an installer page.** NSIS runs before the app has made its data folder and settings
   store, so it cannot set a setting. It would have to leave a file (or a registry value) that
   the app reads once on its first launch and then deletes. A silent update never shows the
   page, so only a first install would see it.

## 2. Against the code

- **When it shows.** `seedOnboarding()` (settings-store.ts) decides once whether this install
  was ever used, and sets `onboardingStep`. Hop in is a new step 0 in front of the walk's step 1
  (sign-in). An upgrade never sees it.
- **The pick** is one new key, `startPick: "cruisin" | "pro"`, default `"cruisin"`. It gets a
  spec in agent-settings.ts and a line in AGENT.md. The Rulez gate reads it in `poolFor`
  (layout.ts), beside the `rewindCard` test that already takes the Rewind card out.
- **A preset** is a list of keys and values in one pure file (tested like `layout-rules.ts`),
  applied once with `setSetting`. Cruisin's list is empty.
- **The walk** (walk.ts) gets the screen as its first stop and a branch after sign-in. The
  sprites, the reduced-motion rule and *Show the tour again* are the walk's own.
- **The graphics card test.** `logRenderer()` in frames.ts already tells a real card from
  software drawing (WARP, SwiftShader) by the WebGL renderer name. It is dev-only today (the
  `DEV` flag), so the test moves to a small file that both frames.ts and the preset read.
- **One list, three readers.** The preset file is read by the pick, by the App Mode info icon,
  and by the confirm. The table in §3 is a copy for people; a docs:check rule (DOCS-ORG.md §8)
  can compare it with the preset file, as the other ledgers are compared.
- **The App Mode row** is a store-backed row, so Compass reaches it by itself. It gets a
  `NEW_MARKS` line and a hint in the ONBOARDING.md §1 ledger.

## 3. The Pro list — a draft from his live settings

Read from the installed app's saved settings on 2026-09-28. 45 values differ from the defaults.
They fall in four groups. Group A is the preset (his call); B–D are listed so nothing is
missed.

**A. Pro: the look and the features he keeps on.**

| Key | Default | His | Note |
|---|---|---|---|
| `theme` / `skin` | Lilac / Press | Black & Red / Cyber | the styled start |
| `lookSchedule` | off | sun | with `daySkin` Glass, `nightSkin` Ocean |
| `glassFancy` | off | on | fails on a PC with no graphics card (COVER-WALLPAPER.md) |
| `glassCanvas` | aurora | covers | |
| `glassTiles` | some | one | |
| `oceanEdges` / `oceanSand` | soft / 15 | sand / 0 | |
| `oceanCardOpacity` | 100 | 48 | |
| `oceanLight` | 0 | 100 | costly with no graphics card (OCEAN.md §6) |
| `pressVinyl` / `pressVinylPlate` | off / on | spin / off | |
| `drillGrow` | vertical | full | |
| `rewindCard` | off | on | |
| `newPlaylistCover` | letters | mosaic | |
| `shuffleMode` / `shuffleStays` | off / on | on / off | |
| `soundEq` / `soundEqPreset` | off / flat | on / Late night | |

**B. Out: his ears, not a style.** `soundLoudness` off, `soundLoudTarget` −16, `soundLowVol`
full, `soundCrossfeed` always, `soundCrossfeedLevel` strong, `soundEqCustom`.
`soundAdaptive` is hidden behind a DevTools flag (SOUND.md §11a).

**C. Out: sharing.** `shareActivityDiscord` on. Sharing is the user's own choice, never a
preset.

**D. Out: this PC, this person, or bookkeeping.** `sizeMax`, `trayView`, `roomName`,
`roomGuestControls`, `sleepWind`, `webTempDays`, `soundEqOutputs`, `soundOutputNames`,
`soundFirstOn`, `soundReviewed`, `rewindAutoShown`, `onboardingStep`, `quickSeen`,
`updateSkip`, `glassPicture`.

## 4. The Pro walk, the pictures, the table check (his calls, third round, 2026-09-28)

**The Pro walk.** After sign-in, each stop is advanced by the real gesture, as the walk does
today. The words are placeholders (§5).

1. *The look.* "Your look follows the sun: Glass by day, Ocean by night. The name menu changes
   it." Advances when the title menu opens.
2. *Rulez.* "Make the app do things on its own. Go to Max, then pick Rulez from a card title."
   Advances when the Rulez card opens. **The walk does not switch the window to Max** (his
   call): the user does it, and so learns the way back.
3. *Discord.* "Show what you play on Discord." A **Turn on** button and a **Not now** button.
   Sharing stays the user's own choice (§3, group C): the stop offers it and never sets it.
   **The stop shows only when Discord is running** (his call), so a new check is built: today
   the app learns this only from a failed send (`sent: false`, presence.ts).
4. *Ctrl + Space*, the same stop as the Cruisin walk, then the send-off.

**A click on a choice's picture** (his call: both) opens a bigger picture in the app, with a
line of what it shows and a *Try it in the demo* link under it (deets.solutions/demo,
WEB-DEMO.md). The bigger picture works before sign-in and with no network; the link opens the
browser only when the user asks. The pictures are made by the shots runner (SHOTS.md) and
bundled with the app, so a redraw is a new run, not a new drawing.

**The table check** (his call: yes). A docs:check rule compares §3's group A table with the
preset file, and is built with the preset. It joins the ledger checks (DOCS-ORG.md §8).

## 5. Still open

1. **The words:** the question (*Why are you here?* for now), a line for each choice, and the
   Pro walk's four sentences.
2. **The Pro walk's order.** The draft is look, Rulez, Discord, Ctrl + Space.

