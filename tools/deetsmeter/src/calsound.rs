//! `deetsmeter calibrate-sound` — the floor of the sound method (music-app-comp.md §17.4).
//!
//! The tool plays N short, quiet blips itself (40 ms of 1 kHz at −36 dBFS) on the default
//! output, and listens to its OWN process with the same process loopback as a run. The time
//! from writing a blip into the render buffer to hearing it in the loopback is the floor:
//! an app's input → sound includes at least this. Like every part of the tool, nothing is
//! recorded: the listener only times when sound starts (audio.rs).

use crate::audio;
use crate::clock;
use crate::events::Events;
use serde_json::json;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioClient, IAudioRenderClient, IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT,
    AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, WAVEFORMATEX,
    WAVE_FORMAT_PCM,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

const RATE: u32 = 48_000;
const BLIP_FRAMES: usize = (RATE as usize) * 40 / 1000;
/// −36 dBFS: a soft tick at a normal volume, far above the −60 dBFS onset threshold.
const AMP: f64 = 32767.0 * 0.015_85;

fn pct(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return f64::NAN;
    }
    sorted[((sorted.len() - 1) as f64 * p).round() as usize]
}

pub fn run(rounds: u32, method: audio::Method, out: Option<&Path>) -> i32 {
    let events = Arc::new(Events::new());
    let listen = match audio::start(std::process::id(), -60.0, method, events.clone()) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[deetsmeter] cannot listen: {e}");
            return 3;
        }
    };
    let r = unsafe { play_and_time(rounds, &listen, &events) };
    drop(listen);
    let (lat, missed, period_ms) = match r {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[deetsmeter] cannot play the blips: {e}");
            return 3;
        }
    };
    let mut s = lat.clone();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("deetsmeter calibrate-sound — default output, {method:?} method, engine period {period_ms:.1} ms");
    println!(
        "  floor  write → heard: median {:.1} ms · p90 {:.1} · min {:.1} · max {:.1}  ({} blips, {} missed)",
        pct(&s, 0.5),
        pct(&s, 0.9),
        pct(&s, 0.0),
        pct(&s, 1.0),
        s.len(),
        missed
    );
    println!("  no audio was stored");
    events.push(clock::now(), "calibrate-sound", json!({
        "floor_ms": { "median": pct(&s, 0.5), "p90": pct(&s, 0.9), "min": pct(&s, 0.0), "max": pct(&s, 1.0), "n": s.len(), "missed": missed },
        "period_ms": period_ms,
        "method": format!("{method:?}"),
    }));
    if let Some(dir) = out {
        let _ = std::fs::create_dir_all(dir);
        let _ = events.write(&dir.join("events.jsonl"));
    }
    if missed > rounds / 4 {
        4
    } else {
        0
    }
}

/// Play the blips on a shared-mode render stream and time each one. Returns
/// (write → heard per blip in ms, blips not heard, the engine period in ms).
unsafe fn play_and_time(rounds: u32, listen: &audio::Listen, ev: &Events) -> windows::core::Result<(Vec<f64>, u32, f64)> {
    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
    let dev = en.GetDefaultAudioEndpoint(eRender, eConsole)?;
    if let Ok(id) = dev.GetId() {
        println!("  default output endpoint {}", id.to_string().unwrap_or_default());
        windows::Win32::System::Com::CoTaskMemFree(Some(id.0 as *const _));
    }
    let client: IAudioClient = dev.Activate(CLSCTX_ALL, None)?;
    let fmt = WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_PCM as u16,
        nChannels: 2,
        nSamplesPerSec: RATE,
        nAvgBytesPerSec: RATE * 4,
        nBlockAlign: 4,
        wBitsPerSample: 16,
        cbSize: 0,
    };
    // 20 ms of buffer; the engine converts our 48k/16/2 to its own mix format.
    client.Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        (AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY) as u32,
        200_000,
        0,
        &fmt,
        None,
    )?;
    let (mut def, mut min) = (0i64, 0i64);
    let _ = client.GetDevicePeriod(Some(&mut def), Some(&mut min));
    let period_ms = def as f64 / 10_000.0;
    let size = client.GetBufferSize()?;
    let rc: IAudioRenderClient = client.GetService()?;
    client.Start()?;

    let mut lat = Vec::new();
    let mut missed = 0u32;
    // Silence first, so the stream runs before the first blip.
    let fill = |tone: Option<&mut usize>| -> windows::core::Result<Option<i64>> {
        let pad = client.GetCurrentPadding()?;
        let avail = (size - pad) as usize;
        if avail == 0 {
            return Ok(None);
        }
        let buf = rc.GetBuffer(avail as u32)?;
        match tone {
            Some(left) if *left > 0 => {
                let n = avail.min(*left);
                let s = std::slice::from_raw_parts_mut(buf as *mut i16, avail * 2);
                let done = BLIP_FRAMES - *left;
                for i in 0..avail {
                    let v = if i < n {
                        let k = (done + i) as f64;
                        (AMP * (2.0 * std::f64::consts::PI * 1000.0 * k / RATE as f64).sin()) as i16
                    } else {
                        0
                    };
                    s[i * 2] = v;
                    s[i * 2 + 1] = v;
                }
                // The blip starts after what is already queued: `pad` frames from now.
                let t = clock::now() + if done == 0 { pad as i64 * 1_000_000 / RATE as i64 } else { 0 };
                rc.ReleaseBuffer(avail as u32, 0)?;
                *left -= n;
                Ok(if done == 0 { Some(t) } else { None })
            }
            _ => {
                rc.ReleaseBuffer(avail as u32, AUDCLNT_BUFFERFLAGS_SILENT.0 as u32)?;
                Ok(None)
            }
        }
    };
    let until = clock::now() + 300_000;
    while clock::now() < until {
        fill(None)?;
        std::thread::sleep(Duration::from_millis(5));
    }
    for i in 0..rounds {
        let mut left = BLIP_FRAMES;
        let mut written: Option<i64> = None;
        let before = listen.last_on.load(Ordering::SeqCst);
        let deadline = clock::now() + 1_000_000;
        while clock::now() < deadline {
            if let Some(t) = fill(Some(&mut left))? {
                written = Some(t);
                ev.push(t, "blip", json!({ "round": i }));
            }
            let on = listen.last_on.load(Ordering::SeqCst);
            if on != before && written.is_some() {
                lat.push((on - written.unwrap()) as f64 / 1000.0);
                break;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        if listen.last_on.load(Ordering::SeqCst) == before {
            missed += 1;
        }
        // Silence long enough for the listener to call the blip over (250 ms), plus a
        // spacing that does not sit on the engine period.
        let gap_until = clock::now() + 400_000 + (i as i64 * 7_000) % 30_000;
        while clock::now() < gap_until {
            fill(None)?;
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    client.Stop()?;
    Ok((lat, missed, period_ms))
}
