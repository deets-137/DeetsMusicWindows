// Rulez's words (docs/architecture/RULES.md §20.3): every When, If / While and Do a row can
// pick, in its section, and how a stored rule reads back as words. Pure: no DOM, no store.
// The lists that change at run time (the cards, the presets, the outputs, your playlists) come
// in as `Lists`. tests/rulez-words.test.ts covers the reading-back and the time field.

import type { Action, Cond, EventId, FactId, Leaf, Rule, RuleTarget, StateRule, Value } from "./rules-eval";

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
  /** The playlists a song can be added to: your local ones and editable Apple ones. */
  editable: Choice[];
  stations: Choice[];
  /** Your own files (RULEZ.md §5): named pictures and sounds. */
  pictures: Choice[];
  sounds: Choice[];
}
export const NO_LISTS: Lists = { cards: [], presets: [], outputs: [], themes: [], skins: [], playlists: [], editable: [], stations: [], pictures: [], sounds: [] };

// ── When ─────────────────────────────────────────────────────────

export interface EventWord {
  id: EventId;
  section: Section;
  label: string;
  /** A cancel event: its rule's Do is Keep (RULES.md §20.7). */
  cancel?: boolean;
  /** A Go to event: its rule's Do is *Open in* (RULEZ.md §10.1). */
  goTo?: boolean;
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
  { id: "station.return", section: "Playback", label: "A station is about to come back", cancel: true },
  { id: "shuffle.press", section: "Playback", label: "You press shuffle" },
  { id: "clock", section: "Time", label: "The clock reaches" },
  { id: "app.open", section: "Window", label: "The app opens" },
  { id: "surface.change", section: "Window", label: "The surface changes" },
  { id: "tray.hide", section: "Window", label: "You hide the app in the tray" },
  { id: "tray.show", section: "Window", label: "You bring the app back" },
  { id: "card.open", section: "Window", label: "You open a card" },
  { id: "grow.outside", section: "Window", label: "You press outside a grown card", cancel: true },
  { id: "grow.back", section: "Window", label: "You go Back from a grown album or artist", cancel: true },
  { id: "queue.summon", section: "Window", label: "The Queue is about to replace a card or end a grow", cancel: true },
  { id: "album.open", section: "Library", label: "You open an album" },
  { id: "artist.open", section: "Library", label: "You open an artist" },
  { id: "diary.open", section: "Library", label: "You open a Diary entry" },
  { id: "playlist.create", section: "Library", label: "You make a playlist" },
  { id: "goto.artist", section: "Library", label: "You press Go to Artist", goTo: true },
  { id: "goto.album", section: "Library", label: "You press Go to Album", goTo: true },
  { id: "cog", section: "Library", label: "You press the cog" },
  { id: "replay.weekly", section: "Library", label: "The weekly Replay is about to be made", cancel: true },
  { id: "output.change", section: "Sound", label: "The output changes" },
];
/** Built-in only: never offered, but a locked row names it. */
const HIDDEN_EVENTS: Partial<Record<EventId, string>> = { "sleep.arm": "The sleep schedule arms" };

export const eventWord = (id: EventId): EventWord | undefined => EVENTS.find((e) => e.id === id);
/** An event's words, the built-in-only ones too. */
export const eventLabel = (id: EventId): string => eventWord(id)?.label ?? HIDDEN_EVENTS[id] ?? id;

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
  // RULEZ.md §11: the cover's most colorful color as a word, and its main field light or dark.
  {
    id: "albumColor", section: "Playback", label: "Album color", kind: "choice",
    choices: [
      { value: "red", label: "Red" }, { value: "orange", label: "Orange" }, { value: "brown", label: "Brown" },
      { value: "yellow", label: "Yellow" }, { value: "green", label: "Green" }, { value: "teal", label: "Teal" },
      { value: "blue", label: "Blue" }, { value: "purple", label: "Purple" }, { value: "pink", label: "Pink" },
      { value: "grey", label: "Grey" },
    ],
  },
  { id: "albumLight", section: "Playback", label: "Album cover light", kind: "bool", yes: "The cover is light", no: "The cover is dark" },
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
  { id: "loved", section: "Playback", label: "Loved", kind: "bool", yes: "The song is loved", no: "The song is not loved" },
  { id: "diaryScore", section: "Playback", label: "Diary score", kind: "number" },
  { id: "plays", section: "Playback", label: "Times played", kind: "number" },
  { id: "queueLength", section: "Playback", label: "Songs up next", kind: "number" },
  { id: "loaded", section: "Playback", label: "A song is loaded", kind: "bool", yes: "A song is loaded", no: "No song is loaded" },
  { id: "time", section: "Time", label: "Time", kind: "time" },
  { id: "day", section: "Time", label: "Day", kind: "choice", choices: DAY_CHOICES },
  { id: "daylight", section: "Time", label: "Daylight", kind: "bool", yes: "It is daylight", no: "It is dark" },
  { id: "sinceOpen", section: "Time", label: "Minutes since the app opened", kind: "number", unit: "min" },
  { id: "idle", section: "Time", label: "Minutes with no press", kind: "number", unit: "min" },
  { id: "output", section: "Sound", label: "Output", kind: "choice", choices: "outputs" },
  {
    id: "outputKind", section: "Sound", label: "Output kind", kind: "choice",
    choices: [
      { value: "speakers", label: "Speakers" }, { value: "headphones", label: "Headphones" }, { value: "headset", label: "Headset" },
      { value: "airplay", label: "AirPlay" }, { value: "unknown", label: "Not known" },
    ],
  },
  { id: "eqPreset", section: "Sound", label: "EQ preset", kind: "choice", choices: "presets" },
  { id: "eqBass", section: "Sound", label: "EQ bass", kind: "number", unit: "dB" },
  { id: "eqMids", section: "Sound", label: "EQ mids", kind: "number", unit: "dB" },
  { id: "eqTreble", section: "Sound", label: "EQ treble", kind: "number", unit: "dB" },
  { id: "loudness", section: "Sound", label: "Song loudness", kind: "number", unit: "LUFS" },
  { id: "songBass", section: "Sound", label: "Song bass", kind: "number", unit: "dB" },
  { id: "songMids", section: "Sound", label: "Song mids", kind: "number", unit: "dB" },
  { id: "songTreble", section: "Sound", label: "Song treble", kind: "number", unit: "dB" },
  { id: "surface", section: "Window", label: "Surface", kind: "choice", choices: SURFACES },
  { id: "windowWidth", section: "Window", label: "Window width", kind: "number", unit: "px" },
  { id: "windowHeight", section: "Window", label: "Window height", kind: "number", unit: "px" },
  { id: "battery", section: "Window", label: "Battery", kind: "number", unit: "%" },
  { id: "charging", section: "Window", label: "Charging", kind: "bool", yes: "The PC is charging", no: "The PC is on battery" },
  { id: "online", section: "Window", label: "Online", kind: "bool", yes: "The PC is online", no: "The PC is offline" },
  { id: "dataSaver", section: "Window", label: "Data saver", kind: "bool", yes: "Data saver is on", no: "Data saver is off" },
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

export type DoInput = "none" | "number" | "choice" | "text";
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
  /** Offered only for a Go to event (*Open in*). */
  goTo?: boolean;
}
const OPEN_IN: Choice[] = [{ value: "library", label: "Library" }, { value: "search", label: "Search" }];

const SHARING = ["shareActivityApp", "shareActivityDiscord", "discordRoomInvite"] as const;
const ON_OFF: Choice[] = [{ value: true, label: "On" }, { value: false, label: "Off" }];
const MOTION: Choice[] = [{ value: "on", label: "On" }, { value: "reduced", label: "Reduced" }, { value: "off", label: "Off" }];
const NOTICES: Choice[] = [{ value: "all", label: "Everything" }, { value: "failures", label: "Failures" }];
const WEB_PLAY: Choice[] = [{ value: "replace", label: "Replaces the queue" }, { value: "keep", label: "Plays now, keeps Up Next" }, { value: "after", label: "Plays after the song" }];
/** A While word that holds one Settings row at a value: its id is the row's key, so `doWordOf`
 *  finds it by the key (RULES.md §18, the rule keys of 2026-09-27). The label is the row's. */
const keyWord = (key: string, section: Section, label: string, choices: Choice[]): DoWord => ({
  id: key, section, label, input: "choice", choices,
  state: (v) => [{ target: { key: key as never }, value: choices === ON_OFF ? v === true : v }],
});
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
  { id: "keep", section: "Window", label: "Keep it from happening", input: "none", cancel: true, moment: () => ({ keep: true }) },
  {
    id: "growOutside", section: "Window", label: "Collapse on outside click", input: "choice", choices: ON_OFF,
    state: (v) => [{ target: { key: "cardGrowOutside" }, value: v === true }],
  },
  {
    id: "sharePause", section: "Sharing", label: "Pause sharing", input: "none",
    moment: () => ({ sharePause: 60 }), state: () => SHARING.map((k) => ({ target: { key: k }, value: false })),
  },
  { id: "sleepIn", section: "Sleep", label: "Start the sleep timer", input: "number", unit: "min", moment: (v) => ({ sleepIn: Number(v) }) },
  // Route 6 (RULEZ.md §3). ♥ and an Apple Music playlist are Apple writes (RULEZ.md §4).
  { id: "note", section: "Window", label: "Show a note", input: "text", moment: (v) => ({ note: String(v) }) },
  { id: "hide", section: "Window", label: "Hide the app in the tray", input: "none", moment: () => ({ hide: true }) },
  { id: "addTo", section: "Library", label: "Add the song to a playlist", input: "choice", choices: "editable", moment: (v) => ({ addTo: String(v) }) },
  { id: "love", section: "Library", label: "Love the song", input: "none", moment: () => ({ love: true }) },
  { id: "diary", section: "Library", label: "Open the Diary for this album", input: "none", moment: () => ({ diary: true }) },
  // Your own files (RULEZ.md §5, session B's store). A picture in a While row holds Glass ›
  // Canvas on that picture; in a When row it sets it as your pick.
  {
    id: "picture", section: "Look", label: "Use picture", input: "choice", choices: "pictures",
    moment: (v) => ({ picture: String(v) }),
    state: (v) => [{ target: { key: "glassCanvas" }, value: "picture" }, { target: { key: "glassPictureId" }, value: String(v) }],
  },
  { id: "playSound", section: "Sound", label: "Play sound", input: "choice", choices: "sounds", moment: (v) => ({ playSound: String(v) }) },
  { id: "scrobble", section: "Playback", label: "Turn scrobbling", input: "choice", choices: ON_OFF, moment: (v) => ({ scrobble: v === true }) },
  // Route 8 (RULEZ.md §10.1).
  { id: "shuffleLibrary", section: "Playback", label: "Play the library shuffled", input: "none", moment: () => ({ shuffleLibrary: true }) },
  { id: "openIn", section: "Library", label: "Open it in", input: "choice", choices: OPEN_IN, goTo: true, moment: (v) => ({ openIn: v === "library" ? "library" : "search" }) },
  // The rule keys of 2026-09-27 (Battery saver, Focus): While rows only.
  keyWord("backgroundMotion", "Look", "Animate backgrounds", MOTION),
  keyWord("appearanceMotion", "Look", "Animate look changes", ON_OFF),
  keyWord("cardSwapMotion", "Look", "Animate card swaps", ON_OFF),
  keyWord("fancyScrubber", "Look", "Fancy scrubber", ON_OFF),
  keyWord("glassFancy", "Look", "Fancy Glass", ON_OFF),
  keyWord("friendsListenAlong", "Sharing", "Let friends listen along", ON_OFF),
  keyWord("friendsRoomInvite", "Sharing", "Put my room code on my box", ON_OFF),
  keyWord("toasts", "Window", "Show notices", NOTICES),
  // Play a web from the song playing (PLAYLIST-WEB.md §11, 2026-09-28): the mode and the skip
  // point have no Settings row; these words are how a pro user sets them.
  keyWord("webPlayNew", "Playback", "Play a web from the song playing", ON_OFF),
  keyWord("webPlayMode", "Playback", "A web from the song playing", WEB_PLAY),
  keyWord("webSkipSeed", "Playback", "Skip the song you just heard", ON_OFF),
  {
    id: "webSkipSeedAt", section: "Playback", label: "Skip the song you just heard past", input: "number", unit: "%",
    state: (v) => [{ target: { key: "webSkipSeedAt" }, value: Math.min(100, Math.max(1, Number(v))) }],
  },
];

export const doWord = (id: string): DoWord | undefined => DOS.find((d) => d.id === id);

/** The Do words a row may pick: a When row the actions (Keep only for a cancel event, and a
 *  cancel event only Keep), a While row the targets. */
export function dosFor(rule: Rule): DoWord[] {
  if (rule.kind === "state") return DOS.filter((d) => d.state);
  const ev = eventWord(rule.when);
  if (ev?.goTo) return DOS.filter((d) => d.goTo);
  const cancel = !!ev?.cancel;
  return DOS.filter((d) => d.moment && !d.goTo && (cancel ? d.cancel : !d.cancel));
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

export function valueText(w: FactWord | undefined, v: Value, lists: Lists): string {
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

/**
 * A phrase as it reads inside a sentence: the first letter goes lower case only when the first
 * word is an ordinary capitalized word ("Time is after" → "time is after", "The music" → "the
 * music"). A word with another capital or a digit keeps its case: a name or a short form
 * ("AirPlay", "EQ preset", "DeetsMusic"). The one place a Rulez phrase changes case, so a new
 * word needs no rule of its own. A plain one-capital name ("Apple") cannot be told from a
 * common word here; give such a label a second word first ("The Apple Music…").
 */
export function lowerFirst(s: string): string {
  return /^[A-Z][a-z]*(?![A-Za-z0-9])/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

/**
 * A condition's words as parts, never one string to cut apart. `name` is the fact's own label
 * when the phrase is "<name> <rest>" ("Genre" + "is Jazz"); a phrase that is a sentence of its
 * own ("The PC is on battery", "Until the pause ends") has no name. The Rulez card shows each
 * part as its own blank (2026-09-27: cutting the label's length off a yes / no phrase showed
 * "Charging" + "s on battery").
 */
export interface LeafParts {
  name?: string;
  rest: string;
}

/** One chip: "Genre is Jazz", "Time is after 8:00 PM", "The music is playing". */
export function leafText(l: Leaf, lists: Lists, inSentence = false): string {
  const p = leafParts(l, lists);
  const out = p.name ? `${p.name} ${p.rest}` : p.rest;
  return inSentence ? lowerFirst(out) : out;
}

export function leafParts(l: Leaf, lists: Lists): LeafParts {
  const w = factWord(l.fact);
  const name = w?.label ?? HIDDEN_FACTS[l.fact] ?? l.fact;
  // A built-in fact with a yes / no value reads as its own words ("The entry is new").
  if (!w && typeof l.is === "boolean") return { rest: l.is ? name : `not: ${lowerFirst(name)}` };
  if (w?.kind === "bool" && l.is !== undefined && !Array.isArray(l.is)) return { rest: l.is === true ? w.yes! : w.no! };
  if (w?.kind === "bool" && l.isNot !== undefined && !Array.isArray(l.isNot)) return { rest: l.isNot === true ? w.no! : w.yes! };
  const parts: string[] = [];
  const vals = (v: Value | Value[]) => list(v).map((x) => valueText(w, x, lists)).join(" or ");
  const time = w?.kind === "time";
  if (l.is !== undefined) parts.push(`is ${vals(l.is)}`);
  if (l.isNot !== undefined) parts.push(`is not ${vals(l.isNot)}`);
  if (l.gt !== undefined) parts.push(`${time ? "is after" : "is above"} ${valueText(w, l.gt, lists)}`);
  if (l.gte !== undefined) parts.push(`${time ? "is from" : "is at least"} ${valueText(w, l.gte, lists)}`);
  if (l.lt !== undefined) parts.push(`${time ? "is before" : "is below"} ${valueText(w, l.lt, lists)}`);
  if (l.lte !== undefined) parts.push(`${time ? "is up to" : "is at most"} ${valueText(w, l.lte, lists)}`);
  if (l.fact === "now" && l.lt !== undefined) return { rest: "Until the pause ends" };
  return { name, rest: parts.join(" and ") };
}

/** A whole condition as one line (the locked rows, the hints). Groups inside get parentheses. */
export function condText(c: Cond | undefined, lists: Lists, top = true, inSentence = false): string {
  if (!c) return "";
  if ("all" in c || "any" in c) {
    const members = "all" in c ? c.all : c.any;
    if (!members.length) return top ? "Always" : "";
    const inner = members.map((m) => condText(m, lists, false, inSentence)).join("all" in c ? " and " : " or ");
    return top || members.length === 1 ? inner : `(${inner})`;
  }
  if ("not" in c) {
    const inner = c.not;
    // not (Surface is Mini) reads as "Surface is not Mini".
    if (!("all" in inner || "any" in inner || "not" in inner) && inner.is !== undefined && Object.keys(inner).length === 2)
      return leafText({ fact: inner.fact, isNot: inner.is }, lists, inSentence);
    if ("any" in inner) return `none of (${inner.any.map((m) => condText(m, lists, false, inSentence)).join(", ")})`;
    return `not ${condText(inner, lists, false, inSentence)}`;
  }
  return leafText(c, lists, inSentence);
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
    // Rulez stores the station; an agent's rule stores its id.
    case "playStation": return `Play ${typeof arg === "string" ? labelOf(lists.stations, arg) : (arg as { name?: string })?.name ?? "a station"}`;
    case "sharePause": return "Pause sharing for an hour";
    case "sleepIn": return `Start the sleep timer: ${arg} min`;
    case "keep": return "Keep it from happening";
    case "note": return `Show a note: ${String(arg)}`;
    case "hide": return "Hide the app in the tray";
    case "addTo": return `Add the song to ${labelOf(lists.editable, arg)}`;
    case "love": return "Love the song";
    case "diary": return "Open the Diary for this album";
    case "scrobble": return `Turn scrobbling ${arg ? "on" : "off"}`;
    case "picture": return `Use the picture ${labelOf(lists.pictures, arg)}`;
    case "playSound": return `Play the sound ${labelOf(lists.sounds, arg)}`;
    case "shuffleLibrary": return "Play the library shuffled";
    case "openIn": return `Open it in ${arg === "library" ? "the Library" : "Search"}`;
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
      else if (t.key === "glassPictureId") out.push(`Use the picture ${labelOf(lists.pictures, s.value)}`);
      else if (t.key === "glassCanvas") continue; // one part with the picture
      else {
        const w = doWord(t.key);
        out.push(w ? `${w.label}: ${labelOf(choicesOf(w, lists), s.value)}` : `Set ${t.key}`);
      }
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
    const station = verb === "playStation" && typeof arg !== "string" ? (arg as { id: string }).id : arg;
    return w ? { word: w, value: station as Value } : null;
  }
  const first = r.set[0];
  if (!first) return null;
  const t = first.target;
  const id = "key" in t
    ? t.key === "soundEqPreset" ? "preset" : t.key === "cardGrowOutside" ? "growOutside" : t.key === "glassPictureId" || t.key === "glassCanvas" ? "picture" : (SHARING as readonly string[]).includes(t.key) ? "sharePause" : t.key
    : t.prop === "window.onTop" ? "onTop" : t.prop.startsWith("tone.") ? t.prop.slice(5) : t.prop;
  const w = doWord(id);
  return w ? { word: w, value: first.value as Value } : null;
}

// ── the sentence (RULEZ.md §6.3, §6.5): DeetsMusic is the actor ────

/** What DeetsMusic does, for a When row (`act`) and a While row (`keep`), before the value. */
export const SAYS: Record<string, { act?: string; keep?: string }> = {
  play: { act: "plays" }, pause: { act: "pauses" }, next: { act: "skips ahead" }, prev: { act: "goes back" },
  shuffle: { act: "turns shuffle" }, repeat: { act: "sets repeat to" }, volume: { act: "sets the volume to", keep: "keeps the volume at" },
  playPlaylist: { act: "plays the playlist" }, playStation: { act: "plays the station" },
  preset: { act: "uses EQ preset", keep: "keeps EQ preset" }, bass: { keep: "keeps the bass at" }, mids: { keep: "keeps the mids at" },
  treble: { keep: "keeps the treble at" }, preamp: { keep: "keeps the preamp at" },
  theme: { act: "uses theme", keep: "keeps theme" }, skin: { act: "uses skin", keep: "keeps skin" },
  grow: { act: "grows this card" }, summon: { act: "opens" }, onTop: { keep: "keeps the window on top" },
  keep: { act: "keeps it from happening" }, growOutside: { keep: "keeps Collapse on outside click" },
  sharePause: { act: "pauses sharing for an hour", keep: "keeps sharing paused" }, sleepIn: { act: "starts the sleep timer for" },
  note: { act: "shows the note" }, picture: { act: "uses the picture", keep: "keeps the picture" }, playSound: { act: "plays the sound" }, hide: { act: "hides in the tray" }, addTo: { act: "adds the song to" },
  love: { act: "loves the song" }, diary: { act: "opens the Diary for this album" }, scrobble: { act: "turns scrobbling" },
  shuffleLibrary: { act: "plays the library shuffled" }, openIn: { act: "opens it in" },
  backgroundMotion: { keep: "keeps Animate backgrounds" }, appearanceMotion: { keep: "keeps Animate look changes" },
  cardSwapMotion: { keep: "keeps Animate card swaps" }, fancyScrubber: { keep: "keeps Fancy scrubber" },
  glassFancy: { keep: "keeps Fancy Glass" }, friendsListenAlong: { keep: "keeps Let friends listen along" },
  friendsRoomInvite: { keep: "keeps Put my room code on my box" }, toasts: { keep: "keeps Show notices at" },
  webPlayNew: { keep: "keeps Play a web from the song playing" }, webPlayMode: { keep: "keeps a web from the song playing at" },
  webSkipSeed: { keep: "keeps Skip the song you just heard" }, webSkipSeedAt: { keep: "skips the song you just heard past" },
};
/** Every Do word has its own SAYS phrase (tests/rulez-words.test.ts checks it); the label is only
 *  a fallback, and it goes through `lowerFirst` so a name in it keeps its case. */
export const saysOf = (w: DoWord, moment: boolean): string => (moment ? SAYS[w.id]?.act : SAYS[w.id]?.keep) ?? lowerFirst(w.label);

/** A Do word's value as words ("Warm", "40%", "−3 dB"), or "" for a word with none. */
export function doValueText(w: DoWord, v: unknown, lists: Lists): string {
  if (w.input === "none") return "";
  if (w.input === "text") return `"${String(v)}"`;
  if (w.input === "number") {
    const n = Number(v);
    return w.unit === "dB" ? `${n > 0 ? "+" : ""}${n} dB` : w.unit === "%" ? `${n}%` : `${n}${w.unit ? ` ${w.unit}` : ""}`;
  }
  if (w.id === "playStation") {
    const st = v as { name?: string; id?: string; special?: string } | string;
    if (typeof st === "string") return labelOf(lists.stations, st);
    return st?.special === "discovery" ? "your Discovery station" : st?.name ?? st?.id ?? "a station";
  }
  if (w.id === "openIn") return v === "library" ? "the Library" : "Search";
  const label = labelOf(choicesOf(w, lists), v);
  // Words that are not names read lower case in the sentence ("grows this card taller").
  const plain = w.id === "grow" || w.id === "shuffle" || w.id === "scrobble" || w.id === "growOutside" || w.id === "repeat"
    || w.choices === ON_OFF || w.choices === MOTION || w.choices === NOTICES;
  return plain ? label.toLowerCase() : label;
}

/** The row's one-line summary: "When the next song plays, DeetsMusic skips ahead, only if The song is explicit." */
export function sentenceText(r: Rule, lists: Lists): string {
  const cond = condText(r.kind === "state" ? r.while : r.if, lists, true, true);
  if (r.kind === "state") {
    const parts = stateParts(r.set).map(({ word, value }) => (word ? `${saysOf(word, false)} ${doValueText(word, value, lists)}`.trim() : ""));
    const does = parts.filter(Boolean).join(" and ") || "…";
    return `While ${cond === "Always" ? "it is on" : lowerFirst(cond)}, DeetsMusic ${does}.`;
  }
  const when = whenText(r, lists);
  const inCard = r.card !== "*" ? ` in ${labelOf(lists.cards, r.card)}` : "";
  const d = doWordOf(r);
  const does = d ? `${saysOf(d.word, true)} ${doValueText(d.word, r.kind === "moment" && "playStation" in r.do ? r.do.playStation : d.value, lists)}`.trim() : "…";
  const only = r.if && cond && cond !== "Always" ? `, only if ${lowerFirst(cond)}` : "";
  return `When ${when ? lowerFirst(when) : "…"}${inCard}, DeetsMusic ${does}${only}.`;
}

/** A While row's set as its Do words (the sharing switches are one word). */
export function stateParts(set: StateSet): { word: DoWord | undefined; value: unknown; set: StateSet }[] {
  const sharing = set.filter((s) => "key" in s.target && (SHARING as readonly string[]).includes(s.target.key));
  const out: { word: DoWord | undefined; value: unknown; set: StateSet }[] = [];
  if (sharing.length) out.push({ word: doWord("sharePause"), value: true, set: sharing });
  // A picture is two targets, Glass › Canvas and the picture: one part.
  const pic = set.filter((s) => "key" in s.target && (s.target.key === "glassCanvas" || s.target.key === "glassPictureId"));
  if (pic.length) out.push({ word: doWord("picture"), value: pic.find((s) => "key" in s.target && s.target.key === "glassPictureId")?.value, set: pic });
  for (const s of set) {
    if (sharing.includes(s) || pic.includes(s)) continue;
    const probe = doWordOf({ id: "", kind: "state", source: { user: true }, on: true, while: { all: [] }, set: [s], onHand: "next" });
    out.push({ word: probe?.word, value: s.value, set: [s] });
  }
  return out;
}

// ── who wins (RULEZ.md §6.2, route 9's Rulez half) ────────────────

/** The top-level "all of" leaves of a condition (what must hold for it to hold). */
function mustHold(c: Cond | undefined): Leaf[] {
  if (!c) return [];
  if ("fact" in c) return [c];
  if ("all" in c) return c.all.flatMap((m) => ("fact" in m ? [m] : []));
  return [];
}

/** Can both conditions hold at once? False only when both name one fact with `is` values that
 *  share nothing ("Genre is Jazz" against "Genre is Rap"). Anything else might overlap. */
export function canBothHold(a: Cond | undefined, b: Cond | undefined): boolean {
  const la = mustHold(a);
  const lb = mustHold(b);
  for (const x of la)
    for (const y of lb) {
      if (x.fact !== y.fact || x.is === undefined || y.is === undefined) continue;
      const xs = (Array.isArray(x.is) ? x.is : [x.is]).map((v) => (typeof v === "string" ? v.toLowerCase() : v));
      const ys = (Array.isArray(y.is) ? y.is : [y.is]).map((v) => (typeof v === "string" ? v.toLowerCase() : v));
      if (!xs.some((v) => ys.includes(v))) return false;
    }
  return true;
}

const targetsOf = (r: StateRule) => r.set.map((s) => ("key" in s.target ? `key:${s.target.key}` : `prop:${s.target.prop}`));

/** For each rule, the first rule above it that also matches when it does (and so runs first). */
export function whoWins(rules: readonly Rule[]): Map<string, Rule> {
  const out = new Map<string, Rule>();
  rules.forEach((r, i) => {
    if (r.draft) return;
    for (const above of rules.slice(0, i)) {
      if (above.draft || !above.on || above.kind !== r.kind) continue;
      if (r.kind === "moment" && above.kind === "moment") {
        if (above.when !== r.when || (above.when === "clock" && above.at !== r.at)) continue;
        if (above.card !== "*" && r.card !== "*" && above.card !== r.card) continue;
        if (!canBothHold(above.if, r.if)) continue;
      } else if (r.kind === "state" && above.kind === "state") {
        const t = new Set(targetsOf(above));
        if (!targetsOf(r).some((x) => t.has(x))) continue;
        if (!canBothHold(above.while, r.while)) continue;
      }
      out.set(r.id, above);
      return;
    }
  });
  return out;
}

/** A row is complete: it names its When and its Do (a draft otherwise, RULES.md §20.2). */
export function isComplete(r: Rule): boolean {
  if (r.kind === "moment") return !!r.when && !!r.do && Object.keys(r.do).length > 0 && (r.when !== "clock" || typeof r.at === "number");
  return r.set.length > 0;
}
