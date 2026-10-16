// The condition blanks' menus, shared by the Rulez card and the Filter panel (RULEZ.md §6.4,
// features/filter-rules.md §13.3). A fact picked by section, then its value; the typing field at
// the top of a word menu; names suggested from your library as you type. One copy, so a
// filter and a rule never offer the same fact two ways.
//
// `songs` is the Filter panel: a text fact also offers Contains, and a fact a song may lack
// offers "has a value" / "has no value" (filter-rules.md §13.4).

import type { FactId, Leaf } from "./rules-eval";
import { choicesOf, parseNumber, parseTime, type FactWord, type Lists } from "./rulez-words";
import { openContextMenuUnder, type ActionItem, type MenuItem } from "./context-menu";
import { MAY_BE_MISSING } from "./filter-eval";
import type { Track } from "./library";
import type { BlockKind } from "./rulez-blocks";

export interface CondCtx {
  /** The facts to offer: Rulez's FACTS, or the filter's FILTER_FACTS. */
  words: readonly FactWord[];
  sections: readonly string[];
  /** A fact the app can read now (a Rulez fact must be registered with the engine). */
  usable: (id: FactId) => boolean;
  lists: () => Lists;
  /** The library's songs, for the names suggested as you type. */
  library: () => readonly Track[];
  songs?: boolean;
}

export const KIND_WORDS: Record<BlockKind, string> = { all: "all of these", any: "any of these", none: "none of these" };

/** Sections as submenus, each holding its own rows (empty sections left out). */
export function bySection<T extends { section: string }>(sections: readonly string[], words: readonly T[], row: (w: T) => MenuItem): MenuItem[] {
  return sections
    .map((s) => ({ s, ws: words.filter((w) => w.section === s) }))
    .filter((x) => x.ws.length)
    .map(({ s, ws }) => ({ label: s, sub: () => ws.map(row) }));
}

/** A typing field at the top of a word menu (his call, 2026-10-10, RULEZ.md §19): a few
 *  letters show the rows of every section that hold them, with the section as the note;
 *  Enter picks the first. A word with a value opens its value rows under the same blank.
 *  Only the section flyouts are searched (a Clear row or a group stays where it is). */
export function withSearch(el: HTMLElement, items: MenuItem[], placeholder: string, sections: readonly string[]): MenuItem[] {
  type Row = { label: string; note: string; item: MenuItem };
  const rows: Row[] = [];
  for (const it of items) {
    if (!("sub" in it) || !sections.includes(it.label)) continue;
    const sub = it.sub();
    if (!Array.isArray(sub)) continue;
    for (const s of sub) if ("label" in s && !("input" in s) && !("disabled" in s && s.disabled)) rows.push({ label: s.label, note: it.label, item: s });
  }
  const find = (q: string): Row[] => {
    const t = q.toLowerCase();
    const hits = rows.filter((r) => r.label.toLowerCase().includes(t));
    return hits.sort((a, b) => Number(!a.label.toLowerCase().startsWith(t)) - Number(!b.label.toLowerCase().startsWith(t)));
  };
  const pick = (r: Row) => {
    if ("run" in r.item) r.item.run();
    else if ("sub" in r.item) openContextMenuUnder(el, r.item.sub() as MenuItem[]);
  };
  return [
    { input: {
      placeholder,
      onSubmit: (v) => { const r = find(v)[0]; if (r) pick(r); },
      onInput: (v, show) => { const hits = find(v).slice(0, 8); show(hits.length ? hits.map((r): ActionItem => ({ label: r.label, note: r.note, run: () => pick(r) })) : "Nothing here holds that."); },
    } },
    ...items,
  ];
}

type NameKind = "genre" | "artist" | "album";
/** Your library's names that hold `text`: the ones that start with it first, then the rest,
 *  each A–Z (no Apple call). */
export function matchNames(kind: NameKind, text: string, library: readonly Track[]): string[] {
  const q = text.toLowerCase();
  const pool = new Set<string>();
  for (const t of library) {
    const vals = kind === "genre" ? t.genres : kind === "artist" ? [t.artistName] : [t.albumName ?? ""];
    for (const v of vals) if (v && v !== "Music" && v.toLowerCase().includes(q)) pool.add(v);
    if (pool.size > 40) break;
  }
  const starts = (v: string) => (v.toLowerCase().startsWith(q) ? 0 : 1);
  return [...pool].sort((a, b) => starts(a) - starts(b) || a.localeCompare(b));
}
/** Suggest from your library as you type. */
function suggest(kind: NameKind, text: string, library: readonly Track[], submit: (v: string) => void): ActionItem[] | string {
  const rows = matchNames(kind, text, library).slice(0, 8).map((v): ActionItem => ({ label: v, run: () => submit(v) }));
  return rows.length ? rows : "Nothing in your library matches. Press Enter to use it as typed.";
}
/** Enter in a suggesting field: the library's own spelling, so "ja" saves "Jazz" and not a
 *  word no song has (a leaf compares the whole name). The same name typed in full wins over
 *  a longer one; with no match the text stays as typed, as the empty line says. */
function resolveTyped(kind: NameKind, text: string, library: readonly Track[]): string {
  const found = matchNames(kind, text, library);
  return found.find((v) => v.toLowerCase() === text.toLowerCase()) ?? found[0] ?? text;
}

/** The value rows for one fact: they build a leaf and hand it to `done`. */
export function valueItems(ctx: CondCtx, w: FactWord, done: (l: Leaf) => void): MenuItem[] {
  const L = (x: Omit<Leaf, "fact">): void => done({ fact: w.id, ...x });
  // A filter: a fact a song may lack can be asked "has a value" (filter-rules.md §13.4).
  const known: MenuItem[] = ctx.songs && MAY_BE_MISSING.has(w.id)
    ? [{ label: "Has a value", run: () => L({ known: true }) }, { label: "Has no value", run: () => L({ known: false }) }]
    : [];
  switch (w.kind) {
    case "bool":
      return [{ label: w.yes!, run: () => L({ is: true }) }, { label: w.no!, run: () => L({ is: false }) }];
    case "choice": {
      const cs = choicesOf(w, ctx.lists());
      if (!cs.length) return [{ label: "Nothing to pick yet", disabled: true, run: () => {} }];
      return [
        { label: "Is", sub: () => cs.map((c): MenuItem => ({ label: c.label, run: () => L({ is: c.value }) })) },
        { label: "Is not", sub: () => cs.map((c): MenuItem => ({ label: c.label, run: () => L({ isNot: c.value }) })) },
      ];
    }
    case "time": {
      const at = (key: "gt" | "lt") => (v: string) => {
        const t = parseTime(v);
        if (t !== null) L({ [key]: t });
      };
      return [
        { input: { label: "Is after", placeholder: "8:00 PM", onSubmit: at("gt") } },
        { input: { label: "Is before", placeholder: "6:00 AM", onSubmit: at("lt") } },
      ];
    }
    case "number": {
      const num = (key: "gt" | "lt" | "is") => (v: string) => {
        const n = parseNumber(v, w.unit);
        if (n !== null) L({ [key]: n });
      };
      const ph = w.unit === "s" ? "A length (4:05)" : w.unit ? `A number (${w.unit})` : "A number";
      return [
        { input: { label: "Is above", placeholder: ph, onSubmit: num("gt") } },
        { input: { label: "Is below", placeholder: ph, onSubmit: num("lt") } },
        { input: { label: "Is", placeholder: ph, onSubmit: num("is") } },
        ...known,
      ];
    }
    case "text": {
      const field = (label: string, key: "is" | "isNot" | "has"): MenuItem => {
        // Contains takes the text as typed: "remix" holds in "Song (Remix)".
        const named = key !== "has" && w.suggest;
        return {
          input: {
            label, placeholder: w.suggest === "genre" ? "Jazz" : w.label,
            onSubmit: (v) => L({ [key]: named ? resolveTyped(w.suggest!, v, ctx.library()) : v.trim() }),
            onInput: named ? (v, show) => show(suggest(w.suggest!, v, ctx.library(), (pick) => L({ [key]: pick }))) : undefined,
          },
        };
      };
      return [field("Is", "is"), field("Is not", "isNot"), ...(ctx.songs ? [field("Contains", "has")] : []), ...known];
    }
  }
}

/** Pick a fact by section, then its value. */
export function factMenu(ctx: CondCtx, done: (l: Leaf) => void): MenuItem[] {
  return bySection(ctx.sections, ctx.words, (f): MenuItem =>
    ctx.usable(f.id) ? { label: f.label, sub: () => valueItems(ctx, f, done) } : { label: f.label, disabled: true, run: () => {} },
  );
}
