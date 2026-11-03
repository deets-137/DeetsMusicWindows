//! The graphics edges (OS-LAYER.md §11.1, from gpu.rs; GRAPHICS-FALLBACK.md §4.2, §10.3).

use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2ProcessFailedEventArgs2, COREWEBVIEW2_PROCESS_FAILED_KIND,
    COREWEBVIEW2_PROCESS_FAILED_KIND_GPU_PROCESS_EXITED,
};
use webview2_com::ProcessFailedEventHandler;
use windows::core::Interface;

/// Call `on_fail(kind, exit_code, is_gpu)` each time one of the web view's processes fails.
/// `kind` is WebView2's `COREWEBVIEW2_PROCESS_FAILED_KIND`; `is_gpu` is true for the GPU process.
/// A failure to add the handler is one log line.
pub fn watch_process(win: &WebviewWindow, on_fail: impl Fn(i32, Option<i32>, bool) + Send + 'static) {
    let r = win.with_webview(move |wv| {
        let add = || -> windows::core::Result<()> {
            let core = unsafe { wv.controller().CoreWebView2()? };
            let handler = ProcessFailedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                unsafe { args.ProcessFailedKind(&mut kind)? };
                let exit_code = args.cast::<ICoreWebView2ProcessFailedEventArgs2>().ok().and_then(|a2| {
                    let mut code = 0i32;
                    unsafe { a2.ExitCode(&mut code) }.ok().map(|_| code)
                });
                on_fail(kind.0, exit_code, kind == COREWEBVIEW2_PROCESS_FAILED_KIND_GPU_PROCESS_EXITED);
                Ok(())
            }));
            let mut token = 0i64;
            unsafe { core.add_ProcessFailed(&handler, &mut token) }
        };
        if let Err(e) = add() {
            crate::log::warn(&format!("gpu: no process-failed watch: {e}"));
        }
    });
    if let Err(e) = r {
        crate::log::warn(&format!("gpu: no process-failed watch: {e}"));
    }
}

/// One test: each hardware adapter in turn (software ones skipped) until one makes a Direct3D 11
/// device. True and the adapter's name when one did; the device is made and freed.
pub fn card_test() -> (bool, Option<String>) {
    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
    use windows::Win32::Graphics::Direct3D11::{D3D11CreateDevice, ID3D11Device, D3D11_CREATE_DEVICE_FLAG, D3D11_SDK_VERSION};
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIAdapter, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE};

    // A fresh factory each time: an old one lists the adapters as they were when it was made.
    let Ok(factory) = (unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }) else { return (false, None) };
    let mut i = 0;
    while let Ok(adapter) = unsafe { factory.EnumAdapters1(i) } {
        i += 1;
        let Ok(desc) = (unsafe { adapter.GetDesc1() }) else { continue };
        let name = String::from_utf16_lossy(&desc.Description).trim_end_matches('\0').to_string();
        if desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 || name.contains("Basic Render Driver") {
            continue;
        }
        let Ok(base) = adapter.cast::<IDXGIAdapter>() else { continue };
        let mut device: Option<ID3D11Device> = None;
        let made = unsafe {
            D3D11CreateDevice(
                &base,
                D3D_DRIVER_TYPE_UNKNOWN,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_FLAG(0),
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                None,
            )
        };
        if made.is_ok() && device.is_some() {
            return (true, Some(name)); // the device drops here: made and freed
        }
    }
    (false, None)
}

/// Wait on Windows' adapter-change event (`IDXGIFactory7::RegisterAdaptersChangedEvent`): no
/// timer, no polling. Call `on_settled(events)` first after `settle_ms` with no change, then again
/// after each settled change. Blocks the calling thread for the rest of the session.
pub fn watch_adapters(settle_ms: u32, mut on_settled: impl FnMut(u32)) -> Result<(), String> {
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory7};
    use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject, INFINITE};

    let factory: IDXGIFactory7 = unsafe { CreateDXGIFactory1() }.map_err(|e| e.to_string())?;
    let event = unsafe { CreateEventW(None, false, false, None) }.map_err(|e| e.to_string())?;
    let cookie = unsafe { factory.RegisterAdaptersChangedEvent(event) };
    if let Err(e) = cookie {
        unsafe { CloseHandle(event).ok() };
        return Err(e.to_string());
    }
    crate::log::info("gpu: adapter watch on");
    let mut events = 0u32;
    loop {
        // Settle: wait until `settle_ms` pass with no change.
        loop {
            let w = unsafe { WaitForSingleObject(event, settle_ms) };
            if w == WAIT_OBJECT_0 {
                events += 1;
            } else if w == WAIT_TIMEOUT {
                break;
            } else {
                unsafe { CloseHandle(event).ok() };
                return Ok(());
            }
        }
        on_settled(events);
        // Then sleep until the next change.
        if unsafe { WaitForSingleObject(event, INFINITE) } != WAIT_OBJECT_0 {
            unsafe { CloseHandle(event).ok() };
            return Ok(());
        }
        events = 1;
    }
}
