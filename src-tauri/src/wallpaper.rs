//! The Glass canvas picture the user chose (COVER-WALLPAPER.md §8).
//!
//! One picture: `wallpaper.jpg` in the app data folder, replaced on each choice. The front end
//! has already resized it (at most 2560 px on its long side) and read its three aurora colors,
//! which are saved beside it in `wallpaper.json`, so a restart reads neither again. The page
//! shows it through `http://wallpaper.localhost/<stamp>`; the stamp (the settings key
//! `glassPicture`) changes the link on each choice, so no cache ever shows the old one.
//!
//! This is the user's own file, so the rule that no picture made from Apple's artwork is stored
//! does not apply to it. The covers' wallpaper is never saved (wallpaper.ts, in memory only).

use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

const PICTURE: &str = "wallpaper.jpg";
const COLORS: &str = "wallpaper.json";
/// A 2560 px JPEG is 1–3 MB; the data URL is a third larger.
const MAX_DATA_URL: usize = 12_000_000;

fn dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// Save the chosen picture (a JPEG data URL) and its colors. Returns the new stamp (ms).
/// Off the UI thread: a file write (CLAUDE.md › Conventions).
#[tauri::command]
pub async fn wallpaper_set(app: AppHandle, data: String, colors: Option<Value>) -> Result<i64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use base64::Engine;
        if data.len() > MAX_DATA_URL {
            return Err("wallpaper_set: the picture is too large".into());
        }
        let payload = data
            .strip_prefix("data:image/jpeg;base64,")
            .ok_or("wallpaper_set: expected a JPEG data URL")?;
        let bytes = base64::engine::general_purpose::STANDARD.decode(payload).map_err(|e| e.to_string())?;
        let dir = dir(&app)?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        // Write then rename, so a crash mid-write never leaves half a picture.
        let tmp = dir.join(format!("{PICTURE}.tmp"));
        std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, dir.join(PICTURE)).map_err(|e| e.to_string())?;
        let colors_path = dir.join(COLORS);
        match colors {
            Some(c) => std::fs::write(&colors_path, c.to_string()).map_err(|e| e.to_string())?,
            None => {
                let _ = std::fs::remove_file(&colors_path);
            }
        }
        crate::log::info(&format!("wallpaper: picture saved ({} KB)", bytes.len() / 1024));
        Ok(std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The saved picture's aurora colors (`{ bg, c1, c2 }`), or null when none were saved.
#[tauri::command]
pub async fn wallpaper_colors(app: AppHandle) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = dir(&app)?.join(COLORS);
        Ok(std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// `http://wallpaper.localhost/<stamp>` → the saved picture. The path is only a cache key.
pub fn response<R: Runtime>(app: &AppHandle<R>) -> tauri::http::Response<Vec<u8>> {
    let not_found = || tauri::http::Response::builder().status(404).body(Vec::new()).unwrap();
    let Ok(bytes) = dir(app).and_then(|d| std::fs::read(d.join(PICTURE)).map_err(|e| e.to_string())) else {
        return not_found();
    };
    tauri::http::Response::builder()
        .header("Content-Type", "image/jpeg")
        .header("Cache-Control", "max-age=31536000, immutable")
        .header("Access-Control-Allow-Origin", "*")
        .body(bytes)
        .unwrap_or_else(|_| not_found())
}
