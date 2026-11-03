//! Facts about the OS itself (OS-LAYER.md §11.1, from log.rs).

/// "Windows 11 24H2 build 26200.6584" — from the registry via `reg.exe`. Cheap, once at
/// startup; a part it cannot read is empty. For the log's start line.
pub fn version() -> String {
    const KEY: &str = r"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion";
    let value = |name: &str| -> String {
        super::reg(&["query", KEY, "/v", name])
            .ok()
            .and_then(|s| s.lines().find(|l| l.trim_start().starts_with(name)).map(|l| l.split_whitespace().last().unwrap_or("").to_string()))
            .unwrap_or_default()
    };
    let build = value("CurrentBuild");
    let ubr = value("UBR");
    let display = value("DisplayVersion");
    let ubr = u64::from_str_radix(ubr.trim_start_matches("0x"), 16).map(|n| n.to_string()).unwrap_or(ubr);
    let major = if build.parse::<u32>().map(|b| b >= 22000).unwrap_or(false) { "11" } else { "10" };
    format!("Windows {major} {display} build {build}.{ubr}")
}
