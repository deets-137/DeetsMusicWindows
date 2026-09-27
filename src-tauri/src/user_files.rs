//! The user's own files a rule may use (RULEZ.md §5): pictures for the Glass canvas and short
//! sound clips. One store, both kinds.
//!
//! A chosen file is COPIED into the app data folder as `files/<id>.<ext>`, with a record in
//! `files.json` (`id`, `kind`, `name`, `ext`, `bytes`, `added`). The original is never read
//! again: a rule names the id, never a path, so a moved or deleted original cannot break it,
//! and no fs scope has to reach the user's folders. A picture's aurora colors sit beside it in
//! `files/<id>.json`, as the old `wallpaper.json` did. The page reads a file through
//! `http://files.localhost/<id>`.
//!
//! These are the user's own files, so the rule that no picture made from Apple's artwork is
//! stored does not apply. The functions take the folder, so the tests run on a temp dir.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

const INDEX: &str = "files.json";
const FOLDER: &str = "files";
/// The old single picture (wallpaper.rs), taken in as the first record at first load.
const OLD_PICTURE: &str = "wallpaper.jpg";
const OLD_COLORS: &str = "wallpaper.json";
/// A 2560 px JPEG is 1–3 MB; base64 is a third larger.
const MAX_PICTURE_B64: usize = 12_000_000;
/// A clip: at most 2 MB on disk (its length, 5 s, is checked by the page after decoding).
const MAX_SOUND_BYTES: usize = 2_000_000;
const MAX_NAME: usize = 60;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Record {
    pub id: String,
    /// `picture` | `sound`
    pub kind: String,
    pub name: String,
    pub ext: String,
    pub bytes: u64,
    /// ms since the epoch
    pub added: i64,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// `f` + the time in base 36 + 4 random hex chars: readable in a log line, unique enough.
fn new_id(now: i64) -> String {
    let mut buf = [0u8; 2];
    let _ = getrandom::getrandom(&mut buf);
    format!("f{}{:02x}{:02x}", base36(now.max(0) as u64), buf[0], buf[1])
}

fn base36(mut n: u64) -> String {
    const D: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while n > 0 {
        out.push(D[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

fn clean_name(name: &str) -> String {
    let n: String = name.trim().chars().take(MAX_NAME).collect();
    if n.is_empty() {
        "Untitled".into()
    } else {
        n
    }
}

fn clean_ext(ext: &str) -> String {
    ext.trim().trim_start_matches('.').to_ascii_lowercase().chars().filter(|c| c.is_ascii_alphanumeric()).take(5).collect()
}

fn read_index(dir: &Path) -> Vec<Record> {
    std::fs::read_to_string(dir.join(INDEX))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Write then rename, so a crash mid-write never leaves half an index.
fn write_index(dir: &Path, records: &[Record]) -> Result<(), String> {
    std::fs::create_dir_all(dir.join(FOLDER)).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("{INDEX}.tmp"));
    std::fs::write(&tmp, serde_json::to_string(records).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(INDEX)).map_err(|e| e.to_string())
}

fn file_path(dir: &Path, r: &Record) -> PathBuf {
    dir.join(FOLDER).join(format!("{}.{}", r.id, r.ext))
}

fn colors_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(FOLDER).join(format!("{id}.json"))
}

/// Every record, oldest first.
pub fn list(dir: &Path) -> Vec<Record> {
    read_index(dir)
}

/// The old single wallpaper becomes the first picture record ("My picture"), once. Returns
/// the record it made, so the page can point `glassPictureId` at it.
pub fn migrate_wallpaper(dir: &Path) -> Result<Option<Record>, String> {
    let old = dir.join(OLD_PICTURE);
    if !old.exists() {
        return Ok(None);
    }
    let mut records = read_index(dir);
    let now = now_ms();
    let r = Record {
        id: new_id(now),
        kind: "picture".into(),
        name: "My picture".into(),
        ext: "jpg".into(),
        bytes: std::fs::metadata(&old).map(|m| m.len()).unwrap_or(0),
        added: now,
    };
    std::fs::create_dir_all(dir.join(FOLDER)).map_err(|e| e.to_string())?;
    std::fs::rename(&old, file_path(dir, &r)).map_err(|e| e.to_string())?;
    let old_colors = dir.join(OLD_COLORS);
    if old_colors.exists() {
        let _ = std::fs::rename(&old_colors, colors_path(dir, &r.id));
    }
    records.push(r.clone());
    write_index(dir, &records)?;
    crate::log::info("user_files: the wallpaper became the first picture");
    Ok(Some(r))
}

/// Save a new file from its bytes. `colors` is a picture's aurora palette (`{ bg, c1, c2 }`).
pub fn add(dir: &Path, kind: &str, name: &str, ext: &str, bytes: &[u8], colors: Option<Value>) -> Result<Record, String> {
    if kind != "picture" && kind != "sound" {
        return Err(format!("user_files: unknown kind {kind:?}"));
    }
    if kind == "sound" && bytes.len() > MAX_SOUND_BYTES {
        return Err("user_files: the sound is too large (2 MB at most)".into());
    }
    if bytes.is_empty() {
        return Err("user_files: the file is empty".into());
    }
    let ext = clean_ext(ext);
    if ext.is_empty() {
        return Err("user_files: the file needs an extension".into());
    }
    let mut records = read_index(dir);
    let now = now_ms();
    let mut id = new_id(now);
    while records.iter().any(|r| r.id == id) {
        id = new_id(now + 1);
    }
    let r = Record { id, kind: kind.into(), name: clean_name(name), ext, bytes: bytes.len() as u64, added: now };
    std::fs::create_dir_all(dir.join(FOLDER)).map_err(|e| e.to_string())?;
    let path = file_path(dir, &r);
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    if let Some(c) = colors {
        std::fs::write(colors_path(dir, &r.id), c.to_string()).map_err(|e| e.to_string())?;
    }
    records.push(r.clone());
    write_index(dir, &records)?;
    crate::log::info(&format!("user_files: {} {} saved ({} KB)", r.kind, r.id, r.bytes / 1024));
    Ok(r)
}

pub fn rename(dir: &Path, id: &str, name: &str) -> Result<Vec<Record>, String> {
    let mut records = read_index(dir);
    let r = records.iter_mut().find(|r| r.id == id).ok_or_else(|| format!("user_files: no file {id:?}"))?;
    r.name = clean_name(name);
    write_index(dir, &records)?;
    Ok(records)
}

pub fn delete(dir: &Path, id: &str) -> Result<Vec<Record>, String> {
    let mut records = read_index(dir);
    let i = records.iter().position(|r| r.id == id).ok_or_else(|| format!("user_files: no file {id:?}"))?;
    let r = records.remove(i);
    let _ = std::fs::remove_file(file_path(dir, &r));
    let _ = std::fs::remove_file(colors_path(dir, &r.id));
    write_index(dir, &records)?;
    crate::log::info(&format!("user_files: {} {} deleted", r.kind, r.id));
    Ok(records)
}

pub fn colors(dir: &Path, id: &str) -> Option<Value> {
    std::fs::read_to_string(colors_path(dir, id)).ok().and_then(|s| serde_json::from_str(&s).ok())
}

fn mime(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "m4a" | "mp4" => "audio/mp4",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        _ => "application/octet-stream",
    }
}

// ── the commands (off the UI thread: file I/O) ──────────────────────────────

fn dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct Listing {
    pub files: Vec<Record>,
    /// The record the old wallpaper became on this call, if it did.
    pub migrated: Option<Record>,
}

/// Every file; the first call after the update takes the old wallpaper in.
#[tauri::command]
pub async fn user_files_list(app: AppHandle) -> Result<Listing, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let d = dir(&app)?;
        let migrated = migrate_wallpaper(&d)?;
        Ok(Listing { files: list(&d), migrated })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Save a file. `data` is base64 (no data-URL prefix); a picture arrives resized as JPEG.
#[tauri::command]
pub async fn user_files_add(app: AppHandle, kind: String, name: String, ext: String, data: String, colors: Option<Value>) -> Result<Record, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use base64::Engine;
        if kind == "picture" && data.len() > MAX_PICTURE_B64 {
            return Err("user_files: the picture is too large".into());
        }
        if kind == "sound" && data.len() > MAX_SOUND_BYTES * 4 / 3 + 4 {
            return Err("user_files: the sound is too large (2 MB at most)".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD.decode(data.as_bytes()).map_err(|e| e.to_string())?;
        add(&dir(&app)?, &kind, &name, &ext, &bytes, colors)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn user_files_rename(app: AppHandle, id: String, name: String) -> Result<Vec<Record>, String> {
    tauri::async_runtime::spawn_blocking(move || rename(&dir(&app)?, &id, &name)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn user_files_delete(app: AppHandle, id: String) -> Result<Vec<Record>, String> {
    tauri::async_runtime::spawn_blocking(move || delete(&dir(&app)?, &id)).await.map_err(|e| e.to_string())?
}

/// A picture's saved aurora colors, or null.
#[tauri::command]
pub async fn user_files_colors(app: AppHandle, id: String) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(colors(&dir(&app)?, &id))).await.map_err(|e| e.to_string())?
}

/// `http://files.localhost/<id>` → the file. The id is the whole cache key: a file never
/// changes under its id (a new choice is a new id), so the response is immutable.
pub fn response<R: Runtime>(app: &AppHandle<R>, path: &str) -> tauri::http::Response<Vec<u8>> {
    let not_found = || tauri::http::Response::builder().status(404).body(Vec::new()).unwrap();
    let id = path.trim_start_matches('/').split(['/', '?', '.']).next().unwrap_or("").to_string();
    let Ok(d) = dir(app) else { return not_found() };
    let Some(r) = read_index(&d).into_iter().find(|r| r.id == id) else { return not_found() };
    let Ok(bytes) = std::fs::read(file_path(&d, &r)) else { return not_found() };
    tauri::http::Response::builder()
        .header("Content-Type", mime(&r.ext))
        .header("Cache-Control", "max-age=31536000, immutable")
        .header("Access-Control-Allow-Origin", "*")
        .body(bytes)
        .unwrap_or_else(|_| not_found())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        // Tests run in parallel threads: the id keeps two of them out of one folder.
        let d = std::env::temp_dir().join(format!("deets-user-files-{}-{}", std::process::id(), new_id(now_ms())));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn add_list_rename_delete_round_trip() {
        let d = temp();
        let r = add(&d, "sound", "  ping.mp3 ", "MP3", b"abc", None).unwrap();
        assert_eq!(r.kind, "sound");
        assert_eq!(r.name, "ping.mp3");
        assert_eq!(r.ext, "mp3");
        assert!(file_path(&d, &r).exists());
        assert_eq!(list(&d), vec![r.clone()]);
        let after = rename(&d, &r.id, "Ping").unwrap();
        assert_eq!(after[0].name, "Ping");
        let after = delete(&d, &r.id).unwrap();
        assert!(after.is_empty());
        assert!(!file_path(&d, &r).exists());
        assert!(delete(&d, &r.id).is_err());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_picture_keeps_its_colors_and_a_bad_kind_or_big_sound_is_refused() {
        let d = temp();
        let c = serde_json::json!({ "bg": "#000", "c1": "#111", "c2": "#222" });
        let r = add(&d, "picture", "Blue", "jpg", b"jpegbytes", Some(c.clone())).unwrap();
        assert_eq!(colors(&d, &r.id), Some(c));
        assert!(add(&d, "video", "x", "mp4", b"a", None).is_err());
        assert!(add(&d, "sound", "big", "wav", &vec![0u8; MAX_SOUND_BYTES + 1], None).is_err());
        assert!(add(&d, "sound", "none", "", b"a", None).is_err());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_old_wallpaper_becomes_the_first_picture_once() {
        let d = temp();
        std::fs::write(d.join(OLD_PICTURE), b"oldjpeg").unwrap();
        std::fs::write(d.join(OLD_COLORS), r##"{"bg":"#123"}"##).unwrap();
        let r = migrate_wallpaper(&d).unwrap().expect("a record");
        assert_eq!(r.name, "My picture");
        assert_eq!(r.ext, "jpg");
        assert_eq!(std::fs::read(file_path(&d, &r)).unwrap(), b"oldjpeg");
        assert_eq!(colors(&d, &r.id), Some(serde_json::json!({ "bg": "#123" })));
        assert!(!d.join(OLD_PICTURE).exists());
        assert_eq!(migrate_wallpaper(&d).unwrap(), None);
        assert_eq!(list(&d).len(), 1);
        let _ = std::fs::remove_dir_all(&d);
    }
}
