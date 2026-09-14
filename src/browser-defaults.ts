// Browser defaults, replaced (DRAG-DROP.md §6). The app is not a web page: no native image
// or text drag (the drag primitive is row-drag.ts), and no native right-click menu. A text
// field gets our own menu instead — Cut · Copy · Paste · Select All, greyed when they can't
// act. Browser keys (Ctrl+F, F5, zoom, …) are turned off in Rust (lib.rs, release only).

import { openContextMenu } from "./context-menu";

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

export function initBrowserDefaults(): void {
  window.addEventListener("dragstart", (e) => e.preventDefault());
  // Bubble phase: a card that opened its own menu already called preventDefault.
  window.addEventListener("contextmenu", (e) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    const f = textField(e.target as HTMLElement);
    if (f) fieldMenu(f, e.clientX, e.clientY);
  });
}
