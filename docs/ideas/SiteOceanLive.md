---
status: idea
desk_test: none
sources: [src-tauri/src/bridge.rs, extension/, docs/integrations/EXTENSION.md, docs/integrations/LASTFM.md, ../DeetsSolutions/docs/ui.md]
updated: 2026-10-13
---
# The site's Ocean takes the color of the song playing now

**An idea (his, 2026-10-13). Not built, not designed.** On deets.solutions, the Ocean skin's
glow from the deep takes its color from the cover of the song that is playing now, not from
today's Song of the Day. This doc holds the mechanics and the forks only.

**The terms.**
- *The site:* deets.solutions (`../DeetsSolutions`).
- *The glow:* the site's Ocean glow from the deep, `--ocean-glow-color` on `.ocean`
  (DeetsSolutions `docs/ui.md`, the Ocean ambient layer).
- *The bridge:* the app's loopback server on `127.0.0.1` (`src-tauri/src/bridge.rs`,
  EXTENSION.md).

## 1. What the site does today

`js/ocean.js` reads the newest song in `sotd/songs.json` with an `artwork_url`. It takes a 60×60
copy from mzstatic (CORS `*`), picks the most colorful dominant color, maps it with the app's
`asGlow`, and sets `--ocean-glow-color`. The result is cached in localStorage
`deets-ocean-glow` and checked at most every 20 h. The album light (neon crests) uses the same
color. There is no heave and there are no ripples, because the site has no player.

The color step already works for any mzstatic cover. The only new part is **where the cover URL
comes from**.

## 2. Whose song (fork S1, his)

- **A. The visitor's own song.** A visitor who runs DeetsMusic sees their own song's color on
  the site.
- **B. The owner's song.** Every visitor sees the color of what the owner plays now: the site
  as a live window on his listening, the same idea as Song of the Day but live.
- **C. Both:** the visitor's own song when they have one, else the owner's, else Song of the
  Day.

## 3. Where the cover comes from

### 3.1 The visitor's song: through the DeetsMusic extension

The page itself cannot ask the app. The bridge answers CORS only for a
`chrome-extension://` / `moz-extension://` origin (EXTENSION.md, decided 2026-09-09), and the
browser blocks a public page from calling a loopback address (Private Network Access). Opening
the bridge to `https://deets.solutions` would weaken a recorded trust rule for a visual, so that
option is dropped.

The extension already reads `GET /now-playing` from the bridge. A content script on
`deets.solutions` only could pass the cover URL (never the song or artist) to the page with one
`postMessage` per song change. The page then runs the color step it already has. Cost: a new
host permission in the extension (a new install prompt line), and a visitor with no extension
sees no change.

### 3.2 The owner's song: through Last.fm

The app already sends `track.updateNowPlaying` to Last.fm on each song start (LASTFM.md).
`user.getRecentTracks` for his user returns the playing track with `@attr.nowplaying` and an
image. A small route on a worker (DeetsSupport) reads it with the API key, caches it for 30 s,
and returns only the cover URL and a `playing` flag, so the site never holds the key and
Last.fm sees one call per 30 s, not one per visitor. Probe first: whether Last.fm's image for a
now-playing scrobble is the Apple cover or a Last.fm copy (a Last.fm copy may not allow CORS
reads; the worker can map it to the mzstatic URL from the app instead).

A second path skips Last.fm: the app posts its cover URL to the worker at each song change
(like Rich Presence). That is a new outlet from the app, with its own off switch.

## 4. Open forks (all his)

1. **S1: whose song** (§2).
2. **S2: the source for the owner's song:** Last.fm (no app change) or the app posting to a
   worker (a new outlet).
3. **S3: the motion:** the color crossfades on each song change (the album light already
   fades over `--ocean-neon-fade`, 1.1 s), or only on page load.
4. **S4: when nothing plays:** fall back to Song of the Day (today's behavior), or a plain sea.
5. **S5: privacy:** with B, every visitor can tell when he is listening. A switch in the app
   (or the Last.fm route's own off), and whether the site says "playing now" anywhere or only
   shows the color.
