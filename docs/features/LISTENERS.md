---
status: built
desk_test: open
sources: [src-tauri/src/lastfm.rs, src/listeners.ts, src-tauri/src/lib.rs, src/now-playing-card.ts, src/settings-store.ts]
updated: 2026-10-12
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
   artist's says "rare for this artist" (a deep cut) against "rare" (an unknown artist). A
   second call, cached per artist name. Recommended as a later step, after the plain number.
3. **A background pass** over the library, so the Library card could sort by rarity. A few
   thousand calls once, then a month's drip. Not before the plain number has been seen.
4. **Off switch.** Closed 2026-10-12: Settings › Playback › *Show play counts from Last.FM* (§4).
