---
status: idea
desk_test: none
sources: [index.html, src/updater.ts, src/update-rules.ts, src/quick-panel.ts, src/settings-card.ts, src/styles/compass.css, docs/ops/RELEASE-NOTES.md, scripts/publish-update.mjs]
updated: 2026-10-16
---
# The updates button — a Max title bar button for updates, what's new and bugs

> An idea (2026-10-16), not built. His ask, with a drawing of two arrows (a down arrow on the
> left, an up arrow on the right): a new title bar button, Max only, right of the Compass. It
> opens a panel with three parts: the version and its one action, a folding *What's new*, and a
> folding *Bugs and suggestions*. When an update exists, the up arrow flies off the top, the
> down arrow moves to the center, and the button takes the highlight color. §1 is what exists
> today; §2 his calls; §3 the design; §4 the rules that follow; §5 the forks (all closed
> 2026-10-16); §6 F1 tried on the last five releases, and the lead rule (§6.3).

## 0. Terms

- **Updates button**: the new title bar button. The glyph is his drawing: two arrows, side by
  side, that point in opposite directions (the "exchange" symbol).
- **Updates panel**: the dropdown panel the button opens.
- **Version row**: the first row of the panel.
- **Offer**: an update that exists and that the user did not skip (`updateSkip`). States
  `available`, `downloading`, `ready` (`UpdateStatus.state`, `src/updater.ts`).
- **Update toast**: the sticky toast the updater shows today (`ask()` in `src/updater.ts`).
- **Release entry**: one `## <version> — <date>` part of `docs/ops/RELEASE-NOTES.md`. Its body
  is paragraphs, each one starts with a **bold lead** ("**A new icon.**").

## 1. What exists today (read 2026-10-16)

- **The title bar, left to right:** the title, the cog (`#cog-open`, the quick panel), the
  Compass (`#compass-open`, Max only: `src/styles/compass.css` hides it in Mini and Midi), the
  drag region, then `.chrome-right`. The Updates button goes between the Compass and the drag
  region. It copies the Compass button's family: the same size token, no fill, `--subtext`
  that turns `--title` on hover and while open, the same focus ring.
- **The updater's state is ready to use.** `onUpdateStatus()` gives every change of
  `UpdateStatus` (`state`, `current`, `version`, `notes`, `size`, `got`, `rollback`,
  `error`). `checkForUpdate(true)` is *Check now*; `download()` and `restartNow()` are the two
  actions; `updateStatusText()` is the Settings › Updates status line. The button and the
  panel need no new Rust.
- **The notes of an offered version** arrive in `UpdateStatus.notes`: the release entry's text
  up to its first `###`, copied into the update index by `release:publish`.
- **The notes of the installed version** are not in the app. The index has them, but the app
  reads the index only for an offer and for Roll back's list (`update_versions`, older
  versions only).
- **The website** shows every release entry in one section,
  `https://deets.solutions/deetsmusic/#releases`. A release row has no anchor of its own.
- **Bugs:** Settings › Bugs holds the report form (kind, title, text, the log area) and My
  reports (`src/settings-card.ts`, `report.rs`). The quick panel's *Updates and bugs* square
  (`data-quick="bugs"`) already draws those rows with the Settings card's own code
  (QUICK-SETTINGS.md §3), and folds them by group (§12).

## 2. His calls (2026-10-16, in his ask)

| Question | His call |
|---|---|
| Where | **Max only**, in the title bar, right of the Compass. |
| Glyph | **Two arrows**, down on the left, up on the right (his drawing). |
| An update exists | The up arrow **flies up**, the down arrow **moves to the center**, and the button is **highlighted**. |
| Panel row 1 | The version. With an offer: the new version and a **Download** or **Restart** button. Without: the current version and a **Check now** button. |
| Panel part 2 | **What's new**, folding: short bullet points, the latest update only, a link to the website section. |
| Panel part 3 | **Bugs and suggestions**, folding. |
| F2 (2026-10-16) | **Keep the update toasts** in every surface. The button is a second, quiet place. |
| F3 (2026-10-16) | **The whole Settings › Bugs form** and My reports in the panel, drawn by the Settings card's code. |
| F4 (2026-10-16) | **After an install, the N** on the button until the panel is first opened in the new version; *What's new* opens unfolded that one time. |
| F5 (2026-10-16) | **A thin bar** under the centered arrow fills while it downloads. It slides in gently when the download starts and slides out when it ends. Downloads are small, so it seldom shows. |

## 3. The design

### 3.1 The button

- `<button class="updates__btn" id="updates-open">` after `#compass-open` in `index.html`. An
  inline SVG of two strokes and two heads, in the Compass glyph's stroke style
  (`stroke: currentColor`, `--compass-btn-size`'s alias `--updates-btn-size`).
- Hidden in Mini and Midi by the same rule as the Compass. There, the quick panel's *Updates
  and bugs* square stays the way in.
- The hover hint (ONBOARDING.md §1 ledger). Draft: *"What's new, updates and bug reports"*;
  with an offer: *"DeetsMusic 0.29.0 is ready"* (the state's own words, §3.3).

### 3.2 The motion

- **At rest:** both arrows, side by side, as drawn.
- **An offer arrives** (`available`, `downloading` or `ready`, and not skipped): the up arrow
  moves up and out of the button's box and fades. The down arrow moves to the center. The
  button's color changes to the highlight role. One motion, on skin tokens
  (`--updates-fly`, `--updates-center`, durations and curves from the skin's motion set).
- **The offer ends** (installed, skipped, or the state goes back to `idle`): the reverse. The
  up arrow comes back down into its place.
- **Downloading:** the down arrow stays centered. A thin bar under it fills with `got / size`
  (F5). The bar slides in when the download starts and slides out when it ends, on skin
  motion tokens (`--updates-bar-in`, `--updates-bar-out`). Reduced motion: the bar shows and
  hides with no slide.
- **Reduced motion:** no movement. The up arrow is gone and the down arrow is centered at
  once; the color change stays.
- At launch with an offer already known, the button paints in the offer state with no motion.

### 3.3 The panel

`makeDropdown` (`src/dropdown.ts`) on the button, `.pop` on arrival, `enterRows` on open,
`app-scroll`, `dataset.frames = "updates"`. Its rows are the panel family of the quick panel
and the Web panel, not a new family.

**Version row.** One line of text and one button, from the updater's state:

| State | Text | Button |
|---|---|---|
| idle, never checked | `Version 0.28.0` | Check now |
| idle, checked | `Version 0.28.0 · Up to date` | Check now |
| checking | `Checking for updates…` | (none, or Check now disabled) |
| available | `DeetsMusic 0.29.0 is available` | Download |
| downloading | `Downloading 0.29.0 · 42 %` | (none) |
| ready | `0.29.0 is ready` | Restart |
| ready, rollback | `0.27.0 is ready. Restart to roll back` | Restart |
| error | `Version 0.28.0. Couldn't check or download the update` | Check now |
| dev build | `Version 0.28.0 · Dev build. A dev build doesn't update` | (none) |

The text is `updateStatusText()`, so the panel and Settings › Updates say the same words.
A skipped version shows as `Version 0.28.0` with Check now; Check now offers it again, as it
does today.

**What's new.** A folding group with the Settings section header family (as QUICK-SETTINGS.md
§12). Inside: the bullets of one release entry (§3.4), then one link, *All release notes*, to
`https://deets.solutions/deetsmusic/#releases`, opened in the browser.

**Bugs and suggestions.** A folding group. Inside: the Settings › Bugs rows, drawn by the
Settings card's own code, as the quick panel's *Updates and bugs* square does (F3).

### 3.4 Which notes, and the bullets

- **The notes shown** are the newest version the user can see: the offered version's notes
  when there is an offer (what you will get), else the installed version's notes (what you
  got). The group's heading says which: *What's new in 0.29.0*.
- **The installed version's notes go into the build.** At build time, Vite reads the release
  entry for `package.json`'s version from `RELEASE-NOTES.md`. No network call, it works
  offline, and the text cannot differ from what shipped.
- **The bullets** come from the release entry by the rule in fork F1.

## 4. Rules that follow (not forks)

- **No new Rust, no new Apple call, no new network call.** Every state comes from
  `onUpdateStatus`; the installed notes come from the build.
- **A required update** (under the worker's `minVersion`) keeps its toast in every surface. The
  button shows the offer state too.
- **The fold memory** is the quick panel's (§12.1): kept across restarts, per group.
- **Compass:** the panel exports an opener, so *What's new*, *Check for updates* and *Report a
  bug* are reachable from Ctrl+Space (COMPASS.md §9). In Mini and Midi they open the quick
  panel's *Updates and bugs* square.
- **Keyboard:** the panel's rows take arrow keys like the other title bar panels; Escape
  closes it.
- **Log lines:** `diag.log("updates:btn", { state })` when the glyph changes state.
- **The web demo** (WEB-DEMO.md) has no updater: the button is hidden there.
- **The hint ledger, the toast ledger and docs:check** get their rows at build time.

## 5. Open forks

**F1 — Where the short bullets come from.**
- **A (recommended):** the bold lead of each paragraph in the release entry, as one bullet
  each ("Updates in two seconds.", "A new icon.", "Easier to read."). No new writing per
  release, and the panel always matches the notes. Cost: every paragraph must start with a
  bold lead (0.28.0's do); docs:check can fail an entry without one.
- **B:** a separate short list in each release entry (a `<!-- bullets -->` block). Your own
  words for the panel. Cost: a second text to write each release.

F2–F5 are closed (§2). F1 is closed in §6.2: the bold leads, written by the rule in §6.3.

## 6. F1 tried on the last five releases (2026-10-16)

What *What's new* would show if it took each paragraph's bold lead, word for word, from
`RELEASE-NOTES.md`:

**0.28.0** (8 bullets)
- Updates in two seconds.
- A new icon.
- Easier to read.
- The right artist.
- Fewer calls to Apple.
- The window fits the screen.
- The tray icon's hover text
- The Library's refresh button

**0.27.0** (10 bullets)
- Usage counts.
- Facts about the artist and the album.
- How many people play this song.
- Full | Lib switches smoothly.
- Shuffle off goes back to the list's order.
- History plays from where you click.
- When the graphics fail, the app stays quick.
- Every search box works the same way.
- New looks for a new install.
- Fixes.

**0.26.1** (1 bullet)
- The full player.

**0.26.0** (7 bullets)
- Choose how many cards Max shows.
- Hide the cards you do not use.
- Connect an AI app in one click.
- Rulez is easier to use.
- A calmer record in Press.
- Quick settings fold.
- Fixes.

**0.25.4** (12 bullets)
- A song that stops loading picks up again.
- AirPlay plays without a gap.
- Music keeps going when a list ends.
- Repeats in your queue play.
- Steadier playback.
- A faster start.
- Your library stays in step.
- Playlists.
- Lists.
- Rules.
- Safer.
- Fixes.

### 6.1 What the test shows

1. **Most leads work as bullets.** About three in four read as a complete statement of the
   change ("Hide the cards you do not use.", "AirPlay plays without a gap.").
2. **Three kinds of lead fail.**
   - **A category word:** "Fixes.", "Playlists.", "Lists.", "Rules.", "Safer." The word alone
     says nothing. 0.25.4 has five of these.
   - **A run-in lead:** the bold part is the subject of the sentence, and the verb is outside
     it. "The tray icon's hover text" and "The Library's refresh button" (0.28.0) are fragments.
   - **A label, not a change:** "Usage counts.", "The full player.", "A new icon." It names
     the thing but not what is new about it. These are short but still read well enough.
3. **The count is long.** 7 to 12 bullets in four of five releases. In the panel, at the
   panel's row height, 12 bullets fill the panel before the Bugs group.
4. **A hotfix shows only itself.** 0.26.1 shows one bullet. A user who jumps from 0.25.4 sees
   only "The full player." and never learns of 0.26.0's six other changes. This is the known
   problem of RELEASE-NOTES.md's top note (the design is DOCS-ORG.md §12, not built). The
   panel makes it more visible.

### 6.2 The options after the test

- **A2 (recommended): the bold leads, with a rule for writing them.** A lead must be a full
  statement of the change, and its sentence ends inside the bold. "Fixes." is allowed once,
  as the last paragraph, and the panel drops it (a fix list is not news). docs:check fails an
  entry that breaks the rule. With the rule, 0.28.0's two run-in leads become "**The tray
  icon's hover text has three lines.**" and "**The Library's refresh button spins until the
  sync is done.**". 0.25.4's category leads become statements ("**Get only the new songs from
  an Apple copy.**"). One text, written once, and the panel matches the notes. Cost: the rule
  changes how you write a release entry.
- **B: a separate short list in each entry.** Your own words, any count. Cost: a second text
  each release, and it can drift from the paragraphs.
- **A1: the bold leads as they are today.** No change to the writing. Cost: the failures in
  §6.1 item 2 reach the panel.

**His call (2026-10-16): A2, the bold leads with a rule.** His note: today's leads are not
ASD-STE100 and not his voice. "Updates in two seconds." and "Choose how many cards Max
shows." are headline fragments, not update text. So the rule is about the wording too (§6.3).

Separate from the source, his calls (2026-10-16):
- **No cap on the count.** The group folds, so every lead of the entry shows.
- **The latest version only.** A missed version is not joined in. The *All release notes*
  link to the website shows the rest.

### 6.3 The lead rule — DRAFT for him to edit

> **Part:** draft · 2026-10-16

**Second pass (2026-10-16, his examples).** Not full sentences. A lead is a short changelog
phrase. His rewrites of the first draft:

| First draft | His lead |
|---|---|
| You can choose how many cards Max shows. | Choices to default to 1 \| 2 \| 4 cards for Max |
| You can hide the cards you do not use from the card picker. | Filter out infrequently used cards from the picker |
| One click connects DeetsMusic to your AI app. | One-click MCP |
| Each rule in Rulez reads When · While · Do. | Clearer rule conditions in Rulez |
| The record in Press turns half as fast. | Halved Press's record spin |
| DeetsMusic now updates in about two seconds. | App updates in 2 seconds |
| DeetsMusic has a new hand-drawn icon. | New App Icon |
| A library sync makes fewer calls to Apple. | Cleaned up Apple API calls for the library |

A lead is the bold start of a paragraph in a release entry. It is also the bullet in
*What's new*. The rule, read from his examples:

1. **A phrase, not a sentence.** No subject ("You", "DeetsMusic"), no closing period in the
   panel (the panel drops one if the notes have it).
2. **The change comes first:** a past-tense verb ("Halved", "Cleaned up", "Filter out"), a
   comparative ("Clearer", "Smoother"), "New", or the thing plus what it does now ("App
   updates in 2 seconds").
3. **Names the place:** Max, Press, Rulez, the picker, the library.
4. **Short:** about 2 to 8 words. **Short wins over complete** (his call, 2026-10-16): "1 | 2
   | 4 cards" leaves out that 2 is two layouts, so a user who does not care reads less. The
   detail stays in the paragraph. Capitals are not decided yet ("New App Icon").
5. **Numerals and pipes:** "2 seconds", "1 | 2 | 4 cards".
6. **Real names are fine** when a user knows them: MCP, Apple API, Last.fm.
7. **Never a category word alone.** "Fixes." may be the last paragraph; the panel leaves it
   out.

docs:check can test 4 (the word count) and 7 (a list of category words). The writer checks
the rest.

**From which release:** the release that ships the panel, and every one after it. Older
entries stay as written (RELEASE-NOTES.md's own rule), because no install that shows the
panel reads them.

**The five releases again, with the rule** (a draft of the wording, for him to edit):

His leads are kept word for word; the others are Claude's, in his style, for him to edit.

**0.28.0**
- App updates in 2 seconds *(his)*
- New App Icon *(his)*
- Easier-to-read text in 5 themes
- Main artist for every song
- Cleaned up Apple API calls for the library *(his)*
- Window always opens inside the screen
- Time left in the tray icon's hover text
- Library refresh spins until the sync is done

**0.27.0**
- Anonymous usage counts, with an off switch
- Last.fm facts on artist and album pages
- Last.fm play counts on Now Playing
- Smoother Full | Lib switch
- Shuffle off returns to the list's order
- History plays from the song you click
- Effects turn off when graphics fail
- Same keys in every search box
- New default looks for new installs
- (Fixes — left out of the panel)

**0.26.1**
- Full player: the cover as large as the window

**0.26.0**
- Choices to default to 1 | 2 | 4 cards for Max *(his)*
- Filter out infrequently used cards from the picker *(his)*
- One-click MCP *(his)*
- Clearer rule conditions in Rulez *(his)*
- Halved Press's record spin *(his)*
- Folding groups in Quick settings
- (Fixes — left out of the panel)

**0.25.4**
- Stalled songs reload on their own
- Gapless AirPlay
- A song web plays when a list ends
- Repeats in the queue
- Silent songs reload, broken songs skip
- Faster start
- Library stays in step with Apple
- New-songs-only refresh from Apple copies
- Sorts keep your place
- Rule holds last until the condition changes
- Tighter browser extension access
- (Fixes — left out of the panel)
