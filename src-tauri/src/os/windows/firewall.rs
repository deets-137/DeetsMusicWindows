//! The firewall (OS-LAYER.md §11.1, from airplay.rs).

/// Let this exe receive UDP: the AirPlay speaker sends timing requests we did not ask for, and
/// without an inbound rule Windows drops them and the connect stalls. Adding a rule needs
/// elevation, so this asks once through UAC via `netsh` (AIRPLAY.md §4).
#[cfg_attr(debug_assertions, allow(dead_code))] // a dev build never prompts (airplay.rs)
pub fn allow_inbound_udp() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let args = format!(
        "advfirewall firewall add rule name=\"DeetsMusic\" dir=in action=allow protocol=udp enable=yes program=\"{}\"",
        exe.display()
    );
    let cmd = format!("Start-Process -FilePath netsh -Verb RunAs -WindowStyle Hidden -ArgumentList '{}'", args.replace('\'', "''"));
    super::hidden(&mut std::process::Command::new("powershell"))
        .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &cmd])
        .status()
        .map_err(|e| format!("powershell: {e}"))?;
    Ok(())
}
