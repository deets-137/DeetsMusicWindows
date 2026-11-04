//! The Linux file of the OS layer (docs/architecture/OS-LAYER.md §8, §11 step 5). A stub today:
//! every edge comes from `stub.rs`. The Linux spec (§8) fills it: MPRIS for the media session, the
//! Secret Service for the secrets, PipeWire for the output, the AirPlay sender for the speaker.

pub use super::stub::{
    app_icon, audio_out, autostart, dialog, discord, display, firewall, gpu, identity, media_session, net, process, secrets, speaker,
    system, system_media, window,
};

/// Nothing is built for Linux yet.
pub const CAPS: super::OsCaps = super::stub::CAPS;
