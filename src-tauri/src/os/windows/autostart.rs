//! Start with Windows (OS-LAYER.md §11.1, from settings.rs): one value under the user's Run
//! key, written through `reg.exe` (the DeetsAirplay / DeetsRGB pattern). Each call spawns
//! `reg.exe` and waits for it: call it off the UI thread.

const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";

/// The command registered under `name`, or None when there is no such value.
pub fn command(name: &str) -> Option<String> {
    let out = super::reg(&["query", RUN_KEY, "/v", name]).ok()?;
    let line = out.lines().map(str::trim_start).find(|l| l.starts_with(name))?;
    let (_, cmd) = line.split_once("REG_SZ")?;
    Some(cmd.trim().to_string())
}

/// Register `cmd` under `name`, or remove the value when `cmd` is None.
pub fn set(name: &str, cmd: Option<&str>) -> Result<(), String> {
    match cmd {
        Some(cmd) => super::reg(&["add", RUN_KEY, "/v", name, "/t", "REG_SZ", "/d", cmd, "/f"])?,
        None => super::reg(&["delete", RUN_KEY, "/v", name, "/f"])?,
    };
    Ok(())
}
