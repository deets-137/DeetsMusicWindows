// The pure half of the update card (update-card.ts; docs/features/UPDATE-CARD.md §3). No DOM and no
// Tauri, so tests/update-card-rules.test.ts pins the rules.

import { compareVersions } from "./update-rules";

export interface Entry {
  version: string;
  date: string;
  body: string;
}

/** One version page: a minor line ("1.2") and its releases (1.2.0, 1.2.1), oldest first. The nav
 *  button reads "1.2" (§3.8), so the patches of one line share its page. */
export interface Line {
  line: string;
  entries: Entry[];
}

/** "1.2.1" → "1.2". */
export const lineOf = (v: string): string => v.split("-")[0].split(".").slice(0, 2).join(".");

/** The releases cut into lines, oldest line first (his call 1: the pages read oldest first). */
export function groupLines(entries: readonly Entry[]): Line[] {
  const sorted = [...entries].sort((a, b) => compareVersions(a.version, b.version));
  const out: Line[] = [];
  for (const e of sorted) {
    const l = lineOf(e.version);
    const last = out[out.length - 1];
    if (last?.line === l) last.entries.push(e);
    else out.push({ line: l, entries: [e] });
  }
  return out;
}

/** The last `n` lines (§3.7: *What's New* shows the last 3), oldest first. */
export const lastLines = (lines: readonly Line[], n = 3): Line[] => lines.slice(-n);

/**
 * The page the card opens on (his call 13, 2026-10-29): the oldest line with a release newer than
 * the version the user ran before this update, so the news starts where theirs starts and Next
 * reads on in order. The newest line when nothing is new: no update yet (`before` ""), or the card
 * was already opened in this version (`seenNow`).
 */
export function startLine(lines: readonly Line[], before: string, seenNow: boolean): string | undefined {
  const newest = lines[lines.length - 1]?.line;
  if (!before || seenNow) return newest;
  return lines.find((l) => l.entries.some((e) => compareVersions(e.version, before) > 0))?.line ?? newest;
}

export interface Paragraph {
  /** The bold lead, without its closing period; null when the paragraph has none. */
  lead: string | null;
  /** The lead as written, its own closing mark kept ("…the Player!"), for the page. */
  shown: string | null;
  /** The text after the lead. */
  text: string;
}

/** An entry's paragraphs, the *Fixes* one left out (§3.1, as in the Updates panel). */
export function paragraphs(body: string): Paragraph[] {
  return body
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim().replace(/\s*\n\s*/g, " "))
    .filter(Boolean)
    .map((p): Paragraph => {
      const m = /^\*\*([^*]+?)\*\*\s*/.exec(p);
      return m
        ? { lead: m[1].trim().replace(/\.$/, ""), shown: m[1].trim(), text: p.slice(m[0].length) }
        : { lead: null, shown: null, text: p };
    })
    .filter((p) => !p.lead || !/^fixes$/i.test(p.lead));
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** The notes' inline marks as markup: **bold**, *italic* (a setting's name), `code`. Escaped first. */
export function inlineHtml(text: string): string {
  return esc(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

/** The marks (`NEW_MARKS`, `DEFAULT_CHANGES`) a line brings, up to the installed version: a row
 *  marked for a later release is not shown yet. */
export function inLine<T extends { since: string }>(items: readonly T[], line: string, upTo: string): T[] {
  return items.filter((m) => lineOf(m.since) === line && compareVersions(m.since, upTo) <= 0);
}

export interface Hit {
  line: string;
  version: string;
  kind: "note" | "setting";
  /** The lead or the setting's name. */
  text: string;
}

/** The Older page's search (§3.7): every word of `term` in a paragraph (its lead and text) or in a
 *  setting's name. A paragraph hit names its lead (or its first words). Newest first. */
export function searchUpdates(term: string, lines: readonly Line[], settings: readonly { since: string; label: string }[]): Hit[] {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const has = (s: string) => words.every((w) => s.toLowerCase().includes(w));
  const hits: Hit[] = [];
  for (const l of lines)
    for (const e of l.entries) {
      for (const p of paragraphs(e.body))
        if (has(`${p.lead ?? ""} ${p.text}`)) hits.push({ line: l.line, version: e.version, kind: "note", text: p.lead ?? `${p.text.split(" ").slice(0, 8).join(" ")}…` });
      for (const s of settings) if (s.since === e.version && has(s.label)) hits.push({ line: l.line, version: e.version, kind: "setting", text: s.label });
    }
  return hits.sort((a, b) => compareVersions(b.version, a.version));
}
