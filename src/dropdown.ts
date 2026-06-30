// Shared dropdown primitive.
//
// One open/close/dismiss mechanism for every titlebar dropdown (the settings
// menu and the volume flyout today). Callers differ only by their markup and by
// the trigger `mode` — which the "Hover-Menu" setting flips at runtime via
// `setMode`, so both dropdowns switch together.
//
// `root` is the hover region: it must contain BOTH the trigger and the panel so
// moving the cursor from the trigger into the panel never counts as "leaving".
// The panel is shown/hidden via its `hidden` attribute (CSS hides `[hidden]`).

export type DropdownMode = "click" | "hover";

export interface DropdownOptions {
  /** Hover region — contains the trigger and the (absolutely-positioned) panel. */
  root: HTMLElement;
  /** Click target; carries `aria-expanded`. */
  trigger: HTMLElement;
  /** The panel to reveal (toggled via its `hidden` attribute). */
  panel: HTMLElement;
  /** Initial trigger mode (default "click"). */
  mode?: DropdownMode;
  /** Close delay after the cursor leaves, in hover mode (default 150ms). */
  hoverGraceMs?: number;
  /** Veto closing while true (e.g. a slider mid-drag inside the panel). */
  shouldStayOpen?: () => boolean;
}

export interface DropdownHandle {
  open(): void;
  close(): void;
  setMode(mode: DropdownMode): void;
  readonly isOpen: boolean;
}

/** Wire open/close/dismiss for a trigger+panel pair. Returns a runtime handle. */
export function makeDropdown(opts: DropdownOptions): DropdownHandle {
  const { root, trigger, panel, hoverGraceMs = 150, shouldStayOpen } = opts;
  let mode: DropdownMode = opts.mode ?? "click";
  let graceTimer: number | undefined;

  const isOpen = () => !panel.hidden;
  const open = () => {
    window.clearTimeout(graceTimer);
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
  };
  const close = () => {
    if (shouldStayOpen?.()) return; // e.g. don't close out from under a drag
    window.clearTimeout(graceTimer);
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };
  const scheduleClose = () => {
    window.clearTimeout(graceTimer);
    graceTimer = window.setTimeout(close, hoverGraceMs);
  };

  // Hover: only acts while in hover mode (the grace covers any trigger↔panel gap).
  root.addEventListener("pointerenter", () => { if (mode === "hover") open(); });
  root.addEventListener("pointerleave", () => { if (mode === "hover") scheduleClose(); });

  // Click toggle works in BOTH modes — it lets a hover user pin the panel.
  trigger.addEventListener("click", (e) => {
    e.stopPropagation(); // don't let the document handler immediately re-close it
    isOpen() ? close() : open();
  });

  // Dismiss: click outside the region, or Escape.
  document.addEventListener("click", (e) => {
    if (isOpen() && !root.contains(e.target as Node)) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  return {
    open,
    close,
    setMode(m: DropdownMode) { mode = m; },
    get isOpen() { return isOpen(); },
  };
}
