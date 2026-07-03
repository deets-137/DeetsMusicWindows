// Context menu — a single shared popover, cursor-anchored (right-click actions) or
// element-anchored (`openContextMenuUnder`, a dropdown below a button).
//
// It's an HTML element inside the webview, so it's confined to the window (it can't
// overflow like a native OS menu — that's the deliberate trade for being fully themed
// + skinned via our tokens). Position is CLAMPED to the LIVE viewport measured at open
// time (never the fixed 480×864), so it's correct under a resized window, fullscreen,
// or the miniplayer. It closes on outside-press / Escape / outside-scroll / resize.
//
// Items come in three species:
//  - `ActionItem` — a button row (Play Now, …).
//  - `InputItem` — a text field (e.g. a playlist name): Enter with a non-empty value
//    commits; every dismiss path is a cancel.
//  - `SubmenuItem` — a `›` row that opens a side FLYOUT (the settings-menu grammar,
//    see index.html/.flyout) holding its own items. The reveal is JS-LATCHED, not
//    CSS :hover — once open it stays while you type in a flyout field, and closes
//    when a sibling row is hovered, another submenu opens, or the menu goes away.
//    The flyout side-flips near the right edge and clamps/scrolls vertically.
//    `sub` resolves lazily (sync or async) the first time the flyout opens.
//
// One instance at a time: opening a new menu (or right-clicking elsewhere) replaces it.

export interface ActionItem {
  label: string;
  run: () => void;
  disabled?: boolean;
}
export interface InputItem {
  /** `label` is an optional non-interactive title rendered above the field (e.g. the
   *  New (+) dropdown's "Playlist" / "Folder" pair of labelled create fields). */
  input: { label?: string; placeholder: string; onSubmit: (value: string) => void };
}
export interface SubmenuItem {
  label: string;
  sub: () => MenuItem[] | Promise<MenuItem[]>;
}
export type MenuItem = ActionItem | InputItem | SubmenuItem;

let openEl: HTMLElement | null = null;
let cleanup: (() => void) | null = null;

/** Close the open menu (if any) and run its teardown (listeners + caller's onClose). */
export function closeContextMenu(): void {
  cleanup?.();
  cleanup = null;
  openEl?.remove();
  openEl = null;
}

const PAD = 6;
type Place = (w: number, h: number, vw: number, vh: number) => { left: number; top: number };

function openMenu(items: MenuItem[], place: Place, onClose?: () => void): void {
  closeContextMenu(); // never stack two
  if (!items.length) return;

  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.setAttribute("role", "menu");
  menu.addEventListener("contextmenu", (e) => e.preventDefault()); // no native menu over ours

  // ── flyout latch (one open at a time) ──
  let openWrap: HTMLElement | null = null;
  const closeFly = () => {
    if (!openWrap) return;
    const fly = openWrap.querySelector<HTMLElement>(".ctx-menu__fly");
    if (fly) fly.hidden = true;
    openWrap.classList.remove("is-open");
    openWrap = null;
  };

  // Side-flip + vertical clamp, measured against the live viewport. The flyout is
  // row-relative (offsetParent = the .ctx-menu__sub wrap), so the vertical fix is a
  // plain offsetTop shift; max-height in CSS keeps it scrollable when very long.
  const placeFly = (fly: HTMLElement) => {
    fly.classList.remove("is-left");
    fly.style.top = "";
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    if (menu.getBoundingClientRect().right + fly.offsetWidth + PAD > vw) fly.classList.add("is-left");
    const over = fly.getBoundingClientRect().bottom - (vh - PAD);
    if (over > 0) fly.style.top = `${fly.offsetTop - over}px`;
  };

  const appendItems = (host: HTMLElement, list: MenuItem[], topLevel: boolean) => {
    for (const item of list) {
      if ("sub" in item) {
        const wrap = document.createElement("div");
        wrap.className = "ctx-menu__sub";
        const row = document.createElement("button");
        row.type = "button";
        row.className = "ctx-menu__item ctx-menu__item--sub";
        row.setAttribute("role", "menuitem");
        row.setAttribute("aria-haspopup", "true");
        const lbl = document.createElement("span");
        lbl.textContent = item.label;
        const chev = document.createElement("span");
        chev.className = "ctx-menu__chev";
        chev.textContent = "›";
        chev.setAttribute("aria-hidden", "true");
        row.append(lbl, chev);
        const fly = document.createElement("div");
        fly.className = "ctx-menu__fly";
        fly.setAttribute("role", "menu");
        fly.hidden = true;
        wrap.append(row, fly);

        const open = () => {
          if (openWrap === wrap) return;
          closeFly();
          openWrap = wrap;
          wrap.classList.add("is-open");
          const show = () => {
            if (openWrap !== wrap) return; // latch moved on while items resolved
            fly.hidden = false;
            placeFly(fly);
          };
          if (fly.dataset.built) show();
          else
            Promise.resolve(item.sub())
              .then((subItems) => {
                appendItems(fly, subItems, false);
                fly.dataset.built = "1";
                show();
              })
              .catch((e) => console.error("[menu] submenu", e));
        };
        row.addEventListener("click", open);
        wrap.addEventListener("pointerenter", open); // hover opens; the latch keeps it open
        host.appendChild(wrap);
        continue;
      }
      if ("input" in item) {
        // The optional title sits ABOVE the field as its own row — the field wrap
        // itself is the canvas well, and the label mustn't sit inside the box.
        if (item.input.label) {
          const title = document.createElement("div");
          title.className = "ctx-menu__label";
          title.textContent = item.input.label;
          if (topLevel) title.addEventListener("pointerenter", closeFly);
          host.appendChild(title);
        }
        const wrap = document.createElement("div");
        wrap.className = "ctx-menu__field";
        const inp = document.createElement("input");
        inp.type = "text";
        inp.className = "ctx-menu__input";
        inp.placeholder = item.input.placeholder;
        inp.addEventListener("keydown", (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const v = inp.value.trim();
          if (!v) return; // empty Enter = no-op; Escape / click-away is the cancel
          closeContextMenu();
          item.input.onSubmit(v);
        });
        wrap.appendChild(inp);
        if (topLevel) wrap.addEventListener("pointerenter", closeFly);
        host.appendChild(wrap);
        continue;
      }
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
      if (topLevel) btn.addEventListener("pointerenter", closeFly); // hovering a sibling unlatches
      host.appendChild(btn);
    }
  };
  appendItems(menu, items, true);

  // Mount hidden so we can measure, then clamp to the live viewport and reveal.
  menu.style.visibility = "hidden";
  document.body.appendChild(menu);
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const pos = place(w, h, vw, vh);
  const left = Math.max(PAD, Math.min(pos.left, vw - w - PAD)); // never off-screen either way
  const top = Math.max(PAD, Math.min(pos.top, vh - h - PAD));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = "";
  menu.querySelector("input")?.focus(); // a top-level field is ready to type (flyouts build lazily)

  openEl = menu;

  // ── dismissal ──
  const onPointerDown = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node)) closeContextMenu();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeContextMenu();
  };
  // A scroll INSIDE the menu (a long flyout scrolling its own list) must not dismiss;
  // any outside scroll still does. Capture so scrolls in any container are seen.
  const onScroll = (e: Event) => {
    if (!(e.target instanceof Node) || !menu.contains(e.target)) closeContextMenu();
  };
  const onAway = () => closeContextMenu(); // resize / another contextmenu
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onAway);
  window.addEventListener("contextmenu", onAway, true);

  cleanup = () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onAway);
    window.removeEventListener("contextmenu", onAway, true);
    onClose?.();
  };
}

/**
 * Open a menu at viewport coords (x, y) — typically `e.clientX/clientY`.
 * `onClose` fires whenever the menu goes away (item run, dismiss, or replacement) —
 * the caller uses it to clear any source-row highlight.
 */
export function openContextMenu(x: number, y: number, items: MenuItem[], onClose?: () => void): void {
  openMenu(
    items,
    (w, h, vw, vh) => ({
      left: x + w + PAD > vw ? x - w : x, // flip left near the right edge
      top: y + h + PAD > vh ? y - h : y, // flip up near the bottom edge
    }),
    onClose,
  );
}

/** Open a menu anchored under `el`, right edges aligned (a "dropdown"). */
export function openContextMenuUnder(el: HTMLElement, items: MenuItem[], onClose?: () => void): void {
  openMenu(
    items,
    (w) => {
      const r = el.getBoundingClientRect();
      return { left: r.right - w, top: r.bottom + PAD };
    },
    onClose,
  );
}
