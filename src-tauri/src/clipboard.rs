//! Text onto the Windows clipboard from Rust. The page's `navigator.clipboard` refuses a window
//! without focus, so a copy started by the CLI or an agent (a Diary Done, DESK-TESTS.md A6) failed
//! while the app sat behind another window. Win32's clipboard has no such rule. The page tries its
//! own clipboard first and comes here only when that refuses (`src/clipboard.ts`).

/// Writes `text` as Unicode text, replacing what the clipboard held.
#[tauri::command]
pub async fn clipboard_write(text: String) -> Result<(), String> {
    // OpenClipboard can wait on another process that holds it: off the UI thread.
    tauri::async_runtime::spawn_blocking(move || write(&text))
        .await
        .map_err(|e| format!("clipboard: {e}"))?
}

#[cfg(windows)]
fn write(text: &str) -> Result<(), String> {
    use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    const CF_UNICODETEXT: u32 = 13;

    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let bytes = wide.len() * std::mem::size_of::<u16>();
    // Another program can hold the clipboard for a moment: a few short tries.
    let mut opened = false;
    for _ in 0..5 {
        if unsafe { OpenClipboard(None) }.is_ok() {
            opened = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    if !opened {
        return Err("clipboard: another program holds it".into());
    }
    let result = unsafe {
        (|| -> Result<(), String> {
            EmptyClipboard().map_err(|e| format!("clipboard: empty: {e}"))?;
            let mem: HGLOBAL = GlobalAlloc(GMEM_MOVEABLE, bytes).map_err(|e| format!("clipboard: alloc: {e}"))?;
            let dst = GlobalLock(mem) as *mut u16;
            if dst.is_null() {
                let _ = GlobalFree(Some(mem));
                return Err("clipboard: lock failed".into());
            }
            std::ptr::copy_nonoverlapping(wide.as_ptr(), dst, wide.len());
            let _ = GlobalUnlock(mem);
            // On success the clipboard owns the memory; on failure it is still ours to free.
            if let Err(e) = SetClipboardData(CF_UNICODETEXT, Some(HANDLE(mem.0))) {
                let _ = GlobalFree(Some(mem));
                return Err(format!("clipboard: set: {e}"));
            }
            Ok(())
        })()
    };
    let _ = unsafe { CloseClipboard() };
    result
}

#[cfg(not(windows))]
fn write(_text: &str) -> Result<(), String> {
    Err("clipboard: Windows only".into())
}
