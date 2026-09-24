---
status: idea
desk_test: none
sources: []
updated: 2026-09-23
---
# Deploy a worker without dropping live connections

Opened 2026-09-23 by the owner, while the DeetsSupport change for DeetsMusic Beta waited. He wants a
way to deploy a worker with no live connection lost. One example he gave: a backup or second path.
**Nothing here is decided or researched.** This doc holds the problem and the facts found so far.
The forks come to him before anything is built.

**Terms.**
- **Socket worker** — a worker whose Durable Object holds live WebSockets: `../DeetsMusicRooms`
  (listening rooms) and `../DeetsMusicFriends` (Friends presence).
- **Request worker** — a worker that only answers HTTP requests: `../DeetsSupport` (the token
  mint, sign-in, updates, reports).

## 1. Which deploys drop what

| Worker | Holds sockets | What a deploy does today |
|---|---|---|
| DeetsMusicRooms | yes (room DO) | Drops every live room socket (ROOMS.md §17.10: inferred from a failed check run, **not proved**) |
| DeetsMusicFriends | yes (presence) | Assumed the same. Not measured |
| DeetsSupport | no | A request that is running at the deploy may fail. Nothing stays open, so no socket drops |

Correction, 2026-09-23: this session first said a DeetsSupport deploy drops room sockets. It does
not. DeetsSupport has no WebSocket and no Durable Object.

## 2. What already exists

- **The room app reconnects.** `src/room.ts` has a reconnect with backoff, and the `reconnecting`
  phase. The host comes back with its host token; a guest comes back without one (ROOMS.md §7).
- **Room state is in DO storage**, not only in memory: `meta`, `transport` and `queue`
  (`DeetsMusicRooms/src/room.js`). A new DO instance can read them again.
- So a deploy may already be a short drop, followed by a reconnect to the same room. **Nobody has
  measured this.** The first step is to measure it: deploy while a test room is open, then read both
  apps' diag rings for the drop, the reconnect and the time between them.

## 3. Paths to consider (not researched)

1. **Make the drop invisible.** Keep the socket drop, and make sure every client comes back to the
   same state within about a second. The UI holds the room during `reconnecting`, and the song never
   stops, because playback is local. This needs no second worker.
2. **A second path (the owner's example).** A standby worker on a second host. A client that loses
   its socket goes to the other host. Deploy A, then deploy B. Open question: a room is ONE Durable
   Object. Two workers would need to reach the same object, or hand its state over.
3. **Cloudflare's own tools.** Versions and gradual deployments, and how they treat Durable Objects
   and their open sockets. Check the Cloudflare docs before any design.
4. **A deploy window.** No code at all: deploy only when no room and no presence is live, found from
   the worker's own counts. This is today's rule, "do not deploy while anyone is in a room",
   written down as a check.

## 4. Waiting on this

- The DeetsSupport change for DeetsMusic Beta (BETA.md §5): the `deetsmusic-beta` sign-in scheme
  and the pre-release version order. DeetsSupport is a request worker, so it does not depend on
  this problem. The owner chose to hold it for now.
- The rooms worker's `epoch` crumb and any later rooms or friends change (ROOMS.md, FRIENDS.md
  §8.7.3).
- Add a room member as a friend (FRIENDS.md §18): a new `friendOffer` relay in the rooms worker.
