# DeetsMusic — Friends (and telling Discord what you play)

> **Paper design, 2026-09-19. Nothing is built yet — the owner has scheduled the build for the
> evening of 2026-09-19 or for 2026-09-20.** Four decisions are closed (§0a); the nine forks in §11
> are still his.
> Two asks in one doc, because they share one question ("who am I, to someone else?"):
> 1. **Friends** — add a person with a friend code, see what they play, and listen together.
> 2. **Broadcast** — put what you play into a Discord channel or your Discord profile.
>
> **Cost rule from the owner (2026-09-19):** stay inside the Cloudflare free tier, and do
> as much app-side as we can. §5 is written to that rule, and it decides the recommendation.

---

## 0. Terms

- **Friend code**: a short code that stands for one person, forever. It does not change.
- **Room code**: what DeetsMusicRooms already uses. It stands for one **session** and dies with it
  (ROOMS.md §6, §7).
- **Presence**: the line "Aditya is playing <song> by <artist>", and nothing more.
- **Broadcast**: sending presence out of DeetsMusic to a service that is not ours (Discord).
- **Friends DO**: a Durable Object, one per person, that would hold that person's friend list and
  their last presence. It does not exist yet.

---

## 0a. Decided by the owner (2026-09-19)

| # | Decision | Where it lands |
|---|---|---|
| D1 | **No heartbeat.** Presence is sent when the song changes, and at no other time. | §5.1 rule 1, and it decides fork 4 in favour of 4A. |
| D2 | **A friend's row opens a room.** Clicking a friend is how you start listening with them. | §7. Fork 6 stays open: it is only about the case where the friend hosts **no** room yet. |
| D3 | **A toast when the service is busy**, and the toast must say that **music is not affected**. | §5.2, new. |
| D4 | **A new worker**, not the rooms worker. Fork 10 is **closed** (§15). | `deetsmusic-friends`, its own repo and its own domain. |

The rest of §11 is still open.

---

## 1. The question you asked: is this an extension of Rooms?

**No. Friends sits UNDER Rooms, not on top of it.** Read from the code, 2026-09-19:

| Thing | Rooms today | Friends needs |
|---|---|---|
| Who you are | `setting("roomName")` — a free-text display name, 24 characters, typed per install (`src/room.ts:198`). Two people can both be "Aditya". | One id that is **yours**, that a stranger cannot claim, and that survives a restart. |
| Identity in the protocol | `memberId` is minted per socket and dies with the room. | An id that outlives every session. |
| Where state lives | The room's own DO. **It deletes its own storage when the room ends** (worker `src/index.js` header). | A store that is alive when you are offline — a friend list is not a session. |
| Server identity | The worker holds **no secrets and no user data** except typed names. | At minimum: id → friend edges. Still no email, no password. |
| Code life | 8 characters, minted by the worker, free again when the room ends. | 8 characters, minted once, **never free again**. |

There is **no client identifier anywhere in the app today** — a grep for `installId`, `deviceId` and
`clientId` over `src/` and `src-tauri/src/` returns nothing (checked 2026-09-19). So Friends is not a
feature we bolt on the side of Rooms. It is a **new bottom layer** (an identity and a friend list) that
Rooms then borrows from: once you have friends, "Invite" stops being "copy this code, paste it in
Discord" and becomes a name in a list.

That is the good news for the build order. **Identity first, presence second, and the Rooms tie-in is a
small third step**, because the app already turns a code into a joined room (`src/room.ts`) and the
worker already has a peek route.

---

## 2. Fork 1 — what a friend code IS

| | Option | What it costs | What it gives |
|---|---|---|---|
| **1A** ⭐ | **A key the app mints at first run.** 16 random bytes in the app's data dir, encrypted with DPAPI, the same road `sotd-outlets.json` takes (`src-tauri/src/sotd/outlet.rs`). The **friend code** is the public half, 8 characters of Crockford base32 — the alphabet the room code already uses, which `rooms.rs::normalize` already reads. | Nothing to run. No sign-in. **A reinstall on a new PC is a new person** unless we add an export (§2a). | No account, no email, no password, no extra service. The worker keeps holding no secrets. |
| 1B | **DeetsAccounts** (`../DeetsAccounts`, Google sign-in, D1, `id.deets.solutions`). The hosted sign-in road from the app already works (2026-09-13). | A second sign-in in a player that already makes you sign in to Apple. A D1 row with a `google_sub` per user — real user data, where we hold none today. | The same friends on every PC. |
| 1C | **1A now, 1B later as an optional link.** | The migration is real work when it comes. | Starts free, keeps the door open. |

**Recommendation: 1A.** It fits what the app is — one desktop app, no account — and it keeps the "the
worker holds no secrets" line true. The cost is portability, and §2a buys most of that back.

### 2a. Fork 1a (only if 1A wins): moving your friends to a new PC

- **1a-A** ⭐ Settings › Friends shows **Copy my key** and **Paste a key**, with the warning that the
  key IS you. Nothing else to build.
- 1a-B The key rides the app's own settings export.
- 1a-C Nothing. A new PC is a new code, and you add your friends again.

---

## 3. Fork 2 — how a friend is added

- **2A** ⭐ **Code in, code out.** You show your code (the `K7QM-4XHT` shape, with `Copy code`), they
  paste it and press Add. **Both sides must add the other before anything is shown**, so one pasted
  code cannot watch you.
- 2B **One-sided add with a request.** They add you, you accept. One more state, one more thing to
  explain, and it needs somewhere to park a request while you are offline.
- 2C **Invite link**, `deetsmusic://friend?code=…`, beside the room link `src-tauri/src/rooms.rs`
  already parses. The Rust side is about 20 lines, copied.

**Recommendation: 2A + 2C.** Mutual add is the cheapest way to be safe: no request store, no inbox, no
notification, nothing to moderate. The link is a copy of a road we have.

---

## 4. Fork 3 — what a friend sees

| | Option |
|---|---|
| **3A** ⭐ | **Song, artist, artwork, and how long ago.** Nothing about where it came from. |
| 3B | 3A and the album, and a **Play this** button (the catalog id is in the presence anyway, or the row could not be drawn). |
| 3C | 3A and "in a room · Join" when they host one (§7). |

**Recommendation: 3A + 3B + 3C — all three.** They are one payload; the difference is only what the row
draws. Ship the row full.

**Privacy — a fork he should still take:**

- **P1** ⭐ One switch, **Share what I play · On/Off**, and **Pause sharing for an hour**.
- P2 Per-friend visibility. A column in the friend list. More UI, more state.
- P3 Also an explicit **Private session**, drawn in the Sleep and Sound panel idiom.

**Recommendation: P1 now, P2 only if he asks.** The friend list is mutual and small. If you do not want
a person to see you, you remove them.

---

## 5. Fork 4 — the transport, and the free tier

This is the fork the cost rule decides. The limits are the ones already measured in ROOMS.md §3.2:
**100,000 requests/day for the whole worker**, **incoming WebSocket messages count 20:1**, **outgoing
broadcasts are free**, **a hibernating DO is not billed for duration**, and **100,000 SQLite rows
written/day**, which is the limit rooms reach first.

| | Option | Requests per person per day | Verdict |
|---|---|---|---|
| **4A** ⭐ | **One socket to your own Friends DO, and one socket to each friend's DO.** You push a song change up your own socket; your DO broadcasts it to the friends listening on it. | 1 + N connects per app launch, plus (your song changes ÷ 20). 10 friends, 3 launches, 60 songs: **about 36**. | About 2,700 people a day inside the free tier. Presence is instant. It is the shape Rooms already has, so the reconnect and backoff code in `src/room.ts` is copied, not written. |
| 4B | **HTTP: post on song change, poll your friends while the panel is open.** | 60 posts, and a read every 30 s while the panel is open. One panel open for 10 minutes adds 20. **80 and up**, and it grows with every second the panel stays open. | Twice the cost of 4A for a worse feeling. Polling is the expensive shape here, not the cheap one. |
| 4C | **No new worker: a personal room.** Your friend code IS a room code your app claims, and `GET /room/:code/peek` already returns `{exists, members, hostName, nowPlaying}` (worker `src/index.js`). The friend list is N peeks when the panel opens. | N peeks per panel open. **About 30** for three opens. | Zero new protocol, but it forces a room DO for every person, it pulls the room's own ideas (queue, guest controls, host token) into presence, and presence only moves when somebody looks. A shortcut that would cost more to un-pick later than it saves now. |
| 4D | **Local only.** Friends is an address book on disk: names, codes, and a Join button when a friend pastes you a room code. No presence. | **0** | Free, and half the idea. Named here because it is the only option with no server at all. |

**Recommendation: 4A**, with the app-side savings in §5.1 built in from the first line. It is the
cheapest option that really shows presence. The 20:1 rule is what makes it cheap: 20 song changes cost
one request, and every broadcast out to your friends costs nothing.

### 5.1 What the app does to stay cheap (the app-side work he asked for)

1. **No heartbeat. Ever.** Presence is sent when the song changes, not on a timer. A timer is what
   kills the free tier: one message a minute per person is 1,440 requests a day, and that caps us at
   about 69 people.
2. **Coalesce.** Song changes inside 20 s of each other (skipping down a playlist) send once, when the
   skipping stops.
3. **Sleep with the window.** The app already knows when it is hidden or in the tray (TRAY.md). Hidden
   and paused for 5 minutes sends one "stopped", then says nothing until something plays.
4. **Presence lives in the socket attachment, not in storage.** Rooms already does this for members
   (ROOMS.md §5.2), so hibernation costs no row write. Only the friend list is written, and it changes
   a few times a year.
5. **Reading is a side effect of being connected.** Nobody polls. The panel draws what the sockets
   already delivered, so opening it costs nothing.
6. **A cap, written down: 50 friends.** It bounds the per-launch connect cost, and it is five times
   more friends than anyone will add.
7. **One reconnect policy, copied from `src/room.ts`**: backoff, and never a reconnect storm.

With all seven, a heavy day is about 40 requests and about 5 row writes per person. The first limit we
would reach is requests, at roughly 2,500 daily users. If we ever reach that, we have a different
problem than a bill.

### 5.2 When the service is busy: the toast (D3, 2026-09-19)

**The rule: a social feature may fail, and the music must not notice.** Friends, Rooms and the
broadcast all talk to a server. Apple playback does not go through any of them. So when a request
fails, the app says so **and says what is still fine**.

**What makes this fire.** Four answers, all of which the worker already gives:

| What comes back | What it means | Today |
|---|---|---|
| **429** | The IP rate limit tripped (30 per 60 s, `wrangler.jsonc`). | Rooms shows the raw text "the rooms server answered 429" (`src/room.ts:216`). |
| **503 `{error:"off"}`** | The kill switch. The owner turned the feature off. | Same raw text. |
| **A socket that will not open, or closes and will not come back** | The daily free-tier budget is spent, or Cloudflare is having a bad day. | Nothing. It retries in silence. |
| **A `fetch` that throws** | No network. | "Couldn't start a room." |

**The toast.** One tier: `warn`, not sticky, **once per 10 minutes at most**, and never during
playback start. Proposed words, and the wording is the one sub-fork left here:

> **"Friends is busy right now — it will come back on its own. Your music is not affected."**

For the kill switch, the honest second line: **"Friends is switched off right now. Your music is not
affected."** A 429 is temporary and a 503 is not, and the toast should not say "it will come back" when
the owner has closed the door.

**Three things it must not do.**
1. **Never toast per retry.** The reconnect has backoff; the toast has its own 10-minute floor.
2. **Never block a control.** The friend list greys, the Friends part of the panel says one quiet line
   ("Not connected"), and every music control keeps working.
3. **Never toast at launch** before the first connection has had its chance. A cold start with slow
   Wi-Fi is not a busy service.

**This also fixes Rooms.** Rooms puts the raw status number in front of the user today. The same helper
serves both, so the work is shared, and a 429 in a room reads like a sentence instead of an error code.
At build time: one row in TOASTS.md §5, and a `diag.log` line for the arm and the fire (CLAUDE.md build
checklist, item 6).

---

## 6. Fork 5 — where Friends lives in the app

- **5A** ⭐ The **title bar item Rooms already has** becomes the people item. Click it, and the panel
  has two parts: **Friends** (the list) and **Room** (what it shows today). One glyph, one panel, and
  Rooms stops being a thing you only reach when you already planned to use it.
- 5B A **Friends card**, summoned like any other card.
- 5C A **Home shelf**, "Friends are playing", after Pins.
- 5D Settings › Friends only.

**Recommendation: 5A for build 1, then 5C.** 5A because the two features are one idea and the panel is
already written (`src/room-panel.ts`). 5C because Home is where he actually looks. Skip 5B: a card is a
lot of surface for a list of ten names.

---

## 7. The Rooms tie-in (small, and last)

Once a friend row exists, three things fall out of what Rooms already has.

1. **Invite by name.** The host panel lists friends. Picking one sends the room code down their Friends
   socket. No pasting. It is one message on a socket that is already open.
2. **Join on a friend's row** when they host a room. **Decided (D2, 2026-09-19): the friend row is the
   way into a room.** Clicking a friend who hosts one joins it. No code is typed, and no code is pasted. Their presence carries the room code, the app
   already turns a code into a joined room, and `rooms.rs` already normalizes it.
3. **Ask to listen along** when they do **not** host one. Their app asks them, and on Yes it starts a
   room from what they play now and sends the code back. **Fork 6:** build 1 (**6A**, one message and
   one toast) or later (**6B** ⭐, because it needs a consent prompt, a decline path and a "they said
   no" toast, and none of that is needed to ship the list)?

**Recommendation: 1 and 2 in build 1, 6B for the ask.**

---

## 8. Broadcasting to Discord

Two mechanisms, and they are not the same thing. We already have one of them.

### 8.1 Fork 7 — which mechanism

| | Option | How it works | What it needs |
|---|---|---|---|
| **7A** ⭐ | **Rich Presence** — your **Discord profile** reads "Listening to <song> by <artist>", with artwork and a progress bar. | The Discord client on the same PC listens on a named pipe, `\\.\pipe\discord-ipc-0`. The app connects, sends a handshake with an application id, and sends an activity on each song change. **Nothing leaves the machine through us.** | A Discord **application id**, registered once. Free: no bot, no token, no server. One Rust file. **Two things to measure first** (§8.4). |
| 7B | **A channel post** — a message in a Discord channel, through a webhook. | We have this today: `src-tauri/src/sotd/discord.rs` checks a webhook URL against Discord's own hosts, posts it, and deletes by message id; `sotd/outlet.rs` keeps the URL encrypted with DPAPI. Song of the Day uses it (DeetsOTD.md §8.3). | Almost nothing new. The work is the anti-flood rule, §8.2. |
| 7C | Both, as two switches. | | |

**Recommendation: 7C, and build 7B first.** 7B is a day of work on code that exists and already has an
encrypted place for the URL. 7A is the one people want, and it is the one with unknowns.

### 8.2 Fork 8 — the channel post must not be a flood

A post per song in a shared channel is unusable: 20 messages an hour.

- **8A** ⭐ **One message, edited in place.** Post "Now playing" once, then **edit** it on each song
  change. The channel gets one line that changes, not a wall. `discord.rs` already keeps the message id
  and already reaches `…/messages/{id}` to delete it; an edit is the same route with `PATCH`. When you
  stop, the message stays as the last song (⭐) or deletes itself — a sub-fork.
- 8B **A digest.** One message an hour, or one at the end of a session: "Aditya played 14 songs: …".
  Cheap and calm, but not live.
- 8C **A post per song with a floor** (one every N minutes). Still a flood, only slower.

**Recommendation: 8A, and 8B later as a second mode.** Discord rate-limits edits per channel, so the
same 20-second coalescing rule as §5.1 applies here, for a different reason.

### 8.3 Fork 9 — what the message says

- **9A** ⭐ The song's **Apple Music link**. Discord unfurls it into a card with the artwork by itself.
  This is what Song of the Day sends today, and it is why that outlet looks good with no embed code of
  ours.
- 9B A hand-built **embed** (title, artist, artwork, a colour from the cover). More control, more code.
- 9C Plain text. Nothing unfurls.

**Recommendation: 9A.** It reuses the outlet, and it lets whoever reads the channel play the song.

### 8.4 What must be measured before 7A is called "one file"

Two claims I will not make without checking. Neither is hard to check, and neither is a fork for him
yet.

1. **The activity type.** Whether an application can set its activity as **"Listening to"** (type 2)
   rather than **"Playing"** is a version-dependent detail of the RPC payload. If it cannot, the profile
   line reads "Playing DeetsMusic" with the song under it — still fine, but he should know which one he
   agreed to before it ships.
2. **The artwork.** Rich Presence images are normally **asset keys uploaded to the application**, not
   free URLs. Newer clients accept an external image through Discord's media proxy. If they do not, the
   large image is a fixed DeetsMusic logo and the cover is not shown.

### 8.5 The rest of the switch

- One Settings section, **Sharing**: *Share what I play* (§4, P1), *Show in my Discord profile* (7A),
  *Post to a Discord channel* (7B) with a **Connect** row that reuses the outlet UI Song of the Day
  already has, and *Pause sharing for an hour*.
- **Private by default.** Every switch here starts **Off**. A player that starts telling a channel what
  you play on the day it updates is the wrong kind of surprise.
- A room does not go through any of this. A room member already sees the song; that is the room, not
  sharing.

---

## 9. What this costs in Apple calls

**Nothing.** Presence is the song we already fetched in order to play it: id, title, artist, artwork
template and duration — the fields `RoomEntry` already carries (`src/room.ts:42`). A friend's row draws
from their payload. Only **Play this** (3B) uses a call, and that is the call the play needs anyway.

---

## 10. Build order, if he says go

1. **Identity** (§2): mint the key, DPAPI at rest, the code in Settings, copy and paste. **No network.**
2. **Friend list, local** (§3): add, name, remove, the cap of 50, the deep link. Still **no network**.
3. **The Discord channel post** (7B + 8A + 9A): the first thing that broadcasts, on code we own. It is
   useful on its own, with no worker at all.
4. **The Friends DO** (4A, in the worker fork 10 picks): the socket, presence in attachments, the seven
   rules of §5.1, and the busy toast of §5.2 — which lands on Rooms at the same time, because they
   share the helper.
5. **The Rooms tie-in** (§7.1, §7.2).
6. **Rich Presence** (7A), after the two measurements in §8.4.

Steps 1 to 3 ship with **zero Cloudflare cost**, and they are most of what the idea feels like.

---

## 11. Open forks, in one list

| # | Question | Recommended |
|---|---|---|
| 1 | What a friend code is | 1A — a key the app mints |
| 1a | Moving to a new PC | 1a-A — copy and paste the key |
| 2 | How a friend is added | 2A mutual add, and 2C invite link |
| 3 | What a friend sees | 3A + 3B + 3C, one full row |
| P | Privacy control | P1 — one switch and a pause |
| 4 | Transport | 4A — sockets, with §5.1 · **D1 (no heartbeat) is decided** |
| 5 | Where it lives | 5A — the Rooms title bar item, then 5C |
| 6 | Ask to listen along | 6B — later. **D2 is decided**: a friend's row is how you reach a room. Fork 6 is only the case where they host none yet. |
| 7 | Discord mechanism | 7C both, 7B first |
| 8 | The flood rule | 8A — one message, edited |
| 9 | What the message says | 9A — the Apple Music link |
| ~~10~~ | ~~Reuse the rooms worker, or a new one (§15)~~ | **CLOSED 2026-09-19 (D4): a new worker.** |
| T | The busy toast's words (§5.2) | The two sentences in §5.2 |

---

## 12. Not in this build (written down so it is not proposed again)

- **Reading friends' presence FROM Discord.** It needs a bot in a shared server with the presence
  intent, or a user token. A user token is against Discord's terms — the wall DeetsOTD already hit
  (DeetsOTD.md §6, "D2 as a user token. Ruled out"). A bot needs a host that holds a gateway socket,
  which a Cloudflare Worker is not built for.
- **A friend feed or history** ("what they played today"). It is a store that grows, on a free tier that
  charges for rows. Presence is one value per person, and that is the point.
- **Following a friend's listening automatically** (their song plays on your app). That is Rooms, and it
  is built. Friends is how you find the room, not a second copy of it.
- **A profile page on deets.solutions.** The website is out of scope for Rooms (ROOMS.md §13), and the
  same line holds here.

---

## 13. What the app asks of our workers today (read from the code, 2026-09-19)

The baseline the owner asked for. Five workers share one Cloudflare account: `deets-support`,
`deets-accounts`, `deetsmusic-rooms`, `deets-radio`, `deetsfilm-worker`. **The free tier is metered per
account, not per worker** — this is the fact that decides §15.

| What | Where | When it runs | Requests per install per day |
|---|---|---|---|
| **The developer-token mint** | `music-api.deets.solutions/token` (`src-tauri/src/apple.rs:368`) | At startup **only** when the cached token has under 3 days left (`REFRESH_MARGIN_SECS`). The worker hands out a shared token with 7–14 days left, so a fetch happens every 4 to 11 days. | **0.1 – 0.25** |
| **Remote config** (flags, notice, `minVersion`) | The same call | **No extra request.** It rides the token response (`apple.rs:623`). | **0** |
| **The update check** | `music-api.deets.solutions/update` (`src-tauri/src/update.rs:24`) | 30 s after launch, then **every 6 hours** (`src/updater.ts:43`). Skipped when Updates is Off and no version is required. | **1 – 5** |
| **A 401 refetch** | The mint | Only when Apple rejects the token; a 10-minute cooldown bounds it. | ~0 |
| **Sign-in** | `music-api.deets.solutions` hosted page | When you sign in. | ~0 |
| **A bug report / My reports** | `support.deets.solutions` | When you send or refresh one. | ~0 |
| **Rooms** | `rooms.deets.solutions` | Only in a room (§14). | 0 |
| **Everything else** | — | Apple, Last.fm and Discord are **not ours** and cost us nothing. | 0 |

**Total today: about 5 requests per install per day**, and the update check is nearly all of it.

**But the budget is not ours alone.** Cloudflare's own wording, checked 2026-09-19: "Accounts on the
Workers Free plan have a daily request limit of 100,000 requests, resetting at midnight UTC." **Per
account.** Five workers share it, and two of them are not idle: `deetsfilm-worker` and the league
crawler behind `api.deets.solutions` run on crons, and the game tables in DeetsSolutions hold real-time
WebSockets (DeetsSolutions/docs/realtime.md). So the honest sentence is: **DeetsMusic is nowhere near
100,000, and the account has other tenants.** Anything we add here is added to their bill, which is
also why a second worker (§15) costs nothing extra — it is the same bucket either way.

**So the honest comparison:** Friends at §5.1's rules costs about **36 requests per install per day**,
which is about **7× what the app costs today**. That is still 2,500 daily users inside the free tier,
but it is the app's first feature whose cost grows with how much you listen instead of how often you
launch. The §5.1 rules exist to keep that multiple from becoming 300× — one heartbeat a minute would.

---

## 14. What one room costs

From ROOMS.md §3.2, the worked example: **4 people, 3 hours, about 45 songs, about 200 commands.**

| Meter | This room | Free limit | Rooms like this per day |
|---|---|---|---|
| Requests | 4 joins, a few reconnects, 200 messages ÷ 20 ≈ **20** | 100,000 / day | ~5,000 |
| **SQLite rows written** | ~2 per command, plus 1 alarm per song ≈ **450** | 100,000 / day | **~220** ← the real limit |
| Duration | The DO hibernates between messages. ~0 | 13,000 GB-s / day | — |
| Storage | A few KB, deleted when the room ends | 5 GB | — |

**A room costs about 20 requests and about 450 row writes.** Rows written is what runs out first, and
it is the room's alarm and its queue edits that write them — **presence writes none of this**, because
a friend's song lives in the socket attachment and never reaches storage (§5.1 rule 4). Friends is a
much cheaper shape than a room, per person and per hour.

### 14.1 The limits, checked again (2026-09-19, developers.cloudflare.com)

The owner asked whether the write limit is really that high. **It is. The numbers in ROOMS.md §3.2 are
right**, re-read from Cloudflare's Durable Objects pricing page on 2026-09-19:

| Free plan | Value |
|---|---|
| Requests | **100,000 / day** |
| Duration | **13,000 GB-s / day** |
| SQLite **rows written** | **100,000 / day** |
| SQLite rows read | **5 million / day** |
| Stored data | **5 GB** total |

What the page also says, and what the doc had only half-right:

- The key-value methods — `get()`, `put()`, `delete()`, `list()` — **run against a hidden SQLite
  table**, so they are counted in rows even though the code never writes SQL. A `put()` of three keys
  is three rows, which is what `room.js:77` does.
- **`setAlarm()` is billed as one row written.** One alarm per song, as the doc says.
- **`delete()` counts as a row written too**, so `deleteAll()` at the end of a room is not free.
- SQLite storage billing was switched on in January 2026, so this is live metering, not a future plan.

### 14.2 The find that matters: attachments are free, and they are bigger than we thought

From Cloudflare's WebSocket hibernation API page, read 2026-09-19:

- `serializeAttachment()` **does not write to SQLite**. It is kept with the connection by the
  hibernation manager, not in the DO's storage, and it is not billed as rows.
- Its cap is **16,384 bytes** — 16 KB per socket, not the 2 KB I had in mind.
- **It dies with the socket.** "If either side closes the connection, attachments are lost."

16 KB per socket is enough for a room's whole transport state, and for a queue of roughly 40 to 50
entries at the size `RoomEntry` serializes to.

**This is what answers the owner's other question** — can a room avoid SQLite writes altogether? Yes,
by moving live state out of storage and into the host's socket attachment, and by dropping the alarm
for arithmetic both sides can do. The design is **ROOMS.md §20**, and its recommendation is to build
the shape **here in Friends first**, where it is new code, and to leave the shipped Rooms alone until
its one open desk test (§18.7) closes.

---

## 15. The worker: a new one (DECIDED 2026-09-19, D4)

**The cost answer: it makes no difference.** The free tier meters requests and rows **per account**. A
second worker does not get a second 100,000, and it does not spend anything extra either. Whatever we
build costs the same in either home. **So this is not a cost decision, and it should not be made on
cost.**

What does differ is **what a deploy breaks**:

| | Option | For | Against |
|---|---|---|---|
| 10A | **The same worker, a new Durable Object class** (`Friends` beside `Room`). One deploy, one domain, shared protocol and version code. | Less config. The 20:1 and hibernation rules are already understood there. One kill switch to reach. | **Every Friends deploy drops every live room socket.** ROOMS.md §17.10 measured this: a deploy disconnects every member of every running room. Friends will deploy often while it is new; Rooms is finished and stable. |
| **10B** ⭐ | **A new worker**, `deetsmusic-friends`, on `friends.deets.solutions`, in its own repo beside DeetsMusicRooms. | A Friends deploy cannot interrupt anyone's room, and a room deploy cannot drop a friend list. Its own kill switch, its own rate limit, its own protocol version. Copying `codes.js`, `protocol.js` and `sanitize.js` is an afternoon. | A second wrangler config, a second DNS record, a second thing to deploy. Two copies of small helpers that will drift. |
| 10C | **No new server** — fork 4C, personal rooms on the rooms worker. | Nothing new at all. | Costs **more**, not less: a room DO writes rows per claim and per alarm (§14) where a presence DO writes none. It buys a "free" worker with a bigger bill. |

**Decided: 10B, a new worker.** The deciding fact is ROOMS.md §17.10, not money. Rooms is built, tested and
quiet; Friends will be redeployed a dozen times in its first month. Those deploys should not reach into
a room somebody is listening in. And §19 of ROOMS.md — the whole design about warning people that a
redeploy happened — exists precisely because that interruption is hard to apologise for.

**As built, then:** `deetsmusic-friends`, its own private repo beside `../DeetsMusicRooms`, plain JS,
no build step, wrangler 4 (or the rate limit is silently dropped), one Durable Object class `Friends`,
its own `KILL_FRIENDS` switch, its own `ratelimits` block, and `friends.deets.solutions` as a custom
domain — compiled into the app the way `rooms.deets.solutions` is (`src/room.ts:132`), so a later move
is a route change and not an app release. `codes.js`, `protocol.js` and `sanitize.js` are copied from
the rooms worker on day one; they will drift, and that is the price of the isolation.

**The one cost of this choice, written down:** two workers to deploy, and two copies of three small
files. Not two budgets — there is only ever one (§13).
