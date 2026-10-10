//! The screen part of the sensor: Desktop Duplication of the region (music-app-comp.md §17.2).
//!
//! DWM hands over a copy of the screen each time it composes a change. A frame whose dirty
//! rectangles miss the region is dropped at once. For the rest, the region is copied to a
//! staging texture and a sparse sample of it is hashed (every 4th pixel of every 4th row):
//! a new hash is a CHANGE. Each probe is read in full and checked for "one flat color".
//!
//! When the region is set or moved, the duplication is opened again, so its first frame is
//! the whole current screen. That frame is the BASELINE (not a change): without it, a
//! still screen gives no frame until the input, and the input's own frame would be taken as
//! the baseline and lost.

use crate::clock;
use crate::events::Events;
use serde_json::{json, Map, Value};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use windows::core::{Interface, PCWSTR};
use windows::Win32::Foundation::{HMODULE, RECT};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_BOX, D3D11_CPU_ACCESS_READ,
    D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_SDK_VERSION,
    D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIAdapter, IDXGIFactory1, IDXGIOutput1, IDXGIOutputDuplication, IDXGIResource,
    DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO, DXGI_OUTDUPL_MOVE_RECT,
};
use windows::Win32::Graphics::Gdi::{EnumDisplaySettingsW, DEVMODEW, ENUM_CURRENT_SETTINGS};

/// A rectangle in desktop (virtual screen) pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    pub fn json(&self) -> Value {
        json!([self.x, self.y, self.w, self.h])
    }
    fn contains(&self, px: i32, py: i32) -> bool {
        px >= self.x && py >= self.y && px < self.x + self.w && py < self.y + self.h
    }
    fn hits(&self, r: &RECT) -> bool {
        r.left < self.x + self.w && r.right > self.x && r.top < self.y + self.h && r.bottom > self.y
    }
}

pub struct Probe {
    pub name: String,
    pub r: Rect,
}

/// One region frame kept as pixels (BGRA, tightly packed) for the PNG output.
pub struct Kept {
    pub tag: String,
    pub t: i64,
    pub w: u32,
    pub h: u32,
    pub bgra: Vec<u8>,
}

/// What the main thread and the capture thread share.
pub struct Watch {
    pub region: Mutex<Option<Rect>>,
    pub probes: Mutex<Vec<Probe>>,
    pub keep_left: AtomicU32,
    pub keep_tag: Mutex<String>,
    pub keep_probe: Mutex<Option<String>>,
    pub kept: Mutex<Vec<Kept>>,
    pub stop: AtomicBool,
    /// Present time (µs) of the last CHANGED frame; i64::MIN before the first.
    pub last_change: AtomicI64,
    pub changes: AtomicU64,
    /// Time (µs) of the last baseline frame; i64::MIN before the first.
    pub baseline: AtomicI64,
    pub hz: AtomicU32,
    /// Every changed frame's present time is also sent here when set (calibrate).
    pub change_tx: Mutex<Option<Sender<i64>>>,
    /// Each probe's last brightness grid, and the time (µs) of its last change.
    pub probe_prev: Mutex<HashMap<String, Vec<u8>>>,
    pub probe_last: Mutex<HashMap<String, i64>>,
    /// A probe CHANGES when one grid cell moves by at least this much (0–255 luma).
    pub probe_threshold: AtomicU32,
}

impl Watch {
    pub fn new() -> Arc<Self> {
        Arc::new(Watch {
            region: Mutex::new(None),
            probes: Mutex::new(Vec::new()),
            keep_left: AtomicU32::new(0),
            keep_tag: Mutex::new(String::new()),
            keep_probe: Mutex::new(None),
            kept: Mutex::new(Vec::new()),
            stop: AtomicBool::new(false),
            last_change: AtomicI64::new(i64::MIN),
            changes: AtomicU64::new(0),
            baseline: AtomicI64::new(i64::MIN),
            hz: AtomicU32::new(0),
            change_tx: Mutex::new(None),
            probe_prev: Mutex::new(HashMap::new()),
            probe_last: Mutex::new(HashMap::new()),
            probe_threshold: AtomicU32::new(16),
        })
    }

    /// Set the region; the capture thread re-opens and takes a new baseline.
    pub fn set_region(&self, r: Rect) {
        *self.region.lock().unwrap() = Some(r);
    }

    /// Wait for a baseline newer than `after` (µs). False on timeout.
    pub fn wait_baseline(&self, after: i64, timeout_ms: u64) -> bool {
        let until = clock::now() + timeout_ms as i64 * 1000;
        while clock::now() < until {
            if self.baseline.load(Ordering::SeqCst) > after {
                return true;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        false
    }

    /// Keep the next `n` frames that change: in `probe` when one is named (a self-animating
    /// window changes the region on every frame), else anywhere in the region.
    pub fn arm_keep(&self, n: u32, tag: &str, probe: Option<&str>) {
        *self.keep_tag.lock().unwrap() = tag.to_string();
        *self.keep_probe.lock().unwrap() = probe.map(str::to_string);
        self.keep_left.store(n, Ordering::SeqCst);
    }

    pub fn probe_last(&self, name: &str) -> Option<i64> {
        self.probe_last.lock().unwrap().get(name).copied()
    }
}

struct Dup {
    ctx: ID3D11DeviceContext,
    dev: ID3D11Device,
    dup: IDXGIOutputDuplication,
    out: Rect,
    staging: Option<(ID3D11Texture2D, u32, u32, DXGI_FORMAT)>,
}

fn wide_to_string(w: &[u16]) -> String {
    let n = w.iter().position(|&c| c == 0).unwrap_or(w.len());
    String::from_utf16_lossy(&w[..n])
}

/// Open a duplication of the output that holds the point, on that output's own adapter.
fn open_for(px: i32, py: i32) -> windows::core::Result<(Dup, String, u32)> {
    unsafe {
        let factory: IDXGIFactory1 = CreateDXGIFactory1()?;
        let mut ai = 0;
        while let Ok(adapter) = factory.EnumAdapters1(ai) {
            ai += 1;
            let mut oi = 0;
            while let Ok(output) = adapter.EnumOutputs(oi) {
                oi += 1;
                let desc = output.GetDesc()?;
                let c = desc.DesktopCoordinates;
                let out = Rect { x: c.left, y: c.top, w: c.right - c.left, h: c.bottom - c.top };
                if !out.contains(px, py) {
                    continue;
                }
                let adapter: IDXGIAdapter = adapter.cast()?;
                let mut dev: Option<ID3D11Device> = None;
                let mut ctx: Option<ID3D11DeviceContext> = None;
                D3D11CreateDevice(
                    &adapter,
                    D3D_DRIVER_TYPE_UNKNOWN,
                    HMODULE::default(),
                    D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                    None,
                    D3D11_SDK_VERSION,
                    Some(&mut dev),
                    None,
                    Some(&mut ctx),
                )?;
                let dev = dev.unwrap();
                let output1: IDXGIOutput1 = output.cast()?;
                let dup = output1.DuplicateOutput(&dev)?;
                let name = wide_to_string(&desc.DeviceName);
                let mut dm = DEVMODEW { dmSize: std::mem::size_of::<DEVMODEW>() as u16, ..Default::default() };
                let hz = if EnumDisplaySettingsW(PCWSTR(desc.DeviceName.as_ptr()), ENUM_CURRENT_SETTINGS, &mut dm).as_bool() {
                    dm.dmDisplayFrequency
                } else {
                    0
                };
                return Ok((Dup { ctx: ctx.unwrap(), dev, dup, out, staging: None }, name, hz));
            }
        }
        Err(windows::core::Error::new(windows::Win32::Foundation::E_FAIL, "no output holds the region"))
    }
}

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;
/// The probe grid: at most this many cells across and down.
const GRID: usize = 32;

fn fnv(h: u64, v: u32) -> u64 {
    (h ^ v as u64).wrapping_mul(FNV_PRIME)
}

/// Start the capture thread. It runs until `watch.stop`.
pub fn spawn(watch: Arc<Watch>, events: Arc<Events>) -> std::thread::JoinHandle<()> {
    std::thread::Builder::new()
        .name("screen".into())
        .spawn(move || capture_loop(&watch, &events))
        .expect("screen thread")
}

fn capture_loop(w: &Watch, ev: &Events) {
    let mut dup: Option<Dup> = None;
    let mut cur_region: Option<Rect> = None;
    let mut prev_hash: Option<u64> = None;
    let mut dirty: Vec<RECT> = vec![RECT::default(); 64];
    let mut moves: Vec<DXGI_OUTDUPL_MOVE_RECT> = vec![DXGI_OUTDUPL_MOVE_RECT::default(); 16];

    while !w.stop.load(Ordering::SeqCst) {
        let Some(region) = *w.region.lock().unwrap() else {
            std::thread::sleep(Duration::from_millis(2));
            continue;
        };
        if cur_region != Some(region) {
            // A new region: open again, so the first frame is a baseline of the whole screen.
            dup = None;
            cur_region = Some(region);
        }
        if dup.is_none() {
            match open_for(region.x + region.w / 2, region.y + region.h / 2) {
                Ok((d, name, hz)) => {
                    w.hz.store(hz, Ordering::SeqCst);
                    ev.push(clock::now(), "output", json!({ "name": name, "rect": d.out.json(), "hz": hz, "region": region.json() }));
                    dup = Some(d);
                    prev_hash = None;
                }
                Err(e) => {
                    ev.push(clock::now(), "screen-error", json!({ "where": "open", "code": format!("{:#x}", e.code().0), "msg": e.message() }));
                    std::thread::sleep(Duration::from_millis(250));
                    continue;
                }
            }
        }
        let d = dup.as_mut().unwrap();
        let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
        let mut res: Option<IDXGIResource> = None;
        match unsafe { d.dup.AcquireNextFrame(16, &mut info, &mut res) } {
            Ok(()) => {}
            Err(e) if e.code() == DXGI_ERROR_WAIT_TIMEOUT => continue,
            Err(e) => {
                // ACCESS_LOST (a mode change, the secure desktop) and the rest: open again.
                ev.push(clock::now(), "screen-lost", json!({ "code": format!("{:#x}", e.code().0) }));
                dup = None;
                std::thread::sleep(Duration::from_millis(50));
                continue;
            }
        }
        let acq = clock::now();
        let baseline = prev_hash.is_none();
        let r = handle_frame(w, ev, d, &info, res, region, baseline, acq, &mut prev_hash, &mut dirty, &mut moves);
        unsafe {
            let _ = d.dup.ReleaseFrame();
        }
        if let Err(e) = r {
            ev.push(acq, "screen-error", json!({ "where": "frame", "code": format!("{:#x}", e.code().0), "msg": e.message() }));
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_frame(
    w: &Watch,
    ev: &Events,
    d: &mut Dup,
    info: &DXGI_OUTDUPL_FRAME_INFO,
    res: Option<IDXGIResource>,
    region: Rect,
    baseline: bool,
    acq: i64,
    prev_hash: &mut Option<u64>,
    dirty: &mut Vec<RECT>,
    moves: &mut Vec<DXGI_OUTDUPL_MOVE_RECT>,
) -> windows::core::Result<()> {
    // A pointer-only update has no present time. A baseline is taken whatever it carries.
    if info.LastPresentTime == 0 && !baseline {
        return Ok(());
    }
    // The region in output-local pixels, clipped to the output.
    let lx0 = (region.x - d.out.x).max(0);
    let ly0 = (region.y - d.out.y).max(0);
    let lx1 = (region.x + region.w - d.out.x).min(d.out.w);
    let ly1 = (region.y + region.h - d.out.y).min(d.out.h);
    if lx1 <= lx0 || ly1 <= ly0 {
        return Ok(());
    }
    let local = Rect { x: lx0, y: ly0, w: lx1 - lx0, h: ly1 - ly0 };

    if !baseline && info.TotalMetadataBufferSize > 0 {
        let mut hit = false;
        unsafe {
            let mut need = 0u32;
            let bytes = (dirty.len() * std::mem::size_of::<RECT>()) as u32;
            if d.dup.GetFrameDirtyRects(bytes, dirty.as_mut_ptr(), &mut need).is_err() && need > bytes {
                dirty.resize(need as usize / std::mem::size_of::<RECT>() + 1, RECT::default());
                let bytes = (dirty.len() * std::mem::size_of::<RECT>()) as u32;
                d.dup.GetFrameDirtyRects(bytes, dirty.as_mut_ptr(), &mut need)?;
            }
            let n = need as usize / std::mem::size_of::<RECT>();
            hit |= dirty[..n.min(dirty.len())].iter().any(|r| local.hits(r));

            let mut need = 0u32;
            let msz = std::mem::size_of::<DXGI_OUTDUPL_MOVE_RECT>();
            let bytes = (moves.len() * msz) as u32;
            if d.dup.GetFrameMoveRects(bytes, moves.as_mut_ptr(), &mut need).is_err() && need > bytes {
                moves.resize(need as usize / msz + 1, DXGI_OUTDUPL_MOVE_RECT::default());
                let bytes = (moves.len() * msz) as u32;
                d.dup.GetFrameMoveRects(bytes, moves.as_mut_ptr(), &mut need)?;
            }
            let n = need as usize / msz;
            hit |= moves[..n.min(moves.len())].iter().any(|m| local.hits(&m.DestinationRect));
        }
        if !hit {
            return Ok(());
        }
    }

    let Some(res) = res else { return Ok(()) };
    let tex: ID3D11Texture2D = res.cast()?;
    let mut desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { tex.GetDesc(&mut desc) };
    let (sw, sh) = (local.w as u32, local.h as u32);
    let fresh = match &d.staging {
        Some((_, w0, h0, f0)) => *w0 != sw || *h0 != sh || *f0 != desc.Format,
        None => true,
    };
    if fresh {
        let sd = D3D11_TEXTURE2D_DESC {
            Width: sw,
            Height: sh,
            MipLevels: 1,
            ArraySize: 1,
            Format: desc.Format,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: 0,
        };
        let mut t: Option<ID3D11Texture2D> = None;
        unsafe { d.dev.CreateTexture2D(&sd, None, Some(&mut t))? };
        d.staging = Some((t.unwrap(), sw, sh, desc.Format));
    }
    let staging = d.staging.as_ref().unwrap().0.clone();
    let bx = D3D11_BOX {
        left: local.x as u32,
        top: local.y as u32,
        front: 0,
        right: (local.x + local.w) as u32,
        bottom: (local.y + local.h) as u32,
        back: 1,
    };
    let mut probes_out = Map::new();
    let mut probe_changes: Vec<String> = Vec::new();
    let hash;
    let mut kept: Option<Vec<u8>> = None;
    unsafe {
        d.ctx.CopySubresourceRegion(&staging, 0, 0, 0, 0, &tex, 0, Some(&bx));
        let mut m = D3D11_MAPPED_SUBRESOURCE::default();
        d.ctx.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut m))?;
        let pitch = m.RowPitch as usize;
        let base = m.pData as *const u8;
        let px = |x: usize, y: usize| -> u32 { std::ptr::read_unaligned(base.add(y * pitch + x * 4) as *const u32) };

        let mut h = FNV_OFFSET;
        for y in (0..sh as usize).step_by(4) {
            for x in (0..sw as usize).step_by(4) {
                h = fnv(h, px(x, y));
            }
        }
        hash = h;

        // Probes are in desktop pixels; read them relative to the region's top-left corner.
        for p in w.probes.lock().unwrap().iter() {
            let x0 = (p.r.x - (d.out.x + local.x)).max(0) as usize;
            let y0 = (p.r.y - (d.out.y + local.y)).max(0) as usize;
            let x1 = ((p.r.x + p.r.w - (d.out.x + local.x)).max(0) as usize).min(sw as usize);
            let y1 = ((p.r.y + p.r.h - (d.out.y + local.y)).max(0) as usize).min(sh as usize);
            if x1 <= x0 || y1 <= y0 {
                continue;
            }
            let area = (x1 - x0) * (y1 - y0);
            let step = ((area as f64 / 16384.0).sqrt().ceil() as usize).max(1);
            let (pw, ph_) = (x1 - x0, y1 - y0);
            // A coarse brightness grid: up to GRID × GRID cells, each the mean luma of its
            // pixels. A probe over a frosted card still sees the backdrop move through it;
            // that is a small change per cell, a scroll or a new panel is a large one.
            let (gx, gy) = (GRID.min(pw), GRID.min(ph_));
            let mut sum = vec![0u32; gx * gy];
            let mut cnt = vec![0u32; gx * gy];
            let (mut lo, mut hi) = ([255u8; 3], [0u8; 3]);
            for y in (y0..y1).step_by(step) {
                let cy = (y - y0) * gy / ph_;
                for x in (x0..x1).step_by(step) {
                    let v = px(x, y);
                    let (b, g, r) = (v as u8, (v >> 8) as u8, (v >> 16) as u8);
                    let luma = (r as u32 * 77 + g as u32 * 150 + b as u32 * 29) >> 8;
                    let cx = (x - x0) * gx / pw;
                    sum[cy * gx + cx] += luma;
                    cnt[cy * gx + cx] += 1;
                    for (c, ch) in [b, g, r].into_iter().enumerate() {
                        lo[c] = lo[c].min(ch);
                        hi[c] = hi[c].max(ch);
                    }
                }
            }
            let grid: Vec<u8> = sum.iter().zip(&cnt).map(|(s, n)| if *n > 0 { (s / n) as u8 } else { 0 }).collect();
            let flat = (0..3).all(|c| hi[c] - lo[c] <= 12);
            let mut body = json!({ "flat": flat });
            let mut prev = w.probe_prev.lock().unwrap();
            match prev.get(&p.name) {
                Some(old) if !baseline && old.len() == grid.len() => {
                    let deltas: Vec<u32> = old.iter().zip(&grid).map(|(a, b)| (*a as i32 - *b as i32).unsigned_abs()).collect();
                    let max = *deltas.iter().max().unwrap_or(&0);
                    let mean = deltas.iter().sum::<u32>() as f64 / deltas.len().max(1) as f64;
                    let changed = max >= w.probe_threshold.load(Ordering::SeqCst);
                    body["d"] = json!(max);
                    body["m"] = json!((mean * 100.0).round() / 100.0);
                    body["c"] = json!(changed);
                    if changed {
                        probe_changes.push(p.name.clone());
                    }
                }
                _ => {}
            }
            prev.insert(p.name.clone(), grid);
            probes_out.insert(p.name.clone(), body);
        }

        let changed = !baseline && *prev_hash != Some(hash);
        let want = match w.keep_probe.lock().unwrap().as_deref() {
            Some(name) => probe_changes.iter().any(|p| p == name),
            None => changed,
        };
        if want && w.keep_left.load(Ordering::SeqCst) > 0 {
            let mut buf = Vec::with_capacity((sw * sh * 4) as usize);
            for y in 0..sh as usize {
                buf.extend_from_slice(std::slice::from_raw_parts(base.add(y * pitch), sw as usize * 4));
            }
            kept = Some(buf);
        }
        d.ctx.Unmap(&staging, 0);
    }

    let t = if info.LastPresentTime != 0 { clock::from_qpc(info.LastPresentTime) } else { acq };
    let changed = !baseline && *prev_hash != Some(hash);
    *prev_hash = Some(hash);
    let mut body = json!({
        "acq": acq,
        "acc": info.AccumulatedFrames,
        "changed": changed,
        "hash": format!("{hash:016x}"),
    });
    if baseline {
        body["baseline"] = json!(true);
    }
    if !probes_out.is_empty() {
        body["probes"] = Value::Object(probes_out);
    }
    if info.ProtectedContentMaskedOut.as_bool() {
        body["protected"] = json!(true);
    }
    ev.push(t, "frame", body);

    if baseline {
        w.baseline.store(t.max(acq), Ordering::SeqCst);
    }
    if !probe_changes.is_empty() {
        let mut last = w.probe_last.lock().unwrap();
        for name in probe_changes {
            last.insert(name, t);
        }
    }
    if changed {
        w.last_change.store(t, Ordering::SeqCst);
        w.changes.fetch_add(1, Ordering::SeqCst);
        if let Some(tx) = w.change_tx.lock().unwrap().as_ref() {
            let _ = tx.send(t);
        }
    }
    // `kept` is only filled when the frame is one the armed keep wants (region or probe).
    if let Some(buf) = kept {
        let left = w.keep_left.fetch_sub(1, Ordering::SeqCst);
        if left > 0 {
            let tag = w.keep_tag.lock().unwrap().clone();
            w.kept.lock().unwrap().push(Kept { tag, t, w: sw, h: sh, bgra: buf });
        }
    }
    Ok(())
}
