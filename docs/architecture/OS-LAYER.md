---
status: designed
desk_test: none
sources: [src-tauri/src/os/mod.rs, src-tauri/src/os/windows.rs, tools/mac-probe/run.mjs, tools/mac-probe/page/index.html, tools/mac-probe/page/glass.html, tools/mac-probe/src-tauri/src/glass.rs, tools/mac-probe/src-tauri/src/main.rs, src/player.ts, src/sound.ts, src/platform.ts, src-tauri/Cargo.toml, src-tauri/src/os/windows/media_session.rs, src-tauri/src/os/windows/system_media.rs, src-tauri/src/tray.rs, src-tauri/src/airplay.rs, src-tauri/src/presence.rs, src-tauri/src/velo.rs, src-tauri/src/gpu.rs]
updated: 2026-11-03
---
# The OS layer — Windows, macOS, then Linux

Designed 2026-11-03 on the `macos-support` branch. Nothing in the app is built. The probe in
`tools/mac-probe/` is built and ran on his Mac (§2). This doc is the plan for a Mac build, and
the spec a cloud agent takes for Linux later (§8).

**Terms.**
- **The OS layer:** `src-tauri/src/os/`, one Rust module with one file per OS. Commands call
  it. It holds only the edges: media keys, secrets, audio output, tray details, the updater, the
  Discord pipe. Nothing about songs, the library, playlists or rules.
- **An edge:** a call into the operating system that has no meaning on another OS as written.
- **WKWebView:** the web view Tauri uses on macOS (Safari's engine, WebKit).
- **Liquid Glass:** macOS 26's native material, `NSGlassEffectView`. `NSGlassEffectContainerView`
  holds several glass shapes and merges them when they come near.
- **A flavor:** one service per app, picked at build time (PROVIDER-CRATES.md §10).

## 1. His calls (2026-11-03)

1. **Apple Silicon only.** No universal build, no Intel Macs.
2. **The EQ can go on a Mac.** If Web Audio gets silence from FairPlay audio (§2.3), the Mac
   build ships without the EQ, the level meter and Adaptive sound.
3. **AirPlay on a Mac is Apple's own route picker**, not our sender crate. macOS sends the
   whole app's audio to the HomePod; we show the system picker (`AVRoutePickerView`).
4. **Rebuild the tooling** for more than one OS (§7), and **move the tools into crates** to clean up
   the repo root (§9).
5. **Liquid Glass behind the window, per skin, and in the menus** (§6.1). Native glass cards
   are to be investigated (§6.2); Cyber does not need glass.
6. **Linux is the third module.** Not a priority. A cloud agent builds it from §8 once the Mac
   work has made the split.

**The forks, decided the same day (§10 has the record):**

7. **Linux runs on Tauri 3 with our own CEF build** (AAC + Widevine), once Tauri 3 is stable.
   This replaces the 2026-09-17 ECS decision (LinuxPort.md §13): no Electron shell, no
   `src/shell/` adapter, no sidecar. Windows and the Mac stay on the system web views.
8. **The OS layer is a module with free functions** (`src-tauri/src/os/`, F1 + F2).
9. **The split runs in its own session, once these docs are complete** (F3); not in this one.
10. **The dev tools drive the app through a bridge `eval` route on every OS** (F7). CDP stays only
   for the GPU traces on Windows.
11. **The CLI and its MCP ship in the first Mac release**, with a shared `crates/app-paths` for the
   data folder, the install folder and opening a folder (used by the app and the CLI).
12. **The root cleanup, all four moves** (F4, §9): a root Cargo workspace, `cli/` into `crates/`,
   the art into `assets/`, each probe a crate under `tools/`.
13. **Liquid Glass per skin (F5):** Glass, Happy and Ocean to start; mainly the cards and the menus,
   for light and effects. Happy's and Ocean's scenes go native (§6.4), so the glass cards sit
   over them. Cyber, Press, Metal and Vanilla: none for now.
14. **Native glass cards: a spike after window glass ships** (F6).
15. **Right-click menus on a Mac are native** (an NSMenu from `media-menu.ts`'s rows), with the web
   menus kept as a setting for users who do not want Liquid Glass (§6.5).

Still open: §10.

## 2. What the probe found (tools/mac-probe, run 2026-11-03 on macOS 27)

### 2.1 The engine, with no token
Origin `tauri://localhost`, a secure context. Media Source with AAC: yes. **FairPlay through
EME: yes**, for `com.apple.fps`, `.1_0`, `.2_0` and `.3_0`. Widevine: no (`player.ts` asks only
for Widevine today, in `warmDrm`; it fails without harm). ClearKey: yes.

The user agent has no `Version/… Safari/…` part. If MusicKit treats it as an unknown browser,
the fix is a custom user agent on the window (one line).

### 2.2 A full song — NOT RUN
It needs a developer token. The mint answers 403 without the build key, and this Mac has
neither the key nor a `.p8`. To run it: copy `deetsmusic-build-key.txt` to
`~/Documents/Deets' Secrets/`, then `node tools/mac-probe/run.mjs`.

### 2.3 Web Audio — NOT RUN
Runs right after a full-song PASS (`WEBAUDIO:` line). It decides §1.2.

### 2.4 Liquid Glass (`node tools/mac-probe/run.mjs --glass`)
Four scenes, each looked at in a screenshot:

| Scene | Result |
|---|---|
| Window glass behind a transparent page | Works. The desktop shows through as Liquid Glass; cards drawn by the page sit on it. |
| Glass shapes behind the cards, a native picture behind them | Works. Each card's glass bends the native picture. An opaque Cyber card hides its glass. |
| CSS `backdrop-filter` on a card over the native layer | Looks like it **does not see** the native layer: the picture behind that card stayed sharp. CSS blurs only web content. |
| Glass **over** the page (a bar above the web view) | Works. It bends the page's own content (stripes and the Cyber card). |
| A moving card, its glass following | **60 updates a second, a round trip of 2 ms at p50, 3 ms at p95** (one `invoke` per frame with every rect). |

The key fact: **glass behind the web view bends only what is native and behind it.** It never
bends the page's own drawing. To have glass cards bend the album cover, the cover wallpaper
must be drawn natively too (§6.2).

## 3. The shape

```
src-tauri/src/os/
  mod.rs        the interface: re-exports one OS file; `caps()`
  windows.rs    today's code, moved here
  macos.rs      new
  linux.rs      new (§8)
```

```rust
#[cfg(windows)]             mod windows;
#[cfg(windows)]             use windows as imp;
#[cfg(target_os = "macos")] mod macos;
#[cfg(target_os = "macos")] use macos as imp;
#[cfg(target_os = "linux")] mod linux;
#[cfg(target_os = "linux")] use linux as imp;

pub use imp::{media_session, secrets, audio_out, presence_pipe, updater, tray_extras, display, net};
pub fn caps() -> OsCaps { imp::CAPS }
```

- A command calls `os::secrets::store(..)` and holds no `cfg` of its own. Each OS file has the same
  signatures, so a missing function fails that OS's build.
- `os::caps()` is one command for the page (`os_caps`). The page hides what this OS cannot do
  (the AirPlay sender, the GPU watch, the EQ). It is the same idea as a provider's `caps()`.
- The Windows crates move to `[target.'cfg(windows)'.dependencies]` in `src-tauri/Cargo.toml`.
  Today `windows`, `windows-core` and `webview2-com` are plain dependencies, and only 3 `cfg`
  gates exist, so the app does not build on a Mac.
- **The two axes stay apart:** a build is service × OS (× Beta). The provider crates never touch
  the OS; the OS layer never knows the service.

## 4. The edges, file by file (read 2026-11-03)

About 19 files, ~7,500 lines, call Windows APIs. The Mac and Linux columns are the plan.

| Today (src-tauri/src) | What it does | macOS | Linux |
|---|---|---|---|
| `smtc.rs`, `media.rs` | our media session; the tray panel's fallback source; master volume | `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter`, or `navigator.mediaSession` if WKWebView drives Now Playing (test) | MPRIS over D-Bus |
| `audio_out.rs` | the output device and its notices | CoreAudio (`AudioObjectAddPropertyListener`) | PipeWire / PulseAudio |
| `airplay.rs` (sender crate, capture) | play on a HomePod | **dropped**: the system picker (§1.3) | keep the sender crate |
| `presence.rs` | Discord's named pipe | Unix socket `$TMPDIR/discord-ipc-0` | Unix socket `$XDG_RUNTIME_DIR/discord-ipc-0` |
| `sotd/outlet.rs`, `friends.rs` | DPAPI for secrets | Keychain | Secret Service (the `keyring` crate covers all three) |
| `velo.rs`, `update.rs` | Velopack install / update | Velopack's macOS path; a notarized `.app` in a `.dmg` | AppImage (§8) |
| `identity.rs`, `app_icon.rs` | the `.msix` identity, icon frames | not needed (the `.app` bundle is the identity) | a `.desktop` file |
| `gpu.rs` | WebView2's GPU process watch | not needed at first (`caps`: off) | not needed at first |
| `display.rs` | the monitor's refresh rate | `NSScreen.maximumFramesPerSecond` | the compositor (or the page's own sample) |
| `net.rs` | the ping (ICMP) | `socket(…, IPPROTO_ICMP)` (an unprivileged ping on macOS) | the same, or a TCP connect time |
| `tray.rs` | tray icon, panel, restore | menu-bar icon; Tauri's tray works on macOS | the tray works; clicks do not reach the app (LinuxPort.md §2.5) |
| `db_open.rs` | a message box when the database will not open | `NSAlert` (or `rfd`) | `rfd` |
| `beta.rs`, `settings.rs` | process checks; start flags | `libproc` / plain `std::process` | `/proc` |
| `crates/mcp-install` | sets up the AI apps | the Mac paths of each app's config | the Linux paths |

## 5. The page side

- `src/platform.ts` gets an `os` value. About 13 files mention WebView2; each reads it.
- `additionalBrowserArgs` in `tauri.conf.json` is WebView2-only. A Mac overlay
  (`tauri.macos.conf.json`) holds the Mac window: `titleBarStyle: Overlay`, `transparent` for
  the glass, the traffic lights.
- **A Mac menu bar is required.** Without an Edit menu, ⌘C, ⌘V and ⌘A do not work in text
  fields. The app menu also carries Settings… (⌘,), Hide, Quit. Native menus get Liquid Glass
  from macOS.
- Keys: Ctrl shortcuts read ⌘ on a Mac. One mapping in the key handling, never per call site.
- `player.ts` `warmDrm` asks for `com.apple.fps` on a Mac.

## 6. Liquid Glass

### 6.1 Behind the window and in the menus (his call)
- **Per skin, as a skin token:** `--native-glass: window | cards | none`. Glass: `window`, then
  `cards` after the spike. Happy and Ocean: `cards` over their native scenes (§6.4). Cyber, Press,
  Metal, Vanilla: `none` (his call, 2026-11-03).
- With `window`, the page canvas goes transparent and one `NSGlassEffectView` fills the window
  behind the web view (§2.4, scene 1). A skin change sends the value to Rust (`os_glass`).
- Menus: the app menu bar, the Dock menu, the menu-bar icon's menu. Our right-click menus stay
  web (`media-menu.ts`); a native right-click menu would be a second implementation.

### 6.2 Native glass cards — what it would look like (investigation, not decided)
The probe says it can work without a rewrite. The cards stay web; only their **fill** goes native.

```
  native wallpaper (NSImageView: the cover, or the queue covers)   ← moves from CSS to native
  NSGlassEffectContainerView: one glass shape per card             ← synced to the card rects
  WKWebView, transparent: the card contents (text, rows, buttons)
  (optional) one glass bar over the page                           ← a floating transport bar
```

- **`src/glass-sync.ts`** (new): reads each card's rect and radius, and sends all of them in one
  `invoke` per change. At rest: a `ResizeObserver` plus layout events. In motion (swap, grow,
  the stacked player): every animation frame, which the probe measured at 2–3 ms per round trip.
- **The container merges shapes.** Two cards that come together in a swap or a grow melt into
  each other: Liquid Glass's own motion, free, during our existing card motion.
- **Per skin:** `--native-glass: cards` joins `window | none`. Cyber stays `none`.
- **The cost:** the cover wallpaper (COVER-WALLPAPER.md) and the album-colored aurora
  (ALBUM-COLOR.md) are CSS today. Under glass cards they must be native, or the glass bends only
  the desktop. The wallpaper is easy (an image view). The aurora's motion is real work (a Metal or
  Core Animation layer).
- **The risk:** at 120 Hz a frame is 8 ms. A 2–3 ms round trip fits, but the glass can trail the
  web content by one frame during fast motion. A test in the real app decides it.
- **What stays impossible without a rewrite:** native controls inside a card (an `NSSlider`, an
  `NSButton` in glass). A native card that is native inside is SwiftUI: a second app.

### 6.3a A web-drawn scene hides the glass
Ocean's sea (`ocean.ts`, its worker, ~270 lines of CSS) and Happy's scene (`scene.ts`, `pet.ts`)
are drawn by the page. Native glass behind the page sits under them and cannot be seen. So glass
cards over those scenes need the scene behind the glass: §6.4.

### 6.3 What CSS can do on its own
Safari supports `backdrop-filter` with blur and saturate, but not an SVG filter inside it. So
the "liquid" bend is Chromium-only in CSS. On a Mac, the real material comes from §6.1 or §6.2.

### 6.4 Native scenes for Happy and Ocean (his call; the approach is open, §10 S1)
What it means, read against the code on 2026-11-03:

- **The scenes are large.** Ocean: `ocean.ts` 497 lines, `ocean-texture.ts` 213, the worker, and
  ~270 lines of sea CSS (the swell bands, the glow from the deep, heave, ripples, the album light).
  Happy: `scene.ts` 398 lines (the sky by the part of the day, the sun or moon at a card corner,
  clouds on card edges) and `pet.ts` 719 (Deets and Happy on the floor, moving the covers).
  Both read the cards' boxes, so a native scene needs the card rects (glass-sync.ts gives them).
- **Heave needs Web Audio.** If the Mac's Web Audio check fails (§2.3), the sea stays calm on a
  Mac whichever renderer draws it.
- **Two ways to do it** (S1):
  - **A Mac-only follower.** The web scene stays the source of truth on Windows, Linux, the web
    demo and WebRooms. The Mac draws its own copy (Core Animation layers or Metal) from the same
    inputs the page already has: theme colors, album glow, sea height, ripple and heave events,
    card rects. **Windows is not touched.** The cost: every change to a scene is made twice and
    checked twice, and the two copies drift unless a parity list (in OCEAN.md and happy.md)
    and a Mac screenshot set hold them together.
  - **One native renderer for every OS.** The scenes move to Rust once (wgpu: Metal on the Mac,
    DirectX 12 on Windows, Vulkan on Linux), behind a transparent web view on all three. One copy,
    no drift, and Windows can then use its own materials (Acrylic, Mica) behind the cards. **Windows
    changes:** a transparent WebView2 over a native layer, a new startup path, new GPU behavior to
    measure (GRAPHICS-FALLBACK.md), and the web demo and WebRooms keep needing a web copy anyway.
- **What stays the same either way:** the skin tokens, the settings (Sky, Album light), the rules
  that read them, and the cards themselves.

### 6.4a S1 decided: a Mac-only follower, held by code, not by docs (2026-11-03)
His call: the web scene stays the source of truth; the Mac draws a follower copy. His ask: a
maintenance system that does not rely on docs to stop drift. The design (forks D1–D3 in §10.2):

1. **The page computes, each OS paints (a display list).** `ocean.ts`, `scene.ts` and `pet.ts`
   split into a *compute* half (pure TS: the band rows of `ocean-texture.ts`, the sky phase of
   `sky-phase.ts`, the sun, cloud and floor places from the card boxes, the pets' paths) and a
   *paint* half. The compute half returns a `SceneFrame`: a short typed list of layers (an
   image, a gradient band, a sprite, a ring) with their animations (keyframes and durations).
   The web painter draws it with the DOM and canvas, as today; the Mac painter draws the same list
   with Core Animation layers. A change to the math reaches the Mac with no Mac code.
2. **One contract, generated to Rust.** The layer kinds, the animation kinds and the scene events
   (ripple, heave, a cover swap, a pet action, the part of day) are one TS file,
   `src/scene-contract.ts`. `npm run scene:contract` writes `crates/scene-contract` (Rust enums),
   like `usage:keys`. The Mac painter matches every enum without a catch-all, so a new kind on
   the web **fails the Mac build** until the Mac paints it.
3. **Every number is a token.** Speeds, sizes, timings and colors of the scenes are `--ocean-*` /
   `--scene-*` skin tokens. The page sends their computed values in the frame; the Mac painter has
   no numbers of its own. A check fails a number literal in the Mac painter (as check 28 does for CSS).
   A token change moves both with no code change.
4. **Pixel parity, in the check.** Fixed inputs (a frozen clock, fixed card boxes, each theme): the
   web painter renders in headless Edge (the shots runner), the Mac painter renders offscreen
   (`CALayer.render(in:)` in a test binary). A perceptual diff over a threshold fails
   `npm run check` on a Mac, and the macOS CI job.
5. **A tripwire on the painters.** `scenes.lock` holds a hash of each web painter file. When one
   changes and the Mac painter does not, the check fails until the Mac side changes or
   `npm run scenes:ack` records that the change does not apply.

**Why a display list, and why the crate (asked 2026-11-03).** The list is data, not drawing: the
layers to show and how each one moves ("sway every 9 s by 6 px"). Each OS runs the animation
itself, so a new list goes over only on a change (a theme, a resize, a card move, an album);
events (a ripple, a heave hop every 100 ms) are small messages. The Mac painter is Rust and gets
the list as JSON, so it needs Rust types for it: `crates/scene-contract`, generated from the TS
file, used by the app's Mac painter and by the pixel-parity binary (hence a crate, not a module).
The other option, the scene math in a Rust crate compiled to WASM, was not taken: a WASM build in
Vite, the demo and WebRooms, and a rewrite of the math, for no gain (the page is always there).

What it costs: step 1 refactors the web scenes first, on Windows, with no visible change. The
motion set (`docs/guide/motion.json`) A/B before and after is its gate.

### 6.5 Right-click menus on a Mac (his call)
- The default on a Mac: a native `NSMenu`, built from `media-menu.ts`'s row list (one builder, two
  renderers). macOS draws it as Liquid Glass over what is under it.
- A setting keeps the web menus for users who do not want Liquid Glass. A new settings key gets
  the usual set: a default with the why, an agent spec, a line in AGENT.md, a `NEW_MARKS` line, a
  Compass row (CLAUDE.md checklist 5, 5a, 9). Its name, place and wording are his (§10 S2).
- Lost in the native menus: our menu motion and the hover hints on rows. Panels on a trigger
  (`makeDropdown`: Play on, Sound) stay web.

## 7. The tooling

Most dev tools speak CDP (Chrome's protocol): `dev:app` driving, `webview-eval`,
`webview-profile`, `shots --source dev`. WKWebView has no CDP, and Linux on ECS has CDP
again. **The plan: drive the dev app through our own bridge, not CDP.**

- A dev-only bridge route: `POST /dev/eval {js}` → `webview.eval()` → the page answers
  through `invoke` (the probe's `report` pattern). This works on all three OS. The shots runner's
  `source: dev` and the drive scripts move onto it.
- Measurement on a Mac: `frames.ts` and `perf.ts` already run in the page, so the `[perf]` lines
  work as they are. GPU-process traces stay Windows-only; on a Mac, Instruments by hand.
- `shots.mjs` (the web demo) gains a WebKit run through Playwright's WebKit, as a stand-in for
  WKWebView in visual checks.
- `npm run check` on a Mac: `cargo check` of the Mac build, plus the tests. The pre-push hook
  runs whichever OS it is on. A CI job for the other OS is later.

## 8. Linux — the spec for a cloud agent (not a priority)

**His call (2026-11-03): Linux runs on Tauri 3 with our own CEF build.** This replaces the ECS
decision of 2026-09-17 (LinuxPort.md §13). Tauri's CEF runtime (v3.tauri.app/develop/cef, read
2026-11-03) is in the **Tauri 3.0 alpha only**; "its APIs may still change before the stable
release". Its bundles are "hundreds of megabytes larger than with wry". The page says nothing
about Widevine or AAC, and standard CEF builds have no AAC (LinuxPort.md §2.3), so we build CEF
ourselves (`proprietary_codecs=true ffmpeg_branding=Chrome`, Widevine on; LinuxPort.md §8) and
point Tauri at it with `CEF_PATH`.

**Before the agent starts:** Tauri 3 is stable, and the whole app is on it. One runtime crate serves
every OS: Windows and the Mac stay on wry (the system web views); only the Linux build selects
`tauri-runtime-cef`. Moving the app to Tauri 3 is its own load-bearing step (§10 S3).

**His call (2026-11-03): Linux waits for Tauri 3, but everything except the sound is built now.**
Tauri 2 already runs on Linux with WebKitGTK. WebKitGTK cannot play Apple's DRM songs, but
every edge can be built and tested on it (§8.1). When Tauri 3 is stable, the runtime changes to
CEF and only the sound is new.

### 8.1 Now, on Tauri 2 + WebKitGTK (no playback)
- `os/linux.rs`: MPRIS (driven by a fake "now playing" from the page), the Secret Service, the
  audio output list, the Discord socket, the tray (and its click limit, LinuxPort.md §2.5), the
  ping, the refresh rate, the message box, the CLI paths in `crates/app-paths`.
- The AirPlay sender crate on Linux (it is ours and has no DRM in it).
- Packaging: an AppImage from the Tauri 2 bundler; the update feed shape.
- CI: a Linux job that builds and runs the unit tests.
- **Do not tune visuals on WebKitGTK.** The final Linux engine is CEF (Chromium, like WebView2),
  so it will look like Windows. WebKitGTK is only for function.
- Sign-in works (the loopback browser flow); MusicKit configures; playback stops at DRM. A
  30-second preview may play through GStreamer, which is enough to drive the media keys.

### 8.2 At Tauri 3 stable
The work:
1. **`os/linux.rs`** — the right-hand column of §4 (from §8.1).
2. **Our CEF build** — a reproducible script, its output cached for CI; a CEF update is a
   release step. The download is ~1 GB per platform the first time.
3. **The runtime pick** — `tauri-runtime-cef` for the Linux target only, and
   `#[tauri_runtime_cef::cef_entry_point]` on `main` for that target.
4. **Packaging** — an AppImage first (the CEF page notes that some distributions restrict the
   AppImage sandbox); Flatpak later.
5. **The tooling** — the bridge `eval` route (§7) works as on the other OS; CEF also speaks CDP.

**Done means:** an AppImage that signs in, plays a song past 30 s, takes media keys (MPRIS),
and updates; Linux ships as beta (LinuxPort.md §13.5).

## 8a. What Tauri 3 means for the rest of the app (read 2026-11-03)

Sources: v3.tauri.app/start/migrate/from-tauri-2, the 3.0 alpha release notes. The migration page
itself says to keep production apps on 2.x until stable, and that `tauri migrate` does not yet
automate the move.

| Tauri 3 change | Where it touches us |
|---|---|
| `Builder::runtime(..)` is required; `tauri::Wry` is gone (`DynRuntime` by default) | `lib.rs`: one line. We never name `Wry`. |
| Runtime APIs move to extension traits (`WebviewWryExt::with_wry_webview`) | 2 calls: `lib.rs` (the WebView2 settings) and `gpu.rs` (the GPU watch) |
| `devtools`, `macos-private-api`, `unstable` move to `tauri-runtime-wry` | Cargo.toml (the Mac glass needs `macos-private-api`; multi-webview would need `unstable`) |
| Official plugins become `3.0.0-alpha.x`; a 2.x plugin cannot register | Ours are all official: opener, single-instance, deep-link (and `@tauri-apps/plugin-opener`) |
| `@tauri-apps/api@next`; the page lists no other JS change | 78 `src/` files import it; no edit expected |
| Capability files unchanged; app manifests list commands | `capabilities/default.json` unchanged |
| `bundle > resources` no longer copied into `target/` in dev | `mcp_install.rs` reads `resource_dir()`; only the installed app has the files, so dev is unchanged |
| The test runtime's origin is `tauri://localhost` everywhere | Tests only. Check at the move that Windows still serves `http://tauri.localhost` (`APPLE_ORIGIN` in apple.rs and the token's origin claim depend on it) |
| Rust 1.95 or newer | This Mac has 1.97.1 |
| Linux tray: ksni by default | Good for Linux (no appindicator library) |

**In short:** for Windows and the Mac, Tauri 3 is a dependency bump with about ten edits, then a
full desk test, because it is the shell under everything (startup, tray, deep links, single
instance, the updater's hooks). It is one load-bearing step on its own, never mixed with feature
work. CEF matters only to the Linux build.

## 9. The repo

One repo. The Mac build shares nearly all of `src/` (243 files), the Rust data half, and the docs.

Proposed, for his review (§10 F4):

```
Cargo.toml          NEW: one workspace (shared target/, one Cargo.lock)
src/  src-tauri/    the app (unchanged place)
crates/
  music-core/  apple-music/     PROVIDER-CRATES.md
  mcp-install/                  exists
cli/                            exists (could join crates/)
tools/
  deetsmeter/                   exists
  mac-probe/                    this doc's probe
  dev-bridge/ ?                 the §7 driver, if it outgrows scripts/
web/  demo/  extension/  mcpb/  the other front ends (unchanged)
assets/ ?                       app-icon*.png, art-template/, icon-template/, store-art/, swatch.html
```

## 10. The forks

### 10.1 Decided 2026-11-03 (his)
| Fork | His call |
|---|---|
| F0 Linux runtime | Tauri 3 + our own CEF build, once Tauri 3 is stable (§8) |
| F1 Module or crate | A module, `src-tauri/src/os/` |
| F2 Free functions or traits | Free functions; a trait only where there is state |
| F3 When the split starts | Once these docs are complete, in its own session |
| F4 Root cleanup | All four moves (§9) |
| F5 Glass skins | Glass, Happy, Ocean: the cards and menus (§6.1, §6.4) |
| F6 Native glass cards | A spike after window glass ships on the Mac |
| F7 Tooling | Bridge `eval` on every OS (§7) |
| CLI | In the first Mac release, with `crates/app-paths` |
| Menus | Native on the Mac, web menus as a setting (§6.5) |
| S1 Native scenes | A Mac-only follower, held by code (§6.4a) |
| Linux timing | On hold for the sound; everything else built now on Tauri 2 + WebKitGTK (§8.1) |
| D1 Shared scene part | A display list computed in the page; `crates/scene-contract` generated from `src/scene-contract.ts` (§6.4a) |
| D2 Pixel parity | In `npm run check` on a Mac and in macOS CI |
| D3 Tripwire | On (`scenes.lock`, `npm run scenes:ack`) |

### 10.2 Open
- **S2 — The menu setting (§6.5):** its name, its place in Settings, its wording.
- **S3 — Tauri 3:** when the app moves (after the Mac ships on Tauri 2 is the working assumption).

## 11. The split — as built

> **Part:** built · 2026-11-03 · steps 1–3 of 9 done (§11.4); not committed; desk test open (step 8)

The first step of the OS layer, on `macos-support`. It moves the app's Windows-only code behind
`src-tauri/src/os/`, so that a Mac file and a Linux file can be added later. Windows users see no
change. The steps, in the order he approved (2026-11-03):

1. Read the callers and write the inventory (§11.1). **Done.**
2. Make the shape: `os/mod.rs`, `os/windows.rs` (§11.2). **Done.**
3. Move the Windows calls, one caller at a time, small to large (§11.4). **Done.**
4. Move the Windows crates to `[target.'cfg(windows)'.dependencies]`.
5. Add `os/macos.rs` and `os/linux.rs` as stubs.
6. Add the check: no Windows code in `src-tauri/src` outside `os/` (DOCS-ORG.md §8).
7. Verify: `npm run check`; `cargo check` for the Windows and Mac targets.
8. This section's desk test; a WORKLOG.md entry.
9. Commit on the branch; ask him before a push.

**His calls on this step (2026-11-03):** `airplay.rs` and `lib.rs` also call Windows; both move
into the OS layer too (they were not in §4). The page's `os_caps` command waits until page code
reads it.

### 11.1 The inventory (read 2026-11-03)

Every Windows call in `src-tauri/src` outside `os/`, and where it goes. "Logic stays" means the
caller keeps the app's own rules and calls the `os::` function. "All of it" means the file has no
logic of its own: the whole file moves, and its callers call `os::` directly.

| Caller | The Windows calls | Goes to | What stays in the caller |
|---|---|---|---|
| `db_open.rs` | `MessageBoxW` (one function, already `cfg`-gated) | `os::dialog::fatal(text)` | the message text, the exit |
| `display.rs` | `MonitorFromWindow`, `GetMonitorInfoW`, `EnumDisplaySettingsW`; `window.hwnd()` | `os::display::{monitor_of, hz_of}` (take a `tauri::Window`) | the per-window memory, the event, the command |
| `net.rs` | `IcmpCreateFile` / `IcmpSendEcho` (the ping) | `os::net::ping(ip, n, timeout)` | the host lookup, the speed test, the commands |
| `settings.rs` | `reg.exe` with `CREATE_NO_WINDOW` (`reg()`): the Run key | `os::autostart::{enabled, write, command}` | the commands, the `--tray` argument |
| `log.rs` | `windows_build()` through `settings::reg` | `os::version()` | the start line |
| `velo.rs` | `CreateToolhelp32Snapshot` (`processes()`), `TerminateProcess` (`kill()`); reads the Run key | `os::process::{list, kill}`; `os::autostart::command` | the updater hooks, the feed |
| `beta.rs` | `OpenProcess` + `WaitForSingleObject` (`wait_for_exit()`) | `os::process::wait_for_exit(pid, limit)` | the pull, the copy |
| `airplay.rs` | `powershell` + `netsh` with `CREATE_NO_WINDOW` (the firewall prompt) | `os::firewall::allow_inbound_udp()` | the sender, the session |
| `lib.rs` | `ICoreWebView2Settings3` — the browser keys off (release only) | `os::window::browser_keys_off(win)` | the setup order |
| `tray.rs` | `IsWindowArranged`, `ShowWindow(SW_RESTORE)`, `ShowWindow(SW_SHOWMINNOACTIVE)` | `os::window::{unsnap, show_minimized}` | the tray, the panel, the launch show |
| `sotd/outlet.rs`, `friends.rs` | DPAPI `CryptProtectData` / `CryptUnprotectData` — two copies of the same two functions | `os::secrets::{protect, unprotect}` (one copy) | each file, its lock, its format |
| `presence.rs` | the overlapped named pipe `\\.\pipe\discord-ipc-N` | `os::discord::Pipe` (state: a trait, §11.2) | the frames, the handshake, the job thread, the commands |
| `app_icon.rs` | icon frames per DPI, the window subclass | all of it: `os::app_icon` | — |
| `identity.rs` | the sparse `.msix`, `PackageManager`, the `.lnk` app ID, `ie4uinit.exe` | all of it: `os::identity` | — (velo.rs and lib.rs call `os::identity`) |
| `gpu.rs` | WebView2 `ProcessFailed`; D3D11 / DXGI card test; the adapter watch | `os::gpu::{watch_process, card_ready, watch_adapters}` | the log line rule, the restart intent, the commands |
| `audio_out.rs` | `IMMNotificationClient`, `IAudioEndpointVolumeCallback` (the output and its notices) | `os::audio_out::{current, watch}` | `AudioOutput`, the event, the command |
| `media.rs` | other apps' session (`GlobalSystemMediaTransportControlsSessionManager`); the master volume | `os::system_media::{now_playing, transport, seek, volume, set_volume, set_mute}` | the shared types, the commands |
| `smtc.rs` | our own media session (`SystemMediaTransportControls`, the overlay) | `os::media_session::{init, update}` | — (bridge.rs and lib.rs call it) |
| `main.rs` | `windows_subsystem = "windows"` | stays: the attribute does nothing on another OS | — |

**Windows-shaped but builds anywhere** (left for the Mac step, not this one): `%LOCALAPPDATA%`
paths in `beta.rs` and `settings.rs` `cli_path`, and `.exe` names. They compile on every OS and
are wrong only at run time on a Mac.

**The Tauri calls that exist on Windows only** are edges too: `WebviewWindow::hwnd()` and
`with_webview(|wv| wv.controller())`. They move with the code that uses them.

### 11.2 The shape

```
src-tauri/src/os/
  mod.rs          picks one OS file; OsCaps and caps(); the shared types; the traits
  windows.rs      the Windows file: its CAPS and its sub-modules
  windows/        one file per edge (§11.1 "Goes to"), filled in step 3
  macos.rs        step 5: the same signatures, stub bodies
  linux.rs        step 5
```

- **Free functions** (his call F2). Each OS file has the same function names and signatures, so a
  missing function fails that OS's build.
- **A trait only where there is state.** One is needed: the Discord pipe, a handle that lives
  across calls (`os::DiscordPipe`). The media session and the audio watch keep their state inside
  the OS file (a `static`), as they do today, so they stay free functions.
- **Shared types live in `os/mod.rs`**, so each OS returns the same shape: `AudioOutput`,
  `SystemVolume`, `WinNowPlaying`, `Transport`. Their names and fields do not change: the page
  reads them as JSON. (`CardAnswer` stays in gpu.rs: the OS returns a plain tuple.)
- **The module is named `windows`**, the same name as the `windows` crate. Inside `os/mod.rs` it
  is always `self::windows`, so the two never mix.
- **`os::caps()`** returns `OsCaps`: one `bool` per edge. Windows: all true. A stub: all false.
  Nothing reads it yet; the page's `os_caps` command comes with the first page code that needs it.

### 11.3 Checking the Windows build from a Mac (set up 2026-11-03, his call)

The work runs on his Mac, and the app ships for Windows. So each move in step 3 is checked for
the Windows target on the Mac with `cargo-xwin`, for the same target that ships
(`x86_64-pc-windows-msvc`). It checks the code; it does not run the app or the tests. The tests
and the desk test still run on Windows.

```bash
cd src-tauri && XWIN_ACCEPT_LICENSE=1 cargo xwin check --target x86_64-pc-windows-msvc
```

`XWIN_ACCEPT_LICENSE=1` accepts Microsoft's license for the CRT and SDK headers that `cargo-xwin`
downloads once (to `~/Library/Caches/cargo-xwin`). He approved that on 2026-11-03.

**The one-time setup on a Mac.** The order is the order of the errors; each line fixed the error
before it.

| Need | Why | How |
|---|---|---|
| `rustup target add x86_64-pc-windows-msvc` | the Windows standard library | rustup |
| `cargo install --locked cargo-xwin` | the Windows headers for C code (`ring`'s `assert.h`) | crates.io |
| `llvm-lib` on `PATH` | the archive tool for C code | `rustup component add llvm-tools`; a link `~/.cargo/bin/llvm-lib` → the toolchain's `llvm-ar` |
| `lld-link` on `PATH` | the linker, for the CLI build below | a link `~/.cargo/bin/lld-link` → the toolchain's `rust-lld` |
| `llvm-rc` on `PATH` | the resource compiler (the exe's icon and manifest, `tauri-winres`) | `brew install llvm` (1.8 GB on disk); a link `~/.cargo/bin/llvm-rc` → `$(brew --prefix llvm)/bin/llvm-rc` |
| `cli/dist/deetsmusic.exe` | `tauri.conf.json` ships it as a resource; a missing resource fails `build.rs` | `cd cli && XWIN_ACCEPT_LICENSE=1 cargo xwin build --release --target x86_64-pc-windows-msvc`, then copy the exe to `cli/dist/` |
| `mcpb/dist/deetsmusic.mcpb` | the same rule | `scripts/mcpb-pack.mjs` calls Windows' `tar.exe`; on a Mac, run its command with `/usr/bin/tar` (the same bsdtar) |

The two staged files are git-ignored. Make them again only when `cli/` or `mcpb/` changes.

**First result (2026-11-03, steps 1–2 in the tree):** the whole app checks for Windows, with no
warning from our code.

### 11.4 Step 3, the moves — as built (2026-11-03)

Where this table and §11.1's "Goes to" column differ, this table is the code. Each row passed
`cargo xwin check` (§11.3) before the next one started; at the end, the dev and the release
profiles and `--tests` all check with no warning from our code.

| Caller | Calls now | In `os/windows/` | Notes |
|---|---|---|---|
| `db_open.rs` | `os::dialog::fatal(title, text)` | `dialog.rs` | its `cfg(windows)` / `cfg(not(windows))` pair is gone |
| `display.rs` | `os::display::{monitor, hz}` (a `tauri::Window`) | `display.rs` | the command turns its `WebviewWindow` into a `Window` |
| `net.rs` | `os::net::ping(ip, n, timeout_ms)` → the round trips | `net.rs` | |
| `settings.rs` | `os::autostart::{command, set}` | `autostart.rs` | `settings::reg` is gone; `reg()` is private to `os/windows.rs` |
| `velo.rs` | `os::autostart::command`; `os::process::{list, kill}`; `os::identity::on_*` | `process.rs` | |
| `beta.rs` | `os::process::wait_for_exit` | `process.rs` | |
| `log.rs` | `os::system::version()` | `system.rs` | the start line reads the same: the word "Windows" moved into `version()` |
| `airplay.rs` | `os::firewall::allow_inbound_udp()` (release only) | `firewall.rs` | the dev build's log-only path stays in airplay.rs |
| `tray.rs` | `os::window::{unsnap, show_minimized}`; `os::app_icon::*` | `window.rs` | |
| `lib.rs` | `os::window::browser_keys_off` (release only); `os::app_icon::*`; `os::identity::on_start`; `os::media_session::init` | `window.rs` | `mod app_icon`, `mod identity`, `mod smtc` are gone from lib.rs |
| `sotd/outlet.rs`, `friends.rs` | `os::secrets::{protect, unprotect}` | `secrets.rs` | one copy now; the two files keep their own locks and formats |
| `presence.rs` | `os::DiscordPipe` through the trait `os::DiscordIpc` (`open`, `write`, `read`, each with a deadline) | `discord.rs` | the frames, the handshake, the reply rules and the thread stay |
| `gpu.rs` | `os::gpu::{watch_process, card_test, watch_adapters}` | `gpu.rs` | the log-line rule, the events, the commands, the restart intent stay |
| `audio_out.rs` | `os::audio_out::watch(on_read)` | `audio_out.rs` | the stored value, the change log line, the event, the command stay |
| `media.rs` | `os::system_media::*` | `system_media.rs` (was media.rs, `git mv`) | media.rs keeps only its six commands |
| `bridge.rs`, `lib.rs` | `os::media_session::{init, update}` | `media_session.rs` (was smtc.rs, `git mv`) | the whole file |
| — | `os::app_icon::*`, `os::identity::*` | `app_icon.rs`, `identity.rs` (`git mv`) | the whole files; their `include_bytes!` paths are one level deeper |

**The sweep.** No `windows::`, `webview2_com`, `cfg(windows)`, `target_os`, `std::os::windows`,
`.hwnd()`, `.controller()` or `creation_flags` is left in `src-tauri/src` outside `os/`. Step 6
makes that a check.

**Behavior I kept on purpose** (each is "Windows users see no change"):
- The Discord connect still stops at once when its wait event cannot be made, and does not try
  the next pipe number. The OS file marks that error with `event: `, and `presence.rs` stops on it.
- The Run key is now read as a command (`os::autostart::command`), not as raw `reg.exe` output.
  "Is it on" and "does it point into this install" ask the same thing as before.

**Not run on this Mac:** the app, `cargo test`, `npx tsc --noEmit` and `npm test` (no
`node_modules` here, and his rule for this sitting forbids the download). Nothing in `src/`
changed.
