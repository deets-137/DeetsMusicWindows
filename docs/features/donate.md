---
status: built
desk_test: passed 2026-11-04
sources: [src/donate-btn.ts, src/donate-rules.ts, src/styles/donate.css, src/styles/skin.css, src/main.ts, src/dropdown.ts]
updated: 2026-11-04
---
# The Donate button — a dollar sign in the Max title bar

> Dev only (2026-11-04). The button and the panel are built, with one goal bar. A release build
> has no Donate button, and its title bar keeps the old order.

## 1. His ask (2026-11-04)

- **Order.** Move the updates button and the Network button to the left of the Compass. The
  Donate button sits on the left of the Network button.
- **Glyph.** A dollar sign.
- **Panel title.** *Donate*, as the other title bar panels show their titles.
- **The move on a click.** The line of the dollar sign moves up and out of the icon. The S
  straightens and becomes the new line. A new line comes in from the bottom left, goes through
  that line, and makes the S.
- **Flag.** Dev only until it is ready.

## 2. As built

- **The title bar in dev:** the cog, the updates button, Donate, Network, the Compass, Rewind,
  the pin. `initDonateButton` moves the two buttons at launch. `index.html` is not changed.
- **The flag:** `if (import.meta.env.DEV)` around the import in `main.ts`, as the copy editor
  has. The release bundle has no `donate-btn.ts` and no `donate.css`. The `--donate-*` tokens
  in `skin.css` do ship, and nothing reads them.
- **The turn:** `--donate-turn` (0.72 s), three strokes on one clock:
  - the line rises 22 units and fades by 38 % of the time;
  - the S pulls straight onto the line's place by 45 %;
  - the new stroke waits until 30 %, slides in from the bottom left along a straight diagonal
    and crosses the line's middle by 62 %, then curls into the S by 100 %.
- **Each close plays the turn backwards**, as the updates arrows do. A press in mid-turn
  reverses the strokes from where they are.
- **Reduced motion:** no turn.
- **The panel:** the cog's panel family, with the Rewind panel's title. Under the title, one
  block per goal in `GOALS` (`donate-btn.ts`): the goal's name, the bar, a line per mark.
- **The first goal (his words, 2026-11-04):** *Lyrics*, a bar of $200 with marks at $50 and $200.
  *$50 - 500 songs per day between all users for one month* and *$200 - 2000 songs per day
  between all users for one month*.
- **The second goal (his words, 2026-11-04):** *Apple Dev Account*, a bar of $100 with one mark.
  *$100 - one year of apple dev access*.
- **The fill:** top to bottom (`fillGoals`, `src/donate-rules.ts`). The open questions on the money
  are [ideas/donations.md](../ideas/donations.md).
- **The bar:** the song scrubber's track and fill with no handle. The marks are the sleep dial's
  major ticks, taller than the track.
- **The amount:** no real amount exists yet, so the bar shows $0. `__donate.raised(75)` in
  DevTools shows a pretend amount until the next reload.
- **Break-it pass (2026-11-04, three agents).** One real fault: Escape played the close turn on a
  shut button, because `close()` in `dropdown.ts` set `hidden` on a shut panel and every dropdown
  hears Escape. Fixed in `dropdown.ts`, so the updates arrows no longer roll on a stray Escape
  either. `turn` now reads `playState`, not a finish event, so no stale state can hold it.
- **Not tested: a narrow Max window.** At 1080 px the left group ends at 300 px and the right
  group is 324 px wide, so the drag region is gone below about 624 px. Donate adds 24 px of that.
  The Max floor is 495 px (`surface.ts`). Check this before the flag comes off.

## 3. Decided inside his ask (for his review)

- The updates button stays left of Donate (his call, 2026-11-04).
- The marks carry no numbers on the bar: the two lines under it name them.
- Max only, as the updates and Network buttons.
- The hover hint is *Donate*.
- The new stroke crosses the line. It does not go over and under the line: at this size a gap
  in a 1.6-unit stroke would not show.

## 4. When the flag comes off

1. Put the button and the order in `index.html`, or keep the move in code and take the `DEV`
   check off `main.ts`.
2. Correct the places in UpdatesButton.md, speedtest.md and ONBOARDING.md §1 that say *right of
   the Compass* or *right of the Rewind button*.
3. Add a `use: "panel.donate"` key (`src/usage-keys.ts`, `npm run usage:keys`).
4. Export an opener and add a Compass row (COMPASS.md §9), with a place for Mini and Midi if he
   wants one.
5. A new outside host the page talks to goes in the CSP (CSP.md §3).
6. Add a clip to the motion set (`docs/guide/motion.json`) and do DESK-TESTS.md §6.6.

## 5. Desk test

Run `npm run dev:app`. Use Max.

1. **The order.** The title bar reads: cog, updates, dollar sign, car, Compass, hourglass, pin.
2. **The turn.** Click the dollar sign. The line leaves through the top, the S pulls straight,
   and a stroke comes in from the bottom left and curls into the S. The panel shows *Donate*.
3. **The close.** Click the dollar sign again, or press Escape. The turn plays backwards.
4. **Rapid presses.** Click twice quickly. The strokes reverse with no jump, and the dollar
   sign ends whole.
5. **Other surfaces.** In Mini and Midi the button is gone.
6. **Release.** `npx vite build`: no `donate` in `dist/assets`.
