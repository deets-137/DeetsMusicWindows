//! Discord's local socket (OS-LAYER.md §11.1, from presence.rs; FRIENDS.md §8.11): the
//! named pipe `\\.\pipe\discord-ipc-N`, overlapped, so every call has a deadline and a wedged
//! Discord client can never hold a thread.

use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, ERROR_IO_PENDING, HANDLE, WAIT_OBJECT_0};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, ReadFile, WriteFile, FILE_FLAG_OVERLAPPED, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
    FILE_SHARE_MODE, OPEN_EXISTING,
};
use windows::Win32::System::Pipes::WaitNamedPipeW;
use windows::Win32::System::Threading::{CreateEventW, ResetEvent, WaitForSingleObject};
use windows::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};

use crate::os::DiscordIpc;

/// An overlapped handle on the pipe, plus the event its calls wait on. Both handles close
/// with the struct, so a dropped pipe leaves nothing behind.
pub struct DiscordPipe {
    file: HANDLE,
    event: HANDLE,
}

impl Drop for DiscordPipe {
    fn drop(&mut self) {
        unsafe {
            // Anything still in flight is cancelled before the handle goes, or the kernel
            // could write into an OVERLAPPED whose stack frame has gone.
            let _ = CancelIoEx(self.file, None);
            let _ = CloseHandle(self.file);
            let _ = CloseHandle(self.event);
        }
    }
}

impl DiscordPipe {
    /// Wait for one overlapped operation. `Ok(None)` = it ran out of time and was cancelled.
    ///
    /// The cancel is then WAITED FOR. `CancelIoEx` only asks; until the kernel answers, the
    /// operation may still write into `ov`, which lives on the caller's stack.
    fn finish(&self, ov: *mut OVERLAPPED, started: windows::core::Result<()>, ms: u32) -> Result<Option<u32>, String> {
        if let Err(e) = started {
            if e.code() != ERROR_IO_PENDING.to_hresult() {
                return Err(e.message());
            }
        }
        if unsafe { WaitForSingleObject(self.event, ms) } != WAIT_OBJECT_0 {
            unsafe {
                let _ = CancelIoEx(self.file, Some(ov));
                let mut n = 0u32;
                let _ = GetOverlappedResult(self.file, ov, &mut n, true);
            }
            return Ok(None);
        }
        let mut n = 0u32;
        unsafe { GetOverlappedResult(self.file, ov, &mut n, false) }.map_err(|e| e.message())?;
        Ok(Some(n))
    }
}

impl DiscordIpc for DiscordPipe {
    /// `WaitNamedPipeW` runs first so a BUSY pipe waits here, with a deadline, instead of
    /// inside `CreateFileW`, which would wait for as long as it took.
    fn open(n: u32, wait_ms: u32) -> Result<Self, String> {
        let wide: Vec<u16> = format!(r"\\.\pipe\discord-ipc-{n}").encode_utf16().chain(std::iter::once(0)).collect();
        let name = PCWSTR(wide.as_ptr());
        unsafe {
            let _ = WaitNamedPipeW(name, wait_ms);
        }
        let file = unsafe {
            CreateFileW(
                name,
                (FILE_GENERIC_READ | FILE_GENERIC_WRITE).0,
                FILE_SHARE_MODE(0),
                None,
                OPEN_EXISTING,
                FILE_FLAG_OVERLAPPED,
                None,
            )
        }
        .map_err(|e| e.message())?;
        let event = match unsafe { CreateEventW(None, true, false, PCWSTR::null()) } {
            Ok(h) => h,
            Err(e) => {
                unsafe {
                    let _ = CloseHandle(file);
                }
                return Err(format!("event: {}", e.message()));
            }
        };
        Ok(DiscordPipe { file, event })
    }

    fn write(&self, bytes: &[u8], ms: u32) -> Result<Option<usize>, String> {
        let mut ov = OVERLAPPED { hEvent: self.event, ..Default::default() };
        unsafe { ResetEvent(self.event) }.map_err(|e| e.message())?;
        let started = unsafe { WriteFile(self.file, Some(bytes), None, Some(&mut ov)) };
        Ok(self.finish(&mut ov, started, ms)?.map(|n| n as usize))
    }

    fn read(&self, buf: &mut [u8], ms: u32) -> Result<Option<usize>, String> {
        let mut ov = OVERLAPPED { hEvent: self.event, ..Default::default() };
        unsafe { ResetEvent(self.event) }.map_err(|e| e.message())?;
        let started = unsafe { ReadFile(self.file, Some(buf), None, Some(&mut ov)) };
        Ok(self.finish(&mut ov, started, ms)?.map(|n| n as usize))
    }
}
