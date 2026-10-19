---
status: shipped
shipped_in: 0.14.0
desk_test: passed 2026-09-24
sources: [src/media-menu.ts, src/context-menu.ts, src/web.ts, src/copy-link.ts, src/go-to.ts, src/pins.ts, src/np-bus.ts, src/tray.ts, src/library-add.ts, src/favorites.ts]
updated: 2026-10-16
---
# DeetsMusic — Right-click menus

One menu for each media type, the same in every card. Code: `src/media-menu.ts`. The menu
primitive (the popover, submenus, fields) is `src/context-menu.ts`; this doc is about what
the menus hold.

Terms used in this doc:
- **Media type** — song, album, artist, playlist, station. A genre and a picked set are
  **lists**.
- **Builder** — a function in `media-menu.ts` that returns the rows of one media type's menu.
- **Group** — a fixed band of rows in a menu (§2). A row that does not apply is left out.
- **Own rows** — rows that only one card has (Move to Top, Refresh, Stop Station).
- **Take-away rows** — rows that remove something (Remove, Hide, Delete).

## 1. Why this exists

On 2026-09-23 the owner found that the same media type opened different menus in different
cards. The audit found six cards that built their song menus by hand (Search, History,
Queue, Now Playing, the tray panel, Friends). Each one had drifted: a missing Pin, ♥ or
Song of the Day row, rows in another order, "Play this" for "Play Now". Artists had no
common menu at all: the Library tile could not play, the Home tile could not start a
station. Three bugs came with it:

- A song row inside a Library album view pinned the ALBUM (`pinRowsFor` read the list's
  `album:` context).
- **Copy Link** on a Home artist tile, a genre tile or a Library picked set copied the first
  song's album.
- A Library picked set opened with "Play Now" and showed Go to and Copy Link rows that do
  not fit a mixed set.

The rule now: **a card never lists media rows by hand.** It calls the builder for the type
and passes only its own rows and its take-away rows.

## 2. The row order

The same in every menu. The groups never change places.

| # | Group | Rows |
|---|---|---|
| 1 | Play | Play Now · Shuffle (albums, playlists) · Play Next · Add to Queue |
| 2 | File | Add to Playlist ▸ |
| 3 | Go to | Go to Artist · Go to Album · Go to Playlist · Song Credits |
| 4 | Seed | Start Station · Start a Web · Copy Link |
| 5 | Keep | Add to Library · Review This Album (albums) · Favorite · Suggest Less (and Suggest Less of This Artist / Album; not on Home's tiles) · Mark as Song of the Day · On Click ▸ · Pin |
| 6 | The card's own rows | Move to Top / Bottom · Move to Folder ▸ · Refresh ▸ · Stop Station · a pick's note … |
| 7 | Take away (last) | Remove · Remove from Playlist · Hide · Delete Playlist |

**The divider (2026-09-26, his call).** `MENU_DIVIDER` (context-menu.ts, a `DividerItem`) is a
hairline in the menu's `--border`, inset like a label, with `--ctx-divider-gap` above and below.
It is not a row: no hover, no focus. Used ONCE so far: an album review's menu (Album Reviews,
the Diary until 2026-10-17) puts it at the top of group 6, so the album's rows and the review's
own (Export · Mark as Done · Move to Folder · Delete Review) read as two groups. Another menu takes it only by the owner's call.

Two menus put a row ABOVE group 1, both by an earlier decision of the owner: the Playlists
card's **Rename** field (PLAYLISTS.md §10.2, "the field first, ready to type") and the Song
of the Day suggestion's **Mark** (DeetsOTD.md §8.6, the row the tile exists for).

## 2a. The quick column

> **Part:** built · 2026-10-16 · desk test open

A column of glyph buttons beside the text list, for the most common rows. The shape is the
Library's Sort pop: the text options, and the direction arrows in a column beside them.

**His calls (2026-10-16):**
- **Which rows:** only the rows that already have a glyph in the app. These are Play, Add to
  Queue, Add to Library, Favorite and Pin. Every other row stays text, with no glyph.
- **Where (1A):** a column on the right of the list, as in the Sort pop. A strip across the
  top and a glyph inside each row were the other choices.
- **The rows stay (2B):** the five rows stay in the text list too, in their §2 places. The
  text says what each glyph does.
- **Add to Queue's glyph:** the Now Playing "Show queue" glyph (`#np-summon`: three lines and
  an outlined triangle on the right) with the triangle moved to the LEFT of the lines. It
  still points right, into the lines.

| Glyph | Row | Source |
|---|---|---|
| ▶ filled triangle | Play Now (the row's own label: "Play 3 songs", the Queue's jump) | the Library's Play button (`collection-card.ts`) |
| triangle, then three lines | Add to Queue | the "Show queue" glyph, mirrored (`now-playing-card.ts`) |
| + (✓ when held) | Add to Library | `ICON_PLUS` / `ICON_CHECK` (`add-square.ts`) |
| ♥ (filled when on) | Favorite | the ♥ (`add-square.ts`) |
| pin (filled when on) | Pin | `ICON_PIN` (`pins.ts`) |
| four corner arrows, out | Expand Player (Now Playing only, 2026-10-16) | the Grow button, `ICON_GROW` (`card-grow.ts`) |
| four corner arrows, in | Shrink Player (Now Playing only, 2026-10-16) | the full player's close square, `ICON_SHRINK` (`card-grow.ts`) |

**What follows from the calls (Claude's, for his review):**
- **Order** top to bottom: Play · Add to Queue · Add to Library · Favorite · Pin · Expand /
  Shrink Player (his ask, 2026-10-16: the glyph matches the row). A glyph whose
  row the menu does not have is left out; the rest close up (the song that is playing has no
  Play; a station has no ♥).
- **State:** ♥ and Pin are filled when on, in the title color.
- **The ✓ (his call, 2026-10-16, after the first build):** when the item is in the library,
  Add to Library shows the ✓, as the + square does. The row itself still leaves itself out:
  the builder returns a `listless` item, which draws its glyph only. The ✓ is a mark, not a
  button (`aria-disabled`, so its hint "In your library" still shows). Where the builder
  knows: a song, an album from its songs (every song held), a playlist (a library playlist,
  or one of Apple's the library lists). A Search album (`addAlbumToLibraryItem`) cannot
  know, so it shows the + as before.
- **The line (his call, 2026-10-16):** the column is as tall as the list, so its hairline runs
  to the bottom; the squares sit at the top. A menu that gains a glyph keeps its shape.
- **A press** runs the row and closes the menu, as the row does. The click trail logs it as
  `ui:act { do: "menu", what: <label>, via: "quick" }`.
- **The flyouts** open from the menu's outer edge, past the column, so Add to Playlist ▸ never
  covers it (`placeFly`). The column has no hover-close: the pointer crosses it on its way
  from a row to that row's flyout, and the flyout stays open.
- **Code:** `ActionItem.quick` (the glyph) and `ActionItem.on` (filled). The rows are marked
  where they are made: `playRows` and `stationMenu` (media-menu.ts), the History and Queue
  cards' own Play groups, the four `Add to Library` builders (library-add.ts), the three ♥
  builders (favorites.ts), `pinItem` (pins.ts), and the tray panel's hand-built song menu
  (tray.ts: +/✓, ♥, Pin). The primitive draws the column from the
  marked rows of the top box only: a flyout has none. A menu with no marked row (Rulez, card
  grow, Settings) has no list box and no column, and is built exactly as before.
- **Keys:** right-click menus have no arrow keys today (rows and squares are reached by Tab).
  The design's arrow keys wait for arrow keys in the menu as a whole.
- **Hints:** each glyph has a hover hint with its row's label; a line in ONBOARDING.md §1.
- **Tokens:** `--menu-quick-size` (= `--lib-pop-dir-size`, the Sort pop's square) and
  `--menu-quick-icon` (= `--icon-sm`). The hairline is `--border`; the glyph is the subtext
  color and takes the title color on hover.

**Desk test.**
1. Right-click a song in the Library. The column on the right shows Play, Add to Queue, ✓, ♥
   and Pin; its line runs to the bottom of the menu. The ✓ does nothing on a press, and its
   hint is "In your library". Each other glyph's hint is its row's label. In Search, a song
   not in your library shows + and the Add to Library row.
2. Press each glyph: it does what its row does, and the menu closes. Right-click again: the ♥
   and the pin are filled when the song is a favorite or pinned.
3. Hover Add to Playlist ▸ and move right: the flyout opens past the column and stays open
   while the pointer crosses the column.
4. Near the right edge of the window: the flyout opens to the left.
5. Right-click a station (Radio), a Queue row, a History row, a picked set and the Now Playing
   cover: the column holds only the glyphs whose rows the menu has (no Play on Now Playing).
6. Right-click a rule in Rulez and a card's title: no column.
6a. Right-click the song in the tray panel: +/✓, ♥ and Pin in the column.
7. Each skin: the squares match the Sort pop's direction squares.
- **Not now:** dividers between the §2 groups ("icons first", his words). `join()` already
  receives each group apart, so a divider between two groups that are not empty is one line.

## 3. The menus

### 3.1 Song — `songMenu`
Play Now · Play Next · Add to Queue · Add to Playlist ▸ · Go to Artist (▸ when several, in
the Library) · Go to Album · Song Credits · Start Station · Start a Web · Copy Link · Add to
Library · Favorite · Suggest Less · Suggest Less of This Artist · Suggest Less of This Album ·
Mark as Song of the Day · Pin.

- **Suggest Less** (2026-10-16, SUGGEST-LESS.md §4): each label follows the state ("Undo
  Suggest Less …"). The artist is Apple's primary artist of the song when known, else its
  artist line; the album row needs the song's album name. Always shown, the gate off too: the
  mark then stays in DeetsMusic. Home's tiles and the Pinned shelves leave all three out
  (`noSuggest`): a Hide is never a Suggest Less.
- A song has no song view, so it never shows "Go to Song". It goes to its artist and album.
- **Pin pins the song**, wherever the row sits — inside an album view too (fork 3A).
- **The song that is playing** (Now Playing, the Queue's now hero) has no Play group, and adds
  **Stop Station** while a station plays.
- **Now Playing only** (2026-10-16, his ask): **Expand Player** opens the full player, and
  **Shrink Player** closes it (fullscreen-player.md). Midi and Max only. With nothing playing,
  the cover's menu holds this one row.
- The **tray panel** has no cards, so it has no Play and no Go to group: Start Station · Copy
  Link · Add to Library · Favorite · Pin (fork 6A). The main window runs each row
  (`np_command`, np-bus.ts).

### 3.2 Album — `albumMenu`
Play Now · Shuffle · Play Next · Add to Queue · Add to Playlist ▸ · Go to Artist · Go to Album ·
Start a Web · Copy Link · Add to Library · Review This Album · Favorite · Suggest Less of This Album ·
On Click ▸ · Pin.

- **Shuffle** (2026-09-24, his call 3A): the hero's Shuffle button as a row, on every card. With
  "Shuffle stays on" it turns the mode on (`runListAction`'s rule).

- **Review This Album** (2026-09-24 as *Add to Diary*, renamed 2026-10-17;
  [DIARY.md](../features/DIARY.md) §2): summons the Album Reviews card at the album's review,
  making it the first time. Left out inside the card itself (`inDiary`). A review tile's own
  rows (group 6): Export · Mark as Done / Mark in Progress · Move to Folder ▸; Delete Review is
  group 7. A folder header in the card: Rename (a field) · Delete Folder (DIARY.md §4b).
- An album has no station (Apple seeds stations from songs and artists).
- **Go to Album on an album tile** (fork 2B): every card shows it. In the Library it drills in
  place; elsewhere it opens the Search album pane.
- Go to Artist is left out on an album tile inside that artist's own view.
- A Search album holds no songs until they load. Its pin key comes from the album's own cover
  (`album:<title> <cover>`, the rule `albumKey` applies to a song), and the songs load on
  the press. A Home "New" tile has no Pin row (a release that is not out has no songs).

### 3.3 Artist — `artistMenu`
Play Now · Play Next · Add to Queue · Add to Playlist ▸ · Go to Artist · Start Station · Start
a Web · Copy Link · Suggest Less of This Artist · On Click ▸ · Pin.

- **What plays** (fork 4A): the artist's songs in your library, in album order. An artist off
  the library plays Apple's Top Songs — one memoized `artistDetail` read, on the press only.
- **Go to Artist**: the Library artist view (in place in the Library, by `requestLibraryDrill`
  elsewhere); off the library, the Search artist pane by the artist's own id
  (`requestArtistPane`, new) or by one song → artist hop.
- **Copy Link** (fork 5A): `music.apple.com/artist/<id>`. A Library artist holds only a name,
  so its id resolves on the press: the Library's saved `library_artist_info` row (zero calls
  once the artist view was opened), else one song → artist hop.
- The artist view's own hero leaves Go to Artist out (you are there).

### 3.4 Playlist — `playlistMenu`
Play Now · Shuffle · Play Next · Add to Queue · Add to Playlist ▸ (not itself) · Go to Playlist ·
Copy Link · Add to Library · Favorite · On Click ▸ · Pin.

- **Shuffle**: as on an album (§3.2).
- **Add to Library** (2026-09-24, his call 4B): only one of Apple's playlists (Search, Home, an
  artist's Featured shelf) that the library does not hold. The row reads the Playlists
  mirror's `globalId`s (zero Apple calls). The press is one `POST /me/library?ids[playlists]=`;
  the playlist's songs do not join the library. The mirror then re-syncs, so the playlist
  shows in the Playlists card. Behind the Library Add toggle, as every add is.

- **Go to Playlist**: the Playlists card opens it (in place on that card); one of Apple's
  opens as a Search pane.
- **Copy Link** (fork 5A): Apple's playlist by its catalog id, or a library playlist that is
  public by its global id. A playlist made in DeetsMusic has no Apple page, so no row.
- **Pin from Search**: one of Apple's playlists now pins. The pin keeps the playlist as its
  snapshot (`catalogPlaylistTile`, pins.ts); a press plays its songs, Open opens its Search
  pane. Before this, only a library playlist could pin.
- No Start a Web: a web starts from one artist, song or album (PLAYLIST-WEB.md).

### 3.5 Station — `stationMenu`
Play Now · Add to Queue · Copy Link · Pin. A station has no view, so no Go to row, and no web.

### 3.6 Lists — `listMenu`, `setMenu`
- A **genre** tile: Play Now · Play Next · Add to Queue · Add to Playlist ▸. It is no one
  album, so it has no link.
- A **picked set** (Ctrl / Shift): Play *N songs* (or albums, artists, genres, plays,
  playlists) · Play Next · Add to Queue · Add to Playlist ▸ · the card's Remove N.
- A **tile** on Home or a Pinned shelf: `tileMenu` picks the builder for the tile's kind.

## 3a. The hero menus

> **Part:** built · 2026-09-24 · desk test passed 2026-09-24

The **hero** is the block at the top of an open album, playlist or artist view: the cover,
the title, the subtitle and the details line. A right-click **anywhere on the hero** opens the
view's own media menu (his call 1A). Before this, an album hero had no menu, a playlist hero
had only its cover menu, and the Library artist hero answered on the cover only.

| View | The menu |
|---|---|
| Album — Library card, Search pane | `albumMenu` with `here`: no Go to Album |
| Playlist — Playlists card | the card's playlist menu (§5) with `here`: no Go to Playlist, no Delete Playlist, no Remove Cover |
| Playlist — Search pane (Apple's) | `playlistMenu` with `here` |
| Artist — Library card, Search pane | `artistMenu` with `here`: no Go to Artist (as before) |

- **Nothing destructive** (his rule, 2026-09-24): the hero never holds a take-away row. Delete
  Playlist stays on the playlist row; Remove Cover stays on the row and on the cover button (5A).
- **The cover button keeps its left-click** (2A): on a playlist you made, the cover still opens
  the short cover menu (Choose Image… first, PLAYLISTS.md §10 1B).
- **Code:** a collection-card hero sets `menu` (the `Hero` interface); the engine's
  right-click handler takes `.lib-hero` first. A hero without `menu` keeps the old rule (the
  cover button's `coverMenu`). Since 2026-10-13 the Search card's pages are engine levels too
  (media-levels.ts, ARTIST-VIEW.md §10.1), so the same handler serves them.
- **Not yet** (his call 6, later): the song credits, Writer and Genre heroes have no menu.

**Desk test.**
1. Library › an album. Right-click the cover, the title, the artist line and the details line:
   each opens the album menu, with Shuffle and without Go to Album.
2. Search › an album, and an Apple playlist: the same, anywhere on the hero. The playlist has
   Add to Library when your library does not hold it; press it, and it shows in the Playlists
   card after the sync.
3. Playlists › a playlist you made: right-click the hero. Rename is on top; Move to Folder,
   the cover rows and the Apple Music row are there; Delete Playlist and Remove Cover are not.
   A left-click on the cover still opens the short cover menu.
4. Library › an artist: right-click the name. The artist menu opens (before, only the cover).
5. Any album tile on Home or in the Library: Shuffle is the second row, and it plays shuffled.
6. Ctrl+Space, `shuffle album <name>`: the album plays shuffled.

## 3b. ♥ Favorite on albums and playlists

> **Part:** built · 2026-09-24 · desk test passed 2026-09-24

Apple's love rating (`PUT /me/ratings/{albums|playlists|library-playlists}/{id}`, value 1;
`DELETE` takes it off), in every album and playlist menu, tiles included (his call F2A). Behind
the Library Add toggle, as the song ♥ is ([FAVORITES.md](../features/FAVORITES.md)).

- **The state** (F1A): the song ♥'s `favorites` table, no schema change. Keys `album:{id}` and
  `playlist:{id}` cannot collide with a song id. A Library album knows only its songs, so a
  pointer row `albumsong:{first song's catalog id}` mirrors the album's row: the Library menu
  reads it with no song → album lookup. The "first song" is the first song with a catalog id
  in disc and track order, in `albumMenu` and in the hero alike.
- **Reading Apple:** a hero asks once per install, the first time it draws
  (`favorite_collection_reconcile`, one `GET …/ratings/{kind}?ids=`). A Library album hero
  first finds the album's id (one song → album hop, cached for the session). A tile never
  asks: an album or playlist never opened reads "Favorite", and a press on one already loved
  only loves it again.
- **The press:** optimistic, as the song ♥. A Library album resolves its id first (the same
  hop). Apple refuses → the row flips back and a warn toast says so.
- **Which playlists** (F3A): a library playlist by its `p.` id (`library-playlists`), one of
  Apple's by its catalog id (`playlists`). A playlist made in DeetsMusic has no ♥ row.
- The Favorite Songs seed and the web and credits reads still see only song ids: the new keys
  never match a song.

**Desk test.**
1. Library › an album › right-click the hero: Favorite. Press it. Open the Music app on the
   phone or the web: the album is loved. Right-click again: Unfavorite.
2. Restart the app. Right-click the same album's tile in the Library: Unfavorite (no Apple
   call — `favorites:` lines in the log show none).
3. Love an album in the Music app. Open its hero in DeetsMusic once: the log shows one
   `favorites: reconciled album …, loved=true`, and the menu says Unfavorite.
4. Search › an Apple playlist › hero › Favorite; Playlists › one of your Apple playlists ›
   Favorite. A playlist under Made Here has no Favorite row.
5. Settings › Apple Music › turn Add to Library and ♥ off: no Favorite row anywhere.

## 4. Start a Web

> **Part:** shipped · 2026-09-23

A row in group 4 on songs, albums and artists (the owner, 2026-09-23: "Start a Web", after
Start Station). One press makes a web playlist with no panel (`startWebItem`, web.ts):

- **Settings:** Reach, Size, Prefer and the Temp days — the settings the web panel writes. A
  change in the panel IS a change of these settings, so the row always uses the last values.
- **Genres:** a song or album seed picks its own genres, as the panel does (§9.1 there). An
  artist seed picks none.
- **Feedback:** an info toast shows the step ("Reading the web of *Name*…", "Making the
  playlist…"). When the playlist is made, the right-clicked row flies to the Playlists card,
  which opens it. A row that re-rendered meanwhile (the Queue moved on) cannot fly: the card
  opens with no flight. A failure is a warn toast.
- **The seed:** a song needs its catalog id; an album its own id or one song's; an artist its
  catalog id, which a Library artist resolves on the press (§3.3). A row that can never seed
  leaves itself out.
- **The row's element:** `menuSource()` (context-menu.ts) keeps the element of the last
  right-click, so no card passes its row into a builder.
- The web panel is the same code from here on (`webFrom`); the Compass's `webQuick` finds its
  seed by name first, then calls it too.
- Not on the tray panel: the playlist opens in the main window, which may be hidden.

## 5. The rows each card adds

| Card | Item | Own rows (group 6) | Take-away (group 7) |
|---|---|---|---|
| Queue | upcoming row | Play Now (jumps to the row) replaces group 1 · Move to Top · Move to Bottom | Remove |
| Queue | picked rows | — (no Play group) | Remove *N songs* |
| Queue · Now Playing | now hero · cover and title | Stop Station (while one plays) | — |
| Now Playing | cover and title | Expand Player / Shrink Player (Midi, Max) | — |
| Queue | station row | Stop Station, or Don't resume (not a media menu) | — |
| History | row · picked rows | group 1 plays the play record by its handle | — |
| Playlists | playlist row | Move to Folder ▸ · Refresh ▸ · Import to Edit (Apple) · Keep Playlist · the cover rows | Delete Playlist |
| Playlists | song in a playlist | — | Remove from Playlist (hand-made only) |
| Home | any tile | Songs of the Day: the pick's note · Post Now · Withdraw · Unmark | Hide |
| Rewind | pick row | the pick's own rows | — |
| Radio | station | — | — |
| Friends panel (2026-09-27) | a friend's box: the song they play | Invite to my room (while you host) · Copy their code · Rename (a field) | Remove (with Undo) |

**The Friends box** joined the builder on 2026-09-27 (the consistency survey found it as the
one song row off it). Before that it listed *Play Now* and *Go to Album* by hand (his call of
2026-09-20, FRIENDS.md fork 3), so a friend's song had no Play Next, Add to Playlist, Start
Station, Copy Link, Add to Library, ♥ or Pin. The song comes from the presence when your
library does not hold it (`trackOf`, friends-panel.ts) and joins the transient store on a play,
as a Search result does. A friend off line or playing nothing keeps the friend rows alone.

Menus that are not media menus keep their own rows: Search term pills, Playlists folder
headers, the card title (Grow ▸ · Fill · Pin · Collapse — fork 7B keeps its "Pin"), Settings › My
reports (Open · Copy Link · Close · Clear), text fields (Cut · Copy · Paste · Select All).

### Where the listeners are

Every `contextmenu` listener in the app, and what it opens. `docs:check` check 24 fails a
module with a listener that neither this doc nor ONBOARDING.md §2 names (2026-09-27).

| Module | The right-click | Opens |
|---|---|---|
| `browser-defaults.ts` | anywhere | blocks the browser's own menu, except in a text field |
| `collection-card.ts` | a row, a tile, the hero, a Last.fm facts box | the row's media menu through its card's builder call; the hero's `menu` (§3a); the facts box's own small menu (LISTENERS.md §7.1) |
| `history-card.ts` · `qcard.ts` · `rewind-card.ts` · `home-card.ts` · `search-card.ts` | a row, a tile, the now hero, a picked set | the media menu of the item's kind, with the card's own rows (§5) |
| `rewind-btn.ts` (2026-10-19, listening-time.md) | a Top Listens row (a song, an album, an artist), a SOTD row | the Rewind card's menus: the media menu of the row's kind; a SOTD row adds the pick's own rows (`pickMenu`) |
| `now-playing-card.ts` | the cover, the title block | the song menu without the Play group (§3.1) |
| `diary-card.ts` | an entry tile, a song row, a folder header | the album menu with the entry's rows (DIARY.md §2); the song menu; Rename · Delete Folder |
| `rulez-card.ts` | a rule | the rule's own rows (RULEZ.md §6) — not a media menu |
| `friends-panel.ts` | a friend's box | the song menu with the friend's rows (§5) |
| `settings-card.ts` | a My reports row · a Glass picture | Open · Copy Link · Close · Clear; Delete picture (COVER-WALLPAPER.md) |
| `card-grow.ts` | a card's title, the Grow button | Grow ▸ · Fill · Pin · Collapse (CARD-GROW.md) |
| `tray.ts` | the song in the tray panel | the tray song menu (§3.1, fork 6A) |
| `web.ts` | the Temp \| N days button | no menu: steps the days back (PLAYLIST-WEB.md §10) |
| `layout.ts` | a card name in the slot picker | Hide from picker (HIDE-CARDS.md) — not a media menu |
| `list-keys.ts` | none: the Menu key and Shift+F10 on a row | sends a `contextmenu` to the row, so the keys open the row's own menu |
| `copy-edit.ts` | dev only, while the copy editor is on | swallows the right-click on a word being edited (COPY-EDIT.md); never in a release |

## 6. The forks, closed 2026-09-23

| Fork | Choice |
|---|---|
| 1 Where the take-away rows go | **A** — last, after Pin (PINS.md §7 changed with it) |
| 2 A tile shows "Go to" its own kind | **B** — on every card, but a song (no song view) |
| 3 Pin on a song row inside an album view | **A** — pins the song |
| 4 Play on an artist off the library | **A** — Apple's Top Songs, one read on the press |
| 5 Copy Link for artists and playlists | **A** — where Apple has a public page |
| 6 The tray panel | **A** — adds Pin and Start Station |
| 7 The card title's "Pin" | **B** — left as it is |
| Web row label · feedback · place | "Start a Web" · toast, then the flight · after Start Station |

## 7. How to add a menu

1. Name the media type. Call its builder (`songMenu`, `albumMenu`, `artistMenu`,
   `playlistMenu`, `stationMenu`, `listMenu` / `setMenu`, or `tileMenu` for a tile).
2. Pass `context` (the queue tag) and `nav` where the card drills in place.
3. Pass the card's own rows as `own` and its take-away rows as `away`. Never splice rows
   into the builder's list.
4. A new verb for a whole media type goes into the builder, in its group, so every card
   gets it at once. Add a line to §3 and to ONBOARDING.md §2.

## 8. Desk test

1. Right-click a song in each place: Library, a Library album view, Playlists, Home, Rewind,
   Search, History, a Queue row. Each menu has the §3.1 rows in the §2 order. Only the
   card's own rows differ (§5).
2. In a Library album view, right-click a song and press Pin. The song pins, not the album.
3. Right-click the Now Playing cover and the Queue's now hero: the song menu without the
   Play group, with Stop Station while a station plays.
4. Right-click an album tile in the Library, Home and Search. Each has Go to Album. In
   Search, Pin the album, then find it on Home's Pinned shelf; it plays.
5. Right-click an artist tile in the Library: Play Now plays their songs. On Home and in
   Search: Start Station is there. From Search, Play Now plays Apple's Top Songs. Copy Link
   on a Library artist copies an `/artist/` link.
6. Right-click a playlist in Search: Pin it. It shows on the Playlists card's Pinned shelf;
   a press plays it, and On Click › Open opens its Search pane. Copy Link on one of Apple's
   playlists copies a `/playlist/` link.
7. Pick three songs in the Library (Ctrl+click) and right-click: "Play 3 songs", Play Next,
   Add to Queue, Add to Playlist. No Copy Link. The same on a genre tile, with "Play Now".
8. Start a Web from a song, an album and a Library artist. With Settings › Notices at
   Everything, the toast shows the steps. The row flies to Playlists and the new Temp web
   opens. Change Size in the web panel, then start another: it has the new size.
9. Right-click the song in the tray panel: Start Station · Copy Link · Add to Library ·
   Favorite · Pin. Pin it; right-click again: Unpin.
10. Right-click a Home tile: Hide is the last row, under Pin.
11. (2026-09-27) Two dev apps, A playing a song B's library does not hold. On B, right-click
    A's box in the Friends panel: the §3.1 rows in the §2 order (Play Now · Play Next · Add to
    Queue · Add to Playlist ▸ · Go to Artist · Go to Album · Song Credits · Start Station ·
    Start a Web · Copy Link · Add to Library · Favorite · Mark as Song of the Day · Pin), then
    Copy their code · Rename, and Remove last; Invite to my room shows only while B hosts a
    room. Play Next queues the song after B's current one. Pin it: the tile on Home plays it.
    Stop A's playback: B's menu shows Copy their code · Rename · Remove alone.
