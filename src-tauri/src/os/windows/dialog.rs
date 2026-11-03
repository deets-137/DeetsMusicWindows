//! Native dialogs (OS-LAYER.md §11.1, from db_open.rs).

/// One error box, on top, before the app exits: the library file will not open
/// (DB-HEALTH.md §7). Blocks until the user closes it.
pub fn fatal(title: &str, text: &str) {
    use windows::core::PCWSTR;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK, MB_SETFOREGROUND};
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let body = wide(text);
    let title = wide(title);
    unsafe {
        MessageBoxW(None, PCWSTR(body.as_ptr()), PCWSTR(title.as_ptr()), MB_OK | MB_ICONERROR | MB_SETFOREGROUND);
    }
}
