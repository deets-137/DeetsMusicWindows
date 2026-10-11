//! `deetsmeter sessions` — which process is playing, on the default output.
//!
//! Lists every audio session with its process (pid, exe, whether it is in the given app's
//! process tree), its state and Windows' own peak meter for it, sampled a few times. The
//! meter is one number per sample that Windows already keeps for the volume mixer; no audio
//! is read or kept. Found 2026-10-10: DeetsMusic's process tree carried only silence (−90 dBFS)
//! while its music played, so the tool must be able to find the process that plays.

use crate::win;
use windows::core::Interface;
use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
use windows::Win32::Media::Audio::{
    eConsole, eRender, AudioSessionStateActive, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
    MMDeviceEnumerator,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

pub fn run(tree_of: Option<&str>) -> i32 {
    let tree: Vec<u32> = match tree_of {
        Some(what) => {
            let what = win::expand_env(what);
            let mut t = Vec::new();
            for p in win::find_pids(&what) {
                t.extend(win::tree(p));
            }
            t
        }
        None => Vec::new(),
    };
    let names: std::collections::HashMap<u32, String> = win::processes().into_iter().map(|(p, _, n)| (p, n)).collect();
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let r: windows::core::Result<()> = (|| {
            let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let dev = en.GetDefaultAudioEndpoint(eRender, eConsole)?;
            let mgr: IAudioSessionManager2 = dev.Activate(CLSCTX_ALL, None)?;
            let list = mgr.GetSessionEnumerator()?;
            let n = list.GetCount()?;
            println!("deetsmeter sessions — default output, {n} session(s); peak = Windows' own meter, 5 samples over 1 s");
            let mut rows = Vec::new();
            for i in 0..n {
                let s = list.GetSession(i)?;
                let s2: IAudioSessionControl2 = s.cast()?;
                let pid = s2.GetProcessId().unwrap_or(0);
                let active = s.GetState().map(|st| st == AudioSessionStateActive).unwrap_or(false);
                let meter: Option<IAudioMeterInformation> = s.cast().ok();
                rows.push((pid, active, meter));
            }
            let mut peaks = vec![0f32; rows.len()];
            for _ in 0..5 {
                for (k, (_, _, m)) in rows.iter().enumerate() {
                    if let Some(m) = m {
                        peaks[k] = peaks[k].max(m.GetPeakValue().unwrap_or(0.0));
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
            for (k, (pid, active, _)) in rows.iter().enumerate() {
                let db = if peaks[k] > 0.0 { format!("{:6.1} dBFS", 20.0 * peaks[k].log10()) } else { "  silent  ".into() };
                let exe = names.get(pid).cloned().unwrap_or_else(|| if *pid == 0 { "(system sounds)".into() } else { "?".into() });
                let mark = if tree.contains(pid) { "  ← in the app's tree" } else { "" };
                println!("  pid {pid:>6}  {:<8} {db}  {exe}{mark}", if *active { "active" } else { "inactive" });
            }
            Ok(())
        })();
        if let Err(e) = r {
            eprintln!("[deetsmeter] sessions: {e}");
            return 2;
        }
    }
    0
}
