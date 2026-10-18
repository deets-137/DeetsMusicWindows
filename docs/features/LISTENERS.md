---
status: shipped
shipped_in: 0.27.0
desk_test: passed 2026-10-13
sources: [src-tauri/src/lastfm.rs, src/listeners.ts, src-tauri/src/lib.rs, src/now-playing-card.ts, src/settings-store.ts, src/info-box.ts, src/hero-slide.ts, src/media-levels.ts, src/present.ts, src/notes-order.ts, src/info-box-menu.ts]
updated: 2026-10-17
---
# Listeners — how rare a song is, from Last.fm

> **Built 2026-10-12.** The read side (§3) and the badge on Now Playing (§4, his design) are
> built, in 0.27.0; the desk test (§4.3) passed 2026-10-13. §4 is the as-built record: where it disagrees with §1–§3,
> it is the code. **§8, the song facts box on the Song Credits page, is BUILT 2026-10-17
> (every fork his); its desk test passed the same day (§8.10, run by Claude). §8.7 is the
> as-built record.**

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
| A station's song (his call, 2026-10-13; it was "nothing" until then) | the same as any song | the same places. The station chip (`.np__station`, a band over the cover's bottom edge on hover) passes under the cover badge |
| Mini, Midi's strip, a live broadcast, a song with no id, a song Last.fm does not know | nothing | |

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
5. A station (2026-10-13): each song gets its badge, and the next song gets new counts. A live
   broadcast: no badge. A long title in the full player: rest the pointer on it, it slides to
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

## 6b. The box lands with a slide (artist and album)

> **Part:** built · 2026-10-13, desk test passed 2026-10-13 (his review on the dev app, §6b.3)

His report (2026-10-13): when the box appears, the drill view flickers, and the cover or photo
jumps to the left. **The cause:** the Library views (the Lib and Full levels) redrew the whole
card to add the box. An answer that came during the drill's slide waited for the slide's end
(`reload` holds while `animating`), so every row and cover drew again just after the slide
stopped: the flicker. The hero went from a centered column to the row layout in one frame: the
jump. The Search panes filled their holder in place (no flicker), but they jumped the same way.

### 6b.1 His calls (2026-10-13)

- The hero draws centered. When the facts land, the cover column slides left and the box
  fades in beside it.
- When the box's row goes off while the view is open, the box leaves and the cover slides back
  to the center.
- Under reduced motion, the cover starts on the left.

### 6b.2 As built

- `src/hero-slide.ts` `setHeroAside(hero, html)` changes the hero's own nodes only, never the
  card. It measures the cover column, puts the box in, and slides the column from where it
  was (a FLIP, `Element.animate`). It also moves the hero's height, so the rows below follow
  instead of jumping. The box fades in, starting at 30 % of the slide. Leaving: the box fades
  out (`--pop-out`), then the column slides back.
- `CollectionCardHandle.heroAside(ctx)` (collection-card.ts) replaces the three `card.reload()`
  calls (the Lib and Full artist and album levels; since 2026-10-13 one call in each of the
  two builders in media-levels.ts, `albumLevel` and `artistLevel`). An answer during
  the drill slide waits for the slide's end, so the drill arrives and then the cover moves. A
  hero that changed in another way since its draw (the photo landed) takes the plain redraw,
  as before. A level that is not on screen draws the box when it comes back.
- The Search panes call `setHeroAside` in place of setting `innerHTML` on the holder.
- The row going off (Settings › Playback, or the box's *Hide* menu) is watched in
  hero-slide.ts: each open box of that kind leaves with the motion above, and its HTML is kept
  beside its hero. Undo, or the row on again, brings it back the same way. The menu no longer
  sets `hidden`.
- Reduced motion: `artistInfoHTML` / `albumInfoHTML` draw an empty held place
  (`data-info-pending`) while the answer is on its way. The cover is on the left from the
  first paint, and the facts appear in the place with no motion. To tell "on its way" from
  "no answer", `artistInfoNow` / `albumInfoNow` now return `undefined` for the first and
  `null` for the second.
- Tokens: `--artist-info-slide` = `--nav-dur`, `--artist-info-slide-ease` = `--nav-ease` (each
  skin's drill tempo). `.lib-hero.is-sliding` clips during the move. `[perf] frames info-box`
  times each slide.

Decided inside his calls (for his review): the drill's tempo for the slide; the box's fade
starts at 30 % of the slide; the box fades out before the cover moves back; under reduced
motion, an answer of "nothing" (or a failed call) snaps the cover back to the center.
**Known gap:** under reduced motion, if Last.fm cannot be reached, the empty place stays on the
left until the view draws again.

### 6b.3 Desk test

1. Restart the app (the session's answers are cleared). Library › an artist you have not
   opened today: the drill slides in with the photo centered, then the photo slides left and
   the box fades in. The rows and covers below do not flash.
2. The same for an album (Library › an album), and for Search › an artist and an album, and
   Library › an artist › **Full**.
3. Open the same artist again: the box is in the first paint, and nothing moves.
4. Midi (a narrow card): the *ARTIST INFO ›* line fades in under the column, and the rows
   move down smoothly with it.
5. With an artist open, Settings › Playback › *Show artist info on the artist's page* off: the
   box fades out and the photo slides back to the center. On again: it slides back in. The
   box's right-click › *Hide artist info*, then the toast's Undo: the same two motions.
6. Each skin: the slide moves at the skin's drill tempo (Cyber fast, Ocean slow).
7. Windows › Accessibility › Animation effects off, restart: open an artist you have not
   opened since the restart. The photo is on the left from the first paint, and the facts
   appear with no motion. An album that Last.fm does not know: the cover snaps to the center.

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
| The views | `media-levels.ts` `albumLevel` (the Lib and Full albums, in the Library and, since 2026-10-13, in Search) through `Hero.aside` | the Lib and Full levels ask by the same Apple names, so they share one answer |
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

## 8. The song facts box (on the Song Credits page)

> **Part:** built · 2026-10-17 · desk test passed 2026-10-17 (§8.10, run by Claude). Every fork
> his (§8.2). §8.7 is the as-built record: where it disagrees with §8.1–§8.5, it is the code.

His ask (2026-10-17): the stats panel on a song's credits page. **Terms:** the *song page* is
the level that **Song Credits** opens (`songLevel` in media-levels.ts; CREDITS.md §7): the
cover, the title, Details, the Writers rows. The *facts box* is the 2×2 box of §6 and §7.

### 8.0 What the code and Last.fm give (checked 2026-10-17)

- The song page has a hero but no `aside`. The album page puts its box there (§7.3), so the
  song page can use the same slot. The song page is drawn by the Library and by Search (one
  drill system since 2026-10-13, CREDITS.md §7.2), so both get the box with no second path.
- The song's call, `track.getInfo`, already runs (§2) and is cached a month in
  `listen_counts`. The Now Playing badge reads it. Rust keeps only the counts and the link
  today (`fetch_count` in lastfm.rs).
- **Six songs probed live:** a large song has tags and a `wiki` (*Cruel Summer*, *Motion
  Sickness*, *Juna*, *Weird Fishes/Arpeggi*). A small song often has neither (*Inventing*,
  Matilda Mann: counts, no tags, no wiki). One song was not on Last.fm (error 6). The tags are
  noisy: "WSUM 91.7 FM Madison" is in the top five of two songs. The answer also names the
  song's album.
- Apple's songs carry no notes of their own (features/album-notes.md §1). An Apple album note can
  be a track-by-track interview: the song's name in bold, then the artist's words on it.

### 8.1 The shape

1. The box sits beside the cover in the song's hero, as the album's does: **Tags** (top left)
   · **Listening Stats** (top right) · **About** (bottom left) · **Links** (bottom right: the
   song's Last.fm page). A missing section leaves its cell empty. A song Last.fm does not know
   and no note for: no box.
2. It slides in when it lands (hero-slide.ts), folds under a *Song Info* line on a narrow card,
   and draws in the FIRST paint once its answer is known (a `listenersNow` sync read, as
   `albumInfoNow`).
3. **In Max, a click on the stats cell opens presentation mode** for the song
   (PresentationMode.md), as on albums and artists.
4. The About cell follows the notes order (§8.3).

### 8.2 His calls (2026-10-17)

1. **The full box**, as on albums: Tags, Listening Stats, About, Links. Not taken: Listening
   Stats and Links only.
2. **Presentation mode for a song:** yes, in Max, from the stats cell. Not taken: plain text.
3. **The notes order, the song first, then the source** (his hierarchy: Apple before Last.fm,
   the song before its album). The About cell shows the first of:
   1. Apple's part about this song, from a track-by-track album note
   2. Last.fm's wiki for the song
   3. Apple's short note for the album
   4. Last.fm's wiki for the album

   Not taken: the source first (Apple's song part, Apple's album note, then Last.fm's two).
   This replaces features/album-notes.md §3 N1 ("Apple's notes only"); that doc records the change.
4. **The album box uses the same order** on its two album steps: Apple's short note, then
   Last.fm's wiki. Built 2026-10-17 with album notes (album-notes.md §8).
5. **A Settings row for the source** (§8.4).
6. **The cell's heading:** *About* for a note about the song; *About the album* for the album's
   note on the song page. On the album page it stays *About*.

### 8.3 The notes, step by step

| Step | Source | Where it comes from | Cost |
|---|---|---|---|
| 1 | Apple, the song's part | the album's `editorialNotes.standard`, the part whose bold heading matches the song (case, accents, quotes and punctuation folded, album-notes.md §1) | the album-notes read: 0 calls from Search and Full, 1 Apple call per Library album the first time (album-notes.md §4), shared with the album page |
| 2 | Last.fm, the song | `track.wiki.summary` from the `track.getInfo` call already made | 0 new calls |
| 3 | Apple, the album | `editorialNotes.short` | the same album-notes read |
| 4 | Last.fm, the album | `album_info.wiki` (§7.3) | one `album.getInfo` per album, the call the album page makes; cached a month |

- Steps 1 and 3 joined on 2026-10-17 with the album-notes build (album-notes.md §8): step 1 is
  `songPart` (album-notes-parse.ts), the paragraphs under the song's heading in a track-by-track
  note; step 3 is the album's short note. The song page asks Apple by the song (one call per
  album the first time, cached a month), and the album's Last.fm facts wait for that answer.
- Step 4 on the song page asks for the album's Last.fm facts only when steps 1 to 3 gave
  nothing, and only with the album row on (`showAlbumInfo`).
- The cell's hover hint names the source and its level: Apple Music or Last.fm, the song or
  the album. The words are a draft for him.
- The text: the first two sentences, as the album's About (`wikiSentences`); Apple's note
  through the same strip of tags.

### 8.4 The source row (his ask, 2026-10-17)

A user who wants only one source, or none, says so in Settings. One row covers every About
cell (the song's and the album's; the artist box has no About).

- **Its place:** Settings › Playback, beside *Show album info on the album's page*.
- **Its choices (a draft, his words to edit):** *Notes from* · **Apple and Last.fm** (the
  default: the order of §8.2 item 3) · **Apple only** · **Last.fm only** · **None** (the About
  cell stays empty; the rest of the box is unchanged).
- With one source, the order keeps its song-before-album rule inside that source (Apple only:
  steps 1, 3; Last.fm only: steps 2, 4).
- It is a store key with a default and its why, an agent spec and an AGENT.md line, and a
  `NEW_MARKS` line (CLAUDE.md › the build checklist item 5, 5a). A rule key too, if he wants
  rules to set it: a fork at build time (RULES.md §19).

### 8.5 What the build touches

- **Rust:** `listen_counts` gains `tags` (JSON) and `wiki` (an `ALTER TABLE … ADD COLUMN`
  that ignores "duplicate column"). `fetch_count` reads `toptags` and `wiki.summary`. A row
  cached before this build has NULL tags: the song page treats it as stale and asks once.
  `lastfm_listeners` takes an optional `max_age_ms`, as the artist and album reads do, for
  presentation mode's 5-minute re-read.
- **Front-end:** `ListenCount` gains `tags` and `wiki`; `listenersNow` beside `listenersFor`;
  `songInfoHTML` and `SONG_INFO_HINTS` in info-box.ts (`data-info-box="song"`, the names for
  presentation mode); `songLevel` gets `aside` and asks on open, as `albumLevel` does;
  present.ts gets a song kind and `songInfoFresh`; info-box-menu.ts gets *Hide song info*.
- **Settings:** its own row, *Show song info on the song's page* (`showSongInfo`, on), as
  his artist call set (§6: "its own row, not the badge's"), plus the source row (§8.4).
- **Ledgers:** the hints in ONBOARDING.md §1; the Hide toast in TOASTS.md §5; the new keys in
  AGENT.md; the motion is the existing slide and present clip (no new motion).

### 8.6 Not in scope

- The user's own play count on the song (not asked for).
- A background pass over the library (§5 fork 3).

### 8.7 As built (2026-10-17)

> **Part:** built · 2026-10-17 · desk test passed 2026-10-17 (§8.10)

| Piece | Where | What |
|---|---|---|
| The table | `listen_counts` gains `tags` (JSON) and `wiki` (`lastfm::init_tables`, added when missing) | NULL tags = a row kept before 2026-10-17 |
| The call | `fetch_count` reads `toptags.tag` (`tags_in`) and `wiki.summary` (`wiki_of`, shared with the album's) | the same one `track.getInfo` |
| The command | `lastfm_listeners(track_id, artist, title, max_age_ms?, facts?)` | `max_age_ms` as the artist and album reads (floored at a minute); `facts: true` treats a known song with NULL tags as stale, so the song page asks once more; the badge does not pass it |
| The reader | `songInfoFor` / `songInfoNow` / `songInfoFresh` / `songInfoByKey` in `listeners.ts` | gated by `showSongInfo`; its own memory beside the badge's, so the box draws in the first paint once its answer is known |
| The order | `pickNote` / `needsAlbumWiki` in `src/notes-order.ts` | pure; `tests/notes-order.test.ts` |
| The markup | `songInfoHTML` in `info-box.ts`, `SONG_INFO_HINTS`, `ABOUT_HINTS` | `data-info-box="song"`, the fold line *Song Info*; `data-song` (the key), `data-artist`, `data-title` for presentation mode. The About goes through `aboutSec` for the album's box too, so *Notes from* applies there |
| The page | `songLevel` in `media-levels.ts` | `hero().aside`; asks the song on open, then the album's Last.fm facts only when `needsAlbumWiki` says so; each answer lands through `heroAside` (the slide, hero-slide.ts) |
| Presentation mode | `present.ts` | a song kind: the title · the artist, `songInfoFresh` every 5 min |
| The menu | `info-box-menu.ts` | *Hide song info*, the toast *Song info hidden…* with Undo |
| The rows | Settings › Playback: *Show song info on the song's page* (`showSongInfo`, on) and *Notes from* (`notesSource`: Apple and Last.fm · Apple only · Last.fm only · None) | New marks; agent specs; hero-slide.ts parks and returns the box on `showSongInfo` |
| Esc in presentation mode | `list-keys.ts`: the Escape branch skips a key already `defaultPrevented` | found by the desk test: with the focus in the card's list, one Esc closed the view AND went Back from the song page. The album and artist views had the same fault |

### 8.8 Decided inside his calls (for his review)

- The row words *Show song info on the song's page* and its hint; the *Notes from* row's place
  (after the song row) and its hint; the four labels are the draft of §8.4 as written.
- *Notes from* applies the next time a page draws its box (an open page keeps its box until
  you open it again or the card redraws). **Changed 2026-10-17 (§8.11):** it applies at once to
  the page on screen.
- *Apple only* shows Apple's notes only (since 2026-10-17, album-notes.md); an album with none
  has no About.
- A song Last.fm does not know, whose album has a Last.fm wiki, draws a box with only About
  and no link.
- The album's Last.fm facts are asked from the song page only with *Show album info* on; with
  it off, the song page's About has only the song's own wiki.
- The hint words of the four About sources (ONBOARDING.md §1).
- `showSongInfo` and `notesSource` are in the usage-counts allow-list (`REPORTED`, as the
  album's and artist's rows are; the test fails a key in neither list). `npm run usage:keys`
  wrote the copy to `../DeetsSupport/src/usage-keys.js`. That copy is not committed and not
  deployed: a deploy is his call. Until the deploy, the worker drops the two keys.

### 8.9 Desk test

Restart `npm run dev:app` (a Rust change).

1. Max, right-click a well-known song (*Cruel Summer*) › **Song Credits**. The cover moves left;
   the box shows Tags, Listening Stats, *About* (the song's wiki, two sentences), Links. Hover
   About: *From the song's wiki on Last.fm*.
2. A small song with no wiki of its own (*Inventing*, Matilda Mann): About reads from the
   album's wiki under *About the album*, or no About when the album has none.
3. Click the stats cell: the card fills Max and the counts grow out of it, the title · the
   artist. Esc goes back.
4. Midi: the *SONG INFO ›* line; it opens and folds as the album's line does.
5. Right-click inside the box: *Open Last.fm* · *Hide song info*. Hide: the box goes and a
   toast with Undo; Undo brings it back.
6. Settings › Playback › *Notes from* › *Last.fm only*, then *None*: open a song again; the
   About follows (none: no About, the rest stays). The same on an album page.
7. Search › a song › Song Credits: the same box.
8. The log: one `lastfm: listeners for <id>` line on the first open of a song kept before this
   build (the tags read), none on the second.

### 8.10 Desk test results (2026-10-17, run by Claude on his dev app)

Run with the shots runner on the running dev app (`"source": "dev"`, SHOTS.md §5h), Max, his
library. The list is [docs/ops/checks/song-box.json](../ops/checks/song-box.json); the probes are
in its console files, the pictures were read.

| Step | Result |
|---|---|
| 1 | **Pass.** *Bohemian Rhapsody* (Queen): Tags (classic rock, rock, Queen, 70s, 80s), Listening Stats (17M plays, 2.3M listeners), About (the song's wiki), Links. The About hint: *From the song's wiki on Last.fm*. *Kill Bill (feat. Doja Cat)*: no tags (Last.fm has none), the rest the same |
| 2 | **Pass.** *Vivid Light* (Blood Orange) has no wiki of its own: the cell reads **About the album** with *Essex Honey*'s wiki, hint *From the album's wiki on Last.fm*; the album's answer came from the cache (no call). *Wild Thought* (Dark Bardo & Shungudzo): Last.fm knows neither the song under that artist text nor an album wiki, so no box |
| 3 | **Pass after a fix.** The card fills Max; *Bohemian Rhapsody · Queen*, 16,795,061 plays, 2,334,102 listeners, *Checked with Last.fm just now*. Esc first closed the view AND left the song page; fixed in `list-keys.ts` (§8.7). After the fix: the view closes, the song page and its box stay |
| 4 | **Pass.** The card in Max's quarter is narrow: the *SONG INFO* line, the box under it |
| 5 | **Pass.** The menu is *Open Last.fm* · *Hide song info*; Hide: the box goes and *Song info hidden. Settings › Playback brings it back.* with Undo; Undo brings it back |
| 6 | **Pass.** *Notes from* › *None*, the song opened again: Tags, Listening Stats, Links, no About. Set back to *Apple and Last.fm*. *Last.fm only* was not run (the same path as both, with no Apple notes today) |
| 7 | **Pass.** Steps 1, 3, 5 and 6 ran in the Search card |
| 8 | **Pass.** One `lastfm: listeners for 6781024437` line on the first open (the row had NULL tags); none on the later opens; `listen_counts` now holds its tags and wiki |

**Found on the way, not in this work:** the song's Last.fm call asks under Apple's whole artist
text (*Dark Bardo & Shungudzo*); Last.fm keeps such a song under the main artist. The album
call already tries Spotify's form first (§7.1 item 3); the song call and the Now Playing badge
do not. A fork for him.

### 8.11 Edge cases and races (fixed 2026-10-17; to test 2026-10-18)

> **Part:** built · 2026-10-17 · desk test passed 2026-10-17 (run by Claude on his dev app; the
> results under the list)

After §8.10, his asks: script the edge cases and races, and ask Sonnet agents how a user might
break the feature (DESK-TESTS.md §6). Two agents read the code (one on workflows, one on data and
timing) and gave 39 scenarios. Claude checked each against the code. Six were real faults in this
feature, and are fixed. The rest are below: a test, a known fork, or a fault that is older than
this feature.

**Fixed (in code, unit-tested where the rule is pure; not yet run on the dev app):**

| # | The fault | The fix |
|---|---|---|
| F1 | A stub wiki (only Last.fm's *Read more* link) counted as a note: the About was empty and the album's wiki was never asked | `noteText` (lastfm-names.ts): a wiki with no words is no note; used by `songInfoHTML`, `albumInfoHTML` and the song page. tests/lastfm-names.test.ts |
| F2 | With *Show song info* off, the song page still asked Last.fm for the album | `askLfm` returns with the row off; `albumWanted` needs a song answer (media-levels.ts) |
| F3 | After a failed song call, the album was asked for a box that could not draw | the same: no song answer, no album call |
| F4 | A box row turned on while its page shows: no box until the page was opened again (songs, albums and artists) | `asideRefresh` on the three levels; collection-card.ts asks again and redraws the hero (`offBoxRows`). *Notes from* now redraws the open page too |
| F5 | The row turned off while presentation mode shows: the view stayed, with frozen numbers | present.ts closes the view when its kind's row goes off |
| F6 | 999,999 read "1000K"; 9,999,999 read "10.0M" | `fmtCount` rounds into the next unit (tests/fmt-count.test.ts). The badge and every box |
| F7 | A wiki's `&eacute;`, `&ndash;`, `&rsquo;` showed as text; "Dr. Dre", "St. Louis", "Vol. 2" ended a sentence | more named entities and a short-form rule in `wikiText` / `wikiSentences` (album and artist boxes too) |

**To test on the dev app (2026-10-18).** The list is
[ops/checks/song-box-edges.json](../ops/checks/song-box-edges.json), made by `song-box-edges.mjs`
beside it. Every probe has an `expect`, so a shot fails by itself on a wrong answer. Run it with:

```
node docs/ops/checks/song-box-edges.mjs && node scripts/shots.mjs --list docs/ops/checks/song-box-edges.json --noise 80
```

| Shot | Checks |
|---|---|
| edge-leave-early | Last.fm 2.5 s late, the user leaves first: nothing draws on the list, nothing throws |
| edge-a-then-b | A's answer late, the user opens B: B's page shows B's box |
| edge-off-no-call | the row off: no box, no `lastfm_listeners` call |
| edge-on-while-open | F4 for a song |
| edge-fail-then-retry | a failure draws nothing and is not kept; the next open draws the box |
| edge-present-row-off | F5 |
| edge-present-compass | Esc closes the Compass first, then the view, and the song page stays |
| edge-grown-skins | the box beside the cover on a grown card, in all 5 skins: nothing overflows (pictures to read) |
| edge-midi-fold | Midi: the *SONG INFO* line folds and opens the box (pictures to read) |
| edge-notes-lastfm-only | *Last.fm only*: *About the album* for a song with no wiki |
| edge-notes-apple-only | *Apple only*: no About today, the rest stays |
| edge-readmore-only | F1 (a patched answer) |
| edge-off-no-album-call | F2 |
| edge-big-counts | F6 in the box |
| edge-long-tags-midi | long and noisy tags stay inside the box in Midi |
| edge-reduced-motion | the held place, no slide |

Also run [ops/checks/song-box.json](../ops/checks/song-box.json) again (§8.10), and read the
pictures of edge-grown-skins and edge-midi-fold. A fail is fixed and run again.

**The run (2026-10-17, afternoon; Claude, his dev app, Max, the Library in slot d): all 20 pass**
(16 shots; edge-grown-skins is 5). Three faults in the test and two in the app came first:
- **The runner's `invoke` rules did nothing on the dev app.** Tauri defines
  `__TAURI_INTERNALS__.invoke` read-only, so the page wrapper never took hold: no delay, no
  failure, no patch, and the call count stayed 0. So the night before, "no call" passed for
  the wrong reason. Fixed in `scripts/shots.mjs` (SHOTS.md §5i): the debugging protocol counts
  each `http://ipc.localhost/<cmd>` request and holds or rewrites the named ones. Checked in
  this run: the delayed and failed calls count 1, a patch reads "1.0M".
- **Song A was not in the library.** Bohemian Rhapsody is a "seen" song, so only the Search
  card finds it. A is now Kill Bill (SZA), a library song with a song wiki.
- **The page keeps each answer for the session**, so a song an earlier shot opened drew with
  no call. Every shot now starts with a reload. In Midi the shots aim at the right slot.
- **Fault: one Esc closed the Compass AND the presentation view** (edge-present-compass). The
  view's Escape (capture phase on `window`) ran first. Fixed in `present.ts`: it steps aside
  while the Compass is open, as it does for a right-click menu.
- **Fault: a long tag ran out of the box** (edge-long-tags-midi, the picture: under the counts
  and past the border). Fixed in styles.css: a tag chip is at most its column's width and ends
  in an ellipsis, one line as every chip. The album and artist boxes share the rule.

Read: the grown card in Glass and Cyber (beside the cover, nothing out), the Midi fold (open,
closed, open), A then B (B's box), the long tags before and after. Kill Bill has no Last.fm
tags, so its Tags cell is empty unless patched. **Not run again:** song-box.json (§8.10). It
needs the Search card in slot d (its song is Bohemian Rhapsody); his dev layout has the
Library there, and the edge list covers the same paths.

**Found, not fixed: his forks, or faults older than this feature.**
- **The name form** (§8.10): the song call and the badge ask under Apple's whole artist text,
  and a "none" is kept a month. A fork for him (try the main artist, as `albumForms` does).
- **The stats cell has no keyboard path:** `[data-present]` is a plain `div` in all three boxes,
  so a keyboard user cannot open presentation mode. It was already like this for albums and artists.
- **The badge and the box can show different counts** after presentation mode re-reads (two
  memories: `held` and `songs`). Low impact.
- **A future `fetched_at`** (a clock that was wrong) keeps a row past its month. Low impact.
- **Noisy tags** (a radio station's name in the top five): shown as Last.fm gives them, as on
  albums (his call, §7.1 item 2).
- **A song with no catalog id** is kept under its library id: the Library and Search can each
  ask once. Low impact.
