//! The OS media session (TRAY.md §3) — the tray panel's fallback source: what another app is
//! playing, its transport, and the master volume. The reads are `os::system_media`
//! (OS-LAYER.md §11.1). Every call blocks, so each command runs it on `spawn_blocking`.

use crate::os::system_media::{now_playing, seek, set_system_mute, set_system_volume, system_volume, transport};
use crate::os::{SystemVolume, Transport, WinNowPlaying};

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
