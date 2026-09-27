// Rulez's words (docs/architecture/RULES.md §20.3): every When, If / While and Do a row can
// pick, in its section, and how a stored rule reads back as words. Pure: no DOM, no store.
// The lists that change at run time (the cards, the presets, the outputs, your playlists) come
// in as `Lists`. tests/rulez-words.test.ts covers the reading-back and the time field.

import type { Action, Cond, EventId, FactId, Leaf, Rule, RuleTarget, Value } from "./rules-eval";

export const SECTIONS = ["Playback", "Time", "Sound", "Look", "Window", "Library", "Sharing", "Sleep"] as const;
export type Section = (typeof SECTIONS)[number];

export interface Choice {
  value: Value;
  label: string;
}

/** The lists that change at run time. */
export interface Lists {
  cards: Choice[];
  presets: Choice[];
  outputs: Choice[];
  themes: Choice[];
  skins: Choice[];
  playlists: Choice[];
  stations: Choice[];
}
export const NO_LISTS: Lists = { cards: [], presets: [], outputs: [], themes: [], skins: [], playlists: [], stations: [] };

// ── When ─────────────────────────────────────────────────────────

export interface EventWord {
  id: EventId;
  section: Section;
  label: string;
  /** A cancel event: its rule's Do is Keep (RULES.md §20.7). */
  cancel?: boolean;
}

export const EVENTS: EventWord[] = [
  { id: "song.play", section: "Playback", label: "The next song plays" },
  { id: "song.end", section: "Playback", label: "A song ends" },
  { id: "music.pause", section: "Playback", label: "The music pauses" },
  { id: "music.resume", section: "Playback", label: "The music resumes" },
  { id: "skip.next", section: "Playback", label: "You skip ahead" },
  { id: "skip.prev", section: "Playback", label: "You go back" },
  { id: "queue.end", section: "Playback", label: "The queue runs out" },
  { id: "station.play", section: "Playback", label: "A station plays" },
  { id: "clock", section: "Time", label: "The clock reaches" },
  { id: "app.open", section: "Window", label: "The app opens" },
  { id: "surface.change", section: "Window", label: "The surface changes" },
  { id: "tray.hide", section: "Window", label: "You hide the app in the tray" },
  { id: "tray.show", section: "Window", label: "You bring the app back" },
  { id: "card.open", section: "Window", label: "You open a card" },
  { id: "grow.outside", section: "Window", label: "You press outside a grown card", cancel: true },
  { id: "album.open", section: "Library", label: "You open an album" },
  { id: "artist.open", section: "Library", label: "You open an artist" },
  { id: "diary.open", section: "Library", label: "You open a Diary entry" },
  { id: "playlist.create", section: "Library", label: "You make a playlist" },
  { id: "cog", section: "Library", label: "You press the cog" },
  { id: "output.change", section: "Sound", label: "The output changes" },
];
/** Built-in only: never offered, but a locked row names it. */
const HIDDEN_EVENTS: Partial<Record<EventId, string>> = { "sleep.arm": "The sleep schedule arms" };

export const eventWord = (id: EventId): EventWord | undefined => EVENTS.find((e) => e.id === id);

// ── If / While ───────────────────────────────────────────────────

export type FactKind = "text" | "number" | "bool" | "choice" | "time";

export interface FactWord {
  id: FactId;
  section: Section;
  label: string;
  kind: FactKind;
  /** number: the unit after the value. */
  unit?: string;
  /** choice: fixed choices, or the name of a run-time list. */
  choices?: Choice[] | keyof Lists;
  /** bool: the words for true and false. */
  yes?: string;
  no?: string;
  /** text: suggest from your library as you type. */
  suggest?: "genre" | "artist" | "album";
}

const DAY_CHOICES: Choice[] = [
  { value: "mon", label: "Monday" }, { value: "tue", label: "Tuesday" }, { value: "wed", label: "Wednesday" },
  { value: "thu", label: "Thursday" }, { value: "fri", label: "Friday" }, { value: "sat", label: "Saturday" }, { value: "sun", label: "Sunday" },
];
const SURFACES: Choice[] = [
  { value: "mini", label: "Mini" }, { value: "player", label: "Player" }, { value: "midi", label: "Midi" }, { value: "max", label: "Max" },
];
const REPEATS: Choice[] = [{ value: "off", label: "Off" }, { value: "all", label: "All" }, { value: "one", label: "One" }];

export const FACTS: FactWord[] = [
  { id: "genre", section: "Playback", label: "Genre", kind: "text", suggest: "genre" },
  { id: "artist", section: "Playback", label: "Artist", kind: "text", suggest: "artist" },
  { id: "album", section: "Playback", label: "Album", kind: "text", suggest: "album" },
  { id: "year", section: "Playback", label: "Year", kind: "number" },
  { id: "explicit", section: "Playback", label: "Explicit", kind: "bool", yes: "The song is explicit", no: "The song is clean" },
  { id: "playing", section: "Playback", label: "The music is playing", kind: "bool", yes: "The music is playing", no: "The music is paused" },
  { id: "shuffle", section: "Playback", label: "Shuffle", kind: "bool", yes: "Shuffle is on", no: "Shuffle is off" },
  { id: "repeat", section: "Playback", label: "Repeat", kind: "choice", choices: REPEATS },
  { id: "volume", section: "Playback", label: "Volume", kind: "number", unit: "%" },
  {
    id: "source", section: "Playback", label: "Source", kind: "choice",
    choices: [
      { value: "library", label: "Library" }, { value: "playlist", label: "A playlist" }, { value: "album", label: "An album" },
      { value: "artist", label: "An artist" }, { value: "station", label: "A station" },
    ],
  },
  { id: "time", section: "Time", label: "Time", kind: "time" },
  { id: "day", section: "Time", label: "Day", kind: "choice", choices: DAY_CHOICES },
  { id: "daylight", section: "Time", label: "Daylight", kind: "bool", yes: "It is daylight", no: "It is dark" },
  { id: "output", section: "Sound", label: "Output", kind: "choice", choices: "outputs" },
  { id: "eqPreset", section: "Sound", label: "EQ preset", kind: "choice", choices: "presets" },
  { id: "eqBass", section: "Sound", label: "EQ bass", kind: "number", unit: "dB" },
  { id: "eqMids", section: "Sound", label: "EQ mids", kind: "number", unit: "dB" },
  { id: "eqTreble", section: "Sound", label: "EQ treble", kind: "number", unit: "dB" },
  { id: "loudness", section: "Sound", label: "Song loudness", kind: "number", unit: "LUFS" },
  { id: "songBass", section: "Sound", label: "Song bass", kind: "number", unit: "dB" },
  { id: "songMids", section: "Sound", label: "Song mids", kind: "number", unit: "dB" },
  { id: "songTreble", section: "Sound", label: "Song treble", kind: "number", unit: "dB" },
  { id: "surface", section: "Window", label: "Surface", kind: "choice", choices: SURFACES },
  { id: "card", section: "Window", label: "Card", kind: "choice", choices: "cards" },
  { id: "grown", section: "Window", label: "Grown card", kind: "choice", choices: "cards" },
];
/** Built-in only (a Settings row's rule reads them). */
const HIDDEN_FACTS: Partial<Record<FactId, string>> = { "entry.new": "The entry is new", now: "Now", lookMode: "Look schedule", cause: "Cause", from: "From" };

export const factWord = (id: FactId): FactWord | undefined => FACTS.find((f) => f.id === id);

export function choicesOf(w: FactWord | DoWord, lists: Lists): Choice[] {
  const c = w.choices;
  if (!c) return [];
  if (typeof c === "string") return w.id === "grown" ? [{ value: "none", label: "None" }, ...lists[c]] : lists[c];
  return c;
}

// ── Do ───────────────────────────────────────────────────────────

export type DoInput = "none" | "number" | "choice";
export type StateSet = { target: RuleTarget; value: unknown }[];

export interface DoWord {
  id: string;
  section: Section;
  label: string;
  input: DoInput;
  unit?: string;
  choices?: Choice[] | keyof Lists;
  /** A When row: the action. */
  moment?: (v: Value) => Action;
  /** A While row: the targets it holds. */
  state?: (v: Value) => StateSet;
  /** Offered only for a cancel event (Keep). */
  cancel?: boolean;
}

const SHARING = ["shareActivityApp", "shareActivityDiscord", "discordRoomInvite"] as const;
const ON_OFF: Choice[] = [{ value: true, label: "On" }, { value: false, label: "Off" }];
const AXES: Choice[] = [{ value: "full", label: "To Fill" }, { value: "vertical", label: "Taller" }, { value: "horizontal", label: "Wider" }];

export const DOS: DoWord[] = [
  { id: "play", section: "Playback", label: "Play", input: "none", moment: () => ({ play: true }) },
  { id: "pause", section: "Playback", label: "Pause", input: "none", moment: () => ({ pause: true }) },
  { id: "next", section: "Playback", label: "Skip ahead", input: "none", moment: () => ({ next: true }) },
  { id: "prev", section: "Playback", label: "Go back", input: "none", moment: () => ({ prev: true }) },
  { id: "shuffle", section: "Playback", label: "Turn shuffle", input: "choice", choices: ON_OFF, moment: (v) => ({ shuffle: v === true }) },
  { id: "repeat", section: "Playback", label: "Set repeat to", input: "choice", choices: REPEATS, moment: (v) => ({ repeat: v as "off" | "all" | "one" }) },
  {
    id: "volume", section: "Playback", label: "Set the volume to", input: "number", unit: "%",
    moment: (v) => ({ volume: Number(v) }), state: (v) => [{ target: { prop: "volume" }, value: Number(v) }],
  },
  { id: "playPlaylist", section: "Playback", label: "Play a playlist", input: "choice", choices: "playlists", moment: (v) => ({ playPlaylist: String(v) }) },
  { id: "playStation", section: "Playback", label: "Play a station", input: "choice", choices: "stations", moment: (v) => ({ playStation: v as never }) },
  {
    id: "preset", section: "Sound", label: "Use EQ preset", input: "choice", choices: "presets",
    moment: (v) => ({ set: { key: "soundEqPreset", value: v } }), state: (v) => [{ target: { key: "soundEqPreset" }, value: v }],
  },
  { id: "bass", section: "Sound", label: "Set the bass to", input: "number", unit: "dB", state: (v) => [{ target: { prop: "tone.bass" }, value: Number(v) }] },
  { id: "mids", section: "Sound", label: "Set the mids to", input: "number", unit: "dB", state: (v) => [{ target: { prop: "tone.mids" }, value: Number(v) }] },
  { id: "treble", section: "Sound", label: "Set the treble to", input: "number", unit: "dB", state: (v) => [{ target: { prop: "tone.treble" }, value: Number(v) }] },
  { id: "preamp", section: "Sound", label: "Set the preamp to", input: "number", unit: "dB", state: (v) => [{ target: { prop: "tone.preamp" }, value: Number(v) }] },
  {
    id: "theme", section: "Look", label: "Use theme", input: "choice", choices: "themes",
    moment: (v) => ({ set: { key: "theme", value: v } }), state: (v) => [{ target: { key: "theme" }, value: v }],
  },
  {
    id: "skin", section: "Look", label: "Use skin", input: "choice", choices: "skins",
    moment: (v) => ({ set: { key: "skin", value: v } }), state: (v) => [{ target: { key: "skin" }, value: v }],
  },
  { id: "grow", section: "Window", label: "Grow this card", input: "choice", choices: AXES, moment: (v) => ({ grow: v as "full" }) },
  { id: "summon", section: "Window", label: "Open a card", input: "choice", choices: "cards", moment: (v) => ({ summon: String(v) }) },
  { id: "onTop", section: "Window", label: "Keep on top", input: "none", state: () => [{ target: { prop: "window.onTop" }, value: true }] },
  { id: "keep", section: "Window", label: "Keep the grown card open", input: "none", cancel: true, moment: () => ({ keep: true }) },
  {
    id: "growOutside", section: "Window", label: "Collapse on outside click", input: "choice", choices: ON_OFF,
    state: (v) => [{ target: { key: "cardGrowOutside" }, value: v === true }],
  },
  {
    id: "sharePause", section: "Sharing", label: "Pause sharing", input: "none",
    moment: () => ({ sharePause: 60 }), state: () => SHARING.map((k) => ({ target: { key: k }, value: false })),
  },
  { id: "sleepIn", section: "Sleep", label: "Start the sleep timer", input: "number", unit: "min", moment: (v) => ({ sleepIn: Number(v) }) },
];

export const doWord = (id: string): DoWord | undefined => DOS.find((d) => d.id === id);

/** The Do words a row may pick: a When row the actions (Keep only for a cancel event, and a
 *  cancel event only Keep), a While row the targets. */
export function dosFor(rule: Rule): DoWord[] {
  if (rule.kind === "state") return DOS.filter((d) => d.state);
  const cancel = !!eventWord(rule.when)?.cancel;
  return DOS.filter((d) => d.moment && (cancel ? d.cancel : !d.cancel));
}

// ── the time field ───────────────────────────────────────────────

/** "8:00 PM", "8pm", "20:00", "8" → the minute of the day, or null. */
export function parseTime(text: string): number | null {
  const m = text.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.[0];
  if (min > 59 || h > 23 || (ap && (h < 1 || h > 12))) return null;
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  return h * 60 + min;
}

export function formatTime(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const ap = h < 12 ? "AM" : "PM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ap}`;
}

// ── reading a rule back as words ─────────────────────────────────

const labelOf = (choices: Choice[], v: unknown): string => choices.find((c) => c.value === v)?.label ?? String(v);

function valueText(w: FactWord | undefined, v: Value, lists: Lists): string {
  if (!w) return String(v);
  if (w.kind === "time" && typeof v === "number") return formatTime(v);
  if (w.kind === "choice") return labelOf(choicesOf(w, lists), v);
  if (w.kind === "number") {
    const sign = w.unit === "dB" && typeof v === "number" && v > 0 ? "+" : "";
    return `${sign}${v}${w.unit ? (w.unit === "%" ? "%" : ` ${w.unit}`) : ""}`;
  }
  return String(v);
}

const list = (v: Value | Value[]) => (Array.isArray(v) ? v : [v]);

/** One chip: "Genre is Jazz", "Time is after 8:00 PM", "The music is playing". */
export function leafText(l: Leaf, lists: Lists): string {
  const w = factWord(l.fact);
  const name = w?.label ?? HIDDEN_FACTS[l.fact] ?? l.fact;
  // A built-in fact with a yes / no value reads as its own words ("The entry is new").
  if (!w && typeof l.is === "boolean") return l.is ? name : `not: ${name.toLowerCase()}`;
  if (w?.kind === "bool" && l.is !== undefined && !Array.isArray(l.is)) return l.is === true ? w.yes! : w.no!;
  if (w?.kind === "bool" && l.isNot !== undefined && !Array.isArray(l.isNot)) return l.isNot === true ? w.no! : w.yes!;
  const parts: string[] = [];
  const vals = (v: Value | Value[]) => list(v).map((x) => valueText(w, x, lists)).join(" or ");
  const time = w?.kind === "time";
  if (l.is !== undefined) parts.push(`is ${vals(l.is)}`);
  if (l.isNot !== undefined) parts.push(`is not ${vals(l.isNot)}`);
  if (l.gt !== undefined) parts.push(`${time ? "is after" : "is above"} ${valueText(w, l.gt, lists)}`);
  if (l.gte !== undefined) parts.push(`${time ? "is from" : "is at least"} ${valueText(w, l.gte, lists)}`);
  if (l.lt !== undefined) parts.push(`${time ? "is before" : "is below"} ${valueText(w, l.lt, lists)}`);
  if (l.lte !== undefined) parts.push(`${time ? "is up to" : "is at most"} ${valueText(w, l.lte, lists)}`);
  if (l.fact === "now" && l.lt !== undefined) return "Until the pause ends";
  return `${name} ${parts.join(" and ")}`;
}

/** A whole condition as one line (the locked rows, the hints). Groups inside get parentheses. */
export function condText(c: Cond | undefined, lists: Lists, top = true): string {
  if (!c) return "";
  if ("all" in c || "any" in c) {
    const members = "all" in c ? c.all : c.any;
    if (!members.length) return top ? "Always" : "";
    const inner = members.map((m) => condText(m, lists, false)).join("all" in c ? " and " : " or ");
    return top || members.length === 1 ? inner : `(${inner})`;
  }
  if ("not" in c) {
    const inner = c.not;
    // not (Surface is Mini) reads as "Surface is not Mini".
    if (!("all" in inner || "any" in inner || "not" in inner) && inner.is !== undefined && Object.keys(inner).length === 2)
      return leafText({ fact: inner.fact, isNot: inner.is }, lists);
    return `not ${condText(inner, lists, false)}`;
  }
  return leafText(c, lists);
}

export function whenText(r: Rule, lists: Lists): string {
  void lists;
  if (r.kind === "state") return "While…";
  if (r.draft && !r.when) return "";
  if (r.when === "clock") return `The clock reaches ${typeof r.at === "number" ? formatTime(r.at) : "…"}`;
  return eventWord(r.when)?.label ?? HIDDEN_EVENTS[r.when] ?? r.when;
}

export function inText(r: Rule, lists: Lists): string {
  if (r.kind === "state") return "";
  return r.card === "*" ? "Any card" : labelOf(lists.cards, r.card);
}

/** What a stored action says. */
export function actionText(a: Action | undefined, lists: Lists): string {
  if (!a || !Object.keys(a).length) return "";
  const [verb, arg] = Object.entries(a)[0] as [string, unknown];
  switch (verb) {
    case "grow": return `Grow this card ${labelOf(AXES, arg).toLowerCase()}`;
    case "summon": return `Open ${labelOf(lists.cards, arg)}`;
    case "sleep": return (arg as { at: string }).at === "sun" ? "Sleep at sunset" : "Sleep at the set time";
    case "play": return "Play";
    case "pause": return "Pause";
    case "next": return "Skip ahead";
    case "prev": return "Go back";
    case "shuffle": return `Turn shuffle ${arg ? "on" : "off"}`;
    case "repeat": return `Set repeat to ${labelOf(REPEATS, arg)}`;
    case "volume": return `Set the volume to ${arg}%`;
    case "playPlaylist": return `Play ${labelOf(lists.playlists, arg)}`;
    case "playStation": return `Play ${(arg as { name?: string })?.name ?? "a station"}`;
    case "sharePause": return "Pause sharing for an hour";
    case "sleepIn": return `Start the sleep timer: ${arg} min`;
    case "keep": return "Keep the grown card open";
    case "set": {
      const { key, value } = arg as { key: string; value: unknown };
      if (key === "theme") return `Use theme ${labelOf(lists.themes, value)}`;
      if (key === "skin") return `Use skin ${labelOf(lists.skins, value)}`;
      if (key === "soundEqPreset") return `Use EQ preset ${labelOf(lists.presets, value)}`;
      return `Set ${key}`;
    }
  }
  return verb;
}

/** What a While row holds: one phrase per target, joined. */
export function setText(set: StateSet, lists: Lists): string {
  const out: string[] = [];
  const keys = set.map((s) => ("key" in s.target ? s.target.key : `prop:${s.target.prop}`));
  if (SHARING.every((k) => keys.includes(k))) out.push("Pause sharing");
  for (const s of set) {
    const t = s.target;
    if ("key" in t && (SHARING as readonly string[]).includes(t.key)) continue;
    if ("key" in t) {
      if (t.key === "theme") out.push(`Use theme ${labelOf(lists.themes, s.value)}`);
      else if (t.key === "skin") out.push(`Use skin ${labelOf(lists.skins, s.value)}`);
      else if (t.key === "soundEqPreset") out.push(`Use EQ preset ${labelOf(lists.presets, s.value)}`);
      else if (t.key === "cardGrowOutside") out.push(`Collapse on outside click: ${s.value ? "On" : "Off"}`);
      else out.push(`Set ${t.key}`);
    } else {
      const v = Number(s.value);
      const db = `${v > 0 ? "+" : ""}${v} dB`;
      if (t.prop === "window.onTop") out.push("Keep on top");
      else if (t.prop === "volume") out.push(`Set the volume to ${v}%`);
      else if (t.prop.startsWith("tone.")) out.push(`Set the ${t.prop.slice(5)} to ${db}`);
      else out.push(t.prop);
    }
  }
  return out.join(", ");
}

export function doText(r: Rule, lists: Lists): string {
  return r.kind === "moment" ? actionText(r.do, lists) : setText(r.set, lists);
}

/** Which Do word a stored action or set came from, and its value (the cell's menu marks it). */
export function doWordOf(r: Rule): { word: DoWord; value: Value } | null {
  if (r.kind === "moment") {
    if (!r.do || !Object.keys(r.do).length) return null;
    const [verb, arg] = Object.entries(r.do)[0] as [string, unknown];
    if (verb === "set") {
      const { key, value } = arg as { key: string; value: Value };
      const id = key === "soundEqPreset" ? "preset" : key;
      const w = doWord(id);
      return w ? { word: w, value } : null;
    }
    const w = doWord(verb);
    return w ? { word: w, value: (verb === "playStation" ? (arg as { id: string }).id : arg) as Value } : null;
  }
  const first = r.set[0];
  if (!first) return null;
  const t = first.target;
  const id = "key" in t
    ? t.key === "soundEqPreset" ? "preset" : t.key === "cardGrowOutside" ? "growOutside" : (SHARING as readonly string[]).includes(t.key) ? "sharePause" : t.key
    : t.prop === "window.onTop" ? "onTop" : t.prop.startsWith("tone.") ? t.prop.slice(5) : t.prop;
  const w = doWord(id);
  return w ? { word: w, value: first.value as Value } : null;
}

/** A row is complete: it names its When and its Do (a draft otherwise, RULES.md §20.2). */
export function isComplete(r: Rule): boolean {
  if (r.kind === "moment") return !!r.when && !!r.do && Object.keys(r.do).length > 0 && (r.when !== "clock" || typeof r.at === "number");
  return r.set.length > 0;
}
