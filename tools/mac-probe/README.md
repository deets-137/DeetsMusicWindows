# The Mac playback probe

Written 2026-11-03 on `macos-support`. It answers the first question in
[LinuxPort.md §6](../../docs/ideas/LinuxPort.md): can MusicKit JS play a **full** Apple song in
Tauri's Mac web view (WKWebView, with FairPlay DRM)? If it cannot, a Mac build on plain Tauri is
not possible, and the fallback is the castLabs ECS shell (LinuxPort.md §13.6).

It is not part of the app: its own small Tauri crate, its own `target/`, and a static page.

## Run it (on a Mac)

```
node tools/mac-probe/run.mjs
```

It needs one of these from the Windows PC first, for the developer token:
- the build key: `Documents\Deets' Secrets\deetsmusic-build-key.txt` copied to
  `~/Documents/Deets' Secrets/` on the Mac (or `DEETSMUSIC_BUILD_KEY=<path>`), or
- a MusicKit key: `apple.json` and the `.p8` in `src-tauri/secrets/` (gitignored).

The first run opens a sign-in page in your browser (`127.0.0.1:47831`, the app's own loopback
flow). The Music User Token is saved in `tools/mac-probe/.probe/` (gitignored). The first
`cargo build` takes a few minutes.

Options: `--song "term"` for another song, `--signin` to sign in again, `--keep` to leave the
window open.

## What it reports

1. **The engine, with no token:** the user agent, the origin (`tauri://localhost`), Media
   Source and AAC, and each DRM key system (`com.apple.fps*`, Widevine, ClearKey) through EME.
2. **MusicKit:** configure, the user token set the app's way (no `authorize()`), a catalog
   search, `play()` (and whether it needs a click), then the position each 5 s.
3. **The verdict:** PASS when the position passes 35 s (past the 30 s preview). FAIL names the
   cause: only a preview played, or no progress in 75 s, or an error.
4. **Web Audio (after a PASS):** the playing `<audio>` goes through `createMediaElementSource`
   into an analyser for 4 s, as `sound.ts` does. PASS means the DRM audio reaches Web Audio.
   FAIL (silence) means the EQ, the level meter, Adaptive sound and the AirPlay tap need
   another path on a Mac. The song may go quiet at this step: that is the FAIL case.

Paste the whole output into the session: the EME lines matter even on a PASS, because
`player.ts` asks for Widevine only today (`warmDrm`).

## The glass test

```
node tools/mac-probe/run.mjs --glass
```

No token needed. A transparent window with native glass placed around the web view
(`src-tauri/src/glass.rs`), driven by `page/glass.html`. It runs four scenes by itself (5 s each),
then a moving card for 6 s, then leaves the buttons:

1. **Window glass:** one `NSGlassEffectView` behind the whole page.
2. **Cards on a native wallpaper:** a native picture (`store-art/box-1x1-1080.png`), one glass
   shape per `.glass` card in an `NSGlassEffectContainerView`, the page on top.
3. **Wallpaper + window glass + cards.**
4. **Glass over the page:** a glass bar ABOVE the web view, over a striped page.
5. **Moving card:** card A slides; its glass follows with one `invoke` per frame. The log line
   gives updates per second and the round trip.

**Regular / Clear** switches the glass style. The results of 2026-11-03 are
OS-LAYER.md §2.4.
