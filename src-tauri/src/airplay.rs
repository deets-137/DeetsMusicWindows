//! AirPlay (docs/integrations/AIRPLAY.md): play what this app plays on a HomePod. The sender
//! is the shared `deets-airplay` crate; this file owns the one live session,
//! the capture choice, the automatic delay, the now-playing metadata, and the
//! transport commands the speaker relays back.
//!
//! Two sources (AIRPLAY.md §12): "DeetsMusic only" is the in-page tap — the front
//! end copies the song at the end of its Sound graph and posts it here through
//! `airplay_tap`, and the PC goes silent because the page's own sink gain drops to
//! 0. "All PC sound" is the WASAPI loopback of the default output, the PC playing
//! along. The per-process capture of §10 is gone: it sat after the app's mixer
//! volume, so it could never make the PC quiet.
//!
//! Every command that touches the network or WASAPI runs on `spawn_blocking`.

use std::net::Ipv4Addr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use deets_airplay::airplay::alac::SAMPLE_RATE;
use deets_airplay::airplay::mdns;
use deets_airplay::airplay::rtsp::RemoteCommand;
use deets_airplay::airplay::session::{self, Config, Metadata, Session, MAX_LATENCY_FRAMES, MIN_LATENCY_FRAMES};
use deets_airplay::capture::{Capture, Ring};
use deets_airplay::claim;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::bridge::{self, NpCommand, NpState};
use crate::settings::{AirplayCapture, AirplaySpeaker, Settings};

/// The one live stream: the session, the capture feeding it, and what the
/// speaker has been told so far.
struct Live {
    session: Session,
    capture: Capture,
    /// Capture stats at the start of the current 10 s window (frames in, frames not silent).
    heard_logged: (Instant, u64, u64),
    /// What the last diagnostic line said ("sound", "silence", "nothing") and when.
    heard_said: Option<(&'static str, Instant)>,
    speaker: AirplaySpeaker,
    /// The tap ring this session drains (DeetsMusic only), or None for the loopback.
    tap: Option<std::sync::Arc<Ring>>,
    /// Tap mode: when the player first said playing while the tap delivered nothing,
    /// and whether the starvation line was logged this session.
    starved_since: Option<Instant>,
    starved_logged: bool,
    /// Auto delay retunes once, from the first seconds of round-trip data.
    retuned: bool,
    meta: Metadata,
    art_url: Option<String>,
    /// Last progress sent: (wall clock, position) so a drift beyond 2 s (a seek) resends.
    progress: Option<(Instant, f64, bool)>,
}

#[derive(Default)]
pub struct AirplayState {
    live: Mutex<Option<Live>>,
    speakers: Mutex<Vec<SpeakerInfo>>,
    /// The speaker a connect is in flight to (the dropdown shows "Connecting…").
    connecting: Mutex<Option<String>>,
    /// The last connect failure, in plain words, until the next attempt.
    error: Mutex<Option<String>>,
    /// Where `airplay_tap` chunks go while a tap session is live; dropped otherwise.
    tap: Mutex<Option<std::sync::Arc<Ring>>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerInfo {
    pub name: String,
    pub ip: String,
    pub port: u16,
    pub model: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connected {
    pub speaker: AirplaySpeaker,
    pub seconds: u64,
    pub latency_ms: u32,
    /// The speaker's own volume, 0–100, as last polled (Siri moves it too).
    pub volume: Option<f64>,
    /// The session drains the in-page tap (the PC is silent) rather than the loopback.
    pub tap: bool,
    /// Tap mode and the player says playing, but no chunk has arrived for 10 s.
    pub tap_starved: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub connected: Option<Connected>,
    pub connecting: Option<String>,
    pub error: Option<String>,
    pub last_speaker: Option<AirplaySpeaker>,
    pub speakers: Vec<SpeakerInfo>,
    pub firewall_seeded: bool,
    /// The Send-to-speaker setting, so the front end arms the tap before a connect.
    pub capture: AirplayCapture,
}

/// The tap ring: 1 s, so a late chunk from a busy main thread costs nothing (the
/// loopback's 100 ms would underrun). Measured 2026-09-17 (AIRPLAY.md §12.5 T3).
const TAP_RING_FRAMES: usize = SAMPLE_RATE as usize;
/// The pacer waits for this much before draining the tap, once per session: the
/// largest gap between chunks measured over ten minutes was 256 ms.
const TAP_PREFILL_FRAMES: usize = SAMPLE_RATE as usize / 2;
/// Tap mode, the player playing, no chunk this long: log it and tell the panel.
const TAP_STARVED_SECS: u64 = 10;

/// Where a speaker starts the first time it is used (0–100). Low on purpose: the
/// speaker's own level may be anything, and a blast is the worst first impression.
/// After that the speaker comes back at whatever it was last left at.
const AIRPLAY_FIRST_VOLUME: f64 = 20.0;

/// Keep a speaker's level for its next use (skips writes for sub-percent jitter).
fn remember_volume(app: &AppHandle, speaker: &str, pct: f64) {
    let settings = app.state::<Settings>();
    let known = settings.get().airplay_speaker_volumes.get(speaker).copied();
    if known.map(|k| (k - pct).abs() < 0.5).unwrap_or(false) {
        return;
    }
    if let Err(e) = settings.update(|d| {
        d.airplay_speaker_volumes.insert(speaker.to_string(), pct.clamp(0.0, 100.0));
    }) {
        log(&format!("remember volume: {e}"));
    }
}

/// The app log (LOGGING.md) carries the connect / drop / error lines; the crate's
/// own `airplay.log` keeps the wire-level session trace.
fn log(line: &str) {
    crate::log::info(&format!("airplay: {}", mask_ipv4(line)));
}

/// The crate's error text can name the speaker's LAN address; a bug report sends these lines.
fn mask_ipv4(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut run = String::new();
    let flush = |run: &mut String, out: &mut String| {
        let parts: Vec<&str> = run.split('.').collect();
        let is_ip = parts.len() == 4 && parts.iter().all(|p| !p.is_empty() && p.len() <= 3 && p.parse::<u16>().map_or(false, |n| n <= 255));
        out.push_str(if is_ip { "[ip]" } else { run.as_str() });
        run.clear();
    };
    for c in s.chars() {
        if c.is_ascii_digit() || c == '.' {
            run.push(c);
        } else {
            flush(&mut run, &mut out);
            out.push(c);
        }
    }
    flush(&mut run, &mut out);
    out
}

#[cfg(test)]
mod mask_tests {
    #[test]
    fn masks_ipv4_only() {
        assert_eq!(super::mask_ipv4("refused 192.168.1.20:7000 after 2.5 s"), "refused [ip]:7000 after 2.5 s");
        assert_eq!(super::mask_ipv4("version 0.4.3"), "version 0.4.3");
    }
}

pub fn setup(app_data: &std::path::Path) {
    deets_airplay::airplay::log_to_file(&app_data.join("airplay.log"));
}

// ── delay policy (DeetsAirplay's Auto, the only mode here) ─────────────────

/// Receiver buffer in frames: 300 ms to start, then once a session has
/// round-trip samples, `250 ms + 4 × p95 RTT`.
fn latency_frames(rtt_p95_ms: Option<f64>) -> u32 {
    let ms = match rtt_p95_ms {
        Some(rtt) => (250.0 + 4.0 * rtt).round() as u32,
        None => 300,
    };
    (ms * SAMPLE_RATE / 1000).clamp(MIN_LATENCY_FRAMES, MAX_LATENCY_FRAMES)
}

// ── the session ─────────────────────────────────────────────────────────

fn plain_error(speaker: &str, e: &str) -> String {
    let e_l = e.to_ascii_lowercase();
    if e_l.contains("timed out") || e_l.contains("connection") || e_l.contains("refused") || e_l.contains("unreachable") {
        // The name is quoted: toast.ts drops quoted names from the log (a speaker is often "<Name>'s HomePod").
        format!("Couldn't reach “{speaker}”. Check that it is on the same Wi-Fi.")
    } else if e_l.contains("pair") || e_l.contains("srp") || e_l.contains("auth") {
        format!("“{speaker}” didn't accept the connection. Try again in a moment.")
    } else if e_l.contains("loopback") || e_l.contains("capture") || e_l.contains("wasapi") {
        "Couldn't capture this app's sound. Is a song playing?".to_string()
    } else {
        format!("Couldn't play on {speaker}.")
    }
}

fn start_live(app: &AppHandle, speaker: AirplaySpeaker, rtt_p95_ms: Option<f64>) -> Result<Live, String> {
    let settings = app.state::<Settings>().get();
    let ip: Ipv4Addr = speaker.ip.parse().map_err(|_| format!("bad speaker address {}", speaker.ip))?;
    // `send` rides the claim file (AIRPLAY.md §11): it says what this stream carries, so the
    // other sender can tell whether our audio is on the speaker, not only that we hold it.
    let (capture, send, tap) = match settings.airplay_capture {
        AirplayCapture::App => {
            // The in-page tap (AIRPLAY.md §12): the front end pushes chunks through
            // `airplay_tap`; the ring is published once the session is up.
            let exe = std::env::current_exe()
                .ok()
                .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
                .unwrap_or_else(|| "DeetsMusic.exe".into());
            let ring = std::sync::Arc::new(Ring::with_capacity(TAP_RING_FRAMES));
            let capture = Capture::from_ring(ring.clone(), TAP_PREFILL_FRAMES, "in-page tap, 44.1 kHz / 16-bit, 500 ms prefill");
            (capture, claim::Send::Apps(vec![exe]), Some(ring))
        }
        AirplayCapture::System => (Capture::start()?, claim::Send::All, None), // the default output: the whole PC, us included
    };
    let handle = app.clone();
    let config = Config {
        latency_frames: latency_frames(rtt_p95_ms),
        // Where this speaker was last left, else the safe first level; the
        // handshake sets it on the speaker before any audio flows.
        volume_pct: settings.airplay_speaker_volumes.get(&speaker.name).copied().unwrap_or(AIRPLAY_FIRST_VOLUME),
        client_name: "DeetsMusic".into(),
        log: true,
        // Siri, the Home app and the HomePod's touch surface relay transport
        // commands; they drive our own player through the tray panel's path.
        on_command: Some(std::sync::Arc::new(move |cmd| {
            let kind = match cmd {
                RemoteCommand::Play => "play",
                RemoteCommand::Pause | RemoteCommand::Stop => "pause",
                RemoteCommand::TogglePlayPause => "play-pause",
                RemoteCommand::Next => "next",
                RemoteCommand::Previous => "previous",
            };
            let _ = handle.emit_to("main", "np-command", NpCommand { kind: kind.to_string(), value: None });
        })),
    };
    // Not the name ("<Name>'s HomePod") or the LAN address: a bug report sends this line.
    log(&format!("connect port {} (capture: {})", speaker.port, capture.format_note));
    let session = session::connect(ip, speaker.port, &speaker.name, config, capture.source()).map_err(|e| {
        log(&format!("connect FAILED: {e}"));
        e
    })?;
    session.describe_send(send); // the claim is written by connect; this fills in its `send`
    Ok(Live {
        session,
        capture,
        heard_logged: (Instant::now(), 0, 0),
        heard_said: None,
        speaker,
        tap,
        starved_since: None,
        starved_logged: false,
        retuned: rtt_p95_ms.is_some(),
        meta: Metadata::default(),
        art_url: None,
        progress: None,
    })
}

/// The live session's ring becomes (or stops being) where `airplay_tap` chunks land.
fn publish_tap(state: &AirplayState) {
    let ring = state.live.lock().unwrap().as_ref().and_then(|l| l.tap.clone());
    let open = ring.is_some();
    let was = std::mem::replace(&mut *state.tap.lock().unwrap(), ring).is_some();
    if open != was {
        log(if open { "tap ring open" } else { "tap ring closed" });
    }
}

fn stop_live(state: &AirplayState) {
    if let Some(live) = state.live.lock().unwrap().take() {
        live.session.disconnect();
    }
    publish_tap(state);
}

/// The speaker this app is streaming to, if any. For the bridge's `/airplay`,
/// which is how DeetsAirplay (the tray sender, the same crate underneath)
/// knows not to offer a receiver we are already holding — a receiver takes one
/// sender at a time. Nothing else need be installed for this to be correct:
/// with no session the route simply answers "nobody".
pub fn held_speaker(app: &AppHandle) -> Option<AirplaySpeaker> {
    app.state::<AirplayState>().live.lock().unwrap().as_ref().map(|l| l.speaker.clone())
}

/// Let the speaker go because the other app asked for it (its "Take over").
/// Exactly what the "This computer" row does, minus the UI.
pub fn release(app: &AppHandle) {
    stop_live(&app.state::<AirplayState>());
}

fn connect_speaker(app: &AppHandle, speaker: AirplaySpeaker) -> Result<(), String> {
    let state = app.state::<AirplayState>();
    // The claim guard (AIRPLAY.md §11): a receiver takes one sender, so a speaker another
    // Deets app holds would fail at SETUP with nothing to act on. Checked before stop_live,
    // so a refused pick keeps the speaker we already have. `on_speaker` skips our own claim
    // and any holder that is no longer running.
    if let Some(other) = claim::on_speaker(&speaker.name) {
        let ours = std::env::current_exe()
            .ok()
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
            .unwrap_or_else(|| "DeetsMusic.exe".into());
        log(&format!("connect refused: the speaker is held by {} (sends ours: {})", other.app, other.send.carries(&ours)));
        // The name is quoted: toast.ts drops quoted names from the log.
        return Err(if other.send.carries(&ours) {
            format!("{} is already sending this PC's sound to “{}”, so your music plays there now.", other.app, speaker.name)
        } else {
            format!("{} is playing on “{}”. Disconnect it there first.", other.app, speaker.name)
        });
    }
    stop_live(&state);
    *state.error.lock().unwrap() = None;
    *state.connecting.lock().unwrap() = Some(speaker.name.clone());
    let result = start_live(app, speaker.clone(), None);
    *state.connecting.lock().unwrap() = None;
    match result {
        Ok(live) => {
            *state.live.lock().unwrap() = Some(live);
            publish_tap(&state);
            app.state::<Settings>().update(|d| d.airplay_last_speaker = Some(speaker)).ok();
            // The speaker learns the current song right away.
            let np = app.state::<bridge::Hub>().np.lock().unwrap().clone();
            push_now_playing(app, &np, true);
            Ok(())
        }
        Err(e) => {
            let plain = plain_error(&speaker.name, &e);
            *state.error.lock().unwrap() = Some(plain.clone());
            Err(plain)
        }
    }
}

/// Reconnect in place (auto retune, a preference change). Keeps the speaker.
fn reconnect(app: &AppHandle, rtt_p95_ms: Option<f64>) -> Result<(), String> {
    let state = app.state::<AirplayState>();
    let Some(live) = state.live.lock().unwrap().take() else { return Ok(()) };
    let speaker = live.speaker.clone();
    live.session.disconnect();
    publish_tap(&state); // between sessions: no ring
    let mut live = start_live(app, speaker, rtt_p95_ms)?;
    live.retuned = true;
    *state.live.lock().unwrap() = Some(live);
    publish_tap(&state);
    let np = app.state::<bridge::Hub>().np.lock().unwrap().clone();
    push_now_playing(app, &np, true);
    Ok(())
}

/// A capture change while connected reconnects in place.
pub fn prefs_changed(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = reconnect(&app, None) {
            log(&format!("reconnect after prefs change failed: {e}"));
        }
    });
}

/// Quit: tear the stream down (TEARDOWN, so the speaker frees the session).
/// Called from the tray's Quit.
pub fn shutdown(app: &AppHandle) {
    stop_live(&app.state::<AirplayState>());
}

// ── now playing → the speaker ────────────────────────────────────────────

/// Every front-end publish lands here (bridge::np_publish). While connected:
/// title/artist/album on change, cover art on change, progress on a track
/// change, a play/pause flip, or a seek. Cheap when nothing changed.
pub fn on_np_state(app: &AppHandle, np: &NpState) {
    push_now_playing(app, np, false);
}

fn push_now_playing(app: &AppHandle, np: &NpState, force: bool) {
    let state = app.state::<AirplayState>();
    let mut guard = state.live.lock().unwrap();
    let Some(live) = guard.as_mut() else { return };

    let meta = Metadata {
        title: np.title.clone().or_else(|| np.station.clone()).unwrap_or_default(),
        artist: np.artist.clone().unwrap_or_default(),
        album: np.album.clone().unwrap_or_default(),
    };
    let track_changed = force || meta != live.meta;
    if track_changed {
        live.meta = meta.clone();
        if let Err(e) = live.session.set_metadata(&meta) {
            log(&format!("metadata: {e}"));
        }
    }
    if force || np.artwork_url != live.art_url {
        live.art_url = np.artwork_url.clone();
        if let Some(url) = np.artwork_url.clone() {
            fetch_artwork(app.clone(), url);
        }
    }
    let resend = match live.progress {
        None => true,
        Some((at, pos, playing)) => {
            let expected = if playing { pos + at.elapsed().as_secs_f64() } else { pos };
            playing != np.playing || (np.current_time - expected).abs() > 2.0
        }
    };
    if (track_changed || resend) && np.duration > 0.0 {
        live.progress = Some((Instant::now(), np.current_time, np.playing));
        if let Err(e) = live.session.set_progress(np.current_time, np.duration) {
            log(&format!("progress: {e}"));
        }
    }
}

/// Cover art comes from Apple's image CDN (not the API); one fetch per track
/// change, sent as-is. Off the caller's thread: a publish must never wait on
/// the network.
fn fetch_artwork(app: AppHandle, url: String) {
    tauri::async_runtime::spawn(async move {
        let fetched = async {
            let r = reqwest::get(&url).await.map_err(|e| e.to_string())?;
            let ct = r.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("image/jpeg").to_string();
            let bytes = r.bytes().await.map_err(|e| e.to_string())?;
            Ok::<_, String>((ct, bytes.to_vec()))
        }
        .await;
        match fetched {
            Ok((ct, bytes)) => {
                let state = app.state::<AirplayState>();
                let guard = state.live.lock().unwrap();
                // Only if this is still the current cover (a fast skip can outrun the fetch).
                if let Some(live) = guard.as_ref().filter(|l| l.art_url.as_deref() == Some(url.as_str())) {
                    let ct = if ct.starts_with("image/png") { "image/png" } else { "image/jpeg" };
                    if let Err(e) = live.session.set_artwork(&bytes, ct) {
                        log(&format!("artwork: {e}"));
                    }
                }
            }
            Err(e) => log(&format!("artwork fetch: {e}")),
        }
    });
}

// ── the Windows Firewall prompt (once, UAC) ──────────────────────────────

/// The speaker sends unsolicited UDP (timing requests) to us; without an
/// inbound rule Windows drops it and the connect stalls. Adding a rule needs
/// elevation, so this asks once through UAC via netsh. Release builds only:
/// a dev exe gets its rule by hand (AIRPLAY.md §4).
#[cfg(not(debug_assertions))]
fn firewall_add_rule() -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let args = format!(
        "advfirewall firewall add rule name=\"DeetsMusic\" dir=in action=allow protocol=udp enable=yes program=\"{}\"",
        exe.display()
    );
    let cmd = format!("Start-Process -FilePath netsh -Verb RunAs -WindowStyle Hidden -ArgumentList '{}'", args.replace('\'', "''"));
    std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &cmd])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|e| format!("powershell: {e}"))?;
    Ok(())
}

#[cfg(debug_assertions)]
fn firewall_add_rule() -> Result<(), String> {
    log("firewall: dev build, no prompt (add the rule for target\\debug\\deetsmusic.exe by hand)");
    Ok(())
}

// ── commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn airplay_scan(app: AppHandle) -> Result<Vec<SpeakerInfo>, String> {
    let found = tauri::async_runtime::spawn_blocking(|| mdns::browse(Duration::from_millis(2500)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("mDNS: {e}"))?;
    let infos: Vec<SpeakerInfo> = found
        .into_iter()
        .filter_map(|s| s.ip.map(|ip| SpeakerInfo { name: s.name, ip: ip.to_string(), port: s.port, model: s.model }))
        .collect();
    *app.state::<AirplayState>().speakers.lock().unwrap() = infos.clone();
    Ok(infos)
}

#[tauri::command]
pub async fn airplay_connect(app: AppHandle, speaker: AirplaySpeaker) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || connect_speaker(&app, speaker)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn airplay_disconnect(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AirplayState>();
        stop_live(&state);
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn airplay_status(app: AppHandle) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AirplayState>();

        // Drop a session whose threads died (the speaker went away).
        let dead = state.live.lock().unwrap().as_ref().map(|l| !l.session.alive()).unwrap_or(false);
        if dead {
            let name = state.live.lock().unwrap().as_ref().map(|l| l.speaker.name.clone()).unwrap_or_default();
            stop_live(&state);
            *state.error.lock().unwrap() = Some(format!("Lost {name}."));
        }

        // Auto delay: after 10 s of round trips, settle the buffer once.
        let retune = {
            let live = state.live.lock().unwrap();
            match live.as_ref() {
                Some(l) if !l.retuned => {
                    let st = l.session.stats();
                    if st.seconds >= 10 && st.rtt_p95_ms > 0.0 {
                        let target = latency_frames(Some(st.rtt_p95_ms));
                        let current = l.session.config.latency_frames;
                        let diff_ms = (target as i64 - current as i64).unsigned_abs() as u32 * 1000 / SAMPLE_RATE;
                        if diff_ms >= 100 { Some(st.rtt_p95_ms) } else { None }
                    } else {
                        None
                    }
                }
                _ => None,
            }
        };
        if let Some(rtt) = retune {
            if let Err(e) = reconnect(&app, Some(rtt)) {
                log(&format!("retune reconnect failed: {e}"));
            }
        } else if let Some(l) = state.live.lock().unwrap().as_mut() {
            if !l.retuned && l.session.stats().seconds >= 10 && l.session.stats().rtt_p95_ms > 0.0 {
                l.retuned = true; // inside the band: call it tuned so we never flap
            }
        }

        // Diagnostic: what the capture heard, judged per 10 s window. "silence" while
        // the player says playing means the tap is not seeing this app's sound. Logged
        // when the verdict changes, and every 10 min while it holds (was every 10 s:
        // 59% of the log, 2026-09-16).
        if let Some(l) = state.live.lock().unwrap().as_mut() {
            if l.heard_logged.0.elapsed() >= Duration::from_secs(10) {
                let (all, loud) = l.capture.stats();
                let (d_all, d_loud) = (all - l.heard_logged.1, loud - l.heard_logged.2);
                let verdict = if d_all == 0 { "nothing" } else if d_loud == 0 { "silence" } else { "sound" };
                let due = match l.heard_said {
                    Some((said, at)) => said != verdict || at.elapsed() >= Duration::from_secs(600),
                    None => true,
                };
                if due {
                    log(&format!("capture heard {verdict}: {d_all} frames, {d_loud} not silent, in the last {} s", l.heard_logged.0.elapsed().as_secs()));
                    l.heard_said = Some((verdict, Instant::now()));
                }
                l.heard_logged = (Instant::now(), all, loud);
            }
            // Tap mode (AIRPLAY.md §12 item 13): the player says playing but the tap delivers
            // nothing. Logged once per session; the panel shows a note; no automatic switch
            // (the cause gets found first).
            if l.tap.is_some() {
                let playing = app.state::<bridge::Hub>().np.lock().unwrap().playing;
                let (all, _) = l.capture.stats();
                let delivering = all > l.heard_logged.1 || l.heard_logged.0.elapsed() < Duration::from_secs(1);
                if playing && !delivering {
                    let since = *l.starved_since.get_or_insert_with(Instant::now);
                    if since.elapsed() >= Duration::from_secs(TAP_STARVED_SECS) && !l.starved_logged {
                        l.starved_logged = true;
                        log(&format!("tap starved: playing for {} s, no chunk from the page", since.elapsed().as_secs()));
                    }
                } else {
                    l.starved_since = None;
                }
            }
        }

        // The speaker's level as heard: the poll's reading once it has one (Siri and the
        // touch surface move it), else what the handshake set. Either way, remembered.
        let heard = state.live.lock().unwrap().as_ref().map(|l| (l.speaker.name.clone(), l.session.receiver_volume_pct().unwrap_or(l.session.config.volume_pct)));
        if let Some((name, pct)) = &heard {
            remember_volume(&app, name, *pct);
        }
        let connected = state.live.lock().unwrap().as_ref().map(|l| Connected {
            speaker: l.speaker.clone(),
            seconds: l.session.stats().seconds,
            latency_ms: l.session.stats().latency_ms,
            volume: heard.as_ref().map(|(_, pct)| *pct),
            tap: l.tap.is_some(),
            tap_starved: l.starved_since.map_or(false, |t| t.elapsed() >= Duration::from_secs(TAP_STARVED_SECS)),
        });
        let settings = app.state::<Settings>().get();
        let status = Status {
            connected,
            connecting: state.connecting.lock().unwrap().clone(),
            error: state.error.lock().unwrap().clone(),
            last_speaker: settings.airplay_last_speaker,
            speakers: state.speakers.lock().unwrap().clone(),
            firewall_seeded: firewall_seeded(&app),
            capture: settings.airplay_capture,
        };
        Ok(status)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// One chunk from the page's tap (AIRPLAY.md §12): interleaved stereo i16 at 44.1 kHz as
/// the raw request body (no JSON; ~11 calls a second of 16 KB). Pushed into the live tap
/// session's ring, dropped when there is none. Synchronous on purpose: a mutex push, no
/// network, no WASAPI.
#[tauri::command]
pub fn airplay_tap(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("tap: expected raw bytes".into());
    };
    let state = app.state::<AirplayState>();
    let Some(ring) = state.tap.lock().unwrap().clone() else { return Ok(()) };
    let samples: Vec<i16> = bytes.chunks_exact(2).map(|p| i16::from_le_bytes([p[0], p[1]])).collect();
    ring.push(&samples);
    Ok(())
}

/// The app's one volume slider drives the speaker while connected (AIRPLAY.md decision 4).
#[tauri::command]
pub async fn airplay_volume(app: AppHandle, pct: f64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AirplayState>();
        let name = {
            let mut live = state.live.lock().unwrap();
            let Some(l) = live.as_mut() else { return Ok(()) };
            l.session.set_volume(pct.clamp(0.0, 100.0))?;
            l.speaker.name.clone()
        };
        remember_volume(&app, &name, pct);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Has THIS exe had its firewall prompt? A dev build never needs one (its rule is
/// added by hand, AIRPLAY.md §4), and never records anything, so it cannot mark the
/// installed build as done — they share settings.json.
fn firewall_seeded(app: &AppHandle) -> bool {
    if cfg!(debug_assertions) {
        return true;
    }
    let me = std::env::current_exe().ok().map(|p| p.display().to_string());
    me.is_some() && app.state::<Settings>().get().airplay_firewall_exe == me
}

/// The one-shot firewall prompt, before the first connect. Marks this exe done
/// whatever the outcome, so a "No" is not asked again every time.
#[tauri::command]
pub async fn airplay_firewall_prompt(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if firewall_seeded(&app) {
            return Ok(());
        }
        if let Err(e) = firewall_add_rule() {
            log(&format!("firewall: {e}"));
        }
        let me = std::env::current_exe().ok().map(|p| p.display().to_string());
        app.state::<Settings>().update(|d| d.airplay_firewall_exe = me).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}
