//! The sound part of the sensor (music-app-comp.md §17.2, phase M2).
//!
//! **Nothing is recorded.** The owner's rule (2026-10-10): the tool must never record sound.
//! So this module keeps NO audio. Each buffer WASAPI hands over is scanned in place for one
//! thing, the first sample at or above the threshold, and released at once. No sample is
//! copied, kept in memory, sent anywhere or written to disk. The only outputs are two events:
//! `sound-on` (the time of the first loud sample after silence, and that buffer's peak in
//! dBFS, rounded) and `sound-off` (the time of the last loud sample before ≥ 250 ms of
//! silence). Do not add a level trace, a waveform, or a buffer copy here.
//!
//! The capture is PROCESS loopback (F14): only what the target process and its children play
//! (Windows 10 2004+), so another app's sound can never start or stop a measurement. Ours
//! plays from a WebView2 child of DeetsMusic.exe; Apple's from AppleMusic.exe. The activation
//! is the pattern of the shared AirPlay crate (DeetsAirplay/crates/airplay/src/capture.rs).

use crate::clock;
use crate::events::Events;
use serde_json::json;
use std::mem::ManuallyDrop;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;
use windows::core::{implement, Interface, Ref};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Media::Audio::{
    ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation, IActivateAudioInterfaceCompletionHandler,
    IActivateAudioInterfaceCompletionHandler_Impl, IAudioCaptureClient, IAudioClient, AUDCLNT_BUFFERFLAGS_SILENT,
    AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK, AUDIOCLIENT_ACTIVATION_PARAMS,
    AUDIOCLIENT_ACTIVATION_PARAMS_0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, WAVEFORMATEX, WAVE_FORMAT_PCM,
};
use windows::Win32::System::Com::StructuredStorage::{PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0};
use windows::Win32::System::Com::{CoInitializeEx, BLOB, COINIT_MULTITHREADED};
use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};
use windows::Win32::System::Variant::VT_BLOB;

const RATE: u32 = 48_000;
const CHANNELS: usize = 2;
/// Silence this long after the last loud sample ends a sound.
const OFF_AFTER_US: i64 = 250_000;

/// A running listener. Dropping it stops the capture thread.
pub struct Listen {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    /// The time (µs) of the last `sound-on`; i64::MIN before the first.
    pub last_on: Arc<AtomicI64>,
}

impl Drop for Listen {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

#[implement(IActivateAudioInterfaceCompletionHandler)]
struct Done(std::sync::mpsc::Sender<()>);

impl IActivateAudioInterfaceCompletionHandler_Impl for Done_Impl {
    fn ActivateCompleted(&self, _op: Ref<'_, IActivateAudioInterfaceAsyncOperation>) -> windows::core::Result<()> {
        self.0.send(()).ok();
        Ok(())
    }
}

fn activate(pid: u32) -> Result<IAudioClient, String> {
    unsafe {
        let params = AUDIOCLIENT_ACTIVATION_PARAMS {
            ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
            Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
                ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                    TargetProcessId: pid,
                    ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
                },
            },
        };
        // A VT_BLOB that borrows `params`. Never let this PROPVARIANT drop: PropVariantClear
        // would CoTaskMemFree a stack pointer (the AirPlay crate found that as heap corruption).
        let pv = ManuallyDrop::new(PROPVARIANT {
            Anonymous: PROPVARIANT_0 {
                Anonymous: ManuallyDrop::new(PROPVARIANT_0_0 {
                    vt: VT_BLOB,
                    wReserved1: 0,
                    wReserved2: 0,
                    wReserved3: 0,
                    Anonymous: PROPVARIANT_0_0_0 {
                        blob: BLOB {
                            cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                            pBlobData: &params as *const _ as *mut u8,
                        },
                    },
                }),
            },
        });
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        let handler: IActivateAudioInterfaceCompletionHandler = Done(tx).into();
        let op = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, &IAudioClient::IID, Some(&*pv), &handler)
            .map_err(|e| format!("ActivateAudioInterfaceAsync: {e}"))?;
        rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "process loopback activation timed out".to_string())?;
        let mut hr = windows::core::HRESULT(0);
        let mut unk: Option<windows::core::IUnknown> = None;
        op.GetActivateResult(&mut hr, &mut unk).map_err(|e| format!("GetActivateResult: {e}"))?;
        hr.ok().map_err(|e| format!("process loopback activation failed: {e}"))?;
        unk.ok_or("process loopback: no interface")?.cast::<IAudioClient>().map_err(|e| format!("IAudioClient: {e}"))
    }
}

/// The amplitude (of 32767) a threshold in dBFS stands for.
fn threshold_amp(db: f64) -> i32 {
    (32767.0 * 10f64.powf(db / 20.0)).round().max(1.0) as i32
}

/// How the sensor hears.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Method {
    /// Windows' per-session peak meter, polled about every 2 ms (the default). It sees
    /// a protected stream: on 2026-10-10 DeetsMusic's MusicKit audio reached the process
    /// loopback as digital silence (−90 dBFS) while the meter read −15.7 dBFS. Resolution
    /// about one engine period (10 ms). Reads one number per poll; no audio at all.
    Meter,
    /// Process loopback (exact to the sample, but silent for protected audio).
    Loopback,
}

impl Method {
    pub fn parse(s: &str) -> Option<Method> {
        match s {
            "meter" => Some(Method::Meter),
            "loopback" => Some(Method::Loopback),
            _ => None,
        }
    }
    fn name(self) -> &'static str {
        match self {
            Method::Meter => "meter",
            Method::Loopback => "loopback",
        }
    }
}

/// Start listening to `pid` and its children. Returns once the capture runs (or fails).
pub fn start(pid: u32, threshold_db: f64, method: Method, ev: Arc<Events>) -> Result<Listen, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let last_on = Arc::new(AtomicI64::new(i64::MIN));
    let (init_tx, init_rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let (st, lo) = (stop.clone(), last_on.clone());
    let thread = std::thread::Builder::new()
        .name("sound".into())
        .spawn(move || {
            let r = match method {
                Method::Loopback => run(pid, threshold_amp(threshold_db), &st, &lo, &ev, &init_tx),
                Method::Meter => run_meter(pid, 10f64.powf(threshold_db / 20.0) as f32, &st, &lo, &ev, &init_tx),
            };
            if let Err(e) = r {
                let _ = init_tx.send(Err(e));
            }
        })
        .map_err(|e| e.to_string())?;
    match init_rx.recv_timeout(Duration::from_secs(6)) {
        Ok(Ok(())) => Ok(Listen { stop, thread: Some(thread), last_on }),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("the sound thread did not start".into()),
    }
}

fn run(
    pid: u32,
    thr: i32,
    stop: &AtomicBool,
    last_on: &AtomicI64,
    ev: &Events,
    init: &std::sync::mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok().map_err(|e| format!("CoInitializeEx: {e}"))?;
        let client = activate(pid)?;
        let block = (CHANNELS * 2) as u16;
        let fmt = WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_PCM as u16,
            nChannels: CHANNELS as u16,
            nSamplesPerSec: RATE,
            nAvgBytesPerSec: RATE * block as u32,
            nBlockAlign: block,
            wBitsPerSample: 16,
            cbSize: 0,
        };
        // Event-driven: polled, the process-loopback device delivers nothing (the AirPlay
        // crate's finding, as in Microsoft's ApplicationLoopback sample).
        client
            .Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK, 0, 0, &fmt, None)
            .map_err(|e| format!("Initialize: {e}"))?;
        let event = CreateEventW(None, false, false, None).map_err(|e| format!("CreateEvent: {e}"))?;
        client.SetEventHandle(event).map_err(|e| format!("SetEventHandle: {e}"))?;
        let cap: IAudioCaptureClient = client.GetService().map_err(|e| format!("IAudioCaptureClient: {e}"))?;
        client.Start().map_err(|e| format!("Start: {e}"))?;
        ev.push(clock::now(), "listen", json!({ "pid": pid, "method": Method::Loopback.name(), "threshold_amp": thr, "stores_audio": false }));
        let _ = init.send(Ok(()));

        // Counts only, for "why was nothing heard": no packets (the app plays elsewhere, for
        // example to AirPlay), or packets that were all below the threshold.
        let (mut packets, mut silent, mut over) = (0u64, 0u64, 0u64);
        // The loudest packet of the whole run: one number, so "all below the threshold" can
        // say by how much. Still no audio kept.
        let mut max_peak = 0i32;
        let mut loud = false;
        let mut last_loud = i64::MIN;
        while !stop.load(Ordering::SeqCst) {
            // Woken per packet; the timeout lets a silence end a sound (a silent process
            // sends no packets at all).
            WaitForSingleObject(event, 20);
            loop {
                if cap.GetNextPacketSize().unwrap_or(0) == 0 {
                    break;
                }
                let mut data: *mut u8 = std::ptr::null_mut();
                let (mut frames, mut flags, mut qpc) = (0u32, 0u32, 0u64);
                if cap.GetBuffer(&mut data, &mut frames, &mut flags, None, Some(&mut qpc)).is_err() {
                    break;
                }
                let now = clock::now();
                // The packet's first frame, on our clock: WASAPI's QPC position is in 100 ns.
                let t_first = if qpc != 0 {
                    clock::from_100ns(qpc as i64)
                } else {
                    now - frames as i64 * 1_000_000 / RATE as i64
                };
                // Scan in place for the first and the last loud frame, and the peak. The
                // buffer is only read here, never copied, then released below.
                let (mut first, mut last, mut peak) = (None::<usize>, None::<usize>, 0i32);
                if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 == 0 && !data.is_null() {
                    let s = std::slice::from_raw_parts(data as *const i16, frames as usize * CHANNELS);
                    for (i, frame) in s.chunks_exact(CHANNELS).enumerate() {
                        let a = frame.iter().map(|v| (*v as i32).abs()).max().unwrap_or(0);
                        if a >= thr {
                            first.get_or_insert(i);
                            last = Some(i);
                        }
                        peak = peak.max(a);
                    }
                }
                let _ = cap.ReleaseBuffer(frames);
                max_peak = max_peak.max(peak);
                packets += 1;
                if first.is_some() {
                    over += 1;
                } else {
                    silent += 1;
                }
                let at = |i: usize| t_first + i as i64 * 1_000_000 / RATE as i64;
                if let (Some(f), Some(l)) = (first, last) {
                    if !loud {
                        loud = true;
                        let t = at(f);
                        last_on.store(t, Ordering::SeqCst);
                        let db = (20.0 * (peak as f64 / 32767.0).log10()).round();
                        ev.push(t, "sound-on", json!({ "peak_db": db }));
                    }
                    last_loud = at(l);
                }
            }
            if loud && clock::now() - last_loud > OFF_AFTER_US {
                loud = false;
                ev.push(last_loud, "sound-off", json!({}));
            }
        }
        ev.push(clock::now(), "listen-end", json!({ "packets": packets, "below_threshold": silent, "loud": over, "max_peak_db": if max_peak > 0 { json!((20.0 * (max_peak as f64 / 32767.0).log10()).round()) } else { serde_json::Value::Null } }));
        let _ = client.Stop();
        let _ = CloseHandle(event);
    }
    Ok(())
}

/// The meter sessions of the default output that belong to `pid`'s process tree.
unsafe fn tree_meters(
    mgr: &windows::Win32::Media::Audio::IAudioSessionManager2,
    tree: &[u32],
) -> windows::core::Result<Vec<(u32, windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation)>> {
    use windows::Win32::Media::Audio::IAudioSessionControl2;
    let list = mgr.GetSessionEnumerator()?;
    let mut out = Vec::new();
    for i in 0..list.GetCount()? {
        let s = list.GetSession(i)?;
        let Ok(s2) = s.cast::<IAudioSessionControl2>() else { continue };
        let p = s2.GetProcessId().unwrap_or(0);
        if p != 0 && tree.contains(&p) {
            if let Ok(m) = s.cast() {
                out.push((p, m));
            }
        }
    }
    Ok(out)
}

/// The meter method: poll Windows' peak meter of every session in the target's tree about
/// once a millisecond. Each poll reads ONE number per session (what the volume mixer shows);
/// no audio is read at all. A sound starts at the first poll at or over the threshold after
/// silence; it stops at the last loud poll before 250 ms under it.
fn run_meter(
    pid: u32,
    thr: f32,
    stop: &AtomicBool,
    last_on: &AtomicI64,
    ev: &Events,
    init: &std::sync::mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    use windows::Win32::Media::Audio::{eConsole, eRender, IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok().map_err(|e| format!("CoInitializeEx: {e}"))?;
        let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| format!("device enumerator: {e}"))?;
        let dev = en.GetDefaultAudioEndpoint(eRender, eConsole).map_err(|e| format!("default output: {e}"))?;
        let mgr: IAudioSessionManager2 = dev.Activate(CLSCTX_ALL, None).map_err(|e| format!("session manager: {e}"))?;
        // The process tree is a snapshot of every process on the PC: costly. Rebuilt every 2 s;
        // the session list (cheap) every 250 ms.
        let mut tree = crate::win::tree(pid);
        let mut tree_at = clock::now();
        let mut meters = tree_meters(&mgr, &tree).map_err(|e| format!("sessions: {e}"))?;
        ev.push(clock::now(), "listen", json!({
            "pid": pid, "method": Method::Meter.name(), "threshold": thr, "sessions": meters.len(), "stores_audio": false,
        }));
        let _ = init.send(Ok(()));

        let (mut polls, mut over) = (0u64, 0u64);
        let mut max_peak = 0f32;
        let mut loud = false;
        let mut last_loud = i64::MIN;
        let mut refreshed = clock::now();
        let (cpu0, t0) = (crate::screen::thread_cpu_us(), clock::now());
        while !stop.load(Ordering::SeqCst) {
            let now = clock::now();
            // A player may open its session only when it starts playing: look again 4× a second.
            if now - refreshed > 250_000 {
                if now - tree_at > 2_000_000 {
                    tree = crate::win::tree(pid);
                    tree_at = now;
                }
                if let Ok(m) = tree_meters(&mgr, &tree) {
                    meters = m;
                }
                refreshed = now;
            }
            let mut peak = 0f32;
            for (_, m) in &meters {
                peak = peak.max(m.GetPeakValue().unwrap_or(0.0));
            }
            let t = clock::now();
            polls += 1;
            max_peak = max_peak.max(peak);
            if peak >= thr {
                over += 1;
                if !loud {
                    loud = true;
                    last_on.store(t, Ordering::SeqCst);
                    ev.push(t, "sound-on", json!({ "peak_db": (20.0 * (peak as f64).log10()).round(), "via": "meter" }));
                }
                last_loud = t;
            } else if loud && t - last_loud > OFF_AFTER_US {
                loud = false;
                ev.push(last_loud, "sound-off", json!({ "via": "meter" }));
            }
            // 2 ms: the meter itself moves once per engine period (10 ms), so a faster poll
            // only costs CPU (1 ms polling measured about 9 % of a core, 2026-10-10).
            std::thread::sleep(Duration::from_millis(2));
        }
        let max_db = if max_peak > 0.0 { json!((20.0 * (max_peak as f64).log10()).round()) } else { serde_json::Value::Null };
        let cpu_pct = (crate::screen::thread_cpu_us() - cpu0) as f64 / (clock::now() - t0).max(1) as f64 * 100.0;
        ev.push(clock::now(), "listen-end", json!({ "polls": polls, "loud": over, "max_peak_db": max_db, "sessions": meters.len(), "cpu_pct": cpu_pct }));
    }
    Ok(())
}
