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
// via its `hidden` attribute (CSS hides `[hidden]`).

export type DropdownMode = "click" | "hover";

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
  shouldStayOpen?: () => boolean;
  /** Veto OPENING while true (e.g. a slot picker that's only live at a card's root). */
  disabled?: () => boolean;
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
let globalMode: DropdownMode = "click";

/** Flip every live dropdown between click/hover (the Hover-Menu toggle calls this). */
export function setDropdownMode(mode: DropdownMode): void {
  globalMode = mode;
  live.forEach((h) => h.setMode(mode));
}

/** Wire open/close/dismiss for a trigger+panel pair. Returns a runtime handle. */
export function makeDropdown(opts: DropdownOptions): DropdownHandle {
  const { root, trigger, panel, hoverGraceMs = 150, shouldStayOpen, disabled } = opts;
  let mode: DropdownMode = opts.mode ?? globalMode;
  let graceTimer: number | undefined;

  const isOpen = () => !panel.hidden;
  const open = () => {
    if (disabled?.()) return; // e.g. a picker that isn't at its card's root
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

  const onEnter = () => { if (mode === "hover") open(); };
  const onLeave = () => { if (mode === "hover") scheduleClose(); };
  const onClick = (e: Event) => {
    e.stopPropagation(); // don't let the document handler immediately re-close it
    isOpen() ? close() : open();
  };
  const onDocClick = (e: MouseEvent) => {
    if (isOpen() && !root.contains(e.target as Node)) close();
  };
  const onDocKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };

  // Hover acts only in hover mode; click toggles in BOTH (lets a hover user pin the panel).
  root.addEventListener("pointerenter", onEnter);
  root.addEventListener("pointerleave", onLeave);
  trigger.addEventListener("click", onClick);
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onDocKey);

  const handle: DropdownHandle = {
    open,
    close,
    setMode(m: DropdownMode) { mode = m; },
    destroy() {
      live.delete(handle);
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onDocKey);
      // root/trigger listeners drop with the host element when a card clears its host.
    },
    get isOpen() { return isOpen(); },
  };
  live.add(handle);
  return handle;
}
