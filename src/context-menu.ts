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
//    when a SIBLING row is hovered, another submenu at the same depth opens, or the
//    menu goes away. A submenu can hold another submenu (Refresh ▸ Weekly ▸ Fri):
//    the latch is one wrap per depth, so a nested row never closes its own parent.
//    The flyout side-flips near the right edge and clamps/scrolls vertically.
//    `sub` resolves lazily (sync or async) the first time the flyout opens.
//
// One instance at a time: opening a new menu (or right-clicking elsewhere) replaces it.

import * as frames from "./frames";
import * as diag from "./diag";
import { enterRows } from "./pop";

export interface ActionItem {
  label: string;
  run: () => void;
  disabled?: boolean;
  /** Trusted markup shown at the row's end (the Apple Music sigil on an Apple playlist). */
  badge?: string;
  /** A cover at the row's start (an image URL) — a search result row (`InputItem.onInput`). */
  art?: string;
  /** A second, quieter line under the label (the artist of an album result). */
  note?: string;
}
export interface InputItem {
  /** `label` is an optional non-interactive title rendered above the field (e.g. the
   *  New (+) dropdown's "Playlist" / "Folder" pair of labelled create fields). */
  input: {
    label?: string;
    placeholder: string;
    /** Text the field opens with (Rename: the current name). */
    value?: string;
    onSubmit: (value: string) => void;
    /**
     * A field that SEARCHES (the Diary's New entry, 2026-09-24): called on each pause in the
     * typing (`SEARCH_PAUSE_MS`). `show` fills a results area right under the field — rows,
     * or a line of text — and the area grows to fit, animated, so the menu opens downward
     * as the answers arrive. Empty text empties it. A stale call's `show` does nothing.
     */
    onInput?: (value: string, show: (rows: ActionItem[] | string) => void) => void;
  };
}
/** The pause in typing before a searching field asks (the Search card's own debounce). */
const SEARCH_PAUSE_MS = 300;
export interface SubmenuItem {
  label: string;
  sub: () => MenuItem[] | Promise<MenuItem[]>;
  /** Trusted markup shown between the label and the flyout chevron — what this submenu
   *  is currently set to (`Refresh ▸  Weekly · Fri`). Build it with `menuState`. */
  badge?: string;
}

/** A trailing state mark for a menu row: the current choice on a submenu parent, or the
 *  tick on the chosen row inside it. It is the same secondary treatment the flyout chevron
 *  already carries on the same row family, so it needs no color role and no token of its
 *  own. Text is escaped — it goes in as markup. */
export function menuState(text: string): string {
  const span = document.createElement("span");
  span.className = "ctx-menu__state";
  span.textContent = text;
  return span.outerHTML;
}

/** The mark on the chosen row inside a choice flyout. */
export const MENU_CHOSEN = menuState("\u2713");
export type MenuItem = ActionItem | InputItem | SubmenuItem;

let openEl: HTMLElement | null = null;
let cleanup: (() => void) | null = null;

// The element the last right-click landed on (a keyboard menu key dispatches one on the
// row too). A row that acts later — "Start a Web" flies the row to the Playlists card —
// reads it, so no card has to pass its row element into a shared menu builder.
let sourceEl: HTMLElement | null = null;
window.addEventListener("contextmenu", (e) => { sourceEl = e.target instanceof HTMLElement ? e.target : null; }, true);

/** The row, tile or hero the open menu was opened on (null when it is gone). */
export function menuSource(): HTMLElement | null {
  const el = sourceEl?.closest<HTMLElement>(
    "[data-idx], [data-row], [data-song], [data-album], [data-artist], [data-playlist], [data-station], [data-shelf-item], .qrow, .qnow, .lib-hero, .np__art",
  ) ?? sourceEl;
  return el?.isConnected ? el : null;
}

/** Close the open menu (if any) and run its teardown (listeners + caller's onClose). */
export function closeContextMenu(): void {
  cleanup?.();
  cleanup = null;
  openEl?.remove();
  openEl = null;
}

const PAD = 6;
type Place = (w: number, h: number, vw: number, vh: number) => { left: number; top: number };

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Fill a searching field's results area (`InputItem.onInput`) and grow or shrink it to fit.
 *  The height change is the `--menu-grow-dur` / `--menu-grow-ease` skin tokens; the new rows
 *  slide in with `enterRows` (the dropdown rule). Reduced motion: it snaps. */
function fillResults(results: HTMLElement, rows: ActionItem[] | string): void {
  const from = results.offsetHeight;
  results.replaceChildren();
  if (typeof rows === "string") {
    const p = document.createElement("div");
    p.className = "ctx-menu__note";
    p.textContent = rows;
    results.append(p);
  } else {
    for (const item of rows) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ctx-menu__item ctx-menu__item--result";
      btn.setAttribute("role", "menuitem");
      if (item.art) {
        const img = document.createElement("img");
        img.className = "ctx-menu__art";
        img.src = item.art;
        img.alt = "";
        img.decoding = "async";
        btn.append(img);
      }
      const text = document.createElement("span");
      text.className = "ctx-menu__text";
      const lbl = document.createElement("span");
      lbl.className = "ctx-menu__line";
      lbl.textContent = item.label;
      text.append(lbl);
      if (item.note) {
        const note = document.createElement("span");
        note.className = "ctx-menu__line ctx-menu__line--note";
        note.textContent = item.note;
        text.append(note);
      }
      btn.append(text);
      btn.addEventListener("click", () => {
        closeContextMenu();
        diag.log("ui:act", { do: "menu", what: "search result" });
        item.run();
      });
      results.append(btn);
    }
  }
  results.classList.toggle("has-rows", results.childElementCount > 0);
  const to = results.offsetHeight; // its natural height, capped by --menu-results-max-h
  if (from !== to && !reducedMotion()) {
    // Read through real properties: a custom property keeps a `calc()` or a `var()` chain as
    // text, which parseFloat cannot read (the Diary morph ran in 0 ms that way, 2026-09-24).
    results.style.transitionDuration = "var(--menu-grow-dur)";
    results.style.transitionTimingFunction = "var(--menu-grow-ease)";
    const cs = getComputedStyle(results);
    const raw = cs.transitionDuration.split(",")[0].trim();
    const easing = cs.transitionTimingFunction.trim() || "ease"; // whole: cubic-bezier has commas
    results.style.transitionDuration = "";
    results.style.transitionTimingFunction = "";
    const dur = (parseFloat(raw) || 0) * (raw.endsWith("ms") ? 1 : 1000);
    results.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: dur, easing });
  }
  if (Array.isArray(rows)) enterRows(results.querySelectorAll(".ctx-menu__item"));
}

function openMenu(items: MenuItem[], place: Place, onClose?: () => void): void {
  closeContextMenu(); // never stack two
  if (!items.length) return;
  frames.during("menu", 300);

  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.setAttribute("role", "menu");
  menu.addEventListener("contextmenu", (e) => e.preventDefault()); // no native menu over ours

  // ── flyout latch (one open PER LEVEL) ──
  // `openWraps[d]` is the submenu wrap whose flyout is open at depth d, so a menu can
  // stand several levels deep (Refresh ▸ Weekly ▸ Fri). Hovering any row closes its OWN
  // level and everything deeper, and never its ancestors — a single latch closed the
  // parent flyout the moment you reached a nested row inside it.
  const openWraps: HTMLElement[] = [];
  const closeFrom = (depth: number) => {
    while (openWraps.length > depth) {
      const wrap = openWraps.pop()!;
      // `:scope >` — a deeper flyout is a descendant too, and must not be taken for this one.
      const fly = wrap.querySelector<HTMLElement>(":scope > .ctx-menu__fly");
      if (fly) fly.hidden = true;
      wrap.classList.remove("is-open");
    }
  };

  // Side-flip + vertical clamp, measured against the live viewport. `host` is the box the
  // flyout grows out of (the menu itself, or the parent flyout), so a nested flyout flips
  // on its own right edge. The flyout is row-relative (offsetParent = the .ctx-menu__sub
  // wrap), so the vertical fix is a plain offsetTop shift; max-height in CSS keeps it
  // scrollable when very long.
  const placeFly = (fly: HTMLElement, host: HTMLElement) => {
    fly.classList.remove("is-left");
    fly.style.top = "";
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    if (host.getBoundingClientRect().right + fly.offsetWidth + PAD > vw) fly.classList.add("is-left");
    const over = fly.getBoundingClientRect().bottom - (vh - PAD);
    if (over > 0) fly.style.top = `${fly.offsetTop - over}px`;
  };

  const appendItems = (host: HTMLElement, list: MenuItem[], depth: number) => {
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
        row.append(lbl);
        if (item.badge) row.insertAdjacentHTML("beforeend", item.badge);
        row.append(chev);
        const fly = document.createElement("div");
        fly.className = "ctx-menu__fly";
        fly.setAttribute("role", "menu");
        fly.hidden = true;
        wrap.append(row, fly);

        const open = () => {
          if (openWraps[depth] === wrap) return;
          closeFrom(depth); // this level and deeper; the ancestors that hold us stay open
          openWraps.push(wrap);
          wrap.classList.add("is-open");
          const show = () => {
            if (openWraps[depth] !== wrap) return; // latch moved on while items resolved
            fly.hidden = false;
            placeFly(fly, host);
          };
          if (fly.dataset.built) show();
          else
            Promise.resolve(item.sub())
              .then((subItems) => {
                appendItems(fly, subItems, depth + 1);
                // A flyout that holds a submenu must not clip it: `overflow-y: auto` also
                // clips horizontally, and a child flyout sits at left: 100%. The cost is
                // that this one flyout no longer scrolls when very long.
                if (subItems.some((i) => "sub" in i)) fly.classList.add("ctx-menu__fly--deep");
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
          title.addEventListener("pointerenter", () => closeFrom(depth));
          host.appendChild(title);
        }
        const wrap = document.createElement("div");
        wrap.className = "ctx-menu__field";
        const inp = document.createElement("input");
        inp.type = "text";
        inp.className = "ctx-menu__input";
        inp.placeholder = item.input.placeholder;
        if (item.input.value) inp.value = item.input.value;
        inp.addEventListener("keydown", (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const v = inp.value.trim();
          if (!v) return; // empty Enter = no-op; Escape / click-away is the cancel
          closeContextMenu();
          item.input.onSubmit(v);
        });
        wrap.appendChild(inp);
        wrap.addEventListener("pointerenter", () => closeFrom(depth));
        host.appendChild(wrap);
        const search = item.input.onInput;
        if (search) {
          // The results area: empty (zero tall) until the first answer, then it grows.
          const results = document.createElement("div");
          results.className = "ctx-menu__results app-scroll";
          results.addEventListener("pointerenter", () => closeFrom(depth));
          host.appendChild(results);
          menu.classList.add("ctx-menu--search");
          let seq = 0;
          let timer = 0;
          inp.addEventListener("input", () => {
            window.clearTimeout(timer);
            const mine = ++seq;
            const v = inp.value.trim();
            const show = (rows: ActionItem[] | string) => {
              if (mine !== seq || !results.isConnected) return;
              fillResults(results, rows);
            };
            if (!v) return show([]);
            timer = window.setTimeout(() => search(v, show), SEARCH_PAUSE_MS);
          });
        }
        continue;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ctx-menu__item";
      btn.setAttribute("role", "menuitem");
      if (item.badge) {
        btn.classList.add("ctx-menu__item--badged");
        const lbl = document.createElement("span");
        lbl.textContent = item.label;
        btn.append(lbl);
        btn.insertAdjacentHTML("beforeend", item.badge);
      } else btn.textContent = item.label;
      if (item.disabled) btn.disabled = true;
      else
        btn.addEventListener("click", () => {
          closeContextMenu();
          // The click trail (LOGGING.md §The click trail): which menu row ran. The label
          // is the gesture — a UI word, never a song title.
          diag.log("ui:act", { do: "menu", what: item.label.slice(0, 40) });
          item.run();
        });
      btn.addEventListener("pointerenter", () => closeFrom(depth)); // hovering a sibling unlatches
      host.appendChild(btn);
    }
  };
  appendItems(menu, items, 0);

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
