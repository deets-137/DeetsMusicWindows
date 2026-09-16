//! The Windows audio output (SOUND.md §2.2, §3B, §3C — phase 4).
//!
//! Sound needs three facts about where the music goes: which device (so the EQ remembers a
//! preset per output), its form factor (so crossfeed turns on for headphones), and the Windows
//! master volume (so Fuller at low volume follows App × Windows). One thread holds the COM
//! objects and waits on a channel. Windows calls two notice objects when the default output
//! changes or its volume moves; they only send a message, and the thread does the reads and
//! emits `audio-output` to the front end. No polling: an idle output costs nothing.
//!
//! Limit: this is the default output for the console role, the one WebView2 plays to. An
//! app-specific output set in Windows' "App volume and device preferences" is not followed.

use serde::Serialize;
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use windows::core::{implement, PCWSTR};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::Media::Audio::Endpoints::{IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl};
use windows::Win32::Media::Audio::{
    eConsole, eRender, EDataFlow, ERole, IMMDevice, IMMDeviceEnumerator, IMMNotificationClient, IMMNotificationClient_Impl,
    MMDeviceEnumerator, AUDIO_VOLUME_NOTIFICATION_DATA, DEVICE_STATE, PKEY_AudioEndpoint_FormFactor,
};
use windows::Win32::System::Com::StructuredStorage::{PropVariantToStringAlloc, PropVariantToUInt32};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ};

/// What the front end reads (`sound.ts` → `SoundOutput` + the Windows master).
#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutput {
    /// `win:<endpoint id>` — the per-output preset key.
    pub key: String,
    pub name: String,
    /// speakers | headphones | headset | unknown
    pub kind: String,
    /// The Windows volume slider, 0..1.
    pub volume: f32,
    /// The attenuation that slider applies, in dB (0 at the top).
    pub volume_db: f32,
    pub muted: bool,
}

static CURRENT: Mutex<Option<AudioOutput>> = Mutex::new(None);

enum Msg {
    Device,
    Volume,
}

#[implement(IMMNotificationClient)]
struct DeviceNotice {
    tx: Mutex<Sender<Msg>>,
}

impl DeviceNotice_Impl {
    fn send(&self) {
        if let Ok(tx) = self.tx.lock() {
            let _ = tx.send(Msg::Device);
        }
    }
}

// Windows calls these on its own threads. They only send; reading or registering inside a
// callback is not allowed.
impl IMMNotificationClient_Impl for DeviceNotice_Impl {
    fn OnDeviceStateChanged(&self, _id: &PCWSTR, _state: DEVICE_STATE) -> windows::core::Result<()> {
        Ok(())
    }
    fn OnDeviceAdded(&self, _id: &PCWSTR) -> windows::core::Result<()> {
        Ok(())
    }
    fn OnDeviceRemoved(&self, _id: &PCWSTR) -> windows::core::Result<()> {
        Ok(())
    }
    fn OnDefaultDeviceChanged(&self, flow: EDataFlow, role: ERole, _id: &PCWSTR) -> windows::core::Result<()> {
        if flow == eRender && role == eConsole {
            self.send();
        }
        Ok(())
    }
    fn OnPropertyValueChanged(&self, _id: &PCWSTR, key: &PROPERTYKEY) -> windows::core::Result<()> {
        // A rename in Sound settings, or a form factor a driver fills in late.
        if *key == PKEY_Device_FriendlyName || *key == PKEY_AudioEndpoint_FormFactor {
            self.send();
        }
        Ok(())
    }
}

#[implement(IAudioEndpointVolumeCallback)]
struct VolumeNotice {
    tx: Mutex<Sender<Msg>>,
}

impl IAudioEndpointVolumeCallback_Impl for VolumeNotice_Impl {
    fn OnNotify(&self, _data: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> windows::core::Result<()> {
        if let Ok(tx) = self.tx.lock() {
            let _ = tx.send(Msg::Volume);
        }
        Ok(())
    }
}

/// `PKEY_AudioEndpoint_FormFactor` (the `EndpointFormFactor` enum) → the three kinds Sound uses.
fn kind_of(form: u32) -> &'static str {
    match form {
        3 => "headphones",                   // Headphones
        5 | 6 => "headset",                  // Headset, Handset
        1 | 2 | 7 | 8 | 9 => "speakers",     // Speakers, LineLevel, digital passthrough, SPDIF, a display (HDMI)
        _ => "unknown",                      // RemoteNetworkDevice, Microphone, UnknownFormFactor
    }
}

fn read_device(device: &IMMDevice) -> windows::core::Result<(String, String, String)> {
    unsafe {
        let id_ptr = device.GetId()?;
        let id = id_ptr.to_string().unwrap_or_default();
        CoTaskMemFree(Some(id_ptr.0 as _));
        let store = device.OpenPropertyStore(STGM_READ)?;
        let name = store
            .GetValue(&PKEY_Device_FriendlyName)
            .ok()
            .and_then(|v| PropVariantToStringAlloc(&v).ok())
            .map(|p| {
                let s = p.to_string().unwrap_or_default();
                CoTaskMemFree(Some(p.0 as _));
                s
            })
            .unwrap_or_else(|| "This PC".into());
        let form = store
            .GetValue(&PKEY_AudioEndpoint_FormFactor)
            .ok()
            .and_then(|v| PropVariantToUInt32(&v).ok())
            .unwrap_or(10);
        Ok((format!("win:{id}"), name, kind_of(form).into()))
    }
}

/// The last output read, for a front end that loads after the first notice.
#[tauri::command]
pub fn audio_output() -> Option<AudioOutput> {
    CURRENT.lock().ok().and_then(|c| c.clone())
}

pub fn setup(app: &AppHandle) {
    let app = app.clone();
    let spawned = std::thread::Builder::new().name("audio-out".into()).spawn(move || {
        if let Err(e) = run(&app) {
            crate::log::warn(&format!("audio-out: stopped: {e}"));
        }
    });
    if let Err(e) = spawned {
        crate::log::warn(&format!("audio-out: thread failed: {e}"));
    }
}

fn run(app: &AppHandle) -> windows::core::Result<()> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let (tx, rx) = channel::<Msg>();
    let enumerator: IMMDeviceEnumerator = unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };
    let device_notice: IMMNotificationClient = DeviceNotice { tx: Mutex::new(tx.clone()) }.into();
    unsafe { enumerator.RegisterEndpointNotificationCallback(&device_notice)? };
    let volume_notice: IAudioEndpointVolumeCallback = VolumeNotice { tx: Mutex::new(tx) }.into();

    let mut endpoint: Option<IAudioEndpointVolume> = None;
    let mut device_info: Option<(String, String, String)> = None;
    let mut reread_device = true;
    loop {
        if reread_device {
            if let Some(old) = endpoint.take() {
                unsafe {
                    let _ = old.UnregisterControlChangeNotify(&volume_notice);
                }
            }
            device_info = None;
            match unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eConsole) } {
                Ok(device) => {
                    device_info = read_device(&device).ok();
                    if let Ok(ep) = unsafe { device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) } {
                        unsafe {
                            let _ = ep.RegisterControlChangeNotify(&volume_notice);
                        }
                        endpoint = Some(ep);
                    }
                }
                Err(e) => crate::log::info(&format!("audio-out: no default output ({e})")),
            }
        }
        let (volume, volume_db, muted) = endpoint
            .as_ref()
            .and_then(|ep| unsafe {
                Some((ep.GetMasterVolumeLevelScalar().ok()?, ep.GetMasterVolumeLevel().ok()?, ep.GetMute().ok()?.as_bool()))
            })
            .unwrap_or((1.0, 0.0, false));
        let next = device_info.as_ref().map(|(key, name, kind)| AudioOutput {
            key: key.clone(),
            name: name.clone(),
            kind: kind.clone(),
            volume,
            volume_db,
            muted,
        });
        let changed = {
            let mut cur = CURRENT.lock().unwrap_or_else(|p| p.into_inner());
            let device_changed = cur.as_ref().map(|c| (&c.key, &c.name, &c.kind)) != next.as_ref().map(|n| (&n.key, &n.name, &n.kind));
            if device_changed {
                // One line per output change; volume moves are not logged (a drag sends dozens).
                match &next {
                    Some(n) => crate::log::info(&format!("audio-out: {} ({})", n.name, n.kind)),
                    None => crate::log::info("audio-out: none"),
                }
            }
            let changed = *cur != next;
            *cur = next.clone();
            changed
        };
        if changed {
            let _ = app.emit("audio-output", next);
        }

        // Wait for a notice, then take a breath and fold a burst (a volume drag) into one read.
        reread_device = match rx.recv() {
            Ok(Msg::Device) => true,
            Ok(Msg::Volume) => false,
            Err(_) => return Ok(()),
        };
        std::thread::sleep(Duration::from_millis(40));
        while let Ok(m) = rx.try_recv() {
            if matches!(m, Msg::Device) {
                reread_device = true;
            }
        }
    }
}
