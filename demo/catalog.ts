// The web demo's mock catalog (docs/features/WEB-DEMO.md §4). Every name is invented. The
// covers are drawn here as SVG, so the demo carries no real album art and no image files.
//
// An artwork template is a data URL with the `{w}{h}{f}` placeholders in its fragment: the
// app's own `.replace("{w}", …)` fills them in and the image ignores the fragment.

import type { Artwork, Track } from "../src/library";
import type { Album, Artist, Playlist } from "../src/search";
import type { Station, StationGenre } from "../src/radio";

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

// ── Covers ──
type CoverStyle = "sun" | "waves" | "grid" | "rings" | "blocks" | "rain" | "peaks" | "orb";

function svgUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}#{w}x{h}.{f}`;
}

function art(svg: string, bg: string, text: string[]): Artwork {
  return { urlTemplate: svgUrl(svg), width: 1200, height: 1200, bgColor: bg.replace("#", ""), textColors: text.map((c) => c.replace("#", "")) };
}

function coverSvg(style: CoverStyle, c: [string, string, string, string], seed: number, label: string): string {
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

function portraitSvg(initials: string, c: [string, string, string, string]): string {
  const [bg1, bg2, a, b] = c;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs>` +
    `<rect width="600" height="600" fill="url(#g)"/>` +
    `<circle cx="300" cy="245" r="105" fill="${a}"/><path d="M110 600 C120 420 480 420 490 600Z" fill="${a}"/>` +
    `<text x="300" y="275" text-anchor="middle" font-family="Georgia, serif" font-size="92" fill="${b}">${initials}</text></svg>`
  );
}

// ── The catalog ──
interface AlbumSpec {
  title: string;
  year: number;
  style: CoverStyle;
  colors: [string, string, string, string];
  songs: string[];
}
interface ArtistSpec {
  name: string;
  genre: string;
  colors: [string, string, string, string];
  writers: string[];
  albums: AlbumSpec[];
}

const ARTISTS: ArtistSpec[] = [
  {
    name: "Harbor Lights",
    genre: "Indie Pop",
    colors: ["#1d3557", "#457b9d", "#f1faee", "#e63946"],
    writers: ["Nell Okafor", "Sam Brightwater"],
    albums: [
      {
        title: "Salt & Signal",
        year: 2024,
        style: "waves",
        colors: ["#0b2545", "#13315c", "#8da9c4", "#eef4ed"],
        songs: ["Lighthouse Keeper", "Signal Fires", "Undertow", "Postcards from the Pier", "Brine", "Coastline Radio", "Tidal Hearts", "Harbor Lights"],
      },
      {
        title: "Low Tide Radio",
        year: 2022,
        style: "sun",
        colors: ["#f4a261", "#e76f51", "#ffd166", "#264653"],
        songs: ["Static on the Shore", "Sandbar", "Paper Moon Motel", "Driftwood", "Late Ferry", "Summer Frequency", "Gulls"],
      },
    ],
  },
  {
    name: "Mara Quell",
    genre: "R&B/Soul",
    colors: ["#3c1642", "#086375", "#1dd3b0", "#affc41"],
    writers: ["Mara Quell", "Dion Achterberg", "Lulu Farris"],
    albums: [
      {
        title: "Honey Static",
        year: 2025,
        style: "orb",
        colors: ["#2b0f2e", "#5c2751", "#e0a458", "#ffdbb5"],
        songs: ["Honey Static", "Slow Burn Satellite", "Velvet Rope", "Call Me Back", "Amber", "Two Cups Deep", "Sugarcane", "Gold Hour"],
      },
      {
        title: "After Hours Atlas",
        year: 2023,
        style: "rings",
        colors: ["#10002b", "#240046", "#c77dff", "#e0aaff"],
        songs: ["Atlas", "4 AM in Lisbon", "Neon Psalm", "Say Less", "Taxi Lights", "Sunrise, Probably"],
      },
    ],
  },
  {
    name: "Velvet Arcade",
    genre: "Electronic",
    colors: ["#0d0221", "#261447", "#ff3864", "#2de2e6"],
    writers: ["Ivo Rahn", "Keiko Marsh"],
    albums: [
      {
        title: "Neon Parable",
        year: 2024,
        style: "grid",
        colors: ["#0d0221", "#2a0845", "#2de2e6", "#ff3864"],
        songs: ["Parable", "Chrome Garden", "Overdrive Hymn", "Pixel Rain", "Afterimage", "Midnight Arcade", "Glass Circuit", "Continue?"],
      },
      {
        title: "Night Drive Almanac",
        year: 2021,
        style: "peaks",
        colors: ["#03071e", "#370617", "#9d0208", "#faa307"],
        songs: ["Mile Marker 88", "Tail Lights", "Desert Relay", "Motorway Lullaby", "Radio Silence", "Almanac", "Exit Ramp"],
      },
    ],
  },
  {
    name: "Juno & the Tidewater",
    genre: "Folk",
    colors: ["#606c38", "#283618", "#fefae0", "#dda15e"],
    writers: ["Juno Hale", "Abe Tidewell"],
    albums: [
      {
        title: "Paper Boats",
        year: 2023,
        style: "blocks",
        colors: ["#fefae0", "#e9edc9", "#bc6c25", "#606c38"],
        songs: ["Paper Boats", "Kettle Song", "The Long Field", "Cedar & Smoke", "Porch Light", "Wild Mint", "River Letters", "Home by Dark"],
      },
    ],
  },
  {
    name: "Koto Rain",
    genre: "Hip-Hop/Rap",
    colors: ["#22223b", "#4a4e69", "#c9ada7", "#f2e9e4"],
    writers: ["Koto Rain", "Benji Ashworth"],
    albums: [
      {
        title: "Rainy Day Ledger",
        year: 2025,
        style: "rain",
        colors: ["#22223b", "#4a4e69", "#9a8c98", "#f2e9e4"],
        songs: ["Ledger", "Umbrella Money", "Window Seat", "Overcast (Interlude)", "Puddle Jumps", "Grey Skies, Gold Chains", "Drip Feed", "Clear by Morning"],
      },
    ],
  },
];

export const artists: Artist[] = [];
export const albums: Album[] = [];
export const tracks: Track[] = [];
/** Album catalog id → its songs in order. */
export const albumTracks = new Map<string, Track[]>();
/** Artist name → its catalog id. */
export const artistIdByName = new Map<string, string>();
export const artistArt = new Map<string, Artwork>();

(function build() {
  let songN = 0;
  ARTISTS.forEach((ar, ai) => {
    const artistId = `90000000${ai + 1}`;
    const initials = ar.name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).slice(0, 2).join("");
    const portrait = art(portraitSvg(initials, ar.colors), ar.colors[0], [ar.colors[3], ar.colors[2]]);
    artistArt.set(ar.name, portrait);
    artistIdByName.set(ar.name, artistId);
    artists.push({ catalogId: artistId, libraryId: `r.${artistId}`, name: ar.name, artwork: portrait, genres: [ar.genre] });
    ar.albums.forEach((al, li) => {
      const albumId = `80000000${ai + 1}${li}`;
      const cover = art(coverSvg(al.style, al.colors, ai * 10 + li + 7, al.title), al.colors[0], [al.colors[3], al.colors[2]]);
      const r = rng(ai * 100 + li);
      const album: Album = {
        catalogId: albumId,
        libraryId: `l.${albumId}`,
        title: al.title,
        artistName: ar.name,
        artwork: cover,
        genres: [ar.genre, "Music"],
        releaseDate: `${al.year}-0${1 + Math.floor(r() * 9)}-1${Math.floor(r() * 9)}`,
        trackCount: al.songs.length,
      };
      albums.push(album);
      const list: Track[] = al.songs.map((title, ti) => {
        songN++;
        const writers = ar.writers.filter((_, wi) => (ti + wi) % 3 !== 2);
        return {
          catalogId: `70000${String(songN).padStart(4, "0")}`,
          libraryId: `i.demo${String(songN).padStart(4, "0")}`,
          title,
          artistName: ar.name,
          albumName: al.title,
          durationMs: Math.round((150 + r() * 130) * 1000),
          trackNumber: ti + 1,
          discNumber: 1,
          genres: [ar.genre, "Music"],
          hasLyrics: true,
          composer: (writers.length ? writers : ar.writers).join(", "),
          releaseDate: album.releaseDate,
          addedRank: songN,
          artwork: cover,
        };
      });
      albumTracks.set(albumId, list);
      tracks.push(...list);
    });
  });
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

// ── Stations ──
function stationArt(label: string, colors: [string, string, string, string], style: CoverStyle, seed: number): Artwork {
  return art(coverSvg(style, colors, seed, label), colors[0], [colors[3]]);
}
export const stations: Station[] = [
  { id: "ra.demo-live-1", name: "Deets Live", isLive: true, tagline: "Songs picked by a person, all day", artwork: stationArt("LIVE", ["#e63946", "#1d3557", "#f1faee", "#ffffff"], "rings", 41) },
  { id: "ra.demo-live-2", name: "Night Shift Radio", isLive: true, tagline: "Late hours, low lights", artwork: stationArt("NIGHT", ["#10002b", "#3c096c", "#9d4edd", "#e0aaff"], "orb", 42) },
  { id: "ra.demo-live-3", name: "Porch Sessions", isLive: true, tagline: "Acoustic, front step, no hurry", artwork: stationArt("PORCH", ["#606c38", "#283618", "#dda15e", "#fefae0"], "peaks", 43) },
];
export const genres: StationGenre[] = [
  { id: "g.pop", name: "Pop" },
  { id: "g.rnb", name: "R&B" },
  { id: "g.electronic", name: "Electronic" },
  { id: "g.folk", name: "Folk" },
  { id: "g.hiphop", name: "Hip-Hop" },
];
export function genreStations(id: string): Station[] {
  const g = genres.find((x) => x.id === id);
  if (!g) return [];
  const seed = genres.indexOf(g) * 7 + 50;
  return [1, 2, 3].map((n) => ({
    id: `ra.demo-${id}-${n}`,
    name: `${g.name} ${["Essentials", "Rising", "Chill"][n - 1]}`,
    isLive: false,
    tagline: ["The songs everyone knows", "New names to follow", "Turned down a little"][n - 1],
    artwork: stationArt(g.name.toUpperCase(), ARTISTS[(genres.indexOf(g) + n) % ARTISTS.length].colors, (["waves", "blocks", "rain"] as CoverStyle[])[n - 1], seed + n),
  }));
}
export const myStation: Station = { id: "ra.demo-me", name: "Your Station", isLive: false, tagline: "Songs like the ones you play", artwork: stationArt("YOU", ["#ffb703", "#fb8500", "#023047", "#ffffff"], "sun", 60) };
export const discovery: Station = { id: "ra.q-demo", name: "Discovery Station", isLive: false, tagline: "New to you, picked for you", artwork: stationArt("NEW", ["#2de2e6", "#261447", "#ff3864", "#ffffff"], "grid", 61) };

// ── Apple playlists (the read-only mirror) ──
function pick(n: number, seed: number): Track[] {
  const r = rng(seed);
  const pool = tracks.slice();
  const out: Track[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return out;
}
export const applePlaylists: { playlist: Playlist; tracks: Track[] }[] = [
  {
    playlist: { libraryId: "p.demoMorning", name: "Morning Coffee", canEdit: true, isPublic: false, source: "apple", kind: "user", description: "Slow start, warm mug" },
    tracks: pick(14, 5),
  },
  {
    playlist: { libraryId: "p.demoFocus", catalogId: "pl.demoFocus", name: "Deep Focus", curatorName: "DeetsMusic Demo", canEdit: false, isPublic: true, source: "apple", kind: "catalog", description: "Nothing with words in the way" },
    tracks: pick(18, 9),
  },
];
for (const p of applePlaylists) {
  p.playlist.trackCount = p.tracks.length;
  p.playlist.coverUrls = [...new Set(p.tracks.map((t) => t.artwork!.urlTemplate))].slice(0, 4);
  p.playlist.dateAdded = "2026-08-02T10:00:00Z";
  p.playlist.lastModified = "2026-09-10T10:00:00Z";
}

/** The local playlists a first visit starts with (ids 1.., `local:{id}`). */
export function seedLocalPlaylists(): { id: number; name: string; description: string | null; trackIds: string[]; cover: string | null; createdAt: number }[] {
  const now = Date.now();
  return [
    { id: 1, name: "Road Trip", description: "Windows down", trackIds: pick(16, 21).map((t) => t.catalogId!), cover: null, createdAt: now - 20 * 864e5 },
    { id: 2, name: "Rainy Sunday", description: null, trackIds: pick(11, 33).map((t) => t.catalogId!), cover: null, createdAt: now - 9 * 864e5 },
    { id: 3, name: "Gym", description: null, trackIds: pick(12, 47).map((t) => t.catalogId!), cover: null, createdAt: now - 3 * 864e5 },
  ];
}

export { rng };
