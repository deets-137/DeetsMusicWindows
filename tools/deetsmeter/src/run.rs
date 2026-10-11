//! `deetsmeter run <steps.json>` — do the steps, record the events (music-app-comp.md §17.2).
//!
//! The run file names the app, the region and the probes (relative to the window's visible
//! frame), and the steps. Coordinates in steps are relative to the visible frame too, so one
//! file works wherever the window sits. The sensor judges nothing: the summary it prints is
//! a convenience; the events file is the record, and the judge (scripts/compare/) reads it.

use crate::clock;
use crate::events::Events;
use crate::input;
use crate::screen::{self, Probe, Rect, Watch};
use crate::win;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use windows::Win32::Foundation::HWND;

#[derive(Deserialize, Default)]
pub struct App {
    pub exe: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    pub aumid: Option<String>,
    pub attach: Option<String>,
}

#[derive(Deserialize)]
pub struct RunFile {
    #[serde(default)]
    pub app: App,
    /// [x, y, w, h] relative to the visible frame; default the whole frame.
    pub region: Option<[i32; 4]>,
    #[serde(default)]
    pub probes: BTreeMap<String, [i32; 4]>,
    /// A probe changes when one grid cell moves by at least this much (0–255 luma); default 16.
    pub probe_threshold: Option<u32>,
    pub steps: Vec<Step>,
}

#[derive(Deserialize, Clone)]
#[serde(tag = "do", rename_all = "snake_case")]
pub enum Step {
    Launch,
    Attach,
    /// `lift`: raise the window the moment it is found (a start: it may open under another
    /// window, and the frames from `shown` on must show the app).
    WaitWindow { timeout_ms: Option<u64>, lift: Option<bool> },
    /// Place the window so its visible frame is `rect` (desktop pixels), or keep it where it
    /// is; either way the region and probes are set from the frame and a baseline is taken.
    /// `on` names a monitor (`left`, `right`, `primary` or `\.DISPLAY2`): then `rect` is
    /// relative to that monitor's work area. The window is put back where it was when the run ends.
    Place { rect: Option<[i32; 4]>, on: Option<String> },
    Focus,
    Wait { ms: u64 },
    Mark { name: String },
    Move { at: [i32; 2] },
    Click { at: [i32; 2], right: Option<bool>, hover_ms: Option<u64>, keep: Option<u32>, tag: Option<String>, probe: Option<String> },
    Wheel { at: [i32; 2], delta: i32, count: Option<u32>, every_ms: Option<u64>, keep: Option<u32>, tag: Option<String>, probe: Option<String> },
    Drag { from: [i32; 2], to: [i32; 2], steps: Option<u32>, every_ms: Option<u64>, keep: Option<u32>, tag: Option<String>, probe: Option<String> },
    Key { key: String, keep: Option<u32>, tag: Option<String>, probe: Option<String> },
    Text { text: String, every_ms: Option<u64>, keep: Option<u32>, tag: Option<String>, probe: Option<String> },
    /// Wait until the region has not changed for `quiet_ms` (F15: 500 ms).
    /// `content: true` (with a probe): quiet counts only while the probe is NOT one flat
    /// colour. A start's blank window is quiet too (Apple's stayed black for over 2 s after
    /// it opened, and the plain settle ended there, 2026-10-10).
    Settle { quiet_ms: Option<u64>, timeout_ms: Option<u64>, probe: Option<String>, content: Option<bool> },
    /// Move the pointer off the window (right of the frame), so a hover cannot paint.
    /// Start hearing the app's own sound (process loopback, F14): the window's process and its
    /// children. Nothing is recorded: only the times sound starts and stops (audio.rs).
    /// `also` names more processes (exe names) whose trees the meter hears too: Apple's app
    /// plays from `AMPLibraryAgent.exe`, which is not its child (2026-10-10).
    Listen { threshold_db: Option<f64>, pid: Option<u32>, method: Option<String>, #[serde(default)] also: Vec<String> },
    /// Wait for sound to start after the last input.
    WaitSound { timeout_ms: Option<u64> },
    /// Press a button by its accessible name through UI Automation: no mouse, no focus
    /// (option A). `names` lists the names it may carry (a play button is "Play" or "Pause").
    /// `probe: "self"` times the change in the button's own rectangle.
    Invoke { names: Vec<String>, probe: Option<String>, keep: Option<u32>, tag: Option<String> },
    /// Keep the next frame, whatever it shows: a picture of the region now.
    Snap { tag: Option<String> },
    Park,
    Close,
    /// Wait until every process of the app's tree at the `close` has exited (`gone`). A
    /// window that only hid itself (DeetsMusic's Close to tray) times out.
    WaitGone { timeout_ms: Option<u64> },
}

struct State {
    pids: Vec<u32>,
    hwnd: Option<HWND>,
    frame: Option<Rect>,
    last_input: Option<i64>,
    win_pid: Option<u32>,
    listen: Option<crate::audio::Listen>,
    /// Where the window was before the first `place` moved it: put back at the end.
    restore: Option<windows::Win32::Foundation::RECT>,
    /// Where the pointer was before the first pointer step, and which window had the focus
    /// before the first `focus`: both put back at the end (his calls 2026-10-10: a real wheel
    /// and typed keys borrow the pointer and the focus, then return them).
    pointer_home: Option<(i32, i32)>,
    focus_home: Option<HWND>,
    /// The app's process tree at the `close`, for `wait_gone`.
    close_tree: Vec<u32>,
}

fn abs(st: &State, at: [i32; 2]) -> Option<(i32, i32)> {
    st.frame.map(|f| (f.x + at[0], f.y + at[1]))
}

/// A point relative to the frame, in desktop pixels, checked to land on the target window.
/// Input is never sent to a point another window covers (§17.5).
fn target(st: &State, at: [i32; 2]) -> Result<(i32, i32), String> {
    let hwnd = st.hwnd.ok_or("input needs a window (wait_window first)")?;
    let (x, y) = abs(st, at).ok_or("input needs a frame (place first)")?;
    match win::covered_at(hwnd, x, y) {
        Some(who) => Err(format!("input at ({x}, {y}) would land on {who}, not the app; nothing was sent")),
        None => Ok((x, y)),
    }
}

/// Keys go to the foreground window: refuse when it is another app.
fn keys_target(st: &State) -> Result<(), String> {
    let hwnd = st.hwnd.ok_or("keys need a window (wait_window first)")?;
    if win::is_foreground(hwnd) {
        Ok(())
    } else {
        Err("keys would go to another app (the target is not the foreground window; add a focus step); nothing was sent".into())
    }
}

pub fn run(file: &Path, out: &Path) -> i32 {
    let text = match std::fs::read_to_string(file) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[deetsmeter] cannot read {}: {e}", file.display());
            return 2;
        }
    };
    let rf: RunFile = match serde_json::from_str(&text) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[deetsmeter] {}: {e}", file.display());
            return 2;
        }
    };
    let events = Arc::new(Events::new());
    let watch = Watch::new();
    if let Some(th) = rf.probe_threshold {
        watch.probe_threshold.store(th, Ordering::SeqCst);
    }
    let cap = screen::spawn(watch.clone(), events.clone());
    events.push(clock::now(), "meta", json!({
        "tool": "deetsmeter",
        "version": env!("CARGO_PKG_VERSION"),
        "file": file.display().to_string(),
        "qpc_freq": clock::freq(),
    }));

    let mut st = State { pids: Vec::new(), hwnd: None, frame: None, last_input: None, win_pid: None, listen: None, restore: None, pointer_home: None, focus_home: None, close_tree: Vec::new() };
    let mut failed: Option<String> = None;
    for (i, step) in rf.steps.iter().enumerate() {
        if let Err(e) = do_step(i, step, &rf, &mut st, &watch, &events) {
            events.push(clock::now(), "step-failed", json!({ "step": i, "why": e }));
            failed = Some(format!("step {i}: {e}"));
            break;
        }
    }
    // Let the last frames land before stopping.
    std::thread::sleep(Duration::from_millis(100));
    st.listen = None; // stops the sound thread
    // Stop the capture BEFORE the window goes back: once it leaves, the region shows whatever
    // is behind it (a kept frame once showed the owner's terminal, 2026-10-10).
    watch.stop.store(true, Ordering::SeqCst);
    let _ = cap.join();
    if let (Some(h), Some(r)) = (st.hwnd, st.restore) {
        win::put_back(h, r);
        events.push(clock::now(), "restored", json!({}));
    }
    if let Some((x, y)) = st.pointer_home {
        input::move_to(x, y);
        events.push(clock::now(), "pointer-back", json!({}));
    }
    if let Some(h) = st.focus_home {
        let ok = unsafe { windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow(h).as_bool() };
        events.push(clock::now(), "focus-back", json!({ "ok": ok }));
    }
    // The capture thread's own CPU over the run (the sensor's cost), and the whole process for reference.
    let run_ms = (clock::now() as f64 / 1000.0).max(1.0);
    let capture_pct = watch.cpu_us.load(Ordering::SeqCst) as f64 / 1000.0 / run_ms * 100.0;
    events.push(clock::now(), "self", json!({ "cpu_pct": crate::self_cpu_pct(), "capture_cpu_pct": capture_pct }));

    let _ = std::fs::create_dir_all(out);
    let n = events.write(&out.join("events.jsonl")).unwrap_or(0);
    let kept = watch.kept.lock().unwrap();
    let k = crate::pngout::write(out, &kept).unwrap_or_else(|e| {
        eprintln!("[deetsmeter] frames not written: {e}");
        0
    });
    summary(&events.snapshot());
    println!("  wrote {n} events{} to {}", if k > 0 { format!(" and {k} frames") } else { String::new() }, out.display());
    if let Some(f) = failed {
        eprintln!("[deetsmeter] stopped at {f}");
        return 1;
    }
    0
}

fn arm(watch: &Watch, i: usize, kind: &str, keep: Option<u32>, tag: &Option<String>, probe: &Option<String>) -> String {
    let tag = tag.clone().unwrap_or_else(|| format!("s{i:02}-{kind}"));
    if let Some(n) = keep {
        watch.arm_keep(n, &tag, probe.as_deref());
    }
    tag
}

fn do_step(i: usize, step: &Step, rf: &RunFile, st: &mut State, watch: &Watch, ev: &Arc<Events>) -> Result<(), String> {
    if matches!(step, Step::Move { .. } | Step::Click { .. } | Step::Wheel { .. } | Step::Drag { .. } | Step::Park) && st.pointer_home.is_none() {
        st.pointer_home = input::cursor();
    }
    if matches!(step, Step::Focus) && st.focus_home.is_none() {
        let fg = unsafe { windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow() };
        if !fg.is_invalid() {
            st.focus_home = Some(fg);
        }
    }
    match step {
        Step::Launch => {
            let t = clock::now();
            let pid = if let Some(exe) = &rf.app.exe {
                win::launch_exe(&win::expand_env(exe), &rf.app.args).map_err(|e| format!("launch: {e}"))?
            } else if let Some(id) = &rf.app.aumid {
                win::launch_aumid(id).map_err(|e| format!("activate: {e}"))?
            } else {
                return Err("launch needs app.exe or app.aumid".into());
            };
            ev.push(t, "launch", json!({ "pid": pid, "step": i }));
            st.pids = vec![pid];
        }
        Step::Attach => {
            let what = rf.app.attach.as_deref().or(rf.app.exe.as_deref()).ok_or("attach needs app.attach or app.exe")?;
            let what = &win::expand_env(what);
            st.pids = win::find_pids(what);
            if st.pids.is_empty() {
                return Err(format!("no process matches {what}"));
            }
            ev.push(clock::now(), "attach", json!({ "pids": st.pids, "step": i }));
        }
        Step::WaitWindow { timeout_ms, lift } => {
            let until = clock::now() + timeout_ms.unwrap_or(30_000) as i64 * 1000;
            // The launched pid's tree (a launcher may hand the window to a child). Rebuilt every
            // 100 ms, not every poll: it is a snapshot of every process on the PC (polling it
            // every 1 ms cost 85 % of a core, 2026-10-10).
            let mut pids: Vec<u32> = Vec::new();
            let mut tree_at: Option<i64> = None;
            let mut restored = false;
            loop {
                if tree_at.is_none_or(|t| clock::now() - t > 100_000) {
                    pids.clear();
                    for p in &st.pids {
                        pids.extend(win::tree(*p));
                    }
                    tree_at = Some(clock::now());
                }
                // A minimized window is brought back, once, without taking the focus.
                if !restored && win::restore_minimized(&pids) {
                    restored = true;
                    ev.push(clock::now(), "unminimized", json!({ "step": i }));
                }
                if let Some(w) = win::windows_of(&pids).into_iter().next() {
                    let t = clock::now();
                    if *lift == Some(true) {
                        win::lift(w.hwnd);
                    }
                    ev.push(t, "shown", json!({ "pid": w.pid, "title": w.title, "frame": w.frame.json(), "lifted": *lift == Some(true), "step": i }));
                    st.hwnd = Some(w.hwnd);
                    st.win_pid = Some(w.pid);
                    st.frame = Some(w.frame);
                    break;
                }
                if clock::now() > until {
                    return Err("no window in time".into());
                }
                std::thread::sleep(Duration::from_millis(2));
            }
        }
        Step::Place { rect, on } => {
            let hwnd = st.hwnd.ok_or("place needs a window (wait_window first)")?;
            let frame = match rect {
                Some(r) => {
                    let (ox, oy) = match on {
                        Some(m) => {
                            let m = win::monitor(m).ok_or_else(|| format!("no monitor {m}"))?;
                            (m.work.x, m.work.y)
                        }
                        None => (0, 0),
                    };
                    if st.restore.is_none() {
                        st.restore = win::outer(hwnd);
                    }
                    win::place(hwnd, Rect { x: ox + r[0], y: oy + r[1], w: r[2], h: r[3] }).ok_or("place failed")?
                }
                None => {
                    win::lift(hwnd);
                    win::frame(hwnd).ok_or("no frame")?
                }
            };
            st.frame = Some(frame);
            let region = match rf.region {
                Some(r) => Rect { x: frame.x + r[0], y: frame.y + r[1], w: r[2], h: r[3] },
                None => frame,
            };
            *watch.probes.lock().unwrap() = rf
                .probes
                .iter()
                .map(|(name, r)| Probe { name: name.clone(), r: Rect { x: frame.x + r[0], y: frame.y + r[1], w: r[2], h: r[3] } })
                .collect();
            if let Some((x, y, who)) = win::covered_in(hwnd, region) {
                return Err(format!(
                    "the region is covered at ({x}, {y}) by {who}; the sensor would measure that app. Bring the app to the front (a focus step) or clear the screen"
                ));
            }
            let t = clock::now();
            watch.set_region(region);
            if !watch.wait_baseline(t, 3000) {
                return Err("no baseline frame in 3 s (Desktop Duplication blocked?)".into());
            }
            ev.push(clock::now(), "placed", json!({ "frame": frame.json(), "region": region.json(), "step": i }));
        }
        Step::Focus => {
            let hwnd = st.hwnd.ok_or("focus needs a window")?;
            let ok = win::raise(hwnd);
            std::thread::sleep(Duration::from_millis(200));
            ev.push(clock::now(), "focus", json!({ "ok": ok, "step": i }));
        }
        Step::Wait { ms } => std::thread::sleep(Duration::from_millis(*ms)),
        Step::Mark { name } => ev.push(clock::now(), "mark", json!({ "name": name, "step": i })),
        Step::Move { at } => {
            let (x, y) = target(st, *at)?;
            input::move_to(x, y);
        }
        Step::Click { at, right, hover_ms, keep, tag, probe } => {
            let (x, y) = target(st, *at)?;
            input::move_to(x, y);
            // The hover paints first and settles before the press is timed.
            std::thread::sleep(Duration::from_millis(hover_ms.unwrap_or(150)));
            // Again, right before the press: on 2026-10-10 a game client came to the front during
            // this wait and took a click the first check had cleared.
            target(st, *at)?;
            let tag = arm(watch, i, "click", *keep, tag, probe);
            let t = clock::now();
            input::click(right.unwrap_or(false));
            ev.push(t, "input", json!({ "kind": "click", "at": at, "tag": tag, "probe": probe, "step": i }));
            st.last_input = Some(t);
        }
        Step::Wheel { at, delta, count, every_ms, keep, tag, probe } => {
            let (x, y) = target(st, *at)?;
            input::move_to(x, y);
            std::thread::sleep(Duration::from_millis(150));
            target(st, *at)?; // again, right before the press: a window can come up during the wait
            let tag = arm(watch, i, "wheel", *keep, tag, probe);
            let n = count.unwrap_or(1);
            let t = clock::now();
            ev.push(t, "input", json!({ "kind": "wheel", "at": at, "delta": delta, "count": n, "tag": tag, "probe": probe, "step": i }));
            st.last_input = Some(t);
            for k in 0..n {
                input::wheel(*delta);
                if k + 1 < n {
                    clock::sleep_us(every_ms.unwrap_or(16) as i64 * 1000);
                }
            }
            ev.push(clock::now(), "input-end", json!({ "kind": "wheel", "tag": tag, "probe": probe, "step": i }));
        }
        Step::Drag { from, to, steps, every_ms, keep, tag, probe } => {
            let (x0, y0) = target(st, *from)?;
            let (x1, y1) = target(st, *to)?;
            input::move_to(x0, y0);
            std::thread::sleep(Duration::from_millis(150));
            target(st, *from)?; // again, right before the press: a window can come up during the wait
            let tag = arm(watch, i, "drag", *keep, tag, probe);
            let n = steps.unwrap_or(60).max(1);
            let t = clock::now();
            input::button(true);
            ev.push(t, "input", json!({ "kind": "drag", "from": from, "to": to, "steps": n, "tag": tag, "probe": probe, "step": i }));
            st.last_input = Some(t);
            for k in 1..=n {
                clock::sleep_us(every_ms.unwrap_or(8) as i64 * 1000);
                let f = k as f64 / n as f64;
                input::move_to(x0 + ((x1 - x0) as f64 * f) as i32, y0 + ((y1 - y0) as f64 * f) as i32);
            }
            input::button(false);
            ev.push(clock::now(), "input-end", json!({ "kind": "drag", "tag": tag, "probe": probe, "step": i }));
        }
        Step::Key { key, keep, tag, probe } => {
            let (mods, vk) = input::parse_key(key).ok_or_else(|| format!("unknown key {key}"))?;
            keys_target(st)?;
            let tag = arm(watch, i, "key", *keep, tag, probe);
            let t = clock::now();
            input::press(&mods, vk);
            ev.push(t, "input", json!({ "kind": "key", "key": key, "tag": tag, "probe": probe, "step": i }));
            st.last_input = Some(t);
        }
        Step::Text { text, every_ms, keep, tag, probe } => {
            keys_target(st)?;
            let tag = arm(watch, i, "text", *keep, tag, probe);
            let units: Vec<u16> = text.encode_utf16().collect();
            let t = clock::now();
            ev.push(t, "input", json!({ "kind": "text", "text": text, "tag": tag, "probe": probe, "step": i }));
            st.last_input = Some(t);
            for (k, c) in units.iter().enumerate() {
                input::char(*c);
                if k + 1 < units.len() {
                    clock::sleep_us(every_ms.unwrap_or(40) as i64 * 1000);
                }
            }
            // The LAST key is the one a result waits on (§2.3, Search → results).
            ev.push(clock::now(), "input-end", json!({ "kind": "text", "tag": tag, "probe": probe, "step": i }));
        }
        Step::Settle { quiet_ms, timeout_ms, probe, content } => {
            let quiet = quiet_ms.unwrap_or(500) as i64 * 1000;
            let mut start = clock::now();
            let wants_content = *content == Some(true) && probe.is_some();
            // Changes count from the last input, not from this step: the input's own
            // changes land before the settle step begins.
            let since = st.last_input.unwrap_or(start);
            let until = start + timeout_ms.unwrap_or(15_000) as i64 * 1000;
            // With a probe, only that area must go quiet (a self-animating backdrop never does).
            let last_change = || match probe {
                Some(p) => watch.probe_last(p).unwrap_or(i64::MIN),
                None => watch.last_change.load(Ordering::SeqCst),
            };
            loop {
                let now = clock::now();
                if wants_content && watch.probe_flat.lock().unwrap().get(probe.as_deref().unwrap_or("")).copied().unwrap_or(true) {
                    // Still blank: the quiet time starts again once something is drawn.
                    start = now;
                }
                let lc = last_change();
                if now - lc.max(start) >= quiet {
                    ev.push(now, "settled", json!({ "last_change": if lc > since { json!(lc) } else { Value::Null }, "quiet_ms": quiet / 1000, "probe": probe, "step": i }));
                    break;
                }
                if now > until {
                    ev.push(now, "settle-timeout", json!({ "probe": probe, "step": i }));
                    break;
                }
                std::thread::sleep(Duration::from_millis(2));
            }
        }
        Step::Listen { threshold_db, pid, method, also } => {
            let pid = pid.or(st.win_pid).ok_or("listen needs a pid or the app's window (wait_window first)")?;
            let m = match method.as_deref() {
                None => crate::audio::Method::Meter,
                Some(s) => crate::audio::Method::parse(s).ok_or_else(|| format!("listen: method is meter or loopback, not {s}"))?,
            };
            if !also.is_empty() && m == crate::audio::Method::Loopback {
                return Err("listen: also works with method meter only (loopback hears one process tree)".into());
            }
            let also: Vec<String> = also.iter().map(|a| crate::win::expand_env(a)).collect();
            let l = crate::audio::start(pid, &also, threshold_db.unwrap_or(-60.0), m, ev.clone()).map_err(|e| format!("listen: {e}"))?;
            st.listen = Some(l);
        }
        Step::WaitSound { timeout_ms } => {
            let l = st.listen.as_ref().ok_or("wait_sound needs a listen step first")?;
            let since = st.last_input.unwrap_or(i64::MIN);
            let until = clock::now() + timeout_ms.unwrap_or(10_000) as i64 * 1000;
            loop {
                if l.last_on.load(Ordering::SeqCst) > since {
                    break;
                }
                if clock::now() > until {
                    ev.push(clock::now(), "sound-timeout", json!({ "step": i }));
                    break;
                }
                std::thread::sleep(Duration::from_millis(2));
            }
        }
        Step::Invoke { names, probe, keep, tag } => {
            let hwnd = st.hwnd.ok_or("invoke needs a window (wait_window first)")?;
            // The search is slow (a cross-process walk of the window's buttons): before the clock.
            let b = crate::uia::find(hwnd, names)?;
            // `probe: "self"` = the button's own rectangle, with a fresh "before" picture.
            let probe_name = match probe.as_deref() {
                Some("self") => {
                    {
                        let mut ps = watch.probes.lock().unwrap();
                        ps.retain(|p| p.name != "self");
                        ps.push(Probe { name: "self".into(), r: b.rect });
                    }
                    watch.probe_prev.lock().unwrap().remove("self");
                    let t0 = clock::now();
                    watch.rebase.store(true, Ordering::SeqCst);
                    if !watch.wait_baseline(t0, 3000) {
                        return Err("no baseline for the button's probe in 3 s".into());
                    }
                    Some("self".to_string())
                }
                other => other.map(str::to_string),
            };
            // No pointer is sent, but a covered window would still be measured wrong.
            if let Some(reg) = *watch.region.lock().unwrap() {
                if let Some((x, y, who)) = win::covered_in(hwnd, reg) {
                    return Err(format!("the region is covered at ({x}, {y}) by {who}; nothing was pressed"));
                }
            }
            let tag = arm(watch, i, "invoke", *keep, tag, &probe_name);
            let t = clock::now();
            let how = crate::uia::press(&b)?;
            let back = clock::now();
            ev.push(t, "input", json!({
                "kind": "invoke", "name": b.name, "how": how, "call_us": back - t,
                "tag": tag, "probe": probe_name, "step": i,
            }));
            st.last_input = Some(t);
        }
        Step::Snap { tag } => {
            // Keep the next frame read, whatever it shows: a picture of the region now.
            *watch.snap_tag.lock().unwrap() = tag.clone().unwrap_or_else(|| format!("s{i:02}-snap"));
            watch.snap.store(true, Ordering::SeqCst);
            watch.rebase.store(true, Ordering::SeqCst);
            let until = clock::now() + 3_000_000;
            while watch.snap.load(Ordering::SeqCst) {
                if clock::now() > until {
                    watch.snap.store(false, Ordering::SeqCst);
                    return Err("snap: no frame in 3 s".into());
                }
                std::thread::sleep(Duration::from_millis(2));
            }
        }
        Step::Park => {
            let f = st.frame.ok_or("park needs a frame")?;
            input::move_to(f.x + f.w + 40, f.y + f.h / 2);
        }
        Step::Close => {
            let hwnd = st.hwnd.ok_or("close needs a window")?;
            let root = st.win_pid.or(st.pids.first().copied()).ok_or("close needs the app's process")?;
            st.close_tree = win::tree(root);
            let t = clock::now();
            win::close(hwnd);
            ev.push(t, "input", json!({ "kind": "close", "tag": "close", "pids": st.close_tree.len(), "step": i }));
            st.last_input = Some(t);
        }
        Step::WaitGone { timeout_ms } => {
            let ms = timeout_ms.unwrap_or(10_000);
            match win::wait_all_gone(&st.close_tree, ms) {
                Some(t) => {
                    ev.push(t, "gone", json!({ "pids": st.close_tree.len(), "step": i }));
                    // The window is gone with it: a later `place` or the end-of-run put-back
                    // must not touch a dead handle.
                    st.hwnd = None;
                    st.frame = None;
                }
                None => return Err(format!("the app was still running {ms} ms after the close (did it hide to the tray?)")),
            }
        }
    }
    Ok(())
}

/// For each input: the first changed frame after it (before the next input), and the
/// settle that follows it. A convenience print; the judge reads the events file.
fn summary(all: &[Value]) {
    let mut sorted: Vec<&Value> = all.iter().collect();
    sorted.sort_by_key(|v| v["t"].as_i64().unwrap_or(0));
    let inputs: Vec<&Value> = sorted.iter().copied().filter(|v| v["ev"] == "input").collect();
    let ms = |us: i64| us as f64 / 1000.0;
    println!("deetsmeter run");
    for e in sorted.iter().filter(|e| matches!(e["ev"].as_str(), Some("output" | "launch" | "shown" | "placed" | "screen-error" | "screen-lost" | "step-failed"))) {
        println!("  {:>9.1} ms  {} {}", ms(e["t"].as_i64().unwrap_or(0)), e["ev"].as_str().unwrap_or(""), short(e));
    }
    for (k, inp) in inputs.iter().enumerate() {
        let t = inp["t"].as_i64().unwrap_or(0);
        let next = inputs.get(k + 1).and_then(|n| n["t"].as_i64()).unwrap_or(i64::MAX);
        // With a probe, a change is a change IN the probe (§17.9: a self-animating window
        // changes the whole region on every frame).
        let probe = inp["probe"].as_str();
        let is_change = |e: &Value| match probe {
            Some(p) => e["probes"][p]["c"] == true,
            None => e["changed"] == true,
        };
        let changes: Vec<i64> = sorted
            .iter()
            .filter(|e| e["ev"] == "frame" && is_change(e))
            .filter_map(|e| e["t"].as_i64())
            .filter(|ft| *ft > t && *ft < next)
            .collect();
        // The probe's noise: its largest cell change in the 500 ms before the input. The
        // threshold must sit above it, and below the input's own change.
        if let Some(p) = probe {
            let noise = sorted
                .iter()
                .filter(|e| e["ev"] == "frame" && e["t"].as_i64().is_some_and(|ft| ft < t && ft > t - 500_000))
                .filter_map(|e| e["probes"][p]["d"].as_u64())
                .max();
            let peak = sorted
                .iter()
                .filter(|e| e["ev"] == "frame" && e["t"].as_i64().is_some_and(|ft| ft > t && ft < next))
                .filter_map(|e| e["probes"][p]["d"].as_u64())
                .max();
            println!(
                "  {:>9.1} ms  probe {p}: cell change before the input max {} · after max {}",
                ms(t),
                noise.map(|v| v.to_string()).unwrap_or("-".into()),
                peak.map(|v| v.to_string()).unwrap_or("-".into())
            );
        }
        let settled = sorted
            .iter()
            .find(|e| e["ev"] == "settled" && e["t"].as_i64().is_some_and(|st| st > t && st < next))
            .and_then(|e| e["last_change"].as_i64());
        let tag = inp["tag"].as_str().unwrap_or("");
        match changes.first() {
            Some(f) => println!(
                "  {:>9.1} ms  {:<6} {:<18} first change +{:.1} ms · {} changed frames{}",
                ms(t),
                inp["kind"].as_str().unwrap_or(""),
                tag,
                ms(f - t),
                changes.len(),
                settled.map(|s| format!(" · settled +{:.1} ms", ms(s - t))).unwrap_or_default()
            ),
            None => println!("  {:>9.1} ms  {:<6} {:<18} no change seen", ms(t), inp["kind"].as_str().unwrap_or(""), tag),
        }
        // Input → sound: the first sound-on after the input, before the next one.
        if let Some(s) = sorted.iter().find(|e| e["ev"] == "sound-on" && e["t"].as_i64().is_some_and(|st| st > t && st < next)) {
            println!(
                "  {:>9.1} ms  {:<6} {:<18} sound +{:.1} ms (peak {} dBFS)",
                ms(t),
                inp["kind"].as_str().unwrap_or(""),
                tag,
                ms(s["t"].as_i64().unwrap_or(0) - t),
                s["peak_db"]
            );
        }
    }
    let ons = sorted.iter().filter(|e| e["ev"] == "sound-on").count();
    let offs = sorted.iter().filter(|e| e["ev"] == "sound-off").count();
    if sorted.iter().any(|e| e["ev"] == "listen") {
        println!("  sound  {ons} start(s), {offs} stop(s) heard · no audio was stored");
        if let Some(end) = sorted.iter().find(|e| e["ev"] == "listen-end") {
            let loud = end["loud"].as_u64().unwrap_or(0);
            match end["polls"].as_u64() {
                Some(polls) => println!(
                    "  sound  meter: {polls} polls of {} session(s), {loud} over the threshold, loudest {} dBFS · longest poll gap {:.1} ms · meter thread {:.1} % of one core",
                    end["sessions"],
                    end["max_peak_db"],
                    end["longest_poll_ms"].as_f64().unwrap_or(f64::NAN),
                    end["cpu_pct"].as_f64().unwrap_or(f64::NAN)
                ),
                None => println!("  sound  loopback: {} packets, {loud} over the threshold, loudest {} dBFS", end["packets"], end["max_peak_db"]),
            }
            if ons == 0 {
                // Say WHY nothing was heard, so a setup problem is not read as a slow app.
                // Packets alone prove nothing: the loopback device sends silent packets on a
                // timer even when the target plays nothing (the chime test, 2026-10-10). The
                // loudest level is what tells "quiet" from "nothing".
                match end["max_peak_db"].as_f64() {
                    None => println!("  sound  nothing heard: the app was silent (paused?), or played elsewhere (AirPlay, another output) or outside its process tree. Measure with local output only (§3)."),
                    Some(db) => println!("  sound  the app was heard, but only up to {db} dBFS: below the threshold. Protected audio (DeetsMusic's MusicKit stream) reaches the loopback as silence: use method meter. Otherwise lower threshold_db or check the app volume."),
                }
            }
        }
    }
    if let Some(s) = sorted.iter().find(|e| e["ev"] == "self") {
        println!(
            "  sensor cost  capture thread {:.1} % of one core · whole process {:.1} %",
            s["capture_cpu_pct"].as_f64().unwrap_or(f64::NAN),
            s["cpu_pct"].as_f64().unwrap_or(f64::NAN)
        );
    }
}

fn short(e: &Value) -> String {
    let mut v = e.clone();
    if let Some(o) = v.as_object_mut() {
        o.remove("t");
        o.remove("ev");
    }
    v.to_string()
}
