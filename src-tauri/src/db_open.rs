//! When the library database will not open (DB-HEALTH.md §7, built 2026-09-29).
//!
//! `lib.rs` setup opens `deetsmusic.db`, creates its tables and runs every migration. Each
//! step panics on failure (`expect`), and a panic in setup meant the window never appeared:
//! the app simply did not start, with nothing on screen. Setup now runs those steps inside
//! `catch_unwind`, and a failure lands here: one native Windows message box that names the
//! file and its backups in plain words, a log line, and a clean exit.
//!
//! No new dependency: `MessageBoxW` is a feature of the `windows` crate the app already has.

use std::path::{Path, PathBuf};

/// The text of a caught panic (an `expect` message with its error).
pub fn panic_text(p: &(dyn std::any::Any + Send)) -> String {
    p.downcast_ref::<&str>()
        .map(|s| s.to_string())
        .or_else(|| p.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown error".into())
}

/// The backups of the library file in the data folder, newest first. Today the only kind is
/// the copy the v2 migration made (`deetsmusic.v1.<stamp>.bak.db`); any `*.bak.db` counts.
pub fn backups(dir: &Path) -> Vec<PathBuf> {
    let mut found: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_lowercase();
            if !(name.starts_with("deetsmusic") && name.ends_with(".bak.db")) {
                return None;
            }
            let at = e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
            Some((at, e.path()))
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, p)| p).collect()
}

/// The message box's words. Plain: what failed, where the file is, where a backup is, what
/// to try. `why` is the raw error, last, for a bug report.
pub fn message(db_path: &Path, backups: &[PathBuf], why: &str) -> String {
    let backup = match backups.first() {
        Some(b) => format!("A backup of an older copy is here:\n{}", b.display()),
        None => "There is no backup of this file.".to_string(),
    };
    format!(
        "DeetsMusic could not open its library file, so it cannot start.\n\n\
         The file is here:\n{}\n\n\
         {backup}\n\n\
         Check that the disk has free space, then start DeetsMusic again.\n\n\
         If it still does not start, close DeetsMusic and move the file to another folder. \
         DeetsMusic then makes a new, empty file and gets your library from Apple Music again. \
         Your playlists, Diary and play history stay in the file you moved.\n\n\
         Error: {why}",
        db_path.display()
    )
}

/// Say it, log it, and exit. Never returns.
pub fn fail(dir: &Path, db_path: &Path, why: &str) -> ! {
    let found = backups(dir);
    // The file name only in the log: a full path carries the Windows user name (LOGGING.md).
    crate::log::error(&format!(
        "db: could not open the library file, exiting: {why} (backups: {})",
        found.len()
    ));
    let text = message(db_path, &found, why);
    show(&text);
    std::process::exit(1);
}

#[cfg(windows)]
fn show(text: &str) {
    use windows::core::PCWSTR;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK, MB_SETFOREGROUND};
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let body = wide(text);
    let title = wide("DeetsMusic can't start");
    unsafe {
        MessageBoxW(None, PCWSTR(body.as_ptr()), PCWSTR(title.as_ptr()), MB_OK | MB_ICONERROR | MB_SETFOREGROUND);
    }
}

#[cfg(not(windows))]
fn show(text: &str) {
    eprintln!("{text}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_names_the_file_and_the_backup_2026_09_29() {
        let db = Path::new(r"C:\data\deetsmusic.db");
        let none = message(db, &[], "disk full");
        assert!(none.contains(r"C:\data\deetsmusic.db"));
        assert!(none.contains("There is no backup"));
        assert!(none.ends_with("Error: disk full"));
        let one = message(db, &[PathBuf::from(r"C:\data\deetsmusic.v1.5.bak.db")], "x");
        assert!(one.contains(r"deetsmusic.v1.5.bak.db"));
        assert!(!one.contains("There is no backup"));
    }

    #[test]
    fn panic_text_reads_both_payloads() {
        let a: Box<dyn std::any::Any + Send> = Box::new("static");
        let b: Box<dyn std::any::Any + Send> = Box::new(String::from("owned"));
        assert_eq!(panic_text(a.as_ref()), "static");
        assert_eq!(panic_text(b.as_ref()), "owned");
    }
}
