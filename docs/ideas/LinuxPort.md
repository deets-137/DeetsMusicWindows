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
- ~~**Drive the user's installed Chrome**~~: first rejected as unstable. Reopened 2026-09-16
  after research: `vibez` ships it as its default. See §11.
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

### 8.3 How much of CEF we ship (asked 2026-09-16)
- **Only on Linux.** Windows keeps WebView2. `src-tauri/src` has no direct `Wry` type (0 hits
  on 2026-09-16), so the runtime can be a Linux-only Cargo feature. Check the plugins.
- **Keep:** `libcef.so`. It holds the engine that MusicKit and our UI need: V8 (JS), Blink,
  MSE + EME, the media pipeline with the AAC decoder, the Widevine host, networking, and GPU
  compositing. CEF does not support turning features off. GN flags such as `enable_pdf=false`
  are not supported by CEF, save little and can break each CEF update. Do not use them.
- **Drop:** debug symbols (strip; the unstripped file is ~1.2 GB, stripped ~100–200 MB), all
  locale `.pak` files except the app's languages, the sample apps and test files.
- **Maybe drop:** SwiftShader (the software GL fallback). Without it, a machine with no working
  GPU driver (a VM, a broken driver) can show a blank window. Keep it until a test says otherwise.
- **Compress:** AppImage and Flatpak compress the files. Expected download ~70–100 MB,
  installed ~150–220 MB. These are estimates. Measure them on the first real build.
- **Share:** if more Deets apps move to Tauri + CEF on Linux, one CEF copy can serve all of
  them (a Flatpak base extension, or one shared folder). The user downloads it once.

### 8.4 Hand-rolling that we should not do
- **Keep WebKitGTK and play the DRM audio in our own Rust code** (load Widevine ourselves,
  decrypt, decode, play). This goes around MusicKit JS for playback, which Apple's terms do not
  allow, and it breaks Widevine's terms. Apple or Google can revoke access, and then no song
  plays for any user. It is also the same shape as a stream-ripping tool. Rejected.
- **Patch WebKitGTK to load Widevine.** Google's CDM talks to Chromium's interface only. A
  non-Chromium engine needs a Widevine agreement with Google (Firefox has one). We would also
  ship and maintain our own WebKitGTK. Rejected.

## 9. The play chain, piece by piece (asked 2026-09-16)

What must happen between "the user presses Play" and sound, on Linux. For each piece: does
WebKitGTK (Tauri today) have it, does standard CEF have it, and can we hand-roll it.

| # | Piece | WebKitGTK | Standard CEF | Hand-roll? |
|---|---|---|---|---|
| 1 | Sign-in, tokens, Apple API calls | Yes (our code) | Yes | — |
| 2 | MusicKit JS runs (JS, fetch, workers) | Yes | Yes | — |
| 3 | EME API: `requestMediaKeySystemAccess("com.widevine.alpha")` answers yes | **No.** EME is off in distro builds, or ClearKey only | Yes | The JS surface, yes. It is only a front door for 5–7. |
| 4 | MSE: MusicKit appends encrypted fMP4 segments | Yes (GStreamer) | Yes | — |
| 5 | A Widevine **client identity**: the CDM signs a license request that Apple's server accepts | **No** | Yes (downloaded from Google) | **No.** The identity is Google's secret inside the CDM. Making one means extracting keys: that is DRM circumvention. |
| 6 | Load Google's CDM (`libwidevinecdm.so`): download it, a host adapter (the open `cdm::ContentDecryptionModule` C++ interface), a sandboxed process | **No** | Yes | The code, yes (open headers; Firefox's adapter is a model). The **permission**, no: Google allows the free component download for Chromium-based apps. A non-Chromium host needs a Widevine agreement (Firefox has one). |
| 7 | Decrypt **inside** the media engine: encrypted samples → CDM → clear samples → decoder, never visible to page JS or our Rust | **No**: needs a WebKit CDM backend + a GStreamer decryptor element, so a WebKitGTK fork | Yes | Inside a WebKit fork, yes, but it is blocked by 6. Outside the engine (clear audio in JS or Rust): **no**, it breaks both Apple's and Google's terms and is the shape of a ripping tool. |
| 8 | Decode AAC-LC | Yes (GStreamer plugin; can be bundled) | **No** | Yes: a build flag (§9.1). |
| 9 | Audio out (PipeWire / PulseAudio) | Yes | Yes | — |
| 10 | Our extras: Sound graph (`createMediaElementSource`), AirPlay capture | Unknown | Probably yes (it works on WebView2, same engine) | AirPlay: PipeWire capture (§4) |

**Result.** On WebKitGTK, pieces 3, 5, 6 and 7 are missing, and all four depend on Google's CDM.
The block is permission, not code. On CEF, only piece 8 is missing, and piece 8 is a build flag.

A zero-code fork: ask Google for a Widevine agreement for a WebKitGTK host. It costs nothing
to ask. Even with a yes, pieces 6–7 are a WebKitGTK fork in C++ that we must keep up to date.
Not recommended over §9.1.

### 9.1 Piece 8 on CEF: the smallest build
- There is no way to add AAC to a standard CEF without a build: FFmpeg is linked inside
  `libcef.so`.
- **Option 8a:** build CEF with AAC-LC turned on (a small patch, not the full
  `proprietary_codecs` set). The binary carries its own decoder. AAC-LC patents expired (§8.1).
- **Option 8b:** build CEF with `use_system_ffmpeg=true`. The decoder then comes from the
  user's system FFmpeg (distro Chromium packages do this). Our binary carries no AAC. Weak
  point: Chromium expects one FFmpeg version, and distros differ. It suits Flatpak, where the
  codecs extension gives one known FFmpeg.
- **Disk:** Chromium's docs ask for 100 GB. That includes the full git history. A
  `--no-history` checkout plus a release-only build needs an estimated 40–60 GB. Do it on a
  rented Linux VM, not this PC. The VM runs only for the build.
- **How often:** once per CEF update we take. A script makes it one command.

## 10. Could ClearKey replace Widevine? (researched 2026-09-16, not tested)

**ClearKey** (`org.w3.clearkey`) is real. It is the one key system that the W3C EME spec
requires every browser to have. It is built into Chromium's media stack (`AesDecryptor`, in
the renderer, no CDM file) and into Firefox. The spec describes it as a baseline for testing.
It is not protection: the license server sends the content key to the page as plain JSON, so
any script on the page can read the key and copy the song.

**What MusicKit does (traced in `musickit.js` v3, 2026-09-16):**
- `org.w3.clearkey` appears in exactly one place: the table `Q` in `detectEMEKeySystems()`.
  That function tries each key system and returns the names that answer (this is the
  `player:eme` clearkey line in our log). The list is stored as `availableKeySystems` on the
  environment object. **Nothing in `musickit.js` reads `availableKeySystems`** except its own
  getter. It is a capability report, not a playback path.
- Playback uses a different enum: `He = { NONE, FAIRPLAY, PLAYREADY, WIDEVINE }`. There is
  no ClearKey member.
- `findKeySystemPreference()` picks the playback key system in this order: FairPlay
  (`WebKitMediaKeys`), then legacy PlayReady (`MSMediaKeys`), then standard EME with only
  `[WIDEVINE, PLAYREADY]` (`potentialKeySystemsForAccess`, PlayReady first under a
  `prefer-playready` feature flag). If none answers, the result is `NONE`, and the key session
  logs "media-extension: No keysystem detected!".
- Apple's asset endpoints give three key URLs per song: `fairPlayKeyCertificateUrl`,
  `widevineKeyCertificateUrl` and `keyServerUrl`. There is no ClearKey URL.
- The `License` class posts the CDM's challenge to `keyServerUrl` with the developer token and
  the Music User Token. It handles FairPlay, PlayReady and Widevine messages only.
- With `NONE`, an item plays only when it needs no key: `generateAssetUrl` returns
  `previewURL` for a `Preview` item. That is the 30-second clip.

**Result: MusicKit cannot play a full song with ClearKey. This is proven in its code, not only
inferred.** A live test (hide every key system except ClearKey, play one song) is not needed.

**Evidence that Apple does not serve full songs with ClearKey:**
- Standard Electron has ClearKey and AAC built in. Sidra's docs say standard Electron
  "cannot be substituted as it lacks Widevine DRM support on Linux".
- Chromium builds without Widevine (ungoogled-chromium) still have ClearKey. Their users
  install Widevine by hand for DRM services.
- No report was found of full Apple Music songs on a browser without Widevine, PlayReady or
  FairPlay. Without them, reports show previews or errors. Previews are plain `.m4a` files with
  no DRM (Waterfox issue #838).
- The record labels license full songs to Apple only under real DRM. A key sent as plain JSON
  does not meet that.

**Apple's side:** DPLA §3.3.6.D (quoted in SOUND.md) says MusicKit Content may be played "only as
rendered by the MusicKit APIs or MusicKit JS". So if MusicKit JS itself chose ClearKey, the
terms would allow it. The choice belongs to Apple's license server, not to us. We found no
Apple statement about ClearKey.

**Other people's attempts:** `vibez` (a Linux Apple Music client) drives an installed Chrome by
default. Its open PR #138 loads Google's Widevine CDM in-process and decrypts outside a browser.
That is the §8.4 shape we rejected (outside MusicKit JS, against both companies' terms). No one
was found who uses ClearKey.

**Conclusion:** ClearKey gives previews only. The code trace above settles it.

### 10.1 Our own DRM? (asked 2026-09-16)
How DRM on Apple's songs works:
1. **Apple** encrypts each song once, on its servers, with a content key (CENC, AES). Apple
   keeps the keys.
2. **Apple** runs the license server (`keyServerUrl`).
3. At play time, the CDM on the user's machine (Widevine, FairPlay or PlayReady) makes a
   request signed with its maker's device certificate.
4. Apple's server checks that signature. Only if it trusts that DRM system does it send the
   content key, encrypted so that only that CDM can read it.
5. The CDM decrypts inside the media engine.

Widevine does not add DRM to Apple's songs. Apple adds the encryption. Widevine is one of the
three client systems that Apple's server agrees to give keys to. The choice of trusted systems
is Apple's, made on Apple's server.

So an in-house DRM cannot unlock Apple's songs. Apple's server would have to trust our system,
and it trusts only three. The other way, wrapping Apple's songs in our own DRM, needs the clear
audio or the content key first. Those come only out of a trusted CDM, and taking them out is
the circumvention rejected in §8.4.

An in-house DRM works only for audio we own or license: we encrypt it, we hold the keys, and
we run the license server (for example Shaka Packager + a ClearKey or our own key server). It
does not help with the Apple Music catalog.

## 11. The lightest setups found, and "use the user's Chrome" (researched 2026-09-16)

### 11.1 Weight of each setup found
| Setup | Extra download | Engines in memory | Proven by | Status |
|---|---|---|---|---|
| Own Widevine pipeline, no browser (vibez PR #138: ~15 MB RAM, <0.5 s start) | ~0 | 0 | vibez (open PR) | **Rejected** (§8.4, terms) |
| **The user's installed Chrome as the player** (vibez default: ~250 MB RAM, ~2.5 s start, 3 processes) | 0 | 2 (WebKitGTK UI + Chrome) | vibez | **Candidate** (§11.2) |
| Tauri + our CEF build (§8) | ~70–100 MB | 1 | atrium (macOS only) | Candidate |
| castLabs ECS / Electron (Path B) | ~100 MB | 1 | Sidra, Cider | Candidate |

"Lightest" depends on what we measure. Using the user's Chrome ships nothing, but it runs two
engines while music plays. CEF ships ~70–100 MB but runs one engine.

### 11.2 The user's Chrome as the player engine
Tauri keeps the UI on WebKitGTK. The Rust back end starts the user's browser as a hidden
playback engine. MusicKit JS runs there, inside Google's own Widevine.

**Facts found:**
- **Which browsers have Widevine on Linux:** Google Chrome ships it. Brave and Vivaldi
  download it. **Microsoft Edge on Linux does not** (corrected 2026-09-16: Microsoft turned it
  off; `edge://flags` says "Not available on your platform", Microsoft Q&A 2025-03-31). Distro Chromium packages do not (Arch needs an extra `widevine`
  package). Chrome for Testing does not.
- **vibez** does this now: Chrome through Playwright/CDP, headless, Widevine, full songs.
  Without Chrome it falls back to WebKitGTK and plays 30-second previews. That is the same
  fallback we would have.
- **Chrome 136+** ignores `--remote-debugging-port` / `--remote-debugging-pipe` on the default
  profile. We must pass our own `--user-data-dir`. That is also better for us: the user's own
  profile, cookies and passwords stay out of it.
- **Widevine needs the component updater.** The flag `--disable-component-update`, which most
  automation tools add, stops Widevine from loading. With our own profile, the first run may
  need a moment (or a restart) before Widevine is ready.
- **Headless:** an old Chromium bug (issue 40551636, 2017) said Widevine does not work in
  headless mode. vibez says it runs headless with Widevine now. **Not confirmed by us.** If
  headless fails, a hidden or off-screen window is the fallback.

**Terms:**
- Apple: MusicKit JS still renders the audio (DPLA §3.3.6.D). The page is ours, served from
  `127.0.0.1` (a secure context, so EME works).
- Google: Widevine runs inside Google's own licensed browser. We do not load, copy or ship the CDM.
- So this setup is inside both companies' terms. That is the difference from vibez PR #138.

**What we would build:**
1. **Find the browser:** Chrome, Brave or Vivaldi, by known paths plus a Settings
   override. None found: previews only, with a message "Install Google Chrome for full songs".
2. **Launch:** our own `--user-data-dir`, `--remote-debugging-pipe` (no open port), no
   `--disable-component-update`, headless or hidden. Stop it when the app quits. Restart it if
   it crashes.
3. **A player page** served by the Rust back end on loopback: MusicKit JS + `player.ts` +
   `sound.ts` (+ the perf lines).
4. **Split `player.ts`.** 23 files import about 50 functions from it. Commands
   (`playTracks`, `queueTracksNext`, `setVolume` …) become calls over the pipe. The
   synchronous getters (`isShuffleOn`, `getVolume`, `isPlayingNow` …) read a state copy that
   the player page pushes back. `onPlayerState` becomes the event stream.
5. **Linux parts** still needed (§4): MPRIS, tray menu, autostart, AirPlay capture (now
   capture the Chrome process tree, not our own).

**Estimate:** steps 1–4 about 2–3 weeks (step 4 is most of it). No build pipeline, no monthly
CEF rebuild. §4 as before.

**Costs and risks:**
- Two engines in memory while playing (WebKitGTK + Chrome).
- Every play goes through one more process hop. Measure click→sound with the perf lines.
- A Chrome update can change flags or behaviour. We do not control the Chrome version.
- The user must have one of the three browsers. Without it, only previews play.
- Flatpak: starting a host browser needs `flatpak-spawn --host`. AppImage and deb do not.
- The same split also works on Windows, but there is no reason to use it there.

**Rejected variant: our browser extension's offscreen document.** Manifest V3 forbids
remotely hosted code, and MusicKit JS must load from Apple's CDN. The extension would also
need Chrome running in the background.

### 11.3 Test before building (not built; ask first)
On a Linux machine with Google Chrome: start Chrome with our own `--user-data-dir` and
`--headless=new`, load a `127.0.0.1` page with MusicKit JS and our developer token plus Music
User Token, and play one library song. Pass: a full song plays past 30 s. Then repeat without
`--headless` in a hidden window if headless fails.

## 12. PlayReady and other unusual options (researched 2026-09-16)

### 12.1 PlayReady
- **What it is:** Microsoft's DRM. On Windows it is part of the OS (Media Foundation). Edge and
  WebView2 use it.
- **In MusicKit:** MusicKit supports it two ways: the old `MSMediaKeys` interface and standard
  EME. With standard EME it tries Widevine first, then PlayReady, unless Apple turns on the
  `prefer-playready` feature flag (§10 trace).
- **What DeetsMusic uses on Windows today:** Widevine. The dev log shows
  `player:drmWarm {"keySystem":"com.widevine.alpha"}` (success), and MusicKit's order picks
  Widevine first. (A 2024 WebView2 feedback issue, #4828, says WebView2 has only PlayReady. Our
  log shows that is out of date.)
- **On Linux:** there is no desktop PlayReady. Microsoft licenses the PlayReady Device Porting
  Kit to chip makers and device makers (TVs, set-top boxes, RDK boxes). A company can sign a
  Final Product License, but it comes with robustness rules (a hardened implementation that
  hides its keys), compliance rules and Microsoft's license terms. It is built for hardware
  makers, not for a small app. **Not a realistic path.**
- **Edge on Linux** has neither PlayReady nor Widevine now.

### 12.2 Other unusual options
| Option | How | Verdict |
|---|---|---|
| **Remote for Apple's Android app (Waydroid)** | Waydroid runs Android in a Linux container. Apple's own Android app plays (reports say lossless, output at 48 kHz). DeetsMusic would control it through Android's media session. | Works for users today. Needs Wayland, Waydroid setup and a Widevine add-on script that installs Google binaries (a grey area). DeetsMusic becomes a remote, not the player. Our library, queue, Sound and AirPlay features would not reach the audio. Not a product path. |
| **Our Windows build under Wine** | WebView2 + Widevine or PlayReady under Wine | See §12.3. WebView2 runs; DRM is unproven. Worth one test. |
| **A Windows PC as the player, Linux as a remote** | The agent bridge already controls playback over loopback | Not a Linux player. Possible later as a "remote" feature. |
| **The user's Chrome (§11)** | — | Still the best option found. |

### 12.3 Wine in detail (researched 2026-09-16)
**Terms:** our unmodified Windows build, WebView2's own Widevine, MusicKit JS rendering. Inside
Apple's and Google's terms. The only question is whether it works.

**What works:**
- **WebView2 runs under Wine** with a Windows version override. Winetricks added a `webview2`
  verb in 2026. Reports name Wine 10.x, then 11.3+, as the minimum. Microsoft calls WebView2 on
  Wine unsupported.
- So our Tauri app will probably start and show its UI.

**What is unproven, piece by piece:**
| Piece | Risk under Wine |
|---|---|
| Widevine component download (Edge's component updater inside WebView2) | Unknown. Probably works: it is plain HTTP + files. |
| The Chromium sandbox that hosts the CDM | High. Chromium's Windows sandbox depends on Windows security APIs that Wine only partly has. Flatpak Edge on Linux needed `--no-sandbox` for Widevine (flathub PR #871). WebView2 accepts `--no-sandbox` through `AdditionalBrowserArguments`, but that removes a security layer. |
| Widevine host verification (VMP) | Unknown. On Windows the CDM checks signed `.sig` files next to the host binaries. Microsoft ships them with WebView2, so the files exist; whether the check passes under Wine is unknown. |
| PlayReady | **No.** Needs Windows Media Foundation's protected media path and the OS PlayReady module. Wine does not have them. MusicKit tries Widevine first anyway. |
| AAC decode | Probably yes (WebView2 decodes AAC through Media Foundation or its own FFmpeg; Wine has partial Media Foundation). Unknown. |
| Our Windows-only parts | SMTC, the tray fallback (`media.rs`), `reg.exe` autostart, WASAPI **process loopback** for AirPlay: Wine has WASAPI, but process loopback is unlikely. Media keys would not reach the Linux desktop. |

**Reports found:** none of Widevine or PlayReady playing under Wine, in any browser. None of a
Tauri app playing DRM under Wine.

**Related: iTunes under Wine.** iTunes plays Apple Music with its own FairPlay, not a browser
CDM. iTunes 12.13 (the current one) shows a black UI under Wine. Old 12.7–12.9 reportedly ran,
with Apple Music streaming (2018 reports). iTunes has a COM automation interface, so DeetsMusic
could in theory act as a remote for it. Too old and too fragile to build on.

**Verdict:** even if it works, it is "the Windows app under Wine", not a Linux release: no
media keys, no tray integration, no AirPlay capture, and a sandbox we may have to turn off.
**Worth one test** because the test is cheap and costs no code.

**The test (not run; needs a Linux machine, same as §11.3):** install Wine ≥ 11 +
`winetricks webview2`, install the current signed DeetsMusic installer, sign in, play one
library song. Pass: plays past 30 s. If it fails, read `player:drmWarm` / `player:eme` in the
Wine prefix's `%APPDATA%\com.deetsmusic.app\deetsmusic.log`, then retry once with
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--no-sandbox` to see whether the sandbox is the block.
The user accepts `--no-sandbox` for this path (2026-09-16).

**Not on a Mac (decided 2026-09-16):** Wine on macOS (CrossOver) runs x86 Windows code through
Rosetta 2, with its own graphics layer and Wine build. CodeWeavers marks its WebView2 ratings as
out of date. A Mac result would not predict the Linux result. The useful Mac test is the native
one: MusicKit JS in WKWebView with FairPlay (§6). Run the Wine test on the Linux machine.

### 12.4 Building on Wine (asked 2026-09-16; only if the §12.3 test passes)
The user is open to building on Wine or patching it (LGPL, open source).

**Shape: "Path W" = our Windows build + bundled Wine + a small native Linux helper.**
- **Bundle:** an AppImage or Flatpak with a Wine build and a prefix. On first run, install the
  **Evergreen** WebView2 runtime into the prefix. Not the Fixed Version: its Widevine does not
  update and may be missing.
- **Our Windows app** detects Wine (the `wine_get_version` export in `ntdll`) and then: turns
  off SMTC, `media.rs` and the `reg.exe` autostart, and passes `--no-sandbox` through WebView2's
  browser arguments. `player.ts` does not change.
- **The native helper** (a small Rust binary for Linux) talks to the app over the existing
  loopback bridge (`bridge.rs`) and does what Wine cannot: MPRIS media keys, the StatusNotifier
  tray, the XDG autostart file, the deep-link `.desktop` handler, and PipeWire capture of the
  Wine process tree for AirPlay.
- **Patch Wine only where the test shows a block** (the sandbox, the Widevine host check).
  Keep the patches small and send them upstream, or each Wine release means a rebase.

**Precedents for this shape:** Proton (Valve ships Wine inside Steam), CrossOver, Bottles, and
yabridge (Windows audio plugins under Wine, with a native Linux host over IPC — the same
split as our helper).

**Terms:**
- Wine: LGPL. Ship its license and offer its source.
- WebView2 runtime license: "install and use any number of copies ... on your devices"; no
  Windows-only clause found. It forbids working around "technical limitations in the software".
  Running it on Wine and passing a Chromium argument that WebView2 accepts is not that, but a
  lawyer's read is safer before a public release.
- Apple and Google: unchanged. MusicKit JS renders; Widevine runs inside Microsoft's licensed
  runtime.

**Estimate if the test passes as is:** Wine detection + switches ~3 days; the helper 2–3 weeks
(PipeWire capture is most of it); packaging + first-run WebView2 install 1–2 weeks.
**About 4–6 weeks.** If the test fails and Wine needs patches for the sandbox or the Widevine
host check: unknown, possibly months of Wine C work.

**Costs:**
- Size: Wine + the WebView2 runtime are an estimated 350–500 MB installed. Heavier than CEF.
  Measure it.
- WebView2 updates: Edge's updater service may not run under Wine. We may have to update the
  runtime ourselves (the `sewnie/wine` Go package exists for this).
- Microsoft calls WebView2 on Wine unsupported. A WebView2 update can break it.
- Graphics: WebView2 draws through Wine's Direct3D-to-Vulkan/OpenGL layer. Measure frames per
  skin.

**Compared with the Chrome path (§11.2):**
| | Path W (Wine) | User's Chrome |
|---|---|---|
| User needs | nothing | Chrome, Brave or Vivaldi |
| Download | ~350–500 MB (estimate) | 0 |
| `player.ts` split | No | Yes (most of that path's work) |
| Engines in memory | 1 (WebView2) + Wine | 2 |
| Proven for Apple Music | No | Yes (vibez) |
| Estimate | 4–6 weeks if the test passes | 2–3 weeks + §4 parts |

**Result:** PlayReady does not open a Linux path. The options stay: the user's Chrome (§11),
Tauri + our CEF build (§8), or castLabs ECS (Path B).

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
- [Chromium Linux build instructions](https://chromium.googlesource.com/chromium/src/+/main/docs/linux/build_instructions.md) ·
  [WebKitGTK EME discussion](https://lists.webkit.org/pipermail/webkit-gtk/2015-July/002391.html) ·
  [Electron libffmpeg and proprietary codecs](https://github.com/electron/libchromiumcontent/issues/174)
- [W3C EME spec (Clear Key)](https://www.w3.org/TR/encrypted-media-2/) ·
  [web.dev: EME basics](https://web.dev/articles/eme-basics) ·
  [Chromium: CDM types and AesDecryptor](https://groups.google.com/a/chromium.org/g/chromium-dev/c/i95JdbEjtqg) ·
  [ungoogled-chromium FAQ (Widevine)](https://ungoogled-software.github.io/ungoogled-chromium-wiki/faq) ·
  [Waterfox #838 (previews)](https://github.com/WaterfoxCo/Waterfox/issues/838) ·
  [Apple forum: MusicKit JS previews only](https://developer.apple.com/forums/thread/683958) ·
  [vibez PR #138](https://github.com/simonepelosi/vibez/pull/138)
- [vibez README](https://github.com/simonepelosi/vibez) ·
  [Chrome: remote debugging switch changes (136)](https://developer.chrome.com/blog/remote-debugging-port) ·
  [agent-browser #1481: Widevine and --disable-component-update](https://github.com/vercel-labs/agent-browser/issues/1481) ·
  [Chromium issue 40551636: Widevine in headless](https://issues.chromium.org/issues/40551636) ·
  [chrome.offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [PlayReady Device Porting Kit](https://learn.microsoft.com/en-us/playready/overview/device-porting-kit) ·
  [PlayReady licensing FAQ](https://www.microsoft.com/playready/licensing/faq/) ·
  [Microsoft Q&A: Widevine disabled on Edge for Linux](https://learn.microsoft.com/en-us/answers/questions/2241881/widevine-drm-disabled-for-linux-environments) ·
  [WebView2Feedback #4828](https://github.com/MicrosoftEdge/WebView2Feedback/issues/4828) ·
  [Ivon's blog: Apple Music on Waydroid](https://ivonblog.com/en-us/posts/play-apple-music-android-on-linux/)
- [Winetricks #2226: WebView2 verb](https://github.com/Winetricks/winetricks/issues/2226) ·
  [sewnie/wine webview2 package](https://pkg.go.dev/github.com/sewnie/wine/webview2) ·
  [Arch forum: WebView2 on Wine](https://bbs.archlinux.org/viewtopic.php?id=287582) ·
  [flathub Edge PR #871: Widevine sandbox](https://github.com/flathub/com.microsoft.Edge/pull/871) ·
  [CEF #3404: VMP sig files](https://github.com/chromiumembedded/cef/issues/3404) ·
  [hobo.house: iTunes via Wine (2018)](https://hobo.house/2018/06/20/run-itunes-on-linux-via-wine/) ·
  [Dedoimedo: iTunes 12.13 on Linux](https://www.dedoimedo.com/computers/linux-itunes.html) ·
  [Automating iTunes (COM)](https://learn.microsoft.com/en-us/archive/blogs/noahc/automating-itunes-with-c-in-net)
- [WebView2: Evergreen vs Fixed Version](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version) ·
  [WebView2 Fixed Version license text](https://scancode-licensedb.aboutcode.org/ms-edge-webview2-fixed.html) ·
  [Vuplex: Widevine in WebView2](https://support.vuplex.com/articles/how-to-enable-widevine/)
- [souvlaki](https://docs.rs/souvlaki) ·
  [tauri-plugin-media](https://crates.io/crates/tauri-plugin-media)
