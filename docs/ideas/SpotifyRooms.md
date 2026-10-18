---
status: idea
desk_test: none
sources: [src/room.ts, src-tauri/src/smtc.rs, docs/ops/checks/spotify-probe.ps1]
updated: 2026-10-18
---
# Spotify in rooms — the user's own Spotify app plays the room

> An idea (2026-10-18), not built. His ask: a room with Apple users and Spotify users, in sync.
> The Apple side is the room we have ([ROOMS.md](../integrations/ROOMS.md)). For a Spotify user,
> DeetsMusic on their PC operates **their own Spotify desktop app**, with their permission:
> it opens each room song in Spotify and keeps it in step. The worker does not change: it only
> relays room messages. **No Spotify developer key, no Web API, no reverse-engineered client.**
> The route is three probes away from a design (§6); he runs them on his PC with his Spotify app.

**Terms.**
- **The Spotify app** is Spotify's own desktop app for Windows (the Store or the installer copy).
- **A media session** is what an app registers with Windows to show in the media flyout and
  answer the media keys. Another app can read and control it through `Windows.Media.Control`
  (the *Global System Media Transport Controls* API). DeetsMusic already *publishes* one
  (`src-tauri/src/smtc.rs`); this idea *controls* Spotify's.
- **A link** is a `spotify:track:<id>` URI. Windows gives it to the Spotify app.
- **Odesli** (song.link) is a free web service that maps a song link on one service to the same
  song on others.
- **A Spotify guest** is a room member whose music comes from the Spotify app.

## 1. The three routes, and why this one

| Route | What it is | Verdict |
|---|---|---|
| The Web API from the worker | The worker holds each Spotify user's token and calls `/me/player/play` with a position | **Blocked.** A Development Mode app has 5 users, its owner needs Premium, and more quota is only for companies with 250k monthly users. Developer Policy III.5 (another service's content) and the Jam overlap. The worker must poll for position (no push), on one shared quota. PROVIDERS.md §9 has the facts. |
| librespot in DeetsMusic | A reverse-engineered Spotify client (the engine of spotify_player, ncspot, spotifyd) built into the app | **Rejected.** The best sync, but it breaks Spotify's user terms, signs in with a borrowed client ID (Spotify's own or ncspot's), and Spotify has broken it before. The risk falls on each user's account and on the signed installer. |
| **The user's own Spotify app** | DeetsMusic opens links and uses the media session | **This doc.** Official Windows API, Spotify's own link handling, the user's own account and app. Coarser sync (§4). |

A CLI does not change any row. A CLI is either a Web API remote (row 1) or a librespot player
(row 2). A Cloudflare Worker cannot run a program in any case.

## 2. The two controls

**The media session** (Windows.Media.Control), on Spotify's session:
- Read: title, artist, album, play state, timeline (position, the time the position was set,
  the song's end).
- Do: Play, Pause, Next, Previous; `TryChangePlaybackPositionAsync` asks for a seek. **Spotify
  may refuse the seek** (P3).
- The session exists only after the Spotify app has played something.

**The link.** `Start-Process spotify:track:<id>` (from Rust: `ShellExecuteW` or the opener
plugin). The Spotify app takes it. **Unknown:** does it start the song, or only show its page?
Spotify has changed this over time (P2). A link may carry a start time, `#m:ss` (P4); if Spotify
honors it, a guest who joins mid-song needs no seek.

**The song id.** A room entry carries the Apple `catalogId` and the `isrc`
(`RoomEntry` in `src/room.ts`). With no Spotify key, the app cannot search Spotify. Odesli
takes `https://music.apple.com/us/song/<catalogId>` and returns the Spotify link (P1). **Since
2026-10-18 the keyless API is closed** (§6.3); the mapping source is open.

## 3. How a room would work

1. The host plays an Apple song. The worker relays the entry, as now.
2. The Spotify guest's DeetsMusic maps the entry to a Spotify id (Odesli, kept in a cache).
3. It opens the link when the room's clock says the song starts (or `#m:ss` on a join, if P4
   passes).
4. It reads Spotify's position from the media session and compares it with the room's
   `expectedPosition` (room.ts). Past a threshold, it seeks (if P3 passes).
5. The host's Pause and Play go to the session as Pause and Play.
6. The guest's own Spotify controls are theirs. A Pause in the Spotify app pauses only them, as
   a guest's Pause does today (ROOMS.md §12.3).

What the worker carries: nothing new, unless F5 picks "the host maps once" (then one optional
field on the entry, `spotifyId`).

## 4. What it cannot do

- **Sync is coarse.** Each song starts after a link opens: an unknown delay, measured by P2.
  With no seek (P3 fails) and no start time (P4 fails), a guest is in step only from the next
  song.
- **Spotify does not know the room's queue.** When a song ends, Spotify starts its own next song
  until DeetsMusic opens the room's next one. A short wrong-song moment is possible. Opening the
  next link a little early may cut the song before it.
- **Missing songs.** Some Apple songs have no Spotify match, so that song is silent for the
  guest (F3).
- **Free accounts.** Ads stop sync. A Free account may not play a chosen song on demand. In
  practice: Premium only (F4).
- **Windows only, DeetsMusic required.** The guest runs DeetsMusic on Windows. A Spotify-only
  user has no Apple sign-in, so the app must start and join a room without one (F1).
- **The guest's own changes.** If the guest picks another song in the Spotify app, DeetsMusic
  sees the title change. What it does then is F6.

## 5. The rules

- **Spotify Developer Policy:** does not apply. No Spotify developer app exists, and no Web API
  call is made.
- **Spotify user terms:** the user's own app plays every song, on their own account. DeetsMusic
  uses an official Windows API and Spotify's own link handling. No clause read so far forbids
  this. It is still "a Jam made from outside", and Spotify's Jam is a first-party feature. Read
  the terms once more before a build.
- **Odesli:** asks for credit ("Powered by Odesli"). Read its API terms before a build.
- **Apple:** the host's side is today's room. ROOMS.md §12 read Apple's terms for rooms; a
  Spotify guest does not stream Apple content.

## 6. The probes (before any design)

Run `docs/ops/checks/spotify-probe.ps1` in **Windows PowerShell 5.1** (`powershell`, not
`pwsh`). It changes nothing and needs no app. The script's header has the steps.

```
powershell -File docs/ops/checks/spotify-probe.ps1 -Apple https://music.apple.com/us/song/<id>
powershell -File docs/ops/checks/spotify-probe.ps1 -Track <a Spotify song link>
```

### 6.1 What each probe answers

| # | Probe | Pass | If it fails |
|---|---|---|---|
| P0 | Spotify's media session: its app id and its controls | A session is found; `seek=True` is a good sign for P3 | No session: the route is closed |
| P1 | Apple link → Spotify id through Odesli | A Spotify id in under 2 s | Mapping needs another source; a cost question |
| P2 | Open a link while another song plays | The title changes **and** the state is Playing, in under 2 s; by ear, no long gap | The link only shows the page: **the route is closed** (no way to start a chosen song) |
| P3 | Seek through the session | `accepted=True`, and 1 s later within 1 s of the target | Sync only at song start; a join waits for the next song (unless P4 passes) |
| P4 | Open a link with `#m:ss` | The song starts within 5 s of the time | A join waits for the next song (unless P3 passes) |
| P5 | Position updates and drift over 10 s | Updates at least once a second; drift under 200 ms | Correction reads a stale position; wider threshold |
| P6 | Pause and Play through the session | Each in under 500 ms | Host pause lags for Spotify guests |

**The gate:** P0 and P2 must pass, and one of P3 or P4. Then this idea gets its design.

### 6.2 Results

| Date | Who | P0 | P1 | P2 | P3 | P4 | P5 | P6 | By ear |
|---|---|---|---|---|---|---|---|---|---|
| 2026-10-18 | Claude, on his PC (Spotify 'Spotify.exe', Windows 10.0.26200) | pass | **fail** | **fail** as written; **pass** with `?autoplay=true` + Play (§6.3) | pass | fail | pass, with care | pass | his: the new song started; the delay not judged |

### 6.3 What the 2026-10-18 run found

- **P0:** the session is `Spotify.exe`; seek is enabled.
- **P1:** Odesli's keyless API is closed. Every call returns `401 {"code":"PUBLIC_API_ACCESS_DEPRECATED"}`
  (a song link and an album link). The mapping needs another source or an Odesli key. This is new
  since the doc was written. Spotify's keyless oEmbed (`open.spotify.com/oembed?url=…`) gives a
  title for a known id, but it cannot search.
- **P2:** a plain `spotify:track:<id>` link changed nothing in 10 s, from this shell and from a
  WMI-started process outside the Claude package. `spotify:track:<id>?autoplay=true` loads the
  song, but leaves it paused. That link plus the session's Play gives Playing **1.36–1.42 s** after
  the open (3 runs, each from another song). `:play` and `Spotify.exe --uri=` were not reached
  (the first form worked). The probe script still opens the plain link.
- **P3:** accepted in 12 ms, and the song is at the target. It works after a P2 load too.
- **P4:** `#1:00` is ignored, with the plain form and with `?autoplay=true`. P3 covers a join.
- **P5:** Spotify sets its position about every **4.5 s** (2 updates in 10 s), but the clock is
  true (−11 ms drift over 10 s). A reader must add the time since `LastUpdatedTime`, as `Pos` in
  the script does. A raw read is up to 4.5 s stale.
- **P6:** Pause 68 ms, Play 59 ms.
- **The gate (§6.1):** P0, P2 (in the `?autoplay=true` form) and P3 pass. The open item is P1:
  how the app finds the Spotify id with no key.

## 7. The forks (his, after the probes)

- **F1 — A Spotify-only user.** (a) DeetsMusic starts with no Apple sign-in, in a "room only" mode
  *(recommended if the probes pass: otherwise only people who already pay for both can join)*;
  (b) a Spotify guest must also have Apple signed in.
- **F2 — The sync bar.** (a) Start-of-song sync is enough to ship; (b) ship only with a working
  seek or start time.
- **F3 — A song with no Spotify match.** (a) Silence and a line in the room panel ("Not on
  Spotify") *(recommended: honest, no surprise song)*; (b) Spotify plays its own next song.
- **F4 — Who may join as a Spotify guest.** (a) Anyone, with a note that Free accounts drift;
  (b) Premium only. The app cannot check Premium without the Web API, so (b) is a note, not a
  gate.
- **F5 — Who maps the song.** (a) The host's app maps it once and the entry carries `spotifyId`
  *(recommended: one Odesli call per song per room, not per guest)*; (b) each guest's app maps
  it; (c) the worker maps it.
- **F6 — The guest picks another song in Spotify.** (a) They leave sync until the next room song,
  with a line in the panel; (b) DeetsMusic pulls them back at once.

## 8. Sources

- Spotify Developer Policy: developer.spotify.com/policy (III.5; the webcasting clause).
- Spotify's February 2026 Development Mode changes: the migration guide, and TechCrunch
  2026-02-06. The 5-user cap; the owner's Premium.
- Spotify Web API changelog, March 2026: track `external_ids` (the ISRC) restored after the
  February removal. PROVIDERS.md §9 still says it is gone; that line is stale.
- librespot: the wiki's Options page (password login removed; OAuth with an allowed client ID).
- Microsoft: `Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager`.
- Odesli: odesli.co, the public API (`api.song.link/v1-alpha.1/links`).
