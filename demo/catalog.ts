// The web demo's catalog (docs/features/WEB-DEMO.md §15). The songs are the owner's own Songs of
// the Day: the rows of deets.solutions' journal feed (`/sotd/songs.json`) that he posted (author
// "Deets"). The feed is read when the page loads, so the demo shows his picks up to today. A copy
// built into the demo at build time stands in when the feed cannot be read (fork 7A).
//
// Covers and previews are Apple's own (mzstatic, itunes), as the feed gives them. The stations'
// covers are drawn here as SVG: a station is not in the feed.
//
// An artwork template carries the `{w}{h}{f}` placeholders: the app's own `.replace("{w}", …)`
// fills them in. For a drawn cover the placeholders sit in the data URL's fragment.

import type { Artwork, Track } from "../src/library";
import type { Album, Artist, Playlist } from "../src/search";
import type { Station, StationGenre } from "../src/radio";
import builtIn from "virtual:sotd-picks";

// ── A small seeded random, so every visitor sees the same catalog ──
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable number from a name (FNV-1a), for the ids the feed does not carry. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

// ── The feed ──
/** One feed row, the fields the demo reads (DeetsOTD.md §1b). */
export interface FeedRow {
  posted_at?: string;
  date?: string;
  track_name?: string;
  artist_name?: string;
  album?: string;
  genre?: string;
  duration_sec?: number;
  release_date?: string;
  release_year?: number;
  author?: string;
  apple_music_url?: string;
  preview_url?: string;
  artwork_url?: string;
}

const FEED_URL = "/sotd/songs.json";
const FEED_WAIT_MS = 4000;
/** Only the owner's picks (his call, 2026-10-12). Nothing else from a row's author is kept. */
const OWNER = "Deets";

async function readFeed(): Promise<{ rows: FeedRow[]; from: "feed" | "built-in" }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FEED_WAIT_MS);
  try {
    const res = await fetch(FEED_URL, { cache: "no-cache", signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { songs?: FeedRow[] };
    const rows = (body.songs ?? []).filter((r) => r.author === OWNER);
    if (!rows.length) throw new Error("no picks in the feed");
    return { rows, from: "feed" };
  } catch (err) {
    console.info("[demo] Songs of the Day feed not read, the built-in copy is used:", String(err));
    return { rows: builtIn, from: "built-in" };
  } finally {
    clearTimeout(timer);
  }
}

interface Pick {
  songId: string;
  albumId: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  durationMs: number;
  releaseDate?: string;
  releaseYear?: number;
  postedMs: number;
  preview?: string;
  art?: string;
}

/** `…/album/<slug>/<albumId>?i=<songId>&…` → the two ids. */
const ID_RE = /\/album\/(?:[^/?]*\/)?(\d+)\?(?:[^#]*&)?i=(\d+)/;
/** Apple's sized cover URL → the template the app fills (`…/600x600bb.jpg` → `…/{w}x{h}bb.{f}`). */
const artTemplate = (url: string | undefined): string | undefined =>
  url && /\/\d+x\d+bb\.\w+$/.test(url) ? url.replace(/\/\d+x\d+bb\.\w+$/, "/{w}x{h}bb.{f}") : undefined;

function toPicks(rows: FeedRow[]): Pick[] {
  const byId = new Map<string, Pick>();
  for (const r of rows) {
    const m = ID_RE.exec(r.apple_music_url ?? "");
    if (!m || !r.track_name || !r.artist_name) continue;
    const p: Pick = {
      songId: m[2],
      albumId: m[1],
      title: r.track_name,
      artist: r.artist_name,
      album: r.album || r.track_name,
      genre: r.genre || "Music",
      durationMs: Math.max(1, Number(r.duration_sec) || 180) * 1000,
      releaseDate: r.release_date || undefined,
      releaseYear: Number(r.release_year) || undefined,
      postedMs: Date.parse(r.posted_at ?? r.date ?? "") || 0,
      preview: r.preview_url || undefined,
      art: artTemplate(r.artwork_url),
    };
    // A song picked twice keeps its latest day.
    const was = byId.get(p.songId);
    if (!was || was.postedMs < p.postedMs) byId.set(p.songId, p);
  }
  return [...byId.values()].sort((a, b) => a.postedMs - b.postedMs);
}

const feed = await readFeed();
const picks = toPicks(feed.rows);
/** Where the songs came from on this load: the live feed or the copy built in. */
export const source = feed.from;

// ── Drawn covers (stations, and a song with no cover) ──
type CoverStyle = "sun" | "waves" | "grid" | "rings" | "blocks" | "rain" | "peaks" | "orb";
type Colors = [string, string, string, string];

function svgUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}#{w}x{h}.{f}`;
}

function art(svg: string, bg: string, text: string[]): Artwork {
  return { urlTemplate: svgUrl(svg), width: 1200, height: 1200, bgColor: bg.replace("#", ""), textColors: text.map((c) => c.replace("#", "")) };
}

function coverSvg(style: CoverStyle, c: Colors, seed: number, label: string): string {
  const r = rng(seed);
  const [bg1, bg2, a, b] = c;
  const defs = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs>`;
  let body = "";
  switch (style) {
    case "sun": {
      body += `<circle cx="300" cy="260" r="150" fill="${a}"/>`;
      for (let i = 0; i < 6; i++) body += `<rect x="0" y="${300 + i * 26}" width="600" height="${8 + i * 2}" fill="${bg2}"/>`;
      body += `<path d="M0 470 L180 380 L300 440 L430 350 L600 450 L600 600 L0 600Z" fill="${b}"/>`;
      break;
    }
    case "waves": {
      for (let i = 0; i < 7; i++) {
        const y = 150 + i * 60;
        const amp = 20 + r() * 30;
        body += `<path d="M0 ${y} Q150 ${y - amp} 300 ${y} T600 ${y} L600 600 L0 600Z" fill="${i % 2 ? a : b}" opacity="${0.35 + i * 0.09}"/>`;
      }
      break;
    }
    case "grid": {
      body += `<rect x="0" y="330" width="600" height="270" fill="${bg2}"/>`;
      for (let i = 0; i <= 12; i++) body += `<line x1="${300 + (i - 6) * 20}" y1="330" x2="${300 + (i - 6) * 110}" y2="600" stroke="${a}" stroke-width="2"/>`;
      for (let i = 0; i < 7; i++) body += `<line x1="0" y1="${340 + i * i * 6}" x2="600" y2="${340 + i * i * 6}" stroke="${a}" stroke-width="2"/>`;
      body += `<circle cx="300" cy="250" r="120" fill="${b}"/>`;
      for (let i = 0; i < 5; i++) body += `<rect x="170" y="${230 + i * 22}" width="260" height="${4 + i * 2}" fill="${bg1}"/>`;
      break;
    }
    case "rings": {
      for (let i = 9; i > 0; i--) body += `<circle cx="${300 + (r() - 0.5) * 20}" cy="${300 + (r() - 0.5) * 20}" r="${i * 30}" fill="none" stroke="${i % 2 ? a : b}" stroke-width="${6 + r() * 10}"/>`;
      body += `<circle cx="300" cy="300" r="22" fill="${a}"/>`;
      break;
    }
    case "blocks": {
      for (let i = 0; i < 14; i++) {
        const w = 60 + r() * 180, h = 40 + r() * 140;
        body += `<rect x="${r() * (600 - w)}" y="${r() * (600 - h)}" width="${w}" height="${h}" fill="${i % 3 === 0 ? a : i % 3 === 1 ? b : bg1}" opacity="${0.55 + r() * 0.45}"/>`;
      }
      break;
    }
    case "rain": {
      for (let i = 0; i < 70; i++) {
        const x = r() * 600, y = r() * 600, l = 20 + r() * 50;
        body += `<line x1="${x}" y1="${y}" x2="${x - 8}" y2="${y + l}" stroke="${i % 4 ? a : b}" stroke-width="3" stroke-linecap="round" opacity="${0.4 + r() * 0.6}"/>`;
      }
      body += `<rect x="0" y="470" width="600" height="130" fill="${bg1}" opacity="0.7"/>`;
      break;
    }
    case "peaks": {
      body += `<circle cx="${160 + r() * 280}" cy="170" r="60" fill="${b}"/>`;
      body += `<path d="M0 420 L140 240 L230 330 L360 180 L600 430 L600 600 L0 600Z" fill="${a}" opacity="0.8"/>`;
      body += `<path d="M0 500 L200 360 L320 440 L470 330 L600 470 L600 600 L0 600Z" fill="${bg2}"/>`;
      break;
    }
    case "orb": {
      body += `<radialGradient id="o" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stop-color="${b}"/><stop offset="1" stop-color="${a}"/></radialGradient>`;
      body += `<circle cx="300" cy="300" r="190" fill="url(#o)"/>`;
      body += `<ellipse cx="300" cy="300" rx="270" ry="60" fill="none" stroke="${b}" stroke-width="6" transform="rotate(-18 300 300)"/>`;
      break;
    }
  }
  const safe = label.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const text = `<text x="36" y="560" font-family="Georgia, serif" font-size="30" fill="${b}" opacity="0.9">${safe}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600">${defs}<rect width="600" height="600" fill="url(#g)"/>${body}${text}</svg>`;
}

const PALETTES: Colors[] = [
  ["#e63946", "#1d3557", "#f1faee", "#ffffff"],
  ["#10002b", "#3c096c", "#9d4edd", "#e0aaff"],
  ["#606c38", "#283618", "#dda15e", "#fefae0"],
  ["#0b2545", "#13315c", "#8da9c4", "#eef4ed"],
  ["#f4a261", "#e76f51", "#ffd166", "#264653"],
  ["#0d0221", "#2a0845", "#2de2e6", "#ff3864"],
  ["#22223b", "#4a4e69", "#9a8c98", "#f2e9e4"],
  ["#2b0f2e", "#5c2751", "#e0a458", "#ffdbb5"],
];
const STYLES: CoverStyle[] = ["rings", "orb", "peaks", "waves", "sun", "grid", "rain", "blocks"];
function drawn(label: string, seed: number): Artwork {
  const c = PALETTES[seed % PALETTES.length];
  return art(coverSvg(STYLES[seed % STYLES.length], c, seed, label), c[0], [c[3], c[2]]);
}

/** Apple's cover: the template, at the largest size the feed's covers come in. */
const appleArt = (template: string): Artwork => ({ urlTemplate: template, width: 1200, height: 1200 });

// ── The catalog ──
export const artists: Artist[] = [];
export const albums: Album[] = [];
/** Every pick, oldest first: the order the picks were posted. */
export const tracks: Track[] = [];
/** Album catalog id → its picked songs, in the order they were picked. */
export const albumTracks = new Map<string, Track[]>();
/** Artist name → its id. The feed has no artist id: the demo makes a stable one from the name. */
export const artistIdByName = new Map<string, string>();
export const artistArt = new Map<string, Artwork>();
const previews = new Map<string, string>();
/** Song catalog id → the day it was the Song of the Day (ms). */
export const pickedAt = new Map<string, number>();

(function build() {
  const albumById = new Map<string, Album>();
  const artistGenres = new Map<string, Map<string, number>>();
  picks.forEach((p, i) => {
    const cover = p.art ? appleArt(p.art) : drawn(p.album, i);
    let album = albumById.get(p.albumId);
    if (!album) {
      album = {
        catalogId: p.albumId,
        libraryId: `l.${p.albumId}`,
        title: p.album,
        artistName: p.artist,
        artwork: cover,
        genres: [p.genre, "Music"],
        releaseDate: p.releaseDate,
        trackCount: 0,
      };
      albumById.set(p.albumId, album);
      albums.push(album);
      albumTracks.set(p.albumId, []);
    }
    const list = albumTracks.get(p.albumId)!;
    const track: Track = {
      catalogId: p.songId,
      libraryId: `i.${p.songId}`,
      title: p.title,
      artistName: p.artist,
      albumName: album.title,
      durationMs: p.durationMs,
      trackNumber: list.length + 1,
      discNumber: 1,
      genres: [p.genre, "Music"],
      hasLyrics: false,
      releaseDate: p.releaseDate,
      addedRank: i + 1,
      artwork: cover,
    };
    list.push(track);
    album.trackCount = list.length;
    tracks.push(track);
    pickedAt.set(p.songId, p.postedMs);
    if (p.preview) previews.set(p.songId, p.preview);
    // The artist's picture: the cover of their latest pick (fork 6A).
    artistArt.set(p.artist, cover);
    const g = artistGenres.get(p.artist) ?? new Map<string, number>();
    g.set(p.genre, (g.get(p.genre) ?? 0) + 1);
    artistGenres.set(p.artist, g);
  });
  for (const [name, g] of artistGenres) {
    const id = String(900000000 + (hash(name) % 99999999));
    artistIdByName.set(name, id);
    const genre = [...g.entries()].sort((a, b) => b[1] - a[1])[0][0];
    artists.push({ catalogId: id, libraryId: `r.${id}`, name, artwork: artistArt.get(name), genres: [genre] });
  }
})();

const byId = new Map<string, Track>();
for (const t of tracks) {
  byId.set(t.catalogId!, t);
  byId.set(t.libraryId!, t);
}
export const trackById = (id: string | undefined | null): Track | undefined => (id ? byId.get(id) : undefined);
export const albumById = (id: string): Album | undefined => albums.find((a) => a.catalogId === id || a.libraryId === id);
export const albumByTitle = (title: string | undefined): Album | undefined => albums.find((a) => a.title === title);
export const artistById = (id: string): Artist | undefined => artists.find((a) => a.catalogId === id || a.libraryId === id);
/** The song's 30-second preview from Apple, if the feed has one. */
export const previewOf = (id: string): string | undefined => {
  const t = byId.get(id);
  return t ? previews.get(t.catalogId!) : undefined;
};
/** The newest picks first. */
export const newestFirst = (): Track[] => tracks.slice().reverse();

/** The genres with the most picks, most first. */
const topGenres: string[] = (() => {
  const n = new Map<string, number>();
  for (const t of tracks) {
    const g = t.genres?.[0];
    if (g && g !== "Music") n.set(g, (n.get(g) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
})();
const ofGenre = (g: string): Track[] => tracks.filter((t) => t.genres?.[0] === g);

// ── Stations: built from the picks (fork 6A). A station plays from its own pool. ──
const pools = new Map<string, () => Track[]>();
function station(id: string, name: string, tagline: string, isLive: boolean, seed: number, pool: () => Track[]): Station {
  pools.set(id, pool);
  return { id, name, isLive, tagline, artwork: drawn(name.toUpperCase(), seed) };
}
const minPool = (ts: Track[]): Track[] => (ts.length >= 10 ? ts : tracks);

export const stations: Station[] = [
  station("ra.demo-live-1", "Deets Live", "Every Song of the Day, shuffled", true, 0, () => tracks),
  station("ra.demo-live-2", "Fresh Picks", "The last month of picks", true, 1, () => minPool(newestFirst().slice(0, 30))),
  station("ra.demo-live-3", "Throwbacks", "Picks released before 2020", true, 2, () => minPool(tracks.filter((t) => (t.releaseDate ?? "9999") < "2020"))),
];
export const genres: StationGenre[] = topGenres.slice(0, 5).map((g) => ({ id: `g.${hash(g)}`, name: g }));
const genreStationCache = new Map<string, Station[]>();
export function genreStations(id: string): Station[] {
  const g = genres.find((x) => x.id === id);
  if (!g) return [];
  let out = genreStationCache.get(id);
  if (!out) {
    const i = genres.indexOf(g);
    out = [station(`ra.demo-${id}`, `${g.name} Picks`, `Every ${g.name} Song of the Day`, false, 3 + i, () => minPool(ofGenre(g.name)))];
    genreStationCache.set(id, out);
  }
  return out;
}
export const myStation: Station = station("ra.demo-me", "Your Station", "Songs like the ones you play", false, 4, () => tracks);
export const discovery: Station = station("ra.q-demo", "Discovery Station", "New to you, picked for you", false, 5, () => tracks);
/** The songs a station plays from. A song's own station plays the picks of its genre. */
export function stationPool(id: string): Track[] {
  const pool = pools.get(id);
  if (pool) return pool();
  for (const g of genres) genreStations(g.id);
  const again = pools.get(id);
  if (again) return again();
  const seed = trackById(id.replace(/^ra\.demo-seed-/, ""));
  return seed ? minPool(ofGenre(seed.genres?.[0] ?? "")) : tracks;
}
/** Every station's cover, for the album light (handlers.ts `album_palette`). */
export const stationArtworks = (): Artwork[] =>
  [...stations, myStation, discovery, ...genres.flatMap((g) => genreStations(g.id))].map((s) => s.artwork!).filter(Boolean);

// ── Apple playlists (the read-only mirror) ──
export const SOTD_PLAYLIST = "p.demoSotd";
export const applePlaylists: { playlist: Playlist; tracks: Track[] }[] = [
  {
    playlist: { libraryId: SOTD_PLAYLIST, name: "Songs of the Day", canEdit: true, isPublic: false, source: "apple", kind: "user", description: "One song a day, newest first" },
    tracks: newestFirst(),
  },
];
for (const p of applePlaylists) {
  p.playlist.trackCount = p.tracks.length;
  p.playlist.coverUrls = [...new Set(p.tracks.map((t) => t.artwork!.urlTemplate))].slice(0, 4);
  const first = p.tracks[p.tracks.length - 1];
  p.playlist.dateAdded = new Date(pickedAt.get(first?.catalogId ?? "") ?? Date.now()).toISOString();
  p.playlist.lastModified = new Date(pickedAt.get(p.tracks[0]?.catalogId ?? "") ?? Date.now()).toISOString();
}

/** The local playlists a first visit starts with (ids 1.., `local:{id}`): one per top genre. */
export function seedLocalPlaylists(): { id: number; name: string; description: string | null; trackIds: string[]; cover: string | null; createdAt: number }[] {
  const now = Date.now();
  return topGenres.slice(0, 3).map((g, i) => ({
    id: i + 1,
    name: `${g} Picks`,
    description: `Every ${g} Song of the Day`,
    trackIds: ofGenre(g).reverse().map((t) => t.catalogId!),
    cover: null,
    createdAt: now - (20 - i * 6) * 864e5,
  }));
}

export { rng };
