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
| D5 | **Keep the pasted webhook. No Discord OAuth.** The question was asked and checked; the answer is §8.6. | §8.6, new. Fork 7B's shape is settled. |
| D6 | **The Rich Presence card carries buttons (11A)**, and *Listen Along* points at a landing page. | §8.7, new. Fork 11 is **closed**. |
| D7 | **The landing page is always shown (L1)** — no install detection, no bare redirect. | §8.7.2. Fork L is **closed**. |
| D8 | **The privacy switches are real Settings rows**, including the one that governs the *Listen Along* button. (Superseded in placement by D9/D10: they live in the top-level `Discord` and `Sharing` sections.) | §8.5, rewritten. The §8.7 privacy sub-fork is **closed in favour of a switch**. |
| D9 | **The webhook moves to a top-level `Discord` section** (fork M1). Song of the Day keeps its pick rows and gains a status line that links there. | §8.5.2. Fork M is **closed**. |
| D10 | **A top-level `Sharing` section** holds the two consent rows, adjacent (fork S1). | §8.5.1. Fork S is **closed**. |
| D11 | **Pause covers both** — DeetsMusic and Discord — and lives in `Sharing`. | §8.5.1, §8.5.3. |
| D12 | **Identity is 1C**: the app mints its own key now (1A), and a DeetsAccounts link comes later as an **optional** extra. The friend code never changes. | §2, §2b. Fork 1 is **closed**. |
| D13 | **Copy my key / Paste a key** (1a-A) is how you move to a new PC until D12's link exists. | §2a. Fork 1a is **closed**. |
| D14 | **Rich Presence ONLY (7A). A now-playing channel post is REJECTED** — not deferred. The owner, 2026-09-19: *"we're not doing 7B, that would equate to spam"*, and *"channel post is actively a bad idea, not wanted."* | §8.1, §12. Fork 7 is **closed at 7A**; forks 8 and 9 fall with it. |
| D15 | **The profile clears about a minute after you pause, and at once when you quit** (sub-fork B1). | §8.9, new. Fork B is **closed**. |

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

### 2b. Where the 1B link lands later (D12, read from `../DeetsAccounts` on 2026-09-19)

1C means **1A is permanent and 1B is additive**. The minted key stays the identity forever; a Deets
account only ever *points at* it. The friend code a person hands out never changes, so nothing a
friend stored can go stale. This is the property that makes "later" safe.

**What already exists.** `../DeetsAccounts` is live at `id.deets.solutions`: Google sign-in with PKCE,
a D1 `users` table, and cookie sessions. It is deliberately thin — scope `openid profile`, so **Google
never sends an email and the table holds none**. It stores an opaque `google_sub`, a display name and
a seat colour. Its routes today are `GET /login`, `GET /cb`, `GET /me`, `PATCH /me`, `POST /logout`.

**The schema already expects this.** `schema.sql` says of `users.id`: *"Ours, not Google's. A second
sign-in method later becomes a new identities table rather than a migration of every foreign key."*
So the link is a new table, not a migration.

**The work, when it comes — four pieces and no app rewrite.**

| # | Where | What |
|---|---|---|
| 1 | `DeetsAccounts` D1 | A new `identities` table: `(user_id, kind, key_hash, created_at)`. **A hash of the friend key, never the key** — the key is a credential, and §2's whole point is that we hold none. |
| 2 | `DeetsAccounts` worker | Two routes: link this key to the signed-in account, and list my linked keys. |
| 3 | The app | One Settings row, *Link to my Deets account*. The sign-in road **already exists** — the hosted page + deep link of DATA-ARCHITECTURE.md §2a, built 2026-09-13 for Apple, travels the same road (`…://auth?…`, `…://lastfm?…`, `…://room?…`). |
| 4 | The app, on a new PC | "Sign in and bring my key" — the one flow that makes 1B worth having. It adopts the linked key instead of minting a fresh one. |

**What triggers it.** Not a date. It comes when **1a-A stops being enough**: when "I lost my key" is a
real support message, or when the owner wants two PCs of his own. Copy-and-paste covers one person
with one machine indefinitely.

**What it costs, and why it is not now.**

- It is the first per-user row that ties the **music app** to a Google account. §1's table says the
  worker holds "no secrets and no user data". 1B bends that line on purpose, and it should be bent
  when there is a reason, not in advance.
- It is a **second sign-in** in a player that already makes you sign in to Apple.
- **A fork for that day, not this one:** DeetsAccounts serves the website and its game tables.
  Putting the music app on it couples two products that are otherwise independent. The alternative is
  for `deetsmusic-friends` (D4) to hold the link itself. Do not decide it now — decide it when §2b is
  actually built, against whatever both products look like then.

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

**CLOSED 2026-09-19 (D14): 7A only.** The owner: *"we're not doing 7B, that would equate to spam."*
A message in a shared channel is addressed to everyone in it, whether or not they asked; a profile
line is addressed to whoever chooses to look at you. That is the difference, and it is the reason.

**This doc previously recorded fork 7 as closed at 7C.** That was wrong — it was inferred from the
owner keeping the pasted webhook for **Song of the Day** (D5), which is a different feature. He never
asked for a now-playing channel post. Corrected 2026-09-19.

**7B, and forks 8 and 9 with it, are REJECTED.** The owner, asked a second time: *"Channel post is
actively a bad idea, not wanted."* §8.2 and §8.3 stay on the page only as a record of the reasoning —
the way PROVIDERS.md keeps Spotify — so that nobody re-derives them as a proposal. They are not a
deferred plan.

**Neither mechanism uses a worker.** 7B posts straight from Rust (§8.6.1 reads the path out of the
code). 7A writes to a pipe on the same PC. The **only** server work anywhere in §8 is the one landing
route in §8.7.2, and that route is not on the posting path.

### 8.2 Fork 8 — the channel post must not be a flood  ·  **REJECTED (D14)**

> Kept only as a record of the reasoning, the way PROVIDERS.md keeps Spotify. The channel post is
> **not wanted** — see §12. Nothing below is a plan.

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

### 8.3 Fork 9 — what the message says  ·  **REJECTED (D14)**

> Kept only as a record. See §12.

- **9A** ⭐ The song's **Apple Music link**. Discord unfurls it into a card with the artwork by itself.
  This is what Song of the Day sends today, and it is why that outlet looks good with no embed code of
  ours.
- 9B A hand-built **embed** (title, artist, artwork, a colour from the cover). More control, more code.
- 9C Plain text. Nothing unfurls.

**Recommendation: 9A.** It reuses the outlet, and it lets whoever reads the channel play the song.

### 8.4 What must be measured before 7A is called "one file"

Three items. The first two are claims I will not make without checking. The third is not a claim — it is
a fact from Discord's own documentation that changes **how 7A is desk-tested**.

1. **The activity type.** Whether an application can set its activity as **"Listening to"** (type 2)
   rather than **"Playing"** is a version-dependent detail of the RPC payload. Current clients do appear
   to accept it, and Discord's activity object also carries **`status_display_type`**, which puts the
   *song* on the headline instead of the app name — "Listening to Blue Monday" rather than "Listening to
   DeetsMusic". Both are to be measured, not assumed. If neither holds, the profile line reads "Playing
   DeetsMusic" with the song under it — still fine, but he should know which one he agreed to before it
   ships.
2. **The artwork.** Rich Presence images are normally **asset keys uploaded to the application**, not
   free URLs. Newer clients accept an external image through Discord's media proxy. Apple's artwork URLs
   are public `https`, so this is likely to need no upload and no extra Apple call — but it is measured
   before it is promised. If it fails, the large image is a fixed DeetsMusic logo and the cover is not
   shown.
**Where these can be measured.** All three need **Windows**, a DeetsMusic dev build, and the **Discord
desktop client running on the same PC** — the pipe is local. They cannot be done from a Mac session, so
they are the first thing to run next time the owner is at the Windows machine. Nothing else in the
build is blocked in the meantime; the doc work is complete without them.

3. **Buttons are invisible to their own author.** Discord's Rich Presence guide states it plainly:
   *"Buttons are only visible to other users — you cannot see buttons on your own Rich Presence."* So the
   §8.7 buttons **cannot be desk-tested from one account**. The test needs a second Discord account or a
   second person, exactly like the two-app room test in ROOMS.md §17. Write this into the desk test
   before the build starts, or the first run will read as a failure when it is not.

### 8.5 Where the switches live (D8, D9, D10, D11 — 2026-09-19)

Read from `src/settings-card.ts` on 2026-09-19: Settings has **21 top-level sections**, and two of
them are already **per-service** — `Apple Music` and `Last.fm`. `Last.fm` earns its section with two
toggles. So a top-level **Discord** section is the pattern the card already uses, not a new one.

**What is there today.** The Discord webhook is **not** in a Discord section. It is a nested group
inside `Song of the Day` (`id: "sotddiscord"`), holding the Connect row (`sotdhook`), *Post as*
(`sotdpostas`) and the post log (`sotdlog`). It sits under a feature name, not a service name.

#### 8.5.1 The layout (S1)

Two new top-level sections. **Sharing** holds the consent; **Discord** holds the plumbing.

**Sharing** — placed next to the service sections, above `Discord`.

| Row | Kind | Default | Key | Governs |
|---|---|---|---|---|
| *Share activity on DeetsMusic* | toggle | **Off** | `shareActivityApp` | Friends presence (§4, fork P1). |
| *Share activity on Discord* | toggle | **Off** | `shareActivityDiscord` | 7A, Rich Presence. The master switch: Off means the pipe is never opened. |
| *Pause sharing for an hour* | button | — | `sharePauseUntil` | **Both rows at once** (D11), without losing either setting. |

The two rows are **adjacent on purpose**. "Who can see what I play" is one decision with two answers,
and a person must be able to read both without leaving the row they are on.

**Discord** — the service section.

| Row | Kind | Default | Key | Governs |
|---|---|---|---|---|
| **Connect** (+ *Post as*, the post log) | the Song of the Day outlet UI, **moved** (D9/M1) | not connected | `sotd-outlets.json` (unchanged) | The one webhook. Paste the URL (D5). |
| *Let my profile invite people to my room* | toggle | **Off** | `discordRoomInvite` | The **Listen Along** button, §8.7.1. Off means the button is never sent, even while hosting. |

#### 8.5.2 The webhook moves, the behaviour does not (M1, D9)

- `Settings › Discord` gets the **Connect** row, *Post as* and the post log — **the same three controls,
  re-parented**. No change to `outlet.rs`, `discord.rs` or the stored file.
- `Song of the Day` **keeps** *Song of the Day*, *Day starts at*, *Picks per day*, *Post my picks* and
  *Post at*. Those rows are about **picks**, not about Discord.
- Its `sotddiscord` group becomes **one status line** — "Posting to ‹webhook name› — Settings ›
  Discord" — and that line is a link. `requestSetting` (`settings-card.ts:2153`) already unfolds a
  section, scrolls to the row and highlights it, so the pointer costs nothing to build.
- **Why it still moves, after D14.** The original reason — a second feature about to read the same
  connection — is void: there is no second feature. What remains is that a **service** section is where
  a person looks for a service's connection, and `Discord` now exists for Rich Presence anyway. So the
  move is **tidiness, not a prerequisite**. It is cheap while the section is being built, and it is the
  one item in this build that touches already-shipped UI. Say the word if Song of the Day should be
  left exactly as it is.
- **One webhook, one feature.** After D14 the webhook has exactly one consumer: Song of the Day.
  `outlet.rs`, `discord.rs` and `sotd-outlets.json` are **unchanged** by this build.

#### 8.5.3 The rules that hold over both sections

- **Private by default.** Every switch here starts **Off**. A player that starts telling a channel what
  you play on the day it updates is the wrong kind of surprise.
- **Why the invite is its own switch, not a consequence of hosting.** Hosting a room is already a
  choice, so a button that only says "he is hosting" tells nobody anything new. But the button carries
  the **room code**, and the code is the only gate on the room (ROOMS.md §6). A public profile therefore
  publishes the code for as long as the card is up. That is a door, not a fact, so it gets its own
  switch and its own Off.
- **The pause covers both** (D11). "Stop telling anyone what I am playing, for an hour" is one
  intention. A pause that covered only half of it would be a trap.
- Each new key needs its default and its "why" in `settings-store.ts`, a spec in `agent-settings.ts`
  and a line in AGENT.md (CLAUDE.md checklist item 5). Each new row is reachable from Ctrl+Space by
  COMPASS.md §9 — store-backed rows are automatic, the Connect panel exports an opener. `Settings ›
  Reset` gets one row per new group of keys (`settings-card.ts:187`).
- A room does not go through any of this. A room member already sees the song; that is the room, not
  sharing.
- **Build order note.** *Share activity on DeetsMusic* has nothing behind it until Friends exists
  (§10 steps 1, 2 and 4). It ships **with Friends**, not with the Discord work. The Sharing section is
  created by whichever lands first, with only the row it owns.

### 8.6 Discord OAuth — asked, checked, and not taken (D5, 2026-09-19)

The question: *could a Discord OAuth sign-in broadcast what you play as "Listening", the way Spotify
does?* Three findings, and they close it.

**1. No OAuth scope sets your presence.** Presence is not a REST resource. It lives on the gateway
socket that the person's **own Discord client** holds. No third party can write to it with any token.
The scopes that sound close — `activities.write`, `rpc.activities.write` — govern the **local** RPC
channel, not a remote call. "Sign in with Discord, then we push your song" does not exist as a route.

**2. Spotify's card is not an integration you can apply for.** It is a first-party **Connection**.
Discord holds the Spotify link itself, polls Spotify's API with it, and draws that specific card — the
progress bar, *Listen Along*, *Play on Spotify*. It is hard-coded for a small partner set. There is no
public form. DeetsMusic cannot become one, and no amount of OAuth changes that.

**3. The Social SDK is the OAuth-flavoured path, and it is the heavy one.** Discord's Social SDK does
use OAuth, and its design guidelines are what a search finds first. It ships a native library and asks
every user to authorize, and it exists to give a game Discord's own friend graph — which we are not
using, because §2 builds ours. It writes **the same activity object** that plain RPC writes.

| | Social SDK | Local RPC (7A) |
|---|---|---|
| OAuth | **Yes**, per user | **No** |
| Ships | A native library in the bundle | One Rust file, a named pipe |
| Also gives | Discord friends, lobbies, voice | Nothing else |
| The presence you get | The same activity object | The same activity object |

**What OAuth would have bought for 7B, and what it costs.** The one real use is the `webhook.incoming`
scope: instead of pasting a URL, the person clicks Connect, picks a server and channel in Discord's own
dialog, and Discord hands back **the same webhook URL**. Same posting code after that, same rate
limits, same message. The price is a **client secret** — which cannot ship inside the app — so the
code-for-token exchange needs a worker route, a stored token, a refresh, a revoke path and a new
failure state. **Decided: keep the paste.** It is built, DPAPI-encrypted and already desk-tested
through Song of the Day.

#### 8.6.1 How 7B posts today, read from the code (2026-09-19)

Confirms there is no server on the posting path, and that §8.2's edit is small.

| Step | Where | What |
|---|---|---|
| Paste | Settings row → Rust | `discord.rs::valid_url` checks `https`, one of **six** Discord hosts, and the path `/api[/vNN]/webhooks/<digits>/<token>`. Anything else is refused **before a request is made**, so the app never calls a host the person pasted. |
| Check | `discord.rs::check` | One `GET`. It **posts nothing**. It reads back the webhook's own name for the status line. |
| Store | `outlet.rs` | `sotd-outlets.json`, DPAPI-encrypted under the current Windows user, registered with `log::register_secret` so the log and any bug report mask it. `status()` returns names and states only — **the URL never reaches the renderer**. |
| Trigger | `outbox.rs` | Ask each time · Right away · At a set time. State is in `pick_posts`, so it survives a restart. A `SENDING` claim set stops a double post, because a webhook is not idempotent. |
| Post | `discord.rs::post` | `reqwest`, 15 s timeout, `POST …?wait=true`, 1 MB body cap. Discord answers with the message, and the **id** is kept. |
| Unmark | `discord.rs::delete` | `DELETE …/messages/{id}`. A 404 counts as deleted. |

**So §8.2's "one message, edited in place" is one function.** `delete` already builds the
`…/messages/{id}` route and the id is already kept; an edit is `PATCH` on that same URL.

---

### 8.7 Fork 11 — what the Rich Presence card offers (D6, closed 2026-09-19)

Spotify's *Listen Along* is a first-party control and cannot be reproduced. **The handoff it performs
can be**, and every piece already exists.

#### 8.7.1 The card

Discord's Rich Presence guide gives an activity **up to two buttons**, each a label and an **`https`**
URL. Custom schemes are refused, so `deetsmusic://` cannot be a button URL directly.

| Slot | Label | Points at | When |
|---|---|---|---|
| Text | the song title | the Apple Music link, through **`details_url`** | always — it spends no button slot |
| Button 1 | **Play on Apple Music** | the song's Apple Music link | always |
| Button 2 | **Listen Along** | `https://rooms.deets.solutions/j/<CODE>` | only while hosting a room **and** `discordRoomInvite` is On (§8.5) |

`details_url` and `state_url` make the activity's own text clickable, so the Apple Music link is
reachable without spending a slot. Both are measured with the other items in §8.4.

**Not taken: join secrets.** Discord can put a real **Join** button in the card and fire `ACTIVITY_JOIN`
into the app, with no browser at all — true parity with Spotify's shape. It needs Discord to know how
to launch DeetsMusic on the **other** person's PC, which means a registered launch protocol and
probably app verification. It is a possible upgrade **after** 11A ships, not a thing to chase first.

#### 8.7.2 The landing route (L1, D7)

`GET https://rooms.deets.solutions/j/<CODE>` — a new route on the **rooms** worker, which already owns
that host (ROOMS.md §14, `rooms.deets.solutions`).

A web page **cannot reliably tell whether the app is installed**, so it does not try. The route always
returns one small page:

> **Aditya is listening on DeetsMusic**
> [ **Open DeetsMusic** ] → `deetsmusic://room?code=<CODE>`
> [ **Get DeetsMusic** ] → `deets.solutions/deetsmusic/`

- **The download target already ships.** `deets.solutions/deetsmusic/` is the release and support page
  (RELEASE.md §6.2), with notes and an installer. So no new website is built, and ROOMS.md §13 — the
  site is out of scope — is not bent. We link to a page that is already live.
- **The deep link already works.** `src-tauri/src/rooms.rs` parses `deetsmusic://room?code=…`, checks
  the code's shape against the Crockford alphabet, and emits `room-invite`; `room.ts` **asks before it
  joins**. A stray page cannot make anyone join anything.
- **The worker validates the code's shape** and serves the same page either way. It does **not** look
  the room up, so the route leaks nothing about whether a room exists and costs no Durable Object read.
- **It reads correctly on a phone**, where the honest answer is "this is a Windows app". L2 (fire the
  deep link, fall back on a timer) was rejected: Edge shows its own "Open DeetsMusic?" prompt and leaves
  the page up, so the download appears under a prompt already answered. L3 (a bare 302) was rejected
  because a person without the app gets a browser error and nothing else.

#### 8.7.3 The deploy

Adding `/j/` means deploying the rooms worker, and a deploy **drops every live room socket**
(ROOMS.md §17.10). The two `epoch` lines from §18.7 are already waiting for the next real deploy, so
**`/j/` rides that same deploy** — one interruption, not two. *(Owner, 2026-09-19: there are no live
users at this stage, so the interruption is not itself a constraint. The single deploy is tidiness,
not risk.)*

### 8.9 When the profile is set, and when it clears (D15 / B1)

One table, because "what does it say right now" is the whole feature and a wrong answer is visible to
other people.

| What happens | What the profile does | Why |
|---|---|---|
| A song starts | Set the activity | — |
| The song changes | Set it again, **through the coalescer** | Discord rate-limits RPC updates (§8.4), and skipping down a playlist would otherwise send one per skip. A settled change fires at once; only skipping is delayed. |
| You **pause** | **Clear after about a minute** | B1. A short pause — a doorbell, a sip of coffee — should not blank your profile and come back. A long one is no longer true. |
| You press play again inside that minute | Nothing was cleared, so nothing is re-sent | The quiet case, and the reason B2 was not taken. |
| You **quit** the app | Clear **at once** | The pipe closing would drop it anyway; doing it deliberately means it is never left behind on a crash-free exit. |
| You switch *Share activity on Discord* **Off** | Clear **at once** | A privacy switch that takes a minute to take effect is not a privacy switch. |
| You press *Pause sharing for an hour* | Clear **at once** | Same reason. |
| Discord is not running | Do nothing, and do not retry in a loop | The pipe is simply absent. It is not an error, and it gets no toast. |

**The clear-after-pause timer is armed on pause and cancelled on play.** `diag.log` records the arm,
the fire and the cancel, per CLAUDE.md checklist item 6.

---

### 8.8 The build gate (2026-09-19)

**Every fork in §8 is now closed by the owner.** 7 at **7A only** (D14), 8 and 9 **rejected with it**,
OAuth (D5), 11 (D6), L (D7), privacy (D8), M (D9), S (D10), Pause (D11), B at **B1** (D15).
**Nothing in the broadcast half waits on a decision.**

**One step remains before code: the three measurements of §8.4** — activity type 2,
`status_display_type`, and whether a plain `https` artwork URL is accepted. All three need **Windows**,
a dev build and the **Discord desktop client on the same PC**, so they cannot be done from a Mac
session. They are the first thing to run at the Windows machine, and all three change 7A's shape, so
no 7A code is written before them.

**Nothing else blocks a start.** ROOMS.md §18.7's code was committed and its three desk-test steps
**PASSED 2026-09-19**, so Rooms has no open desk test and CLAUDE.md's one-in-flight rule is satisfied.

**The build, in full, after D14:**

| Piece | Where |
|---|---|
| The RPC client — pipe, handshake, `SET_ACTIVITY` | one new Rust file |
| The activity — type, `details_url`, artwork, timestamps, buttons | §8.7.1 |
| The coalescer, and the lifecycle table | §8.9 |
| `Sharing` + `Discord` Settings sections, three rows | §8.5.1 |
| The §8.5.2 move of Song of the Day's Connect row | tidiness, still the owner's to cancel |
| The `/j/` landing route, on the next rooms deploy | §8.7.2 |
| Desk test — needs the owner's friend, because §8.4 item 3 | §8.4 |

---

## 9. What this costs in Apple calls

**Nothing.** Presence is the song we already fetched in order to play it: id, title, artist, artwork
template and duration — the fields `RoomEntry` already carries (`src/room.ts:42`). A friend's row draws
from their payload. Only **Play this** (3B) uses a call, and that is the call the play needs anyway.

---

## 10. Build order, if he says go

1. **Identity** (§2): mint the key, DPAPI at rest, the code in Settings, copy and paste. **No network.**
2. **Friend list, local** (§3): add, name, remove, the cap of 50, the deep link. Still **no network**.
3. ~~**The Discord channel post** (7B + 8A + 9A).~~ **REMOVED by D14 — it would be spam.**
4. **The Friends DO** (4A, in the worker fork 10 picks): the socket, presence in attachments, the seven
   rules of §5.1, and the busy toast of §5.2 — which lands on Rooms at the same time, because they
   share the helper.
5. **The Rooms tie-in** (§7.1, §7.2).
6. **Rich Presence** (7A) — after the three measurements of §8.4, and remembering item 3: the buttons
   cannot be seen from the account that sets them. With D14 this is **the only broadcast work**, so it
   moves to the front: it does not wait on steps 1, 2, 4 or 5, because a profile line needs no friend
   code, no worker and no network. It carries with it the `Sharing` + `Discord` Settings sections, the
   coalescer and the §8.5.2 move.
7. **The `/j/` landing route** (§8.7.2), bundled into the rooms worker's next deploy with the three
   pending `epoch` lines of ROOMS.md §18.7.

**After D14, the real order is 6 → 7 → 1 → 2 → 4 → 5.** Rich Presence is independent of Friends, and
it is what the owner asked for on the first day.

Steps 1 to 3 ship with **zero Cloudflare cost**, and they are most of what the idea feels like.

---

## 11. Open forks, in one list

| # | Question | Recommended |
|---|---|---|
| ~~1~~ | ~~What a friend code is~~ | **CLOSED 2026-09-19 (D12): 1C** — 1A's minted key now, a DeetsAccounts link later as an option (§2b). |
| ~~1a~~ | ~~Moving to a new PC~~ | **CLOSED 2026-09-19 (D13): 1a-A** — Copy my key / Paste a key, with the warning that the key IS you. |
| 2 | How a friend is added | 2A mutual add, and 2C invite link |
| 3 | What a friend sees | 3A + 3B + 3C, one full row |
| P | Privacy control | P1 — one switch and a pause |
| 4 | Transport | 4A — sockets, with §5.1 · **D1 (no heartbeat) is decided** |
| 5 | Where it lives | 5A — the Rooms title bar item, then 5C |
| 6 | Ask to listen along | 6B — later. **D2 is decided**: a friend's row is how you reach a room. Fork 6 is only the case where they host none yet. |
| ~~7~~ | ~~Discord mechanism~~ | **CLOSED 2026-09-19 (D14): 7A only.** A channel post is spam. The doc's earlier "7C" was an inference, not his decision. |
| ~~8~~ | ~~The flood rule~~ | **REJECTED with D14.** There is no channel post. |
| ~~9~~ | ~~What the message says~~ | **REJECTED with D14.** 9A was approved before 7B was dropped; it is now moot. |
| ~~OAuth~~ | ~~Discord OAuth instead of the pasted webhook (§8.6)~~ | **CLOSED 2026-09-19 (D5): keep the paste.** No scope sets presence; `webhook.incoming` buys a channel picker and costs a secret, a worker route and a token to keep. |
| ~~11~~ | ~~What the Rich Presence card offers (§8.7.1)~~ | **CLOSED 2026-09-19 (D6): 11A** — two buttons plus clickable text. Join secrets are a later upgrade, not a first chase. |
| ~~L~~ | ~~What the Listen Along URL does (§8.7.2)~~ | **CLOSED 2026-09-19 (D7): L1** — always a small landing page, no install detection. |
| ~~Priv~~ | ~~Whether the invite button needs its own switch~~ | **CLOSED 2026-09-19 (D8): its own switch**, Off by default, in Sharing › Discord (§8.5). |
| ~~S~~ | ~~Where the Friends switch sits next to the Discord group (§8.5)~~ | **CLOSED 2026-09-19 (D10): S1** — a top-level `Sharing` section with the two *Share activity on …* rows adjacent, and a top-level `Discord` section for the plumbing. |
| ~~M~~ | ~~Whether the Song of the Day webhook moves (§8.5.2)~~ | **CLOSED 2026-09-19 (D9): M1** — the connection moves to `Discord`, the pick rows stay, a linked status line replaces the old group. |
| ~~Pause~~ | ~~What *Pause* covers~~ | **CLOSED 2026-09-19 (D11): both rows**, and it lives in `Sharing`. |
| ~~10~~ | ~~Reuse the rooms worker, or a new one (§15)~~ | **CLOSED 2026-09-19 (D4): a new worker.** |
| T | The busy toast's words (§5.2) | The two sentences in §5.2 |
| ~~B~~ | ~~What the profile does when you pause~~ | **CLOSED 2026-09-19 (D15): B1.** The full lifecycle is §8.9. |

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
  same line holds here. The `/j/` landing page of §8.7.2 is **not** an exception: it is a worker route on
  `rooms.deets.solutions`, and it links to the release page that already ships.
- **A now-playing post in a Discord channel (7B).** **Rejected**, twice, 2026-09-19: *"that would
  equate to spam"* and *"channel post is actively a bad idea, not wanted."* A channel message is
  addressed to everyone in the channel whether they asked or not; a profile line is addressed only to
  whoever chooses to look. This is a judgement about what the product should be, not a cost or a
  scheduling call, so it does not come back when the schedule changes. §8.2 and §8.3 remain only as a
  record of reasoning already done.
- **Discord OAuth, in any form.** §8.6 has the three findings. It cannot set presence at all, and for
  the webhook it buys a channel picker at the price of a shipped secret.
- **Becoming a Discord first-party Connection**, the way Spotify is. There is no public route to it
  (§8.6, finding 2).
- **The Discord Social SDK.** It writes the same activity a named pipe writes, and it asks for a native
  library and a per-user OAuth sign-in to do it (§8.6, finding 3).

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
