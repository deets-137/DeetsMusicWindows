// The two DOM helpers that were copied from file to file (the consistency read,
// 2026-09-25): `el` lived in three panels and `esc` in two. One copy each, here. This file
// imports nothing, so any module can use it without a cycle (split-pill.ts is imported by
// collection-card.ts, which re-exports `esc` for its older callers).

/** A new element with its class names and, optionally, its text. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

/** Text made safe for HTML, in element content and in a double-quoted attribute. */
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPES[c]);
