//! The Network panel's two reads (docs/features/speedtest.md): a ping and the Test download. Each is a command the front end calls; nothing here runs on its own, and no
//! thread is started (each read is one `spawn_blocking` task, or async).
//!
//! - `net_ping`: ICMP echoes to the support worker's host (Cloudflare's edge), through
//!   `IcmpSendEcho` (no admin right needed). net.ts calls it every 30 s, only while music plays
//!   (his call N3, speedtest.md §7). The answer is the round trips and how many came back: the
//!   only packet-loss number the app has for the internet link.
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
    let ip = host_v4()?;
    let n = n.clamp(1, ECHO_MAX);
    let rtts = crate::os::net::ping(ip, n, ECHO_TIMEOUT_MS)?;
    Ok(Ping { sent: n, rtts })
}

#[tauri::command]
pub async fn net_ping(n: u32) -> Result<Ping, String> {
    tauri::async_runtime::spawn_blocking(move || ping_blocking(n)).await.map_err(|e| e.to_string())?
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
