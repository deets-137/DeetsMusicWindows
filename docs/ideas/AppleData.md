---
status: idea
desk_test: none
sources: []
updated: 2026-09-16
---
# Apple data DeetsMusic does not use yet

Collected 2026-09-16. None of these endpoints, views or attributes are called in `apple.rs`,
`enrich.rs` or `src/` on that date. **The user has ideas for each area and will bring them to
a future conversation** — start from those ideas, not from the rows below. The areas he named
first: stronger Artist shelves, Browse, album versions, and Apple calls for Home.

"Extra calls" = Apple calls a feature adds on top of what the app makes today.

## 1. Artist

| Apple data | Possible feature | Extra calls |
|---|---|---|
| views `singles`, `latest-release`, `live-albums`, `compilation-albums`, `appears-on-albums` | Artist view shelves: Singles, Latest, Live, Appears On | 0 — joins the existing `views=` fetch |
| view `similar-artists` | "Fans also like" shelf | 0 |
| views `featured-albums`, `top-music-videos`, `featured-music-videos` | videos are skipped on purpose | — |

## 2. Album and song

| Apple data | Possible feature | Extra calls |
|---|---|---|
| album views `other-versions`, `related-albums` | Other versions (deluxe, clean, anniversary) | 1 |
| album `recordLabel`, `copyright`, `upc` | a label line under the album; tap → label page (§3) | 0 |
| song `audioTraits` (lossless, hi-res-lossless, atmos, spatial) | a quality badge on Now Playing (AUDIO-QUALITY.md) | 0 |
| song `composerName` | writer credits; a seed for [DeetsRecommends.md](DeetsRecommends.md) | 0 |
| `editorialVideo` (motion artwork) | moving covers in Max — high graphics cost | 0 |
| `songs?filter[isrc]=`, `filter[equivalents]` | find a song in your storefront (imports, unavailable songs) | 1 |

## 3. Browse

| Apple data | Possible feature | Extra calls |
|---|---|---|
| `catalog/{sf}/charts` (songs, albums, playlists; `genre=`) | a Charts shelf on Home or Search | 1 |
| `catalog/{sf}/genres` | browse by genre | 1 |
| `catalog/{sf}/activities` (Workout, Focus, Party…) | mood playlists | 1 |
| `record-labels/{id}` views `latest-releases`, `top-releases` | a label page | 1 |
| `curators`, `apple-curators` (+ their playlists) | tap a curator name → all its playlists | 1 |
| `search/hints`, `search/suggestions` | type-ahead in Search | 1 per typing pause |

## 4. Your account (`/me`)

| Apple data | Possible feature | Extra calls |
|---|---|---|
| `recent/played`, `recent/played/tracks`, `history/heavy-rotation` | Home on a new install; plays from other devices | 1 |
| `recent/radio-stations` | Recent stations in Radio | 1 |
| `music-summaries` (Apple Replay by year) | Apple's own numbers in Rewind | 1 |
| `library/recently-added`, `library/search` | server-side library search | 1 |
| `library/playlist-folders` | show Apple Music folders | 1 |
| `ratings/albums`, `/playlists`, `/stations`; rating −1 | ♥ on albums and playlists, "Suggest less" | 1 per press |

## 5. MusicKit JS (player) — check that v3 has these

- `autoplayEnabled` — keep playing similar songs when the queue ends.
- Live-radio timed metadata — the song now on Apple Music 1.

## 6. Not in the public API

Lyrics text (only `hasLyrics`), full credits (producers, features as data), audio features
(energy, mood, tempo), play counts.
