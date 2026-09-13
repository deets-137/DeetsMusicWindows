//! AirPlay (docs/AIRPLAY.md): play what this app plays on a HomePod. The sender
//! is the shared `deets-airplay` crate; this file owns the one live session,
//! the capture choice, the automatic delay, the now-playing metadata, and the
//! transport commands the speaker relays back.
//!
//! The PC keeps playing while a speaker does: the per-process tap copies the
//! sound AFTER the app's own Windows-mixer volume, so muting DeetsMusic there
//! silences the speaker too (measured on the desk 2026-09-10). No mute here.
//!
//! Every command that touches the network or WASAPI runs on `spawn_blocking`.

use std::net::Ipv4Addr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use deets_airplay::airplay::alac::SAMPLE_RATE;
use deets_airplay::airplay::mdns;
use deets_airplay::airplay::rtsp::RemoteCommand;
use deets_airplay::airplay::session::{self, Config, Metadata, Session, MAX_LATENCY_FRAMES, MIN_LATENCY_FRAMES};
use deets_airplay::capture::Capture;
use deets_airplay::mixer;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::bridge::{self, NpCommand, NpState};
use crate::settings::{AirplayCapture, AirplaySpeaker, Settings};

/// The one live stream: the session, the capture feeding it, and what the
/// speaker has been told so far.
struct Live {
    session: Session,
    capture: Capture,
    /// Last capture stats logged (frames in, frames not silent), for the diagnostic line.
    heard_logged: (Instant, u64, u64),
    speaker: AirplaySpeaker,
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
}

/// Flip for v2: honours the "DeetsMusic only" setting (AIRPLAY.md §10).
const V2_PER_PROCESS: bool = false;

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
    crate::log::info(&format!("airplay: {line}"));
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
        format!("Couldn't reach {speaker}. Check that it is on the same Wi-Fi.")
    } else if e_l.contains("pair") || e_l.contains("srp") || e_l.contains("auth") {
        format!("{speaker} didn't accept the connection. Try again in a moment.")
    } else if e_l.contains("loopback") || e_l.contains("capture") || e_l.contains("wasapi") {
        "Couldn't capture this app's sound. Is a song playing?".to_string()
    } else {
        format!("Couldn't play on {speaker}.")
    }
}

fn start_live(app: &AppHandle, speaker: AirplaySpeaker, rtt_p95_ms: Option<f64>) -> Result<Live, String> {
    let settings = app.state::<Settings>().get();
    let ip: Ipv4Addr = speaker.ip.parse().map_err(|_| format!("bad speaker address {}", speaker.ip))?;
    // v1 ships "All PC sound" only (user's call 2026-09-10, AIRPLAY.md §10): the
    // per-process path works from the probe but needs the WebView2-child target
    // and more desk time before it is trusted. The setting stays on disk for v2.
    let capture = match settings.airplay_capture {
        AirplayCapture::App if V2_PER_PROCESS => Capture::start_process(capture_target())?,
        _ => Capture::start()?,
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
    log(&format!("connect {} at {}:{} (capture: {})", speaker.name, speaker.ip, speaker.port, capture.format_note));
    let session = session::connect(ip, speaker.port, &speaker.name, config, capture.source()).map_err(|e| {
        log(&format!("connect FAILED: {e}"));
        e
    })?;
    Ok(Live {
        session,
        capture,
        heard_logged: (Instant::now(), 0, 0),
        speaker,
        retuned: rtt_p95_ms.is_some(),
        meta: Metadata::default(),
        art_url: None,
        progress: None,
    })
}

/// The process whose tree the "DeetsMusic only" capture follows. Our sound is
/// rendered by WebView2, and Windows' process loopback does not follow the tree
/// from this exe into it (measured: capturing our own pid hears nothing), so
/// target the WebView2 browser process — our direct `msedgewebview2.exe` child,
/// whose own children (the audio utility) the tree flag does reach.
fn capture_target() -> u32 {
    let me = std::process::id();
    match mixer::children_named(me, "msedgewebview2.exe").first() {
        Some(&pid) => pid,
        None => {
            log("no WebView2 child found; capturing our own pid");
            me
        }
    }
}

fn stop_live(state: &AirplayState) {
    if let Some(live) = state.live.lock().unwrap().take() {
        live.session.disconnect();
    }
}

fn connect_speaker(app: &AppHandle, speaker: AirplaySpeaker) -> Result<(), String> {
    let state = app.state::<AirplayState>();
    stop_live(&state);
    *state.error.lock().unwrap() = None;
    *state.connecting.lock().unwrap() = Some(speaker.name.clone());
    let result = start_live(app, speaker.clone(), None);
    *state.connecting.lock().unwrap() = None;
    match result {
        Ok(live) => {
            *state.live.lock().unwrap() = Some(live);
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
    let mut live = start_live(app, speaker, rtt_p95_ms)?;
    live.retuned = true;
    *state.live.lock().unwrap() = Some(live);
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

        // Diagnostic: what the capture heard since the last line. "loud=0" while
        // the player says playing means the tap is not seeing this app's sound.
        if let Some(l) = state.live.lock().unwrap().as_mut() {
            if l.heard_logged.0.elapsed() >= Duration::from_secs(10) {
                let (all, loud) = l.capture.stats();
                log(&format!("capture heard {} frames, {} not silent, in the last {} s", all - l.heard_logged.1, loud - l.heard_logged.2, l.heard_logged.0.elapsed().as_secs()));
                l.heard_logged = (Instant::now(), all, loud);
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
        });
        let settings = app.state::<Settings>().get();
        let status = Status {
            connected,
            connecting: state.connecting.lock().unwrap().clone(),
            error: state.error.lock().unwrap().clone(),
            last_speaker: settings.airplay_last_speaker,
            speakers: state.speakers.lock().unwrap().clone(),
            firewall_seeded: firewall_seeded(&app),
        };
        Ok(status)
    })
    .await
    .map_err(|e| e.to_string())?
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
