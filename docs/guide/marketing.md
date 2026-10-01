---
status: project
desk_test: none
sources: [docs/guide/SHOTS.md, docs/guide/shots.json, docs/guide/motion.json, docs/ops/RELEASE-NOTES.md]
updated: 2026-10-01
---
# DeetsMusic — the marketing outline (tech spec)

> **State (2026-10-01):** outline only. Claude wrote the facts. The owner directs the video and
> writes every word a stranger reads or hears (SHOTS.md §1, DOCS-ORG.md §13.2 U3). This doc is
> separate from the user guide: the guide is tasks, this is the feature list as a spec.

**Terms**
- **Spec line** — one feature: what it does, how it is built, and its numbers. No sales words.
- **Shot** — a picture or clip from the runner (SHOTS.md). The id is the shot list entry.
- **Source** — `demo` (the web build with invented tracks) or `dev` (the real app: the owner's
  library and real album art, local only, F2).
- **Shipped** — in a published installer. Every line in §2–§9 is shipped (RELEASE-NOTES.md, up
  to 0.25.2). §10 lists what is not, so no video claims it.

## 1. Direction (the owner's)

**The positioning (his words, 2026-10-01):** DeetsMusic has no algorithm. It helps you choose
what you listen to on purpose, and it values recommendations from friends. Songs of the Day and
diaries form a local web for friends to see and share, not an algorithm. The app does not hold
you: there are deep ways to customize, to turn features on and off, to set up automations, and to
make it your own.

**Apple's algorithm (his call, 2026-10-01):** the guide does not hide or attack it. It shows a
**conscious engagement** with Apple's algorithm and with large communities of millions of users:
Apple Mixes, Apple's stations, Featured Playlists and the Popular sort are labeled as Apple's,
and Playlist refresh (Daily · Weekly › a day · Off) lets you hold a list longer. DeetsMusic adds
no algorithm of its own; Home's hour shelf and New shelf are local rules you can read.

**A highlight point: music is not a data feed (his words, unmodified, 2026-10-01):**

> companies are collecting so much data to streamline activities into mindlessness. music is a
> type of solace, an activity meant to be uniquely individual without being alone and having a
> community.

The facts behind it (Claude's research, 2026-10-01). Use them as background. They are not
copy:
- Music is now a betting market. Kalshi's music markets traded about $70 million in 2025 and
  more than $400 million in 2026 by late September ([MusicResearch.com](https://musicresearch.com/music-business/kalshi-music-prediction-markets-top-400m-in-2026-volume/),
  [Billboard](https://www.billboard.com/pro/billboard-on-the-record-how-kalshi-changes-fandom/)).
  The markets bet on Spotify streams, the #1 song, Billboard charts, album sales and Grammys.
- Polymarket publishes no music total. Its "Top Spotify Artist 2025" market alone traded
  about $90 million ([Polymarket](https://polymarket.com/event/top-spotify-artist-2025-146)).
  **Combined total: PLACEHOLDER, research open (his call, 2026-10-01).** No number goes here
  until an estimate is tracked down with actual sources. Claude's unsourced guess (about half
  a billion dollars in 2026) is not used.
- The bets now move the charts. Spotify removed more than 500,000 streams from Malcolm Todd's
  "Earrings" after its rise to #1 on the US daily chart was tied to bets on Kalshi
  ([Music Business Worldwide](https://www.musicbusinessworldwide.com/spotify-slashes-streams-hit-song-after-suspicious-activity-on-prediction-market-kalshi/),
  [Rolling Stone](https://www.rollingstone.com/music/music-features/kalshi-prediction-markets-music-industry-1235535735/)).

How the shipped app answers it (facts, for the spec lines): your listening history stays on
your PC (§6); DeetsMusic adds no algorithm (§1, above); the community parts are people you
choose: Friends and listening rooms (§9), Song of the Day (§6) and the playlist web (§5).

**A bit, kept for later (his words, unmodified, 2026-10-01):**

> log a question and if we don't do it yet i'll build it for 50cents as a joke for marketing

Where it lives (his call, 2026-10-01): in the bug and issue report spaces that sit throughout
the wiki — the "Open issues for this workflow" block at the bottom of each page
(DOCS-ORG.md §13.10, `_template.md`). The words a reader sees are his to write; nothing is
drafted.

**Waits on the docket:** friends do not see picks or diaries yet (FRIENDS.md §20). The guide
tells that part of the story after it is built.

**The wiki (his calls, 2026-10-01): the workflow is the product.** The folders are confirmed,
roughly one per card or workflow: "Listen on purpose" first (no algorithm here; what is
Apple's; hold a playlist; build from people: the web and the credits; your history stays on
your PC), then Get started, Play, Find, Library, Playlists, Your listening, The look, Sound,
Make it yours, Together, Connect, Help, and a long Rulez appendix (every event, fact and
action, the 7 recipes, the 11 rule rows, a cookbook). Each page: a video that walks through
the workflow, the steps, then short FAQ-style instructions at the bottom that link to the open
issues and bugs for that workflow. The full record is DOCS-ORG.md §13.10.

The forks still open from the 2026-10-01 talk:

- Shape: one intro (about 60–90 s) and short clips per guide page, or one long walkthrough.
- Footage: the demo only, or the demo and dev shots for the desktop-only parts (§9).
- Sound: silent with captions, music, or a voice.
- Order and cut: which lines of §2–§9 go in, and in what order.

## 2. The platform

| Spec line | Numbers / facts | Shot | Source |
|---|---|---|---|
| A native Windows 11 app for Apple Music | Tauri v2 + WebView2; Rust back end; TypeScript front end with no framework | — | — |
| Full songs, not previews | MusicKit JS in WebView2, Apple's DRM path, in use since 2026-07 | — | — |
| Small installer | 8.6 MB (0.25.1) | — | — |
| Signed, and it updates itself | Authenticode signing; the built-in updater reads the release channel | — | dev |
| Few calls to Apple | A call counter and a 429 back-off (`apple_calls.rs`); a local SQLite cache of the library; most features make zero calls | — | — |
| Fast to sound | Our part of click → sound is about 10 ms; the rest is MusicKit (DEBUGGING.md) | — | — |
| A real browser demo | The real UI with invented tracks on deets.solutions/demo (WEB-DEMO.md) | — | demo |

## 3. One window, four sizes, cards

| Spec line | Numbers / facts | Shot | Source |
|---|---|---|---|
| Four surfaces from one webview | Mini 385×550, Player 405×675, Midi 495×670, Max 1100×950; the surface follows the window size | `surface-midi-to-max`, `surface-drag-grow`, `surface-drag-shrink`, `max-overview` | demo |
| Cards in slots, any card in any slot | A card registry; swap, summon and replace motion in each skin's own shape | `clip-card-swap`, `card-replace`, `max-swap` | demo |
| Grow a card over its neighbor; Fill in Max | Drag the edge bar, or Escape to collapse | `grow` | demo |
| Max: a stage column and a 2×2 card grid | A square cover and Now Playing stay fixed; the Queue takes the free height | `max-overview` | demo |
| A card comes back where you left it | Card memory: the view, the scroll, the drill | — | demo |
| Drag and drop between cards | Songs, albums and playlists drop on the Queue, Playlists and other cards | — | demo |
| A right-click menu for each media type | One menu builder for song, album, artist, playlist, station | `context-menu` | demo |
| Lists for big libraries | Windowed rows; tested on a 3,895-song library; a sort takes about 4 ms | `scroll` | demo |
| Quick settings | The cog opens a panel of squares for the common settings | `quick-panel` | demo |
| Hover hints, toasts, first-run walk | One themed hint box for every control; a sticky toast queue; Settings › Tips | `hover-hint`, `toasts` | demo |

## 4. Find and play

| Spec line | Numbers / facts | Shot | Source |
|---|---|---|---|
| Compass: go anywhere from the keyboard | Ctrl+Space; places, settings, verbs, library items; a calculator; zero Apple calls while you type | `compass-open`, `clip-compass-arrive` | demo |
| Home | Shelves: Recently Played, Recently Added, the hour's usual music, New, Pinned, Song of the Day; reorder by holding a shelf label | `midi-home` | demo |
| Library and the artist view | Round artist hero; Albums, Featured and Your Playlists shelves; Popular sort from Apple's top songs at 0 extra calls | — | demo |
| Full \| Lib | Apple's whole album or artist page in place of your songs, in the same card | — | demo |
| Search the Apple Music catalog | Songs, albums, playlists, stations; right-click queue actions | — | demo |
| Stations | Apple live, personal and genre stations; Start Station on any song or artist | — | demo |
| Queue | The Queue card is the truth and MusicKit follows it; shuffle and repeat; Play and Shuffle on any collection | `next-song`, `play` | demo |
| Pins | Pin a playlist, station, album, artist or song; each pin has its own click verb (Play, Shuffle, Open) | — | demo |
| Add to Library and ♥ | From every card a song shows in | — | demo |
| Sleep timer | A dial, chips, a wind-down of the volume, an every-day schedule | — | demo |

## 5. Playlists and discovery

| Spec line | Numbers / facts | Shot | Source |
|---|---|---|---|
| Local-first playlists | A local store; your Apple playlists mirrored read-only in the same list; export to Apple when you choose | `drill` | demo |
| Playlist covers | Letters, Mosaic or Note covers made in the app | — | demo |
| The playlist web | A playlist from one artist and the artists they work with; reach 1–3; genre filter; song and album seeds; temporary webs | — | demo |
| Writer credits | The song's writers from Apple's `composerName`, at 0 extra calls | — | demo |
| Playlist refresh | Each mirrored playlist sets how often it reads its songs again | — | demo |

## 6. Your listening, on your PC

| Spec line | Numbers / facts | Shot | Source |
|---|---|---|---|
| Rewind | Listening stats from the local play log; nothing leaves the PC | — | demo |
| Diary | An album journal: a note and a score per song and per album, any scale (/10, /5, /100 or your own) | — | demo |
| Song of the Day | Mark one song a day; a Home shelf; Rewind › Picks; optional Discord webhook post | — | demo |
| Local data for agents and you | Read-only SQL over a fresh in-memory copy of five tables | — | dev |

## 7. The look

| Spec line | Numbers / facts | Shot | Source |
|---|---|---|---|
| 30 looks | 6 themes (Lilac, Green, Sepia, Moonlight, Black & Yellow, Black & Red) × 5 skins (Vanilla, Glass, Ocean, Press, Cyber); a skin owns its shapes and its motion | `look-switch`, every motion clip × 5 skins | demo |
| Theme crossfade | A hand pick crossfades in about 500 ms | `look-switch` | demo |
| Day look and night look | Changes at sunrise and sunset for your time zone, at set times, or with Windows light / dark mode | — | demo |
| Album color | An aurora from the cover's own colors around Now Playing | `next-song` | demo |
| Press: a turning record | The cover cut into a record, its turn locked to the audio clock | `next-song` (press) | demo |
| Ocean: a sea behind the cards | A swell in three depths that heaves with the song's loudness, a glow of the album color, ripples on play and drop | `play` (ocean) | demo |
| Glass: cover wallpaper | The album cover large with the queue's next covers around it, or your own picture | — | demo |

## 8. Sound and rules

| Spec line | Numbers / facts | Shot | Source |
|---|---|---|---|
| Equalizer | Up to 10 parametric bands in a hand-written audio worklet; presets (Flat, Bass lift, Vocal, Treble lift, Late night); one preset per output | — | demo |
| Rulez (Max only) | Make your own rules: When or While, an If tree of any depth (genre, time, output, the live bass / mid / treble balance), and a Do | — | demo |
| Rules under the settings | The look schedule, sleep schedule, per-output EQ and other rows run on one rules engine | — | demo |

## 9. Outside the window (desktop only: dev shots or hand shots)

| Spec line | Numbers / facts | Shot | Source |
|---|---|---|---|
| Tray icon and tray panel | Left-click pops the app as Mini at the click; minimize to tray; Windows media keys and media session | — | dev |
| AirPlay to a HomePod | Our own Rust AirPlay sender (`deets-airplay`); DeetsMusic only, bit-exact, or all PC sound | — | dev |
| Listening rooms | Listen together; a host and guests in sync | — | dev |
| Friends | A friend code (Ed25519); see what friends play | — | dev |
| Discord Rich Presence | Your song on your Discord profile | — | dev |
| Last.fm | Scrobbles and now playing | — | dev |
| Browser extension | On YouTube or YouTube Music, finds the song on Apple Music; + adds it to your library | — | dev |
| Agent control | A `deetsmusic` CLI and an MCP server with 21 tools (search, play, queue, playlists, Diary, rules …); Settings › Connections › Agent control | — | dev |
| Bug reports in the app | Settings › Bugs sends a report with the log | — | dev |

## 10. Do not claim (not shipped, or hidden)

- Spotify: parked (PROVIDERS.md).
- Adaptive sound: hidden behind a DevTools flag since 2026-09-25 (SOUND.md §11a).
- Suggest Less: designed; no release note names it. Check before any use.
- Skinz (edit theme colors), Hop in (welcome screen), the Layout rows, a second Search card, one
  search field, the graphics fallback, usage counts: designed, not built.
- Everything in `docs/ideas/`.

## 11. Shots that exist today (0.25.1)

- `shots.json`: `midi-home`, `max-overview`, `compass-open`, `clip-compass-arrive`,
  `clip-card-swap`. One look each (Moonlight × Glass).
- `motion.json`: 24 clips × 5 skins. They were made to debug motion; each clip is one gesture,
  3–8 s, no sound.
- No shot for §6, most of §4–§5, §8, or §9. The dev-app source (SHOTS.md §10 step 4) is not
  built, so §9 has no shot path yet.
