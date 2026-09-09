//! Back-end settings (TRAY.md / EXTENSION.md): the handful of choices the Rust
//! side has to know BEFORE the webview is up — whether × hides to the tray, whether
//! the tray panel may read the Windows media session, and the extension pairing
//! token. Front-end-only preferences (theme, skin, menu mode, Library Add …) stay in
//! localStorage as before; this file is deliberately tiny.
//!
//! Persisted as JSON at `<app_data>/settings.json`. Every field has a default so a
//! missing or stale file never blocks startup.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsData {
    /// × hides the main window to the tray instead of quitting (default on).
    pub minimize_to_tray: bool,
    /// The tray panel falls back to Windows' media session when DeetsMusic is idle.
    pub read_windows_media: bool,
    /// Shared secret the browser extension presents on every bridge call.
    pub bridge_token: String,
}

impl Default for SettingsData {
    fn default() -> Self {
        Self { minimize_to_tray: true, read_windows_media: true, bridge_token: String::new() }
    }
}

pub struct Settings {
    pub data: Mutex<SettingsData>,
    path: PathBuf,
}

/// 24 random bytes → 32-char base32-ish pairing code. Grouped for humans by the UI.
fn random_token() -> String {
    const ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
    let mut buf = [0u8; 24];
    getrandom::getrandom(&mut buf).expect("os rng");
    buf.iter().map(|b| ALPHABET[(*b as usize) % ALPHABET.len()] as char).collect()
}

impl Settings {
    pub fn load(dir: PathBuf) -> Self {
        let path = dir.join("settings.json");
        let mut data: SettingsData = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let mut dirty = false;
        if data.bridge_token.is_empty() {
            data.bridge_token = random_token();
            dirty = true;
        }
        let s = Self { data: Mutex::new(data), path };
        if dirty {
            s.save().ok();
        }
        s
    }

    pub fn save(&self) -> Result<(), String> {
        let json = serde_json::to_string_pretty(&*self.data.lock().unwrap()).map_err(|e| e.to_string())?;
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::write(&self.path, json).map_err(|e| format!("settings.json: {e}"))
    }

    pub fn get(&self) -> SettingsData {
        self.data.lock().unwrap().clone()
    }

    pub fn update(&self, f: impl FnOnce(&mut SettingsData)) -> Result<SettingsData, String> {
        let out = {
            let mut d = self.data.lock().unwrap();
            f(&mut d);
            d.clone()
        };
        self.save()?;
        Ok(out)
    }
}

// ── commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn settings_get(settings: tauri::State<'_, Settings>) -> SettingsData {
    settings.get()
}

#[tauri::command]
pub fn settings_set_minimize_to_tray(on: bool, settings: tauri::State<'_, Settings>) -> Result<SettingsData, String> {
    settings.update(|d| d.minimize_to_tray = on)
}

#[tauri::command]
pub fn settings_set_read_windows_media(
    on: bool,
    app: tauri::AppHandle,
    settings: tauri::State<'_, Settings>,
) -> Result<SettingsData, String> {
    let out = settings.update(|d| d.read_windows_media = on)?;
    crate::tray::sync_menu(&app);
    Ok(out)
}

/// Regenerate the pairing token (the old one stops working immediately).
#[tauri::command]
pub fn settings_rotate_bridge_token(settings: tauri::State<'_, Settings>) -> Result<SettingsData, String> {
    settings.update(|d| d.bridge_token = random_token())
}
