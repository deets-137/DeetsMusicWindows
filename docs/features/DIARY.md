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
- **A drop** (5B). An album dragged from any card onto the Diary opens its entry. A song or a
  playlist is refused (the card does not light up). The album's facts come from its first song,
  because a drag carries songs; the catalog id rides the payload's `albumId`.
- **Add to Diary** (5C). A row in group 5 (Keep) of `albumMenu`, after Add to Library. It uses
  the held-request bus (`requestDiaryAlbum` in layout-bus.ts), so the card is summoned and takes
  the album on mount or at once if it is on screen. A Search album's songs load only then.

**One entry per album.** The key is the catalog id, else the library id, else title + artist.
Picking an album that has an entry opens it, and the song list is replaced by the new one; notes
and scores stay (a song is keyed by its catalog id, else library id, else disc and track).

## 3. The store (schema v14, diary.rs)

`diary_entries` (one row per album: the album and song snapshot as JSON, `scale_max`, `score`,
`note`, `review_date`, times) and `diary_songs` (`entry_id` + `song_key`: `score`, `note`,
`note_date`). A song row with nothing left in it is deleted. Days are the user's local day as
`YYYY-MM-DD` text, written by the front end.

Not in the `query` export (LOCAL-DATA.md): a diary is private writing. Opening an agent to it is
an open fork (§7).

Commands: `diary_list` · `diary_get` · `diary_open(album, tracks, today)` · `diary_update(id,
patch)` · `diary_song_set(entry, key, patch)` · `diary_rescale(id, from, to)` · `diary_delete`.
A patch changes only the keys it holds; `null` clears.

## 4. The card

**Root.** The + cover (a shelf tile with no art, half again as big: `--diary-new-size`), then
"Your entries": a sideways shelf, the newest touched first. A tile reads "7.5/10 · 5 of 12 songs".
Right-click a tile: the album menu, and **Delete entry** last.

**Entry.** The header reads "Entry" with Back. In the scroll: the hero (cover, title, artist,
"12 songs · 5 written"), then the album line — the album score field, the **Out of 10** pill,
the review-date pill — the album note, Play / Shuffle, and the songs. Each song row shows its
number, title, a note mark when it has a note, and its score. Unreleased songs are dimmed as on
the Search album page (SEARCH.md §Unreleased songs). An entry for a pre-release album asks Apple
once on open for songs that came out since.

- A click on a row shows that song in the foot. A double-click plays the album from that row.
- **The foot** (6B): a play square (plays the album from this song), the song's title, its score
  field, its note, and its note-day pill. When a song from this album plays — from the Diary or
  anywhere — the foot moves to it. It never moves while you type in it: the move waits until the
  focus leaves the foot.
- Everything plays with the context `diary:<id>`.

**Saving.** A note saves 600 ms after the last key and on leaving the field. A score saves on
Enter or on leaving the field. A score that is not a number, or is above the top, is refused: the
field is marked in the accent and its hint says what to type. A song note's day is set to today
when its first word goes in; the pill changes it (Today · Pick a date… · No date).

## 5. The scale (fork 7B)

The **Out of N** pill opens a menu: Out of 10 · Out of 5 · Out of 100 · a field for your own top.
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

- An agent reading the Diary (the MCP `query` tool, a Diary verb). Off until he decides.
- Compass: the card is reachable (automatic). No "Add this album to the Diary" verb yet.
- Export or share an entry.

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
6. Change the scale to Out of 5: the toast asks. Keep numbers: the 7.5 is marked. Change again
   and Rescale: 7.5/10 becomes 3.75/5. Set Settings › Diary › Rescale scores to Always and
   change the scale: no toast, the scores move.
7. Type 2.6767 in a score on a /5 scale: it stays 2.6767.
8. Back: the shelf shows the entry with its score and "N of M songs".
9. Right-click an album in Search › Add to Diary: the Diary comes on screen at that album.
   Drag an album from the Library onto the Diary: it opens. Drag a song: the card does not light.
10. Open OPIA by VITA from the + search: ten songs dimmed.
11. Restart the dev app: the entry, notes, scores and dates are all there. Right-click the tile ›
    Delete entry › Delete: it is gone.
