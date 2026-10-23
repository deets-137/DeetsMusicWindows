---
status: idea
desk_test: none
sources: [docs/guide/marketing.md, docs/ops/RELEASE-NOTES.md, README.md]
updated: 2026-10-18
---
# Launch posts — Product Hunt and Reddit

> **Superseded (2026-10-23, his word):** he wrote his own launch announcements and took his own
> images. This draft is a record only.
>
> A first draft (2026-10-18), not posted. He rewrites the words himself; this is the outline
> and the facts (his note, 2026-10-18; marketing.md §1: he writes every word a stranger reads).
> §1 is the facts every post uses. §2 is Product Hunt. §3 is one Reddit post per community.
> §4 is the answers to the questions people will ask. §5 is the open questions before a post.

Every claim here is in a shipped release (up to 0.29.0, 2026-10-16). Nothing from the "do not
claim" list (marketing.md §10) is used: no Spotify, no Adaptive sound, no web rooms, no Backup,
no Skinz.

## 1. The facts every post uses

| Fact | Value |
|---|---|
| Name | DeetsMusic |
| One line | A native Apple Music player for Windows 11, with no algorithm of its own |
| Platform | Windows 11 desktop. Needs an Apple Music subscription |
| Price | Free. Open source, MIT ([GitHub](https://github.com/deets-137/DeetsMusicWindows)) |
| Download | [deets.solutions/deetsmusic](https://deets.solutions/deetsmusic/) |
| Try first | [deets.solutions/demo](https://deets.solutions/demo) — the real UI in a browser, invented tracks |
| Version | 0.29.0. Signed (Authenticode), updates itself in about 2 seconds |
| Size | About 9 MB installer (9.2 MB measured at 0.26.1; measure again before a post) |
| Stack | Tauri v2 + WebView2, Rust back end, TypeScript with no framework |
| Playback | Full songs, not previews: MusicKit JS inside WebView2 |
| Privacy | Listening history stays on the PC. Usage counts are anonymous, can be turned off (Settings › About › *Send usage counts*), and *What is sent* shows each report |

**The positioning (his words, 2026-10-01).** DeetsMusic has no algorithm. It helps you choose
what you listen to on purpose, and it values recommendations from friends. It does not hold
you: you can turn features on and off, set up automations, and make it your own.

**The highlight point (his words, unmodified, 2026-10-01):**

> companies are collecting so much data to streamline activities into mindlessness. music is a
> type of solace, an activity meant to be uniquely individual without being alone and having a
> community.

## 2. Product Hunt

Product Hunt limits the tagline to about 60 characters and the description to about 260.
Check both counts in the form on the day.

**Name:** DeetsMusic

**Tagline options** (pick one; character count in brackets):

1. Apple Music for Windows, made by a listener (45)
2. A native Apple Music player for Windows 11 (42)
3. Apple Music on Windows, with no algorithm of its own (52)

**Description** (about 250 characters):

> A free, open-source Apple Music player for Windows 11. Full songs, a 9 MB app, 30 looks, a
> keyboard bar for everything, an equalizer, AirPlay to a HomePod and listening rooms with
> friends. Your listening history stays on your PC.

**Topics:** Music, Windows, Open Source, Productivity.

**Links:** the download page, the GitHub repo, the demo.

### 2.1 The maker's first comment

> Hi Product Hunt! I'm the maker of DeetsMusic.
>
> I listen to Apple Music all day on a Windows PC, and I wanted an app that felt made for it.
> So I built one.
>
> DeetsMusic is a native Windows 11 app. It plays full songs through Apple's own MusicKit, and
> the installer is about 9 MB. It has no algorithm of its own. Apple's mixes and stations are
> there, and they are labeled as Apple's. Everything else is you and the people you choose:
> friends, listening rooms, a Song of the Day.
>
> A few things I'm proud of:
>
> - **One window, four sizes.** Drag the window from a small player to a full grid of cards.
>   Any card goes in any slot.
> - **Compass (Ctrl+Space).** Go to any album, setting or action from the keyboard. It is also
>   a calculator.
> - **30 looks.** 6 themes and 5 skins, including a turning record and a sea that moves with
>   the song.
> - **Rulez.** Make your own rules: "at night, on my headphones, use the Late night EQ".
> - **Your listening stays yours.** Rewind stats and album reviews are kept on your PC.
> - **AirPlay, Last.fm, Discord, and an MCP server**, so an AI app can play music for you.
>
> It is free and open source (MIT). You need Windows 11 and an Apple Music subscription. You
> can try the real interface in your browser first on the demo page.
>
> I read every comment. Tell me what is missing.

### 2.2 The gallery

Product Hunt shows the first picture as the thumbnail. Pictures are 1270×760. The shots that
exist today (marketing.md §11) are one look each (Moonlight × Glass).

| Order | Picture | Shot |
|---|---|---|
| 1 | Max, the whole grid of cards | `max-overview` |
| 2 | The full player, the cover as large as the window | `max-full-player` |
| 3 | Midi with Home | `midi-home` |
| 4 | Compass open | `compass-open` |
| 5 | One window in several looks | not made (from the `look-switch` clips) |
| 6 | A 30–60 s video | not made (his fork, marketing.md §1) |

## 3. Reddit

Each community has its own rules on self-promotion. Read the sidebar rules of each before a
post; some allow a post only on a set day or need a flair. Post one community at a time, a day
or more apart, and stay in the comments for the first hours. The angle changes per community;
the facts do not.

### 3.1 r/AppleMusic — the listener's angle

**Title:** I made a free Apple Music app for Windows 11

> I use Apple Music on a Windows PC, and I wanted an app that felt made for it. So I made
> DeetsMusic. It is free and open source.
>
> - Full songs through Apple's MusicKit, not previews. You sign in with your own account.
> - Your library, playlists, stations and Apple's mixes, all in one window.
> - Rewind: your own listening stats, kept on your PC.
> - Album Reviews: a note and a score for each song of an album.
> - Song of the Day, a sleep timer, an equalizer, Last.fm scrobbles.
> - AirPlay to a HomePod.
> - Listening rooms: listen together with a friend, in sync.
>
> It has no algorithm of its own. Apple's mixes and stations are labeled as Apple's, and the
> rest is what you choose.
>
> Windows 11 only, and you need an Apple Music subscription. You can try the interface in your
> browser first: [demo link]. Download: [link]. I read every comment.

### 3.2 r/Windows11 — the native-app angle

**Title:** A native Apple Music player for Windows 11 (9 MB, free, open source)

> DeetsMusic is an Apple Music player built for Windows 11.
>
> - One window, four sizes: a small player, two mid sizes and a full grid. The window size
>   picks the layout.
> - The tray icon opens a small player where you click. Media keys and the Windows media
>   controls work.
> - Ctrl+Space opens a bar that goes to any album, setting or action.
> - Day and night looks follow sunrise and sunset, set times, or Windows light / dark mode.
> - Sharp taskbar and Start icons at every display scale.
> - A signed installer of about 9 MB that updates itself in about 2 seconds.
>
> Built on Tauri and WebView2 with a Rust back end. Needs an Apple Music subscription.
> Download: [link]. Demo in the browser: [demo link].

### 3.3 r/SideProject — the maker's angle

**Title:** I built the Apple Music app I wanted on Windows

> For [N months] I have built DeetsMusic, a free Apple Music player for Windows 11.
>
> Why: [his reason, in his words].
>
> What it does: full songs through MusicKit, 30 looks (6 themes × 5 skins), a keyboard bar for
> everything, rules you make yourself ("at night, on headphones, use this EQ"), listening
> rooms with friends, and an MCP server so an AI app can drive it.
>
> What I learned: [one or two lessons — for example, holding Apple API calls low with a local
> SQLite cache, or getting Apple's DRM to play inside WebView2].
>
> It is MIT on GitHub: [link]. Feedback is welcome, the rough parts too.

### 3.4 r/rust or r/tauri — the technical angle

**Title:** DeetsMusic: an Apple Music client for Windows in Tauri v2 + Rust

> A technical write-up of an Apple Music client for Windows 11.
>
> - Full DRM playback: MusicKit JS runs inside WebView2, so the audio decodes in the browser
>   engine. Rust holds the library, the cache and the Apple API.
> - The front end only sees a normalized model. Apple's raw shapes are normalized in Rust.
> - A local SQLite cache of the library; most features make zero Apple calls. A call counter
>   and a 429 back-off guard the rest.
> - Our part of click → sound is about 10 ms; the rest is MusicKit.
> - Our own AirPlay sender in Rust, for HomePods.
> - The equalizer is a hand-written audio worklet, up to 10 parametric bands.
> - A loopback bridge with a CLI and an MCP server.
> - Velopack for updates: signed, delta packages, a restart in about 2 seconds.
> - TypeScript with no framework; every color, size and motion value is a token.
>
> Source (MIT): [GitHub link]. Questions about any part are welcome.

## 4. Answers to the questions people will ask

Short, true answers to have ready. Each one is checked against the shipped app or the README.

| Question | Answer |
|---|---|
| Is it legal / does Apple allow it? | It uses Apple's public MusicKit with a developer token, and you sign in with your own Apple Music account. [His wording; the Apple terms reading is his call — see §5.] |
| Does it play full songs? | Yes. Full songs with a subscription, through Apple's own DRM path. |
| Do I need a subscription? | Yes, an Apple Music subscription. |
| Mac or Linux? | Windows 11 only. A Linux release is an idea, not planned for a date. |
| Spotify? | No. Do not promise it (marketing.md §10). |
| What data does it collect? | Listening history stays on the PC. Anonymous usage counts with no ID and no IP; turn them off in Settings › About; *What is sent* shows each report. |
| Why not use the Apple Music app for Windows? | [His answer, in his words.] |
| How does it make money? | It does not. [Tip jar: open, see §5.] |
| Lossless or Dolby Atmos? | Do not claim it. [Check what MusicKit JS plays in WebView2 before an answer — AUDIO-QUALITY.md.] |
| Is it safe to install? | The installer is signed (Authenticode), and every update is signed; the app refuses one that is not. The source is public. |
| Where do I report a bug? | Settings › Bugs in the app, or the updates button's *Bugs and suggestions* in Max. |

## 5. Open questions before a post

- **The tip jar.** He wants one before the Reddit post (2026-10-06). Apple's "indirectly
  monetize access" clause (quoted in ROOMS.md) must be read first. His call.
- **The Apple terms answer.** The wording of the "is this allowed" answer in §4.
- **The pictures and the video.** Which looks, and whether the video is made before launch
  (marketing.md §1 has the open forks).
- **The launch order.** Product Hunt first, then Reddit, or the other way round, and on which
  days.
- **GitHub Issues and Discussions are off.** People from Reddit will look for them. Turn them
  on, or point to Settings › Bugs.
- **The download page.** Page pass 1 (DeetsSolutions `docs/deetsmusic-page-pass.md`) was not
  built on 2026-10-06; check it. The page is where every post sends people.
