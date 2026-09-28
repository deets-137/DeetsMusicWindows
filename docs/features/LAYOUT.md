---
status: designed
desk_test: none
sources: [src/rules-eval.ts, src/rules.ts, src/settings-store.ts, src/settings-card.ts, src/row-order.ts, src/artist-view.ts, src/collection-card.ts, src/search-card.ts, src/compass.ts, src/now-playing-card.ts]
updated: 2026-09-27
---
# DeetsMusic — Layout: the artist view order and the button states

> **Status (2026-09-27):** designed with the owner in one sitting. Every fork is his (§2, §9).
> The list in §6 is approved. Nothing is built; it is on the docket (HANDOFF.md › Open now).
> The consistency session's review came in the same evening (§11). He closed its five forks
> (§11.3): the rows live in Settings › Window, the pill says *On*, the Grow button is off the
> list, Home's Refresh is on it, and Reset row order clears the artist order too.

**What he asked for.** Use the rules engine to (1) reorder the parts of a view, the artist
drill-down first, and (2) turn buttons off and on. He wants it very granular, and he does not
want it to load basic users.

---

## 1. Terms

- **Part:** one piece of a view that can move or change state: an artist-view shelf, or a
  button on the fixed list (§6).
- **Part state:** what a part shows. A button: **On**, **Faded** or **Hidden**. A shelf:
  **On** or **Hidden**.
- **Faded:** the button stays in its place, looks faded, and does nothing when pressed. Its
  hover hint says why.
- **Hidden:** the part is not drawn. The space closes.
- **Hand layout:** the order and the part states that you set in Settings › Window.
- **Rule layout:** a state rule's order or part state. It lies on top of the hand layout while
  the rule's condition holds, and goes away when the condition stops (the overlay, RULES.md §7).
- **Target:** one thing that a state rule can set (RULES.md §4). Today a target is a settings
  key (`key:theme`) or a window property (`prop:window.onTop`). This doc adds a third kind,
  a part (`part:np.shuffle`).

## 2. His calls (2026-09-27)

| Fork | His call |
|---|---|
| Feature or rules only | **The feature first**, and rules change it by condition (rules sit under features, RULES.md §18). The feature **lives in Settings only**, so basic users and users who do not care never meet it. No new gesture in the views. |
| Hide or fade | **Both.** A button can be On, Faded or Hidden (the word *On*: §11.3). |
| Which views reorder | **The artist view only.** An album has little to reorder. |
| Which buttons | **A fixed list.** The Compass is the fallback for everything: a button goes on the list only if a Compass row does the same thing (§5). |
| The engine | **One target per part** (§4). |
| Where in Settings | First a new section, Layout; then, after the review, **Settings › Window**, beside the other arrangement rows (§11.3). |
| Can a shelf hide | **Yes.** Each artist-view shelf has an On / Hidden pill. |
| What Faded does | **The button stays, looks faded, and ignores presses.** The hint names the reason. |

## 3. The two features

### 3.1 Feature A — the artist view order

A Settings › Window row, **Artist view**, lists the artist view's parts:

| Part id | Library artist view | Search artist view |
|---|---|---|
| `artist.albums` | Albums | Albums |
| `artist.featured` | Featured Playlists | Featured Playlists |
| `artist.yours` | Your Playlists | Your Playlists |
| `artist.songs` | Songs (with its sticky Sort / View bar) | Top Songs |

- You drag a part up or down in the row. The artist view draws the parts in that order.
- **One order for Library and Search.** Songs and Top Songs share one place.
- Each part has an **On / Hidden** pill.
- The order is saved in the `row_order` table under a new scope, `artist.parts`
  (MOVABLE-ROWS.md §13.2). The table does not change. An unranked part sorts last, in the
  built-in order, as every scope does.
- The hero (the round photo, the name and the meta line) is not a part. It stays at the top
  (his call, §9.1).

### 3.2 Feature B — the button states

A Settings › Window row, **Buttons**, lists the buttons of the fixed list (§6), grouped by
where they sit: Title bar, Now Playing, Cards.

- Each button has an **On / Faded / Hidden** pill.
- The values are one settings key, `partStates: Record<PartId, "on" | "faded" | "hidden">`.
  A part with no entry is On. A new part on the list is On on every install.
- A Faded button: `data-part="faded"`. It takes a skin token for its opacity, and ignores
  pointer and key presses. Its hint is its own hint plus the reason: *Faded in Settings ›
  Window* or *Faded by the rule "In a room"* (§11.2).
- A Hidden button: `data-part="hidden"`, not drawn. Its row or bar closes the space.

## 4. The engine — one target per part

**How the engine picks a value today.** `resolveState` (rules-eval.ts) reads the rules from
the top. For each rule whose condition holds, it takes the rule's targets. A target that a
higher rule already took is skipped. So the first rule wins, one target at a time.

**What changes.** `RuleTarget` gets a third kind, `{ part: PartId }`, with the target id
`part:<id>`. Each part on the list is its own target. The artist order is one more target,
`part:artist.order`, whose value is a list of part ids.

What this means for rules:
- **Two rules on different buttons both apply.** "While in Mini, Shuffle is Hidden" and "While
  a room is on, Next is Faded" take different targets.
- **Two rules on the same button:** the higher rule in Rulez wins. The Rulez *who wins* line
  says so, as it does for theme rules today.
- **One rule can set many parts.** A "Focus" rule hides Shuffle, Repeat and ♥. A hand change
  on one of them holds every target that rule sets (RULES.md §18).
- **A hand change:** you change a pill while a rule sets it. Your pick wins; the rule stands
  aside by its `onHand` (RULES.md §8). The rule chip (the dot) sits beside that pill.

What it takes:
1. `rules-eval.ts`: the `{ part }` target and its id. `resolveState` does not change.
2. A parts list (a new small file, `parts.ts`): one line per part: id, name, place, the values
   it allows, its Compass row. It is the fixed list (§6), and `known().targets` reads it.
3. `settings-store.ts`: `partStates`. It is not a `RuleKey`: the rule acts on each part's
   target, not on the whole key.
4. `rules.ts`: each part's rule value goes into a small overlay in memory, the way it does for
   the store's keys. A part reads `partState(id)` = the rule's value, or yours. One listener
   tells the parts to repaint.
5. Each button on the list reads `partState` when it draws and on a change. The artist view
   reads the effective order and states when it builds its head block.
6. Rulez gets new Do words ("Shuffle is Hidden", "the artist view shows Albums first"). These
   are part of the custom-rules pass, RULEZ.md §15.

No schema change. No Apple calls.

## 5. The Compass rule

- A button goes on the list **only if a Compass row does the same thing.** A hidden button
  never takes a function away.
- A button with no Compass row gets one first, or stays off the list.
- **The Compass button in the title bar is never on the list.** Ctrl+Space always works.
- A faded or hidden button's Compass row still works. The row does not read the part state.
- The two rows are Settings rows, so the Compass finds them by itself (COMPASS.md §9).

## 6. The fixed list — approved 2026-09-27

Checked against `actions()` and `places()` in compass.ts and the hint ledger
(ONBOARDING.md §1). **On** = on the list. **Off** = kept off. He approved the list as drafted,
with Library › Refresh added (its Compass row is part of the build).

### 6.1 Title bar

| Part id | Button | Compass row | Draft |
|---|---|---|---|
| `title.cog` | the cog (Quick settings) | *Quick settings*, *Settings* | On |
| `title.friends` | Friends (three figures) | *Listening room*, *Friends* | On |
| `title.web` | Web (the rings) | *Web* | On |
| `title.sound` | Sound (the faders) | *Sound* | On |
| `title.sleep` | Sleep timer (the clock) | *Sleep timer*, *Sleep in … min* | On |
| `title.volume` | the volume bar, with its Mute | the `volume` command, *Mute* | On |
| `title.airplay` | AirPlay | the speaker rows ("airplay") | On |
| — | the compass | — | **Never** (§5) |
| — | the title (DeetsMusic menu) | themes, skins, surfaces | Off: it is the app's name and the window's drag area |
| — | Minimize · Maximize · Close | none | Off: the window's own controls |

### 6.2 Now Playing

| Part id | Button | Compass row | Draft |
|---|---|---|---|
| `np.shuffle` | Shuffle | *Shuffle on / off* | On |
| `np.repeat` | Repeat | *Repeat …* | On |
| `np.prev` | Previous | *Previous song* | On |
| `np.play` | Play / Pause | *Play / Pause* | On (his call, §9.3) |
| `np.next` | Next | *Next song* | On |
| `np.love` | ♥ | the `favorite` command (`favoriteRow`) | On |
| `np.add` | + (Add to Library) | the `add` command (`addRow`) | On |
| `np.queue` | Show queue | the Queue card | On |
| `np.search` | Show search | the Search card | On |
| `np.stage.mute` | Mute (the stage row, Max) | *Mute* | On, its own line (his call, §9.2) |
| `np.stage.airplay` | AirPlay (the stage row, Max) | the speaker rows | On, its own line (his call, §9.2) |

### 6.3 Cards

| Part id | Button | Compass row | Draft |
|---|---|---|---|
| `library.refresh` | Library › Refresh | *Refresh library* (new row in `actions()`, built with this) | On (his call) |
| `home.refresh` | Home › Refresh | *Refresh Home* (new row in `actions()`, built with this) | On (his call, §11.3) |
| — | the Grow button (hover-only) | *Grow …* | Off (his call, §11.3): Settings › Window › Grow cards is its switch |
| — | Back | none | Off: no Compass row, and a way back must stay |
| — | Pin (while grown) | none | Off: it shows only while a card is grown |
| — | Full · Lib chips | none | Off: a view control, not a button |
| — | Search › Clear · Filter | none | Off: part of the search field (SEARCH-FIELDS.md) |
| — | Settings › search | Settings rows | Off: it is the way through Settings, and these rows live there |

### 6.4 Not in the first list

- **The tray panel** (tray.html). The tray panel does not run the rules engine (RULES.md §7).
- **Right-click menu rows** (media-menu.ts). A menu row is not a button on screen. It can be
  its own list later.
- **Rulez and Skinz controls.** They are the tools that change the layout.

## 7. The Settings rows

- **Section:** Settings › Window, beside Grow cards, Card on drill, Move sections by holding
  and Keep view when grown. No new section, so no new quick-panel square. Each of the two rows
  gets one line in `NEW_MARKS`.
- **Artist view row:** a new row shape, a drag list with a pill on each line. It uses
  `row-drag.ts` and the Settings pill family. It goes in `SHAPES` (hint.ts) and the
  ONBOARDING.md §1a list.
- **Buttons row:** one line per button, grouped by place, each with a three-value pill. The
  words on the pill: *On · Faded · Hidden*.
- **Reset:** each row has *Reset* back to the built-in order and every part On. It asks
  first, as *Reset row order* does (MOVABLE-ROWS.md §13.5).
- **Reset row order** (the Compass verb and its Settings row) clears the artist order too, as
  it clears every `row_order` scope, and its text says so (his call, §11.3). It does not touch
  `partStates`.
- The rule chip sits beside a pill that a rule sets.
- The agent: `partStates` gets a spec in `agent-settings.ts` and a line in AGENT.md. The
  artist order is read through `row_order` (it is already in the SQL export).

## 8. The build checklist (CLAUDE.md)

1. Motion: the rows enter with `enterRows`. A part that changes state on screen fades (his
   call, §9.4): opacity over `--part-fade-dur`; a Hidden part fades out, then its space closes.
   Reduced motion snaps (a `prefers-reduced-motion` rule in styles.css).
2. Tokens: `--part-faded-opacity: var(--unreleased-opacity)` (the "does not act" family that
   `--rulez-idle-opacity` already joins, §11.2) and `--part-fade-dur: var(--dur-med)` in
   skin.css base. No raw values.
3. Hints: the Faded reason text; the two rows; the new row shape.
4. Toasts: none.
5. Settings keys: `partStates` with its default and why; its agent spec.
5a. New badge: the two Window rows.
6. Log lines: `diag.log("part", { id, state, by })` when a part changes state.
6a. Scrollbars: the Buttons row sits in the Settings card's own scroll.
7. Telemetry: none (no panel animates).
8. `npx tsc --noEmit`, `npx vite build`, `npm run check`.
9. Compass: the two rows are automatic; *Refresh library* and *Refresh Home* are one row each
   in `actions()`; *Reset row order*'s text names the artist order.
10. Rules: the `part` target (§4).

## 9. Forks closed (his calls, 2026-09-27)

1. **The hero:** fixed at the top. Not a part.
2. **A button in two places** (Mute and AirPlay in the title bar and the stage row): one line
   for each place.
3. **Play / Pause:** on the list. The Compass, the tray and the media keys still play and
   pause.
4. **Motion when a part changes state on screen:** a fade (§8 item 1).
5. **The list** (§6): approved as drafted, with Library › Refresh added.

**Decided inside his choices (for his review at the hand-off):** the Settings key name
`partStates`; the scope `artist.parts`; the part ids in §3.1 and §6; the Faded hint text; `--part-fade-dur` as an alias of `--dur-med`; the
*Refresh library* Compass row's title.

## 10. Desk test

Written with the build.

## 11. The consistency review (2026-09-27, evening)

> **Part:** designed · 2026-09-27

The session *App consistency and documentation gaps* read this design against its survey. It
edited nothing. Each claim was checked against the code before it went in here.

### 11.1 Corrections to this doc (applied)

- **Favorite and Add to Library have Compass rows.** They are typed commands (`favoriteRow`,
  `addRow` in compass.ts), not rows in `actions()`. The review said they had none; that half is
  wrong. §6 now names them as commands, the same as `volume`.
- **The `np.*` parts are read on every surface that draws them.** The Mini player view uses the
  same `np__btn` markup. A part read only in Max would look broken in Mini.
- **The `part:` target gets the same place as `prop:`** in RULES.md: §4's `RuleTarget`, §7b,
  §19 step 2, and `known().targets` in rules.ts. Otherwise the next feature invents a fourth.
- **The drag list is a new Settings row kind:** SETTINGS.md §3's row kinds, `SHAPES` (hint.ts),
  ONBOARDING.md §1a. If it scrolls, it gets `app-scroll`.
- **§8 points to the CLAUDE.md checklist** (items 0–14) for a new row; it does not restate it.

### 11.2 Decided inside his choices (for his review)

- `--part-faded-opacity` aliases `--unreleased-opacity`, the family of "a thing that does not
  act" (`--rulez-idle-opacity` is already in it).
- The Faded hint follows the rule chip's wording (`registerChipText`): *Faded by the rule "In
  a room"* / *Faded in Settings › Window*. A faded button and a chip read as one system.

### 11.3 The review's forks — his calls (2026-09-27)

1. **Window, not a new Layout section.** Settings › Window already holds the arrangement rows
   (Grow cards, Card on drill, Move sections by holding, Keep view when grown). A second section
   for arrangement would bring back the drift the 2026-09-18 regroup removed. The two rows go
   under Window, each with a New badge. The feature and this doc keep the name Layout.
2. **The pill words: *On · Faded · Hidden*.** The Settings pills use one-word states such as On.
3. **The Grow button is off the list.** Settings › Window › Grow cards (`cardGrow`) already
   removes the button, the zones and the menu rows. One switch for one button.
4. **Home's Refresh is on the list** as `home.refresh`, with a new *Refresh Home* Compass row.
5. **Reset row order clears the artist order too**, and its text says so.

Also noted: Back stays off the list with more reason. Escape goes Back only on cards that adopt
list-keys.ts; Rewind, Diary and Rulez do not, so on those three the button is the only way.
