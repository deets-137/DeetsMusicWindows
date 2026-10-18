---
status: built
desk_test: passed 2026-10-17
sources: [src-tauri/src/identity.rs, src-tauri/src/velo.rs, src-tauri/src/media.rs, src-tauri/src/app_icon.rs, src-tauri/build.rs, src-tauri/identity/identity.json, src-tauri/identity/AppxManifest.template.xml, scripts/identity-pack.mjs, scripts/release.mjs, scripts/release-check.mjs, scripts/icons.py, docs/ops/VELOPACK.md, docs/ideas/whitelabel.md]
updated: 2026-10-17
---
# Package identity — exact-size taskbar icons for the installed app

> **Built 2026-10-16 on `shixtheenth`, live in 0.29.0; desk test passed 2026-10-17 (§9.2, his
> word).** His ask: the live taskbar button
> is small and soft, the dev one is crisp. The cause, the measurements and the spike are
> whitelabel.md §10.6. §3–§7 are the design, §8 the probes that changed it, **§9 the as-built
> record** (where it differs from the design above, §9 is the code). Not released: a release
> from the branch is his call after the desk test.

## 1. Terms

- **App ID** (AUMID): the name Windows groups a window, its taskbar button, its pins and its
  media session under. Today it is `velopack.DeetsMusic`, written by Velopack's `Update.exe` on
  the Start Menu shortcut.
- **Package identity**: a small signed package (`.msix`, a manifest and no app files) that
  Windows registers against our install folder ("packaging with external location", Windows 10
  2004+). The app's process then runs with the package's app ID,
  `<PackageFamilyName>!<ApplicationId>`.
- **Targetsize asset**: a PNG for one exact size, `Square44x44Logo.targetsize-24_altform-unplated.png`.
  A process with identity gets these on the taskbar, one per size.

## 2. What the spike proved (whitelabel.md §10.6)

- With identity, the taskbar draws the asset made for its size: **100 % the 24 asset, 0 of 576
  pixels differ; 150 % the 36 asset, 0 of 1296 differ.** At 125 % it draws the 30 asset at its
  own size, at a fractional x (soft side to side; the centered taskbar, every app alike).
- Without identity (today), Windows takes the shortcut's icon and shrinks the 32 frame (100 %,
  125 %) or the 48 frame (150 %): the head is 14×11 and soft at 100 %.
- Registration took about 2 s through PowerShell. The process read back its package app ID.

## 3. The parts

### 3.1 The identity package (release.mjs)
- One manifest per flavor: `DeetsMusic` (live) and `DeetsMusicBeta`. `Identity Name` =
  `DeetsMusic` / `DeetsMusicBeta`, so the app ID still contains "deetsmusic" (§3.6).
- `Publisher` = the Artifact Signing subject, exactly: `CN=Aditya Sundaram, O=Aditya Sundaram,
  L=San Jose, S=ca, C=US`. A different subject is a different package family, so a different
  app ID, and every pin splits again. `release-check` compares the manifest's `Publisher` with
  the signed exe's subject and refuses a mismatch.
- `uap10:AllowExternalContent`, `runFullTrust`, `unvirtualizedResources`,
  `uap10:TrustLevel="mediumIL"`, `uap10:RuntimeBehavior="win32App"`: the app runs as it does
  today, with no file or registry redirection (§8 P7 checks it).
- `AppListEntry` shown: the package is the Start entry (§3.5, after the probes).
- The package version is the identity version, not the app version: it goes up only when the
  manifest or the logos change (§3.4).
- `release.mjs`: `makepri` → `makeappx pack /nv` → `sign.mjs` → the `.msix` into the staged
  folder, so `vpk pack` ships it in `current\`. The logos and `resources.pri` go to the root of
  `current\` (the field report: a missing `resources.pri` there gives a grey plate).

### 3.2 The exe's manifest (build.rs)
- A release build embeds the `<msix publisher packageName applicationId>` element beside the
  Common-Controls dependency (`tauri_build::WindowsAttributes::app_manifest`). The Beta build
  names `DeetsMusicBeta`.
- A debug build (`tauri dev`, `dev:app`) gets no element: the dev app keeps no identity, and its
  taskbar button keeps `app_icon.rs`'s exact frames (crisp today).
- With the element but no registered package, the exe runs as an ordinary app (§8 P6).

### 3.3 The icons
- The targetsize PNGs are the city frames (whitelabel.md §10.6): 16, 20, 24, 30, 32, 36, 40,
  48, 64, 256, each made for its size. `npm run icons` writes them with the `.ico`.
- The `.ico` stays: Installed apps, Explorer, Alt+Tab and every place that reads the exe.
- The tray keeps the head alone (his words), from its own frames. Identity does not touch the
  tray: the app sets it through `Shell_NotifyIcon` from `.ico` frames. Measured by the "Tray
  icon size discrepancy" session (2026-10-16): the live `.ico`'s 20 / 24 / 32 frames hold the
  head with a margin (18×15 at (3,4) in the 24), the Beta's fill the box; so above 100 % the live
  tray head is about 75 % of the Beta's. The tray's own frames should fill the box (16, 20, 24,
  30, 32, 36), read by `tray_image()` / `refresh_tray()` from a second `icons/tray.ico`. Not
  built; part of this build or its own (his call).

### 3.4 Velopack hooks (velo.rs)
- **Install** (`--veloapp-install`, 30 s): register the package against `current\` with
  `PackageManager.AddPackageByUriAsync` and `ExternalLocationUri` (the `windows` crate, no
  PowerShell), then `ie4uinit.exe -show`. A failure logs, writes a plain Start shortcut, and
  goes on (§3.5, §3.7).
- **Updated** (`--veloapp-updated`, 15 s; it adds to the 2.44 s update): register again only
  when the shipped identity version is above the registered one, or nothing is registered. Most
  updates do nothing here, so the update stays fast. A new logo set bumps the identity version.
- **Uninstall** (`before_uninstall`): remove the package (`RemovePackageAsync`). Velopack then
  deletes every shortcut into the root and the folder.
- **Every start of a release build**: if the process has no identity (`GetCurrentPackageFullName`
  fails) but the package is expected, register it in the background and log it. This heals an
  install that missed a hook, and covers the update that first brings identity (the updated hook
  runs the new exe, so it registers there too). The identity takes effect at the next start.

### 3.5 Shortcuts and pins
- The window's app ID becomes the package's. Velopack's shortcut (`velopack.DeetsMusic`) and
  every existing pin no longer group with the window: the pin starts the app, and the window
  opens a second button beside it. F2 and F3 decide how we close that gap.
- **Revised after the probes (2026-10-16, §8):** no `.lnk` may carry the package app ID. Any
  shortcut that does (in Start, and so a pin) makes the taskbar draw that shortcut's icon, the
  exe's, shrunk (tests B and T2). So:
  - **The Start entry is the package's own** (`AppListEntry` shown): Start lists "DeetsMusic"
    with the package logos, and Installed apps shows nothing extra (P10, his look). `vpk pack
    --shortcuts None`, so Velopack makes no shortcut.
  - **A pin is the package's own**: right-click the running button › Pin to taskbar makes a
    packaged pin (no `.lnk`), exact closed and running, one button (P4).
  - **The first start with identity removes Velopack's old Start shortcut** (target inside the
    install root), or Start shows two DeetsMusic entries. Velopack never deletes it on an
    update (P1, source).
  - **No identity (§3.7) → keep a plain Start shortcut**: the install hook and each start
    without identity make sure one exists, with Velopack's ID, so Start always has the app.
  - `--aumid` stays Velopack's default. Under identity the package ID wins (tests A, X), and
    the default keeps Velopack's per-update rewrite away from the package ID.
  - After a registration, `ie4uinit.exe -show`: the shell caches the icon per app ID, and a
    stale entry stays until it is refreshed (seen after test T2).
  - Old taskbar pins are F3 (re-opened).

### 3.6 Everything that reads the app ID
- `media.rs` `is_self`: matches "deetsmusic" in the app ID. The package app ID
  `DeetsMusic_<hash>!DeetsMusic` contains it: no change (the spike's did too).
- The media flyout and the volume mixer: they name and draw the app from the package
  (`DisplayName`, the logos) instead of the shortcut. §8 P9 looks at both.
- Notifications: the app sends none through Windows today (no notification plugin).
- The deep link (`register_all()`), start with Windows (the Run value), the data folders, the
  single-instance lock: none reads the app ID. §8 P7 checks the first three under identity.

### 3.7 When identity cannot be had
- Windows older than 10 2004, sideloading blocked by a policy, a failed registration: the app
  runs as today, with the soft button. One `diag` line, no toast, no setting. The icon is a look,
  and a notice about it would only cost the user attention.

### 3.8 Docs and checks
- RELEASE.md: the identity package in the build and the signing; VELOPACK.md §3 (the app ID
  line is wrong after this); this doc's as-built section; a release-notes line for the pin
  (F3).
- `release-check`: the `Publisher` match (§3.1), the logos and `resources.pri` in the stage,
  the manifest's `<msix>` element in the release exe.

## 4. What this does not change

- The install folder, the update feed and its signature, the Installed apps entry (Velopack's;
  the listed identity package adds none, P10).
- The dev app.

## 5. Risks

- **The signing subject.** If Artifact Signing's subject changes (a new identity validation, a
  new address), the package family changes and pins split again. The `release-check` match
  stops the build; the fix then is a deliberate migration, not a silent one.
- **Unsupported tricks.** Rewriting a pinned shortcut (F3 B) is not a documented interface.
- **The 125 % softness stays.** It is the taskbar's own placement, the same for every app.

## 6. Order of work

1. The probes (§8), on the Beta install, Claude alone. 2. His calls on F1–F3. 3. The build on
a branch: icons, build.rs, release.mjs, velo.rs, docs. 4. A Beta release and his desk test
(install, update, pin, uninstall). 5. Live.

## 7. The forks (his)

> **His calls (2026-10-16): F1 A, F2 A, F3 A** ("1-3A works"). F3 A rests on probe P5; if P5
> fails, F3 comes back to him.
>
> **Re-opened the same day by the probes (§8).** F1 A (our shortcut with the package ID) gives
> the soft icon (test B), and so does F3 A (an old pin rewritten to the package ID, test T2).
> F1 now has one working option, the package's own Start entry (§3.5), and F2 follows from it
> (remove Velopack's old shortcut). F3 is open again: see F3′ below.

**F3′. Old taskbar pins** (a `.lnk` with `velopack.DeetsMusic`; they start the app but no
longer group with its window). **His call (2026-10-16): A.**
- **A (recommended): a one-time notice with a button.** "Pin DeetsMusic again for the sharp
  icon: right-click its button › Pin to taskbar." The button removes the old pin
  (`IStartMenuPinnedList::RemoveFromList`, the call Velopack uses; P5′ checks it unpins the
  taskbar on Windows 11). The user acts once and consents to the removal.
- **B: remove the old pin silently, then the same notice.** Cost: a user who ignores it has no
  pin.
- **C: leave it.** Cost: two buttons, and the user does not know why.

**F1. The Start Menu entry.**
- **A (recommended): our own shortcut.** `vpk pack --shortcuts None`; the install hook writes
  `Start Menu\Programs\DeetsMusic.lnk` with the package app ID; the uninstall hook removes it.
  The package stays hidden (`AppListEntry="none"`). One entry in Start and one in Installed
  apps, as today. Cost: we own the shortcut's life (install, the first update, uninstall).
- **B: the package's own Start entry** (`AppListEntry` shown, no Velopack shortcut). Windows
  draws Start from the package logos. Cost: the package may show a second Installed apps entry
  whose Uninstall removes only the identity (§8 P10 decides if it shows).
- **C: keep Velopack's shortcut and rewrite its app ID at each start.** Cost: `Update.exe`
  writes `velopack.DeetsMusic` back on every update, so after each update the Start entry and
  the window disagree until the app starts once more.

**F2. The first update for a current user** (the one that brings identity).
- **A (recommended): the update replaces Velopack's Start shortcut with ours**, in the same
  start that registers the package. If §8 P1 shows Velopack deletes its own shortcut when the
  new version says `None`, ours is simply the only one.
- **B: leave Velopack's shortcut until the user reinstalls.** Cost: Start opens a window that
  does not group with what Start shows.

**F3. Existing taskbar pins** (his own pin, every user who pinned).
- **A (recommended, if §8 P5 passes): rewrite the old pin's app ID** in `User Pinned\TaskBar`
  once, on the first start with identity. The user sees one button, as before. Cost: not a
  documented interface; P5 must show the taskbar takes it (maybe only after Explorer restarts).
- **B: a one-time notice** — "Pin DeetsMusic again for the sharp icon" — with the old pin left
  as it is. Cost: two buttons until the user acts; one notice.
- **C: say nothing.** Cost: two buttons, and the user does not know why.

## 8. The probes before a build (Claude, on the Beta install)

| # | Question | How |
|---|---|---|
| P1 | Does a Velopack update to a `--shortcuts None` package delete the old shortcut? | Two Beta builds, the second with `None`; update; list Start |
| P2 | Does the registration survive Velopack's swap of `current\`? | Register, update the Beta, read the process's package name |
| P3 | Does a Start shortcut carrying the package app ID group with the window and pin crisp? | Write it, start from Start, pin from Start, capture the taskbar |
| P4 | With `AppListEntry="none"`, can the user pin the running button, and does it group after a restart? | Right-click the button, pin, restart, capture |
| P5 | Does rewriting an old pin's app ID merge it with the window? | Rewrite, restart Explorer if needed, capture |
| P6 | Does the exe with `<msix>` run as an ordinary app when nothing is registered? | Remove the package, start the exe |
| P7 | Under identity: the data folders, the deep link key and the Run value are where they are today | Read them before and after |
| P8 | Does the uninstall leave no package and no shortcut? | `Get-AppxPackage`, Start, Installed apps |
| P9 | The media flyout and the volume mixer: name and icon | Play a song, open both, capture |
| P10 | With `AppListEntry` shown: does a second Installed apps entry appear? | Register a variant, look |

Each probe's result goes in this table with its date before the build starts.

### 8.1 Results (2026-10-16, Claude; the spike in `../DeetsMusic-identity/spike/`)

Setup: the Beta 0.28.0-beta.6 exe with the `<msix>` element, in a Velopack layout
(`spike/root/Update.exe`, `spike/root/current/`), so Velopack's startup runs as installed; the
identity package registered through WMI; every taskbar check is `match.py` on a per-monitor-v2
capture (0 differing pixels = the asset drawn 1:1).

| # | Result |
|---|---|
| P1 | **No (source, Velopack 1.2.161 `shortcuts.rs`).** On every update `Update.exe` scans Desktop, Startup, Start Menu and **User Pinned** for `.lnk` files whose target is in the install root, resets their target, icon and app ID (the package's `shortcutAumid`, `vpk --aumid`, default `velopack.<packId>`), and only ADDS locations new to this version. It never deletes one. So the first identity start must remove Velopack's Start shortcut itself. |
| P2 | **Pass.** The install folder renamed away and a copy put in its place: the new exe started with the identity, and the 24 asset still drew 1:1. Registration follows the path. |
| P3 | **Fail, as designed in F1 A.** A Start shortcut carrying the package app ID: the window groups with it, but the taskbar then draws the SHORTCUT's icon (the exe's, shrunk: 339 of 576 pixels differ). Same with the package listed in Start (T2). |
| P4 | **Pass (his click).** Pinned from the running button: closed, the pin is the 24 asset 1:1; after a restart the window takes the same button, 1:1. No `.lnk` is written to `User Pinned`. Tested with the package listed in Start. |
| P5 | **Fail for F3 A** (follows from P3 / T2): an old pin rewritten to the package ID would draw soft. |
| P5′ | **Pass (his pin of the Beta from Start).** `IStartMenuPinnedList::RemoveFromList` on the Beta's Start `.lnk` (STA thread; the item passed as an `IShellItem`) returned 1 (S_FALSE), and `DeetsMusic Beta.lnk` left `User Pinned\TaskBar`. The Beta was running, so its button stayed until it closed; closed, the button was gone. So F3′ A's button can remove the old pin. |
| P6 | **Pass.** Nothing registered: the exe runs as an ordinary app (`GetPackageFullName` 15700). |
| P7 | **Pass.** Under identity the app wrote the real `%APPDATA%` and `%LOCALAPPDATA%` data folders, and its start rewrote the real `HKCU\…\deetsmusic-beta` deep link. The Run value is the same kind of HKCU write (not set during the test). A `%LOCALAPPDATA%\Packages\<family>\Settings` folder appears at registration (two small system files). |
| P8 | **By source:** Velopack's uninstall deletes every `.lnk` that points into the root; our hook removes the package. Not run end to end; the Beta desk test does it. |
| P9 | **Not run** (it needs a song playing). The Beta desk test looks at the media flyout and the volume mixer. |
| P10 | **Pass (his look).** With the package listed in Start, Settings › Installed apps shows no entry for it. |
| A, X | Velopack sets the process's explicit app ID at start (proved by a control run without identity: the window grouped with the Beta's Start shortcut and drew its soft icon). With identity, the package's ID wins whatever Velopack sets (`velopack.DeetsMusicBeta` or an unrelated ID): the 24 asset 1:1 both times. |
| cache | After a shortcut with the package ID was removed, the button stayed soft until `ie4uinit.exe -show`; then 1:1. |

Cleaned up 2026-10-16: the spike package removed (its `Packages` folder, its Start entry and
his test pin went with it), the test shortcut removed, the Beta's deep link pointed back at the
installed Beta, `ie4uinit.exe -show`. His Beta pin was removed by P5′. The spike files stay in
the worktree (uncommitted) for the build.

## 9. As built (2026-10-16, branch `shixtheenth`)

> **His call during the build (2026-10-16): no old-pin notice** ("I'm the only user for now").
> F3′ A is not built; he pins the new button by hand once. If other users arrive before the
> release, F3′ comes back (P5′ proved the unpin call).

### 9.1 The parts
- **`scripts/icons.py`** (`npm run icons`) makes every icon from three sources in
  `icon-template/`: `deets-head-32.png`, `deets-head-16.png` and **`deets-city-600.png`** (his
  Discord server icon). A city frame is a square crop of the art (480 px at (60, 45); the 30
  frame takes the whole art, the 36 the 360 px around the head) shrunk with a box filter, his
  head laid on top nearest-neighbor. Writes:
  - `src-tauri/icons/icon.ico`: 16 and 20 the head alone; 24, 30, 32, 36, 40, 48, 64, 256 the
    city. Every frame read back.
  - `src-tauri/icons/tray.ico` (new): the head alone, as large as the box takes: 16 his 16;
    20 the head 1:1; 24 ×4/3; 30 ×5/3; 32 his 16 ×2; 36 ×2. The other session's finding
    (§3.3) is built here.
  - `src-tauri/identity/Assets/`: `Square44x44Logo.targetsize-N` (plain and
    `_altform-unplated`) for 16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256 (the head
    alone below 24), `Square44x44Logo` and `Square150x150Logo` at scale 100 and 200,
    `StoreLogo`.
  - The PNG set (`32x32` … `icon.png`, `app-icon.png` 1024, `mcpb/icon.png`) is the city; the
    extension's toolbar icons stay the head.
- **`app_icon.rs`**: the tray and a window's SMALL icon (Alt+Tab) read `tray.ico`
  (`CreateIconFromResourceEx` on the frame's own bytes); the BIG icon (the taskbar button of a
  window without identity: the dev app, or a failed registration) stays the exe's `icon.ico`,
  now the city.
- **`src-tauri/identity/identity.json`**: the identity version (1.0.0.0), the publisher, the
  live and Beta names. One source for `build.rs`, `identity-pack.mjs`, `identity.rs` and
  release-check 12.
- **`build.rs` `identity_manifest()`**: a release profile build embeds Tauri's manifest plus
  `<msix publisher packageName applicationId>` (`WindowsAttributes::app_manifest`); the Beta
  flavor (`DEETSMUSIC_FLAVOR=beta`) its own names. A debug build gets none. Note: `dev:built`
  is a release profile build, so its exe carries the element; it runs from `target\release\`,
  which no package points at, so it runs as an ordinary app (P6).
- **`src-tauri/identity/AppxManifest.template.xml` + `scripts/identity-pack.mjs`**: fills the
  manifest, copies the logos, `makepri` → `resources.pri`, `makeappx pack /nv`, signs with
  `sign.mjs`, and puts the `.msix`, `Assets\` and `resources.pri` in the stage.
  `AppListEntry` is left at its default (shown). Checked alone 2026-10-16: a valid signature,
  the manifest's names right.
- **`release.mjs`**: runs `identity-pack.mjs` after the stage is filled; `vpk pack
  --shortcuts None`.
- **`identity.rs`** (new): `on_install`, `on_updated`, `on_uninstall` (wired in `velo.rs`'s
  builder and `before_uninstall`) and `on_start` (lib.rs setup, on `spawn_blocking`). Only an
  installed release build acts (`current\` beside `..\Update.exe`, with the `.msix` in it).
  Registration through `PackageManager.AddPackageByUriAsync` with `ExternalLocationUri`, then
  `ie4uinit.exe -show`. With identity at start: remove the Start shortcut when it points into
  the install (Velopack's from 0.28, or our fallback). Without: register (effective next start)
  or, on failure or when registered yet not applied, write a plain Start shortcut with
  Velopack's app ID. Hook lines go to `crate::log`, which is not open in a hook run, so the
  start's own lines are the record (`identity: running as DeetsMusic [1, 0, 0, 0]`).
- **`release-check.mjs` check 12**: the `.msix` is signed and its subject equals
  `identity.json`'s publisher; the full package holds `resources.pri` and the 24 logo; the exe
  carries the `<msix>` element for the flavor.
- **Cargo**: `windows` features `ApplicationModel`, `Management_Deployment`,
  `Win32_Storage_Packaging_Appx`, `Win32_Storage_EnhancedStorage` (no new crate).

### 9.2 Desk test (his; on the Beta first if he wants, else live)
1. `npm run release` (or `-- --beta`), install over the current version from a WMI-started
   process (VELOPACK.md). Expect the app to start with identity at once: the log line
   `identity: running as …`; Start lists DeetsMusic with the city, once (the old Velopack
   shortcut gone).
2. The taskbar button at 100 %, 125 % and 150 %: the city, the 24 / 30 / 36 logo (a capture
   and `match.py` from the spike, or his eye).
3. Unpin the old button; right-click the running button › Pin to taskbar; close and start
   again: one button, the city, closed and running.
4. The tray at 100 / 125 / 150 %: the head filling the box. Alt+Tab: the head.
5. Play a song: the media flyout and the volume mixer show DeetsMusic with the city (P9).
6. An update to the next version: the app keeps its identity (the updated hook does nothing
   unless the identity version rose).
7. Uninstall (the Beta is the safer place): no package left (`Get-AppxPackage DeetsMusic*`),
   no Start entry (P8).

### 9.3 What Claude decided inside his calls (for his review)
- The tray frames' scales (20 1:1, 24 ×4/3, 30 ×5/3, 32 his 16 ×2, 36 ×2) and the small window
  icon moving to them (Alt+Tab shows the head, as the tray does).
- The 16 / 20 frames of the exe icon and the logos stay the head alone (a city is unreadable
  there).
- The PNG set and `mcpb/icon.png` became the city; the browser extension's icons did not.
- The Beta's package uses the same city logos (its own look is still open, whitelabel.md).
- The identity version is separate from the app version, raised by hand when the logos change.
