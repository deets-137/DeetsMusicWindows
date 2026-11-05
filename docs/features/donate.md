---
status: built
desk_test: passed 2026-11-04
sources: [src/donate-btn.ts, src/donate-rules.ts, src/styles/donate.css, src/styles/skin.css, src/main.ts, src/compass.ts, src/dropdown.ts, index.html]
updated: 2026-11-05
---
# The Donate button — a dollar sign in the Max title bar

> The dev flag came off on 2026-11-05 (his call), so the next release carries the button, the panel
> and the new title bar order.

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

- **The title bar:** the cog, the updates button, Donate, Network, the Compass, Rewind, the pin.
  The order is in `index.html`. `initDonateButton` puts the button before `#net`.
- **The flag:** off since 2026-11-05. Only `__donate` stays dev only.
- **The Compass:** the *Donate* row, Max only, as the button (`openDonatePanel`).
- **The usage count:** `panel.donate`.
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
- **The link (2026-11-05):** *Donate with PayPal*, under the title. His page's address is
  `PAYPAL_URL` in `donate-btn.ts`, and `openUrl` opens it in the browser, as *All release notes*
  does. The account row's text link family (`.account__link`). The CSP needs no new host.
- **The note (his ask, 2026-11-05):** *(not tax-deductible\*)*, right of the link, in
  `--donate-note-fs`, 2 px under the panel's type.
- **The divider (his ask, 2026-11-05):** `.donate__rule`, the menu divider's family, between the
  link and the first goal.
- **His words (2026-11-05):** two paragraphs between the title and the link, `SAY` in
  `donate-btn.ts`, unchanged from what he sent. *For now* (his word).
- **The height:** `--donate-panel-max-h` is the window less 48 px, with no 620 px cap: measured on
  Cyber, the panel is 653 px, and the cap cut off the last goal. A shorter window scrolls, with
  `app-scroll`. No `scrollbar-gutter`: the panel's height does not change while it is open.
- **The bar:** the song scrubber's track and fill with no handle. The marks are the sleep dial's
  major ticks, taller than the track.
- **The amount:** no real amount exists yet, so the bar shows $0. `__donate.raised(75)` in
  DevTools shows a pretend amount until the next reload.
- **Break-it pass (2026-11-04, three agents).** One real fault: Escape played the close turn on a
  shut button, because `close()` in `dropdown.ts` set `hidden` on a shut panel and every dropdown
  hears Escape. Fixed in `dropdown.ts`, so the updates arrows no longer roll on a stray Escape
  either. `turn` now reads `playState`, not a finish event, so no stale state can hold it.
- **A narrow Max window (measured 2026-11-05, open).** The title bar needs 624 px. Below that the
  gap between the two groups is gone. Then the Compass button shrinks to nothing, and at the 495 px
  floor (`surface.ts`) the right group ends at 595 px, so the window buttons are cut off. The
  released order has this fault too, 24 px sooner to clear: Donate adds 24 px. Not fixed.

## 3. Decided inside his ask (for his review)

- The updates button stays left of Donate (his call, 2026-11-04).
- The marks carry no numbers on the bar: the two lines under it name them.
- Max only, as the updates and Network buttons.
- The hover hint is *Donate*.
- The link's words are *Donate with PayPal* (2026-11-05).
- The link's hover hint is *Opens PayPal's donation page in your browser*.
- The panel stays open after a click on the link, as the updates panel does.
- The new stroke crosses the line. It does not go over and under the line: at this size a gap
  in a 1.6-unit stroke would not show.

## 4. The flag came off (2026-11-05)

1. The order went into `index.html`. The button is still made in `donate-btn.ts`.
2. The docs that named the old places are corrected.
3. `panel.donate` is on the list and copied to DeetsSupport. A worker deploy (his call) takes it.
   Until then the worker drops it.
4. The opener and the Compass row are built. Mini and Midi have no place for the panel.
5. The CSP needs nothing: the page opens in the browser.
6. No motion set clip: the set has none for the title bar's panels, and it runs on the demo. The
   turn has not changed since its review: `donate-turn.mjs` passed again on 2026-11-05.

## 5. Desk test

Run `npm run dev:app`. Use Max.

1. **The order.** The title bar reads: cog, updates, dollar sign, car, Compass, hourglass, pin.
2. **The turn.** Click the dollar sign. The line leaves through the top, the S pulls straight,
   and a stroke comes in from the bottom left and curls into the S. The panel shows *Donate*.
3. **The close.** Click the dollar sign again, or press Escape. The turn plays backwards.
4. **Rapid presses.** Click twice quickly. The strokes reverse with no jump, and the dollar
   sign ends whole.
5. **Other surfaces.** In Mini and Midi the button is gone.
6. **Release.** Since 2026-11-05 the release bundle has the button. Check it on the installed app.
7. **The link (passed 2026-11-05, his word).** Click *Donate with PayPal*: the browser opens the
   PayPal page, with DeetsMusic's line on the page and US dollars.
8. **The top of the panel (2026-11-05, open).** Open the panel. From the top: *Donate*, his two
   paragraphs, the link with *(not tax-deductible\*)* right of it in smaller type, a line the width
   of the panel, both goals. Make the Max window as short as it goes: the panel scrolls only if it
   must, with the app's bar, and the last goal can be reached.
9. **The Compass.** In Max, Ctrl+Space, type `donate`, Enter: the panel opens. In Midi: no row.
