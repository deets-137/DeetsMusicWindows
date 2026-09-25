---
status: built
desk_test: open
sources: [src/diary-card.ts, src/diary.ts, src/styles/diary.css, src-tauri/src/diary.rs, src/layout-bus.ts, src/media-menu.ts]
updated: 2026-09-24
---
# DeetsMusic — the Diary card

> An album journal. You pick an album, you listen, and you keep a note and a score for each
> song and for the whole album. Everything stays on this PC.

**Terms.** An **entry** is one album in the Diary. A **scale** is the top of the score range for
one entry ("out of 10"). The **foot** is the note panel fixed under the song list.

## 1. His calls (2026-09-24)

| Fork | Call |
|---|---|
| 4 More than one album | **A** — the card opens on the + cover, with a shelf of past entries under it |
| 5 How to pick an album | **A + B + C** — a search field in the card, a drop on the card, Add to Diary on every album menu |
| 6 Notes while you listen | **B** — a note panel at the foot. It follows the song that plays, or the row you click |
| 7 A scale change | **B** — the numbers stay as typed. A toast asks whether to rescale, and a Settings row sets the default |
| 8 Dates | **B** — a date for the entry (the review), and a date on each song note |

The scale presets: /10 (the default), /5, /100, or any top above 0 typed in. A score is any
number from 0 to the top: 3/10 and 2.6767/5 are both valid.

## 2. The ways in

- **The + cover** (5A). A press opens a search field in place of the cover. Typing lists your
  library albums first (no Apple call), then Apple Music albums (one catalog search per pause in
  typing, 300 ms). Escape or × closes it.
- **The morph** (polish 2026-09-24, his ask). A press on the + cover turns its square into the
  search bar: a stand-in box on `<body>` travels from the cover's place, size, corner and fill
  to the field's, and the real field fades in as it lands. × or Escape runs it back. Tokens
  `--diary-morph-dur` (the skin's `--nav-dur` × 1.4) and `--diary-morph-ease`. Reduced motion
  snaps.
- **The header +** (polish 2026-09-24, his ask): the Playlists + shape — two labelled fields,
  **Entry** and **Folder**. The Entry field searches as you type (library first, then Apple
  Music) and the menu grows downward with the answers: covers, titles, and "In your library" or
  the year. Enter opens the first answer. This is a new, optional part of the menu primitive:
  `InputItem.onInput` (context-menu.ts), with result rows that carry `art` and `note`; tokens
  `--menu-search-w`, `--menu-results-max-h`, `--menu-grow-dur`, `--menu-grow-ease`.
- **A drop** (5B). An album dragged from any card onto the Diary opens its entry. A song or a
  playlist is refused (the card does not light up). The album's facts come from its first song,
  because a drag carries songs; the catalog id rides the payload's `albumId`.
- **Add to Diary** (5C). A row in group 5 (Keep) of `albumMenu`, after Add to Library. It uses
  the held-request bus (`requestDiaryAlbum` in layout-bus.ts), so the card is summoned and takes
  the album on mount or at once if it is on screen. A Search album's songs load only then.

**One entry per album.** The key is the catalog id, else the library id, else title + artist.
Picking an album that has an entry opens it, and the song list is replaced by the new one; notes
and scores stay (a song is keyed by its catalog id, else library id, else disc and track).

## 3. The store (schema v14 + v15, diary.rs)

v15 adds `done_at` and `folder_id` to `diary_entries` and the `diary_folders` table (§4b).


`diary_entries` (one row per album: the album and song snapshot as JSON, `scale_max`, `score`,
`note`, `review_date`, times) and `diary_songs` (`entry_id` + `song_key`: `score`, `note`,
`note_date`). A song row with nothing left in it is deleted. Days are the user's local day as
`YYYY-MM-DD` text, written by the front end.

Not in the `query` export (LOCAL-DATA.md): a diary is private writing. Agents reach it only
through `/diary`, behind its own switch (§10).

Commands: `diary_list` · `diary_get` · `diary_open(album, tracks, today)` · `diary_update(id,
patch)` · `diary_song_set(entry, key, patch)` · `diary_rescale(id, from, to)` · `diary_delete`.
A patch changes only the keys it holds; `null` clears.

## 4. The card

**Root.** The + cover (a shelf tile with no art, half again as big: `--diary-new-size`), then
"Your entries": a sideways shelf, the newest touched first. A tile reads "7.5/10 · 5 of 12 songs".
Right-click a tile: the album menu, and **Delete entry** last.

**Entry.** The header reads "Diary: <album name>" with Back (his call 2026-09-24; the title's
ellipsis cuts a long name, and its hover hint gives the whole name). In the scroll: the hero (cover, title, artist,
"12 songs · 5 written"), then the album line — the album **score split pill** on the left
(the number you type | "/ 10 ▾", the scale's menu), the review-date pill at the right end — the
album note, Play / Shuffle, and the songs. (Polish 2026-09-24, his call: the separate "Out of
10" pill is gone; the scale lives in the score pill's right half.) Each song row shows its
number, title, a note mark when it has a note, and its score. Unreleased songs are dimmed as on
the Search album page (SEARCH.md §Unreleased songs). An entry for a pre-release album asks Apple
once on open for songs that came out since.

- A click on a row shows that song in the foot. A double-click plays the album from that row
  (an unreleased row toasts its date). The click moves the selected mark in place
  (`paintSel`), never rebuilding the rows: a rebuild between the two clicks put the second on a
  new element, and the browser sent no dblclick (seen 2026-09-24).
- **The foot** (6B): one head row — a play square (plays the album from this song), the song's
  title, its note-day pill, its score pill — then its note. A song's score pill shows the scale
  as text ("/ 10"); the scale is changed only on the album's pill, because one scale covers the
  entry. When a song from this album plays — from the Diary or
  anywhere — the foot moves to it. It never moves while you type in it: the move waits until the
  focus leaves the foot.
- Everything plays with the context `diary:<id>`.

**Saving.** A note saves 600 ms after the last key and on leaving the field. A score saves on
Enter or on leaving the field. A score that is not a number, or is above the top, is refused: the
field is marked in the accent and its hint says what to type. A song note's day is set to today
when its first word goes in; the pill changes it (Today · Pick a date… · No date).

## 4a. Grow on open, the first song, the song menu (polish 2026-09-24, his asks)

- **Grow on open** — Settings › Diary (`diaryGrow`): **New entries** (default) · Every entry ·
  Never. When it applies, the card grows over ONE neighbour: up or down in Max, left or right in
  Midi (`growCardTaller` in card-grow.ts). It obeys Settings › Window › Grow cards from edges,
  does nothing in Mini, and leaves a card that is already grown alone. `diary_open` returns
  `created: true` only when it made the entry, so "New entries" means the first open only.
- **Back collapses a grow the entry made.** A grow you made yourself stays.
- **The foot waits for a song.** A new entry starts with its first song picked (it grew, so there
  is room). A reopened entry starts on the song that plays, when it is on this album, else on
  none, and the foot is not drawn. The first pick slides the foot in (`enterRows`).
- **Right-click a song row:** the song menu (`songMenu`), context `diary:<id>`. Play Now plays
  the album on from that song when Settings › Playback says so. An unreleased song gets Go to
  Artist only.

## 4b. Done, rows and folders (built 2026-09-24, schema v15; his calls below)

| Fork | Call |
|---|---|
| The two status rows and your folders | **Status always, folders extra.** In progress and Completed always show every entry by its Done state. A folder is an extra group: an entry filed in one shows there too. One folder per entry |
| A second press of the check | **Toggles back** to in progress |
| Order | **End, all movable.** In progress, then Completed, then your folders oldest first. Every row header moves by hold, the two built-ins too |
| Moving between rows | **Menu and drag** |

- **The check** (`#diary-done`, an icon square at the header's right, where Playlists has
  Refresh): shown only in an entry. Pressed (`is-active`) while done. A press toggles
  (`diary_set_done`, `done_at` = the time or NULL). Every finish goes through `diarySetDone`,
  which fires `onDiaryDone` — the hook for what he wants to attach to a finish (§7).
- **The + on the home page** (`#diary-add`): a menu with an **Entry** field that searches
  (§2) and a **Folder** field (makes a folder; it appears at the end).
- **The rows.** Each row is a header in the Playlists voice (`.lib-shelf--toggle`: chevron,
  name, count) and a sideways shelf of tiles. A click on a header folds the row
  (`deets.diary.collapsed`, localStorage). An empty row says how to fill it and still takes a
  drop. In a folder row, a finished entry wears a check in the tile-badge corner.
- **Arranging** (row order, `roworder.rs`): hold a header, then move it — the row moves among
  the rows (`diary.sections`; needs Settings › Window › Move sections by holding). Drag a tile
  along its row to reorder it (`diary.row:<key>`). Drag it into another row: Completed marks it
  done, In progress marks it in progress, a folder files it there (out of its old folder); it
  lands where you dropped it. Over another card, the tile is the album (Now Playing plays it).
- **Right-click a tile:** the album menu, then Mark as done / Mark in progress and **Move to
  Folder ▸** (a New folder field, the other folders, Remove from Folder), then Delete entry.
  **Right-click a folder header:** Rename (a field), Delete Folder — its entries stay in their
  status rows. The built-in headers have no menu.

## 10. Export, the Compass, the CLI and agents (built 2026-09-24; his calls below)

**Export** (right-click a tile or the hero › Export; Ctrl+Enter on a Compass Diary row) copies
one text, made in Rust (`export_text`) so every path gives the same words:

```
## OPIA by VITA | 7.5/10
Sep 24, 2026
The album note.

## 3. PLEASER | 8/10
Sep 25, 2026
The song note.

https://music.apple.com/album/6801682028
```

His calls: the album heading carries the artist, joined by **"by"**; a song heading is
`## <track number>. <title> | <score>` (**3. PLEASER | 8/10**). Anything missing is left out. A
song with no note and no score is left out whole. A song's date shows only when it differs from
the review's. The link needs the album's catalog id: a library album finds it from one of its
songs (one memoized song → album hop) when it opens, and an older entry finds it on its first
Export; the entry is then re-keyed by that id (`open_entry` looks under the old key).

**The Compass** (his picks: entries, Add to Diary, Export):
- A **Diary** group: type an album's name — its entry is a row (score and status on the second
  line). Enter opens it (the held request `requestDiaryEntry`); Ctrl+Enter copies its Export.
  Built from the list the Diary last read (`diaryCachedList`), dropped on every write.
- **Add to Diary** in Actions while a song plays: the playing album, as the album menu's row.

**Agents and the CLI** (his call: **read and write, behind a switch**). Settings › Connections ›
**Agents use the Diary** (Rust `agent_diary`, off by default; an agent may only turn it off).
Route `GET/POST /diary` (AGENT.md), CLI `deetsmusic diary`, MCP tool `diary` (full pack):
list · show (the export text) · add (album:…) · note · score · date · done. `song` is a track
number; without it, the album. A write emits `diary-changed`, and the window redraws.

## 5. The scale (fork 7B)

The right half of the album's score pill ("/ 10 ▾") opens a menu with four rows only: 5 · 10 ·
100 · a field for any other top.
What happens to the scores already there is Settings › Diary › **Rescale scores**
(`diaryRescale`):

- **Ask** (default): the scale changes and the numbers stay. A sticky toast asks: *“OPIA” is now
  out of 5. Rescale its 6 scores too? 7/10 becomes 3.5/5.* **[Rescale] [Keep numbers]**.
- **Always**: the scores move in proportion at once.
- **Never**: the numbers stay, and no toast.

A score above the new top is marked (the field's accent border, an underline in the row) until
you type a new one or rescale.

## 6. Decided inside his choices (list for his review)

- Built by hand, not on the collection engine: the engine scrolls the whole pane, and 6B needs a
  fixed foot.
- One entry per album; a second pick reopens it. No re-reviews (a second dated entry).
- A row click selects; a double-click or the foot's play square plays.
- The foot follows a song of this album played from ANY card, not only from the Diary.
- Notes and scores are allowed on unreleased songs (a first impression before release).
- Typing a score above the top is refused, not stored.
- The review date starts on the day the entry is made; song note days start on the first word.
- Delete asks with a sticky toast (Delete / Keep). There is no Undo.
- The card is always in the slot pickers (Rewind is gated by a setting; the Diary is not).
- The Settings section is new and wears the New badge. It is in no quick-panel group.
- Numbers show to four places at most (a rescale can make 3.3333).

## 7. Open forks

- **What else a finish triggers** — he has more to attach to marking an entry done (2026-09-24).
  The hook is `onDiaryDone` in diary.ts.
- Decided inside §4b (for his review): one folder per entry; a tile drags with a plain press
  (no hold — the header is the hold); a drop back into a status row changes only the status and
  leaves the folder; rows do not fold as they lift; Settings › Reset has no Diary order row yet.
- Decided inside §10 (for his review): Export's dates are "Sep 24, 2026" in English on every
  path (the CLI has no locale); the link is `music.apple.com/album/<id>` with no storefront (it
  opens in the reader's own region, as Copy Link does); an agent's `add` needs an `album:` id
  from search; an agent cannot delete an entry, change the scale, file into folders or rescale;
  an open entry redraws after an agent's write unless you are typing in it.

## 8. Desk test

1. Put the Diary card in a slot. It shows the + cover and "Pick an album, listen, and write about
   each song."
2. Press +, type an album you own. Your library rows show at once, then Apple Music rows. Pick
   one: the entry opens, the review date reads today, the foot shows the first song.
3. Type a note in the foot, then click another row: the first row gets the note mark, the foot
   shows the new song. Its day pill reads No date until you type.
4. Type 7.5 in the album score and press Enter. Type 11 in a song score: the field is marked.
5. Press Play. The foot moves with each song. Type in the foot while a song changes: the foot
   stays until you click out.
6. Press "/ 10 ▾" on the album's score pill and pick 5: the toast asks. Keep numbers: the 7.5 is marked. Change again
   and Rescale: 7.5/10 becomes 3.75/5. Set Settings › Diary › Rescale scores to Always and
   change the scale: no toast, the scores move.
7. Type 2.6767 in a score on a /5 scale: it stays 2.6767.
8. Back: the shelf shows the entry with its score and "N of M songs".
9. Right-click an album in Search › Add to Diary: the Diary comes on screen at that album.
   Drag an album from the Library onto the Diary: it opens. Drag a song: the card does not light.
10. Open OPIA by VITA from the + search: ten songs dimmed.
11a. Grow on open: in Max, make a NEW entry — the Diary grows taller over the card below or
    above, and the foot shows song 1. Back: it collapses. Reopen the entry: no grow, no foot
    until you click a song. Set Grow on open to Every entry and reopen: it grows. In Midi it
    grows wider.
11b. Right-click a song row: the song menu. On a dimmed row: Go to Artist only.
11c. Done and rows: in an entry press the check — it fills. Back: the tile is in Completed, not
    In progress. Open it, press the check again: back in In progress. Press + › Folder, name it:
    a row appears at the end. Drag a tile into it: it shows in the folder AND its status row.
    Drag a tile into Completed: it is done (the folder copy wears a check). Drag a tile along a
    row: it stays where you put it. Hold a header, move it up: the row moves. Right-click a
    folder header › Rename, then Delete Folder: its entries stay in their status rows.
11d. Export: write a note and a score on the album and on two songs, date one song another day.
    Right-click the tile › Export, paste: the layout above, the other day only on that song, the
    link last. Ctrl+Space, type the album: a Diary row; Ctrl+Enter copies the same text; Enter
    opens the entry. With a song playing, Ctrl+Space › Add to Diary opens its album.
11e. Agents: `deetsmusic diary` → the refusal. Turn on Settings › Connections › Agents use the
    Diary: `diary` lists, `diary show N` prints the export, `diary score N --song 3 8` writes and
    the open entry redraws.
11. Restart the dev app: the entry, notes, scores and dates are all there. Right-click the tile ›
    Delete entry › Delete: it is gone.
