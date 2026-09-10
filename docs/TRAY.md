# Tray panel + minimize-to-tray

> Design agreed 2026-09-08. Status: **built and user-tested** through 0.1.3; the window
> lifecycle (§6) landed 2026-09-09 after the pinned-taskbar bug. Code:
> `src-tauri/src/tray.rs` (icon, menu, window policy, single-instance activation),
> `src-tauri/src/lib.rs` (the single-instance plugin), `src-tauri/src/media.rs` (Windows
> media session + master volume), `tray.html` + `src/tray.ts` (the panel),
> `src/np-bus.ts` + `bridge.rs` `Hub` (state relay), `src-tauri/src/settings.rs`.

## 1. Shape (DeetsRGB / DeetsAirplay lineage)

- **Tray icon** — the DM mark (`app-icon.png`, transparent, scarlet D + burgundy M →
  `npx tauri icon`; same family as DeetsAirplay's DA / DeetsRGB's DR).
- **Left-click pops the app itself** (decided 2026-09-09, the DA/DR model): Rust emits
  `tray-pop` → `main.ts` switches to the **mini surface** (`applySurface("mini")`, which
  resizes the window) → `tray_place_main` anchors the window's bottom-right corner at the
  click, clamped to the monitor, and shows it. A window popped this way is a **flyout**:
  it hides on focus loss (release builds only, like the panel — devtools steal focus in
  dev) and a second left-click hides it. A blur within 500 ms of showing is ignored (it's
  the tray/menu click itself resolving, not the user clicking away). The 300 ms re-pop
  guard stops the click that blurred it from re-opening it. If the *real* window was
  visible when the pop happened, its position is remembered. The flyout is **off the
  taskbar** (`set_skip_taskbar(true)` on pop, back to `false` on Open / pin) and always
  opens at mini's **default** size (`applySurface("mini", true)`) — a fixed panel like
  DA's, so a remembered mini size from narrowing the app window can't stretch it.
- **Right-click → *Open DeetsMusic* = the real app**: `show_main` **hides the window
  first**, then emits `tray-open` → the page switches to the **full surface**
  (`deets.surface.full`: midi, or max if that was the last non-mini choice) and resizes
  while hidden → `tray_place_main` restores the position, shows, and leaves it **pinned**
  (no hide-on-blur). The hide is what makes it one clean cut: resizing and moving a
  *visible* window made the flyout visibly grow and travel across the screen. It
  deliberately does not route through `hide_main`, whose `main_hidden_at` would make the
  re-show look like a fresh hide to the 300 ms re-pop guard. A window that's already
  visible and pinned just gets `unminimize` + focus. Picking a surface from the title menu
  also pins (`tray_pin_main`).
- **The position is remembered across × and across restarts** — `remember_pos` writes it to
  both `Inner.restore_pos` and `settings.json` (`windowPos`), and `restore_window_pos` reads
  it back at startup, discarding a position that no longer lands on any connected monitor.
  It is captured on a pop *and* in `hide_main`, but **never while popped**: a popped window
  sits at the tray anchor, and recording that as the real position is what used to strand
  the full window in the bottom-right corner after × → tray-click → Open.
- **Right-click menu**: *Open DeetsMusic* · *Now Playing panel* · ☑ *Read Windows media* ·
  (dev: *Panel devtools*) · *Quit DeetsMusic*. *Now Playing panel* anchors the panel at the
  last tray click.
- **Mini composition so far** (`[data-surface="mini"] .bento`): one wide column — Now
  Playing, then the *left* slot's card; the right slot is hidden. Being built piece by
  piece, user-led.
- **Panel** — a second, always-alive frameless webview window (label `tray`, `tray.html`,
  360 px wide, **height fitted to content** via `tray_panel_resize`, skip-taskbar,
  always-on-top, hidden on blur in release). Kept alongside the mini pop for now; its
  Windows-media source and volume row are candidates to migrate into mini once mini is
  designed. It reuses the app's `.titlebar` / `.panel` /
  `.np` / `.scrub` classes verbatim, so every theme × skin renders it exactly like the Now
  Playing card; the deltas (`.tray__*`) are a source badge, a time readout, the **+**, and a
  horizontal volume row.
- **Minimize to Tray** — title-menu toggle, **default on**, stored in
  `<app_data>/settings.json` (Rust owns it because the close policy runs before any JS
  could answer). On: **×** hides the main window to the tray and playback keeps running (a
  hidden WebView2 still plays). Off: × quits as before. The minimize light is untouched.

## 2. Sources

| Priority | Source | Data | Transport | Volume | + |
|---|---|---|---|---|---|
| 1 | **DeetsMusic** — whenever the app holds a current item (playing *or* paused) | hub `np` event | `np_command` → `np-command` event → main window (MusicKit) | app software gain (`setVolume`) | `add-to-library` command → `addTrackToLibrary` in the main window |
| 2 | **Windows media session** (GSMTC) — when DeetsMusic is idle **and** the *Read Windows media* toggle is on | `win_media_now_playing`, polled 1 Hz **only while the panel is visible** | `win_media_transport` / `win_media_seek` on that session | **system master** level (`IAudioEndpointVolume`) — a GSMTC session has no per-app volume | `bridge_resolve` once per (title, artist) → best candidate (score ≥ 0.45) → `bridge_add` |
| – | idle | "Not playing" | – | system | hidden |

The Windows reader skips our own process (`deetsmusic` / `msedgewebview2` AUMIDs — the
app registers its own SMTC session natively, `smtc.rs`) and prefers a *playing*
foreign session. Position is interpolated from the session's `LastUpdatedTime`, since
apps report it sparsely. Thumbnails come back as data URLs, cached per track.

## 3. The hub (Rust in the middle)

```
main window ──np_publish (state+progress+volume, ≤1/s)──▶ bridge::Hub ──emit "np"──▶ tray panel
main window ◀──emit "np-command"──────────────────────── bridge::Hub ◀──np_command── tray panel
main window ──appearance_publish (theme, skin)──────────▶ Hub ──emit "appearance"──▶ tray panel (+ /health)
bridge /add ──emit "library-changed"────────────────────▶ main window reloads the track store
```

Rust holds the last state so the panel can `np_snapshot` on show, and `/now-playing` on
the bridge shows exactly what the panel sees (debug). The panel never imports player /
queue / MusicKit code; `tray.ts` is a pure consumer.

## 4. Debug
- Panel: `__diag` (the app's ring log) is live on the tray window; `__tray.state()` dumps
  source / deets / windows / settings / candidate; `__tray.poll()` forces a Windows read.
  Dev builds: tray menu → *Panel devtools*.
- Bridge: `GET /now-playing` (with the pairing token) or the app's *Copy bridge log*.

## 5. Window lifecycle — one instance, one window

Added 2026-09-09. The tray flyout runs with `set_skip_taskbar(true)`, so while it is up the
app has **no taskbar button**. Windows matches a pinned shortcut to a running window by
identity (for a plain desktop app, the exe path), finds nothing to match, and treats a click
on the pin as *launch*. A minimize-to-tray × does the same — a hidden window has no button
either.

The result was a **second process**, and it was not inert: a second tray icon, a second writer
on the same SQLite file, and a bridge that failed over to port 47826 (`bridge.rs` `PORTS`), so
the extension and the MCP server could end up driving the wrong process.

**`tauri-plugin-single-instance`, registered FIRST in the builder** (`lib.rs`). The position is
load-bearing, not style: a later registration lets the duplicate run setup — open the database,
take a port — before it is told to die. Its callback is one call, `tray::show_main`, so a
pinned-button click is the same path as the menu's *Open DeetsMusic*: a flyout un-pops to its
full surface and back onto the taskbar, and a window hidden to the tray returns.

The guard's mutex name derives from the **app identifier**, so `com.deetsmusic.dev` keeps its
own — `npm run dev:app` still runs beside the installed app. A plain `npm run tauri dev` shares
`com.deetsmusic.app`, and therefore shares the guard and the data dir, with the installed build.

Known limits, both accepted:

- While the flyout is up the pin shows **no running mark**, because there is still no taskbar
  button. That is the cost of the off-taskbar flyout; single-instance fixes the *click*, not
  the icon state.
- A **debug** build shows a console window for the turned-away duplicate: it starts, finds the
  mutex, exits. `main.rs` suppresses the console under `not(debug_assertions)`, so release
  builds show nothing.
- A dev build gets its **own taskbar button** beside the pin — different exe path, different
  identity. Two DeetsMusic icons in dev is expected, not a duplicate process.

## 6. Later
- Theme/skin pre-paint on the panel already follows the shared `deets.theme` / `deets.skin`
  keys (same origin); live changes ride the `appearance` event.
- "Read Windows media" is only in the tray menu; a mirror in the Settings card when that
  card lands (HANDOFF → Next up #1).
- Per-app volume for the Windows source would need the WASAPI session enumerator
  (`IAudioSessionManager2`) matched by process — skipped for v1.
