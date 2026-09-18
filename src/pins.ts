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
import { esc } from "./collection-card";
import { mosaicHTML } from "./mosaic";
import * as diag from "./diag";

export type PinKind = HomeKind;

export interface Pin {
  key: string;
  kind: PinKind;
  data?: string | null;
  pinnedAt: number;
}

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

/** Every pin, newest first (the cards' order), or only the kinds asked for. */
export function pinsOf(kinds?: PinKind[]): Pin[] {
  const all = [...pins.values()].sort((a, b) => b.pinnedAt - a.pinnedAt);
  return kinds ? all.filter((p) => kinds.includes(p.kind)) : all;
}

/** A song's pin key — the same string Home gives its tile (home.ts `songItem`). */
export const songKey = (t: Track): string => `song:${t.catalogId ?? t.libraryId ?? t.title}`;

export async function setPin(key: string, kind: PinKind, data?: unknown): Promise<void> {
  const row = await invoke<Pin>("pin_set", { key, kind, data: data == null ? null : JSON.stringify(data) });
  pins.set(row.key, row);
  diag.log("pin:set", { key });
  emit();
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
const shelfTileHTML = (it: HomeItem): string =>
  `<div class="search__tile" data-shelf-item="pin" data-key="${esc(it.key)}" role="button" tabindex="0" title="${esc(it.title)}">` +
  `${tileArt(it)}${pinBadgeHTML(it.key)}<span class="search__tile-name">${esc(it.title)}</span>` +
  `<span class="search__tile-sub">${esc(it.sub)}</span></div>`;

/** A card's Pinned shelf: the tiles under no label (the badge says it), a hairline under
 *  them, and "" with nothing pinned so the card is exactly what it was (fork 8). */
export function pinnedShelfHTML(kinds: PinKind[]): string {
  const items = pinnedItems(kinds);
  if (!items.length) return "";
  return `<div class="lib-shelves lib-shelves--pins"><div class="search__scroller">${items.map(shelfTileHTML).join("")}</div></div>`;
}

/** The tile a shelf event landed on, resolved back to its item. */
export function pinShelfItem(el: HTMLElement): HomeItem | null {
  const key = el.dataset.key;
  const p = key ? pins.get(key) : undefined;
  return p ? pinTile(p) : null;
}
