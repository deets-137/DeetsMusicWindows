//! Outlets (docs/DeetsOTD.md §8.2, §8.15) — the places a pick is sent to, and the one file
//! that holds their secrets.
//!
//! Build 1 has one outlet, the Discord webhook. Every other part of the feature (the outbox,
//! the modes, the toasts, the settings rows) talks only to this file, so build 2's Bluesky
//! and Mastodon are new arms here and nothing else.
//!
//! **Secrets.** The webhook URL is a credential: anyone holding it can post in that channel.
//! It lives in `<app_data>/sotd-outlets.json`, encrypted with Windows DPAPI under the
//! current user, so a copied file is useless on another account or PC. It never reaches the
//! renderer: `status()` returns names and states only, and every secret goes through
//! `log::register_secret`, so the log file and a bug report mask it.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::discord;

/// The outlets this build knows. A name that is not one of these is refused before anything
/// is stored or sent.
pub const KNOWN: [&str; 1] = ["discord"];

/// One outlet's stored state. `secret` is the credential; everything else is what the
/// Settings rows show.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Conn {
    /// The webhook URL (Discord). Never leaves Rust.
    pub secret: String,
    /// What the status line names: "#channel in Server" for Discord.
    pub where_to: String,
    /// The webhook's own name — the placeholder for "Post as".
    pub default_name: String,
    /// The user's toggle for this outlet. Connecting turns it on; it is off until then.
    pub on: bool,
    /// The last failure, for the status line. Cleared by a good post or a new connect.
    pub error: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Store {
    discord: Option<Conn>,
}

static STORE: Mutex<Option<Store>> = Mutex::new(None);
static PATH: OnceLock<PathBuf> = OnceLock::new();

fn path() -> Option<&'static PathBuf> {
    PATH.get()
}

// ── DPAPI ────────────────────────────────────────────────────────────────────

/// Encrypt for the current Windows user (`CryptProtectData`). The file is plain JSON inside,
/// so a decrypt that fails is a file from another account — never a crash.
fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};
    unsafe {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB::default();
        CryptProtectData(&input, None, None, None, None, 0, &mut out).map_err(|e| e.to_string())?;
        let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(out.pbData as *mut _)));
        Ok(v)
    }
}

fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};
    unsafe {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB::default();
        CryptUnprotectData(&input, None, None, None, None, 0, &mut out).map_err(|e| e.to_string())?;
        let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(out.pbData as *mut _)));
        Ok(v)
    }
}

// ── the file ─────────────────────────────────────────────────────────────────

fn load() -> Store {
    let Some(p) = path() else { return Store::default() };
    let Ok(raw) = std::fs::read(p) else { return Store::default() };
    let plain = match unprotect(&raw) {
        Ok(v) => v,
        Err(e) => {
            // Another account's file, or a copy from another PC. Not connected, one warn,
            // no retry loop, and the file is left alone so nothing is lost by accident.
            crate::log::warn(&format!("sotd: the outlet file could not be read on this account ({e})"));
            return Store::default();
        }
    };
    serde_json::from_slice(&plain).unwrap_or_default()
}

fn save(store: &Store) {
    let Some(p) = path() else { return };
    let Ok(json) = serde_json::to_vec(store) else { return };
    match protect(&json) {
        Ok(blob) => {
            if let Some(parent) = p.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Err(e) = std::fs::write(p, blob) {
                crate::log::warn(&format!("sotd: could not save the outlets ({e})"));
            }
        }
        Err(e) => crate::log::warn(&format!("sotd: could not encrypt the outlets ({e})")),
    }
}

fn with_store<T>(f: impl FnOnce(&mut Store) -> T) -> T {
    let mut guard = STORE.lock().unwrap_or_else(|p| p.into_inner());
    if guard.is_none() {
        *guard = Some(load());
    }
    f(guard.as_mut().expect("store loaded"))
}

fn mask(c: &Conn) {
    if !c.secret.is_empty() {
        crate::log::register_secret(&c.secret);
    }
}

pub fn setup(_app: &AppHandle, dir: PathBuf) {
    let _ = PATH.set(dir.join("sotd-outlets.json"));
    with_store(|s| {
        if let Some(c) = &s.discord {
            mask(c);
            crate::log::info("sotd: Discord webhook loaded");
        }
    });
}

/// One outlet's stored connection, or `None` when it is not set up.
pub fn conn(outlet: &str) -> Option<Conn> {
    with_store(|s| match outlet {
        "discord" => s.discord.clone(),
        _ => None,
    })
}

fn put(outlet: &str, c: Option<Conn>) {
    with_store(|s| {
        match outlet {
            "discord" => s.discord = c,
            _ => return,
        }
        save(s);
    });
}

/// The outlets a pick should go to: set up AND switched on.
pub fn live() -> Vec<String> {
    KNOWN
        .iter()
        .filter(|o| conn(o).map(|c| c.on).unwrap_or(false))
        .map(|o| (*o).to_string())
        .collect()
}

// ── what the Settings card sees ──────────────────────────────────────────────

/// Names and states only — never a secret (§8.15, "Secrets in motion").
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OutletStatus {
    pub outlet: String,
    pub connected: bool,
    pub on: bool,
    /// "#song-of-the-day in Friends" — what the status line names.
    pub where_to: String,
    /// The webhook's own name, the placeholder for "Post as".
    pub default_name: String,
    pub error: Option<String>,
}

#[tauri::command]
pub fn outlet_status() -> Vec<OutletStatus> {
    KNOWN
        .iter()
        .map(|o| {
            let c = conn(o);
            OutletStatus {
                outlet: (*o).to_string(),
                connected: c.is_some(),
                on: c.as_ref().map(|c| c.on).unwrap_or(false),
                where_to: c.as_ref().map(|c| c.where_to.clone()).unwrap_or_default(),
                default_name: c.as_ref().map(|c| c.default_name.clone()).unwrap_or_default(),
                error: c.and_then(|c| c.error),
            }
        })
        .collect()
}

/// Set an outlet up from what the user pasted. It CHECKS and stores; it posts nothing.
#[tauri::command]
pub async fn outlet_connect(outlet: String, input: String, app: AppHandle) -> Result<OutletStatus, String> {
    let c = match outlet.as_str() {
        "discord" => discord::check(&input).await?,
        _ => return Err("This is not an outlet this build knows.".into()),
    };
    mask(&c);
    put(&outlet, Some(c));
    crate::log::info(&format!("sotd:webhook:check ok outlet={outlet}"));
    super::changed(&app);
    Ok(outlet_status().into_iter().find(|s| s.outlet == outlet).ok_or("no status")?)
}

/// Forget an outlet. Its picks stay; only the connection goes.
#[tauri::command]
pub fn outlet_disconnect(outlet: String, app: AppHandle) -> Result<(), String> {
    put(&outlet, None);
    crate::log::info(&format!("sotd: {outlet} removed"));
    super::changed(&app);
    Ok(())
}

/// The per-outlet toggle. Off keeps the connection: it pauses what the outlet receives.
#[tauri::command]
pub fn outlet_set_on(outlet: String, on: bool, app: AppHandle) -> Result<(), String> {
    let Some(mut c) = conn(&outlet) else { return Err("not set up".into()) };
    c.on = on;
    put(&outlet, Some(c));
    super::changed(&app);
    Ok(())
}

pub fn note_error(outlet: &str, err: Option<String>) {
    if let Some(mut c) = conn(outlet) {
        c.error = err;
        put(outlet, Some(c));
    }
}

// ── sending ──────────────────────────────────────────────────────────────────

/// Send one message through an outlet. Returns the remote post's id, which is what a later
/// delete needs. Only the outbox calls this.
pub async fn post(app: &AppHandle, outlet: &str, text: &str) -> Result<String, String> {
    let Some(c) = conn(outlet) else { return Err("not set up".into()) };
    match outlet {
        "discord" => discord::post(app, &c, text).await,
        _ => Err("unknown outlet".into()),
    }
}

/// Delete one of OUR OWN posts, by the id we stored. A failure is a warn, never an error the
/// user must act on: the pick is already gone from the app.
pub async fn delete_post(app: &AppHandle, outlet: &str, remote_id: &str) {
    let Some(c) = conn(outlet) else { return };
    let r = match outlet {
        "discord" => discord::delete(&c, remote_id).await,
        _ => Err("unknown outlet".into()),
    };
    match r {
        Ok(()) => crate::log::info(&format!("sotd:post:delete outlet={outlet}")),
        Err(e) => crate::log::warn(&format!("sotd: could not delete the {outlet} post ({e})")),
    }
    super::changed(app);
}
