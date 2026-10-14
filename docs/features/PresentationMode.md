---
status: shipped
shipped_in: 0.27.0
desk_test: passed 2026-10-13
sources: [src/present.ts, src/info-box.ts, src/listeners.ts, src-tauri/src/lastfm.rs, src/card-grow.ts, src/collection-card.ts, src/media-levels.ts, src/full-player.ts, docs/features/LISTENERS.md, docs/cards/CARD-GROW.md, docs/integrations/ROOMS.md, docs/integrations/FRIENDS.md]
updated: 2026-10-13
---
# Presentation mode — the listening stats take over the card

> **Opened 2026-10-13** from the owner's ask, drawn on a screenshot of the album view
> (*Inventing - Single*, Matilda Mann; the *Listening Stats* cell of the album facts box
> circled): "clicking on an album or artist's listening stats makes it take over the entire
> card and grows it significantly; imagine an album listening party with live data from
> Last.fm." **His calls are §7a; the first part is BUILT (§9, the as-built record; desk test
> passed 2026-10-13, his).** He designs the picture: the view's layout is a placeholder.

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

**A third read, 18:08 the same day (~16 h later), the numbers had moved:**

| Read | Plays | Listeners |
|---|---|---|
| *NICOLE KIDMAN* | 2,665,764 (+53,585, ~3,300 an hour) | 235,512 (+3,665) |
| *Inventing* | 266,851 (+42, ~2.6 an hour) | 49,328 (+2) |

**The hour's watch, 18:13 to 19:14 the same day** (`docs/ops/checks/lastfm-refresh-probe.mjs`,
a read every minute, 59 of 60 reads answered): **not one count moved**, for the top 3 chart
songs (the top song gains ~3,300 plays an hour), *Inventing* or *THREAD 27*. So Last.fm
refreshes the public counts less often than once an hour; between the 02:11 and 18:08 reads it
did refresh at least once. A daily batch is the likely shape; a run over a day would pin it.

So the count moves in jumps when Last.fm refreshes, not by the scrobble. A threshold (a round
number) is crossed in hours for a hit and in weeks for a small album.

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

## 7a. His calls (2026-10-13, the "coffee shop TV" talk)

His picture: DeetsMusic on a TV in a coffee shop, a listening party where a group watches a
number cross a threshold.

1. **Terms first: a party on personal accounts** (at home, friends, a Room, any TV). That stays
   inside Apple's personal, non-commercial terms and Last.fm's non-commercial API terms. **The
   café product is documented, not pursued:** a business needs a licensed business music
   service and a commercial Last.fm agreement. He may pursue it through the proper channels if
   it is worth it. Do not build for a commercial venue until he says those are in place.
2. **The number is Last.fm's** (source A in §3), not our own count: "what does our app know;
   Last.fm has insight into millions of users." It moves when Last.fm refreshes (§2), so the
   view says when it last moved. The probe in §7 step 1 gives the period.
3. **The view is the card grow** (§1) for now, not a full-window TV mode.

This closes §8 fork 1 (A, with B / C / D not chosen now) and fork 4 (the card's Fill).

**His calls before the build (2026-10-13, the same talk):**

4. **No goal marker for now.** The threshold bar from the mock (a goal, its progress, "N to go")
   is an idea, not built. When it comes back, it tracks **Plays** (his call), which move about
   50 to 1,000 times faster than Listeners, so a crossing can happen during a party.
5. **Albums and artists both** (§8 fork 2 closed).
6. **Max only** (§8 fork 5 closed). Midi and Mini: the cell stays plain text.

## 7b. An idea: a live stream from Last.fm for a release-night party

> **Part:** idea · 2026-10-13 (his). Not designed, not asked of Last.fm.

His idea: work with Last.fm to set up a WebSocket (or another push stream) of real live data,
for a party on the night an album comes out. A song gets most of its listens in its first
couple of nights, so release night is when a live count moves most and means most.

What we know today:
- The public API has no live call and no push. The counts it gives move in batches (§2): in
  the probes, nothing moved in 95 s or in a whole hour's watch, but the top
  song had +53,585 plays over 16 hours.
- Last.fm sees each scrobble as it comes in, so a per-album or per-artist count of scrobbles
  in the last minute exists on their side.
- Our API key is under Last.fm's non-commercial terms. A stream would be a new arrangement
  with Last.fm: an ask through their business or API contact, not a change in the app.

What it would need from us, when the time comes: a socket client beside the re-read
(`present.ts`), a "live" mark on the view, and the goal marker (§7a item 4, on Plays) as the
moment the group watches. The Room (§3 D) could share the one stream with every member.

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

## 9. As built (2026-10-13)

> **Part:** built · 2026-10-13 · desk test open (§9.3)

### 9.1 How it is built

| Piece | Where | What |
|---|---|---|
| The trigger | `[data-present]` on the stats cell (`statsSec`, info-box.ts); the click in collection-card.ts | Max only. The box wrap carries the names it was asked by (`data-artist`, `data-album`), passed from media-levels.ts. The cell takes the hover brightness of a clickable hero cover |
| The grow | `fillCard(slot, "present")` (card-grow.ts) | the card fills Max; Now Playing and the Queue stay. A card already grown keeps its grow. `slotHolding` / `hostOf` (new exports) find the card's slot and panel |
| The view | `src/present.ts` `openPresent` | a `.present` layer over the whole panel: *Listening Stats* (the shelf label), the album · artist (or the artist), Plays and Listeners in full digits at `--present-num` (it follows the card's width), the age line |
| The motion | a clip from the cell's box to the card's, on `--grow-dur` / `--grow-ease`; the words fade in after `--present-in-delay` | the grow's own idiom; the way back clips into the cell on `--grow-collapse-dur`, then the grow collapses. Reduced motion: no clip, no fade. `[perf] frames present` |
| The re-read | `artistInfoFresh` / `albumInfoFresh` (listeners.ts) → `max_age_ms` on `lastfm_artist_info` / `lastfm_album_info` | on open and every 5 min while open; a stored answer under 4 min old is not asked again; Rust floors the age at 1 min (`MIN_MAX_AGE_MS`). The answer replaces the cached one, so the box shows it too |
| A count that moved | `roll` | counts up to the new value over `--present-roll-dur` (1.2 s); a snap under reduced motion |
| The age line | `ageText` | *Checked with Last.fm N min ago*, from the answer's `fetchedAt`; redrawn every 30 s |
| Ways out | Esc (taken before the grow's own Esc), the shrink square, anything that ends the grow (an outside click), a surface change | |
| Log lines | `present:open` · `present:read` (each re-read, with the counts) · `present:moved` (the deltas) · `present:close` | the ring (diag) |
| Hints | `PRESENT_HINTS`; the stats cell's hint gained "In Max, click to show them large" | ONBOARDING.md §1 |

### 9.2 Decided inside his calls (for his review)

The trigger is the click only (no box-menu row, no Compass verb, no rule; §8 fork 3 still
open). No Settings row: it rides the box rows (§8 fork 8). Not remembered: a restart brings the
card back at rest (§8 fork 6). The clip on the grow's curve (§8 fork 7). Full digits, not
48K. The 5-minute re-read and the 4-minute age. The words of the age line and the two hints.
The view's look: the facts box's fill and rim, the shrink square of the grow, the name in the
title type. **The layout is a placeholder for his picture.**

### 9.3 Desk test

1. Max, Library › an album with a facts box. Hover the Listening Stats cell: the hint, and
   the cell brightens. Click it: the card fills Max; the stats grow out of the cell over the
   card; Now Playing and the Queue stay.
2. The numbers are in full digits. Under them, *Checked with Last.fm just now* (or N min ago).
3. Esc: the view goes back into the cell, then the card goes back to its place. The same with
   the shrink square, and with a click on Now Playing (the grow's outside click).
4. The same for an artist (Library › an artist), and in Search › an album.
5. Midi: the cell is plain text, and a click does nothing.
6. Leave it open over 5 minutes: one `present:read` line in the ring per re-read; when Last.fm
   has moved, the number rolls up and a `present:moved` line shows the change.
