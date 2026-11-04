//! The macOS file of the OS layer (docs/architecture/OS-LAYER.md §11, step 5). A stub today:
//! every edge comes from `stub.rs`. Each edge moves here as it is built for the Mac (the media
//! session as `MPNowPlayingInfoCenter`, the secrets in the Keychain, the speaker as Apple's route
//! picker, …), and its `CAPS` line turns true with it.

pub use super::stub::{
    app_icon, audio_out, autostart, dialog, discord, display, firewall, gpu, identity, media_session, net, process, secrets, speaker,
    system, system_media, window,
};

/// Nothing is built for the Mac yet.
pub const CAPS: super::OsCaps = super::stub::CAPS;
