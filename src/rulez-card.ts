// Rulez — the rules builder (docs/architecture/RULES.md §20). The first Max-only card: it opens
// at Fill, and an X (in place of Back) puts back the card it replaced (layout.ts `closeCard`).
//
// A row is a rule, read as a sentence: When · In · If · Do, with a Name and a Desc. Each cell
// is a button that opens a menu of sections (the context-menu primitive, the menu-row family).
// The If cell is chips joined by "and" / "or", with parentheses at any depth. Your rules come
// first (the first match wins, so rows move); the built-in rules the Settings rows make follow,
// locked, each naming its row. A row with a part missing is a draft: saved, dimmed, never run.
//
// The words are rulez-words.ts; the engine is rules.ts. This card only edits the stored list.

import type { CardDef, CardInstance, CardId } from "./cards";
import { registry } from "./cards";
import { allRules, known, onRulesChange, ruleIdle, saveUserRules, userRules } from "./rules";
import type { Cond, EventId, Leaf, MomentRule, OnHand, Rule, StateRule, Value } from "./rules-eval";
import {
  EVENTS, FACTS, SECTIONS, choicesOf, condText, doText, doWordOf, dosFor, formatTime, inText, isComplete,
  leafText, parseTime, whenText, type Choice, type DoWord, type FactWord, type Lists, type Section, type StateSet,
} from "./rulez-words";
import {
  MENU_CHOSEN, MENU_DIVIDER, openContextMenu, openContextMenuUnder, type ActionItem, type MenuItem,
} from "./context-menu";
import { enterRows } from "./pop";
import { onSettingsChange, setting } from "./settings-store";
import { requestSetting } from "./layout-bus";
import { presetOptions } from "./sound";
import { THEME_OPTIONS, SKIN_OPTIONS } from "./look-schedule";
import { playlistsCached } from "./playlists";
import { radioRecents, radioSpecialPeek, radioLivePeek, type Station } from "./radio";
import { tracks } from "./track-store";
import { esc } from "./dom";
import * as diag from "./diag";

// ── the built-in rows (locked): their Settings row, by the rule's source ──
const ROWS: Record<string, { name: string; row: string | null }> = {
  drillGrow: { name: "Grow on album or artist", row: "drillgrow" },
  diaryGrow: { name: "Diary: Grow on open", row: "diarygrow" },
  cog: { name: "The cog", row: null },
  lookSchedule: { name: "Look schedule", row: "lookschedule" },
  alwaysOnTop: { name: "Keep on top", row: "aot" },
  soundEqOutputs: { name: "Remember each output", row: "eqperoutput" },
  sharePauseUntil: { name: "Pause sharing", row: "sharepause" },
  playlistCreateSummon: { name: "New playlist opens Search", row: "createsummon" },
  sleepSchedule: { name: "Sleep every day", row: "sleepsched" },
};
const builtinOf = (r: Rule) => ("row" in r.source ? ROWS[r.source.row] : "fixed" in r.source ? ROWS[r.source.fixed] : undefined);

const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" /></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke-linecap="round" /></svg>';
const ICON_MORE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>';
const ICON_LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>';
const ICON_GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="1.4" /><circle cx="15" cy="7" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="9" cy="17" r="1.4" /><circle cx="15" cy="17" r="1.4" /></svg>';

const HEAD = `
  <header class="panel__head">
    <button class="panel__back rulez__close" type="button" aria-label="Close Rulez" title="Closes Rulez and brings back the card it replaced">${ICON_X}</button>
    <h2 class="panel__title">Rulez</h2>
    <button class="panel__action" data-rulez="add" type="button" aria-label="New rule" title="Makes a new rule">${ICON_PLUS}</button>
  </header>
  <div class="panel__body rulez app-scroll"></div>`;

const newId = () => `u:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// ── conditions by path (a path = member indexes from the root group) ──
type GroupNode = Extract<Cond, { all: Cond[] }> | Extract<Cond, { any: Cond[] }>;
const isGroup = (c: Cond): c is GroupNode => "all" in c || "any" in c;
const membersOf = (g: GroupNode): Cond[] => ("all" in g ? g.all : g.any);
/** The rule's condition as a group (a lone leaf becomes a group of one). */
function rootOf(r: Rule): GroupNode {
  const c = r.kind === "state" ? r.while : r.if;
  if (!c) return { all: [] };
  return isGroup(c) ? c : { all: [c] };
}
function nodeAt(root: GroupNode, path: number[]): Cond {
  let n: Cond = root;
  for (const i of path) n = isGroup(n) ? membersOf(n)[i] : "not" in n ? n.not : n;
  return n;
}
/** Drop empty groups below the root. A group of one stays: it is how "(A or B)" starts (Put
 *  in parentheses, then + inside), found at the desk 2026-09-27. */
function tidy(c: Cond, top: boolean): Cond | null {
  if ("not" in c) {
    const inner = tidy(c.not, false);
    return inner ? { not: inner } : null;
  }
  if (!isGroup(c)) return c;
  const kept = membersOf(c).map((m) => tidy(m, false)).filter((m): m is Cond => !!m);
  if (!top && !kept.length) return null;
  return "all" in c ? { all: kept } : { any: kept };
}

export const rulezCard: CardDef = {
  id: "rulez",
  title: "Rulez",
  maxOnly: true,
  mount(host, opts): CardInstance {
    host.innerHTML = HEAD;
    const body = host.querySelector<HTMLElement>(".rulez")!;
    body.dataset.frames = "rulez";
    const closeBtn = host.querySelector<HTMLElement>(".rulez__close")!;
    const addBtn = host.querySelector<HTMLElement>('[data-rulez="add"]')!;
    let destroyed = false;

    // ── the run-time lists ──
    let playlistChoices: Choice[] = [];
    void playlistsCached()
      .then((ps) => {
        playlistChoices = ps.map((p) => ({ value: p.libraryId ?? p.catalogId ?? p.name, label: p.name }));
      })
      .catch(() => {});
    const stationsNow = (): Station[] => {
      const seen = new Set<string>();
      return [...radioSpecialPeek(), ...radioRecents(), ...radioLivePeek()].filter((s) => !seen.has(s.id) && !!seen.add(s.id));
    };
    const lists = (): Lists => {
      const outputs = Object.entries(setting("soundOutputNames")).map(([value, label]) => ({ value, label }));
      return {
        cards: (Object.values(registry).filter(Boolean) as { id: CardId; title: string }[])
          .filter((c) => c.id !== "rulez")
          .map((c) => ({ value: c.id, label: c.title })),
        presets: presetOptions().map((p) => ({ value: p.id, label: p.name })),
        outputs: outputs.length ? outputs : [{ value: "default", label: "This PC" }],
        themes: THEME_OPTIONS,
        skins: SKIN_OPTIONS,
        playlists: playlistChoices,
        stations: stationsNow().map((s) => ({ value: s.id, label: s.name })),
      };
    };

    // ── the list you own ──
    let mine: Rule[] = clone(userRules());
    let fresh: string | null = null; // a row just added: it enters with motion
    const save = (why: string) => {
      for (const r of mine) {
        const done = isComplete(r);
        if (r.draft && done) r.on = true; // a draft that is now whole starts running
        if (done) delete r.draft;
        else {
          r.draft = true;
          r.on = false;
        }
      }
      diag.log("ui:act", { do: "rulez", what: why });
      saveUserRules(clone(mine));
    };
    const edit = (id: string, why: string, fn: (r: Rule) => Rule | void) => {
      const i = mine.findIndex((r) => r.id === id);
      if (i < 0) return;
      const out = fn(mine[i]);
      if (out) mine[i] = out;
      save(why);
    };

    // ── menus ──
    /** Sections as submenus, each holding its own rows (empty sections left out). */
    const bySection = <T extends { section: Section }>(words: T[], row: (w: T) => MenuItem): MenuItem[] =>
      SECTIONS.map((s) => ({ s, ws: words.filter((w) => w.section === s) }))
        .filter((x) => x.ws.length)
        .map(({ s, ws }) => ({ label: s, sub: () => ws.map(row) }));
    const k = () => known();
    const chosen = (on: boolean) => (on ? MENU_CHOSEN : undefined);

    /** The When cell: an event by section, or While. */
    const whenMenu = (r: Rule): MenuItem[] => {
      const reg = k();
      const pick = (when: EventId, at?: number) =>
        edit(r.id, "when", (x) => {
          const base = { id: x.id, source: x.source, on: x.on, name: x.name, desc: x.desc, draft: x.draft };
          const cond = x.kind === "state" ? x.while : x.if;
          const keepDo = x.kind === "moment" && !!doWordOf(x) && dosFor({ ...x, when } as MomentRule).some((d) => d.id === doWordOf(x)!.word.id);
          const m: MomentRule = { ...base, kind: "moment", when, card: x.kind === "moment" ? x.card : "*", if: cond, do: keepDo ? (x as MomentRule).do : ({} as never) };
          if (when === "clock") m.at = at;
          return m;
        });
      const items = bySection(EVENTS, (e): MenuItem => {
        if (e.id === "clock")
          return {
            label: e.label,
            sub: () => [{ input: { label: "At", placeholder: "8:00 PM", value: r.kind === "moment" && typeof r.at === "number" ? formatTime(r.at) : "", onSubmit: (v) => {
              const t = parseTime(v);
              if (t !== null) pick("clock", t);
            } } }],
          };
        const off = !reg.events.has(e.id);
        return { label: e.label, disabled: off, badge: chosen(r.kind === "moment" && r.when === e.id), run: () => pick(e.id) };
      });
      items.push(MENU_DIVIDER, {
        label: "While a condition holds",
        badge: chosen(r.kind === "state"),
        run: () =>
          edit(r.id, "while", (x): StateRule => ({
            id: x.id, source: x.source, on: x.on, name: x.name, desc: x.desc, draft: x.draft, kind: "state",
            while: (x.kind === "state" ? x.while : x.if) ?? { all: [] },
            set: x.kind === "state" ? x.set : [], onHand: x.kind === "state" ? x.onHand : "next",
          })),
      });
      return items;
    };

    const inMenu = (r: MomentRule): MenuItem[] => [
      { label: "Any card", badge: chosen(r.card === "*"), run: () => edit(r.id, "in", (x) => void ((x as MomentRule).card = "*")) },
      MENU_DIVIDER,
      ...lists().cards.map((c): MenuItem => ({ label: c.label, badge: chosen(r.card === c.value), run: () => edit(r.id, "in", (x) => void ((x as MomentRule).card = String(c.value))) })),
    ];

    /** Suggest from your library as you type (no Apple call). */
    const suggest = (kind: "genre" | "artist" | "album", text: string, submit: (v: string) => void): ActionItem[] | string => {
      const q = text.toLowerCase();
      const pool = new Set<string>();
      for (const t of tracks()) {
        const vals = kind === "genre" ? t.genres : kind === "artist" ? [t.artistName] : [t.albumName ?? ""];
        for (const v of vals) if (v && v !== "Music" && v.toLowerCase().includes(q)) pool.add(v);
        if (pool.size > 40) break;
      }
      const rows = [...pool].sort((a, b) => a.localeCompare(b)).slice(0, 8).map((v): ActionItem => ({ label: v, run: () => submit(v) }));
      return rows.length ? rows : "Nothing in your library matches. Press Enter to use it as typed.";
    };

    /** The value rows for one fact: they build a leaf and hand it to `done`. */
    const valueItems = (w: FactWord, done: (l: Leaf) => void): MenuItem[] => {
      const L = (x: Omit<Leaf, "fact">): void => done({ fact: w.id, ...x });
      switch (w.kind) {
        case "bool":
          return [{ label: w.yes!, run: () => L({ is: true }) }, { label: w.no!, run: () => L({ is: false }) }];
        case "choice": {
          const cs = choicesOf(w, lists());
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
            const n = Number(v.replace(/[^\d.+-]/g, ""));
            if (v.trim() && Number.isFinite(n)) L({ [key]: n });
          };
          const ph = w.unit ? `A number (${w.unit})` : "A number";
          return [
            { input: { label: "Is above", placeholder: ph, onSubmit: num("gt") } },
            { input: { label: "Is below", placeholder: ph, onSubmit: num("lt") } },
            { input: { label: "Is", placeholder: ph, onSubmit: num("is") } },
          ];
        }
        case "text": {
          const field = (label: string, key: "is" | "isNot"): MenuItem => ({
            input: {
              label, placeholder: w.suggest === "genre" ? "Jazz" : w.label,
              onSubmit: (v) => L({ [key]: v }),
              onInput: w.suggest ? (v, show) => show(suggest(w.suggest!, v, (pick) => L({ [key]: pick }))) : undefined,
            },
          });
          return [field("Is", "is"), field("Is not", "isNot")];
        }
      }
    };

    /** Pick a fact by section, then its value. */
    const factMenu = (done: (l: Leaf) => void): MenuItem[] => {
      const reg = k();
      return bySection(FACTS, (f): MenuItem =>
        reg.facts.has(f.id) ? { label: f.label, sub: () => valueItems(f, done) } : { label: f.label, disabled: true, run: () => {} },
      );
    };

    /** Change the rule's condition: `fn` gets a copy of the root group and changes it in place. */
    const editCond = (r: Rule, why: string, fn: (root: GroupNode) => void) =>
      edit(r.id, why, (x) => {
        const root = clone(rootOf(x));
        fn(root);
        const c = tidy(root, true) as GroupNode;
        const empty = !membersOf(c).length;
        if (x.kind === "state") x.while = c;
        else x.if = empty ? undefined : c;
      });
    const parentOf = (root: GroupNode, path: number[]) => nodeAt(root, path.slice(0, -1)) as GroupNode;

    const chipMenu = (r: Rule, path: number[]): MenuItem[] => [
      { label: "Change", sub: () => factMenu((l) => editCond(r, "if:change", (root) => void (membersOf(parentOf(root, path))[path[path.length - 1]] = l))) },
      {
        label: "Put in parentheses",
        run: () =>
          editCond(r, "if:paren", (root) => {
            const p = parentOf(root, path);
            const i = path[path.length - 1];
            const inner = membersOf(p)[i];
            // The new group joins its members the other way, so "(A or B)" can sit inside "… and …".
            membersOf(p)[i] = "all" in p ? { any: [inner] } : { all: [inner] };
          }),
      },
      MENU_DIVIDER,
      { label: "Remove", run: () => editCond(r, "if:remove", (root) => void membersOf(parentOf(root, path)).splice(path[path.length - 1], 1)) },
    ];

    const groupMenu = (r: Rule, path: number[]): MenuItem[] => [
      {
        label: "Remove the parentheses",
        run: () =>
          editCond(r, "if:unparen", (root) => {
            const p = parentOf(root, path);
            const i = path[path.length - 1];
            membersOf(p).splice(i, 1, ...membersOf(nodeAt(root, path) as GroupNode));
          }),
      },
      { label: "Remove the group", run: () => editCond(r, "if:removeGroup", (root) => void membersOf(parentOf(root, path)).splice(path[path.length - 1], 1)) },
    ];

    // ── the Do cell ──
    const doValueItems = (w: DoWord, done: (v: Value) => void): MenuItem[] | null => {
      if (w.input === "none") return null;
      if (w.input === "number") {
        return [{ input: { label: w.label, placeholder: w.unit ? `A number (${w.unit})` : "A number", onSubmit: (v) => {
          const n = Number(v.replace(/[^\d.+-]/g, ""));
          if (Number.isFinite(n)) done(n);
        } } }];
      }
      const cs = choicesOf(w, lists());
      return cs.length ? cs.map((c): MenuItem => ({ label: c.label, run: () => done(c.value) })) : [{ label: "Nothing to pick yet", disabled: true, run: () => {} }];
    };
    /** A Do word as a menu row: its value opens beside it, or it applies at once. */
    const doRow = (w: DoWord, done: (w: DoWord, v: Value) => void, mark: boolean): MenuItem => {
      const reg = k();
      const verb = w.moment ? (Object.keys(w.moment(0 as Value))[0] ?? "") : "";
      const off = w.moment && !w.state ? !reg.actions.has(verb) : false;
      if (off) return { label: w.label, disabled: true, run: () => {} };
      const vals = () => doValueItems(w, (v) => done(w, v));
      return w.input === "none" ? { label: w.label, badge: chosen(mark), run: () => done(w, true) } : { label: w.label, sub: () => vals()! };
    };
    const setMoment = (r: Rule, w: DoWord, v: Value) =>
      edit(r.id, "do", (x) => {
        if (x.kind !== "moment" || !w.moment) return;
        if (w.id === "playStation") {
          const s = stationsNow().find((st) => st.id === v);
          if (!s) return;
          x.do = { playStation: { id: s.id, name: s.name, isLive: s.isLive, url: s.url, artwork: s.artwork } as never };
        } else x.do = w.moment(v);
      });
    const momentDoMenu = (r: MomentRule): MenuItem[] => {
      const cur = doWordOf(r)?.word.id;
      return bySection(dosFor(r), (w) => doRow(w, (ww, v) => setMoment(r, ww, v), cur === w.id));
    };

    /** A While row's Do: its targets as chips; each chip is one Do word's set. */
    const SHARING = ["shareActivityApp", "shareActivityDiscord", "discordRoomInvite"];
    const setChips = (set: StateSet): StateSet[] => {
      const out: StateSet[] = [];
      const sharing = set.filter((s) => "key" in s.target && SHARING.includes(s.target.key));
      if (sharing.length) out.push(sharing);
      for (const s of set) if (!sharing.includes(s)) out.push([s]);
      return out;
    };
    const stateDoMenu = (r: StateRule, replace: number | null): MenuItem[] =>
      bySection(dosFor(r), (w) =>
        doRow(w, (ww, v) => edit(r.id, "do", (x) => {
          if (x.kind !== "state" || !ww.state) return;
          const chips = setChips(x.set);
          const next = ww.state(v);
          // One target once: a new chip on a target another chip holds takes its place.
          const ids = new Set(next.map((s) => JSON.stringify(s.target)));
          const kept = chips.filter((c, i) => i !== replace && !c.some((s) => ids.has(JSON.stringify(s.target))));
          if (replace !== null && replace < chips.length) kept.splice(Math.min(replace, kept.length), 0, next);
          else kept.push(next);
          x.set = kept.flat();
        }), false),
      );

    const onHandMenu = (r: StateRule): MenuItem[] => {
      const opt = (label: string, h: OnHand): MenuItem => ({ label, badge: chosen(r.onHand === h), run: () => edit(r.id, "onHand", (x) => void ((x as StateRule).onHand = h)) });
      return [opt("It holds until the condition changes", "next"), opt("It holds until DeetsMusic starts again", "session"), opt("The rule turns off", "off")];
    };

    const rowMenu = (r: Rule, locked: boolean): MenuItem[] => {
      if (locked) {
        const b = builtinOf(r);
        return b?.row ? [{ label: "Open in Settings", run: () => requestSetting(b.row!) }] : [{ label: "This rule has no Settings row", disabled: true, run: () => {} }];
      }
      const i = mine.findIndex((x) => x.id === r.id);
      const move = (to: number) => () => {
        const [x] = mine.splice(i, 1);
        mine.splice(to, 0, x);
        save("move");
      };
      const items: MenuItem[] = [
        { label: r.on ? "Turn off" : "Turn on", disabled: !!r.draft, run: () => edit(r.id, r.on ? "off" : "on", (x) => void (x.on = !x.on)) },
      ];
      if (r.kind === "state") items.push({ label: "When I change what it set", sub: () => onHandMenu(r) });
      items.push(
        {
          label: "Duplicate",
          run: () => {
            const copy = { ...clone(r), id: newId(), name: r.name ? `${r.name} copy` : undefined };
            mine.splice(i + 1, 0, copy);
            fresh = copy.id;
            save("duplicate");
          },
        },
        { label: "Move up", disabled: i <= 0, run: move(i - 1) },
        { label: "Move down", disabled: i >= mine.length - 1, run: move(i + 1) },
        MENU_DIVIDER,
        { label: "Delete", run: () => { mine.splice(i, 1); save("delete"); } },
      );
      return items;
    };

    // ── drawing ──
    const btn = (cls: string, text: string, act: string, hint: string, extra = "") =>
      `<button class="rulez__cell ${cls}${text ? "" : " is-empty"}" type="button" data-act="${act}" title="${esc(hint)}"${extra}>${esc(text || "Pick…")}</button>`;

    /** The If cell: chips, "and" / "or" joiners, parentheses; a + at the end of each group. */
    const condHTML = (g: GroupNode, path: number[], top: boolean, L: Lists): string => {
      const op = "all" in g ? "and" : "or";
      const parts = membersOf(g).map((m, i) => {
        const p = [...path, i];
        const at = p.join(".");
        const node = isGroup(m)
          ? condHTML(m, p, false, L)
          : "not" in m
            ? `<span class="rulez__chip rulez__chip--text" title="A condition made outside Rulez">${esc(condText(m, L))}</span>`
            : `<button class="rulez__chip" type="button" data-act="chip" data-path="${at}" title="Changes, groups or removes this condition">${esc(leafText(m, L))}</button>`;
        const join = i ? `<button class="rulez__join" type="button" data-act="join" data-path="${path.join(".")}" title="Switches this group between and and or">${op}</button>` : "";
        return join + node;
      });
      const add = `<button class="rulez__add" type="button" data-act="addCond" data-path="${path.join(".")}" aria-label="Add a condition" title="Adds a condition here">${ICON_PLUS}</button>`;
      if (top) return parts.join("") + add;
      return `<span class="rulez__group"><button class="rulez__paren" type="button" data-act="group" data-path="${path.join(".")}" title="Removes the parentheses or the group">(</button>${parts.join("")}${add}<span class="rulez__paren rulez__paren--end">)</span></span>`;
    };

    const rowHTML = (r: Rule, locked: boolean, L: Lists): string => {
      const idle = locked ? null : ruleIdle(r);
      const b = locked ? builtinOf(r) : undefined;
      const cls = `rulez__row${locked ? " is-locked" : ""}${idle ? " is-idle" : ""}`;
      const title = locked ? `Made by Settings › ${b?.name ?? "a row"}. Change it there.` : idle ?? "";
      const lead = locked
        ? `<span class="rulez__lead" aria-hidden="true">${ICON_LOCK}</span>`
        : `<span class="rulez__lead rulez__grip" data-act="grip" title="Drag to move this rule. The first rule that matches runs">${ICON_GRIP}</span>`;
      const more = `<button class="rulez__more" type="button" data-act="more" aria-label="Rule menu" title="${locked ? "Opens the Settings row that makes this rule" : "Turns the rule on or off, copies, moves or deletes it"}">${ICON_MORE}</button>`;
      if (locked) {
        const cond = condText(r.kind === "state" ? r.while : r.if, L);
        return `<div class="${cls}" data-id="${esc(r.id)}" title="${esc(title)}">${lead}
          <span class="rulez__text">${esc(b?.name ?? "")}</span><span class="rulez__text rulez__text--dim">From Settings</span>
          <span class="rulez__text">${esc(whenText(r, L))}</span><span class="rulez__text">${esc(inText(r, L))}</span>
          <span class="rulez__text">${esc(cond === "Always" && r.kind === "moment" ? "" : cond)}</span><span class="rulez__text">${esc(doText(r, L))}</span>${more}</div>`;
      }
      const name = btn("rulez__name", r.name ?? "", "name", "Renames this rule");
      const desc = btn("rulez__desc", r.desc ?? "", "desc", "Says what this rule is for, in your words");
      const when = btn("rulez__when", whenText(r, L), "when", "Picks what starts this rule, or While for a rule that holds while its condition is true");
      const inCell = r.kind === "moment" ? btn("rulez__in", inText(r, L), "in", "Picks the card the event must happen in") : `<span class="rulez__text rulez__text--dim">—</span>`;
      const cond = `<div class="rulez__cond">${condHTML(rootOf(r), [], true, L)}</div>`;
      let doCell: string;
      if (r.kind === "moment") doCell = btn("rulez__do", doText(r, L), "do", "Picks what this rule does");
      else {
        const chips = setChips(r.set).map((c, i) => `<button class="rulez__chip" type="button" data-act="doChip" data-i="${i}" title="Changes or removes this">${esc(doText({ ...r, set: c }, L))}</button>`);
        doCell = `<div class="rulez__cond">${chips.join("")}<button class="rulez__add" type="button" data-act="addDo" aria-label="Add what it holds" title="Adds a value this rule holds while its condition is true">${ICON_PLUS}</button></div>`;
      }
      return `<div class="${cls}" data-id="${esc(r.id)}"${title ? ` title="${esc(title)}"` : ""}>${lead}${name}${desc}${when}${inCell}${cond}${doCell}${more}</div>`;
    };

    const render = () => {
      if (destroyed) return;
      const L = lists();
      mine = clone(userRules());
      const builtins = allRules().filter((r) => !("user" in r.source));
      const headRow = `<div class="rulez__row rulez__row--head" aria-hidden="true"><span></span><span>Name</span><span>Desc</span><span>When</span><span>In</span><span>If</span><span>Do</span><span></span></div>`;
      const empty = mine.length ? "" : `<p class="rulez__empty">No rules of your own yet. Press + to make one.</p>`;
      const lockedHead = builtins.length ? `<div class="rulez__divider">Made by Settings</div>` : "";
      const scroll = body.scrollTop;
      body.innerHTML = `<div class="rulez__table">${headRow}${mine.map((r) => rowHTML(r, false, L)).join("")}${empty}${lockedHead}${builtins.map((r) => rowHTML(r, true, L)).join("")}</div>`;
      body.scrollTop = scroll;
      if (fresh) {
        const row = body.querySelector<HTMLElement>(`[data-id="${CSS.escape(fresh)}"]`);
        if (row) enterRows([row]);
        fresh = null;
      }
    };

    // ── input ──
    const ruleOf = (el: HTMLElement): { rule: Rule; locked: boolean } | null => {
      const id = el.closest<HTMLElement>(".rulez__row")?.dataset.id;
      if (!id) return null;
      const own = mine.find((r) => r.id === id);
      if (own) return { rule: own, locked: false };
      const b = allRules().find((r) => r.id === id);
      return b ? { rule: b, locked: true } : null;
    };
    const pathOf = (el: HTMLElement): number[] => (el.dataset.path ? el.dataset.path.split(".").map(Number) : []);

    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
      if (!el || el.dataset.act === "grip") return;
      const hit = ruleOf(el);
      if (!hit) return;
      const { rule: r, locked } = hit;
      const act = el.dataset.act;
      if (act === "more") return openContextMenuUnder(el, rowMenu(r, locked));
      if (locked) return;
      switch (act) {
        case "name":
          return openContextMenuUnder(el, [{ input: { label: "Name", placeholder: "Night jazz", value: r.name, onSubmit: (v) => edit(r.id, "name", (x) => void (x.name = v)) } }]);
        case "desc":
          return openContextMenuUnder(el, [
            { input: { label: "Description", placeholder: "What this rule is for", value: r.desc, onSubmit: (v) => edit(r.id, "desc", (x) => void (x.desc = v)) } },
            ...(r.desc ? [{ label: "Clear", run: () => edit(r.id, "desc", (x) => void delete x.desc) } as MenuItem] : []),
          ]);
        case "when":
          return openContextMenuUnder(el, whenMenu(r));
        case "in":
          return r.kind === "moment" ? openContextMenuUnder(el, inMenu(r)) : undefined;
        case "chip":
          return openContextMenuUnder(el, chipMenu(r, pathOf(el)));
        case "group":
          return openContextMenuUnder(el, groupMenu(r, pathOf(el)));
        case "join":
          return editCond(r, "if:join", (root) => {
            const g = nodeAt(root, pathOf(el)) as Record<string, Cond[] | undefined>;
            // In place, so the root group flips as any group inside does.
            if (g.all) [g.any, g.all] = [g.all, undefined];
            else [g.all, g.any] = [g.any, undefined];
            delete g[g.all ? "any" : "all"];
          });
        case "addCond":
          return openContextMenuUnder(el, factMenu((l) => editCond(r, "if:add", (root) => void membersOf(nodeAt(root, pathOf(el)) as GroupNode).push(l))));
        case "do":
          return r.kind === "moment" ? openContextMenuUnder(el, momentDoMenu(r)) : undefined;
        case "addDo":
          return r.kind === "state" ? openContextMenuUnder(el, stateDoMenu(r, null)) : undefined;
        case "doChip": {
          if (r.kind !== "state") return;
          const i = Number(el.dataset.i);
          return openContextMenuUnder(el, [
            { label: "Change", sub: () => stateDoMenu(r, i) },
            MENU_DIVIDER,
            { label: "Remove", run: () => edit(r.id, "do", (x) => void ((x as StateRule).set = setChips((x as StateRule).set).filter((_, j) => j !== i).flat())) },
          ]);
        }
      }
    };
    const onContext = (e: MouseEvent) => {
      const hit = ruleOf(e.target as HTMLElement);
      if (!hit) return;
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, rowMenu(hit.rule, hit.locked));
    };

    // Drag a row by its grip: the rows between move aside as a line shows where it lands.
    const onGrip = (e: PointerEvent) => {
      const grip = (e.target as HTMLElement).closest<HTMLElement>('[data-act="grip"]');
      if (!grip || e.button !== 0) return;
      const row = grip.closest<HTMLElement>(".rulez__row")!;
      const from = mine.findIndex((r) => r.id === row.dataset.id);
      if (from < 0) return;
      e.preventDefault();
      const rows = [...body.querySelectorAll<HTMLElement>(".rulez__row:not(.rulez__row--head):not(.is-locked)")];
      let to = from;
      row.classList.add("is-dragging");
      grip.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        to = rows.filter((r) => r !== row && r.getBoundingClientRect().top + r.offsetHeight / 2 < ev.clientY).length;
        rows.forEach((r) => r.classList.remove("is-drop-before", "is-drop-after"));
        const target = rows.filter((r) => r !== row)[to];
        if (target) target.classList.add("is-drop-before");
        else {
          const others = rows.filter((r) => r !== row);
          others[others.length - 1]?.classList.add("is-drop-after");
        }
      };
      const up = () => {
        grip.removeEventListener("pointermove", move);
        rows.forEach((r) => r.classList.remove("is-drop-before", "is-drop-after", "is-dragging"));
        if (to !== from) {
          const [x] = mine.splice(from, 1);
          mine.splice(to, 0, x);
          save("drag");
        }
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up, { once: true });
      grip.addEventListener("pointercancel", up, { once: true });
    };

    const onAdd = () =>
      openContextMenuUnder(addBtn, [
        {
          input: {
            label: "New rule",
            placeholder: "Name",
            onSubmit: (name) => {
              const r = { id: newId(), kind: "moment", source: { user: true }, on: false, draft: true, name, when: "" as EventId, card: "*", do: {} } as unknown as MomentRule;
              mine.unshift(r);
              fresh = r.id;
              save("add");
            },
          },
        },
      ]);

    closeBtn.addEventListener("click", () => opts?.onClose?.());
    addBtn.addEventListener("click", onAdd);
    body.addEventListener("click", onClick);
    body.addEventListener("contextmenu", onContext);
    body.addEventListener("pointerdown", onGrip);
    const offRules = onRulesChange(render);
    const offSettings = onSettingsChange((key) => {
      if (key === "rules" || key === "soundOutputNames" || key === "soundEqUser") render();
    });
    render();
    enterRows(body.querySelectorAll(".rulez__row"));

    return {
      destroy() {
        destroyed = true;
        offRules();
        offSettings();
        host.innerHTML = "";
      },
    };
  },
};
