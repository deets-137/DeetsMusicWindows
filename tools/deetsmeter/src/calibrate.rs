//! `deetsmeter calibrate` — the floor of the method (music-app-comp.md §17.4).
//!
//! The tool opens its own small window and clicks it. The window flips between two greys on the
//! press, with no other work. Phase 1: click → first changed frame, N times, at a spacing
//! that does not sit on the refresh, so the result spans the whole vsync phase. That is the
//! FLOOR: any app's input → first change includes it. Phase 2: the window flips once per
//! composition (`DwmFlush`) for 2 s; the sensor must see ~one change per refresh. Fewer, or
//! frames with `AccumulatedFrames > 1`, means the sensor falls behind DWM on this PC.

use crate::clock;
use crate::events::Events;
use crate::input;
use crate::screen::{self, Rect, Watch};
use serde_json::json;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::Duration;
use windows::core::w;
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::DwmFlush;
use windows::Win32::Graphics::Gdi::{
    BeginPaint, CreateSolidBrush, DeleteObject, EndPaint, FillRect, GetDC, ReleaseDC, HDC, PAINTSTRUCT,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetClientRect, GetMessageW, PostMessageW,
    PostQuitMessage, RegisterClassW, TranslateMessage, CS_HREDRAW, CS_VREDRAW, MSG, WM_APP, WM_CLOSE, WM_DESTROY,
    WM_LBUTTONDOWN, WM_PAINT, WNDCLASSW, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP, WS_VISIBLE,
};

static WHITE: AtomicBool = AtomicBool::new(false);
const WIN: Rect = Rect { x: 200, y: 200, w: 480, h: 320 };

/// The options of a calibrate run. `size` and `probes` make it the sensor's own load test:
/// a window that big, flipping every composition, with or without probes (§17.9).
pub struct Opts {
    pub rounds: u32,
    pub size: Option<(i32, i32)>,
    pub probes: bool,
}

unsafe fn fill(hwnd: HWND, hdc: HDC) {
    let mut r = RECT::default();
    let _ = GetClientRect(hwnd, &mut r);
    // Two dark greys, not black and white: the spin flips every composition, and a large
    // black/white strobe is hard on the eyes. 40 luma apart: well over the probe threshold.
    let c = if WHITE.load(Ordering::SeqCst) { 0x0058_5858 } else { 0x0030_3030 };
    let b = CreateSolidBrush(COLORREF(c));
    FillRect(hdc, &r, b);
    let _ = DeleteObject(b.into());
}

unsafe fn flip(hwnd: HWND) {
    WHITE.fetch_xor(true, Ordering::SeqCst);
    let hdc = GetDC(Some(hwnd));
    fill(hwnd, hdc);
    ReleaseDC(Some(hwnd), hdc);
}

unsafe extern "system" fn proc_(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    match msg {
        WM_LBUTTONDOWN => {
            flip(hwnd);
            LRESULT(0)
        }
        WM_APP => {
            // Flip once per composition for lp ms.
            let until = clock::now() + lp.0 as i64 * 1000;
            while clock::now() < until {
                flip(hwnd);
                let _ = DwmFlush();
            }
            LRESULT(0)
        }
        WM_PAINT => {
            let mut ps = PAINTSTRUCT::default();
            let hdc = BeginPaint(hwnd, &mut ps);
            fill(hwnd, hdc);
            let _ = EndPaint(hwnd, &ps);
            LRESULT(0)
        }
        WM_CLOSE => {
            let _ = DestroyWindow(hwnd);
            LRESULT(0)
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wp, lp),
    }
}

fn window_thread(tx: mpsc::Sender<isize>, win: Rect) {
    unsafe {
        let inst = GetModuleHandleW(None).unwrap_or_default();
        let wc = WNDCLASSW {
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(proc_),
            hInstance: inst.into(),
            lpszClassName: w!("deetsmeter-calibrate"),
            ..Default::default()
        };
        RegisterClassW(&wc);
        let hwnd = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
            w!("deetsmeter-calibrate"),
            w!("deetsmeter calibrate"),
            WS_POPUP | WS_VISIBLE,
            win.x,
            win.y,
            win.w,
            win.h,
            None,
            None,
            Some(inst.into()),
            None,
        );
        let Ok(hwnd) = hwnd else {
            let _ = tx.send(0);
            return;
        };
        let _ = tx.send(hwnd.0 as isize);
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

fn pct(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return f64::NAN;
    }
    let i = ((sorted.len() - 1) as f64 * p).round() as usize;
    sorted[i]
}

pub fn run(o: Opts, out: Option<&Path>) -> i32 {
    let rounds = o.rounds;
    let win = match o.size {
        Some((w, h)) => Rect { x: WIN.x, y: WIN.y, w, h },
        None => WIN,
    };
    let events = std::sync::Arc::new(Events::new());
    let watch = Watch::new();
    let (tx, rx) = mpsc::channel();
    let wt = std::thread::spawn(move || window_thread(tx, win));
    let raw = rx.recv().unwrap_or(0);
    if raw == 0 {
        eprintln!("[deetsmeter] could not open the calibrate window");
        return 2;
    }
    let hwnd = HWND(raw as *mut _);
    std::thread::sleep(Duration::from_millis(200));
    let region = crate::win::frame(hwnd).unwrap_or(win);
    if o.probes {
        // Two probes, as a scene would have: a list-sized one and a button-sized one.
        *watch.probes.lock().unwrap() = vec![
            screen::Probe { name: "big".into(), r: Rect { x: region.x + region.w / 4, y: region.y + region.h / 4, w: region.w / 3, h: region.h / 3 } },
            screen::Probe { name: "small".into(), r: Rect { x: region.x + 20, y: region.y + 20, w: 40, h: 40 } },
        ];
    }
    watch.set_region(region);
    let cap = screen::spawn(watch.clone(), events.clone());

    let close = |code: i32| {
        watch.stop.store(true, Ordering::SeqCst);
        unsafe {
            let _ = PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0));
        }
        code
    };

    if !watch.wait_baseline(i64::MIN, 3000) {
        eprintln!("[deetsmeter] the screen capture gave no frame in 3 s (Desktop Duplication blocked here?)");
        for e in events.snapshot().iter().filter(|e| e["ev"] == "screen-error") {
            eprintln!("  {e}");
        }
        let code = close(3);
        let _ = cap.join();
        let _ = wt.join();
        return code;
    }
    let hz = watch.hz.load(Ordering::SeqCst);
    let period_ms = if hz > 0 { 1000.0 / hz as f64 } else { f64::NAN };

    let (ctx, crx) = mpsc::channel::<i64>();
    *watch.change_tx.lock().unwrap() = Some(ctx);
    let (cx, cy) = (region.x + region.w / 2, region.y + region.h / 2);
    input::move_to(cx, cy);
    std::thread::sleep(Duration::from_millis(250));

    // Phase 1: the floor.
    let mut lat = Vec::new();
    let mut missed = 0;
    for i in 0..rounds {
        // Back on the window each round: a hand on the mouse must not send a click elsewhere
        // (the first run on 2026-10-10 lost 11 of 30 rounds that way).
        input::move_to(cx, cy);
        std::thread::sleep(Duration::from_millis(20));
        while crx.try_recv().is_ok() {}
        let t = clock::now();
        input::click(false);
        events.push(t, "input", json!({ "kind": "click", "round": i }));
        match crx.recv_timeout(Duration::from_millis(500)) {
            Ok(tc) => lat.push((tc - t) as f64 / 1000.0),
            Err(_) => missed += 1,
        }
        // 60–99 ms apart, stepped by 17 ms: the click lands at a new point of the refresh.
        std::thread::sleep(Duration::from_millis(60 + (i as u64 * 17) % 40));
    }
    lat.sort_by(|a, b| a.partial_cmp(b).unwrap());

    // Phase 2: the cadence.
    std::thread::sleep(Duration::from_millis(200));
    while crx.try_recv().is_ok() {}
    let spin_ms = 2000i64;
    let t0 = clock::now();
    events.push(t0, "mark", json!({ "name": "cadence" }));
    unsafe {
        let _ = PostMessageW(Some(hwnd), WM_APP, WPARAM(0), LPARAM(spin_ms as isize));
    }
    let mut times = Vec::new();
    let cpu0 = watch.cpu_us.load(Ordering::SeqCst);
    let mut spin_cpu_pct = f64::NAN;
    while clock::now() < t0 + spin_ms * 1000 + 300_000 {
        if let Ok(t) = crx.recv_timeout(Duration::from_millis(50)) {
            times.push(t);
        }
        if spin_cpu_pct.is_nan() && clock::now() >= t0 + spin_ms * 1000 {
            // The capture thread's own CPU over the spin: the sensor's cost under full load.
            let cpu1 = watch.cpu_us.load(Ordering::SeqCst);
            spin_cpu_pct = (cpu1.saturating_sub(cpu0)) as f64 / ((clock::now() - t0) as f64) * 100.0;
        }
    }
    // Judge the middle 1.5 s, away from the start and the end of the spin.
    //
    // The test window cannot promise one flip per composition (GDI + DwmFlush sometimes
    // lands two flips in one, which reads as "no change"). So the sensor is judged on what
    // it can be blamed for: every composition that touched the region is a frame event, and
    // `AccumulatedFrames > 1` is a composition the sensor did not see. `changes/s` is printed
    // as the test window's own rate, for reference.
    let (a, b) = (t0 + 250_000, t0 + 1_750_000);
    let changes = times.iter().filter(|t| **t >= a && **t <= b).count() as f64 / 1.5;
    let snap = events.snapshot();
    let mut seen: Vec<i64> = snap
        .iter()
        .filter(|e| e["ev"] == "frame")
        .filter_map(|e| e["t"].as_i64())
        .filter(|t| *t >= a && *t <= b)
        .collect();
    seen.sort();
    let fps = seen.len() as f64 / 1.5;
    let long = seen.windows(2).filter(|w| (w[1] - w[0]) as f64 / 1000.0 > period_ms * 1.5).count();
    let acc_lost = snap
        .iter()
        .filter(|e| e["ev"] == "frame" && e["t"].as_i64().is_some_and(|t| t >= a && t <= b))
        .map(|e| e["acc"].as_u64().unwrap_or(1).saturating_sub(1))
        .sum::<u64>() as usize;
    let lost_pct = if seen.is_empty() { 100.0 } else { acc_lost as f64 / (seen.len() + acc_lost) as f64 * 100.0 };

    let code = close(0);
    let _ = cap.join();
    let _ = wt.join();
    let cpu = crate::self_cpu_pct();

    println!("deetsmeter calibrate — {} Hz (one refresh = {:.2} ms)", hz, period_ms);
    println!(
        "  floor  click → first change: median {:.2} ms · p90 {:.2} · min {:.2} · max {:.2}  ({} rounds, {} missed)",
        pct(&lat, 0.5),
        pct(&lat, 0.9),
        pct(&lat, 0.0),
        pct(&lat, 1.0),
        lat.len(),
        missed
    );
    println!(
        "  cadence  {:.0} compositions/s seen of {} Hz · gaps over 1.5 refresh: {} · compositions missed by the sensor: {} ({:.2} %) · test window {:.0} changes/s",
        fps, hz, long, acc_lost, lost_pct, changes
    );
    println!("  sensor cost  capture thread {spin_cpu_pct:.1} % of one core while the window flips every composition · whole process {cpu:.1} % over the run");
    let floor_ok = pct(&lat, 0.5) <= period_ms * 2.0 + 2.0;
    let sensor_ok = lost_pct <= 1.0;
    println!(
        "  verdict  floor {} · sensor {}",
        if floor_ok { "ok" } else { "HIGH (expected ≤ 2 refreshes)" },
        if sensor_ok { "keeps up with DWM" } else { "BEHIND DWM (over 1 % of compositions missed)" }
    );

    events.push(clock::now(), "calibrate", json!({
        "hz": hz,
        "floor_ms": { "median": pct(&lat, 0.5), "p90": pct(&lat, 0.9), "min": pct(&lat, 0.0), "max": pct(&lat, 1.0), "n": lat.len(), "missed": missed },
        "cadence": { "seen_per_s": fps, "long_gaps": long, "acc_lost": acc_lost, "lost_pct": lost_pct, "window_changes_per_s": changes },
        "self_cpu_pct": cpu,
        "capture_cpu_pct_spin": spin_cpu_pct,
    }));
    if let Some(dir) = out {
        let _ = std::fs::create_dir_all(dir);
        match events.write(&dir.join("events.jsonl")) {
            Ok(n) => println!("  wrote {n} events to {}", dir.join("events.jsonl").display()),
            Err(e) => eprintln!("[deetsmeter] could not write events: {e}"),
        }
    }
    if missed > rounds / 4 {
        return 4;
    }
    code
}
