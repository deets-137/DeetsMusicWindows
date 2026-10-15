---
status: idea
desk_test: none
sources: [src/info-box.ts, src/present.ts, src/library-model.ts, src/media-levels.ts, src/listeners.ts, src-tauri/src/apple.rs, src-tauri/src/model.rs]
updated: 2026-10-15
---
# Album notes — Apple's editorial notes in the album's facts box

> An idea (2026-10-15), not built; every fork closed the same day (§3). His sketch: the album's
> facts box shows Apple's short note from the start, in the empty cell under Tags. A click on it
> opens the full note, the same way a click on Listening Stats opens presentation mode. Where the
> note names a song, the song's name is a mention you can act on. §1 is what Apple gives (probed
> live); §3 his calls. §6 is a second finding from the same screenshot: the album's artist line,
> and Apple's own album artist at zero extra calls.

## 0. Terms

- **Facts box**: the 2 × 2 box beside an album's hero (`src/info-box.ts`, LISTENERS.md §7):
  Tags · Listening Stats / About · Links. Its data is Last.fm's today.
- **About cell**: the bottom-left cell. It shows the first two sentences of Last.fm's wiki, or
  nothing when Last.fm has no wiki (Rrromeo: empty, the orange box in his screenshot).
- **Editorial notes**: Apple's `editorialNotes` on a catalog album: `short`, `standard`,
  `tagline`. Apple Music's editors write them; some quote the artist at length.
- **Short note**: `editorialNotes.short`, one line.
- **Full note**: `editorialNotes.standard`, the long text.
- **Mention**: a song's name inside the full note, shown so it can be clicked.
- **Hop**: the call from a library song to its catalog album (FULL-LIB.md §3).

## 1. What Apple gives (probed live, 2026-10-15)

Read-only calls with the app's tokens, storefront `us`, album **Rrromeo** by Girl Ultra
(catalog `6782852893`, released 2026-10-09; Apple spells it *Rrromeo*, the notes *RRROMEO*).

**The album's attributes:** `artistName` (Girl Ultra), `artwork`, `copyright`,
`editorialNotes`, `genreNames`, `isCompilation`, `isComplete`, `isMasteredForItunes`,
`isSingle`, `name`, `playParams`, `recordLabel`, `releaseDate`, `trackCount`, `upc`, `url`.

**`editorialNotes`:**
- `tagline`: "New Album and Interview".
- `short`: "The CDMX artist dives into ’80s pop: “I loved its sense of eroticism.”"
- `standard`: about 900 words. An editor's introduction (three paragraphs), then "Below, Mariana
  de Miguel walks Apple Music through the eight songs on *RRROMEO*", then one part per song: the
  song's name in bold on its own line, then her words in quotes. All eight songs have a part.
- **The format.** Paragraphs split by `\n\n`. `<i>` for the album's name, `<b>` for each song's
  name, both in the song parts' headings and in the running text (`<b>“Denisse”</b>`). Curly
  quotes. A heading can carry a credit: `<b>“Mentirasmentiras” (feat. Buscabulla)</b>`.
- **Names in the note do not match Apple's track names letter for letter:** the note says
  *“RRRomeo”*, the track is *Rrromeo*; *“¡El groove de Romeo!”* against *¡El Groove De Romeo!*.
  So a mention is matched after folding case, accents, quotes and punctuation.
- The note names one song that is not on this album: *“BOMBAY”* (2022).

**The songs** (in the album's `tracks`): `composerName`, `isrc`, `hasLyrics`,
`isAppleDigitalMaster`, `previews`. No notes per song.

**Extended attributes:** `extend=editorialVideo,editorialArtwork` on the album returned 200 with
neither (this album has no motion cover). On an artist, `editorialArtwork` is refused: HTTP 400,
code 40012, "'editorialArtwork' entities require permissions that are not in the request".
Apple's own web app has a token with more rights than ours.

**The artist** (Girl Ultra, `1207957662`): `name`, `artwork`, `genreNames`, `url` only. No
`editorialNotes`. `extend=artistBio,bornOrFormed,origin,isGroup` returned 200 with all four
empty. **An artist bio is not on offer to us**, at least for this artist.

**Not yet known:** how many albums carry notes. A new album with an interview is the best case.
A sample of his library answers it (§5).

## 2. The shape (his sketch)

1. **The About cell shows the short note from the start.** On Rrromeo the cell is empty today,
   because Last.fm has no wiki for it.
2. **The cell is clickable, as Listening Stats is.** A click opens the full note. In Max,
   Listening Stats fills Max with the card and grows the stats over it (`present.ts`,
   PresentationMode.md); the note would use the same mechanics.
3. **Mentions.** Where the full note names a song, the name is woven in as a mention. The song
   parts' headings are rows of their own.

## 3. His calls (2026-10-15)

> **Part:** designed · 2026-10-15

- **N1: Apple's notes only.** Last.fm's wiki leaves the About cell entirely ("scrub Last.fm's
  notes"). The cell shows Apple's short note, or nothing. Not taken: Apple first with Last.fm as
  the fallback; Last.fm first; both.
- **N2: every surface.** In Max, the card fills and the note grows from the cell, as Listening
  Stats does. In Midi and Mini, the note opens over the card's song list, inside the card. Not
  taken: Max only.
- **N3 = A: a mention plays that song, with the album as the context** (the album from that song,
  as a click on the album's song row does). The note stays open, so you can read about a song
  while it plays. Right-click gives the song's own menu (`media-menu.ts`, CONTEXT-MENUS.md). Not
  taken: go to the song's row; a small menu.

## 4. What follows (no fork)

**The data.**
- `model.rs` `Album` gets `notes: Option<AlbumNotes>` (`short`, `standard`, `tagline`), read in
  `album_from_catalog` (`apple.rs:1666`). The Search pane's album and the Full level read the
  catalog album already, so there the notes cost **0 calls**.
- **A Lib album needs the hop:** 1 call (song → its catalog album, the attributes come with it),
  the same hop the Full level makes (FULL-LIB.md §3). It runs when the album page opens, in the
  background, like the Last.fm ask. **1 call per album, the first time only:** the notes go in a
  new table (`album_notes`: catalog album id, the three fields, `fetched_at`), kept a month, as
  `listen_counts` is (LISTENERS.md). An album with no notes is stored as *none*, so it is not
  asked again within the month.
- The hop and its count go through `apple_calls.rs` (APPLE-CALLS.md), as a background job.

**The box.**
- **Last.fm's wiki goes (N1).** `albumInfoHTML` no longer draws the About from `i.wiki`;
  `wikiSentences` and `ABOUT_SENTENCES` go if nothing else uses them; `ALBUM_INFO_HINTS.about`
  becomes Apple's. The `album_info.wiki` column stays (no schema change), unread. LISTENERS.md
  §7.2 and §7.3 get a line that the About is Apple's since this build.
- Today the box draws only when Last.fm answers *have*. With notes, it draws when either source
  has something (Last.fm's tags and counts, Apple's note); a missing section leaves its cell
  empty, as now.
- The box's Settings row (*Show album info on the album's page*, `showAlbumInfo`) covers the
  notes too: the notes are part of the box. Its hint, and the box's toggle hint ("Shows or hides
  Last.fm's facts about this album"), change to name both sources (ONBOARDING.md §1).
- **The cell keeps its size.** The short note is clamped to the cell's 4 lines, as the wiki was.
- An artist's box gets nothing: Apple gives no artist notes (§1).

**The full view on every surface (N2).**
- Max: `present.ts`'s mechanics (Fill, the grow from the cell, the way back into the cell).
  The view is a second kind of presentation beside the stats, not a copy of the module.
- Midi and Mini: the view covers the card's song list inside the card (the hero stays), with the
  same shrink square and Escape. On a narrow card the facts box is folded under *Album Info*; the
  note opens from the cell once the fold is open.
- Card memory (CARD-MEMORY.md): an open note is in the card's `snapshot()`, so the card comes
  back with it open.

**The full note.**
- **Apple's HTML is never set as HTML.** The text is split on `\n\n` into paragraphs, and only
  `<i>` and `<b>` become elements; every other tag is dropped and every entity decoded. The DOM
  is built from text nodes (no `innerHTML` of Apple's string).
- **Mentions:** each `<b>` whose text, folded (case, accents, quotes, punctuation, a trailing
  `(feat. …)`), equals a track name of this album is a mention. A `<b>` alone in its paragraph
  is a **song heading**: a row with the song's number and a play mark, then her words under it.
  A `<b>` inside a sentence is an inline mention.
- **A name not on this album** (*“BOMBAY”*) is matched at the click, by one catalog search for
  the artist and the name (no call until it is clicked). No match: plain bold text.
- The view names its source: Apple's `tagline` as the kicker above the title, and a "From
  Apple Music" line at the end. The note is shown as Apple sends it, not cut or rewritten.
- Keys: the view takes `wireListKeys` over its song headings (`src/list-keys.ts`); Escape
  closes it; reduced motion is a plain show.
- `diag.log` the hop and its answer (`notes: <album> have|none`).

**Apple's terms.** The notes are MusicKit Content (VINYL.md §10 quotes §3.3.6.D). Showing them
whole and naming Apple is the reading the app already uses for covers. Not cut, not rewritten.

## 5. Probes before the build

1. **How common notes are.** Sample 100 albums from his library: their catalog ids from the
   songs (`songs?ids=…&include=albums`, 1 call for up to 300 songs), then read the notes. Count
   *short only*, *short and standard*, *track-by-track* (a `<b>` line per song), *none*. Report
   by release year.
2. **Other storefronts.** Read Rrromeo in `mx` (her home storefront) and with `l=es-MX`: is the
   note translated, missing, or the same English text?
3. **Other tags.** Look for any tag but `<i>` and `<b>` (a `<br>`, a link) in the sample.

## 6. A second finding: the album's artist line

**His question (2026-10-15):** the screenshot's hero says *Girl Ultra, Buscabulla & Chromeo*,
the credit of one song (*Mentirasmentiras*), not the album's artist (*Girl Ultra*). Can it be
fixed with no extra calls?

**The cause (read 2026-10-15).** A Library album is not an Apple album record: `groupAlbums()`
(`src/library-model.ts`) groups the library songs by album name and cover, and takes the album's
artist as the **most common song artist**. His library has 2 of the 8 songs: *Mentirasmentiras*
(*Girl Ultra, Buscabulla & Chromeo*) and *Denisse* (*Girl Ultra & Chromeo*). One vote each: the
song met first wins, so the line can change between runs. The database shows it did:
`album_info` holds two rows for this album, one under each credit.

**All 8 of the album's credits** (from `song_credits`, written when the Full level read the
album): *Girl Ultra* ×2, *Girl Ultra & Chromeo* ×3, *Girl Ultra, Buscabulla & Chromeo*,
*Girl Ultra & Jean Tonique*, *Girl Ultra, Chromeo & Empress Of*. Every one starts with
*Girl Ultra*.

**First thought, set aside: a rule.** The longest lead credit all songs share (*Girl Ultra*).
His call (2026-10-15): no rule-based guess. An artist with a comma, an `&` or an `x` in the name
(*Earth, Wind & Fire*, *Simon & Garfunkel*, *Tyler, the Creator*), or a duo album, can defeat any
rule. He asked for Apple's official album artist, cached.

### 6.1 Apple's album artist, at zero extra calls (probed live, 2026-10-15)

> **Part:** designed · 2026-10-15

**The probe.** The library sync reads `me/library/songs?limit=100&offset=…&sort=…`
(`apple.rs:1801`, `songs_page`). The same page with **`&include=albums`** returns, on every song,
its **library album**: `artistName`, `artwork`, `dateAdded`, `genreNames`, `name`, `playParams`
(`{ id: "l.rhcK5bw", kind: "album", isLibrary: true }`), `releaseDate`, `trackCount`.
- 100 of 100 songs came back with their library album, and each album carried `artistName`.
- Rrromeo: *Mentirasmentiras* (song: *Girl Ultra, Buscabulla & Chromeo*) and *Denisse* (song:
  *Girl Ultra & Chromeo*) both point at library album `l.rhcK5bw`, artist **Girl Ultra**.
- **Cost:** the same number of calls. The page grows from 63 KB to 121 KB and took 1.24 s
  against 0.95 s (one sample each, the newest 100 songs).
- The library album record exists for every library song, catalog or not (an upload too), so
  it does not depend on the catalog.
- It carries no catalog album id (`playParams` has the library id only). The notes still need the
  catalog album (§4).

**Also seen:** `catalog/{sf}/songs?ids=…&include=albums&fields[albums]=name,artistName,editorialNotes`
returns each song's catalog album with Apple's album artist and the notes, trimmed to those
fields: 99 ids in one call, 99 songs back, 137 KB, 0.36 s. That is a bulk path for the notes
(one song per album, about 100 albums a call) if opening albums one by one ever costs too much.

### 6.2 What follows (no fork)

- **The sync adds `include=albums`** to its song pages, the full pass and the incremental pass.
  With the primary artist (apple-calls.md §5) it is one change:
  `include=albums,artists&fields[library-albums]=name,artistName&fields[library-artists]=name`,
  106 KB a page (apple-calls.md S4).
  `track_from_library_song` reads the song's album relationship into two new `Track` fields:
  `albumArtist` (the library album's `artistName`) and `libraryAlbumId` (`l.…`). They are stored
  in the track's JSON in `tracks` (no new table, no schema change).
- **`groupAlbums()` names the album by `albumArtist`** when its songs carry one. The vote stays
  only for songs with no album artist (a catalog song in a queue or a playlist, never synced as a
  library song). Rrromeo then reads *Girl Ultra* on every run.
- `libAlbum()` (`library-model.ts:93`, the album's right-click menu) takes the same artist, not
  the first song's.
- **Last.fm asks by the album's artist**, so one album is one `album_info` row (Rrromeo has two
  today, one per song credit). The old rows age out; nothing reads them.
- **The backfill.** Songs already cached carry no album artist until a full pass re-reads them.
  A full pass runs at most every 7 days, or when Apple's song count changes, or on the Library
  card's refresh button (FUTURE-SETTINGS.md §21, DATA-ARCHITECTURE.md §5a). No extra pass is
  forced: until then, an album shows the vote, as today.
- **`albumKey` does not change.** Home's hide keys, pins and the Diary are keyed on it. Keying
  albums by `libraryAlbumId` (the true album identity the comment in `library-model.ts` waits
  for) is a later step with its own migration.
- The web demo's TypeScript twin of the normalizers (WebRooms.md §9.3) gets the two fields, and
  the shared fixture its `relationships.albums` sample.
- A unit test with Rrromeo's two songs: one album, artist *Girl Ultra*.

## 7. Draft (his to edit)

- The About cell's heading: **About** (as now).
- The cell's hint: "From Apple Music's notes on this album".
- The full view: the tagline (*New Album and Interview*) small above the album's title; the
  short note as the first line in larger type; the full note; "From Apple Music" at the end.
- Cache: a month, as Last.fm's counts.
