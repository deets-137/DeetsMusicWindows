---
status: idea
desk_test: none
sources: [src/onboarding.ts, src/styles/onboarding.css, src/settings-card.ts, src/settings-store.ts, src/release-leads.ts, vite-release-notes.ts, src/updates-btn.ts, src/compass.ts]
updated: 2026-10-26
---
# The update card — new settings after an update

> An idea (2026-10-26), designed, not built. His ask: a copy of the grand-opening card
> opens after an update. It shows and sets the settings that are new, and it offers the
> defaults that changed. One page per version. §1 is his calls. §2 is what the code does
> today. §3 is the design inside his calls. §5 is what is still to ask.

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
- **Release notes:** the release-notes plugin bundles every entry after `LEAD_RULE_AFTER`, not
  only the installed one. The entries load with a dynamic import when the card opens, so the
  first paint does not carry them. The *Fixes* paragraph is left out, as in the Updates panel.

### 3.2 When the card opens
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

## 4. Not in scope
- A toast for a small update (his call 3).
- Changing a value without the user's press.

## 5. Open forks
None. U1 and U2 were closed 2026-10-26 (§1, calls 5 and 6). Still to ask: release entries as a
Compass data kind (§3.7), and each preview, row by row (§3.6).
