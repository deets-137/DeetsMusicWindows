//! Velopack: install, update, uninstall (docs/ops/VELOPACK.md). update.rs keeps the commands
//! and the status the front end reads; this module is what is under them.
//!
//! - `startup()` is the first call in `run()`: Velopack's hook starts (`--veloapp-*`) do their
//!   work and exit here, before Tauri, the single-instance plugin or the beta copy start. It
//!   also applies a downloaded update at start (his call F1 A, VELOPACK.md §1): *Later* means
//!   "at the next start".
//! - `SignedSource` (§4): the feed must carry a minisign signature by the updater key, every
//!   package a SHA-256, our package id, a plain file name and a size under the cap, before
//!   Velopack sees it. Velopack then checks each package it downloads against that SHA-256.
//!   A hacked Worker or bucket alone cannot ship code to an install.
//! - The app id (AUMID) is Velopack's own `velopack.<packId>`: Update.exe writes it on the Start
//!   Menu shortcut whatever the app sets, so a different one splits the pin from the window
//!   (found by the spike, §8a).

use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use std::sync::Mutex;

use velopack::sources::{HttpSource, UpdateSource};
use velopack::{Error, UpdateCheck, UpdateInfo, UpdateManager, UpdateOptions, VelopackApp, VelopackAsset, VelopackAssetFeed};

/// The feed's home: `<BASE>/<channel>/vp/releases.<channel>.json` (DeetsSupport update.js).
const BASE: &str = "https://music-api.deets.solutions/update";
/// A build-time override: a local folder of `vpk pack` output, or another URL. For testing a
/// build before its feed is published (VELOPACK.md §8a). Never set in `npm run release`.
const FEED_OVERRIDE: Option<&str> = option_env!("DEETSMUSIC_VELO_FEED");
/// The updater key's public half (the key that signed the Tauri updater's installers until
/// 0.27; RELEASE.md §6.6). The same key signs every feed.
pub const PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDQ5Mjc4MzI3RTVFRjUxNzMKUldSelVlL2xKNE1uU2JCVG12VFczOFg1c3Zvdk9wa3ZOOHFZcXp3TmVkbnlxS0Vla3k4WXVYVkgK";
/// Refuse a feed that lists a bigger package (a full one is ~16 MB in 0.28).
const SIZE_CAP: u64 = 50 * 1024 * 1024;

/// Velopack's startup. A hook start does its work and exits inside `run()`; a normal start
/// with a downloaded update waiting applies it and restarts first.
pub fn startup() {
    VelopackApp::build()
        // Package identity (identity.rs, IDENTITY.md §3.4): register at install, again on an
        // update only when the identity version rose, remove at uninstall.
        .on_after_install_fast_callback(|_| crate::identity::on_install())
        .on_after_update_fast_callback(|_| crate::identity::on_updated())
        .on_before_update_fast_callback(|_| {
            stop_clis();
        })
        .on_before_uninstall_fast_callback(|_| before_uninstall())
        .run();
}

/// `<exe folder>\cli\`, the bundled CLI's folder.
fn cli_dir() -> Option<PathBuf> {
    Some(std::env::current_exe().ok()?.parent()?.join("cli"))
}

/// Stop every process that runs from this install's `cli\` folder: the MCP servers AI apps
/// hold open (RELEASE.md §4a). Matched by full path, never by name, so a dev build and the
/// other app's CLI keep running. Update.exe stops processes inside the install root too
/// (VELOPACK.md §8a S4); this first pass runs in the app, before it exits, and logs a count.
pub fn stop_clis() -> usize {
    let Some(dir) = cli_dir() else { return 0 };
    let prefix = dir.to_string_lossy().trim_start_matches(r"\\?\").to_lowercase() + "\\";
    let mut n = 0;
    for (pid, path) in processes() {
        if path.to_lowercase().starts_with(&prefix) && kill(pid) {
            n += 1;
        }
    }
    if n > 0 {
        std::thread::sleep(std::time::Duration::from_millis(300)); // the handles close after the exit
    }
    n
}

/// The uninstall: take our MCP entry out of the AI apps (an entry left behind points at a
/// deleted exe, MCP-INSTALL.md fork 6A), stop the CLIs, and remove the start-with-Windows value
/// when it points into this install. Velopack then deletes the folder; the data folder stays.
fn before_uninstall() {
    crate::identity::on_uninstall();
    if let Some(dir) = cli_dir() {
        let exe = dir.join(format!("{}.exe", crate::settings::cli_name()));
        if exe.is_file() {
            let _ = std::process::Command::new(exe).args(["mcp", "uninstall", "--all", "--quiet"]).status();
        }
    }
    stop_clis();
    if let Some(root) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_string_lossy().to_lowercase())) {
        if let Ok(out) = crate::settings::reg(&["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run", "/v", crate::beta::app_name()]) {
            if out.to_lowercase().contains(&root) {
                let _ = crate::settings::autostart_write(false);
            }
        }
    }
}

fn processes() -> Vec<(u32, String)> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    let mut out = Vec::new();
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
        let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut ok = Process32FirstW(snap, &mut e).is_ok();
        while ok {
            if let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, e.th32ProcessID) {
                let mut buf = [0u16; 1024];
                let mut len = buf.len() as u32;
                if QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut len).is_ok() {
                    out.push((e.th32ProcessID, String::from_utf16_lossy(&buf[..len as usize])));
                }
                let _ = CloseHandle(h);
            }
            ok = Process32NextW(snap, &mut e).is_ok();
        }
        let _ = CloseHandle(snap);
    }
    out
}

fn kill(pid: u32) -> bool {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
    unsafe {
        let Ok(h) = OpenProcess(PROCESS_TERMINATE, false, pid) else { return false };
        let ok = TerminateProcess(h, 0).is_ok();
        let _ = CloseHandle(h);
        ok
    }
}

// ── the signed feed (VELOPACK.md §4) ──

/// Where a feed is read from: the Worker (or an override URL), or a local folder.
#[derive(Clone)]
enum Where {
    Url(String),
    Dir(PathBuf),
}

impl Where {
    fn for_channel(channel: &str) -> Where {
        match FEED_OVERRIDE {
            Some(o) if o.starts_with("http") => Where::Url(o.trim_end_matches('/').to_string()),
            Some(o) => Where::Dir(PathBuf::from(o)),
            None => Where::Url(format!("{BASE}/{channel}/vp")),
        }
    }

    fn read(&self, name: &str, query: &str) -> Result<Vec<u8>, String> {
        match self {
            Where::Url(base) => velopack::download::download_url_as_string(&format!("{base}/{name}{query}"), None)
                .map(String::into_bytes)
                .map_err(|e| e.to_string()),
            Where::Dir(dir) => std::fs::read(dir.join(name)).map_err(|e| e.to_string()),
        }
    }
}

/// The main feed, or (with `rollback`) the one-version feed the Worker keeps for that version.
/// Packages always come from the main folder.
struct SignedSource {
    at: Where,
    rollback: Option<String>,
    current: String,
}

fn verify(data: &[u8], sig_b64: &str) -> Result<(), String> {
    use base64::Engine;
    let b64 = |s: &str| -> Result<String, String> {
        let raw = base64::engine::general_purpose::STANDARD.decode(s.trim()).map_err(|e| e.to_string())?;
        String::from_utf8(raw).map_err(|e| e.to_string())
    };
    let key = minisign_verify::PublicKey::decode(&b64(PUBKEY)?).map_err(|e| e.to_string())?;
    let sig = minisign_verify::Signature::decode(&b64(sig_b64)?).map_err(|e| e.to_string())?;
    key.verify(data, &sig, true).map_err(|e| e.to_string())
}

/// The whole trust rule, pure, so `cargo test` holds it.
fn check_feed(json: &[u8], sig: &str, app_id: &str) -> Result<VelopackAssetFeed, String> {
    verify(json, sig).map_err(|e| format!("the feed's signature is not ours: {e}"))?;
    let feed: VelopackAssetFeed = serde_json::from_slice(json).map_err(|e| e.to_string())?;
    for a in &feed.Assets {
        if !a.PackageId.eq_ignore_ascii_case(app_id) {
            return Err(format!("{} belongs to {}, not {app_id}", a.FileName, a.PackageId));
        }
        if a.SHA256.is_empty() {
            return Err(format!("{} has no SHA-256", a.FileName));
        }
        if a.Size > SIZE_CAP {
            return Err(format!("{} is {} bytes, over the cap", a.FileName, a.Size));
        }
        if a.FileName.contains(['/', '\\']) || a.FileName.contains("..") || !a.FileName.ends_with(".nupkg") {
            return Err(format!("{} is not a plain package name", a.FileName));
        }
    }
    Ok(feed)
}

impl UpdateSource for SignedSource {
    fn get_release_feed(&self, channel: &str, app: &velopack::bundle::Manifest, _: &str) -> Result<VelopackAssetFeed, Error> {
        let name = match &self.rollback {
            Some(v) => format!("rollback/{v}/releases.{channel}.json"),
            None => format!("releases.{channel}.json"),
        };
        // `v`: the Worker answers a rollback feed only inside the running version's group (§6.5).
        let query = format!("?v={}", self.current);
        let fetched = self.at.read(&name, &query).and_then(|json| {
            let sig = self.at.read(&format!("{name}.sig"), &query)?;
            Ok((json, String::from_utf8_lossy(&sig).into_owned()))
        });
        let (json, sig) = fetched.map_err(|e| Error::Other(format!("no feed: {e}")))?;
        check_feed(&json, &sig, &app.id).map_err(|e| {
            crate::log::warn(&format!("update: feed refused: {e}"));
            Error::Other(e)
        })
    }

    fn download_release_entry(&self, asset: &VelopackAsset, local_file: &Path, progress: Option<Sender<i16>>) -> Result<(), Error> {
        match &self.at {
            Where::Url(base) => HttpSource::new(base).download_release_entry(asset, local_file, progress),
            Where::Dir(dir) => {
                std::fs::copy(dir.join(&asset.FileName), local_file)?;
                if let Some(p) = &progress {
                    let _ = p.send(100);
                }
                Ok(())
            }
        }
    }
}

// ── check, download, install ──

/// The offer a download and an install act on.
static PENDING: Mutex<Option<UpdateInfo>> = Mutex::new(None);

fn manager(rollback: Option<String>) -> Result<UpdateManager, String> {
    // A dev build, or an exe outside an install, has no Velopack manifest: no updates.
    let probe = UpdateManager::new(velopack::sources::NoneSource {}, None, None).map_err(|_| "this build is not installed".to_string())?;
    let channel = probe_channel();
    let opts = UpdateOptions { AllowVersionDowngrade: rollback.is_some(), ExplicitChannel: None, MaximumDeltasBeforeFallback: 10 };
    let src = SignedSource { at: Where::for_channel(&channel), rollback, current: probe.get_current_version_as_string() };
    UpdateManager::new(src, Some(opts), None).map_err(|e| e.to_string())
}

/// The channel this install was packed for (`vpk pack --channel`): `deetsmusic`, or
/// `deetsmusic-test` for DeetsMusic Beta and test builds.
fn probe_channel() -> String {
    if crate::beta::is_beta() {
        return "deetsmusic-test".into();
    }
    option_env!("DEETSMUSIC_UPDATE_CHANNEL").unwrap_or("deetsmusic").into()
}

/// True in a Velopack install; false in a dev build.
pub fn installed() -> bool {
    UpdateManager::new(velopack::sources::NoneSource {}, None, None).is_ok()
}

pub struct Offer {
    pub version: String,
    pub notes: String,
    /// What this download fetches: the deltas when there are any, else the full package.
    pub size: u64,
}

/// The newest version (or `rollback`, an older one), or None.
pub fn check(rollback: Option<String>) -> Result<Option<Offer>, String> {
    let m = manager(rollback.clone())?;
    let found = match m.check_for_updates().map_err(|e| e.to_string())? {
        UpdateCheck::UpdateAvailable(info) => Some(*info),
        _ => None,
    };
    let Some(info) = found else {
        *PENDING.lock().unwrap_or_else(|e| e.into_inner()) = None;
        return Ok(None);
    };
    let t = &info.TargetFullRelease;
    if rollback.as_deref().is_some_and(|v| v != t.Version) {
        return Err(format!("asked for {}, the feed holds {}", rollback.unwrap_or_default(), t.Version));
    }
    let delta: u64 = info.DeltasToTarget.iter().map(|d| d.Size).sum();
    let size = if info.DeltasToTarget.is_empty() { t.Size } else { delta };
    crate::log::info(&format!(
        "update: {} {} offered ({} deltas, {size} bytes to fetch, full {} bytes)",
        if rollback.is_some() { "rollback to" } else { "version" },
        t.Version,
        info.DeltasToTarget.len(),
        t.Size
    ));
    let offer = Offer { version: t.Version.clone(), notes: t.NotesMarkdown.clone(), size };
    *PENDING.lock().unwrap_or_else(|e| e.into_inner()) = Some(info);
    Ok(Some(offer))
}

/// Download the offer (deltas first; a full package when they fail). `progress` gets 0–100.
/// Velopack keeps one download at a time with its own lock, and the package on disk.
pub fn download(rollback: Option<String>, progress: impl Fn(i16) + Send + 'static) -> Result<(), String> {
    let info = PENDING.lock().unwrap_or_else(|e| e.into_inner()).clone().ok_or("nothing to download; check first")?;
    let m = manager(rollback)?;
    let (tx, rx) = std::sync::mpsc::channel::<i16>();
    let pump = std::thread::spawn(move || {
        for p in rx {
            progress(p);
        }
    });
    let t0 = std::time::Instant::now();
    let r = m.download_updates(&info, Some(tx)).map_err(|e| e.to_string());
    let _ = pump.join();
    crate::log::info(&format!(
        "update: download of {} took {} ms{}",
        info.TargetFullRelease.Version,
        t0.elapsed().as_millis(),
        r.as_ref().err().map(|e| format!(": {e}")).unwrap_or_default()
    ));
    r
}

/// Throw away a downloaded version that waits for the next start (*Skip this version*): the
/// start applies any newer full package in the packages folder (F1 A), so a skip must delete it.
/// Returns the version thrown away.
pub fn discard() -> Result<Option<String>, String> {
    let m = manager(None)?;
    let Some(asset) = m.get_update_pending_restart() else { return Ok(None) };
    let dir = velopack::locator::auto_locate_app_manifest(velopack::locator::LocationContext::FromCurrentExe)
        .map_err(|e| e.to_string())?
        .get_packages_dir();
    std::fs::remove_file(dir.join(&asset.FileName)).map_err(|e| e.to_string())?;
    *PENDING.lock().unwrap_or_else(|e| e.into_inner()) = None;
    crate::log::info(&format!("update: {} skipped; its downloaded package is deleted", asset.Version));
    Ok(Some(asset.Version))
}

/// Hand the swap to Update.exe (it waits for this process to exit, swaps `current\`, starts
/// the new version), then exit. The caller has saved the session and stopped AirPlay.
pub fn install(rollback: Option<String>) -> Result<(), String> {
    let info = PENDING.lock().unwrap_or_else(|e| e.into_inner()).clone().ok_or("no update is ready to install")?;
    let m = manager(rollback)?;
    let args: [&str; 0] = [];
    m.wait_exit_then_apply_updates(&info.TargetFullRelease, true, true, args).map_err(|e| e.to_string())?;
    crate::log::info(&format!("update: installing {}; the app exits now", info.TargetFullRelease.Version));
    std::process::exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    // The signed-feed rule (VELOPACK.md §4), 2026-10-15: an unsigned or re-signed-by-someone-else
    // feed never reaches Velopack.
    #[test]
    fn feed_without_our_signature_is_refused_2026_10_15() {
        let json = br#"{"Assets":[]}"#;
        let bogus = "dW50cnVzdGVkIGNvbW1lbnQ6IG5vdCBhIHNpZ25hdHVyZQo=";
        let err = check_feed(json, bogus, "DeetsMusic").unwrap_err();
        assert!(err.contains("signature"), "{err}");
    }
}
