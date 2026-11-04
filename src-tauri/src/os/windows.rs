//! The Windows file of the OS layer (docs/architecture/OS-LAYER.md §11). Today's Windows code,
//! moved here from its callers in step 3, one sub-module per edge under `os/windows/`.
//! Inside this file `windows::` is the `windows` crate.

use super::OsCaps;

pub mod app_icon;
pub mod audio_out;
pub mod autostart;
pub mod dialog;
pub mod discord;
pub mod display;
pub mod firewall;
pub mod gpu;
pub mod identity;
pub mod media_session;
pub mod net;
pub mod process;
pub mod secrets;
pub mod speaker;
pub mod system;
pub mod system_media;
pub mod window;

/// Windows does every edge.
pub const CAPS: OsCaps = OsCaps {
    media_session: true,
    system_media: true,
    audio_out: true,
    discord: true,
    secrets: true,
    ping: true,
    autostart: true,
    process: true,
    firewall: true,
    window: true,
    identity: true,
    app_icon: true,
    gpu: true,
    display_hz: true,
    airplay_sender: true,
    route_picker: false,
};

/// A child process with no console window (`CREATE_NO_WINDOW`).
fn hidden(cmd: &mut std::process::Command) -> &mut std::process::Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW)
}

/// `reg.exe` with `args`, hidden; its standard output. Spawns and waits: never on the UI thread.
fn reg(args: &[&str]) -> Result<String, String> {
    let out = hidden(&mut std::process::Command::new("reg")).args(args).output().map_err(|e| format!("reg.exe: {e}"))?;
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}
