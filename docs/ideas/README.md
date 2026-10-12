---
status: idea
desk_test: none
sources: []
updated: 2026-09-17
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

When one of these is built, move its doc back to `docs/` and link it from
[HANDOFF.md](../HANDOFF.md).
