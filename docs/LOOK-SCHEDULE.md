# DeetsMusic — Look schedule (day look / night look)

> Built 2026-09-15. Code: `src/look-schedule.ts`, `src/sun-zones.ts` (generated),
> `scripts/gen-sun-zones.mjs`, the pre-paint in `index.html`, Settings › Look and feel.

## 1. What it does

The app changes between a **day look** and a **night look** by itself. A look is one theme
and one skin. Settings › Look and feel › **Change look at** picks what sets the change:

| Value | Key value | The change comes at |
|---|---|---|
| Sunrise and sunset | `sun` | sunrise and sunset for the time zone's main city, plus **Shift sun times** (−60…+60 min) |
| Set times | `clock` | **Day runs** from one time (04:00–12:00) to another (15:00–23:30), half-hour steps |
| Windows mode | `windows` | the Windows light/dark app mode (live, `prefers-color-scheme`) |
| Off (default) | `off` | never; the saved theme and skin stay |

The **Day look** and **Night look** rows are split pills: a theme menu and a skin menu.
Defaults are the two first-launch pairs (Lilac × Press, Black & Red × Retro-Future). A
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
  `initLookSchedule()` (right after `initTheme` / `initSkin`) then applies the exact plan
  without animation. `tray.html` needs nothing: it follows `publishAppearance` and the saved ids.
- A scheduled change writes `deets.theme` / `deets.skin` like a hand pick, so turning the
  schedule off keeps the current look.
