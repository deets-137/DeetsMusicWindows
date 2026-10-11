//! Input without the mouse: press a button through UI Automation (option A, 2026-10-10).
//!
//! The owner's call: the tool runs on the left monitor and must not take his mouse. A button
//! is found by its accessible name among the window's buttons, then pressed with the Invoke
//! pattern (or Toggle, for a toggle button). The press is not a real click: the app gets the
//! button's action without the pointer events before it. Both apps get the same kind of
//! press, so the comparison stays fair; the number is "press → …", not "mouse click → …".
//! The search runs BEFORE the clock starts; only the Invoke call is timed.

use crate::screen::Rect;
use windows::core::BSTR;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
use windows::Win32::System::Variant::{VARIANT, VARIANT_0, VARIANT_0_0, VARIANT_0_0_0, VT_I4};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationInvokePattern, IUIAutomationTogglePattern,
    TreeScope_Descendants, UIA_ButtonControlTypeId, UIA_ControlTypePropertyId, UIA_InvokePatternId, UIA_TogglePatternId,
};

pub struct Button {
    pub name: String,
    pub rect: Rect,
    pub el: IUIAutomationElement,
}

fn automation() -> windows::core::Result<IUIAutomation> {
    unsafe {
        // The main thread may already be in an apartment (a Store-app launch); either works.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
    }
}

fn i4(v: i32) -> VARIANT {
    VARIANT {
        Anonymous: VARIANT_0 {
            Anonymous: std::mem::ManuallyDrop::new(VARIANT_0_0 {
                vt: VT_I4,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: VARIANT_0_0_0 { lVal: v },
            }),
        },
    }
}

/// Every on-screen button in the window, with its name and its rectangle (desktop pixels).
pub fn buttons(hwnd: HWND) -> windows::core::Result<Vec<Button>> {
    unsafe {
        let ua = automation()?;
        let root = ua.ElementFromHandle(hwnd)?;
        let cond = ua.CreatePropertyCondition(UIA_ControlTypePropertyId, &i4(UIA_ButtonControlTypeId.0))?;
        let arr = root.FindAll(TreeScope_Descendants, &cond)?;
        let mut out = Vec::new();
        for i in 0..arr.Length()? {
            let el = arr.GetElement(i)?;
            if el.CurrentIsOffscreen().map(|b| b.as_bool()).unwrap_or(false) {
                continue;
            }
            let name = el.CurrentName().map(|b: BSTR| b.to_string()).unwrap_or_default();
            let r = el.CurrentBoundingRectangle().unwrap_or_default();
            out.push(Button { name, rect: Rect { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top }, el });
        }
        Ok(out)
    }
}

/// The first on-screen button whose name is one of `names` (case and spaces ignored).
pub fn find(hwnd: HWND, names: &[String]) -> Result<Button, String> {
    let norm = |s: &str| s.trim().to_lowercase();
    let want: Vec<String> = names.iter().map(|n| norm(n)).collect();
    // Chromium (WebView2) builds its accessibility tree only after a client first asks: the
    // first search finds the window caption alone (3 buttons on 2026-10-10, 67 a moment
    // later). So search again, a few times, before giving up.
    let mut n = 0;
    for attempt in 0..4 {
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_millis(700));
        }
        let all = buttons(hwnd).map_err(|e| format!("UI Automation: {e}"))?;
        n = all.len();
        if let Some(b) = all.into_iter().find(|b| want.contains(&norm(&b.name)) && b.rect.w > 0 && b.rect.h > 0) {
            return Ok(b);
        }
    }
    Err(format!("no on-screen button named {names:?} among {n} buttons (deetsmeter uia lists them)"))
}

/// Press it: Invoke, or Toggle for a toggle button. Returns which pattern pressed it.
pub fn press(b: &Button) -> Result<&'static str, String> {
    unsafe {
        if let Ok(p) = b.el.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId) {
            return p.Invoke().map(|_| "invoke").map_err(|e| format!("Invoke: {e}"));
        }
        if let Ok(p) = b.el.GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId) {
            return p.Toggle().map(|_| "toggle").map_err(|e| format!("Toggle: {e}"));
        }
    }
    Err(format!("button {:?} has no Invoke or Toggle pattern", b.name))
}

/// `deetsmeter uia <exe | path>`: the buttons of the app's window, to write a profile from.
pub fn list(what: &str) -> i32 {
    let what = crate::win::expand_env(what);
    let mut pids = Vec::new();
    for p in crate::win::find_pids(&what) {
        pids.extend(crate::win::tree(p));
    }
    let Some(w) = crate::win::windows_of(&pids).into_iter().next() else {
        eprintln!("no window for {what}");
        return 1;
    };
    // The first ask may only wake Chromium's accessibility tree (see `find`).
    let _ = buttons(w.hwnd);
    std::thread::sleep(std::time::Duration::from_millis(700));
    match buttons(w.hwnd) {
        Ok(list) => {
            println!("{} buttons on screen in {:?} (frame [{}, {}, {}, {}]); rect relative to the frame:", list.len(), w.title, w.frame.x, w.frame.y, w.frame.w, w.frame.h);
            for b in list {
                let pat = unsafe {
                    if b.el.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId).is_ok() {
                        "invoke"
                    } else if b.el.GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId).is_ok() {
                        "toggle"
                    } else {
                        "-"
                    }
                };
                let r = b.rect;
                println!("  [{:>5}, {:>5}, {:>4}, {:>4}]  {:<7} {:?}", r.x - w.frame.x, r.y - w.frame.y, r.w, r.h, pat, b.name);
            }
            0
        }
        Err(e) => {
            eprintln!("UI Automation: {e}");
            2
        }
    }
}
