//! Processes and windows: launch, attach, find the app's window, place it, read its frame.
//! Every coordinate is a physical pixel: main sets per-monitor DPI awareness v2 first.

use crate::screen::Rect;
use windows::core::{PCWSTR, PWSTR};
use windows::core::BOOL;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    CreateProcessW, OpenProcess, QueryFullProcessImageNameW, PROCESS_CREATION_FLAGS, PROCESS_INFORMATION,
    PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, STARTUPINFOW,
};
use windows::Win32::UI::Shell::{ApplicationActivationManager, IApplicationActivationManager, AO_NONE};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetAncestor, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible, PostMessageW,
    SetForegroundWindow, SetWindowPos, WindowFromPoint, GA_ROOT, HWND_TOP, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
    SWP_SHOWWINDOW, WM_CLOSE,
};

/// Who is on top at a desktop point, if it is not the target window: "title (exe)".
/// The guard for §17.5: on 2026-10-10 the first run on the live app measured, and scrolled,
/// the game client that covered it.
pub fn covered_at(target: HWND, x: i32, y: i32) -> Option<String> {
    unsafe {
        let h = WindowFromPoint(POINT { x, y });
        let root = GetAncestor(h, GA_ROOT);
        if root == target {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(root, Some(&mut pid));
        let mut buf = [0u16; 256];
        let n = GetWindowTextW(root, &mut buf);
        let title = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
        let exe = image_path(pid).and_then(|p| p.rsplit('\\').next().map(str::to_string)).unwrap_or_else(|| format!("pid {pid}"));
        Some(format!("\"{title}\" ({exe})"))
    }
}

/// The first point of the rectangle (its centre, then 8 px inside each corner) where
/// another window is on top of the target.
pub fn covered_in(target: HWND, r: Rect) -> Option<(i32, i32, String)> {
    let pts = [
        (r.x + r.w / 2, r.y + r.h / 2),
        (r.x + 8, r.y + 8),
        (r.x + r.w - 9, r.y + 8),
        (r.x + 8, r.y + r.h - 9),
        (r.x + r.w - 9, r.y + r.h - 9),
    ];
    pts.into_iter().find_map(|(x, y)| covered_at(target, x, y).map(|who| (x, y, who)))
}

/// Bring the window to the top of the z-order, then try to make it the foreground window.
pub fn raise(hwnd: HWND) -> bool {
    unsafe {
        let _ = SetWindowPos(hwnd, Some(HWND_TOP), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
        SetForegroundWindow(hwnd).as_bool()
    }
}

/// `%NAME%` → the environment variable, so a run file names `%LOCALAPPDATA%\DeetsMusic\…`
/// and never a user's own path (the repo is public).
pub fn expand_env(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(a) = rest.find('%') {
        let Some(b) = rest[a + 1..].find('%') else { break };
        let name = &rest[a + 1..a + 1 + b];
        out.push_str(&rest[..a]);
        match std::env::var(name) {
            Ok(v) if !name.is_empty() => out.push_str(&v),
            _ => out.push_str(&rest[a..a + b + 2]),
        }
        rest = &rest[a + b + 2..];
    }
    out.push_str(rest);
    out
}

pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn from_wide(w: &[u16]) -> String {
    let n = w.iter().position(|&c| c == 0).unwrap_or(w.len());
    String::from_utf16_lossy(&w[..n])
}

/// (pid, parent pid, exe name) for every process.
pub fn processes() -> Vec<(u32, u32, String)> {
    let mut out = Vec::new();
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
        let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        if Process32FirstW(snap, &mut e).is_ok() {
            loop {
                out.push((e.th32ProcessID, e.th32ParentProcessID, from_wide(&e.szExeFile)));
                if Process32NextW(snap, &mut e).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    out
}

pub fn image_path(pid: u32) -> Option<String> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut n = buf.len() as u32;
        let r = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut n);
        let _ = CloseHandle(h);
        r.ok()?;
        Some(String::from_utf16_lossy(&buf[..n as usize]))
    }
}

/// The pids that match: a bare exe name matches by name; a path (with a `\`) matches the
/// full image path, so the installed app and the dev app are told apart.
pub fn find_pids(what: &str) -> Vec<u32> {
    let by_path = what.contains('\\') || what.contains('/');
    let want = what.replace('/', "\\").to_lowercase();
    processes()
        .into_iter()
        .filter(|(pid, _, name)| {
            if by_path {
                image_path(*pid).map(|p| p.to_lowercase() == want).unwrap_or(false)
            } else {
                name.to_lowercase() == want
            }
        })
        .map(|(pid, _, _)| pid)
        .collect()
}

/// The pid and every descendant of it.
pub fn tree(root: u32) -> Vec<u32> {
    let all = processes();
    let mut set = vec![root];
    let mut i = 0;
    while i < set.len() {
        let p = set[i];
        for (pid, parent, _) in &all {
            if *parent == p && !set.contains(pid) {
                set.push(*pid);
            }
        }
        i += 1;
    }
    set
}

/// Start an exe. Returns its pid.
pub fn launch_exe(exe: &str, args: &[String]) -> windows::core::Result<u32> {
    let mut cmd = format!("\"{exe}\"");
    for a in args {
        cmd.push(' ');
        cmd.push_str(a);
    }
    let mut cmdw = wide(&cmd);
    let exew = wide(exe);
    let si = STARTUPINFOW { cb: std::mem::size_of::<STARTUPINFOW>() as u32, ..Default::default() };
    let mut pi = PROCESS_INFORMATION::default();
    unsafe {
        CreateProcessW(
            PCWSTR(exew.as_ptr()),
            Some(PWSTR(cmdw.as_mut_ptr())),
            None,
            None,
            false,
            PROCESS_CREATION_FLAGS(0),
            None,
            PCWSTR::null(),
            &si,
            &mut pi,
        )?;
        let _ = CloseHandle(pi.hThread);
        let _ = CloseHandle(pi.hProcess);
    }
    Ok(pi.dwProcessId)
}

/// Start a Store app by its AppUserModelID (Apple's app). Returns its pid.
pub fn launch_aumid(aumid: &str) -> windows::core::Result<u32> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let mgr: IApplicationActivationManager = CoCreateInstance(&ApplicationActivationManager, None, CLSCTX_LOCAL_SERVER)?;
        let id = wide(aumid);
        mgr.ActivateApplication(PCWSTR(id.as_ptr()), PCWSTR::null(), AO_NONE)
    }
}

pub struct Win {
    pub hwnd: HWND,
    pub pid: u32,
    pub title: String,
    pub frame: Rect,
}

/// The visible frame of a window, without Windows 11's invisible resize border.
pub fn frame(hwnd: HWND) -> Option<Rect> {
    let mut r = RECT::default();
    unsafe {
        DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &mut r as *mut _ as *mut _, std::mem::size_of::<RECT>() as u32).ok()?;
    }
    Some(Rect { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top })
}

fn cloaked(hwnd: HWND) -> bool {
    let mut v = 0u32;
    unsafe {
        DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut v as *mut _ as *mut _, 4).is_ok() && v != 0
    }
}

unsafe extern "system" fn collect(hwnd: HWND, lp: LPARAM) -> BOOL {
    let list = &mut *(lp.0 as *mut Vec<HWND>);
    list.push(hwnd);
    BOOL(1)
}

/// Visible, uncloaked top-level windows of the given pids, largest first.
pub fn windows_of(pids: &[u32]) -> Vec<Win> {
    let mut all: Vec<HWND> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&mut all as *mut _ as isize));
    }
    let mut out: Vec<Win> = all
        .into_iter()
        .filter_map(|hwnd| unsafe {
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if !pids.contains(&pid) || !IsWindowVisible(hwnd).as_bool() || cloaked(hwnd) {
                return None;
            }
            if GetAncestor(hwnd, GA_ROOT) != hwnd {
                return None;
            }
            let frame = frame(hwnd)?;
            if frame.w < 120 || frame.h < 120 {
                return None;
            }
            let mut buf = [0u16; 256];
            let n = GetWindowTextW(hwnd, &mut buf);
            Some(Win { hwnd, pid, title: String::from_utf16_lossy(&buf[..n.max(0) as usize]), frame })
        })
        .collect();
    out.sort_by_key(|w| -(w.frame.w as i64 * w.frame.h as i64));
    out
}

/// Move and size the window so its VISIBLE frame is `want`. The outer rectangle includes
/// the invisible border, so the border is measured first and added back.
pub fn place(hwnd: HWND, want: Rect) -> Option<Rect> {
    unsafe {
        let mut outer = RECT::default();
        windows::Win32::UI::WindowsAndMessaging::GetWindowRect(hwnd, &mut outer).ok()?;
        let vis = frame(hwnd)?;
        let (bl, bt) = (vis.x - outer.left, vis.y - outer.top);
        let (br, bb) = (outer.right - (vis.x + vis.w), outer.bottom - (vis.y + vis.h));
        SetWindowPos(
            hwnd,
            Some(HWND_TOP),
            want.x - bl,
            want.y - bt,
            want.w + bl + br,
            want.h + bt + bb,
            SWP_SHOWWINDOW | SWP_NOZORDER,
        )
        .ok()?;
    }
    std::thread::sleep(std::time::Duration::from_millis(150));
    frame(hwnd)
}

pub fn is_foreground(hwnd: HWND) -> bool {
    unsafe {
        let fg = windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow();
        GetAncestor(fg, GA_ROOT) == hwnd
    }
}

pub fn close(hwnd: HWND) {
    unsafe {
        let _ = PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0));
    }
}
