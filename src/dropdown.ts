// Shared dropdown primitive.
//
// One open/close/dismiss mechanism for every titlebar/card dropdown (the settings menu,
// the volume flyout, and the slot-card pickers). Callers differ only by markup and by the
// trigger `mode` — "click" or "hover" — which the "Hover-Menu" setting flips at runtime.
//
// Menu mode is a CROSS-INSTANCE concern, so it lives here with the primitive (not scattered
// across main.ts): every live dropdown registers in a module-level set, and `setDropdownMode`
// fans a change out to all of them. main.ts owns the *setting* (persistence + the toggle UI);
// this owns *distributing* it to instances.
//
// `root` is the hover region: it must contain BOTH the trigger and the panel so moving the
// cursor from the trigger into the panel never counts as "leaving". The panel is shown/hidden
// via its `hidden` attribute (CSS hides `[hidden]`). A panel portaled OUT of `root` (to
// escape a card's stacking context — the AirPlay "Play on" panel) is its own hover region
// and counts as "inside" for dismissal.

import * as frames from "./frames";

export type DropdownMode = "click" | "hover";

/** Why a dropdown is closing, so `shouldStayOpen` can veto only some closes:
 *  "toggle" the trigger was clicked · "away" a click outside · "escape" the Escape key ·
 *  "leave" the pointer left, in hover mode · "api" a caller's handle.close(). */
export type CloseReason = "toggle" | "away" | "escape" | "leave" | "api";

export interface DropdownOptions {
  /** Hover region — contains the trigger and the (absolutely-positioned) panel. */
  root: HTMLElement;
  /** Click target; carries `aria-expanded`. */
  trigger: HTMLElement;
  /** The panel to reveal (toggled via its `hidden` attribute). */
  panel: HTMLElement;
  /** Initial trigger mode (defaults to the current global menu mode). */
  mode?: DropdownMode;
  /** Close delay after the cursor leaves, in hover mode (default 150ms). */
  hoverGraceMs?: number;
  /** Veto closing while true (e.g. a slider mid-drag inside the panel). */
  shouldStayOpen?: (why: CloseReason) => boolean;
  /** More elements a click counts as inside (a nested panel portaled out of `root`). */
  alsoInside?: () => (Element | null | undefined)[];
  /** Veto OPENING while true (e.g. a slot picker that's only live at a card's root). */
  disabled?: () => boolean;
  /** Runs each time the panel appears, after it is shown (a slot picker fits itself to the window). */
  onOpen?: () => void;
}

export interface DropdownHandle {
  open(): void;
  close(): void;
  setMode(mode: DropdownMode): void;
  /** Remove document listeners and unregister from the mode fan-out. */
  destroy(): void;
  readonly isOpen: boolean;
}

// Every live dropdown follows one menu mode; `setDropdownMode` fans a change out to all.
const live = new Set<DropdownHandle>();
/** Each live dropdown's own elements, so opening one can close the others (below). */
const regions = new Map<DropdownHandle, { root: HTMLElement; panel: HTMLElement; closeAway: () => void }>();
let globalMode: DropdownMode = "click";

/** Flip every live dropdown between click/hover (the Hover-Menu toggle calls this). */
export function setDropdownMode(mode: DropdownMode): void {
  globalMode = mode;
  live.forEach((h) => h.setMode(mode));
}

/** Keep a right-anchored panel (`right: 0` of `anchor`) inside the window: when its left edge
 *  would pass the window's left edge (a wide panel under an icon far from the right, the Sound
 *  panel in midi, 2026-09-16), move it right by the difference, less `--panel-edge-gap`.
 *  Reads layout, not the rect, so the .pop arrival's scale does not skew it. Call on open and
 *  on resize while open. */
export function keepInWindow(anchor: HTMLElement, panel: HTMLElement): void {
  panel.style.right = "";
  const gap = parseFloat(getComputedStyle(panel).getPropertyValue("--panel-edge-gap")) || 0;
  const left = anchor.getBoundingClientRect().right - panel.offsetWidth;
  const under = gap - left;
  if (under > 0) panel.style.right = `${-under}px`;
}

/** Wire open/close/dismiss for a trigger+panel pair. Returns a runtime handle. */
export function makeDropdown(opts: DropdownOptions): DropdownHandle {
  const { root, trigger, panel, hoverGraceMs = 150, shouldStayOpen, alsoInside, disabled, onOpen } = opts;
  let mode: DropdownMode = opts.mode ?? globalMode;
  let graceTimer: number | undefined;

  const isOpen = () => !panel.hidden;
  const open = () => {
    if (disabled?.()) return; // e.g. a picker that isn't at its card's root
    window.clearTimeout(graceTimer);
    // A panel that animates (the .pop style) logs its arrival's frames (DEBUGGING.md §Frame telemetry).
    if (panel.hidden && panel.dataset.frames) frames.during("menu", 300, panel.dataset.frames);
    const appearing = panel.hidden;
    // One dropdown at a time. A trigger's click stops propagation (so its own panel is not
    // closed again at once), which also kept every OTHER open panel from seeing a click away:
    // the sleep panel stayed open over the Sound panel (2026-09-16). So opening closes the
    // others — except one that holds this trigger (the AirPlay square inside the volume panel).
    if (appearing) {
      for (const [h, r] of regions) {
        if (h === handle || !h.isOpen) continue;
        if (r.root.contains(trigger) || r.panel.contains(trigger)) continue;
        r.closeAway();
      }
    }
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    if (appearing) onOpen?.();
  };
  const close = (why: CloseReason = "api") => {
    if (shouldStayOpen?.(why)) return; // e.g. don't close out from under a drag
    window.clearTimeout(graceTimer);
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };
  const scheduleClose = () => {
    window.clearTimeout(graceTimer);
    graceTimer = window.setTimeout(() => close("leave"), hoverGraceMs);
  };

  const onEnter = () => { if (mode === "hover") open(); };
  const onLeave = () => { if (mode === "hover") scheduleClose(); };
  const onClick = (e: Event) => {
    e.stopPropagation(); // don't let the document handler immediately re-close it
    isOpen() ? close("toggle") : open();
  };
  const onDocClick = (e: MouseEvent) => {
    const t = e.target as Node;
    // A target the page no longer holds is NOT a click away. A panel that redraws itself
    // in its own click handler (the Rooms panel on Start a room, 2026-09-17) detaches the
    // button you pressed before the click reaches the document, and `contains` then says
    // "outside" about a press that was inside. A panel that WANTS to close on a press
    // calls close() itself, so nothing loses a close it asked for.
    if (!t.isConnected) return;
    const inside = root.contains(t) || panel.contains(t) || !!alsoInside?.().some((el) => el?.contains(t));
    if (isOpen() && !inside) close("away");
  };
  const onDocKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close("escape");
  };

  // Hover acts only in hover mode; click toggles in BOTH (lets a hover user pin the panel).
  root.addEventListener("pointerenter", onEnter);
  root.addEventListener("pointerleave", onLeave);
  if (!root.contains(panel)) {
    panel.addEventListener("pointerenter", onEnter);
    panel.addEventListener("pointerleave", onLeave);
  }
  trigger.addEventListener("click", onClick);
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onDocKey);

  const handle: DropdownHandle = {
    open,
    close: () => close("api"),
    setMode(m: DropdownMode) { mode = m; },
    destroy() {
      live.delete(handle);
      regions.delete(handle);
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onDocKey);
      // root/trigger listeners drop with the host element when a card clears its host.
    },
    get isOpen() { return isOpen(); },
  };
  live.add(handle);
  regions.set(handle, { root, panel, closeAway: () => close("away") });
  return handle;
}
