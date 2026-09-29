---
status: shipped
shipped_in: 0.5.0
desk_test: passed 2026-09-15
sources: [scripts/gen-sun-zones.mjs, src/look-schedule.ts, src/sun-zones.ts, src/look.ts, src/rules-eval.ts, src/rules.ts]
updated: 2026-09-29
---
# DeetsMusic — Look schedule (day look / night look)

> Built 2026-09-15. Code: `src/look-schedule.ts`, `src/sun-zones.ts` (generated),
> `scripts/gen-sun-zones.mjs`, the pre-paint in `index.html`, Settings › Look schedule.

## 1. What it does

The app changes between a **day look** and a **night look** by itself. A look is one theme
and one skin. Settings › Look schedule › **Change look at** picks what sets the change:

| Value | Key value | The change comes at |
|---|---|---|
| Sunrise and sunset | `sun` | sunrise and sunset for the time zone's main city, plus **Shift sun times** (−60…+60 min) |
| Set times | `clock` | **Day runs** from one time (04:00–12:00) to another (15:00–23:30), half-hour steps |
| Windows mode | `windows` | the Windows light/dark app mode (live, `prefers-color-scheme`) |
| Off (default) | `off` | never; the saved theme and skin stay |

The **Day look** and **Night look** rows are split pills: a theme menu and a skin menu.
Defaults are the two first-launch pairs (Lilac × Press, Black & Red × Cyber). A
status line under the section says which look shows and until when.

A scheduled change runs through `withAppearanceTransition` (the launch animation, the same
as a pick from the title menu; UX-COVERUPS.md §6a) and then `publishAppearance`, so the tray panel
and the extension follow. A change to any schedule setting applies at once.

## 2. A pick from the title menu (user's call 2026-09-15: 3A, as a setting)

**Menu pick lasts** (`lookHold`):

- **Until next change** (default): `noteHandPick()` (main.ts, Theme and Skin clicks) writes
  `deets.look.hold` = `{ period, until }`. The schedule does not touch the look while the
  period is the same and `now < until` (`until` is null in Windows mode: the hold ends when
  Windows changes mode). The next check after that clears the hold.
- **For good**: the pick turns the schedule off.

Any change to a schedule setting clears the hold.

## 3. Sun times without location

`Intl.DateTimeFormat().resolvedOptions().timeZone` gives the IANA zone (for example
`America/Chicago`). `sun-zones.ts` maps each zone (418, plus 237 old names such as
`Asia/Calcutta`) to its main city's latitude and longitude, from the tz database's
`zone.tab` and `backward`. `sunEdges()` is the standard sunrise equation (about 1 minute
accurate for the city). The app makes no request and asks for no permission.

- **Error:** the user is not at the main city. Usually 10–30 minutes; wide zones more
  (Minneapolis vs Houston on `America/Chicago`: about 40 minutes at a summer sunset).
  Shift sun times corrects it for one user.
- **No main city** (`UTC`, `Etc/GMT+5`): longitude from the UTC offset, latitude 40° N; the
  status line says the time is rough.
- **Polar day or night:** one look all day; the next check is at midnight.
- **Regenerate** the table when the tz database adds a zone: `node scripts/gen-sun-zones.mjs`.

## 4. Timing and launch

- `tick()` sets a timer to the next change, capped at 15 minutes (a timer stops while the PC
  sleeps). It also runs when the window becomes visible and when Windows changes mode.
- **Pre-paint:** each tick writes `deets.look.prepaint` = `{ window, day, night }` (today's day
  window in local minutes; null in Windows mode). `index.html` reads it and the hold before
  the stylesheet loads, so a launch after a change time does not flash the old look.
  `initLookSchedule()` runs right BEFORE `initLook`, so the first paint already has the
  scheduled look, with no animation. `tray.html` needs nothing: it follows
  `publishAppearance` and the saved ids.
- **Since 2026-09-26 a scheduled change never writes your look.** Your theme and skin are the
  settings store's `theme` / `skin` (RULES.md §7a); the schedule only lays its look on top.
  Turning the schedule off still keeps the current look, as before: `keepShownLook()` writes
  the look on screen as your pick at that moment.

## 5. On the rules engine (built 2026-09-26)

> **Part:** built · 2026-09-26 · desk test passed (Claude, dev app) except Windows mode (his)

The feature is the same; the rules engine runs it (RULES.md §13).
- The row makes two state rules: while `daylight` → the day theme and skin, while not → the
  night pair. `look-schedule.ts` keeps the plan and is the provider of the `daylight` and
  `lookMode` facts; `tick()` asks the engine to check again at each change.
- **A hand pick** (the title menu, the Compass, Reset, an agent — all through `pickLook` in
  look.ts) is a hand change: *Until next change* is the rule's `onHand: "next"` — it holds
  both the theme and the skin until `daylight` changes; the half you did not pick stays as it
  shows. *For good* is `onHand: "off"` — the row turns Off and your pick stays.
- The hold is saved (`deets.rules.holds`), so it survives a restart until the period changes.
  `deets.look.hold` is still written for the pre-paint (`syncHoldKey`).
- A change to any schedule row ends a hold at once, as before (`resumeRow`).
- **The chip** (RULES.md §9) sits beside Theme and Skin in the title menu: a green dot while the
  schedule shows its look ("The look schedule shows the night look. Your pick is Moonlight."),
  a scarlet dot while your pick holds ("Your pick stays until 7:00 AM. Press to go back to the
  schedule now."). A press on the scarlet dot ends the hold.

**Desk test (2026-09-26, dev app).** Set times with the day window around now → the day look;
at the night time the night look comes in by itself. A menu pick at night → Lilac with the
scheduled skin kept, the hand chip and its hint. The period changes → the hold ends and the
day look comes. The chip resumes the schedule. *For good* → the row goes Off, the pick stays.
The row set to Off → the look on screen stays as your pick. A reload during a period, with and
without a held pick → the pre-paint and the app agree (no flash). **His:** Windows mode follows
the OS light / dark switch.

### 5a. The pick ends at the chip's time (2026-09-29)

> **Part:** built · 2026-09-29 · desk test open (RULES.md §18b, steps 2 and 3)

**His call (2026-09-29): the hold ends at the time the chip shows.** Before, the engine ended a
hand pick only when `daylight` changed. A pick made at 14:00 ("until 7:00 PM"), the app closed
before 7:00 PM and opened the next morning, held all the next day, while the pre-paint (which
ends the hold at `until`) painted the scheduled look first. Now:
- At the hand change the engine asks this module when the pick ends (`registerHoldEnd`): the
  plan's next change, read fresh. The hold carries it as `endsAt` and ends when it comes, at
  launch too (RULES.md §18b).
- `deets.look.hold.until`, the chip's hint and the status line all read that same time
  (`pickEnds`). The pre-paint in index.html did not change: it and the engine now end the pick
  at the same two edges, the period change or `until`.
- Windows mode has no time: the pick ends when Windows changes mode, as before.
- A hold saved before this fix takes its time from its old `deets.look.hold` copy at launch
  (`adoptHoldEnd`).
