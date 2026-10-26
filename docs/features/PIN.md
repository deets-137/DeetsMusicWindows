---
status: built
desk_test: open
sources: [src/pin.ts, src/styles/pin.css, src/surface.ts, src/main.ts, src/rules-eval.ts, src/rulez-card.ts, src/rulez-words.ts, src/settings-card.ts, src/settings-store.ts, src/agent-settings.ts, src/compass.ts, src/usage-keys.ts, src/styles/skin.css, index.html, tests/rules-eval.test.ts]
updated: 2026-10-26
---
# Pin on top — a title bar button that keeps the window above other windows

> **Built 2026-10-26 on `main`, committed and pushed (9460b39); ships in 1.1.0. His hand test
> passed the four pins and unpins the same day; §5.1 lists the cases still open.** Every fork
> is his (§2). §8 is the as-built record: where it disagrees with §3, §8 is the code.

His ask (2026-10-26): make *Keep on top* easy to find. A pin button in the title bar opens a
panel. The user picks what stays on top (the album cover only, the player with its controls,
and so on), and one button pins the window and starts it.

## 1. What the code has today

- **The title bar buttons.** Updates, Rewind and Network (the car) sit right of the Compass.
  Each is a `makeDropdown` panel with `.pop` and `enterRows` (`src/rewind-btn.ts`,
  `src/net.ts`). They show in Max only (`styles/net.css` hides them in Mini and Midi).
- **Keep on top.** *Settings › Window › Keep on top*: Always · Player · **Off**
  (`alwaysOnTop`). The row makes a state rule on the `window.onTop` property
  (`rules-eval.ts`, RULES.md §13); `main.ts` applies it with `setAlwaysOnTop`.
- **The small views.** Mini (Now Playing and one card) and Player (Now Playing alone, the
  `miniView` "player" in `surface.ts`). No view shows the cover alone.
- **The Mini title bar.** The app title shows the short monogram "DM"
  (`.app-title__short`) when the window is narrow. That frees the room for the pin.

## 2. His calls (2026-10-26)

1. **The pin shows on every surface** (fork 1, A). It is also the unpin button, so a pinned
   Mini, Player or Cover window has it. In Mini it fits beside the short monogram (his note).
2. **Cover = the cover only, with controls on hover** (fork 2, A). The pointer on the cover
   shows a thin bar with Previous, Play / Pause and Next, and an unpin icon in a corner. A
   drag on the cover moves the window.
3. **The pin is its own hold** (fork 3, A). It is a state rule on `window.onTop` while the
   `pinned` fact is true. The *Keep on top* row does not change. Unpin gives back the earlier
   view; the row then applies again. **The hover hints of the pin button AND the Keep on top
   row each name the other** (his ask), so the two never drift apart in the user's mind.

## 3. The design

### 3.1 The button
- A pin glyph in the title bar, right of the car in Max. In Midi and Mini, where the other
  three buttons are hidden, it sits right of the Compass. **The glyph is a pin (his call,
  2026-10-26).**
- Pressed look (`aria-pressed="true"`) while pinned. A press while pinned unpins at once (no
  panel). A press while not pinned opens the panel.
- **Motion (his design, 2026-10-26).** The pin rests diagonal. While the pointer holds the
  button down it turns to horizontal, and it stays horizontal while the panel is open (his ask
  at the hand test, 2026-10-26); a close of the panel with no pin turns it back to diagonal. When the window
  is pinned, the pin stands vertical (pushed in), and stays vertical while pinned; unpin turns
  it back to diagonal. The rotation is one `transform: rotate` on the glyph, its duration and
  easing skin tokens (`--pin-turn`, `--pin-ease`). Reduced motion (`motionReduced()`) sets
  the angle with no turn.

### 3.2 The panel
- Heading "Keep on top".
- Four tiles, each with a small picture of its view: **Cover** · **Player** · **Mini** ·
  **This window** (the window keeps its surface and size and goes on top).
- One button under the tiles names what it does: "Pin cover", "Pin player", "Pin mini",
  "Pin this window". A press pins, closes the panel and changes the view.
- The panel remembers the last tile (`pinView`, §3.5).

### 3.3 Pinned
- **Pin:** save the view to come back to (surface, Mini view, size, place), switch to the
  picked view, set the `pinned` fact true. The pin rule holds `window.onTop`.
- **Unpin:** from the pin button, the Cover view's unpin icon, the Compass, or the agent.
  Set `pinned` false, then restore the saved view, size and place.
- **A restart keeps the pin** (shown to him as a "follows" item, 2026-10-26): the saved view
  and the pin are stored, so the app opens pinned and unpin still knows where to return.
- A hand surface change while pinned (the surface menu, a resize across a band) keeps the
  window on top: the pin is about "on top", the view is only where it starts.

### 3.4 The Cover view
- A new `miniView` value `"cover"` in `surface.ts`, with its own size slot, a square minimum
  size, and a *Cover opens at* row under *Settings › Window › Window sizes*.
- The cover fills the window. Pointer over: the control bar fades in at the bottom, the
  unpin icon at the top left (his ask at the hand test: the left, where the pin sits in the
  title bar). Pointer out: both fade out.
- A drag on the cover moves the window (`data-tauri-drag-region`); the bar and icon are not
  drag regions.
- The surface menu does not list Cover; it is reached by the pin only. (A row for it is a
  later fork if he wants one.)

### 3.5 What follows from the design (no fork)
1. **Settings key** `pinView` ("cover" · "player" · "mini" · "window"; default "player",
   the view that already exists and has the controls), with a spec in `agent-settings.ts` and
   a line in AGENT.md. The pin state itself is a store value read by the rule.
2. **The rule:** a state rule `row:pin` with `while: { fact: "pinned", is: true }` setting
   `window.onTop`, `onHand: "off"`. The `pinned` fact is registered with the engine, so a
   Rulez rule can use it.
3. **Hover hints** (ONBOARDING.md §1): the button, each tile, the pin button, the Cover
   view's bar and unpin icon. The pin's hint names *Settings › Window › Keep on top*; the
   row's hint names the pin button (§2.3).
4. **Compass:** "Pin on top" and "Unpin" (COMPASS.md §9), and `openPinPanel` for the panel.
5. **Log lines:** `diag.log("pin:on" / "pin:off")` with the view and the cause.
6. **Motion and telemetry:** `.pop` + `enterRows` on open, `dataset.frames="pin"`.
7. **The checklist in CLAUDE.md** (tokens, control family = the title bar icon square and
   the panel chip, `app-scroll` not needed, a loading clip not needed: no data wait).

### 3.6 Claude's choices inside his calls (for his review before the build)
- `pinView` defaults to Player.
- A hand surface change while pinned keeps the window on top (§3.3).
- The surface menu does not list Cover (§3.4).
- A press on the pin while pinned unpins at once, with no panel (§3.1).
- In Midi and Mini the pin sits right of the Compass (§3.1). **Corrected at the build:** the
  Compass is Max only, so in Midi and Mini the pin sits right of the app title, as his note said.

## 4. Build steps
1. `surface.ts`: the `"cover"` view, its size slot and floor; `isCoverView()`.
2. `src/pin.ts`: the button, the panel, pin / unpin, the saved view, the `pinned` fact.
3. `rules-eval.ts`: the `row:pin` rule; `rulez-words.ts` / `rulez-logs.ts` names.
4. `index.html` + `styles/pin.css`: the button on every surface, the panel, the Cover view.
5. Settings: `pinView`, the *Cover opens at* row, the Keep on top hint.
6. Compass rows, agent spec, hints ledger, `npx tsc --noEmit`, `npx vite build`, `npm run check`.
7. The desk test below, run by Claude on the dev app, then his hand test.

## 5. Desk test (to write in full at build)
- Pin each of the four views from Max, Midi and Mini; check `window.onTop` and the view.
- Unpin from each place (button, Cover icon, Compass); the window returns to its view, size
  and place.
- *Keep on top* = Always, then pin and unpin: the window stays on top after unpin.
- *Keep on top* = Player, pin Cover, unpin to Max: not on top after unpin.
- Restart while pinned: opens pinned; unpin returns to the saved view.
- Rapid pin / unpin presses; a surface change while pinned.

### 5.1 What ran (2026-10-26)
- **Claude, on the dev app (Max, Happy skin):** the button at its diagonal rest
  (`rotate(45deg)`); the panel opened by a click, its tiles and "Pin cover"; Pin cover gave a
  320 × 320 Cover, `is_always_on_top` true, the way back stored (Max 1100 × 950 at its place).
  Found and fixed: the Happy scene drew over the cover (§8). Not run by Claude: the hover
  controls under a real pointer, the restart, the Keep on top cases, rapid presses.
- **His hand test, the same minutes:** Cover, Player, This window and Mini, each pinned and
  unpinned (the `pin:on` / `pin:off` lines, ring #84–#217). It found the stale Cover view (§8).
  His asks after it: a narrower panel, the Cover's unpin icon on the left. Both built.
- **Open:** the restart while pinned, the two Keep on top cases, rapid presses, and the
  control bar's place over the cover under a real pointer.

## 8. As built (2026-10-26)

- **Files.** `src/pin.ts` (the button, the panel, `pin` / `unpin`, the `pinned` fact, the Cover's
  unpin icon and its window drag), `src/styles/pin.css`, the `--pin-*` tokens in `skin.css`,
  the markup in `index.html`. `surface.ts`: the `"cover"` mini view (`data-mini="player"` plus
  `data-cover`), its size slot `sizeCover` (320 × 320, floor 200 × 200), `isCoverView`,
  `currentMiniView`, `setMiniView`. `rules-eval.ts`: the built-in `fixed:pin`, always made.
  Rulez: "The pin" in its built-in list, the `pinned` fact under Window. Settings: *Cover opens
  at* (with its New mark), and the Keep on top hint names the pin. Compass: "Pin on top", or
  "Unpin" while pinned. `pinView` is listed as not sent in `usage-keys.ts` (a new key on the
  allow-list is his call).
- **The panel** is two tiles wide (`--pin-tile-w` 96 px), his ask at the hand test.
- **The switch is covered (his call, 2026-10-26).** A pin or unpin that changes the view runs
  under the launch cover, as an agent's surface change does (UX-COVERUPS.md §6b): the cover
  fades in, the window unmaximizes, resizes and moves while the cover is opaque, and the cards
  rise in the new shape. A real morph (stepping the window's size over 0.5 s) was the other
  option; §6b records that a stepped native resize can't reach frame rate. *Animate look
  changes* off, or reduced motion, makes it a snap. Not run by Claude: he uses the dev app.
- **The stale Cover (found in his test).** Pinning from Max wrote Mini's view as Cover, and
  unpin to Max left it there, so a later Mini pick would have opened a bare Cover.
  `applySurface` with Midi or Max now also sets the view Mini comes back to; `pin` never stores
  Cover as a way back; `initPin` puts a leftover Cover back to Player with no resize.
- **What Claude decided inside his calls (for his review):**
  1. The `surface` fact reads "player" in Cover, so *Keep on top = Player* also holds a Cover.
  2. A pin of *This window* stores no way back: unpin leaves the window where it is, even if
     you moved it while pinned. The other views go back to the view, size and place they had.
  3. Cover hides a scene skin's sky, ground and actors (Happy), so the cover shows alone.
  4. A drag on the Cover moves the window; the drag of the song to another card is off there
     (there is no other card).
  5. The tiles' pictures are simple outline drawings; yours to redraw.
