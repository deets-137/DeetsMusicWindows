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

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Text made safe for HTML: element content, and a double- or single-quoted attribute
 *  (`'` added 2026-09-29; no template uses single quotes today, so none can slip later). */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** A module's error reporter for a promise chain: `const err = errorOf("menu")`, then
 *  `.catch(err("play now"))` logs `[menu] play now` with the error. Every console.error
 *  writes an ERROR line to the log file (his call 2026-09-25). One copy here; four modules
 *  each had their own until 2026-09-27. */
export const errorOf = (tag: string) => (what: string) => (e: unknown) => console.error(`[${tag}] ${what}`, e);
