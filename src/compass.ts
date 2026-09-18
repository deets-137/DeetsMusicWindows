// The Compass (docs/COMPASS.md) — Ctrl+Space's bar under the title bar, in every surface.
//
// Type a few letters and the bar lists what matches: the cards, surfaces, themes and skins
// (Places), every Settings row (store-backed rows inline), the transport and sleep verbs
// (Actions), and the library — songs, albums, artists, playlists, the stations played
// before. Enter goes to the OWNER of the row (the card, the Settings row, the player); the
// bar never renders a panel of its own (VALUES.md §4.1). The last row hands the term to the
// Search card: the bar itself makes no Apple call.
//
// The index is built from the app's own registries (cards.ts, the title menu's buttons,
// settings-card.ts's inert rows) and the in-memory track store. Nothing is stored.

import "./styles/compass.css";
import { registry, type CardId } from "./cards";
import { requestCard, requestSetting, requestLibraryDrill, requestSearchTerm, cardHost } from "./layout-bus";
import { growCard, growDirs, type Slot, type GrowDir } from "./card-grow";
import { currentSurface, onSurfaceChange } from "./surface";
import { makeDropdown } from "./dropdown";
import { enterRows } from "./pop";
import { setting } from "./settings-store";
import { settingsRows, type SettingEntry } from "./settings-card";
import { tracks } from "./track-store";
import { creditIndex } from "./artist-credit";
import { albumKey, albumOrder, artistOrder } from "./library-card";
import { esc } from "./collection-card";
import { playlistsCached, playlistTracks, requestOpenPlaylist } from "./playlists";
import { radioRecents, radioLivePeek, radioSpecialPeek, radioGenresPeek, radioGenreStationsPeek, radioGenreStations, radioLive, radioMyStation, radioDiscovery, radioGenres, type Station } from "./radio";
import type { Playlist } from "./search";
import type { Track } from "./library";
import {
  playPause, nextTrack, prevTrack, toggleShuffle, cycleRepeat, toggleMute, isMuted, isPlayingNow, isShuffleOn, getRepeat,
  playTracks, playStation, jumpToUpcoming, setVolume, queueTracksNext, queueTracksLater, queueTracksAt,
} from "./player";
import { sleepIn, sleepOff, sleepArmed, sleepAtEnd, openSleepPanel } from "./sleep";
import { presetOptions, selectPreset } from "./sound";
import { getUpcoming, getRecentlyPlayed, getCurrent } from "./queue";
import { isLoved, setLoved, favoriteOffered } from "./favorites";
import { addTrackToLibrary, alreadyInLibrary, libraryAddEnabled } from "./library-add";
import { trackById } from "./track-store";
import { resolveEntry } from "./queue-rows";
import { requestSongPane } from "./go-to";
import { speakersKnown, connectSpeaker, scanSpeakers, isScanning } from "./airplay";
import { webQuick, type WebRequest } from "./web";
import { openSoundPanel } from "./sound-panel";
import { openRoomPanel } from "./room-panel";
import { inRoom, leaveRoom, endRoom, roomState, startRoom, isStopped, listenAgain, stopListening } from "./room";
import * as diag from "./diag";
import { toast } from "./toast";

// ── the rows ──────────────────────────────────────────────────

type Group =
  | "Places" | "Settings" | "Actions" | "Sound" | "Up Next" | "Recently Played" | "Speakers"
  | "Songs" | "Albums" | "Artists" | "Genres" | "Playlists" | "Stations" | "Apple Music";
/** Rows per group, and for the shown library kind, by surface: Mini is a small window
 *  (the user's call 2026-09-17: three there). */
const perGroup = (): number => (currentSurface() === "mini" ? 3 : 6);
const perKind = (): number => (currentSurface() === "mini" ? 3 : currentSurface() === "midi" ? 8 : 12);
/** The library kinds the filter row cycles (COMPASS.md §2a); the shown one lists more rows. */
const KINDS: Group[] = ["Songs", "Albums", "Artists", "Genres", "Playlists", "Stations"];
/** The card that owns a kind: on screen, that kind ranks a little higher (a context match). */
const KIND_CARD: Partial<Record<Group, CardId>> = { Songs: "library", Albums: "library", Artists: "library", Genres: "library", Playlists: "playlists", Stations: "radio" };
const CONTEXT = "compass";

interface Row {
  group: Group;
  title: string;
  /** The second line: a card's kind, a setting's section, a song's artist and album. */
  sub?: string;
  /** The hover hint (a Settings row's own). */
  hint?: string;
  /** A trailing note on the right: a key ("Ctrl+K"), a state ("On"). */
  side?: string;
  /** Enter. Returns false to keep the bar open (an inline row). */
  run: () => boolean | void;
  /** Ctrl+Enter (the data rows' Play). */
  alt?: { label: string; run: () => void };
  /** An inline Settings control (COMPASS.md §3). */
  control?: SettingEntry["control"];
  /** A row that never leaves the bar (an inline row): Enter acts and the rows repaint. */
  stays?: boolean;
  /** A command's own options (the grow command's shape): a split pill, Tab moves between them. */
  options?: { labels: string[]; get: () => number; set: (i: number) => void };
  /** Draw `options` on the highlighted row only; the other rows keep their `side` (the card
   *  rows' shape pill, so the key hints stay readable). CSS does it, so no re-render. */
  ctlOnActive?: boolean;
  /** A data row's songs (the queue command reads them). */
  tracks?: () => Promise<Track[]>;
  /** Shown muted; Enter does nothing (the grow command in Mini). */
  disabled?: boolean;
  /** Other words that find this row ("skip" finds Next song). Searched, never shown. */
  aliases?: string[];
}

/** Words a person may type for a thing the app names otherwise. Applied to the typed term:
 *  each word is tried as itself and as each of its synonyms. Mirrored in
 *  docs/COMPASS-TERMS.md; change both. */
export const SYNONYMS: Record<string, string[]> = {
  preferences: ["settings"], options: ["settings"], prefs: ["settings"],
  skip: ["next"], forward: ["next"],
  back: ["previous"], prev: ["previous"],
  loop: ["repeat"],
  random: ["shuffle"],
  silence: ["mute"], quiet: ["mute"],
  vol: ["volume"], loud: ["volume"],
  eq: ["eq", "equalizer"], equalizer: ["eq"],
  speaker: ["speakers"], airplay: ["speakers", "play on"], homepod: ["speakers"],
  timer: ["sleep"], alarm: ["sleep"],
  fav: ["favorite"], love: ["favorite"], heart: ["favorite"], like: ["favorite"],
  dislike: ["favorite"], unlove: ["favorite"],
  "up next": ["queue"], upnext: ["queue"],
  recent: ["recently played", "history"], recents: ["recently played"],
  stations: ["radio"], station: ["radio"],
  expand: ["grow"], enlarge: ["grow"], big: ["grow"], fill: ["grow"],
  look: ["theme", "skin"], colors: ["theme"], colour: ["theme"], dark: ["theme"], light: ["theme"],
  window: ["surface"], size: ["surface"], small: ["mini"], large: ["max"],
  lib: ["library"], songs: ["library"], music: ["library"],
  lists: ["playlists"], list: ["playlists"],
  web: ["web"], playlistweb: ["web"],
  find: ["search"], lookup: ["search"],
};

/** Damerau-Levenshtein distance, capped: 0 when equal; a typo is 1; stops early past `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  const prev2 = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) { prev2[j] = prev[j]; prev[j] = cur[j]; }
  }
  return prev[b.length];
}
/** A typed word nearly equals a word of the text: one slip in a word of 4+, two in 8+. */
function nearWord(w: string, words: string[]): boolean {
  if (w.length < 4) return false;
  const max = w.length >= 8 ? 2 : 1;
  return words.some((x) => Math.abs(x.length - w.length) <= max && editDistance(w, x, max) <= max);
}

const GLYPH: Record<Group, string> = {
  Places: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 10v10"/></svg>',
  Settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>',
  Actions: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l12 7-12 7z"/></svg>',
  Sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4v16M12 4v16M19 4v16"/><rect x="3" y="9" width="4" height="3" rx="1"/><rect x="10" y="13" width="4" height="3" rx="1"/><rect x="17" y="6" width="4" height="3" rx="1"/></svg>',
  "Up Next": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M4 12h10M4 18h7M17 9l4 3-4 3z"/></svg>',
  "Recently Played": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
  Speakers: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3" width="12" height="18" rx="2"/><circle cx="12" cy="14" r="3.5"/><circle cx="12" cy="7.5" r="1"/></svg>',
  Songs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>',
  Albums: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/></svg>',
  Artists: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  Genres: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h10M4 17h13"/><circle cx="18" cy="12" r="2"/></svg>',
  Playlists: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h12M4 12h12M4 18h8M18 12v6M15.5 18a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0z"/></svg>',
  Stations: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2"/><path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9M4.7 4.7a10.3 10.3 0 0 0 0 14.6M19.3 4.7a10.3 10.3 0 0 1 0 14.6"/></svg>',
  "Apple Music": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg>',
};
const COMPASS_GLYPH =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.4c4.6-.3 8.2 3 8.4 7.6.2 4.9-3.5 9.2-8.3 9.4-4.7.2-8.6-3.6-8.5-8.4C3.7 7.4 7.4 3.7 12 3.4z"/><path d="M12 5.6l1.6 6.9L12 12l-1.6.5z"/><path d="M6.1 11.7h1.7M16.2 11.7h1.7M12 16.8v1.2"/></svg>';

/** Lower-case, no accents, so "Beyonce" finds Beyoncé. */
const fold = (s: string): string => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** 0 = no match. 3 = the title starts with the term; 2 = every word of the term starts a
 *  word; 1 = every word is somewhere in the text (a row's aliases count as text);
 *  0.5 = every word is in the text or one slip away from a word of it (a typo). */
function score(row: Row, words: string[], term: string): number {
  const title = fold(row.title);
  const text = `${title} ${fold(row.sub ?? "")}${row.aliases ? ` ${row.aliases.map(fold).join(" ")}` : ""}`;
  if (words.every((w) => text.includes(w))) {
    if (title === term) return 4; // the exact name, above every "starts with"
    if (title.startsWith(term)) return 3;
    if (row.aliases?.some((a) => fold(a).startsWith(term))) return 3; // "airpla" is the speakers, not Airplane Tickets
    const starts = text.split(/[\s,.·/&()'"-]+/);
    if (words.every((w) => starts.some((s) => s.startsWith(w)))) return 2;
    return 1;
  }
  const parts = text.split(/[\s,.·/&()'"-]+/);
  return words.every((w) => text.includes(w) || nearWord(w, parts)) ? 0.5 : 0;
}

/** The term's words, each also as its synonyms: "fav skip" → [["fav","favorite"],["skip","next"]].
 *  A row matches when, for every word, one of its forms matches (`hitsOf`). */
function expand(words: string[]): string[][] {
  return words.map((w) => [w, ...(SYNONYMS[w] ?? [])]);
}

// ── the index ─────────────────────────────────────────────────

// ── a card's shape (COMPASS.md §2c) ───────────────────────────
//
// Every card row opens its card. HOW it opens is a shape: as the card at rest, or grown over
// its neighbor (Horizontal, Vertical) or over the whole bento (Full). Two ways to pick it:
// a word typed before or after the card's name ("full settings", "settings full"), or the
// pill the highlighted row carries — Tab moves between the shapes this surface has. The pick
// is not remembered: the bar opens on Card every time, because opening a card is the common
// act and a remembered Full would fill the window on an Enter nobody thought about.

/** The card keys, and the hints the rows show for them. ONE list: main.ts's global handler
 *  reads it too, and so does the bar's own handler — the bar must answer the key it prints,
 *  because the global one ignores every Ctrl key while a text field has the focus, and the
 *  bar's field is one (found 2026-09-18). */
export const CARD_KEYS: Record<string, CardId> = { k: "search", q: "queue", l: "library", p: "playlists", ",": "settings" };
const KEY_HINT: Partial<Record<CardId, string>> = Object.fromEntries(
  Object.entries(CARD_KEYS).map(([k, id]) => [id, `Ctrl+${k === "," ? "," : k.toUpperCase()}`]),
);

type CardShape = "card" | "wide" | "tall" | "full";
const SHAPE_LABEL: Record<CardShape, string> = { card: "Card", wide: "Horizontal", tall: "Vertical", full: "Full" };
/** The shapes this surface has. Mini has one: a card already fills the window. */
const shapesNow = (): CardShape[] =>
  currentSurface() === "max" ? ["card", "wide", "tall", "full"] : currentSurface() === "midi" ? ["card", "wide"] : ["card"];
/** The nearest shape this surface has ("full" in Midi is Horizontal; anything in Mini is Card). */
const clampShape = (s: CardShape): CardShape => {
  const have = shapesNow();
  return have.includes(s) ? s : have.length > 1 ? have[1] : "card";
};
/** Words that name a shape. "max" is NOT one: it is the surface. */
const SHAPE_WORDS: Record<string, CardShape> = {
  card: "card", normal: "card", open: "card", plain: "card",
  horizontal: "wide", wide: "wide", side: "wide", across: "wide", half: "wide",
  vertical: "tall", tall: "tall", upright: "tall",
  full: "full", fill: "full", whole: "full", big: "full", huge: "full",
};
/** The shape a word names, by the word itself or a prefix of three letters or more that
 *  reaches one shape only ("hor", "vert", "ful"). */
function shapeOf(word: string): CardShape | null {
  const exact = SHAPE_WORDS[word];
  if (exact) return exact;
  if (word.length < 3) return null;
  let found: CardShape | null = null;
  for (const [w, sh] of Object.entries(SHAPE_WORDS)) {
    if (!w.startsWith(word)) continue;
    if (found && found !== sh) return null;
    found = sh;
  }
  return found;
}
/** Splits a shape word off the front or the back of the typed words. */
function splitShape(words: string[]): { shape: CardShape | null; rest: string[] } {
  if (words.length >= 2) {
    const first = shapeOf(words[0]);
    if (first) return { shape: first, rest: words.slice(1) };
    const last = shapeOf(words[words.length - 1]);
    if (last) return { shape: last, rest: words.slice(0, -1) };
  }
  return { shape: null, rest: words };
}
/** The Tab pick while the bar is open; cleared on every opening. Tab beats a typed word. */
let shapeTab: CardShape | null = null;

/** Open a card in a shape: the card comes in first, then the grow (its host has a slot the
 *  next frame). Shared by the card rows and the `grow` command. */
function openCard(id: CardId, shape: CardShape): void {
  const here = !!cardHost(id);
  requestCard(id);
  if (shape === "card") return;
  const doGrow = () => {
    const slot = cardHost(id)?.dataset.slot as Slot | undefined;
    if (!slot) return;
    const dirs = growDirs(slot);
    const dir: GrowDir | undefined =
      shape === "full" ? "full" : shape === "wide" ? dirs.find((d) => d === "left" || d === "right") : dirs.find((d) => d === "up" || d === "down");
    if (dir) growCard(slot, dir, "compass");
  };
  if (here) doGrow();
  else requestAnimationFrame(doGrow);
}

/** The cards, the surfaces, the themes and skins, the two title bar panels. A theme, skin or
 *  surface row clicks the title menu's own button, so the owner's handler runs (the
 *  appearance transition, the schedule's hand-pick note, the tray pin). */
function places(all: boolean, typed: CardShape | null = null, plain = false): Row[] {
  const KEY = KEY_HINT;
  const rows: Row[] = [];
  // The shape pill: the shapes this surface has. Tab's pick beats a typed word; with neither,
  // a card opens as the card at rest.
  const shapes = shapesNow();
  const eff = (): CardShape => (plain ? "card" : clampShape(shapeTab ?? typed ?? "card"));
  // The second line says the shape, and names the limit when the surface has no such shape.
  const subOf = (): string => {
    const want = plain ? null : shapeTab ?? typed;
    const got = eff();
    if (!want || want === "card") return "Card";
    if (got === "card") return "Card · Mini shows one card";
    if (got !== want) return `Card · ${SHAPE_LABEL[got]} · Midi grows sideways only`;
    return `Card · ${SHAPE_LABEL[got]}`;
  };
  for (const def of Object.values(registry)) {
    if (!def || def.id === "now-playing") continue;
    if (def.id === "rewind" && !setting("rewindCard")) continue;
    const ALIAS: Partial<Record<CardId, string[]>> = { settings: ["preferences", "options"], queue: ["up next"], history: ["recent", "plays"], radio: ["stations"], library: ["songs", "music"], search: ["find", "apple music"] };
    rows.push({
      group: "Places", title: def.title, sub: subOf(), side: KEY[def.id], aliases: ALIAS[def.id],
      options: !plain && shapes.length > 1
        ? { labels: shapes.map((sh) => SHAPE_LABEL[sh]), get: () => Math.max(0, shapes.indexOf(eff())), set: (i) => { shapeTab = shapes[i]; } }
        : undefined,
      ctlOnActive: !plain && shapes.length > 1,
      run: () => openCard(def.id, eff()),
    });
  }
  if (!all) return rows;
  const click = (el: HTMLElement) => () => el.click();
  document.querySelectorAll<HTMLElement>("[data-surface-choice]").forEach((el) => {
    const name = el.textContent?.trim() ?? "";
    rows.push({ group: "Places", title: name === "NP" ? "NP (the player alone)" : name, sub: "Surface", hint: el.dataset.hint || el.title, run: click(el) });
  });
  document.querySelectorAll<HTMLElement>("[data-theme-choice]").forEach((el) => {
    rows.push({ group: "Places", title: el.textContent?.trim() ?? "", sub: "Theme", hint: el.dataset.hint || el.title, run: click(el) });
  });
  document.querySelectorAll<HTMLElement>("[data-skin-choice]").forEach((el) => {
    rows.push({ group: "Places", title: el.textContent?.trim() ?? "", sub: "Skin", hint: el.dataset.hint || el.title, run: click(el) });
  });
  rows.push({ group: "Places", title: "Sound", sub: "The equalizer and adaptive sound", run: () => openSoundPanel() });
  rows.push({ group: "Places", title: "Sleep timer", sub: "The alarm clock", run: () => openSleepPanel() });
  rows.push({
    group: "Places",
    title: "Listening room",
    sub: inRoom() ? `In room ${roomState().code}` : "Listen with friends",
    run: () => openRoomPanel(),
  });
  return rows;
}

function settingRows(): Row[] {
  return settingsRows()
    .filter((e) => e.when())
    .map((e): Row => {
      const c = e.control;
      if (!c) return { group: "Settings", title: e.label, sub: e.section, hint: e.hint(), run: () => requestSetting(e.id) };
      return {
        group: "Settings", title: e.label, sub: e.section, hint: e.hint(), control: c, stays: true,
        // Enter: a toggle flips; a choice moves to the next option (Shift+Enter: the one before).
        run: () => {
          if (c.kind === "toggle") c.set(!c.get());
          else {
            const i = c.options.findIndex((o) => o.value === c.get());
            c.set(c.options[(i + (shiftHeld ? c.options.length - 1 : 1)) % c.options.length].value);
          }
          return false;
        },
      };
    });
}

function actions(all: boolean): Row[] {
  const rows: Row[] = [
    { group: "Actions", title: isPlayingNow() ? "Pause" : "Play", side: "Space", aliases: ["play", "pause", "resume", "stop"], run: () => void playPause().catch((e) => console.error("[compass] play", e)) },
    { group: "Actions", title: "Next song", aliases: ["skip", "forward"], run: () => void nextTrack().catch((e) => console.error("[compass] next", e)) },
    { group: "Actions", title: "Previous song", aliases: ["back", "prev", "rewind"], run: () => void prevTrack().catch((e) => console.error("[compass] prev", e)) },
  ];
  if (!all) return rows;
  const repeatNext = { off: "all", all: "one", one: "off" }[getRepeat()];
  rows.push(
    { group: "Actions", title: isShuffleOn() ? "Shuffle off" : "Shuffle on", sub: "The Shuffle button", aliases: ["random"], run: () => void toggleShuffle().catch((e) => console.error("[compass] shuffle", e)) },
    { group: "Actions", title: `Repeat ${repeatNext}`, sub: `Now: ${getRepeat()}`, aliases: ["loop"], run: () => void cycleRepeat() },
    { group: "Actions", title: isMuted() ? "Unmute" : "Mute", aliases: ["silence", "quiet", "sound off"], run: () => toggleMute() },
    ...[15, 30, 45, 60].map((m): Row => ({ group: "Actions", title: `Sleep in ${m} min`, sub: "The sleep timer", run: () => sleepIn(m) })),
  );
  // The song pane for what is playing (CREDITS.md §7). Only while a song with a catalog
  // id is on: an uploaded track has no credits to show.
  const playing = getCurrent();
  const playingTrack = playing ? resolveEntry(playing) : undefined;
  if (playingTrack?.catalogId)
    rows.push({
      group: "Actions",
      title: "Song credits",
      sub: playingTrack.title,
      aliases: ["writers", "composer", "credits", "who wrote"],
      run: () => requestSongPane({ track: playingTrack }),
    });
  rows.push(
    { group: "Actions", title: "Sleep at end of song", sub: "The sleep timer", run: () => sleepAtEnd("song") },
    { group: "Actions", title: "Sleep at end of Up Next", sub: "The sleep timer", run: () => sleepAtEnd("queue") },
  );
  if (sleepArmed()) rows.push({ group: "Actions", title: "Sleep timer off", run: () => sleepOff() });
  // Listening rooms (ROOMS.md §9, COMPASS.md §9): the verbs a room adds. Joining needs a
  // code, so that stays in the panel.
  if (!inRoom()) {
    rows.push({
      group: "Actions",
      title: "Start a listening room",
      sub: "Friends follow what you play",
      aliases: ["room", "listen together", "share"],
      run: () => void startRoom(),
    });
  } else {
    const state = roomState();
    rows.push({
      group: "Actions",
      title: state.isHost ? "End room" : "Leave room",
      sub: `Room ${state.code}`,
      aliases: ["room"],
      run: () => (state.isHost ? endRoom() : leaveRoom()),
    });
    rows.push(
      isStopped()
        ? { group: "Actions", title: "Listen again", sub: "Re-join the room's song", run: () => listenAgain() }
        : { group: "Actions", title: "Stop listening", sub: "The room plays on", run: () => stopListening() },
    );
  }
  return rows;
}

/** The equalizer presets (built-in, Custom, yours), the one in force marked. */
function soundRows(): Row[] {
  const cur = setting("soundEqPreset");
  return presetOptions().map((p): Row => ({
    group: "Sound", title: `EQ: ${p.name}`, sub: "Equalizer preset", side: p.id === cur ? "On" : undefined,
    run: () => selectPreset(p.id),
  }));
}

/** Up Next, in order: Enter jumps there. */
const upNextRows = (): Row[] =>
  getUpcoming().flatMap((e, i): Row[] => {
    const t = trackById(e.catalogId ?? e.libraryId);
    if (!t) return [];
    return [{ group: "Up Next", title: t.title, sub: `${i + 1} · ${t.artistName}`, run: () => void jumpToUpcoming(i).catch((err) => console.error("[compass] jump", err)) }];
  });

/** What played this session, newest first, each song once: Enter plays it again. */
function recentRows(): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const e of [...getRecentlyPlayed()].reverse()) {
    const id = e.catalogId ?? e.libraryId ?? "";
    const t = trackById(id);
    if (!t || seen.has(id)) continue;
    seen.add(id);
    out.push({ group: "Recently Played", title: t.title, sub: t.artistName, run: () => play([t]) });
  }
  return out;
}

/** The speakers on the network. The first speaker-shaped term of the session looks for them
 *  (the Play on panel's own scan: the local network, no Apple); until then the last one used
 *  is listed. A row looks again. */
const SPEAKER_WORDS = ["airplay", "speaker", "speakers", "play on", "homepod"];
let speakersAsked = false;
function speakerRows(term: string): Row[] {
  const rows: Row[] = speakersKnown().map((s): Row => ({
    group: "Speakers", title: `Play on ${s.name}`, sub: "AirPlay", aliases: SPEAKER_WORDS,
    run: () => void connectSpeaker(s).catch((e) => console.error("[compass] speaker", e)),
  }));
  const asked = SPEAKER_WORDS.some((w) => w.startsWith(term) || term.startsWith(w));
  if (asked && !speakersAsked) {
    speakersAsked = true;
    diag.log("compass:speakers", { scan: true });
    void scanSpeakers().then(() => { if (handle?.isOpen) render(); }).catch((e) => console.warn("[compass] scan", e));
  }
  if (asked)
    rows.push(
      isScanning()
        ? { group: "Speakers", title: "Looking for speakers…", sub: "On your network", aliases: SPEAKER_WORDS, disabled: true, run: () => false }
        : {
            group: "Speakers", title: "Look for speakers again", sub: "On your network; a few seconds", aliases: SPEAKER_WORDS, stays: true,
            run: () => {
              void scanSpeakers().then(() => { if (handle?.isOpen) render(); }).catch((e) => console.warn("[compass] scan", e));
              render();
              return false;
            },
          },
    );
  return rows;
}

/** The songs a name can mean for favorite / add: the current song, Up Next, this session's
 *  plays, then the library (for favorite). Each once. */
function nearbySongs(withLibrary: boolean): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  const take = (t: Track | undefined) => {
    const id = t?.catalogId ?? t?.libraryId;
    if (!t || !id || seen.has(id)) return;
    seen.add(id);
    out.push(t);
  };
  const cur = getCurrent();
  if (cur) take(trackById(cur.catalogId ?? cur.libraryId));
  for (const e of getUpcoming()) take(trackById(e.catalogId ?? e.libraryId));
  for (const e of [...getRecentlyPlayed()].reverse()) take(trackById(e.catalogId ?? e.libraryId));
  if (withLibrary) for (const t of tracks()) take(t);
  return out;
}
const songSub = (t: Track) => [t.artistName, t.albumName].filter(Boolean).join(" · ");
/** The best song for a name among `pool`, or the current song with no name. */
function songFor(name: string, pool: Track[]): Track | undefined {
  if (!name) {
    const cur = getCurrent();
    return cur ? trackById(cur.catalogId ?? cur.libraryId) : undefined;
  }
  const rows: Row[] = pool.map((t) => ({ group: "Songs", title: t.title, sub: songSub(t), run: () => {}, tracks: () => Promise.resolve([t]) }));
  const hit = hitsOf(rows, fold(name).split(/\s+/), fold(name))[0]?.r;
  return hit ? pool[rows.indexOf(hit)] : undefined;
}
/** The Add to Library and ♥ gate (Settings › Apple Music): off → the row opens that setting. */
const gateRow = (title: string): Row => ({
  group: "Actions", title, sub: "Off in Settings › Apple Music › Add to Library and ♥. Enter opens it",
  run: () => requestSetting("libraryadd"),
});

/** "favorite [song]" (fav, love, heart, like): ♥ the song, or the current song with no name.
 *  A loved song offers Unfavorite. A REAL Apple write, behind the ♥ gate. */
function favoriteRow(term: string): Row[] {
  const m = /^(?:favou?rite|fav|love|heart|like|unfavou?rite|unfav|unlove|dislike)(?:\s+(.+))?$/i.exec(term.trim());
  if (!m) return [];
  if (!libraryAddEnabled()) return [gateRow("Favorite")];
  const t = songFor(m[1]?.trim() ?? "", nearbySongs(true));
  if (!favoriteOffered(t)) return m[1] ? [] : [{ group: "Actions", title: "Favorite", sub: "Nothing is playing", disabled: true, run: () => false }];
  const on = isLoved(t);
  return [{
    group: "Actions", title: `${on ? "Unfavorite" : "Favorite"} \u201c${t.title}\u201d`, sub: `${songSub(t)} · ${on ? "takes the ♥ off" : "♥ on Apple Music too"}`,
    run: () => void setLoved(t, !on).catch((e) => console.error("[compass] favorite", e)),
  }];
}

/** "add [song]" (add to library): the song into your library, or the current song with no
 *  name. Only a song not in the library yet (a station's, a catalog play's). A REAL Apple write. */
function addRow(term: string): Row[] {
  const m = /^(?:add(?:\s+to\s+library)?)(?:\s+(.+))?$/i.exec(term.trim());
  if (!m) return [];
  if (!libraryAddEnabled()) return [gateRow("Add to Library")];
  const pool = nearbySongs(false).filter((t) => t.catalogId && !alreadyInLibrary(t));
  const t = songFor(m[1]?.trim() ?? "", pool);
  if (!t || alreadyInLibrary(t) || !t.catalogId) {
    if (m[1]) return [];
    const cur = getCurrent() ? trackById(getCurrent()!.catalogId ?? getCurrent()!.libraryId) : undefined;
    return [{ group: "Actions", title: "Add to Library", sub: cur ? `\u201c${cur.title}\u201d is in your library already` : "Nothing is playing", disabled: true, run: () => false }];
  }
  return [{
    group: "Actions", title: `Add \u201c${t.title}\u201d to Library`, sub: `${songSub(t)} · on Apple Music`,
    run: () => void addTrackToLibrary(t).catch((e) => console.error("[compass] add", e)),
  }];
}

/** "volume 40" / "vol 40": one row that sets the level. */
function volumeRow(term: string): Row[] {
  const m = /^vol(?:ume)?\s+(\d{1,3})\s*%?$/i.exec(term.trim());
  if (!m) return [];
  const pct = Math.max(0, Math.min(100, Number(m[1])));
  return [{ group: "Actions", title: `Volume ${pct}%`, run: () => setVolume(pct / 100) }];
}

/** "web <seed> [1|2|3] [genre, genre]" and "web song|album|artist <seed> …": one row that
 *  asks the playlist web for a playlist (web.ts `requestWeb`, COMPASS.md §2b). The seed is the
 *  longest run of words that starts a library artist, song, album or an earlier web's name;
 *  what follows is the genre (several: commas). With no local match the whole text is the
 *  seed and Apple is searched. Reach and style not given come from Settings. */
function webRow(term: string): Row[] {
  const m = /^web\s+(.+)$/i.exec(term.trim());
  if (!m) return [];
  const tokens = m[1].trim().split(/\s+/);
  let kind: WebRequest["kind"];
  if (/^(artist|song|album)$/i.test(tokens[0]) && tokens.length > 1) kind = tokens.shift()!.toLowerCase() as WebRequest["kind"];
  let reach: WebRequest["reach"];
  const ri = tokens.findIndex((t, i) => i > 0 && /^[123]$/.test(t));
  if (ri > 0) {
    reach = Number(tokens[ri]) as 1 | 2 | 3;
    tokens.splice(ri, 1);
  }
  if (!tokens.length) return [];
  const lib = libraryRows();
  const names = [...(kind === "song" ? lib.songs : kind === "album" ? lib.albums : kind === "artist" ? lib.artists : [...lib.artists, ...lib.songs, ...lib.albums])].map((r) => fold(r.title));
  let seedWords = tokens.length;
  if (ri > 0) seedWords = Math.min(seedWords, ri); // the reach number ended the seed
  else {
    for (let k = tokens.length; k >= 1; k--) {
      const prefix = fold(tokens.slice(0, k).join(" "));
      if (names.some((n) => n === prefix || n.startsWith(prefix))) {
        seedWords = k;
        break;
      }
    }
  }
  const seed = tokens.slice(0, seedWords).join(" ");
  const genres = tokens.slice(seedWords).join(" ").split(",").map((g) => g.trim()).filter(Boolean);
  const sub = webStatus ?? [kind ? `${kind[0].toUpperCase()}${kind.slice(1)}` : "Artist, song or album", `reach ${reach ?? setting("webReach")}`, ...genres, "makes the playlist"].join(" · ");
  return [{
    group: "Actions", title: `Web from \u201c${seed}\u201d`, sub, stays: true, disabled: webStatus !== null,
    // The row stays and reports each step; when the playlist exists the row itself flies to the
    // Playlists card as the chip, and the bar closes behind it.
    run: () => {
      if (webStatus !== null) return false;
      const req: WebRequest = { kind, term: seed, reach, genres };
      const status = (t: string) => { webStatus = t; render(); };
      status("Finding the start…");
      diag.log("web:compass", req);
      void webQuick(req, status, () => list?.querySelector<HTMLElement>(".compass__row.is-web") ?? null)
        .then(() => closeCompass())
        .catch((e) => { webStatus = null; render(); toast({ kind: "warn", text: String(e instanceof Error ? e.message : e) }); })
        .finally(() => { webStatus = null; });
      return false;
    },
  }];
}
let webStatus: string | null = null; // the web command's step under way, shown in its row

/** "grow <card>": grow the card over its neighbor, or fill the window (Max), bringing the card
 *  on screen first when it is not. The shape is a pill the row carries (Horizontal, Vertical,
 *  Full: the ones this surface has); the last pick is remembered. */
const GROW_KEY = "deets.compass.grow";
type GrowShape = "wide" | "tall" | "full";
const GROW_SHAPES: { shape: GrowShape; label: string }[] = [
  { shape: "wide", label: "Horizontal" },
  { shape: "tall", label: "Vertical" },
  { shape: "full", label: "Full" },
];
const growShapesNow = (): typeof GROW_SHAPES =>
  currentSurface() === "max" ? GROW_SHAPES : currentSurface() === "midi" ? GROW_SHAPES.filter((s) => s.shape === "wide") : [];
let growPick: GrowShape = (() => {
  try { return (localStorage.getItem(GROW_KEY) as GrowShape) || "wide"; } catch { return "wide"; }
})();
function growRow(term: string): Row[] {
  const m = /^grow\s+(.+)$/i.exec(term.trim());
  if (!m) return [];
  const shapes = growShapesNow();
  const want = fold(m[1]);
  const def = Object.values(registry).find((d) => d && d.id !== "now-playing" && fold(d.title).startsWith(want));
  if (!def) return [];
  if (!shapes.length) return [{ group: "Actions", title: `Grow ${def.title}`, sub: "Nothing to grow in Mini: one card fills the window. Midi or Max first", disabled: true, run: () => false }];
  const idx = () => Math.max(0, shapes.findIndex((s) => s.shape === growPick));
  return [{
    group: "Actions", title: `Grow ${def.title}`, sub: cardHost(def.id) ? "On screen" : "Brings the card in first",
    options: {
      labels: shapes.map((s) => s.label),
      get: idx,
      set: (i) => {
        growPick = shapes[i].shape;
        try { localStorage.setItem(GROW_KEY, growPick); } catch { /* session only */ }
      },
    },
    run: () => openCard(def.id, shapes[idx()].shape),
  }];
}

/** "queue [song|album|playlist] <name> [N | next | end]": the best library match goes into Up
 *  Next — at position N (from 1), next (the default), or at the end. */
function queueRow(term: string): Row[] {
  const m = /^queue\s+(.+)$/i.exec(term.trim());
  if (!m) return [];
  const tokens = m[1].trim().split(/\s+/);
  let kind: "song" | "album" | "playlist" | undefined;
  if (/^(song|album|playlist)$/i.test(tokens[0]) && tokens.length > 1) kind = tokens.shift()!.toLowerCase() as typeof kind;
  let where: { kind: "next" } | { kind: "end" } | { kind: "at"; n: number } = { kind: "next" };
  const last = tokens[tokens.length - 1]?.toLowerCase();
  if (tokens.length > 1 && last) {
    if (/^\d+$/.test(last)) { where = { kind: "at", n: Math.max(1, Number(last)) }; tokens.pop(); }
    else if (last === "next") { tokens.pop(); }
    else if (last === "end" || last === "last") { where = { kind: "end" }; tokens.pop(); }
  }
  const name = tokens.join(" ");
  if (!name) return [];
  const lib = libraryRows();
  const pool = kind === "song" ? lib.songs : kind === "album" ? lib.albums : kind === "playlist" ? playlistRows() : [...lib.songs, ...lib.albums, ...playlistRows()];
  const words = fold(name).split(/\s+/);
  const hit = hitsOf(pool, words, fold(name))[0]?.r;
  if (!hit?.tracks) return [];
  const put = where.kind === "at" ? `at position ${where.n}` : where.kind === "end" ? "at the end" : "next";
  return [{
    group: "Actions", title: `Queue \u201c${hit.title}\u201d ${put}`, sub: `${hit.group.replace(/s$/, "")} · ${hit.sub ?? ""}`,
    run: () => {
      const tracks = hit.tracks!;
      const w = where;
      void tracks()
        .then((ts) => (w.kind === "at" ? queueTracksAt(w.n - 1, ts, CONTEXT) : w.kind === "end" ? queueTracksLater(ts, CONTEXT) : queueTracksNext(ts, CONTEXT)))
        .then(() => diag.log("compass:queue", { title: hit.title, where: w }))
        .catch((e) => console.error("[compass] queue", e));
    },
  }];
}

// The stations Apple lists, read once per session the first time a term is typed: the same
// four calls the Radio card makes, into the same caches, so a Radio card opened after
// costs nothing (the user's ask). A bar used only for cards or settings never makes them.
let stationsAsked = false;
function preloadStations(): void {
  if (stationsAsked) return;
  stationsAsked = true;
  diag.log("compass:stations", { calls: 4 });
  void Promise.all([radioLive(), radioMyStation().catch(() => null), radioDiscovery().catch(() => null), radioGenres()])
    .then(() => { if (handle?.isOpen) render(); })
    .catch((e) => console.warn("[compass] stations", e));
}

const play = (ts: Track[]) => void playTracks(ts, 0, CONTEXT).catch((e) => console.error("[compass] play", e));

/** The library: songs, albums and artists from the track store; the playlists the store
 *  cached; the stations played before. Built per open, memoized on the store's array. */
let libMemo: { src: Track[]; songs: Row[]; albums: Row[]; artists: Row[]; genres: Row[] } | null = null;
function libraryRows(): { songs: Row[]; albums: Row[]; artists: Row[]; genres: Row[] } {
  const src = tracks();
  if (libMemo && libMemo.src === src) return libMemo;
  const songs = src.map((t): Row => ({
    group: "Songs", title: t.title, sub: [t.artistName, t.albumName].filter(Boolean).join(" · "),
    run: () => requestLibraryDrill({ kind: "album", track: t }),
    alt: { label: "Play", run: () => play([t]) },
    tracks: () => Promise.resolve([t]),
  }));
  const byAlbum = new Map<string, Track[]>();
  for (const t of src) {
    const k = albumKey(t);
    const list = byAlbum.get(k);
    if (list) list.push(t);
    else byAlbum.set(k, [t]);
  }
  const albums = [...byAlbum.values()].map((ts): Row => {
    const t = ts[0];
    return {
      group: "Albums", title: t.albumName ?? "Unknown Album", sub: `${t.artistName} · ${ts.length} song${ts.length === 1 ? "" : "s"}`,
      run: () => requestLibraryDrill({ kind: "album", track: t }),
      alt: { label: "Play", run: () => play(albumOrder(ts)) },
      tracks: () => Promise.resolve(albumOrder(ts)),
    };
  });
  const idx = creditIndex(src);
  const counts = new Map<string, number>();
  for (const t of src) for (const n of idx.namesOf(t)) counts.set(n, (counts.get(n) ?? 0) + 1);
  const artists = [...counts].map(([name, n]): Row => ({
    group: "Artists", title: name, sub: `${n} song${n === 1 ? "" : "s"}`,
    run: () => requestLibraryDrill({ kind: "artist", name }),
    alt: { label: "Play", run: () => play(idx.tracksFor(name)) },
  }));
  // Genres: a song's first genre, as the Library's Genres view groups them.
  const byGenre = new Map<string, number>();
  for (const t of src) if (t.genres[0]) byGenre.set(t.genres[0], (byGenre.get(t.genres[0]) ?? 0) + 1);
  const genres = [...byGenre].map(([name, n]): Row => ({
    group: "Genres", title: name, sub: `${n} song${n === 1 ? "" : "s"}`,
    run: () => requestLibraryDrill({ kind: "genre", name }),
    alt: { label: "Play", run: () => play(artistOrder(src.filter((t) => t.genres[0] === name))) },
  }));
  libMemo = { src, songs, albums, artists, genres };
  return libMemo;
}

let playlists: Playlist[] = [];
function playlistRows(): Row[] {
  return playlists
    .filter((p) => p.libraryId)
    .map((p): Row => ({
      group: "Playlists", title: p.name, sub: p.source === "local" ? "Your playlist" : p.curatorName || "Apple Music playlist",
      run: () => requestOpenPlaylist(p.libraryId!),
      alt: { label: "Play", run: () => void playlistTracks(p).then(play).catch((e) => console.error("[compass] playlist", e)) },
      tracks: () => playlistTracks(p),
    }));
}

/** The stations played before, then Apple's live list if the Radio card fetched it already. */
function stationRows(): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  const push = (s: Station, sub?: string) => {
    if (seen.has(s.id)) return;
    seen.add(s.id);
    out.push({
      group: "Stations", title: s.name, sub: sub ?? (s.tagline || "Station"),
      run: () => void playStation(s).catch((e) => console.error("[compass] station", e)),
    });
  };
  for (const s of [...radioRecents(), ...radioSpecialPeek(), ...radioLivePeek()] as Station[]) push(s);
  // Genre stations cost one call per genre, so they are read on demand: a genre's row reads
  // its stations (once per session) and the bar shows them; a genre read already lists them.
  for (const g of radioGenresPeek()) {
    const have = radioGenreStationsPeek(g.id);
    if (have) have.forEach((s) => push(s, `${g.name} · Station`));
    else
      out.push({
        group: "Stations", title: `${g.name} stations`, sub: "Enter reads them from Apple Music, once", stays: true,
        run: () => {
          void radioGenreStations(g).then(() => { if (handle?.isOpen) render(); }).catch((e) => console.warn("[compass] genre stations", e));
          return false;
        },
      });
  }
  return out;
}

interface Chip { group: Group; n: number; best: number }
interface Result { rows: Row[]; chips: Chip[]; kind: Group | null }

function hitsOf(pool: Row[], words: string[], term: string): { r: Row; s: number }[] {
  const hits: { r: Row; s: number }[] = [];
  const forms = expand(words);
  const plain = forms.every((f) => f.length === 1);
  for (const r of pool) {
    let s = score(r, words, term);
    if (!s && !plain) {
      // Synonyms: the best score over one form per word (few rows reach here: only when
      // the typed words themselves found nothing).
      const pick = (i: number, chosen: string[]): number => {
        if (i === forms.length) return score(r, chosen, chosen.join(" "));
        let best = 0;
        for (const f of forms[i]) best = Math.max(best, pick(i + 1, [...chosen, f]));
        return best;
      };
      s = pick(0, []);
    }
    if (s) hits.push({ r, s });
  }
  return hits.sort((a, b) => b.s - a.s || a.r.title.localeCompare(b.r.title));
}

/** The rows for a term. Empty: the cards, then Play / Next / Previous. With a term: the
 *  Places, Settings and Actions that match (six each), then ONE library kind - the one the
 *  filter row has (`kind`), or the predicted one: the kind with the best match, a tie going
 *  to Artists, Albums, Playlists, Songs, Stations - twelve rows; then the Apple Music row. */
function query(termRaw: string, kind: Group | null): Result {
  const term = fold(termRaw.trim());
  if (!term) return { rows: [...places(false), ...actions(false)], chips: [], kind: null };
  const words = term.split(/\s+/);
  const lib = libraryRows();
  preloadStations();
  const rows: Row[] = [...webRow(termRaw), ...volumeRow(termRaw), ...growRow(termRaw), ...queueRow(termRaw), ...favoriteRow(termRaw), ...addRow(termRaw)];
  // Each group is a block with its best score; the blocks come in that order, ties in the
  // default order — so an exact playlist name ("Replay") sits above the Settings rows that
  // only contain the word. The library block (its chips ride with it) is one block.
  const blocks: { best: number; rows: Row[] }[] = [];
  // Places first, because a shape word is split off the term for them alone ("full settings",
  // "settings full"). The split only stands when what is left still finds a card; otherwise
  // the whole term is searched, so a song called "Wide Awake" is still reachable.
  {
    const { shape, rest } = splitShape(words);
    let h = hitsOf(places(true, shape), words, term).slice(0, perGroup());
    if (shape && rest.length) {
      const rt = rest.join(" ");
      const shaped = hitsOf(places(true, shape), rest, rt).filter((x) => x.r.sub?.startsWith("Card"));
      if (shaped.length) h = [...shaped, ...h.filter((x) => !shaped.some((y) => y.r.title === x.r.title))].slice(0, perGroup());
    }
    if (h.length) blocks.push({ best: h[0].s, rows: h.map((x) => x.r) });
  }
  for (const pool of [settingRows(), actions(true), soundRows(), upNextRows(), recentRows(), speakerRows(term)]) {
    const h = hitsOf(pool, words, term).slice(0, perGroup());
    if (h.length) blocks.push({ best: h[0].s, rows: h.map((x) => x.r) });
  }
  const pools: Record<string, Row[]> = { Songs: lib.songs, Albums: lib.albums, Artists: lib.artists, Genres: lib.genres, Playlists: playlistRows(), Stations: stationRows() };
  const hits = new Map(KINDS.map((k) => [k, hitsOf(pools[k], words, term)] as const));
  // A kind whose card is on screen ranks a little higher: the context match.
  const boost = (k: Group): number => (KIND_CARD[k] && cardHost(KIND_CARD[k]!) ? 0.25 : 0);
  const chips: Chip[] = KINDS.map((k) => ({ group: k, n: hits.get(k)!.length, best: (hits.get(k)![0]?.s ?? 0) + boost(k) })).filter((c) => c.n);
  const PREFER: Group[] = ["Artists", "Albums", "Genres", "Playlists", "Songs", "Stations"];
  const predicted = chips.length
    ? chips.reduce((a, b) => (b.best > a.best || (b.best === a.best && PREFER.indexOf(b.group) < PREFER.indexOf(a.group)) ? b : a)).group
    : null;
  const active = kind && chips.some((c) => c.group === kind) ? kind : predicted;
  if (active) blocks.push({ best: chips.find((c) => c.group === active)!.best, rows: hits.get(active)!.slice(0, perKind()).map((h) => h.r) });
  blocks.sort((a, b) => b.best - a.best); // Array.sort is stable: ties keep the default order
  for (const b of blocks) rows.push(...b.rows);
  rows.push({ group: "Apple Music", title: `Search Apple Music for “${termRaw.trim()}”`, run: () => requestSearchTerm(termRaw.trim()) });
  return { rows, chips, kind: active };
}

// ── the bar ───────────────────────────────────────────────────

let panel: HTMLElement | null = null;
let input: HTMLInputElement | null = null;
let list: HTMLElement | null = null;
let handle: { open(): void; close(): void; readonly isOpen: boolean } | null = null;
let rows: Row[] = [];
let chips: Chip[] = [];
let kind: Group | null = null; // the filter row's pick; null = the predicted kind
let shownKind: Group | null = null;
let active = 0;
let shiftHeld = false;
let returnTo: HTMLElement | null = null;

// The needle on the title bar button (COMPASS.md §12). `angle` only grows or unwinds by a
// half turn, and the CSS transition on --compass-angle does the motion: the bar opens with a
// half turn forward, and it closes back the way it came, or on through the full circle when
// the press took you somewhere. `went` is that answer for the opening under way.
let mark: HTMLElement | null = null;
let angle = 0;
let went = false;
function turnNeedle(by: number): void {
  angle += by;
  mark?.style.setProperty("--compass-angle", `${angle}deg`);
}

// ── the agent's way in (AGENT.md; `deetsmusic go <place>`) ───────────────────
//
// One verb over the same registry the bar uses, so a place added to the Compass is
// reachable from the CLI the same day, with no second list to keep.
//
// PLACES ONLY, and not all of them. A card, the Sound panel and the Sleep timer only
// move what is on screen. Theme, skin and surface are in the same group but they WRITE a
// stored setting, and writing settings is already a route with its own consent (Settings ›
// Connections › Agent changes settings) and its own slower cover (UX-COVERUPS §6b). Letting
// `go glass` through here would be a second way in that asks nobody, so it is refused with
// a pointer at the route that does ask. Settings rows, transport verbs and data rows are
// out for the same reason: each already has a CLI verb that obeys its own rules.
type Reply = Record<string, unknown>;
/** The two panels in Places that are not cards; everything else navigable is `sub: "Card"`. */
const PANELS = new Set(["Sound", "Sleep timer"]);
/** A Places row this verb may run: it moves the view and writes nothing. */
function navigable(r: Row): boolean {
  if (r.group !== "Places") return false;
  if (r.sub === "Theme" || r.sub === "Skin" || r.sub === "Surface") return false;
  return r.sub === "Card" || PANELS.has(r.title);
}

function placeHits(term: string): Row[] {
  const t = fold(term.trim());
  const pool = places(true, null, true).filter(navigable);
  if (!t) return pool;
  return hitsOf(pool, t.split(/\s+/), t).map((h) => h.r);
}

const placeName = (r: Row): string => (r.sub && r.sub !== "Card" ? `${r.title} (${r.sub})` : r.title);

/**
 * `GET /go` (list) and `POST /go {target}` (run) — AGENT.md §3.
 * A target that matches nothing, or matches a place this verb will not run, says which.
 */
export function agentGo(payload: { target?: string; list?: boolean } | null): Reply {
  const term = String(payload?.target ?? "").trim();
  if (payload?.list || !term) {
    const all = placeHits("").map(placeName);
    return { ok: true, places: all, message: `${all.length} place(s) to go to` };
  }
  const hits = placeHits(term);
  if (!hits.length) {
    // Say WHY when the word does match something the bar knows: a skin or a setting is a
    // different verb, not a dead end.
    const near = places(true, null, true).find((r) => hitsOf([r], fold(term).split(/\s+/), fold(term)).length);
    if (near && (near.sub === "Theme" || near.sub === "Skin" || near.sub === "Surface")) {
      const key = near.sub.toLowerCase();
      throw new Error(
        `blocked: ${near.title} is a ${key}, and changing it is a setting — use \`deetsmusic settings set ${key} ${near.title.toLowerCase()}\`, which asks first if you have set it to.`,
      );
    }
    throw new Error(`unknown: no place called ${JSON.stringify(term)} — \`deetsmusic go\` with no words lists them`);
  }
  const row = hits[0];
  diag.log("compass:go", { title: row.title, sub: row.sub });
  row.run();
  return { ok: true, went: placeName(row), also: hits.slice(1, 4).map(placeName), message: `Went to ${placeName(row)}.` };
}

export const compassOpen = (): boolean => !!handle?.isOpen;

/** Open the bar (the title menu row, the compass button). A second call keeps it open and refocuses.
 *  Ctrl+Space itself toggles: see the key handler at the end of this file. */
export function openCompass(): void {
  if (!handle) return;
  if (!handle.isOpen) {
    returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    shapeTab = null; // a card opens as the card at rest until this opening's Tab says otherwise
    handle.open();
  }
  input?.focus();
  input?.select();
}

function closeCompass(): void {
  handle?.close();
}

const sideHTML = (r: Row, i: number): string => {
  const c = r.control;
  if (c?.kind === "toggle") {
    const on = c.get();
    return `<div class="set__split compass__ctl"><button class="set__half set__half--toggle" type="button" role="switch" aria-checked="${on}" data-toggle="${i}" tabindex="-1">${on ? "On" : "Off"}</button></div>`;
  }
  if (c?.kind === "choice") {
    const cur = c.get();
    return `<div class="set__split compass__ctl" role="radiogroup">${c.options
      .map((o) => `<button class="set__half" type="button" data-choice="${i}" data-value="${esc(o.value)}" aria-pressed="${o.value === cur}" tabindex="-1">${esc(o.label)}</button>`)
      .join("")}</div>`;
  }
  if (r.options) {
    const cur = r.options.get();
    // ctlOnActive (the card rows): the pill is drawn on the highlighted row only and the key
    // hint takes its place on the others. Both are in the DOM; CSS picks — setActive only
    // moves a class, it does not re-render.
    const cls = `set__split compass__ctl${r.ctlOnActive ? " compass__ctl--active" : ""}`;
    const pill = `<div class="${cls}" role="radiogroup">${r.options.labels
      .map((l, j) => `<button class="set__half" type="button" data-opt="${i}" data-j="${j}" aria-pressed="${j === cur}" tabindex="-1" title="Tab moves between these">${esc(l)}</button>`)
      .join("")}</div>`;
    if (!r.ctlOnActive || !r.side) return pill;
    return `<span class="compass__side compass__side--rest">${esc(r.side)}</span>${pill}`;
  }
  if (r.alt) {
    return `<div class="set__split compass__ctl"><button class="set__half" type="button" data-run="${i}" tabindex="-1" title="Enter">Open</button><button class="set__half" type="button" data-alt="${i}" tabindex="-1" title="Ctrl+Enter">${esc(r.alt.label)}</button></div>`;
  }
  return r.side ? `<span class="compass__side">${esc(r.side)}</span>` : "";
};

/** The filter row: one pill of the library kinds that have a match; the shown one is pressed.
 *  Tab moves to the next kind, Shift+Tab to the one before. */
const chipsHTML = (): string =>
  chips.length
    ? `<div class="compass__chips"><div class="set__split" role="radiogroup" aria-label="Show">${chips
        .map((c) => `<button class="set__half" type="button" data-kind="${c.group}" aria-pressed="${c.group === shownKind}" tabindex="-1" title="Tab moves between these">${c.group} <span class="compass__n">${c.n}</span></button>`)
        .join("")}</div></div>`
    : "";

/** The highlight to the shown kind's first row (after a Tab or a chip click). */
function activateKind(): void {
  setActive(Math.max(0, rows.findIndex((r) => r.group === shownKind)));
}

function render(): void {
  if (!list) return;
  const q = query(input?.value ?? "", kind);
  rows = q.rows;
  chips = q.chips;
  shownKind = q.kind;
  active = Math.min(active, Math.max(0, rows.length - 1));
  let html = "";
  let last: Group | null = null;
  let chipsDrawn = false;
  rows.forEach((r, i) => {
    // The filter row sits right above the library rows, not above Settings (only the
    // library kinds are what it filters).
    if (!chipsDrawn && KINDS.includes(r.group)) {
      html += chipsHTML();
      chipsDrawn = true;
    }
    if (r.group !== last) {
      html += `<div class="compass__group">${esc(r.group)}</div>`;
      last = r.group;
    }
    const tip = r.hint ? ` title="${esc(r.hint)}"` : "";
    const cls = `${i === active ? " is-active" : ""}${r.disabled ? " is-disabled" : ""}${r.title.startsWith("Web from") ? " is-web" : ""}`;
    html +=
      `<div class="compass__row${cls}" role="option" data-i="${i}" aria-selected="${i === active}"${r.disabled ? ' aria-disabled="true"' : ""}${tip}>` +
      `<span class="compass__glyph">${GLYPH[r.group]}</span>` +
      `<span class="compass__text"><span class="compass__title">${esc(r.title)}</span>${r.sub ? `<span class="compass__sub">${esc(r.sub)}</span>` : ""}</span>` +
      sideHTML(r, i) +
      `</div>`;
  });
  list.innerHTML = html || `<div class="compass__empty">Nothing here yet</div>`;
  input?.setAttribute("aria-activedescendant", rows.length ? `compass-row-${active}` : "");
  list.querySelectorAll<HTMLElement>(".compass__row").forEach((el) => (el.id = `compass-row-${el.dataset.i}`));
}

/** Move the highlight. A key press keeps the row in view; the pointer (already on it) does not. */
function setActive(i: number, scroll = true): void {
  if (!rows.length || !list) return;
  active = (i + rows.length) % rows.length;
  list.querySelectorAll<HTMLElement>(".compass__row").forEach((el) => {
    const on = Number(el.dataset.i) === active;
    el.classList.toggle("is-active", on);
    el.setAttribute("aria-selected", String(on));
    if (on && scroll) el.scrollIntoView({ block: "nearest" });
  });
  input?.setAttribute("aria-activedescendant", `compass-row-${active}`);
}

/** Run a row: Enter (or a click), Ctrl+Enter for its second action. An inline row keeps the bar. */
function runRow(i: number, alt = false): void {
  const r = rows[i];
  if (!r || r.disabled) return;
  diag.log("compass:run", { group: r.group, title: r.title, alt });
  if (alt && r.alt) {
    r.alt.run();
    went = true;
    closeCompass();
    return;
  }
  const keep = r.run() === false || r.stays;
  if (keep) render();
  else {
    went = true;      // the needle carries on instead of unwinding
    closeCompass();
  }
}

/** Keep the bar clear of the Now Playing card (COMPASS.md §11).
 *
 *  Two raw numbers, both measured against the title bar (the panel's positioning context),
 *  and styles/compass.css decides which one a surface uses:
 *    --np-drop   how far the card's bottom edge sits below the title bar — midi and mini
 *                card view, where NP is the full-width top row, so the bar drops under it.
 *    --np-right  where the card's right edge sits from the title bar's left — max, where NP
 *                is the tall left stage column, so the bar insets its left edge instead.
 *
 *  Measured, not tokens, for two reasons: the midi/mini row is content-sized, so the card's
 *  height changes when the transport row stacks (a resize, or a station hiding Repeat), and
 *  max's stage column is `minmax(0, --max-stage-w)`, so it is allowed to be narrower than
 *  the token. Mini's player view is the NP card alone — nothing to dodge, and the CSS
 *  excludes it (the owner's pick, 2026-09-17). The toast stack places itself the same way
 *  (src/toast.ts), including the excluded surfaces. */
function keepClearOfNp(panel: HTMLElement): () => void {
  const bar = panel.parentElement;                                  // the title bar
  const np = document.querySelector<HTMLElement>('[data-slot="np"]');
  if (!bar || !np) return () => {};
  const place = (): void => {
    const card = np.getBoundingClientRect();
    const top = bar.getBoundingClientRect();
    if (card.width <= 0 || card.height <= 0) {                      // no card: CSS falls back
      panel.style.removeProperty("--np-drop");
      panel.style.removeProperty("--np-right");
      return;
    }
    panel.style.setProperty("--np-drop", `${Math.max(0, Math.round(card.bottom - top.bottom))}px`);
    panel.style.setProperty("--np-right", `${Math.max(0, Math.round(card.right - top.left))}px`);
  };
  place();
  new ResizeObserver(place).observe(np);   // the card's own size: a stack, a surface open size
  window.addEventListener("resize", place);
  onSurfaceChange(place);                  // a flip moves the card before the window resizes
  return place;
}

export function initCompass(): void {
  panel = document.getElementById("compass");
  const trigger = document.getElementById("compass-open");
  if (!panel || !trigger) return;
  mark = trigger;
  panel.innerHTML =
    `<div class="compass__field"><span class="compass__mark">${COMPASS_GLYPH}</span>` +
    `<input class="compass__input" type="text" role="combobox" aria-expanded="true" aria-controls="compass-list" aria-autocomplete="list" ` +
    `placeholder="Go anywhere: a card, a setting, a song, an artist…" spellcheck="false" autocomplete="off" />` +
    `<span class="compass__side compass__esc">Esc</span></div>` +
    `<div class="compass__list" id="compass-list" role="listbox"></div>`;
  input = panel.querySelector<HTMLInputElement>(".compass__input");
  list = panel.querySelector<HTMLElement>(".compass__list");
  if (!input || !list) return;
  panel.dataset.frames = "compass";
  panel.style.setProperty("--pop-origin", "top center");
  const placeClear = keepClearOfNp(panel);

  // The panel is its own hover region (root): hover mode must never open it from the title
  // bar. The menu row is the trigger, so a click there toggles it like any title bar panel.
  handle = makeDropdown({
    root: panel,
    trigger,
    panel,
    // Settings › Window › Compass closes on outside click (default on).
    shouldStayOpen: (why) => why === "away" && !setting("compassCloseAway"),
    onOpen: () => {
      placeClear();     // fresh on every press: a transform (the boot arrival) moves the card without resizing it
      active = 0;
      kind = null;
      if (input) input.value = "";
      render();
      void playlistsCached().then((ps) => { playlists = ps; if (handle?.isOpen) render(); }).catch(() => {});
      enterRows(list!.children, 14);
      went = false;
      turnNeedle(180);
      diag.log("compass:open");
    },
  });
  // Focus goes back where it was when the bar closes (any way it closes). By the time the
  // observer runs, the hidden field may still hold the focus or may have dropped it to the
  // body; a focus the user moved elsewhere (a click on a card) is left alone.
  new MutationObserver(() => {
    if (!panel!.hidden) return;
    turnNeedle(went ? 180 : -180);   // on through the circle, or back the way it came
    went = false;
    const to = returnTo;
    returnTo = null;
    const now = document.activeElement;
    if (to && document.contains(to) && (now === document.body || panel!.contains(now))) to.focus({ preventScroll: true });
  }).observe(panel, { attributes: true, attributeFilter: ["hidden"] });

  input.addEventListener("input", () => { active = 0; kind = null; render(); }); // a new term: predict again
  input.addEventListener("keydown", (e) => {
    shiftHeld = e.shiftKey;
    // A card key printed on a row (Ctrl+L…): it acts like Enter on that row, in this
    // opening's shape. The global handler cannot — the field has the focus.
    if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
      const id = CARD_KEYS[e.key.toLowerCase()];
      if (id) {
        e.preventDefault();
        diag.log("compass:key", { key: e.key, card: id, shape: clampShape(shapeTab ?? "card") });
        openCard(id, clampShape(shapeTab ?? "card"));
        went = true;
        closeCompass();
        return;
      }
    }
    switch (e.key) {
      case "Tab": {
        // A row with its own options (grow): Tab moves between them. Else the filter row:
        // the next kind that has a match (Shift: the one before).
        const o = rows[active]?.options;
        if (o) {
          o.set((o.get() + (e.shiftKey ? o.labels.length - 1 : 1)) % o.labels.length);
          render();
          break;
        }
        if (!chips.length) return;
        const i = chips.findIndex((c) => c.group === shownKind);
        kind = chips[(i + (e.shiftKey ? chips.length - 1 : 1)) % chips.length].group;
        render();
        activateKind();
        break;
      }
      case "ArrowDown": setActive(active + 1); break;
      case "ArrowUp": setActive(active - 1); break;
      case "Home": if (!input!.value) setActive(0); else return; break;
      case "End": if (!input!.value) setActive(rows.length - 1); else return; break;
      case "PageDown": setActive(Math.min(rows.length - 1, active + 8)); break;
      case "PageUp": setActive(Math.max(0, active - 8)); break;
      case "Enter": runRow(active, e.ctrlKey); break;
      case "Escape":
        // Typed text clears first (the palette idiom); an empty field lets dropdown.ts close the panel.
        if (!input!.value) return;
        e.stopPropagation();
        input!.value = "";
        active = 0;
        kind = null;
        render();
        break;
      default: return;
    }
    e.preventDefault();
  });
  input.addEventListener("keyup", (e) => { shiftHeld = e.shiftKey; });

  list.addEventListener("pointermove", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".compass__row");
    if (row && Number(row.dataset.i) !== active) setActive(Number(row.dataset.i), false);
  });
  list.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const chip = t.closest<HTMLElement>("[data-kind]");
    if (chip) {
      kind = chip.dataset.kind as Group;
      render();
      activateKind();
      input?.focus();
      return;
    }
    const toggle = t.closest<HTMLElement>("[data-toggle]");
    if (toggle) { runRow(Number(toggle.dataset.toggle)); input?.focus(); return; }
    const choice = t.closest<HTMLElement>("[data-choice]");
    if (choice) {
      const r = rows[Number(choice.dataset.choice)];
      if (r?.control?.kind === "choice") { r.control.set(choice.dataset.value!); render(); }
      input?.focus();
      return;
    }
    const opt = t.closest<HTMLElement>("[data-opt]");
    if (opt) {
      rows[Number(opt.dataset.opt)]?.options?.set(Number(opt.dataset.j));
      render();
      input?.focus();
      return;
    }
    const alt = t.closest<HTMLElement>("[data-alt]");
    if (alt) { runRow(Number(alt.dataset.alt), true); return; }
    const row = t.closest<HTMLElement>(".compass__row");
    if (row) runRow(Number(row.dataset.i));
  });
  // A click in the bar's chrome keeps the field's focus (the caret must not leave).
  panel.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button, input")) return;
    e.preventDefault();
  });

  // A press outside closes it too (the setting above): the title bar's drag region takes the
  // mouse for the window drag and never sends the click the dropdown listens for.
  document.addEventListener("pointerdown", (e) => {
    if (!handle?.isOpen || !setting("compassCloseAway")) return;
    const t = e.target as Node | null;
    if (!t || panel!.contains(t) || trigger.contains(t)) return;
    handle.close();
  });

  // Ctrl+Space, and Ctrl+Shift+Space for a PC whose IME takes the first (COMPASS.md §1).
  // From a text field too: no field of ours uses Ctrl+Space, and the Search field is where
  // a person often is when they want to go somewhere else.
  // The same keys close the bar when it is open: the key that opens it also puts it away.
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || !e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    if (handle?.isOpen) closeCompass();
    else openCompass();
  });
}
