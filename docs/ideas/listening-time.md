---
status: idea
desk_test: none
sources: [src/rewind.ts, src/rewind-card.ts, src/rewind-window.ts, src/stats.ts, src/filter-eval.ts, src/filters.ts, src/cond-editor.ts, src/updates-btn.ts, src-tauri/src/library.rs]
updated: 2026-10-19
---
# Listening time — a title bar glance and "where did my time go"

> An idea (2026-10-19), not built. His ask: a toolbar widget that shows how much time the
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
