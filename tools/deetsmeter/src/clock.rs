//! One clock for every event: QueryPerformanceCounter, in µs from the start of the run.
//! Desktop Duplication's `LastPresentTime` is a QPC value too, so a frame's time and an
//! input's time need no sync (music-app-comp.md §17.1).

use std::sync::OnceLock;
use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};

struct Base {
    t0: i64,
    freq: i64,
}

static BASE: OnceLock<Base> = OnceLock::new();

fn raw() -> i64 {
    let mut v = 0i64;
    unsafe { QueryPerformanceCounter(&mut v).ok() };
    v
}

/// Fix the zero of the run. Called once, first thing in main.
pub fn start() {
    let mut freq = 0i64;
    unsafe { QueryPerformanceFrequency(&mut freq).ok() };
    let _ = BASE.set(Base { t0: raw(), freq });
}

/// A raw QPC value as µs from the start of the run.
pub fn from_qpc(qpc: i64) -> i64 {
    let b = BASE.get().expect("clock::start first");
    ((qpc - b.t0) as i128 * 1_000_000 / b.freq as i128) as i64
}

/// A QPC value given in 100 ns units (WASAPI's `pu64QPCPosition`) as µs from the start.
pub fn from_100ns(v: i64) -> i64 {
    let b = BASE.get().expect("clock::start first");
    from_qpc((v as i128 * b.freq as i128 / 10_000_000) as i64)
}

/// Now, in µs from the start of the run.
pub fn now() -> i64 {
    from_qpc(raw())
}

pub fn freq() -> i64 {
    BASE.get().map(|b| b.freq).unwrap_or(0)
}

/// Sleep, then spin the last stretch: `thread::sleep` alone overshoots by up to a timer tick.
pub fn sleep_us(us: i64) {
    let until = now() + us;
    if us > 2_000 {
        std::thread::sleep(std::time::Duration::from_micros((us - 1_500) as u64));
    }
    while now() < until {
        std::hint::spin_loop();
    }
}
