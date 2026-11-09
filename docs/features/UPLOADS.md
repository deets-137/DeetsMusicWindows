---
status: built
desk_test: open
sources: [src/library-model.ts, src/rewind.ts, src/sound.ts, src/presence.ts, src-tauri/src/upload_art.rs, src-tauri/src/apple.rs, src-tauri/src/library.rs]
updated: 2026-11-09
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

**The now-playing state (2026-11-09).** MusicKit can hand a playing upload Apple's signed link (377
characters, over Discord's limit of 300, seen as a refused card every 5 s). `artworkUrlOf`
(`player.ts`) replaces it with the saved cover, so no signed link reaches Discord or Friends.

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

**As run (2026-11-09, his WAV, on the dev app).** A real upload, 18 s, played from
`store-033.blobstore.apple.com` with `crossOrigin` on, so the host sends the header on the real
`GET`. The risk above did not happen. No file came back without the header, and no `sound:startLost`
was logged.

| Case | Element | Level before the effects (`__sound.inspect`, RMS) | Log |
|---|---|---|---|
| Every effect off | Not routed, plays, no error | Not read: no graph | `sound:uploadCors` |
| Match loudness on | Routed | 0.012–0.039 | `heard: true`, fresh, 35 ms |
| Equalizer on, one band | Routed | 0.014–0.035 | `heard: true`, 23 ms |
| A catalog song after it | `blob:`, `crossOrigin` removed | 0.010–0.014 | `heard: true` |
| The upload again | `crossOrigin` set again | 0.014–0.039 | `heard: true`, 29 ms |

Silence through the graph reads exactly 0. The effects were switched with `__sound.set`, not the
Settings rows. The song also played to its natural end. No listener's ear was part of this run.

## 5. Desk test

> **Part:** steps 1, 2, 4 and 5 passed 2026-11-09 (§4 as run, §6). Step 3 waits for 24 hours.

Needs an upload: a file Apple cannot match, added in Apple's app with Sync Library on.

1. Add two files with one album name, then sync. The Library shows one album with two songs.
2. Each song shows its cover. The picture is in `upload-covers/`.
3. Wait over 24 hours, restart, and look again. The cover is still there.
4. Play one with every Sound effect off, then with Match loudness on, then the Equalizer on (§4).
   Each time it is heard. The log has `sound:uploadCors` and no `sound:startLost` with
   `heard: false`.
5. Play a catalog song after it: it plays as before.

## 6. One upload after another
> **Part:** built · 2026-11-09 · `docs/ops/checks/upload-next.mjs`

Test album: 10 tagged MP3s with one cover, "Upload Test Vol. 1", in `Music\DeetsMusic Upload Test`.
`groupAlbums` makes one album of 10, with a guest artist on one song. All 10 covers load at
1024×1024 from `cover.localhost`, and no blobstore link reaches the page. Each song saves its own
copy of the cover: the 10 files are byte-identical, because each song has its own link.

**The fault.** At the end of an upload, MusicKit reports `ended` with no song for about 50 ms, then
starts the next upload by itself. `onEndedWithoutItem` (`player.ts`) repaired at the first sight of
that state, and stopped a song change that was working. The CORS hook did not cause it: with the
hook taken out for one run, the repair still fired.

| The next song | Before the fix |
|---|---|
| Not the last one MusicKit holds | `player:deadNext` re-windowed onto it: about 0.5 s of extra gap, with a warning. |
| The last one MusicKit holds (an album's last track, or one queued song) | The `windowDry` branch moved the model onto the last row, so Up Next was empty. `maybeFinishQueue`, in the same tick, took that for the end of the list. The song was lost. |

**The fix, two parts.** The stop must last: the repair waits `END_SETTLE_MS` (400 ms, about 8 times
the measured state) and acts only if MusicKit is still stopped on the same row
(`endStillHolds`, `queue-sync.ts`). While `endHealing` is set, `maybeFinishQueue` does nothing, so
a repair onto the last row cannot end the list. The second part holds for catalog songs too.

**As run (2026-11-09, dev app).** Middle of the album; the last track; a true list end (back to
the first song, paused); a queued upload after a one-song list; catalog to upload to catalog; Next
pressed during the wait; Match loudness on. The repair forced in the same tick on the last row
played that row and did not end the list. In each normal change there was no repair, no warning,
and the model and MusicKit stayed aligned. Not run: the wait before a repair on a truly stuck
song, because the app drops a dead id before the song before it ends.

**Also seen.** An agent cannot open an upload's album: `album:l.…` goes to Apple's catalog and
answers 404.
