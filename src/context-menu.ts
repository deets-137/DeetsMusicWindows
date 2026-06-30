// Context menu — a single shared, cursor-anchored popover (right-click actions).
//
// It's an HTML element inside the webview, so it's confined to the window (it can't
// overflow like a native OS menu — that's the deliberate trade for being fully themed
// + skinned via our tokens). Position is CLAMPED to the LIVE viewport measured at open
// time (never the fixed 480×864), so it's correct under a resized window, fullscreen,
// or the miniplayer. It closes on outside-press / Escape / scroll / resize.
//
// One instance at a time: opening a new menu (or right-clicking elsewhere) replaces it.

export interface MenuItem {
  label: string;
  run: () => void;
  disabled?: boolean;
}

let openEl: HTMLElement | null = null;
let cleanup: (() => void) | null = null;

/** Close the open menu (if any) and run its teardown (listeners + caller's onClose). */
export function closeContextMenu(): void {
  cleanup?.();
  cleanup = null;
  openEl?.remove();
  openEl = null;
}

/**
 * Open a menu at viewport coords (x, y) — typically `e.clientX/clientY`.
 * `onClose` fires whenever the menu goes away (item run, dismiss, or replacement) —
 * the caller uses it to clear any source-row highlight.
 */
export function openContextMenu(x: number, y: number, items: MenuItem[], onClose?: () => void): void {
  closeContextMenu(); // never stack two
  if (!items.length) return;

  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.setAttribute("role", "menu");
  menu.addEventListener("contextmenu", (e) => e.preventDefault()); // no native menu over ours
  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ctx-menu__item";
    btn.setAttribute("role", "menuitem");
    btn.textContent = item.label;
    if (item.disabled) btn.disabled = true;
    else
      btn.addEventListener("click", () => {
        closeContextMenu();
        item.run();
      });
    menu.appendChild(btn);
  }

  // Mount hidden so we can measure, then clamp to the live viewport and reveal.
  menu.style.visibility = "hidden";
  document.body.appendChild(menu);
  const pad = 6;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  let left = x + w + pad > vw ? x - w : x; // flip left near the right edge
  let top = y + h + pad > vh ? y - h : y; // flip up near the bottom edge
  left = Math.max(pad, Math.min(left, vw - w - pad)); // and never off-screen either way
  top = Math.max(pad, Math.min(top, vh - h - pad));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = "";

  openEl = menu;

  // ── dismissal ──
  const onPointerDown = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node)) closeContextMenu();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeContextMenu();
  };
  const onAway = () => closeContextMenu(); // scroll / resize / another contextmenu
  // capture so a scroll inside any container still dismisses
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("scroll", onAway, true);
  window.addEventListener("resize", onAway);
  window.addEventListener("contextmenu", onAway, true);

  cleanup = () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("scroll", onAway, true);
    window.removeEventListener("resize", onAway);
    window.removeEventListener("contextmenu", onAway, true);
    onClose?.();
  };
}
