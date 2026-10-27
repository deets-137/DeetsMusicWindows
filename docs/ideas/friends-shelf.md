---
status: idea
desk_test: none
sources: [src/home.ts, src/home-card.ts, src/friends.ts, src/friends-panel.ts, ../DeetsMusicFriends/src/friends.js]
updated: 2026-10-27
---
# Friends are listening to: a Home shelf of your friends' songs

**An idea (2026-10-27), his ask.** His words: a "Friends are listening to" shelf on Home. "It'd
only appear if the user has friends in DeetsMusic." Nothing is built and nothing is decided.
**He asked to keep it as open ended as possible:** this doc records what exists today, a
sketch, and the open questions. It makes no recommendation. Every question is his.

**The terms.**
- *A friend:* a person on your list in the people panel (FRIENDS.md §16). Mutual: they see you
  only after you add each other.
- *Presence:* the song a friend plays now, as their app sent it (`FriendPresence` in
  `src/friends.ts`): the catalog id, title, artist, album, artwork, `startedAt`, `playing`, and a
  room code when they host one.
- *The shelf:* a Home shelf (HOME.md §1), a row of tiles that scrolls sideways.

## 1. What exists today (read 2026-10-27)

- **Apple gives us no friend data.** The Apple Music API has no profile, no follow list and no
  friends' plays. A shelf of friends can only come from our own Friends feature (or a new source).
- **The app already holds each friend's presence.** `initFriends` opens one watch socket per
  friend at launch when the list is not empty (`friends.ts:643`). `onFriendsChange` gives
  `FriendsState.rows`, one `FriendRow` per friend with `online`, `allowed` and `presence`.
- **Presence is live only.** The worker holds nothing in storage (FRIENDS.md §16.6). A friend's
  presence ends when their socket closes, and their app sends one "stopped" after 5 minutes
  hidden and paused (`SLEEP_MS`, §5.1 rule 3). Nothing records what a friend played before.
- **What a friend agreed to share** is one switch, *Share what I play*, and the hour's pause
  (FRIENDS.md §4, P1). They agreed to presence, not to a history.
- **The people panel's box** already has *Play this* and *Go to Album* on its right-click menu,
  and a **Listen Along** button (FRIENDS.md §16.1, §16.2). The presence carries `catalogId`, so
  the song can be played from the catalog.
- **Home leaves out an empty shelf** (HOME.md §1). A shelf has an id in the `HomeShelf` union
  (`home.ts:132`); a shelf that a later version adds appears at the end of a user's own order
  (MOVABLE-ROWS.md §13). Home builds again on events (`home-card.ts:333`–`:356`).
- **FRIENDS.md §20** (on the docket) asks what friends could see beyond presence (Songs of the
  Day, the Diary), and names Home as one possible place. This shelf may be a part of that, or
  apart from it.

## 2. A sketch (one possible shape, not a proposal)

A shelf that shows only when the user has friends, with one tile per friend: the song's cover,
the song, and the friend's name. The data could be the presence the app already holds, at no
Apple call and no worker change. Other shapes are as open: more than one song per friend, a
song a friend picked rather than played, a tile that is the friend and not the song.

## 3. Open questions

- What does a tile stand for: a song, a friend, or something else?
- What does the shelf hold: only songs playing now, the last song while a friend is online, or a
  history? A history needs somewhere to live (this PC, or the worker) and the friend's consent.
- What does "has friends" mean: any friend on the list, a mutual friend, a friend online now?
- What shows when there are friends but nothing to show?
- What does a click do, and what is on the right-click menu (play, Go to Album, Listen Along)?
- Where does the shelf sit in Home's order, and can a user hide it?
- Does it tie into FRIENDS.md §20 (picks and the Diary), or stay presence only?
- What is the label? His working name: "Friends are listening to".
