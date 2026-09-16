# DeetsMusic — audio quality

> Opened 2026-09-16. Goal (user's words): the highest possible quality, AirPlay or otherwise.
> Measure first, then change. Results go in §4 as they come in.

## 1. The chain today

| Stage | What happens | Can we change it? |
|---|---|---|
| Apple's stream | MusicKit JS v3 plays AAC, 256 kbps at most, Widevine DRM. Lossless, Hi-Res and Atmos do not exist on the web player. | No. |
| MusicKit bitrate | Apple picks once at player start from Chromium's estimate (§4.1). | **Built 2026-09-16:** Settings › Playback › Stream quality, Auto / High / Low (§5). |
| App gain | `music.volume` = level × sleep-timer duck (`player.ts` §Volume). Pinned to 1 while AirPlay holds the slider. No EQ, normalization or crossfade. | Already clean. |
| Chromium | Resamples the 44.1 kHz decode to the device mix rate (often 48 kHz float) before Windows sees it. | Only by setting the device to 44.1 kHz in Windows (a whole-PC setting). |
| AirPlay capture | Loopback of the default output, asked for 44.1 kHz / 16-bit. The engine converts (`SRC_DEFAULT_QUALITY`); 8 of 8 logged connects used it, and it measures at the 16-bit ceiling (§4.2). | **Built 2026-09-16 (crate, uncommitted):** the fallback is now `resample::Sinc` + TPDF dither instead of linear. Reaches DeetsMusic with a crate `rev` bump. |
| Network | Uncompressed ALAC, 44.1 kHz / 16-bit (the realtime AirPlay stream). | No. Lossless. |

So on the AirPlay path the sound is resampled twice (44.1 → mix rate → 44.1) and cut to 16-bit once,
by code we do not control.

## 2. The tools

- **`probe fidelity`** (DeetsAirplay repo, kept permanently): plays test tones with the master volume
  muted and records the shipping capture and the raw mix side by side. It prints level, THD+N,
  residual, worst spur and IMD for each row: the ceiling, the device, the engine (what ships),
  linear, sinc, sinc + dither. `fidelity offline` needs no device. Full reference:
  `DeetsAirplay/docs/architecture.md` § Measuring audio quality.
- **`--listen N` + `fidelity js`**: the probe records while the dev app plays the same schedule
  through an `<audio>` element (`node scripts/webview-eval.mjs "<snippet>"`). This measures
  Chromium's own resample, which is the local-listening loss.
- **The live bitrate**: `node scripts/webview-eval.mjs "__music.bitrate"` in the dev app, or the
  `player:bitrate` log line (every configure, and every switch).

Rules for a run: nothing else playing (the probe stops if it hears anything), no optimization or
bench runs at the same time (the release build and the analysis load the CPU), `--release` build.

## 3. Open questions

1. ~~Does MusicKit lower the bitrate on its own?~~ Once, at player start (§4.1).
2. ~~How far is the engine from the ceiling?~~ At it (§4.2).
3. ~~How much does Chromium's resample cost locally?~~ −3.5 dB and ~−73 dBc spurs at 20 kHz (§4.3). Re-measure with the device at 44.1 kHz.
4. ~~Can DRM audio go through Web Audio?~~ Yes (§4.4).

## 4. Results

### 4.1 MusicKit's bitrate (read from `musickit.js` v3, 2026-09-16)
- `BitrateCalculator` is built once in `configure()`. It takes `configure({ bitrate })` if given,
  then reads `navigator.connection.downlink` once: ×100 > 64 → `HIGH` (256), else `STANDARD` (64).
  `configure`'s own `bitrate` option is applied after that read, so it wins.
- It never re-reads the network. A low estimate at player start keeps the session at 64 kbps.
- Each song's asset is chosen at prepare time from the current `bitrate` (flavors above it are
  filtered out). `music.bitrate = …` is a plain setter; the only effect is a
  `playbackBitrateDidChange` event that nothing inside MusicKit listens to. So a change applies from
  the next song and never reloads the one playing.

### 4.2 `probe fidelity` on the desk (2026-09-16)
Device: 48 kHz / 2 ch / 32-bit float. Shipping capture: engine conversion. One raw-loopback
discontinuity was reported; the rows match the offline run, so it did not land in a window.

| Row | THD+N, 1 kHz −1 dBFS | Worst spur, 1 kHz −60 dBFS | Level, 20 kHz | Worst spur, 20 kHz | IMD, 19+20 kHz |
|---|---|---|---|---|---|
| R ceiling | −92.7 dB | −63.9 dBc | 0.00 dB | −118.3 dBc | −127.3 dBc |
| device (raw loopback) | −157.6 dB | −155.2 dBc | 0.00 dB | −151.8 dBc | −156.3 dBc |
| **E engine (ships)** | **−92.7 dB** | **−62.7 dBc** | **−0.26 dB** | **−109.2 dBc** | **−130.3 dBc** |
| L linear (fallback) | −63.9 dB | −44.7 dBc | −5.28 dB | −5.5 dBc | −75.1 dBc |
| S sinc, rounded | −97.2 dB | −52.0 dBc | 0.00 dB | −105.9 dBc | −109.9 dBc |
| S+D sinc + TPDF | −92.7 dB | −63.8 dBc | 0.00 dB | −114.4 dBc | −126.6 dBc |

CPU: L 0.3 ms, S+D 4.6 ms per second of audio (0.5 % of one core).

**Reading.**
- The loopback itself is bit-exact (the device row equals the source made in memory).
- The engine conversion Windows does for us is already at the 16-bit ceiling: same THD+N, and it
  dithers (the −60 dBFS spur matches R). It loses 0.26 dB at 20 kHz and its spurs sit ~9 dB above
  S+D at −109 dBc. Neither is audible. **Switching the shipping path to sinc gains nothing you can hear.**
- The linear fallback is poor (aliases at −5.5 dBc on a 20 kHz tone). It never ran on this desk,
  but a PC whose engine refuses the conversion would get it. S+D is the fix for that path.
- Rounding without dither leaves a −52 dBc spur on quiet material; dither is required.

### 4.3 Chromium's own resample — `probe fidelity --listen` (2026-09-16)
The dev WebView played the schedule as a 44.1 kHz float WAV through an `<audio>` element
(MusicKit's path); the device runs at 48 kHz, so Chromium resampled it before Windows.

| Tone | Level | THD+N | Worst spur |
|---|---|---|---|
| 1 kHz −1 dBFS | 0.00 dB | −105.3 dB | −109.6 dBc |
| 15 kHz −6 dBFS | 0.00 dB | −74.5 dB | −77.9 dBc |
| 19 kHz −6 dBFS | −0.16 dB | −70.1 dB | −73.3 dBc |
| 20 kHz −6 dBFS | **−3.49 dB** | −69.2 dB | −72.5 dBc |

**Reading.** Clean through the midrange. Above ~15 kHz Chromium's resampler rolls off (−3.5 dB at
20 kHz) and leaves spurs near −73 dBc. This is the largest measured loss on the local path, and it
also sits in front of the AirPlay capture (the `E` / `S+D` rows inherit it). Audibility is small:
content up there is quiet in music and most adult hearing stops near 16–17 kHz. The one way to
remove it: set the Windows output format to 44.1 kHz (a whole-PC setting; 48 kHz sources then get
resampled instead). Not yet re-measured at 44.1 kHz.

### 4.4 DRM audio through Web Audio (2026-09-16)
Test: a `play()` hook routed MusicKit's element into `createMediaElementSource` → `AnalyserNode`
(not connected to the output, so silent), a catalog song played through the dev bridge.
Result: `mediaKeys` set (Widevine), `bitrate` 256, context running at 48 kHz, **peak 0.19, RMS 0.06**
— real signal. Chromium does not blank EME audio in Web Audio, so an in-app DSP chain (EQ,
loudness, crossfeed) is possible. Once an element is routed, its sound only reaches the speakers
through the graph: a suspended `AudioContext` means silence, which a build must handle.

## 5. Decisions and what was built (2026-09-16)

**Stream quality row** (user's picks): Settings › Playback, *Auto* / *High* / *Low*, default Auto.
Auto is ours, not Apple's launch pick: `applyStreamQuality` (player.ts) runs after every
configure, on a settings change, and on Chromium's `navigator.connection` `change` event.
Low below 0.5 Mbps, High above 1 Mbps, keep the current pick in between; no estimate → High.
Cost: one event listener, no polling, no Apple calls; the estimate is Chromium's, which runs
anyway. `player:bitrate` logs every configure and every switch (reason, choice, kbps, from,
downlink). Wired through `SETTINGS.md` §3, `RESET_GROUPS` › Playback, `agent-settings.ts`
`SPECS`, AGENT.md §Values.

**Capture fallback** (user's pick: fallback only): Windows' conversion stays the main path.
When the engine refuses 44.1 kHz / 16-bit, `capture.rs` now uses `Sinc` + `Quantizer(dither)`
instead of `Linear`. Sinc was not made the main path: no audible gain measured (§4.2).

**Desk test.**
1. Dev app, first play: the log has `player:bitrate {reason:"configure", choice:"auto", kbps:256 …}`.
2. Set Stream quality to Low during a song: the song keeps playing, no gap; one
   `player:bitrate {reason:"setting", kbps:64}` line; the next song streams at 64 kbps
   (`__music.bitrate` → 64). Set High: back to 256 from the song after.
3. Agent: `settings set streamQuality low` answers with the row; the card's pill moves.
4. Reset › Playback returns it to Auto.
5. Capture fallback: not reachable on this desk (the engine accepts). `probe fidelity` shows the
   `S+D (fallback)` row it now runs.

Next: sound processing (EQ, loudness, crossfeed) is designed in [SOUND.md](SOUND.md). Its §0 adds two
checked facts: `music.volume` acts before Web Audio, and Apple's DPLA §3.3.6.D forbids modifying MusicKit Content.
