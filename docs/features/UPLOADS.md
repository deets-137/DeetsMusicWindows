---
status: built
desk_test: open
sources: [src/library-model.ts, src/rewind.ts, src/sound.ts, src/presence.ts, src-tauri/src/upload_art.rs, src-tauri/src/apple.rs, src-tauri/src/library.rs]
updated: 2026-11-07
---
# DeetsMusic — Uploaded songs

An **upload** is a song in the user's Apple library that has no match in Apple's catalog. The user
added the file in Apple's app, and Sync Library sent it to Apple. Songs that never reach Apple do
not reach this app. An upload has no `catalogId`, and its cover sits on `*.blobstore.apple.com`.

The report that started this: "Local files not working" (post `tWWvv_5rQO-fuzPX`, 1.4.1,
2026-11-06). Three faults: no sound, an album split into single tracks, most covers blank.

## 1. What Apple sends

- **The cover** is a signed link with `X-Amz-Expires=86400`. A link dated 2026-11-04 answered
  `406`, "wrong time info", on 2026-11-06.
- **The sound** is a plain file, not a DRM stream. `musickit.js` reads `isCloudUpload`
  (`songId` is `-1`), then sets the element's `src` in `_playRawAsset`. A third-party model of the
  API names the host as `blobstore.apple.com`.
- **The format.** Old Apple text says ALAC, WAV and AIFF go up as 256 kbps AAC. No current Apple
  page confirms it.

## 2. The album key
> **Part:** built · 2026-11-06

`albumKey` (`library-model.ts`) used the album name and the cover link. An upload's link changes
with each signature, so one album fell apart. An upload now keys on the name and
`libraryAlbumId`, else the album's artist. A catalog album's key does not change. `rewind.ts` uses
the same function. A pin or a card memory made on an old upload key does not carry over.

## 3. The covers
> **Part:** built · 2026-11-06

`artwork_from` (`apple.rs`) passes each link through `upload_art::localize`, so a blobstore link
reaches neither the store nor the page. The page gets `http://cover.localhost/upload/<key>`, and a
background job saves the picture in `upload-covers/` in the app data folder. The key is a hash of
the link's path. It is not in a backup: the next sync gets it again.

**Old rows.** `reread_old_upload_covers` runs once. If the library holds a signed link, it clears
the full-pass clock, so the next sync re-reads every song. A library with no uploads pays nothing.

**Where the cover does not go.** Friends and Discord cannot reach a file on this PC, so they get no
cover: the friends worker drops an `http` link, and `bigArt` in `presence.ts` does too. AirPlay
reads the file (`link_bytes`). The Windows media overlay shows no cover for an upload: its link
is a `http://cover.localhost` address that Windows cannot reach.

**Not known.** Whether the link's path stays the same between pulls. If it does not, each weekly
pass saves a second copy, and `upload-covers/` needs a prune.

## 4. No sound
> **Part:** built · 2026-11-07 (his call A: build it, his test with a real upload before 1.4.2 is published)

**The likely cause.** With any Sound effect on, `route()` (`sound.ts`) sends the element through
Web Audio. Chromium outputs silence for a cross-origin file not requested with CORS, and MusicKit
never sets `crossOrigin`. The report's log has `sound:route`, Match loudness on, then
`sound:startLost` with `heard: false` and `src: "stream"`, while the song's clock ran to 0:16.
With every effect off the element is not routed, which fits PLAYLISTS.md §10.5.

**The fix to test.** Set `crossOrigin = "anonymous"` on the element before `src` is set, for
`*.blobstore.apple.com` only. An `OPTIONS` request to that host answered
`access-control-allow-origin: *`. A real `GET` is not tested: it needs a fresh link.

**The risk.** If the file comes back without that header, the song fails to load.

**As built (2026-11-07).** `installUploadCors` (`sound.ts`, run first in `initSound`) wraps the
media element's `src` setter and `setAttribute("src")`: a link on `*.blobstore.apple.com` gets
`crossOrigin = "anonymous"` before the link is set (`sound:uploadCors` in the log); a link to any
other host on the same element takes the attribute off again, only where the hook put it on.
A catalog song (a `blob:` link) is not touched. Not run: no upload exists in the dev library.

**What to read in the test.** `sound:uploadCors` as the upload starts; no `sound:startLost` with
`heard: false`; the song is heard. If the song does not load at all, the host did not send the
header on the real `GET`: the fallback is to turn the hook off and say so in the note.

## 5. Desk test

Needs an upload: a file Apple cannot match, added in Apple's app with Sync Library on.

1. Add two files with one album name, then sync. The Library shows one album with two songs.
2. Each song shows its cover. The picture is in `upload-covers/`.
3. Wait over 24 hours, restart, and look again. The cover is still there.
4. Play one with every Sound effect off, then with Match loudness on, then the Equalizer on (§4).
   Each time it is heard. The log has `sound:uploadCors` and no `sound:startLost` with
   `heard: false`.
5. Play a catalog song after it: it plays as before.
