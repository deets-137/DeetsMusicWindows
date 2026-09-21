//! Our own Windows media session (System Media Transport Controls).
//!
//! WebView2 handles the hardware media keys on its own but never registers a
//! session with metadata, so the Win11 media overlay stayed blank (verified
//! 2026-09-10). This registers a native session on the main window's HWND: the
//! overlay shows cover / title / artist / album with a live scrubber, and the
//! overlay's buttons + the media keys come back as the same `np-command` events
//! the tray panel already sends (bridge.rs → np-bus.ts). Chromium's own key
//! handling is switched off in `tauri.conf.json` so a press is not handled twice.
//!
//! Fed from `np_publish` (the one relay point every player state change passes
//! through). Metadata is only re-pushed when it changes; status + timeline are
//! cheap and follow every publish. `media.rs::is_self` already skips this
//! session when the tray panel looks for a *foreign* player.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, WebviewWindow};
use windows::core::{factory, HSTRING};
use windows::Foundation::{TimeSpan, TypedEventHandler, Uri};
use windows::Media::{
    MediaPlaybackStatus, MediaPlaybackType,
    SystemMediaTransportControls, SystemMediaTransportControlsButton as Button,
    SystemMediaTransportControlsButtonPressedEventArgs as ButtonArgs,
    SystemMediaTransportControlsTimelineProperties as Timeline,
    PlaybackPositionChangeRequestedEventArgs as SeekArgs,
};
use windows::Storage::Streams::RandomAccessStreamReference;
use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;

use crate::bridge::{NpCommand, NpState};

static SMTC: Mutex<Option<SystemMediaTransportControls>> = Mutex::new(None);
/// Last (title, artist, album, art) pushed to the display updater — skip repeats.
static LAST_META: Mutex<Option<String>> = Mutex::new(None);
/// Last known duration (s), so a seek request can be turned into a fraction.
static LAST_DURATION: Mutex<f64> = Mutex::new(0.0);

/// Artwork size asked of Apple's `{w}x{h}` template for the overlay.
const ART_PX: u32 = 512;

const fn ticks(secs: f64) -> TimeSpan {
    TimeSpan { Duration: (secs * 10_000_000.0) as i64 }
}

fn send(app: &AppHandle, kind: &str, value: Option<f64>) {
    let _ = app.emit_to("main", "np-command", NpCommand { kind: kind.to_string(), value, from: Some("windows".into()) });
}

/// Register the session on the main window. Call once from `setup`, on the
/// main thread (the interop wants the window's thread).
pub fn init(app: AppHandle, win: &WebviewWindow) -> Result<(), String> {
    let hwnd = win.hwnd().map_err(|e| format!("main hwnd: {e}"))?;
    let interop = factory::<SystemMediaTransportControls, ISystemMediaTransportControlsInterop>()
        .map_err(|e| format!("smtc interop: {e}"))?;
    let smtc: SystemMediaTransportControls =
        unsafe { interop.GetForWindow(hwnd) }.map_err(|e| format!("smtc for window: {e}"))?;

    smtc.SetIsEnabled(false).map_err(|e| e.to_string())?;
    smtc.SetIsPlayEnabled(true).map_err(|e| e.to_string())?;
    smtc.SetIsPauseEnabled(true).map_err(|e| e.to_string())?;
    smtc.SetIsStopEnabled(false).map_err(|e| e.to_string())?;
    smtc.SetPlaybackStatus(MediaPlaybackStatus::Closed).map_err(|e| e.to_string())?;
    smtc.DisplayUpdater()
        .and_then(|d| d.SetType(MediaPlaybackType::Music))
        .map_err(|e| e.to_string())?;

    let a = app.clone();
    smtc.ButtonPressed(&TypedEventHandler::<SystemMediaTransportControls, ButtonArgs>::new(
        move |_, args| {
            let Some(args) = args.as_ref() else { return Ok(()) };
            match args.Button()? {
                Button::Play | Button::Pause => send(&a, "play-pause", None),
                Button::Next => send(&a, "next", None),
                Button::Previous => send(&a, "previous", None),
                _ => {}
            }
            Ok(())
        },
    ))
    .map_err(|e| e.to_string())?;

    let a = app;
    smtc.PlaybackPositionChangeRequested(&TypedEventHandler::<
        SystemMediaTransportControls,
        SeekArgs,
    >::new(move |_, args| {
        let Some(args) = args.as_ref() else { return Ok(()) };
        let secs = args.RequestedPlaybackPosition()?.Duration as f64 / 10_000_000.0;
        let dur = *LAST_DURATION.lock().unwrap();
        if dur > 0.0 {
            send(&a, "seek", Some((secs / dur).clamp(0.0, 1.0)));
        }
        Ok(())
    }))
    .map_err(|e| e.to_string())?;

    *SMTC.lock().unwrap() = Some(smtc);
    Ok(())
}

/// Mirror a published player state onto the session. Errors are swallowed —
/// the overlay is a courtesy, never a reason to fail a publish.
pub fn update(s: &NpState) {
    let guard = SMTC.lock().unwrap();
    let Some(smtc) = guard.as_ref() else { return };
    let _ = apply(smtc, s);
}

fn apply(smtc: &SystemMediaTransportControls, s: &NpState) -> windows::core::Result<()> {
    *LAST_DURATION.lock().unwrap() = s.duration;

    if !s.active {
        smtc.SetIsEnabled(false)?;
        smtc.SetPlaybackStatus(MediaPlaybackStatus::Closed)?;
        let d = smtc.DisplayUpdater()?;
        d.ClearAll()?;
        d.Update()?;
        *LAST_META.lock().unwrap() = None;
        return Ok(());
    }

    smtc.SetIsEnabled(true)?;
    // A live station has no skip (STATIONS.md §1) — mirror the in-app caps.
    smtc.SetIsNextEnabled(!s.live)?;
    smtc.SetIsPreviousEnabled(!s.live)?;
    smtc.SetPlaybackStatus(if s.playing {
        MediaPlaybackStatus::Playing
    } else {
        MediaPlaybackStatus::Paused
    })?;

    // Metadata: only when it changed.
    let art = s
        .artwork_template
        .as_deref()
        .map(|t| {
            t.replace("{w}", &ART_PX.to_string())
                .replace("{h}", &ART_PX.to_string())
                .replace("{f}", "jpg")
        })
        .or_else(|| s.artwork_url.clone());
    // A station reads better as the album line than the track's own album.
    let album = s.station.as_deref().or(s.album.as_deref()).unwrap_or_default();
    let key = format!(
        "{}\u{1}{}\u{1}{}\u{1}{}",
        s.title.as_deref().unwrap_or_default(),
        s.artist.as_deref().unwrap_or_default(),
        album,
        art.as_deref().unwrap_or_default()
    );
    let stale = LAST_META.lock().unwrap().as_deref() != Some(key.as_str());
    if stale {
        let d = smtc.DisplayUpdater()?;
        d.ClearAll()?;
        d.SetType(MediaPlaybackType::Music)?;
        let m = d.MusicProperties()?;
        m.SetTitle(&HSTRING::from(s.title.as_deref().unwrap_or_default()))?;
        m.SetArtist(&HSTRING::from(s.artist.as_deref().unwrap_or_default()))?;
        m.SetAlbumTitle(&HSTRING::from(album))?;
        if let Some(url) = art.as_deref().filter(|u| u.starts_with("http")) {
            if let Ok(uri) = Uri::CreateUri(&HSTRING::from(url)) {
                if let Ok(stream) = RandomAccessStreamReference::CreateFromUri(&uri) {
                    d.SetThumbnail(&stream)?;
                }
            }
        }
        d.Update()?;
        *LAST_META.lock().unwrap() = Some(key);
    }

    // Timeline: a real scrubber for finite tracks, nothing for live radio.
    let tl = Timeline::new()?;
    if !s.live && s.duration.is_finite() && s.duration > 0.0 {
        let pos = s.current_time.clamp(0.0, s.duration);
        tl.SetStartTime(ticks(0.0))?;
        tl.SetMinSeekTime(ticks(0.0))?;
        tl.SetEndTime(ticks(s.duration))?;
        tl.SetMaxSeekTime(ticks(s.duration))?;
        tl.SetPosition(ticks(pos))?;
    } else {
        tl.SetStartTime(ticks(0.0))?;
        tl.SetEndTime(ticks(0.0))?;
        tl.SetPosition(ticks(0.0))?;
    }
    smtc.UpdateTimelineProperties(&tl)?;
    Ok(())
}
