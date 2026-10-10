---
status: designed
desk_test: none
sources: [src/layout.ts, src/layout-rules.ts, src/cards.ts, src/compass.ts, src/settings-card.ts, src/settings-store.ts, src/agent-settings.ts, src/quick-panel.ts, src/stats.ts, src/toast.ts, src/context-menu.ts, vite.demo.config.ts]
updated: 2026-10-10
---
# Hide cards — choose the cards the picker offers

> **Designed 2026-10-10. Nothing here is built.** The owner closed every fork on 2026-10-10
> (§2, §6). §7 is the build scope. Do not tell a user that the app can do this.

## 1. What it is

**Terms.** *The picker* is the menu that opens from a card's title. It swaps the card in
that slot (`makePicker`, [layout.ts](../../src/layout.ts)). *Hide* means that the picker
does not offer the card.

A user may not want some cards, for example Rulez, Diary or Rewind. This feature lets them
remove those cards from the picker. The feature behind the card continues to work.

Rewind already does this through one setting, `rewindCard`. While it is off:
- the picker does not offer Rewind (`poolFor`, layout.ts),
- Compass does not offer Rewind (compass.ts, the card rows),
- a slot that shows Rewind changes to a card that is not on screen (the `onSettingsChange`
  handler at the end of layout.ts).

`rewindCard` starts off and turns on by itself after 50 plays (stats.ts). This feature
changes that one Rewind setting into a setting that can hide any card. Compass no longer
hides Rewind (§6).

## 2. The owner's decisions (2026-10-10)

| Fork | Decision |
|---|---|
| Which cards can be hidden | **Every card except Settings, Now Playing and Queue.** That is Home, Library, Playlists, Search, History, Rewind, Radio, Diary and Rulez. Now Playing and Queue are anchored in Max. Settings is always available. |
| What "hidden" covers | **The picker only.** Compass, the Ctrl+letter shortcuts, rules (the `summon` action), the agent, drills ("Go to Playlist", the Search handoffs) and the Now Playing buttons still open a hidden card. |
| The feature behind the card | **Only the card is hidden.** Diary entries, Rewind counts, Rulez rules and Radio continue to work. |
| Where you hide a card | **A dedicated Settings section** with one toggle per card. In the quick panel, it is the second part under the **Window** icon, after `Window`. Also a **Hide from picker** row when you right-click a card name in the picker. |
| Rewind's own row | **It becomes one toggle in the new section.** It still turns on by itself after 50 plays. |

## 3. The rules that are not choices

- **A minimum.** Max has four slots. Settings is always in the pool. Rulez opens at Fill and
  is never a fallback (`!c.maxOnly` in the fallback). So **at least three of the eight
  everyday cards** (all except Rulez) must stay shown. When only three are shown, their
  toggles lock, and the hint tells you why. Midi needs two cards. Settings and Queue are
  always in its pool, so Midi is always safe.
- **A slot that shows a card when you hide it** changes to a shown card that is not on
  screen, or to the slot's default. This is the Rewind behavior, extended to every card.
  The card's memory (CARD-MEMORY.md) is kept, so the card returns as it was if you show it
  again.
- **The saved layout.** `loadLayout` checks the stored layout against the pool. One card
  that is not in the pool resets **the whole layout** to the defaults
  (`storedAssignment`, layout-rules.ts). The defaults can also name a hidden card (Home,
  Library, Playlists or Search). The build must:
  1. replace only the hidden slot, and not reset the layout;
  2. fill a default from the shown cards when the default card is hidden.
  This rule is pure, so it goes in layout-rules.ts with a test.
- **A card that is opened while it is hidden** (from Compass or a shortcut) shows in its
  slot as usual. That slot's picker then shows the card's name as the current choice,
  because a menu must show what is on screen. The other cards in that list do not change.
  The card leaves the picker again when the slot changes to a different card.

## 4. The setting

- **The key:** `hiddenCards: CardId[]`. It replaces `rewindCard`. Default `["rewind"]`,
  because Rewind is hidden until 50 plays.
- **Migration:** a user whose `rewindCard` is `true` starts with `[]`.
- **The 50-play turn-on** (stats.ts) removes `"rewind"` from the list, once. It uses the
  existing `rewindAutoShown` flag, so a user who later hides Rewind again keeps it hidden.
- **The pool:** `poolFor` reads `hiddenCards` in place of the Rewind test. The Rewind test
  in compass.ts is deleted. The handler at
  the end of layout.ts listens for `hiddenCards` in place of `rewindCard`.
- **The usual steps (CLAUDE.md checklist):**
  - a default with its reason in settings-store.ts;
  - a spec in agent-settings.ts (the agent can show or hide a card) and a line in AGENT.md;
  - a `NEW_MARKS` line for the new section;
  - a reset group in settings-card.ts (the Reset section can restore all cards);
  - a Compass row for the section (automatic, because the rows are in the store);
  - hints in the ONBOARDING.md §1 ledger;
  - the right-click on the picker as a line in ONBOARDING.md §2 (a menu that is not media);
  - `diag.log` when the fallback changes a slot by itself.
- **Rules:** a hidden list could be a rule key ("hide Diary on Mini"). This is **out of
  scope** for the first build (RULES.md §19 later).

## 5. The section

- **Settings:** a new section, **Cards**, with one toggle per hideable card in the registry
  order. The label is the card's name. The toggle is on when the picker offers the card. The
  hint is one sentence that says what the card is. The Rewind toggle moves here from the
  Rewind section.
- **The quick panel:** the Window icon shows `Window`, then this section as a second part
  (`mountSettingsParts`, QUICK-SETTINGS.md §3). The Window icon's row count in §9 changes.
  The icon order is fixed, so no icon moves.
- **The picker's right-click:** `openContextMenu` on a card name in the picker. One row,
  **Hide from picker**. It is not shown on the Settings card. It also works on the card in
  the slot now; that slot then changes at once (§3). It is greyed out when the minimum (§3)
  is reached. After the hide, the picker closes, and a toast offers Undo (a row in TOASTS.md
  §5). Undo shows the card again and puts it back in the slot it left.

## 6. The second forks (the owner, 2026-10-10)

| Fork | Decision |
|---|---|
| The section's name | **Cards.** |
| Row words | **One toggle per card**, with the card's name as the label (*Diary*). |
| Rewind before 50 plays | **Compass shows it.** One rule for every card: hiding affects the picker only. The Rewind test in compass.ts goes. |
| After *Hide from picker* | **An Undo toast.** |
| Hide the card in the slot now | **Yes.** The *Hide from picker* row works on the current card. The slot changes at once (§3). |

### 6.1 Still to bring him at build time

- The hint sentence for each toggle, and the toast's words.
- The Cards section's place in the Settings card's section order.
### 6.2 The Rulez gate: one mechanism (the owner, 2026-10-10)

HOP-IN.md §2 and RULEZ.md §16.1 designed a second gate: a test on `startPick` in `poolFor`
that took Rulez out of the picker for a Cruisin user. **His call: one mechanism.**
`hiddenCards` is the only list that the picker reads.

- The Cruisin preset writes `hiddenCards: ["rewind", "rulez"]`. The Pro preset writes `[]`.
- A change of the Cruisin / Pro Settings row adds `"rulez"` to the list (Cruisin) or removes
  it (Pro). It does not touch the other cards in the list.
- A Cruisin user can show Rulez from Cards, and the Cruisin / Pro row does not change.
- `poolFor` has no `startPick` test.

This doc is built first, so the Hop in build uses this list.

## 7. The build scope

Front end only. No Rust, no schema change, no Apple call. The dev runner needs no restart
(Vite reloads the changes).

### 7.1 The pure rules — `src/layout-rules.ts` + `tests/layout-rules.test.ts`

Three small functions, with no DOM and no registry, so the tests can hold them:

| Function | Rule |
|---|---|
| `repairAssignment(slots, raw, pool, defaults)` | Replaces `storedAssignment`'s all-or-nothing answer. A slot whose card is not in the pool takes its default; a default that is not in the pool, or is already used, takes the first unused card in the pool. JSON that does not parse still gives `null` (the caller uses the defaults). |
| `newlyHidden(before, after)` | The cards that the last change hid. The handler moves only these, so a hidden card that you opened from Compass stays on screen when you hide a different card. |
| `canHide(hidden, id)` | False when the hide would leave fewer than three of the eight everyday cards shown (§3). The toggle lock and the greyed right-click row both read it. |

The test names carry the date (CLAUDE.md, *How to verify*). The existing
`storedAssignment` tests stay true for the cases with no hidden card.

### 7.2 The setting — `src/settings-store.ts`

- `hiddenCards: CardId[]`, default `["rewind"]`, with the reason in its comment. It goes in the
  `// ── cards ──` group, in place of `rewindCard`. `rewindAutoShown` stays.
- `migrate()`: if the stored settings have `rewindCard`, then `hiddenCards` is `[]` when it was
  `true`, else `["rewind"]`. Delete `rewindCard` (the `cardGrowDrill` migration is the model).
- The type of `CardId` comes from `cards.ts`. The store must not import the card modules, so
  import the type only.

### 7.3 The pool and the slots — `src/layout.ts`

- `poolFor`: `!setting("hiddenCards").includes(c.id)` in place of the Rewind test.
- `loadLayout`: `repairAssignment` in place of `storedAssignment`, with the composition's
  defaults.
- `makePicker`: the list is the pool, plus the card in the slot now when it is hidden (§3).
  A `contextmenu` listener on the menu opens `openContextMenu` with one row, **Hide from
  picker** (none on Settings; disabled when `canHide` is false).
  - **A risk to check first.** `makeDropdown` closes on a press outside its panel. The quick
    panel already counts a portaled `.ctx-menu` as inside (QUICK-SETTINGS.md §5). The picker
    needs the same, or the press on the row closes the picker before the row runs.
- **Hide from picker** runs one exported function, `hideCard(id, slot?)`: it writes the list,
  and it remembers `{ id, slot }` for the Undo. The toast (`toast({ kind: "info", actions:
  [{ label: "Undo" }] })`) shows the list again and calls `setSlot(slot, id)`. A toast with
  an Undo always shows (toast.ts admits it like a question).
- The `onSettingsChange` handler at the end of `initLayout`: listen for `hiddenCards`. Keep the
  last list. For each card in `newlyHidden` that is in a slot, put the fallback in that slot
  (the existing Rewind code, run per card). `diag.log("card:hide", { card, slot, fallback })`.
  Then `decompose()` and `compose()` as now, so every picker reads the new pool.

### 7.4 Settings — `src/settings-card.ts`

- **The section:** `title: "Cards"`, one toggle row per hideable card, in the registry order.
  `storeToggle` takes a boolean key, so the rows use a small local helper: `get` = not in the
  list, `set` = add or remove. A row whose `canHide` is false shows as locked, with a hint.
  The Rewind row keeps its two hints ("Shows after 50 plays" / the description).
- **Out of the Rewind section:** the `rewindCard` row. Its other rows stay there.
- **`RESET_GROUPS`:** a `cards` group with the key `hiddenCards`. Take `rewindCard` out of the
  Rewind group.
- **`NEW_MARKS`:** `{ section: "Cards" }`, with the build date.
- **The section's place:** his call (§6.1).

### 7.5 The quick panel — `src/quick-panel.ts`

- `window: [{ title: "Window" }, { title: "Cards" }]`. The Window part's own first
  sub-heading is dropped today; check that the Cards sub-heading shows.
- QUICK-SETTINGS.md §3 and §9: the Window row count goes from 19 to 28.

### 7.6 Compass — `src/compass.ts`

- Delete the line `if (def.id === "rewind" && !setting("rewindCard")) continue;`.
- The Cards section and its rows reach the bar by themselves, because the rows are in the
  store (COMPASS.md §9).

### 7.7 The 50-play turn-on — `src/stats.ts`

- `maybeUnlockRewind`: remove `"rewind"` from `hiddenCards`, in place of
  `setSetting("rewindCard", true)`. The toast text stays.
- The DevTools `__toast.sim.rewind()` needs no change: it calls the same function.

### 7.8 The agent — `src/agent-settings.ts`

- The Spec kinds have no list kind. So: one toggle spec per hideable card, section `"Cards"`,
  key `hiddenCards.<id>` (for example `hiddenCards.diary`), label = the card's title, `get`
  and `set` over the list. `set` refuses when `canHide` is false and says why in `note`.
- Delete the `rewindCard` spec.
- Check before the build: docs:check 20 ("a settings key with no agent spec") must accept the
  `hiddenCards.` prefix as the spec for the key `hiddenCards`. If it does not, the check
  learns the prefix.

### 7.9 The web demo — `vite.demo.config.ts`

- The seed writes `rewindCard = true` today. It must write `hiddenCards = []` instead, under
  the same "only while unset" rule.

### 7.10 The docs to change with the build

| Doc | Change |
|---|---|
| this doc | status `built`, an as-built section, the desk test (§8) |
| [SETTINGS.md](../architecture/SETTINGS.md) | the Rewind row in the table and §4 *The Rewind gate*: the key is now `hiddenCards` |
| [SETTINGS-INVENTORY.md](../architecture/SETTINGS-INVENTORY.md) | the Cards section and its rows |
| [AGENT.md](../integrations/AGENT.md) | the nine `hiddenCards.<id>` rows; `rewindCard` out |
| [TOASTS.md](../architecture/TOASTS.md) §5 | the Hide from picker toast |
| [ONBOARDING.md](ONBOARDING.md) §1, §2 | the hints; the picker's right-click |
| [QUICK-SETTINGS.md](QUICK-SETTINGS.md) §3, §9 | the second part under Window; the row count |
| [COMPASS.md](COMPASS.md) | Rewind is in the bar from the first day |
| [HOP-IN.md](HOP-IN.md) §1, §2, §3 | done 2026-10-10 (§6.2); check again at build |
| [RULEZ.md](RULEZ.md) §16.1 | done 2026-10-10 (§6.2); check again at build |
| [WEB-DEMO.md](WEB-DEMO.md) | the seed writes `hiddenCards` |
| [DEBUGGING.md](../ops/DEBUGGING.md) | `__toast.sim.rewind()` takes `"rewind"` out of the list |
| [DESK-TESTS.md](../ops/DESK-TESTS.md) | the desk test's row |

### 7.11 The checks

`npx tsc --noEmit`, `npm test` (the new layout-rules cases), `npx vite build`,
`npm run docs:check` (checks 20, 22 and 24 read the new key, hints and right-click).

### 7.12 Size

About ten source files, a handful of lines in most. The new code is the three pure
functions, the Cards rows, the picker's right-click and Undo, and the per-card handler.
It is one load-bearing feature, because it changes the layout's load rule.

## 8. Desk test (when built)

To be written with the build. It covers, at least: hide each kind of card from Settings and
from the picker; hide the card in the slot now (Midi and Max); Undo; the lock at three
cards; a restart with a hidden card in the saved layout (the layout stays); a hidden card
opened from Compass and Ctrl+letter; Rewind before and after 50 plays (`__toast.sim.rewind()`);
an agent `settings` set on `hiddenCards.diary`; the web demo's first visit.
