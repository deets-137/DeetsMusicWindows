//! Windows media session (TRAY.md §3) — the tray panel's fallback source.
//!
//! When DeetsMusic itself has nothing loaded, the tray reads whatever Windows'
//! Global System Media Transport Controls session reports (Spotify, a browser tab,
//! any app that paints the Win11 volume flyout): title / artist / album, the
//! thumbnail, the timeline, and the transport it accepts. Transport and seek go
//! back through the same session; volume is the system master level, because a
//! GSMTC session has no per-app volume.
//!
//! Ported from DeetsAirplay's `media.rs` and extended. Every WinRT call blocks on
//! `.get()`, so callers run these on `spawn_blocking` — never on the main thread.

use serde::Serialize;
use std::sync::Mutex;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Storage::Streams::DataReader;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Transport {
    Previous,
    PlayPause,
    Next,
}

/// The tray's view of the Windows session. `present == false` means no app has
/// registered one (or the only one is DeetsMusic's own WebView2).
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WinNowPlaying {
    pub present: bool,
    pub playing: bool,
    pub title: String,
    pub artist: String,
    pub album: String,
    /// Source app's AUMID (e.g. `Spotify.exe`, `MSEdge`). The UI turns it into a label.
    pub app_id: String,
    pub position_secs: f64,
    pub duration_secs: f64,
    pub can_seek: bool,
    /// Thumbnail as a data: URL, or absent when the app offers none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub art_data_url: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemVolume {
    pub level: f32, // 0..1 scalar
    pub muted: bool,
}

/// Our own process re-registers a session through WebView2 (media-session.ts) —
/// that must never count as "something else is playing".
fn is_self(app_id: &str) -> bool {
    let a = app_id.to_ascii_lowercase();
    a.contains("deetsmusic") || a.contains("msedgewebview2")
}

/// Pick the session to mirror: Windows' current one unless it is us; otherwise the
/// first playing foreign session, otherwise any foreign session.
fn pick_session(manager: &Manager) -> windows::core::Result<Option<Session>> {
    if let Ok(cur) = manager.GetCurrentSession() {
        if !is_self(&cur.SourceAppUserModelId()?.to_string()) {
            return Ok(Some(cur));
        }
    }
    let sessions = manager.GetSessions()?;
    let mut fallback: Option<Session> = None;
    for s in sessions {
        if is_self(&s.SourceAppUserModelId()?.to_string()) {
            continue;
        }
        let playing = s.GetPlaybackInfo().and_then(|p| p.PlaybackStatus()).map(|st| st == Status::Playing).unwrap_or(false);
        if playing {
            return Ok(Some(s));
        }
        if fallback.is_none() {
            fallback = Some(s);
        }
    }
    Ok(fallback)
}

/// 100-ns ticks since 1601 → now, for interpolating a stale timeline position.
fn filetime_now() -> i64 {
    let unix = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    (unix.as_nanos() / 100) as i64 + 116_444_736_000_000_000
}

// Thumbnail cache: reading the stream costs a few ms and the panel polls at ~2 Hz,
// so remember the last one by (app, title, artist).
static ART_CACHE: Mutex<Option<(String, Option<String>)>> = Mutex::new(None);

fn read_thumbnail(session: &Session, key: &str) -> Option<String> {
    if let Some((k, v)) = ART_CACHE.lock().unwrap().as_ref() {
        if k == key {
            return v.clone();
        }
    }
    let inner = || -> windows::core::Result<Option<String>> {
        let props = session.TryGetMediaPropertiesAsync()?.get()?;
        let Ok(thumb) = props.Thumbnail() else { return Ok(None) };
        let stream = thumb.OpenReadAsync()?.get()?;
        let size = stream.Size()? as u32;
        if size == 0 || size > 4_000_000 {
            return Ok(None);
        }
        let mime = stream.ContentType().map(|s| s.to_string()).unwrap_or_else(|_| "image/jpeg".into());
        let reader = DataReader::CreateDataReader(&stream)?;
        reader.LoadAsync(size)?.get()?;
        let mut buf = vec![0u8; size as usize];
        reader.ReadBytes(&mut buf)?;
        Ok(Some(format!("data:{mime};base64,{}", base64_encode(&buf))))
    };
    let v = inner().unwrap_or(None);
    *ART_CACHE.lock().unwrap() = Some((key.to_string(), v.clone()));
    v
}

/// Standard base64 (no external crate needed for a thumbnail).
fn base64_encode(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Snapshot the Windows session. Empty (`present: false`) when nothing foreign is
/// registered. Never panics — every failure collapses to the empty snapshot.
pub fn now_playing() -> WinNowPlaying {
    let inner = || -> windows::core::Result<WinNowPlaying> {
        let manager = Manager::RequestAsync()?.get()?;
        let Some(session) = pick_session(&manager)? else { return Ok(WinNowPlaying::default()) };
        let app_id = session.SourceAppUserModelId()?.to_string();
        let info = session.GetPlaybackInfo()?;
        let playing = info.PlaybackStatus()? == Status::Playing;
        let can_seek = info.Controls().and_then(|c| c.IsPlaybackPositionEnabled()).unwrap_or(false);
        let props = session.TryGetMediaPropertiesAsync()?.get()?;
        let title = props.Title()?.to_string();
        let artist = props.Artist()?.to_string();
        let album = props.AlbumTitle().map(|s| s.to_string()).unwrap_or_default();

        let (mut position, duration) = match session.GetTimelineProperties() {
            Ok(tl) => {
                let start = tl.StartTime().map(|t| t.Duration).unwrap_or(0);
                let end = tl.EndTime().map(|t| t.Duration).unwrap_or(0);
                let mut pos = tl.Position().map(|t| t.Duration).unwrap_or(0) - start;
                // Apps report position sparsely; walk it forward from the last report.
                if playing {
                    if let Ok(updated) = tl.LastUpdatedTime() {
                        let elapsed = filetime_now() - updated.UniversalTime;
                        if elapsed > 0 && elapsed < 10 * 60 * 10_000_000 {
                            pos += elapsed;
                        }
                    }
                }
                (pos as f64 / 1e7, (end - start) as f64 / 1e7)
            }
            Err(_) => (0.0, 0.0),
        };
        if duration > 0.0 {
            position = position.clamp(0.0, duration);
        }
        let key = format!("{app_id}\u{1f}{title}\u{1f}{artist}");
        let art_data_url = if title.is_empty() { None } else { read_thumbnail(&session, &key) };
        Ok(WinNowPlaying {
            present: !title.is_empty() || playing,
            playing,
            title,
            artist,
            album,
            app_id,
            position_secs: position,
            duration_secs: duration,
            can_seek,
            art_data_url,
        })
    };
    inner().unwrap_or_default()
}

/// Drive the mirrored session. Returns false when no session accepted the request.
pub fn transport(t: Transport) -> bool {
    let inner = || -> windows::core::Result<bool> {
        let manager = Manager::RequestAsync()?.get()?;
        let Some(session) = pick_session(&manager)? else { return Ok(false) };
        let op = match t {
            Transport::Previous => session.TrySkipPreviousAsync()?,
            Transport::PlayPause => session.TryTogglePlayPauseAsync()?,
            Transport::Next => session.TrySkipNextAsync()?,
        };
        op.get()
    };
    inner().unwrap_or(false)
}

/// Seek the mirrored session to an absolute position in seconds.
pub fn seek(secs: f64) -> bool {
    let inner = || -> windows::core::Result<bool> {
        let manager = Manager::RequestAsync()?.get()?;
        let Some(session) = pick_session(&manager)? else { return Ok(false) };
        let start = session.GetTimelineProperties().and_then(|tl| tl.StartTime()).map(|t| t.Duration).unwrap_or(0);
        session.TryChangePlaybackPositionAsync(start + (secs.max(0.0) * 1e7) as i64)?.get()
    };
    inner().unwrap_or(false)
}

// ── system master volume (the Windows source has no per-app level) ────────────

fn endpoint_volume() -> windows::core::Result<IAudioEndpointVolume> {
    unsafe {
        // Already-initialised threads return RPC_E_CHANGED_MODE / S_FALSE; both are fine.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
        device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
    }
}

pub fn system_volume() -> SystemVolume {
    let inner = || -> windows::core::Result<SystemVolume> {
        let ep = endpoint_volume()?;
        unsafe { Ok(SystemVolume { level: ep.GetMasterVolumeLevelScalar()?, muted: ep.GetMute()?.as_bool() }) }
    };
    inner().unwrap_or_default()
}

pub fn set_system_volume(level: f32) -> Result<SystemVolume, String> {
    let inner = || -> windows::core::Result<()> {
        let ep = endpoint_volume()?;
        unsafe {
            ep.SetMasterVolumeLevelScalar(level.clamp(0.0, 1.0), std::ptr::null())?;
            if level > 0.0 && ep.GetMute()?.as_bool() {
                ep.SetMute(false, std::ptr::null())?;
            }
        }
        Ok(())
    };
    inner().map_err(|e| e.to_string())?;
    Ok(system_volume())
}

pub fn set_system_mute(muted: bool) -> Result<SystemVolume, String> {
    let inner = || -> windows::core::Result<()> {
        let ep = endpoint_volume()?;
        unsafe { ep.SetMute(muted, std::ptr::null()) }
    };
    inner().map_err(|e| e.to_string())?;
    Ok(system_volume())
}

// ── commands (all blocking WinRT/COM → spawn_blocking) ────────────────────────

#[tauri::command]
pub async fn win_media_now_playing() -> WinNowPlaying {
    tauri::async_runtime::spawn_blocking(now_playing).await.unwrap_or_default()
}

#[tauri::command]
pub async fn win_media_transport(kind: Transport) -> bool {
    tauri::async_runtime::spawn_blocking(move || transport(kind)).await.unwrap_or(false)
}

#[tauri::command]
pub async fn win_media_seek(secs: f64) -> bool {
    tauri::async_runtime::spawn_blocking(move || seek(secs)).await.unwrap_or(false)
}

#[tauri::command]
pub async fn system_volume_get() -> SystemVolume {
    tauri::async_runtime::spawn_blocking(system_volume).await.unwrap_or_default()
}

#[tauri::command]
pub async fn system_volume_set(level: f32) -> Result<SystemVolume, String> {
    tauri::async_runtime::spawn_blocking(move || set_system_volume(level)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn system_volume_mute(muted: bool) -> Result<SystemVolume, String> {
    tauri::async_runtime::spawn_blocking(move || set_system_mute(muted)).await.map_err(|e| e.to_string())?
}
