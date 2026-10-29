---
status: built
desk_test: open
sources: [src/home.ts, src/home-card.ts, src/friends.ts, src/friends-log.ts, tests/friends-log.test.ts, ../DeetsMusicFriends/src/friends.js, ../DeetsMusicFriends/src/sanitize.js]
updated: 2026-10-29
---
# Friends are listening to: a Home shelf of your friends' albums

**An idea (2026-10-27), his ask; designed with him 2026-10-29 (§2).** His words: a "Friends are
listening to" shelf on Home. "It'd only appear if the user has friends in DeetsMusic." On
2026-10-29: the albums friends play now, a vertical divider, then their recent listens. BUILT
2026-10-29 (§4); the worker change is not deployed and the desk test (§5) is open.

**The terms.**
- *A friend:* a person on your list in the people panel (FRIENDS.md §16). Mutual: they see you
  only after you add each other.
- *Presence:* the song a friend plays now, as their app sent it (`FriendPresence` in
  `src/friends.ts`): the catalog id, title, artist, album, artwork, `startedAt`, `playing`, and a
  room code when they host one.
- *The shelf:* a Home shelf (HOME.md §1), a row of tiles that scrolls sideways.
- *The log:* the albums a friend played recently, as your app keeps them (§2.2).

## 1. What exists today (read 2026-10-27, checked again 2026-10-29)

- **Apple gives us no friend data.** The Apple Music API has no profile, no follow list and no
  friends' plays. A shelf of friends can only come from our own Friends feature.
- **The app already holds each friend's presence.** `initFriends` opens one watch socket per
  friend at launch when the list is not empty. `onFriendsChange` gives `FriendsState.rows`, one
  `FriendRow` per friend with `online`, `allowed` and `presence`.
- **A presence goes out on every song change** while *Share what I play* is on (`push` →
  `sendNow` in `friends.ts`, coalesced, FRIENDS.md §5.1 rule 2).
- **Presence is live only.** The worker holds nothing in storage (FRIENDS.md §16.6). Nothing
  records what a friend played before.
- **The worker drops unknown fields.** `sanitizePresence` (`sanitize.js`) rebuilds the presence
  from a fixed list of fields. A new field reaches friends only after a worker change.
- **Turning sharing off looks like a pause today.** `stopSharing` sends an empty presence and
  closes the socket. The hour's pause and the 5-minute "stopped" (`SLEEP_MS`) send the same
  empty presence. A watcher cannot tell them apart.
- **The people panel's box** already has *Play this* and *Go to Album* on its right-click menu,
  and a **Listen Along** button (FRIENDS.md §16.1, §16.2).
- **Home leaves out an empty shelf** (HOME.md §1). A shelf has an id in the `HomeShelf` union
  (`home.ts`); a shelf that a later version adds appears at the end of a user's own order
  (MOVABLE-ROWS.md §13).
- **No vertical divider exists inside a shelf.** The nearest pattern is the horizontal group line
  in menus and Rulez (`ctx-menu__divider`, `rulez__divider`).

## 2. The design (his calls, 2026-10-29)

### 2.1 What a friend's app sends (his call)
- Every presence also carries `recent`: the friend's **last 3 albums**, newest first. Songs from
  the same album count once. A station has no album and is never in the list.
- It rides the switch the friend already turned on, *Share what I play*. No new setting.
- A friend who just connected fills your shelf from the first message.
- When the friend turns *Share what I play* off, the last message carries `sharing: false`. The
  hour's pause and the 5-minute "stopped" do not.

### 2.2 What your app keeps (his call)
- A rolling log of **10 albums per friend**, newest first, merged from each `recent` and each
  presence. It lives in memory and one small file on this PC. Nothing goes to the worker's
  storage.
- **Deleted at once** when that friend's `sharing: false` arrives (his words: "delete it the
  second the user turns off share what I play").
- Also deleted when the friend removes you (the worker sends `denied`), and when you remove them.
- Also deleted after 7 days with no word from that friend: it covers a friend who turned sharing
  off while you were offline, and a friend on an older app that sends no `sharing: false`.
- During a friend's hour's pause, their tiles hide; their log stays.

### 2.3 The shelf
- **Left:** one tile per friend playing now, the album's cover, the friend's name under it. No
  "now" mark and no side labels: the size of each side says which is which (his call,
  2026-10-29). These tiles do not count toward the 10 (his call, 2026-10-29).
- **A plain vertical line** (his call), then **right: up to 10 recent albums** (his call). With one friend,
  that friend's 10. With more, the friends take turns (his call, 2026-10-29): each turn takes
  one album from each friend, the friend with the newest album first; a friend with fewer albums
  leaves room for the others.
- No one playing now: the left side and the divider hide. Nothing to show, or no friends: the
  whole shelf hides (HOME.md §1).
- A click plays the album, as every Home tile does (§4.1). Right-click: the media menu
  (`media-menu.ts`), plus Listen Along on a left tile.
- The new shelf goes at the end of the user's Home order and moves like any shelf.
- The label: **"Friends on DM"** (his call, 2026-10-29).

### 2.4 The worker change and its deploy (his OK, 2026-10-29)
- `sanitizePresence` keeps `recent`: up to 3 entries of title, artist, artwork URL (https only)
  and catalog id, each cleaned like the presence's own fields. It also keeps `sharing: false`.
- Old apps ignore the new fields, so no protocol bump. Deploy the worker first, then release the
  app. A friend on an old app shows only the left tile.
- **What users notice:** the deploy drops every live friends socket. Each app retries after 2 s
  (`BACKOFF_MS`). Friend rows keep their song while the socket is down (`Link.presence`), and the
  "Friends is gone" notice comes only after the third failed try, so a short deploy shows
  nothing. Music, rooms (their own worker) and the rest of the app do not feel it.

## 3. Open
- Does it tie into FRIENDS.md §20 (picks and the Diary)? Not part of this design.

## 4. As built (2026-10-29)

**The worker** (`../DeetsMusicFriends`): `sanitize.js` rebuilds `presence.recent` (at most 3;
album, artist, song title, song catalog id, an Apple-host cover, a time clamped to now; an entry
with no album or no song id is dropped) and exports `sanitizeSharing` (`false`, `"paused"`, or
left out). `friends.js` passes `sharing` on in the broadcast. `protocol.js` records the shapes.
`scripts/check.mjs` has eight new rows; all pass against `wrangler dev`. Against live (before the
deploy) only those rows fail, which also showed that the uncommitted key-pin work (§19) is
already live: a deploy ships only this change.

**The rules** (`src/friends-log.ts`, pure, `tests/friends-log.test.ts`): `mergeAlbums` (one
entry per album name + artist, the newest play wins, newest first, capped), `expireLogs` (7
days from the last word), `recentToSend` (your own list without the album playing now, 3),
`takeTurns` (the split), `asLogAlbum` (reads an entry off the wire or out of storage).

**The sender** (`friends.ts`): `sendNow` adds `recent` and then puts the album playing now at
the head of its own list (`deets.friends.sent`, 4 kept). The list grows only inside `sendNow`,
which runs only while *Share what I play* is on, so nothing played with sharing off is ever
sent. `stopSharing` sends `sharing: false` (and deletes the list) or `sharing: "paused"`.

**The receiver** (`friends.ts`): `logPresence` folds each trusted presence into that friend's
log (`deets.friends.log`, 10 kept); `false` deletes it, `"paused"` hides it, an empty presence
restarts the 7 days. `denied` and a friend off the list (any path through `reloadList`) delete
it. `friendShelfParts()` gives Home each friend's album playing now (only while `playing`) and
their log, the paused friends left out. Each deletion and pause logs `friends:log-forget` /
`friends:log-pause`.

**The shelf** (`home.ts` `friendsShelf`, `home-card.ts`): the `friends` shelf, last in the
built-in order. A tile is `albumItem` from one real song (yours from the store when you have
it), so a press plays the whole album through the one song→album hop, as Recently Played does
for a catalog album; the sub line is the friend's name. `HomeShelf.split` puts
`<span class="home-split">` before the first recent tile. The card finds a tile's item in its
OWN shelf now (`itemAt`), because one album can be on two shelves with two menus. The card
rebuilds on `onFriendsChange` only when the shelf's content changed, 1.5 s after the last change.
Tokens: `--home-split-w` (1px, the menu divider's), `--home-split-gap`; color `--border`.

### 4.1 What Claude decided inside his calls (for his review)
- **A click plays the album**, as every Home tile does. The design said "opens"; Home has no
  open on a tile (`activate` in home-card.ts), so the pattern wins (CLAUDE.md, item 00).
- **"Playing now" means `playing: true`.** A friend who paused shows their album on the right.
- **No Hide row** on these tiles: Hide is keyed on the album and would also hide it from Recently
  Played. It is the Songs of the Day shelf's precedent.
- **The sender's list holds only what played while sharing was on**, and turning sharing off
  deletes it, the same rule his call set for the receiver.
- The line stretches the tile's full height (cover and the two text lines).
- A friend's tile on the left wears their name; the same album on the right is skipped, and one
  album two friends both played shows once, with the name of the friend whose turn came first.

## 5. Desk test (open)

Needs the worker deployed (or both apps' `friendsUrl` on a local `wrangler dev`) and two apps
that are friends (`npm run dev:app -- --second`).
1. App B: *Share what I play* on. Play songs from 4 albums. App A, Home: **Friends on DM** shows
   B's album playing now on the left, a line, and B's other albums on the right.
2. App B: skip to a new album. Within about 20 s (the coalesce) App A's left tile changes and the
   old album moves to the right.
3. App B: pause. The album moves to the right; the line goes when the left is empty.
4. App B: Settings › *Share what I play* › Pause for an hour. App A: B's tiles go. End the pause
   and play: they come back.
5. App B: turn *Share what I play* off. App A: B's tiles go, and `deets.friends.log` holds no B
   (`friends:log-forget {why:"sharing off"}` in the log).
6. App A: right-click a left tile: the album menu, Listen Along, no Hide. Click a tile: the
   album plays from its first song.
7. App A: remove B. B's albums are gone.
