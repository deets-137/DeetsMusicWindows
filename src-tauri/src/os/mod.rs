//! The OS layer (docs/architecture/OS-LAYER.md §3, §11): every call into the operating system
//! that has no meaning on another OS as written. Nothing about songs, the library or rules.
//!
//! One file per OS, picked here by `cfg`. Each OS file has the same free functions with the same
//! signatures (his call F2), so a function one OS lacks fails that OS's build. A trait only where
//! there is state. The callers call `os::…` and hold no `cfg` of their own; the check in
//! `scripts/docs-check.mjs` fails Windows code anywhere else in `src-tauri/src`.
//!
//! The module is named `windows`, like the `windows` crate. Here it is always `self::windows`,
//! so the two never mix.
//!
//! macOS and Linux are stubs (step 5): `macos.rs` and `linux.rs` re-export `stub.rs`, one edge
//! at a time until each is built.
//!
//! The OS is picked by `os_windows` / `os_macos` / `os_linux`, not by `cfg(windows)`: build.rs
//! sets the one for the target, and `DEETS_STUB_OS=macos` (or `linux`) sets that one instead on
//! any machine, so `cargo check` on Windows builds the whole app against the Mac's file
//! (`npm run check:os`). The Windows crates are still in that build; nothing calls them.

#[cfg(os_windows)]
mod windows;
#[cfg(os_windows)]
use self::windows as imp;

#[cfg(any(os_macos, os_linux))]
mod stub;
#[cfg(os_macos)]
mod macos;
#[cfg(os_macos)]
use self::macos as imp;
#[cfg(os_linux)]
mod linux;
#[cfg(os_linux)]
use self::linux as imp;

/// The edges, one module each (§11.1). Every OS file has each one, with the same signatures.
pub use imp::{app_icon, audio_out, autostart, dialog, display, gpu, identity, media_session, net, process, secrets, system, system_media, window};
/// Play on a speaker (§11.7): the AirPlay sender's state, its hooks and its commands on Windows;
/// the same names, with no sender, on a stub.
pub use imp::speaker;
pub use imp::discord::DiscordPipe;
#[allow(unused_imports)] // a release build only (airplay.rs)
pub use imp::firewall;

/// Discord's local socket, one per connection (the one edge with state, so a trait: his call F2).
/// Every call has a deadline; `Ok(None)` = the deadline passed and the call was cancelled.
/// Dropping the value closes the socket.
pub trait DiscordIpc: Sized {
    /// Open socket number `n` (Discord takes the first free one, 0 to 9). A busy socket may take
    /// up to `wait_ms` to free. An error that starts with `event: ` is a fault of this process,
    /// not of that socket: the caller stops trying the other numbers.
    fn open(n: u32, wait_ms: u32) -> Result<Self, String>;
    /// Write `bytes`; the count written.
    fn write(&self, bytes: &[u8], ms: u32) -> Result<Option<usize>, String>;
    /// Read into `buf`; the count read. `Some(0)` = Discord closed the socket.
    fn read(&self, buf: &mut [u8], ms: u32) -> Result<Option<usize>, String>;
}

/// The output the music plays to, and its master volume (`audio_out`; sound.ts reads it as
/// `SoundOutput`).
#[derive(Clone, Debug, Default, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutput {
    /// `<os>:<device id>` — the per-output preset key (`win:<endpoint id>` on Windows).
    pub key: String,
    pub name: String,
    /// speakers | headphones | headset | unknown
    pub kind: String,
    /// The OS volume slider, 0..1.
    pub volume: f32,
    /// The attenuation that slider applies, in dB (0 at the top).
    pub volume_db: f32,
    pub muted: bool,
}

/// A transport button sent to another app's media session (`system_media`).
#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Transport {
    Previous,
    PlayPause,
    Next,
}

/// The tray's view of the OS media session (`system_media`). `present == false` means no app has
/// registered one (or the only one is DeetsMusic's own WebView2).
#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WinNowPlaying {
    pub present: bool,
    pub playing: bool,
    pub title: String,
    pub artist: String,
    pub album: String,
    /// Source app's AUMID (e.g. `Spotify.exe`, `MSEdge`). The UI turns it into a label.
    pub app_id: String,
    pub position_secs: f64,
    pub duration_secs: f64,
    pub can_seek: bool,
    /// Thumbnail as a data: URL, or absent when the app offers none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub art_data_url: Option<String>,
}

/// The OS master volume (`system_media`).
#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemVolume {
    pub level: f32, // 0..1 scalar
    pub muted: bool,
}

/// What this OS can do: one `bool` per edge (§11.1). Windows: all true. A stub OS: all false.
/// The page will read it through an `os_caps` command, added with the first page code that hides
/// a control on it (his call, 2026-11-03).
#[allow(dead_code)] // the fields are read by the page, through `os_caps` (§11.2)
#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OsCaps {
    /// Our own media session: media keys and the system overlay (`media_session`).
    pub media_session: bool,
    /// Other apps' media session and the master volume: the tray panel's fallback (`system_media`).
    pub system_media: bool,
    /// The output device and its change notices (`audio_out`).
    pub audio_out: bool,
    /// Discord Rich Presence over Discord's local socket (`DiscordPipe`).
    pub discord: bool,
    /// Secrets sealed for this user account (`secrets`).
    pub secrets: bool,
    /// The ICMP ping in the network panel (`net`).
    pub ping: bool,
    /// Start with the OS (`autostart`).
    pub autostart: bool,
    /// List, wait for and end processes: the updater and Beta hooks (`process`).
    pub process: bool,
    /// The one-time firewall prompt for the AirPlay sender (`firewall`).
    pub firewall: bool,
    /// Window details: un-snap, show minimized, the browser keys off (`window`).
    pub window: bool,
    /// Package identity for exact-size taskbar and Start icons (`identity`).
    pub identity: bool,
    /// Per-DPI icon frames for the windows and the tray (`app_icon`).
    pub app_icon: bool,
    /// The web view's GPU process watch and the graphics card test (`gpu`).
    pub gpu: bool,
    /// The monitor's refresh rate (`display`).
    pub display_hz: bool,
    /// Our own AirPlay sender plays on a speaker (`speaker`; Windows, later Linux).
    pub airplay_sender: bool,
    /// The OS's own speaker picker plays on a speaker (`speaker`; the Mac's `AVRoutePickerView`,
    /// his call §1.3, not built yet).
    pub route_picker: bool,
}

/// What this OS can do.
#[allow(dead_code)] // read by the `os_caps` command, which comes with its first page user (§11.2)
pub fn caps() -> OsCaps {
    imp::CAPS
}
