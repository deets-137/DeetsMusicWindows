---
status: shipped
shipped_in: 0.9.5
desk_test: passed 2026-09-19
sources: [src/compass.ts, src/styles/compass.css, src/compass-math.ts, src/list-keys.ts, src/styles/skin.css, src/main.ts]
updated: 2026-09-20
---
# Compass — go anywhere from the keyboard

> **Ctrl+Space** opens a bar under the title bar, in every surface. Type a few letters and
> the bar lists the places, settings, actions and library items that match. Enter goes
> there. Designed and built 2026-09-17 (`src/compass.ts`, `src/styles/compass.css`).

**Terms used in this doc**
- **The bar:** the panel Ctrl+Space opens. It hangs from the title bar, over the cards.
- **A result:** one row in the bar. Each result has an owner: the card, the Settings row,
  the player, or the song it stands for.
- **The owner:** the part of the app that already holds the thing (VALUES.md §4.1). The bar
  never copies a panel; it sends the user to the owner.
- **Inline row:** a Settings result with its own control in the bar, so a toggle or a
  choice changes without leaving the bar.
- **The index:** the list the bar searches. It is built from the app's own registries and
  the in-memory library; no Apple calls.

## 1. Decisions (2026-09-17, the owner's picks)

| # | Fork | Pick |
|---|---|---|
| 1 | Shape | **A.** A panel that drops from the title bar over the window, any surface. Not a card in a slot: mini's NP view has no slot, and Max's Fill covers the cards. |
| 2 | Apple catalog | **A.** Local only while typing. The last row hands the term to the Search card: "Search Apple Music for …". Zero Apple calls from the bar. |
| 3 | Depth of a result | **A + B.** Enter goes to the owner. A Settings row whose value lives in the settings store also renders its control in the bar (toggle: on/off; choice of up to three: the split pill). Rows held in Rust, split rows, sliders and actions jump to the Settings card at the row. |
| 4 | Discovery | **A**, then moved the same day: the compass icon sits in the **title bar, right of the title**, alone, with the hint "Go anywhere! (Ctrl + Space)". Plus a Tips entry. (The first build put it in the title menu as a row; the owner asked for the title bar.) |
| 5 | Scope | **B.** The bar, plus **Space** for play / pause and **Enter / Space** on the Search card's rows. |

### Decided alone (VALUES.md §3)

| Fork | Options | Pick | Value |
|---|---|---|---|
| The feature's name | "Nav bar", "Go anywhere", "Compass" | **Compass** in the docs and the code; the menu row says **Go anywhere**. The icon is a compass. | §4.9 fun at no cost; the user reads "Go anywhere", the plain words. |
| A second key | Ctrl+Space only; Ctrl+Space + Ctrl+Shift+Space | **Both.** An East Asian IME on Windows takes Ctrl+Space for itself. | §4.4 stewardship: the key must work on every PC. |
| Data rows: what Enter does | Play; Open the owner | **Open** the owner (a song opens its album in the Library; an album or artist opens in the Library; a playlist opens in Playlists; a station plays, it has no page). **Ctrl+Enter plays** a song, album, artist or playlist. Each data row shows both as a split pill. | §4.5: a control lives in one place; the bar only sends. §4.7a: power (Play) is one key away. |
| The Settings index | A static list in the bar; the card's own rows | **The card's own rows.** `settingsRows()` in settings-card.ts builds the sections once, inert (no Rust reads, no listeners, no render). | §4.1: the owner holds the fact. |
| Empty bar | Nothing; the places | **The places** (every card, in the registry's order), then the actions. A first press shows what the bar can do. | Anthropologists (TASTE.md): a new place is warm, not blank. |
| Result cap | All matches; a cap per group | **6 per group**, 40 in all; the first rows are the best matches by a word-prefix score. | §4.7: a long list is bulk. |
| Stations | Apple's live list; the recents | **The recents only** (`radioRecents()`), so the bar makes no call. | §4.3. |
| Focus after close | Stays in the bar's host; goes back | **Goes back** to the element that had it before Ctrl+Space. | The keyboard pass's own rule (HANDOFF "polished keyboard control"). |
| The web command's end | Open the panel with the web built, the user presses Make; make it | **Make it.** The command names its terms; the panel opens and shows the motion, so the user sees what was made. | §4.7a: the user asked for the result, not a form. |
| The station calls' moment | On open; on the first term | **On the first term.** A bar opened for a card never pays. | §4.3. |
| Speakers | Scan from the bar; the ones already found | **Scan once per session on a speaker-shaped term**, then "Look for speakers again" (changed 2026-09-17 from "already found only": the owner wanted the others listed; the scan is local, no provider cost). | §4.7a; §4.3 holds (no Apple call). |
| Close on outside click | Always; a setting | **A setting, default on** (`compassCloseAway`, Window). | The owner's call; §5 a choice of taste gets a row. |
| `queue` with no position | Next; the end | **Next.** | The queue's own Play Next is the common verb. |
| Result order | Fixed group order; by best match | **By best match**, ties in the fixed order; an exact name scores above "starts with"; the on-screen card's kind gets +0.25. | The owner's "replay" case (2026-09-17); §4.7. |
| Rows per group in Mini | Six; three | **Three** (the owner's number); Midi 6 / 8, Max 6 / 12. | §4.7: bulk. |
| `grow` shapes | Always three; the surface's own | **The surface's own** (Midi: Horizontal; Max: all three). A shape the card cannot take is not offered. | §4.5: a control with nothing to act on is not shown here, since the pill is the command's. |

Desk-test steps for each row are in §7.

## 2. What the bar shows

The bar has one text field at the top and groups of rows under it. The groups, in order:

| Group | Rows | Enter | Ctrl+Enter |
|---|---|---|---|
| **Places** | Every card in the registry but Now Playing (it is always on screen); Rewind only while its gate is on. Then the four surfaces (Mini, Player, Midi, Max), the six themes, the four skins, Sound, Sleep timer, Quick settings (2026-09-20). | `requestCard`, `applySurface`, `applyTheme` / `applySkin` under the appearance transition, or the Sound / Sleep / quick panel opens. | — |
| **Settings** | Every Settings row (label, its section as the second line, its hint on hover). `when` rows show only while they apply (skin rows). Store-backed rows are inline (§3). | Inline: the toggle flips, or the highlighted option applies. Others: the Settings card opens at the row (`requestSetting`). | — |
| **Actions** | Play / Pause (the label follows the state), Next song, Previous song, Shuffle on/off, Repeat (off › all › one), Mute / Unmute, Sleep in 15 · 30 · 45 · 60 min, Sleep timer off. | Runs it. The bar closes. | — |
| **Sound** | The equalizer presets: built-in, Custom, yours; the one in force says On. | Selects it (`selectPreset`, the per-output memory included). | — |
| **Up Next** | The queue, in order. | Jumps there. | — |
| **Recently Played** | This session's plays, newest first, each song once. | Plays it again. | — |
| **Speakers** | The AirPlay speakers on the network. The first speaker-shaped term of the session (airplay, speaker, play on, homepod) runs the Play on panel's own scan (the local network, no Apple; a few seconds); until then the last speaker used. "Look for speakers again" rescans. | Plays on it. | — |
| **Songs** | Library songs by title and artist. | Opens the album in the Library. | Plays the song. |
| **Albums** | Library albums by name and artist. | Opens the album in the Library. | Plays the album in track order. |
| **Artists** | Library artists by name. | Opens the artist in the Library. | Plays every song by them in the library. |
| **Genres** | The library's genres (a song's first genre, as the Library's Genres view groups them). | Opens the genre in the Library (§8). | Plays the genre's songs in artist order. |
| **Playlists** | Local and Apple playlists by name. | Opens it in Playlists. | Plays it. |
| **Stations** | The stations played before (recents). | Plays it. | — |
| **Apple Music** | One row: "Search Apple Music for *term*". | The Search card opens with the term. | — |

With no text: Places, then Actions. A group with no match is not drawn.

### 2a. The filter row (added the same day, the owner's ask)

"jhene aiko" listed six songs, six albums, then the artist: three presses to reach the one
row wanted. So with a term, the library shows **one kind at a time**, twelve rows, under a
**filter row**: a pill of the kinds that have a match (Songs, Albums, Artists, Genres,
Playlists, Stations), each with its count, drawn **right above the library rows** (under any
Settings or Actions matches: those are not what it filters). The shown kind is **predicted**:
the kind with the best match; a tie goes to Artists, then Albums, Genres, Playlists, Songs,
Stations. **Tab** moves to the
next kind, **Shift+Tab** to the one before, and the highlight goes to that kind's first row;
a click on a chip does the same. A new letter predicts again. Places, Settings and Actions
matches (six each) still come first; they are usually none. The Apple Music row stays last.

Stations: the ones played before (recents), your station, the Discovery station, Apple's
live list, and the **genre stations on demand**: each genre Apple lists has a row ("Jazz
stations"); Enter reads that genre's stations (one call, once per session, the Radio card's
own cache) and the bar lists them in place. A genre the Radio card already read lists at
once. **The bar reads them once per session, the first time a term is typed**: the same
four calls the Radio card makes (live, my station, Discovery, genres), into the same caches,
so a Radio card opened after costs nothing (the owner's ask, 2026-09-17). A bar used only
for cards or settings never makes them. Genre stations (one call per genre) are not read;
the ones the Radio card already read show (`radioGenreStationsPeek`).

### 2c. How a card opens: the shape (2026-09-18, the owner's ask)

A card row opens the card. **How much room it takes** is a shape on the same row, so there
is one row for one act (§4.1) and no second place to learn.

Two ways to pick it:
- **A word before or after the card's name.** `full settings` and `settings full` are the
  same. The words are in COMPASS-TERMS.md §1a: **card / normal / open / plain**,
  **horizontal / wide / side / across / half**, **vertical / tall / upright**,
  **full / fill / whole / big / huge**. A prefix of three letters or more that reaches one
  shape counts (`hor`, `vert`, `ful`). The word is split off the term for the **card rows
  only**; the split stands only when what is left still finds a card, so the song *Wide
  Awake* is still reachable.
- **The pill and Tab.** The **highlighted** card row carries the pill; the other rows keep
  their key hint (Ctrl+K, Ctrl+L…). Both are in the DOM and CSS picks, so moving the
  highlight costs no re-render. **Tab** moves between the shapes (on a row with its own
  options, Tab is the row's, not the filter row's — the filter row's chips are still
  clickable). Tab beats a typed word: the typed shape is where Tab starts.

The shapes this window has: **Max** Card · Horizontal · Vertical · Full; **Midi** Card ·
Horizontal; **Mini** Card alone (no pill). A word this window does not have takes the
nearest one and the second line says why ("Card · Horizontal · Midi grows sideways only").

**The pick is not remembered.** `shapeTab` is cleared each time the bar opens, so an Enter on
a card row opens the card at rest unless this opening said otherwise (§4.8). The `grow`
command keeps its own remembered pick (`deets.compass.grow`); it is unchanged, and now runs
through the same `openCard` helper.

**The keys the rows print answer inside the bar too** (2026-09-18). `main.ts`'s global
handler ignores every Ctrl key while a text field has the focus, and the bar's field is one —
so a row printed "Ctrl+L" and then swallowed it. The bar's own handler now reads the same
list (`CARD_KEYS`, exported from compass.ts and imported by main.ts, so there is one list)
and runs that card in this opening's shape, exactly as Enter on its row would.

The grow itself is `card-grow.ts`: the card is brought in first (`requestCard`), and the
grow runs the next frame, when its host has a slot.

**The CLI is not touched.** `deetsmusic go` reads the card rows in their plain form
(`places(true, null, true)`): its rows always say "Card", and growing from the CLI stays
`deetsmusic grow`.

### 2d. The calculator (2026-09-18, the owner's ask)

Type a sum into the bar and the first row is the answer: `1+1` shows **`1 + 1 = 2`** under
an **Answer** header, with an equals sign in the row's square. **Enter copies the answer**
(the plain digits) and **the bar stays open**, so the next sum follows the last. The row has
no second line: the sum and its answer are the whole row. Nothing is stored, and no Apple
call is made. The engine is `src/compass-math.ts` — a tokenizer and a recursive-descent
parser, about 200 lines. There is no `eval`, so nothing a user types can run as code.

**Keep it out of the release notes** (the owner's call, 2026-09-18). It is documented here
and in COMPASS-TERMS.md so it is supported and supportable, but no entry in
[RELEASE-NOTES.md](../ops/RELEASE-NOTES.md) announces it: the point is that you find it yourself.

**When a row appears.** The bar is a search box first, so the grammar is strict:

- The **whole** term must parse as a sum. Anything left over kills the row.
- Every name must be a function or a constant this file knows. `Blink-182` gives no row,
  because "Blink" is not a number or a name.
- The sum must hold at least one **operator or function call**. `1984` gives no row. The
  one exception is a bare `pi`, `π` or `tau`; a bare `e` is a typed letter, not a sum.
- The answer must be **real and finite**. `1/0`, `sqrt(-1)` and `1+` give no row at all —
  never an error row (the owner's call: no scold in the bar while you type).

A term that is both a sum and a name — `50/50` — shows the answer AND the library rows
under it, so the song is still one arrow-down away.

**What it knows.**

| Kind | Words |
| --- | --- |
| Operators | `+` `-` `*` (`×`) `/` (`÷`) `^` (`**`) `%` (`mod`) `!` (factorial), parentheses |
| Roots, powers | `sqrt` `cbrt` `root(n, x)` `pow(a, b)` `exp` |
| Logs | `ln` `log` (base 10) `log10` `log2` |
| Trigonometry | `sin` `cos` `tan` `asin` `acos` `atan` `atan2` `sinh` `cosh` `tanh` |
| Rounding | `round` `floor` `ceil` `trunc` `abs` `sign` |
| Several numbers | `min` `max` `hypot` `gcd` `lcm` |
| Whole numbers | `fact(n)` (the same as `n!`) |
| Units | `rad(x)` degrees → radians, `deg(x)` radians → degrees |
| Constants | `pi` `π` `tau` `e` |

**Angles are degrees.** `sin(30)` is 0.5 and `atan(1)` is 45. Use `rad()` and `deg()` when
you want the other unit.

**Numbers.** `-2^2` is −4 and `2^3^2` is 2^9, as in mathematics. `%` is the **remainder**,
not a percentage (`10 % 3` = 1); `mod` is the same operator. Float noise is cut at 12
significant digits, so `0.1+0.2` reads `0.3`. The shown answer groups thousands
(`2^64` reads `18,446,744,073,709,552,000`); **the clipboard gets the plain digits**, so a
paste is always a number. A number too large or too small for plain digits goes to the
exponent shape (`1.2e21`).

### 2b. Commands

Two terms are commands, drawn as the first row:
- **`volume 40`** (or `vol 40`): sets the level.
- **`web <seed> [1|2|3] [genre, genre]`**, and `web song|album|artist <seed> …`: asks the
  playlist web for a playlist and makes it. The seed is the longest run of words that starts
  a library artist, song or album, or an earlier web's name; what follows is the genre
  (several: commas; matched by prefix, so `r&b` presses "R&B/Soul"). A lone 1, 2 or 3 after
  the seed is this web's reach; it is never written to the setting. With no local match, the
  whole text is the seed and Apple is searched; several Apple answers wait for a click in
  the panel, then the make follows. Reach, size and style not given come from Settings ›
  Playlists. Example: `web Samara Cyn 1 R&B`. **No panel** (the owner's call, the second
  build): the row stays and reports each step ("Finding the start…", "Reading the web of
  …", "Making the playlist…"), then the **row itself flies to the Playlists card as the
  chip** (`handOff`, the web panel's own flight) and the bar closes; the card opens the
  playlist. With several Apple answers the first is taken. The songs, the name, Temp and its
  days follow the panel's own rules (`webQuick` in web.ts). Logged as `web:compass`, then the
  panel's `web:make` with `from: "compass"`. A failure is one warn toast in the bar's place.
- **`grow <card>`**: grows the card over its neighbor, or fills the window; a card not on
  screen is brought in first. The row carries a pill of the shapes this surface has:
  Horizontal in Midi; Horizontal, Vertical, Full in Max. In Mini the row is muted and says
  there is nothing to grow (one card fills the window). **Tab** moves between them (on a row
  with its own options, Tab is the row's, not the filter row's); the last pick is remembered
  (`deets.compass.grow`). Enter grows.
- **`favorite [song]`** (`fav`, `love`, `heart`, `like`; `unfavorite`, `unlove`, `dislike`):
  ♥ the song on Apple Music, or the current song with no name; a loved song offers
  Unfavorite. The name is looked for in the current song, Up Next, this session's plays,
  then the library. Behind the Add to Library and ♥ gate: off, the row opens that setting.
- **`add [song]`** (`add to library`): the song into your library, or the current song with
  no name; only a song not in the library yet (a station's, a catalog play's), found in the
  current song, Up Next and this session's plays. The same gate. A REAL Apple write.
- **`queue [song|album|playlist] <name> [N | next | end]`**: the best library match goes into
  Up Next: at position N (counted from 1), next (the default), or at the end. `queue Fancy 3`,
  `queue album Do Well end`, `queue playlist Web Samara next`. Logged as `compass:queue`.

Score: each word of the term must match the start of a word in the row's text (title, then
the second line, then the row's hidden aliases). A match at the start of the title ranks
first (a row's alias that starts with the term counts the same: "airpla" is the speakers,
not the album Airplane Tickets), then at the start of any word, then anywhere; last, a **typo** (one slip in a word of
four letters or more, two in eight or more: "jhenne", "setings"). **Synonyms**: a typed
word is also tried as each of its synonyms ("skip" finds Next song, "prefs" finds Settings,
"fav" finds Favorite); the table is `SYNONYMS` in compass.ts and
**[COMPASS-TERMS.md](COMPASS-TERMS.md)**, the user-guide list of everything the bar answers
to. An **exact name** ranks above every "starts with" (score 4). The **groups come in the
order of their best match**, ties in the default order: "replay" with the playlist named
Replay puts Playlists above the Settings rows that only contain the word. A kind whose
**card is on screen** gets a small boost (the context match, +0.25: the Playlists card open,
"replay" predicts Playlists). Rows per group by surface: **Mini 3**, Midi 6 (the shown kind
8), Max 6 (the shown kind 12).

## 3. Inline Settings rows

A Settings row is inline when its truth is in the settings store: a `toggle` built by
`storeToggle` (it carries `key`), or a `choice` with `key` and no more than three options.
The row renders the Settings card's own markup (`.set__row--toggle`, `.set__split`) so it
looks the same as the card. The store change re-renders the Settings card too, if it is on
screen. A `choice` with more than three options, a `split`, a `range`, a Rust-held toggle
(Close to tray, Start with Windows, Last.fm, Agent control) and every action jump to the
card instead.

Keys on an inline row: **Enter** flips a toggle, or moves a choice to its next option
(**Shift+Enter**: the one before); a click on an option applies it. Left / Right stay with
the text caret; Tab belongs to the filter row (2a).

## 4. How it opens, moves and closes

- **Open:** Ctrl+Space or Ctrl+Shift+Space, anywhere, a text field included (none of ours
  uses the key, and the Search field is where a person often is when they want to go
  elsewhere). The compass button in the title bar (right of the title) opens it too. The panel arrives with `.pop`; the rows
  enter with `enterRows`. The panel sets `data-frames="compass"` for frames.ts.
- **Move:** Up / Down move the highlight and keep it in view; Home / End jump. The field keeps
  the focus the whole time; the highlighted row carries `is-active` and `aria-selected`.
  Typing filters at once (no debounce: the index is in memory).
- **Run:** Enter, or a click on a row. Ctrl+Enter is the row's second action.
- **Close:** Ctrl+Space again (the same key puts the bar away), Escape (typed text clears first; a second Escape closes), a click outside (Settings › Window › **Compass closes on outside click**,
  default on; a press on the title bar's drag region counts, since it never sends a click),
  or a result that leaves the bar. Focus returns to the element that had it.
- **Where:** under the title bar, `left` and `right` at `--panel-edge-gap`, `z-index` with
  the other title bar panels, and clear of the Now Playing card — §11. Opening it closes any
  other title bar panel (dropdown.ts).
- **Reduced motion:** `.pop` and `enterRows` already snap.

## 5. The rest of the keyboard pass (fork 5B, then the lists — built 2026-09-17)

**Inside every list** (`src/list-keys.ts`, adopted by the collection-card engine — Library,
Playlists, Rewind, the artist and genre views — the Queue, History, Home and the Search
card): **Tab** reaches the list and the first row takes the focus (in a drilled card the
list's tab stop comes after the hero's cover and the Play / Shuffle row, so Tab walks cover,
Play, Shuffle, then the rows; found in the desk test 2026-09-17); **arrows** move (in a
grid of tiles, up and down move by a row of tiles); **Home / End**, **PageUp / PageDown**;
**Enter / Space** do what a click does; the **Menu key** or **Shift+F10** opens the row's
right-click menu at the row; **Escape** goes back one step in a drilled card, or pops a
Search pane. A windowed Library list reveals the row first, so an arrow reaches every row.
A real button inside a row (the Add square) keeps its own keys. The ring is the theme's
focus ring, inset on the row. A key does exactly what the pointer does: the helper clicks
the row and dispatches a `contextmenu` event, so each card's own handlers run.

- **Space** plays or pauses when nothing that takes Space has the focus: the body, a card's
  body, a row without a tabindex. A focused button, a slider, a text field and a row with
  `role="button"` keep Space for themselves (a focused search row plays on Space through
  the row's own handler, so the two never fight).
- **Enter / Space on a Search card row** does what a click does: plays the song, or opens the
  album, artist, playlist or station pane. The rows already carried `role="button"` and
  `tabindex="0"` without a key handler.
- Still open: hover-only controls (the Search Add-to-Library square) show only on
  `:focus-visible`; the Sort / View popovers take no arrow keys yet.

## 6. What changed

| File | Change |
|---|---|
| `src/compass.ts` | The bar: the index, the query, the rows, the keys, the inline settings rows. |
| `src/styles/compass.css` | The panel and its rows. Color through theme roles; geometry through the `--compass-*` tokens. |
| `src/styles/skin.css` | `--compass-max-h`, `--compass-row-h`, `--compass-field-h` in the base block. |
| `index.html` | The panel host under the title bar; the compass button right of the title. |
| `src/main.ts` | `initCompass()`; Space for play / pause. |
| `src/layout-bus.ts` | `requestLibraryDrill` (an artist by name or an album by a track) and `requestPlaylistOpen` (by id), held until the card takes them, like `requestSetting`. |
| `src/library-card.ts`, `src/playlists-card.ts` | Take those requests on mount and while on screen. |
| `src/settings-card.ts` | `settingsRows()`: the sections built inert. `key` on store toggles. A Tips entry. |
| `src/search-card.ts` | `requestSearchTerm`; Enter / Space on rows. |
| `src/sleep.ts` | `sleepIn(minutes)` and `sleepOff()`. |
| `docs/features/ONBOARDING.md` | Ledger rows for the menu row, the field and the pills. |

Zero Apple calls. No new settings key. No Rust change (no dev-runner restart).

## 8. The Library's Genres view, and the collection sorts (2026-09-17, the owner's ask)

The Songs list could sort by Artist, Album and Genre, which felt off: those name a
collection, not a property of one song. Two facts decided the shape:
- The sorts stay. A grown Library card's column headers (Artist, Album, Genre, Length) sort
  by them (CARD-GROW.md §9a), so the Sort popover must show the sort in force.
- They now sort **inside the collection** too, the record-shop order: Artist = artist,
  then album, then disc and track; Album = album, then disc and track; Genre = genre, then
  artist, album, track. One key, so the arrow flips the whole order.

And **Genres is a View** now, beside Songs / Albums / Artists: one mosaic tile per genre
(a song's first genre, as Apple lists it; up to 16 covers), with its song and artist counts;
sorts A–Z, Song Count, Artist Count; right-click, drag and multi-select carry the genre's
songs in artist order. A tile drills to the genre: a hero (the mosaic, the counts, the
length) over Songs / Albums / Artists of that genre, Songs by Artist by default. The Compass's
Genres rows open it (`requestLibraryDrill({ kind: "genre" })`).

Desk test: Library › View › Genres (the fourth column entry; check the popover's width);
a tile's mosaic; drill; Sort › Artist in the root Songs list (songs of one artist sit by
album and track); a grown Library's Artist column header still sorts.

## 9. Making a feature reachable from the Compass

Read this when you add a card, a setting, a panel, a verb, a data kind or a command. Most
of it is automatic; the rest is one row in `src/compass.ts`.

| You add | What the bar needs | Where |
|---|---|---|
| **A card** | Nothing. The Places group reads the card registry (`cards.ts`); a gate like Rewind's is a `continue` in `places()`. | automatic |
> **A row that stays, stays — fixed 2026-09-17.** `stays: true` (a Settings row, "Look for
> speakers again", "Web from …", a genre's stations) and a `run()` that returns `false` both
> keep the bar open, and `runRow` redraws the list instead of closing. Under the mouse that
> did not hold: `render()` rewrites `list.innerHTML`, so the row you pressed left the document
> before the click reached `dropdown.ts`, which read your own press as a click away and closed
> the bar. From the keyboard it always worked, because Enter fires no document click — which
> is how it hid. The fix is in the primitive, one line: a click whose target is no longer in
> the document is not a click away (`src/dropdown.ts`, ROOMS.md §16.7 has the whole cause).
> The inline controls in a Settings row (a toggle, a choice, an options cycle) and the group
> chips were shut by the same thing, and are fixed by the same line.

| **A Settings row** | Nothing for the jump. For an **inline** control the row's truth must be in the store: use `storeToggle(...)` or give a `choice` its `key` (three options or fewer; `menu: true` makes it a jump). A row over Rust or a closure stays a jump; that is right. | settings-card.ts |
| **A title bar panel** | Export an `open<Name>Panel()` that calls the dropdown handle's `open()` (Sound and Sleep do), and one Places row. | the panel's module; `places()` |
| **A verb** (transport, sleep, a toggle) | One row in `actions()`: title, an optional second line, `run`. The title follows the state when the verb does (Play / Pause). | `actions()` |
| **A data kind** with a page of its own (a library kind, a store) | Rows built once per store change in `libraryRows()` or a sibling; `run` sends to the owner through a held request on the bus (`requestLibraryDrill`, `requestOpenPlaylist`, `requestSearchTerm`: copy that shape, the card takes it on mount and while on screen); `alt` for Play; `tracks` so `queue` can take it. Add the kind to `KINDS` for a chip and to `PREFER` for the prediction. | `libraryRows()`, layout-bus.ts, the card |
| **A data kind that only acts** (a station, a speaker) | Rows with `run` only; no chip unless it is a library kind. | its own `…Rows()` |
| **A verb that only makes sense sometimes** (Reset row order) | The same one row in `actions()`, inside an `if`. *Reset row order* is pushed only when `orderedScopes()` is not empty, and it OPENS its Settings row rather than firing — a destructive verb from a search bar should still ask. | `actions()` (MOVABLE-ROWS.md §13.5) |
| **A command** (`web`, `grow`, `queue`, `volume`) | A `…Row(termRaw)` that parses the text and returns one row, spread first in `query()`. A shape the user picks is `options` (Tab walks it; remember the pick in localStorage). | `query()` |

Rules that hold for every row:
- **Zero Apple calls while typing.** Read caches and peeks; a call that must happen goes once
  per session behind a clear reason (the stations), and is logged.
- **The owner acts, the bar sends.** Never render a panel's copy in a row. An inline
  control writes the store the owner reads.
- Inner buttons carry `tabindex="-1"`: the field keeps the focus; Tab is the pill's key.
- A row's hover text is its `title`; the hint engine adopts it. New row shapes go in
  ONBOARDING.md's ledger.
- Add the desk-test step to §7 and, when it is a settings key, the row in AGENT.md.
- Add the row, command or synonym to **COMPASS-TERMS.md** (the user-guide list) and, for a
  synonym, to `SYNONYMS` in compass.ts. Give a static row `aliases` for the words people say.

## 10. `deetsmusic go` — the CLI's way to a place (built 2026-09-17)

The CLI could reach the data (playlists, the library, the queue), the settings and the
transport, but it had no way to reach a **place**. The Compass already registers every one,
so the verb is one reader over that registry rather than a second list:

```bash
deetsmusic go                # lists every place it will go to
deetsmusic go rewind         # a card
deetsmusic go sound          # the Sound panel
deetsmusic go sleep timer    # several words are fine
```

Routes: `GET /go` (the list) and `POST /go {target}` (go there), both under Agent control
like every other agent route. `compass.ts` exports `agentGo`; `agent-writes.ts` routes the
`go` and `go-get` kinds. A place added to the Compass by §9's rules is reachable from the
CLI the same day, with nothing else to write.

**It goes to places; it does not change settings.** The Places group also holds the themes,
the skins and the surfaces, and picking one of those WRITES a stored setting. That write
already has a route (`/settings`), a consent row (Settings › Connections › Agent changes
settings, default Ask) and a slower cover so the change is visible
([UX-COVERUPS](../architecture/UX-COVERUPS.md) §6b). Letting `go glass` through here would be a second way
in that asks nobody, so `go` refuses it and names the verb that does ask:

```
$ deetsmusic go glass
blocked: Glass is a skin, and changing it is a setting — use `deetsmusic settings set skin
glass`, which asks first if you have set it to.
```

Settings rows, transport verbs and the library's own data rows are out of `go` for the same
reason: each already has a CLI verb that obeys its own rules. Like `grow`, `go` is a CLI verb
and a route, not an MCP tool.

## 11. Clear of the Now Playing card (2026-09-17, the owner's ask)

The bar used to hang straight down from the title bar, so the field and the results covered
the player. The rule now: **the bar never covers the Now Playing card**, in any surface.

Where the card is decides which way the bar moves (styles.css, the bento):

| Surface | The NP card | What the bar does |
|---|---|---|
| midi | row 1, full width, under the title bar | drops below the card |
| mini, card view | the top row of the one column | drops below the card |
| max | the tall left stage column | keeps its top, insets its left edge right of the card |
| mini, player view | the whole window | nothing to dodge: it hangs from the title bar (fork 2B) |

**How.** `keepClearOfNp()` in compass.ts measures the card against the title bar (the
panel's positioning context) and publishes two custom properties on the panel:
`--np-drop` (the card's bottom edge below the title bar) and `--np-right` (the card's right
edge from the title bar's left). styles/compass.css picks one per surface through
`--compass-drop`; max sets the drop to `0px` and uses `--np-right + --panel-gap` for `left`;
mini's player view sets the drop to `0px` as well. No card measured (width or height `0`)
drops both, and the CSS falls back to today's placement.

Both numbers are **measured, not tokens**, for two reasons found in the code:

- The midi/mini row is `auto`, so the card is content-sized, and its height changes by one
  row when the transport row stacks — a window resize, or a **station**, which hides Repeat
  and so needs less width (now-playing-card.ts `fit()`). The title and artist never change
  it: they are `nowrap` with an ellipsis.
- max's stage column is `minmax(0, var(--max-stage-w))`, so the column is allowed to be
  narrower than the 340px token.

A `ResizeObserver` on the card, a `resize` listener and `onSurfaceChange` keep both live
while the bar is open, and **`onOpen` measures again on every press**. This is the toast
stack's own method (src/toast.ts `ensureHost`), excluded surfaces included, plus that
open-time read.

The open-time read is not belt and braces. The cards arrive with a `transform`
(`boot-safety-panel`, styles.css), so a rect taken during boot puts the card's bottom edge
lower than its resting one, and the drop comes out too big. A transform changes no element's
**size**, so no `ResizeObserver` ever corrects it: the number stayed stale until the next
real resize. The owner saw exactly this on the first press after a launch (2026-09-17).

**No clipping.** The drop moves the panel down, so `--compass-max-h` (skin.css) subtracts
the same `--compass-drop`: the box always ends 24px above the window bottom, the rows scroll
inside it, and the window never clips a row. Three rows is the floor for a very short
window. When the drop is `0px` the token is exactly what it was before.

**Not affected.** A grown card never changes this: in midi a grown card takes row 2 only,
and in max columns 2-3, so it neither covers the NP card nor changes its size.

## 7. Desk test — PASSED 2026-09-19 (every step, the §7.10a calculator included)

1. Ctrl+Space in Midi: the bar drops in under the title bar; the field has the focus;
   Places then Actions show. Escape closes it and the focus goes back where it was.
2. Ctrl+Shift+Space opens it too.
3. Type `lib`: Library leads Places. Enter opens the Library card; the bar closes.
4. Type `hover`: "Show hover hints" shows as an inline toggle. Enter flips it; the Settings
   card (if on screen) follows. Type `notices`: the split pill; Enter moves to the next
   option, Shift+Enter back; a click on an option applies it.
5. Type `tray`: "Close to tray" (Rust-held) has no control. Enter opens Settings at the row,
   flashed.
6. Type `sleep 30` → "Sleep in 30 min": Enter arms the timer (the alarm clock lights).
7. Type a song you have: Enter opens its album in the Library. Ctrl+Enter plays it.
8. Type an artist: Enter opens the artist page in the Library; Ctrl+Enter plays their songs.
9. Type a playlist: Enter opens it in Playlists; Ctrl+Enter plays it.
10. Type anything: the last row is "Search Apple Music for …". Enter opens the Search card
    with the term typed and the search running.
10a. **The calculator (§2d, added 2026-09-18 — OPEN).** Type `1+1`: the first row reads
    `1 + 1 = 2` under an **Answer** header, with an equals sign in its square and no second
    line. Enter copies `2`, a "Copied 2." toast shows, and **the bar stays open** with the
    term still in the field. Paste somewhere: `2`, plain. Then check, in one sitting:
    `2^10` = 1,024 · `log(1000)` = 3 · `sin(30)` = 0.5 · `atan(1)` = 45 · `5!` = 120 ·
    `0.1+0.2` = 0.3 (not 0.30000000000000004) · `-2^2` = −4 · `(1+2)*3` = 9 ·
    `100/3` = 33.3333333333 · `pi` = 3.14159265359 · `2^64` groups its thousands, and the
    paste has none. **No row at all** for: `1984`, `e`, `1+`, `1/0`, `sqrt(-1)`, `3:45`,
    an artist with a number in the name (`Blink-182`, `2 Chainz`). A song named `50/50`
    shows the answer first AND the song under it. Last, in Mini: the row still appears and
    Enter still copies.
11. **Clear of the player (§11).** Midi: Ctrl+Space — the bar starts under the Now Playing
    card, not over it; the whole card stays readable. Drag the window narrower until the
    transport row stacks: the bar moves down with the card. Play a station (Repeat hides) at
    a borderline width: the bar follows again.
12. Max: the bar keeps its top but starts right of the stage column; the player and the
    anchored Queue stay clear. Mini, card view: it drops under the card. Mini, player view:
    it hangs from the title bar over the player, as decided.
13. **The first press after a launch.** Start the app and press Ctrl+Space as soon as the
    cards are up: the gap under the player is the same as on every later press (the boot
    arrival's transform used to make it too big).
14. Make the window short (drag the bottom up) and type a letter with many matches: the
    bar's last row stays inside the window and the list scrolls to it. Nothing is cut off.
11. In mini › Player (the player alone): Ctrl+Space works; a Place switches to the card view.

**The card shape (§2c, 2026-09-18).**
15. Max. Ctrl+Space, type `settings`: the Settings row leads and its second line says "Card".
    The **highlighted** row shows the pill Card · Horizontal · Vertical · Full; the rows under
    it still show their keys (Ctrl+K on Search, Ctrl+L on Library). Enter opens Settings as
    it always did.
16. Max. Type `settings full` — and then `full settings`: both put the Settings card row
    first, the second line says "Card · Full", the pill shows Full pressed. Enter: the card
    comes in and fills the bento. Collapse it.
17. Max. Type `queue vertical`, Enter: the Queue grows up over Now Playing. Type
    `library horizontal`, Enter: the Library grows sideways.
18. Max. Type `lib`, then press **Tab** three times: the pill steps Horizontal → Vertical →
    Full and the second line follows. Enter grows the Library that way. Close the bar, open
    it again, type `lib`: it is back on **Card** (the pick is not remembered).
19. Max. Arrow down to a card row and click an option on its pill with the mouse: the pill
    changes and the row does NOT run. Click the row itself: it runs in that shape.
20. Midi. Type `settings full`: the second line says "Card · Horizontal · Midi grows
    sideways only" and Enter grows it sideways. Tab steps Card ↔ Horizontal only.
21. Mini. Type `settings full`: the Settings row is found, there is **no pill**, the second
    line says "Card · Mini shows one card", and Enter just opens Settings.
22. Type `wide awake` (or any song of yours whose name starts with a shape word): the song
    is still found — the shape split does not eat it.
23. Type `grow library`: the old command row is unchanged and still remembers its own pick.
24. In a terminal, `deetsmusic go library` still works after you have Tabbed a shape in the
    bar and closed it.
25. **The keys the rows print (fixed 2026-09-18).** With the bar open, press **Ctrl+L**: the
    Library opens and the bar closes. The same for Ctrl+K, Ctrl+Q, Ctrl+P and Ctrl+, . Tab a
    shape first (say Full) and press Ctrl+L: the Library comes in grown that way.
12. In Max with a Fill: Ctrl+Space works over the filled card.
13. The compass button right of the title opens the bar; its hint reads "Go anywhere! (Ctrl + Space)".
14. Space with nothing focused: play / pause. Click a Search card row (it takes focus), press
    Space: the row's own action, not a pause. Tab to a Search row, Enter: it plays.
15. Reduced motion on (Windows › Accessibility › Visual effects › Animation effects off): the
    bar snaps in, no row stagger.
16. Settings › Tips has the "Ctrl+Space" entry.
17. Type `jhene aiko`: the filter row shows Songs, Albums, Artists with counts, Artists is
    pressed, and the artist row is first under the chips. Tab: Songs, then Albums; Shift+Tab
    back. Type one more letter: the prediction runs again.
18. Under Glass, the bar's corners match a card's, not the title menu's.
19. Type `eq`: the presets, the current one says On; Enter picks another (the Sound panel
    follows). Type a song in Up Next: the Up Next row says its position; Enter jumps.
    Type `vol 30`: Enter sets the level (the pill follows). After the Play on panel has
    scanned: type the speaker's name, Enter plays on it. Type `sleep at`: the two end rows.
20. Type any word: the log gets one `compass:stations` line (four calls) the first time this
    session, and Radio opened after loads at once with no `radio` calls in the log.
22. Click a card while the bar is open: it closes. Settings › Window › Compass closes on
    outside click off: the click leaves it open; Escape closes. Click the title bar's empty
    drag area with the row on: it closes.
23. `grow lib` in Midi: the pill shows Horizontal only; Enter grows the Library wide. In Max:
    Tab walks Horizontal, Vertical, Full; Enter; reopen the bar: the pick is remembered.
    `grow radio` with Radio off screen: the card comes in, then grows.
25. Tab into the Library: the first row rings. ↓ ↓ ↓, End (the last of 3,895 rows), Home;
    Enter on an album tile drills; Escape goes back; the Menu key on a song opens its menu at
    the row; Space on a song plays it (not pause). The same in Up Next, History, Home,
    Search (Escape pops a pane).
26. Library › Sort: Artist, Album and Genre are gone. In a grown Library, click the Artist
    column header: it sorts, and Sort shows "Artist" as the one in force until another sort.
30. Type `airpla`: Speakers sit above Albums; the first time, "Looking for speakers…" then
    the speakers on the network; "Look for speakers again" rescans; Enter on one plays there.
29. Open the Playlists card, type `replay`: Playlists (Replay first, exact) sit above the
    Settings rows; close Playlists and open Library: the Settings block may lead again only
    if its best match is higher. In Mini: three rows per group.
28. `fav` with a song playing: "Favorite “…”"; Enter (a real ♥ on Apple). `fav` again:
    "Unfavorite". `add` while a station plays a song not in the library: "Add “…” to
    Library"; on a library song the muted row says it is there already. Turn the ♥ gate off:
    both rows point at the setting. Type `skip`: Next song; `prefs`: Settings; `setings`
    (a typo): Settings; `jhenne aiko`: the artist.
27. `grow lib` in Mini: the muted row says there is nothing to grow. `web Samara Cyn 1 R&B`:
    no panel; the row reports three steps, flies to Playlists, the playlist opens.
    Type `jazz`: "Jazz stations" (Enter reads them, the rows appear in place).
24. `queue Fancy` → next; `queue Fancy 3` → third in Up Next; `queue album Do Well end`.
21. `web Samara Cyn 1 R&B`: Playlists comes on screen, the web panel opens with the seed,
    the build runs at reach 1, the R&B chip presses, the playlist is made and flies. Then
    `web Fancy` (a library song title): the song seed, reach from Settings. Then `web song
    Fancy 2`: kind and reach given.

## 12. The needle turns with the bar (2026-09-17, the owner's ask)

The title bar button holds the owner's hand-drawn compass. The needle now reports the trip:

| Moment | The turn |
| --- | --- |
| The bar opens | Half a turn forward, 0° → 180°. |
| The bar closes and nothing ran | Back the way it came, 180° → 0°. The trip went nowhere. |
| A row ran and the bar closed | On through, 180° → 360°. The circle closes with the trip. |

How it is built: `src/compass.ts` keeps one angle that only grows or unwinds by 180 and
writes it to `--compass-angle` on the button; `styles/compass.css` rotates the `svg` with a
`transition`, so a turn that reverses mid-way turns back from where it is, not from the end.
The timing is one skin token, `--compass-spin` (base `0.42s` with a small overshoot — a
needle settles, it does not snap); reduced motion drops the transition and the mark jumps.

`went` is the answer for the opening under way: `runRow` sets it when the row closes the bar
(both the row's own action and its `Ctrl+Enter` second action), and the `hidden` observer
reads it, so every close path — Esc, a click away, the button again — turns the same way. A
row that keeps the bar open (a toggle, a choice) is not a trip and does not set it. A second
`Ctrl+Space` while the bar is open closes it, so the needle unwinds the way Esc does.
The compass button and `openCompass()` still only open and refocus.

**Desk test.** 1. Ctrl+Space: the needle turns half a circle as the bar arrives. 2. Esc: it
turns back to where it started. 3. Ctrl+Space, `library`, Enter: it carries on the same way
and finishes the circle. 4. Ctrl+Space, press a toggle row (a Settings row with On/Off): the
bar stays, the needle holds at the half turn; then Esc unwinds it. 5. Ctrl+Space, then click
the button in the title bar to close: it unwinds. 6. Open and Esc five times in a row: the
needle ends where it began, never drifting. 7. Windows › Accessibility › Visual effects ›
Animation effects off: the mark jumps between the two angles with no motion.
