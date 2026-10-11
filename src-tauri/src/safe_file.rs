//! The files we cannot afford to lose half of: settings.json, the friend key, the Song of the Day
//! outlets, the Last.fm session, the Apple user token (2026-10-11).
//!
//! Two rules. A write goes to a file beside the real one, is flushed to the disk, then renamed
//! over it, so a crash or a power cut mid-write leaves the old file whole. A read keeps every
//! field it can read: a value this build does not know (a choice a newer build added, before a
//! Roll back) or a value of the wrong type resets THAT field to its default, never the whole
//! file. serde's `default` covers only a MISSING field; one unreadable value fails the struct.

use serde::{de::DeserializeOwned, Serialize};
use serde_json::{Map, Value};
use std::io::Write;
use std::path::{Path, PathBuf};

/// `path` with `suffix` added to its whole name: `settings.json` → `settings.json.bad`.
pub fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

/// Write beside, flush, then rename over. On Windows `std::fs::rename` replaces the old file
/// (MoveFileExW with REPLACE_EXISTING), so a reader sees the old file or the new one, never half.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = with_suffix(path, ".tmp");
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path)
}

/// What a forgiving read found.
pub struct Lenient<T> {
    pub value: T,
    /// The fields that held a value this build cannot read; each is back to its default.
    pub bad_fields: Vec<String>,
    /// The file is not a JSON object at all (cut off, empty, or another kind of file): every
    /// field is back to its default.
    pub unreadable: bool,
}

impl<T> Lenient<T> {
    pub fn clean(&self) -> bool {
        !self.unreadable && self.bad_fields.is_empty()
    }
}

/// Read `text` as `T`, field by field when the whole does not read. Fields this build does not
/// know are ignored, as serde ignores them. Each stored field is tried on top of the fields
/// already kept, so a field is dropped only when its own value fails.
pub fn parse_lenient<T: Default + Serialize + DeserializeOwned>(text: &str) -> Lenient<T> {
    let Ok(Value::Object(stored)) = serde_json::from_str::<Value>(text) else {
        return Lenient { value: T::default(), bad_fields: Vec::new(), unreadable: true };
    };
    if let Ok(value) = serde_json::from_value::<T>(Value::Object(stored.clone())) {
        return Lenient { value, bad_fields: Vec::new(), unreadable: false };
    }
    let mut kept = match serde_json::to_value(T::default()) {
        Ok(Value::Object(m)) => m,
        _ => Map::new(),
    };
    let mut bad_fields = Vec::new();
    for (k, v) in stored {
        let mut trial = kept.clone();
        trial.insert(k.clone(), v.clone());
        if serde_json::from_value::<T>(Value::Object(trial)).is_ok() {
            kept.insert(k, v);
        } else {
            bad_fields.push(k);
        }
    }
    let value = serde_json::from_value(Value::Object(kept)).unwrap_or_default();
    Lenient { value, bad_fields, unreadable: false }
}

/// Keep the file that did not read whole beside it, as `<name>.bad`, so a value this build
/// dropped can still be found by hand. The newest copy replaces an older one.
pub fn keep_bad_copy(path: &Path) -> Option<PathBuf> {
    let bad = with_suffix(path, ".bad");
    std::fs::copy(path, &bad).ok().map(|_| bad)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "lowercase")]
    enum Mode {
        Ask,
        Now,
    }

    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase", default)]
    struct Prefs {
        close_to_tray: bool,
        mode: Mode,
        token: String,
        volumes: std::collections::HashMap<String, f64>,
    }
    impl Default for Prefs {
        fn default() -> Self {
            Self { close_to_tray: true, mode: Mode::Ask, token: String::new(), volumes: Default::default() }
        }
    }

    #[test]
    fn a_whole_file_reads_whole() {
        let r: Lenient<Prefs> = parse_lenient(r#"{"closeToTray":false,"mode":"now","token":"abc"}"#);
        assert!(r.clean());
        assert_eq!(r.value.mode, Mode::Now);
        assert!(!r.value.close_to_tray);
    }

    #[test]
    fn an_unknown_choice_resets_only_its_field_2026_10_11() {
        // A newer build's choice, read after a Roll back.
        let r: Lenient<Prefs> = parse_lenient(r#"{"closeToTray":false,"mode":"weekly","token":"abc"}"#);
        assert_eq!(r.bad_fields, vec!["mode".to_string()]);
        assert!(!r.unreadable);
        assert_eq!(r.value.mode, Mode::Ask);
        assert!(!r.value.close_to_tray, "the other fields are kept");
        assert_eq!(r.value.token, "abc");
    }

    #[test]
    fn a_wrong_type_resets_only_its_field() {
        let r: Lenient<Prefs> = parse_lenient(r#"{"closeToTray":"yes","volumes":{"Kitchen":"loud","Den":40},"token":"abc"}"#);
        let mut bad = r.bad_fields.clone();
        bad.sort();
        assert_eq!(bad, vec!["closeToTray".to_string(), "volumes".to_string()]);
        assert!(r.value.close_to_tray, "back to its default");
        assert_eq!(r.value.token, "abc");
    }

    #[test]
    fn a_field_this_build_does_not_know_is_ignored() {
        let r: Lenient<Prefs> = parse_lenient(r#"{"closeToTray":false,"newerThing":[1,2]}"#);
        assert!(r.clean());
        assert!(!r.value.close_to_tray);
    }

    #[test]
    fn a_cut_off_or_empty_file_is_unreadable() {
        for text in [r#"{"closeToTray":false,"tok"#, "", "[1,2]", "null"] {
            let r: Lenient<Prefs> = parse_lenient(text);
            assert!(r.unreadable, "{text:?}");
            assert_eq!(r.value, Prefs::default());
        }
    }

    #[test]
    fn write_atomic_replaces_the_file_and_leaves_no_temp() {
        let dir = std::env::temp_dir().join(format!("deets-safe-file-{}", std::process::id()));
        let path = dir.join("settings.json");
        write_atomic(&path, b"old").unwrap();
        write_atomic(&path, b"new").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new");
        assert!(!with_suffix(&path, ".tmp").exists());
        assert_eq!(keep_bad_copy(&path), Some(with_suffix(&path, ".bad")));
        assert_eq!(std::fs::read(with_suffix(&path, ".bad")).unwrap(), b"new");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
