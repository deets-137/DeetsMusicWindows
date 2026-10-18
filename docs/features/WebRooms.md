---
status: built
desk_test: passed 2026-10-17
sources: [web/app.ts, web/listen.ts, web/handlers.ts, web/apple-catalog.ts, web/tauri-shim.ts, vite.listen.config.ts, src/platform.ts, src/room.ts, src/room-panel.ts, src/history-card.ts, src/media-menu.ts, src/now-playing-card.ts, src/search-card.ts, src/player.ts, src-tauri/src/apple.rs, tests/web-catalog.test.ts, tests/web-commands.test.ts, docs/integrations/ROOMS.md, docs/integrations/FRIENDS.md, docs/features/WEB-DEMO.md, ../DeetsSolutions/docs/radio.md, ../DeetsSolutions/radio/dev-token.js]
updated: 2026-10-17
---
# Rooms on the web — a friend on a Mac tunes in from deets.solutions

> **Opened 2026-10-13** from the owner's ask: "have the rooms implementation on
> DeetsSolutions be an extension of the friends listening on the app. If 2 friends on the app
> invite another friend who's on Mac, they can tune in on the website."
>
> **Status (2026-10-13): the app side is BUILT (§10); the desk test (§10.5) passed 2026-10-17 on his
> word.** The Safari steps run once the site page is live. The site page
> (part H) and the publish step are not built, and the worker change is not deployed, so no
> visitor can use it yet. Do not tell a user the app does this.
>
> **His calls, the same day (§7):** in by the room code only; the site's Radio tab is rebuilt as
> a web port of four app cards (Search, Queue, History, and Now Playing 1:1 in place of the tab's
> own) on the DeetsMusicRooms worker, with no listener management, no Match Desk and no YouTube;
> no friends on the web; the Radio tab's developer token is reused; History lists the room's
> songs; **a web visitor may start a room**, open to everyone (no guest controls panel). The old
> DeetsRadio worker goes offline after the port is live (§6.1). Those forks are closed.
>
> **§9 is the excavation (2026-10-13):** what the code takes, part by part, with the sizes and a
> build order. Its three forks are his and closed (§9.7): keep the site-shell, the name "DeetsMusic
> Rooms", phones not now.
>
> **This reopens ROOMS.md §13** ("the website is out of scope", his call, 2026-09-17). His ask of
> 2026-10-13 is the newer word. Two of §13's reasons still hold as rules here (§3): no preview
> listener and no YouTube entries. Rooms still end when their host leaves (ROOMS.md §7).

## 0. Terms

- **Room**: a DeetsMusicRooms session. One queue and one clock that several players follow. Each
  player plays the songs through its own Apple Music subscription. No audio passes (ROOMS.md).
- **Room code**: the 8-character code (`K7QM-4XHT`) that the worker makes when an app starts a
  room (ROOMS.md §6).
- **App member**: a member who listens in the installed DeetsMusic app on Windows.
- **Web member**: a member who listens in a browser tab on deets.solutions. A Mac user is the
  first case. A Windows user with no install and a Linux user are the same case.
- **The Radio tab**: deets.solutions/radio today. Web rooms on their own worker
  (`radio-api.deets.solutions`), with YouTube entries, a Match Desk and a crew panel
  (`../DeetsSolutions/docs/radio.md`).
- **The web port**: the rebuilt Radio tab. The app's own Search, Queue and History cards, built
  for the web, joined to a DeetsMusicRooms room.
- **Invite link**: `https://rooms.deets.solutions/j/<CODE>`. It exists today (FRIENDS.md §8.7.2)
  and offers **Open DeetsMusic** and **Get DeetsMusic** only.

## 1. What the owner wants, in one picture

1. Aditya and Sam are in a room on the app.
2. Aditya sends the room code (or the invite link, which carries it) to Priya, who has a Mac and
   an Apple Music subscription.
3. Priya opens deets.solutions/radio (or the link's **Listen in your browser** button), types the
   code, signs in to Apple Music in Apple's own MusicKit window, types her name, and joins.
4. She hears the same song at the same position as Aditya and Sam. She sees the room's Queue,
   searches the catalog in the Search card, and sees what played in the History card. What she may
   change is what the host gave guests (ROOMS.md §8).
5. Aditya and Sam see her in the member list, marked as on the web.
6. When the host ends the room, her page shows "The room ended" and stops.

**The other direction (his call R, §7.1).** Priya can also start a room on the website. The worker
makes the code. She sends it to Aditya, who joins from the app (Room panel › Join) or another
browser. Her room is open to everyone: every guest may play, pause, skip, seek, add and change Up
Next. There is no panel to change that on the web.

## 2. Why this is mostly parts that exist (read 2026-10-13)

| Part | State today | What the web port needs |
|---|---|---|
| The rooms worker | Live on `rooms.deets.solutions`. Keeps the clock, the queue and the sockets. | `https://deets.solutions` in `ALLOWED_ORIGINS` (`DeetsMusicRooms/src/index.js:187`), and one member field (§4). Otherwise the same protocol. |
| The follower | `src/room.ts` + follower mode in `src/player.ts`. Both are browser code: the page opens the WebSocket (`room.ts:370`) and plays through MusicKit JS. `room.ts` calls Rust once, for `friend_code` (`room.ts:343`). | The web build answers `friend_code` with "none" (no friends on the web, his call). |
| The four cards | `src/search-card.ts`, `src/qcard.ts`, `src/history-card.ts`, `src/now-playing-card.ts`. | The web build of each, on real MusicKit JS and the room in place of Rust (§5). |
| The real UI in a browser | The web demo (WEB-DEMO.md): `vite build --mode web` with a shim in place of Tauri. | A second web entry with only the four cards, and real MusicKit JS in place of the demo's fake one. |
| Starting a room | `POST /room` on the worker mints the code and the host token, and takes the guest controls set (`DeetsMusicRooms/src/room.js:102`). | The web sends all five controls as `everyone`. No worker change. |
| The Radio tab | A working browser follower: MusicKit JS full songs, autoplay handling, MusicKit's own error dialogs held back. | Its lessons carry. Its code is replaced (§6). |
| The developer token | `../DeetsSolutions/radio/dev-token.js`, origin-locked to deets.solutions, re-signed by a nightly job. | Reused as it is (his call, §7.1). |

## 3. The rules this design keeps (not forks)

Each rule below has one option left after the tests in the global fork rule. They follow.

1. **A web member must have an Apple Music subscription and sign in.** There is no preview tier.
   Reason: ROOMS.md §12 clause g holds only while no non-subscriber hears audio. The old Radio
   tab's 30-second preview listener goes with the rebuild.
2. **Each web member plays through their own MusicKit JS.** The room carries ids and a clock,
   never audio (ROOMS.md §12 clauses a, d, e).
3. **No YouTube.** It is the item that would put the room on the wrong side of clause d
   (ROOMS.md §12.2). His call too (§7.1).
4. **Catalog songs only** (ROOMS.md §5.3). The web Search card searches the catalog with the
   developer token. It never reads the web member's library.
5. **An app host's guest controls rule the web member** exactly as they rule an app guest. The
   worker already checks every command (ROOMS.md §8). The web member's Pause never greys out: under
   "Host only" it reads **Stop listening** (ROOMS.md §12.3).
6. **The member list in the app shows who is on the web**, and an app host's **Remove** works on a
   web member. The web shows no member list and no Remove (his call: no listener management).
7. **A room started on the web is open to everyone** (his call R). All five guest controls are
   `everyone`, fixed for the room's life. The web host has no Remove and no controls panel.
8. **A web host's room ends when the web host leaves**, as an app host's does (ROOMS.md §7). The
   60 s grace window holds, so a reload does not end it: the host token is kept in the tab's
   `sessionStorage`, which survives a reload and dies with the tab. Closing the tab ends the room
   60 s later. The web host's leave button says so: **End room**.
9. **A room started on the web begins empty.** The first song added from Search starts it (the
   worker's idle rule, ROOMS.md §5.5).
10. **The invite link still never looks up the room** (FRIENDS.md §8.7.2). The web port asks the
   worker's `peek` only after the visitor presses Join, under the same rate limit (ROOMS.md §11).
11. **Version gate.** The web port sends `v` like the app (ROOMS.md §5.1). A web port older than
   `minV` shows "Reload this page".

## 4. What the worker would change

The worker is **DeetsMusicRooms** (`deetsmusic-rooms` on `rooms.deets.solutions`, repo
`../DeetsMusicRooms`), the one the app's rooms use today. The old DeetsRadio worker gets no change:
it goes offline (§6.1).

- `ALLOWED_ORIGINS` (a var in `wrangler.jsonc`, read at `src/index.js:187`) gains
  `https://deets.solutions`. (The origin check is not a security layer,
  ROOMS.md §9.2. The code length and the rate limits are.)
- **One optional `client` field on `join`** (`"app"` or `"web"`), carried on the socket attachment
  and in the member view, so the app can mark a web member (§3 rule 6). Additive: an older app
  ignores it (FRIENDS.md §18.1 has the same reasoning).
- A rooms deploy drops every live room socket (ROOMS.md §17.10). The deploy is the owner's call.

## 5. The web port

- **Where:** deets.solutions/radio, in place of the old tab. The invite link's new button opens
  `deets.solutions/radio?code=<CODE>`.
- **The steps:** **Sign in with Apple Music** (`authorize()`), then the name (remembered in the
  browser), then **Join** with a code or **Start a room**. Browsers block sound until a press. The
  sign-in press counts.
- **The cards:**
  - **Search**: the app's Search card on the catalog. Its add verbs (Play Next, Add to Up Next)
    become room `add` commands, as they do for an app guest. Verbs that need a library or a
    playlist (Add to Library, ♥, Add to Playlist) are not on the web.
  - **Queue**: the app's Queue card, fed by the room's `state` messages, as an app guest's is.
  - **History**: the room's history (his call H). The worker keeps the room's last 50 songs
    (`queue.history`, ROOMS.md §5.2) and sends them in every `state`, so a late joiner sees what
    played before they came. The web card reads that list. The app's History card is not changed.
  - **Now Playing**: the app's Now Playing card 1:1, **in place of the Radio tab's own
    now-playing card** (his call T). It carries Play, Pause and Skip (Apple's clause c, ROOMS.md
    §12.1) and the **Stop listening** text, with the app's tokens. The Queue card shows the current
    song but not its buttons (`src/qcard.ts`), so this card is the one that holds them.
- **Follower values:** the app's (ROOMS.md §9.3, §18.8). The browser's MusicKit JS is the same
  library that WebView2 runs. A desk test on Safari decides whether the values carry: Safari is
  the one engine the app never uses.
- **Stats:** a web member writes nothing to our servers. Last.fm on the web is not in scope.
- **Leaving:** closing the tab leaves the room.

## 6. What the rebuild takes out of the site

- The Match Desk, the D1 match registry and the auto-resolver (`../DeetsSolutions/docs/youtube.md`).
- `radio/youtube.js` and `radio/yt-key.js`. **The YouTube key stays in the public repo's git
  history**, so the owner revokes it in the Google Cloud console when the file goes.
- The crew panel, kick, the Open / Restricted mode and the device tokens (his call: no listener
  management on the web).
- The preview listener (§3 rule 1).
- `radio/transport.js`, `radio/transport-mock.js` and the old protocol.
- `radio/dev-token.js` and its nightly job **stay** (§7.1).

### 6.1 The old DeetsRadio worker goes offline

Read 2026-10-13: the only code that calls `radio-api.deets.solutions` is the site's Radio tab
(`radio/transport.js`, `radio/index.html`). No other Deets repo calls it. After the web port is
live, it serves nothing, and an unused public endpoint is only a cost. So it goes offline, in this
order, each step the owner's call at the time:

1. The web port is live on deets.solutions/radio, and a web room and an app room have both played.
2. Export the `deets-radio-matches` D1 database (the Match Desk's registry) to a file, as a record.
   Nothing reads it after YouTube goes.
3. Delete the `deets-radio` worker, its `radio-api.deets.solutions` custom domain, its two Durable
   Object classes (`RadioRoom`, `GapLog`) and the D1 database.
4. Archive the DeetsRadio repo on GitHub, with a README line that points here.
5. Revoke the YouTube key (§6).
6. Update the site's docs (`radio.md`, `youtube.md`, HANDOFF.md, CLAUDE.md) and the sibling list
   in RELEASE.md (line 880).

## 7. The forks

### 7.1 Decided by the owner, 2026-10-13

| # | Question | His call |
|---|---|---|
| W1 | How a web member gets in | **By the room code only**: the 8-character code the worker makes when a room starts, typed or carried by the invite link. Not by a friend's name. |
| W2 | What the web side is | **Rebuild the site's Radio tab as a web port of the app's Search, Queue and History cards, for now.** No listener management on the website. No Match Desk. YouTube torn out. |
| W3 | Friends on the web | **No.** A web member is a guest with a typed name. |
| W4 | The developer token | **Reuse the Radio tab's token.** |
| T | Where Play, Pause and Skip sit | **The app's Now Playing card, 1:1, in place of the Radio tab's own card on screen.** |
| H | What the web History card lists | **The room's history** (the worker's last 50). |
| R | May a web visitor start a room? | **Yes, with less:** no guest controls panel, so the room is open to everyone. |
| — | The old DeetsRadio worker | **Goes offline** after the web port is live (§6.1). Asked by him the same day; nothing else calls it. |

**On W4, the question he asked: is the token public?** Yes. `radio/dev-token.js` is committed to
the DeetsSolutions repo, and that repo is public (checked 2026-10-13). This is by design
(`../DeetsSolutions/docs/radio.md`, "The developer token"): MusicKit JS needs the developer
token in the page, so every visitor's browser receives it anyway. The mint's token would be
public in the same way the moment a page used it. What guards it is the `origin` claim, locked to
deets.solutions, and a re-sign about every 150 days. A script can forge the `Origin` header and
spend the token's catalog quota until the next re-sign ("Known exposure" in radio.md, accepted
2026-07-14). It gives no access to any listener's account: each listener signs in with their own
Apple ID, and their user token never leaves their browser. So the reuse costs nothing in
security over the mint.

### 7.2 What his call R costs, written down

- A web host who closes the tab ends the room for everyone, 60 s later (§3 rule 8).
- The host token lives in the browser tab. Anyone with that tab open is the host.
- New web rooms count against the worker's free-tier budget, about 200 evening-long rooms a day
  on SQLite rows written (ROOMS.md §3.2). Web rooms and app rooms share it.
- An open room's code is the only guard (ROOMS.md §6, §11). A code posted in public lets anyone
  with an Apple Music subscription skip and reorder. That is the cost of "open to everyone".

The calls above have no open forks. The excavation's three are in §9.7, also closed.

## 8. Before a build

1. Re-read Apple's DPLA §3.3.6.D (ROOMS.md §12.4 says to, after a few months).
2. ~~A probe of `authorize()` and full songs from the deets.solutions origin.~~ **Not needed (his
   call, 2026-10-13):** the Radio tab already signs in and plays full songs from that origin, and
   it works today. The port builds on that. §9.3 D keeps the port in the same shape.
3. The site's `_headers` bug (the site's HANDOFF.md, 2026-09-15): a page cached four hours old
   could speak an old protocol. Fix it first, or the version gate (§3 rule 11) covers it.
4. ROOMS.md §13 gets a pointer here, and the site's HANDOFF.md replaces its 2026-09-16 "PARKED"
   entry, when he says go.

## 9. The excavation: what the code takes

> **Part:** idea · 2026-10-13. His ask: "scope out the excavation / the code for it, since we
> haven't done any web migration yet". Read from the code the same day. Nothing is built. The
> line counts are estimates for sizing, not promises.

**Terms used in this section.**
- **Web build**: `src/` built by Vite for a browser, with a shim in place of Tauri. The web demo
  is the one web build today (WEB-DEMO.md).
- **Shim**: browser code that defines the two globals `@tauri-apps/api` reads
  (`window.__TAURI_INTERNALS__`, `window.__TAURI_EVENT_PLUGIN_INTERNALS__`), so every `invoke`
  and `listen` in `src/` reaches a TypeScript handler and not Rust (WEB-DEMO.md §9.1).
- **Handler**: the shim's answer to one Tauri command. The demo answers with mock data, or with
  `null` for a command it does not know.
- **The port**: the web build of this design. Its entry is a new file, not `main.ts`.
- **Closure**: every file that a file imports, and every file those import, to the end.

### 9.1 What was measured

A scratch script followed every static import from the four cards, `room.ts` and `player.ts`
(2026-10-13). The result:

| Start file | Files in its closure | Lines | Tauri commands named |
|---|---|---|---|
| `queue.ts` | 3 | 1,349 | 0 |
| `player.ts` or `room.ts` | 76 | 24,575 | 114 |
| `qcard.ts` or `history-card.ts` | 87 | ~28,100 | 116 |
| `search-card.ts` | 92 | 30,791 | 119 |
| `now-playing-card.ts` | 101 | 33,354 | 126 |
| All six together | 105 | 34,965 | 126 |

**What this means: the four cards are not a small part of the app. They import almost all of
it.** Three hub imports cause most of it:
- `queue-rows.ts` imports `esc` from `collection-card.ts` (2,304 lines, 27 imports: pins, present,
  listeners, card-grow…). `esc` is in fact defined in `dom.ts`, and `collection-card.ts`
  only passes it on. 20 files import it by that route.
- `player.ts`, `room.ts` and `sound.ts` import each other (a cycle), so each one has the
  closure of all three.
- `now-playing-card.ts` imports AirPlay, the Press vinyl, favorites, Add to Library, the album
  color, the full player and the Last.fm listener counts.

**So the port does not copy four cards into a new small bundle.** It takes the demo's way: the
whole `src/` in the bundle, a shim under it, and a new entry that mounts only four cards. The demo
proves that the whole `src/` boots and plays in Chrome on a shim (WEB-DEMO.md §9.6). Most of the
126 commands are never called while only these four cards are mounted. The shim answers them with
`null`, as the demo does.

**Untangling the hubs is optional, and not needed for the port.** A smaller bundle loads
faster on a slow connection. Fixing the `esc` import is a 20-line change with no risk. Breaking
the player / room / sound cycle is a larger refactor. It belongs in WORKERS.md-style clean-up,
not in this build.

### 9.2 The seam that exists (the demo)

| File | What it does | The port's use |
|---|---|---|
| `demo/shim.ts` (152) | The Tauri globals, the events table, the host-page messages, the fake MusicKit hook-up, a guard that refuses cross-origin `fetch` and `WebSocket`. | Split it (§9.3 A). The port needs the globals and events. It must NOT have the fake MusicKit or the network guard: the guard is what keeps the demo off `rooms.deets.solutions`. |
| `demo/handlers.ts` (683) | One mock answer per command. | Not used. The port gets its own handlers (§9.3 C). |
| `demo/musickit.ts` (404) | The fake MusicKit. | Not used. The port uses Apple's MusicKit JS from Apple's CDN. |
| `vite.demo.config.ts` (140) | Serves `index.html` with the MusicKit script removed and `demo/boot.ts` in place of `main.ts`. | A second config for the port: keep the MusicKit script; a new entry in place of `main.ts`. |
| `scripts/demo-publish.mjs` | Builds and copies into `../DeetsSolutions/deetsmusic/demo/app/`. | A second target into `../DeetsSolutions/radio/app/`. |

### 9.3 The work, by part

**A. Split the shim** (in this repo, about 150 lines moved, no new behavior). The Tauri globals,
the callback table and the events go into a shared file (for example `web/tauri-shim.ts`). The
demo's shim imports it and adds its own fake MusicKit and network guard. The demo's shots and
its desk test must pass unchanged after the split: that is the check.

**B. The port's entry and build** (new, about 300 lines). A `web/listen.ts` entry and a
`vite.listen.config.ts`. The entry does what the four cards need from `main.ts`, and no more:
the settings store, the look (theme and skin), the hint box, the toast host, the track store,
`initPlayer`, and the room. Then it mounts the four cards in a fixed grid through their
`CardDef.mount(host)` (`src/cards.ts:61`). There are no surfaces (Mini, Midi, Max), no card
slots, no card picker, no Compass and no Settings card. Each card's `snapshot()` memory is
kept, so a reload brings the cards back as they were.

**C. A real web back end in TypeScript** (new, about 600 lines). These are the commands that the
four cards, the room and the player call while they run, and what each one becomes:

| Command | Today (Rust) | In the port |
|---|---|---|
| `apple_developer_token` | the DeetsSupport mint | the token in the site's `radio/dev-token.js` (his call W4) |
| `apple_user_token`, `apple_connection_status` | the token from the loopback sign-in | the token from MusicKit JS `authorize()` (§9.3 D) |
| `catalog_search` | `apple.rs:2279` + the provider's `search` (`apple.rs:1893`) | a TypeScript port: one call to `/v1/catalog/{storefront}/search` |
| `catalog_collection_tracks` | `apple.rs:1948` (paged) | the same calls, ported |
| `catalog_artist` | `apple.rs:2054` | the same calls, ported |
| `catalog_related` | `apple.rs:2514` | the same calls, ported |
| the normalizers | `apple.rs:1577–1770`: `artwork_from`, `track_from_catalog_song`, `album_from_catalog`, `artist_from_catalog`, `playlist_from_catalog`, `station_from_catalog` (~200 lines) | a TypeScript twin (~250 lines) |
| the storefront | `enrich::storefront`, from the user's account | `music.storefrontId` from MusicKit JS |
| `materialize_track`, `catalog_heals`, `catalog_heal_one` | write and read the SQLite cache | do nothing; no cache on the web |
| `dead_ids_cached`, `dead_ids_mark` | the dead-id list in SQLite | a list in memory for the tab |
| `friend_code` | the friend key | `null` (no friends on the web, his call W3) |
| `play_events_since` | the plays table | not called: History reads the room (§9.3 E) |
| every other command | | `null`, as the demo does |

**This breaks one convention, and the break needs a guard.** CLAUDE.md: "Front-end only ever sees
the normalized model; normalization lives in Rust." The port has a second normalizer in
TypeScript. If one side changes and the other does not, the web shows wrong data. The guard is
the one Friends uses for its friend codes (FRIENDS.md §16.3): a fixed Apple JSON sample in the
repo, a Rust test that turns it into a `Track`, and a TypeScript test (`npm test`) that must
produce the same `Track`. The pre-push check then catches a drift.

The Apple calls go through MusicKit JS's own `music.api.music(path)`, which adds both tokens.
Each web member spends their own calls. There is no shared cache, so the Apple call counter
(APPLE-CALLS.md) does not apply on the web.

**D. Sign-in** (`src/player.ts`, about 40 lines). The app never calls `authorize()`: its popup
cannot open in WebView2, so the app puts the token in by hand (`injectUserToken`,
`player.ts:324`). A browser can call `authorize()`, and should. One web branch in `initPlayer`:
configure, then `authorize()` on the visitor's press, in place of `injectUserToken`. Sign-out is
`unauthorize()`.

**The port keeps the shape the Radio tab proved (no probe, his call 2026-10-13).** In the Radio
tab, MusicKit runs in the top page, `/radio/` itself, and the site-shell puts the OTHER site pages
in a frame over it. The port does the same: its build is the `/radio/` page, not a frame inside a
host page as the demo is (WEB-DEMO.md §9.5). So `authorize()` and playback run where they already
work. The cost: the app's styles and the site's header share one page, so the port's styles are
scoped to its own root element, and the site header on that page is the site's own markup.

**E. History from the room** (`src/room.ts`, `src/history-card.ts`, about 60 lines). Two gaps:
- `room.ts` does not keep the room's history today. The worker sends `queue.history` (the last 50)
  in each `state` message, but `room.ts` does not store it. It must keep it and give it out.
- `history-card.ts` reads `play_events_since` only. It needs a second source: the room's list.
  The rows, the menus and the keys stay the same.

**F. A web flag in `src/`** (a new `src/platform.ts`, about 100 lines of changes over five files).
The demo changed no file in `src/` (WEB-DEMO.md §9). The port cannot keep that rule: rows that need
the desktop must not show at all, and CSS cannot hide a menu row that JavaScript builds (the row
stays in the keyboard order). So one flag, read in these places:
- `media-menu.ts` (the one menu builder, CONTEXT-MENUS.md §7): no Add to Library, no ♥, no Add to
  Playlist, no Pin / Unpin, no Start Station, no Add to Diary, no Song of the Day mark, no Song
  Credits (it reads the SQLite credits). Play Now, Play Next, Add to Queue, Go to Artist and the
  Copy Link rows stay.
- `now-playing-card.ts`: no AirPlay mount, no Add to Library square, no ♥, no playlist cover.
  Play, Pause and Skip, the scrub bar and the volume stay. The Press vinyl stays: it is part of the
  look.
- `search-card.ts`: no station results (a station leaves a room, ROOMS.md §10), no library side.
- `room.ts`: the `client: "web"` field on `join` (§4); `startRoom` with all five controls set to
  `everyone` (his call R); the host token kept in `sessionStorage` (§3 rule 8; today it is a
  variable in memory, `room.ts:162`).
- The Room panel's member row in the app: the "on the web" mark (§3 rule 6).

**G. The rooms worker** (`../DeetsMusicRooms`, about 20 lines). §4: the origin, and the `client`
field on the socket attachment and in the member view. One deploy, the owner's call.

**H. The site** (`../DeetsSolutions`). Out: `radio/radio.js` (2,451), `radio/apple.js` (442),
`radio/transport.js` (191), `radio/transport-mock.js` (585), `radio/youtube.js` (619),
`radio/yt-key.js`, and the radio rules in `styles/main.css` (about 313 lines) plus a few in
`chrome.css` and `skin.css`. That is about 4,900 lines out. In: `radio/index.html` as the port's own page (the site header
markup, then the port's root element; no frame around the port, §9.3 D), the site-shell code
(§9.7 S), a trimmed `radio/strings.js`, and the port's built files in `radio/app/`.
`radio/dev-token.js` and its nightly job stay. The site menu link (`index.html:91`) reads
"DeetsMusic Rooms" (§9.7 N).

**I. Publishing.** The port is published like the demo: `release:publish` on the live channel
builds it and copies it into `../DeetsSolutions/radio/app/` (WEB-DEMO.md §9.8 has the guards).
The rooms protocol version is the worker's, so a worker deploy that raises `minV` also needs a
port publish first.

**J. Tests and checks.**
- The normalizer fixture test (§9.3 C).
- A test of the command list: every command the port's closure names has a real handler or is
  on a written list of `null` answers. A new command in a shared file then fails the test, not a
  visitor's page (the demo's "a new command answers `null` until it gets a handler" gap,
  WEB-DEMO.md §9.8).
- The shots runner can drive the port with a fake MusicKit for pictures. Real playback needs a
  real browser and a real subscription.

### 9.4 What the port does not touch

The app's surfaces, the card slot engine, the Library, Home, Playlists, Settings, the Compass,
rules, Sound, AirPlay, Last.fm, Friends and the SQLite cache keep working in the app as they do
today. No Rust module changes. The Rust side gains one test: the normalizer fixture (§9.3 C).

### 9.5 Size, in one table

| Part | Where | New or changed lines (estimate) |
|---|---|---|
| A. shim split | this repo `demo/`, `web/` | ~150 moved |
| B. entry and build | this repo `web/`, a Vite config | ~300 new |
| C. web back end + normalizers | this repo `web/` | ~600 new |
| D–F. `src/` changes | `player.ts`, `room.ts`, `history-card.ts`, `media-menu.ts`, `now-playing-card.ts`, `search-card.ts`, `platform.ts` | ~200 changed |
| G. worker | `../DeetsMusicRooms` | ~20 |
| H. site | `../DeetsSolutions/radio/`, `styles/` | ~500 new (with the shell, §9.7 S), ~4,900 out |
| J. tests | `tests/`, a Rust test | ~150 new |

**Size: about 1,950 new or changed lines in three repos, and about 4,900 lines removed.**
The risk is not in the size. It is in two places: the sign-in (D), which keeps the Radio tab's
proven shape, and the second normalizer (C), which the fixture test guards.

### 9.6 Build order

1. ~~Probes.~~ Not needed (his call, 2026-10-13): the Radio tab's sign-in and playback work
   today, and the port keeps their shape (§9.3 D).
2. A: split the shim. The demo's shots pass unchanged.
3. B: the entry with the four cards on all-`null` handlers. This shows what breaks before any
   handler is real.
4. C: the catalog port and the fixture test. Search works.
5. D: sign-in. Full songs play outside a room.
6. F, then E: the web flag, then History from the room.
7. G: the worker change, deployed at his word. A web member joins an app room; an app member
   joins a web room.
8. H and I: the site page, the old Radio files out, the first publish.
9. The desk test: an app host and a Safari guest on a Mac; a web host and an app guest; a web
   host who reloads (the room stays) and who closes the tab (the room ends 60 s later).
10. §6.1: the old worker goes offline.

### 9.7 The forks the excavation found — decided by the owner, 2026-10-13

| # | Question | His call |
|---|---|---|
| S | Does the room keep playing while the visitor browses the rest of the site? | **Yes: keep the site-shell.** The old Radio tab loads the other site pages in a frame over the room page, so the room never unloads (../DeetsSolutions/docs/radio.md "The site-shell"). The port keeps that. |
| N | The name on the site | **"DeetsMusic Rooms"** on the menu link and the page. The URL stays `/radio/`, so old links work. |
| P | Phones | **Not now** ("let's not worry about it"). No phone layout, no phone probe, no phone desk test. |

What each call adds to the work:
- **S:** the dock layout (../DeetsSolutions/docs/radio.md "The site-shell": the square player over a tabbed Queue |
  Search | History column, and the bottom strip under 66rem) is rebuilt around the app's four
  cards. The port is the top page and the site's pages go in a frame over it, as in the Radio
  tab today (§9.3 D). Part H (§9.3) gains
  the shell code, about 250 more lines, so the site's new lines are about 500.
- **N:** the site menu link (`index.html:91`), the page title, `radio/strings.js`, and the site
  docs say "DeetsMusic Rooms". In this repo, the invite link page's new button says
  "Listen in your browser" and links to `/radio/`.
- **P:** a phone that opens `/radio/` gets the desktop layout as it is. Nothing is built to stop
  it or to fit it. The old tab's phone layout goes with the old files. A phone layout can come
  later as its own design.

There are no open forks.

## 10. As built (2026-10-13)

> **Part:** built · 2026-10-13. His word: "go ahead and build" (the same day). Parts A–G and J of
> §9.3 are built in this repo and in `../DeetsMusicRooms`. **Not built: H (the site page and the
> site-shell, in `../DeetsSolutions`) and I (the publish step).** The worker change is NOT
> deployed. Where this section and §9 differ, this section is the code.

### 10.1 The files

| Part | Files | What it is |
|---|---|---|
| A. the shared Tauri stand-in | `web/tauri-shim.ts` (new); `demo/shim.ts` (uses it) | `installTauri(handler)`: the two globals, the callback table, the events. The demo keeps its fake MusicKit and its network guard. |
| B. the entry and build | `web/listen.ts`, `web/app.ts`, `web/tsconfig.json`, `vite.listen.config.ts` (new); `package.json` (`listen`, `listen:build`); `.gitignore` (`dist-listen`) | `listen.ts` installs the stand-in, THEN loads `app.ts` (boot-prefetch.ts calls Rust at import time). `app.ts` starts the look, the skin layers, the hint box, the track store and the Room panel, and mounts the four cards into the page's slots. |
| C. the web back end | `web/handlers.ts`, `web/apple-catalog.ts` (new) | The catalog commands call `api.music.apple.com` with the Radio tab's token; `apple-catalog.ts` is the TypeScript twin of the Rust normalizers. |
| C. the twin's guard | `tests/fixtures/apple-catalog.json`, `tests/fixtures/apple-catalog.expected.json`, `tests/web-catalog.test.ts` (new); `src-tauri/src/apple.rs` (test `web_twin_fixture`) | Rust writes the expected file (`UPDATE_WEB_FIXTURE=1 cargo test web_twin_fixture`); both sides must match it. |
| D. sign-in | `src/player.ts` (`injectUserToken` returns at once on the web); `web/app.ts` (`signIn`) | MusicKit's own `authorize()`, fired by `deets:sign-in` from the panel's Sign in or the signed-out toast. |
| E. History from the room | `src/room.ts` (`RoomState.history`, the names of a late joiner's earlier songs); `src/history-card.ts` | The web card reads the room's last 50, newest first, with no clock column. |
| F. the web flag | `src/platform.ts` (new, `WEB_ROOMS`); `src/media-menu.ts` (`desk()`); `src/now-playing-card.ts`; `src/search-card.ts`; `src/room.ts`; `src/room-panel.ts` | §10.2. |
| G. the worker | `../DeetsMusicRooms`: `src/room.js` (the `client` field), `src/index.js` (the /j/ page's **Listen in your browser**), `wrangler.jsonc` (`ALLOWED_ORIGINS` + `https://deets.solutions`), `scripts/check.mjs` (two new checks) | 43 of 43 checks pass on a local `wrangler dev`. Not deployed: the owner's call. |
| J. the command guard | `tests/web-commands.test.ts` (new); `web/handlers.ts` (`HANDLED`, `NULL_ON_PURPOSE`) | Every `invoke("…")` in the closure of `web/app.ts` has a real answer or a written reason. |

### 10.2 What the web flag changes (and nothing else)

- **Menus** (`media-menu.ts`): `desk()` leaves out Add to Playlist, Start Station, Start a web,
  Song Credits, Add to Library, ♥, the Song of the Day mark, Pin / Unpin and Add to Diary. Play
  Now, Shuffle, Play Next, Add to Queue, Go to Artist / Album / Playlist and Copy Link stay.
- **Now Playing**: no Add to Library square, no ♥, no AirPlay square, no Last.fm badge, no
  Queue and Search summon squares (all four cards are on screen).
- **Search**: no Stations category (a station leaves a room).
- **Room**: the `join` message carries `client: "web"`; a web host's code and token are kept
  in `sessionStorage` (`deets.room.host`) and `resumeWebHost()` goes back in after a reload;
  the invite link is the worker's `/j/` page.
- **Room panel**: titled "DeetsMusic Rooms"; Apple Music › Sign in at the top while signed out;
  Start a room and Join wait for the sign-in AND a name; Start a room sends all five controls
  as `everyone`; no Friends part, no Permissions fold, no Remove, no Add friend. **In the app**
  (not only the web) a member row shows a **Web** tag for a member with `client: "web"`.

### 10.3 Decided inside his calls (for his review)

1. **The page is the app's own Max layout** with two cards beside the stage (`data-max-cards="2cols"`):
   Now Playing over the Queue on the left, Search and History beside them. The title bar holds
   the name "DeetsMusic Rooms" and the Room item only.
2. **The Room panel is the app's, with less**, not a new panel. The Apple sign-in sits in it as
   the first row, because the web has no Settings › Account.
3. **Start a room and Join wait for the Apple sign-in** as well as the name: a room you cannot
   hear is no use (§3 rule 1).
4. **A `?code=` link opens the panel with the code filled in**; the listener presses Join. It
   never joins on its own (the app's deep link asks first, too).
5. **The dev server takes 8787, else 8788**, the only two localhost ports the token's `origin`
   claim allows, and refuses to start when both are taken.
6. **The web History has no clock column**: the room keeps no play times. The day row
   (*Show the day*) has nothing to show there either.
7. **The landing page's new button** says "Listen in your browser", and its note gains one
   sentence: "On a Mac, listen in your browser."

### 10.4 Checked (2026-10-13, Claude, in Edge on this PC)

On `npm run listen` against the LIVE rooms worker (it already allows any localhost origin):
the page draws the four cards in the app's look; a catalog search returns songs, albums,
artists and playlists and no stations; the Room panel shows Sign in, the name, Start a room and
Join; a room started from the page is open to everyone and the panel has no Permissions or
Remove; two songs added through the player's own Add to Queue went into the room and the Queue
card showed them; Skip moved the first into History; a reload came back as the host of the same
room with its History; the song, album and artist menus hold only the web rows; End room
cleared the tab's host token. NOT checked: sound and the sign-in (they need an Apple ID, which
is his to type), and Safari.

Also: `npm test` (249 tests), `npx tsc --noEmit` and `-p demo` and `-p web`, `npx vite build`,
`npm run demo:build`, `npm run listen:build`, `cargo test web_twin_fixture`, `npm run docs:check`.

### 10.5 Desk test (his)

On this PC (Chrome or Edge), with `npm run listen` running:
1. Open the address it prints (`http://localhost:8787/`). Open the Room item (top right).
   Press **Sign in** and sign in to Apple Music in Apple's window. The row goes; Start a room
   and Join unlock once your name is typed.
2. Search a song, right-click it, **Play Next**. With no room yet the song plays from Search,
   with sound, in the browser.
3. **Start a room** on the page. Copy the code. In the desktop dev app (`npm run dev:app`), join
   that code. The app's member list shows your web name with a **Web** tag.
4. Play, Pause, Skip and Seek on either side: both follow. Add a song from the app; the web Queue
   shows it. A song that ends moves into the web History.
5. Reload the page: it comes back into the room as host. Close the tab: about a minute later the
   app says the room ended.
6. The other way: start a room in the app, open `http://localhost:8787/?code=<CODE>`; the panel
   opens with the code; press Join.

On a Mac (Safari): the same steps 1–4 once the site page is live (part H), against
deets.solutions.

### 10.6 Next

1. **Part H, the site** (`../DeetsSolutions`): `radio/index.html` becomes the port's page with the
   site header; the site-shell (§9.7 S) rebuilt around the four cards; "DeetsMusic Rooms" on the
   menu link; the old Radio files, YouTube and the Match Desk out (§6). A DeetsSolutions
   session picks it up from `../DeetsSolutions/docs/rooms-web.md` (opened 2026-10-14), which
   holds the page as it is today and two forks found there: how the app's look and the site's
   look share one page (they use the same token names), and his entry field.
2. **Part I, publishing**: a `listen:publish` like `demo:publish`, into `../DeetsSolutions/radio/app/`.
3. **The worker deploy** (G), his call. Until then the live worker refuses `https://deets.solutions`
   as an origin and drops the `client` field (an app then shows no Web tag).
4. §6.1, the old DeetsRadio worker goes offline.
