# DeetsMusic — DeetsMusicRooms (listening rooms)

> **Named DeetsMusicRooms (2026-09-17).** The feature, the worker and its repo all carry this
> name, in line with the other Deets workers.
> "DeetsRadio" below always means the **older website feature** on deets.solutions and its own
> worker, which this design borrows rules from. **The website is out of scope (§13).**
>
> **Apple terms read 2026-09-17 (§12).** No clause in the agreement names group listening. The
> design holds on every clause that touches it. The one item it raised is decided: **a guest's Pause
> never greys out** — under Host only it stops that guest's own app (§12.3, §8).
>
> **BUILT 2026-09-17 (§16 = as built). Not deployed, and not desk-tested.** The worker
> runs locally (its own repo, `../DeetsMusicRooms`; 23 protocol checks pass, §16.1) and the app
> side compiles.
> Two things stand between this and a real room: the worker has to be deployed (the owner's
> call, §16.3), and two apps have to meet in a room at the desk (§16.4).
>
> **Designed 2026-09-16.** Decided by the user (2026-09-16): a title bar item with three
> figures opens a Room panel; a room code of **8 characters from a 32-character set**; a **new,
> dedicated Cloudflare worker, DeetsMusicRooms** (not the old DeetsRadio worker); the room **ends when the
> host leaves**, and a room with only the host left needs no broadcast; **seek is a room command**;
> songs heard in a room **count everywhere** (History, Home, play counts, Last.fm); **the panel sets
> which controls guests may use**. The user asked Claude to pick the clock owner on free-tier limits,
> conflicts and user experience: **the worker keeps the clock** (§4).
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
| 1 | Server | A new Cloudflare worker for DeetsMusic rooms, **DeetsMusicRooms**, in its own private repo beside DeetsAccounts and DeetsSupport. Name settled 2026-09-17. | User |
| 2 | Clock owner | The worker (the room's DO) keeps the clock and moves to the next song on an alarm. | Claude, on request (§4) |
| 3 | Room life | The room ends when the host leaves (after a short grace window, §7). A room with only the host in it stays open, but nothing is sent. | User |
| 4 | Code | 8 characters from a 32-character set, shown as `XXXX-XXXX` (§6). | User |
| 5 | Controls | The host sets which controls guests may use, in the panel (§8). | User |
| 6 | Seek | A room command. Everyone moves. | User |
| 7 | Stats | Room songs count in History, Home, play counts and Last.fm. | User |
| 8 | Website | **Out of scope** (2026-09-17). The site and its old worker are not a constraint; we borrow rules from them and owe nothing back (§13). | User |
| 9 | Audio | Never shared. Each app plays through its own MusicKit. | Carried over from DeetsRadio |
| 10 | Apple terms | Read 2026-09-17. No clause names group listening; the design holds on every clause that touches it (§12). | Claude |
| 11 | Guest's Pause | Never greys out. Under "Host only" it stops the guest's own app ("Stop listening"), and the room clock runs on (§12.3, §8). | User |

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

The user asked for the easiest choice on three tests. (A sixth test, the website phase, was
dropped on 2026-09-17 with the website itself, §13. It favoured the worker too; the result is
unchanged.) Both options need the DO (a relay also needs
one place that holds every socket), so the difference is in the rest.

| Test | Worker keeps the clock | Host's app keeps the clock |
|---|---|---|
| **Free tier** | 1 row for each song's alarm. No periodic messages: apps work out the position from `startedAt`. | Same DO. The host must also send position updates or song-end events. About the same cost. **Not a deciding test.** |
| **Code in the app** | **One follower mode** in `player.ts`, used by the host and guests alike. | **Two modes**: the host plays normally and also takes remote commands; guests follow. More code in the biggest file. |
| **Code on the worker** | The rules already exist in the DeetsRadio worker (radio.md "The core mechanic"). We port them. | A relay is small, but the host logic moves into the app. |
| **Guest command speed** | One hop: guest → worker → everyone. | Two hops: guest → worker → host → worker → everyone. |
| **Host network trouble** | The room keeps time. Guests hear no gap while the host reconnects. | The room stops moving. A laptop that sleeps freezes the room. |

**Result: the worker keeps the clock.** The cost to the host is the same scheduled start that guests
get (§9.3): the host's own click waits for the lead time too.

---

## 5. Protocol

### 5.1 Versioned from the first message

Every message carries `v` (protocol version, integer, starts at `1`). The join reply carries the
worker's `v` and `minV`. If the app's `v` is below `minV`, the app shows "Update DeetsMusic to join
this room" and does not join. **Why:** installed apps update later than the worker deploys.
This is not about a web page any more (§13): it is about installed apps,
which update whenever their owner lets them, long after the worker deploys.

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
  isrc,               // kept for matching a song across libraries later; no other use today
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
- **The Pause button never greys out** (decided 2026-09-17, §12.3). When "Play and pause" is Host
  only, a guest's Pause becomes **Stop listening**: it stops that guest's own app and leaves the room
  clock running. Play then reads **Listen again** and re-joins the clock at the room's position, the
  same path as a late join (§9.3). This keeps the standard media control present and truthful under
  DPLA §3.3.6.D, which is why the row is worded this way and not greyed.
- The worker checks every command against these settings and answers `denied`. The app also greys
  out a denied control, so a guest rarely sees `denied`. **Pause is the exception above.**
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
| Play / pause / Next / Previous | Room commands (§8). Previous is always "previous song": the "restart if past 3 s" rule does not apply. **Pause with Play/pause set to Host only** stops your own app instead (Stop listening → Listen again, §8). |
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

Ported from DeetsRadio (radio.md "Limits & costs"), then brought up to the house set the other
Deets workers carry (2026-09-17 — DeetsAccounts and DeetsSupport were read side by side):

| Guard | Value | Note |
|---|---|---|
| **IP rate limit** | 30 per 60 s | On `POST /room`, `peek` and the WebSocket join. The `ratelimits` binding; **fails OPEN** if absent, so `wrangler dev` still runs. |
| **Per-socket command limit** | 20 per 10 s | The counter rides the socket attachment, so it survives hibernation with no storage write. |
| **Socket message size** | 256 KB | Checked **before** `JSON.parse`. A full 500-song add of real Apple entries is about 150 KB. |
| **POST /room body** | 4 KB → `413` | The body is a name and five permissions. The shape DeetsSupport's `readJson` uses. |
| **Kill switch** | `KILL_ROOMS` | Non-empty: no new room (503), no new member; rooms already running finish. The shape of `KILL_BOARDS` and `KILL_UPDATE`. |
| **Room size** | 32 members | A join past it gets `error: "full"`. |
| **Queue** | 500 upcoming | One storage key, so this is a size cap as much as a count. |
| **Entry text** | 120 chars, artwork 220 | Cut from 200/400 on 2026-09-17 (below). |
| **Credential-shaped text** | dropped | A JWT-shaped string is blanked rather than stored and shown to the room — DeetsSupport's rule on every intake. |
| **Input checks** | `sanitizeEntry()` | Rebuilds each entry field by field: allowed fields, length limits, https-only artwork, a sane duration. Names 1–24 characters, trimmed, unique in the room. |
| **Unclaimed rooms** | 10 minutes | A room minted by `POST /room` that nobody joins deletes itself (§16.3). |

**The size that matters is what the room sends BACK, not what a client sends.** Measured
2026-09-17 on a full 500-entry room with worst-case entries: **one command re-broadcast 596 KB to
every member**, because every `state` carries the whole queue. That is what cut the text caps from
200/400 to 120/220 — a generous cap is paid 32 times over, on every command. With real Apple
metadata a full room is about 60 KB a broadcast. **If a room ever feels heavy on a slow
connection, the fix is a delta `state`, not a smaller cap.** No secrets are attached to the worker
and none are needed (§3.1).

---

## 12. Apple terms — read 2026-09-17

Read from the Apple Developer Program License Agreement (the English PDF on developer.apple.com,
§3.3.6.D MusicKit) and the Apple Media Services Terms and Conditions. **The agreement has no clause
about group listening, synchronized listening between users, or a shared playback session.** Neither
document names the case. The reading below is therefore built from the clauses that touch it.

### 12.1 The clauses, quoted

| # | Clause (DPLA §3.3.6.D unless marked) | Quoted text |
|---|---|---|
| a | Purpose limit | "You agree not to call the MusicKit APIs or use MusicKit JS … for purposes unrelated to **facilitating access to Your end users' Apple Music subscriptions**." |
| b | Money | "You agree not to require payment for or indirectly monetize access to the Apple Music service (e.g. in-app purchase, advertising, requesting user info)." |
| c | **Controls** | "full songs must be enabled for playback, and **users must initiate playback and be able to navigate playback using standard media controls such as 'play,' 'pause,' and 'skip'**, and You agree to not misrepresent the functionality of these controls" |
| d | **Synchronize** | "You may not, and You may not permit Your end users to, download, upload, or modify any MusicKit Content and **MusicKit Content cannot be synchronized with any other content**, unless otherwise permitted by Apple in the Documentation" |
| e | Rendering | "You may play MusicKit Content only as rendered by the MusicKit APIs or MusicKit JS and only as permitted in the Documentation" |
| f | User metadata | "Metadata from users (such as playlists and favorites) may be used only to provide a service or function that is **clearly disclosed to end users** and that is directly relevant to the use of Your Application" |
| g | DPLA §2.8 | "You agree not to **share access to mechanisms provided to You by Apple** for the use of the Services with any third party. Further, You agree not to create or attempt to create a substitute or similar service." |
| h | Media Services T&C | "You may use the Services and Content only for **personal, noncommercial purposes**." |

### 12.2 The reading, clause by clause

| # | Against a room | Verdict |
|---|---|---|
| a | Every member plays from their own subscription, through their own MusicKit. The room carries song ids and a clock, never audio and never a song. | Inside the purpose. |
| b | Free. No advertising, no purchase, no data collected for money. | Clear. |
| c | §8 lets the host set Play/Pause, Skip and Seek to "Host only". **Settled §12.3:** Pause never greys out — under Host only it stops the guest's own app ("Stop listening"). Skip and Seek may still be host-only; they move the room, and the guest keeps play, pause and leave. | Answered. |
| d | "Any other content" reads most naturally as other *media*: a video, a second audio track, a slideshow. A room synchronizes MusicKit Content with **the same MusicKit Content on another subscriber's app**, not with other content. The counter-reading (another member's stream is "other content") is possible, because Apple does not define the phrase. Note that the old DeetsRadio worker's **YouTube entries would sit on the wrong side of this clause** — they are plainly other content beside MusicKit Content. Dropping the website (§13) removes that. | Holds, risk not zero. |
| e | Each app plays MusicKit's own rendering. The room changes *when* a song starts, never the audio. Nothing is re-encoded, copied or sent. | Clear. |
| f | The room shows the member's Up Next and who added each song, to the room's members only. The panel says so, and a member joins by choice. | Clear, with the disclosure kept in the panel. |
| g | No token, key or account crosses the room. The worker holds no Apple secret (§3.1). A person with no Apple Music subscription joins and **hears nothing** — the app cannot play for them, and there is no preview path. This is the clause that would bite a "listen without an account" feature; the design has none. | Clear, and stays clear only while no non-subscriber ever hears audio. |
| h | A room is a group of friends who each already pay. 32 members, an unlisted 8-character code, no directory, no discovery, no way to find a stranger's room (§6, §11). | Personal use. A public code would be a different question. |

**Overall:** the design does the same thing Apple's own SharePlay does — each subscriber's own device
plays the song, and only a clock passes between them. Apple ships that behaviour on its platforms
but gives no API for it on Windows, and the agreement neither permits nor forbids a developer doing
the same. So this is a **reading, not a permission**. The risk sits in clause d's undefined word and
in clause c.

### 12.3 The one item the owner must decide (clause c)

Clause c says users must be able to navigate playback with standard controls. §8 lets the host take
Play/Pause, Skip and Seek away from guests. Three ways to stand:

1. **As designed.** A guest who wants the controls back leaves the room with one click and their own
   queue returns (§9.4); the guest chose to join, and a room is one session, not the app.
2. **Play/Pause always Everyone.** Drop that row from §8; keep Skip, Seek, Add and Change Up Next as
   host-settable. A guest can always stop their own sound. Costs the host nothing they use often.
3. **Local Stop always.** Keep §8 as it is, but a guest's Pause never greys out — it stops **their
   own app** and leaves the room's clock running, with the row reading "Stop listening".

**Decided by the owner, 2026-09-17: option 3.** It answers the clause exactly (the standard control
is always there and does what it says), and it keeps the host's power over the room. Written into
§8 and §10: Pause never greys out; under Host only it reads **Stop listening**, and Play reads
**Listen again** and re-joins at the room's position.

### 12.4 Record

Quotes read 2026-09-17 from developer.apple.com (Apple Developer Program License Agreement, English)
and apple.com/legal/internet-services/itunes/us/terms.html. Re-read §3.3.6.D before the build starts
if more than a few months pass: Apple revises the agreement several times a year.

---

## 13. The website is out of scope (2026-09-17)

**Decided by the user:** DeetsMusicRooms is an app feature. The deets.solutions radio tab and its old
worker are **not part of this design and not a constraint on it**. We take pieces from that worker
where they help (§5.5 transport rules, §9.3 follower values, §11 limits) and owe it nothing back.

What that removes from this doc:
- **No protocol compatibility** with the old worker. Message names, the `Entry` shape and the lead
  times are ours to change at any time.
- **No browser client**, so no MusicKit JS host, no page deploy tied to a worker deploy, and no
  `ALLOWED_ORIGINS` entry for deets.solutions (§9.2 keeps only the app's own two origins).
- **No no-login preview listener** — which is what keeps §12 clause g clear.
- **No YouTube entries** — which is what keeps §12 clause d clear.
- **No free-form room names** and **no rooms that outlive their members**: the generated code (§6)
  and "the host leaves, the room ends" (§7) are now simply the rules, not a difference to settle.
- **No retirement plan for the old worker.** It keeps running on its own. If the site ever wants
  this worker, that is a DeetsSolutions session, starting from this doc as it stands.

The site's own record stays where it is: DeetsSolutions `docs/HANDOFF.md`.

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
9. ~~Whether the worker gets `rooms.deets.solutions`~~ — settled at the build (2026-09-17): it
   does, as a custom domain, and the app compiles that host in. A workers.dev name would make a
   later move an app release; the mint follows the same rule with music-api.deets.solutions.
(Clause c, §12.3, is no longer a default: the owner decided it on 2026-09-17.)

---

## 15. Build order

1. §12 is read and recorded, and §12.3 is decided. **Done 2026-09-17.**
2. The worker. **Done** — its own repo, §16.1.
3. `src/room.ts` + follower mode + the bridge. **Done** — §16.2.
4. The title bar item and the Room panel. **Done** — §16.2.
5. The deep link. **Done** — `src-tauri/src/rooms.rs`, §16.2.
6. The desk test. **Open** — §16.4.
7. — (the website phase left with §13).

---

## 16. As built (2026-09-17)

### 16.1 The worker — its own repo, `DeetsMusicRooms`

It sits beside the app, not inside it: **`../DeetsMusicRooms`**, a private GitHub repo
(`deets-137/DeetsMusicRooms`), in the same shape as DeetsAccounts and DeetsSupport — **plain
JavaScript, no build step, no `package.json` and no `node_modules`**, run with `npx wrangler`.
The design doc stays here, in the app repo, the way `accounts.md` and `support.md` stay in
DeetsSolutions.

| File | What |
|---|---|
| `src/index.js` | `POST /room`, `GET /room/:code/peek`, `GET /room/:code/ws`, `GET /`. CORS from `ALLOWED_ORIGINS` plus any `localhost` port. The IP rate limit (§11) sits on all three, and fails OPEN if the binding is absent. |
| `src/room.js` | The Durable Object: the three storage keys (§5.2), hibernatable sockets, the transport rules (§5.5), guest controls (§8), the host grace window (§7), the per-socket command limit. |
| `src/protocol.js` | The wire and every constant: `PROTOCOL_V`, `LEAD_MS` 1500, `SEEK_LEAD_MS` 300, `HOST_GRACE_MS` 60000, the caps. The app's `src/room.ts` mirrors this file by hand — they are separate builds, on purpose. |
| `src/codes.js` | The 8-character Crockford code, unbiased (`byte & 31` on uniform bytes), the typed-code mapping, the 32-byte host token. |
| `src/sanitize.js` | `sanitizeEntry` rebuilds every entry field by field. **The artwork URL is returned raw, not through `URL.toString()`**: the parser percent-encodes Apple's `{w}`/`{h}` braces and would leave every member with a broken cover. |
| `scripts/check.mjs` | `node scripts/check.mjs http://127.0.0.1:<port>` drives the protocol as two apps would, against a `wrangler dev` worker. No dependencies, the way DeetsAccounts' own `check.mjs` has none. |
| `wrangler.jsonc` | The DO binding and its `new_sqlite_classes` migration, the rate limit, `ALLOWED_ORIGINS`, and the `rooms.deets.solutions` custom domain. No D1, no KV, no secrets. |

**Wrangler 4 is required.** On wrangler 3 the `ratelimits` block is silently dropped
("Unexpected fields found in top-level field"), so the room would run with no IP limit at
all. Wrangler 4 prints `env.JOIN_LIMIT (30 requests/60s)` in the binding list — read that
line before every deploy. `@cloudflare/workers-types` must be v5 to match it.

**The protocol run, 2026-09-17: 23 checks, all pass** (re-run after the port to plain JS) — code shape and host token, peek, a
dashed lower-case code, host and guest join, the first add starting the song, the scheduled
start (+1498 ms), a guest's pause and play, `setControls` reaching everyone, a host-only
command denied, **the song ending on the room's own alarm with the next song starting at the
old one's exact end (0 ms)**, the room history, a seek landing at 2000 ms, an entry with no
catalog id refused, an app below `minV` turned away, `ended` reaching the guest, and the code
free again afterwards.

### 16.2 The app

| File | What |
|---|---|
| `src/room.ts` | The connection (WebSocket, backoff 0.5–8 s, clock offset), the room state store, follower mode, "Stop listening", and the bridge below. |
| `src/room-panel.ts` | The title bar item and the panel (§1). `.pop` + `enterRows` on open, `keepInWindow`, `dataset.frames`, `app-scroll` on the member list. **The panel wears the Sound panel's clothes** (§16.6). |
| `src/player.ts` | A third `PlayerMode`, `"room"`, and **the bridge**. |
| `src/queue.ts` | `setRoomQueue(handles)`: the room's queue becomes the model, so Now Playing, Up Next, the Queue card and History show the room with no card of their own. |
| `src/settings-store.ts` | `roomName`, `roomGuestControls`, `roomsUrl`. |
| `src-tauri/src/rooms.rs` | The `deetsmusic://room?code=…` route. It only checks the code's shape and emits `room-invite`; main.ts asks before joining. Three unit tests (`cargo test --lib rooms`). |
| `src/compass.ts` | A Places row for the panel, and the Start / Leave / End / Stop listening / Listen again verbs. |
| `src/agent-settings.ts` | The five guest-control defaults, as `roomGuests.<control>`. |

**The bridge is the design's one change.** §9.1 put the room branch in `queue.ts`; it is in
`player.ts` instead. `RoomBridge` is an interface room.ts installs while a room is on, and
the funnels every click already passes through — `playPause`, `nextTrack`, `prevTrack`,
`seekToFraction`, `seekToSeconds`, `playContext`, `jumpToUpcoming`, `enqueue`,
`insertInQueue`, `removeFromQueue`, `moveInQueue`, `playStation`, `shuffleQueue`,
`toggleShuffle`, `setRepeat` — ask it first. **Why:** `queue.ts` is a pure model with no
idea what a click is, and teaching the dozens of call sites about rooms would have been the
alternative. One interface, sixteen one-line guards.

**Follower mode feeds MusicKit ONE song.** `roomShow` loads the room's current song alone
and `growNow`/`scheduleGrow`/`maybeTopUpWindow`/`reconcileUpcoming` stand down in room mode.
That is what makes §5.5's "apps never move to the next song on their own" true by
construction: MusicKit reaches the end of a one-song queue and goes quiet, and the room's
alarm starts the next song. The drift check rides `emitProgress` (`roomDriftTick`), corrects
past 1.75 s, and at most once per 5 s.

**One catch-up after each start.** `setQueue` alone fetches nothing (no lookup, no licence,
no bytes), so the lead SCHEDULES the start but does not buffer it: each app's own `play()`
takes its own moment, and two apps can begin up to about a second apart — under the 1.75 s
drift threshold, so nothing would ever correct it. `settle()` looks once, 1.4 s after a song
starts, and lines the app up to within 250 ms. Whether the lead should also pre-buffer (a
muted play, say) is a question for the desk test, not a guess: §16.4 step 2 measures it.

**Late joins seek before the first sound.** `LoadOpts.seekMs` moves the song to the room's
position between the feed and the play, so a late join never plays the opening bars the room
passed a minute ago.

### 16.2a The panel, and what the first cut got wrong

The first cut shipped a panel of its own invention and it showed: the label wrapped, the
fields stretched, Join sat half off the edge, and there was no title. Two causes, both now
fixed by taking the **Sound panel** as the pattern rather than inventing one (the user's
call, 2026-09-17):

1. **The panel did not set its own type scale.** `.sound__panel` sets `font-size:
   var(--fs-subtext)` on the PANEL; without it every label inherits the body size, and
   "Your name" wrapped to two lines in a 248 px panel.
2. **Fields and buttons had no shared shape.** They now share one rule with the Sound
   panel's chips — `box-sizing: border-box`, `height: var(--icon-lg)`, the same border and
   radius — so a field beside a chip is one row and nothing is clipped. The name field has a
   set width (`--room-field-w`), and only the code field grows.

The panel is now the Sound panel's width (`--room-panel-w: var(--sound-panel-w)`), with its
head (title at the left, one action at the right), its label-left / control-right rows, and
its chip and pill shapes. The title reads **DeetsRadio**.

**The glyph** was redrawn the same day. Three whole figures crossed their strokes and read as
a knot of arcs at 16 px; now the middle figure is a whole silhouette and the two behind show
only the part that sticks out, the way a group glyph is normally built. Only the front figure
fills in a room — filling the partial shapes behind it made slivers.

**The scrollbar gutter** is reserved only in a room (`[data-scrolls]`). `app-scroll` draws a
real bar, not an overlay, so it takes width the moment it appears. Out of a room the panel is
four rows and can never scroll, and a permanent gutter would narrow the fields for nothing. In
a room rows arrive while the panel is open — a member joins, "Waiting for the host" appears —
which is exactly when a bar would shove every row left. The member list always reserves it: it
is the part that grows.

### 16.6 The stage (2026-09-17)

The panel's rectangle of silhouettes, designed from a mockup he confirmed before any of it
was written. It sits under the head, in the shape the Sound panel's graph takes (a bordered
box of its own height, `--room-stage-h`).

| Decision | His call |
|---|---|
| **It is always there.** | One still figure out of a room — the room you have not made yet — and the crowd fills in from the middle as people join. |
| **The front figure is you.** | Not the host. The room reads from where you stand, which matches the title bar glyph, where the middle figure is the one that fills. |
| **The heads move ONLY to the loudness meter.** | No steady fallback bob. With every Sound effect off nothing is routed (SOUND.md §1), so there is no meter and the stage is a still picture. A made-up rhythm against a slow song is worse than stillness, and nobody pays for an analyser they did not ask for. |
| **Hollow figures, three at most.** | Line work like the title bar glyph, not filled shapes. **The stage is a picture of a room, not a count of it** — the member list under it is the count — so a fourth silhouette bought nothing and cost the panel its width. Past three the corner says `+N`. |
| **The panel keeps its own width.** | 248 px, not the Sound panel's 300. The stage stopped needing the room, so the width went back. Everything else still follows Sound: the type scale on the panel, the head, the rows, the chips. |
| **A backdrop behind them.** | A light grid: two repeating gradients at `--room-grid-size`, drawn in `--room-grid-line` from the panel's own border color, so every theme gets its own weight and nothing is hardcoded. A skyline image was tried first the same day and taken out again — it read as a picture the figures stood in front of, rather than a ground they stand on. |

**How it moves.** `sound.ts` `onMeter` hands the panel a mean square every 100 ms; the panel
writes one custom property, `--room-bob`, and CSS moves the heads. No loop and no `rAF`: one
style write per hop, only while the panel is open, and none at all while the graph is not
routed. The value is the fourth root of the mean square, so a quiet passage still shows
without the loud parts pinning the heads at the top. Four hundred milliseconds without a hop
and the heads settle. Reduced motion: the panel stops writing and the transform is dropped.

**Shape.** Three figures, then `+N` in the corner (a room holds 32). The two behind step out
to either side, `--room-fig-step-s` smaller, dimmer, and bob a fifth shallower and 40 ms
later, so a crowd does not nod in lockstep. The stroke does not scale with them
(`non-scaling-stroke`), so the figures at the back keep a line you can see, and the shoulders
are an open arc whose ends meet the stage floor — the figures stand on it rather than
carrying a baseline of their own. Only the head moves, one transform on its own element,
which keeps it compositor work.

**Open:** the frame cost is unmeasured. It wants a `[perf] frames` pass with the panel open
on a real card (`dataset.frames = "room-stage"` is set), and the honest measurement is
`npm run dev:built`, not the dev server (CLAUDE.md, graphics rules).

### 16.7 Permissions, one fold (2026-09-17)

His report from the live panel: the guest-control pills did not line up, and the last one,
"Change Up Next", hung past the panel's right edge. The cause was the row itself — a flex
line with `justify-content: space-between` and a label that never wraps, so each pill
started where its own label ended and the longest label pushed its pill out of the panel.

| Fork | His call |
|---|---|
| **Where the rows live.** | Behind a **Permissions** fold, the Sound panel's primitive (`.sound__fold-btn` + `.sound__fold`): a row with a turning caret, the rows in a tinted box under it. The flat "Guests may" header is gone from the panel body; the same words are the first line INSIDE the box, so the sentence still reads "Guests may · Play · Skip". |
| **Shut or open.** | **Shut**, like every Sound fold. In a room the panel reads: the code, the two copies, who is listening, one Permissions row. |
| **Who gives way, the label or the pill.** | **The labels.** The panel keeps its 248 px (§16.6). "Start and stop" → **Play**, "Change Up Next" → **Reorder**. The hover hint still carries the full meaning, unchanged. |

**What makes them line up.** Two rules, no magic numbers:

- `.room__row--control` is a **grid**, `minmax(0, 1fr) auto`. The pill column is its own
  width in every row, so the pills stand in one column and a long label can no longer move
  one. The label takes what is left and ellipses if a skin's type is wide.
- `.room__pill` is a **grid of two equal columns**. "Everyone" and "Host only" are one
  width, so the pill is the same size in every skin's type scale — `--fs-subtext` is 11 px,
  12 px or 13 px depending on the skin, so a fixed pixel width would have clipped.

**The panel no longer shuts when the room starts.** His report the same day: after Start a
room the panel closed, so the code and the two copies took a second click to reach. The cause
was not in the room code. `startRoom()` emits `phase: "starting"` while the click is still
running, `render()` calls `panel.replaceChildren()`, and the chip you pressed leaves the
document. The click then reaches `document`, where `dropdown.ts` asks `panel.contains(target)`
— false, because the target is detached — and reads your own press as a click away. The fix is
in the primitive: **a target the page no longer holds is not a click away**
(`if (!t.isConnected) return`, `src/dropdown.ts`). Every panel that redraws itself on a press
is covered, and no panel loses a close it asked for — the ones that close on a pick (Compass,
the slot picker, the Settings menus, the web panel) all call `close()` themselves.

**The fold's state is a module variable** (`permsOpen`), not the DOM. `render()` rebuilds the
whole panel on every room change — a member joins, the host reconnects — so a fold that kept
its state in `hidden` would shut under the host's hand while they were using it. It goes back
to shut when the phase returns to `off`, so a new room starts tidy. Opening it runs
`enterRows` over the box, the checklist's motion rule.

### 16.3 Before a room works between two PCs

1. ~~Deploy the worker.~~ **DONE 2026-09-17**, at the owner's word: `deetsmusic-rooms` is live on
   **`rooms.deets.solutions`** (version `ce3a94c7`), and `scripts/check.mjs` passes all 24 checks
   against the live host. **No secrets are attached, and none are needed.**

   The first live probe found a real hole: a room minted by `POST /room` that nobody ever joins had
   nothing to end it, so it sat in Durable Object storage for good. Rooms now carry
   `unclaimedUntil` (10 minutes), cleared by the first join and swept by the alarm they already
   had. Fixed, redeployed and the probe's own room ended by hand the same day.
   The deploy also creates the `rooms.deets.solutions` custom domain named in its
   `wrangler.jsonc`; that host is what `ROOMS_URL_DEFAULT` (`src/room.ts`) compiles in, so
   nothing in the app changes when the worker moves.
2. For a desk run with no deploy at all: `cd ../DeetsMusicRooms && npx wrangler dev --port 8801`,
   then point the app at it from DevTools (below). Two apps on one PC both reach it.

**`roomsUrl` is a dev-only route (the user's call, 2026-09-17): no Settings card row.** It is set
from the DevTools console and read at the next launch, because the store loads once at start and a
same-window `localStorage` write raises no `storage` event:

```js
const s = JSON.parse(localStorage.getItem("deets.settings") ?? "{}");
s.roomsUrl = "http://127.0.0.1:8801";   // "" puts it back on rooms.deets.solutions
localStorage.setItem("deets.settings", JSON.stringify(s));
location.reload();
```

The panel's own errors name the address it tried ("the rooms server answered 404"), so a wrong or
undeployed host says so rather than failing quietly.

### 16.4 The desk test (open)

Two PCs, or one PC with two apps — but read this first (2026-09-17):

- **The installed app cannot be a member yet.** 0.9.5 shipped before this work, so it has no Room
  item. A second member on this PC means either a new build installed, or a second dev app.
- **`npm run dev:app` cannot be run twice.** Both instances would take the identifier
  `com.deetsmusic.dev` and the same data dir, and the single-instance plugin turns the second away.
  A `--instance 2` flag (its own identifier, data dir, port and CDP port) is about twenty lines in
  `scripts/dev-app.mjs`, and is not written.
- **Two apps playing at once is UNCONFIRMED, and stays that way until the owner says otherwise
  (his call, 2026-09-17).** One Apple Music subscription streams to one place at a time; a **Family
  plan carries six**, which is what the owner has, so two members should hold — but nobody has heard
  it yet. Whether two apps on ONE Apple ID also hold, or whether the second play stops the first, is
  the open question. He is testing it live.

  **This item does not close at release.** If a build ships before he confirms, it ships with this
  unproven, and RELEASE-NOTES and HANDOFF say so. Do not write "rooms work" anywhere until he has
  heard two apps play in step and said so.

So: the protocol, the panel, the codes, the controls and the invite link can all be walked on one
PC. Hearing two apps play in step is the one thing only he can confirm.

| # | Step | Pass |
|---|---|---|
| 1 | Host: play something, open the Room item, Start a room. | The glyph fills; the code shows as `XXXX-XXXX`; the song keeps playing. |
| 2 | Guest: type the code (lower case, no dash) and Join. | Both apps play the same song, in step, within about a second. |
| 3 | Guest: Copy invite link on the host, open it on the guest PC. | DeetsMusic asks "Join listening room …?"; Join works. |
| 4 | Either: Pause, Play, Next, Previous, a scrub. | Everyone moves together. The lead is about 1.5 s on a click. |
| 5 | Let a song end by itself. | The next song starts on both apps with no gap and no double skip. |
| 6 | Host: set each §8 control to Host only, then try it as the guest. | The guest is told the host keeps it. **Pause still works and stops only the guest** (§12.3); Play then reads Listen again. |
| 7 | Guest: add a song from any card; drag one into Up Next; remove one. | The room's Up Next changes for everyone, and the row says who added it. |
| 8 | Guest: play a song that is only in your library (an upload). | The app says the room cannot play it; the room does not change. |
| 9 | Host: pull the network for 20 s, then restore it. | Guests keep playing; the panel says "Waiting for the host"; the host rejoins with no new code. |
| 10 | Host: close the app and wait over 60 s. | Guests get "The room ended", and their own queue comes back paused. |
| 11 | Host: Remove a guest. | That app leaves and gets its own queue back. |
| 12 | Either: start a station. | "A station cannot play in a room", with Leave room on the toast. |
| 13 | Both: check Settings › Rewind / History after. | The room's songs are there, with the play counts and the Last.fm scrobbles. |

### 16.4a The protection pass (2026-09-17)

Asked whether the worker carried the usual protections, and it did not: it had the IP limit and
the per-socket limit, but no size cap of any kind, no kill switch and no credential-shape rule —
the three things DeetsAccounts and DeetsSupport both carry. A measurement came first (§11), then
all four went in with their own checks (`scripts/check.mjs` is now 28 checks, passing against the
live host).

What the measurement changed, beyond adding caps: the entry text caps came DOWN, because the cost
is not the one message a client sends but the whole queue going back to every member on every
command.

### 16.5 Known gaps

- **Two apps playing in step is not yet heard** (§16.4). The owner is testing it on a Family plan.
  It remains open after release until he confirms; nothing should claim rooms work before that.

- **A room is not saved across a restart.** Quit in a room and the app comes back with the
  room's last song as its own (the restore setting's doing). Leaving properly always returns
  the saved queue.
- **`insertAt` is coarse.** A drop between two rows in a room adds at the top of Up Next,
  not at the row: the room's `add` takes "next" or "end". A `move` after the add would fix
  it; it costs a second command and was left out.
- **`jumpTo` removes the songs it skips.** Clicking the fourth row of the room's Up Next
  removes the three above it and calls Next. That is what "play from here" means for a
  shared queue, but the other members see three rows disappear at once.
- **No `room` agent tool yet** (§9.1 has it as "later"). An agent in a room drives the room
  through the ordinary play and queue routes, because they pass through the same bridge.

---

## 17. The first two-app desk test (2026-09-18) — two bugs, both fixed

The first run of §16.4 on one PC failed: the guest kept its own song, both Queue cards
were empty, and nothing played. The host's log named the cause in four lines.

```
3199485ms  room:in    {"code":"3FJH71EF","host":true}
3367833ms  room:song  {"id":"1249348482","startsIn":1499,"at":0}    ← 168 s later
```

`room:in` with no `add` after it: the room was created empty and stayed empty until a
song was clicked by hand.

### 17.1 The host never seeded the room

`startRoom` read `queue.getCurrent()` **after** `await connect(...)`. `connect` resolves
on the first `state` message, and `applyState` → `writeModel` → `queue.setRoomQueue([])`
had already replaced this app's queue with the room's — empty, on a new room. So the seed
read a queue it had just wiped, sent nothing, and the room sat idle for ever.

Fixed by reading the host's current song and Up Next **before** the connection and sending
the `add` after it. A `room:seed { songs }` line now records what went in, so an empty
seed is visible in the log instead of being a missing line.

### 17.2 A room `play` never reached a held follower

`step()`'s same-song branch ended in `roomResumeAt(position, true)`, and `correcting`
is what tells `roomResumeAt` not to call `play()`. So once an app was paused but still
held the song, a room `play` seeked it to the right moment and left it paused. Nothing
recovered it: the drift check runs off the progress tick, and a paused player has none.

`correcting` now means "from the drift tick alone", where the song is playing by
definition. Every other caller leaves it false, so a held player starts again.

### 17.3 Two things this test could not answer

1. **The guest half is unreadable.** The guest was the dev app, and its page reloaded
   three times in twenty seconds (`boot:ready` at t≈0 in each flush), which drops the
   WebSocket and the ring buffer with it.
2. **A room started mid-song replays that song from 0:00.** The `add` reaches the worker
   with no position, so `advance` starts it at 0. Carrying the host's position needs a
   `startPosition` on the wire — designed nowhere yet, and open for the owner.

### 17.4 Desk test for these two fixes

1. Start a room from an app that is playing. The host log gets
   `room:seed { songs: N }` with N ≥ 1, and `room:song` follows within a second or two.
2. Join from the second app. It takes the room's song at the room's position, and plays.
3. Press Pause in one app, then Play. **Both** apps stop and both start again.
4. Press Pause in the guest while the host keeps playing (Stop listening), then Play.
   The guest re-joins at the room's position.

### 17.5 The title bar button was a red blob in a room (2026-09-18)

The glyph is three line figures on a 24 grid, and in a room the middle one filled —
head and shoulders both. `--room-btn-size` is `--traffic-size`, 16 px, so the grid
scales by 2/3:

| part | at 16 px |
| --- | --- |
| filled head disc | 5.13 px across |
| filled bust | 8.47 × 4.23 px |
| **clear gap between them** | **0.73 px** |

Under one device pixel. Antialiasing closed it, the two filled shapes merged, and the
button read as one red mark with no figure in it.

Only the **head** fills now. The shoulders stay an open arc, which keeps the gap by
construction — a 1 px stroke around a hollow cannot merge with the disc above it at any
size — and keeps the interior counter that makes a 16 px glyph readable. `[data-in]`
already turns the whole glyph `--title`, so colour carries the state and the fill is the
second cue.

The **stage** figures inside the panel are a separate drawing and are untouched. Their
head sits 1.40 head-radii above the shoulders against the glyph's 0.84, so at 62 px the
head reads as detached. That is a look, not a failure, and it is the owner's call.

### 17.6 The count badge is gone (2026-09-18)

The blob in the title bar was not the glyph. When more than one app was listening, a
`::after` badge was drawn over the button: 14 × 14 px on a 16 px button, solid `--title`,
border-radius 7 — a red disc covering 77% of it, leaving a 6 px strip on the left and 4 px
on the top. The "2" inside it was 9 px type, which at that size is texture, not a digit.

Removed: the rule in styles.css, the `dataset.count` write in `paintButton`, and the
`--room-count-size` / `--room-count-fs` tokens (TOKENS.md regenerated). The owner's
words: "I didn't realize we had a count badge. Unnecessary."

Nothing replaces it. The hover hint already says it in full — "2 listening together in
room 3FJH-71EF" — and the panel lists every member by name.

### 17.7 The stage figures now match the glyph (2026-09-18)

His call: make the two drawings one to one. The stage figure is `glyph()`'s middle
figure multiplied by **5** — the largest whole scale the 64 x 80 box takes (the head
clears the top at 5.28, the shoulders clear the sides at 5.04) — with the baseline on
the stage floor.

| | glyph (24 box) | stage (64 x 80 box) |
| --- | --- | --- |
| head | `cy 8, r 3.1` | `cy 23.5, r 15.5` |
| shoulders | `r 5.6, baseline 19.3` | `r 28, baseline 80` |
| head to shoulders | 0.8387 r | 0.8387 r |
| shoulders to each side | 1.8065 r | 1.8065 r |
| head to floor | 2.6452 r | 2.6452 r |

Before this the stage's gap was **1.40 r**, picked by eye — a head floating over an
unrelated hump at 62 px.

Two things deliberately do not scale:

- **The `Z`.** The glyph's bust is closed because it floats 4.7 units above its own box.
  On the stage the floor closes it, which is the whole point of the open arc.
- **The stroke.** Scaling it gives 7.3 px of line on a 30 px head. An icon's stroke
  weight is an optical choice for 16 px, not a proportion, so the stage keeps
  `--room-fig-stroke`.

### 17.8 The scrollbar gutter opens instead of sitting there (2026-09-18)

His ask: no gutter in the room menu, and if it has to scroll, animate the gutter opening.

**What was there.** `.room__panel[data-scrolls]` reserved the gutter, and `data-scrolls`
meant *in a room* — not *overflowing*. So every in-room panel carried a blank 8 px strip
down its side whether it scrolled or not. `.room__members` reserved one unconditionally,
so a two-member list carried a second strip inside the first.

**Why it cannot simply be dropped.** `app-scroll` draws a real bar, not an overlay, so it
takes its width the moment it appears. With nothing reserved, a member joining shoves
every row 8 px left. That shove is what the reservation existed to prevent.

**What it does now.** The gutter opens by *widening the panel*, not by taking width from
the rows:

```css
.room__panel[data-scrolls] {
  width: calc(var(--room-panel-w) + var(--scrollbar-w));
  scrollbar-gutter: stable;
}
```

Width `+ --scrollbar-w`, minus the bar, is `--room-panel-w` — **the content box is
unchanged**. No row moves, nothing re-wraps; only the panel's own edge travels, over
`--room-gutter-open` (`--dur-med`). The member list cannot widen a panel, so it reaches
outward into the panel's right padding by the same amount, with the same result.

That identity is load-bearing twice over. It is why no row shifts, and it is why the
measurement is safe: **turning the gutter on cannot change what fits**, so
`measureGutters()` cannot flip it back off and oscillate.

`measureGutters()` reads `scrollHeight > clientHeight` on both boxes after a render and
from a `ResizeObserver` on the panel, always a frame late (outside the observer's own
delivery, so it cannot raise the loop warning) and only writing when the answer changed.

Reduced motion keeps the gutter and drops the travel.

Also fixed on the way: the panel had `overflow-y: auto` but no `app-scroll` class, so when
it did scroll it showed the grey OS bar — the exact miss CLAUDE.md's checklist item 6a
warns about.

