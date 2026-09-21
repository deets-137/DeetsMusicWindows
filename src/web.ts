// The playlist web (docs/features/PLAYLIST-WEB.md): the Playlists card's web button opens a panel
// that builds a playlist from one artist and the artists they make songs with.
//
// Rust (`web_build`, web.rs) reads the artists and returns candidate songs with their degree.
// Everything after that — the genre chips, the size cap, the order — happens here, so a
// chip or a size press never calls Apple. Rust saves every artist it read, so a bigger reach
// reads only the new degree.
//
// The field is a search, not free text: it lists your library's artists, songs or albums (the
// Artist · Song · Album row picks which) and the seeds you built webs from (zero calls), and its
// last row, "Search Apple Music", is the only way to a catalog search. A web starts only from a
// picked row. A song or album seed leads the playlist and picks its genre chips (§9).
//
// Apple calls per panel use: one artist search (only from that row) and one build
// per artist or reach change. Rust saves every artist read (web_artists), so a build of a web
// read before is zero calls until the saves age out or you press Read again.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { makeDropdown } from "./dropdown";
import { enterRows } from "./pop";
import { searchCatalog, type Album, type Artist, type SearchResults, type SearchType } from "./search";
import { playlistCreate, playlistAddTracks, requestOpenPlaylist } from "./playlists";
import { requestCard } from "./layout-bus";
import { setting, setSetting, onSettingsChange } from "./settings-store";
import { esc } from "./collection-card";
import { toast } from "./toast";
import { handOff } from "./handoff";
import { tokenMs } from "./boot-cover";
import * as frames from "./frames";
import * as diag from "./diag";
import type { Artwork, Track } from "./library";
import { tracks } from "./track-store";
import { creditIndex } from "./artist-credit";
import { albumKey } from "./rewind";
import { APPLE_SIGIL } from "./apple-sigil";

interface WebSong {
  track: Track;
  degree: number;
  artistId: string;
  seed: boolean;
  /** The seed song itself, or a song of the seed album: it leads the playlist (§9). */
  anchor: boolean;
  /** What you already have: 3 ♥, 2 played, 1 in your library, 0 new to you. */
  mine: number;
}
interface WebArtist {
  id: string;
  name: string;
  degree: number;
}
type SeedKind = "artist" | "song" | "album";
/** Where a web starts (web.rs `WebSeed`). A library album has no catalog id: `songId` finds it. */
type WebSeed = { kind: "artist"; artist: Artist } | { kind: "song"; track: Track } | { kind: "album"; album: Album; songId?: string };
interface WebResult {
  kind: SeedKind;
  /** The seed artist; for a song or an album, its artist line. */
  seed: Artist;
  /** The song's or album's genres: picked for a new seed. */
  genres: string[];
  artists: WebArtist[];
  songs: WebSong[];
  calls: number;
  /** Artists whose read failed; building again reads only these. */
  failed: number;
  /** Epoch-ms of the oldest saved read in this web. */
  oldest: number;
}
export type WebPrefer = "familiar" | "discover" | "mix";
/** What a picked genre does to the artist's own songs: filter them, filter them but keep at
 *  least SEED_FLOOR, or leave them all. */
export type WebSeedFilter = "all" | "floor" | "off";

const KINDS: { value: SeedKind; label: string }[] = [
  { value: "artist", label: "Artist" },
  { value: "song", label: "Song" },
  { value: "album", label: "Album" },
];
/** An album starts with many artists: its web reaches 2 at most (user's call 2026-09-17). */
const ALBUM_MAX_REACH = 2;
/** A temporary web playlist's days (PLAYLIST-WEB.md §10.4): a press on the days button moves
 *  right, a right-click moves left, both round. */
const TEMP_DAYS = [1, 3, 5, 7, 30] as const;
type TempDays = (typeof TEMP_DAYS)[number];
const dayLabel = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
/** Up to this many picked genres go into the default playlist name ("V (Deluxe) Reggae Web"). */
const NAME_GENRES = 2;
const REACHES = [1, 2, 3] as const;
const SIZES = [25, 50, 100] as const;
const PREFERS: { value: WebPrefer; label: string }[] = [
  { value: "familiar", label: "Familiar" },
  { value: "discover", label: "Discover" },
  { value: "mix", label: "Mix" },
];
const DAY_MS = 24 * 60 * 60 * 1000;
/** "Keep 5": the artist's songs a genre filter never goes below. */
const SEED_FLOOR = 5;
const MAX_HITS = 5;

// ── A web asked for from outside (the Compass, COMPASS.md §2b): no panel ──
// The seed is found (the library first, then Apple), the web is built at the asked reach,
// the asked genres are pressed, the songs are picked by the Settings the panel uses, the
// playlist is made, and the caller's element flies to the Playlists card as the chip.
export interface WebRequest {
  kind?: SeedKind;
  term: string;
  /** This web's reach; absent = Settings › Web reach. Never written to the setting. */
  reach?: 1 | 2 | 3;
  /** Genre phrases to press, matched by prefix, case-insensitive ("r&b" presses "R&B/Soul"). */
  genres?: string[];
}
/** The seed for a request: the best library match of the kind (or of any kind: artist, then
 *  song, then album), else Apple's first answer for the kind (artist when none). */
async function quickSeed(r: WebRequest): Promise<WebSeed | null> {
  const needle = r.term.toLowerCase();
  const best = <T>(list: T[], name: (x: T) => string): T | null => {
    let top: { x: T; rank: number } | null = null;
    for (const x of list) {
      const rank = matchRank(name(x), needle);
      if (rank >= 0 && (!top || rank < top.rank)) top = { x, rank };
    }
    return top?.x ?? null;
  };
  const kinds: SeedKind[] = r.kind ? [r.kind] : ["artist", "song", "album"];
  for (const k of kinds) {
    if (k === "artist") {
      const lib = best(libraryArtists(), (a) => a.name);
      if (lib) {
        if (lib.songId) {
          const info = await invoke<{ catalogId?: string; artwork?: Artwork } | null>("library_artist_info", { name: lib.name, songId: lib.songId, featured: false }).catch(() => null);
          if (info?.catalogId) return { kind: "artist", artist: { name: lib.name, catalogId: info.catalogId, artwork: info.artwork ?? lib.cover } };
        }
        const r2 = await searchOnce(lib.name, "artists");
        const same = r2.artists.find((a) => a.catalogId && a.name.toLowerCase() === lib.name.toLowerCase()) ?? r2.artists.find((a) => a.catalogId);
        if (same) return { kind: "artist", artist: same };
      }
    } else if (k === "song") {
      const t = best(tracks().filter((x) => x.catalogId), (x) => x.title);
      if (t) return { kind: "song", track: t };
    } else {
      const lib = best(libraryAlbums(), (a) => a.title);
      if (lib) return { kind: "album", album: { title: lib.title, artistName: lib.artistName, artwork: lib.cover, genres: lib.genres }, songId: lib.songId };
    }
  }
  const k = r.kind ?? "artist";
  const res = await searchOnce(r.term, k === "artist" ? "artists" : k === "song" ? "songs" : "albums");
  if (k === "artist") { const a = res.artists.find((x) => x.catalogId); return a ? { kind: "artist", artist: a } : null; }
  if (k === "song") { const t = res.songs.find((x) => x.catalogId); return t ? { kind: "song", track: t } : null; }
  const a = res.albums.find((x) => x.catalogId);
  return a ? { kind: "album", album: a } : null;
}

/** Make a web playlist from a request with no panel. `status` gets the step under way;
 *  `chip` (the Compass row) flies to the Playlists card, which opens the playlist. Throws
 *  with a plain message when nothing could be made. */
export async function webQuick(r: WebRequest, status: (text: string) => void, chip: () => HTMLElement | null): Promise<void> {
  status("Finding the start…");
  const seed = await quickSeed(r);
  if (!seed) throw new Error(`Nothing found for “${r.term}”`);
  const wanted = r.reach ?? setting("webReach");
  const reach = seed.kind === "album" ? Math.min(ALBUM_MAX_REACH, wanted) : wanted;
  status(`Reading the web of ${seedName(seed)}…`);
  const res = await invoke<WebResult>("web_build", { seed, reach, fresh: false });
  const have = new Set(res.songs.flatMap((s) => s.track.genres));
  const want = (r.genres ?? []).map((g) => g.trim().toLowerCase()).filter(Boolean);
  let picked = new Set([...have].filter((g) => want.some((w) => g.toLowerCase().startsWith(w) || g.toLowerCase().includes(w))));
  // A song or album seed picks its own genres, as the panel does (§9.1).
  if (!picked.size && seed.kind !== "artist") picked = new Set(res.genres.filter((g) => !NOT_A_GENRE.has(g) && have.has(g)));
  const list = pickSongs(res, picked, setting("webSize"), setting("webPrefer"), setting("webSeedFilter"));
  if (!list.length) throw new Error("The web had no songs to pick");
  const genres = picked.size <= NAME_GENRES ? [...picked].join(" & ") : "";
  const name = `${seedName(seed)}${genres ? ` ${genres}` : ""} Web`;
  const expireDays = setting("webTempDays"); // every new web starts on Temp, as the panel does
  status("Making the playlist…");
  const id = await playlistCreate(name, undefined, expireDays);
  await playlistAddTracks(id, list);
  diag.log("web:expiry", { arm: id, days: expireDays });
  diag.log("web:make", { kind: res.kind, seed: seedName(seed), expireDays, songs: list.length, genres: [...picked], prefer: setting("webPrefer"), from: "compass", reach });
  const open = () => requestOpenPlaylist(`local:${id}`, list);
  const el = chip();
  if (el) handOff(el, "playlists", () => Promise.resolve(list), open, list.length, true);
  else { requestCard("playlists"); open(); }
}

/** The panel's Apple searches, by kind and text, until the app closes: the same search again
 *  (another kind and back, the panel closed and opened) costs 0 calls. A failure is forgotten. */
const searchMemo = new Map<string, Promise<SearchResults>>();
function searchOnce(term: string, type: SearchType): Promise<SearchResults> {
  const key = `${type}:${term.toLowerCase()}`;
  let p = searchMemo.get(key);
  if (!p) {
    p = searchCatalog(term, [type]);
    p.catch(() => searchMemo.delete(key));
    searchMemo.set(key, p);
  }
  return p;
}
const MAX_CHIPS = 10;
/** Genre names that say nothing about the sound. */
const NOT_A_GENRE = new Set(["Music"]);

/** A web of circles and lines (the user's sketch, 2026-09-16): a hub, four nodes of
 *  different sizes, and one long line that crosses the web. Lines stop short of the rings. */
const NODES: [number, number, number][] = [
  [6.5, 6, 2.6], // 0 top left
  [18.5, 7, 2.2], // 1 top right
  [9.5, 16, 2.3], // 2 the hub
  [3.5, 20, 1.6], // 3 bottom left
  [19.5, 20.5, 2], // 4 bottom right
];
const EDGES: [number, number][] = [[0, 4], [1, 2], [2, 3], [2, 4]];
const GAP = 1.3;

function iconSvg(): string {
  const lines = EDGES.map(([a, b]) => {
    const [x1, y1, r1] = NODES[a];
    const [x2, y2, r2] = NODES[b];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const f = (n: number) => n.toFixed(2);
    return `M${f(x1 + ux * (r1 + GAP))} ${f(y1 + uy * (r1 + GAP))}L${f(x2 - ux * (r2 + GAP))} ${f(y2 - uy * (r2 + GAP))}`;
  }).join("");
  const rings = NODES.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join("");
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${lines}"/>${rings}</svg>`;
}

const art = (a: Artwork | undefined, px: number): string =>
  a?.urlTemplate ? a.urlTemplate.replace("{w}", String(px)).replace("{h}", String(px)).replace("{f}", "jpg") : "";

/** One of your library's artists, as the Library card groups them (artist-credit.ts). */
interface LibArtist {
  name: string;
  songs: number;
  /** A song this artist leads — its Apple artist is this artist (`library_artist_info`). */
  songId?: string;
  /** An album cover, until a photo is known. */
  cover?: Artwork;
}
const libMemo = new WeakMap<Track[], LibArtist[]>();
function libraryArtists(): LibArtist[] {
  const list = tracks();
  const hit = libMemo.get(list);
  if (hit) return hit;
  const idx = creditIndex(list);
  const map = new Map<string, LibArtist>();
  for (const t of list) {
    idx.namesOf(t).forEach((name, i) => {
      let a = map.get(name);
      if (!a) map.set(name, (a = { name, songs: 0 }));
      a.songs++;
      if (!a.cover && t.artwork) a.cover = t.artwork;
      if (i === 0 && !a.songId && t.catalogId) a.songId = t.catalogId; // the lead credit only
    });
  }
  const out = [...map.values()].filter((a) => a.name);
  libMemo.set(list, out);
  return out;
}

const seedName = (s: WebSeed): string => (s.kind === "artist" ? s.artist.name : s.kind === "song" ? s.track.title : s.album.title);
/** The artist line under a song or album row ("" for an artist). */
const seedLine = (s: WebSeed): string => (s.kind === "artist" ? "" : s.kind === "song" ? s.track.artistName : s.album.artistName);
const seedArt = (s: WebSeed): Artwork | undefined => (s.kind === "artist" ? s.artist.artwork : s.kind === "song" ? s.track.artwork : s.album.artwork);
const seedMatchKey = (s: WebSeed): string => `${seedName(s)}|${seedLine(s)}`.toLowerCase();

/** One of your library's albums: its songs grouped as Rewind and Home group them (`albumKey`). */
interface LibAlbum {
  title: string;
  artistName: string;
  cover?: Artwork;
  genres: string[];
  songs: number;
  /** One of its songs' catalog ids: Apple finds the album through it. */
  songId: string;
}
const albumMemo = new WeakMap<Track[], LibAlbum[]>();
function libraryAlbums(): LibAlbum[] {
  const list = tracks();
  const hit = albumMemo.get(list);
  if (hit) return hit;
  const groups = new Map<string, Track[]>();
  for (const t of list) {
    if (!t.albumName) continue;
    const k = albumKey(t);
    const g = groups.get(k);
    if (g) g.push(t);
    else groups.set(k, [t]);
  }
  const out: LibAlbum[] = [];
  for (const g of groups.values()) {
    const withId = g.find((t) => t.catalogId);
    if (!withId) continue; // uploaded files: Apple cannot find the album
    // The artist line most of its songs carry (Apple's own album artist replaces it on build).
    const lines = new Map<string, number>();
    for (const t of g) lines.set(t.artistName, (lines.get(t.artistName) ?? 0) + 1);
    const artistName = [...lines].sort((a, b) => b[1] - a[1])[0][0];
    out.push({ title: withId.albumName!, artistName, cover: g.find((t) => t.artwork)?.artwork, genres: withId.genres, songs: g.length, songId: withId.catalogId! });
  }
  albumMemo.set(list, out);
  return out;
}

/** How well a name matches what was typed: 0 starts with it, 1 a word starts with it,
 *  2 contains it, -1 no match. */
function matchRank(name: string, needle: string): number {
  const n = name.toLowerCase();
  if (n.startsWith(needle)) return 0;
  if (n.split(/[\s&,.(/-]+/).some((w) => w.startsWith(needle))) return 1;
  return n.includes(needle) ? 2 : -1;
}

type Row =
  | { kind: "library"; lib: LibArtist }
  | { kind: "libsong"; track: Track }
  | { kind: "libalbum"; lib: LibAlbum }
  | { kind: "seed"; seed: WebSeed }
  | { kind: "apple"; seed: WebSeed }
  | { kind: "search"; term: string };

const SEARCH_GLYPH =
  '<svg class="web__hit-glyph" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>';

/** Pick and order the songs (PLAYLIST-WEB.md §4). The seed's songs fill at most half; the web
 *  fills the rest nearest degree first, one artist at a time. Picked genres filter the web, and
 *  the seed's songs as `seedFilter` says. */
export function pickSongs(r: WebResult, genres: Set<string>, size: number, prefer: WebPrefer, seedFilter: WebSeedFilter): Track[] {
  // A song seed is track 1 whatever the chips say (you picked it); the rest fills after it.
  const pinned = r.kind === "song" ? r.songs.filter((s) => s.anchor) : [];
  const full = size;
  size = Math.max(0, full - pinned.length);
  // Familiar: what you ♥, played or saved first. Discover: what you don't have first. The sort
  // is stable, so Apple's order (top songs first) holds inside each level.
  const lean = (list: WebSong[]) =>
    prefer === "mix" ? list : [...list].sort((a, b) => (prefer === "familiar" ? b.mine - a.mine : Math.sign(a.mine) - Math.sign(b.mine)));
  const fits = (s: WebSong) => !genres.size || s.track.genres.some((g) => genres.has(g));
  // An album's songs lead the seed half, each group sorted by Prefer on its own.
  const allSeed = [...lean(r.songs.filter((s) => s.anchor && r.kind !== "song")), ...lean(r.songs.filter((s) => s.seed && !s.anchor))];
  let seedSongs = seedFilter === "off" ? allSeed : allSeed.filter(fits);
  // Keep 5: a genre that fits few of the artist's songs tops them up with their best others.
  if (seedFilter === "floor" && seedSongs.length < SEED_FLOOR) {
    const kept = new Set(seedSongs);
    seedSongs = [...seedSongs, ...allSeed.filter((s) => !kept.has(s)).slice(0, SEED_FLOOR - seedSongs.length)];
  }
  const web = lean(r.songs.filter((s) => !s.seed && fits(s)));
  const byArtist = new Map<string, WebSong[]>();
  for (const s of web) {
    const list = byArtist.get(s.artistId);
    if (list) list.push(s);
    else byArtist.set(s.artistId, [s]);
  }
  const webTake: WebSong[] = [];
  const room = () => size - Math.min(seedSongs.length, Math.ceil(size / 2)) - webTake.length;
  const degrees = [...new Set(r.artists.map((a) => a.degree))].filter((d) => d > 0).sort((a, b) => a - b);
  for (const d of degrees) {
    const queues = r.artists.filter((a) => a.degree === d).map((a) => [...(byArtist.get(a.id) ?? [])]);
    while (room() > 0 && queues.some((q) => q.length)) {
      for (const q of queues) {
        if (room() <= 0) break;
        const s = q.shift();
        if (s) webTake.push(s);
      }
    }
    if (room() <= 0) break;
  }
  // A thin web leaves room: the seed's songs fill it.
  const seedTake = seedSongs.slice(0, size - webTake.length);
  // Alternate the seed and the web, spread evenly when one side is longer.
  const out: Track[] = pinned.map((s) => s.track);
  const total = seedTake.length + webTake.length;
  let i = 0;
  let j = 0;
  for (let k = 0; k < total; k++) {
    const seedDue = j >= webTake.length || (i < seedTake.length && i * webTake.length <= j * seedTake.length);
    out.push(seedDue ? seedTake[i++].track : webTake[j++].track);
  }
  return out.slice(0, full);
}

/** Mount the web button's panel. Returns a teardown for the card's destroy. */
export function mountWeb(btn: HTMLElement): () => void {
  btn.innerHTML = iconSvg();
  btn.setAttribute("aria-haspopup", "dialog");
  btn.setAttribute("aria-expanded", "false");

  const panel = document.createElement("div");
  panel.className = "web pop";
  panel.dataset.frames = "web";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Playlist web");
  panel.innerHTML = `
    <div class="web__title">Playlist web</div>
    <div class="web__row" title="Start the web from an artist, a song or an album">
      <span class="web__label">Start</span>
      <div class="web__seg" data-seg="kind">${KINDS.map((o) => `<button class="web__opt" type="button" data-value="${o.value}" aria-pressed="false">${o.label}</button>`).join("")}</div>
    </div>
    <input class="web__input" data-artist type="text" placeholder="Find an artist" spellcheck="false" autocomplete="off"
      role="combobox" aria-expanded="false" aria-controls="web-hits" aria-autocomplete="list"
      title="Finds an artist in your library, or searches Apple Music" />
    <div class="web__hits" id="web-hits" role="listbox" aria-label="Seeds" hidden></div>
    <div class="web__row" title="1 reaches the artist's collaborators. Each step reaches one circle further">
      <span class="web__label">Reach</span>
      <div class="web__seg" data-seg="reach">${REACHES.map((n) => `<button class="web__opt" type="button" data-value="${n}" aria-pressed="false">${n}</button>`).join("")}</div>
    </div>
    <div class="web__row" title="Songs in the new playlist">
      <span class="web__label">Size</span>
      <div class="web__seg" data-seg="size">${SIZES.map((n) => `<button class="web__opt" type="button" data-value="${n}" aria-pressed="false">${n}</button>`).join("")}</div>
    </div>
    <div class="web__row" title="Familiar puts your songs first. Discover puts songs you don't have first">
      <span class="web__label">Prefer</span>
      <div class="web__seg" data-seg="prefer">${PREFERS.map((o) => `<button class="web__opt" type="button" data-value="${o.value}" aria-pressed="false">${o.label}</button>`).join("")}</div>
    </div>
    <div class="web__chips" hidden></div>
    <div class="web__status" aria-live="polite" hidden><span class="web__status-text"></span><button class="web__again" type="button" hidden></button></div>
    <input class="web__input" data-name type="text" placeholder="Playlist name" spellcheck="false" hidden
      title="Names the new playlist" />
    <button class="web__make" type="button" disabled hidden title="Makes the playlist and opens it">Make playlist</button>
    <div class="web__life" hidden>
      <button class="web__opt" type="button" data-life="keep" aria-pressed="false" title="Keeps the playlist until you delete it">Keep</button>
      <div class="web__temp" role="group" aria-label="Temporary">
        <button class="web__opt" type="button" data-life="temp" aria-pressed="false">Temp</button>
        <button class="web__opt web__days" type="button" data-days aria-pressed="false"></button>
      </div>
    </div>`;
  document.body.appendChild(panel); // portaled: a Glass card is a stacking context (airplay.ts)

  const q = <T extends HTMLElement>(sel: string) => panel.querySelector<T>(sel)!;
  const artistInput = q<HTMLInputElement>("[data-artist]");
  const hitsEl = q<HTMLElement>(".web__hits");
  const chipsEl = q<HTMLElement>(".web__chips");
  const statusEl = q<HTMLElement>(".web__status");
  const statusText = q<HTMLElement>(".web__status-text");
  const againBtn = q<HTMLButtonElement>(".web__again");
  const nameInput = q<HTMLInputElement>("[data-name]");
  const makeBtn = q<HTMLButtonElement>(".web__make");
  const lifeEl = q<HTMLElement>(".web__life");
  const tempBtn = q<HTMLButtonElement>('[data-life="temp"]');
  const daysBtn = q<HTMLButtonElement>("[data-days]");

  let rows: Row[] = [];
  let active = 0; // the row Enter picks
  let seeds: WebSeed[] = []; // webs built before, all kinds (web_seeds)
  let photos = new Map<string, Artwork>(); // library artist photos already saved (artist_photos)
  let plays = new Map<string, number>(); // library song id -> plays, the song rows' order (play_counts)
  let kind: SeedKind = "artist"; // what the field finds (the Start row)
  let seed: WebSeed | null = null;
  let pickGenres = false; // the next build picks the seed's genres (a new song or album seed)
  let builtReach = 0; // the reach of the last build started
  let nameEdited = false; // the name field was typed in: the picked genres no longer rename it
  let temp = true; // Keep · Temp: every new web starts on Temp (user's call 2026-09-17); the days are remembered
  let daysAnim: Animation | null = null;
  let result: WebResult | null = null;
  let picked = new Set<string>();
  let building = 0; // the build in flight; a newer one wins
  let making = false;

  /** Show or hide a part; a part that appears while the panel shows slides in. */
  const show = (el: HTMLElement, on: boolean) => {
    if (el.hidden === !on) return;
    el.hidden = !on;
    if (on && !panel.hidden) enterRows([el]);
  };
  /** The status line, with an optional action at its end: Retry (a part failed) or Read
   *  again (the web came from saved reads). */
  const setStatus = (text: string, action?: "retry" | "again") => {
    statusText.textContent = text;
    againBtn.hidden = !action;
    if (action) {
      againBtn.dataset.action = action;
      againBtn.textContent = action === "retry" ? "Retry" : "Read again";
      againBtn.title =
        action === "retry"
          ? "Reads only the artists that didn't load"
          : "Reads this web from Apple Music again. Use it when an artist has new songs";
    }
    show(statusEl, !!text);
  };

  const place = () => {
    if (panel.hidden) return;
    const r = btn.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const gap = parseFloat(getComputedStyle(panel).marginTop) || 0;
    panel.style.left = `${Math.max(gap, Math.min(r.right - panel.offsetWidth, vw - panel.offsetWidth - gap))}px`;
    panel.style.top = `${r.bottom}px`;
    // The panel never runs past the window's bottom: it stops a gap short and scrolls. The
    // --web-panel-max-h token is the ceiling on a tall window.
    const ceiling = parseFloat(getComputedStyle(panel).getPropertyValue("--web-panel-max-h")) || Infinity;
    const room = document.documentElement.clientHeight - r.bottom - 2 * gap;
    panel.style.maxHeight = `${Math.max(0, Math.min(ceiling, room))}px`;
  };

  /** The reach a build uses: an album seed stops at ALBUM_MAX_REACH. The setting is kept. */
  const reachNow = () => ((seed?.kind ?? kind) === "album" ? Math.min(ALBUM_MAX_REACH, setting("webReach")) : setting("webReach"));

  const renderSegs = () => {
    const albumCap = (seed?.kind ?? kind) === "album";
    for (const seg of panel.querySelectorAll<HTMLElement>("[data-seg]")) {
      const k = seg.dataset.seg;
      const cur = String(k === "kind" ? kind : k === "reach" ? reachNow() : k === "size" ? setting("webSize") : setting("webPrefer"));
      for (const b of seg.querySelectorAll<HTMLElement>("[data-value]")) {
        b.setAttribute("aria-pressed", String(b.dataset.value === cur));
        if (k !== "reach") continue;
        const off = albumCap && Number(b.dataset.value) > ALBUM_MAX_REACH;
        b.toggleAttribute("aria-disabled", off);
        if (off) b.title = "An album starts with many artists, so its web reaches 2 at most";
        else b.removeAttribute("title");
      }
    }
  };

  // The panel's height moves from `from` to the new content's height instead of jumping (a
  // Start row press lists another kind). The AirPlay panel's pattern: --pop-grow, --pop-ease.
  let grow: Animation | null = null;
  const animateHeight = (from: number) => {
    grow?.cancel();
    grow = null;
    panel.classList.remove("is-growing");
    if (panel.hidden || !from || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const to = panel.offsetHeight;
    if (Math.abs(to - from) < 1) return;
    const dur = tokenMs("--pop-grow");
    panel.classList.add("is-growing");
    frames.during("menu", dur + 100, "web-kind");
    const a = panel.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: dur,
      easing: getComputedStyle(panel).getPropertyValue("--pop-ease").trim() || "ease",
    });
    grow = a;
    a.onfinish = a.oncancel = () => {
      if (grow !== a) return;
      grow = null;
      panel.classList.remove("is-growing");
    };
  };

  /** The default playlist name: the seed, up to NAME_GENRES picked genres, "Web". */
  const defaultName = () => {
    if (!seed) return "";
    const genres = picked.size <= NAME_GENRES ? [...picked].join(" & ") : "";
    return `${seedName(seed)}${genres ? ` ${genres}` : ""} Web`;
  };
  const renameDefault = () => {
    if (!nameEdited) nameInput.value = defaultName();
  };

  /** The days half of Temp shows only while Temp is picked. `animate`: its width opens from
   *  (or closes to) nothing while it fades — --pop-grow, --pop-ease; reduced motion snaps. */
  const showDays = (on: boolean, animate: boolean) => {
    if (daysBtn.hidden === !on && !daysAnim) return;
    daysAnim?.cancel();
    daysAnim = null;
    const moving = animate && !panel.hidden && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    daysBtn.hidden = false;
    const cs = getComputedStyle(daysBtn);
    const open = { width: `${daysBtn.offsetWidth}px`, minWidth: `${daysBtn.offsetWidth}px`, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight, opacity: 1 };
    daysBtn.hidden = !on;
    if (!moving) return;
    daysBtn.hidden = false;
    const shut = { width: "0px", minWidth: "0px", paddingLeft: "0px", paddingRight: "0px", opacity: 0 };
    const dur = tokenMs("--pop-grow");
    frames.during("menu", dur + 100, "web-days");
    const a = daysBtn.animate(on ? [shut, open] : [open, shut], {
      duration: dur,
      easing: getComputedStyle(panel).getPropertyValue("--pop-ease").trim() || "ease",
    });
    daysAnim = a;
    a.onfinish = () => {
      if (daysAnim !== a) return;
      daysAnim = null;
      daysBtn.hidden = !on;
    };
  };

  /** Keep · Temp | N days (PLAYLIST-WEB.md §10.4). `animate`: a press moved between Keep and Temp. */
  const renderLife = (animate = false) => {
    const days = setting("webTempDays");
    const i = TEMP_DAYS.indexOf(days);
    const at = (d: number) => TEMP_DAYS[(i + d + TEMP_DAYS.length) % TEMP_DAYS.length];
    for (const b of lifeEl.querySelectorAll<HTMLElement>("[data-life], [data-days]"))
      b.setAttribute("aria-pressed", String(b.dataset.life === "keep" ? !temp : temp));
    daysBtn.textContent = dayLabel(days);
    tempBtn.title = `Deletes the playlist ${dayLabel(days)} after you last play it. Right-click the playlist to keep it`;
    daysBtn.title = `Press for ${dayLabel(at(1))}, right-click for ${dayLabel(at(-1))}`;
    showDays(temp, animate);
  };
  const stepDays = (dir: 1 | -1) => {
    const i = TEMP_DAYS.indexOf(setting("webTempDays"));
    setSetting("webTempDays", TEMP_DAYS[(i + dir + TEMP_DAYS.length) % TEMP_DAYS.length] as TempDays);
  };

  /** The field's placeholder and hint follow the Start row. */
  const renderField = () => {
    const word = kind === "artist" ? "artist" : kind === "song" ? "song" : "album";
    const a = kind === "artist" || kind === "album" ? "an" : "a";
    artistInput.placeholder = seed?.kind === kind ? `Find another ${word}` : `Find ${a} ${word}`;
    artistInput.title = `Finds ${a} ${word} in your library, or searches Apple Music`;
  };

  /** The rows under the artist field. Typing re-renders without motion; a new kind of list
   *  (the field opening, Apple's answer, a pick) slides its rows in. */
  const renderRows = (animate: boolean) => {
    const typing = artistInput.value.trim() !== "";
    if (seed && seed.kind === kind && !typing) {
      const img = art(seedArt(seed), 64);
      const cls = `web__hit-art${seed.kind === "artist" ? "" : " web__hit-art--cover"}`;
      const line = seedLine(seed);
      hitsEl.innerHTML = `<div class="web__hit" role="option" aria-selected="true" data-picked
        title="The web starts here. Type to pick another ${seed.kind}">${img ? `<img class="${cls}" src="${esc(img)}" alt="" />` : `<span class="${cls}"></span>`}<span class="web__hit-name">${esc(seedName(seed))}</span>${line ? `<span class="web__hit-sub web__hit-sub--line">${esc(line)}</span>` : ""}</div>`;
    } else {
      hitsEl.innerHTML = rows
        .map((r, i) => {
          let pic = "";
          let name = "";
          let sub = "";
          let tip = "";
          let tail = "";
          let line = false; // the sub is an artist line: it gives way to the name
          if (r.kind === "search") {
            pic = `<span class="web__hit-art web__hit-art--glyph">${SEARCH_GLYPH}</span>`;
            name = `Search Apple Music for “${esc(r.term)}”`;
            tip = kind === "artist" ? "Searches Apple Music for this name" : "Searches Apple Music for this title";
            tail = APPLE_SIGIL;
          } else if (r.kind !== "library") {
            const s: WebSeed =
              r.kind === "libsong"
                ? { kind: "song", track: r.track }
                : r.kind === "libalbum"
                  ? { kind: "album", album: { title: r.lib.title, artistName: r.lib.artistName, artwork: r.lib.cover, genres: r.lib.genres } }
                  : r.seed;
            const src = art(seedArt(s), 64);
            const cls = `web__hit-art${s.kind === "artist" ? "" : " web__hit-art--cover"}`;
            pic = src ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" />` : `<span class="${cls}"></span>`;
            name = esc(seedName(s));
            if (s.kind === "artist") sub = r.kind === "seed" ? "Web before" : esc(s.artist.genres?.[0] ?? "");
            else {
              sub = esc(seedLine(s));
              line = true;
            }
            if (r.kind === "apple") tail = APPLE_SIGIL;
            tip = r.kind === "libsong" || r.kind === "libalbum" ? "In your library. Starts the web here" : "Starts the web here";
          } else {
            const src = art(photos.get(r.lib.name) ?? r.lib.cover, 64);
            pic = src ? `<img class="web__hit-art" src="${esc(src)}" alt="" loading="lazy" />` : `<span class="web__hit-art"></span>`;
            name = esc(r.lib.name);
            sub = `${r.lib.songs} song${r.lib.songs === 1 ? "" : "s"}`;
            tip = "In your library. Starts the web here";
          }
          return `<button class="web__hit${r.kind === "search" ? " web__hit--search" : ""}${i === active ? " is-active" : ""}" type="button" role="option"
            id="web-hit-${i}" data-i="${i}" aria-selected="${i === active}" tabindex="-1" title="${tip}">${pic}<span class="web__hit-name">${name}</span>${sub ? `<span class="web__hit-sub${line ? " web__hit-sub--line" : ""}">${sub}</span>` : ""}${tail}</button>`;
        })
        .join("");
    }
    const open = hitsEl.children.length > 0;
    show(hitsEl, open);
    artistInput.setAttribute("aria-expanded", String(open && !hitsEl.querySelector("[data-picked]")));
    if (rows[active]) artistInput.setAttribute("aria-activedescendant", `web-hit-${active}`);
    else artistInput.removeAttribute("aria-activedescendant");
    if (animate && !panel.hidden) enterRows(hitsEl.children);
  };

  const setActive = (i: number) => {
    if (!rows.length) return;
    active = (i + rows.length) % rows.length;
    hitsEl.querySelectorAll<HTMLElement>(".web__hit[data-i]").forEach((el) => {
      const on = Number(el.dataset.i) === active;
      el.classList.toggle("is-active", on);
      el.setAttribute("aria-selected", String(on));
      if (on) el.scrollIntoView({ block: "nearest" });
    });
    artistInput.setAttribute("aria-activedescendant", `web-hit-${active}`);
  };

  /** What the field lists for the text typed, for the Start row's kind: earlier webs' seeds
   *  and your library's artists, songs or albums that match, then "Search Apple Music". Empty
   *  text: the earlier webs of that kind. No calls. */
  const localRows = (): Row[] => {
    const typed = artistInput.value.trim();
    const mine = seeds.filter((x) => x.kind === kind);
    if (!typed) return mine.slice(0, MAX_HITS).map((x) => ({ kind: "seed" as const, seed: x }));
    const needle = typed.toLowerCase();
    const ranked: { row: Row; rank: number; weight: number }[] = [];
    const named = new Set<string>();
    for (const x of mine) {
      const rank = matchRank(seedName(x), needle);
      if (rank < 0) continue;
      ranked.push({ row: { kind: "seed", seed: x }, rank, weight: Number.MAX_SAFE_INTEGER });
      named.add(seedMatchKey(x));
    }
    if (kind === "artist") {
      for (const lib of libraryArtists()) {
        const rank = matchRank(lib.name, needle);
        if (rank < 0 || named.has(`${lib.name}|`.toLowerCase())) continue;
        ranked.push({ row: { kind: "library", lib }, rank, weight: lib.songs });
      }
    } else if (kind === "song") {
      const ids = new Set<string>();
      for (const t of tracks()) {
        if (!t.catalogId || ids.has(t.catalogId)) continue; // uploaded files cannot start a web
        const rank = matchRank(t.title, needle);
        if (rank < 0 || named.has(`${t.title}|${t.artistName}`.toLowerCase())) continue;
        ids.add(t.catalogId);
        ranked.push({ row: { kind: "libsong", track: t }, rank, weight: plays.get(t.libraryId ?? t.catalogId) ?? 0 });
      }
    } else {
      for (const lib of libraryAlbums()) {
        const rank = matchRank(lib.title, needle);
        if (rank < 0 || named.has(`${lib.title}|${lib.artistName}`.toLowerCase())) continue;
        ranked.push({ row: { kind: "libalbum", lib }, rank, weight: lib.songs });
      }
    }
    ranked.sort((x, y) => x.rank - y.rank || y.weight - x.weight);
    return [...ranked.slice(0, MAX_HITS).map((r) => r.row), { kind: "search", term: typed }];
  };

  const renderChips = () => {
    chipsEl.innerHTML = "";
    if (!result) return show(chipsEl, false);
    const counts = new Map<string, number>();
    for (const s of result.songs) {
      if (s.seed) continue;
      for (const g of new Set(s.track.genres)) if (!NOT_A_GENRE.has(g)) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, MAX_CHIPS);
    // A picked genre (a song's or album's own) shows even outside the ten: it filters.
    for (const g of picked) if (!top.some(([t]) => t === g)) top.push([g, counts.get(g) ?? 0]);
    chipsEl.innerHTML = top
      .map(([g, n]) => `<button class="web__chip" type="button" data-genre="${esc(g)}" data-n="${n}" aria-pressed="${picked.has(g)}">${esc(g)} <span class="web__chip-n">${n}</span></button>`)
      .join("");
    show(chipsEl, top.length > 0);
    if (!panel.hidden) enterRows(chipsEl.children);
    renderChipHints();
  };

  /** Each chip's hint says what its number means now and what a press would do, counted
   *  with the Size and Prefer and the chips picked. It is written again on every change, and
   *  the hint box shows the new text at once if the pointer rests on the chip. No calls. */
  const renderChipHints = () => {
    if (!result) return;
    const r = result;
    const size = setting("webSize");
    const prefer = setting("webPrefer");
    const seedFilter = setting("webSeedFilter");
    const who = r.seed.name;
    const seedTracks = new Set(r.songs.filter((x) => x.seed).map((x) => x.track));
    /** The playlist the chips `set` would make: web songs of genre `g`, and the artist's songs. */
    const counts = (g: string, set: Set<string>) => {
      const list = pickSongs(r, set, size, prefer, seedFilter);
      const theirs = list.filter((t) => seedTracks.has(t)).length;
      return { web: list.filter((t) => !seedTracks.has(t) && t.genres.includes(g)).length, theirs };
    };
    // Short and direct (the Settings voice): the pool, then what goes in.
    // "66 R&B/Soul songs in the web. Pick it: 44 go in, with 6 by Samara Cyn"
    const theirs = (n: number) => (seedFilter === "off" ? `, with all of ${who}'s songs` : `, with ${n} by ${who}`);
    for (const chip of chipsEl.querySelectorAll<HTMLElement>(".web__chip")) {
      const g = chip.dataset.genre!;
      const pool = Number(chip.dataset.n);
      const has = `${pool} ${g} song${pool === 1 ? "" : "s"} in the web`;
      if (picked.has(g)) {
        const c = counts(g, picked);
        chip.title = `${has}. ${c.web} go in${theirs(c.theirs)}. Press again to drop it`;
      } else if (!picked.size) {
        const c = counts(g, new Set([g]));
        chip.title = `${has}. Pick it: ${c.web} go in${theirs(c.theirs)}`;
      } else {
        const c = counts(g, new Set([...picked, g]));
        chip.title = `${has}. Add it: ${c.web} go in${theirs(c.theirs)}`;
      }
    }
  };

  const renderReady = () => {
    if (!result) return;
    const list = pickSongs(result, picked, setting("webSize"), setting("webPrefer"), setting("webSeedFilter"));
    const n = list.length;
    const artists = result.artists.length;
    // With a genre picked and the artist's songs filtered, say how many of theirs are left:
    // a thin share is explained, not a surprise.
    let count = `${n} songs from ${artists} artist${artists === 1 ? "" : "s"}`;
    if (picked.size && setting("webSeedFilter") !== "off") {
      const seedTracks = new Set(result.songs.filter((x) => x.seed).map((x) => x.track));
      count += ` · ${list.filter((t) => seedTracks.has(t)).length} by ${result.seed.name}`;
    }
    const days = Math.floor((Date.now() - result.oldest) / DAY_MS);
    if (!n) setStatus("No songs match. Pick fewer genres");
    else if (result.failed) setStatus(`${count} · some artists didn't load`, "retry");
    else if (!result.calls) setStatus(`${count} · read ${days < 1 ? "today" : days === 1 ? "yesterday" : `${days} days ago`}`, "again");
    else setStatus(count);
    makeBtn.disabled = !n || making;
    renderChipHints();
  };

  /** `fresh`: read the web from Apple again instead of the saved reads. A Retry is a plain
   *  build: the saved reads that failed are read again, and only those. */
  const build = async (fresh = false) => {
    if (!seed) return;
    const mine = ++building;
    builtReach = reachNow();
    result = null;
    makeBtn.disabled = true;
    renderChips();
    setStatus("Reading the web…");
    try {
      const r = await invoke<WebResult>("web_build", { seed, reach: reachNow(), fresh });
      if (mine !== building) return;
      result = r;
      // A new song or album seed picks its own genres (§9.1); a rebuild keeps your chips.
      if (pickGenres) {
        picked = new Set(r.genres.filter((g) => !NOT_A_GENRE.has(g)));
        pickGenres = false;
      }
      // A genre the new web does not have cannot stay picked.
      const have = new Set(r.songs.flatMap((s) => s.track.genres));
      picked = new Set([...picked].filter((g) => have.has(g)));
      renameDefault();
      diag.log("web:build", { kind: r.kind, seed: seedName(seed), reach: reachNow(), fresh, artists: r.artists.length, songs: r.songs.length, calls: r.calls, failed: r.failed, genres: [...picked] });
      renderChips();
      renderReady();
    } catch (e) {
      if (mine !== building) return;
      console.error("[web] build", e);
      setStatus("Couldn't read this web. Try again");
    }
  };


  const pickSeed = (s: WebSeed) => {
    seed = s;
    kind = s.kind;
    rows = [];
    active = 0;
    picked = new Set();
    pickGenres = s.kind !== "artist";
    artistInput.value = "";
    renderField();
    renderSegs();
    nameEdited = false;
    renameDefault();
    renderRows(true);
    show(nameInput, true);
    show(makeBtn, true);
    temp = true; // a new web starts on Temp
    renderLife();
    show(lifeEl, true);
    void build();
  };

  /** The "Search Apple Music" row: one catalog search of the Start row's kind. Its answers
   *  replace the rows; a single answer is picked at once. `exact`: pick the artist with this
   *  name (a library artist with no song to resolve from). */
  const searchApple = async (term: string, exact?: string) => {
    const k = kind;
    setStatus("Searching Apple Music…");
    try {
      const r = await searchOnce(term, k === "artist" ? "artists" : k === "song" ? "songs" : "albums");
      if (k !== kind) return; // the Start row changed while Apple answered
      const hits: WebSeed[] = (
        k === "artist"
          ? r.artists.filter((a) => a.catalogId).map((artist) => ({ kind: "artist" as const, artist }))
          : k === "song"
            ? r.songs.filter((t) => t.catalogId).map((track) => ({ kind: "song" as const, track }))
            : r.albums.filter((a) => a.catalogId).map((album) => ({ kind: "album" as const, album }))
      ).slice(0, MAX_HITS);
      const same = exact ? hits.filter((h) => seedName(h).toLowerCase() === exact.toLowerCase()) : [];
      if (same.length === 1) return pickSeed(same[0]);
      if (hits.length === 1) return pickSeed(hits[0]);
      rows = hits.map((x) => ({ kind: "apple" as const, seed: x }));
      active = 0;
      renderRows(true);
      setStatus(hits.length ? "" : k === "artist" ? "Apple Music found no artist by that name" : `Apple Music found no ${k} by that title`);
    } catch (e) {
      console.error("[web] search", e);
      setStatus("Couldn't search Apple Music");
    }
  };

  /** A library artist: their Apple id comes from a song they lead — saved after the first
   *  time (`artist_catalog`), so 0 or 1 call. With no such song, Apple is searched by name. */
  const pickLibrary = async (lib: LibArtist) => {
    if (!lib.songId) return searchApple(lib.name, lib.name);
    setStatus("Finding the artist on Apple Music…");
    try {
      const info = await invoke<{ catalogId?: string; artwork?: Artwork } | null>("library_artist_info", {
        name: lib.name,
        songId: lib.songId,
        featured: false,
      });
      if (!info?.catalogId) return searchApple(lib.name, lib.name);
      if (info.artwork) photos.set(lib.name, info.artwork);
      pickSeed({ kind: "artist", artist: { name: lib.name, catalogId: info.catalogId, artwork: info.artwork ?? lib.cover } });
    } catch (e) {
      console.error("[web] library artist", e);
      setStatus("Couldn't find this artist on Apple Music");
    }
  };

  const activate = (r: Row | undefined) => {
    if (!r) return;
    if (r.kind === "search") void searchApple(r.term);
    else if (r.kind === "library") void pickLibrary(r.lib);
    else if (r.kind === "libsong") pickSeed({ kind: "song", track: r.track });
    else if (r.kind === "libalbum")
      pickSeed({ kind: "album", album: { title: r.lib.title, artistName: r.lib.artistName, artwork: r.lib.cover, genres: r.lib.genres }, songId: r.lib.songId });
    else pickSeed(r.seed);
  };

  const make = async () => {
    if (!result || !seed || making) return;
    const tracks = pickSongs(result, picked, setting("webSize"), setting("webPrefer"), setting("webSeedFilter"));
    const name = nameInput.value.trim() || defaultName();
    const expireDays = temp ? setting("webTempDays") : undefined;
    if (!tracks.length) return;
    making = true;
    makeBtn.disabled = true;
    makeBtn.textContent = "Making…";
    let id: number;
    try {
      // Made first (local, a few ms): only a playlist that exists flies. A failure keeps the panel.
      id = await playlistCreate(name, undefined, expireDays);
      await playlistAddTracks(id, tracks);
    } catch (e) {
      console.error("[web] make", e);
      toast({ kind: "warn", text: "Couldn't make the web playlist." });
      return;
    } finally {
      making = false;
      makeBtn.textContent = "Make playlist";
      renderReady();
    }
    if (expireDays) diag.log("web:expiry", { arm: id, days: expireDays });
    diag.log("web:make", { kind: result.kind, seed: seedName(seed), expireDays, songs: tracks.length, genres: [...picked], prefer: setting("webPrefer") });
    // The chip flight (handoff.ts, ARTIST-VIEW.md §5): the picked artist row, with the song
    // count, flies to the Playlists card, and the playlist opens under the landing. The panel
    // shrinks into the row first or pops out as it lifts (Web panel closes, `webMakeMotion`). The row must be on screen: typed text hides it, so clear the field first.
    if (artistInput.value || kind !== seed.kind) {
      artistInput.value = "";
      kind = seed.kind; // the Start row shows another kind: the picked row is not on screen
      renderField();
      renderSegs();
      renderRows(false);
    }
    const tile = hitsEl.querySelector<HTMLElement>("[data-picked]");
    const open = () => requestOpenPlaylist(`local:${id}`, tracks);
    const fly = () => {
      if (tile) handOff(tile, "playlists", () => Promise.resolve(tracks), open, tracks.length, true);
      else open();
    };
    // Not tied to Animate card swaps (user's call 2026-09-16): no card changes place here.
    const moving = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (tile && moving && setting("webMakeMotion") === "shrink") return shrinkInto(tile, fly);
    fly();
    dropdown.close(); // after handOff copied the row: the copy lives on <body>
  };

  /** "Shrink to chip": the panel closes in on the picked artist row — its edges draw in to
   *  the row's edges while its other parts fade — and at the end the row's copy flies from
   *  exactly there. The panel then goes away at once (no pop out: nothing of it is left to see).
   *  Timing and curve: --web-shrink-dur / --web-shrink-ease. */
  const shrinkInto = (tile: HTMLElement, fly: () => void) => {
    tile.scrollIntoView({ block: "nearest" });
    const p = panel.getBoundingClientRect();
    const t = tile.getBoundingClientRect();
    const cs = getComputedStyle(panel);
    const from = `inset(0px 0px 0px 0px round ${cs.borderTopLeftRadius})`;
    const to =
      `inset(${t.top - p.top}px ${p.right - t.right}px ${p.bottom - t.bottom}px ${t.left - p.left}px ` +
      `round ${getComputedStyle(tile).borderTopLeftRadius})`;
    const dur = tokenMs("--web-shrink-dur");
    const easing = cs.getPropertyValue("--web-shrink-ease").trim() || "ease";
    frames.during("menu", dur + 100, "web-shrink");
    const anims: Animation[] = [panel.animate([{ clipPath: from }, { clipPath: to }], { duration: dur, easing, fill: "forwards" })];
    // Everything but the row fades; the fade ends early so the last part of the shrink is the row alone.
    for (const el of Array.from(panel.querySelectorAll<HTMLElement>(":scope > *, .web__hits > *"))) {
      if (el === tile || el.contains(tile)) continue;
      anims.push(el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur * 0.6, easing, fill: "forwards" }));
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      fly(); // the copy is made on the row, where the shrink ended
      panel.classList.add("web--gone"); // hidden at once: the pop-out transition is off for this close
      dropdown.close();
      requestAnimationFrame(() => {
        anims.forEach((a) => a.cancel());
        panel.classList.remove("web--gone");
      });
    };
    anims[0].onfinish = finish;
    window.setTimeout(finish, dur + 150); // a hidden window sends no finish
  };

  artistInput.addEventListener("input", () => {
    rows = localRows();
    active = 0;
    if (!artistInput.value.trim() && !seed) setStatus("");
    renderRows(false);
  });
  artistInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive(active + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter") {
      e.preventDefault(); // typed text alone never starts a web: Enter picks the marked row
      activate(rows[active]);
    }
  });
  nameInput.addEventListener("input", () => {
    nameEdited = nameInput.value !== defaultName(); // typing it back to the default lets genres rename it again
  });
  // Right-click on the days button: one step back (PLAYLIST-WEB.md §10.4), no field menu.
  daysBtn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    stepDays(-1);
  });
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !makeBtn.disabled) void make();
  });
  panel.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const hit = t.closest<HTMLElement>(".web__hit[data-i]");
    if (hit) {
      activate(rows[Number(hit.dataset.i)]);
      return;
    }
    if (t.closest("[data-days]")) return stepDays(1);
    const life = t.closest<HTMLElement>("[data-life]")?.dataset.life;
    if (life) {
      if ((life === "temp") === temp) return;
      temp = life === "temp";
      return renderLife(true);
    }
    const opt = t.closest<HTMLElement>(".web__opt");
    if (opt) {
      const seg = opt.closest<HTMLElement>("[data-seg]")!.dataset.seg;
      const v = opt.dataset.value!;
      if (seg === "kind") {
        if (v === kind) return;
        const from = panel.offsetHeight;
        kind = v as SeedKind;
        artistInput.value = ""; // a built web stays until a new seed is picked
        rows = localRows();
        active = 0;
        renderField();
        renderSegs();
        renderRows(true);
        animateHeight(from);
        artistInput.focus();
        return;
      }
      if (opt.hasAttribute("aria-disabled")) return;
      if (seg === "reach") setSetting("webReach", Number(v) as 1 | 2 | 3);
      else if (seg === "size") setSetting("webSize", Number(v) as 25 | 50 | 100);
      else setSetting("webPrefer", v as WebPrefer);
      return;
    }
    if (t.closest(".web__again")) {
      void build(againBtn.dataset.action === "again");
      return;
    }
    const chip = t.closest<HTMLElement>(".web__chip");
    if (chip) {
      const g = chip.dataset.genre!;
      if (picked.has(g)) picked.delete(g);
      else picked.add(g);
      chip.setAttribute("aria-pressed", String(picked.has(g)));
      renameDefault();
      return renderReady();
    }
    if (t.closest(".web__make")) void make();
  });

  const offSettings = onSettingsChange((k) => {
    if (k === "webTempDays") return renderLife();
    if (k !== "webReach" && k !== "webSize" && k !== "webPrefer" && k !== "webSeedFilter") return;
    const before = builtReach;
    renderSegs();
    if (k === "webReach") {
      if (reachNow() !== before) void build();
    } else renderReady();
  });

  let unlisten: (() => void) | null = null;
  void listen<{ degree: number; artists: number }>("web-progress", (e) => {
    if (panel.hidden || result) return;
    const { degree, artists } = e.payload;
    setStatus(
      degree === 0
        ? artists > 1 ? `Reading ${artists} artists…` : "Reading the artist…"
        : `Reading ${artists} artist${artists === 1 ? "" : "s"}, ${degree} step${degree === 1 ? "" : "s"} out…`,
    );
  }).then((u) => (unlisten = u));

  const dropdown = makeDropdown({
    root: btn, // the panel lives on <body>, so it is its own hover region
    trigger: btn,
    panel,
    // While the playlist is being made, a click away or the pointer leaving does not close it.
    shouldStayOpen: (why) => making && (why === "away" || why === "leave" || why === "toggle"),
    onOpen: () => {
      renderSegs();
      // Zero calls: the earlier webs' seeds, the library artist photos and play counts already saved.
      void Promise.all([
        invoke<WebSeed[]>("web_seeds").catch(() => [] as WebSeed[]),
        invoke<[string, Artwork][]>("artist_photos").catch(() => [] as [string, Artwork][]),
        invoke<{ id: string; full: number; partial: number }[]>("play_counts").catch(() => []),
      ]).then(([s, p, c]) => {
        seeds = s;
        photos = new Map(p);
        plays = new Map(c.map((x) => [x.id, x.full + x.partial]));
        // The panel opens on the kind of the last web built (not a setting).
        if (!seed && !artistInput.value.trim()) kind = s[0]?.kind ?? "artist";
        renderField();
        renderSegs();
        if (!seed || seed.kind !== kind || artistInput.value.trim()) {
          rows = localRows();
          active = 0;
          renderRows(true);
        }
      });
      place();
      enterRows(Array.from(panel.children).filter((el) => !(el as HTMLElement).hidden));
      artistInput.focus();
    },
  });
  const onResize = () => place();
  window.addEventListener("resize", onResize);

  return () => {
    building++;
    offSettings();
    unlisten?.();
    window.removeEventListener("resize", onResize);
    dropdown.destroy();
    panel.remove();
  };
}
