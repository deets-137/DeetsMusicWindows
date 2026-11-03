//! The Liquid Glass test (tools/mac-probe/README.md § The glass test).
//!
//! Native views placed around the WKWebView in its superview, bottom to top:
//!
//!   wallpaper (NSImageView)          — stands in for the album wallpaper, drawn natively
//!   window glass (NSGlassEffectView) — the whole window, behind a transparent page
//!   card container (NSGlassEffectContainerView) — one glass shape per card rect
//!   WKWebView (transparent page)
//!   over glass (NSGlassEffectView)   — ABOVE the page: does glass bend our own content?
//!
//! The page sends a `Scene` (flags + rects in CSS px, the web view's own coordinates);
//! `apply` runs on the main thread. Views are rebuilt when the flags change, and only
//! re-framed when just the rects move (the moving-card test).

use std::cell::RefCell;

use objc2::rc::Retained;
use objc2::MainThreadMarker;
use objc2::{AnyThread, MainThreadOnly};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSGlassEffectContainerView, NSGlassEffectView, NSGlassEffectViewStyle,
    NSImage, NSImageScaling, NSImageView, NSView, NSWindowOrderingMode,
};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
use serde::Deserialize;

#[derive(Deserialize, Clone, Copy, PartialEq)]
pub struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    r: f64,
}

#[derive(Deserialize, Clone, PartialEq)]
pub struct Scene {
    window: bool,
    clear: bool,
    wallpaper: bool,
    cards: Vec<Rect>,
    over: Option<Rect>,
}

impl Scene {
    /// What forces a rebuild: everything but the rect positions.
    fn shape(&self) -> (bool, bool, bool, usize, bool) {
        (self.window, self.clear, self.wallpaper, self.cards.len(), self.over.is_some())
    }
}

struct State {
    wk: Retained<NSView>,
    wallpaper_path: String,
    shape: Option<(bool, bool, bool, usize, bool)>,
    views: Vec<Retained<NSView>>,
    content: Option<Retained<NSView>>,
    cards: Vec<Retained<NSGlassEffectView>>,
    over: Option<Retained<NSGlassEffectView>>,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
}

/// Called once, on the main thread, with the WKWebView pointer from `with_webview`.
pub fn init(wk: *mut std::ffi::c_void, wallpaper_path: String) {
    // SAFETY: Tauri hands us the live WKWebView (an NSView subclass) on the main thread.
    let wk = unsafe { Retained::retain(wk.cast::<NSView>()) }.expect("no WKWebView");
    STATE.with(|s| {
        *s.borrow_mut() = Some(State {
            wk,
            wallpaper_path,
            shape: None,
            views: Vec::new(),
            content: None,
            cards: Vec::new(),
            over: None,
        })
    });
}

fn fill_mask() -> NSAutoresizingMaskOptions {
    NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable
}

fn style(clear: bool) -> NSGlassEffectViewStyle {
    if clear { NSGlassEffectViewStyle::Clear } else { NSGlassEffectViewStyle::Regular }
}

/// A rect in the web view's coordinates (CSS px = points, top-left origin) to `target`'s.
fn to_view(wk: &NSView, target: &NSView, r: &Rect) -> NSRect {
    let local = NSRect::new(NSPoint::new(r.x, r.y), NSSize::new(r.w, r.h));
    wk.convertRect_toView(local, Some(target))
}

/// Returns a line for the probe log on a rebuild, None on a re-frame.
pub fn apply(scene: &Scene) -> Option<String> {
    let mtm = MainThreadMarker::new().expect("glass::apply off the main thread");
    STATE.with(|s| {
        let mut guard = s.borrow_mut();
        let st = guard.as_mut()?;
        // SAFETY: main thread; the web view is in a window.
        let sup = unsafe { st.wk.superview() }?;
        let bounds = sup.bounds();

        if st.shape != Some(scene.shape()) {
            // Rebuild: take every view out, put them back in order.
            for v in st.views.drain(..) {
                v.removeFromSuperview();
            }
            st.cards.clear();
            st.content = None;
            st.over = None;
            let mut notes = Vec::new();

            if scene.wallpaper {
                let img = NSImage::initWithContentsOfFile(NSImage::alloc(), &NSString::from_str(&st.wallpaper_path));
                match img {
                    Some(img) => {
                        let iv = NSImageView::imageViewWithImage(&img, mtm);
                        iv.setImageScaling(NSImageScaling::ScaleAxesIndependently);
                        iv.setFrame(bounds);
                        iv.setAutoresizingMask(fill_mask());
                        sup.addSubview_positioned_relativeTo(&iv, NSWindowOrderingMode::Below, None);
                        st.views.push(Retained::into_super(Retained::into_super(iv)));
                        notes.push("wallpaper");
                    }
                    None => notes.push("wallpaper MISSING"),
                }
            }
            if scene.window {
                let g = NSGlassEffectView::initWithFrame(NSGlassEffectView::alloc(mtm), bounds);
                g.setStyle(style(scene.clear));
                g.setAutoresizingMask(fill_mask());
                sup.addSubview_positioned_relativeTo(&g, NSWindowOrderingMode::Below, Some(&st.wk));
                st.views.push(Retained::into_super(g));
                notes.push("window glass");
            }
            if !scene.cards.is_empty() {
                let c = NSGlassEffectContainerView::initWithFrame(NSGlassEffectContainerView::alloc(mtm), bounds);
                c.setAutoresizingMask(fill_mask());
                c.setSpacing(24.0);
                let content = NSView::initWithFrame(NSView::alloc(mtm), bounds);
                content.setAutoresizingMask(fill_mask());
                c.setContentView(Some(&content));
                for _ in &scene.cards {
                    let g = NSGlassEffectView::initWithFrame(NSGlassEffectView::alloc(mtm), NSRect::ZERO);
                    g.setStyle(style(scene.clear));
                    content.addSubview(&g);
                    st.cards.push(g);
                }
                sup.addSubview_positioned_relativeTo(&c, NSWindowOrderingMode::Below, Some(&st.wk));
                st.views.push(Retained::into_super(c));
                st.content = Some(content);
                notes.push("card glass");
            }
            if scene.over.is_some() {
                let g = NSGlassEffectView::initWithFrame(NSGlassEffectView::alloc(mtm), NSRect::ZERO);
                g.setStyle(style(scene.clear));
                sup.addSubview_positioned_relativeTo(&g, NSWindowOrderingMode::Above, Some(&st.wk));
                st.over = Some(g.clone());
                st.views.push(Retained::into_super(g));
                notes.push("glass over the page");
            }
            st.shape = Some(scene.shape());
            frame(st, scene, &sup);
            return Some(format!(
                "glass: built [{}] style={} superview flipped={}",
                if notes.is_empty() { "nothing".into() } else { notes.join(", ") },
                if scene.clear { "clear" } else { "regular" },
                sup.isFlipped()
            ));
        }
        frame(st, scene, &sup);
        None
    })
}

fn frame(st: &State, scene: &Scene, sup: &NSView) {
    if let Some(content) = &st.content {
        for (g, r) in st.cards.iter().zip(&scene.cards) {
            g.setFrame(to_view(&st.wk, content, r));
            g.setCornerRadius(r.r);
        }
    }
    if let (Some(g), Some(r)) = (&st.over, &scene.over) {
        g.setFrame(to_view(&st.wk, sup, r));
        g.setCornerRadius(r.r);
    }
}
