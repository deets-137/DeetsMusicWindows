---
status: built
desk_test: open
sources: [src/rewind-btn.ts, src/styles/rewind-top.css, src/rewind.ts, src/rewind-window.ts, src/rewind-card.ts, src/stats.ts, src/updates-btn.ts, index.html, tests/rewind-window.test.ts]
updated: 2026-10-19
---
# Listening time — the Rewind button in the title bar

> **V1 BUILT 2026-10-19 on `ideas-nineteen`; his desk test is open (§9.3).** §8 is his calls,
> §9 the as-built record. Read §9 first: where it disagrees with §3–§7, §9 is the code. §1–§7
> are the idea as written before his calls; §4 (the breakdown) and the forks F4–F7 are not
> built and wait for a later talk.
>
> The idea (2026-10-19). His ask: a toolbar widget that shows how much time the
> user really listened, from their DeetsMusic history. Then let the user make filters to see
> where the time went: by artist, by genre, by day of the week, and so on. §1 is what the app
> already has; §2 the push-back (most of this exists); §3 the glance; §4 the breakdown; §5
> the new code; §6 the costs; §7 the forks (all his, all open).

## 0. Terms

- **Listening time**: the sum of `play_events.ms_listened`. It counts only forward playback.
  A pause, a seek and a stall add nothing (DEETS-REWIND.md §5a).
- **The glance**: the new title bar button. It shows one number, for example "2 h 14 m today".
- **The breakdown**: the view that splits the time by one dimension (artist, genre, weekday …).
- **Dimension**: the thing the breakdown groups by.
- **Song fact**: a value of one song (its genre, its artist). filter-rules.md §4 lists them.
- **Play fact**: a value of one play, not of the song (its weekday, its hour, its source).
  No play facts exist today.

## 1. What the app already has (read 2026-10-19)

- **The data.** `play_events` has one row per play since 2026-07-01: `started_ts`,
  `ms_listened`, `completed`, `context` (DEETS-REWIND.md §5a). Since the sweep fix F4
  (2026-10-18) an open play saves its minutes every 30 s, so a crash loses 30 s at most.
- **The read.** `play_events_since(since_ts)` and the join to the track store in
  `src/rewind.ts`. It reads a year of plays (3,660 rows on live) in well under 150 ms
  (DEETS-REWIND.md §8.3).
- **The time spans.** `src/rewind-window.ts`: Past Day, Week, Month, This Year, Past Year.
  Pure, with tests.
- **The Rewind card.** It already ranks Songs, Artists, Albums and Playlists by real minutes
  in each time span.
- **The filters.** filter-rules.md: song facts (`artist`, `genre`, `year`, `loved`,
  `diaryScore`, `inPlaylist` …), the pure `evalCond`, saved filters (`src/filters.ts`) and the
  condition menus (`src/cond-editor.ts`).
- **A title bar button pattern.** `src/updates-btn.ts`: a Max title bar button with a
  `makeDropdown` panel.
- **The refresh signal.** `stats.onPlayEvent` fires when a play's row is written (the Rewind
  card uses it since F2).

## 2. The push-back

Most of this already exists. Two things are new:

1. **A number in the title bar.** Rewind is a card. The user must open it to see the time.
2. **Dimensions Rewind does not have.** Genre, weekday, hour of the day, and a filter on the
   songs that count.

My recommendation: **do not make a second stats card.** Make the glance small, and put the
breakdown INTO Rewind as new choices in its first dropdown plus one filter pill. Reasons:

- Two stats surfaces would give two numbers for one question. They would drift.
- Rewind already has the time spans, the join, the menus, the keys, the sweep and its guards.
- The filter engine already exists. A second filter UI would break the rule "never a fourth
  primitive" in spirit.

Also: "effective listening time" needs one definition (F1). Do not show three numbers.

## 3. The glance (the title bar button)

- One button in the title bar. Its face: a small clock glyph and the number, for example
  "2 h 14 m". The number is for the time span of F3 (today is my recommendation).
- **Live.** The page adds the open play's ticks to the last read total, so the number moves
  while music plays. It reads the database again only at `onPlayEvent`. No timer reads SQL.
- **Click**: a small `makeDropdown` panel:
  - Today · This week · This month, one row each, with the minutes.
  - "vs last week": up or down, in minutes (F5).
  - The top artist and the top genre of the time span, one row each.
  - "Open Rewind": opens Rewind on the breakdown (§4).
- **Hover hint**: "Time you listened today. Pauses and skips are not counted."

## 4. The breakdown (inside Rewind)

### 4.1 New dimensions in the first dropdown

| Dimension | Group key | Fact kind | Notes |
|---|---|---|---|
| Genre | each of `track.genres` | song | A song with 3 genres: F4 decides how its minutes split. |
| Weekday | local weekday of `started_ts` | play | 7 rows, Monday first or Sunday first (locale). |
| Hour | local hour of `started_ts` | play | 24 rows. A bar per row reads better than a ranked list. |
| Source | `context` kind: album, playlist, library, search, radio, Home … | play | Playlists exist already; this is the coarse kind. |
| Decade | `year` / 10 | song | Cheap and fun. |

Weekday and Hour are not a leaderboard. They have a fixed order and every row shows. The card
draws them as bars in the theme's role colors (dataviz rules), not as the ranked list. F6.

### 4.2 The filter pill

One pill beside the two dropdowns: **Filter**. It takes the same condition editor as the
Library's Filter pill (`cond-editor.ts`) and the same saved filters. Only the plays whose song
passes the filter count. Examples:

- "Genre is Jazz" + dimension Weekday: when do I play jazz?
- "Loved is true" + dimension Artist: where my time on loved songs went.
- "In playlist Road Trip" + dimension Hour.

Play facts (weekday, hour, source, completed) can join the condition menus as a second
registry. That is F7, and it is the one change to the shared filter engine. Keep it out of a
first build.

### 4.3 Compare (later, not v1)

Two time spans side by side ("this month vs last month") per row. A later step; list it only.

## 5. The new code (a sketch, not a plan)

- `src/listen-time.ts` (pure): sum, group by a key function, weekday and hour in local time.
  Unit tests, with a DST day.
- `src/listen-glance.ts`: the title bar button and its panel (the `updates-btn.ts` pattern).
- `rewind.ts` / `rewind-card.ts`: the new dimensions, the bar view, the Filter pill.
- No new Rust command, no schema change. `play_events_since` gives every field.
- The checklist in CLAUDE.md applies: hints in ONBOARDING.md §1, a `NEW_MARKS` line if a
  Settings row is added (F2), `enterRows` on the panel, `app-scroll`, `dataset.frames`, a
  Compass row, a `loading.json` clip.

## 6. Costs

- **Apple calls: 0.** **Last.fm calls: 0.** All local.
- **Reads:** one `play_events_since` per play end for the glance (today's rows only, small).
  The breakdown reads as Rewind reads today.
- **Limits to say in the UI:** history starts 2026-07-01 (or at install). A song played in
  another app, or on the phone, is not counted. Plays before the 2026-07-02 metadata fix can
  show as "Unknown".

## 7. The forks (all his, all open)

- **F1. What is "effective" time?**
  - A. `ms_listened` as is: forward playback only (recommended; it is the Rewind number).
  - B. A, minus plays under 30 s (skips do not count).
  - C. Only completed plays (`completed = 1`).
- **F2. Where does the glance live?**
  - A. Max title bar only, like the updates button (recommended).
  - B. Max and Midi.
  - C. Off by default; a Settings › Window row turns it on.
- **F3. The number on the button.**
  - A. Today (recommended: it moves while you listen).
  - B. This week.
  - C. The user picks in the panel; the pick is kept.
- **F4. A song with more than one genre.**
  - A. Its full minutes go to each genre; the column does not sum to the total (recommended;
    say so in the hint).
  - B. The minutes split evenly between its genres.
  - C. The first genre only.
- **F5. "vs last week" in the panel.** A. Yes. B. No (recommended for v1: it invites a goal,
  and the goal marker is paused, PresentationMode.md §7a).
- **F6. Weekday and Hour as bars.** A. Bars in the card (recommended). B. The ranked list, as
  today.
- **F7. Play facts in the shared condition menus.** A. Later, after v1 (recommended). B. In v1.
- **F8. The glyph and the panel's look.** His to draw.

## 8. His calls (2026-10-19)

> **Part:** decided · 2026-10-19

| Fork | His call |
|---|---|
| F1 | **A.** Listening time is `ms_listened` as it is: forward playback only, the Rewind number. |
| F2 | The Rewind card moves into the title bar: a button **left-aligned** in the title bar, with an **hourglass** glyph. He redraws the glyph later, by the usual protocol. |
| F3 | A click opens a panel "akin to the sleep timer panel": a rectangle titled **Rewind**. Its first row is the title text **Today: XX mins**, always minutes; a Settings row sets hours and minutes. What sits under it is to be talked through later. |
| V1 | Under Today, one row: **Top Listens** left, **SOTD** right. Top Listens opens the songs by most played, with a view dropdown (song / album / artist) in the quick-button style: the up and down arrows on the right of the choices, cut by a vertical divider (the Library's Sort pop). SOTD opens the history of picks, newest first. A list "gently slides in below and expands the panel". |
| F4–F7 | Later, "whenever we get there". |

## 9. As built (2026-10-19)

> **Part:** built · 2026-10-19 · desk test: open

### 9.1 What is in the code

| Part | Where |
|---|---|
| The button: right of the updates button, before the drag gap; hidden in Mini and Midi by CSS | `index.html` (`#rewind-top`), `styles/rewind-top.css` |
| The panel: the head "Rewind", the Today row, the two chips, one list part; a dropdown (`makeDropdown`) with `.pop` and `enterRows` on open; `keepRightInWindow` | `src/rewind-btn.ts` `initRewindButton` (main.ts, a `later` step after the updates button) |
| Today: the sum of `ms_listened` since local midnight. Read at the panel's open, at each play event (`stats.onPlayEvent`) and every 30 s while open, so an open play's 30 s saves show | `rewind.ts` `listenedToday`; `rewind-window.ts` `todayStart`, `fmtToday` (tested) |
| Top Listens: the whole log (`topSince(view, 0)`), sorted by plays, then minutes; ↑ reverses it; 50 rows; each row's right side says "N plays" | `rewind.ts` `topSince` (split out of `topBy`, no change to the card) |
| The view dropdown: Songs · Albums · Artists, a divider, ↓ (most played first) and ↑ (least played first). A nested `makeDropdown`; the Library's `lib-pop__*` classes inside the panel's own `rewind-top__pop` box (absolute, not portaled). A choice keeps the pop open, as the Library's Sort pop does. The view and order are kept in `localStorage` `deets.rewindTop` | `rewind-btn.ts` `popHTML` |
| SOTD: every pick, newest day first, the row's right side "Today · a note"; the chip is hidden while Song of the Day is off | `rewind-btn.ts` `sotdRows` |
| The slide: a press draws the list, then the panel's height animates from the old height to the new (`--pop-grow`), the rows enter with `enterRows`. A second press on the pressed chip closes the list the same way. One list at a time | `rewind-btn.ts` `togglePart`, `animateHeight` (the updates panel's shape) |
| The families (UI-ARCHITECTURE.md §2a), aligned 2026-10-19 at his ask: the title is the Room and Sound panels' title; Top Listens, SOTD and the view trigger are the **panel chip** (`.sound__pill` on the button, as the Library's Filter panel does, with alias tokens `--rewind-top-chip-radius`, `--rewind-top-chip-w`), not the sleep chip and not the Library's toolbar pill; the pop's choices and ↑ ↓ are the Library's own `lib-pop__*` | `styles/rewind-top.css`, `skin.css` |
| The scrollbar's gutter (his ask, 2026-10-19): the Room panel's method. A list that scrolls gets `data-scrolls`, reserves the gutter and reaches into the panel's 8 px right padding by the bar's 8 px, so no row moves when the bar comes or goes. Measured right after each draw, before the paint; no transition | `rewind-btn.ts` `measureGutter`, `.rewind-top__list[data-scrolls]` |
| Rows: the Queue card's `qrow`; right-click is the Rewind card's menus (songs, albums, artists, a pick with `pickMenu`); arrows and Home / End (`wireListKeys`, no Enter) | `rewind-btn.ts` `menuFor` |
| **Settings › Rewind › Today's time in**: *Minutes* (default) / *Hours and minutes*. Key `rewindToday`, its agent spec, the reset group, the usage list, the New mark | `settings-store.ts`, `agent-settings.ts`, `settings-card.ts`, `usage-keys.ts` |
| The Compass: **Listening today** (Max only) opens the panel | `compass.ts`, COMPASS-TERMS.md |

No new Rust, no schema change, no Apple call. The Rewind card is unchanged (§9.4).

### 9.2 What Claude decided inside his calls (for his look)

- **Max only**, as the Compass and the updates button: Mini and Midi keep the title bar free to
  drag the window. In those surfaces the Rewind card is still the way in.
- The place: right of the updates button, the last button on the left side.
- **Top Listens reads all time** (the whole play log, from 2026-07-01), not a time span: his
  words were "most played". **Plays first, minutes second** (the card ranks minutes first).
- Rows show "N plays" on the right; 50 rows, then the list scrolls (`--rewind-top-list-max-h`, 320 px).
- A small grey word right of the view pill: "Most played" or "Least played".
- The Today format: "1 min", "134 mins"; in hours "1 hr", "2 hrs 14 mins". Whole minutes, rounded
  down. "Today: …" until the first read lands.
- The hint texts (ONBOARDING.md §1). The setting's label "Today's time in" and its hint.
- A plain click on a row does nothing, as on the Rewind card; right-click carries the verbs. No
  Ctrl / Shift picks and no drag to another card in V1.
- The list that was open stays open the next time the panel opens (in this session).
- Top Listens and SOTD at one width, 88 px (`--rewind-top-chip-w`): the family asks a pair to be
  one width, and no token was wide enough for "Top Listens".
- The panel's width is the cog panel's (`--quick-panel-w`), not the sleep panel's 224 px: a list
  of songs needs the room.
- The Compass row's name, "Listening today".

### 9.3 The desk test (his)

1. Max. The hourglass sits right of the updates button. Mini and Midi: no hourglass.
2. Click it: "Rewind", then "Today: N mins". Play a song for a minute with the panel open:
   the number goes up within 30 s.
3. Settings › Rewind › Today's time in › Hours and minutes: the row reads "2 hrs 14 mins" (or
   "N mins" under an hour) at once. Set it back.
4. Top Listens: the list slides in and the panel grows. Press it again: the list slides out.
5. The Songs pill: pick Albums, then Artists (round covers). Press ↑: least played first.
   Close the app and open it: the pill keeps Artists and ↑.
6. SOTD: your picks, newest first, the day on the right. With Top Listens open, press SOTD: one
   list replaces the other.
7. Right-click a song, an album, an artist and a pick: the Rewind card's menus. Play one.
8. Escape, and a click outside, close the panel (and the pill's pop).
9. The gutter: open Top Listens (it scrolls), then SOTD with only a few picks (it does not), then
   back. No row's text and no "N plays" moves sideways; the bar sits at the panel's right edge.
10. The chips: Top Listens and SOTD are one width, the same shape as the Sound panel's chips;
   the view chip's caret turns while its pop is open.
11. The hourglass (his drawing, 2026-10-19, on `v-thirtyone`): a flat top and base, sand as
   dots. Open the panel: the glass turns a half turn. Close it (the button, Escape, a click
   outside): it turns another half turn the same way, never back. With Windows' animation
   effects off, it flips at once.

### 9.4 Open

- **"Move the Rewind card into the toolbar":** V1 keeps the card. To take the card out is a
  fork for him once the panel covers what the card does (the time spans, Playlists, Make
  playlist, picks and drag), and Mini and Midi have a way in.
- What sits under Today (his F3: "we can chat user flow"), and §4's breakdown with F4–F7.
- ~~His hourglass glyph.~~ Drawn from his sketch and made to flip, 2026-10-19 (§9.3 step 11):
  `index.html`, `--rewind-top-flip` (the Compass needle's turn), the observer in rewind-btn.ts.
- A `loading.json` clip for the panel's wait (CLAUDE.md checklist 17), and a shots list of §9.3
  on the dev app (DESK-TESTS.md §6): not run from this cloud session (no Windows dev app here).
