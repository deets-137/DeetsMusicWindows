---
status: designed
desk_test: none
sources: [src/radio-card.ts, src/radio.ts, src/player.ts, src/qcard.ts, src/now-playing-card.ts, src/sound.ts, src-tauri/src/bridge.rs, src-tauri/src/library.rs, src-tauri/tauri.conf.json]
updated: 2026-10-13
---
# Local radio — your own stations, from Radio Browser

> **Designed 2026-10-13, not built.** His decisions are §1. The forks still open are §14,
> each with a recommendation. The probes in §13 come before any build: the API did not answer
> from this session (§13.1).

Read with [STATIONS.md](STATIONS.md) (Apple's stations and radio mode, which this joins),
[QUEUE.md](QUEUE.md) (the station row in Up Next), [SOUND.md](SOUND.md) (the Web Audio graph),
[SECRETS-AND-CSP.md](../ideas/SECRETS-AND-CSP.md) (the CSP plan) and
[LASTFM.md](../integrations/LASTFM.md).

## 0. Terms

- **Radio Browser** — radio-browser.info. A free, community directory of internet radio
  stations, with a public API on several mirror servers. No key, no sign-in.
- **Web station** — a station from Radio Browser. An **Apple station** is one from Apple Music.
- **Stream** — the audio of a web station: an endless HTTP response (MP3 or AAC), or HLS
  (a list of short audio files).
- **ICY metadata** — the song title that a station sends inside its stream, between blocks of
  audio, as `StreamTitle='Artist - Title';`. A client gets it only when it asks with the
  request header `Icy-MetaData: 1`. A browser cannot ask, so the page cannot read it.
- **The radio proxy** — a small HTTP server in Rust on `127.0.0.1`. It fetches the stream,
  takes out the ICY metadata, and gives clean audio to the page.
- **CSP** — Content Security Policy: the list of places the page can load scripts, pictures,
  audio and connections from (SECRETS-AND-CSP.md §0).

## 1. His decisions (2026-10-13)

| # | Fork | His choice |
|---|---|---|
| 1 | Location | The user types a city. United States first. Large international cities are accepted where Radio Browser has stations for them. |
| 2 | Playback path | The Rust radio proxy. "We've done all the hard work and built out this ecosystem, let's keep it going as well built and architected." The Equalizer, the AirPlay tap and the song titles all work on web stations. |
| 3 | Where it appears | A Local shelf in the Radio card, next to Apple's stations. |
| 4 | Scope | Local stations are shown first. The user can search any station in the world. |
| 5 | Station logos | Rust fetches and caches them. The CSP stays tight. |
| 6 | Song titles in History | Recorded, as radio plays. The song shows as a radio line in the queue, so it reads like the app's current station structures. |
| 7 | Last.fm | Scrobble when we know the song. When we know the song, the user can also add it to the library and use the other song verbs. |
| 8 | Station search | The search bar of the Radio card. The UI is designed when the build gets there. |

## 2. Radio Browser: what the data is

**The answer to "are we streaming random links from unknown sources?": yes, mostly.** Read
this section before the trust rules in §3.

- Any person can add a station to Radio Browser through its web page. There is no review of
  the person or the station. Many entries come from the stations themselves; many come from
  listeners who found a stream URL.
- Radio Browser's servers check each stream on a timer, from test servers in several
  countries. `lastcheckok` is `1` when most of them could connect. **The check says the URL
  answers. It does not say what the audio is, or who runs it.**
- The real stations (public radio, the big US owners, college radio) are in the list, and
  they are the ones most users will pick. Next to them are small streams, abandoned streams,
  wrong names and duplicates.
- The useful signals are `votes`, `clickcount`, `clicktrend` and `lastcheckok`. A station
  that many people play is very likely the station it says it is.

So the app treats each stream as **untrusted bytes from an unknown server** (§3), and it ranks
the list so that the stations people really play come first (§4.3).

### 2.1 The API (from docs.radio-browser.info, read 2026-10-13)

| What | How |
|---|---|
| Servers | Look up `all.api.radio-browser.info` in DNS, then call one of the names (for example `de1.api.radio-browser.info`). `/json/servers` is for a client with no DNS. |
| Search | `/json/stations/search` with `name`, `country`, `countrycode`, `state`, `language`, `tag`, `tagList`, `codec`, `bitrateMin`, `bitrateMax`, `has_geo_info`, `is_https`, `order`, `reverse`, `offset`, `limit`, `hidebroken`. |
| Order | `name`, `votes`, `codec`, `bitrate`, `lastcheckok`, `clickcount`, `clicktrend`, `random`, and others. |
| Station fields | `stationuuid`, `name`, `url_resolved` (playlists and redirects already followed), `homepage`, `favicon`, `tags`, `countrycode`, `state`, `iso_3166_2`, `language`, `codec`, `bitrate`, `hls`, `lastcheckok`, `geo_lat`, `geo_long`, `votes`, `clickcount`. |
| Rules | Send a User-Agent `DeetsMusic/<version>`. Call the click endpoint (`/json/url/<stationuuid>`) when a user starts a station; repeat clicks from one IP count once a day. |

**Not confirmed:** a search by distance (`geo_distance`). The docs show `geo_lat` and
`geo_long` as station fields only, and the server's changelog stops at 0.7.24 (2022). The
plan in §4 does not need it. **Not confirmed:** the license of the data. The docs page names
none (§13.6).

### 2.2 Cost

- No Apple calls. Radio Browser calls go from Rust, with the User-Agent.
- One search for the Local shelf, cached a day per city (station lists change slowly).
- One search per typed query, with the search field's delay (`searchField()`).
- One click call per station start.
- One logo fetch per station, cached on disk.

## 3. Trust: the rules for an unknown stream

A stream cannot run code in the app. Audio is decoded by WebView2's media stack, which also
decodes every web page's audio. The real risks are in **our** code and in **where the proxy
connects**. Each rule closes one of them.

| # | Risk | Rule |
|---|---|---|
| T1 | The proxy is told to fetch an address inside the user's network (a router page, a NAS, `localhost`). A directory URL can point anywhere. | The proxy resolves the host itself and **refuses** loopback, private (10/8, 172.16/12, 192.168/16), link-local, CGNAT and IPv6 local ranges, on the first request **and on every redirect**. |
| T2 | A redirect loop, or a redirect to another scheme. | At most 5 redirects; `http` and `https` only. |
| T3 | The URL is a web page or a large file, not a stream. | The response must be `audio/*`, `application/ogg`, an HLS playlist type, or a playlist (`.pls`, `.m3u`) that the proxy resolves once. Anything else stops with "This station did not send audio." |
| T4 | Bad ICY metadata: a huge block, broken text, HTML in the title. | The metadata block is capped by its own length byte (at most 4,080 bytes). Text is decoded as UTF-8, then Latin-1, then dropped. The page only ever inserts it with `esc()`, like every other name. |
| T5 | A station name or tag with HTML in it (the directory is open to anyone). | The same: `esc()` everywhere. The CSP (§10) is the second wall. |
| T6 | A logo that is not a picture, or is very large. | The logo fetch has the T1 and T2 rules, takes `image/*` only, at most 1 MB, and Rust re-encodes it to a small PNG before the page sees it. |
| T7 | A station that stops sending data. | A read timeout (10 s without bytes) ends the stream with a toast; no spin forever. |
| T8 | Audio that is not what the name says. | Nothing in the code can see this. The list ranks by real use (§4.3). The station's right-click menu has *Report this station*, which opens its Radio Browser page in the browser, where anyone can correct it. |

The proxy serves the page only: it listens on `127.0.0.1`, takes a one-time token in the path
(like the bridge), and serves only the stream that the app asked for.

## 4. The Local shelf: the city and the stations

### 4.1 The city

- The first time the Local shelf opens, it shows one row: *Type your city to see its
  stations*, with a field.
- The field matches a **bundled city table** (§14 F1) as you type: "Austin, TX", "Toronto,
  Canada". The table gives the country code, the state code (ISO 3166-2, for example `US-TX`)
  and the coordinates. Nothing is sent anywhere while you type.
- The United States has every place in the table. Outside the US, the table has the large
  cities only, and only the ones where Radio Browser has stations (the build checks this when
  it makes the table, §13.5).
- The city is one setting (`radioCity`). Settings › Radio has the same field, to change it.
- No IP lookup and no Windows location. The time zone guess from the look schedule
  (LOOK-SCHEDULE.md) can fill the field's first suggestion only.

### 4.2 The query

One search: `countrycode` + `state` (from `iso_3166_2`) + `hidebroken=true` +
`order=clickcount` + `reverse=true` + `limit=200`. For a city outside the US with no state
data, the query uses `countrycode` only.

### 4.3 The order

1. Stations with coordinates, by distance from the city, in rings: within 40 km first, then
   within 120 km.
2. Inside a ring, by `clickcount`, then `votes`.
3. Stations of the same state with no coordinates come after the rings, by `clickcount`.
4. Duplicates (the same name and the same `homepage`, or the same `url_resolved`) keep the one
   with the higher bitrate.

The shelf shows the first 12. *Show all* drills into the full list, like a genre drill.

### 4.4 Search

The Radio card's search bar searches **both** Apple's stations (as it does today, by name)
and Radio Browser (by `name`, and by `tag` for a genre word). The UI of the two result groups
is designed at build time (his decision 8). The query goes through `searchField()` and its
delay, so typing does not send a call per key.

## 5. Playback: the radio proxy and radio mode

### 5.1 The path

```
station URL ─▶ Rust radio proxy (127.0.0.1:<port>/<token>)
                 ├─ audio bytes ──▶ <audio> element (radio-player.ts) ──▶ sound graph ──▶ speakers / AirPlay tap
                 └─ ICY titles ───▶ Tauri event "radio:title" ──▶ player state ──▶ Now Playing, queue, History, Last.fm
```

- **Why a server, not a `*.localhost` protocol:** Tauri's custom protocols (`cover.localhost`)
  return one complete response. A live stream never completes. The bridge (`bridge.rs`) and
  the AirPlay loopback already run small loopback servers; the proxy is one more, on a port
  picked at start from a range, never one fixed port (the user's dev-server rule applies to
  all loopback ports).
- **The proxy is a Tokio task**, not a new thread (CLAUDE.md checklist 16). It gets a row in
  the thread ledger anyway, because it lives as long as a station plays.
- **HLS** (`hls=1`): the proxy fetches the playlist and the segments, and the page plays it
  through Media Source, the same way MusicKit does. ICY metadata does not exist in HLS; the
  title comes from the segment's ID3 tags when the station sends them, else there is no title.
- **CORS is not a question any more:** the audio comes from our own loopback origin, so
  `createMediaElementSource` hears it (SOUND.md).

### 5.2 Radio mode

Today radio mode is `mode = "radio"` with an Apple `Station` (player.ts `playStation`). A web
station joins the same mode:

- `Station` gets `source: "apple" | "web"`. A web station also carries `stationuuid`,
  `streamUrl`, `codec`, `bitrate`, `homepage` and the city ring it came from.
- `playStation(s)` branches once at the edge: an Apple station goes to MusicKit as today; a
  web station pauses MusicKit and starts `radio-player.ts`. Every caller (the Radio card,
  Search, Pins, the agent, the launch resume) keeps calling `playStation`.
- Stop Station, the LIVE marker, the locked Previous / Next and the hidden Repeat work as
  they do for an Apple live station (now-playing-card.ts `.np--live`).
- Volume, the duck, the sleep timer's wind-down, the Equalizer and the AirPlay tap read the
  radio element through the same graph. A web station is never sent through MusicKit.
- **Rooms:** a web station is not shared in a room in the first build (the follower would need
  the same stream at the same moment; §14 F6).

### 5.3 The queue: the radio line

The Queue card already has a station row (qcard.ts `.qrow--station`, QUEUE.md): the station
sits in Up Next as if it were one row, and its right-click menu has Stop Station. A web
station uses the same row, with its logo and its city.

His decision 6 adds the songs: each ICY title that the station sends becomes a **radio line**
in the heard trail above the station row: the song, the artist, the station's name in the
row's sub-line, and no cover (or the Apple cover when the song is matched, §6). A radio line is
not jumpable and not draggable, like the station row: a live stream cannot go back.

## 6. Knowing the song

### 6.1 From the stream title

- Split `StreamTitle` on the first ` - ` into artist and title. Many stations send exactly
  this.
- A title that does not split, or is the station's own name, an ad, a show name or empty, is
  **not a song**. A small rule list drops the common ones ("Commercial", the station name,
  text with a URL or a phone number). Unknown text shows on Now Playing as the station's
  line, but makes no radio line, no History row and no scrobble.

### 6.2 Matching to Apple

When the title splits, the app looks for the song in Apple's catalog, so that Add to Library,
♥, Start Station, Add to Playlist and the song pane work on it (his decision 7).

- One catalog search (`term = artist + title`, type songs, limit 3). A match needs the
  artist and the title to agree after the normal folding (case, accents, "feat.").
- The cost is one Apple call per song. A station plays about 15 songs an hour. When the call
  happens is §14 F2. Every match is cached by its raw title, so a song that the station plays
  again costs nothing.
- **Clause a is clear here:** a search that lets the user add a song to their own Apple
  library facilitates access to their subscription. It does not send Apple data out.

### 6.3 History, Rewind and Last.fm

- A radio song is recorded as a radio play: the raw title, the artist and title parts, the
  station, the time, the seconds heard, and the Apple id when matched. Where it is stored is
  §14 F3 (`play_events.track_id` points at a catalog or library track today).
- Rewind counts a matched radio play with the song's other plays. An unmatched one counts in
  a "Radio" line only.
- **Last.fm (his decision 7):** a split title scrobbles, matched or not, with the same 50 % /
  4 minute rule as an Apple play. The stream gives no song length, so the rule uses the
  matched song's length, or 4 minutes heard when unmatched. Last.fm's own field for radio,
  `chosenByUser=0`, is sent, because the station chose the song.

## 7. The Radio card

- A new shelf, **Local · <city>**, in the shelf list (radio-card.ts `shelf()`), with the
  movable-section rules (MOVABLE-ROWS.md) and the fold store (`deets.radio.collapsed`).
- The built-in order puts it after Live (§14 F4).
- Recents holds Apple and web stations together, newest first.
- A web station can be pinned (PINS.md), dragged to Now Playing and the Queue (DRAG-DROP.md),
  and has the station menu from `media-menu.ts`, with *Open the station's website* and
  *Report this station* as its own rows.
- The ⟳ button reads Apple's stations again and re-runs the Local query.
- No Apple Music badge on the Local shelf, and no Radio Browser or other service badge next to
  Apple's shelves (§11, clause d1). The shelf credits Radio Browser in text, in its empty
  state and in Settings › About.

## 8. Settings

| Key | Default and why |
|---|---|
| `radioCity` | none. The shelf asks, because a wrong guess shows wrong stations. |
| `radioScrobble` | on (his decision 7). Settings › Last.fm row *Scrobble radio songs*. |
| `radioMatch` | per §14 F2. |

Each key gets a spec in `agent-settings.ts`, a line in AGENT.md, a `NEW_MARKS` line, and a
row in SETTINGS-INVENTORY.md.

## 9. Station logos

Rust fetches `favicon` once (the T6 rules), stores a small PNG in the cache folder, and serves
it on a finite custom protocol, `stationlogo.localhost`, the same way as `cover.localhost`. A
station with no logo, or a failed fetch, gets the round initial thumb (the genre treatment in
radio-card.ts `genreCell`).

## 10. CSP

When the CSP of SECRETS-AND-CSP.md Part A is built, local radio adds two entries and no wide
ones:

- `media-src http://127.0.0.1:*` — the radio proxy. (A port range is allowed; a wildcard host
  is not needed.)
- `img-src http://stationlogo.localhost` — the logos.

Radio Browser, the streams and the logos are fetched by Rust, so `connect-src` gets nothing.

## 11. Terms

### 11.1 Apple (the clauses of SupportArtist.md §4.1, read against this feature)

| Clause | Verdict |
|---|---|
| a. MusicKit only to give access to the subscription | Clear, with one rule: **never send MusicKit data to Radio Browser**. "Stations like this Apple artist" or "stations for the genre playing now" would send Apple data out for another purpose. A word the user types is clear. The §6.2 match is clear (it serves the subscription). |
| b. MusicKit content only as MusicKit renders it | Clear. Web audio never goes through MusicKit; Apple audio never goes through the proxy. |
| c. No money from access to Apple Music | Clear. The app earns nothing; ads in a station's stream are the station's. |
| d1. No Apple Music lockup next to other services' badges | Clear, with the §7 badge rule. A station's own logo is not a service badge; a logo such as iHeartRadio's sits near the line. |
| e. No substitute service through Apple's services | Clear. Radio is built without them. |
| f. Personal, noncommercial use | Not changed. |

### 11.2 The stations' own terms

**Not read yet (§13.7).** Some large US owners (iHeartMedia, Audacy) may forbid playback of
their streams outside their own players. Many radio apps play these streams from directories.
That is not the same as allowed. This is his call after the read.

### 11.3 Radio Browser

The data license is not named on the docs page (§13.6). The app stores Radio Browser data in
its cache, so the license must allow that before the build.

## 12. The build checklist (CLAUDE.md › Working style), applied

- **Motion:** the city field's rows and the Local shelf's rows enter with `enterRows`.
- **Hints:** every new `title` goes in the ONBOARDING.md §1 ledger.
- **Toasts:** "Couldn't start <station>" already exists; new rows in TOASTS.md §5 for "This
  station did not send audio" and "<station> stopped sending audio".
- **Log lines:** `diag.log` the proxy's start, each redirect, each refusal (T1–T3), the stream
  end, and each title (`radio:title`), with the station id and no URL token.
- **Compass:** a web station is a station row in the bar; *Change radio city* is a verb.
- **Rules:** the `station` fact gets `source` (apple / web), so a rule can act on "while a web
  station plays" (RULES.md §19). Bring him the fork if the rule order matters.
- **Keyboard, picks, drags, memory:** the Local shelf rides the collection engine, so
  `wireListKeys`, picks and card memory come with it; the drill key is `local:<city>`.
- **Threads:** the proxy task is a row in DEBUGGING.md § Threads.
- **Tests:** the pure parts get unit tests in a small pure file (`radio-rules.ts`): the title
  split and the not-a-song rules, the ring order, the duplicate rule, the private-address test
  (Rust test).

## 13. Probes before the build

1. **Reach the API from the app.** From this session on 2026-10-13, every mirror resolved to
   one address and reset the TLS connection, from curl and from a web fetch. Try from the dev
   app's Rust client. If the service is down, the feature needs a fallback plan.
2. **The distance search:** does `/json/stations/search` take `geo_lat`, `geo_long` and
   `geo_distance` on today's server? If yes, §4.2 can use it; §4.3 stays as the order.
3. **The stream shapes in the US:** for the top 500 US stations by clicks, count the codecs,
   the HLS share, the ICY share (the `icy-metaint` header) and how many titles split on ` - `.
   This sizes §5.1 and §6.
4. **Coordinates:** what share of US stations have `geo_lat`? This decides how much the rings
   in §4.3 carry.
5. **The international cities:** which large cities have enough stations (for example 10 or
   more, `lastcheckok=1`) to be in the table.
6. **The data license** of Radio Browser (its site, the GitHub repos, or a question to the
   maintainer).
7. **The stations' terms:** iHeartMedia and Audacy terms of use, on third-party players.

Each probe script goes in `docs/ops/checks/` with a description (the archive rule).

## 14. Open forks

| # | Fork | Options | Recommendation |
|---|---|---|---|
| F1 | The city table | (A) bundled: the US Census place list plus GeoNames large cities (CC BY 4.0), filtered by §13.5, about 1–2 MB · (B) a geocoding service when the user types (sends the typed text out) | A. Nothing leaves the PC while you type. |
| F2 | When the §6.2 Apple match runs | (A) when the song starts, so ♥ and Add to Library are ready (about 15 calls an hour while a station plays) · (B) only when the user opens the song's menu or ♥ (zero calls when nobody touches it) | B. It keeps Apple calls low. History stores the raw title, and a later match fills in the Apple id. |
| F3 | Where a radio play is stored | (A) a new `radio_plays` table, joined into History and Rewind · (B) `play_events` with a `radio:` track id and the title in `context` | A. The current table assumes a real track id; the queries that read it stay safe. |
| F4 | The Local shelf's built-in place | (A) after Live · (B) first, above For You | A. A user can move it (MOVABLE-ROWS.md). |
| F5 | A web station that has no logo and no city match in search results | (A) show it with the initial thumb · (B) hide stations with `lastcheckok=0` even in search | Both: A for the thumb, and `hidebroken=true` in search as on the shelf. |
| F6 | Rooms | (A) not in the first build · (B) the room shares the station, and each member plays the live stream (no sync) | A first; B is small after, since a live stream has no position to sync. |
