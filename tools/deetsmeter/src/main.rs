//! deetsmeter — the outside-in measuring tool (docs/ideas/music-app-comp.md §17).
//!
//!   deetsmeter calibrate [--rounds 30] [--size WxH] [--probes] [--out <dir>]
//!                                                      the floor and the cadence of the screen method
//!   deetsmeter calibrate-sound [--rounds 10] [--method meter|loopback]
//!                                                      the floor of the sound method (quiet blips)
//!   deetsmeter run <steps.json> [--out <dir>]          do the steps, record the events
//!   deetsmeter find <exe name | full path>             the app's windows and their frames
//!   deetsmeter sessions [<exe name | full path>]       which process plays, on the default output
//!   deetsmeter uia <exe name | full path>              the app's buttons, to write a profile from
//!   deetsmeter monitors                                the monitors, in physical pixels
//!
//! The sensor launches the app, places its window, presses its buttons, and reads the screen
//! and the sound, all on one QPC clock. It judges nothing; scripts/compare/ does.

mod audio;
mod calibrate;
mod calsound;
mod clock;
mod events;
mod input;
mod pngout;
mod run;
mod screen;
mod sessions;
mod uia;
mod win;

use std::path::PathBuf;
use windows::Win32::Foundation::FILETIME;
use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};
use windows::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};

static WALL0: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

/// This process's CPU time so far (kernel + user), in ms.
pub fn self_cpu_ms() -> f64 {
    let ft = |f: FILETIME| ((f.dwHighDateTime as u64) << 32 | f.dwLowDateTime as u64) as f64 / 10_000.0;
    let (mut c, mut e, mut k, mut u) = (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
    unsafe {
        if GetProcessTimes(GetCurrentProcess(), &mut c, &mut e, &mut k, &mut u).is_err() {
            return f64::NAN;
        }
    }
    ft(k) + ft(u)
}

/// This process's CPU time over its wall time, as % of one core.
pub fn self_cpu_pct() -> f64 {
    let wall = WALL0.get().map(|t| t.elapsed().as_secs_f64() * 1000.0).unwrap_or(f64::NAN);
    self_cpu_ms() / wall * 100.0
}

fn default_out() -> PathBuf {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    PathBuf::from("deetsmeter-runs").join(secs.to_string())
}

fn usage() -> i32 {
    eprintln!(
        "usage:\n  deetsmeter calibrate [--rounds 30] [--size WxH] [--probes] [--out <dir>]\n  deetsmeter calibrate-sound [--rounds 10] [--method meter|loopback] [--out <dir>]\n  deetsmeter run <steps.json> [--out <dir>]\n  deetsmeter find <exe name | full path>\n  deetsmeter sessions [<exe name | full path>]\n  deetsmeter uia <exe name | full path>\n  deetsmeter monitors"
    );
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
            let size = opt("--size").and_then(|s| {
                let (w, h) = s.split_once(['x', 'X'])?;
                Some((w.parse().ok()?, h.parse().ok()?))
            });
            calibrate::run(calibrate::Opts { rounds, size, probes: args.iter().any(|a| a == "--probes") }, out.as_deref())
        }
        Some("calibrate-sound") => {
            let rounds = opt("--rounds").and_then(|s| s.parse().ok()).unwrap_or(10);
            let method = match opt("--method").as_deref() {
                None => audio::Method::Meter,
                Some(s) => match audio::Method::parse(s) {
                    Some(m) => m,
                    None => std::process::exit(usage()),
                },
            };
            calsound::run(rounds, method, opt("--out").map(PathBuf::from).as_deref())
        }
        Some("run") => match args.get(1).filter(|a| !a.starts_with("--")) {
            Some(file) => run::run(&PathBuf::from(file), &opt("--out").map(PathBuf::from).unwrap_or_else(default_out)),
            None => usage(),
        },
        Some("find") => match args.get(1) {
            Some(what) => {
                let pids = win::find_pids(&win::expand_env(what));
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
                    if args.iter().any(|a| a == "--all") {
                        // Every top-level window, whatever its state: why a window is not found.
                        for line in win::debug_windows(&all) {
                            println!("{line}");
                        }
                    } else {
                        for w in win::windows_of(&all) {
                            let f = w.frame;
                            println!("  pid {:>6}  frame [{}, {}, {}, {}]  {}", w.pid, f.x, f.y, f.w, f.h, w.title);
                        }
                    }
                    0
                }
            }
            None => usage(),
        },
        Some("sessions") => sessions::run(args.get(1).map(String::as_str)),
        Some("uia") => match args.get(1) {
            Some(what) => uia::list(what),
            None => usage(),
        },
        Some("monitors") => {
            for m in win::monitors() {
                let (f, w) = (m.full, m.work);
                let primary = if m.primary { "  primary" } else { "" };
                println!("  {}  full [{}, {}, {}, {}]  work [{}, {}, {}, {}]{primary}", m.name, f.x, f.y, f.w, f.h, w.x, w.y, w.w, w.h);
            }
            0
        }
        _ => usage(),
    };
    std::process::exit(code);
}
