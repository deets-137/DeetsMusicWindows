// Pins (PINS.md) — an item you chose to keep in view: a playlist, a station, an album, an
// artist or a song. One `pins` table in the library database (library.rs), mirrored here
// as one in-memory map seeded at boot. Three cards draw a Pinned tile shelf of their own
// kinds at the top of their root (pin order, newest first); Home draws every pin as its
// fifth shelf, by plays (home.ts). A pin's key is the Home tile key, so the play log's
// `context` tag names it directly.
//
// The tile is built live where the app holds the item (the track store, the playlists
// cache), and from the pin's own JSON snapshot where it does not (a station, a song or an
// album off the library): a pin never needs a fetch to draw.

import { invoke } from "@tauri-apps/api/core";
import type { Track } from "./library";
import { artistDetail, materializeTrack, type Playlist, type Artist } from "./search";
import type { Station } from "./radio";
import type { MenuItem } from "./context-menu";
import { tracks as allTracks, addTransientTracks } from "./track-store";
import { playlistsCached, onPlaylistsChange } from "./playlists";
import { pid } from "./rewind";
import { songItem, albumItem, playlistItem, stationItem, artistItem, type HomeItem, type HomeKind } from "./home";
import { menuState, MENU_CHOSEN } from "./context-menu";
import { esc, runListAction } from "./collection-card";
import { setting } from "./settings-store";
import { sortByOrder, moveTo, onRowOrderChange } from "./row-order";
import type { DragRow } from "./row-drag";
import { playTracks, playStation } from "./player";
import { requestOpenPlaylist } from "./playlists";
import { requestLibraryDrill } from "./layout-bus";
import { mosaicHTML } from "./mosaic";
import * as diag from "./diag";

export type PinKind = HomeKind;

export interface Pin {
  key: string;
  kind: PinKind;
  data?: string | null;
  pinnedAt: number;
  /** What a click does (PINS.md §8). Absent = never chosen = the card's own rule. */
  act?: string | null;
}

/** The three verbs a pinned tile can carry. */
export type PinAct = "play" | "shuffle" | "open";

/** The pin glyph — Search's term pins and the grow bar draw the same one. */
export const ICON_PIN =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M12 14v7"/></svg>';

const pins = new Map<string, Pin>();
let ready = false;
const listeners = new Set<() => void>();
export function onPinsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const emit = () => listeners.forEach((cb) => cb());
// A hand order IS pin order (fork 12A), so a move — or a Reset that drops one — redraws
// every Pinned shelf through the listener the cards already have.
onRowOrderChange(() => emit());

/** The playlists the store cached, kept here so a pin resolves without an await. */
let playlists = new Map<string, Playlist>();
const refreshPlaylists = () =>
  playlistsCached()
    .then((ps) => {
      playlists = new Map(ps.map((p) => [pid(p), p]));
      if (ready) emit();
    })
    .catch((e) => console.warn("[pins] playlists", e));

/** Boot: the mirror. Cards subscribe and draw their shelf when it lands. */
export async function initPins(): Promise<void> {
  onPlaylistsChange(() => void refreshPlaylists());
  await Promise.all([
    invoke<Pin[]>("pins_list")
      .then((rows) => {
        pins.clear();
        for (const p of rows) pins.set(p.key, p);
      })
      .catch((e) => console.error("[pins] list", e)),
    refreshPlaylists(),
  ]);
  ready = true;
  emit();
}

export const isPinned = (key: string): boolean => pins.has(key);

/** Every pin in the order the cards show, or only the kinds asked for: the order you set
 *  by hand first (MOVABLE-ROWS.md fork 12A — it wins on every shelf, Home included), and
 *  under it, newest first, as it always was. A pin you never moved is unranked, so it
 *  keeps its newest-first place and sits after the ones you placed. */
export function pinsOf(kinds?: PinKind[]): Pin[] {
  const all = sortByOrder("pins", [...pins.values()].sort((a, b) => b.pinnedAt - a.pinnedAt), (p) => p.key);
  return kinds ? all.filter((p) => kinds.includes(p.kind)) : all;
}

/** A song's pin key — the same string Home gives its tile (home.ts `songItem`). */
export const songKey = (t: Track): string => `song:${t.catalogId ?? t.libraryId ?? t.title}`;

export async function setPin(key: string, kind: PinKind, data?: unknown): Promise<void> {
  // A NEW pin starts on the Settings default; Rust keeps an existing `act`, so a verb set
  // by hand survives a re-pin (PINS.md §8.4). A song and a station always play, so they
  // carry no verb at all.
  const act = hasAct(kind) ? setting("pinNewAct") : null;
  const row = await invoke<Pin>("pin_set", { key, kind, data: data == null ? null : JSON.stringify(data), act });
  pins.set(row.key, row);
  diag.log("pin:set", { key, act: row.act ?? null });
  emit();
}

// ── On Click (PINS.md §8) ─────────────────────────────────────────────────────

/** Is this kind offered the On Click row? A song has one song, and a station is a stream
 *  Apple shuffles — both always play, so neither is asked (fork 5). */
export const hasAct = (kind: PinKind): boolean => kind === "album" || kind === "artist" || kind === "playlist";

/** What a click on this pin does: the verb it carries, else its card's own rule. Every pin
 *  made before v12 has no verb, which is why nothing changed on update day (§8.2a). */
export function pinAct(key: string, kind: PinKind): PinAct {
  if (!hasAct(kind)) return "play";
  const a = pins.get(key)?.act;
  return a === "play" || a === "shuffle" || a === "open" ? a : "open";
}

/** Set what a click does. */
export async function setPinAct(key: string, act: PinAct): Promise<void> {
  await invoke<boolean>("pin_act", { key, act });
  const p = pins.get(key);
  if (p) pins.set(key, { ...p, act });
  diag.log("pin:act", { key, act });
  emit();
}

/** The On Click row: the three verbs, the current one ticked. Null for a kind that is not
 *  asked, and for a key that is not pinned (the row belongs to the pin, not the item). */
export function pinActItem(key: string, kind: PinKind): MenuItem | null {
  if (!hasAct(kind) || !pins.has(key)) return null;
  const now = pinAct(key, kind);
  const verb = (act: PinAct, label: string) => ({
    label,
    badge: now === act ? MENU_CHOSEN : "",
    run: () => void setPinAct(key, act).catch((e) => console.error("[pins] act", e)),
  });
  return {
    label: "On Click",
    badge: menuState(now === "play" ? "Play" : now === "shuffle" ? "Shuffle" : "Open"),
    sub: () => [verb("play", "Play"), verb("shuffle", "Shuffle"), verb("open", "Open")],
  };
}

/** How the card that owns this tile opens an item in place. A card that cannot open a kind
 *  leaves its handler out, and the hop to the card that CAN takes over — which is what
 *  Home does for every kind, having no detail of its own. */
export interface PinNav {
  openAlbum?: (t: Track) => void;
  openArtist?: (name: string) => void;
  openPlaylist?: (p: Playlist) => void;
}

/** A click on a pinned tile, everywhere. This is the one rule: it replaced four
 *  hand-written shelf bodies that had drifted into two different answers (§8.1). */
export function pinActivate(it: HomeItem, at: string, nav?: PinNav): void {
  const act = pinAct(it.key, it.kind);
  // The click trail (LOGGING.md §The click trail): a complaint about this is read, not
  // guessed — which tile, and which verb it ran.
  diag.log("ui:act", { at, do: "pin", kind: it.kind, act });
  const err = (what: string) => (e: unknown) => console.error(`[pins] ${what}`, e);

  // A station is a stream: it plays, whatever anything says (fork 5).
  if (it.kind === "station" && it.station) {
    void playStation(it.station).catch(err("play station"));
    return;
  }

  if (act === "open") {
    if (it.kind === "playlist" && it.playlist) {
      if (nav?.openPlaylist) nav.openPlaylist(it.playlist);
      else if (it.playlist.libraryId) requestOpenPlaylist(it.playlist.libraryId);
      return;
    }
    if (it.kind === "artist") {
      if (nav?.openArtist) nav.openArtist(it.title);
      else requestLibraryDrill({ kind: "artist", name: it.title });
      return;
    }
    if (it.kind === "album") {
      const known = it.tracks();
      const seed = Array.isArray(known) ? known[0] : undefined;
      // An album the library does not hold has nothing to drill into: it plays, whole —
      // the exception the Library shelf already made (§8.4).
      if (seed && !it.whole) {
        if (nav?.openAlbum) nav.openAlbum(seed);
        else requestLibraryDrill({ kind: "album", track: seed });
        return;
      }
    }
    // Every other Open falls through to Play: a song, or an item with no view to open.
  }

  void (it.whole?.() ?? Promise.resolve(it.tracks()))
    .then((ts) => {
      if (!ts.length) return;
      // The house rule (§8.1 fact 3): Shuffle plays a shuffled COPY, and with "Shuffle
      // button stays on" it turns the mode on, exactly as a card's Shuffle button does.
      runListAction(act === "shuffle" ? "shuffle" : "play", ts, (list) => void playTracks(list, 0, it.context).catch(err("play")));
    })
    .catch(err("activate"));
}

export async function clearPin(key: string): Promise<void> {
  await invoke<boolean>("pin_clear", { key });
  if (pins.delete(key)) {
    diag.log("pin:clear", { key });
    emit();
  }
}

export const togglePin = (key: string, kind: PinKind, data?: unknown): Promise<void> =>
  pins.has(key) ? clearPin(key) : setPin(key, kind, data);

/** The one menu row every card adds: `Pin`, or `Unpin` when it is. `data` is the JSON
 *  snapshot for a kind with no local store (a station; a song, so one from Search draws). */
export function pinItem(key: string, kind: PinKind, data?: unknown): MenuItem {
  const on = pins.has(key);
  return {
    label: on ? "Unpin" : "Pin",
    run: () => void togglePin(key, kind, data).catch((e) => console.error("[pins] toggle", e)),
  };
}

/** The pin rows a menu adds: **On Click** (only when the item is pinned and its kind is
 *  asked), then Pin / Unpin — which stays the LAST row of every menu (§7). */
export function pinRows(key: string, kind: PinKind, data?: unknown): MenuItem[] {
  const act = pinActItem(key, kind);
  return act ? [act, pinItem(key, kind, data)] : [pinItem(key, kind, data)];
}

/** `pinArtistItem` with its On Click row. */
export const pinArtistRows = (a: Artist): MenuItem[] =>
  pinRows(`artist:${a.name}`, "artist", { name: a.name, artwork: a.artwork, catalogId: a.catalogId });

/** `pinItemFor` with its On Click row (empty when the list has no pin of its own). */
export function pinRowsFor(items: Track[], context?: string): MenuItem[] {
  if (context?.startsWith("album:")) return pinRows(context, "album", items);
  if (context?.startsWith("artist:")) return pinRows(context, "artist");
  if (items.length === 1) return pinRows(songKey(items[0]), "song", items[0]);
  return [];
}

/** The pin row for an artist known by name and catalog id (a Search result, the artist
 *  pane, the Library artist view): the snapshot lets an artist off the library draw. */
export const pinArtistItem = (a: Artist): MenuItem =>
  pinItem(`artist:${a.name}`, "artist", { name: a.name, artwork: a.artwork, catalogId: a.catalogId });

/** The pin row for a song menu (`trackMenu`, library-card.ts), read from the list's queue
 *  context: an album's or an artist's list pins that container; a single song pins the song.
 *  Null for a list the pin has no name for (a genre, a picked set, a playlist's rows). */
export function pinItemFor(items: Track[], context?: string): MenuItem | null {
  // An album's songs ride the pin: an album not in your library (played from Search, or on
  // your phone) has no other record here, and the tile must still draw and play.
  if (context?.startsWith("album:")) return pinItem(context, "album", items);
  if (context?.startsWith("artist:")) return pinItem(context, "artist");
  if (items.length === 1) return pinItem(songKey(items[0]), "song", items[0]);
  return null;
}

/** Plays per pin key, all time (fork 5). */
export const pinPlayCounts = (keys: string[]): Promise<Map<string, number>> =>
  keys.length
    ? invoke<[string, number][]>("pin_play_counts", { keys }).then((rows) => new Map(rows))
    : Promise.resolve(new Map());

// ── tiles ─────────────────────────────────────────────────────────────────────

const parse = <T,>(json: string | null | undefined): T | null => {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
};

/** The tile for one pin, built live; null when the item is gone and no snapshot holds it. */
export function pinTile(p: Pin): HomeItem | null {
  const id = p.key.slice(p.key.indexOf(":") + 1);
  switch (p.kind) {
    case "song": {
      const live = allTracks().find((t) => songKey(t) === p.key);
      const t = live ?? parse<Track>(p.data);
      return t ? songItem(t) : null;
    }
    case "album":
      return albumItem(id, parse<Track[]>(p.data) ?? []);
    case "artist":
      return artistItem(id) ?? artistSnapshotTile(parse<Artist>(p.data));
    case "playlist": {
      const pl = playlists.get(id);
      return pl ? playlistItem(pl) : null;
    }
    case "station": {
      const s = parse<Station>(p.data);
      return s ? stationItem(s) : null;
    }
  }
  return null;
}

/** An artist the library does not hold: the tile from the pin's snapshot; a press plays
 *  Apple's top songs for them (one memoized catalog read), made playable as Search does. */
function artistSnapshotTile(a: Artist | null): HomeItem | null {
  if (!a?.name) return null;
  const whole = async (): Promise<Track[]> => {
    if (!a.catalogId) return [];
    const d = await artistDetail(a.catalogId);
    addTransientTracks(d.topSongs);
    d.topSongs.forEach(materializeTrack);
    return d.topSongs;
  };
  return {
    key: `artist:${a.name}`,
    kind: "artist",
    title: a.name,
    sub: "Artist",
    art: a.artwork,
    round: true,
    context: `artist:${a.name}`,
    tracks: () => [],
    whole,
  };
}

/** The pinned tiles of these kinds, in pin order, ready for a shelf. */
export function pinnedItems(kinds?: PinKind[]): HomeItem[] {
  return pinsOf(kinds).map(pinTile).filter((x): x is HomeItem => !!x);
}

const artURL = (it: HomeItem, px: number): string | null =>
  it.art?.urlTemplate ? it.art.urlTemplate.replace("{w}", String(px)).replace("{h}", String(px)).replace("{f}", "jpg") : null;

function tileArt(it: HomeItem): string {
  const round = it.round ? " search__tile-art--round" : "";
  const url = artURL(it, 192);
  if (url) return `<img class="search__tile-art${round}" src="${esc(url)}" alt="" loading="lazy" decoding="async" />`;
  if (it.mosaic?.length) return mosaicHTML("search__tile-art", it.mosaic, it.mosaicSeed ?? it.key);
  return `<div class="search__tile-art search__tile-art--empty${round}" aria-hidden="true">♪</div>`;
}

/** The corner mark on a pinned tile (the *tile badge* family, UI-ARCHITECTURE.md §2a). It is
 *  a real button — a press unpins (owner, 2026-09-18: a mark that looks pressable must be).
 *  Every click listener over tiles calls `handleUnpin` first. */
export const pinBadgeHTML = (key: string): string =>
  `<button class="search__tile-badge" type="button" data-unpin="${esc(key)}" aria-label="Unpin" title="Unpin">${ICON_PIN}</button>`;

/** A click on a tile's badge: unpin, and keep the tile's own press from firing. True when
 *  the event was the badge's. */
export function handleUnpin(e: Event): boolean {
  const t = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>("[data-unpin]") : null;
  if (!t?.dataset.unpin) return false;
  e.preventDefault();
  e.stopPropagation();
  void clearPin(t.dataset.unpin).catch((err) => console.error("[pins] unpin", err));
  return true;
}

/** One tile in a card's Pinned shelf. `data-shelf-item` routes its click and right-click to
 *  the card's `onShelf` / `shelfMenu` (collection-card.ts); `data-key` is the pin. */
const shelfTileHTML = (it: HomeItem, i: number): string =>
  `<div class="search__tile" data-shelf-item="pin" data-pin-idx="${i}" data-key="${esc(it.key)}" role="button" tabindex="0" title="${esc(it.title)}">` +
  `${tileArt(it)}${pinBadgeHTML(it.key)}${PIN_GRIP}<span class="search__tile-name">${esc(it.title)}</span>` +
  `<span class="search__tile-sub">${esc(it.sub)}</span></div>`;

/** A card's Pinned shelf: the tiles under no label (the badge says it), a hairline under
 *  them, and "" with nothing pinned so the card is exactly what it was (fork 8). */
export function pinnedShelfHTML(kinds: PinKind[]): string {
  const items = pinnedItems(kinds);
  if (!items.length) return "";
  return `<div class="lib-shelves lib-shelves--pins"><div class="search__scroller">${items.map(shelfTileHTML).join("")}</div></div>`;
}

// ── moving a pinned tile (MOVABLE-ROWS.md §5.2) ───────────────────────────────
// A tile press already carries its songs to another card (DRAG-DROP.md §2), and a tile has
// no header to hold. So the tile grows its own grip: a bar over the left of the cover,
// three dots, shown on hover or keyboard focus (the owner, 2026-09-20). Press the bar and
// the tile slides along its shelf; press anywhere else and nothing at all has changed.

/** The grip bar. `aria-hidden`: the tile is one control, and the bar is a handle on it. */
export const PIN_GRIP =
  '<span class="tile-grip" data-pin-grip title="Drag to move this pinned item"><i></i><i></i><i></i></span>';

/** The drag a press on a grip starts, or null when the press was somewhere else. Every
 *  card that draws pinned tiles hands its `rowAt` through this first. */
export function pinDragRow(target: HTMLElement): DragRow | null {
  const grip = target.closest<HTMLElement>("[data-pin-grip]");
  if (!grip) return null;
  const tile = grip.closest<HTMLElement>("[data-pin-idx]");
  const list = tile?.parentElement;
  if (!tile || !list || !tile.dataset.key) return null;
  const keys = [...list.querySelectorAll<HTMLElement>("[data-pin-idx]")]
    .map((el) => el.dataset.key ?? "")
    .filter(Boolean);
  const key = tile.dataset.key;
  return {
    row: tile,
    index: Number(tile.dataset.pinIdx),
    list,
    count: keys.length,
    axis: "x", // a shelf runs sideways: an upright line, and sideways auto-scroll
    measure: true,
    sel: "[data-pin-idx]",
    done: (to) => {
      if (to != null) void moveTo("pins", keys, key, to);
    },
  };
}

/** A click that landed on a grip is the grip's: the tile must not act. */
export const isPinGrip = (e: Event): boolean =>
  e.target instanceof HTMLElement && !!e.target.closest("[data-pin-grip]");

/** The tile a shelf event landed on, resolved back to its item. */
export function pinShelfItem(el: HTMLElement): HomeItem | null {
  const key = el.dataset.key;
  const p = key ? pins.get(key) : undefined;
  return p ? pinTile(p) : null;
}
