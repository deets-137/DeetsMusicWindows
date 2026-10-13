---
status: idea
desk_test: none
sources: [src/info-box.ts, src/listeners.ts, src-tauri/src/lastfm.rs, src/card-grow.ts, src/full-player.ts, docs/features/LISTENERS.md, docs/cards/CARD-GROW.md, docs/integrations/ROOMS.md, docs/integrations/FRIENDS.md]
updated: 2026-10-13
---
# Presentation mode — the listening stats take over the card

> **An idea, opened 2026-10-13** from the owner's ask, drawn on a screenshot of the album view
> (*Inventing - Single*, Matilda Mann; the *Listening Stats* cell of the album facts box
> circled): "clicking on an album or artist's listening stats makes it take over the entire
> card and grows it significantly; imagine an album listening party with live data from
> Last.fm." Nothing is decided and nothing is built. Every fork in §8 is his. He designs the
> picture. Do not tell a user the app does this.

## 0. Terms

- **The facts box:** the 2×2 box beside an artist's photo or an album's cover: Tags, Listening
  Stats, On tour / About, Links (LISTENERS.md §6, §7). Built and shipped.
- **The stats cell:** the box's top-right section: **N** Plays over **M** Listeners. Today it
  is plain text, with no click (LISTENERS.md §6.1, "the counts are plain text since 2026-10-12").
- **Presentation mode:** the new view. The stats cell grows until it fills the card, and the
  card grows too (over its neighbor, or over all content cards in Max).
- **Plays / Listeners:** Last.fm's all-time scrobbles and distinct scrobblers, for every user of
  Last.fm, not only this app (LISTENERS.md, the terms).
- **Listening party:** a group that hears one album start to finish at one time. In this app
  that is a Room (ROOMS.md): members hear the same song at the same time.

## 1. The shape (the mechanics, not the picture)

1. The user clicks the stats cell in an artist's or an album's facts box.
2. The cell expands to fill the card. The other three cells and the hero step aside.
3. The card grows at the same time: Fill in Max, over the neighbor in Midi. It uses the
   existing grow (`growCard`, CARD-GROW.md §4) — not a new kind of grow.
4. The view shows the numbers large, and the numbers that move while the user listens (§3).
5. Escape, a click on the same control, or Back returns the cell, then the card, to rest.

The cell is a new click target, so it needs a hover hint (ONBOARDING.md §1) and the box's
right-click menu gets a row (*Present*), as the box menu is the card's own (LISTENERS.md §7.3).

## 2. What "live" can mean — probed 2026-10-13

**Last.fm's public counts are not live by the minute.** Two reads 95 s apart, 02:09 and 02:11:

| Read | Plays | Listeners |
|---|---|---|
| `chart.getTopTracks` #1 (*NICOLE KIDMAN*, ADÉLA) | 2,612,179 → 2,612,179 | 231,847 → 231,847 |
| `album.getInfo` *Inventing* (Matilda Mann) | 266,809 → 266,809 | 49,326 → 49,326 |

The top song in the world gets many scrobbles each minute, but the count did not move. Last.fm
caches these counts. How often they refresh (an hour? a day?) is not known yet: a longer probe
answers it (§7 step 1). So a counter that ticks while the album plays **cannot come from the
global count alone.** The ticking numbers come from somewhere else (§3).

Last.fm has no public "who is listening to this album now" call. `user.getRecentTracks` shows
one named user's now-playing song, and only for a user name you already know.

## 3. Where the moving numbers can come from

| Source | What moves | Cost | Notes |
|---|---|---|---|
| **A. The global count, polled** | Plays / Listeners, when Last.fm refreshes | 1 call per refresh period | Honest but slow. Show *Updated 14 min ago*, not a ticker. The month cache (LISTENERS.md §3) is skipped while presenting |
| **B. Per-song bars** | nothing moves; a bar per song, the playing song lit | 1 `track.getInfo` per song, cached a month (the existing `listen_counts` table) | `album.getInfo` gives the track list but no plays per song (LISTENERS.md §7.0). A 12-song album = 12 calls once, then free. The song now playing rises and lights as it plays |
| **C. Your own share** | your plays of this album / artist, +1 on each scrobble | 0 Last.fm calls: our own `plays` table; or `user.getInfo` style reads if connected | Ticks for real while you listen: "you are 1 of 49,326" and your count goes up |
| **D. The Room** | the members, each one's ♥, who joined | 0 new calls: the room socket (ROOMS.md) | The real live party. N people here now, the song you all hear, its place in the album |
| **E. Friends now** | friends who play this artist or album now | 0 new calls: Friends presence (FRIENDS.md) | Only friends who share presence; a friend sees presence only today (FRIENDS.md §20) |
| **F. Last.fm friends' now-playing** | named Last.fm users' current songs | 1 `user.getRecentTracks` per friend per poll | Needs Last.fm user names; a list to manage. Probably not |

**A + B + C** give a presentation for one user with no new server. **D** makes it the party
the ask names. B is the strongest picture of an album: the songs as a ranked shape, the
listener drop-off from song 1 to the last song, the deep cut no one plays.

For an **artist**, B becomes `artist.getTopTracks` (ideas/LastfmArtist.md §1): one call gives
every song's listeners and rank. The artist view's presentation = the artist's songs ranked,
with your plays beside each.

## 4. What the grown view can hold (a list for his picture)

- The two big numbers, the refresh age under them (A).
- The per-song bars or ranks (B), the playing song lit, a click plays that song.
- Your share and your plays, +1 on each scrobble (C).
- The Room's members and the album's progress, song 3 of 12 (D).
- The tags and the About text from the box, smaller.
- The album cover large, or the album color behind it (ALBUM-COLOR.md) — a party wants the
  Glass canvas covers (COVER-WALLPAPER.md).

He picks which, and draws where.

## 5. How it sits with what exists

| Exists | Use |
|---|---|
| `growCard` / `collapseGrow` (card-grow.ts) | the card's grow and its return; CARD-GROW §18 grow rules already grow a card on an album or artist open |
| The full player (full-player.ts, fullscreen-player.md) | the other way to fill the window. A party might want Now Playing large **and** the stats; a fork (§8.4) |
| `albumInfoFor` / `artistInfoFor` (listeners.ts) | the first paint: the cached numbers draw at once, then the fresh read lands |
| `listenersFor` (listeners.ts) and `listen_counts` | the per-song bars (B) with no new table |
| The box menu (info-box-menu.ts) | the *Present* row |
| Card memory (CARD-MEMORY.md) | a card left in presentation mode comes back in it — or not; a fork |
| Rules (RULES.md §19) | "present when a Room starts an album" is a rule, if he wants it later |

## 6. Costs and limits

- **Apple:** zero calls.
- **Last.fm:** about five calls a second on average is their ask. A: one call per refresh
  period per open view. B: one call per song per month. Both are far under the limit.
- **Accuracy:** Last.fm's numbers skew to scrobbling users (most from Spotify). The album page
  is the Spotify form of the name (LISTENERS.md §7.1 item 3), so a single or an EP shows the
  big page, as the box does today.
- **Rooms:** a room has no "album party" state; it plays a queue. "Song 3 of 12" is read from
  the queue, not the room.

## 7. Probes before he designs

1. **The refresh period.** A script reads one hot song and one small album every 5 min for
   3 hours and logs when each number moves. Kept in `docs/ops/checks/` (his ask, 2026-10-01).
   It decides if A is "updated a minute ago" or "updated today".
2. **Per-song drop-off.** `track.getInfo` over three albums he plays (a big one, an EP, a
   single), to see if B's bars tell a story or sit flat.
3. **His library.** How many of his albums have a Last.fm page at all (the box shows `none`
   for some; the `album_info` table has the count today).

## 8. Forks (all his)

1. **Live, which kind.** A only (honest, slow) · A + B + C (one user, no server) · add D
   (the Room party) · add E (Friends).
2. **Albums and artists, or albums first.** The ask names both; the album has the party story.
3. **The trigger.** A click on the stats cell only · also the box menu's *Present* · also a
   Compass verb (COMPASS.md §9) · also a rule.
4. **The size.** The card's Fill (other cards covered) · the whole window, like the full
   player · Now Playing and the stats side by side.
5. **Midi and Mini.** Midi grows over its neighbor as any grow does; Mini has no facts box, so
   no presentation. Or Max only, as the Rulez and Skinz cards are.
6. **Memory.** A card left presenting comes back presenting, or at rest.
7. **The motion.** The cell's growth is a new motion (the grow's `--grow-*` shape, or a
   flight from the cell, as the chip flight in ARTIST-VIEW.md). It joins the motion set
   (docs/guide/motion.json).
8. **A setting.** Its own row in Settings › Playback beside the two box rows, or it rides
   *Show album info* / *Show artist info*.
