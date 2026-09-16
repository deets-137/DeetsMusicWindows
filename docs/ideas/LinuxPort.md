# DeetsMusic on Linux (and macOS)

Written 2026-09-16. Not built. The user wants a stable Linux release at some point. This doc
lists what blocks it, what the research found, and the paths around it. macOS is in §6
because most of the work is shared.

**Terms (used below):**
- **Web view:** the browser engine inside the app window. Tauri uses WebView2 (Chromium) on
  Windows, WKWebView (Safari's engine) on macOS and WebKitGTK on Linux.
- **CDM:** Content Decryption Module. The part of a browser that unlocks DRM audio. Widevine
  is Google's CDM. FairPlay is Apple's. MusicKit JS needs one, or full songs do not play.
- **AAC:** the audio codec of Apple's web streams. `player.ts` asks for
  `audio/mp4; codecs="mp4a.40.2"`. The CDM only decrypts. The web view must decode AAC itself.
- **CEF:** Chromium Embedded Framework — Chromium as a library for other apps.
- **ECS:** castLabs "Electron for Content Security" — an Electron fork with Widevine.

## 1. Summary

Playback is the one hard problem. Every other Windows-only part has a known Linux
replacement (§4).

A Linux build needs a web view with **both** Widevine **and** an AAC decoder. On 2026-09-16:

| Web view | Widevine on Linux | AAC | Usable today |
|---|---|---|---|
| WebKitGTK (Tauri default) | No, in distro builds (§2.1) | Yes (GStreamer) | **No** |
| CEF, standard binaries (Tauri `feat/cef`) | Yes, downloaded at run time | **No** (§2.3) | No, not without our own CEF build |
| castLabs ECS (Electron) | Yes | Yes | **Yes** — Sidra and Cider ship on it |
| Google Chrome / Firefox | Yes | Yes | Yes, but they are browsers, not a shell for us |

## 2. The facts, checked

### 2.1 WebKitGTK has no desktop Widevine
WebKit's GStreamer ports (WebKitGTK, WPE) have EME code. The Widevine path goes through
Thunder/OpenCDM, which is built for set-top boxes. Distro WebKitGTK packages do not include it,
and Google does not give a desktop Widevine library to WebKit. **Result: Tauri's Linux web view
cannot play Apple songs.** This confirms the first estimate.

### 2.2 Tauri's Chromium runtime is not released
Tauri has a CEF runtime on the `feat/cef` branch. It is in active work: PR #15984 merged into
that branch on 2026-09-07 for Windows, macOS and Linux. It is **not in a stable Tauri
release** (the stable line is 2.10.x). One app (atrium) ships a CEF view inside Tauri on macOS
and reports ~170 MB added to the bundle and a slow first start.

### 2.3 New finding: standard CEF has no AAC
The first estimate missed this. CEF and Chromium builds turn off H.264 and AAC by default
(`proprietary_codecs=false`) because the FFmpeg decoders need a patent license. CEF issue #3559
(open since 2023) proposes decoding through the OS instead. Windows and macOS have OS decoders.
**Linux does not.** So a CEF runtime alone does not fix Linux. We would also need:
- our own CEF build with `proprietary_codecs=true ffmpeg_branding=Chrome` (a multi-hour
  Chromium build on a large machine, repeated for each CEF update), and
- an answer to the AAC patent license question for the binaries we ship.

CEF can download the Widevine CDM at run time (default since M93). On Linux the CDM loads
only after an app restart, because it must load into the zygote process at start.

**Checked later the same day (§8):** the patent block is smaller than it looks. Apple's 256 kbps
stream is AAC-LC (`mp4a.40.2`), and Red Hat's lawyers found the AAC-LC patents expired (Fedora
ships an AAC-LC decoder since 2017). Widevine through CEF's download is free for a client app
that does not bundle the CDM.

### 2.4 castLabs ECS works on Linux today
- ECS bundles Widevine and the proprietary codecs.
- castLabs lists Linux as "partial": persistent (offline) licenses do not work. Apple Music
  streams online, so this does not matter for us.
- VMP signing is enforced on Windows and macOS only. castLabs EVS signs for free after sign-up.
- **Sidra** wraps music.apple.com in ECS and ships AppImage, deb, rpm, Snap and Nix, with
  MPRIS, Wayland and X11. **Cider** also ships on Linux. So MusicKit on Linux through ECS is
  proven by other apps, not only in theory.
- Apple's web player runs on Linux in Chrome and Firefox. Both use Widevine. The web stream is
  AAC, the same as ours on Windows today, so a Linux build does not lose audio quality.

### 2.5 Tray clicks do not reach the app on Linux
Confirmed in the Tauri v2 API reference: a tray icon click event is "unsupported" on Linux,
because libappindicator only gives menu events. The icon rect is always `None`. The menu on
right-click works. Electron on Linux uses the same StatusNotifier system and has the same limit
on most desktops. **Result:** "the tray icon opens the mini player" (TRAY.md) becomes a menu
item "Open mini player" on Linux.

## 3. Paths around the playback problem

### Path A — wait for Tauri CEF, build our own CEF
Keep Tauri. Switch the Linux runtime to CEF when `feat/cef` ships. Build CEF with AAC.
- **Keeps:** all 136 Rust commands, the 169 `invoke` calls, one code base.
- **Costs:** a Chromium build pipeline, ~170 MB more per install, the AAC license question,
  a restart after the first Widevine download. The date depends on the Tauri team.
- **Also gives:** the same engine on all three systems, so the graphics measurements and the
  CDP scripts (`webview-eval`, `webview-profile`, `bench`) work everywhere.

### Path B — a Linux shell on castLabs ECS
Linux only: Electron (ECS) hosts the same `src/` front end. The Rust back end runs as a separate
process next to it.
- **Proven:** Sidra and Cider do this now.
- **Costs:** a second shell. The 35 files that import `@tauri-apps/*` go through one adapter
  (`invoke` → IPC to the Rust process; events, window and opener too). The Rust `tauri::command`
  functions need a transport that is not Tauri. The loopback bridge (`bridge.rs`) is a possible
  base. Two release pipelines. A bigger download (Electron size).
- **Risk:** the two shells drift apart over time. The adapter must be the only place that knows
  which shell runs.

### Path C — Tauri UI plus a hidden playback process
Keep Tauri + WebKitGTK for the UI. Run MusicKit in a hidden ECS or CEF process. Send commands
and state between them.
- **Not proven** by any app we found.
- **Costs:** two web engines in memory. The Sound graph (`sound.ts`, a Web Audio
  `createMediaElementSource` graph) and the perf telemetry must move into the hidden process.
  Every playback call becomes a cross-process call, which adds to click→sound.
- Not recommended. Listed so that it is not proposed again without these costs.

### Rejected
- **Drive the user's installed Chrome** (CDP or `--app` window): depends on what the user has
  installed. It cannot be a stable release.
- **Previews only on WebKitGTK:** 30-second clips are not a music player.

## 4. The other Windows-only parts (checked in the code 2026-09-16)

| Part | Where | Linux replacement | macOS replacement |
|---|---|---|---|
| Media keys + media overlay | `smtc.rs` (~190 lines) | MPRIS over D-Bus | MPNowPlayingInfoCenter + MPRemoteCommandCenter |
| Tray fallback: other apps' media + system volume | `media.rs` (~300 lines) | MPRIS client + PipeWire/Pulse volume, or drop | Drop (no public API for other apps' media) |
| Start with Windows (`reg.exe` Run key) | `settings.rs:196` | XDG autostart `.desktop` file | Login item |
| Browser shortcut keys off (WebView2 API) | `lib.rs:228` | Per runtime (CEF/Electron have their own) | Check WKWebView |
| OS version in the log (`reg.exe`) | `log.rs:260` | `/etc/os-release` | `sw_vers` |
| AirPlay: capture only our own audio | DeetsAirplay `capture.rs` (WASAPI process loopback) | PipeWire capture stream aimed at our app's node — shown working in Rust (Rivulet PR #158) | Core Audio process tap, macOS 14.2+, asks the user for permission |
| `powershell` call | `airplay.rs:417` | Rewrite | Rewrite |
| Installer, signing | NSIS + Authenticode + `nsis/hooks.nsh` | AppImage (the Tauri updater supports it), deb, Flatpak | .dmg + Developer ID + notarization |
| Deep-link sign-in | registry scheme | `.desktop` MIME handler (the plugin does it) | Info.plist scheme (the plugin does it) |
| Tray click → mini player | TRAY.md | A menu item (§2.5) | Works |

For media keys on all three systems: `souvlaki` wraps SMTC, MPRIS and MPNowPlayingInfoCenter,
but it is unmaintained (pinned to `windows` 0.44). `tauri-plugin-media` is a newer candidate,
not evaluated. Our own `smtc.rs` stays on Windows either way.

## 5. Suggested order (when the Linux work starts)

1. **Check the Tauri `feat/cef` state again.** If it is released, try Path A first.
2. **One-hour test:** a Tauri `feat/cef` build on Linux with standard CEF binaries loads MusicKit
   and plays one song. Expected result: the CDM loads, AAC fails (§2.3). This confirms or
   removes the codec block before any build pipeline work.
3. If step 2 fails as expected, decide A (build CEF with AAC) or B (ECS shell). Check the
   license questions in §7 before either one.
4. Port §4 in this order: MPRIS, autostart, log, deep link, tray menu, AppImage + updater,
   AirPlay capture last.
5. Graphics: measure each skin again on the new engine (Glass frost and Ocean scroll first).

## 6. macOS

- **Playback:** WKWebView supports FairPlay through EME on macOS. LitoMusic (archived 2023)
  shipped MusicKit JS in WKWebView on macOS 11+. So full songs probably play. **Test it
  first:** one Tauri window on a Mac that plays one song. `warmDrm` in `player.ts` asks for
  Widevine only. It fails without harm (it is inside `try`), but it should ask for
  `com.apple.fps` on macOS.
- **Estimate** if the test passes: 2–4 weeks. §4 has the list. AirPlay capture is optional,
  because macOS has AirPlay built in.
- **Needs:** a Mac or a macOS CI runner, an Apple Developer ID ($99/year) and notarization.
- **Product question:** macOS already has the Apple Music app with AirPlay, media keys and a
  mini player. DeetsMusic must offer more than that on a Mac.

## 7. Open questions

- ~~Google Widevine terms for a CEF app (Path A).~~ Answered §8.1.
- ~~AAC patent license (Path A).~~ Mostly answered §8.1: AAC-LC is clear. HE-AAC is not checked.
- ~~Can `feat/cef` use a custom CEF build?~~ Yes: `cef-rs` reads `CEF_PATH` (§8.1).
- Which codec is Apple's 64 kbps flavor (Stream quality › Low)? If it is HE-AAC
  (`mp4a.40.5`), an AAC-LC-only build must force High on Linux. Read `player:bitrate` and the
  EME log line on a Low session to find out.
- Do our Tauri plugins (single-instance, deep-link, updater, opener) run on the CEF runtime?
- Apple's MusicKit / DPLA terms say nothing about the OS. Check again at release time.
- Flatpak: does the Widevine download work inside the sandbox?

## 8. Build it ourselves on Tauri (Path A without the wait)

Asked 2026-09-16: can we hand-roll the missing parts and keep Tauri?

### 8.1 What makes it possible
- **Tauri's runtime can be swapped.** `feat/cef` is a whole runtime (`tauri-runtime-cef`) that
  we can pin as a git dependency now, the same way `deets-airplay` is pinned. Our 136 commands
  and 169 `invoke` calls do not change.
- **`cef-rs` takes our own CEF build.** It downloads the standard binaries unless `CEF_PATH`
  points at a custom build.
- **Widevine:** Google allows a CEF app to download the CDM through Chromium's component
  updater, free, with no license, when the app is a client of someone else's service. Only
  **bundling** the CDM needs a license. So we must not ship the `.so`. It downloads on first
  run, then the app restarts once (§2.3).
- **AAC:** Apple's 256 kbps stream is AAC-LC, and its patents have expired. We build CEF with the
  AAC decoder on. To keep H.264 (still patented) out, build with a small patch that turns on
  AAC only, not the whole `proprietary_codecs` set.

### 8.2 The work
Estimates for one person working with Claude. The CEF build is the part with the most unknowns.

| Step | Work | Estimate |
|---|---|---|
| 1. Pin `feat/cef`, run the app on Windows with standard CEF | Find what breaks: plugins, window code, `lib.rs:228` WebView2 call, DevTools | 3–5 days |
| 2. The one-song test on Linux with standard CEF | Confirms the AAC block (§5 step 2) | 1 day |
| 3. A CEF build with AAC-LC on | `automate-git.py` on Linux. Needs ~100 GB disk, 16 GB+ RAM, several hours per build. Not on this PC's C: drive (~96 GB free). A cloud VM or a self-hosted runner. | 1–2 weeks to the first good build |
| 4. Linux OS parts | §4 table: MPRIS, autostart, log, deep link, tray menu, AirPlay capture | 2–4 weeks (AirPlay is half) |
| 5. Package + update | AppImage + the updater, the Widevine first-run restart, a first-run message | 1 week |
| 6. Graphics + perf pass on the new engine | Each skin, the frame telemetry | 1 week |
| **Total to a Linux beta** | | **~6–10 weeks** |

**The cost that does not end:** Chromium ships security fixes about every 4 weeks. Each one
means a new CEF build (hours of machine time, plus a test), or the Linux app runs an old,
unpatched browser engine. A script and a scheduled cloud build can make it routine, but it
stays a monthly chore. The CEF binaries also add ~170 MB per install, so the Linux app is not
"lightweight" the way the Windows app is.

**Risk:** `feat/cef` is not released. Its API can change under us. Pinning a commit protects
the build, but each bump may need fixes.

### 8.3 Hand-rolling that we should not do
- **Keep WebKitGTK and play the DRM audio in our own Rust code** (load Widevine ourselves,
  decrypt, decode, play). This goes around MusicKit JS for playback, which Apple's terms do not
  allow, and it breaks Widevine's terms. Apple or Google can revoke access, and then no song
  plays for any user. It is also the same shape as a stream-ripping tool. Rejected.
- **Patch WebKitGTK to load Widevine.** Google's CDM talks to Chromium's interface only. A
  non-Chromium engine needs a Widevine agreement with Google (Firefox has one). We would also
  ship and maintain our own WebKitGTK. Rejected.

## Sources

- [Tauri PR #15984 (feat/cef)](https://github.com/tauri-apps/tauri/pull/15984) ·
  [atrium: CEF inside Tauri](https://getatrium.dev/blog/embedding-real-browser-tauri) ·
  [tauri-apps/cef-rs](https://github.com/tauri-apps/cef-rs)
- [CEF issue #3559: proprietary codecs with OS decoding](https://github.com/chromiumembedded/cef/issues/3559) ·
  [CEF: Widevine by default from M93](https://groups.google.com/g/cef-announce/c/wlcge0kBMC0) ·
  [CEF issue #3149: Widevine component updater](https://github.com/chromiumembedded/cef/issues/3149)
- [Igalia: EME on GStreamer WebKit ports (Thunder/OpenCDM)](https://blogs.igalia.com/xrcalvar/2020/09/02/serious-encrypted-media-extensions-on-gstreamer-based-webkit-ports/)
- [castLabs electron-releases](https://github.com/castlabs/electron-releases) ·
  [castLabs EVS](https://github.com/castlabs/electron-releases/wiki/EVS)
- [Sidra](https://github.com/wimpysworld/sidra) ·
  [Cider on Linux (OMG! Ubuntu)](https://www.omgubuntu.co.uk/2022/07/cider-is-an-open-source-apple-music-client-for-linux-desktops) ·
  [LitoMusic (WKWebView + WebView2)](https://github.com/lujjjh/LitoMusic)
- [Tauri tray API (Linux limits)](https://v2.tauri.app/reference/javascript/api/namespacetray/) ·
  [tray-icon issue #104](https://github.com/tauri-apps/tray-icon/issues/104)
- [Rivulet PR #158: PipeWire per-app capture](https://github.com/thoser666/Rivulet/pull/158) ·
  [Apple: Core Audio taps](https://developer.apple.com/documentation/CoreAudio/capturing-system-audio-with-core-audio-taps) ·
  [AudioCap sample](https://github.com/insidegui/AudioCap)
- [Widevine open-source license terms](https://developers.google.com/widevine/open-source/license-1) ·
  [CEF issue #1631: Widevine CDM support](https://github.com/chromiumembedded/cef/issues/1631) ·
  [Fedora: FDK-AAC licensing](https://fedoraproject.org/wiki/Licensing/FDK-AAC) ·
  [Phoronix: Fedora can offer AAC](https://www.phoronix.com/news/Fedora-FDK-AAC)
- [souvlaki](https://docs.rs/souvlaki) ·
  [tauri-plugin-media](https://crates.io/crates/tauri-plugin-media)
