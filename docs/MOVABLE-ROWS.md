# DeetsMusic — Movable rows

> **Status (2026-09-20): BUILT, and the desk test in §12 PASSED 2026-09-20.** Every fork in §11 was decided by
> the owner on 2026-09-20 and the whole thing was built in one hand-over — sections on all
> four cards, playlist rows inside their section, pinned-tile order, and the Settings search
> bar. **§13 is AS BUILT and is the section to read first**; §§1-11 are the design that led
> there, and where they disagree with §13, §13 is the code. §0a is still the scope.

**What you asked for.** Two things, in one doc because they collide in one place (§10.5):
1. A user can press a row and drag it to a new place, so the card shows the rows in the
   order the user wants. This covers Home, Playlists, Radio, Settings, and every card that
   draws folders or sections.
2. The Settings card gets a search bar.

---

## 0. Terms

Define these once. The rest of the doc uses them exactly.

- A **row** is one line in a card's vertical list. A **tile** is one square in a shelf that
  scrolls sideways.
- A **section** is a header plus the rows under it. Radio's *Recents* is a section. A
  Playlists **folder** is a section. A Settings **section** is a header plus setting rows.
- A **shelf** is a label plus one sideways row of tiles. Home has six shelves.
- **Section order** is the top-to-bottom order of the sections in a card.
- **Item order** is the order of the rows or tiles inside one section.
- The **built-in order** is the order the code makes today, with no user order saved.
- A **rank list** is the saved user order: a list of section ids or item ids.
- An **unranked** section or item is one the rank list does not name. A new folder is
  unranked until the user moves something.

---

## 0a. Scope — decided by the owner (2026-09-19)

He read §5.1 and cut Feature B down. **What is in and what is out:**

| | In scope | Why |
|---|---|---|
| **Section order** (Feature A) — Home shelves, Playlists folders and clusters, Radio sections, Settings sections | **YES** | The original ask |
| **Pinned tiles** (Feature B) | **YES** | His words: *"Would like to re-arrange pinned items"* |
| **Playlist rows inside their section** (Feature B) | **YES** | His words: *"Would for playlists (some apple playlists over others)"* |
| **Radio stations inside a section** (Feature B) | **NO** | His words: *"wouldn't want to for radio items"*. §5.1 agreed: Recents is a log that reorders itself on the next play |
| **Home shelf tiles** (Feature B) | **NO** | Not asked for. The shelves are ranked lists — a hand order contradicts the shelf's own meaning (§5.1). **The Pinned shelf is the exception, because it is in scope above** |
| **Settings rows inside a section** (Feature B) | **OPEN** | Never answered. Fork 11 in §11 |

**The two in-scope B items are not the same size**, and neither is free:

- **Playlist rows** are the cheap case: vertical, uniform, already the shape `Grouping.reorder`
  handles. No new drag math.
- **Pinned tiles cost two things this doc listed as reasons to say no** (§5.2). They are a
  **sideways** shelf, so they need the horizontal insertion line, index math and sideways
  auto-scroll that do not exist. And pin order lives in the **`pins` SQLite table**, so a hand
  order is a **schema change** — which by the one-load-bearing-feature rule cannot share a tree
  with the `playlist_refresh` table of [PLAYLIST-REFRESH.md](PLAYLIST-REFRESH.md) §6.

**And pinned tiles collide with a decision he already made.** The roots' Pinned shelf is pin
order (newest first, `pinsOf`), but **Home's Pinned shelf is most-played-first**
([home.ts:952](../src/home.ts), PINS.md fork 4 — his own earlier call). A hand order has to
answer which of those it overrides. That is fork 12 in §11.

---

## 1. What the code does today (checked 2026-09-19)

### 1.1 The drag primitive

`src/row-drag.ts` (429 lines) already does most of the pointer work. It gives us:

- A whole-row press, a 6 px threshold in any direction, and a quick click that still acts.
- A translucent **ghost** on `<body>`, so a drag can cross card edges.
- An **insertion line** (`.drop-line`) inside the source's own list, with row math that
  holds when the list is windowed (`collection-window.ts`).
- Edge **auto-scroll** in the list under the pointer.
- A module-level **drop-target registry** (`registerDropTarget`), so one drag reaches every
  card (DRAG-DROP.md §7).
- `isDragging()` / `onDragEnd()`, so every card holds its re-renders during a drag.
- **Escape** cancels. The trailing click is swallowed for every card.

So: we do not write a new drag. We extend this one. That is the same call DRAG-DROP.md §0
rule 3 made.

### 1.2 Reorder today — one narrow shape

The collection engine offers reorder through one hook (`src/collection-card.ts:93`):

```ts
reorder?: { sortKey: string; move: (from: number, to: number) => void };
```

It is offered **only** in lines density, **only** in that sort ascending, and **only** with
no search — because a drop position means nothing in another order or a filtered list. Two
callers use it:

| Caller | What moves | Write |
|---|---|---|
| `qcard.ts` | an Up Next row | `queue.move` → `reconcileUpcoming()` |
| `playlists-card.ts:344` | a song in a hand-made playlist | `playlist_reorder` (SQLite) |

**Both are item order inside one flat list.** Nothing in the app moves a **section** today,
and nothing reorders **tiles**.

### 1.3 The four places you named, as they are built

**Home** (`src/home-card.ts`, `src/home.ts`). Six shelves, pushed in a fixed order at
`home.ts:932-937`:

```
Recently Played · Recently Added · New · <bucket> · Pinned · Songs of the Day
```

Facts that matter:
- A `HomeShelf` is `{ label, items }`. **There is no stable id.** The fourth shelf's label
  is `bucketLabel()` — it changes with the hour and the day ("Weekday evening"). A rank list
  keyed on the label would lose that shelf every few hours.
- A shelf with no items is **not drawn at all** (`if (played.length) shelves.push(…)`).
- Home does **not** ride the collection engine. It builds its own markup and delegates three
  listeners. So it gets its own `rowDrag` wiring.
- The tiles are `.search__tile` inside `.search__scroller` — a **sideways** list.

**Playlists root** (`src/playlists-card.ts:112-123, 688-743`). A heterogeneous list of
`PlRow`, with a `pos` field that pins the section order through the engine's sort:
- manual folders first, sorted **A–Z** (`byName`), then
- the unfiled playlists, auto-clustered by kind (the clusters have a fixed built-in order).
- Headers exist **only** in the `folders` sort, ascending, with no query. Any other sort or
  a live query flattens the list to plain playlist rows.
- Collapse state persists per section, keyed on `sectionKey(x)` — `folder:<id>` for a
  folder, the cluster key for a cluster. **That key is already the stable id we need.**
- A folder always renders, even when empty.

**Radio root** (`src/radio-card.ts:41-47, 145-171`). The same grammar:
- `ShelfItem` with `pos`; sections `Recents · For You · Live · Genres`, in that fixed order.
- Collapse state is keyed on the **label** (`data-section="${label}"`). The labels are
  constants here, so the label is a usable stable id — unlike Home's.
- Any non-featured view flattens the headers out and dedupes stations by id.

**Settings** (`src/settings-card.ts:134-142, 750`). Not the engine at all:
- `sections: Section[]` is one array literal, 23 sections, `{ title, rows, tail?, count?,
  defaultOpen? }`.
- Folds persist as **title → open** in `localStorage["deets.settings.folds"]`. So the title
  is the stable id, and it is already load-bearing.
- A section whose every row is gated off by `when` is not drawn.
- `settingsRows()` builds the **Compass index** from the same array, inert
  (`settings-card.ts:311`). So a change to the array's order changes the Compass's order too
  (§10.6).
- `focusRow(id)` finds a row by id, unfolds its section, scrolls and flashes it. A user order
  does not break it.

**Library root** (`src/library-card.ts:1154`) draws the Pinned shelf with
`shelvesFirst: true`. `pinsOf` is **newest-first** with no user order (PINS.md).

### 1.4 What this tells us

The ask is not one feature. It is **three** features that share one primitive:

| # | Feature | Where | Built today |
|---|---|---|---|
| A | **Section order** — move a header and its whole block | Home, Playlists, Radio, Settings | no |
| B | **Item order** — move a row or tile inside its section | Home shelves, Radio Recents, a folder's playlists, a Settings section's rows | no |
| C | **Flat-list order** | Up Next, a hand-made playlist | **yes**, §1.2 |

A is what your sentence asks for most directly. B is a larger job with more open questions
(§4). C stays exactly as it is.

---

## 2. The one hard problem: an order over a computed list

Every list here is **computed on each render**. Sections appear and disappear:

- A Home shelf vanishes when it has no items, and the bucket shelf hides under five scored
  items (`SCORE_MIN`).
- Radio's *Genres* appears only after the genres load; *Recents* appears after the first
  station plays.
- A Playlists folder is created and deleted at any time.
- A Settings section hides when `when` gates off every row (Skin settings under Cyber).

So a saved order cannot be an array of positions. It must be a **rank list of ids**, and the
render must answer one question: **where does an unranked section go?**

Three answers, and this is fork 3:

| | Rule | What the user sees |
|---|---|---|
| **3A** | **Unranked goes last**, in built-in order | You moved one shelf; a new shelf appears at the bottom, never in the middle of your order |
| **3B** | **Unranked keeps its built-in neighbour** — insert it beside the nearest ranked section it sat next to in the built-in order | A new shelf appears where the code meant it to be, inside your order |
| **3C** | **Rank everything on the first move** — write the full order the moment the user drags once; a genuinely new id goes last | Your order is frozen; a shelf added by a later app version lands at the bottom |

3B is the kindest and the hardest to explain. 3C is the simplest to reason about and the one
that surprises a user after an update. **Recommendation: 3A.** It is one sentence in the
hover hint ("New sections appear at the end"), and it needs no built-in-neighbour table. But
this is your call, and it is the decision the rest of the doc leans on hardest.

**A hidden section keeps its rank.** A rank list holds ids the render does not draw. That is
correct and needs no code: the sort reads the rank, the filter drops the row. So a Home
bucket shelf that hides at 3 a.m. comes back in your place at 8 a.m.

**Home needs a stable id first.** `HomeShelf` gains `id: "played" | "added" | "new" |
"bucket" | "pinned" | "sotd"`, and the label stays what it prints. This is a prerequisite for
any Home work and is not itself a fork.

---

## 3. Where the order lives

Fork 4. Four candidates, all real in this codebase:

| | Store | Cost | Notes |
|---|---|---|---|
| **4A** | **One `localStorage` key per card** — `deets.<card>.order` | none | Matches the folds keys (`deets.settings.folds`, the Radio/Playlists collapse sets) exactly |
| **4B** | **One settings-store key** — `rowOrder`, a JSON object of card → rank list | small | Rides `settings-store.ts`, so it reaches the agent (`agent-settings.ts`) and the Compass; needs a spec and an AGENT.md line (the checklist, item 5) |
| **4C** | **A SQLite table** — `row_order(card, kind, id, rank)` | a migration + Rust commands | Only this one survives a cleared WebView cache, and only this one can be read by the `query` MCP tool |
| **4D** | **Per owner** — a folder's playlist order in the folder's own table, a shelf order in localStorage | mixed | Truest to each thing's real home; most code |

**Recommendation: 4A.** Section order is a look preference, in the same class as a fold, and
every fold in this app is already a `localStorage` key. It needs no migration, no Rust, and
no agent spec. If you want the agent to set the order, or you want the order in a backup,
4B is the honest answer instead — say so and I will design the spec.

---

## 4. Feature A — moving a section

### 4.1 What "move a section" means per card

| Card | The header element | What moves with it |
|---|---|---|
| Home | `.search__label` | the `.search__scroller` under it |
| Playlists | `.lib-shelf--toggle` (a row in the same list, with `data-idx`) | the member rows after it, to the next header |
| Radio | `.lib-shelf--toggle` (same) | the same |
| Settings | `.set__head` inside `.set__section` | the whole `<section>` |

Home and Settings are easy: the header and its content sit in **one** wrapper element, so
one block moves. Playlists and Radio are hard: the header and its members are **siblings in
one flat list of rows**, each with its own `data-idx`. Moving that header means moving a
**block of N rows**, which the primitive cannot do today (§5.2).

**A cheap way out, worth naming:** a section is **collapsed** while it is dragged. A
collapsed section is exactly one row in the list, so the existing one-row math applies
unchanged, and the ghost is one row tall. The fold is restored on drop. This is fork 5:

- **5A** Collapse on press, restore on drop (one row moves; the existing math holds).
- **5B** True block move (the ghost is the whole block; new math; the insertion line may
  only land between sections, never inside one).

**Recommendation: 5A.** It is a fraction of the code, it reads clearly on screen (the
section shuts, you place it, it opens), and the motion already exists — the fold animation
is `frames.during("fold", 250, …)` plus `enterRows`. 5B looks better in a screenshot and
costs a new drag mode.

### 4.2 The gesture — is there an Arrange mode?

Fork 6. A press on a Playlists folder header today opens its right-click menu on
right-click and toggles the fold on left-click. A press on a Home tile is a drag **source**
already (it carries songs to another card, DRAG-DROP.md §2). So the gesture must not be
ambiguous.

| | Gesture | Cost to the user |
|---|---|---|
| **6A** | **A grip appears on the header on hover.** Press the grip to move the section; press anywhere else on the header to fold it | Nothing changes unless you aim at the grip. One new control family member (§7) |
| **6B** | **Press and hold the header** (about 400 ms) to move it | No new pixels. A hold is invisible; nothing on screen teaches it |
| **6C** | **An Arrange mode** — right-click a header → *Arrange sections*; every header grows a grip, drills and plays are suppressed, an *Arrange* chip in the header ends it | The most discoverable and the most machinery. It is also the only option that can offer *Reset order* in the same place |
| **6D** | **Both 6A and 6C** — the grip is always there, and the right-click menu also has *Arrange sections* for someone who never sees it | — |

**Recommendation: 6A.** It matches the app: nothing else here has a mode, and the drag
primitive is already always-on. The grip is a `title`, so the hover hint teaches it
(ONBOARDING.md ledger). A grip also solves Home for free: the shelf **label** is not a drag
source today, so a grip beside it is unambiguous against the tiles below it.

### 4.3 The sort gate

The engine's rule holds and is not a fork: **a user order is only offered when the card is
in the view that shows sections.** That is `folders` ascending with no query for Playlists,
`Featured` for Radio. Any other sort or a live query flattens the headers out, so there is
no header to grab, and the rank list is simply not read. No code needed — it follows from
§1.3.

Settings has no sort, so its sections are always movable. Home has no sort either.

### 4.4 Reset

A user order needs a way back. Fork 7:

- **7A** *Reset order* in each card's own header menu, plus a row in Settings › Reset (the
  `RESET_GROUPS` machinery already exists, `settings-card.ts:1533`).
- **7B** Settings › Reset only.
- **7C** Both, and a `success` toast that says what was reset (TOASTS.md §5 gets one row).

**Recommendation: 7A plus the toast** — i.e. 7C. A reset you cannot find is not a reset.

---

## 5. Feature B — moving an item inside a section

**Scope settled in §0a: pinned tiles and playlist rows, yes; radio stations and Home's other
shelf tiles, no.** This section is kept as the reasoning that produced that answer, and §5.2
is the live cost list for the two that are in.

### 5.1 Four different lists, four different answers

| Where | The list | Does a user order even mean anything? |
|---|---|---|
| **A Playlists folder's members** | playlist rows, vertical, uniform | **Yes.** They are sorted `byName` inside the folder today. A hand order is a real want |
| **A Radio section's stations** | station rows, vertical, uniform | **Recents is a log** — it reorders itself on the next play, so a hand order fights the data. *For You*, *Live* and *Genres* are Apple's order |
| **A Home shelf's tiles** | tiles, **sideways**, uniform | **The shelves are ranked lists.** Recently Played is time order; the bucket shelf is a score. A hand order inside them contradicts the shelf's own meaning |
| **A Settings section's rows** | setting rows, vertical, **not uniform** (a range row is taller than a toggle) | Possible, and the least useful. The Compass and the new search bar are the fast paths to a row |

So Feature B is **not one feature either**. The only place it is clearly right is a folder's
members. Everywhere else it either fights the data (Recents, Home's shelves) or buys little
(Settings rows).

**This table is what the owner decided from** (§0a, 2026-09-19): playlist rows in, pinned
tiles in, radio out, Home's other tiles out. The one row he did not answer is the Settings
rows — fork 11.

### 5.2 What the two in-scope items cost

**Playlist rows — nothing new.** Vertical, uniform, flush. This is the shape `row-drag.ts`
already handles and `Grouping.reorder` already exposes (§1.2). The work is a rank list per
section and the write, not the drag.

**Pinned tiles — two real costs, both named here before the build:**

1. **A sideways list.** The press threshold is already 2-D, but the insertion line, the index
   math and the edge auto-scroll are all vertical. A horizontal variant is **new code** in the
   primitive (`RowDragOptions.axis?: "y" | "x"`, §6 item 4), and it must scroll
   `.search__scroller` sideways.
2. **A schema change.** Pin order is the `pins` table's own order (`pinsOf`, newest first), so a
   hand order means a **`rank` column** on `pins`. By the one-load-bearing-feature rule that
   cannot ride the same tree as `playlist_refresh` ([PLAYLIST-REFRESH.md](PLAYLIST-REFRESH.md)
   §6). **These two features must be built in separate hand-overs.**

**Also still true, and no longer avoidable:** a pinned tile is **already** a drag source — a
press and a drag carries its songs to the Queue, to Now Playing, to the Library
(DRAG-DROP.md §2). A tile dragged one seat sideways and a tile dragged out to another card
start identically, and a tile has no header to hang a grip on. **So pinned tiles need either a
mode or a tile-corner grip, whatever fork 6 chooses for section headers.** §0a is why fork 6
can no longer be answered for headers alone — see fork 6's amended options in §11.

**Settings rows, if fork 11 says yes:** the row math assumes uniform, flush rows (the comment
at the top of `row-drag.ts` says so), and a range row is taller than a toggle. That needs
per-row measurement — a third piece of new primitive work for the least useful of the three.

### 5.3 The conflict with drag-to-copy

A Home tile, a playlist row and a station row are **already** drag sources: a press and a
drag carries songs to the Queue, to Now Playing, to the Library (DRAG-DROP.md §2). If the
same press also reorders, one gesture means two things.

The existing rule already answers most of it: **inside the source's own list the drag is a
reorder; once it leaves the list it is a copy** (DRAG-DROP.md §3). That rule was written for
exactly this, and it works for the vertical lists. It does **not** answer Home: a tile
dragged sideways one seat and a tile dragged out to the Queue start identically.

So if Feature B reaches Home tiles, Home tiles need a grip too, or a mode. This is the
strongest argument for 6C, and a reason to decide fork 8 before fork 6.

---

## 6. What the primitive grows

Small, and additive. Nothing that exists changes behaviour.

1. **A block source.** `DragRow` gains `block?: { id: string; rows: number }` — the header's
   id and how many rows travel with it. With 5A (collapse on press) `rows` is always 1 and
   the field is only the id.
2. **A section list.** A new option on `rowDrag`: `sections?: { idAt(row) → string | null;
   order(ids: string[]) → void }`. The primitive draws the insertion line **between
   sections only**, and hands back the whole new id order — not splice indexes. A rank list
   wants ids, not positions (§2), so the callback should speak ids.
3. **A grip.** The primitive learns one selector (`[data-grip]`) that must be pressed for a
   section drag to start, when the caller asks for it. Fork 6 decides whether that is the
   only way in.
4. **Horizontal lists** — only if fork 8 reaches Home tiles. `RowDragOptions.axis?: "y" |
   "x"`, default `"y"`.

Nothing else. The ghost, the auto-scroll, the Escape, the swallowed click, the render hold
and the `frames` telemetry all apply as they are.

---

## 7. The checklist (CLAUDE.md, "before you build a new panel, row, button or card")

Walked now, so the build does not discover it later.

1. **Motion.** A section that lands must not jump. The fold animation already exists
   (`frames.during("fold", 250)` + `enterRows` from `src/pop.ts`) and 5A reuses it end to
   end. The rows of a section that opens after a drop slide in through `enterRows`, the same
   call `toggleSection` makes today (`settings-card.ts:1865`). Reduced motion: the primitive
   already snaps the lift; a drop becomes instant.
2. **Tokens.** The drag look is `--drag-lift`, `--drag-ghost-opacity`,
   `--drag-source-opacity`, `--shadow-panel` — all present. A grip needs alias tokens, never
   raw values: `--grip-w`, `--grip-gap`, `--grip-opacity` in `skin.css` base, and its colour
   is a theme role in `themes.css`.
2a. **Design language.** The grip joins the **icon square** family (the family of
   `.panel__action` and the collapse chevron), because it sits in a header. It is not a panel
   chip and not a toast button. Copy that family's whole rule set — fill, border, height,
   radius, hover, focus (UI-ARCHITECTURE.md §2a).
3. **Hints.** The grip carries a `title`: *"Drag to move this section. New sections appear at
   the end."* (the second sentence is fork 3's wording). One new row in the ONBOARDING.md
   ledger, and one new row shape in its SHAPES table.
4. **Toasts.** One row in TOASTS.md §5 for *Reset order* (`success`). A move itself gets **no**
   toast — the screen already shows the result.
5. **Settings keys.** 4A needs none. 4B needs a default with its "why", an
   `agent-settings.ts` spec and an AGENT.md line.
6. **Log lines.** `diag.log` each committed reorder: the card, the moved id, the new
   neighbour. That is what makes a "my Home is in the wrong order" report readable (the
   CLAUDE.md read-never-guess rule).
6a. **Scrollbars.** Nothing new scrolls. Settings' body already has its own thumb rule
   (`is-scrollable`).
7. **Telemetry.** The drag already sets `frames.begin("drag", label)`. Use a new label
   `section` so a section move is separable in the log from a row move and a `cross` copy.
8. **Check.** `npx tsc --noEmit`, `npx vite build`, then the desk test written into §12.
9. **Compass.** *Reset order* is a command row in `src/compass.ts` (COMPASS.md §9), and
   `SYNONYMS` gets "arrange", "rearrange", "move". One line in COMPASS-TERMS.md.

---

## 8. What this does NOT touch

Stated so the build stays inside its edge:

- **Up Next and a hand-made playlist's songs** keep exactly today's reorder (§1.2 C).
- **Drag between cards** (DRAG-DROP.md) is untouched. No target changes.
- **The `pins` table** gains no `rank` column in this build (§5.2).
- **Apple's own order** is never rewritten. A user order is ours, local, and on top.
- **`Grouping.reorder`** keeps its signature. Section order is a new hook beside it, not a
  change to it.

---

## 9. Build order

Each step compiles and can be handed over on its own. This assumes 3A · 4A · 5A · 6C · 7C.
**Two hand-overs, because pinned tiles change the schema and playlist refresh already does
(§5.2):** steps 1-8 are one, steps 9-10 are the next.

1. `HomeShelf.id` (§2) — a prerequisite, no user-visible change.
2. A tiny shared module, `src/row-order.ts`: read a rank list, write it, sort a list of ids
   by it under the fork-3 rule, reset it. About 60 lines, one place to test the §2 rule.
3. `row-drag.ts`: the grip selector and the `sections` option (§6 items 2 and 3).
4. **Settings sections** first — it is the simplest card (one wrapper per section, its own
   render, no sort, no engine, no drill).
5. **Home shelves** — the second simplest (one wrapper per shelf, its own render).
6. **Radio and Playlists** sections, through the engine, with 5A's collapse-on-press.
7. *Reset order* — the header menus, the Settings › Reset row, the toast, the Compass row.
8. Docs: this file's "as built" section, ONBOARDING.md, TOASTS.md, COMPASS-TERMS.md,
   DEBUGGING.md (`drag section`), and the four cards' own docs.

9. **Playlist rows** inside their section (§0a) — the cheap B case, no new drag math.
10. **Pinned tiles** — the horizontal axis in `row-drag.ts`, the `rank` column on `pins`, and
    fork 12's answer about Home's shelf. **Its own hand-over**, after the `playlist_refresh`
    schema work has landed and been desk-tested.

---

## 10. The Settings search bar

### 10.1 Why it is cheap

The index already exists. `settingsRows()` (`settings-card.ts:311`) returns every setting
row with its `id`, `label`, `section`, `hint()` and `when()`, built once from an inert mount.
The Compass uses it today. The search bar reads the **same** function, so there is one source
of truth and no second list to keep in step.

### 10.2 Where it sits — fork S1

| | Placement | Notes |
|---|---|---|
| **1A** | **A search pill in the card header that opens a field under it** — the collection card's own idiom (`.lib-pill--icon[data-pop="search"]` + the `.lib-searchbar` slide-down, `collection-card.ts:578-590`) | Identical to every other card's search. Costs a header button where Settings has none today |
| **1B** | **An always-visible field pinned at the top of the body**, above the first section | One press fewer. It also spends vertical space in a card that is already a long scroll, and it matches no other card |
| **1C** | **No bar; the Compass is the search** | Free. It is also a fair answer — Ctrl+Space already reaches every setting and renders a store-backed row inline (COMPASS.md §3) |

**Recommendation: 1A.** A user who is inside Settings should not have to leave it to find a
row, and 1A is the one option that teaches nothing new — the gesture is the gesture every
other card already has.

### 10.3 What a match does — fork S2

| | Behaviour |
|---|---|
| **2A** | **Filter in place.** Sections with no match are hidden; a section with a match unfolds and shows only its matching rows; the count in the header shows the matches. Clearing restores the folds exactly |
| **2B** | **A result list.** The sections are replaced by a flat list of matching rows, each with its section name underneath; a click runs `focusRow(id)` — clear the query, unfold, scroll, flash |
| **2C** | **Filter in place, and matched rows keep their real controls** (2A) plus the section name shown on each row when more than one section matched |

**Recommendation: 2A.** It is what the folds and `render()` already do — `shown(rows)` is one
filter, and one more predicate goes beside it. 2B duplicates the Compass in the card that
least needs a second Compass.

### 10.4 What is matched

- The row's **label**, its **section title**, and its **hint** text. The hint is where the
  words a user actually remembers live ("tray", "blur", "85%").
- A row gated off by `when()` is **not** matched. It cannot be shown, so a hit on it is a
  dead end.
- A section's `tail` markup is not matched (it is HTML, and its rows are not in the index).
- Matching is case-insensitive substring, and every space-separated word must hit somewhere
  in that row's text. This is the same rule the engine's `match` uses, so "tray min" finds
  *Minimize to Tray*. Fuzzy matching is a fork only if you want it — I recommend against it
  in a 23-section list.

### 10.5 The collision with §4

A live query is a **filter**. The engine's rule (§4.3) already says a filtered list is not
reorderable, and Settings must follow it: **while the search field holds text, the section
grips are hidden and a section drag cannot start.** Clearing the field brings them back. This
is not a fork — it is the existing rule applied.

### 10.6 One thing to know about the index

`settingsRows()` memoizes into a module-level `entries` and reads section order from the
array literal. If a user section order lands (§4), the **Compass's** list order follows the
user's order too, because both read the same array. That is almost certainly what you want,
but it is a consequence worth seeing before it ships: reorder Settings and the Compass's
settings results reorder with it.

### 10.7 Ctrl+F — fork S3

In a release build the browser accelerator keys are off (`AreBrowserAcceleratorKeysEnabled =
false`, DRAG-DROP.md §6), so **Ctrl+F does nothing at all today**.

- **9A** Ctrl+F opens this field while the Settings card is on screen and focused.
- **9B** Ctrl+F opens the focused card's search field, for **every** card that has one —
  Settings, Library, Playlists, Radio, Search.
- **9C** Leave Ctrl+F dead; the pill and Ctrl+Space are enough.

**Recommendation: 9B.** It is barely more code than 9A, it makes one key mean one thing
everywhere, and it gives a Windows user back a key the release build took away. It is also
the keyboard pass's own territory (COMPASS.md), so it may belong in that session instead of
this one — your call.

### 10.8 Checklist items the bar owes

1. Motion: the field's slide is the `.lib-searchbar` `is-open` rule, reused as is.
2. Tokens: none new — `.lib-search` and `.lib-pill--icon` carry theirs.
2a. Family: the **field** family, copied from `.lib-search` whole.
3. Hint: the pill's `title` — *"Finds a setting by name"*.
4. Toasts: none.
5. Keys: none (a query is not remembered across a remount; CARD-MEMORY.md holds the scroll
   place and the folds, and a stale query would be a surprise on return). Fork S4 if you
   disagree.
6. Log lines: none — a search acts on nothing.
7. Telemetry: `dataset.frames` on the slide-down, as the other cards' bars have.
9. Compass: nothing. The Compass already indexes every setting.

---

## 11. The fork sheet

**Forks 1, 2 and 8 were closed** by §0a (the owner, 2026-09-19). **Every other fork was
closed by the owner on 2026-09-20**; the "I recommend" column is kept as written, and the
answer column says what he chose. Where they differ, he wins — fork 6 and fork 7 are both
his own shapes, not one of my options.

### 11.1 Closed

| # | Question | His answer |
|---|---|---|
| 1 | Which features? | **A (sections) everywhere, plus B for pinned tiles and playlist rows only** (§0a) |
| 2 | Which cards? | **All four** — Home, Playlists, Radio, Settings — for section order |
| 8 | If B, which lists? | **Pinned tiles and playlist rows.** Radio stations out, Home's other shelf tiles out |

### 11.2 Decided 2026-09-20 — movable rows

| # | Question | I recommended | **His answer (2026-09-20)** |
|---|---|---|---|
| 3 | Where does a NEW section go? | 3A | **3A — last, in built-in order.** The hint says so in words |
| 4 | Where does the order live? | 4A | **4C — one SQLite table, `row_order`, for all of it** (schema v13). Pins included, so there is no `pins.rank` column |
| 5 | How does a section move? | 5A | **5A — it folds shut as it lifts, and opens again on the drop** |
| 6 | The gesture? | 6C | **His own shape: the HEADER ITSELF is the grip when it is HELD** (a click still folds it), with a Settings row to turn it off. No Arrange mode, no header grip. A hold of **400 ms**, the row **on** by default |
| 6a | And a pinned tile, which has no header? | — | **His own shape: a grip bar over the left of the cover** — a rectangle most of the cover's height with three dots in it, pressed and dragged. Shown on **hover or keyboard focus**, not always |
| 7 | Reset? | 7C | **Settings › Reset + a toast.** No per-card menu row (so 7B + the toast) |
| 11 | Do Settings ROWS reorder inside their section? | No | **No** |
| 12 | A hand pin order vs Home's most-played Pinned shelf | 12A | **12A — the hand order wins everywhere, Home included** |

### 11.3 Decided 2026-09-20 — the Settings search bar (§10)

| # | Question | I recommended | **His answer (2026-09-20)** |
|---|---|---|---|
| S1 | Placement? | 1A | **1A — a header button that opens the field under it** |
| S2 | Behaviour? | 2A | **2A — filter in place** |
| S3 | Ctrl+F? | 9B | **9B — every card with a search field** |
| S4 | Is the query remembered across a remount? | no | **no** |

## 12. The desk test — **PASSED 2026-09-20**

Written before the build; every step below is what the built code must satisfy. **Read
§13 first — the gesture is a HOLD, so every "drag" below means "hold the header for a
moment, then drag".** Steps 17-20 were added after the build.

1. **Settings.** Hold *Sound* and drag it above *Window*. It stays there. Close and reopen the card — it
   is still there. Restart the app — still there.
2. **A hidden section keeps its place.** Put *Skin settings* between two sections, switch to
   Cyber (the section draws nothing), switch back. It is in your place, not at the end.
3. **A new section goes where fork 3 says.** Simulate one: clear the rank list for one id,
   reload, and check it lands per 3A/3B/3C.
4. **Home.** Drag *Pinned* to the top. Play a song (the card rebuilds on a song change) —
   the order holds. Let the bucket shelf change label across an hour boundary — the order
   holds (this is the §2 stable-id test).
5. **Radio.** In the Featured view, drag *Genres* above *Recents*. Switch to another sort —
   the headers flatten, no grip, no crash. Switch back — your order is there.
6. **Playlists.** Drag a folder above another folder. Create a new folder — it appears per
   fork 3. Delete a folder — the rank list holds a dead id and nothing breaks.
7. **The gesture does not steal the old ones.** A left-click on a header still folds it. A
   right-click still opens its menu. A press on a **playlist row** inside a folder still
   drags that playlist to the Queue as a copy (DRAG-DROP.md §2) — Feature A changed nothing
   about it.
8. **Escape** during a section drag cancels and restores the fold.
9. **Reduced motion** on: the drop is instant, the section still opens.
10. **Reset order** in the card menu and in Settings › Reset both restore the built-in order,
    and the toast says so.
11. **Search.** Type "tray" in the Settings bar: *Minimize to Tray* shows, its section
    unfolded, everything else hidden. The grips are gone while the field has text. Clear it:
    the folds are exactly as they were before the search, and the grips are back.
12. **Search + a gated row.** With Cyber on, search "glass": the Glass-only rows do not
    appear (§10.4).
13. **Playlist rows** (§0a): in a folder, drag one playlist above another. It holds through a
    re-render, a sync and a restart. Switch to another sort — the hand order is not applied
    (the §4.3 gate) and nothing crashes.
14. **Pinned tiles** (§0a, its own hand-over): drag a tile sideways one seat on the Library
    root. The order holds, and it shows the same on the Playlists and Radio roots. Then check
    Home's Pinned shelf against fork 12's answer.
15. **A pinned tile still drags out.** Drag a pinned tile to the Queue card — it still carries
    its songs (DRAG-DROP.md §2). This is the test that catches fork 6 being wired wrong.
16. `npx tsc --noEmit` and `npx vite build` clean. **Done 2026-09-20, both clean, and
    `cargo check` clean.**
17. **The hold does not steal a scroll.** Press a Settings header and move at once: the card
    scrolls, no ghost, no fold change. Press and wait, then move: it lifts.
18. **The row turns it off.** Settings › Window › *Move sections by holding* → Off. Hold any
    header anywhere: it only folds, and the header's hover hint no longer mentions moving. A
    pinned tile's grip bar still works.
19. **The grip is not the tile.** Click a pinned tile's grip bar without moving: nothing
    plays, nothing opens. Hover away: the bar goes.
20. **Two cards, one order.** Move a pinned tile on the Library root; the Playlists and Radio
    roots show the same order without a restart, and so does Home.

---

## 13. As built (2026-09-20)

Everything below is in the tree. Where it disagrees with §§1-11, this section is the code.

### 13.1 The gesture

**A section header is its own grip while it is HELD.** Press a header and hold it still for
**400 ms**: it swells. Now move the pointer and it lifts and moves. Let go without a move —
before the swell or after it — and it is the click it always was: the section folds. Move
the pointer before the hold fires and the press is **dropped whole**, so a scroll or a drag
that starts on a header is never stolen.

**§13.1a — hold, then move (changed 2026-09-20, the owner's choice).** As first built, the
header lifted the moment the 400 ms ran out, with no move needed. A relaxed click is often
longer than 400 ms, so the section folded, lifted, unfolded on the release and swallowed
the click: in Playlists and Settings a fold click did nothing. Now the timer only ARMS the
header (the swell stays on while it is armed), and the lift waits for a move past the 6 px
threshold. `--hold-ms` is unchanged.

- The hold is one Settings row: **Window › Growing and drilling › Move sections by holding**
  (`moveSections`, default **on**). Off means no section anywhere can be moved, and no
  header carries the hint.
- 400 ms is the `--hold-ms` skin token. `row-order.ts holdMs()` READS that token, so the
  swell animation and the timer can never drift apart.
- A **pinned tile** has no header, and a tile press already carries its songs to another
  card. So a pinned tile grows its own **grip bar**: a rectangle over the left of the cover,
  72% of its height, three dots, shown on **hover or keyboard focus**. Press the bar to
  move the tile; press anywhere else and the tile is exactly what it was.

### 13.2 What moves, and where the order lives

| Scope in `row_order` | What it orders | Built-in order under it |
|---|---|---|
| `settings.sections` | the Settings card's sections | the `sections` array literal |
| `home.shelves` | Home's shelves, by `HomeShelf.id` | the push order in `homeShelves()` |
| `radio.sections` | Radio's Featured sections, by label | Recents · For You · Live · Genres |
| `playlists.sections` | folders and clusters, by `sectionKey` | folders A–Z, then the clusters |
| `playlists.folder:<key>` | the playlists inside ONE section | A–Z (`byName`) |
| `pins` | every pinned tile, on every shelf | pin time (newest first); on Home, plays |

**One table, `row_order(scope, id, rank)`, schema v13** (`src-tauri/src/roworder.rs`,
fork 4C). Three commands: `row_order_all` (one read at boot), `row_order_set` (replaces one
scope inside a transaction), `row_order_reset`. The table is also **exported to the
read-only SQL copy** (`query.rs`), so `select * from row_order` works from the agent and the
`query` MCP tool.

**The rank list holds only the ids you moved past.** An unranked id sorts LAST, in the
card's own built-in order (fork 3A) — `sortByOrder` is a stable sort over the caller's own
array, and that array IS the built-in order. A ranked id the render does not draw keeps its
rank for free, and `writeOrder` puts it back beside the neighbour it had, so a Home bucket
shelf that is hidden at 3 a.m. is not thrown to the end by a drag it took no part in.

### 13.3 What the primitive grew

`row-drag.ts`, all opt-in per `DragRow`, nothing existing changed:

| Field | What it does |
|---|---|
| `hold` | start on a timer, not on the 6 px threshold; any movement first drops the press |
| `measure` | measure each rendered child instead of assuming uniform, flush rows (sections are as tall as their rows) |
| `sel` | what a measured list's children are — pinned tiles use `[data-pin-idx]`, because the collection engine reads `[data-idx]` as a row of its own list |
| `axis: "x"` | a sideways shelf: an upright insertion line and sideways auto-scroll |
| `begin` | the drag really started — fork 5A folds the section here, before the ghost is copied |
| `done` | this row writes its own rank list instead of `onEnd` |

`.is-holding` is the swell (`--hold-swell`); on a Settings section it is the HEADER that
swells, not the whole block. Reduced motion drops it.

### 13.4 Per card

- **Settings** (`settings-card.ts`). Each section is a `<section data-idx>`; the list is the
  card body. The hold is on `[data-fold]`. A fold shut by the hold is restored on the drop,
  with `enterRows` as `toggleSection` does. **No move while the search field holds text**
  (§10.5), and no move with the row off.
- **Home** (`home-card.ts`, `home.ts`). `HomeShelf` gained the stable `id` §2 asked for, and
  each shelf is now one `<section class="home-shelf" data-idx>` — label and scroller move
  together. The hold is on `.search__label`. The Pinned shelf's tiles carry `data-pin-idx`
  and the grip.
- **Radio** and **Playlists** (through the engine). Sections are gathered into blocks and
  emitted in the user's order, so nothing else about `shelf()` changed. The engine grew one
  hook, `Context.holdDrag(row, index, list, view, rerender)`: the card answers with the drag
  a hold starts, and `rerender` is the re-render fork 5A needs DURING a drag (the engine's
  own `reload` defers while a drag runs). The engine also grew `Context.shelfDrag(target)`
  for the pinned tiles above the list — the three roots pass `pinDragRow`.
- **A playlist row** moves inside its OWN section and never out of it: the drop index is
  clamped to its section's rows. Moving between folders stays Move to Folder, which says
  what it does. A plain press and drag on a playlist row is untouched — it still carries
  the songs to another card and still drops onto another playlist row.
- **A drop index counts ROWS, not sections**, in the two engine cards. `sectionAt()` in
  `row-order.ts` converts one to the other by counting the headers that end up before it.

### 13.5 Reset

**Settings › Reset › Row order** — one row, under every group row, above Everything. It
asks first (`Put every row and section back in its built-in order?`), then a `success` toast
with a 6-second **Undo** that writes the whole snapshot back. It is not a settings key, so
it does not ride `RESET_GROUPS`; it has its own ask-confirm-undo in the same shape. The
Compass has one row, **Reset row order**, which opens that Settings row rather than firing
it, and it only appears when there is an order to drop.

### 13.6 The Settings search bar

A search button in the Settings header opens the `.lib-searchbar` field under it — the same
markup and the same slide every other card has. Typing filters **in place**: sections with
no match are hidden, the ones with a match are open, their matching rows keep their real
controls, and the header count shows the matches. The index is `settingsRows()`, the
Compass's own, so there is one list of settings. A row `when()` has gated off is never
matched. Clearing the field restores every fold exactly. The query is **not** remembered
across a remount (fork S4).

**Ctrl+F** opens the search field of the card you last pressed in — Settings, Library,
Playlists, Radio and Search (`src/find-key.ts`, fork S3 = 9B). With no press yet, one card
with a field takes it; with several, nothing happens rather than the wrong one opening. A
press inside a text box is left alone.

### 13.7 What it writes to the log

`diag.log("order:set", { scope, n, id, to, after })` on every committed move — the list, what
moved, and the id it now follows — and `order:reset` / `order:restore`. That is what makes a
"my Home is in the wrong order" report readable without guessing. A section move is its own
frame-telemetry scene: the label is `<card>-section`, so it is separable from a row move and
a cross-card copy.

### 13.8 Decided inside his forks, while building

Named here so nothing ships unseen:

1. The **Settings row sits in Window › Growing and drilling**, with the other card-shape
   gestures — not under Playback beside the pin rows.
2. The hover hint on every section header is one line: *"Click to open or close. Hold to
   move this section. New sections appear at the end."* It is absent while the row is off.
3. The grip bar's own hint is *"Drag to move this pinned item."*
4. `--tile-art` is a new skin token (96 px). The shelf tile's cover and width were two
   hardcoded `96px` values; the grip has to measure against that cover, so it became a token
   rather than a third copy of the number.
5. The grip is `.tile-grip`, in the **tile badge** family it sits opposite (same fill, same
   radius, same hover dim, same focus ring).
6. A move writes **no toast**. The screen already shows the result (TOASTS.md §5 gains only
   the Reset row).
7. `row_order` is exported to the `query` MCP copy. Fork 4C's stated advantage was that the
   agent can read it; leaving it out of the export would have made that untrue.
8. **Playlist rows also move by hold**, not by plain drag. A plain drag on a playlist row
   already means two things that matter (carry its songs to another card; drop onto another
   playlist row to add them). One rule for the card — hold to move, drag to copy — keeps
   both.
