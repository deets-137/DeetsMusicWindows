//! Play on a speaker, on Windows (OS-LAYER.md §11.7): our own AirPlay sender. The sender is app
//! logic, not an edge (its sessions, the stall watch, the delay), so it stays in
//! `src-tauri/src/airplay.rs`; this file hands its names on, so the callers and `lib.rs` call
//! `os::speaker::…` on every OS. `airplay.rs` is built only where a sender exists (`os_windows`
//! today; Linux later, §8), the one `cfg` outside `os/`.

pub use crate::airplay::{held_speaker, on_np_state, prefs_changed, release, setup, shutdown, AirplayState as State};

// The commands, with the two hidden names `#[tauri::command]` makes for `generate_handler!`
// (`__cmd__…` and `__tauri_command_name_…`): a plain re-export of the function is not enough.
pub use crate::airplay::{
    __cmd__airplay_connect, __cmd__airplay_disconnect, __cmd__airplay_firewall_prompt, __cmd__airplay_scan, __cmd__airplay_status,
    __cmd__airplay_tap, __cmd__airplay_volume, __tauri_command_name_airplay_connect, __tauri_command_name_airplay_disconnect,
    __tauri_command_name_airplay_firewall_prompt, __tauri_command_name_airplay_scan, __tauri_command_name_airplay_status,
    __tauri_command_name_airplay_tap, __tauri_command_name_airplay_volume, airplay_connect, airplay_disconnect,
    airplay_firewall_prompt, airplay_scan, airplay_status, airplay_tap, airplay_volume,
};
