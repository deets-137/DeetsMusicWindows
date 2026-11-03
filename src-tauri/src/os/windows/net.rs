//! The ping (OS-LAYER.md §11.1, from net.rs): ICMP echoes through `IcmpSendEcho`, which needs
//! no admin right.

use std::net::Ipv4Addr;

/// `n` echoes to `ip`, one after the other; the round trip of each one that came back, ms.
/// Blocking: the caller runs it inside `spawn_blocking`.
pub fn ping(ip: Ipv4Addr, n: u32, timeout_ms: u32) -> Result<Vec<u32>, String> {
    use windows::Win32::NetworkManagement::IpHelper::{IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho, ICMP_ECHO_REPLY};

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
                timeout_ms,
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
    Ok(rtts)
}
