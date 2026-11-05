---
status: shipped
shipped_in: 1.3.0
desk_test: passed 2026-11-04
sources: [src/listen-later.ts, src/media-menu.ts, src/playlists.ts, src/playlists-card.ts, src/playlist-export.ts, src/stats.ts, src/rules-app.ts, src/rulez-card.ts, src/agent-writes.ts, src/compass.ts, src/settings-card.ts, src-tauri/src/bridge.rs, cli/src/main.rs]
updated: 2026-11-04
---
# Listen later: Saved for the Right Day

**Designed and BUILT 2026-11-01 with him. Every fork below is his call. Desk test open (§5).
§6 is the as-built record.**

A **Listen later** row on the right-click menu of a song or an album. It adds the songs to
one playlist, **Saved for the Right Day**. The app makes that playlist and owns it, so its
header names the owner as **DeetsMusic**, not "Yours". The same label goes on Replay and on
Rulez Playlists.

**The terms.**
- *The later playlist:* the one playlist that Listen later adds to. The app finds it by its
  role (`role: "later"`), never by its name.
- *A full play:* a play with `completed: true` in the play log (`PlayEvent`, rewind.ts). A
  skip, or a stop before the end, is not a full play.
- *The owner label:* the third part of a playlist header's line (`songs · length · owner`),
  [playlists-card.ts](../../src/playlists-card.ts) `hero()`.

## 1. His calls (2026-11-01)

1. **Listen later is the only way in.** The later playlist is not in *Add to Playlist ▸*, and
   it takes no drop. (His words: "you should only be able to add to it via the Listen later
   button rather than the typical add to playlist route.")
2. **The name is "Saved for the Right Day", and you can rename it.**
3. **The owner label is "DeetsMusic"** on the later playlist, on Replay, and on Rulez
   Playlists (the other option for Rulez was "Yours", because you wrote the rule).
4. **A song stays after you play it (the default).** A Settings row can remove it after a full
   play. The row is there from the start.
5. **The removal reads a full play from anywhere by default.** The row can limit it to a full
   play started from the later playlist. (The other option was "this playlist only" as the
   only behavior.)
6. **An AI app can save songs too,** through its own `later` command. It never goes through
   `playlist_add`, which refuses the later playlist, the same way it refuses Replay.
7. **A new save goes at the end** of the list, as in every playlist.
8. **The row is "Remove from Later list automatically"**, with the pills **Off · Played from
   List · Played Anywhere**. It shows on the update card (a `NEW_MARKS` line at 1.3.0), so a
   user sees it on the first launch after the update.

## 2. The design

### 2.1 The menu row
- **Label:** Listen Later (Title Case, as every menu row).
- **Place:** group 2 (File) of the row order, directly under *Add to Playlist ▸*
  ([media-menu.ts](../../src/media-menu.ts), CONTEXT-MENUS.md §2). The builder adds it, so
  every card's song and album menu has it, and a set of picked songs has it too.
- **On an album:** it adds the album's songs, in album order.
- **Duplicates:** a song already in the playlist is skipped. A song is the same when its
  catalog id or its library id matches.
- **Feedback:** the drop's words (a drop on a playlist is the precedent; the *Add to Playlist ▸*
  flyout shows no toast): "Added “Song” to “Saved for the Right Day”." with Undo. When every
  song was already there: "Already in “…”." One row in TOASTS.md §5. The toast uses the
  playlist's name at that time, so a rename shows in it.

### 2.2 The playlist
- **Made on first use,** not at install. A user who never uses Listen later has no empty
  playlist.
- **Found by role.** A rename keeps it working. If you delete it, the next Listen later makes
  a new one with the default name.
- **A new role, `"later"`.** The `role` column already exists (`playlist_create`,
  playlists.rs), so this needs no schema change. Replay's role locks a playlist completely
  (`isReplay`). The later role locks only the ways in.
- **Split `handMade()`** ([playlists-card.ts](../../src/playlists-card.ts)). Today one check
  controls rename, reorder, remove and drop together. The later playlist needs rename,
  reorder and remove, but no drop.
- **Not an add target:** the filter in `addToPlaylistItem` (playlists.ts, beside the Replay
  exclusion, PLAYLISTS.md §10.8) leaves out `role: "later"` too.
- **It can still be a source** for a Rulez Playlist and for Export, the same as any other
  local playlist. Those only read it.
- **Its cover follows Settings › Playlists › New cover** (Letters by default), drawn once when
  the list is made. His call (2026-11-01): keep Letters, and show *New cover* on the 1.3.0
  update card beside *Remove from Later list automatically* (a `NEW_MARKS` line at 1.3.0), so a
  user learns the cover can be Mosaic or Note. The line also gives the row its N badge again.

### 2.3 The owner label
- `hero()` shows "DeetsMusic" when `role` is `"replay"`, `"rulez"` or `"later"`, else
  "Yours" for a local playlist, as today. One helper, so the overview and the Compass can use
  the same word later.

### 2.4 The setting
- **Settings › Playlists › Remove from Later list automatically** (his words, call 8).
- **Pills:** Off · Played from List · Played Anywhere. Default **Off** (his call 4).
- **Hover hint:** "After a full play (as Rewind › Count a play at sets it) or a skip. Played
  from List counts only plays started from the Later list." (A skip added 2026-11-01, §9.)
- **A full play is the app's own rule** (`fullPlayRule`, 90 % by default), the one Rewind and
  the play log use.
- One key, `laterRemove: "off" | "here" | "anywhere"`, with its default and the why in
  settings-store.ts, a spec in agent-settings.ts, a line in AGENT.md, a `NEW_MARKS` line,
  and a Compass entry (automatic for a store-backed row).
- **When it acts:** when a full play ENDS (the next song starts, or the app closes), not at
  the full mark, so a row never vanishes while its song plays. "Played from List" checks the
  play's `context` against `playlist:local:N`, the context every playlist play writes (the
  card, a Home tile, a pin of the list).
- **The log:** `diag.log` each removal (the song and the mode), since it acts on its own.

### 2.5 The agent
- A new `later` command adds songs or an album by id. It returns the playlist's name and how
  many songs it added or skipped.
- `playlist_add` refuses the later playlist and names the `later` command in its error.

## 3. Claude's choices, for his review

- **One row with three pills** for calls 4 and 5, not two rows (his wording replaced the draft).
- **Skip duplicates** instead of adding a song twice.
- **Toast with Undo,** in the drop's words.
- **Listen Later on picked songs, but not on a genre tile's whole list.**
- **The Rulez *Add the song to a playlist* action** leaves the Later list out of its choices,
  and refuses it at run time, for a rule made before the list existed.
- **The Apple Music submenu** hides *Get New Songs* and *Match the Apple Copy* on the Later
  list, as on a Replay: both pull songs in. *Export* and *Send New Songs* stay.
- **The setting is in the usage counts** (his call, 2026-11-01: "Yes write it up to be sent"):
  `laterRemove` is on `REPORTED` in usage-keys.ts, and `npm run usage:keys` copied it to
  DeetsSupport (uncommitted there). The worker drops it until that copy is deployed (his call).
- **A song inside the Later list still shows Listen Later.** Pressing it says "Already in …".

## 4. Not now

- **The save date on each row** ("saved 3 weeks ago"). `local_playlist_tracks` has no
  added-at column, so this needs a schema change. Bring it to him as its own fork if he wants
  it.

## 5. Desk test (to run after the build)

1. Right-click a song › Listen later. The playlist is made, the song is in it, and the toast
   shows. Undo removes it.
2. Listen later on the same song again: "Already saved", no second row.
3. Right-click an album › Listen later: all its songs, in album order.
4. *Add to Playlist ▸* does not list the later playlist. A drag onto it shows no drop target.
5. Rename it, then Listen later: the song goes to the renamed playlist.
6. Delete it, then Listen later: a new "Saved for the Right Day" is made.
7. The headers of the later playlist, a Replay and a Rulez Playlist say "DeetsMusic". A
   hand-made playlist says "Yours".
8. The setting at *Played Anywhere*: play a saved song to the end from its album. It leaves
   when the next song starts. Skip another one. It stays.
9. The setting at *Played from List*: play a saved song to the end from its album. It stays.
   Play it to the end from the later playlist. It leaves.
10. The agent: `later` with a song id adds it; `playlist_add` to the later playlist refuses.
11. Settings › Playlists shows the new row with the N mark, and the update card's 1.3.0 page
    lists it.
12. Rulez: *Add the song to a playlist* does not offer the Later list. Its Apple Music submenu
    has no *Get New Songs* or *Match the Apple Copy*.

## 6. As built (2026-11-01)

- `src/listen-later.ts` — new: `laterList` (by role), `saveForLater` (find or make, skip held
  songs, append), `removeFromLater` (by ids, not rows), `listenLaterItem` / `listenLater` (the
  row, the toast, Undo) and the removal on `onPlayEnd`. Its writes run one at a time.
  Log lines: `later:made`, `later:save`, `later:undo`, `later:played`, `later:err`.
- `src/stats.ts` — `onPlayEnd(song, how)` (`completed` until §9), fired by `finalizeEvent`; the open event keeps
  its song and context.
- `src/playlists.ts` — the `"later"` role, `isLater`, `ownerOf` (the header's owner word), and
  the Later list left out of *Add to Playlist ▸*.
- `src/playlists-card.ts` — the header uses `ownerOf`; a drop on the Later list is refused.
  Rename, reorder and remove are unchanged (`handMade` still allows them).
- `src/media-menu.ts` — the row on songs, albums and picked sets (`listMenu`'s `later` flag).
- `src/playlist-export.ts`, `src/rules-app.ts`, `src/rulez-card.ts` — the other ways in, closed.
- The agent: `action: later` on `POST /playlist` (`bridge.rs` resolves its `id` as for `add`;
  `agent-writes.ts`); the MCP `later` tool (in both tool sets) and `deetsmusic later [id]`
  (`cli/src/main.rs`). A dev runner restart is needed for the Rust and CLI parts.
- Compass: `listen later [song]` (`later`, `save for later`) in `compass.ts`.
- Settings: `laterRemove` in settings-store.ts, the row `laterremove`, its `NEW_MARKS` line
  (1.3.0), the agent spec, `NOT_REPORTED`.
- Tests: `tests/media-menu.test.ts` (the row's place; no row on a genre list).
- No schema change, no new invoke, no Apple call.

## 7. The second round (2026-11-01): use counts and DeetsMusic Lists

> **Part:** built · 2026-11-01

**His calls.**
1. **The setting is sent** in the weekly settings report ("Yes write it up to be sent").
2. **Use counts in the day count, beside the minutes**, as counters (USAGE-COUNTS.md §18):
   saves by where they came from, the songs the setting took out, Undo presses.
3. **The Playlists card's sections:** the top section is **DeetsMusic Lists** (Replay, the Later
   list and Rulez Playlists, then the webs); *Made Here* becomes **Created Here**.
4. **Webs:** only webs made from now on carry the new role and move; an old web stays in
   Created Here (his idea for later: a one-time action in the Updates panel that a user can run
   to move theirs).
5. **The divider:** a vertical line in a grid view, a horizontal line in the Lines view.

**As built.** PLAYLISTS.md §3a (the sections, the divider, the Replay folder's one-time pass) and
USAGE-COUNTS.md §18 (the counts, the worker, the admin page).

**Desk test (his).**
1. Playlists card, Folders sort: DeetsMusic Lists is first, with Replay, Saved for the Right Day
   and any Rulez Playlist. The "Replay" folder is gone (after the first launch's pass, 8 s in).
2. Make a web: it lands in DeetsMusic Lists after the divider. Lines view: a line between two
   rows. A grid view: a vertical line before the web's tile; change the card's width and the
   line moves with the tile.
3. *Far Caspian Web* (made before) is still under Created Here, with your own playlists.
4. Settings › About › *Show what is sent*: the next day count shows `uses` with the counts of the
   last day it was sent.

## 8. A skip that took a song off the list (2026-11-01, fixed)

> **Part:** built · 2026-11-01

**His report:** with the setting on, a song skipped after about 3 seconds left the Later list.

**The read (the dev log and the plays table, not a guess).** At 249.705 s he pressed Next on song
A (6810354032) at 2:51, past its 90 % mark. Song B (6810354228) started at 249.754 s, and
`stats:full` credited B a full play at 249.757 s, 3 ms later: MusicKit sent one more progress
tick with A's position after `nowPlayingItem` already named B, so the id check in player.ts let
it through. B was skipped 2 s later, its play ended `completed`, and it left the list. The plays
table showed more plays that day marked `finished` with 1–3 s listened. The same tick also
counted B as heard in Rewind and the full-play count.

**The fix, at the source.** `src/play-ticks.ts` `isStaleTick`: in a play's first second, a tick
more than 5 s into the song is the last song's, and `recordProgress` (stats.ts) drops it
whole (`stats:stale` in the log). A scrub by hand comes later and still counts, as before.
`tests/play-ticks.test.ts` holds the case from the log.

**Unchanged (his call):** a pause never takes a song off. The song leaves when its full play
ends: the next song starts, or the app closes. (§9 adds a skip.)

## 9. A skip takes the song off too (2026-11-01)

> **Part:** built · 2026-11-01

**His ask:** "I listen to a song and the first 2 seconds really don't sit right with me. If I
skip it, it should fall off the list."

**His calls.**
1. **Any skip removes the song,** at any point before the full mark (the other option was a skip
   after 2 s or more of listening).
2. **The same setting governs it.** Off keeps the song. Played from List counts only a skip in a
   play started from the Later list. Played Anywhere counts a skip from anywhere.
3. **A skip shows a toast with Undo:** "Took “Song” off “Saved for the Right Day”." A full play
   still removes the song without a toast.

**The terms.** A *skip*: the play ends before the full mark because a different song starts
(Next, a click on another song, the queue moving on). These are not skips, so the song stays:
a pause, an app close, a restart of the same song (Previous to its start, a re-click).

**As built.**
- `stats.ts` `onPlayEnd(song, how)`: `how` is `"full"`, `"skip"` or `"stop"`. `finalizeEvent`
  takes the song that starts now (`startEvent` passes it). A play that is not full ends as a
  skip only when that song is a different one; with no song (`beforeunload`) it is a stop.
- `listen-later.ts`: `takeFromLater` returns each song with the row it held. A skip counts
  `later.skip` and shows the toast. Skips within 5 s (`SKIP_NOTE_MS`, the toast's own time)
  share one toast: "Took N songs off “…”." Its Undo puts every song it names back in its old
  row (`putBack`: append, then `playlistReorder`; the end when the list is shorter now), and
  counts `later.undo`. A song the list holds again is left alone.
- The log: `later:skipped` per song (the id and the mode), `later:undo` with `kind: "skip"`.
- The use count `later.skip` (USAGE-COUNTS.md §18), copied to the worker by
  `npm run usage:keys`. It needs the same worker deploy as the other use counts.

**Claude's choices, for his review.**
- **Quick skips share one toast,** so five Next presses show one notice with one Undo, not five.
- **Undo puts a song back in its old row,** not at the end.
- **A song that fails to load and moves on counts as a skip** (it is a different song starting
  before the mark). The toast and its Undo cover it.

**Desk test.**
1. Settings › Playlists › Remove from Later list automatically › Played from List. Play the Later
   list. Press Next after 1 s. The song leaves the list, and the toast says so.
2. Press Undo. The song is back in its old row.
3. Press Next three times quickly. One toast names 3 songs. Undo puts all three back in order.
4. Press Previous to restart the song, then pause it, then close the app. The song stays.
5. Play a Later-list song from Search and skip it. It stays (Played from List). Switch to Played
   Anywhere and repeat: it leaves.
6. Set the row to Off. Skip a song from the list. It stays.
