//! Friends — who you are, and who you have added (docs/integrations/FRIENDS.md §2, §3).
//!
//! This file is the **bottom layer** the rest of Friends stands on, and it talks to no
//! network at all. It does three things:
//!
//! 1. **Mints one identity, once, and keeps it forever.** An Ed25519 key pair, minted at
//!    first ask and stored in `<app_data>/friends.json` encrypted with Windows DPAPI —
//!    the same road `sotd-outlets.json` takes (`sotd/outlet.rs`). The **friend code** is
//!    the public half: the first 5 bytes of `SHA-256(public key)`, written as 8 characters
//!    of the Crockford base32 alphabet the room code already uses (`rooms.rs`).
//! 2. **Keeps the friend list.** Up to 50 entries, in the same file. A friend is a code and
//!    a name you typed; nothing about a friend is ever fetched to store it.
//! 3. **Reads the invite link**, `deetsmusic://friend?code=…`, the road `…://room?code=…`
//!    already travels. The link carries no power: it hands the code to the front end,
//!    which asks before it adds anyone.
//!
//! **Why a key pair and not 16 random bytes.** The friend code is permanent (§2), so the
//! one thing it must survive is somebody else claiming it. A key pair lets the worker check
//! that a socket really is you — it verifies a signature over a nonce it chose — **without
//! ever holding anything secret of yours**. It is the property that keeps §1's line true:
//! the worker stores no secrets and no user data. A shared secret would have had to be sent
//! to the server to be checked, which is the opposite.
//!
//! **The secret never reaches the renderer.** `me()` returns the code; `sign()` returns a
//! signature. The seed leaves Rust through exactly one door, `friend_key_export`, which
//! exists because §2a's *Copy my key* is how you move to a new PC — and it is registered
//! with `log::register_secret`, so the log and any bug report mask it.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use base64::Engine as _;
use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

/// §5.1 rule 6. It bounds the per-launch connect cost, and it is five times more friends
/// than anyone will add.
pub const MAX_FRIENDS: usize = 50;

/// One person you have added. `code` is theirs and permanent; `name` is yours and local —
/// nobody is told what you called them.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Friend {
    pub code: String,
    pub name: String,
    /// Unix milliseconds. Only the list's default order uses it.
    pub added_at: i64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Store {
    /// The Ed25519 seed, 32 bytes, base64. This is the credential, and it IS you.
    seed: String,
    friends: Vec<Friend>,
}

static STORE: Mutex<Option<Store>> = Mutex::new(None);
static PATH: OnceLock<PathBuf> = OnceLock::new();

fn b64() -> base64::engine::general_purpose::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

// ── DPAPI ────────────────────────────────────────────────────────────────────
// Copied from sotd/outlet.rs on purpose: two secrets, two files, no shared lock. A
// decrypt that fails is a file from another Windows account, never a crash.

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
    let Some(p) = PATH.get() else { return Store::default() };
    let Ok(raw) = std::fs::read(p) else { return Store::default() };
    let plain = match unprotect(&raw) {
        Ok(v) => v,
        Err(e) => {
            // Another account's file, or a copy from another PC. No identity, one warn, and
            // the file is LEFT ALONE — overwriting it would destroy a key that is somebody's
            // only copy. §2a's Paste a key is the way back.
            crate::log::warn(&format!("friends: the key file could not be read on this account ({e})"));
            return Store::default();
        }
    };
    serde_json::from_slice(&plain).unwrap_or_default()
}

fn save(store: &Store) -> Result<(), String> {
    let p = PATH.get().ok_or("friends: no data dir yet")?;
    let json = serde_json::to_vec(store).map_err(|e| e.to_string())?;
    let blob = protect(&json)?;
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(p, blob).map_err(|e| e.to_string())
}

fn with_store<T>(f: impl FnOnce(&mut Store) -> T) -> T {
    let mut guard = STORE.lock().unwrap_or_else(|p| p.into_inner());
    if guard.is_none() {
        *guard = Some(load());
    }
    f(guard.as_mut().expect("store loaded"))
}

// ── the identity ─────────────────────────────────────────────────────────────

/// The friend code for a public key: `SHA-256(pub)[0..5]` as 8 Crockford characters.
///
/// 5 bytes is 40 bits, which is exactly 8 characters — no padding, and the same shape and
/// the same alphabet as a room code, so one `normalize` reads both. 40 bits is the size
/// ROOMS.md §6 already argued for against guessing, and a friend code is harder still: a
/// guessed code is useless unless that person also adds you back (§3, mutual add).
fn code_for(public: &VerifyingKey) -> String {
    let digest = Sha256::digest(public.as_bytes());
    let mut bits: u64 = 0;
    for b in &digest[..5] {
        bits = (bits << 8) | u64::from(*b);
    }
    let alphabet: Vec<char> = crate::rooms::ALPHABET.chars().collect();
    (0..crate::rooms::CODE_LEN)
        .map(|i| {
            let shift = 5 * (crate::rooms::CODE_LEN - 1 - i);
            alphabet[((bits >> shift) & 0x1f) as usize]
        })
        .collect()
}

/// The signing key, minted on the first ask and never again.
///
/// Minting is lazy on purpose: a person who never opens Friends never has a key, so the
/// app writes no identity it was not asked for.
fn key() -> Result<SigningKey, String> {
    let existing = with_store(|s| s.seed.clone());
    if !existing.is_empty() {
        let bytes = b64().decode(&existing).map_err(|e| format!("the stored key is unreadable ({e})"))?;
        let seed: [u8; 32] = bytes.try_into().map_err(|_| "the stored key is the wrong length".to_string())?;
        return Ok(SigningKey::from_bytes(&seed));
    }
    let mut seed = [0u8; 32];
    getrandom::getrandom(&mut seed).map_err(|e| format!("no randomness ({e})"))?;
    let signing = SigningKey::from_bytes(&seed);
    let encoded = b64().encode(seed);
    crate::log::register_secret(&encoded);
    with_store(|s| {
        s.seed = encoded;
        save(s)
    })?;
    crate::log::info(&format!("friends: a friend code was minted ({})", code_for(&signing.verifying_key())));
    Ok(signing)
}

/// Who you are, as the front end may see it. No secret in this shape.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Me {
    /// 8 characters, unhyphenated. The UI draws it as `K7QM-4XHT`.
    pub code: String,
    /// The public key, base64 — what the worker verifies a signature against.
    pub public_key: String,
}

/// Your friend code, minting it if this is the first time.
#[tauri::command]
pub fn friend_me() -> Result<Me, String> {
    let k = key()?;
    let public = k.verifying_key();
    Ok(Me { code: code_for(&public), public_key: b64().encode(public.as_bytes()) })
}

/// Sign the worker's nonce, so it can tell that this socket really is this friend code
/// (FRIENDS.md §5.1). The nonce is the worker's, never ours, so a signature cannot be
/// replayed onto a different connection.
///
/// The renderer gets a signature and never the key.
#[tauri::command]
pub fn friend_sign(nonce: String) -> Result<String, String> {
    if nonce.len() > 256 {
        return Err("that nonce is not a nonce".into());
    }
    let k = key()?;
    Ok(b64().encode(k.sign(nonce.as_bytes()).to_bytes()))
}

/// §2a, *Copy my key*. The one door the seed leaves by, and the UI that calls it carries
/// the warning that the key IS you.
#[tauri::command]
pub fn friend_key_export() -> Result<String, String> {
    key()?; // mint first, so there is always something to copy
    Ok(with_store(|s| s.seed.clone()))
}

/// §2a, *Paste a key*. Adopting a key REPLACES this PC's identity, so the caller confirms
/// first. The friend list is left alone: it is this PC's list, and the key is who you are,
/// not who you know.
#[tauri::command]
pub fn friend_key_import(key_b64: String) -> Result<Me, String> {
    let bytes = b64()
        .decode(key_b64.trim())
        .map_err(|_| "That does not look like a DeetsMusic key.".to_string())?;
    let seed: [u8; 32] = bytes.try_into().map_err(|_| "That key is the wrong length.".to_string())?;
    let signing = SigningKey::from_bytes(&seed);
    let encoded = b64().encode(seed);
    crate::log::register_secret(&encoded);
    with_store(|s| {
        s.seed = encoded;
        save(s)
    })?;
    let public = signing.verifying_key();
    crate::log::info("friends: a pasted key replaced this PC's friend code");
    Ok(Me { code: code_for(&public), public_key: b64().encode(public.as_bytes()) })
}

// ── the friend list ──────────────────────────────────────────────────────────

/// Your friends, newest first — the order the panel draws before presence reorders it.
#[tauri::command]
pub fn friend_list() -> Vec<Friend> {
    with_store(|s| {
        let mut out = s.friends.clone();
        out.sort_by(|a, b| b.added_at.cmp(&a.added_at));
        out
    })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Add a code. It checks the shape, refuses your own code and a duplicate, and holds the
/// cap. Adding is local and silent: the other person learns nothing until they add you too.
#[tauri::command]
pub fn friend_add(code: String, name: String) -> Result<Friend, String> {
    let code = crate::rooms::normalize(&code).ok_or("That is not a friend code.")?;
    if code == friend_me()?.code {
        return Err("That is your own code.".into());
    }
    let name = clean_name(&name);
    with_store(|s| {
        if s.friends.iter().any(|f| f.code == code) {
            return Err("They are already on your list.".to_string());
        }
        if s.friends.len() >= MAX_FRIENDS {
            return Err(format!("{MAX_FRIENDS} friends is the most the list holds."));
        }
        let friend = Friend { code: code.clone(), name, added_at: now_ms() };
        s.friends.push(friend.clone());
        save(s)?;
        Ok(friend)
    })
}

#[tauri::command]
pub fn friend_rename(code: String, name: String) -> Result<(), String> {
    let code = crate::rooms::normalize(&code).ok_or("That is not a friend code.")?;
    let name = clean_name(&name);
    with_store(|s| {
        let Some(f) = s.friends.iter_mut().find(|f| f.code == code) else {
            return Err("They are not on your list.".to_string());
        };
        f.name = name;
        save(s)
    })
}

#[tauri::command]
pub fn friend_remove(code: String) -> Result<(), String> {
    let code = crate::rooms::normalize(&code).ok_or("That is not a friend code.")?;
    with_store(|s| {
        s.friends.retain(|f| f.code != code);
        save(s)
    })
}

/// A name is yours and local, so the only rules are that it fits on a row and holds no
/// control characters. 24 is what a room name already allows (`room.ts`).
fn clean_name(raw: &str) -> String {
    let cleaned: String = raw.trim().chars().filter(|c| !c.is_control()).take(24).collect();
    if cleaned.is_empty() { "Friend".to_string() } else { cleaned }
}

// ── the invite link ──────────────────────────────────────────────────────────

/// Is this the friend route? (`<scheme>://friend?code=…`)
pub fn is_link(raw: &str) -> bool {
    url::Url::parse(raw)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.eq_ignore_ascii_case("friend")))
        .unwrap_or(false)
}

/// Hand the code to the front end (`friend-invite`). Like the room link, it carries no
/// power at all: the panel fills its field and the person presses Add. A stray page cannot
/// add anybody to anything.
pub fn handle_link(app: &AppHandle, raw: &str) {
    let code = url::Url::parse(raw)
        .ok()
        .and_then(|u| u.query_pairs().find(|(k, _)| k == "code").map(|(_, v)| v.into_owned()))
        .and_then(|raw| crate::rooms::normalize(&raw));
    match code {
        Some(code) => {
            crate::log::info("friends: an invite link arrived");
            let _ = app.emit("friend-invite", code);
        }
        None => crate::log::warn("friends: an invite link with no usable code; ignored"),
    }
}

// ── setup ────────────────────────────────────────────────────────────────────

/// Point the store at the data dir. It does NOT mint a key: that waits for the first ask,
/// so a person who never opens Friends never gets an identity.
pub fn setup(dir: PathBuf) {
    let _ = PATH.set(dir.join("friends.json"));
    with_store(|s| {
        if !s.seed.is_empty() {
            crate::log::register_secret(&s.seed);
            crate::log::info(&format!("friends: {} on the list", s.friends.len()));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_code_is_eight_crockford_characters() {
        let signing = SigningKey::from_bytes(&[7u8; 32]);
        let code = code_for(&signing.verifying_key());
        assert_eq!(code.chars().count(), crate::rooms::CODE_LEN);
        assert!(code.chars().all(|c| crate::rooms::ALPHABET.contains(c)));
        // Stable: the same key is the same person, on every PC and every version.
        assert_eq!(code_for(&signing.verifying_key()), code);
    }

    /// The cross-language vector. `DeetsMusicFriends/src/codes.js::codeForKey` must give
    /// this same answer for this same public key, or every friend code in the world
    /// changes meaning and no socket can ever prove itself again. Checked both ways on
    /// 2026-09-20; `DeetsMusicFriends/scripts/check.mjs` re-checks it over the wire.
    #[test]
    fn agrees_with_the_worker() {
        let signing = SigningKey::from_bytes(&[7u8; 32]);
        let public = b64().encode(signing.verifying_key().as_bytes());
        assert_eq!(public, "6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=");
        assert_eq!(code_for(&signing.verifying_key()), "ZT0JR4QK");
    }

    #[test]
    fn different_keys_are_different_people() {
        let a = code_for(&SigningKey::from_bytes(&[1u8; 32]).verifying_key());
        let b = code_for(&SigningKey::from_bytes(&[2u8; 32]).verifying_key());
        assert_ne!(a, b);
    }

    #[test]
    fn a_signature_verifies_against_the_public_key() {
        use ed25519_dalek::{Signature, Verifier};
        let signing = SigningKey::from_bytes(&[9u8; 32]);
        let sig = signing.sign(b"nonce-from-the-worker");
        let bytes: [u8; 64] = b64().decode(b64().encode(sig.to_bytes())).unwrap().try_into().unwrap();
        assert!(signing
            .verifying_key()
            .verify(b"nonce-from-the-worker", &Signature::from_bytes(&bytes))
            .is_ok());
    }

    #[test]
    fn a_name_is_trimmed_and_never_empty() {
        assert_eq!(clean_name("  Sam  "), "Sam");
        assert_eq!(clean_name(""), "Friend");
        assert_eq!(clean_name(&"x".repeat(80)).chars().count(), 24);
    }

    #[test]
    fn knows_its_own_route() {
        assert!(is_link("deetsmusic://friend?code=K7QM4XHT"));
        assert!(!is_link("deetsmusic://room?code=K7QM4XHT"));
    }
}
