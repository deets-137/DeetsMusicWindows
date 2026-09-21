---
status: shipped
shipped_in: 0.11.0
desk_test: passed 2026-09-20
sources: [src/pins.ts, src/home-card.ts, src/library-card.ts, src/playlists-card.ts, src/radio-card.ts, src-tauri/src/library.rs]
updated: 2026-09-20
---
# DeetsMusic — Pins

> **Status (2026-09-18): BUILT on branch `pins-for-days`, desk test §6 PASSED 2026-09-19.** Forks 1–9 decided
> by the owner; the Library mockup passed before code. §7 = as built.
> **§8 (2026-09-19): On Click — a per-pin verb (Play · Shuffle · Open) on a right-click row.
> Forks 1-7 decided by the owner; §8.2a (what verb a NEW pin starts with) is the one open
> fork — CLOSED 2026-09-20, §8.2a. NOT BUILT.**

**Terms used in this doc**
- **Pin** — one item you chose to keep in view: a playlist, a station, an album, an artist or
  a song. Search's *term* pins (a search you re-run) are a different thing and stay as they
  are in `search-card.ts`.
- **Pin key** — the item's identity string, the same one Home already uses for a tile and a
  hide: `playlist:<pid>`, `station:<id>`, `album:<albumKey>`, `artist:<name>`, `song:<trackId>`.
- **Tile shelf** — the sideways row of covers that Home and the artist view draw
  (`.search__label` + `.search__scroller` + `.search__tile`, HOME.md §1).
- **Pinned shelf** — a tile shelf of pins. One at the top of the Library, Playlists and Radio
  roots; one as the fifth shelf on Home.

---

## 1. What exists today (read 2026-09-18)

| Part | Where | What it gives Pins |
|---|---|---|
| Search term pins | `search-card.ts` (`PINS_KEY`, `loadPins`, `togglePin`, `ICON_PIN`) | The pin glyph and the word "Pinned". Nothing else is shared: terms are not items. |
| Tile shelf markup + CSS | `home-card.ts` (`tileHTML`, `shelfHTML`), `styles.css` `.search__tile*` | The whole shelf, as is. 96 px tiles, `--lib-tile-radius`, name + sub lines. |
| Engine shelf slot | `collection-card.ts` `Context.shelves / onShelf / shelfMenu` | The artist view draws its Featured / Your Playlists shelves through it. The three roots get their Pinned shelf the same way. |
| Home tile builders | `home.ts` (`songItem`, `albumItem`, `playlistItem`, `stationItem`, `artistItem`) | One `HomeItem` per pin kind, with art, sub line, tracks and the queue context tag. |
| Play log | `play_events(track_id, started_ts, context)` in `library.rs` | The play count per pin key: `context` for a container, `track_id` for a song. |
| Hide list | `homeHidden` in `settings-store.ts` | The shape a settings-store store would have had. Rejected (fork 1). |

Library's Songs list is windowed (`collection-window.ts`). A row section inside it (the
Playlists/Radio `mixed: true` header shape) is ruled out by the code. That is why the
Pinned block is a shelf on every card (fork 3).

## 2. Decisions (owner, 2026-09-18)

| # | Fork | Decision |
|---|---|---|
| 1 | Where pins live | **B — a SQLite table** `pins` in the library database. |
| 2 | What Library can pin | **A — albums, artists and songs.** |
| 3 | Shape in the cards | **A — one Pinned tile shelf** above the list on Library, Playlists and Radio, through the engine's shelf slot. Mockup before code. |
| 4 | Order | **B — pin order in the cards** (newest pin first, as Search does), **plays on Home.** Pins are comfort plays, not frequent ones; Home is a quick start. |
| 5 | The play window | **B — all time.** A window had no reason of its own; it was only the read the bucket shelf already makes. |
| 6 | The small icon | **A — a pin glyph in a corner of the tile art.** The glyph is Search's `ICON_PIN`, moved to one shared place. |
| 7 | The gesture | **A — right-click Pin / Unpin** on a row in each card and on any Home tile. A Compass `pin` verb. |
| 8 | The shelf's look in a card (owner, 2026-09-18, from the Library mockup) | **No "Pinned" label** in the three cards: the badge says it. **A hairline divider under the shelf** (`1px solid var(--border)`, the pill border's color). Everything under the divider stays pixel-identical to today. Home keeps its "Pinned" label like its other shelves. |
| 9 | Where the shelf sits in the card | **B — inside the scroll, above the Play / Shuffle row** (`shelvesFirst` on the engine's existing `shelves` slot). The shelf scrolls away with the list. A (a fixed slot above the toolbar) and C (the slot as is, under Play / Shuffle) were the other two. |

## 3. Data (Rust)

```sql
CREATE TABLE IF NOT EXISTS pins (
    key        TEXT PRIMARY KEY,   -- the pin key (see Terms)
    kind       TEXT NOT NULL,      -- playlist | station | album | artist | song
    pinned_at  INTEGER NOT NULL    -- ms since epoch; the card order (fork 4)
);
```

Migration **v9** (`migrate_v9`; v8 was `local_playlists.expire_days`, v7 the loudness table).
As built the row also carries **`data TEXT`**, a JSON snapshot for the kinds with no local
store: a station (Radio's caches are per session), a song and an album (so one pinned from
Search or from a phone play, off the library, still draws and plays; an album in the library
plays the library's full copy first). A playlist and an artist are built live from the
playlists cache and the track store, so a rename or a new cover shows at once. A pin whose
item is gone is skipped when drawing; a deleted playlist clears its own pin (`playlistDelete`).
There is no prune pass: a song or album that leaves the library keeps its pin (the snapshot,
or nothing to draw) until you unpin it.

**The order changed on 2026-09-20** ([MOVABLE-ROWS.md](MOVABLE-ROWS.md) §13, fork 12A): a
pinned tile can be **moved by hand**, with the grip bar on its cover, and that hand order wins
on every shelf — the three roots AND Home, which until then sorted its Pinned shelf by plays
(fork 4 above). The order is NOT a column on `pins`; it is the `row_order` table's `pins`
scope, so this table is unchanged. A pin never moved by hand is unranked and keeps the place
it always had — newest first on the roots, most played on Home — after the ones that were
placed.

Commands: `pins_list() -> Vec<Pin>` (newest first), `pin_set(key, kind, data)` (a re-pin
refreshes the snapshot and keeps its time), `pin_clear(key)`, `pin_play_counts(keys) ->
Vec<(key, n)>`. The count is one prepared statement per key over all time — `context = key`
for a container, `track_id = id` for a `song:` key. `play_events` has no index on `context`.
The table is thousands of rows, the read is one per Home build, and Home already reads the
whole log for the bucket shelf. No index. The agent's SQL sees `pins` as a sixth exported
table (LOCAL-DATA.md): `id`, `kind`, `pinned_at`.

**Why a table, not a settings key (1B).** The hide list is a settings key because a hide is
a preference that fades. A pin is a library object you look at every day, it joins the play
log, and the agent's read-only SQL (LOCAL-DATA.md) should see it as a table. The settings
pack does not carry it.

## 4. Front end

- `src/pins.ts` — the store: one in-memory `Map<key, Pin>` seeded from `pins_list` at boot,
  `isPinned(key)`, `togglePin(key, kind)`, `onPinsChange(cb)`, `pinMenuItem(key, kind)` (the
  one menu row every card adds), and `pinnedItems()` which resolves keys to `HomeItem`s
  through the Home builders. The glyph `ICON_PIN` moves here; Search and the grow bar import it.
- **The three roots** add `shelves: () => pinnedShelfHTML()` to their root `Context`, plus
  `onShelf` (a click plays or drills the tile, as Home does) and `shelfMenu` (Unpin, plus the
  kind's own Play / Queue rows). Order: `pinned_at` desc. The shelf is left out with no pins.
  Filter per card: Library shows album / artist / song pins; Playlists shows playlist pins;
  Radio shows station pins. Home shows all.
- **Home** adds `{ label: "Pinned", items }` as the fifth shelf, ordered by the count from
  `pin_play_counts`, ties by `pinned_at`. Capped at `SHELF` (12) like the others. A pinned
  tile's right-click reads **Unpin** where the others read **Hide**; a pin is never hidden.
- **The badge (6A).** The tile art gets a corner square holding the glyph. This is a new
  control family, *tile badge*: an icon square cut to the tile's radius, on the surface
  color, `--icon-sm` glyph, `--space-1` inset, top-right. Tokens: `--tile-badge-size`,
  `--tile-badge-inset`, `--tile-badge-radius: var(--lib-tile-radius)` (skin base; a skin
  overrides only what it changes). Color: `--surface` fill, `--title` glyph. Ocean's "Draw
  card edges" and Glass frost do not touch it.
- **Menus.** `pinMenuItem` goes into: the playlist row menu and the Home playlist tile menu,
  the station row menu (both Radio roots) and the Home station tile menu, the Library album,
  artist and song row menus (root and detail levels), the Home album / artist / song tile menu,
  and the Now Playing cover menu for the playing song. The label is `Pin` or `Unpin`.
- **Compass.** One verb row: `pin` / `unpin` acting on the playing song, plus the
  card rows are automatic (COMPASS.md §9).
- **Agent.** `pins` is readable through `query` (LOCAL-DATA.md) as a table. No write route
  in build 1.

## 5. Checklist (CLAUDE.md › Working style)

1. Motion: the shelf is the Home shelf; the first fill's `enterRows` slide applies through the
   engine as it does for the artist shelves. The badge has no motion.
2. Tokens: three new tile-badge tokens in `skin.css` base; color roles reused.
2a. Family: **tile badge** (new). Recorded in UI-ARCHITECTURE.md §2a with this doc.
3. Hints: the badge carries no `title` (the tile's own title stands). The menu row needs none.
4. Toasts: none. A pin is visible at once.
5. Settings keys: none.
6. Log lines: `pin:set` / `pin:clear` with the key.
6a. Scrollbars: the shelf is `.search__scroller`, already styled.
7. Telemetry: none new.
8. Check: `npx tsc --noEmit`, `npx vite build`, `cargo test --lib`.
9. Compass: the verb row.

## 6. Desk test (after build) — PASSED 2026-09-19

1. Playlists › right-click a playlist › **Pin**. A Pinned shelf appears above Folders with the
   badge on the tile. Right-click the tile › **Unpin**: the shelf goes.
2. Radio › pin a station; Library › pin an album, an artist and a song. Each card shows only
   its own kinds.
3. Home shows a fifth shelf, Pinned, with all of them. Play one twice. Refresh Home: it leads.
4. Right-click a Home Pinned tile: **Unpin**, no Hide.
5. Pin two playlists; the card shelf shows the newer first, whatever their plays.
6. Delete a pinned playlist. The tile is gone from every shelf; after a sync `pins` has no row.
7. Restart the app: pins persist. Ctrl+Space `pin` pins the playing song.
8. Every skin: the badge sits inside the art's radius. Reduced motion changes nothing.

## 7. As built (2026-09-18)

| Piece | Where |
|---|---|
| The table, `migrate_v9`, the four commands | [`library.rs`](../../src-tauri/src/library.rs) (`Pin`, `pins_list`, `pin_set`, `pin_clear`, `pin_play_counts`); registered in `lib.rs` |
| The SQL export | `query.rs` — `pins` in `BUILD` and in `TABLES`; the fixture and `reads_the_exported_tables` cover it |
| The store, the glyph, the menu rows, the shelf | [`src/pins.ts`](../../src/pins.ts) — `initPins` (main.ts, beside `initFavorites`), `isPinned`, `togglePin`, `pinItem`, `pinItemFor`, `pinnedShelfHTML`, `pinShelfItem`, `pinBadgeHTML`, `ICON_PIN` |
| The engine flag | `shelvesFirst` on `Context` in `collection-card.ts`: the shelves go before the Play / Shuffle row |
| The three roots | `rootContext` in `library-card.ts` (albums · artists · songs; an album or artist tile drills, a song plays), `playlists-card.ts` (a tile opens the playlist), `radio-card.ts` (a tile plays). Each reloads on `onPinsChange` |
| Home | `pinnedShelf()` in `home.ts`, fifth; `home-card.ts` draws the badge on any pinned tile, drops Hide for a pin, rebuilds on `onPinsChange` |
| The song menu | `trackMenu` in `library-card.ts` ends with `pinItemFor(items, context)`: `album:` / `artist:` context → that container, one song → the song, else no row |
| The other menus | the playlist row (`listMenu`), the station row (`stationMenu`, with the station as the snapshot), the Home station / playlist tiles, the Now Playing cover (`npMenu`) |
| Compass | "Pin this song" / "Unpin this song" in `actions()` (`compass.ts`), aliases pin · unpin · pinned |
| The glyph | one `ICON_PIN` in pins.ts; `search-card.ts` and `card-grow.ts` import it |
| Tokens | `--tile-badge-size` 20px · `--tile-badge-inset` (`--space-1`) · `--tile-badge-radius` (`--lib-tile-radius`) in skin.css base; TOKENS.md regenerated |
| CSS | `.search__tile` is now `position: relative`; `.search__tile-badge`; `.lib-shelves--pins` = the hairline + `--space-2` under it |
| Docs | ONBOARDING.md §2 (two rows), UI-ARCHITECTURE.md §2a (the tile badge family), LOCAL-DATA.md (the table), COMPASS-TERMS.md §3 |

Decided while building, inside the owner's choices:
- **A song pin and an album pin carry a snapshot** (`data`: the song, or the album's songs as
  the tile knew them), so one off the library still draws and plays; a station does the same.
  A playlist and an artist do not. Fixed the same day: the first cut left albums out, and an
  EP played on the phone pinned but never drew.
- **No prune pass.** A deleted playlist clears its pin in `playlistDelete`; anything else stays
  pinned until unpinned, and simply does not draw while its item is missing.
- **A card's shelf tile acts like that card's row**: Library album / artist tiles drill, a
  Playlists tile opens the playlist, a Radio tile plays, a song plays. Home tiles all play.
- **An album off the library plays whole** (owner, 2026-09-18: "pins are not the library").
  `HomeItem.whole` (home.ts `wholeAlbum`): one song→album hop (`catalogRelated`) and the
  catalog album (`collectionTracks`), both memoized for the session, the songs made playable
  as a Search pane makes them. A press on the tile, its Play Now / Next / Add to Queue rows,
  and the Library shelf tile all use it. This also fixes an older Home limit: a Recently
  Played album tile for a phone play used to play only the songs the phone played. The pin's
  snapshot stays the songs the tile knew; the fetch runs at the press.
- **Why JSON in the pin row**: the house pattern. `tracks.json`, the playlist track tables and
  the web tables all keep the front-end model as one JSON TEXT column beside the real columns
  SQL needs (ids, positions, times), so the schema never chases the model
  (DATA-ARCHITECTURE.md §tracks). A pin's `data` is the same idea.
- **Pin / Unpin is the last row** of every menu, after ♥. On Home a pinned tile has no Hide row.
- **The song menu derives the pin from its context tag**: a Library album tile's menu pins the
  album, an artist tile's pins the artist. A genre list, a picked set and a playlist's rows get
  no pin row — nothing to name.
- **Pinning again refreshes the snapshot but keeps the time**, so a re-pin does not jump to the
  front of the card's shelf.
- **The Compass row acts on the playing song only** — the cards' own rows are automatic.
- **A pin's shelf tile hint is the item's title** (`title`), as a Home tile's is.
- **The badge is a button** (owner, 2026-09-18: a mark that looks pressable must be): a press
  unpins, and `handleUnpin` runs first in every click listener over tiles (home-card.ts, the
  engine) so the tile's own press does not fire. Hover and focus copy the icon square.
- **Artists pin from four more places** (owner, 2026-09-18): the Library artist view's cover
  (the engine's cover menu), a Search artist row, the Search artist pane's hero, and the Home
  artist tile. An artist pin carries a snapshot (name, photo, catalog id); off the library the
  tile draws from it and a press plays Apple's top songs for them (`artistDetail`, memoized).

---

## 8. What a click on a pin does — On Click (designed 2026-09-19, **BUILT 2026-09-20**)

> **§8.7 is as built, and the desk test in §8.6 PASSED 2026-09-20.** This section — and this section will need a pass
> once it has been run: see §8.8.

**The idea (owner, 2026-09-19):** a settings item that says what a click on a pinned tile
does — **play**, **shuffle** or **open** the album, playlist, artist or station.

**Terms added here**
- **Open** — go to the item's own view: the album detail, the playlist detail, the artist
  view. It starts no sound.
- **Play** — start the item from its first song, in its own order.
- **Shuffle** — start the item from a shuffled copy of its songs.

### 8.1 What a click does today (read from the code, 2026-09-19)

| Where | Pin kind | The click today | Code |
|---|---|---|---|
| Library root | album (in the library) | **opens** the album detail | `pinShelfOpen`, [`library-card.ts:1140`](../../src/library-card.ts) |
| Library root | album (off the library) | **plays** whole (`it.whole()` → `playList`) | same |
| Library root | artist | **opens** the artist view (`drillArtist`) | same |
| Library root | song | **plays** | same |
| Playlists root | playlist | **opens** the playlist (`card.drill(detail)`) | [`playlists-card.ts:752`](../../src/playlists-card.ts) |
| Radio root | station | **plays** (`startStation`) | [`radio-card.ts:224`](../../src/radio-card.ts) |
| Home › Pinned | every kind | **plays** (`activate`) | [`home-card.ts:153`](../../src/home-card.ts) |

So there are already two rules in the app, and they disagree: a card's pin tile copies that
card's own row, and a Home tile always plays. The rule was decided in §7 ("A card's shelf tile
acts like that card's row"). This section can keep that rule as the default and let the setting
override it, or replace it.

Three more facts the code fixes:
1. **A song pin has no Open and no Shuffle.** One song plays. Whatever the setting says, a
   song pin plays.
2. **A station pin has no Open.** Radio has no station detail view; a station is a stream,
   and Apple shuffles it, not us. Whatever the setting says, a station plays.
3. **Shuffle already has a house rule.** The card Play / Shuffle row shuffles a copy of the
   list, and with `shuffleStays` on, Shuffle also turns the shuffle MODE on, as Apple does
   (`collection-card.ts:242`). A pin's Shuffle must do the same thing, or one gesture means
   two things in one app. There is no "shuffle this list" helper yet: it is
   `playTracks(shuffleInPlace([...ts]), 0, ctx)` plus the mode call.

### 8.2 Decisions (owner, 2026-09-19)

| # | Fork | Decision |
|---|---|---|
| 1 | How many settings items | **C — per pin, a right-click row on the tile.** Each pin carries its own verb. A Settings row sets the verb NEW pins start with (fork 7). |
| 2 | What it covers | **A — pinned tiles only.** Home's other shelves and the artist view's shelves are untouched. |
| 3 | The values | **A — the three verbs only: Play · Shuffle · Open.** "As the card does" is dropped. (It was a fourth value meaning "keep what this card does today", so nobody who never opened the menu saw a change; with a per-pin row it is dead weight — the row must read as three plain verbs.) |
| 4 | Home too | **A — yes.** One pin, one verb, in all four Pinned shelves. |
| 5 | Songs and stations | **They play.** A song has one song; a station is a stream Apple shuffles. Their row is not offered; the hint says *Played on click*. |
| 6 | How to play when the verb is Open | **A — the right-click menu.** It already carries Play Now / Shuffle / Add to Queue. No hover badge, no modifier click. |
| 7 | Where the Settings row sits | **Playback.** |

**Wording (owner, 2026-09-19):** the menu row is **On Click**.

### 8.2a CLOSED 2026-09-20 — C, per kind

**The owner's words:** *"New pin starts with play for songs / radios and open for albums /
playlists by default."* That is **C**, and it agrees with fork 5 — a song and a station play,
and they are not offered the row at all. An **artist** is not named in his answer; it takes
**Open**, with the albums and playlists it sits beside, because opening the artist view is
what all three cards do today.

| Pin kind | Starts with | Has an On Click row |
|---|---|---|
| song | **Play** | no (fork 5 — the hint says *Played on click*) |
| station | **Play** | no (fork 5) |
| album | **Open** | yes |
| playlist | **Open** | yes |
| artist | **Open** | yes |

So `pins.act` is `NULL` for every pin that exists on update day, and `NULL` means "the card's
rule", which is the table above. **Nothing visibly changes when this ships** — which is the
reason C was the recommendation.

**And the smaller question that rode on it:** the Settings row changes **only new pins**. His
wording settles it — *"new pin starts with"*. A verb set by hand on a tile is never overwritten
by a Settings row, and a pin never set reads its card's rule for ever. The row is honestly
**New pins open on click**, which is the label §8.3 already uses.

**Status: BUILT 2026-09-20.** Every fork in §8 was closed first. It was built the same day
as playlist refresh at the owner's instruction, so **two schema migrations (v11 and v12) share
one untested tree** — the case the one-load-bearing-feature rule warns about. It is written
down here so that, if a desk test goes wrong, the first question asked is *which of the two*.

### 8.2a-old The fork as it was asked (kept as the record)

**What verb does a NEW pin start with?** The per-pin row needs a starting value, and the
Settings row (fork 7) is what sets it.

- **A. `Open`.** What the three cards do today for an album, an artist and a playlist. A pin
  made today and a pin made after this ships behave the same.
- **B. `Play`.** What Home does today, and what "pin" suggests: the thing you keep in view
  because you play it.
- **C. Per kind**: album and playlist `Open`, artist `Open`, everything else `Play` — i.e.
  each card's own rule, frozen as the starting value, so nothing visibly changes on the day
  this ships.
- *Recommendation:* **C.** It is the only one where existing pins do not silently change verb
  on update day, and the user who wants Play sets it per pin, which is the whole point of 1C.

A second, smaller question rides on the answer: **does the Settings row change pins that
already exist, or only new ones?** Recommended: **only new ones** — a per-pin verb the user
set by hand must not be overwritten by a Settings row, and a pin that was never set reads its
card's rule (C above) forever. That makes the Settings row honestly "New pins open / play /
shuffle", which is the label §8.3 uses.

### 8.3 What it looks like

**On the tile (the per-pin row).** Right-click any pinned tile, or any pinned row in the three
cards. A new row **On Click**, holding the three verbs with the current one marked:

> Play · Shuffle · Open

Placement: above Pin / Unpin, which stays the last row of every menu (§7). It is offered for
**playlist, album and artist** pins only — see 8.2
fork 5: a `song:` and a `station:` pin get no On Click row.

**In Settings › Playback**, one choice row under "Play Now plays":

> **New pins open on click** — `Open` · `Play` · `Shuffle`
> Hint: *The verb a new pin starts with. Change any pin with its own On Click row. Songs and stations are played on click.*

(The row's label follows 8.2a: it names NEW pins, because it never touches a pin you set.)

### 8.4 How it is built

- **Storage: the `pins` row, not a settings key.** The verb belongs to the pin, and the pin is
  a row (§3, fork 1B). Add a nullable column: `ALTER TABLE pins ADD COLUMN act TEXT` in a new
  migration **v12** (v10 is Song of the Day, and v11 became `playlist_refresh` on 2026-09-20); `NULL` = never set = the card's rule (8.2a C). `pin_set` keeps an existing
  `act` on a re-pin, exactly as it keeps `pinned_at` (§7). A new command `pin_act(key, act)`
  writes it; `Pin` gains `act: Option<String>`. `query.rs` exports the column so the agent's
  SQL sees it (LOCAL-DATA.md), and `TABLES` gains the `act` line.
- **One resolver.** `pinAct(key, kind): "play" | "shuffle" | "open"` in `src/pins.ts` — the
  pin's `act`, else the new-pin default from settings if the key was made after it, else the
  card rule. Every shelf calls one new `pinActivate(it, nav)` that replaces the four
  hand-written `onShelf` bodies ([`library-card.ts:1140`](../../src/library-card.ts),
  [`playlists-card.ts:752`](../../src/playlists-card.ts), [`radio-card.ts:224`](../../src/radio-card.ts),
  `activate` in [`home-card.ts:153`](../../src/home-card.ts)).
- **Open, off Home.** Home has no Library card of its own to drill into; an `Open` on a Home
  pinned tile must hop to the card that holds the item, as Home's playlist tile already does
  with its "Open in Playlists" row ([`home-card.ts`](../../src/home-card.ts), `menuFor`). An album
  or artist pin opens the Library card at that detail, a playlist pin opens the Playlists card.
  A pin off the library has no detail view: it **plays** (the §7 `whole` path), the same
  exception the Library shelf already makes.
- **Shuffle** follows the house rule (8.1 fact 3): a shuffled copy through
  `playTracks(shuffleInPlace([...ts]), 0, ctx)`, and with `shuffleStays` on it turns the
  shuffle mode on, as the card's Shuffle button does (`collection-card.ts:242`).
- **The menu row.** `pinActItem(key, kind)` in `pins.ts`, beside `pinItem`, so every menu adds
  one call: the playlist row, the Library album / artist row menus, and the four shelves' own
  `shelfMenu`. It is left out when the key is not pinned, and for `song:` / `station:` keys.
- **Settings key** `pinNewAct` in `settings-store.ts`, default per 8.2a, with its spec in
  `agent-settings.ts` (`storeChoice("Playback", "pinNewAct", "New pins open on click", …)`) and
  a line in AGENT.md. Compass reaches it for free (COMPASS.md §9).
- **Log line:** `diag.log("ui:act", { at: <card>, do: "pin", kind, act })` at the click, and
  `pin:act` with the key when the menu row changes it — so a complaint about it is read, not
  guessed (CLAUDE.md › a complaint is read).

### 8.5 Checklist (CLAUDE.md › Working style)

1. Motion: none new — the click already drills or plays; the menu row is a menu row.
2. Tokens: none new.
2a. Family: the **menu row** (the pin rows' own family) and the Settings **choice row**. No
    new control.
3. Hints: the Settings row's hint (8.3). The tile's `title` stays the item's name — the verb
   does not go in it. One ONBOARDING.md ledger row for the Settings hint; the On Click row is
   a new SHAPES entry (a menu row with three values).
4. Toasts: none. The next click shows the change.
5. Settings keys: `pinNewAct` — default with its why, the agent spec, the AGENT.md line.
6. Log lines: the two above.
6a. Scrollbars: nothing new scrolls. (The pin menus gain one row; they are already `app-scroll`.)
7. Telemetry: none new.
8. Check: `npx tsc --noEmit`, `npx vite build`, `cargo test --lib query`.
9. Compass: the Settings row is automatic; no new verb row.


### 8.6 Desk test — **PASSED 2026-09-20**

1. Pin an album in Library. Right-click the tile: **On Click** shows three verbs, with the
   current one marked. §6's desk test still passes unchanged.
2. Set the album to **Play**: the tile plays instead of drilling. Set **Shuffle**: it starts
   on a song that is not track 1, twice out of three; with "Shuffle button stays on", the
   toolbar Shuffle is lit after it. Set **Open**: it drills again.
3. The same pin on **Home** obeys the same verb. `Open` on Home hops to the Library card at
   the album.
4. A pinned **playlist** set to Play plays; set to Open it drills, from both Playlists and Home.
5. A pinned **song** and a pinned **station** have no On Click row and still play.
6. A pinned album **off the library** set to Open: it plays whole (no detail view), no error
   in the log.
7. Re-pin an item that has a verb set: the verb holds, and so does its shelf position (§7).
8. Settings › Playback › **New pins open on click** = Play. An OLD pin keeps its verb; a
   pin made after it starts on Play.
9. Restart the app: every per-pin verb holds (`pins.act`). The agent's `query` over `pins`
   reads the `act` column.
10. Unpin and re-pin from scratch: the verb is the Settings default again.

### 8.7 As built (2026-09-20)

| Piece | What it is |
|---|---|
| `migrate_v12` (`library.rs`) | `ALTER TABLE pins ADD COLUMN act TEXT`. Additive and idempotent. **v12, not the v10 the design said** — v10 is Song of the Day and v11 became `playlist_refresh` the same day |
| `pin_set(…, act)` | The verb a NEW row starts with. `ON CONFLICT` does **not** touch `act`, so a verb set by hand survives a re-pin exactly as `pinned_at` does (§8.6 step 7) |
| `pin_act(key, act)` | Sets the verb. An unknown key is a no-op, not an error: the tile can be unpinned from another surface while the menu is open |
| `query.rs` | The `pins` export carries `act`, so the agent's SQL sees it. The `TABLES` fixture and its test moved with it (`cargo test --lib query`: 9 passed) |
| `pinAct(key, kind)` | The one resolver: the pin's verb, else `open` — which is what every album, playlist and artist pin did before this shipped |
| `pinActivate(it, at, nav?)` | **The one click rule.** It replaced the four hand-written shelf bodies that had drifted into two different answers (§8.1). A card that can open a kind in place passes a handler; a card that cannot leaves it out and the hop takes over |
| `pinRows` · `pinArtistRows` · `pinRowsFor` | Each returns **On Click** (when the pin is one that is asked) followed by Pin / Unpin, which stays the last row of every menu |
| `pinNewAct` | Settings › Playback › **New pins open on click**, default **Open**. Stamped onto the row at pin time, so it can never reach a pin that already exists |

**Decided inside his choice:**

1. **The Settings default is stamped at pin time, not read at click time.** It is the only
   shape where *"a verb you set by hand is yours for ever"* and *"a pin made after the setting
   changed starts on the new verb"* are both true, and it needs no "when was this pin made"
   comparison anywhere.
2. **`requestLibraryDrill` already existed** (`layout-bus.ts`) and does exactly what §8.4's
   hop describes, including summoning the card. I wrote a second bus in `go-to.ts` before
   finding it, and deleted it. Home's Open on an album or artist pin uses the existing one;
   its playlist pin uses `requestOpenPlaylist`, as its own menu row already did.
3. **Shuffle goes through `runListAction`** (`collection-card.ts`), the card Shuffle button's
   own helper — so "Shuffle button stays on" behaves identically from a pin and from a card,
   which §8.1 fact 3 asked for without naming the helper.
4. **A station still routes through `pinActivate`** although it can only play. One click path
   means one `ui:act` line on all four shelves, and the log is what a complaint is read from.
5. **`pinNewAct` and `playlistAutoRefresh` were both added to `RESET_GROUPS`** — Playback and
   Playlists. Nothing checks that a new key is in a reset group, and the refresh key had
   already been missed once that day.

### 8.8 After the desk test — the doc pass this section still needs

**Written down on 2026-09-20, at the owner's instruction; settled the same day.** §8.6 was run
and **PASSED 2026-09-20** — the owner confirmed it with the three other features of that day.
Nothing in the build changed as a result, so §8.7 stands exactly as written.

- ~~Mark §8.6 **PASSED** with the date~~ — done.
- If anything changes in the build, **§8.7 is the table that must change with it** — it is the
  record of what is true, not of what was intended.
- §8.1's table ("what a click does today") is now **history**: it describes the four drifted
  bodies that `pinActivate` replaced. Leave it, but it should say so once the test passes.
- Check the two migrations against each other. `pins.act` (v12) and `playlist_refresh` (v11)
  shipped in one tree; the desk test is the first time both run on a real database.
