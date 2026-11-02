// Browser defaults, replaced (DRAG-DROP.md §6). The app is not a web page: no native image
// or text drag (the drag primitive is row-drag.ts), and no native right-click menu. A text
// field gets our own menu instead — Cut · Copy · Paste · Select All, greyed when they can't
// act. Browser keys (Ctrl+F, F5, zoom, …) are turned off in Rust (lib.rs, release only).
// The mouse's back button goes back one step in the card under the pointer, not in the
// webview's history (DRAG-DROP.md §6a, his ask 2026-11-02).

import { openContextMenu } from "./context-menu";
import { backIn } from "./list-keys";
import * as diag from "./diag";

const TEXT_TYPES = new Set(["text", "search", "url", "email", "tel", ""]);

type Field = HTMLInputElement | HTMLTextAreaElement;
const textField = (el: HTMLElement | null): Field | null => {
  const f = el?.closest<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  if (!f) return null;
  return f instanceof HTMLTextAreaElement || TEXT_TYPES.has(f.type) ? f : null;
};

function fieldMenu(f: Field, x: number, y: number): void {
  const s = f.selectionStart ?? 0;
  const e = f.selectionEnd ?? 0;
  const selected = f.value.slice(s, e);
  const locked = f.readOnly || f.disabled;
  // Write into the field the way typing does, so its own `input` listeners (a search) run.
  const put = (text: string) => {
    f.focus();
    f.setRangeText(text, s, e, "end");
    f.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const fail = (what: string) => (err: unknown) => console.warn(`[field menu] ${what}`, err);
  openContextMenu(x, y, [
    { label: "Cut", disabled: !selected || locked, run: () => void navigator.clipboard.writeText(selected).then(() => put("")).catch(fail("cut")) },
    { label: "Copy", disabled: !selected, run: () => void navigator.clipboard.writeText(selected).catch(fail("copy")) },
    { label: "Paste", disabled: locked, run: () => void navigator.clipboard.readText().then(put).catch(fail("paste")) },
    { label: "Select All", disabled: !f.value, run: () => { f.focus(); f.select(); } },
  ]);
}

/** One Back step in the card at `at`: its list's own step (Escape's), else its visible Back
 *  button (a card with no list keys, the update card's Older page). */
function backAt(at: Element | null, how: "mouse" | "key"): void {
  const panel = at?.closest<HTMLElement>(".panel") ?? null;
  let took = false;
  if (panel) {
    took = backIn(panel);
    if (!took) {
      const btn = [...panel.querySelectorAll<HTMLButtonElement>('.panel__back[aria-label="Back"]')].find((b) => !b.hidden && !b.disabled && b.offsetParent !== null);
      if (btn) {
        btn.click();
        took = true;
      }
    }
  }
  diag.log("ui:back", { how, card: panel?.dataset.slot ?? panel?.dataset.card ?? null, took });
}

export function initBrowserDefaults(): void {
  window.addEventListener("dragstart", (e) => e.preventDefault());
  // The mouse's back button (Windows' XButton1, `button` 3) and forward button (4). Chromium's
  // own history step runs as mouseup's default action, so mouseup is where it stops; a stop on
  // auxclick does not stop it. Forward has no step of ours yet: it only does nothing.
  window.addEventListener("mouseup", (e) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    if (e.button === 3) backAt(e.target as Element | null, "mouse");
  });
  // A mouse program (Logitech Options and others) can send the keyboard's Browser Back key in
  // place of the button: the same step, in the card under the pointer's last place.
  let px = -1;
  let py = -1;
  window.addEventListener("pointermove", (e) => { px = e.clientX; py = e.clientY; }, { passive: true });
  window.addEventListener("keydown", (e) => {
    if (e.key !== "BrowserBack" || e.defaultPrevented) return;
    e.preventDefault();
    backAt(px >= 0 ? document.elementFromPoint(px, py) : null, "key");
  });
  // Bubble phase: a card that opened its own menu already called preventDefault.
  window.addEventListener("contextmenu", (e) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    const f = textField(e.target as HTMLElement);
    if (f) fieldMenu(f, e.clientX, e.clientY);
  });
}
