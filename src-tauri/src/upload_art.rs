//! The covers of uploaded songs (UPLOADS.md §3).
//!
//! A song the user uploaded through Apple's app has its cover on `*.blobstore.apple.com`, at a
//! signed link that dies after 24 hours. We stored that link, and the full sync that refreshes
//! it runs once a week, so most of these covers were blank.
//!
//! So a blobstore link never reaches the store or the page. `localize` turns it into
//! `http://cover.localhost/upload/<key>` while the signed link is still fresh, and a background
//! job saves the picture in `upload-covers/`. The key comes from the link's path, so a new
//! signature on the same picture is the same key and costs no second download.
//!
//! The picture is the user's own, from their own file, so the rule that no picture made from
//! Apple's artwork is stored does not apply to it (the same reason as wallpaper.rs).

use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

const LINK: &str = "http://cover.localhost/upload/";
/// A cover is a few hundred KB. This only stops a wrong reply from filling the disk.
const MAX_BYTES: usize = 20_000_000;

static DIR: OnceLock<PathBuf> = OnceLock::new();
/// Signed links seen and not saved yet, by key. In memory: a signed link is worth nothing later.
static PENDING: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
static DRAINING: AtomicBool = AtomicBool::new(false);

fn with_pending<T>(f: impl FnOnce(&mut HashMap<String, String>) -> T) -> T {
    let mut guard = PENDING.lock().unwrap_or_else(|p| p.into_inner());
    f(guard.get_or_insert_with(HashMap::new))
}

pub fn setup(dir: PathBuf) {
    let _ = DIR.set(dir.join("upload-covers"));
}

/// The key of a blobstore picture, or `None` for any other link.
fn key_of(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    if !parsed.host_str()?.ends_with(".blobstore.apple.com") {
        return None;
    }
    let digest = Sha256::digest(parsed.path().as_bytes());
    Some(digest[..16].iter().map(|b| format!("{b:02x}")).collect())
}

/// The link to store and show. Every other link comes back as it went in.
pub fn localize(url: String) -> String {
    let Some(key) = key_of(&url) else { return url };
    let link = format!("{LINK}{key}");
    if DIR.get().is_some() {
        with_pending(|p| p.insert(key, url));
        drain();
    }
    link
}

/// One job at a time, one picture at a time: a first pass over a large library of uploads
/// must not open hundreds of connections beside the sync.
fn drain() {
    if DRAINING.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async {
        loop {
            match with_pending(|p| p.keys().next().cloned()) {
                Some(key) => {
                    ensure(&key).await;
                }
                None => {
                    DRAINING.store(false, Ordering::SeqCst);
                    // A link that arrived between the look and the store has no job yet.
                    if with_pending(|p| p.is_empty()) || DRAINING.swap(true, Ordering::SeqCst) {
                        break;
                    }
                }
            }
        }
    });
}

fn file_of(key: &str) -> Option<PathBuf> {
    let safe = key.len() == 32 && key.bytes().all(|b| b.is_ascii_hexdigit());
    safe.then(|| DIR.get().map(|d| d.join(key))).flatten()
}

/// Is the picture on disk? Saves it first when a fresh link is waiting.
async fn ensure(key: &str) -> bool {
    let Some(path) = file_of(key) else { return false };
    let url = with_pending(|p| p.remove(key));
    if path.exists() {
        return true;
    }
    let Some(url) = url else { return false };
    let bytes = match download(&url).await {
        Ok(bytes) => bytes,
        Err(e) => {
            crate::log::warn(&format!("upload cover {key}: {e}"));
            return false;
        }
    };
    let wrote = tauri::async_runtime::spawn_blocking(move || crate::safe_file::write_atomic(&path, &bytes)).await;
    match wrote {
        Ok(Ok(())) => true,
        Ok(Err(e)) => {
            crate::log::warn(&format!("upload cover {key}: {e}"));
            false
        }
        Err(e) => {
            crate::log::warn(&format!("upload cover {key}: {e}"));
            false
        }
    }
}

async fn download(url: &str) -> Result<Vec<u8>, String> {
    let reply = crate::apple::http_client()
        .get(url)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| e.without_url().to_string())?;
    let status = reply.status();
    if !status.is_success() {
        return Err(format!("status {status}"));
    }
    let bytes = reply.bytes().await.map_err(|e| e.without_url().to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err(format!("{} bytes is too large", bytes.len()));
    }
    if mime_of(&bytes).is_none() {
        return Err("the reply is not a picture".into());
    }
    Ok(bytes.to_vec())
}

/// The picture's type, from its first bytes. Apple's reply names none we can trust once the
/// file is on disk, and anything else must never be served as a cover.
fn mime_of(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0xFF, 0xD8, 0xFF, ..] => Some("image/jpeg"),
        [0x89, b'P', b'N', b'G', ..] => Some("image/png"),
        [b'G', b'I', b'F', b'8', ..] => Some("image/gif"),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => Some("image/webp"),
        _ => None,
    }
}

fn read(key: &str) -> Option<(&'static str, Vec<u8>)> {
    let bytes = std::fs::read(file_of(key)?).ok()?;
    Some((mime_of(&bytes)?, bytes))
}

/// A stored cover by its link, for code that fetches a cover itself (AirPlay). The webview's
/// `cover.localhost` is not a host the network can reach.
pub fn link_bytes(link: &str) -> Option<(&'static str, Vec<u8>)> {
    read(link.strip_prefix(LINK)?)
}

/// Answer `cover.localhost/upload/<key>`. Runs on its own thread (lib.rs), so it may wait for
/// a picture the job has not reached yet.
pub fn response(key: &str) -> tauri::http::Response<Vec<u8>> {
    let not_found = || tauri::http::Response::builder().status(404).body(Vec::new()).unwrap();
    let Some(path) = file_of(key) else { return not_found() };
    if !path.exists() {
        tauri::async_runtime::block_on(ensure(key));
    }
    let Some((mime, bytes)) = read(key) else { return not_found() };
    tauri::http::Response::builder()
        .header("Content-Type", mime)
        .header("Cache-Control", "max-age=31536000, immutable")
        .header("Access-Control-Allow-Origin", "*")
        .body(bytes)
        .unwrap_or_else(|_| not_found())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SIGNED: &str = "https://store-037.blobstore.apple.com/sq/af/6f/image?X-Amz-Date=20261104T142247Z&X-Amz-Signature=aaa";
    const SIGNED_LATER: &str = "https://store-037.blobstore.apple.com/sq/af/6f/image?X-Amz-Date=20261111T142247Z&X-Amz-Signature=bbb";

    #[test]
    fn a_new_signature_on_one_picture_is_one_link_2026_11_06() {
        let link = localize(SIGNED.to_string());
        assert!(link.starts_with(LINK));
        assert!(!link.contains("Signature"));
        assert_eq!(link, localize(SIGNED_LATER.to_string()));
    }

    #[test]
    fn every_other_link_comes_back_as_it_went_in_2026_11_06() {
        for url in [
            "https://is1-ssl.mzstatic.com/image/thumb/a/{w}x{h}bb.jpg",
            "https://blobstore.apple.com.example.com/image",
            "not a link",
        ] {
            assert_eq!(localize(url.to_string()), url);
        }
    }

    #[test]
    fn only_a_picture_is_kept_2026_11_06() {
        assert_eq!(mime_of(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(mime_of(b"\x89PNG\r\n"), Some("image/png"));
        assert_eq!(mime_of(b"RIFF1234WEBPVP8 "), Some("image/webp"));
        assert_eq!(mime_of(b"<?xml version=\"1.0\"?><Error>"), None);
        assert_eq!(mime_of(b""), None);
    }

    #[test]
    fn a_key_is_never_a_path_2026_11_06() {
        assert_eq!(key_of("https://x.blobstore.apple.com/a").map(|k| k.len()), Some(32));
        assert!(!"../../settings.json".bytes().all(|b| b.is_ascii_hexdigit()));
    }
}
