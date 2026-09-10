# DeetsMusic — AirPlay (play on a HomePod)

> Scoped and **built 2026-09-10** on branch `release-prep`; **connected and played on the desk**
> the same day. Source of the sender: `../DeetsAirplay` (public repo `deets-137/DeetsAirplay`),
> now a library crate, `crates/airplay` (`deets-airplay` 0.2.0). Read its `CLAUDE.md` "Never"
> list before touching any wire code. Code here: `src-tauri/src/airplay.rs` (the session,
> metadata, commands), `src/airplay.ts` (the "Play on" panel, the volume takeover), the AirPlay
> row in `settings-card.ts`, `settings.rs` (three fields), `player.ts` (`setVolumeSink`).
>
> **v1 ships "All PC sound" only** (user's call, 2026-09-10 evening, §10): the speaker gets the
> default output's loopback, the PC keeps playing. The per-process path ("DeetsMusic only")
> works from the probe but waits for v2. Before shipping (§9): flip the Cargo dependency from
> `path` to `git` once the crate is pushed, and confirm the first-connect UAC prompt on an
> installed build.

## 1. What the user sees (the words)

No protocol words anywhere in the UI. "AirPlay" appears only as the button's tooltip and the
Settings section title, because that is the word on the HomePod's box.

| Where | What |
|---|---|
| The AirPlay square (next to the volume slider) | Idle: outlined glyph. Connected: filled glyph. Connecting: pulses. |
| The dropdown ("Play on") | `This computer ✓` then one row per speaker found: name + a small model line ("HomePod"). The last-used speaker shows even before the scan finds it. Footer line: "Looking for speakers…" / "No speakers found" + a Scan again row. Clicking a speaker connects; clicking the ticked one does nothing; clicking "This computer" disconnects. |
| State line under the list | "Connecting to Living Room…" → "Playing on Living Room" → "Lost Living Room" (when the speaker drops). Failure: "Couldn't reach Living Room. Check that it is on the same Wi-Fi." |
| The volume slider (pill + stage row) | While on a speaker, it moves the **speaker's** volume, and follows Siri / the HomePod's touch surface (polled every ~2 s). See fork 4. **A speaker starts at 20 % the first time** (`AIRPLAY_FIRST_VOLUME`, set during the handshake, before audio flows) and **comes back at whatever it was last left at** (`airplaySpeakerVolumes` in `settings.json`, by speaker name; written on every slider change and on every polled Siri change). |
| The HomePod's touch surface / Siri | Play, pause, next, previous drive DeetsMusic itself (`np-command` on the main window, the tray panel's existing path). |
| First connect ever | One plain sentence, then the Windows permission prompt: "Windows needs to let the speaker talk back to DeetsMusic. Click Yes on the next prompt." (fork 6) |
| Settings › AirPlay | The preferences (fork 5). Never live actions. |

## 2. What carries over from DeetsAirplay

Verbatim into a **shared library crate** in the DeetsAirplay repo (`crates/airplay/`, name
to confirm), which both apps depend on:

| DeetsAirplay file | Role | Notes |
|---|---|---|
| `airplay/mdns.rs` | find speakers | 2.5 s browse; returns `Speaker` (name, ip, port, model, txt) |
| `airplay/rtsp.rs`, `pairing.rs`, `tlv8.rs`, `bplist.rs` | handshake + control channel | untouched |
| `airplay/alac.rs`, `rtp.rs` | audio packets, timing | untouched |
| `airplay/session.rs` | `connect() → Session` (pacer, timing, control, events, keep-alive threads), `set_volume`, `receiver_volume_pct`, `stats`, `alive`, `disconnect` | already source-agnostic (`Source = Box<dyn FnMut(&mut [i16])>`) |
| `crypto/*` | SRP, HKDF, ChaCha20-Poly1305, RNG | untouched |
| `capture.rs` | WASAPI loopback of the default output = "everything the PC plays" | becomes the secondary source (a setting) |
| `airplay/mod.rs` `log` / `log_to_file` | session log | file becomes `<app_data>/airplay.log` in DeetsMusic |
| `lib.rs` (pieces, **ported not shared**) | `latency_frames` + the Auto retune (10 s of RTT, settle once), dead-session sweep, receiver-volume follow, connect/reconnect/stop, `firewall_add_rule` (one UAC via netsh) | goes into a new `src-tauri/src/airplay.rs` in DeetsMusic |
| `store.rs` fields | last speaker, latency mode, sync offset, firewall seeded | join DeetsMusic's Rust `settings.json` (the session lives in Rust, so Rust must read them without JS) |
| `bin/probe.rs` | desk probe | stays in DeetsAirplay, re-pointed at the crate |

**Not carried:** DeetsAirplay's tray/panel, autostart, `media.rs` (DeetsMusic drives its own
player), its front-end.

Crate deps: `num-bigint`, `sha2`, `chacha20poly1305`, `windows 0.61` (same major as
DeetsMusic, so Cargo unifies; the crate declares its own feature list).

## 3. New code

1. **Per-process capture** (`capture_process.rs`, ~150 lines, in the shared crate).
   `ActivateAudioInterfaceAsync` with `AUDIOCLIENT_ACTIVATION_PARAMS` (target = our own
   PID, `INCLUDE_TARGET_PROCESS_TREE`). The sound comes out of `msedgewebview2.exe`, a child
   of `deetsmusic.exe`, so the tree flag covers it. Same ring + same `Source` shape as
   `capture.rs`; the pacer already pads silence when the app is idle. Needs the `windows`
   crate's `implement` feature for the completion handler.
2. **`src-tauri/src/airplay.rs`** in DeetsMusic: `AirplayState { live, speakers }`, commands
   `airplay_scan`, `airplay_connect`, `airplay_disconnect`, `airplay_status`,
   `airplay_volume`, `airplay_set_prefs`; all on `spawn_blocking`. Remote commands go out as
   `emit_to("main", "np-command", …)`.
3. **`src/airplay.ts`** (typed invokes; a 1 s status poll only while the dropdown is open or
   a session is live) + the dropdown on the AirPlay square (`makeDropdown`) + the Settings
   rows. Tokens only: new skin tokens for the row, dot and pulse; colours via theme roles.
4. **Optional, later:** now-playing title/artist/cover to the speaker (`SET_PARAMETER`,
   DMAP). DeetsAirplay never built it; the HomePod itself shows nothing, the Home app does.

## 4. Known facts that shape the forks

- A per-process loopback is a **tap**: the PC keeps playing too. DeetsAirplay measured that
  the *system* tap sits before the endpoint volume (system mute = silent PC, stream still
  full). Whether a *per-process* tap sits before the app's own session volume (the Windows
  per-app mixer) is **unknown until tested on the desk**.
- `DeetsAudioDriver` (the dedicated virtual output) is tabled pending an EV certificate; the
  desk cannot load it (Secure Boot). Not an option for v1.
- The HomePod sends unsolicited UDP; without an inbound firewall rule the connect stalls.
  The rule needs UAC. The DeetsMusic installer is per-user with no admin prompt.
- Dev builds need a manual rule once:
  `netsh advfirewall firewall add rule name="DeetsMusic dev" dir=in action=allow protocol=udp program="<repo>\src-tauri\target\debug\deetsmusic.exe"`
- Both repos are public. A `path` dependency on `../DeetsAirplay` breaks `cargo build` for
  anyone who clones DeetsMusic alone.

## 5. Decisions (user's picks, 2026-09-10 — do not re-raise)

1. **Dependency form: git.** `airplay = { git = "https://github.com/deets-137/DeetsAirplay",
   rev = "…" }` in `src-tauri/Cargo.toml`. While developing, a gitignored
   `src-tauri/.cargo/config.toml` holds a `[patch]` to `../../DeetsAirplay/crates/airplay`.
   The installed exe is identical either way; this only affects building from source.
   (Duplicating the files was rejected: two copies drift.)
2. **The PC while a speaker plays: keeps playing.** Measured twice on 2026-09-10 (§6, the
   second time properly, with peak levels): the per-process tap copies the sound *after* the
   app's own mixer volume — mute DeetsMusic in the mixer and the tap goes to peak 1 within a
   few seconds. The fallback holds: both play, the state line reads "Playing on Living Room
   and this computer", and there is no setting for it. (`mixer.rs` stays in the crate for the
   probe; DeetsMusic does not call it.) The only real "PC goes quiet" is DeetsAudioDriver.
3. **Button outside max: the Vol. pill's panel** hosts the AirPlay square in mini/midi; the
   stage row hosts it in max. Both squares open the **same** dropdown and share one state;
   CSS gates so exactly one is visible per surface. No separate settings for the two.
4. **Volume while connected: Apple-style.** The app slider (pill, stage row, tray panel)
   drives the speaker's volume; MusicKit gain pins to 100 % for the session and is
   restored on disconnect; the slider follows Siri / the touch surface via the poll.
5. **Delay: automatic only, never a control.** The Auto policy (`250 ms + 4 × p95 RTT`,
   settled once) runs under the hood. The dropdown state line shows it read-only:
   "Playing on Living Room · 0.3 s behind". No fixed-delay or sync-offset rows.
6. **Firewall prompt: on the first Connect**, after one plain sentence in the dropdown.
   Installer stays no-admin.
7. **Now-playing text to the speaker: in v1.** Title, artist, album and cover art go out on
   `SET_PARAMETER` (DMAP `mlit` + `image/jpeg`) on every track change and on connect, so the
   Home app and an iPhone's lock screen show the song. Progress (`progress:`) too, so the
   lock-screen scrubber reads right. New protocol work (~100 lines in the crate); the probe
   gets a `meta` flag to send a fixed record.

## 6. The desk test (before any UI)

A probe subcommand in DeetsAirplay, `probe process-mute <ip>`: starts the per-process
capture of a chosen PID (a running DeetsMusic), connects, streams for 10 s, then mutes that
process's audio session and streams 10 s more. Two outcomes:

- HomePod keeps playing while the PC is silent → decision 2 holds as written.
- HomePod goes silent too → the mute is removed; "This computer" behaves as "keeps
  playing" and the §7 row is dropped.

**Result (2026-09-10, in the app itself): the HomePod went silent too.** Mute removed, row
dropped. That first run was not valid evidence (the capture heard nothing for another reason,
§10), so it was re-measured with `probe process <ip> --pid <webview2 pid> --dry --mute-after 4`,
which reports the capture's peak level every 2 s: peak ~14000 while playing, 1 after the mute.
Same conclusion, now on real data: the tap sits after the per-app mixer volume.

## 7. Settings › AirPlay (the rows)

**v1: no rows.** The capture is always the default output ("All PC sound"); the Settings
card has no AirPlay section. The row below is what v2 brings back when the per-process path
is trusted (§10) — its field already exists in Rust `settings.json` (`SettingsData`), read at
connect time, and a `ChoiceRow` with `get`/`set` is how a Rust-owned choice renders
([SETTINGS.md](SETTINGS.md) §2). Label: short, active; hint as a tooltip.

| Row (hint) | Field | Values (default first) | Read site |
|---|---|---|---|
| Send to speaker (All PC sound also sends other apps) — *DeetsMusic only* / *All PC sound* | `airplay_capture` | `app` / `system` | `airplay.rs` `start_live` (behind `V2_PER_PROCESS`) |

Also in `settings.json`, not shown as rows: `airplay_last_speaker` (name, ip, port; feeds
the dropdown's remembered row), `airplay_firewall_seeded` (the one-shot prompt fired). The
speaker volume is not stored: the speaker owns it.

A change to the row while connected reconnects in place (same speaker), like DeetsAirplay's
latency change.

## 8. What was built (2026-09-10, all compiling, none of it run yet)

| Where | What |
|---|---|
| `../DeetsAirplay/crates/airplay` | The crate: `airplay/`, `crypto/`, `capture.rs` moved verbatim (git history kept); **new** `Capture::start_process(pid)` (per-process loopback via `ActivateAudioInterfaceAsync`, process tree included), **new** `mixer.rs` (`set_tree_mute`: mute/unmute every Windows-mixer session of a process tree), **new** `Session::set_metadata / set_artwork / set_progress` (DMAP `mlit`, `image/jpeg`, `progress:`; all carry `RTP-Info: rtptime=` from the pacer's packet count). |
| `../DeetsAirplay/src-tauri` | The tray app depends on the crate by path; `probe` gained `process <ip> --pid N [--mute-after S]` (§6). |
| `src-tauri/src/airplay.rs` | `AirplayState`; `airplay_scan / connect / disconnect / status / volume / firewall_prompt`; Auto delay + one retune; dead-session sweep. Remote commands → `np-command` (`play` / `pause` / `play-pause` / `next` / `previous`). `on_np_state` is called from `bridge::np_publish`: metadata on track change, artwork on cover change (fetched from Apple's image CDN, one request per change), progress on track change / play-pause flip / seek (> 2 s drift). Failures are rewritten to plain words (`plain_error`). Log: `<app_data>/airplay.log`. |
| `settings.rs` | `airplayCapture` (app / system), `airplayLastSpeaker`, `airplayFirewallSeeded`; `settings_set_airplay_capture` reconnects in place while connected. |
| `src/airplay.ts` | One module state, `mountAirplay(square)` per square; the panel (Play on · This computer · speakers · state line · Scan again); scans when opened; polls status 1 s while open / 2 s while connected / never otherwise; the firewall sentence before the first connect; the volume takeover. |
| `src/player.ts` | `setVolumeSink(sink, initial)` pins MusicKit's gain to 100 % and routes slider changes to the speaker; `reflectExternalVolume(v)` shows a Siri change without sending; the app level is restored on release. |
| `index.html` / `main.ts` / `now-playing-card.ts` | The pill panel's square (`#vol-airplay`, hidden in max) and the stage row's square (`#np-airplay`, max only); the pill's dropdown stays open while the nested panel is. |
| `np-bus.ts` | `play` / `pause` command kinds (the speaker's touch surface sends them, not only a toggle). |
| `settings-card.ts` | `ChoiceRow` can carry `get`/`set` for Rust-owned values; the **AirPlay** section (§7). |
| `styles.css`, `skin.css` | `.ap-*` + `.vol__airplay`; tokens `--ap-panel-w`, `--ap-row-h`, `--ap-dot`, `--ap-pulse`. Colours: `--go` for the connected glyph, the menu roles for the panel. |

## 9. To do before shipping

1. ~~Desk test (§6)~~ done: the PC keeps playing (decision 2 as resolved).
2. ~~Dev firewall rule~~ added 2026-09-10 ("DeetsMusic dev", inbound UDP). A `cargo clean`
   keeps it: the rule is by exe path.
3. **Push the crate, flip the dependency** to `git = …, rev = <sha>` in `src-tauri/Cargo.toml`
   (the path line is marked). Add a gitignored `src-tauri/.cargo/config.toml` `[patch]` for
   local development if the crate keeps changing.
4. **`npm run release`** then confirm the first-connect UAC prompt on an installed build.

## 10. The per-process capture: what was learned, and what v2 must do

Everything below was measured with the probe on 2026-09-10 (`probe process <ip> --pid N
--dry` reports frames heard and the peak level; `probe selfcapture` plays a WAV from a child
process while capturing its own tree). Each is a rule now.

1. **Poll it and it delivers nothing.** The process-loopback virtual device must be
   initialised with `AUDCLNT_STREAMFLAGS_EVENTCALLBACK` and read on its event, exactly like
   Microsoft's ApplicationLoopback sample. `capture.rs` does this now.
2. **`AUDCLNT_BUFFERFLAGS_SILENT` is bit 0x2, not 0x1.** Checked wrong, a silent buffer
   (uninitialised memory on this device) counts as sound. Fixed in both capture paths; the
   probe's "not silent" figures from before the fix were garbage, which is why the first
   mute test looked like the tap survived the mute.
3. **The "include process tree" flag does not cross from the host exe into WebView2.**
   Capturing `deetsmusic.exe` hears nothing (peak 1) while the song plays; capturing its
   direct `msedgewebview2.exe` child hears it (peak ~15000), and so does that child's audio
   utility grandchild. `airplay.rs` `capture_target()` therefore targets the WebView2
   browser child (`mixer::children_named`). The parent chain in Win32 is intact, so the
   engine must key the tree on something else; unknown, not needed.
4. **The tap sits after the per-app mixer volume** (decision 2). So "DeetsMusic only" can
   never make the PC quiet; only a virtual output device can.
5. **Never let a windows-rs `PROPVARIANT` that borrows a blob drop** — heap corruption
   (`STATUS_HEAP_CORRUPTION` on connect). `ManuallyDrop`, forever.

**v1 ships without it** (user's call): `V2_PER_PROCESS = false` in `airplay.rs`, no Settings
row. The crate keeps `Capture::start_process`, `mixer.rs`, and the probe subcommands.

**v2, to trust it:** run the app with `V2_PER_PROCESS = true`, connect with the setting on
`app`, and read `airplay.log`'s "capture heard … not silent" lines (every 10 s) against what
the HomePod plays; watch a fresh WebView2 process tree after a MusicKit reload (the child pid
is looked up at each connect, so a respawned WebView2 is found on the next connect, not
mid-session); then bring the §7 row back.
