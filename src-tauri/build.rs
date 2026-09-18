fn main() {
    lastfm_key();
    build_key();
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

/// The build key (docs/RELEASE.md §7a): one line in `Documents\Deets' Secrets\deetsmusic-build-key.txt`
/// (or the file `DEETSMUSIC_BUILD_KEY` names), handed to the app as `option_env!("DEETS_BUILD_KEY")`.
/// The app sends it as the `X-Deets-Build` header on the token mint and on report intake, and the
/// DeetsSupport worker refuses a request without a listed key once its `BUILD_KEYS` secret is set.
/// A missing file builds an app that sends no header — fine for a clone, which brings its own
/// back end; `release-check` refuses to ship it.
fn build_key() {
    println!("cargo:rerun-if-env-changed=DEETSMUSIC_BUILD_KEY");
    let path = std::env::var("DEETSMUSIC_BUILD_KEY").map(std::path::PathBuf::from).unwrap_or_else(|_| {
        let home = std::env::var("USERPROFILE").unwrap_or_default();
        std::path::Path::new(&home).join("Documents").join("Deets' Secrets").join("deetsmusic-build-key.txt")
    });
    println!("cargo:rerun-if-changed={}", path.display());
    match std::fs::read_to_string(&path).map(|t| t.trim().to_string()) {
        Ok(key) if !key.is_empty() && !key.contains(char::is_whitespace) => println!("cargo:rustc-env=DEETS_BUILD_KEY={key}"),
        Ok(_) => println!("cargo:warning=build key: {} is empty or has spaces (this build sends none)", path.display()),
        Err(_) => println!("cargo:warning=build key: no file at {} (this build sends none)", path.display()),
    }
}
