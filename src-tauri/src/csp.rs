//! The webview's Content Security Policy (docs/architecture/CSP.md).
//!
//! The policy itself is `app.security.csp` in tauri.conf.json: Tauri adds each page's inline
//! script hashes and a nonce at build time, and sends it as `Content-Security-Policy` on every
//! page it serves from the bundle. This file decides two things at each page load (§6, §7):
//! - **The mode.** `report` renames the header to `Content-Security-Policy-Report-Only`: the
//!   webview reports what the policy would block and blocks nothing. `enforce` leaves it.
//! - **A signed relaxation.** DeetsSupport's `/config` may carry `csp: { payload, sig }`, where
//!   `payload` is JSON `{ mode?, add, versions }` signed with the updater key (velo.rs `PUBKEY`).
//!   It is the way back when Apple changes MusicKit and the policy blocks a new host: it can
//!   add sources to a directive, or switch to `report`, for the versions it names. It is
//!   fetched in the background at each start and saved; it applies from the next launch.
//!
//! A dev build serves the page from Vite, not from the bundle, so neither applies there: the
//! Vite plugin (scripts/csp-dev-plugin.mjs) sends the same policy in report mode instead.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// This release's mode (§6, step 2: one release in report, then enforce).
const RELEASE_MODE: Mode = Mode::Report;
const CONFIG_URL: &str = "https://support.deets.solutions/config?app=deetsmusic";
const FILE: &str = "csp-relax.json";
const FETCH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// The directives a block is counted under, and a relaxation may add to. A block's log line
/// starts with `csp-<directive>:`, which usage.rs counts as its own area (C1, §9).
pub const DIRECTIVES: &[&str] = &[
    "default-src", "script-src", "style-src", "img-src", "media-src", "font-src", "connect-src",
    "worker-src", "object-src", "base-uri", "form-action", "frame-src", "manifest-src", "child-src",
];

#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Report,
    Enforce,
}

/// What a relaxation says, once its signature is good.
#[derive(Clone, Debug, PartialEq, serde::Deserialize)]
struct Relax {
    mode: Option<Mode>,
    #[serde(default)]
    add: BTreeMap<String, Vec<String>>,
    versions: Vec<String>,
}

/// The signed form, as `/config` carries it and `csp-relax.json` keeps it.
#[derive(Clone, PartialEq, serde::Serialize, serde::Deserialize)]
struct Signed {
    payload: String,
    sig: String,
}

/// The mode and the extra sources for this run, fixed before the windows are made.
struct Active {
    mode: Mode,
    add: BTreeMap<String, Vec<String>>,
}

static ACTIVE: OnceLock<Active> = OnceLock::new();
static DIR: OnceLock<PathBuf> = OnceLock::new();

/// Read the saved relaxation and fix this run's policy. Call before the windows are made.
pub fn setup(dir: &Path) {
    let _ = DIR.set(dir.to_path_buf());
    let relax = std::fs::read_to_string(dir.join(FILE)).ok().and_then(|text| {
        let signed: Signed = serde_json::from_str(&text).ok()?;
        match check(&signed, env!("CARGO_PKG_VERSION")) {
            Ok(r) => r,
            Err(e) => {
                crate::log::warn(&format!("csp: the saved relaxation was not used ({e})"));
                None
            }
        }
    });
    let active = match relax {
        Some(r) => {
            crate::log::info(&format!(
                "csp: a signed relaxation applies (mode {:?}, adds to {})",
                r.mode.unwrap_or(RELEASE_MODE),
                r.add.keys().cloned().collect::<Vec<_>>().join(", ")
            ));
            Active { mode: r.mode.unwrap_or(RELEASE_MODE), add: r.add }
        }
        None => Active { mode: RELEASE_MODE, add: BTreeMap::new() },
    };
    if !cfg!(debug_assertions) {
        crate::log::info(&format!("csp: {:?}", active.mode));
    }
    let _ = ACTIVE.set(active);
}

/// The window hook (`on_web_resource_request`): the mode's header name, the relaxation's sources.
pub fn hook(_req: tauri::http::Request<Vec<u8>>, res: &mut tauri::http::Response<std::borrow::Cow<'static, [u8]>>) {
    use tauri::http::header::{HeaderName, HeaderValue};
    let Some(active) = ACTIVE.get() else { return };
    let Some(policy) = res.headers_mut().remove("Content-Security-Policy") else { return };
    let text = policy.to_str().map(|s| with_sources(s, &active.add)).unwrap_or_default();
    let Ok(value) = HeaderValue::from_str(&text) else {
        // Never serve a page with no policy because a relaxation made a bad header.
        res.headers_mut().insert("Content-Security-Policy", policy);
        return;
    };
    let name = match active.mode {
        Mode::Report => HeaderName::from_static("content-security-policy-report-only"),
        Mode::Enforce => HeaderName::from_static("content-security-policy"),
    };
    res.headers_mut().insert(name, value);
}

/// Fetch `/config` and save (or drop) the relaxation for the next launch. In the background.
pub fn refresh() {
    if cfg!(debug_assertions) {
        return; // a dev page never carries the bundle's policy (see the top of this file)
    }
    tauri::async_runtime::spawn(async {
        let Some(dir) = DIR.get().cloned() else { return };
        let url = format!("{CONFIG_URL}&v={}", env!("CARGO_PKG_VERSION"));
        let body: serde_json::Value = match crate::apple::http_client().get(&url).timeout(FETCH_TIMEOUT).send().await {
            Ok(r) if r.status().is_success() => match r.json().await {
                Ok(v) => v,
                Err(_) => return,
            },
            _ => return, // offline or a worker fault: keep what is saved
        };
        let Some(config) = body.get("config").filter(|c| c.is_object()) else { return };
        let path = dir.join(FILE);
        let saved: Option<Signed> = std::fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str(&t).ok());
        match config.get("csp") {
            None => {
                if saved.is_some() {
                    let _ = tauri::async_runtime::spawn_blocking(move || std::fs::remove_file(&path)).await;
                    crate::log::info("csp: the relaxation was withdrawn; the built-in policy applies from the next launch");
                }
            }
            Some(v) => {
                let Ok(signed) = serde_json::from_value::<Signed>(v.clone()) else {
                    crate::log::warn("csp: /config carried a relaxation of the wrong shape; ignored");
                    return;
                };
                if saved.as_ref() == Some(&signed) {
                    return;
                }
                if let Err(e) = check(&signed, env!("CARGO_PKG_VERSION")) {
                    crate::log::warn(&format!("csp: /config carried a relaxation that is not ours ({e}); ignored"));
                    return;
                }
                let bytes = serde_json::to_vec(&signed).unwrap_or_default();
                match tauri::async_runtime::spawn_blocking(move || crate::safe_file::write_atomic(&path, &bytes)).await {
                    Ok(Ok(())) => crate::log::info("csp: a new signed relaxation is saved; it applies from the next launch"),
                    _ => crate::log::warn("csp: could not save the relaxation"),
                }
            }
        }
    });
}

/// A block the page saw (`securitypolicyviolation`). One WARN line per block, in the area
/// `csp-<directive>`, so the health counts carry it per directive and never its text (C1).
/// The page sends each directive + host + file once per load.
#[tauri::command]
pub fn csp_blocked(directive: String, host: String, source: String, report_only: bool) {
    let base = base_directive(&directive);
    let clean = |s: &str, n: usize| -> String {
        s.chars().filter(|c| c.is_ascii_graphic()).take(n).collect()
    };
    crate::log::warn(&format!(
        "csp-{base}: {} {} ({}) from {}",
        if report_only { "would block" } else { "blocked" },
        clean(&host, 80),
        clean(&directive, 24),
        clean(&source, 120),
    ));
}

/// `script-src-elem` → `script-src`; an unknown name → `other`.
fn base_directive(d: &str) -> &'static str {
    let d = d.trim().to_ascii_lowercase();
    let d = d.strip_suffix("-elem").or_else(|| d.strip_suffix("-attr")).unwrap_or(&d).to_string();
    DIRECTIVES.iter().find(|x| **x == d).copied().unwrap_or("other")
}

/// The signature, then the payload, then the version. `Ok(None)`: good, but not for this version.
fn check(s: &Signed, version: &str) -> Result<Option<Relax>, String> {
    check_with(crate::velo::PUBKEY, s, version)
}

fn check_with(pubkey: &str, s: &Signed, version: &str) -> Result<Option<Relax>, String> {
    crate::velo::verify_with(pubkey, s.payload.as_bytes(), &s.sig).map_err(|e| format!("signature: {e}"))?;
    let r: Relax = serde_json::from_str(&s.payload).map_err(|e| format!("payload: {e}"))?;
    for (d, sources) in &r.add {
        if !DIRECTIVES.contains(&d.as_str()) {
            return Err(format!("unknown directive {d}"));
        }
        if let Some(bad) = sources.iter().find(|s| !source_ok(s)) {
            return Err(format!("bad source {bad}"));
        }
    }
    Ok(r.versions.iter().any(|v| version_matches(v, version)).then_some(r))
}

/// One source token: no space, no `;` or `,`, nothing that could end the directive.
fn source_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 200 && s.chars().all(|c| c.is_ascii_alphanumeric() || ":/*.-_'+=".contains(c))
}

/// `0.32.0` matches itself; `0.32.*` matches every 0.32 version; `*` matches all.
fn version_matches(pattern: &str, version: &str) -> bool {
    match pattern.strip_suffix('*') {
        Some(prefix) => version.starts_with(prefix),
        None => pattern == version,
    }
}

/// The policy with the relaxation's sources added to their directives (a directive the policy
/// lacks is added whole).
fn with_sources(policy: &str, add: &BTreeMap<String, Vec<String>>) -> String {
    if add.is_empty() {
        return policy.to_string();
    }
    let mut parts: Vec<String> = policy.split(';').map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect();
    for (d, sources) in add {
        let extra = sources.join(" ");
        match parts.iter_mut().find(|p| p.split_whitespace().next() == Some(d.as_str())) {
            Some(p) => {
                p.push(' ');
                p.push_str(&extra);
            }
            None => parts.push(format!("{d} {extra}")),
        }
    }
    parts.join("; ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn add(d: &str, s: &[&str]) -> BTreeMap<String, Vec<String>> {
        BTreeMap::from([(d.to_string(), s.iter().map(|x| x.to_string()).collect())])
    }

    #[test]
    fn sources_join_their_directive_2026_10_21() {
        let p = "default-src 'self'; connect-src 'self' https://*.apple.com; img-src 'self'";
        assert_eq!(
            with_sources(p, &add("connect-src", &["https://new.example"])),
            "default-src 'self'; connect-src 'self' https://*.apple.com https://new.example; img-src 'self'"
        );
        assert_eq!(with_sources(p, &add("media-src", &["blob:"])), format!("{p}; media-src blob:"));
        assert_eq!(with_sources(p, &BTreeMap::new()), p);
    }

    #[test]
    fn a_source_cannot_end_its_directive_2026_10_21() {
        assert!(source_ok("https://*.apple.com"));
        assert!(source_ok("'wasm-unsafe-eval'"));
        assert!(source_ok("'sha256-abc+/=='"));
        assert!(!source_ok("https://a.com; script-src *"));
        assert!(!source_ok("a b"));
        assert!(!source_ok(""));
    }

    #[test]
    fn versions_match_exact_or_by_prefix_2026_10_21() {
        assert!(version_matches("0.32.0", "0.32.0"));
        assert!(!version_matches("0.32.0", "0.32.1"));
        assert!(version_matches("0.32.*", "0.32.4"));
        assert!(!version_matches("0.32.*", "0.33.0"));
        assert!(version_matches("*", "1.0.0"));
    }

    #[test]
    fn directives_fold_to_their_base_2026_10_21() {
        assert_eq!(base_directive("script-src-elem"), "script-src");
        assert_eq!(base_directive("style-src-attr"), "style-src");
        assert_eq!(base_directive("connect-src"), "connect-src");
        assert_eq!(base_directive("trusted-types"), "other");
        // Every area fits the worker's area rule (16 characters at most).
        for d in DIRECTIVES {
            assert!(format!("csp-{d}").len() <= 16, "{d}");
        }
    }

    /// A throwaway key pair (`tauri signer generate`, no password), made for this test only;
    /// the payload was signed with `tauri signer sign`, as `npm run csp:relax` does.
    const TEST_PUB: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDI2NjFCODc5NTA4N0IyN0MKUldSOHNvZFFlYmhoSmhlbDZvVXpIRWVnOXB4SGdDcGUyRWtYWHNBSVdmQi82aVZTSUp2VzcwM0oK";
    const TEST_PAYLOAD: &str = r#"{"mode":"report","add":{"connect-src":["https://new.example"]},"versions":["0.32.*"]}"#;
    const TEST_SIG: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSOHNvZFFlYmhoSm91WVJFTndEaFgrWjg1VkVzUVIvbTA4RGRzWjNXcTNScHFTcVVDTWdLMlZkaXFSczZSbTNwY1ZrMERsMnd1bHF1NVYva3VzRHA2Q0dwSVpvaExkOGdNPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkyNjE0NDA4CWZpbGU6cC5qc29uClhDS1g0Y29uWEFWRFpnRVB2SDh0NFFnSFJuWjBqVjYrczRibjhwdlVJQVcxZ3lKLy9hbE5WTVpvZmNFWW8zeS94RmQvUUtlSmgwbGU4MFNrMCtQWUF3PT0K";

    #[test]
    fn a_signed_relaxation_applies_to_its_versions_only_2026_10_21() {
        let s = Signed { payload: TEST_PAYLOAD.into(), sig: TEST_SIG.into() };
        let r = check_with(TEST_PUB, &s, "0.32.1").unwrap().expect("0.32.1 is in 0.32.*");
        assert_eq!(r.mode, Some(Mode::Report));
        assert_eq!(r.add, add("connect-src", &["https://new.example"]));
        assert_eq!(check_with(TEST_PUB, &s, "0.33.0").unwrap(), None);
        // One changed byte, and the signature no longer holds.
        let tampered = Signed { payload: TEST_PAYLOAD.replace("new.example", "evil.example"), sig: TEST_SIG.into() };
        assert!(check_with(TEST_PUB, &tampered, "0.32.1").unwrap_err().starts_with("signature"));
        // Signed by another key than the app's: refused.
        assert!(check(&s, "0.32.1").is_err());
    }

    #[test]
    fn an_unsigned_relaxation_is_refused_2026_10_21() {
        let s = Signed { payload: r#"{"mode":"report","versions":["*"]}"#.into(), sig: "bm90IGEgc2lnbmF0dXJl".into() };
        assert!(check(&s, "0.32.0").unwrap_err().starts_with("signature"));
    }
}
