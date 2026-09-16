fn main() {
    lastfm_key();
    tauri_build::build()
}

/// The Last.fm API account (docs/LASTFM.md §2): built into the exe, as Last.fm expects of a
/// desktop app. Read from `Documents\Deets' Secrets\lastfm.json` (or the file that
/// `DEETSMUSIC_LASTFM` names) and handed to `lastfm.rs` as `option_env!` values. Only the two
/// values reach the exe, never the path. A missing file or an unfilled `PASTE_…` value builds
/// an app whose Last.fm row says it is not in this build; `release-check` refuses to ship that.
fn lastfm_key() {
    println!("cargo:rerun-if-env-changed=DEETSMUSIC_LASTFM");
    let path = std::env::var("DEETSMUSIC_LASTFM").map(std::path::PathBuf::from).unwrap_or_else(|_| {
        let home = std::env::var("USERPROFILE").unwrap_or_default();
        std::path::Path::new(&home).join("Documents").join("Deets' Secrets").join("lastfm.json")
    });
    println!("cargo:rerun-if-changed={}", path.display());
    let Ok(text) = std::fs::read_to_string(&path) else {
        println!("cargo:warning=Last.fm: no key file at {} (scrobbling is off in this build)", path.display());
        return;
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
        println!("cargo:warning=Last.fm: {} is not valid JSON (scrobbling is off in this build)", path.display());
        return;
    };
    let field = |k: &str| json.get(k).and_then(|v| v.as_str()).map(str::trim).filter(|v| !v.is_empty() && !v.starts_with("PASTE_"));
    match (field("apiKey"), field("sharedSecret")) {
        (Some(key), Some(secret)) => {
            println!("cargo:rustc-env=DEETS_LASTFM_KEY={key}");
            println!("cargo:rustc-env=DEETS_LASTFM_SECRET={secret}");
        }
        _ => println!("cargo:warning=Last.fm: apiKey / sharedSecret not filled in (scrobbling is off in this build)"),
    }
}
