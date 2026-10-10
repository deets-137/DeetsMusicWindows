//! deetsmeter — the outside-in measuring tool (docs/ideas/music-app-comp.md §17).
//!
//!   deetsmeter calibrate [--rounds 30] [--out <dir>]   the floor and the cadence of the method
//!   deetsmeter run <steps.json> [--out <dir>]          do the steps, record the events
//!   deetsmeter find <exe name | full path>              the app's windows and their frames
//!
//! The sensor launches the app, places its window, sends input, and reads the screen, all on
//! one QPC clock. It judges nothing; scripts/compare/ does.

mod calibrate;
mod clock;
mod events;
mod input;
mod pngout;
mod run;
mod screen;
mod win;

use std::path::PathBuf;
use windows::Win32::Foundation::FILETIME;
use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};
use windows::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};

static WALL0: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

/// This process's CPU time over its wall time, as % of one core.
pub fn self_cpu_pct() -> f64 {
    let ft = |f: FILETIME| ((f.dwHighDateTime as u64) << 32 | f.dwLowDateTime as u64) as f64 / 10_000.0;
    let (mut c, mut e, mut k, mut u) = (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
    unsafe {
        if GetProcessTimes(GetCurrentProcess(), &mut c, &mut e, &mut k, &mut u).is_err() {
            return f64::NAN;
        }
    }
    let wall = WALL0.get().map(|t| t.elapsed().as_secs_f64() * 1000.0).unwrap_or(f64::NAN);
    (ft(k) + ft(u)) / wall * 100.0
}

fn default_out() -> PathBuf {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    PathBuf::from("deetsmeter-runs").join(secs.to_string())
}

fn usage() -> i32 {
    eprintln!("usage:\n  deetsmeter calibrate [--rounds 30] [--out <dir>]\n  deetsmeter run <steps.json> [--out <dir>]\n  deetsmeter find <exe name | full path>");
    2
}

fn main() {
    WALL0.get_or_init(std::time::Instant::now);
    clock::start();
    // Physical pixels everywhere; Desktop Duplication also asks for a DPI-aware process.
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
    let args: Vec<String> = std::env::args().skip(1).collect();
    let opt = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    let code = match args.first().map(String::as_str) {
        Some("calibrate") => {
            let rounds = opt("--rounds").and_then(|s| s.parse().ok()).unwrap_or(30);
            let out = opt("--out").map(PathBuf::from);
            calibrate::run(rounds, out.as_deref())
        }
        Some("run") => match args.get(1).filter(|a| !a.starts_with("--")) {
            Some(file) => run::run(&PathBuf::from(file), &opt("--out").map(PathBuf::from).unwrap_or_else(default_out)),
            None => usage(),
        },
        Some("find") => match args.get(1) {
            Some(what) => {
                let pids = win::find_pids(what);
                if pids.is_empty() {
                    eprintln!("no process matches {what}");
                    1
                } else {
                    let mut all = Vec::new();
                    for p in &pids {
                        all.extend(win::tree(*p));
                    }
                    all.sort();
                    all.dedup();
                    println!("pids {pids:?}");
                    for w in win::windows_of(&all) {
                        let f = w.frame;
                        println!("  pid {:>6}  frame [{}, {}, {}, {}]  {}", w.pid, f.x, f.y, f.w, f.h, w.title);
                    }
                    0
                }
            }
            None => usage(),
        },
        _ => usage(),
    };
    std::process::exit(code);
}
