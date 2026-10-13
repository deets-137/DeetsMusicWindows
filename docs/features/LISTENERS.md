---
status: built
desk_test: open
sources: [src-tauri/src/lastfm.rs, src/listeners.ts, src-tauri/src/lib.rs, src/now-playing-card.ts, src/settings-store.ts]
updated: 2026-10-13
---
# Listeners — how rare a song is, from Last.fm

> **Built 2026-10-12.** The read side (§3) and the badge on Now Playing (§4, his design) are
> built; the desk test (§4.3) is open. §4 is the as-built record: where it disagrees with §1–§3,
> it is the code.

**Terms**
- **Listeners:** the number of distinct Last.fm users who have scrobbled a song at least once.
- **Play count:** every scrobble of the song, from every user.
- **Rarity:** a low listener count. A user who cares about finding music few people hear
  wants to see it on the song.

## 1. Why, and why Last.fm

His ask (2026-10-12): show a listener count per song, so a user who cares can see how
"rare" a song is. The first thought was Genius. Checked: Genius has no play data. Its API
gives `stats.pageviews` (views of the lyrics page), a `hot` flag, annotation and pyong
counts. Those measure lyric reading, skew to rap and pop, need a title + artist fuzzy match,
and commercial use needs a paid license. Apple gives third parties no play counts. Spotify's
0 to 100 popularity score is behind the parked Spotify integration (PROVIDERS.md).

**Last.fm, his call.** `track.getInfo` returns `listeners` and `playcount` per song. The
app already holds a Last.fm API key ([LASTFM.md](../integrations/LASTFM.md) §2), so there is no
new secret, no new account, and no new terms: Last.fm's non-commercial terms already cover
the app. The data skews to Last.fm's scrobbling users, but it covers every genre and is the
only open source of distinct-listener counts.

## 2. The call

| Call | When | Parameters | Needs |
|---|---|---|---|
| `track.getInfo` | A song's counts are asked for and the cache has none under a month old | `artist`, `track`, `autocorrect=1` | the API key only; no session, so it works before the user connects an account |

It rides the same signed POST as every Last.fm call (`call` in lastfm.rs): Last.fm ignores
`api_sig` on a method that needs none, and one code path keeps the timeout, the user agent and
the error parse. `autocorrect=1` lands "Beyonce" and "Beyoncé" on one page, as Last.fm's own
correction does.

**Cost.** One call per song, once a month at most. A song pane opened twice makes one call.
Last.fm asks for about five calls a second on average; a user opening song panes by hand
cannot reach that. A background pass over the library is **not** built and is a fork (§5).

## 3. The read side

> **Part:** built · 2026-10-12

| Piece | Where | What |
|---|---|---|
| The table | `listen_counts` (`lastfm::init_tables`) | `track_id` (catalog id, else library id: the `play_stats` key) · `state` have / none · `listeners` · `playcount` · `url` · `fetched_at` |
| The command | `lastfm_listeners(track_id, artist, title)` in `lastfm.rs` | cache first on the database thread; one call when the row is missing or over 30 days old; the answer stored, then returned |
| Not found | error 6 | cached as `state = none` for the same month, so a song Last.fm does not know is not asked on every open |
| A network failure | `Err` | caches nothing; the next ask tries again. One `lastfm: listeners for … failed (…)` warning |
| No key in the build | `Ok(None)` | the dev build without `lastfm.json`; the UI shows nothing |
| The renderer | `src/listeners.ts` `listenersFor(track)` | a shared promise per song, so two callers in flight make one round trip; a failed call is dropped from the map |
| The number's shape | `fmtCount` | 1234 → 1.2K, 4 567 890 → 4.6M; under a thousand as is |
| Log line | `lastfm: listeners for <id>: have (N listeners, M plays)` | one per Last.fm answer |
| Backup | left out | a cache; BACKUP.md's list |

**Decided inside his choice** (for his review): the table name; a month before a re-read; a
not-found answer cached for the same month; the catalog-first key; `autocorrect=1`; the
signed POST reused; no artist call yet (§5 fork 2).

## 4. The badge on Now Playing (as built)

> **Part:** built · 2026-10-12 · desk test open (§4.3)

**His design (2026-10-12), every call his.** Not a row in the song pane: a badge on Now
Playing, in the place he drew.

| Place | Reads | Where |
|---|---|---|
| The full player (Midi and Max) | **N Plays** over **M Listeners**, two lines (his call) | at the right of the title block, spanning its three lines, inside the band. The same place in both layouts of the band: when the controls share the band, the badge sits above the ♥ and + squares |
| The Max card (the stage, not full) | **N Plays** | on the cover's bottom-right corner, inset by `--np-listen-inset` |
| Mini, Midi's strip, a station, a song with no id, a song Last.fm does not know | nothing | |

- **Plays** is Last.fm's all-time scrobble count for the song across all users, not this
  app's play count. **Listeners** is the distinct users who scrobbled it at least once (§0).
- **The row:** Settings › Playback › *Show play counts from Last.FM*, a toggle, **on** by default (his
  call). Off: no call is made, and the badge goes at once. The key is `showListeners`
  (SETTINGS.md §3, an agent spec in `agent-settings.ts`, a `NEW_MARKS` line). It is not a rule
  key: it decides what shows, not when.
- **A cut-off title slides** to its end while the pointer rests on it, at
  `--np-title-scroll-rate` px a second after `--np-title-scroll-delay`, and snaps back in
  `--np-title-scroll-back` when the pointer leaves (his call: the badge, or the card's width,
  may cut the title). Every
  surface, since the title is one element. Reduced motion: the ellipsis stays; the hover hint
  already carries the full title.

### 4.1 How it is built

| Piece | Where | What |
|---|---|---|
| Two elements, one paint | `now-playing-card.ts` `paintListen` | `#np-listen-cover` inside the cover box (`.np__art`, over the record's slots, `z-index: 2`) and `#np-listen-meta` as the fourth child of `.np__meta`; CSS shows the one for the place (`[data-surface="max"]` for the cover, `:root[data-player="full"]` for the meta) |
| The ask | `refreshListen` on every player state | the song's key (catalog id, else library id) is compared with the last; a new song paints nothing, then asks `listenersFor` and paints the answer only if the song is still the same |
| The title block | `.np__meta` is a grid since 2026-10-12 | `minmax(0, 1fr) auto`: the three lines in column 1, the badge in column 2 over rows 1–3. With the badge hidden it is the stack it was |
| The family | `.np__listen` in styles.css | the station chip's (`.np__station`): the panel wash, subtext type; `--np-listen-*` are aliases of the chip's tokens plus a radius, an inset, a gap, a line gap and a faint rim |
| The colors (his ask: legible in every skin, 2026-10-12) | `--np-listen-fill` / `--np-listen-ink` / `--np-listen-sub` in themes.css | the card's own pair (`--panel`, `--title`), fixed at `:root` so the band's remap of `--title` on the rows cannot reach the chip. Ocean overrides the fill with its card color at full strength (skin.css): its see-through cards left the chip as bare ink on the band. Checked by screenshot in the five skins |
| The click | `openUrl(c.url)` | the song's page on last.fm |
| The hints | `LISTEN_HINT_COVER`, `LISTEN_HINT_META` | ONBOARDING.md §1 |
| The title scroll | `.np__title-text`, `is-scrolling` | the text in a span inside the clipped title; `pointerenter` measures the overflow and sets `--np-title-shift` and `--np-title-scroll-dur` |

### 4.2 Decided inside his choices (for his review)

The row's words (*Show play counts from Last.FM*, his words 2026-10-12; its hint); the badge's two hint sentences; the
badge's look (the station chip's family), its radius and its faint rim; the two lines
left-aligned inside the chip; the Max badge inset (`--space-2`); the scroll rate (40 px a second) and delay
(350 ms); the quick way back on leave (`--dur-med`, after a slide back at the reading rate
left the title cut on the left for seconds in the first run); the scroll on every surface; the badge inside the cover box
rides its `aria-hidden`, so a screen reader hears only the full player's badge; a song
Last.fm does not know shows nothing (no "0 Plays"); the count's shape (`fmtCount`: 48K, 1.2M).

### 4.3 Desk test

**Claude's run, 2026-10-12, on his dev app over CDP (steps 1, 2, 3 and the scroll of 5 by
probe and screenshot; the rest his).** The Max badge sat on the cover's bottom-right corner;
the full-player badge at the right of the title block in both layouts of the band (Max: the
controls under the cover; Midi: on the band, the badge above ♥ and +); a long title slid at
the rate. Two fixes from the run: the cover badge is appended after the record player mounts
(`mountVinyl` empties the cover box, so the template's badge was gone); the way back after a
scroll is quick (it took the slide's own time, and the title stayed cut on the left).

1. Max, a song playing: the cover's bottom-right corner shows *N Plays* after a beat. Hover:
   the hint. Click: the song's Last.fm page opens in the browser.
2. Open the full player (Max): the badge on the cover goes; *N Plays | M Listeners* sits at
   the right of the title block in the band. Shrink the window until the controls move onto
   the band: the badge stays at the title block's right, above ♥ and +.
3. Midi, the strip: no badge. Open the full player from Midi: the badge beside the title.
4. Next song: the badge goes, then the new counts come. Log: one `lastfm: listeners for …`
   line per new song; a song heard twice this month writes none.
5. A station: no badge. A long title in the full player: rest the pointer on it, it slides to
   its end after a beat; move away, it slides back.
6. Settings › Playback › *Show play counts from Last.FM* off: the badge goes at once; Next: no log line.
   On again: the badge comes back for the song playing.
7. A song Last.fm does not know (an obscure library upload): no badge, one log line with
   `none`.

## 5. Open forks

1. **The word.** Closed 2026-10-12: *Plays* and *Listeners*, Last.fm's own words.
2. **A ratio.** `artist.getInfo` gives the artist's listeners. A song's listeners over the
   artist's says "rare for this artist" (a deep cut) against "rare" (an unknown artist).
   The artist call is built (§6, the facts box); the ratio itself is not shown anywhere. The
   rank from `artist.getTopTracks` is the other read: ideas/LastfmArtist.md.
3. **A background pass** over the library, so the Library card could sort by rarity. A few
   thousand calls once, then a month's drip. Not before the plain number has been seen.
4. **Off switch.** Closed 2026-10-12: Settings › Playback › *Show play counts from Last.FM* (§4).

## 6. The artist facts box (as built)

> **Part:** built · 2026-10-12 · desk test passed 2026-10-13 (§6.3, his) · **for release** (his call, later
> 2026-10-12): the DevTools flag (`deets.dev.artistBox`, `ARTIST_BOX_ON`) is gone. Its own
> row gates it: Settings › Playback › *Show artist info on the artist's page*
> (`showArtistInfo`, default On, independent of the badge's row). Off, no artist call is made.

**His design (2026-10-12), drawn on a screenshot of the Library artist view.** In an artist
view, the round photo moves to the left and a box sits on its right with two columns: Last.fm's
tags and an *On tour* marker, then the artist's plays and listeners. Play and Shuffle stay
under both. The Search artist view gets the same box.

### 6.0 What `artist.getInfo` gives (probed live, Pat Kalla & Le Super Mojo)

`stats.listeners` 2,648 and `stats.playcount` 11,005 (all time); `tags.tag` five names
(*funk*, *World Music*, *Pat Kalla*, *groove*, *worldwide groove*); `ontour` 0 or 1; `url`;
five `similar` artists (dropped today, ideas/LastfmArtist.md); a `bio` (not read). It needs
the API key only, like the song call.

### 6.1 How it is built

| Piece | Where | What |
|---|---|---|
| The table | `artist_info` (`lastfm::init_tables`) | `artist` (the name, lower case) · `state` have / none · `listeners` · `playcount` · `tags` (JSON) · `on_tour` · `url` · `fetched_at` |
| The command | `lastfm_artist_info(name)` in `lastfm.rs` | cache first on the database thread; one call when the row is missing or over 30 days old (`LISTENERS_TTL_MS`, shared with songs); error 6 cached as `none`; a network failure caches nothing |
| The renderer | `artistInfoFor(name)` in `listeners.ts` | a shared promise per name; `null` when the row is off (no call), no key, or no answer |
| The markup | `artistInfoHTML` in `artist-view.ts` | `.artist-info`: a 2×2 grid of `.artist-info__sec` sections, each a `.artist-info__h` header in the shelf label's voice (`.search__label`) over its facts (his sketch, 2026-10-12). **Tags** top left (up to five chips) · **Listening Stats** top right (**N** Plays, **M** Listeners on two lines, right-aligned) · **On tour** bottom left (a dot and *Touring now*; only when Last.fm says so) · **Links** bottom right (a *Last.fm ↗* text button; only with a `url`). A missing section leaves its cell empty (`grid-template-areas`). The box stretches to the photo column's height and the two rows share it evenly (`1fr 1fr`; his ask, 2026-10-12); wrapped under the photo it takes its own height. Nothing until the answer is `have` |
| The Library view | `Hero.aside` (collection-card.ts `heroHTML`) | the hero becomes `.lib-hero--aside`: a `.lib-hero__main` column (photo, name, meta) beside the box; `library-card.ts` asks on open and reloads the card when the answer lands |
| The Search view | `[data-artist-info]` in the inline hero (search-card.ts) | the same classes; the holder is filled when the answer lands |
| The click | `[data-artist-lastfm]` with `data-url` (the Links section's button; the counts are plain text since 2026-10-12) | the artist's Last.fm page (`openUrl`); handled in each card's click listener (collection-card.ts cannot import artist-view.ts, which imports it) |
| The layout | styles.css `.lib-hero--aside` | a wrapping row: on a card too narrow for both, the box folds under an *Artist Info* line below the photo column (The fold, above) |
| The tag chip | `.artist-info__tag` | the web panel chip's family (`.web__chip`, `--web-chip-radius`), on `--surface-hover` so it reads against the box's `--surface` |
| The tokens | `--artist-info-*` in skin.css | the gap to the photo column, the column gap, the row gap, the pad, the radius, the tags' wrap width, the on-tour dot |
| The gate | `showArtistInfo` (`artistInfoFor`) | Settings › Playback › *Show artist info on the artist's page*, its own row (his call, 2026-10-12); the badge's `showListeners` no longer gates it |
| The fold | `.artist-info-wrap` › `.artist-info__toggle` + `.artist-info__fold` › `.artist-info__fold-in` › `.artist-info` | a container query on `.lib-hero--aside` (≤ 560 px, raw: a query cannot read a token). Wide: the toggle is hidden and the box always open beside the photo. Narrow: one *Artist Info* line (shelf header voice, a turning ›) over a fold that grows `0fr → 1fr` and fades in (`--artist-info-fold-dur`); closed by default; the last choice kept in `localStorage["deets.artistInfo.open"]` (`artistInfoOpen` / `toggleArtistInfo` in listeners.ts, his call). The Search holder is `display: contents` so the wrap is the flex item there too |
| Log line | `lastfm: artist info for <name>: have (N listeners, M plays, K tags[, on tour])` | one per Last.fm answer |

### 6.2 Decided inside his choices (for his review)

The box's look (a `--surface` box with the panel border and the control radius); the tag chip
family; the *On tour* marker as a dot and the word in the title's weight, above the tags; the
counts as one button on two lines, the number in the title's type; the three hints; the wrap on
a narrow card; the lower-cased name as the cache key; the five tags as Last.fm returns them;
the same Settings row, not a second one; nothing shown for an artist Last.fm does not know.

**The sections pass (2026-10-12, his sketch and four answers):** headers *Tags* and *Listening
Stats* in the shelf header style; *On tour* is the bottom-left section; the bottom-right
section is *Links* and holds the Last.fm page. Decided inside those: the box fills the row
beside the photo; the right column right-aligned (as sketched); the On tour body reads
*Touring now* with the dot; the link reads *Last.fm ↗* in the title ink, underlined on hover;
a missing section leaves its cell empty so the others keep their corners; the counts hint lost
its "Opens…" clause and the link has its own hint.

**The fold and the row (2026-10-12, his four answers):** the DevTools flag removed; the row
on by default and independent of the badge's; the open / closed choice remembered; the closed
line is the shelf header with a caret. Decided inside those: the narrow width (560 px of
hero); the row's words and hint; its place under the badge's row in Playback, with a New mark;
the fold's 240 ms grow with a fade; the line's hint; on a narrow card the box takes its own
height (not the shared halves); localStorage, not a setting, for the open state (a per-viewer
convenience no agent needs).

### 6.3 Desk test

1. Library › an artist with Last.fm presence: the photo moves left, the box appears on its
   right after a beat with tags, maybe *On tour*, and the two counts. Play / Shuffle stay full
   width under both.
2. Click *Last.fm ↗* under Links: the artist's Last.fm page opens in the browser. Hover a tag,
   the marker, the counts and the link: the four hints.
3. Search › an artist: the same box beside the photo. Library › an artist › **Full**: the
   same box (the Full level, `library-full.ts`, had none before 2026-10-12).
4. Midi (a narrow card): under the photo column, one *ARTIST INFO ›* line, closed. Click it:
   the box grows open under it and the caret turns; nothing is cut. Open another artist: it is
   open. Click to close, restart the app, open an artist: closed. Grow the card wide: the line
   goes and the box stands beside the photo, open.
5. Open the same artist again: no new `lastfm: artist info` log line (the month's cache).
6. Settings › Playback › *Show artist info on the artist's page* (wears the N) off, open an
   artist: no box, no call. *Show play counts from Last.FM* off alone: the box still shows.
7. An artist Last.fm does not know: the plain centered hero, one log line with `none`.
8. Right-click inside the box: its own menu, *Open Last.fm* · *Hide artist info* (since
   2026-10-13, §7.1 item 5). Right-click elsewhere on the hero: the hero's artist menu.

## 7. The album facts box

> **Part:** built · 2026-10-13 · desk test passed 2026-10-13 (§7.5, his). The as-built record is §7.3.

His ask (2026-10-12): the artist box's data and style, per album. The same box beside the
album cover in the album hero, the same 2×2 grid, the same fold on a narrow card.

### 7.0 What `album.getInfo` gives (probed live 2026-10-12)

Listeners and plays; up to five tags (often with the release year: Essex Honey *2025, soul,
rnb, dream pop, art pop*); the album's Last.fm `url`; an `mbid` for well-known albums; the
track list (name, duration, rank; no per-song plays); a `wiki` (a summary of ~670 characters
and its date) for well-known albums only. No on-tour equivalent. A small release often has no
tags and no wiki: Lucy Park's *THREAD 27* has neither.

**Names.** Last.fm keeps one page per exact (artist, album) text a scrobbler sends and merges
none of them. `autocorrect` fixes artist spellings only. Most scrobbles come from Spotify,
which sends the main artist only and no ` - EP` / ` - Single`, so that page is the big one:

| Apple's album | Apple's form | No suffix | Main artist, no suffix |
|---|---|---|---|
| *GUERILLAZ - Single* (H.LLS & Lucy Park) | 49 listeners | 628 | **20,434** (H.LLS) |
| *THREAD 27 - EP* (Lucy Park) | 31 | **616** | the same |

`track.getInfo` names the album with Apple's suffix (*THREAD 27 - EP*), the small page, so it
does not help; an `mbid` works but small releases have none.

### 7.1 His calls (2026-10-12)

1. **Sections:** Tags (top left) · Listening Stats (top right) · **About** (bottom left: the
   wiki summary in place of On tour) · Links (bottom right: the album's Last.fm page).
2. **Tags as Last.fm gives them**, the year tags kept.
3. **The page:** Spotify's form first (the album artist's main name, the title without
   Apple's ` - EP` / ` - Single`); only when that is not found (error 6), Apple's exact
   names. Usually one call; the answer cached a month, as the artist's.
4. **Its own Settings row**, beside the artist's ("Show album info on the album's page").
5. **Right-click inside a box opens a small menu of its own:** *Hide artist info* (or *Hide
   album info*), which turns its row off, and *Open Last.fm*. This applies to the artist box
   too. The rest of the hero keeps the hero's menu.
6. **Scrobble names are a separate fix** (LASTFM.md §10), not part of this work.

### 7.2 His calls before the build (2026-10-13)

- **About:** the first two sentences of the summary, the HTML and Last.fm's *Read more* link
  stripped. **No jitter, and boxes of one size.**
- **The main artist:** the text before the first ` & `, `, `, ` x ` or ` feat. ` (Web
  Scrobbler's `removeAdditionalArtists` idea): *H.LLS & Lucy Park* → *H.LLS*.
- **After Hide:** a toast with Undo.
- **All three album views now**, the Search pane too (the unify, ARTIST-VIEW.md §10, takes
  its holder away later).

### 7.3 As built (2026-10-13)

> **Part:** built · 2026-10-13 · desk test passed 2026-10-13 (§7.5)

| Piece | Where | What |
|---|---|---|
| The table | `album_info` (`lastfm::init_tables`) | `album` (Apple's artist and album, lower case, joined by U+001F) · `state` · `listeners` · `playcount` · `tags` (JSON) · `wiki` (the summary as sent) · `url` · `fetched_at` |
| The command | `lastfm_album_info(artist, album, forms)` in `lastfm.rs` | cache first; else `album.getInfo` per form in order until one is found (error 6 → the next form); none found → cached `none`; a network failure caches nothing. Log line `lastfm: album info for <artist> / <album>: have (…, as <form>)` |
| The names | `albumForms`, `mainArtist`, `stripReleaseSuffix` in `src/lastfm-names.ts` | pure, `tests/lastfm-names.test.ts`. Spotify's form, then Apple's; one form when they match |
| The About | `wikiSentences` / `wikiText` in `lastfm-names.ts` | the *Read more on Last.fm* link and every tag removed, entities decoded, the first two sentences |
| The reader | `albumInfoFor` / `albumInfoNow` in `listeners.ts` | gated by `showAlbumInfo`; one ask per album; `…Now` returns an answer that has landed this session, so a view drawn again draws its box in the FIRST paint (the artist's got the same, `artistInfoNow`) |
| The markup | `albumInfoHTML` in `src/info-box.ts` (with the artist's, moved there) | the same wrap, fold and grid; `.artist-info__sec--about` sits in the bottom-left cell; the fold line reads *Album Info* |
| The views | `library-card.ts` `albumDetail` and `library-full.ts` `album()` through `Hero.aside`; `search-card.ts` `heroHTML` (albums) + `fillCollection` into a `[data-artist-info]` holder | the Lib and Full levels ask by the same Apple names, so they share one answer |
| One size | `.artist-info__about` (a fixed block of `--artist-info-about-lines` × `--artist-info-about-lh`, clamped); on a narrow card each row is at least `--artist-info-row-min` | a long summary and a short one, an artist's box and an album's, draw one size |
| The menu | `src/info-box-menu.ts` (`infoBoxAt`, `openInfoBoxMenu`), called first in the hero's right-click in collection-card.ts and both Search panes | *Open Last.fm* · *Hide artist info* / *Hide album info*; Hide turns the row off, hides the box, and toasts with Undo (TOASTS.md §5) |
| The row | Settings › Playback › *Show album info on the album's page* (`showAlbumInfo`, on) | a New mark; the agent's `settings` reaches it |

### 7.4 Decided inside his calls (for his review)

The row's default **On**, as the artist's; its words and hint. The About's hint. A line
height of 1.4 and a 100 px narrow row. (The About's line count is his: 3 at first, **4** on
2026-10-13, after the Essex Honey look cut its second sentence.) *Open Last.fm* first and
*Hide …* last in the box menu; the toast's words. One open / folded memory for both boxes. The
Diary's album hero gets no box (your notes, not a store page). The Full album asks by the
names the level opened with, so it shares the Lib level's answer. Only the very first open of
a name can still move the hero (the box arrives after Last.fm answers); every later open
draws it at once.

### 7.5 Desk test

1. Library › an album that Last.fm knows well (*Essex Honey*): the cover moves left; the box
   shows Tags, Listening Stats, About (two sentences, four lines at most), Links.
2. An EP or a single (*THREAD 27 - EP*): the counts are the plain name's (hundreds of
   listeners, not tens). The log line ends with `as Lucy Park / THREAD 27`.
3. A small album with no wiki: no About; the box keeps its size on a narrow card.
4. Press **Full**, then **Lib**: the box stays, drawn at once, with no new log line.
5. Search › an album: the same box. Midi: the *ALBUM INFO ›* line, closed or open as the
   artist's line was last left.
6. Right-click inside a box: *Open Last.fm* · *Hide album info*. Hide: the box goes, a toast
   with Undo; Undo brings it back in place. Settings › Playback shows the row off after Hide.
   Right-click elsewhere on the hero: the album's own menu, as before.
7. Settings › Playback › *Show album info on the album's page* (wears the N) off: no box, no
   album call.
