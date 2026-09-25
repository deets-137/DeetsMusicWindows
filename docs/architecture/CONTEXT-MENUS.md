---
status: shipped
shipped_in: 0.14.0
desk_test: passed 2026-09-23
sources: [src/media-menu.ts, src/context-menu.ts, src/web.ts, src/copy-link.ts, src/go-to.ts, src/pins.ts, src/np-bus.ts, src/tray.ts]
updated: 2026-09-23
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
| 1 | Play | Play Now · Play Next · Add to Queue |
| 2 | File | Add to Playlist ▸ |
| 3 | Go to | Go to Artist · Go to Album · Go to Playlist · Song Credits |
| 4 | Seed | Start Station · Start a Web · Copy Link |
| 5 | Keep | Add to Library · Add to Diary (albums) · Favorite · Mark as Song of the Day · On Click ▸ · Pin |
| 6 | The card's own rows | Move to Top / Bottom · Move to Folder ▸ · Refresh ▸ · Stop Station · a pick's note … |
| 7 | Take away (last) | Remove · Remove from Playlist · Hide · Delete Playlist |

Two menus put a row ABOVE group 1, both by an earlier decision of the owner: the Playlists
card's **Rename** field (PLAYLISTS.md §10.2, "the field first, ready to type") and the Song
of the Day suggestion's **Mark** (DeetsOTD.md §8.6, the row the tile exists for).

## 3. The menus

### 3.1 Song — `songMenu`
Play Now · Play Next · Add to Queue · Add to Playlist ▸ · Go to Artist (▸ when several, in
the Library) · Go to Album · Song Credits · Start Station · Start a Web · Copy Link · Add to
Library · Favorite · Mark as Song of the Day · Pin.

- A song has no song view, so it never shows "Go to Song". It goes to its artist and album.
- **Pin pins the song**, wherever the row sits — inside an album view too (fork 3A).
- **The song that is playing** (Now Playing, the Queue's now hero) has no Play group, and adds
  **Stop Station** while a station plays.
- The **tray panel** has no cards, so it has no Play and no Go to group: Start Station · Copy
  Link · Add to Library · Favorite · Pin (fork 6A). The main window runs each row
  (`np_command`, np-bus.ts).

### 3.2 Album — `albumMenu`
Play Now · Play Next · Add to Queue · Add to Playlist ▸ · Go to Artist · Go to Album · Start a
Web · Copy Link · Add to Library · Add to Diary · On Click ▸ · Pin.

- **Add to Diary** (2026-09-24, [DIARY.md](../features/DIARY.md) §2): summons the Diary card at
  the album's entry, making it the first time. Left out inside the Diary itself (`inDiary`).
- An album has no station (Apple seeds stations from songs and artists).
- **Go to Album on an album tile** (fork 2B): every card shows it. In the Library it drills in
  place; elsewhere it opens the Search album pane.
- Go to Artist is left out on an album tile inside that artist's own view.
- A Search album holds no songs until they load. Its pin key comes from the album's own cover
  (`album:<title> <cover>`, the rule `albumKey` applies to a song), and the songs load on
  the press. A Home "New" tile has no Pin row (a release that is not out has no songs).

### 3.3 Artist — `artistMenu`
Play Now · Play Next · Add to Queue · Add to Playlist ▸ · Go to Artist · Start Station · Start
a Web · Copy Link · On Click ▸ · Pin.

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
Play Now · Play Next · Add to Queue · Add to Playlist ▸ (not itself) · Go to Playlist · Copy
Link · On Click ▸ · Pin.

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
| Queue | station row | Stop Station, or Don't resume (not a media menu) | — |
| History | row · picked rows | group 1 plays the play record by its handle | — |
| Playlists | playlist row | Move to Folder ▸ · Refresh ▸ · Import to Edit (Apple) · Keep Playlist · the cover rows | Delete Playlist |
| Playlists | song in a playlist | — | Remove from Playlist (hand-made only) |
| Home | any tile | Songs of the Day: the pick's note · Post Now · Withdraw · Unmark | Hide |
| Rewind | pick row | the pick's own rows | — |
| Radio | station | — | — |

Menus that are not media menus keep their own rows: Search term pills, Playlists folder
headers, the card title (Grow ▸ · Fill · Pin · Collapse — fork 7B keeps its "Pin"), Friends
rows (Play Now · Go to Album · Invite · Copy their code · Rename · Remove), Settings › My
reports (Open · Copy Link · Close · Clear), text fields (Cut · Copy · Paste · Select All).

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
