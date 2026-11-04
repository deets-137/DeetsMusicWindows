//! The stub of the OS layer (docs/architecture/OS-LAYER.md §11, step 5): every edge with the same
//! signatures as `os/windows/`, and bodies that do nothing, return nothing or say "not on this
//! OS". `macos.rs` and `linux.rs` re-export it until each OS gets its own code, one edge at a
//! time. Its `CAPS` is all false, so the page can hide what the OS cannot do.
//!
//! The rule for a stub body: never pretend. A secret is never stored in the clear, a ping never
//! answers, a speaker never connects. Where a caller would wait or retry on an error, the stub
//! says so in the error text (the Discord socket starts its error with `event: `, which stops the
//! caller trying the other socket numbers).
//!
//! `DEETS_STUB_OS=macos cargo check` (or `linux`) builds the whole app against this file on
//! Windows (build.rs), so a signature that drifts from `os/windows/` fails there too.

#![allow(dead_code, unused_variables)]

/// A stub does no edge.
pub const CAPS: super::OsCaps = super::OsCaps {
    media_session: false,
    system_media: false,
    audio_out: false,
    discord: false,
    secrets: false,
    ping: false,
    autostart: false,
    process: false,
    firewall: false,
    window: false,
    identity: false,
    app_icon: false,
    gpu: false,
    display_hz: false,
    airplay_sender: false,
    route_picker: false,
};

/// "Not on this OS", with the edge's name, for the errors below.
fn none(edge: &str) -> String {
    format!("{edge}: not built for {} yet (OS-LAYER.md §11)", std::env::consts::OS)
}

pub mod app_icon {
    use tauri::{image::Image, AppHandle, Runtime, Window};
    /// The window keeps Tauri's own icon.
    pub fn set_window<R: Runtime>(win: &Window<R>) {}
    pub fn set_all<R: Runtime>(app: &AppHandle<R>) {}
    /// None: the tray keeps the icon Tauri gave it.
    pub fn tray_image() -> Option<Image<'static>> {
        None
    }
    pub fn watch_scale(app: &AppHandle) {}
}

pub mod audio_out {
    use super::super::AudioOutput;
    /// No output watch: the Sound panel shows no output name, and the per-output presets stay off.
    pub fn watch(on_read: impl FnMut(Option<AudioOutput>)) -> Result<(), String> {
        Err(super::none("audio_out"))
    }
}

pub mod autostart {
    /// Start with the OS: never on, and a change is refused.
    pub fn command(name: &str) -> Option<String> {
        None
    }
    pub fn set(name: &str, cmd: Option<&str>) -> Result<(), String> {
        Err(super::none("autostart"))
    }
}

pub mod dialog {
    /// No native box: the text goes to standard error, then the caller exits as on Windows.
    pub fn fatal(title: &str, text: &str) {
        eprintln!("{title}: {text}");
    }
}

pub mod discord {
    use super::super::DiscordIpc;
    /// No Discord socket. Never made: `open` always fails.
    pub struct DiscordPipe;
    impl DiscordIpc for DiscordPipe {
        fn open(n: u32, wait_ms: u32) -> Result<Self, String> {
            // `event: ` = a fault of this process, so the caller does not try sockets 1 to 9.
            Err(format!("event: {}", super::none("discord")))
        }
        fn write(&self, bytes: &[u8], ms: u32) -> Result<Option<usize>, String> {
            Err(super::none("discord"))
        }
        fn read(&self, buf: &mut [u8], ms: u32) -> Result<Option<usize>, String> {
            Err(super::none("discord"))
        }
    }
}

pub mod display {
    /// No monitor id and no refresh rate: the callers keep their defaults.
    pub fn monitor(win: &tauri::Window) -> Option<isize> {
        None
    }
    pub fn hz(win: &tauri::Window) -> Option<u32> {
        None
    }
}

pub mod firewall {
    /// No firewall prompt: only the Windows AirPlay sender needs one.
    pub fn allow_inbound_udp() -> Result<(), String> {
        Err(super::none("firewall"))
    }
}

pub mod gpu {
    use tauri::WebviewWindow;
    /// No GPU process watch.
    pub fn watch_process(win: &WebviewWindow, on_fail: impl Fn(i32, Option<i32>, bool) + Send + 'static) {}
    /// Not ready, no name: the page asks only after a software start, which is a Windows case, and
    /// "not ready" starts nothing.
    pub fn card_test() -> (bool, Option<String>) {
        (false, None)
    }
    pub fn watch_adapters(settle_ms: u32, on_settled: impl FnMut(u32)) -> Result<(), String> {
        Err(super::none("gpu"))
    }
}

pub mod identity {
    /// Package identity is a Windows idea (IDENTITY.md); the name stays so callers build.
    pub const MSIX: &str = "DeetsMusic.identity.msix";
    pub fn has_identity() -> bool {
        false
    }
    pub fn on_install() {}
    pub fn on_updated() {}
    pub fn on_uninstall() {}
    pub fn on_start() {}
}

pub mod media_session {
    use crate::bridge::NpState;
    use tauri::{AppHandle, WebviewWindow};
    /// No media session yet: no media keys and no system Now Playing (the Mac's is
    /// `MPNowPlayingInfoCenter`, QUEUE.md § Let go after a pause).
    pub fn init(app: AppHandle, win: &WebviewWindow) -> Result<(), String> {
        Err(super::none("media_session"))
    }
    pub fn update(s: &NpState) {}
}

pub mod net {
    use std::net::Ipv4Addr;
    /// No ping: the network panel shows the speed test only.
    pub fn ping(ip: Ipv4Addr, n: u32, timeout_ms: u32) -> Result<Vec<u32>, String> {
        Err(super::none("net"))
    }
}

pub mod process {
    use std::time::Duration;
    pub fn list() -> Vec<(u32, String)> {
        Vec::new()
    }
    pub fn kill(pid: u32) -> bool {
        false
    }
    /// Cannot see the process, so wait the whole limit: a caller that copies files after it
    /// (the Beta pull) must never start while the other app may still run.
    pub fn wait_for_exit(pid: u32, limit: Duration) {
        std::thread::sleep(limit);
    }
}

pub mod secrets {
    /// No sealed store: refuse, never store in the clear.
    pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
        Err(super::none("secrets"))
    }
    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
        Err(super::none("secrets"))
    }
}

pub mod system {
    /// The OS name only, for the start line.
    pub fn version() -> String {
        match std::env::consts::OS {
            "macos" => "macOS".into(),
            "linux" => "Linux".into(),
            os => os.into(),
        }
    }
}

pub mod system_media {
    use super::super::{SystemVolume, Transport, WinNowPlaying};
    /// No other app's session: the tray panel's fallback shows nothing.
    pub fn now_playing() -> WinNowPlaying {
        WinNowPlaying::default()
    }
    pub fn transport(t: Transport) -> bool {
        false
    }
    pub fn seek(secs: f64) -> bool {
        false
    }
    pub fn system_volume() -> SystemVolume {
        SystemVolume::default()
    }
    pub fn set_system_volume(level: f32) -> Result<SystemVolume, String> {
        Err(super::none("system_media"))
    }
    pub fn set_system_mute(muted: bool) -> Result<SystemVolume, String> {
        Err(super::none("system_media"))
    }
}

pub mod window {
    use tauri::WebviewWindow;
    /// Nothing is snapped on this OS.
    pub fn unsnap(w: &WebviewWindow) -> bool {
        false
    }
    /// Tauri's own minimize: the window goes down, as the tray launch wants.
    pub fn show_minimized(w: &WebviewWindow) {
        let _ = w.minimize();
    }
    pub fn browser_keys_off(w: &WebviewWindow) {}
}

/// Play on a speaker (OS-LAYER.md §11.7). No sender here: on a Mac the speaker is Apple's route
/// picker (his call §1.3), which is not built yet; on Linux the sender comes later (§8). The
/// commands keep their names, so the page's calls get an error, not a missing command.
pub mod speaker {
    use crate::bridge::NpState;
    use crate::settings::AirplaySpeaker;
    use tauri::AppHandle;

    /// Nothing to hold.
    #[derive(Default)]
    pub struct State;

    pub fn setup(app_data: &std::path::Path) {}
    pub fn held_speaker(app: &AppHandle) -> Option<AirplaySpeaker> {
        None
    }
    pub fn release(app: &AppHandle) {}
    pub fn prefs_changed(app: &AppHandle) {}
    pub fn shutdown(app: &AppHandle) {}
    pub fn on_np_state(app: &AppHandle, np: &NpState) {}

    #[tauri::command]
    pub async fn airplay_scan(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
        Err(super::none("speaker"))
    }
    #[tauri::command]
    pub async fn airplay_connect(app: AppHandle, speaker: AirplaySpeaker) -> Result<(), String> {
        Err(super::none("speaker"))
    }
    /// Nothing is connected, so there is nothing to drop.
    #[tauri::command]
    pub async fn airplay_disconnect(app: AppHandle) -> Result<(), String> {
        Ok(())
    }
    #[tauri::command]
    pub async fn airplay_status(app: AppHandle) -> Result<serde_json::Value, String> {
        Err(super::none("speaker"))
    }
    /// The page posts no tap while nothing is connected; one that comes is dropped.
    #[tauri::command]
    pub fn airplay_tap(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
        Ok(())
    }
    #[tauri::command]
    pub async fn airplay_volume(app: AppHandle, pct: f64) -> Result<(), String> {
        Err(super::none("speaker"))
    }
    #[tauri::command]
    pub async fn airplay_firewall_prompt(app: AppHandle) -> Result<(), String> {
        Err(super::none("speaker"))
    }
}
