---
status: designed
desk_test: none
sources: [tools/mac-probe/run.mjs, tools/mac-probe/page/index.html, tools/mac-probe/page/glass.html, tools/mac-probe/src-tauri/src/glass.rs, tools/mac-probe/src-tauri/src/main.rs, src/player.ts, src/sound.ts, src/platform.ts, src-tauri/Cargo.toml, src-tauri/src/smtc.rs, src-tauri/src/media.rs, src-tauri/src/tray.rs, src-tauri/src/airplay.rs, src-tauri/src/presence.rs, src-tauri/src/velo.rs, src-tauri/src/gpu.rs]
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

The work:
1. **`os/linux.rs`** — the right-hand column of §4.
2. **Our CEF build** — a reproducible script, its output cached for CI; a CEF update is a
   release step. The download is ~1 GB per platform the first time.
3. **The runtime pick** — `tauri-runtime-cef` for the Linux target only, and
   `#[tauri_runtime_cef::cef_entry_point]` on `main` for that target.
4. **Packaging** — an AppImage first (the CEF page notes that some distributions restrict the
   AppImage sandbox); Flatpak later.
5. **The tooling** — the bridge `eval` route (§7) works as on the other OS; CEF also speaks CDP.

**Done means:** an AppImage that signs in, plays a song past 30 s, takes media keys (MPRIS),
and updates; Linux ships as beta (LinuxPort.md §13.5).

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

### 10.2 Open
- **S1 — The native scenes (§6.4):** a Mac-only follower (Windows untouched), or one native
  renderer for every OS.
- **S2 — The menu setting (§6.5):** its name, its place in Settings, its wording.
- **S3 — Tauri 3:** when the app moves (after the Mac ships on Tauri 2 is the working assumption).
