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
- [DeetsOTD.md](DeetsOTD.md) — Song of the Day: the Discord journal (DeetsOTD repo + deets.solutions/sotd)
  as it stands, and the room for DeetsMusic in it. §8 = build 1 spec (picks, Discord +
  Bluesky + Mastodon outlets, the owner's journal import), ready to build (2026-09-17).
- [DeetsRecommends.md](DeetsRecommends.md) — recommendations from a music-credit graph.
- [AppleData.md](AppleData.md) — Apple Music API data the app does not call yet, by area
  (artist, album, browse, your account), for a future session.
- [LinuxPort.md](LinuxPort.md) — a Linux (and macOS) release: the DRM + AAC block on Linux,
  the Tauri CEF / castLabs ECS paths around it, and the Windows-only parts to replace.

When one of these is built, move its doc back to `docs/` and link it from
[HANDOFF.md](../HANDOFF.md).
