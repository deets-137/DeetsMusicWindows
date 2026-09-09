# Tray panel + minimize-to-tray

> Design agreed 2026-09-08. Status: **built, awaiting first user test.** Code:
> `src-tauri/src/tray.rs` (icon, menu, window policy), `src-tauri/src/media.rs` (Windows
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
- **Right-click → *Open DeetsMusic* = the real app**: Rust emits `tray-open` → the page
  switches to the **full surface** (`deets.surface.full`: midi, or max if that was the
  last non-mini choice) → `tray_place_main` restores the pre-pop position and shows it
  **pinned** (no hide-on-blur). A window that's already visible and pinned just gets
  focus. Picking a surface from the title menu also pins (`tray_pin_main`).
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
webview registers its own SMTC session via media-session.ts) and prefers a *playing*
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

## 5. Later
- Theme/skin pre-paint on the panel already follows the shared `deets.theme` / `deets.skin`
  keys (same origin); live changes ride the `appearance` event.
- "Read Windows media" is only in the tray menu; a mirror in the Settings card when that
  card lands (HANDOFF → Next up #1).
- Per-app volume for the Windows source would need the WASAPI session enumerator
  (`IAudioSessionManager2`) matched by process — skipped for v1.
