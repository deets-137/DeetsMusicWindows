// The pin (docs/features/PIN.md): the title bar button that keeps the window above other
// windows, on every surface (his call 1A, 2026-10-26). In Mini and Midi, where the Compass and
// the other title bar buttons are hidden, it sits right of the app title.
//   - Not pinned: a press opens the panel. Four tiles (Cover · Player · Mini · This window) and
//     one button that names what it does ("Pin cover"). The panel remembers the last tile
//     (`pinView`).
//   - Pinned: a press unpins at once, with no panel (§3.6). The window goes back to the view,
//     size and place it had before the pin, when the pin changed the view.
// The pin is its own hold (his call 3A): the built-in rule `fixed:pin` holds `window.onTop`
// while the `pinned` fact is true. Settings › Window › Keep on top keeps its own value, and
// the two hover hints name each other.
// The glyph is a pin (his design, 2026-10-26): diagonal at rest, horizontal while the pointer
// holds the button and while the panel is open, vertical while pinned. CSS turns it
// (styles/pin.css).
// Cover (his call 2A) is the player with only its cover (surface.ts `data-cover`): the pointer
// over it shows Previous, Play / Pause, Next and an unpin icon; a drag on it moves the window.

import "./styles/pin.css";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { makeDropdown, type DropdownHandle } from "./dropdown";
import { enterRows } from "./pop";
import { keepRightInWindow } from "./quick-panel";
import { applySurface, currentMiniView, currentSurface, isCoverView, onSurfaceChange, setMiniView, type MiniView, type SurfaceName } from "./surface";
import { setting, setSetting, onSettingsChange, type Settings } from "./settings-store";
import { registerFact } from "./rules";
import { withAppearanceTransition } from "./appearance";
import * as diag from "./diag";

type PinView = Settings["pinView"];

/** The pin's own state: on or off, and the view to go back to. Not a setting: it is what the
 *  window is doing now, kept across a restart (PIN.md §3.3). */
const STORE_KEY = "deets.pin";

/** Where unpin goes back to. `x`, `y` are the outer position in physical px; `w`, `h` the
 *  inner size in css px (surface.ts `winBounds` uses the same units). */
interface Back { surface: SurfaceName; view: MiniView; x: number; y: number; w: number; h: number; max: boolean }
interface PinState { on: boolean; back: Back | null }

const VIEWS: { id: PinView; label: string; verb: string; hint: string; glyph: string }[] = [
  {
    id: "cover", label: "Cover", verb: "Pin cover",
    hint: "The album cover alone. Point at it for the controls",
    glyph: '<rect x="5" y="5" width="14" height="14" rx="1.5" class="pin__fill" />',
  },
  {
    id: "player", label: "Player", verb: "Pin player",
    hint: "Now Playing alone, with its controls",
    glyph: '<rect x="7" y="3.5" width="10" height="10" rx="1.2" class="pin__fill" /><path d="M6 17h12M9 20.5h6" />',
  },
  {
    id: "mini", label: "Mini", verb: "Pin mini",
    hint: "Now Playing and one card",
    glyph: '<rect x="6" y="3" width="12" height="6.5" rx="1.2" class="pin__fill" /><rect x="6" y="11.5" width="12" height="9.5" rx="1.2" />',
  },
  {
    id: "window", label: "This window", verb: "Pin this window",
    hint: "The window as it is now",
    glyph: '<rect x="3" y="5.5" width="18" height="13" rx="1.5" /><path d="M3 9h18" />',
  },
];

const HINT_OFF = "Keep on top: pin the cover, the player, Mini or this window above other windows. For a lasting choice, use Settings › Window › Keep on top";
const HINT_ON = "Unpin: the window goes back to how it was. Settings › Window › Keep on top still applies";

const appWindow = getCurrentWindow();

const load = (): PinState => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "");
    const b = raw?.back;
    const back: Back | null =
      b && typeof b === "object" && ["mini", "midi", "max"].includes(b.surface) && ["cards", "player", "cover"].includes(b.view) &&
      [b.x, b.y, b.w, b.h].every((n) => Number.isFinite(n))
        ? { surface: b.surface, view: b.view, x: b.x, y: b.y, w: b.w, h: b.h, max: b.max === true }
        : null;
    return { on: raw?.on === true, back };
  } catch {
    return { on: false, back: null }; // first run, or storage unavailable
  }
};
const save = (s: PinState) => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch { /* storage unavailable: the pin lasts the session */ }
};

let state = load();
const factListeners = new Set<() => void>();
const changeListeners = new Set<(on: boolean) => void>();
let busy = false; // one pin or unpin at a time: the window calls are async
let dropdown: DropdownHandle | null = null;

/** True while the window is pinned. (Not `isPinned`: that is a pinned tile, pins.ts.) */
export const windowPinned = (): boolean => state.on;

/** Subscribe to pin and unpin. Returns an unsubscribe fn. */
export function onPinChange(cb: (on: boolean) => void): () => void {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}

function setState(next: PinState): void {
  state = next;
  save(next);
  factListeners.forEach((cb) => cb());
  changeListeners.forEach((cb) => cb(next.on));
}

/** The surface and mini view a pick switches to; null = the window stays as it is. */
const target = (v: PinView): { s: SurfaceName; view: MiniView } | null =>
  v === "cover" ? { s: "mini", view: "cover" } : v === "player" ? { s: "mini", view: "player" } : v === "mini" ? { s: "mini", view: "cards" } : null;

/** Change the window's shape under the launch cover, as an agent's surface change does
 *  (appearance.ts, UX-COVERUPS.md §6b; his call, 2026-10-26): the cover fades in, the window
 *  resizes while it is opaque, and the cards rise in the new shape. A snap when *Animate look
 *  changes* is off or motion is reduced. Resolves once the change is made. */
const covered = (fn: () => Promise<void>): Promise<void> =>
  new Promise((done) => withAppearanceTransition("surface", fn, { after: done }));

/** Take the window out of a Windows snap before it is sized (tray.rs `main_unsnap`): a snapped
 *  window keeps its size from before the snap, and a drag puts it back. A pinned Cover dragged
 *  off a snapped Max grew to Max's size (his report on 1.1.0, 2026-10-26). */
const unsnap = async (cause: string): Promise<void> => {
  const was = await invoke<boolean>("main_unsnap").catch((e) => (console.error("[pin] unsnap", e), false));
  if (was) diag.log("pin:unsnap", { cause });
};

/** Pin the window: keep it above other windows, in the view `v`. */
export async function pin(v: PinView = setting("pinView"), cause = "button"): Promise<void> {
  if (state.on || busy) return;
  busy = true;
  try {
    const to = target(v);
    const changes = !!to && (currentSurface() !== to.s || currentMiniView() !== to.view);
    let back: Back | null = null;
    if (changes) {
      const [pos, max] = await Promise.all([appWindow.outerPosition(), appWindow.isMaximized()]);
      // A Cover is never a view to go back to: it lives only while pinned.
      const view: MiniView = currentMiniView() === "cover" ? "player" : currentMiniView();
      back = { surface: currentSurface(), view, x: pos.x, y: pos.y, w: Math.round(window.innerWidth), h: Math.round(window.innerHeight), max };
    }
    setState({ on: true, back }); // the rule holds the window on top from here
    diag.log("pin:on", { view: v, cause, from: back ? `${back.surface}:${back.view}` : "same" });
    if (to && changes) {
      const unmax = back?.max === true;
      await covered(async () => {
        if (unmax) await appWindow.unmaximize();
        else await unsnap("pin");
        await applySurface(to.s, to.view);
      });
    }
  } catch (e) {
    console.error("[pin] pin", e);
  } finally {
    busy = false;
  }
}

/** Unpin: the window stops being held on top and goes back to the view it had before. */
export async function unpin(cause = "button"): Promise<void> {
  if (!state.on || busy) return;
  busy = true;
  const b = state.back;
  try {
    setState({ on: false, back: null });
    diag.log("pin:off", { cause, to: b ? `${b.surface}:${b.view}` : "same" });
    if (!b) return;
    await covered(async () => {
      await unsnap("unpin"); // a pinned window snapped by hand (a drag to an edge)
      await applySurface(b.surface, b.view);
      // The exact size and place it had: applySurface set the view's open size.
      await appWindow.setSize(new LogicalSize(b.w, b.h));
      await appWindow.setPosition(new PhysicalPosition(b.x, b.y));
      if (b.max) await appWindow.maximize();
    });
  } catch (e) {
    console.error("[pin] unpin", e);
  } finally {
    busy = false;
  }
}

/** Open the panel (the Compass row). Pinned, there is no panel: the row unpins. */
export function openPinPanel(): boolean {
  if (state.on || !dropdown) return false;
  dropdown.open();
  return true;
}

const glyphSVG = (g: string) => `<svg class="pin__pic" viewBox="0 0 24 24" aria-hidden="true">${g}</svg>`;

export function initPin(): void {
  registerFact("pinned", () => state.on, {
    seam: (cb) => {
      factListeners.add(cb);
      return () => factListeners.delete(cb);
    },
  });

  // A Cover window that is not pinned has no way back (Cover is the pin's view only, §3.6):
  // a pin cleared outside the app, or an unpin cut short. It becomes the player.
  if (!state.on && isCoverView()) void applySurface("mini", "player");
  // The same while Midi or Max shows: mini must not come back as a bare Cover.
  if (!state.on && currentMiniView() === "cover") setMiniView("player");

  const root = document.getElementById("pin");
  const btn = document.getElementById("pin-open");
  const panel = document.getElementById("pin-panel");
  if (!root || !btn || !panel) return;

  panel.innerHTML = `
    <div class="pin__head">Keep on top</div>
    <div class="pin__tiles" role="radiogroup" aria-label="What stays on top">
      ${VIEWS.map((v) => `<button class="sound__pill pin__tile" type="button" role="radio" aria-checked="false" data-pin-view="${v.id}" title="${v.hint}">${glyphSVG(v.glyph)}<span>${v.label}</span></button>`).join("")}
    </div>
    <button class="sound__chip pin__go" type="button" data-pin-go title="Keeps the window above other windows until you unpin it. Settings › Window › Keep on top is not changed">
      ${glyphSVG('<path class="pin__go-pin" d="M9 3.5h6M10.2 3.5v5L7.6 12.4h8.8l-2.6-3.9v-5M12 12.4v8" />')}<span data-pin-verb></span>
    </button>`;
  const verb = panel.querySelector<HTMLElement>("[data-pin-verb]")!;

  const paintPanel = () => {
    const v = setting("pinView");
    panel.querySelectorAll<HTMLElement>("[data-pin-view]").forEach((t) => t.setAttribute("aria-checked", String(t.dataset.pinView === v)));
    verb.textContent = VIEWS.find((x) => x.id === v)?.verb ?? "Pin";
  };
  const paintButton = () => {
    btn.setAttribute("aria-pressed", String(state.on));
    btn.setAttribute("aria-label", state.on ? "Unpin" : "Keep on top");
    btn.title = state.on ? HINT_ON : HINT_OFF;
  };

  panel.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-pin-view]");
    if (t) {
      setSetting("pinView", t.dataset.pinView as PinView, "panel");
      return;
    }
    if ((e.target as HTMLElement).closest("[data-pin-go]")) {
      dropdown?.close();
      void pin(setting("pinView"), "panel");
    }
  });

  // Pinned, a press unpins and the panel never opens. Capture, so the dropdown's own click
  // handler on the same button does not see it.
  btn.addEventListener(
    "click",
    (e) => {
      if (!state.on) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      void unpin("button");
    },
    { capture: true },
  );

  dropdown = makeDropdown({
    root,
    trigger: btn,
    panel,
    disabled: () => state.on,
    onOpen: () => {
      paintPanel();
      keepRightInWindow(root, panel);
      enterRows(panel.children);
    },
  });
  window.addEventListener("resize", () => { if (!panel.hidden) keepRightInWindow(root, panel); });

  // The glyph turns horizontal while the pointer holds the button (his design): back on release,
  // or when the pointer leaves with the button still held.
  const release = () => btn.removeAttribute("data-held");
  btn.addEventListener("pointerdown", (e) => { if (e.button === 0) btn.setAttribute("data-held", ""); });
  btn.addEventListener("pointerup", release);
  btn.addEventListener("pointerleave", release);
  btn.addEventListener("pointercancel", release);

  // ── the Cover view: the unpin icon, and a drag that moves the window ──
  const cover = document.createElement("div");
  cover.className = "pin-cover";
  cover.innerHTML = `<button class="pin-cover__unpin" type="button" aria-label="Unpin" title="Unpin: the window goes back to how it was">${glyphSVG('<path d="M9 3.5h6M10.2 3.5v5L7.6 12.4h8.8l-2.6-3.9v-5M12 12.4v8" />')}</button>`;
  document.body.append(cover);
  cover.querySelector("button")!.addEventListener("click", () => void unpin("cover"));
  // A press on the cover moves the window (his call 2A). Capture, ahead of the cover's own drag
  // to another card: in Cover there is no other card.
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!isCoverView() || e.button !== 0) return;
      const t = e.target as HTMLElement;
      if (!t.closest(".np__art")) return;
      e.stopPropagation();
      void appWindow.startDragging().catch((err) => console.error("[pin] drag", err));
    },
    { capture: true },
  );

  onSurfaceChange(() => { if (!panel.hidden) dropdown?.close(); });
  paintButton();
  paintPanel();
  onPinChange(paintButton);
  onSettingsChange((k) => { if (k === "pinView") paintPanel(); });
  if (state.on) diag.log("pin:on", { view: "restored", cause: "launch" });
}
