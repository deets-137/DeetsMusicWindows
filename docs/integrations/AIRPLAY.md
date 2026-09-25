---
status: shipped
shipped_in: 0.4.3
desk_test: passed 2026-09-19
sources: [src-tauri/src/airplay.rs, src/airplay.ts, scripts/webview-eval.mjs, src/player.ts, src/sound-worklet.ts, src/sound.ts]
updated: 2026-09-24
---
# DeetsMusic — AirPlay (play on a HomePod)

> Scoped and **built 2026-09-10** on branch `release-prep`; **connected and played on the desk**
> the same day. Source of the sender: `../DeetsAirplay` (public repo `deets-137/DeetsAirplay`),
> now a library crate, `crates/airplay` (`deets-airplay`, 0.4.0 since 2026-09-17, a git dependency
> pinned by `rev`; §11 has the bumps). Read its `CLAUDE.md` "Never"
> list before touching any wire code. Code here: `src-tauri/src/airplay.rs` (the session,
> metadata, commands), `src/airplay.ts` (the "Play on" panel, the volume takeover), the AirPlay
> row in `settings-card.ts`, `settings.rs` (three fields), `player.ts` (`setVolumeSink`).
>
> **Two sources since 2026-09-17 (§12; the owner confirmed on the desk the same day that the
> speaker plays and the headphones stay silent — the rest of §12.4 is still open).** The default,
> *DeetsMusic only*, copies the song inside the page at the end of the Sound graph and hands it
> to the sender: the PC goes silent, other apps stay out of the speaker, and the stream is
> bit-exact. *All PC sound* is what v1 shipped (2026-09-10 to 0.9.5): the default output's
> loopback, the PC playing along. Settings › AirPlay › Send to speaker picks. The per-process
> capture of §10 is gone from this app.

## 1. What the user sees (the words)

No protocol words anywhere in the UI. "AirPlay" appears only as the button's tooltip and the
Settings section title, because that is the word on the HomePod's box.

| Where | What |
|---|---|
| The AirPlay square (next to the volume slider) | A full ring with a caret that cuts it. Idle: the caret, outlined, cuts the bottom of the ring. Connected: the caret slides to the top, cuts the top, and fills (`--ap-caret-rise`, `--ap-caret-dur`; reduced motion snaps) — a shape signal, because on the NP card the accent color can equal the off color. The cut is an SVG mask per square (`ap-cut-vol`, `ap-cut-np`) whose caret copy moves with the caret (`--ap-cut-w`), so it works on any background. Connecting: pulses. Round caps at `--ap-stroke` (2026-09-16). |
| The dropdown ("Play on") | `This computer ✓` then one row per speaker found: name + a small model line ("HomePod"). The last-used speaker shows even before the scan finds it. Footer line: "Looking for speakers…" / "No speakers found". The bold "Play on" title row carries a refresh square (the Library Sync button) that scans again and spins while it scans. The panel fades and slides in; the rows arrive one after another, and a speaker found later slides in while the panel's height follows (updated in place, never rebuilt — 2026-09-14; the shared `.pop` style and its `--pop-in/out/grow/stagger/shift/scale/ease` skin tokens, which the Vol. panel also wears; reduced motion snaps). Clicking a speaker connects; clicking the ticked one does nothing; clicking "This computer" disconnects. |
| State line under the list | "Connecting to Living Room…" → "Playing on Living Room" → "Lost Living Room" (when the speaker drops). Failure: "Couldn't reach Living Room. Check that it is on the same Wi-Fi." |
| The volume slider (pill + stage row) | While on a speaker, it moves the **speaker's** volume, and follows Siri / the HomePod's touch surface (polled every ~2 s). See fork 4. **A speaker starts at 20 % the first time** (`AIRPLAY_FIRST_VOLUME`, set during the handshake, before audio flows) and **comes back at whatever it was last left at** (`airplaySpeakerVolumes` in `settings.json`, by speaker name; written on every slider change and on every polled Siri change). |
| The HomePod's touch surface / Siri | Play, pause, next, previous drive DeetsMusic itself (`np-command` on the main window, the tray panel's existing path). |
| First connect ever | The panel asks first — a question block under the speaker list, with Not now and Continue — then the Windows permission prompt (§9a, built 2026-09-17; fork 6). |
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

**One row, back since 2026-09-17** (v1 had none: the capture was always the default output).
`app` means the in-page tap of §12, not the per-process capture of §10. The field lives in
Rust `settings.json` (`SettingsData`), read at connect time; a `ChoiceRow` with `get`/`set` is
how a Rust-owned choice renders ([SETTINGS.md](../architecture/SETTINGS.md) §2). The agent reaches it as
`airplaySend` (AGENT.md §6).

| Row (hint) | Field | Values (default first) | Read site |
|---|---|---|---|
| Send to speaker (DeetsMusic only: the speaker plays your music and this PC goes quiet. All PC sound: every app's sound, and this PC keeps playing) — *DeetsMusic only* / *All PC sound* | `airplay_capture` | `app` / `system` | `airplay.rs` `start_live` |

Also in `settings.json`, not shown as rows: `airplay_last_speaker` (name, ip, port; feeds
the dropdown's remembered row), `airplay_firewall_exe` (the exe the one-shot prompt was
answered for), `airplay_speaker_volumes` (by speaker name, §1).

A change to the row while connected reconnects in place (same speaker), like DeetsAirplay's
latency change.

## 8. What was built (2026-09-10, all compiling, none of it run yet)

| Where | What |
|---|---|
| `../DeetsAirplay/crates/airplay` | The crate: `airplay/`, `crypto/`, `capture.rs` moved verbatim (git history kept); **new** `Capture::start_process(pid)` (per-process loopback via `ActivateAudioInterfaceAsync`, process tree included), **new** `mixer.rs` (`set_tree_mute`: mute/unmute every Windows-mixer session of a process tree), **new** `Session::set_metadata / set_artwork / set_progress` (DMAP `mlit`, `image/jpeg`, `progress:`; all carry `RTP-Info: rtptime=` from the pacer's packet count). |
| `../DeetsAirplay/src-tauri` | The tray app depends on the crate by path; `probe` gained `process <ip> --pid N [--mute-after S]` (§6). |
| `src-tauri/src/airplay.rs` | `AirplayState`; `airplay_scan / connect / disconnect / status / volume / firewall_prompt`; Auto delay + one retune; dead-session sweep. Remote commands → `np-command` (`play` / `pause` / `play-pause` / `next` / `previous`). `on_np_state` is called from `bridge::np_publish`: metadata on track change, artwork on cover change (fetched from Apple's image CDN, one request per change), progress on track change / play-pause flip / seek (> 2 s drift). Failures are rewritten to plain words (`plain_error`). Log: `<app_data>/airplay.log`. |
| `settings.rs` | `airplayCapture` (app / system), `airplayLastSpeaker`, `airplayFirewallSeeded`; `settings_set_airplay_capture` reconnects in place while connected. |
| `src/airplay.ts` | One module state, `mountAirplay(square)` per square; the panel (Play on + the refresh square · This computer · speakers · state line; rows kept by key, height animated); scans when opened; polls status 1 s while open / 2 s while connected / never otherwise; the firewall sentence before the first connect; the volume takeover. |
| `src/player.ts` | `setVolumeSink(sink, initial)` pins MusicKit's gain to 100 % and routes slider changes to the speaker; `reflectExternalVolume(v)` shows a Siri change without sending; the app level is restored on release. |
| `index.html` / `main.ts` / `now-playing-card.ts` | The pill panel's square (`#vol-airplay`, hidden in max) and the stage row's square (`#np-airplay`, max only); the pill's dropdown stays open while the nested panel is. |
| `np-bus.ts` | `play` / `pause` command kinds (the speaker's touch surface sends them, not only a toggle). |
| `settings-card.ts` | `ChoiceRow` can carry `get`/`set` for Rust-owned values; the **AirPlay** section (§7). |
| `styles.css`, `skin.css` | `.ap-*` + `.vol__airplay`; tokens `--ap-panel-w`, `--ap-row-h`, `--ap-dot`, `--ap-pulse`. Colours: `--go` for the connected glyph, the menu roles for the panel. |

## 9. To do before shipping

1. ~~Desk test (§6)~~ done: the PC keeps playing (decision 2 as resolved).
2. ~~Dev firewall rule~~ added 2026-09-10 ("DeetsMusic dev", inbound UDP). A `cargo clean`
   keeps it: the rule is by exe path.
3. ~~Push the crate, flip the dependency~~ done 2026-09-10: `deets-airplay` is a git
   dependency pinned to a DeetsAirplay commit. To change the crate: commit + push
   DeetsAirplay, bump `rev` in `src-tauri/Cargo.toml`.
4. **`npm run release`** then confirm the first-connect UAC prompt on an installed build.
   **0.2.0 failed this** (2026-09-10): the dev build and the installed build share
   `settings.json` (same identifier), the dev run had set the yes/no flag, so the installed
   build skipped the prompt and "Couldn't reach" the speaker. 0.2.1 remembers the **exe
   path** the rule was made for (`airplayFirewallExe`); a dev build reports itself seeded
   and records nothing. **Re-tested on the installed 0.2.1: prompt shown, AirPlay works.**
5. ~~**The firewall prompt scares people**~~ **(picked 3A and built 2026-09-17; §9a).**
   The old shape, kept here as the record: the only
   warning is one line in the panel's state area, then Windows' UAC dialog appears with
   `netsh` as the program. A first-time user has no reason to trust that. Two shapes to
   pick from, both now possible (toasts landed 2026-09-13, [TOASTS.md](../architecture/TOASTS.md)): (a) a confirmation
   inside the app before the dialog — "Windows will ask for permission so the speaker can
   answer DeetsMusic. Continue?" with a Not now that leaves the speaker list usable; (b) a
   toast that stays until the dialog closes, naming what to click. Either way the sentence
   must say it happens once, and the dialog names `netsh`, so say that too.

## 9a. The permission question (shape (a), built 2026-09-17; desk test below)

The user picked **(a)**: the question lives in the "Play on" panel, under the speaker list,
where the eyes already are. A toast was the other shape; it would have put the question in
the corner, away from the list it gates.

**What happens.** Before the first connect on this exe, a click on a speaker row does not
connect. The panel grows a block under the list:

> Windows asks for permission once, so **Living Room** can answer DeetsMusic. The prompt
> names netsh, the Windows firewall tool.
>
> `Not now`   `Continue`

- **Continue** runs the same one-shot prompt as before, then connects. The state line reads
  "Windows is asking now. Click Yes on the prompt." while the dialog is up.
- **Not now** drops the question and nothing else: the panel stays open, the speaker list
  stays usable, and the next click on a speaker asks again.
- The panel cannot close under the question (`shouldStayOpen`), and closing it by the square
  forgets the question.
- The speaker's own name is in the sentence, so it is clear what the permission is for.

`askFirewall` in `airplay.ts` is the whole state. The block is built once with the panel and
hidden; when it appears, its two parts go through `enterRows`, and the panel's height follows.
Styles: `.ap__ask*` in styles.css, tokens only. The two buttons wear the app's panel chip
shape — the Sound panel's pill, which Rooms already borrows: `--surface` fill,
`--panel-border`, `--icon-lg` tall, text centred, one width for both words
(`--ap-ask-btn-w`, `--ap-ask-radius`). **Continue** wears the Rooms Leave treatment (the
title colour on a clear fill, `--picked` on hover), which is the app's one "this is the
action" mark; `--picked` as a fill is kept for a pressed state, so it is not used at rest.
Log lines:
`airplay:firewallAsk` and `airplay:firewallDeclined` (both carry the speaker name).

**Desk test (front-end only; no runner restart).** The flag is per exe
(`airplay_firewall_exe`), so clear it first: stop the app, delete `airplayFirewallExe` from
`settings.json`, start again.

1. Open "Play on", click a speaker. The block appears under the list, with the speaker's
   name in it; the panel grows; nothing connects.
2. Press **Not now**. The block goes, the panel stays open, the speaker list still works.
3. Click a speaker again: the block comes back.
4. Press **Continue**. The Windows prompt appears; click Yes; the speaker connects.
5. Click a speaker once more: no block ever again on this exe.
6. With the block up, click the card behind the panel: the panel stays open.
7. Reduced motion on: the block appears with no slide.

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

**v2 (2026-09-17): superseded by §12, built the same day.** The per-process capture can never
make the PC quiet (rule 4), so "DeetsMusic only" is the in-page tap. `V2_PER_PROCESS` and
`capture_target()` are gone from `airplay.rs`; `Capture::start_process`, `mixer.rs` and the
probe subcommands stay in the crate, because `probe process` measures with them.

## 11. Sharing the speaker with DeetsAirplay (2026-09-15)

DeetsAirplay is the tray sender in `../DeetsAirplay` — the same crate underneath, sending the
whole PC's output instead of this app's. A receiver takes **one** sender, so before this the
two could offer the same HomePod, and whoever lost the race got a handshake failure with
nothing to act on. Two channels now keep them honest. Neither is required for DeetsMusic to
work, and the usual install has no DeetsAirplay at all.

**The claim file — no code here.** `deets-airplay`'s `claim.rs` writes
`{id, app, pid, exe, speaker, ip, port, since, send}` to
`%LOCALAPPDATA%\Deets\airplay-claims.tsv` inside `session::connect`, and drops it in the
session's `Drop`. A claim counts only while a process with that pid *and* that exe name is
alive, so a crash needs no cleanup. **This app adopts it by bumping the crate `rev`** (done
2026-09-15: pinned at `d735d14`, crate 0.3.0; 2026-09-16: bumped to `4989dfb`, same crate 0.3.0,
which adds `resample.rs` + `fidelity.rs` and makes the capture's fallback sinc + TPDF dither
instead of linear — AUDIO-QUALITY.md). The one line in `airplay.rs` is
`session.describe_send(send)` after `connect`: `Send::All` for the default-output capture
this version ships, `Send::Apps([this exe])` for the per-process path. Without it the claim
reads `Unknown` and the other side can say who holds the speaker but not whether our audio
is on it. `send` says what the stream carries (`all` for DeetsAirplay's
loopback, `apps [...]` once its per-app picker exists), which is how the other side knows
whether our song is already on the speaker or genuinely absent from it.

**Two bridge routes — the only new code.** `bridge.rs`:

| Route | Gate | Answers |
|---|---|---|
| `GET /airplay` | the token, like `/now-playing` | `{speaker, ip, port, sends}`, or nulls when idle |
| `POST /airplay` | the token **and** Agent control | `{action:"disconnect"}` — let the speaker go |

`held_speaker()` and `release()` in `airplay.rs` are the two lines behind them; `release` is
what "This computer" already does. The GET exists so a DeetsAirplay running against an
*older* DeetsMusic (one whose crate predates `claim.rs`) can still see which speaker we hold;
the other side detects the route by calling it, so there is no version gate to keep in step.

**What the other app does with it:** its speaker list shows "Playing from DeetsMusic" on a
held row with a **Take over** button (`POST /airplay`, wait for the claim to clear, connect),
and its now-playing card is ours — cover, position, exact transport through `POST /command` —
whenever we hold the stream, or whenever it is sending the whole PC and we are playing.
Its volume slider forwards to `POST /command {kind:"volume"}`, which lands on our slider,
which while we stream is already the speaker's own volume: one hop, never a second gain stage.

**The claim guard — both directions (built 2026-09-17, desk test PASSED 2026-09-19).** Until then this app
*wrote* a claim but did not read one, so it connected straight over a speaker DeetsAirplay held.
Now `connect_speaker` checks `claim::on_speaker(&speaker.name)` first, **before `stop_live`**, so a
refused pick keeps the speaker we already have. `on_speaker` skips our own pid and any holder that
is no longer running. The error reaches the AirPlay dropdown's note line (`airplay.ts` `connect`),
with two wordings from the claim's `send`:
- the holder sends this exe too (`Send::All`, DeetsAirplay's whole-PC loopback): *"DeetsAirplay is
  already sending this PC's sound to “Living Room”, so your music plays there now."*
- otherwise: *"DeetsAirplay is playing on “Living Room”. Disconnect it there first."*

Log: `airplay: connect refused: the speaker is held by <app> (sends ours: <bool>)` (no speaker
name). No **Take over** on this side: DeetsAirplay has no bridge for us to ask. An installed
DeetsMusic and a `dev:app` are two pids, so each refuses a speaker the other holds.

Desk test (Rust changed: restart the dev runner):
1. DeetsAirplay connects to a speaker. In DeetsMusic, pick the same speaker: the note shows the
   "already sending this PC's sound" line, nothing disconnects, and the log has the refused line.
2. DeetsMusic plays on speaker A; DeetsAirplay takes speaker B; in DeetsMusic pick B: refused, and
   A keeps playing.
3. Quit DeetsAirplay (or kill it): pick the speaker again in DeetsMusic; it connects.
4. With the installed DeetsMusic on a speaker, pick it in `dev:app`: refused, naming DeetsMusic.

**Releasing:** the routes are additive and inert, so they can ride any release. The claim
needed a `rev` bump to a crate revision at or past `deets-airplay` 0.3.0 — done for 0.6.2,
after that crate was pushed.

## 12. Speaker only: the in-page tap (designed and built 2026-09-17; desk test §12.4 PASSED 2026-09-19)

**The problem.** A speaker plays, and so does the PC. Decision 2 accepted that because the only
copy points Windows offers (§4, §10) sit after the per-app volume: mute the app and the speaker
goes quiet too. Since then two facts changed (SOUND.md §0, built 2026-09-16): DRM audio passes
through Web Audio, and every song can be routed through our own graph. So the copy can be made
**inside the page**, before the sound ever reaches Windows.

**Terms used here.** *Tap*: the worklet node that copies the sound. *Sink gain*: the last gain
node before the destination; 0 makes the PC silent. *Ring*: the crate's buffer the pacer drains
(`capture.rs` `Ring`). *Chunk*: one block of frames the tap posts.

### 12.1 The design

```
MusicKit <audio> ─ source ─ element node ─ … bus (EQ, shelves, crossfeed, limiter) ─┐
                                                                                     ▼
                                                            tap (worklet) ── sink gain ── destination
                                                              │                   (0 while a speaker plays,
                                                              │ Int16 chunks       1 otherwise)
                                                              ▼
                                       main thread: invoke("airplay_tap", bytes)
                                                              ▼
                                       Rust: Ring.push ── pacer ── ALAC ── HomePod
```

1. **The tap** is a new processor in `sound-worklet.ts` (`deets-tap`), placed between the bus and
   the destination. Disarmed, it copies input to output and posts nothing: zero cost. Armed, it
   also packs each 128-frame block into an interleaved Int16 buffer with TPDF dither and posts one
   chunk of 4096 frames (93 ms at 44.1 kHz) to the main thread, transferred not copied. The bus
   worklet is untouched.
2. **The sink gain** replaces `bus.connect(ctx.destination)` in `ensureContext`. Speaker only = 0.
   The graph keeps rendering (a node chain to the destination is pulled every quantum even at
   gain 0), so the tap keeps posting while the window sits in the tray.
3. **The main thread** forwards each chunk with a raw-body `invoke` (Tauri v2 accepts an
   `ArrayBuffer` as the body; `tauri::ipc::Request` on the Rust side). 176 KB/s in ~11 calls per
   second. The worklet cannot call `invoke` itself; a Worker cannot either.
4. **Rust** (`airplay.rs`): `airplay_tap` pushes the bytes into a `Ring` when a session is live
   on the tap, and drops them otherwise. The crate makes `Ring::new` and `push` public and adds
   `Capture::from_ring` (a crate bump: commit, push, `rev`). The existing "capture heard sound /
   silence / nothing" verdicts keep working unchanged on that ring, because they read the ring's
   own counters.
5. **`start_live`**: `AirplayCapture::App` → the tap ring and `claim::Send::Apps([exe])`;
   `System` → `Capture::start()` as today. `V2_PER_PROCESS` and `capture_target()` go.
6. **Prefill.** The ring grows from 100 ms to 1 s, and the tap source waits until 500 ms is
   queued before the pacer drains it, once per session (T3 measured one 256 ms gap in ten minutes). A late chunk (a busy main thread) then
   costs nothing; today's ring would underrun. The Auto delay (decision 5) is unchanged.
7. **Routing on connect.** Today an element is routed only while an effect is wanted. Connect
   arms the tap, so `wanted()` also counts the tap, and the element playing at that moment is
   routed at once, mid-song (`createMediaElementSource` works on a playing element). Bypass, not
   teardown: it stays routed after disconnect, at the graph's known zero cost.
8. **Order on connect.** Arm the tap and route first (the pacer pads silence until frames
   arrive); the sink gain drops to 0 only when the session reports playing. A failed connect
   never silences the PC. Disconnect, "Lost", and app exit set the gain back to 1 and disarm.
9. **The row (§7) returns**, default `app`: *Send to speaker — DeetsMusic only / All PC sound.*
   A change while connected reconnects in place (already built, `settings_set_airplay_capture`).
   All PC sound keeps decision 2's words ("and this computer"); DeetsMusic only shows
   "Playing on Living Room". *(Alone decision, VALUES.md §3: the default is `app` because the
   whole point of a speaker is that the room hears one source. Flagged for the desk test.)*
10. **The context rate.** The graph is created once at the device rate (48 kHz here) and cannot
    be recreated for elements already routed. Created at **44.1 kHz** instead, the element enters
    the graph without a resample and the tap hands the pacer Apple's decode bit-exact (the two
    resamples in AUDIO-QUALITY.md §1 both disappear). The local path then resamples once at the
    context output instead of once at the element, which test T1 must show is no worse than
    §4.3. If it is worse, the context stays at the device rate and Rust resamples the tap with
    the crate's `Sinc` + dither, which measures at the 16-bit ceiling (§4.2). *(Test-first fork:
    the measurement decides, not a person.)*
11. **Volume**: unchanged (decision 4). The slider drives the speaker, MusicKit's gain is pinned to
    1, the Windows master no longer matters because the PC is silent, and `sound.ts` already
    ignores the master while `airplayOutput` is set.
12. **EQ and DeetsAdaptiveSound** apply to the speaker, because the tap sits after the bus. The
    per-output preset for `airplay:<name>` keys (SOUND.md fork 4) already exists.
13. **Fallback.** If the tap ring reports *nothing* for 10 s while MusicKit says playing, log
    `airplay: tap starved` and show the panel note "The speaker gets no sound from DeetsMusic.
    Try All PC sound." No automatic switch: the cause gets found first (root-cause rule).
    The loopback path stays in the crate for exactly this case; Chromium's design is what makes
    the tap possible, and a Chromium or Apple change would take it away without notice.
14. **Log lines**: `airplay: tap armed / disarmed` and `sound:sink` (gain 0/1) in `diag.log`;
    the ring verdicts in `airplay.log` as today. `__sound.status()` gains `tap: {armed, chunks,
    lastGapMs}`. DeetsAirplay's speaker list reads the claim's `send` and shows "Playing from
    DeetsMusic" with no change on its side.

**What goes away:** the WebView2 child hunt, the process-tree flag, the per-process capture
(§10 rules 1, 3 and 4 become history), the double resample, and other apps' sound on the speaker.
**What stays:** the firewall rule (the HomePod's UDP reply still needs it), the claim file, the
volume takeover, metadata and artwork.

### 12.2 Terms (DPLA §3.3.6.D), checked 2026-09-17 with the owner

The clause: no download, no upload, no modification of MusicKit Content; play it only as
rendered by MusicKit JS. Against the tap:

| Word | The tap | Same as today's loopback? |
|---|---|---|
| download | Holds under 1 s in memory, writes nothing. | Yes (100 ms ring). |
| upload | Carries the sound to a HomePod on the LAN over Apple's own AirPlay protocol, which Apple Music does itself; the receiver stores nothing. | Yes. |
| modify | Every effect off: the bit-exact rendering (the flat graph measured identical, AUDIO-QUALITY.md §4.3a). Effects on: the fork 0 risk already shipped in 0.8.0. | Yes, plus fork 0. |
| rendered by MusicKit JS | The tap hears MusicKit JS's own rendering into its own element, through the standard `createMediaElementSource` the graph already makes. No second player, no other asset, no undocumented API, no DRM circumvention (Chromium hands EME audio to Web Audio by design, §4.4). | Yes: the loopback hears the same rendering, one stage later. |

Nothing new leaves the PC. The owner's reading (2026-09-17): fine. Recorded here so the question is
not re-raised; the counter-reading ("only the browser's own output path counts as rendered") was
already accepted as a risk with fork 0 and is not made worse by moving the copy point.

### 12.3 Tests before the build (facts, cheap, no harness)

All in the dev app through `scripts/webview-eval.mjs`, unless marked *desk*.

| # | Question | How | Pass |
|---|---|---|---|
| T1 | Does a 44.1 kHz context cost the local path anything? | `probe fidelity --listen` (AUDIO-QUALITY.md §2) with `__sound` forced to create its context at 44100, and again at the device rate. Nothing else playing. | Level, THD+N and spurs within 2 dB of §4.3 at every tone. Worse → design item 10's fallback. |
| T2 | Does the graph keep rendering at sink gain 0 with the window hidden? | A test tap node counts posted chunks; hide the window to the tray for 60 s; read the count. | ~640 chunks/min, no gap over 200 ms. |
| T3 | Does a raw-body `invoke` at 11 Hz stall? | A stub command counts bytes and the largest gap between calls over 10 min while `__frames.sample` runs a scripted scroll, the Sound menu opens and a song changes. | Largest gap under the prefill. Larger → a bigger prefill, or a `SharedArrayBuffer` + Worker path. |
| T4 | Does routing a playing element mid-song blip? | Route on a live song from the console; listen (*desk*) and read `[perf] frames`. | No gap the ear notices. |
| T5 | Does the tap hear the song through the ring? | After the build: `airplay.log` verdict "heard sound" while playing, "silence" while paused, never "nothing". | 30 min, no *nothing*. |

### 12.4 The desk test (after the build; Rust changed, restart the dev runner)

1. Play a song; pick the speaker. The PC goes quiet when the note reads "Playing on Living
   Room"; the speaker carries the song; no other app's sound reaches it (play a video in Edge).
2. An album end to end: no dropout; `airplay.log` has no *nothing* verdict.
3. Pause and play from the HomePod's touch surface; next and previous; a seek. The speaker
   follows; the PC stays silent.
4. Minimize to the tray for five minutes: the song keeps playing on the speaker.
5. Turn on Advanced EQ with a strong preset: the speaker's sound changes; turn it off.
6. Settings › AirPlay › Send to speaker → All PC sound: reconnects in place; the PC plays again;
   the note reads "and this computer". Back to DeetsMusic only: the PC goes quiet.
7. Pick "This computer": the PC plays at once, at the level the slider showed before the speaker.
8. Quit the app while connected: the speaker stops; a restart plays on the PC.
9. DeetsAirplay's speaker list shows "Playing from DeetsMusic" on the held row.
10. Pull the HomePod's power: the note reads "Lost Living Room" and the PC plays again.

### 12.5 Results (2026-09-17, dev app, `scripts/webview-eval.mjs`)

| # | Result | Evidence |
|---|---|---|
| T1 | **Pass.** A 44.1 kHz context costs the local path nothing. | `probe fidelity --listen` through the graph at 44.1 kHz vs the plain path, same session: 1 kHz THD+N −105.5 / −105.3 dB, 15 kHz −74.5 / −74.5, 19 kHz −70.1 / −70.1, 20 kHz level −3.49 / −3.49 dB. Identical to the decimal, and to §4.3 (2026-09-16). The 20 kHz roll-off is Chromium's output resampler either way. **Design item 10: the context is created at 44.1 kHz.** |
| T2 | **Pass.** The graph renders at sink gain 0 while the window is hidden. | Oscillator → worklet → gain 0 → destination, 60 s shown then 60 s hidden by `getCurrentWindow().hide()` (the tray's own call): 20,700 then 20,800 quanta (20,671 expected per minute), worst gap 22 ms, no gap over 200 ms. `document.visibilityState` stayed `visible` while hidden. |
| T3 | **Pass with one change.** A raw-body `invoke` at 11 Hz never fails; the largest gap was 256 ms. | Built dev mode (`dev:built`, a fixed bundle that survives other sessions' saves), 10 min: 5,971 chunks of 16 KB (97.8 MB), 0 failures, worst `invoke` round trip 40 ms, Rust-side largest gap between chunks 256 ms, once, under a scroll every 25 s (worst 29 ms frame), the Sound menu and a song change every 100 s. 256 ms is 6 ms over the 250 ms prefill, so **the prefill is 500 ms** (design item 6); the 1 s ring keeps 500 ms of headroom. The temporary stub (`airplay_tap_probe`) was removed after the run. |
| T4 | **Pass.** Routing a playing song mid-song makes no audible gap. | Twice on the desk (headphones, the live app off AirPlay): once into a warm context, once creating the 44.1 kHz context and routing in the same call (35 ms). The song's clock ran on; the owner heard no gap and no click. |

### 12.6 As built (2026-09-17, crate 0.4.0 at `85a9ff1`; Rust changed, restart the dev runner)

| Where | What |
|---|---|
| `../DeetsAirplay/crates/airplay/capture.rs` | `Ring::new` / `with_capacity` / `push` / `queued_frames` public; `Capture::from_ring(ring, prefill_frames, note)` — no thread, the pacer source pads silence until the prefill is queued, once. The WASAPI captures are untouched (prefill 0, 100 ms ring). `start_process` stays for `probe process`. |
| `src-tauri/src/airplay.rs` | `AirplayState.tap`: the live tap session's ring, or None (`publish_tap` after every connect / reconnect / stop). `airplay_tap` (sync, raw body → `Ring::push`, dropped with no ring). `start_live`: `App` → a 1 s ring with a 500 ms prefill + `Send::Apps([exe])`; `System` → `Capture::start()` + `Send::All`. `Connected.tap` / `tapStarved`, `Status.capture`. The starvation check rides the 10 s heard-verdict window: tap mode, the Hub says playing, no frame in → after 10 s one `airplay: tap starved` line and the panel note (item 13). `V2_PER_PROCESS`, `capture_target`, the `mixer` import: gone. |
| `src/sound-worklet.ts` | `deets-tap`: passthrough; armed, 4096-frame Int16 chunks with TPDF dither, transferred. |
| `src/sound.ts` | `bus → tap → sink → destination`; the context is created at 44.1 kHz (item 10; the dev override `deets.dev.soundRate` stays for the probe). `armTap(on)` (routes the playing element, refuses if the context is not 44.1 kHz — `sound:tapRate`), `setSink(0|1)` (3 ms time-constant ramp), `tapStatus()` in `__sound.status().tap` (`armed, sink, chunks, failed, lastGapMs, worstGapMs`). `wanted()` counts the tap. Log: `airplay:tapArmed / tapDisarmed`, `sound:sink`, `sound:tapFailed` (first failure only). |
| `src/airplay.ts` | `connect()`: `capture === "app"` → `armTap(true)` before the invoke (item 8). The poll's `applyTakeover`: `connected.tap` → arm (a reconnect in place) and sink 0; otherwise sink 1 and disarm. State line: *Playing on X · 0.3 s behind* (tap) / *… and this computer · …* (loopback); the starved note. |
| `src/settings-card.ts`, `src/agent-settings.ts` | The AirPlay section (§7); `airplaySend` for the agent. |

**Alone decisions (VALUES.md §3), for the desk test:** the default is `app` (item 9). The sink
ramp is 3 ms, not a hard 0, so the PC's last sample never clicks. Arming refuses at any rate but
44.1 kHz rather than resampling in Rust, because a context at another rate can only come from
the dev override. The starved note names Settings › AirPlay. The tap chunk is decoded from
little-endian bytes on the Rust side, one `Vec` per chunk (16 KB, 11 times a second).

**What the desk test should also watch:** `__sound.status().tap.worstGapMs` after an album
(T3 saw 256 ms; the prefill is 500 ms); `airplay.log` never says *nothing* while playing (T5);
the PC's own volume slider and Windows master have no effect on the speaker while the tap plays.

**A false alarm worth knowing.** The first T1 run measured the first tone and then digital silence.
The next run showed the context gone (`ctx: "none"`): a front-end save from another session had
reloaded the page mid-run. With saves held, the run was clean. Every listen run reports one raw-loopback
discontinuity, clean runs included, so that warning is the probe's and not a signal.

## 13. Stalls, switch speed, and sleep (2026-09-24)

> **Part:** designed · 2026-09-24

The owner's goal: **AirPlay must be tight.** A switch of the output, in DeetsMusic or in
Windows, must be fast and smooth. A stall must leave a trace. Build with
[APPLE-CALLS.md](../ops/APPLE-CALLS.md) A + B and the DEBUGGING.md pause fixes (§Why did it pause).

### 13.1 The evidence that started this

On 2026-09-23 at about 22:14 (installed app, radio, AirPlay): a song ended and the next started
**17.5 s** later, at the same moment `sound:output` changed to "Speakers (Yeti Classic)". An
`airplay: progress: SET_PARAMETER … connection attempt failed` line came at 22:12:42. The
cause cannot be read, for three reasons:
- **`airplay.log` rolls over in hours.** The crate writes a `→ POST /feedback` and a `← 200`
  line every 2 s (`rtsp.rs` in DeetsAirplay), so the 512 KB file holds only the last few hours.
  The 22:14 trace was already gone the next day.
- **A drop is not logged.** `airplay_status` sets `Lost {name}.` on a dead session but writes no
  log line, and it notices only when the session's threads have died (`session.alive()`).
- **An output change does not say why.** `sound:output` does not say if the user, Windows or
  a lost speaker changed it.

### 13.2 The tracking (designed, not built)

| Line | When | Fields |
|---|---|---|
| `airplay: switch` | each connect, disconnect, reconnect in place, and speaker → speaker | `from`, `to`, `why` (user / agent / retune / pref / lost / wake), `ms` total, and the stage split: claim check, stop old, RTSP setup, first frame sent, sink flip (the PC goes quiet) |
| `airplay: drop` | a session is found dead | speaker, how found (threads / no reply / wake), seconds since the last good reply |
| `airplay: stall` / `stall-end` | connected, NP playing, and no frame sent to the speaker for 2 s (the crate's frame count stops) | speaker, `s`, the last RTT p95, the last RTSP error |
| `sound:output` | (exists) | add `why`: user / windows (the default device changed, audio_out.rs) / airplay-lost / airplay-on |
| `sound:switch` | a **Windows** output change while playing | `ms` from the `audio-output` event to the first non-silent block the sound graph measures |

- The existing `tap starved` (10 s, page → Rust) stays. `stall` is the Rust → speaker side.
- `player:stall` (DEBUGGING.md) catches the effect on the queue. These lines name the cause.
- **The wire log (crate change):** write `/feedback` only when it fails or is slow (> 500 ms),
  so `airplay.log` keeps days, not hours. This is a change in the shared crate: a new crate
  version and the `rev` in Cargo.toml (§11: DeetsAirplay uses the same crate).
- A `diag` event for each line (CLAUDE.md checklist item 6), so the `diag` tool sees them live.

🔵 **Open (for the owner, after the first numbers):** the targets. The tracking gives the
baseline first. A draft to react to: speaker → PC under 300 ms of silence, PC → speaker under
2 s to sound, speaker → speaker under 2.5 s.

### 13.3 After the PC sleeps — to find out

> **Part:** idea · 2026-09-24

**The suspected fault:** after the PC wakes, AirPlay shows **connected** when it is not. It fits
the code: a session counts as dead only when its threads die (`session.alive()`,
airplay.rs `airplay_status`). Through a sleep, the threads can live on over a socket that the
speaker has closed. Nothing listens for the Windows sleep and wake events today.

**What to find out first (a desk test, no code):**
1. Connect to the HomePod, play, and sleep the PC for **1 minute**. Wake it. Read the AirPlay
   panel, `airplay_status`, the last lines of `airplay.log`, and `deetsmusic diag`. Does sound
   come back? Does the panel say connected?
2. The same for **30 minutes** (the HomePod forgets the session in that time, if it ever does).
3. The same with the music **paused** before the sleep.
4. Each time: does a new pick of the same speaker work at once, or does the speaker refuse (a
   stale claim on its side)?

**Possible fixes (for the owner after the test; not decided):**
- Listen for the Windows power events (`PBT_APMSUSPEND` / `PBT_APMRESUMEAUTOMATIC`). On
  suspend: note the speaker and disconnect cleanly. On wake: reconnect in place when the
  network is back, `why: wake` in `airplay: switch`.
- Or on wake only: probe the session with one round trip and a 2 s timeout. No reply →
  `airplay: drop {how: wake}`, then reconnect, or show the lost state.
- In both: the panel never says connected until a reply proves it.
