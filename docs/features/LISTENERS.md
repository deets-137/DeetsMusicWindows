---
status: designed
desk_test: open
sources: [src-tauri/src/lastfm.rs, src/listeners.ts, src-tauri/src/lib.rs]
updated: 2026-10-12
---
# Listeners — how rare a song is, from Last.fm

> **Designed 2026-10-12.** The read side is built (§3, part marker). The row that shows the
> number is not: he builds the UI with it the next sitting (§4). Until then, do not tell a
> user the app shows this.

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

## 4. The UI (next sitting, not built)

Where the number can show. The forks are his.

1. **The song pane's Details table** (CREDITS.md §7.2a), one row: "Listeners · 48K on
   Last.fm". The pane is the one place a song's facts already sit; the open of the pane is
   the moment of the call. Recommended as the first and maybe only place.
2. **The hover hint's third line**, after the writers. The hint must answer at once, so it
   can only show a number already in the memory map (the credits pattern, `credits.ts`).
3. **Now Playing**, a small line under the artist. One call per song start: more calls, and
   a number on every play whether the user cares or not.
4. **A Rulez fact** (`listeners`), so a rule can act on rarity. Only once a surface shows it.

Whatever the surface: the number carries the hover hint "People on Last.fm who have heard
this song" (ONBOARDING.md §1), the Last.fm page opens on a click (`url`), and the row joins
the Details family of the pane (UI-ARCHITECTURE.md §2a). The desk test is written with the row.

## 5. Open forks

1. **The word.** "Listeners", "Heard by", or "Rarity"? Last.fm's own word is listeners.
2. **A ratio.** `artist.getInfo` gives the artist's listeners. A song's listeners over the
   artist's says "rare for this artist" (a deep cut) against "rare" (an unknown artist). A
   second call, cached per artist name. Recommended as a later step, after the plain number.
3. **A background pass** over the library, so the Library card could sort by rarity. A few
   thousand calls once, then a month's drip. Not before the plain number has been seen.
4. **Off switch.** A Settings › Last.fm row to not ask, for a user who wants no call? Today
   nothing asks until a surface is built, so this is decided with the surface.
