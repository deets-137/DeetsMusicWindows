//! Package identity (docs/ops/IDENTITY.md): a small signed `.msix` registered against the
//! install's `current\` folder, so the taskbar, Start and the media flyout draw the app from the
//! package's exact-size logos instead of shrinking the exe's 32 px frame (whitelabel.md §10.6).
//!
//! - **Who:** an installed release build only (`current\` beside `..\Update.exe`, with the
//!   `.msix` shipped in it). The dev app and a release exe run from anywhere else do nothing.
//! - **Install hook:** register. A failure leaves the app without identity (§3.7): it runs as
//!   before, so it gets a plain Start shortcut (`vpk --shortcuts None` makes none).
//! - **Updated hook:** register again only when the shipped identity version is newer than
//!   the registered one, so most updates add nothing to their time.
//! - **Uninstall hook:** remove the package. Velopack then deletes the shortcuts and the folder.
//! - **Each start** (`on_start`, off the main thread): with identity, remove Velopack's old Start
//!   shortcut (from before identity; it would be a second Start entry, P1). Without it, register
//!   (it takes effect at the next start) or keep the plain shortcut.
//!
//! No `.lnk` may carry the package's app ID: the taskbar then draws that shortcut's icon, soft
//! (§8 P3, T2). The Start entry is the package's own (`AppListEntry` shown) and a pin is a
//! packaged pin, made by the user from the running button (P4).

use std::path::{Path, PathBuf};

use windows::core::{Interface, HSTRING};
use windows::Foundation::Uri;
use windows::Management::Deployment::{AddPackageOptions, PackageManager};
use windows::Win32::Foundation::{ERROR_INSUFFICIENT_BUFFER, WIN32_ERROR};
use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
use windows::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;
use windows::Win32::System::Com::StructuredStorage::InitPropVariantFromStringVector;
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READ};
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

const JSON: &str = include_str!("../identity/identity.json");
/// The signed identity package, shipped in `current\` by `release.mjs`.
pub const MSIX: &str = "DeetsMusic.identity.msix";

struct Id {
    name: String,
    publisher: String,
    version: [u16; 4],
}

fn id() -> Option<Id> {
    let json: serde_json::Value = serde_json::from_str(JSON).ok()?;
    let flavor = if crate::beta::is_beta() { "beta" } else { "live" };
    let mut version = [0u16; 4];
    for (slot, part) in version.iter_mut().zip(json["version"].as_str()?.split('.')) {
        *slot = part.parse().ok()?;
    }
    Some(Id {
        name: json["flavors"][flavor]["name"].as_str()?.to_string(),
        publisher: json["publisher"].as_str()?.to_string(),
        version,
    })
}

/// `current\` when this is an installed release build that ships the package.
fn install_dir() -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        return None;
    }
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let named_current = dir.file_name()?.to_string_lossy().eq_ignore_ascii_case("current");
    (named_current && dir.parent()?.join("Update.exe").is_file() && dir.join(MSIX).is_file()).then(|| dir.to_path_buf())
}

/// Does this process run with the package's identity?
pub fn has_identity() -> bool {
    let mut len = 0u32;
    // With a package, a zero-length buffer is "too small"; without one, APPMODEL_ERROR_NO_PACKAGE.
    let rc: WIN32_ERROR = unsafe { GetCurrentPackageFullName(&mut len, None) };
    rc == ERROR_INSUFFICIENT_BUFFER
}

/// The registered package for this user: (full name, version), or None.
fn registered(id: &Id) -> Option<(String, [u16; 4])> {
    let pm = PackageManager::new().ok()?;
    let found = pm.FindPackagesByUserSecurityIdNamePublisher(&HSTRING::new(), &HSTRING::from(&id.name), &HSTRING::from(&id.publisher)).ok()?;
    let pkg = found.into_iter().next()?;
    let pid = pkg.Id().ok()?;
    let v = pid.Version().ok()?;
    Some((pid.FullName().ok()?.to_string(), [v.Major, v.Minor, v.Build, v.Revision]))
}

/// A `file:///` URI for a local path (spaces and `#` escaped; `%` first).
fn file_uri(path: &Path) -> windows::core::Result<Uri> {
    let p = path.to_string_lossy().replace('%', "%25").replace(' ', "%20").replace('#', "%23").replace('\\', "/");
    Uri::CreateUri(&HSTRING::from(format!("file:///{p}")))
}

/// Register the shipped package against `dir` (current\), then refresh the shell's icon cache.
fn register(dir: &Path) -> Result<(), String> {
    let e = |w: windows::core::Error| w.to_string();
    let pm = PackageManager::new().map_err(e)?;
    let opts = AddPackageOptions::new().map_err(e)?;
    opts.SetExternalLocationUri(&file_uri(dir).map_err(e)?).map_err(e)?;
    let res = pm.AddPackageByUriAsync(&file_uri(&dir.join(MSIX)).map_err(e)?, &opts).map_err(e)?.get().map_err(e)?;
    let code = res.ExtendedErrorCode().map_err(e)?;
    if code.is_err() {
        return Err(format!("{code:?}: {}", res.ErrorText().map(|t| t.to_string()).unwrap_or_default()));
    }
    refresh_icons();
    Ok(())
}

fn unregister(id: &Id) -> Result<(), String> {
    let Some((full, _)) = registered(id) else { return Ok(()) };
    let pm = PackageManager::new().map_err(|e| e.to_string())?;
    pm.RemovePackageAsync(&HSTRING::from(full)).map_err(|e| e.to_string())?.get().map_err(|e| e.to_string())?;
    Ok(())
}

/// The shell caches the icon it chose per app ID; a stale one stays until this (§8.1 "cache").
fn refresh_icons() {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = std::process::Command::new("ie4uinit.exe").arg("-show").creation_flags(CREATE_NO_WINDOW).status();
}

// ── the Start shortcut ──

/// Velopack's Start shortcut (`--packTitle` names it), and our plain fallback: the same file.
fn start_lnk() -> Option<PathBuf> {
    let roaming = PathBuf::from(std::env::var_os("APPDATA")?);
    Some(roaming.join(r"Microsoft\Windows\Start Menu\Programs").join(format!("{}.lnk", crate::beta::app_name())))
}

fn com() {
    // S_FALSE (already initialized on this thread) is fine; a different mode is too for these calls.
    let _ = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
}

fn lnk_target(lnk: &Path) -> Option<PathBuf> {
    com();
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        link.cast::<IPersistFile>().ok()?.Load(&HSTRING::from(lnk.as_os_str()), STGM_READ).ok()?;
        let mut buf = [0u16; 1024];
        link.GetPath(&mut buf, std::ptr::null_mut(), 0).ok()?;
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(PathBuf::from(String::from_utf16_lossy(&buf[..len])))
    }
}

/// Remove the Start shortcut when it points into this install (Velopack's, or our fallback).
fn remove_start_lnk(root: &Path) {
    let Some(lnk) = start_lnk().filter(|p| p.is_file()) else { return };
    let ours = lnk_target(&lnk).is_some_and(|t| t.to_string_lossy().to_lowercase().starts_with(&root.to_string_lossy().to_lowercase()));
    if ours {
        match std::fs::remove_file(&lnk) {
            Ok(()) => crate::log::info("identity: removed the old Start shortcut (the package is the Start entry now)"),
            Err(e) => crate::log::warn(&format!("identity: could not remove the old Start shortcut: {e}")),
        }
    }
}

/// Without identity the app needs a Start entry of its own: a plain shortcut to `current\`'s
/// exe with Velopack's app ID (`velopack.<packId>`, what the process sets), as before identity.
fn ensure_plain_lnk(dir: &Path) {
    let Some(lnk) = start_lnk() else { return };
    if lnk.is_file() {
        return;
    }
    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(_) => return,
    };
    let aumid = format!("velopack.{}", crate::beta::app_name().replace(' ', ""));
    com();
    let made = unsafe {
        (|| -> windows::core::Result<()> {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            link.SetPath(&HSTRING::from(exe.as_os_str()))?;
            link.SetWorkingDirectory(&HSTRING::from(dir.as_os_str()))?;
            link.SetIconLocation(&HSTRING::from(exe.as_os_str()), 0)?;
            let store: IPropertyStore = link.cast()?;
            let id = HSTRING::from(aumid.as_str());
            let value = InitPropVariantFromStringVector(Some(&[windows::core::PCWSTR(id.as_ptr())]))?;
            store.SetValue(&PKEY_AppUserModel_ID, &value)?;
            store.Commit()?;
            link.cast::<IPersistFile>()?.Save(&HSTRING::from(lnk.as_os_str()), true)
        })()
    };
    match made {
        Ok(()) => crate::log::info("identity: no identity, so a plain Start shortcut was written"),
        Err(e) => crate::log::warn(&format!("identity: could not write the Start shortcut: {e}")),
    }
}

// ── Velopack's hooks (velo.rs) ──

pub fn on_install() {
    let (Some(dir), Some(_)) = (install_dir(), id()) else { return };
    if let Err(e) = register(&dir) {
        crate::log::warn(&format!("identity: install: registration failed ({e}); running without it"));
        ensure_plain_lnk(&dir);
    }
}

pub fn on_updated() {
    let (Some(dir), Some(id)) = (install_dir(), id()) else { return };
    if registered(&id).is_some_and(|(_, v)| v >= id.version) {
        return;
    }
    if let Err(e) = register(&dir) {
        crate::log::warn(&format!("identity: update: registration failed ({e})"));
    }
}

pub fn on_uninstall() {
    let Some(id) = id() else { return };
    if let Err(e) = unregister(&id) {
        crate::log::warn(&format!("identity: uninstall: could not remove the package ({e})"));
    }
}

/// Each start of an installed release build. Blocking (COM, deployment calls): run it off the
/// main thread.
pub fn on_start() {
    let (Some(dir), Some(id)) = (install_dir(), id()) else { return };
    let root = dir.parent().map(Path::to_path_buf).unwrap_or_else(|| dir.clone());
    let reg = registered(&id);
    if has_identity() {
        crate::log::info(&format!("identity: running as {} {:?}", id.name, reg.as_ref().map(|r| r.1)));
        remove_start_lnk(&root);
        if reg.is_some_and(|(_, v)| v < id.version) {
            if let Err(e) = register(&dir) {
                crate::log::warn(&format!("identity: re-registration failed ({e})"));
            }
        }
        return;
    }
    if reg.is_some_and(|(_, v)| v >= id.version) {
        // Registered, yet this process has none: a path or manifest mismatch. Do not loop.
        crate::log::warn("identity: the package is registered but this process has no identity");
        ensure_plain_lnk(&dir);
        return;
    }
    match register(&dir) {
        Ok(()) => crate::log::info("identity: registered; it takes effect at the next start"),
        Err(e) => {
            crate::log::warn(&format!("identity: registration failed ({e}); running without it"));
            ensure_plain_lnk(&dir);
        }
    }
}
