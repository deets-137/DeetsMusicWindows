# DeetsMusic — listening rooms

> **Designed 2026-09-16. Not built.** Decided by the user (2026-09-16): a title bar item with three
> figures opens a Room panel; a room code of **8 characters from a 32-character set**; a **new,
> dedicated Cloudflare worker** (not the DeetsRadio worker); the room **ends when the host leaves**,
> and a room with only the host left needs no broadcast; **seek is a room command**; songs heard in a
> room **count everywhere** (History, Home, play counts, Last.fm); **the panel sets which controls
> guests may use**. The user asked Claude to pick the clock owner on free-tier limits, conflicts and
> user experience: **the worker keeps the clock** (§4). After the app feature works, **the website's
> DeetsRadio is rebuilt as a client of this worker** (§13).
> Defaults that Claude chose and the user can still change are in §14.

**Terms used here.**
- **Room**: a shared queue and clock that several DeetsMusic apps follow. Each app plays the songs
  through its own MusicKit and its own Apple Music subscription. **No audio passes between apps.**
- **Host**: the person who made the room. **Guest**: anyone who joined with the code.
- **Room clock**: the room's record of the current song, whether it plays, and the moment it started
  (`startedAt`, epoch ms). Every app works out "where the song should be now" from it.
- **Follower**: the player mode that keeps the local MusicKit in step with the room clock.
- **Worker / Durable Object (DO)**: Cloudflare code at the edge. One DO instance per room holds the
  room's state and the WebSocket connections of its members.
- **Drift**: the difference between the local song position and the room clock's position.

---

## 1. What the user sees

1. **The Room item in the title bar.** A line glyph of three figures side by side. The middle figure
   sits a little higher and in front. In a room, the glyph fills (like the AirPlay glyph when it is
   on) and a small count of members shows. Its hover hint: "Listen with friends".
2. **Click opens the Room panel** (a dropdown panel, like Sleep and Sound). Out of a room it shows:
   - **Your name** (one text field, remembered).
   - **Start a room**: makes a room from what you play now and shows the code.
   - **Join**: one field for a code, then Join.
3. **In a room the panel shows:** the code in large type (`K7QM-4XHT`) with **Copy code** and
   **Copy invite link**; the member list (host marked); for the host, the **guest controls** (§8)
   and **Remove** on each guest, and **End room**; for a guest, **Leave room**.
4. **In a room, every card works as usual,** but the queue and transport act on the room (§10).
   Up Next shows who added each song.
5. **A friend clicks the invite link** (`deetsmusic://room?code=K7QM4XHT`). DeetsMusic opens,
   asks for a name if none is saved, and joins.

---

## 2. Decisions

| # | Question | Decision | By |
|---|---|---|---|
| 1 | Server | A new Cloudflare worker for DeetsMusic rooms (working name **DeetsRooms**). | User |
| 2 | Clock owner | The worker (the room's DO) keeps the clock and moves to the next song on an alarm. | Claude, on request (§4) |
| 3 | Room life | The room ends when the host leaves (after a short grace window, §7). A room with only the host in it stays open, but nothing is sent. | User |
| 4 | Code | 8 characters from a 32-character set, shown as `XXXX-XXXX` (§6). | User |
| 5 | Controls | The host sets which controls guests may use, in the panel (§8). | User |
| 6 | Seek | A room command. Everyone moves. | User |
| 7 | Stats | Room songs count in History, Home, play counts and Last.fm. | User |
| 8 | Website | After the app feature works, DeetsRadio on deets.solutions becomes a client of this worker (§13). | User |
| 9 | Audio | Never shared. Each app plays through its own MusicKit. | Carried over from DeetsRadio |

---

## 3. Architecture

```
DeetsMusic app (host)  ─┐
DeetsMusic app (guest) ─┼─ wss://<rooms host>/room/K7QM4XHT/ws ─> Worker ─> Durable Object "K7QM4XHT"
DeetsMusic app (guest) ─┘                                                   ├─ SQLite storage: room state (§5.2)
                                                                            ├─ hibernatable WebSockets, one per member
                                                                            └─ alarm: song end → next song
POST /room            → mints a free code, makes the DO, returns the code + host token
GET  /room/:code/peek → {exists, members, nowPlaying} for the join preview (rate limited)
```

### 3.1 What we need from Cloudflare

| Part | Need it? | Why |
|---|---|---|
| **Worker** | Yes | Takes HTTP and WebSocket requests and passes them to the room's DO. |
| **Durable Object class** (SQLite backend) | Yes | A plain Worker cannot hold several people's sockets together. The DO holds the sockets, the state and the alarm. |
| **Rate-limit binding** | Yes | Limits code guessing on `peek`, `join` and `POST /room` per IP (§11). A line in `wrangler.jsonc`. |
| Custom domain (for example `rooms.deets.solutions`) | Optional | One DNS record on the zone we already have. `*.workers.dev` also works. |
| D1, KV, R2, Queues, Pages | No | The DO's own storage holds everything a room needs. |

**The worker holds no secrets.** No Apple key, no Last.fm key, no user data except the display names
people type. Each app plays with its own Apple token from DeetsSupport.

### 3.2 Free-tier budget (checked 2026-09-16, developers.cloudflare.com/durable-objects/platform/pricing)

| Workers Free limit | Value | Notes |
|---|---|---|
| Requests | 100,000 / day | **Incoming WebSocket messages count 20:1** (100 messages = 5 requests). Outgoing broadcasts do not count. |
| Duration | 13,000 GB-s / day | A DO that is idle and can hibernate is **not billed for duration**. |
| SQLite rows written | 100,000 / day | Each `setAlarm()` counts as one row written. **This is the limit we reach first.** |
| SQLite rows read | 5 million / day | |
| Stored data | 5 GB total | A room is a few KB. |
| Backend | Only SQLite-backed DOs are on the free plan. | We use SQLite. |

**One evening room, as an example:** 4 people, 3 hours, about 45 songs, about 200 commands.
- Requests: 4 joins + a few reconnects + 200 messages ÷ 20 ≈ **20 requests**.
- Rows written: about 2 per command + 1 alarm per song ≈ **450 rows**.
- Duration: the DO wakes only for a message or an alarm. It is close to zero.

So the free tier carries about **200 evenings like this per day**. **Rule for the build:** keep the
room state in a small number of storage keys (§5.2), so that one command writes 1–2 rows and not one
row per queue entry.

---

## 4. Why the worker keeps the clock

The user asked for the easiest choice on three tests. Both options need the DO (a relay also needs
one place that holds every socket), so the difference is in the rest.

| Test | Worker keeps the clock | Host's app keeps the clock |
|---|---|---|
| **Free tier** | 1 row for each song's alarm. No periodic messages: apps work out the position from `startedAt`. | Same DO. The host must also send position updates or song-end events. About the same cost. **Not a deciding test.** |
| **Code in the app** | **One follower mode** in `player.ts`, used by the host and guests alike. | **Two modes**: the host plays normally and also takes remote commands; guests follow. More code in the biggest file. |
| **Code on the worker** | The rules already exist in the DeetsRadio worker (radio.md "The core mechanic"). We port them. | A relay is small, but the host logic moves into the app. |
| **Guest command speed** | One hop: guest → worker → everyone. | Two hops: guest → worker → host → worker → everyone. |
| **Host network trouble** | The room keeps time. Guests hear no gap while the host reconnects. | The room stops moving. A laptop that sleeps freezes the room. |
| **Website phase (§13)** | A browser tab joins as one more follower. | A browser tab has to be a host or a guest of an app host. |

**Result: the worker keeps the clock.** The cost to the host is the same scheduled start that guests
get (§9.3): the host's own click waits for the lead time too.

---

## 5. Protocol

### 5.1 Versioned from the first message

Every message carries `v` (protocol version, integer, starts at `1`). The join reply carries the
worker's `v` and `minV`. If the app's `v` is below `minV`, the app shows "Update DeetsMusic to join
this room" and does not join. **Why:** installed apps update later than the worker deploys.
DeetsRadio had a deploy where the worker and page had to land at the same time
(radio.md status, day three). Apps cannot land at the same time.

### 5.2 Room state (DO storage)

Keep this in **three keys** (§3.2 rule):

- `meta`: `{ code, createdAt, hostToken, hostName, guestControls (§8), maxMembers }`
- `transport`: `{ current: Entry|null, playing, startedAt, pausedPosition, epoch }`
  (`epoch` counts every change, so a late message can be dropped.)
- `queue`: `{ upcoming: Entry[], history: Entry[] (capped at 50) }`

Members live on the WebSocket attachments (`name`, `memberId`, `isHost`, `joinedAt`, command-rate
counter), so they survive hibernation without a storage write.

**The DO must not keep state only in memory.** Hibernation throws memory away. Every change goes to
storage before the broadcast.

### 5.3 Entry (one song in the room)

```
{
  entryId,            // minted by the room
  catalogId,          // Apple catalog id — the play target for every member
  isrc,               // kept for the website phase and later matching
  title, artist, album,
  artworkUrl,         // Apple artwork template
  durationMs,         // the room clock moves on this
  addedBy,            // memberId + name at add time
  addedAt
}
```

Only catalog songs can enter a room. A library-only song (uploaded, or not in the catalog) has no id
that other members can play. The app does not offer Add for it and shows a note: "This song is only
in your library."

### 5.4 Messages

Client → room: `join {v, code, name, hostToken?}` · `play` · `pause` · `next` · `previous` ·
`seek {positionMs}` · `add {entries[], where: "next"|"end"}` · `remove {entryId}` ·
`move {entryId, toIndex}` · `setControls {…}` (host) · `kick {memberId}` (host) · `end` (host) ·
`leave` · `ping`.

Room → clients: `state {v, serverNow, meta-lite, transport, queue, members}` (on join and on any
change) · `denied {command, reason}` · `ended {reason: "host-left"|"host-ended"}` ·
`kicked` · `error {code}`.

Every broadcast carries `serverNow`, so each app keeps a clock offset (radio.md "Sync details").

### 5.5 Transport rules (ported from DeetsRadio)

- **Scheduled start.** `play` from idle, `next`, `previous` and `play` after a pause set
  `startedAt = now + LEAD` (§9.3), so apps can buffer and start together.
- **Seamless song end.** The alarm fires at `startedAt + durationMs`. The next song's
  `startedAt` is the old song's exact end. No lead between songs.
- **Pause** stores `pausedPosition`. A pause during the lead cancels back to where the lead started.
- **Seek** (new, not in DeetsRadio): `startedAt = now + SEEK_LEAD − positionMs`; alarm reset.
  `SEEK_LEAD` is short (a few hundred ms) because the song is already buffered.
- **Queue empty:** the room goes idle. The first `add` while idle starts the song.
- **Apps never move to the next song on their own.** At their local song end they go silent and
  wait for the room. If apps moved on their own, drift would skip songs twice.

---

## 6. Room codes

- **Set:** 32 characters, `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (Crockford base32: no I, L, O, U).
- **Length:** 8 characters = 40 bits = about 1.1 trillion codes.
- **Shown as** `K7QM-4XHT`. **Typed** in any case, with or without the dash. On input the app maps
  `O`→`0` and `I`/`L`→`1`, so a misread code still works.
- **The worker makes the code** (`POST /room`), not the app. It picks a random code from
  `crypto.getRandomValues`, checks that no live room uses it, and returns it with a random
  **host token** (32 bytes). The host token proves who the host is after a reconnect.
- **Why 40 bits is enough:** at 30 guesses per minute per IP (§11), one IP address needs about
  70,000 years to try half the codes. A 16-bit code would take about 18 hours.

---

## 7. Room life

| Event | Result |
|---|---|
| Host starts a room | The room takes the host's current song, position and Up Next. |
| Guest joins | The guest's current queue is **saved** (§9.4). The guest's player follows the room from the current position. |
| All guests leave, host stays | The room stays open. Nothing is sent. The DO hibernates. The host keeps listening, and the queue still acts on the room so a guest can join again. |
| **Host's connection drops** | **Grace window: 60 s.** Guests see "Waiting for the host" and keep playing on the room clock. The host's app reconnects with its host token. |
| Host does not return in 60 s, or closes the app, or presses **End room** | The room broadcasts `ended`, closes all sockets and **deletes its storage**. The code is free. |
| A guest's app gets `ended` | Playback stops. The guest's saved queue returns, paused. Toast: "The room ended." |
| Host presses Remove on a guest | That guest gets `kicked`, then the same as `ended`. |

**Why a grace window:** an app update, a Wi-Fi change or a restart would otherwise end the room for
everyone. The user's rule "the room ends when the host leaves" still holds: it ends 60 s later.
The DO keeps the grace window with an alarm, so it costs one row.

---

## 8. Guest controls (the host's settings in the panel)

One row per control. Each row is a two-way pill: **Everyone | Host only**.

| Control | Covers | Default |
|---|---|---|
| Play and pause | play, pause | Everyone |
| Skip | next, previous | Everyone |
| Seek | the scrub bar, seek keys | Everyone |
| Add songs | Play Next, Add to Up Next, drag into Up Next | Everyone |
| Change Up Next | remove, reorder | Everyone |

- Removing a guest and ending the room are always host only.
- The worker checks every command against these settings and answers `denied`. The app also greys
  out a denied control, so a guest rarely sees `denied`.
- The host's choice is saved as the default for the next room (settings key `roomGuestControls`).

---

## 9. The app side

### 9.1 New parts

| Part | What |
|---|---|
| `src/room.ts` | The connection: WebSocket, reconnect with backoff, clock offset, `v` check, state store, command sends. |
| `src/room-panel.ts` | The title bar item and its dropdown panel (§1). |
| Follower mode in `src/player.ts` | §9.3. |
| Room branch in `src/queue.ts` | While in a room, queue operations become room commands, and room `state` messages write the model. The radio-mode functions (`appendCurrent`, `disposePlan`) already show a queue that something outside feeds. |
| Deep link | `deetsmusic://room?code=…` in the same single-instance route that takes `deetsmusic://auth?…` (`src-tauri/src/lib.rs`). |
| Agent | Later: `room` tool (status, join, leave). Agent queue and play commands in a room go through the room like any click. |

### 9.2 What the worker must allow

`ALLOWED_ORIGINS` must contain `http://tauri.localhost` (the installed app's origin: the app does not
set `useHttpsScheme`) and **any** `http://localhost:<port>` (the dev app does not keep one fixed
port). **The origin check is not a security layer here:** any program can send any Origin header.
Code length and rate limits (§6, §11) protect the rooms.

### 9.3 Follower mode

- **Start:** at `startedAt − LEAD`, `setQueue` the song and buffer it. At `startedAt`, play.
- **Drift:** if `|local − expected| > 1.75 s`, seek. At most one correction per 5 s
  (radio.md values; tune in the desk test).
- **Song end:** go silent and wait for the room (§5.5).
- **Late join:** seek to the expected position. No lead.
- **Lock-ups:** port DeetsRadio's safety rules (radio.md "Providers"): every in-flight call has a
  time limit, swap the queue only from a stopped player, a load counter drops a late `setQueue`.
- **The gapless feed window** (`player.ts` feeds MusicKit a few songs ahead) still applies, but the
  room decides when each song starts.
- **LEAD:** DeetsRadio uses 3.5 s with a 3-2-1 countdown. The app's click-to-sound is fast, and a
  3.5 s wait on every Skip would feel slow. **Start at 1.5 s with no countdown**, and measure with the
  `[perf] click→sound` line (CLAUDE.md "How to verify") on a guest on a slow network. §14 item 3.

### 9.4 The guest's own queue

On join, the app saves the guest's queue with the same code as `queue-persist.ts`, under a separate
key. On leave, end or kick, the saved queue returns, paused at the saved song and position.

### 9.5 Stats (decision 7)

Room songs write `play_events`, History, play counts and Last.fm scrobbles like any other play.
The play's context is `room:<code>`, so a later filter can find them.

---

## 10. Features in a room

| Feature | In a room |
|---|---|
| Play / pause / Next / Previous | Room commands (§8). Previous is always "previous song": the "restart if past 3 s" rule does not apply. |
| Seek (scrub bar, keys, `control seek`) | Room command. |
| Play Next / Add to Up Next / drag to Up Next | Room `add`. |
| Remove / reorder Up Next | Room commands. |
| Clicking a song in a list ("play from here") | Host: replaces the room's Up Next with that list from that song (same as today). Guest: allowed only if **Change Up Next** is Everyone, else **Play Next**. |
| Stations | **Not in a room** in v1: a station has no song list that the other apps can follow. Starting a station asks "Leave the room?" |
| Repeat | Off in a room, button disabled with a hint. |
| Shuffle (the button) | Off. **Shuffle** on a collection is still allowed: it adds the songs in shuffled order. |
| Sleep timer | Acts on your own app only. When it fires, you leave the room. For the host, the room ends (§7). |
| Volume, Sound panel, AirPlay, output device, Stream quality | Your own app only. No change. |
| Press record player, album colors, mini player, tray | No change. They follow the local player. |
| History, Home, Last.fm | Count (§9.5). |
| Media keys / Windows media overlay | Send room commands. |

---

## 11. Abuse limits (worker)

Ported from DeetsRadio (radio.md "Limits & costs"):
- **Per-socket command limit:** 20 messages per 10 s. The counter rides the socket attachment.
- **IP rate limit** on `peek`, WebSocket `join` and `POST /room`: 30 per 60 s.
- **Room size limit:** 32 members. A join past it gets `error: "full"`.
- **Input checks:** `sanitizeEntry()` rebuilds each entry field by field (allowed fields, length
  limits, https-only artwork, a sane duration). Names: 1–24 characters, trimmed, unique in the room.
- **Queue limit:** 500 upcoming entries (row size, not rows: the queue is one key).

---

## 12. Apple terms — check before the build

Each member plays through MusicKit with their own subscription, and no audio passes between apps.
DeetsRadio already does this on the web. **Still read, before the build:** the MusicKit parts of the
Apple Developer Program License Agreement on synchronized or group listening in a distributed app.
Record the text and the reading here, as SOUND.md §0 did for §3.3.6.D.

---

## 13. Website phase: DeetsRadio on this worker

After the app feature works and is committed:
1. The deets.solutions DeetsRadio tab becomes a **client of the DeetsRooms worker**. App members and
   browser members share one room.
2. The page keeps its own rules (no build step, plain JS, handwritten strings in `radio/strings.js`).
   It speaks protocol `v` like the app.
3. Features the DeetsRadio worker has and this one does not, to settle then:
   - Rooms that live on when everyone leaves (this design ends them).
   - Free-form room names (this design uses generated codes).
   - The no-login 30 s preview listener.
   - YouTube entries (`Entry.youtube`). The app cannot play them; it would stay silent with a note.
   - The website as a **host**. MusicKit JS in a browser can follow the clock, so a browser host
     works in principle.
4. The old DeetsRadio worker is retired once the page no longer calls it.

The site's own record: DeetsSolutions `docs/HANDOFF.md` Next up.

---

## 14. Defaults Claude chose (the user can change them)

1. **Grace window for the host:** 60 s (§7).
2. **Room size limit:** 32 (§11).
3. **LEAD:** 1.5 s, no countdown (§9.3).
4. **Stations** leave the room (§10).
5. **Repeat** is off in a room (§10).
6. **Sleep timer** fires → you leave; host → room ends (§10).
7. **Guest's queue** is saved on join and returns on leave (§9.4).
8. **Guest controls** default to Everyone for all five (§8).
9. **Worker name** DeetsRooms, and whether it gets `rooms.deets.solutions` (§3).

---

## 15. Build order (when the user says go)

1. §12 terms check. Record it.
2. Worker: `POST /room`, DO with state keys, WebSocket join, transport rules + alarm, controls,
   limits, `v`. Local `wrangler dev` first (pick a free port; do not fix one).
3. `src/room.ts` + follower mode + the queue branch, driven from the console with two dev apps.
   (Two `dev:app` instances need separate identifiers or data dirs; check before the first run.)
4. Title bar item + Room panel. Walk the CLAUDE.md pre-build checklist: `.pop` + `enterRows`,
   tokens, hover hints in ONBOARDING.md, toasts in TOASTS.md §5, settings keys (`roomName`,
   `roomGuestControls`) in `settings-store.ts` + `agent-settings.ts` + AGENT.md, `diag.log` for
   join / leave / drift seek / reconnect / ended, `app-scroll` on the member list,
   `dataset.frames` on the panel.
5. Deep link `deetsmusic://room`. Note: `dev:app` does not take `deetsmusic://` links from the
   installed app's registration (`src-tauri/src/apple.rs` §2a fork 4 note), so test invites on the
   installed build.
6. Desk test (to write into this section at build time): two PCs, or one PC with the installed app +
   dev app on different Apple accounts; host start, guest join by code and by link, each §8 control
   on both settings, seek, song end, host network drop < 60 s and > 60 s, guest kick, `v` below
   `minV`.
7. §13 website phase.
