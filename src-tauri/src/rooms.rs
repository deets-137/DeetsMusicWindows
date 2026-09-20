//! Listening rooms: the invite link (docs/ROOMS.md §1, §9.1).
//!
//! `deetsmusic://room?code=K7QM4XHT` opens the app and offers to join. The browser
//! starts the exe with the link as an argument and the single-instance plugin hands it
//! here (lib.rs), the same road `…://auth?…` and `…://lastfm?…` travel.
//!
//! Nothing else about a room is Rust's: the worker is reached from the webview, and no
//! Apple key, Last.fm key or account detail is involved. This file only checks the
//! shape of the code and passes it to the front end, which asks before it joins.

use tauri::{AppHandle, Emitter};

/// Crockford base32, the room code's alphabet (§6). No I, L, O or U.
/// A FRIEND code uses the same alphabet and the same length (FRIENDS.md §2), so
/// `normalize` below is shared rather than copied — one reading of "is this a code",
/// for both kinds.
pub(crate) const ALPHABET: &str = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
pub(crate) const CODE_LEN: usize = 8;

/// Is this the room route? (`<scheme>://room?code=…`)
pub fn is_link(raw: &str) -> bool {
    url::Url::parse(raw)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.eq_ignore_ascii_case("room")))
        .unwrap_or(false)
}

/// A code as typed or as sent: any case, with or without the dash, with the misread
/// letters mapped back (`O`→`0`, `I`/`L`→`1`). `None` when it is not a code.
pub(crate) fn normalize(raw: &str) -> Option<String> {
    let cleaned: String = raw
        .to_ascii_uppercase()
        .chars()
        .filter(|c| !matches!(c, ' ' | '-' | '_'))
        .map(|c| match c {
            'O' => '0',
            'I' | 'L' => '1',
            other => other,
        })
        .collect();
    if cleaned.chars().count() != CODE_LEN {
        return None;
    }
    if !cleaned.chars().all(|c| ALPHABET.contains(c)) {
        return None;
    }
    Some(cleaned)
}

/// Hand the code to the front end (`room-invite`). Anything that is not a code is
/// dropped with a line in the log: a stray page can open a link, so nothing here acts
/// on its own — room.ts asks the person before it joins.
pub fn handle_link(app: &AppHandle, raw: &str) {
    let code = url::Url::parse(raw)
        .ok()
        .and_then(|u| {
            u.query_pairs()
                .find(|(k, _)| k == "code")
                .map(|(_, v)| v.into_owned())
        })
        .and_then(|raw| normalize(&raw));
    match code {
        Some(code) => {
            crate::log::info("rooms: an invite link arrived");
            let _ = app.emit("room-invite", code);
        }
        None => crate::log::warn("rooms: an invite link with no usable code; ignored"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_code_in_any_form() {
        assert_eq!(normalize("K7QM4XHT").as_deref(), Some("K7QM4XHT"));
        assert_eq!(normalize("k7qm-4xht").as_deref(), Some("K7QM4XHT"));
        // The misread letters map back to what the code really holds.
        assert_eq!(normalize("K7QM4XHI").as_deref(), Some("K7QM4XH1"));
        assert_eq!(normalize("OOOOOOOO").as_deref(), Some("00000000"));
    }

    #[test]
    fn refuses_anything_else() {
        assert!(normalize("").is_none());
        assert!(normalize("K7QM4XH").is_none()); // too short
        assert!(normalize("K7QM4XHTT").is_none()); // too long
        assert!(normalize("K7QM4XH!").is_none()); // not the alphabet
    }

    #[test]
    fn knows_its_own_route() {
        assert!(is_link("deetsmusic://room?code=K7QM4XHT"));
        assert!(!is_link("deetsmusic://auth?n=1"));
        assert!(!is_link("not a url"));
    }
}
