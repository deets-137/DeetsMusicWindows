---
status: built
desk_test: passed 2026-10-30
sources: [src/update-card.ts, src/update-card-rules.ts, src/paged-card.ts, src/onboarding.ts, src/styles/onboarding.css, src/settings-card.ts, src/settings-store.ts, src/release-leads.ts, vite-release-notes.ts, src/updates-btn.ts, src/update-rules.ts, src/compass.ts]
updated: 2026-10-30
---
# The update card — new settings after an update

> Designed 2026-10-26, BUILT 2026-10-29 on `updatez`. His ask: a copy of the grand-opening
> card shows and sets the settings that are new, and it offers the defaults that changed. One
> page per version line. §1 is his calls. §2 is what the code did before. §3 is the design
> inside his calls; §3.11 (the change log, the panel's own open) and §3.12 (the card) are the
> as-built records. §5 is what is still to ask.

**Terms.** The **update card** is the copy of the grand-opening card (`src/onboarding.ts`,
`features/GRAND-OPENING.md`). A **version page** is one page in the update card, for one
release. The **range** is the versions after the one the user last ran, up to the one they
have now.

## 1. His calls (2026-10-26)

1. **Page order: oldest first.** The range's pages read from the oldest version to the one the
   user has now. The last page's button is *Done*, as *Let's Boogie* ends the grand opening.
2. **The × means done.** The card does not open again by itself. The N badges stay on each row
   the user did not rest the pointer on. A Compass row, *What's New*, opens the card again with
   the **last 3 versions**, and a page to **search the older updates** (§3.7).
3. **The full card in all cases**, also for an update with one new setting. No toast path.
4. **Three columns, as on onboarding pages 1 and 2:** column 1 the release notes, column 2 the
   settings, column 3 previews (optional, only on a page that has one).
5. **U1 A: the card opens only when the range has a new setting or a default change.** An
   update with no settings is a fixes update, so it does not stop the user.
6. **U2 A, with a limit: the full paragraphs, each lead in bold. When an entry does not fit
   the column, the column shows the bold leads only, and a lead expands to its paragraph.**

### 1.1 His calls (2026-10-29, branch `updatez`)
7. **The change log: one record per setting, plus one log line per change** (fork 1 A, §3.9).
   The record keeps who set the setting last, when, and in which version. Not a full history.
8. **A changed default is offered to every user whose value is still the old one**, also a
   user who picked that value on purpose (fork 2 B; "users can ignore"). §3.4 stays as written.
   The change log does not gate the offer.
9. **The Updates panel opens by itself on the first launch after a 1.X or X.Y update that has
   a new setting.** A 1.2.X update does not open it. A toggle in What's new makes it open after
   every update (§3.10).
10. **The panel replaces the update card's own open** (fork 3 A). Call 5 is replaced: the update
   card no longer opens by itself. It opens from the panel and from *What's New* in the Compass.
   A changed default counts too (call 12).
11. **The history goes back to 1.0.0 only** (2026-10-29). No user ran a version before 1.0, so no
   version page, *What's New* entry or Older search result is older than 1.0.0. The `since` on a
   pre-1.0 `NEW_MARKS` line stays (it costs nothing and no range reaches it), and no pre-1.0
   release entry is bundled.
12. **A changed default opens the panel, and never changes the user's value** (2026-10-29). It
   counts only while the user's own value is still the old default (`offeredDefaultVersions`,
   update-rules.ts): a user who picked another value, or already has the new one, is not told.
   The new value is applied only by the user's press (§3.4, *Use it*).
13. **The card opens on the first version the user has not run yet** (2026-10-29). 1.2 → 1.3
   opens on 1.3; 1.1 → 1.3 opens on 1.2, and Next goes to 1.3. When nothing is new (no update
   yet, or the card was already opened in this version) it opens on the newest. The rule is
   `startLine` (update-card-rules.ts, a test); the marks are `deets.updates.before` (written by
   the launch after an update, updates-btn.ts) and `deets.updates.cardSeen` (the version the card
   was last opened in). Run on the dev app: from 1.0.0 it opened on 1.1 with *Next*; the second
   visit opened on 1.2.

## 2. What the code does today

- **A changed default never reaches an existing user.** `setSetting` writes the whole state to
  localStorage (`settings-store.ts`, `setSetting`), and `load()` is `{ ...DEFAULTS, ...stored }`.
  After a user's first change, every default they had then is saved as their own value. A new
  default reaches them only through a `migrate()` step. The update card is the way to offer it.
- **The list of new settings exists:** `NEW_MARKS` (`settings-card.ts`), one line per new row or
  section, with the date in a comment. The N badges and `seedNewMarks` (a fresh install sees
  nothing as new) read it. The update card reads the same list. It is not a second list.
- **No last-run version is stored.** The app does not know which version it last ran.
- **The bundle holds one version's notes.** `virtual:release-notes` (`vite-release-notes.ts`)
  puts only the installed version's bold leads in the bundle. `releaseEntries()`
  (`release-leads.ts`) already reads every entry; RELEASE-NOTES.md is 49 entries, 87 KB.
- **The three-column page exists:** `.onboarding__cols` (`styles/onboarding.css`), a title on
  top and three columns split by lines. In Midi and Mini the columns stack.
- **The grand-opening card mounts the whole Settings card as a page** (`buildPage` in
  onboarding.ts). To check before a build: can the Settings card mount a given list of rows?

## 3. The design

### 3.1 The sources
- **New settings:** each `NEW_MARKS` line gets `since: "1.2.0"`. A version page shows the lines
  whose `since` is that version. The older lines get their `since` back-filled from the date in
  their comment and the dates in RELEASE-NOTES.md, so the search page (§3.7) can show them.
- **Default changes:** a new list, `DEFAULT_CHANGES`, one line per change:
  `{ since, key, from, to, why }`. A line is added in the same commit as the change to `DEFAULTS`.
- **Release notes:** the release-notes plugin bundles every entry from 1.0.0 on (his call 11),
  not only the installed one. The entries load with a dynamic import when the card opens, so the
  first paint does not carry them. The *Fixes* paragraph is left out, as in the Updates panel.

### 3.2 When the card opens
> **Part:** replaced · 2026-10-29 — the card no longer opens by itself (his call 10). The
> Updates panel opens instead (§3.10), and a button there opens the card (to build with the card).

- On the first launch after an update, after the launch cover, when the range has a setting or
  a default change on any of its pages (his call 5). An update with notes only does not open
  it; its notes stay in the Updates panel and in *What's New*.
- Not on a fresh install: it stores the current version and shows nothing.
- Not while the grand opening is pending (`openingPending`).
- A new key, `settingsSeenVersion`: the last version whose card the user closed or did not need.
  It gets a default with its "why", a spec in `agent-settings.ts` and a line in AGENT.md.

### 3.3 A version page
The title: the version and its date. Then the three columns:
1. **Notes** — the version's release notes (his call 6). When the entry fits the column's
   height, it shows the full paragraphs, each lead in bold. When it does not fit, each
   paragraph shows as its bold lead only, and a click on a lead expands its paragraph below it.
   The fit is measured when the page mounts and again when the card changes size.
   Claude's choices for his review: a lead expands only its own paragraph (the others stay
   closed); the expand rides `enterRows`; a lead is a button, so Enter and Space expand it.
2. **Settings** — the version's new rows, live, as in Settings. Then its default changes (§3.4).
3. **Previews** — only when a row on the page changes what the cards look like (§3.6). With no
   preview, the page has two columns.

A version with no settings and no default changes still gets a page in the range, with its notes.

### 3.4 Default changes
A change shows only when the user's value is still `from`. The page shows the row with one line
under it ("New default: *Spacious*") and a *Use it* chip. The app never changes the value
without the user's press. A row a rule owns shows the rule's value, as Settings does
(`effective`); *Use it* sets the user's own value, and the rule stays in front.

### 3.5 Across versions
- A key changed in two versions shows once, on the later page, with its latest value.
- A row added and then removed shows on no page.
- When a row is shown on a version page, its N is marked seen (`quickSeen`), so the badges and
  the card agree.

### 3.6 Previews
A row that changes the layout or the spacing changes the cards behind the update card, where the
user cannot see them. Its page shows a preview tile, as page 2's layout picks do
(`onboarding-looks.ts`). Each preview is designed with him, row by row, when the row is built.

### 3.7 What's New from the Compass
- A Compass row, *What's New*, opens the card with the last 3 versions (oldest first), whatever
  the user saw before. A default change there still shows only while the value is `from`.
- A nav button, **Older**, above Settings at the bar's foot, opens the search page: one search
  field (`searchField()`) over every entry's notes and its settings' names. A result names the
  version and the matched lead or row. A click opens that version as a page.
- To ask him: should release entries also be a Compass data kind, so typing a lead word in
  Ctrl+Space finds the version? (COMPASS.md §9: one row in `compass.ts`.)

### 3.8 The frame
The update card is the grand opening's frame, with a second caller: the nav bar, the glide, the
page slide, the nav tokens. Its numbered pages are versions ("1.2", "1.3"); Settings stays at the
foot. The page motion, the hints, `enterRows`, `app-scroll` and `dataset.frames` come from the
frame as they are.

### 3.9 The change log (his call 7)
> **Part:** built · 2026-10-29 on `updatez`; desk test passed (§3.11). §3.11 is the as-built record.

Every write to the settings store goes through `setSetting` (`settings-store.ts`), about 120
calls in 29 files. The log sits there.
- **The source is a required argument:** `setSetting(key, value, source)`. Then `tsc` lists
  every call, and no call falls back to a default source. A shared "current source" variable is
  not used: it breaks across `await`.
- **The sources (a draft for his edit):** `onboarding` (the grand-opening pages), `walk` (the
  first-run walk), `settings` (the Settings card), `quick` (the cog's quick panel), `panel` (a
  control on a card or panel: the Sound panel, the pin panel, the look buttons), `agent` (the
  MCP, the CLI, the HTTP bridge), `rule` (the Rulez card writing your own value; a rule's
  overlay is not a change and is not logged), `window` (a change from another window, such as
  the tray panel, through the `storage` event), `app` (the app's own state: `onboardingStep`,
  `quickSeen`, `updateSkip`, `rewindAutoShown`; logged, never counted as a user's pick).
- **The record:** a second localStorage key beside the store, key → `{ source, at, version }`.
  It is not a `Settings` key, so it is not in the store's blob and no agent spec reads it.
- **The log line:** `diag.log("setting", { key, source })` per change. The value is not in the
  line: a value can be personal (a city, a picture id).
- **Rust's settings** (Close to tray, Start with Windows, Agent control) are not in the store.
  The same helper records them where the Settings card or the agent sets them.
- **On this PC only.** Nothing goes to DeetsSupport. A count of sources in the weekly usage row
  is a separate change (USAGE-COUNTS.md, its allow-list).
- **Existing users:** on the first run of this build, a key whose value is not its default gets
  the source `before`. A key on its default gets no record.
- **Who reads it:** the `diag` ring and the log file now; the update card and the agent later.

### 3.10 The Updates panel opens by itself (his call 9)
> **Part:** built · 2026-10-29 on `updatez`; desk test passed (§3.11). Where §3.11 differs, it is the code.

- **A new key, `lastRunVersion`:** the version the app ran last. It is written at launch, after
  the check below. The updates button's `readSeen` is not it: that is written when the panel
  opens.
- **The check:** at launch, when `lastRunVersion` is set and differs from the version now. The
  rule is pure (a small file with a test): open when the major or minor number changed AND a
  version in the range has a new setting (`since` on `NEW_MARKS`, §3.1). With the toggle on,
  open after every update, patch or not, with or without a new setting (his words: "after every
  update").
- **What opens:** `openUpdatesPanel(true)`, so What's new is unfolded. In Mini and Midi that is
  the quick panel's Updates square (its rows are Settings › Updates).
- **The toggle:** one Settings row in Settings › Updates, *Show what's new after every update*,
  default off (his rule is the default). The What's new group in the Max panel mounts the same
  row through `mountSettingsParts`, as the panel's Bugs rows do. A key with its "why", an agent
  spec, a line in AGENT.md, a `NEW_MARKS` line.
- **Not on a fresh install** and **not while the grand opening is pending** (`openingPending`).
- **How it sits with the update card:** the panel replaces the card's own open (his call 10).

### 3.11 As built (2026-10-29)
**The change log**
- `settings-store.ts`: `SettingSource`, `recordSetting`, `lastChange`, `onSettingChanged`,
  `setSettingsVersion`. The record is `localStorage["deets.settings.log"]`. `setSetting` takes the
  source as its third argument; a look pair it writes with the key is recorded with the same source.
- **The sources as built:** the draft above, with two changes. `compass` is added (a toggle or a
  choice set in the Ctrl+Space bar). `window` is dropped: the tray panel writes through its own
  `setSetting` with its own source, and the `storage` event in the other window only re-reads.
- **The Settings card** takes its source from its mount: the card is `settings`, the quick panel
  `quick`, the grand opening's pages `onboarding`, the Updates panel `panel`, the Compass's index
  `compass`. `mountSettingsParts` takes the source as its third argument.
- **Shared setters take a source:** `pickLook`, `setRepeat`, `cycleRepeat`, `setShuffleMode`,
  `shuffleOff`, `toggleShuffle`, `shuffledPlay`, `shuffleLibrary`, `selectPreset`,
  `commitBands`, `setWallpaperFromFile`, `pickWallpaper`, `pauseSharingForAnHour`.
- **Rust's rows** are recorded under the agent's key (`closeToTray`, `startWithWindows`,
  `airplaySend`, `lastfmScrobble`, `lastfmNowPlaying`, `agentControl`, `agentHistory`,
  `agentDiary`, `sotd*`): `notifyOwnedSettingChange(key, source)` records for the agent, and the
  Settings card calls `recordSetting` beside each `invoke`. The rule's *Scrobble* action records
  `rule`.
- **The log line** is `setting {key, source}`, wired in main.ts and tray.ts.
- **Claude's choices inside his calls:** the app's own writes that follow a user press are
  `panel` (the Sound review toast's *Keep* and *Turn off*); the look schedule writing the shown
  look when it turns off is `app`; `soundOutputNames` is `app`; the dev `__store.set` is `app`.

**The panel's own open**
- The rule is `opensWhatsNew` in `update-rules.ts` (pure, three tests in
  `tests/update-rules.test.ts`). `openByItself` in `updates-btn.ts` runs at the end of
  `initUpdatesButton`; a launch to the tray opens it when the window first shows.
- **The last-run version is not a setting:** `localStorage["deets.updates.lastRun"]`, a
  per-install mark like `deets.updates.seen`. The first launch of the build that brings it has
  no mark: it takes `deets.updates.seen` (the version the panel was last opened in), else none.
- **`since` on every `NEW_MARKS` line.** The 49 older lines were dated from git: the first
  `package.json` version after the commit that added the line (a beta rounds to its release).
  Three by hand from their dated comments: *Album Reviews* (renamed from Diary; 0.14.5),
  *Spin FPS* (0.30.0), *Today's time in* (0.31.0). The new row's line says `1.3.0`: the next
  release's number is a guess, to fix at release time.
- **`DEFAULT_CHANGES`** sits beside `DEFAULTS` in `settings-store.ts`, empty today. A line counts
  for the panel's open only while the user's value is still its `from` (call 12; a fourth test).
- **Where the offer shows:** on the update card (§3.12, choice 8). The panel that opens for a
  default change leads there through *See the new settings*.
- **The toggle:** Settings › Updates › *Show what's new after every update* (`whatsNewEveryUpdate`,
  default off), its agent spec, a `NEW_MARKS` line, not sent in usage counts (his call first,
  `usage-keys.ts`). The Max panel's What's new draws the same row under the leads while the
  group is open, through a new `bare` option on `SettingsPart` (rows only, no heading or fold).
- **The *See the new settings* button** in the panel: built with the card (§3.12).

**Desk test: passed 2026-10-29** (his click, then Claude on the dev app). He turned the toggle
on in the Max panel's What's new: the record read `{ source: "panel", version: "1.2.1" }`.
Claude set `deets.updates.lastRun` to `1.2.0` and reloaded: the panel opened in Max with What's
new unfolded, the leads and the toggle row shown, and `lastRun` became `1.2.1`. A second reload
left it shut. Not run on the app: the default path (1.2 → 1.3 with a new setting, toggle off)
needs a 1.3.0 build; the unit tests cover it. Mini and Midi not run.

The steps:
1. In DevTools: `localStorage["deets.settings.log"]` holds a record after a change in the
   Settings card (`settings`), the quick panel (`quick`), the Compass (`compass`), the Sound
   panel (`panel`), and an agent `settings` call (`agent`). The log file has a `setting` line
   for each, with no value.
2. Set `localStorage["deets.updates.lastRun"] = "1.2.1"` and restart: the panel opens with
   What's new unfolded (1.2.1 → 1.3.0 brings the new row). Restart again: it stays shut.
3. Set it to `"1.3.0"` with the toggle off, restart: shut. Toggle on, set `"1.2.9"`, restart:
   it opens. (Needs a build whose version is 1.3.0.)
4. In Mini and Midi the open shows the quick panel's Updates square.

### 3.12 The card, as built (2026-10-29)
> **Part:** built · 2026-10-29 on `updatez`; Claude's run on the dev app passed (below); his hand test passed 2026-10-30 (his word: "I've checked the update card").

- **The frame** is `src/paged-card.ts`, moved out of onboarding.ts unchanged (GRAND-OPENING.md's
  status box). One paged card at a time: opening one closes the other. `src/update-card.ts` is the
  second caller; the grand opening's pages stay in onboarding.ts.
- **The notes** come from `virtual:release-entries` (vite-release-notes.ts): every entry from 1.0.0
  to the installed version, a 4 KB chunk loaded by a dynamic import when the card opens.
- **The pure rules** are `src/update-card-rules.ts` (five tests): the lines, the paragraphs, the
  inline marks, a line's marks up to the installed version, the search.
- **Opened by:** the Updates panel's *See the new settings* (beside *All release notes*; the panel
  closes first) and *What's New* in the Compass, on every surface (until 2026-10-29 that row
  opened the Max panel). `window.__updateCard.open()` for a desk test.
- **The settings rows** mount with the source `update` (a new `SettingSource`); a row shown on a
  page clears its N (§3.5, `seeNewMarks`).

**Claude's choices inside his calls (for his review)**
1. **A page per minor line** (his OK, 2026-10-29), not per release: the nav reads "1.2" (§3.8), so 1.2.0 and 1.2.1
   share the 1.2 page, each under its own heading (version · date), oldest first. *The last 3
   versions* (§3.7) are the last 3 lines: 1.0, 1.1, 1.2 today.
2. **The page title** is the line in the welcome page's large type, the dates under it.
3. **Two columns** (What's new, New settings) until a row has a preview (§3.6 designs each with him).
4. **The page it opens on is his call 13** (below the calls, §1.1). The last version page's
   button is *Done*; Next on the others; none on Older and Settings.
5. **A version with no new settings** says "No new settings in this version."
6. **The leads keep their own mark** ("…the Player!"); the fit is measured against the page's
   height under the title; a lead opens only its own paragraph, through `enterRows`.
7. **Older's icon** is a clock with its hand turned back. With no words it lists every line, newest
   first; a hit names the version and "a change" or "a new setting". A line in the nav bar opens
   as its page (the glide); an older one opens inside Older, with Back.
8. **A changed default** shows its row (live), then "New default: *value*. *why*" and *Use it*,
   under a "New defaults" heading. *Use it* sets the value (source `update`) and the line goes.
   Untested on the app: `DEFAULT_CHANGES` is empty.
9. **What's new rows** (the Updates panel) keep their own *All release notes* link to the site.

**Claude's run on the dev app (2026-10-29), every check by script:**
- The card: the nav is 1.0, 1.1, 1.2, Older, Settings; it opens on 1.0 (no settings: the line
  shows), 1.1 (1.1.2's 7 leads; *Cover opens at*, *Title under the cover*), 1.2 (1.2.0 and 1.2.1,
  4 leads; the three Playback rows). The last button reads *Done* and closes it.
- The fit: with the pane cut to 260 px the notes showed the leads only; a lead opened its own
  paragraph only (`aria-expanded` true); at full height the paragraphs came back.
- Older: the three lines newest first; "queue" found two notes and *Clear the queue on launch*;
  "zzzz" said "Nothing found."; a hit for 1.2 glided to the 1.2 page.
- The Updates panel's *See the new settings* closed the panel and opened the card on 1.0.
- The grand opening on the shared frame: pages 1–5 by Next, *Let's Boogie* on page 5, Settings at
  the foot with no foot button, Escape closed it.
- Not run: a changed default (none exists), Mini and Midi, the motion's timing gate.

## 4. Not in scope
- A toast for a small update (his call 3).
- Changing a value without the user's press.

## 5. Open forks
None. U1 and U2 were closed 2026-10-26 (§1, calls 5 and 6); forks 1–3 on 2026-10-29 (§1.1).
Still to ask: release entries as a Compass data kind (§3.7), each preview, row by row (§3.6),
and his review of Claude's choices in §3.12 (a page per minor line first).
