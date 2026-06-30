// Shared drag-slider primitive.
//
// One pointer-capture loop drives BOTH the horizontal seek bar (Now Playing) and
// the vertical volume slider (titlebar). Callers differ only by axis and by what
// they do with the resulting 0..1 fraction — the geometry, clamping, and fill
// reflection live here once.
//
// The fill is published to CSS via the `--slider-fill` custom property (a
// percentage). Both orientations consume it: horizontal sliders map it to width
// + handle `left`, vertical sliders to height + handle `bottom`. See the `.scrub`
// block in `styles.css`.

export interface SliderOptions {
  axis: "x" | "y";
  /** Fired continuously while dragging (and once on the initial press). */
  onDrag?: (frac: number) => void;
  /** Fired once on release with the final fraction. */
  onCommit?: (frac: number) => void;
}

export interface SliderHandle {
  /** Reflect an externally-driven value (0..1). No-op while the user is dragging. */
  setValue(frac: number): void;
  /** True while a drag is in progress (so callers can hold popups open, etc.). */
  readonly dragging: boolean;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Attach drag-to-set behaviour to `el`. Returns a handle for external updates. */
export function makeSlider(el: HTMLElement, opts: SliderOptions): SliderHandle {
  const { axis, onDrag, onCommit } = opts;
  let dragging = false;

  // Map a pointer position to a 0..1 fraction along the active axis. Vertical
  // sliders read bottom→top (up = more), so the Y fraction is inverted.
  const fracAt = (clientX: number, clientY: number): number => {
    const r = el.getBoundingClientRect();
    if (axis === "x") return r.width > 0 ? clamp01((clientX - r.left) / r.width) : 0;
    return r.height > 0 ? clamp01(1 - (clientY - r.top) / r.height) : 0;
  };

  const reflect = (frac: number) => {
    el.style.setProperty("--slider-fill", `${(clamp01(frac) * 100).toFixed(2)}%`);
  };

  el.addEventListener("pointerdown", (e) => {
    dragging = true;
    el.setPointerCapture(e.pointerId);
    const f = fracAt(e.clientX, e.clientY);
    reflect(f);
    onDrag?.(f);
  });
  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const f = fracAt(e.clientX, e.clientY);
    reflect(f);
    onDrag?.(f);
  });
  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    const f = fracAt(e.clientX, e.clientY);
    reflect(f);
    onCommit?.(f);
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);

  return {
    setValue(frac: number) {
      if (!dragging) reflect(frac);
    },
    get dragging() {
      return dragging;
    },
  };
}
