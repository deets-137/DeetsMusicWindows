---
status: idea
desk_test: none
sources: []
updated: 2026-10-14
---
# Ideas — not built

The docs in this folder describe features that **do not exist in DeetsMusic**. They are
design notes for possible future work. Nothing here is scheduled. Do not tell a user that
the app can do any of these things.

- [DeetsWeather.md](DeetsWeather.md) — stations and queues shaped by the local weather.
  Its premise (the own-station engine) was dropped; it needs a rethink.
- [WeatherSkin.md](WeatherSkin.md) — a skin and theme that change with the weather.
- [DeetsRecommends.md](DeetsRecommends.md) — recommendations from a music-credit graph.
- [AppleData.md](AppleData.md) — Apple Music API data the app does not call yet, by area
  (artist, album, browse, your account), for a future session.
- [LinuxPort.md](LinuxPort.md) — a Linux (and macOS) release: the DRM + AAC block on Linux,
  the Tauri CEF / castLabs ECS paths around it, and the Windows-only parts to replace.
- [MatterLights.md](MatterLights.md) — an on/off panel for Matter lights, in one process:
  native Rust vs our own TypeScript, costs, the AirPlay reuse, forks (researched 2026-09-21).
- [WorkerDeploy.md](WorkerDeploy.md) — deploy a worker (rooms, friends) without dropping live
  connections: what drops today, what exists, the paths to consider (opened 2026-09-23).
- [WORKERS.md](WORKERS.md) — workers and queues in Rust: the database thread (built
  2026-09-25), one actor per outside subsystem, one Apple call queue, and where a worker
  speeds the app up (opened 2026-09-25).

- [LastfmArtist.md](LastfmArtist.md) — an idea (2026-10-12): Last.fm's top tracks and similar
  artists on the artist view; the calls, the costs, the cache; he designs the UI.
- [SECRETS-AND-CSP.md](SECRETS-AND-CSP.md) — designed, not built (2026-09-29): a Content
  Security Policy for the webview, and DPAPI for the Apple token and the Last.fm session.
- [music-app-comp.md](music-app-comp.md) — an idea (2026-10-06): metrics and methods to
  measure DeetsMusic against the Apple Music app for Windows; symmetric OS-level tools only
  (our own `deetsmeter`: input, screen and sound on one clock; PDH counters), the scenes, the asymmetries, the forks. Since
  2026-10-10 also our own upgrades: each release against the last, from 0.25.4, with Apple's
  app as the control; the change rule, the release-check step (§11–§16).
- [ClassicSkins.md](ClassicSkins.md) — an idea (2026-10-10): Winamp classic skins (`.wsz`)
  for a small player. A skin is sprites for Winamp's fixed layout, so it needs its own window
  in that layout, not a restyled Mini; what maps, what does not, a theme-from-a-skin first
  step, the rights, the forks.
- [AtRecords.md](AtRecords.md) — an idea (2026-10-12): when Max fills the owner's ultrawide,
  Cyber gives way to a hidden sixth skin `at-records`, a record player, set by a built-in rule
  (his calls: the sixth skin, the full-size trigger; he designs the UI himself). The mechanics
  only: the Press disc, the window facts, CSS first and three.js as a second step; §9 the forks.
- [SupportArtist.md](SupportArtist.md) — an idea (2026-10-12): a "Support" link on the artist
  view to the artist's crowdfunding page, Bandcamp and official site, from MusicBrainz URL
  relationships (zero Apple calls). Kickstarter itself set aside (§2); the Apple terms read (§4);
  a probe of the owner's library before he designs the UI (§5, §6); the forks (§8).
- [SiteOceanLive.md](SiteOceanLive.md) — an idea (2026-10-13): the site's Ocean glow takes the
  color of the song playing now (the visitor's, through the extension; or the owner's, through
  Last.fm); §4 the forks.
- [whitelabel.md](whitelabel.md) — an idea (2026-10-14): DeetsMusic built under another brand
  (a Bandcamp player was the ask). The brand layer is small (the Beta overlay is the pattern,
  §2); the service layer is the real work (§3); Bandcamp has no public fan API (§4); a brand
  config as the first step (§8); the forks (§9); the planned rename to DeetsBeats and the
  Deets-head icon (§10, 2026-10-15).
- [album-notes.md](../features/album-notes.md) — an idea (2026-10-15): Apple's editorial notes in the album's
  facts box, the short note in the About cell and the full note on a click, song names as
  mentions; what Apple gives, probed live on Rrromeo (§1); his calls (§3); and a Library album's
  real artist from the library sync's `include=albums`, at no extra call (§6).
- [apple-calls.md](apple-calls.md) — an idea (2026-10-15): the ledger of every Apple call site
  (§2), a measured day (§1), five savings probed or read (§3: about 110 → 15 library calls a day
  for the owner), the Library ⟳'s silent refusal (§4), and a song's primary artist from Apple at
  no extra call (§5; his calls P1 and P2, 2026-10-15).
- [UpdatesButton.md](../features/UpdatesButton.md) — moved to features/ on 2026-10-16, when it
  was built (a Max title bar button for updates, what's new and bug reports).
- [filter-rules.md](../features/filter-rules.md) — moved to features/ on 2026-10-16, when it
  was built (the Library's Filter and Rulez Playlists: a rule that picks songs).
- [speedtest.md](speedtest.md) — an idea (2026-10-16): a race car button in the title bar and a
  panel that rates the network for music (Internet, Wi-Fi, Apple Music, Stream, AirPlay), mostly
  from signals the app already has (§1); a test file of at most 2 MB on our own worker, never stored (§2.3); §5 his calls (2026-10-16); §5.2 the probe of
  what Apple sends; §5.3 the header-only `fetch` wrap; §6 its test on every change.
- [SpotifyRooms.md](SpotifyRooms.md) — an idea (2026-10-18): Spotify users in a room through their
  own Spotify desktop app (a link opens each song; the Windows media session reads and seeks);
  no Spotify key; the Web API and librespot routes set aside (§1); the probes first (§6).
- [launch.md](launch.md) — a first draft (2026-10-18): the Product Hunt listing and the Reddit
  posts for the launch; he rewrites the words; §5 the open questions.
- [listening-time.md](../features/listening-time.md) — moved to features/ on 2026-10-19, when its
  V1 was built (the Rewind button in the Max title bar).
- [PresentationMode.md](../features/PresentationMode.md) — moved to features/ on 2026-10-13, when
  its first part was built (the stats cell grows over the card in Max).
- [WebRooms.md](../features/WebRooms.md) — moved to features/ on 2026-10-13, when its app side
  was built (the rooms web port: a friend on a Mac listens in a browser).

When one of these is built, move its doc to its area folder with
`node scripts/docs-move.mjs NAME=features` (or another area), set its status, and link it
from [HANDOFF.md](../HANDOFF.md). An idea that is dropped goes to `docs/archive/` (DOCS-ORG.md §5.3).
