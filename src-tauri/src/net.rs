//! The Network panel's three reads (docs/features/speedtest.md): a ping, the Wi-Fi signal, and the
//! Test download. Each is a command the front end calls; nothing here runs on its own, and no
//! thread is started (each read is one `spawn_blocking` task, or async).
//!
//! - `net_ping`: ICMP echoes to the support worker's host (Cloudflare's edge), through
//!   `IcmpSendEcho` (no admin right needed). net.ts calls it every 30 s, only while music plays
//!   (his call N3, speedtest.md §7). The answer is the round trips and how many came back: the
//!   only packet-loss number the app has for the internet link.
//! - `net_wifi`: the Wi-Fi signal quality (0–100) of the connected Wi-Fi adapter, through the
//!   WLAN API. `None` on Ethernet, or with the WLAN service off.
//! - `net_test`: the Test button. Three pings, then a download of 2 MB from
//!   `support.deets.solutions/speed`. The bytes are counted and dropped: nothing goes to disk
//!   (his rule, speedtest.md §5 F1). Only the result goes back to the panel.

use std::net::{Ipv4Addr, ToSocketAddrs};
use std::time::{Duration, Instant};

use serde::Serialize;

/// The host the ping and the Test reach: our own worker, so no third party sees the user.
const HOST: &str = "support.deets.solutions";
const SPEED_URL: &str = "https://support.deets.solutions/speed";
/// The worker sends 2 MB; more than this is a wrong answer, and the read stops.
const SPEED_MAX_BYTES: u64 = 3 * 1024 * 1024;
const SPEED_TIMEOUT: Duration = Duration::from_secs(20);
/// One echo's wait. A reply later than this counts as lost.
const ECHO_TIMEOUT_MS: u32 = 1000;
const ECHO_MAX: u32 = 5;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ping {
    pub sent: u32,
    /// The round trip of each echo that came back, ms.
    pub rtts: Vec<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Wifi {
    /// The signal quality Windows reports, 0–100.
    pub quality: u32,
    /// The link's receive rate, Mbps (what the adapter negotiated, not what the internet gives).
    pub rx_mbps: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedTest {
    pub bytes: u64,
    /// From the reply's headers to its last byte.
    pub ms: u64,
    pub mbps: f64,
    pub ping: Ping,
}

fn host_v4() -> Result<Ipv4Addr, String> {
    (HOST, 443)
        .to_socket_addrs()
        .map_err(|e| format!("net: no address for {HOST}: {e}"))?
        .find_map(|a| match a.ip() {
            std::net::IpAddr::V4(v4) => Some(v4),
            _ => None,
        })
        .ok_or_else(|| format!("net: no IPv4 address for {HOST}"))
}

/// `n` echoes, one after the other. Blocking: call it inside `spawn_blocking`.
fn ping_blocking(n: u32) -> Result<Ping, String> {
    use windows::Win32::NetworkManagement::IpHelper::{IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho, ICMP_ECHO_REPLY};

    let ip = host_v4()?;
    let n = n.clamp(1, ECHO_MAX);
    let handle = unsafe { IcmpCreateFile() }.map_err(|e| format!("net: IcmpCreateFile: {e}"))?;
    let payload = [0x44u8; 32];
    // The reply holds the header, our payload, and 8 bytes for an ICMP error (the API's rule).
    let mut reply = vec![0u8; std::mem::size_of::<ICMP_ECHO_REPLY>() + payload.len() + 8];
    let mut rtts = Vec::new();
    for _ in 0..n {
        let got = unsafe {
            IcmpSendEcho(
                handle,
                u32::from_ne_bytes(ip.octets()),
                payload.as_ptr().cast(),
                payload.len() as u16,
                None,
                reply.as_mut_ptr().cast(),
                reply.len() as u32,
                ECHO_TIMEOUT_MS,
            )
        };
        if got > 0 {
            let r: ICMP_ECHO_REPLY = unsafe { std::ptr::read_unaligned(reply.as_ptr().cast()) };
            if r.Status == 0 {
                rtts.push(r.RoundTripTime);
            }
        }
    }
    let _ = unsafe { IcmpCloseHandle(handle) };
    Ok(Ping { sent: n, rtts })
}

#[tauri::command]
pub async fn net_ping(n: u32) -> Result<Ping, String> {
    tauri::async_runtime::spawn_blocking(move || ping_blocking(n)).await.map_err(|e| e.to_string())?
}

fn wifi_blocking() -> Option<Wifi> {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::NetworkManagement::WiFi::{
        wlan_interface_state_connected, wlan_intf_opcode_current_connection, WlanCloseHandle, WlanEnumInterfaces, WlanFreeMemory,
        WlanOpenHandle, WlanQueryInterface, WLAN_CONNECTION_ATTRIBUTES, WLAN_INTERFACE_INFO_LIST,
    };

    let mut handle = HANDLE::default();
    let mut version = 0u32;
    // 2 = the client version of Windows Vista and later. Fails when the WLAN service is off.
    if unsafe { WlanOpenHandle(2, None, &mut version, &mut handle) } != 0 {
        return None;
    }
    let mut found = None;
    let mut list: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
    if unsafe { WlanEnumInterfaces(handle, None, &mut list) } == 0 && !list.is_null() {
        let count = unsafe { (*list).dwNumberOfItems } as usize;
        let first = unsafe { std::ptr::addr_of!((*list).InterfaceInfo) }.cast::<windows::Win32::NetworkManagement::WiFi::WLAN_INTERFACE_INFO>();
        for i in 0..count {
            let info = unsafe { &*first.add(i) };
            if info.isState != wlan_interface_state_connected {
                continue;
            }
            let mut size = 0u32;
            let mut data: *mut core::ffi::c_void = std::ptr::null_mut();
            let rc = unsafe { WlanQueryInterface(handle, &info.InterfaceGuid, wlan_intf_opcode_current_connection, None, &mut size, &mut data, None) };
            if rc == 0 && !data.is_null() {
                let attrs = unsafe { &*(data as *const WLAN_CONNECTION_ATTRIBUTES) };
                let a = &attrs.wlanAssociationAttributes;
                found = Some(Wifi { quality: a.wlanSignalQuality.min(100), rx_mbps: a.ulRxRate / 1000 });
                unsafe { WlanFreeMemory(data) };
                break;
            }
        }
        unsafe { WlanFreeMemory(list as *const _) };
    }
    unsafe { WlanCloseHandle(handle, None) };
    found
}

#[tauri::command]
pub async fn net_wifi() -> Result<Option<Wifi>, String> {
    tauri::async_runtime::spawn_blocking(wifi_blocking).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn net_test() -> Result<SpeedTest, String> {
    let ping = tauri::async_runtime::spawn_blocking(|| ping_blocking(3)).await.map_err(|e| e.to_string())??;
    let client = reqwest::Client::builder()
        .timeout(SPEED_TIMEOUT)
        .user_agent(format!("DeetsMusic/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client.get(SPEED_URL).send().await.map_err(|e| format!("net: test not sent: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("net: the worker answered {}", resp.status().as_u16()));
    }
    let t0 = Instant::now();
    let mut bytes = 0u64;
    // Each piece is counted and dropped at once (speedtest.md §5 F1: no storage).
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("net: the test broke off: {e}"))? {
        bytes += chunk.len() as u64;
        if bytes > SPEED_MAX_BYTES {
            break;
        }
    }
    let ms = t0.elapsed().as_millis().max(1) as u64;
    let mbps = mbps_of(bytes, ms);
    crate::log::info(&format!("net: test {bytes} bytes in {ms} ms = {mbps:.1} Mbps · ping {}/{} back", ping.rtts.len(), ping.sent));
    Ok(SpeedTest { bytes, ms, mbps, ping })
}

fn mbps_of(bytes: u64, ms: u64) -> f64 {
    (bytes as f64 * 8.0) / (ms.max(1) as f64 * 1000.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mbps_2026_10_19() {
        // 2 MB in 1 s is 16.8 Mbps (megabits, 10^6).
        assert!((mbps_of(2 * 1024 * 1024, 1000) - 16.777).abs() < 0.01);
        assert!(mbps_of(100, 0).is_finite());
    }
}
