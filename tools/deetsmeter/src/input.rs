//! Input: the pointer is moved with SetCursorPos (exact physical pixels), the buttons, the
//! wheel and the keys go through SendInput. The caller takes the clock just before the call
//! that does the press; that time is the `input` event.

use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
    KEYEVENTF_UNICODE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP,
    MOUSEEVENTF_WHEEL, MOUSEINPUT, MOUSE_EVENT_FLAGS, VIRTUAL_KEY, VK_CONTROL, VK_DOWN, VK_END, VK_ESCAPE, VK_HOME,
    VK_LEFT, VK_MEDIA_NEXT_TRACK, VK_MEDIA_PLAY_PAUSE, VK_MEDIA_PREV_TRACK, VK_MENU, VK_NEXT, VK_PRIOR, VK_RETURN,
    VK_RIGHT, VK_SHIFT, VK_SPACE, VK_TAB, VK_UP,
};
use windows::Win32::UI::WindowsAndMessaging::SetCursorPos;

fn mouse(flags: MOUSE_EVENT_FLAGS, data: u32) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 { mi: MOUSEINPUT { dx: 0, dy: 0, mouseData: data, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    }
}

fn key(vk: VIRTUAL_KEY, scan: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    }
}

fn send(list: &[INPUT]) -> bool {
    unsafe { SendInput(list, std::mem::size_of::<INPUT>() as i32) as usize == list.len() }
}

pub fn move_to(x: i32, y: i32) -> bool {
    unsafe { SetCursorPos(x, y).is_ok() }
}

pub fn click(right: bool) -> bool {
    let (d, u) = if right { (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP) } else { (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP) };
    send(&[mouse(d, 0), mouse(u, 0)])
}

pub fn button(down: bool) -> bool {
    send(&[mouse(if down { MOUSEEVENTF_LEFTDOWN } else { MOUSEEVENTF_LEFTUP }, 0)])
}

/// One wheel notch is 120; negative scrolls down.
pub fn wheel(delta: i32) -> bool {
    send(&[mouse(MOUSEEVENTF_WHEEL, delta as u32)])
}

/// A key by name: `enter`, `escape`, `space`, `tab`, arrows, `pageup` / `pagedown`, `home`,
/// `end`, `playpause`, `next`, `prev`, or one character; `ctrl+`, `shift+`, `alt+` in front.
pub fn parse_key(spec: &str) -> Option<(Vec<VIRTUAL_KEY>, VIRTUAL_KEY)> {
    let parts: Vec<String> = spec.split('+').map(|s| s.trim().to_lowercase()).collect();
    let (last, mods) = parts.split_last()?;
    let mods = mods
        .iter()
        .map(|m| match m.as_str() {
            "ctrl" | "control" => Some(VK_CONTROL),
            "shift" => Some(VK_SHIFT),
            "alt" => Some(VK_MENU),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    let vk = match last.as_str() {
        "enter" | "return" => VK_RETURN,
        "escape" | "esc" => VK_ESCAPE,
        "space" => VK_SPACE,
        "tab" => VK_TAB,
        "left" => VK_LEFT,
        "right" => VK_RIGHT,
        "up" => VK_UP,
        "down" => VK_DOWN,
        "pageup" => VK_PRIOR,
        "pagedown" => VK_NEXT,
        "home" => VK_HOME,
        "end" => VK_END,
        "playpause" => VK_MEDIA_PLAY_PAUSE,
        "next" => VK_MEDIA_NEXT_TRACK,
        "prev" => VK_MEDIA_PREV_TRACK,
        s if s.chars().count() == 1 => {
            let c = s.chars().next()?.to_ascii_uppercase();
            if c.is_ascii_alphanumeric() {
                VIRTUAL_KEY(c as u16)
            } else {
                return None;
            }
        }
        _ => return None,
    };
    Some((mods, vk))
}

/// Press and release a key, with its modifiers held around it, in one SendInput call.
pub fn press(mods: &[VIRTUAL_KEY], vk: VIRTUAL_KEY) -> bool {
    let mut list = Vec::new();
    for m in mods {
        list.push(key(*m, 0, KEYBD_EVENT_FLAGS(0)));
    }
    list.push(key(vk, 0, KEYBD_EVENT_FLAGS(0)));
    list.push(key(vk, 0, KEYEVENTF_KEYUP));
    for m in mods.iter().rev() {
        list.push(key(*m, 0, KEYEVENTF_KEYUP));
    }
    send(&list)
}

/// Type one character as Unicode (no layout involved).
pub fn char(c: u16) -> bool {
    send(&[key(VIRTUAL_KEY(0), c, KEYEVENTF_UNICODE), key(VIRTUAL_KEY(0), c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)])
}
