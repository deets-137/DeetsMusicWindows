// The Filter panel (docs/features/filter-rules.md §13.3, §13.6): the Library's third pop, after
// Sort and View. A filter is a condition as the Rulez card builds one, as blocks of blanks
// (the same menus, cond-editor.ts), asked of each song in the library. It works at once,
// unsaved (a quick filter: a genre, a year, loved); *Save filter* names it; *Make a Rulez
// Playlist* turns it into a playlist that the app makes again (filters.ts).
//
// A Rulez Playlist's rule is edited here too (its menu's *Edit the rule*): then the panel
// also shows where its songs come from, their order, the limit, the refresh and the songs you
// kept or took out.
//
// The panel is drawn by the Library card's state (`PanelHost`); it never keeps its own. The
// control families (UI-ARCHITECTURE.md §2a): the condition is the Rulez blanks; the buttons
// are panel chips (`.sound__pill`); a saved filter is a menu row.

import type { Cond, FactId, Leaf } from "./rules-eval";
import { blockOf, isLeaf, liftGroup, toCond, withBlock, type Block, type BlockKind } from "./rulez-blocks";
import { FILTER_FACTS, FILTER_SECTIONS, NO_LISTS, condText, factWord, leafParts, type Choice, type Lists } from "./rulez-words";
import { KIND_WORDS, factMenu, withSearch, type CondCtx } from "./cond-editor";
import { MENU_CHOSEN, MENU_DIVIDER, openContextMenuUnder, type MenuItem } from "./context-menu";
import { enterRows } from "./pop";
import { tracks } from "./track-store";
import { playlistsCached } from "./playlists";
import { esc } from "./dom";
import { toast } from "./toast";
import * as diag from "./diag";
import {
  deleteFilter, filterRow, filterRows, makeRulezPlaylist, newFilterId, refreshNow, saveFilter, setLists, setRefresh,
} from "./filters";
import type { FilterRule, Limit, OrderBy, Refresh, SourceId, Window } from "./filter-eval";

export interface FilterState {
  /** The draft: the condition, and for a Rulez Playlist its sources, order and limit. */
  rule: FilterRule;
  /** The saved filter it came from; null = a quick filter, not saved. */
  savedId: string | null;
  /** The count of the last check; null while it runs or with no condition. */
  result: { shown: number; total: number; missing: Map<FactId, number> } | null;
}

export interface PanelHost {
  state(): FilterState;
  /** Put this rule in force (the list narrows) and draw the panel again. */
  apply(rule: FilterRule, savedId: string | null): void;
}

const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke-linecap="round" /></svg>';
const ICON_MORE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>';

export const emptyRule = (): FilterRule => ({ id: "", name: "", sources: ["library"], order: { by: "hand", dir: "asc" } });
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const chosen = (on: boolean) => (on ? MENU_CHOSEN : undefined);
const fmt = (n: number) => n.toLocaleString();

// ── the run-time lists (the playlists, for "Playlist is …" and the sources) ──
let playlistChoices: Choice[] = [];
const refreshLists = () =>
  void playlistsCached()
    .then((ps) => {
      playlistChoices = ps.map((p) => ({ value: p.libraryId ?? p.catalogId ?? p.name, label: p.name }));
    })
    .catch(() => {});
const lists = (): Lists => ({ ...NO_LISTS, playlists: playlistChoices });

const ctx: CondCtx = {
  words: FILTER_FACTS, sections: FILTER_SECTIONS, usable: () => true, lists, library: () => tracks(), songs: true,
};

// ── the words for the Rulez Playlist part ──
const WINDOW_LABEL: Record<Window, string> = { day: "the last day", week: "the last 7 days", month: "the last 30 days", year: "the last 365 days", ytd: "this year" };
const SOURCE_LABEL: Record<string, string> = {
  library: "Your library", seen: "Songs you played outside your library", history: "Everything you have played",
  loved: "Loved songs", sotd: "Songs of the Day", diary: "Your Diary", pins: "Pinned songs",
};
const sourceLabel = (s: SourceId): string => {
  if (s.startsWith("rewind:")) return `Played in ${WINDOW_LABEL[s.slice(7) as Window]}`;
  if (s.startsWith("playlist:")) return playlistChoices.find((c) => c.value === s.slice(9))?.label ?? "A playlist";
  return SOURCE_LABEL[s] ?? s;
};
const ORDERS: { by: OrderBy; label: string; dir: "asc" | "desc" }[] = [
  { by: "hand", label: "Your order", dir: "asc" },
  { by: "added", label: "Newest added first", dir: "desc" },
  { by: "plays", label: "Most played first", dir: "desc" },
  { by: "lastPlayed", label: "Played longest ago first", dir: "desc" },
  { by: "diaryScore", label: "Highest Diary score first", dir: "desc" },
  { by: "listeners", label: "Rarest first (Last.fm)", dir: "asc" },
  { by: "year", label: "Oldest first", dir: "asc" },
  { by: "length", label: "Shortest first", dir: "asc" },
  { by: "title", label: "Title A–Z", dir: "asc" },
  { by: "artist", label: "Artist A–Z", dir: "asc" },
  { by: "random", label: "Random", dir: "asc" },
];
const orderLabel = (r: FilterRule) => ORDERS.find((o) => o.by === r.order.by && (o.dir === r.order.dir || o.by === "hand" || o.by === "random"))?.label ?? ORDERS.find((o) => o.by === r.order.by)?.label ?? "Your order";
const limitLabel = (l?: Limit): string => {
  const parts = [l?.songs ? `${l.songs} songs` : "", l?.minutes ? `${l.minutes} minutes` : "", l?.perArtist ? `${l.perArtist} per artist` : ""].filter(Boolean);
  return parts.length ? parts.join(", ") : "No limit";
};
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const refreshLabel = (r: Refresh | null): string =>
  !r || r === "off" ? "Off" : r === "live" ? "Live" : r === "daily" ? "Daily" : `Weekly on ${DAYS[Number(r.slice(7))] ?? "Sunday"}`;

/** The refresh choices, shared with a Rulez Playlist's own menu (playlists-card.ts). */
export function refreshItems(id: string, now: Refresh | null): MenuItem[] {
  const set = (r: Refresh) => () => void setRefresh(id, r).catch((e) => toast({ kind: "error", text: `Could not change the refresh: ${String(e)}` }));
  return [
    { label: "Live", badge: chosen(now === "live"), run: set("live") },
    { label: "Daily", badge: chosen(now === "daily"), run: set("daily") },
    { label: "Weekly", sub: () => DAYS.map((d, i): MenuItem => ({ label: d, badge: chosen(now === `weekly:${i}`), run: set(`weekly:${i}`) })) },
    { label: "Off", badge: chosen(!now || now === "off"), run: set("off") },
  ];
}

// ── drawing ──
const blank = (text: string, act: string, hint: string, extra = "", missing = false) =>
  `<button class="rulez__blank${missing ? " is-empty" : ""}" type="button" data-act="${act}"${extra} title="${esc(hint)}">${esc(text)}</button>`;
const chip = (text: string, act: string, hint: string, extra = "") =>
  `<button class="sound__pill fpop__chip" type="button" data-act="${act}"${extra} title="${esc(hint)}">${esc(text)}</button>`;

/** A text leaf: the accent toggle beside it (his call, §13.5). */
const textLeaf = (l: Leaf) => factWord(l.fact)?.kind === "text" && (l.has !== undefined || l.is !== undefined || l.isNot !== undefined);

function blockHTML(b: Block, path: number[], lead?: string): string {
  const at = path.join(".");
  const showHead = path.length > 0 || b.members.length > 1 || b.kind !== "all";
  const head = showHead ? blank(KIND_WORDS[b.kind], "block", "Switches between all, any and none of these, or removes the group", ` data-path="${at}" data-kind="${b.kind}"`) : "";
  const members = b.members.map((m, i) => {
    const p = [...path, i];
    const inner = blockOf(m);
    if (inner) return `<div class="rulez__block">${blockHTML(inner, p)}</div>`;
    if (!isLeaf(m)) return "";
    const words = leafParts(m, lists());
    const pa = ` data-path="${p.join(".")}"`;
    const hint = "Changes or removes this condition";
    const accent = textLeaf(m)
      ? `<button class="sound__pill fpop__accent" type="button" data-act="accents"${pa} aria-pressed="${!!m.accents}" title="${m.accents ? "Accents count: “Venus” does not find “Vénus”" : "Accents do not count: “Venus” finds “Vénus”"}">é</button>`
      : "";
    return `<div class="rulez__line">${words.name ? blank(words.name, "leaf", hint, pa) : ""}${blank(words.rest, "leaf", hint, pa)}${accent}</div>`;
  });
  const add = `<button class="rulez__add" type="button" data-act="addCond" data-path="${at}" aria-label="Add a condition" title="Adds a condition here">${ICON_PLUS}</button>`;
  const leadWord = lead ? `<span class="rulez__word">${esc(lead)}</span>` : "";
  if (!showHead) return `<div class="rulez__line">${leadWord}${members.join("").replace(/^<div class="rulez__line">/, "").replace(/<\/div>$/, "")}${add}</div>`;
  return `<div class="rulez__line">${leadWord}${head}</div><div class="rulez__block">${members.join("")}<div class="rulez__line">${add}</div></div>`;
}

const rootOf = (c: Cond | undefined): Block => (!c ? { kind: "all", members: [] } : blockOf(c) ?? { kind: "all", members: [c] });

function countText(s: FilterState): string {
  if (!s.rule.if) return `Every song (${fmt(tracks().length)})`;
  if (!s.result) return "Counting…";
  return `${fmt(s.result.shown)} of ${fmt(s.result.total)} songs`;
}

function missingHTML(s: FilterState): string {
  if (!s.result) return "";
  const lines: string[] = [];
  for (const [fact, n] of s.result.missing) {
    if (!n) continue;
    const w = factWord(fact);
    lines.push(`<button class="fpop__missing" type="button" data-act="missing" data-fact="${fact}" title="Adds “has a value”, so the songs with none leave the list">${fmt(n)} song${n === 1 ? " has" : "s have"} no ${esc((w?.label ?? fact).toLowerCase())}</button>`);
  }
  return lines.length ? `<div class="fpop__notes">${lines.join("")}</div>` : "";
}

function rulezPartHTML(s: FilterState): string {
  const row = s.savedId ? filterRow(s.savedId) : undefined;
  if (row?.playlistId == null) return "";
  const r = s.rule;
  const from = r.sources.map((src, i) => blank(sourceLabel(src), "source", "Removes this source", ` data-i="${i}"`)).join("");
  const kept = row.keep.length || row.never.length ? blank(`${row.keep.length} kept · ${row.never.length} taken out`, "lists", "The songs you added or removed by hand: Undo any of them") : "";
  return `<div class="fpop__part">
    <div class="rulez__line"><span class="rulez__word">From</span>${from}<button class="rulez__add" type="button" data-act="addSource" aria-label="Add a source" title="Adds a place the songs come from">${ICON_PLUS}</button></div>
    <div class="rulez__line"><span class="rulez__word">Order</span>${blank(orderLabel(r), "order", "Picks the order of the songs")}<span class="rulez__word">Limit</span>${blank(limitLabel(r.limit), "limit", "Picks how many songs the playlist holds")}</div>
    <div class="rulez__line"><span class="rulez__word">Refresh</span>${blank(refreshLabel(row.refresh), "refresh", "Picks when the playlist is made again")}${kept}</div>
  </div>`;
}

function savedHTML(s: FilterState): string {
  const saved = filterRows();
  if (!saved.length) return "";
  const rows = saved.map((r) => {
    const on = r.rule.id === s.savedId;
    const kind = r.playlistId != null ? `Rulez Playlist · ${refreshLabel(r.refresh)}` : "Filter";
    const words = condText(r.rule.if, lists()) || "Every song";
    return `<div class="fpop__row${on ? " is-on" : ""}">
      <button class="fpop__use" type="button" data-act="use" data-id="${esc(r.rule.id)}" aria-pressed="${on}" title="${on ? "Turns this filter off" : "Puts this filter in force"}">
        <span class="fpop__name">${esc(r.rule.name || "No name")}</span><span class="fpop__sub">${esc(kind)} · ${esc(words)}</span>
      </button>
      <button class="rulez__more" type="button" data-act="savedMore" data-id="${esc(r.rule.id)}" aria-label="More" title="Renames, edits or deletes this filter">${ICON_MORE}</button>
    </div>`;
  });
  return `<div class="fpop__saved"><div class="rulez__divider">Saved</div>${rows.join("")}</div>`;
}

function panelHTML(s: FilterState): string {
  const row = s.savedId ? filterRow(s.savedId) : undefined;
  const rulez = row?.playlistId != null;
  const title = rulez ? `Rulez Playlist: ${row!.rule.name}` : row ? row.rule.name || "Filter" : "Filter";
  const root = rootOf(s.rule.if);
  const cond = root.members.length
    ? blockHTML(root, [], "Only songs where")
    : `<div class="rulez__line"><span class="rulez__word">Only songs where</span>${blank("what is true?", "addCond", "Picks what a song must be to stay in the list", ' data-path=""', true)}</div>`;
  const edited = row && JSON.stringify(row.rule) !== JSON.stringify(s.rule);
  const acts = rulez
    ? [edited ? chip("Save changes", "saveEdit", "Saves the rule; the playlist is made again") : "", chip("Refresh now", "refreshNow", "Makes the playlist again now"), chip("Done", "stopEdit", "Takes the filter off the Library")]
    : [
        s.rule.if ? chip("Clear", "clear", "Shows every song again") : "",
        s.rule.if && edited ? chip("Save changes", "saveEdit", "Saves the changes to this filter") : "",
        s.rule.if && !row ? chip("Save filter…", "save", "Names this filter and keeps it") : "",
        s.rule.if ? chip("Make a Rulez Playlist…", "makePl", "Makes a playlist of these songs that keeps itself up to date") : "",
      ];
  return `<div class="fpop" data-frames="fpop">
    <div class="fpop__head"><span class="fpop__title">${esc(title)}</span><span class="fpop__count">${esc(countText(s))}</span></div>
    <div class="fpop__cond">${cond}</div>
    ${missingHTML(s)}
    ${rulezPartHTML(s)}
    <div class="fpop__acts">${acts.filter(Boolean).join("")}</div>
    ${savedHTML(s)}
  </div>`;
}

/** Draw the panel for the card's state. Wires its one click listener on the first draw. */
export function drawFilterPanel(panel: HTMLElement, host: PanelHost): void {
  if (!panel.dataset.wired) {
    panel.dataset.wired = "1";
    refreshLists();
    panel.addEventListener("click", (e) => onClick(e, host));
  }
  panel.innerHTML = panelHTML(host.state());
  // The rows enter when the pop opens (collection-card.ts sets `enter`), not on every redraw.
  if (panel.dataset.enter === "1") enterRows(panel.querySelectorAll(".fpop > *"));
  panel.dataset.enter = "0";
}

// ── input ──
function onClick(e: MouseEvent, host: PanelHost): void {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!el) return;
  const s = host.state();
  const rule = clone(s.rule);
  const path = el.dataset.path ? el.dataset.path.split(".").map(Number) : [];
  const setCond = (fn: (root: Block) => Block, why: string) => {
    rule.if = toCond(fn(rootOf(rule.if)));
    diag.log("ui:act", { do: "filter", what: why });
    host.apply(rule, s.savedId);
  };
  const setLeaf = (l: Leaf | null) =>
    setCond((root) => withBlock(root, path.slice(0, -1), (b) => {
      const members = [...b.members];
      if (l) members[path[path.length - 1]] = l;
      else members.splice(path[path.length - 1], 1);
      return { ...b, members };
    }), l ? "if:change" : "if:remove");
  const addTo = (node: Cond) => setCond((root) => withBlock(root, path, (b) => ({ ...b, members: [...b.members, node] })), "if:add");
  const fail = (what: string) => (err: unknown) => toast({ kind: "error", text: `Could not ${what}: ${err instanceof Error ? err.message : String(err)}` });

  switch (el.dataset.act) {
    case "leaf": {
      const items: MenuItem[] = [...factMenu(ctx, (l) => setLeaf(l)), MENU_DIVIDER, { label: "Remove this condition", run: () => setLeaf(null) }];
      return openContextMenuUnder(el, withSearch(el, items, "Find a fact", FILTER_SECTIONS));
    }
    case "addCond": {
      const items: MenuItem[] = [
        ...factMenu(ctx, (l) => addTo(l)),
        MENU_DIVIDER,
        { label: "A group inside this one", sub: () => factMenu(ctx, (l) => addTo({ all: [l] })) },
      ];
      return openContextMenuUnder(el, withSearch(el, items, "Find a fact", FILTER_SECTIONS));
    }
    case "block": {
      const kind = el.dataset.kind as BlockKind;
      const items: MenuItem[] = (Object.keys(KIND_WORDS) as BlockKind[]).map((k) => ({
        label: `Only if ${KIND_WORDS[k]}`, badge: chosen(kind === k),
        run: () => setCond((root) => withBlock(root, path, (b) => ({ ...b, kind: k })), "if:kind"),
      }));
      if (path.length) items.push(MENU_DIVIDER, { label: "Remove the group", run: () => setCond((root) => liftGroup(root, path), "if:lift") });
      return openContextMenuUnder(el, items);
    }
    case "accents": {
      const root = rootOf(rule.if);
      let node: Cond | Block = root;
      let b: Block = root;
      for (const i of path) {
        node = b.members[i];
        const next = blockOf(node as Cond);
        if (next) b = next;
      }
      const l = node as Leaf;
      const next = { ...l };
      if (l.accents) delete next.accents;
      else next.accents = true;
      return setLeaf(next);
    }
    case "missing": {
      const fact = el.dataset.fact as FactId;
      return setCond((root) => ({ ...root, members: [...root.members, { fact, known: true }] }), "if:known");
    }
    case "clear":
      diag.log("ui:act", { do: "filter", what: "clear" });
      return host.apply(emptyRule(), null);
    case "save":
      return openContextMenuUnder(el, [{ input: { label: "Name", placeholder: "Late-night jazz", onSubmit: (v) => {
        const name = v.trim();
        if (!name) return;
        const saved = { ...rule, id: newFilterId(), name };
        void saveFilter(saved).then(() => host.apply(saved, saved.id)).catch(fail("save the filter"));
      } } }]);
    case "saveEdit":
      return void saveFilter(rule).then(() => host.apply(rule, s.savedId)).catch(fail("save the changes"));
    case "makePl":
      return openContextMenuUnder(el, [{ input: { label: "Playlist name", placeholder: rule.name || "Late-night jazz", value: rule.name, onSubmit: (v) => {
        const name = v.trim();
        if (!name) return;
        const r = { ...rule, id: s.savedId && !filterRow(s.savedId)?.playlistId ? s.savedId : newFilterId(), name };
        void makeRulezPlaylist(r, name)
          .then(() => {
            host.apply(r, r.id);
            toast({ text: `Made the Rulez Playlist “${name}”. It refreshes Live.` });
          })
          .catch(fail("make the playlist"));
      } } }]);
    case "use": {
      const id = el.dataset.id!;
      const row = filterRow(id);
      diag.log("ui:act", { do: "filter", what: s.savedId === id ? "off" : "use", id });
      if (!row || s.savedId === id) return host.apply(emptyRule(), null);
      return host.apply(clone(row.rule), id);
    }
    case "savedMore": {
      const row = filterRow(el.dataset.id!);
      if (!row) return;
      const items: MenuItem[] = [
        { input: { label: "Rename", placeholder: "Name", value: row.rule.name, onSubmit: (v) => {
          const name = v.trim();
          if (name) void saveFilter({ ...row.rule, name }).then(() => s.savedId === row.rule.id && host.apply({ ...s.rule, name }, row.rule.id)).catch(fail("rename it"));
        } } },
      ];
      if (row.playlistId == null)
        items.push({ label: "Make a Rulez Playlist", run: () => void makeRulezPlaylist(row.rule, row.rule.name || "Rulez Playlist").then(() => toast({ text: `Made the Rulez Playlist “${row.rule.name}”. It refreshes Live.` })).catch(fail("make the playlist")) });
      else {
        items.push({ label: "Refresh", sub: () => refreshItems(row.rule.id, row.refresh) });
        items.push({ label: "Refresh now", run: () => void refreshNow(row.rule.id) });
      }
      items.push(MENU_DIVIDER, {
        label: row.playlistId == null ? "Delete" : "Delete the rule (the playlist stays)",
        run: () => void deleteFilter(row.rule.id).then(() => s.savedId === row.rule.id && host.apply(emptyRule(), null)).catch(fail("delete it")),
      });
      return openContextMenuUnder(el, items);
    }
    // ── the Rulez Playlist part ──
    case "source": {
      const i = Number(el.dataset.i);
      if (rule.sources.length <= 1) return void toast({ text: "A Rulez Playlist needs one place to take songs from." });
      rule.sources.splice(i, 1);
      return host.apply(rule, s.savedId);
    }
    case "addSource": {
      const has = (src: SourceId) => rule.sources.includes(src);
      const add = (src: SourceId) => () => {
        if (has(src)) return;
        rule.sources.push(src);
        host.apply(rule, s.savedId);
      };
      const own = filterRow(s.savedId ?? "")?.playlistId;
      const items: MenuItem[] = (["library", "loved", "sotd", "diary", "pins", "history", "seen"] as SourceId[]).map((src) => ({ label: sourceLabel(src), badge: chosen(has(src)), run: add(src) }));
      items.push(
        { label: "Played in…", sub: () => (Object.keys(WINDOW_LABEL) as Window[]).map((w): MenuItem => ({ label: WINDOW_LABEL[w], badge: chosen(has(`rewind:${w}`)), run: add(`rewind:${w}`) })) },
        { label: "A playlist", sub: () => {
          const ps = playlistChoices.filter((c) => c.value !== `local:${own}`);
          return ps.length ? ps.map((c): MenuItem => ({ label: c.label, badge: chosen(has(`playlist:${c.value}`)), run: add(`playlist:${c.value}`) })) : [{ label: "No playlists yet", disabled: true, run: () => {} }];
        } },
      );
      return openContextMenuUnder(el, items);
    }
    case "order":
      return openContextMenuUnder(el, ORDERS.map((o): MenuItem => ({
        label: o.label, badge: chosen(rule.order.by === o.by && (o.by === "hand" || o.by === "random" || rule.order.dir === o.dir)),
        run: () => { rule.order = { by: o.by, dir: o.dir }; host.apply(rule, s.savedId); },
      })));
    case "limit": {
      const set = (k: keyof Limit) => (v: string) => {
        const n = Math.floor(Number(v.replace(/[^\d]/g, "")));
        rule.limit = { ...rule.limit, [k]: n > 0 ? n : undefined };
        host.apply(rule, s.savedId);
      };
      return openContextMenuUnder(el, [
        { input: { label: "At most this many songs", placeholder: "50", value: rule.limit?.songs ? String(rule.limit.songs) : "", onSubmit: set("songs") } },
        { input: { label: "At most this many minutes", placeholder: "60", value: rule.limit?.minutes ? String(rule.limit.minutes) : "", onSubmit: set("minutes") } },
        { input: { label: "At most this many per artist", placeholder: "2", value: rule.limit?.perArtist ? String(rule.limit.perArtist) : "", onSubmit: set("perArtist") } },
        MENU_DIVIDER,
        { label: "No limit", badge: chosen(!rule.limit?.songs && !rule.limit?.minutes && !rule.limit?.perArtist), run: () => { delete rule.limit; host.apply(rule, s.savedId); } },
      ]);
    }
    case "refresh": {
      const row = filterRow(s.savedId ?? "");
      return row ? openContextMenuUnder(el, refreshItems(row.rule.id, row.refresh)) : undefined;
    }
    case "lists": {
      const row = filterRow(s.savedId ?? "");
      if (!row) return;
      const name = (key: string) => {
        const t = tracks().find((x) => (x.catalogId ?? x.libraryId) === key);
        return t ? `${t.title} — ${t.artistName}` : "A song not in your library";
      };
      const undo = (keep: string[], never: string[]) => () => void setLists(row.rule.id, keep, never).catch(fail("change the list"));
      const items: MenuItem[] = [];
      if (row.keep.length) {
        items.push({ label: "Kept (added by hand)", disabled: true, run: () => {} });
        row.keep.forEach((k) => items.push({ label: `Undo: ${name(k)}`, run: undo(row.keep.filter((x) => x !== k), row.never) }));
      }
      if (row.never.length) {
        if (items.length) items.push(MENU_DIVIDER);
        items.push({ label: "Taken out (removed by hand)", disabled: true, run: () => {} });
        row.never.forEach((k) => items.push({ label: `Undo: ${name(k)}`, run: undo(row.keep, row.never.filter((x) => x !== k)) }));
      }
      return openContextMenuUnder(el, items);
    }
    case "refreshNow": {
      if (s.savedId) void refreshNow(s.savedId);
      return;
    }
    case "stopEdit":
      return host.apply(emptyRule(), null);
  }
}

/** A saved filter, for the Compass and the hint: "Jazz I play a lot". */
export const filterName = (id: string): string => filterRow(id)?.rule.name ?? "";
