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
    /// CPU time (µs) the capture thread has used: the sensor's own cost, apart from anything
    /// else in the process (the calibrate window draws in this process too).
    pub cpu_us: AtomicU64,
    /// Set for a new "before" picture of every probe (a probe added just before a press),
    /// read from the GPU copy of the last real frame (`rebase`).
    pub rebase: AtomicBool,
    /// Keeping frames stops at this time (µs) whatever is left (`arm_keep`).
    pub keep_until: AtomicI64,
    /// Keep the next frame read, whatever it shows (the `snap` step).
    pub snap: AtomicBool,
    pub snap_tag: Mutex<String>,
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
            cpu_us: AtomicU64::new(0),
            rebase: AtomicBool::new(false),
            keep_until: AtomicI64::new(i64::MIN),
            snap: AtomicBool::new(false),
            snap_tag: Mutex::new(String::new()),
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
        // A 3 s limit: an armed keep the frames never fill must not run on (it also keeps the
        // whole-region read, the costly path, switched on).
        self.keep_until.store(clock::now() + 3_000_000, Ordering::SeqCst);
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
    /// One small staging texture per probe (probes-only frames copy just these).
    probe_staging: HashMap<String, Option<(ID3D11Texture2D, u32, u32, DXGI_FORMAT)>>,
    /// The output's rotation in degrees (0, 90, 180, 270). Desktop Duplication hands over the
    /// image in the PANEL's own orientation: on a portrait monitor it is sideways. Found
    /// 2026-10-10 on the owner's left monitor: the region was cut from the unrotated image
    /// with rotated coordinates, so a run measured a sideways patch of another app.
    rot: u32,
    /// A GPU-side copy of the region from the last REAL frame (in the duplication's own
    /// orientation). A new "before" picture (a probe added before a press, a snap) is read
    /// from it. Re-opening the duplication for that does not work: its first frame is a
    /// placeholder (AccumulatedFrames 0, LastPresentTime 0) whose image is not the screen
    /// (found 2026-10-10: every such baseline read the Play button as flat).
    last: Option<(ID3D11Texture2D, u32, u32, DXGI_FORMAT)>,
}

impl Dup {
    /// An output-local rectangle (as the user sees it) in the duplication's own image.
    fn tex_rect(&self, r: Rect) -> Rect {
        tex_rect(self.out, self.rot, r)
    }
}

fn tex_rect(out: Rect, rot: u32, r: Rect) -> Rect {
    let (w, h) = (out.w, out.h);
    match rot {
        270 => Rect { x: h - (r.y + r.h), y: r.x, w: r.h, h: r.w },
        90 => Rect { x: r.y, y: w - (r.x + r.w), w: r.h, h: r.w },
        180 => Rect { x: w - (r.x + r.w), y: h - (r.y + r.h), w: r.w, h: r.h },
        _ => r,
    }
}

/// Turn a mapped box of the duplication's image back to the user's orientation: `lw × lh`
/// pixels, BGRA, tightly packed. Only called on a rotated output.
unsafe fn derotate(base: *const u8, pitch: usize, rot: u32, lw: usize, lh: usize) -> Vec<u8> {
    let mut out = vec![0u8; lw * lh * 4];
    for ly in 0..lh {
        for lx in 0..lw {
            let (sx, sy) = match rot {
                270 => (lh - 1 - ly, lx),
                90 => (ly, lw - 1 - lx),
                180 => (lw - 1 - lx, lh - 1 - ly),
                _ => (lx, ly),
            };
            let s = base.add(sy * pitch + sx * 4);
            std::ptr::copy_nonoverlapping(s, out.as_mut_ptr().add((ly * lw + lx) * 4), 4);
        }
    }
    out
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
                // DXGI_MODE_ROTATION: 2 = 90°, 3 = 180°, 4 = 270° (1 identity, 0 unspecified).
                let rot = match dup.GetDesc().Rotation.0 {
                    2 => 90,
                    3 => 180,
                    4 => 270,
                    _ => 0,
                };
                return Ok((Dup { ctx: ctx.unwrap(), dev, dup, out, staging: None, probe_staging: HashMap::new(), rot, last: None }, name, hz));
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

    let mut tick = 0u32;
    while !w.stop.load(Ordering::SeqCst) {
        tick = tick.wrapping_add(1);
        if tick % 16 == 0 {
            w.cpu_us.store(thread_cpu_us(), Ordering::SeqCst);
        }
        let Some(region) = *w.region.lock().unwrap() else {
            std::thread::sleep(Duration::from_millis(2));
            continue;
        };
        if cur_region != Some(region) {
            // A new region (it may sit on another monitor): open again. The baseline is the
            // first REAL frame after it (the window move makes one); see `handle_frame`.
            dup = None;
            cur_region = Some(region);
        }
        if dup.is_none() {
            match open_for(region.x + region.w / 2, region.y + region.h / 2) {
                Ok((d, name, hz)) => {
                    w.hz.store(hz, Ordering::SeqCst);
                    ev.push(clock::now(), "output", json!({ "name": name, "rect": d.out.json(), "hz": hz, "rotation": d.rot, "region": region.json() }));
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
        if w.rebase.swap(false, Ordering::SeqCst) {
            match rebase(w, ev, d, region) {
                Ok(true) => {}
                // No copy of the region yet: the next real frame is the baseline.
                Ok(false) => prev_hash = None,
                Err(e) => {
                    ev.push(clock::now(), "screen-error", json!({ "where": "rebase", "code": format!("{:#x}", e.code().0), "msg": e.message() }));
                    prev_hash = None;
                }
            }
        }
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

/// A desktop rectangle in output-local pixels, clipped to the output.
fn clip_to(out: Rect, r: Rect) -> Option<Rect> {
    let x0 = (r.x - out.x).max(0);
    let y0 = (r.y - out.y).max(0);
    let x1 = (r.x + r.w - out.x).min(out.w);
    let y1 = (r.y + r.h - out.y).min(out.h);
    (x1 > x0 && y1 > y0).then_some(Rect { x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
}

/// A new "before" picture from the GPU copy of the last real frame (`Dup::last`): every
/// probe's grid, and the snap frame if one is asked for. Returns false when there is no copy
/// yet (then the next real frame is the baseline).
fn rebase(w: &Watch, ev: &Events, d: &mut Dup, region: Rect) -> windows::core::Result<bool> {
    let Some((last, lw, lh, fmt)) = d.last.clone() else { return Ok(false) };
    let Some(local) = clip_to(d.out, region) else { return Ok(false) };
    let tl = d.tex_rect(local);
    if tl.w as u32 != lw || tl.h as u32 != lh {
        return Ok(false);
    }
    let (sw, sh) = (local.w as usize, local.h as usize);
    let staging = staging_for(&d.dev, &mut d.staging, lw, lh, fmt)?;
    let mut body = Map::new();
    let mut snapped: Option<Vec<u8>> = None;
    unsafe {
        d.ctx.CopySubresourceRegion(&staging, 0, 0, 0, 0, &last, 0, None);
        let mut m = D3D11_MAPPED_SUBRESOURCE::default();
        d.ctx.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut m))?;
        let (base, pitch) = (m.pData as *const u8, m.RowPitch as usize);
        let probes: Vec<(String, Rect)> = w.probes.lock().unwrap().iter().filter_map(|p| clip_to(d.out, p.r).map(|r| (p.name.clone(), r))).collect();
        for (name, r) in &probes {
            let tr = d.tex_rect(*r);
            let (ox, oy) = (tr.x - tl.x, tr.y - tl.y);
            if ox < 0 || oy < 0 || ox + tr.w > tl.w || oy + tr.h > tl.h {
                continue;
            }
            let g = if d.rot == 0 {
                read_grid(base, pitch, ox as usize, oy as usize, (ox + tr.w) as usize, (oy + tr.h) as usize)
            } else {
                let buf = derotate(base.add(oy as usize * pitch + ox as usize * 4), pitch, d.rot, r.w as usize, r.h as usize);
                read_grid(buf.as_ptr(), r.w as usize * 4, 0, 0, r.w as usize, r.h as usize)
            };
            body.insert(name.clone(), json!({ "flat": g.flat }));
            judge_probe(w, name, g, true);
        }
        if w.snap.load(Ordering::SeqCst) {
            snapped = Some(if d.rot == 0 {
                let mut buf = Vec::with_capacity(sw * sh * 4);
                for y in 0..sh {
                    buf.extend_from_slice(std::slice::from_raw_parts(base.add(y * pitch), sw * 4));
                }
                buf
            } else {
                derotate(base, pitch, d.rot, sw, sh)
            });
        }
        d.ctx.Unmap(&staging, 0);
    }
    let t = clock::now();
    if let Some(buf) = snapped {
        let tag = w.snap_tag.lock().unwrap().clone();
        w.kept.lock().unwrap().push(Kept { tag, t, w: sw as u32, h: sh as u32, bgra: buf });
        w.snap.store(false, Ordering::SeqCst);
    }
    ev.push(t, "rebase", json!({ "probes": Value::Object(body) }));
    w.baseline.store(t, Ordering::SeqCst);
    Ok(true)
}

/// One probe's brightness grid, read from a mapped BGRA image.
struct Grid {
    cells: Vec<u8>,
    flat: bool,
}

/// Read a probe as a brightness grid: up to GRID × GRID cells, each the mean luma of its
/// pixels. A probe over a frosted card still sees the backdrop move through it; that is a
/// small change per cell, a scroll or a new panel is a large one. `(x0, y0)` to `(x1, y1)`
/// are pixels of the mapped image.
unsafe fn read_grid(base: *const u8, pitch: usize, x0: usize, y0: usize, x1: usize, y1: usize) -> Grid {
    let (pw, ph) = (x1 - x0, y1 - y0);
    let step = (((pw * ph) as f64 / 16384.0).sqrt().ceil() as usize).max(1);
    let (gx, gy) = (GRID.min(pw), GRID.min(ph));
    let mut sum = vec![0u32; gx * gy];
    let mut cnt = vec![0u32; gx * gy];
    let (mut lo, mut hi) = ([255u8; 3], [0u8; 3]);
    for y in (y0..y1).step_by(step) {
        let row = base.add(y * pitch);
        let cy = (y - y0) * gy / ph;
        for x in (x0..x1).step_by(step) {
            let v = std::ptr::read_unaligned(row.add(x * 4) as *const u32);
            let (b, g, r) = (v as u8, (v >> 8) as u8, (v >> 16) as u8);
            let luma = (r as u32 * 77 + g as u32 * 150 + b as u32 * 29) >> 8;
            let i = cy * gx + (x - x0) * gx / pw;
            sum[i] += luma;
            cnt[i] += 1;
            for (c, ch) in [b, g, r].into_iter().enumerate() {
                lo[c] = lo[c].min(ch);
                hi[c] = hi[c].max(ch);
            }
        }
    }
    Grid {
        cells: sum.iter().zip(&cnt).map(|(s, n)| if *n > 0 { (s / n) as u8 } else { 0 }).collect(),
        flat: (0..3).all(|c| hi[c] - lo[c] <= 12),
    }
}

/// A staging texture of the given size and format, reused while they stay the same.
fn staging_for(dev: &ID3D11Device, slot: &mut Option<(ID3D11Texture2D, u32, u32, DXGI_FORMAT)>, w: u32, h: u32, f: DXGI_FORMAT) -> windows::core::Result<ID3D11Texture2D> {
    texture_for(dev, slot, w, h, f, true)
}

/// A texture of the given size and format, reused while they stay the same: a staging one
/// (the CPU reads it) or a GPU-only one (the copy of the region, `Dup::last`).
fn texture_for(dev: &ID3D11Device, slot: &mut Option<(ID3D11Texture2D, u32, u32, DXGI_FORMAT)>, w: u32, h: u32, f: DXGI_FORMAT, staging: bool) -> windows::core::Result<ID3D11Texture2D> {
    if let Some((t, w0, h0, f0)) = slot {
        if *w0 == w && *h0 == h && *f0 == f {
            return Ok(t.clone());
        }
    }
    let sd = D3D11_TEXTURE2D_DESC {
        Width: w,
        Height: h,
        MipLevels: 1,
        ArraySize: 1,
        Format: f,
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Usage: if staging { D3D11_USAGE_STAGING } else { windows::Win32::Graphics::Direct3D11::D3D11_USAGE_DEFAULT },
        BindFlags: 0,
        CPUAccessFlags: if staging { D3D11_CPU_ACCESS_READ.0 as u32 } else { 0 },
        MiscFlags: 0,
    };
    let mut t: Option<ID3D11Texture2D> = None;
    unsafe { dev.CreateTexture2D(&sd, None, Some(&mut t))? };
    let t = t.unwrap();
    *slot = Some((t.clone(), w, h, f));
    Ok(t)
}

fn bx(r: Rect) -> D3D11_BOX {
    D3D11_BOX { left: r.x as u32, top: r.y as u32, front: 0, right: (r.x + r.w) as u32, bottom: (r.y + r.h) as u32, back: 1 }
}

/// Fold one probe's new grid into its history: returns the frame-event body for it, and
/// whether it CHANGED (one cell moved by at least the threshold).
fn judge_probe(w: &Watch, name: &str, g: Grid, baseline: bool) -> (Value, bool) {
    let mut body = json!({ "flat": g.flat });
    let mut changed = false;
    let mut prev = w.probe_prev.lock().unwrap();
    if let Some(old) = prev.get(name) {
        if !baseline && old.len() == g.cells.len() {
            let mut max = 0u32;
            let mut total = 0u32;
            for (a, b) in old.iter().zip(&g.cells) {
                let dlt = (*a as i32 - *b as i32).unsigned_abs();
                max = max.max(dlt);
                total += dlt;
            }
            let mean = total as f64 / g.cells.len().max(1) as f64;
            changed = max >= w.probe_threshold.load(Ordering::SeqCst);
            body["d"] = json!(max);
            body["m"] = json!((mean * 100.0).round() / 100.0);
            body["c"] = json!(changed);
        }
    }
    prev.insert(name.to_string(), g.cells);
    (body, changed)
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
    // No present time: a pointer-only update, or the placeholder a fresh duplication hands
    // over first (its image is not the screen). Neither is a picture, so neither is read,
    // and neither can be a baseline: the baseline is the first REAL frame.
    if info.LastPresentTime == 0 {
        return Ok(());
    }
    // The region in output-local pixels, clipped to the output.
    let clip = |r: Rect| -> Option<Rect> {
        let x0 = (r.x - d.out.x).max(0);
        let y0 = (r.y - d.out.y).max(0);
        let x1 = (r.x + r.w - d.out.x).min(d.out.w);
        let y1 = (r.y + r.h - d.out.y).min(d.out.h);
        (x1 > x0 && y1 > y0).then_some(Rect { x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
    };
    let Some(local) = clip(region) else { return Ok(()) };

    // The rectangles DWM redrew this frame (dirty + move destinations), in output pixels.
    // `None` means "unknown, treat everything as redrawn" (a baseline, or no metadata).
    let mut redrawn: Option<Vec<RECT>> = None;
    if !baseline && info.TotalMetadataBufferSize > 0 {
        let mut list = Vec::new();
        unsafe {
            let mut need = 0u32;
            let rsz = std::mem::size_of::<RECT>();
            let bytes = (dirty.len() * rsz) as u32;
            if d.dup.GetFrameDirtyRects(bytes, dirty.as_mut_ptr(), &mut need).is_err() && need > bytes {
                dirty.resize(need as usize / rsz + 1, RECT::default());
                let bytes = (dirty.len() * rsz) as u32;
                d.dup.GetFrameDirtyRects(bytes, dirty.as_mut_ptr(), &mut need)?;
            }
            list.extend_from_slice(&dirty[..(need as usize / rsz).min(dirty.len())]);

            let mut need = 0u32;
            let msz = std::mem::size_of::<DXGI_OUTDUPL_MOVE_RECT>();
            let bytes = (moves.len() * msz) as u32;
            if d.dup.GetFrameMoveRects(bytes, moves.as_mut_ptr(), &mut need).is_err() && need > bytes {
                moves.resize(need as usize / msz + 1, DXGI_OUTDUPL_MOVE_RECT::default());
                let bytes = (moves.len() * msz) as u32;
                d.dup.GetFrameMoveRects(bytes, moves.as_mut_ptr(), &mut need)?;
            }
            list.extend(moves[..(need as usize / msz).min(moves.len())].iter().map(|m| m.DestinationRect));
        }
        // Dirty and move rectangles are in the duplication's own (unrotated) image.
        let tl = d.tex_rect(local);
        if !list.iter().any(|r| tl.hits(r)) {
            return Ok(());
        }
        redrawn = Some(list);
    }
    let (out, rot) = (d.out, d.rot);
    let touched = |r: &Rect| {
        let t = tex_rect(out, rot, *r);
        redrawn.as_ref().is_none_or(|l| l.iter().any(|x| t.hits(x)))
    };

    let Some(res) = res else { return Ok(()) };
    let tex: ID3D11Texture2D = res.cast()?;
    let mut desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { tex.GetDesc(&mut desc) };

    // Keep the GPU copy of the region current (a copy on the graphics card, no read-back):
    // a later "before" picture is read from it (`rebase`).
    {
        let tl = d.tex_rect(local);
        let last = texture_for(&d.dev, &mut d.last, tl.w as u32, tl.h as u32, desc.Format, false)?;
        unsafe { d.ctx.CopySubresourceRegion(&last, 0, 0, 0, 0, &tex, 0, Some(&bx(tl))) };
    }

    let probes: Vec<(String, Rect)> = w.probes.lock().unwrap().iter().filter_map(|p| clip(p.r).map(|r| (p.name.clone(), r))).collect();
    // Keeping frames ends after its time limit: it must never run on after the window has
    // left (a kept frame once showed the terminal behind it, 2026-10-10).
    let keep_live = w.keep_left.load(Ordering::SeqCst) > 0 && clock::now() < w.keep_until.load(Ordering::SeqCst);
    let keeping = keep_live || w.snap.load(Ordering::SeqCst);
    // The whole region is read back only when it must be: no probes (the region IS the
    // measure, as in calibrate), or frames are being kept. Otherwise only the probes that
    // DWM redrew this frame are copied: a probe nothing touched has not changed.
    let full = probes.is_empty() || keeping;

    let mut probes_out = Map::new();
    let mut probe_changes: Vec<String> = Vec::new();
    let mut hash: Option<u64> = None;
    let mut kept: Option<Vec<u8>> = None;
    let (sw, sh) = (local.w as u32, local.h as u32);

    if full {
        let tl = d.tex_rect(local);
        let staging = staging_for(&d.dev, &mut d.staging, tl.w as u32, tl.h as u32, desc.Format)?;
        unsafe {
            d.ctx.CopySubresourceRegion(&staging, 0, 0, 0, 0, &tex, 0, Some(&bx(tl)));
            let mut m = D3D11_MAPPED_SUBRESOURCE::default();
            d.ctx.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut m))?;
            // The mapped box is in the duplication's own orientation (sideways on a portrait
            // monitor). The hash reads it as it is: any fixed order of the same pixels is a
            // valid change test. Only probe boxes and kept frames are turned upright.
            let (base, pitch) = (m.pData as *const u8, m.RowPitch as usize);
            let mut h = FNV_OFFSET;
            for y in (0..tl.h as usize).step_by(8) {
                let row = base.add(y * pitch);
                for x in (0..tl.w as usize).step_by(8) {
                    h = fnv(h, std::ptr::read_unaligned(row.add(x * 4) as *const u32));
                }
            }
            hash = Some(h);
            for (name, r) in &probes {
                let g = if d.rot == 0 {
                    let (x0, y0) = ((r.x - local.x).max(0) as usize, (r.y - local.y).max(0) as usize);
                    let (x1, y1) = (((r.x + r.w - local.x) as usize).min(sw as usize), ((r.y + r.h - local.y) as usize).min(sh as usize));
                    if x1 <= x0 || y1 <= y0 {
                        continue;
                    }
                    read_grid(base, pitch, x0, y0, x1, y1)
                } else {
                    // The probe's box inside the mapped region box, turned upright on its own.
                    let tr = d.tex_rect(*r);
                    let (ox, oy) = (tr.x - tl.x, tr.y - tl.y);
                    if ox < 0 || oy < 0 || ox + tr.w > tl.w || oy + tr.h > tl.h {
                        continue;
                    }
                    let buf = derotate(base.add(oy as usize * pitch + ox as usize * 4), pitch, d.rot, r.w as usize, r.h as usize);
                    read_grid(buf.as_ptr(), r.w as usize * 4, 0, 0, r.w as usize, r.h as usize)
                };
                let (body, c) = judge_probe(w, name, g, baseline);
                if c {
                    probe_changes.push(name.clone());
                }
                probes_out.insert(name.clone(), body);
            }
            let region_changed = !baseline && *prev_hash != Some(h);
            let want = match w.keep_probe.lock().unwrap().as_deref() {
                Some(name) => probe_changes.iter().any(|p| p == name),
                None => region_changed,
            };
            if (want && keep_live) || w.snap.load(Ordering::SeqCst) {
                kept = Some(if d.rot == 0 {
                    let mut buf = Vec::with_capacity((sw * sh * 4) as usize);
                    for y in 0..sh as usize {
                        buf.extend_from_slice(std::slice::from_raw_parts(base.add(y * pitch), sw as usize * 4));
                    }
                    buf
                } else {
                    derotate(base, pitch, d.rot, sw as usize, sh as usize)
                });
            }
            d.ctx.Unmap(&staging, 0);
        }
    } else {
        // Copy every touched probe first, then map them: the first Map waits for the GPU,
        // the rest are ready by then.
        let mut todo: Vec<(String, ID3D11Texture2D, u32, u32)> = Vec::new();
        for (name, r) in &probes {
            if !touched(r) {
                continue;
            }
            let tr = d.tex_rect(*r);
            let slot = d.probe_staging.entry(name.clone()).or_default();
            let t = staging_for(&d.dev, slot, tr.w as u32, tr.h as u32, desc.Format)?;
            unsafe { d.ctx.CopySubresourceRegion(&t, 0, 0, 0, 0, &tex, 0, Some(&bx(tr))) };
            todo.push((name.clone(), t, r.w as u32, r.h as u32));
        }
        for (name, t, pw, ph) in todo {
            let g = unsafe {
                let mut m = D3D11_MAPPED_SUBRESOURCE::default();
                d.ctx.Map(&t, 0, D3D11_MAP_READ, 0, Some(&mut m))?;
                let g = if d.rot == 0 {
                    read_grid(m.pData as *const u8, m.RowPitch as usize, 0, 0, pw as usize, ph as usize)
                } else {
                    let buf = derotate(m.pData as *const u8, m.RowPitch as usize, d.rot, pw as usize, ph as usize);
                    read_grid(buf.as_ptr(), pw as usize * 4, 0, 0, pw as usize, ph as usize)
                };
                d.ctx.Unmap(&t, 0);
                g
            };
            let (body, c) = judge_probe(w, &name, g, baseline);
            if c {
                probe_changes.push(name.clone());
            }
            probes_out.insert(name, body);
        }
    }

    let t = if info.LastPresentTime != 0 { clock::from_qpc(info.LastPresentTime) } else { acq };
    // With the region read: CHANGED = its hash moved. Probes only: the region was redrawn
    // (the probes say whether anything that matters changed).
    let changed = match hash {
        Some(h) => {
            let c = !baseline && *prev_hash != Some(h);
            *prev_hash = Some(h);
            c
        }
        None => {
            if prev_hash.is_none() {
                *prev_hash = Some(0);
            }
            !baseline
        }
    };
    let mut body = json!({ "acq": acq, "acc": info.AccumulatedFrames, "changed": changed });
    if let Some(h) = hash {
        body["hash"] = json!(format!("{h:016x}"));
    }
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
    // `kept` is only filled when the frame is one the armed keep wants (region or probe), or
    // when a snap asked for the next frame whatever it shows.
    if let Some(buf) = kept {
        if w.snap.swap(false, Ordering::SeqCst) {
            let tag = w.snap_tag.lock().unwrap().clone();
            w.kept.lock().unwrap().push(Kept { tag, t, w: sw, h: sh, bgra: buf });
        } else {
            let left = w.keep_left.fetch_sub(1, Ordering::SeqCst);
            if left > 0 {
                let tag = w.keep_tag.lock().unwrap().clone();
                w.kept.lock().unwrap().push(Kept { tag, t, w: sw, h: sh, bgra: buf });
            }
        }
    }
    Ok(())
}

/// This thread's CPU time (kernel + user), in µs.
pub(crate) fn thread_cpu_us() -> u64 {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::{GetCurrentThread, GetThreadTimes};
    let ft = |f: FILETIME| ((f.dwHighDateTime as u64) << 32 | f.dwLowDateTime as u64) / 10;
    let (mut c, mut e, mut k, mut u) = (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
    unsafe {
        if GetThreadTimes(GetCurrentThread(), &mut c, &mut e, &mut k, &mut u).is_err() {
            return 0;
        }
    }
    ft(k) + ft(u)
}
