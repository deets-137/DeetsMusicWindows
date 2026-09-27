// Rulez — the rules builder (docs/features/RULEZ.md). The first Max-only card: it opens at
// Fill, and an X (in place of Back) puts back the card it replaced (layout.ts `closeCard`).
//
// A rule is a sentence (his call, RULEZ.md §6). A row shows its name, an on/off switch and the
// sentence as one line; a press opens it in place, one row at a time, to the sentence with
// blanks: "When [the next song plays], DeetsMusic [uses EQ preset] [Warm], only if [Genre] [is
// Jazz]". Each blank opens the section menus (the context-menu primitive, the menu-row family).
// Conditions are "all / any / none of these" blocks at any depth (rulez-blocks.ts). Under the
// sentence a live line says whether the rule would run now. Your rules come first (the first
// match wins, so rows move, and a row that a row above beats says so); then the recipes (off
// until turned on) and the built-in rules the Settings rows make, locked.
//
// Two views in the head (the split pill): Rules, and Logs (rulez-logs.ts). The header's ⋯ holds
// paste, import and export. The words are rulez-words.ts; the engine is rules.ts. This card
// only edits the stored list.

import type { CardDef, CardInstance, CardId } from "./cards";
import { registry } from "./cards";
import { allRules, known, onRulesChange, recipesOn, ruleIdle, ruleStats, saveUserRules, setRecipe, tryRule, userRules } from "./rules";
import { RECIPES } from "./rules-recipes";
import { evalCond, factsOf, validate, type EventId, type Leaf, type MomentRule, type OnHand, type Rule, type StateRule, type Value } from "./rules-eval";
import {
  EVENTS, FACTS, SECTIONS, choicesOf, doValueText, doWordOf, dosFor, factWord, formatTime, isComplete,
  leafText, parseTime, saysOf, sentenceText, stateParts, whenText, whoWins,
  type Choice, type DoWord, type FactWord, type Lists, type Section,
} from "./rulez-words";
import { blockOf, fromBlock, isLeaf, liftGroup, rootBlock, toCond, withBlock, type Block, type BlockKind } from "./rulez-blocks";
import { logsHTML, isRuleLine } from "./rulez-logs";
import { splitPillHTML, splitPick } from "./split-pill";
import { MENU_CHOSEN, MENU_DIVIDER, openContextMenu, openContextMenuUnder, type ActionItem, type MenuItem } from "./context-menu";
import { enterRows } from "./pop";
import { onSettingsChange, setting } from "./settings-store";
import { requestSetting } from "./layout-bus";
import { presetOptions } from "./sound";
import { THEME_OPTIONS, SKIN_OPTIONS } from "./look-schedule";
import { playlistsCached } from "./playlists";
import { radioRecents, radioSpecialPeek, radioLivePeek, type Station } from "./radio";
import { tracks } from "./track-store";
import { toast } from "./toast";
import { esc } from "./dom";
import * as diag from "./diag";
import { onFilesChange, pickFile, userFiles, type FileKind } from "./user-files";
import { fileGone, previewSound } from "./rules-files";
import { onDiag } from "./diag";

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
  goToTarget: { name: "Go to opens", row: "gototarget" },
  shuffleIdle: { name: "Idle shuffle plays", row: "shuffleidle" },
};
const builtinOf = (r: Rule) => ("row" in r.source ? ROWS[r.source.row] : "fixed" in r.source ? ROWS[r.source.fixed] : undefined);
const recipeOf = (r: Rule) => ("recipe" in r.source ? RECIPES.find((x) => x.id === (r.source as { recipe: string }).recipe) : undefined);

const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" /></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke-linecap="round" /></svg>';
const ICON_MORE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>';
const ICON_LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>';
const ICON_GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="1.4" /><circle cx="15" cy="7" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="9" cy="17" r="1.4" /><circle cx="15" cy="17" r="1.4" /></svg>';
const ICON_WARN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.5" stroke-linecap="round" /></svg>';

const HEAD = `
  <header class="panel__head">
    <button class="panel__back rulez__close" type="button" aria-label="Close Rulez" title="Closes Rulez and brings back the card it replaced">${ICON_X}</button>
    <h2 class="panel__title">Rulez</h2>
    <div class="coll-views" data-rulez-views></div>
    <button class="panel__action" data-rulez="more" type="button" aria-label="Import and export" title="Pastes, imports or exports rules">${ICON_MORE}</button>
    <button class="panel__action" data-rulez="add" type="button" aria-label="New rule" title="Makes a new rule">${ICON_PLUS}</button>
  </header>
  <div class="panel__body rulez app-scroll"></div>`;

const newId = () => `u:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const PLAYBACK_FACTS = ["genre", "artist", "album", "year", "albumColor", "albumLight", "explicit", "loved", "diaryScore", "plays", "loudness", "songBass", "songMids", "songTreble"] as const;
const EXPORT_NAME = "deetsmusic.deetsrules.json";

type View = "rules" | "logs";
interface Snap {
  view: View;
  open: string | null;
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
    const moreBtn = host.querySelector<HTMLElement>('[data-rulez="more"]')!;
    const viewsEl = host.querySelector<HTMLElement>("[data-rulez-views]")!;
    const snap = (opts?.memory ?? {}) as Partial<Snap>;
    let view: View = snap.view === "logs" ? "logs" : "rules";
    let openId: string | null = snap.open ?? null;
    let raw = false;
    let destroyed = false;

    // ── the run-time lists ──
    let playlistChoices: Choice[] = [];
    let editableChoices: Choice[] = [];
    void playlistsCached()
      .then((ps) => {
        playlistChoices = ps.map((p) => ({ value: p.libraryId ?? p.catalogId ?? p.name, label: p.name }));
        editableChoices = ps
          .filter((p) => (p.source === "local" && p.role !== "replay") || (p.source === "apple" && p.canEdit))
          .map((p) => ({ value: p.libraryId ?? p.catalogId ?? p.name, label: p.name }));
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
        editable: editableChoices,
        stations: stationsNow().map((s) => ({ value: s.id, label: s.name })),
        pictures: userFiles("picture").map((f) => ({ value: f.id, label: f.name })),
        sounds: userFiles("sound").map((f) => ({ value: f.id, label: f.name })),
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
    /** A rule's name for a line of text: yours, a recipe's, or its Settings row's. */
    const nameOf = (id: string): string => {
      const r = mine.find((x) => x.id === id) ?? allRules().find((x) => x.id === id) ?? RECIPES.flatMap((x) => x.rules).find((x) => x.id === id);
      if (!r) return "A rule";
      if ("user" in r.source) return `"${r.name || "Untitled rule"}"`;
      const rec = recipeOf(r);
      if (rec) return `the recipe ${r.name ?? rec.name}`;
      return `Settings › ${builtinOf(r)?.name ?? "a row"}`;
    };

    // ── menus ──
    /** Sections as submenus, each holding its own rows (empty sections left out). */
    const bySection = <T extends { section: Section }>(words: T[], row: (w: T) => MenuItem): MenuItem[] =>
      SECTIONS.map((s) => ({ s, ws: words.filter((w) => w.section === s) }))
        .filter((x) => x.ws.length)
        .map(({ s, ws }) => ({ label: s, sub: () => ws.map(row) }));
    const k = () => known();
    const chosen = (on: boolean) => (on ? MENU_CHOSEN : undefined);

    /** The When blank: an event by section, or While. */
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

    // ── conditions as blocks (RULEZ.md §6.4) ──
    /** Change the rule's condition: `fn` gets the root block and returns the new one. */
    const editRoot = (r: Rule, why: string, fn: (root: Block) => Block) =>
      edit(r.id, why, (x) => {
        const c = toCond(fn(rootBlock(x)));
        if (x.kind === "state") x.while = c ?? { all: [] };
        else x.if = c;
      });
    const parentPath = (p: number[]) => p.slice(0, -1);
    const lastOf = (p: number[]) => p[p.length - 1];
    const setLeaf = (r: Rule, path: number[], l: Leaf | null) =>
      editRoot(r, l ? "if:change" : "if:remove", (root) =>
        withBlock(root, parentPath(path), (b) => {
          const members = [...b.members];
          if (l) members[lastOf(path)] = l;
          else members.splice(lastOf(path), 1);
          return { ...b, members };
        }),
      );
    const addTo = (r: Rule, path: number[], node: Leaf | ReturnType<typeof fromBlock>) =>
      editRoot(r, "if:add", (root) => withBlock(root, path, (b) => ({ ...b, members: [...b.members, node] })));

    const leafMenu = (r: Rule, path: number[]): MenuItem[] => [
      ...factMenu((l) => setLeaf(r, path, l)),
      MENU_DIVIDER,
      { label: "Remove this condition", run: () => setLeaf(r, path, null) },
    ];
    const addCondMenu = (r: Rule, path: number[]): MenuItem[] => [
      ...factMenu((l) => addTo(r, path, l)),
      MENU_DIVIDER,
      { label: "A group inside this one", sub: () => factMenu((l) => addTo(r, path, { all: [l] })) },
    ];
    const KIND_WORDS: Record<BlockKind, string> = { all: "all of these", any: "any of these", none: "none of these" };
    const blockMenu = (r: Rule, path: number[], kind: BlockKind): MenuItem[] => {
      const items: MenuItem[] = (Object.keys(KIND_WORDS) as BlockKind[]).map((k2) => ({
        label: `Only if ${KIND_WORDS[k2]}`,
        badge: chosen(kind === k2),
        run: () => editRoot(r, "if:kind", (root) => withBlock(root, path, (b) => ({ ...b, kind: k2 }))),
      }));
      if (path.length) items.push(MENU_DIVIDER, { label: "Remove the group", run: () => editRoot(r, "if:lift", (root) => liftGroup(root, path)) });
      return items;
    };

    // ── the Do blanks ──
    /** `moment`: a When row. Its theme / skin / preset words save your own pick for good (RULEZ.md
     *  §1.4); route 10 says so on each choice. */
    const doValueItems = (w: DoWord, done: (v: Value) => void, moment = false): MenuItem[] | null => {
      if (w.input === "none") return null;
      if (w.input === "text") return [{ input: { label: w.label, placeholder: "What the note says", onSubmit: (v) => done(v) } }];
      if (w.input === "number") {
        return [{ input: { label: w.label, placeholder: w.unit ? `A number (${w.unit})` : "A number", onSubmit: (v) => {
          const n = Number(v.replace(/[^\d.+-]/g, ""));
          if (Number.isFinite(n)) done(n);
        } } }];
      }
      const cs = choicesOf(w, lists());
      // Your own files (RULEZ.md §5.2): choose a new one right here, no trip to Settings.
      const fileKind: FileKind | null = w.id === "picture" ? "picture" : w.id === "playSound" ? "sound" : null;
      const choose: MenuItem[] = fileKind
        ? [...(cs.length ? [MENU_DIVIDER] : []), { label: fileKind === "picture" ? "Choose a picture…" : "Choose a sound…", run: () => void pickFile(fileKind).then((f) => f && done(f.id)) }]
        : [];
      if (!cs.length && !choose.length) return [{ label: "Nothing to pick yet", disabled: true, run: () => {} }];
      // A sound opens two rows: use it, or listen to it first (RULEZ.md §5.3 asks for a play button).
      const rows = cs.map((c): MenuItem =>
        fileKind === "sound"
          ? { label: c.label, sub: () => [{ label: "Use this sound", run: () => done(c.value) }, { label: "Listen", run: () => void previewSound(String(c.value)) }] }
          : { label: c.label, run: () => done(c.value) },
      );
      rows.push(...choose);
      // Route 10: a When row's pick is yours for good; a greyed line at the top says so.
      const note = moment && ["theme", "skin", "preset"].includes(w.id);
      return note ? [{ label: "Saves it as your own pick, for good", disabled: true, run: () => {} }, MENU_DIVIDER, ...rows] : rows;
    };
    /** A Do word as a menu row: its value opens beside it, or it applies at once. */
    const doRow = (w: DoWord, done: (w: DoWord, v: Value) => void, mark: boolean, moment: boolean): MenuItem => {
      const verb = w.moment ? (Object.keys(w.moment(0 as Value))[0] ?? "") : "";
      if (moment && !k().actions.has(verb)) return { label: w.label, disabled: true, run: () => {} };
      return w.input === "none"
        ? { label: w.label, badge: chosen(mark), run: () => done(w, true) }
        : { label: w.label, sub: () => doValueItems(w, (v) => done(w, v), moment)! };
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
      return bySection(dosFor(r), (w) => doRow(w, (ww, v) => setMoment(r, ww, v), cur === w.id, true));
    };
    /** A While row's part `i` (null = a new part) becomes word `w` with value `v`. One target once. */
    const setPart = (r: StateRule, i: number | null, w: DoWord, v: Value) =>
      edit(r.id, "do", (x) => {
        if (x.kind !== "state" || !w.state) return;
        const parts = stateParts(x.set).map((p) => p.set);
        const next = w.state(v);
        const ids = new Set(next.map((s) => JSON.stringify(s.target)));
        const kept = parts.filter((p, j) => j !== i && !p.some((s) => ids.has(JSON.stringify(s.target))));
        if (i !== null && i < parts.length) kept.splice(Math.min(i, kept.length), 0, next);
        else kept.push(next);
        x.set = kept.flat();
      });
    const stateDoMenu = (r: StateRule, i: number | null): MenuItem[] => {
      const items = bySection(dosFor(r), (w) => doRow(w, (ww, v) => setPart(r, i, ww, v), false, false));
      if (i !== null)
        items.push(MENU_DIVIDER, { label: "Remove this", run: () => edit(r.id, "do", (x) => void ((x as StateRule).set = stateParts((x as StateRule).set).filter((_, j) => j !== i).flatMap((p) => p.set))) });
      return items;
    };

    const onHandMenu = (r: StateRule): MenuItem[] => {
      const opt = (label: string, h: OnHand): MenuItem => ({ label, badge: chosen(r.onHand === h), run: () => edit(r.id, "onHand", (x) => void ((x as StateRule).onHand = h)) });
      return [opt("It holds until the condition changes", "next"), opt("It holds until DeetsMusic starts again", "session"), opt("The rule turns off", "off")];
    };

    // ── row menus ──
    /** Try (route 1), for the locked rows: an open row of yours shows the same answer live. */
    const tryText = (r: Rule): string => {
      const t = tryRule(r.id);
      if (t.runs) return r.kind === "state" ? "Holds now." : ruleReadsSong(r) ? "Would run for the song playing now." : "Would run now.";
      if (t.leaf) return `Would not run now: "${leafText(t.leaf, lists())}" is not true.`;
      if (t.lostTo) return `Would not run now: ${nameOf(t.lostTo.id)} comes first.`;
      return `Would not run now. ${t.note ?? ""}`.trim();
    };
    const ruleReadsSong = (r: Rule): boolean => {
      const f = factsOf(r.kind === "state" ? r.while : r.if);
      return PLAYBACK_FACTS.some((x) => f.has(x));
    };
    const copyText = (rules: Rule[]) =>
      void navigator.clipboard.writeText(JSON.stringify(rules.length === 1 ? rules[0] : rules, null, 2)).then(
        () => toast({ kind: "success", text: rules.length === 1 ? "Rule copied." : `${rules.length} rules copied.` }),
        () => toast({ kind: "warn", text: "Couldn't copy the rules." }),
      );
    /** Put copies of `rules` at the top of your list (a recipe's Duplicate, Paste, Import). */
    const addCopies = (rules: Rule[], why: string) => {
      const copies = rules.map((r) => ({ ...clone(r), id: newId(), source: { user: true as const } }));
      mine.unshift(...copies);
      fresh = copies[0]?.id ?? null;
      save(why);
    };

    const rowMenu = (r: Rule): MenuItem[] => {
      const rec = recipeOf(r);
      if (rec) {
        const on = recipesOn().includes(rec.id);
        return [
          { label: on ? "Turn off" : "Turn on", run: () => setRecipe(rec.id, !on) },
          { label: "Try", disabled: !on, run: () => toast({ kind: "info", text: `${rec.name}: ${rec.rules.map(tryText).join(" ")}` }) },
          { label: "Duplicate into your rules", run: () => addCopies(rec.rules, "recipe:duplicate") },
          { label: "Copy as text", run: () => copyText(rec.rules) },
        ];
      }
      if (!("user" in r.source)) {
        const b = builtinOf(r);
        return [
          { label: "Try", run: () => toast({ kind: "info", text: `${nameOf(r.id)}: ${tryText(r)}` }) },
          b?.row ? { label: "Open in Settings", run: () => requestSetting(b.row!) } : { label: "This rule has no Settings row", disabled: true, run: () => {} },
        ];
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
      if (r.kind === "state") items.push({ label: "When I change what it keeps", sub: () => onHandMenu(r) });
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
        { label: "Copy as text", run: () => copyText([r]) },
        MENU_DIVIDER,
        {
          label: "Delete",
          run: () => {
            mine.splice(i, 1);
            if (openId === r.id) openId = null;
            save("delete");
          },
        },
      );
      return items;
    };

    // ── paste, import, export (route 4) ──
    /** Read rules from text: one rule, a list, or a saved file ({ rules }). Each is checked against
     *  what this app knows; a broken one is named and skipped. */
    const importText = (text: string, why: string) => {
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        toast({ kind: "warn", text: "That is not a rule. Copy a rule from Rulez, or a file it saved." });
        return;
      }
      const list = (Array.isArray(data) ? data : data && typeof data === "object" && "rules" in data ? (data as { rules: unknown[] }).rules : [data]) as Rule[];
      const reg = k();
      const good: Rule[] = [];
      const bad: string[] = [];
      for (const r of list) {
        const probe = r && typeof r === "object" ? { ...r, id: "import" } : r;
        const why2 = (probe as Rule)?.draft ? null : validate(probe, reg);
        if (why2) bad.push(`${(r as Rule)?.name ? `"${(r as Rule).name}"` : "a rule"} (${why2})`);
        else good.push(r);
      }
      if (good.length) addCopies(good, why);
      const text2 = `${good.length ? `Added ${good.length === 1 ? "1 rule" : `${good.length} rules`}.` : "Added no rules."}${bad.length ? ` Skipped ${bad.join(", ")}.` : ""}`;
      toast({ kind: bad.length ? "warn" : "success", text: text2 });
    };
    const importFile = () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.addEventListener("change", () => {
        const f = input.files?.[0];
        if (f) void f.text().then((t) => importText(t, "import:file"));
      });
      input.click();
    };
    const exportFile = () => {
      const blob = new Blob([JSON.stringify({ v: 1, rules: mine }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = EXPORT_NAME;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      diag.log("ui:act", { do: "rulez", what: "export", rules: mine.length });
      toast({ kind: "success", text: `Saved ${mine.length === 1 ? "1 rule" : `${mine.length} rules`} as ${EXPORT_NAME} in your Downloads folder.` });
    };
    const moreMenu = (): MenuItem[] => [
      // A field, not a clipboard read: the WebView refuses the page a read (found at the desk,
      // 2026-09-27), and Ctrl+V into a text box always works.
      { input: { label: "Paste a rule", placeholder: "Press Ctrl+V, then Enter", onSubmit: (t) => importText(t, "paste") } },
      { label: "Import from a file…", run: importFile },
      MENU_DIVIDER,
      { label: "Export your rules to a file", disabled: !mine.length, run: exportFile },
      { label: "Copy your rules as text", disabled: !mine.length, run: () => copyText(mine) },
    ];

    /** A rule whose picture or sound was deleted from your files (RULEZ.md §5.1). */
    const usesGoneFile = (r: Rule): boolean => {
      if (r.kind === "moment") {
        const d = r.do as { picture?: string; playSound?: string };
        const id = d.picture ?? d.playSound;
        return !!id && fileGone(id);
      }
      return r.set.some((s) => "key" in s.target && s.target.key === "glassPictureId" && fileGone(String(s.value)));
    };

    // ── drawing: the collapsed row ──
    const onOffHTML = (on: boolean, disabled: string | null, act = "onoff") =>
      `<span class="set__split rulez__switch"><button class="set__half set__half--toggle" type="button" role="switch" data-act="${act}" aria-checked="${on}"${disabled ? ` aria-disabled="true" title="${esc(disabled)}"` : ` title="${on ? "Turns this rule off" : "Turns this rule on"}"`}>${on ? "On" : "Off"}</button></span>`;
    const moreHTML = (hint: string) => `<button class="rulez__more" type="button" data-act="more" aria-label="Rule menu" title="${esc(hint)}">${ICON_MORE}</button>`;

    const ownRowHTML = (r: Rule, wins: Map<string, Rule>, L: Lists): string => {
      const open = openId === r.id;
      const idle = ruleIdle(r) ?? (usesGoneFile(r) ? "The file this rule uses is gone." : null);
      // A rule an agent made through the bridge (RULEZ.md §7) says so; you change it like your own.
      const summary = (r.by === "agent" ? "Made by an AI app. " : "") + (r.draft ? "Finish the sentence to use this rule." : sentenceText(r, L));
      const warn = idle && !r.draft && r.on ? `<span class="rulez__warn" aria-hidden="true">${ICON_WARN}</span>` : "";
      const w = wins.get(r.id);
      const winsLine = w && r.on && !r.draft ? `<p class="rulez__wins">Also matches when ${esc(nameOf(w.id))} does. ${esc(nameOf(w.id))} runs first.</p>` : "";
      const bar = `<div class="rulez__bar" data-act="open" title="${esc(open ? "Closes this rule" : r.desc ? r.desc : "Opens this rule to change it")}">
        <span class="rulez__lead rulez__grip" data-act="grip" title="Drag to move this rule. The first rule that matches runs">${ICON_GRIP}</span>
        <span class="rulez__name">${esc(r.name || "Untitled rule")}</span>
        <span class="rulez__summary">${warn}${esc(idle && !r.draft && r.on ? idle : summary)}</span>
        ${onOffHTML(r.on, r.draft ? "Finish the rule first" : null)}
        ${moreHTML("Turns the rule on or off, copies, moves or deletes it")}
      </div>`;
      const cls = `rulez__rule${open ? " is-open" : ""}${!r.on || r.draft ? " is-idle" : ""}${r.by === "agent" ? " is-agent" : ""}`;
      return `<div class="${cls}" data-id="${esc(r.id)}" data-own="1">${bar}${winsLine}${open ? openHTML(r, L) : ""}</div>`;
    };

    const lockedRowHTML = (r: Rule, wins: Map<string, Rule>, L: Lists): string => {
      const rec = recipeOf(r);
      const b = builtinOf(r);
      const w = wins.get(r.id);
      const on = rec ? recipesOn().includes(rec.id) : true;
      const winsLine = w && on ? `<p class="rulez__wins">Also matches when ${esc(nameOf(w.id))} does. ${esc(nameOf(w.id))} runs first.</p>` : "";
      const hint = rec ? "Made by DeetsMusic. Turn it on to use it." : `Made by Settings › ${b?.name ?? "a row"}. Change it there.`;
      const name = rec ? (rec.rules.length > 1 ? `${rec.name}: ${r.name?.split(": ")[1] ?? ""}` : rec.name) : b?.name ?? "";
      // A recipe's switch sits on its first rule only: one switch per recipe.
      const sw = rec && rec.rules[0].id === r.id ? onOffHTML(on, null, "recipe") : `<span class="rulez__switch"></span>`;
      return `<div class="rulez__rule is-locked${on ? "" : " is-idle"}" data-id="${esc(r.id)}"><div class="rulez__bar" title="${esc(hint)}">
        <span class="rulez__lead" aria-hidden="true">${ICON_LOCK}</span>
        <span class="rulez__name">${esc(name)}</span>
        <span class="rulez__summary">${esc(sentenceText(r, L))}</span>
        ${sw}
        ${moreHTML(rec ? "Turns the recipe on or off, or copies it into your rules" : "Tries this rule, or opens the Settings row that makes it")}
      </div>${winsLine}</div>`;
    };

    // ── drawing: the open row, the sentence ──
    const blank = (text: string, act: string, hint: string, extra = "", missing = false) =>
      `<button class="rulez__blank${missing ? " is-missing" : ""}" type="button" data-act="${act}"${extra} title="${esc(hint)}">${esc(text)}</button>`;

    const openHTML = (r: Rule, L: Lists): string => {
      const facts = ruleStats().facts;
      const fields = `<div class="rulez__fields">
        ${blank(r.name || "Untitled rule", "name", "Renames this rule")}
        ${blank(r.desc || "Add a description", "desc", "Says what this rule is for, in your words")}
      </div>`;
      // Line 1: When / While.
      let when: string;
      if (r.kind === "state") when = `<span class="rulez__word">While</span>${blank("…", "when", "Picks what starts this rule, or keeps While")}`;
      else {
        const w = r.when ? whenText(r, L) : "";
        when = `<span class="rulez__word">When</span>${blank(w ? w[0].toLowerCase() + w.slice(1) : "what happens?", "when", "Picks what starts this rule, or While for a rule that holds while its condition is true", "", !r.when)}`;
        const cardEvent = r.when && ["card.open", "album.open", "artist.open", "grow.outside", "grow.back", "queue.summon", "goto.artist", "goto.album"].includes(r.when);
        if (cardEvent || r.card !== "*") when += `<span class="rulez__word">in</span>${blank(r.card === "*" ? "any card" : L.cards.find((c) => c.value === r.card)?.label ?? r.card, "in", "Picks the card the event must happen in")}`;
      }
      // Line 2: DeetsMusic does.
      let does: string;
      if (r.kind === "moment") {
        const d = doWordOf(r);
        const v = d ? doValueText(d.word, "playStation" in r.do ? r.do.playStation : d.value, L) : "";
        does = `<span class="rulez__word">DeetsMusic</span>${blank(d ? saysOf(d.word, true) : "does what?", "do", "Picks what DeetsMusic does", "", !d)}${d && d.word.input !== "none" ? blank(v || "…", "doValue", "Picks the value") : ""}`;
      } else {
        const parts = stateParts(r.set);
        const shown = parts.map((p, i) =>
          (i ? `<span class="rulez__word">and</span>` : "") +
          blank(p.word ? saysOf(p.word, false) : "…", "part", "Changes or removes what this rule keeps", ` data-i="${i}"`) +
          (p.word && p.word.input !== "none" ? blank(doValueText(p.word, p.value, L), "partValue", "Picks the value", ` data-i="${i}"`) : ""),
        );
        does = `<span class="rulez__word">DeetsMusic</span>${shown.join("") || blank("keeps what?", "addPart", "Picks what DeetsMusic keeps while the condition holds", "", true)}${parts.length ? `<button class="rulez__add" type="button" data-act="addPart" aria-label="Keep something more" title="Adds another value this rule keeps">${ICON_PLUS}</button>` : ""}`;
      }
      // Line 3: the conditions (a While rule's condition is its "While" part).
      const root = rootBlock(r);
      const complete = r.kind === "state" || (!!r.when && isComplete(r));
      let cond = "";
      if (root.members.length) cond = blockHTML(r, root, [], facts, L, r.kind === "state" ? "While" : "only if");
      else if (r.kind === "state") cond = `<div class="rulez__line">${blank("add the condition…", "addCond", "Picks what must be true while this rule holds", ' data-path=""', true)}</div>`;
      else if (complete) cond = `<div class="rulez__line">${blank("only if…", "addCond", "Adds a condition that must be true too", ' data-path=""')}</div>`;
      const live = r.draft ? "Finish the sentence to use this rule." : !r.on ? "This rule is off." : tryText(r);
      return `<div class="rulez__open">${fields}
        <div class="rulez__line">${r.kind === "state" ? "" : when}</div>
        ${r.kind === "state" ? `<div class="rulez__line">${when}</div>` : ""}
        <div class="rulez__line">${does}</div>
        ${cond}
        <p class="rulez__live">${esc(live)}</p>
      </div>`;
    };

    /** A block: its head chip when it holds more than one member or sits inside another. */
    const blockHTML = (r: Rule, b: Block, path: number[], facts: Record<string, unknown>, L: Lists, lead?: string): string => {
      const at = path.join(".");
      const showHead = path.length > 0 || b.members.length > 1 || b.kind !== "all";
      const head = showHead
        ? blank(KIND_WORDS[b.kind], "block", "Switches between all, any and none of these, or removes the group", ` data-path="${at}" data-kind="${b.kind}"`)
        : "";
      const members = b.members.map((m, i) => {
        const p = [...path, i];
        const inner = blockOf(m);
        if (inner) return `<div class="rulez__block">${blockHTML(r, inner, p, facts, L)}</div>`;
        if (!isLeaf(m)) return "";
        const w = factWord(m.fact);
        const holds = evalCond(m, facts as never);
        const mark = showHead ? `<span class="rulez__mark${holds ? " is-yes" : ""}" title="${holds ? "True now" : "Not true now"}">${holds ? "✓" : "✗"}</span>` : "";
        const rest = leafText(m, L).slice((w?.label ?? "").length).trim() || leafText(m, L);
        return `<div class="rulez__line">${mark}${blank(w?.label ?? m.fact, "leaf", "Changes or removes this condition", ` data-path="${p.join(".")}"`)}${blank(rest, "leaf", "Changes or removes this condition", ` data-path="${p.join(".")}"`)}</div>`;
      });
      const add = `<button class="rulez__add" type="button" data-act="addCond" data-path="${at}" aria-label="Add a condition" title="Adds a condition here">${ICON_PLUS}</button>`;
      const leadWord = lead ? `<span class="rulez__word">${esc(lead)}</span>` : "";
      if (!showHead) return `<div class="rulez__line">${leadWord}${members.join("").replace(/^<div class="rulez__line">/, "").replace(/<\/div>$/, "")}${add}</div>`;
      return `<div class="rulez__line">${leadWord}${head}</div><div class="rulez__block${path.length ? " is-inner" : ""}">${members.join("")}<div class="rulez__line">${add}</div></div>`;
    };

    // ── the views ──
    const paintViews = () => {
      viewsEl.innerHTML = splitPillHTML(
        [
          { key: "rules", label: "Rules", title: "Your rules, the recipes and the built-in rules" },
          { key: "logs", label: "Logs", title: "What the rules did, and the facts they read now" },
        ],
        view,
        "Show",
      );
      addBtn.hidden = view !== "rules";
      moreBtn.hidden = view !== "rules";
    };

    const render = () => {
      if (destroyed) return;
      const L = lists();
      mine = clone(userRules());
      if (openId && !mine.some((r) => r.id === openId)) openId = null;
      const scroll = body.scrollTop;
      if (view === "logs") {
        const everything = [...mine, ...RECIPES.flatMap((x) => x.rules), ...allRules().filter((r) => "row" in r.source || "fixed" in r.source)];
        body.innerHTML = `<div class="rulez-log">
          <div class="rulez-log__tools">${splitPillHTML([
            { key: "words", label: "Words", title: "Each line as a sentence" },
            { key: "raw", label: "Raw", title: "Each line as it is logged" },
          ], raw ? "raw" : "words", "Show lines as")}</div>
          ${logsHTML(everything, nameOf, L, raw)}
        </div>`;
        body.scrollTop = scroll;
        return;
      }
      const live = allRules();
      const wins = whoWins(live);
      const recipeRules = RECIPES.flatMap((x) => x.rules);
      const builtins = live.filter((r) => "row" in r.source || "fixed" in r.source);
      const empty = mine.length ? "" : `<p class="rulez__empty">You have no rules yet. Press + to make one.</p>`;
      body.innerHTML = `<div class="rulez__list">
        ${mine.map((r) => ownRowHTML(r, wins, L)).join("")}${empty}
        <div class="rulez__divider">Recipes</div>${recipeRules.map((r) => lockedRowHTML(r, wins, L)).join("")}
        ${builtins.length ? `<div class="rulez__divider">Made by Settings</div>${builtins.map((r) => lockedRowHTML(r, wins, L)).join("")}` : ""}
      </div>`;
      body.scrollTop = scroll;
      if (fresh) {
        const row = body.querySelector<HTMLElement>(`[data-id="${CSS.escape(fresh)}"]`);
        if (row) enterRows([row]);
        fresh = null;
      }
    };

    /** Open one row (closing any other); its parts enter with the row motion. */
    const openRow = (id: string | null) => {
      openId = id;
      render();
      if (!id) return;
      const row = body.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] .rulez__open`);
      if (row) enterRows(row.children);
    };

    // ── input ──
    const ruleOf = (el: HTMLElement): Rule | null => {
      const id = el.closest<HTMLElement>(".rulez__rule")?.dataset.id;
      if (!id) return null;
      return mine.find((r) => r.id === id) ?? allRules().find((r) => r.id === id) ?? RECIPES.flatMap((x) => x.rules).find((r) => r.id === id) ?? null;
    };
    const pathOf = (el: HTMLElement): number[] => (el.dataset.path ? el.dataset.path.split(".").map(Number) : []);

    const onClick = (e: MouseEvent) => {
      if (view === "logs") {
        const pick = splitPick(e);
        if (pick) {
          raw = pick === "raw";
          render();
        }
        return;
      }
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
      if (!el || el.dataset.act === "grip") return;
      const r = ruleOf(el);
      if (!r) return;
      const act = el.dataset.act;
      const own = "user" in r.source;
      if (act === "more") return openContextMenuUnder(el, rowMenu(r));
      if (act === "recipe") {
        const rec = recipeOf(r);
        if (rec) setRecipe(rec.id, !recipesOn().includes(rec.id));
        return;
      }
      if (!own) return;
      if (act === "onoff") {
        if (!r.draft) edit(r.id, r.on ? "off" : "on", (x) => void (x.on = !x.on));
        return;
      }
      if (act === "open") return openRow(openId === r.id ? null : r.id);
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
        case "do":
          return r.kind === "moment" ? openContextMenuUnder(el, momentDoMenu(r)) : undefined;
        case "doValue": {
          const d = r.kind === "moment" ? doWordOf(r) : null;
          const items = d ? doValueItems(d.word, (v) => setMoment(r, d.word, v), true) : null;
          return items ? openContextMenuUnder(el, items) : undefined;
        }
        case "addPart":
          return r.kind === "state" ? openContextMenuUnder(el, stateDoMenu(r, null)) : undefined;
        case "part":
          return r.kind === "state" ? openContextMenuUnder(el, stateDoMenu(r, Number(el.dataset.i))) : undefined;
        case "partValue": {
          if (r.kind !== "state") return;
          const i = Number(el.dataset.i);
          const p = stateParts(r.set)[i];
          const items = p?.word ? doValueItems(p.word, (v) => setPart(r, i, p.word!, v)) : null;
          return items ? openContextMenuUnder(el, items) : undefined;
        }
        case "leaf":
          return openContextMenuUnder(el, leafMenu(r, pathOf(el)));
        case "addCond":
          return openContextMenuUnder(el, addCondMenu(r, pathOf(el)));
        case "block":
          return openContextMenuUnder(el, blockMenu(r, pathOf(el), el.dataset.kind as BlockKind));
      }
    };
    const onContext = (e: MouseEvent) => {
      const r = ruleOf(e.target as HTMLElement);
      if (!r) return;
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, rowMenu(r));
    };

    // Drag a row by its grip: a line shows where it lands.
    const onGrip = (e: PointerEvent) => {
      const grip = (e.target as HTMLElement).closest<HTMLElement>('[data-act="grip"]');
      if (!grip || e.button !== 0) return;
      const row = grip.closest<HTMLElement>(".rulez__rule")!;
      const from = mine.findIndex((r) => r.id === row.dataset.id);
      if (from < 0) return;
      e.preventDefault();
      e.stopPropagation();
      const rows = [...body.querySelectorAll<HTMLElement>(".rulez__rule[data-own]")];
      const others = rows.filter((r) => r !== row);
      let to = from;
      row.classList.add("is-dragging");
      try {
        grip.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer the page does not own (a script): the moves still reach the grip */
      }
      const move = (ev: PointerEvent) => {
        to = others.filter((r) => r.getBoundingClientRect().top + r.offsetHeight / 2 < ev.clientY).length;
        rows.forEach((r) => r.classList.remove("is-drop-before", "is-drop-after"));
        if (others[to]) others[to].classList.add("is-drop-before");
        else others[others.length - 1]?.classList.add("is-drop-after");
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

    /** + : a new rule, open, with its When blank's menu open (RULEZ.md §6.3). */
    const onAdd = () => {
      const r = { id: newId(), kind: "moment", source: { user: true }, on: false, draft: true, when: "" as EventId, card: "*", do: {} } as unknown as MomentRule;
      mine.unshift(r);
      fresh = r.id;
      openId = r.id;
      save("add");
      const blankEl = body.querySelector<HTMLElement>(`[data-id="${CSS.escape(r.id)}"] [data-act="when"]`);
      if (blankEl) openContextMenuUnder(blankEl, whenMenu(r));
    };

    const onViews = (e: MouseEvent) => {
      const pick = splitPick(e);
      if (!pick || pick === view) return;
      view = pick as View;
      diag.log("ui:act", { do: "rulez", what: `view:${view}` });
      paintViews();
      render();
    };

    // The Logs view follows new rule lines, at most every 300 ms, only while it shows.
    let logTimer = 0;
    const offDiag = onDiag((e) => {
      if (view !== "logs" || logTimer || !isRuleLine(e)) return;
      logTimer = window.setTimeout(() => {
        logTimer = 0;
        render();
      }, 300);
    });

    closeBtn.addEventListener("click", () => opts?.onClose?.());
    addBtn.addEventListener("click", onAdd);
    moreBtn.addEventListener("click", () => openContextMenuUnder(moreBtn, moreMenu()));
    viewsEl.addEventListener("click", onViews);
    body.addEventListener("click", onClick);
    body.addEventListener("contextmenu", onContext);
    body.addEventListener("pointerdown", onGrip);
    const offRules = onRulesChange(render);
    const offFiles = onFilesChange(render); // a new picture or sound shows in the menus
    const offSettings = onSettingsChange((key) => {
      if (key === "rules" || key === "soundOutputNames" || key === "soundEqUser") render();
    });
    paintViews();
    render();
    enterRows(body.querySelectorAll(".rulez__rule"));

    return {
      snapshot: (): Snap => ({ view, open: openId }),
      destroy() {
        destroyed = true;
        window.clearTimeout(logTimer);
        offDiag();
        offFiles();
        offRules();
        offSettings();
        host.innerHTML = "";
      },
    };
  },
};

