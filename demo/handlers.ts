// The web demo's back end (docs/features/WEB-DEMO.md §3). Each Tauri command the app calls
// has a handler here that answers from the mock catalog. What the visitor changes (playlists,
// ♥, pins, the queue, plays) is kept in this browser's localStorage, the way the real app
// keeps it in its database. A command with no handler answers `null` and logs once.

import type { Track } from "../src/library";
import type { Playlist, SearchResults } from "../src/search";
import * as cat from "./catalog";
import { diaryHandlers } from "./diary";

const VERSION = __DEMO_VERSION__;

// ── The visitor's own data ──
interface LocalList {
  id: number;
  name: string;
  description: string | null;
  tracks: Track[];
  cover: string | null;
  coverAt: number;
  createdAt: number;
  folderId?: number;
}
interface PlayEventRow {
  id: number;
  trackId: string;
  startedTs: number;
  msListened: number | null;
  completed: boolean;
  context: string | null;
}
interface Store {
  v: 1;
  lists: LocalList[];
  nextListId: number;
  folders: { id: number; name: string }[];
  folderOf: Record<string, number>;
  loved: string[];
  known: string[];
  pins: { key: string; kind: string; data: string | null; pinnedAt: number; act: string | null }[];
  rowOrder: { scope: string; id: string; rank: number }[];
  queue: string | null;
  events: PlayEventRow[];
  plays: Record<string, { full: number; partial: number }>;
}

const STORE_KEY = "deets.demo.store";

function seedEvents(): { events: PlayEventRow[]; plays: Store["plays"] } {
  const r = cat.rng(99);
  const events: PlayEventRow[] = [];
  const plays: Store["plays"] = {};
  const now = Date.now();
  // Two weeks of listening, a few sittings a day, weighted to a few favourite albums.
  const favourites = cat.tracks.filter((t) => ["Honey Static", "Neon Parable", "Salt & Signal", "Rainy Day Ledger"].includes(t.albumName ?? ""));
  let id = 1;
  for (let day = 14; day >= 1; day--) {
    const sittings = 1 + Math.floor(r() * 3);
    for (let s = 0; s < sittings; s++) {
      let ts = now - day * 864e5 + (8 + r() * 14) * 36e5;
      const n = 3 + Math.floor(r() * 8);
      for (let i = 0; i < n; i++) {
        const pool = r() < 0.7 ? favourites : cat.tracks;
        const t = pool[Math.floor(r() * pool.length)];
        const full = r() < 0.8;
        const ms = full ? t.durationMs! : Math.round(t.durationMs! * (0.1 + r() * 0.5));
        events.push({ id: id++, trackId: t.catalogId!, startedTs: Math.round(ts), msListened: ms, completed: full, context: `album:${cat.albumByTitle(t.albumName)?.catalogId}` });
        const p = (plays[t.catalogId!] ??= { full: 0, partial: 0 });
        if (full) p.full++;
        else p.partial++;
        ts += ms + 2000;
      }
    }
  }
  return { events, plays };
}

function seedQueue(): string {
  const album = cat.albums.find((a) => a.title === "Honey Static")!;
  const list = cat.albumTracks.get(album.catalogId!)!;
  const context = `album:${album.catalogId}`;
  const entry = (t: Track) => ({ catalogId: t.catalogId, libraryId: t.libraryId, context, origin: "auto" });
  return JSON.stringify({ v: 1, history: [], current: entry(list[0]), upcoming: list.slice(1).map(entry), savedAt: Date.now() });
}

function freshStore(): Store {
  const { events, plays } = seedEvents();
  const lists: LocalList[] = cat.seedLocalPlaylists().map((l) => ({
    id: l.id,
    name: l.name,
    description: l.description,
    tracks: l.trackIds.map((id) => cat.trackById(id)!).filter(Boolean),
    cover: null,
    coverAt: 0,
    createdAt: l.createdAt,
  }));
  const loved = cat.tracks.filter((_, i) => i % 7 === 2).map((t) => t.catalogId!);
  return {
    v: 1,
    lists,
    nextListId: lists.length + 1,
    folders: [],
    folderOf: {},
    loved,
    known: loved.slice(),
    pins: [],
    rowOrder: [],
    queue: seedQueue(),
    events,
    plays,
  };
}

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Store;
      if (s && s.v === 1) return s;
    }
  } catch {
    /* a private window or a bad blob: start fresh */
  }
  return freshStore();
}

const store = loadStore();
let saveTimer = 0;
function save(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch {
      /* storage full or blocked: the session still works */
    }
  }, 300);
}

// ── Shapes ──
const listById = (id: number): LocalList => {
  const l = store.lists.find((x) => x.id === id);
  if (!l) throw new Error(`no playlist ${id}`);
  return l;
};

function coverUrlsOf(ts: Track[]): string[] {
  return [...new Set(ts.map((t) => t.artwork?.urlTemplate).filter((u): u is string => !!u))].slice(0, 100);
}

function localPlaylist(l: LocalList): Playlist {
  const iso = new Date(l.createdAt).toISOString();
  return {
    libraryId: `local:${l.id}`,
    name: l.name,
    description: l.description ?? undefined,
    canEdit: true,
    isPublic: false,
    trackCount: l.tracks.length,
    dateAdded: iso,
    lastModified: iso,
    source: "local",
    folderId: store.folderOf[`local:${l.id}`],
    artwork: l.cover ? { urlTemplate: l.cover, width: 0, height: 0 } : undefined,
    coverUrls: l.cover ? undefined : coverUrlsOf(l.tracks),
  };
}

function allPlaylists(): Playlist[] {
  return [
    ...store.lists.map(localPlaylist),
    ...cat.applePlaylists.map((p) => ({ ...p.playlist, folderId: store.folderOf[p.playlist.libraryId!] })),
  ];
}

function tracksOfCollection(kind: string, id: string): Track[] {
  if (kind === "albums") {
    const a = cat.albumById(id);
    return a ? (cat.albumTracks.get(a.catalogId!) ?? []) : [];
  }
  const p = cat.applePlaylists.find((x) => x.playlist.catalogId === id || x.playlist.libraryId === id);
  return p ? p.tracks : [];
}

function search(term: string, types: string[] | null): SearchResults {
  const q = term.trim().toLowerCase();
  const has = (s: string | undefined) => !!s && s.toLowerCase().includes(q);
  const want = (t: string) => !types || types.includes(t);
  return {
    songs: want("songs") ? cat.tracks.filter((t) => has(t.title) || has(t.artistName) || has(t.albumName)).slice(0, 25) : [],
    albums: want("albums") ? cat.albums.filter((a) => has(a.title) || has(a.artistName)) : [],
    artists: want("artists") ? cat.artists.filter((a) => has(a.name) || (a.genres ?? []).some(has)) : [],
    playlists: want("playlists") ? cat.applePlaylists.filter((p) => p.playlist.catalogId && has(p.playlist.name)).map((p) => p.playlist) : [],
    stations: want("stations")
      ? [...cat.stations, ...cat.genres.flatMap((g) => cat.genreStations(g.id))].filter((s) => has(s.name) || has(s.tagline))
      : [],
  };
}

function artistDetail(id: string) {
  const artist = cat.artistById(id) ?? cat.artists[0];
  const albums = cat.albums.filter((a) => a.artistName === artist.name);
  const songs = cat.tracks.filter((t) => t.artistName === artist.name);
  const topSongs = songs.slice().sort((a, b) => (store.plays[b.catalogId!]?.full ?? 0) - (store.plays[a.catalogId!]?.full ?? 0)).slice(0, 10);
  const featuredPlaylists = cat.applePlaylists.filter((p) => p.playlist.catalogId && p.tracks.some((t) => t.artistName === artist.name)).map((p) => p.playlist);
  return { artist, albums, topSongs, featuredPlaylists };
}

function recentPlayed(): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (let i = store.events.length - 1; i >= 0 && out.length < 40; i--) {
    const id = store.events[i].trackId;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = cat.trackById(id);
    if (t) out.push(t);
  }
  return out;
}

function credit(t: Track | undefined) {
  if (!t?.composer) return { state: "none" as const, composer: "", names: [] };
  return { state: "have" as const, composer: t.composer, names: t.composer.split(/,\s*/) };
}

// ── The window, the events, the plugins ──
export interface Host {
  resize(w: number, h: number): void;
  minSize(w: number, h: number): void;
  emit(event: string, payload: unknown): void;
  appearance(payload: unknown): void;
}

function sizeOf(args: any): { w: number; h: number } | null {
  // Tauri sends `{ value: Size }`, where Size wraps a LogicalSize or a PhysicalSize.
  const v = args?.value ?? args;
  const inner = v?.size ?? v?.Logical ?? v?.Physical ?? v?.logical ?? v?.physical ?? v;
  const w = Number(inner?.width), h = Number(inner?.height);
  if (!(w > 0 && h > 0)) return null;
  const physical = inner?.type === "Physical" || !!v?.Physical || !!v?.physical;
  const k = physical ? window.devicePixelRatio || 1 : 1;
  return { w: w / k, h: h / k };
}

type Handler = (args: any, host: Host) => unknown;

const H: Record<string, Handler> = {
  // Tauri's own plugins
  "plugin:app|version": () => VERSION,
  "plugin:app|name": () => "DeetsMusic",
  "plugin:app|tauri_version": () => "2",
  "plugin:window|inner_size": () => ({ width: Math.round(innerWidth * devicePixelRatio), height: Math.round(innerHeight * devicePixelRatio) }),
  "plugin:window|outer_size": () => ({ width: Math.round(innerWidth * devicePixelRatio), height: Math.round(innerHeight * devicePixelRatio) }),
  "plugin:window|inner_position": () => ({ x: 0, y: 0 }),
  "plugin:window|outer_position": () => ({ x: 0, y: 0 }),
  "plugin:window|scale_factor": () => devicePixelRatio || 1,
  "plugin:window|is_maximized": () => false,
  "plugin:window|is_minimized": () => false,
  "plugin:window|is_visible": () => true,
  "plugin:window|is_focused": () => document.hasFocus(),
  "plugin:window|is_fullscreen": () => false,
  "plugin:window|is_always_on_top": () => false,
  "plugin:window|title": () => "DeetsMusic",
  "plugin:window|theme": () => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  "plugin:window|set_size": (a, host) => {
    const s = sizeOf(a);
    if (s) host.resize(s.w, s.h);
  },
  "plugin:window|set_min_size": (a, host) => {
    const s = sizeOf(a);
    if (s) host.minSize(s.w, s.h);
  },
  "plugin:window|current_monitor": () => ({ name: "Demo", size: { width: screen.width * devicePixelRatio, height: screen.height * devicePixelRatio }, position: { x: 0, y: 0 }, scaleFactor: devicePixelRatio || 1, workArea: { position: { x: 0, y: 0 }, size: { width: screen.width * devicePixelRatio, height: screen.height * devicePixelRatio } } }),
  "plugin:window|primary_monitor": (a, h) => H["plugin:window|current_monitor"](a, h),
  "plugin:window|available_monitors": (a, h) => [H["plugin:window|current_monitor"](a, h)],
  "plugin:opener|open_url": (a) => {
    const url = String(a?.url ?? "");
    if (/^https:\/\//.test(url)) window.open(url, "_blank", "noopener");
  },

  // Apple account + health: signed in from the start
  apple_connection_status: () => true,
  apple_auth_status: () => ({ state: "captured" }),
  apple_begin_auth: () => null,
  apple_cancel_auth: () => null,
  apple_disconnect: () => null,
  apple_developer_token: () => "demo",
  apple_user_token: () => "demo",
  apple_check: () => ({ app: "ok", signin: "ok", healed: false }),
  apple_remote_config: () => ({}),
  apple_dump_library: () => "",
  apple_add_to_library: () => null,

  // Library
  library_tracks: (a) => {
    const offset = Number(a?.offset ?? 0), limit = Number(a?.limit ?? 200);
    const items = cat.tracks.slice(offset, offset + limit);
    const next = offset + limit < cat.tracks.length ? offset + limit : null;
    return { items, total: cat.tracks.length, nextOffset: next };
  },
  library_sync: () => cat.tracks.length,
  seen_tracks: () => [],
  materialize_track: () => null,
  added_at_map: () => cat.tracks.map((t, i) => [t.catalogId!, Date.now() - (cat.tracks.length - i) * 36e5 * 7]),
  library_artist_info: (a) => {
    const name = String(a?.name ?? "");
    const d = artistDetail(cat.artistIdByName.get(name) ?? "");
    if (!cat.artistIdByName.has(name)) return null;
    return { catalogId: d.artist.catalogId, artwork: d.artist.artwork, featuredPlaylists: d.featuredPlaylists, topSongs: d.topSongs };
  },
  library_artists_expire: () => null,

  // Catalog
  catalog_search: (a) => search(String(a?.term ?? ""), a?.types ?? null),
  catalog_collection_tracks: (a) => tracksOfCollection(String(a?.kind ?? ""), String(a?.id ?? "")),
  catalog_artist: (a) => artistDetail(String(a?.id ?? "")),
  catalog_related: (a) => {
    const kind = String(a?.kind), id = String(a?.id), rel = String(a?.rel);
    const t = kind === "songs" ? cat.trackById(id) : undefined;
    const al = kind === "albums" ? cat.albumById(id) : cat.albumByTitle(t?.albumName);
    if (rel === "albums") return al ? { id: al.catalogId, name: al.title } : null;
    const name = t?.artistName ?? al?.artistName;
    const aid = name ? cat.artistIdByName.get(name) : undefined;
    return aid ? { id: aid, name } : null;
  },

  // Home
  recent_played_tracks: () => recentPlayed(),
  recent_added: () => ({ albums: cat.albums.slice().reverse().map((a, i) => ({ ...a, dateAdded: new Date(Date.now() - i * 3 * 864e5).toISOString() })), playlists: allPlaylists().slice(0, 3) }),
  artist_photos: () => [...cat.artistArt.entries()],
  artist_new_releases: () => cat.albums.filter((a) => (a.releaseDate ?? "") >= "2025"),

  // Playlists
  playlists_cached: () => allPlaylists(),
  apple_playlists_sync: () => cat.applePlaylists.length,
  apple_playlist_counts: () => 0,
  apple_playlist_tracks: (a) => cat.applePlaylists.find((p) => p.playlist.libraryId === a?.id)?.tracks ?? [],
  local_playlist_tracks: (a) => listById(Number(a?.id)).tracks,
  playlists_song_index: () => ({
    lists: [
      ...store.lists.map((l) => ({ key: `local:${l.id}`, tracks: l.tracks })),
      ...cat.applePlaylists.map((p) => ({ key: p.playlist.libraryId!, tracks: p.tracks })),
    ],
    unchecked: [],
  }),
  playlist_create: (a) => {
    const id = store.nextListId++;
    store.lists.push({ id, name: String(a?.name ?? "New Playlist"), description: a?.description ?? null, tracks: [], cover: null, coverAt: 0, createdAt: Date.now() });
    save();
    return id;
  },
  playlist_add_tracks: (a) => {
    listById(Number(a?.id)).tracks.push(...(a?.tracks ?? []));
    save();
  },
  playlist_insert_tracks: (a) => {
    const l = listById(Number(a?.id));
    l.tracks.splice(Number(a?.at ?? l.tracks.length), 0, ...(a?.tracks ?? []));
    save();
  },
  playlist_rename: (a) => {
    listById(Number(a?.id)).name = String(a?.name ?? "");
    save();
  },
  playlist_reorder: (a) => {
    const l = listById(Number(a?.id));
    const [t] = l.tracks.splice(Number(a?.from), 1);
    if (t) l.tracks.splice(Number(a?.to), 0, t);
    save();
  },
  playlist_remove_track: (a) => {
    listById(Number(a?.id)).tracks.splice(Number(a?.position), 1);
    save();
  },
  playlist_set_cover: (a) => {
    const l = listById(Number(a?.id));
    l.cover = a?.cover ?? null;
    l.coverAt = Date.now();
    save();
  },
  playlist_delete: (a) => {
    store.lists = store.lists.filter((l) => l.id !== Number(a?.id));
    save();
  },
  playlist_keep: () => null,
  playlist_folders_list: () => store.folders,
  playlist_folder_create: (a) => {
    const id = (store.folders.reduce((m, f) => Math.max(m, f.id), 0) || 0) + 1;
    store.folders.push({ id, name: String(a?.name ?? "Folder") });
    save();
    return id;
  },
  playlist_folder_rename: (a) => {
    const f = store.folders.find((x) => x.id === Number(a?.id));
    if (f) f.name = String(a?.name ?? f.name);
    save();
  },
  playlist_folder_delete: (a) => {
    store.folders = store.folders.filter((f) => f.id !== Number(a?.id));
    for (const k of Object.keys(store.folderOf)) if (store.folderOf[k] === Number(a?.id)) delete store.folderOf[k];
    save();
  },
  playlist_folder_assign: (a) => {
    if (a?.folderId == null) delete store.folderOf[a?.playlistKey];
    else store.folderOf[a.playlistKey] = Number(a.folderId);
    save();
  },
  playlist_refresh_rows: () => [],
  playlist_refresh_set: () => null,
  playlist_refresh_stamp: () => null,
  playlist_refetch: (a) => ({ added: 0, total: cat.applePlaylists.find((p) => p.playlist.libraryId === a?.id)?.tracks.length ?? 0 }),
  playlists_expire: () => [],
  playlist_restore: () => 0,
  playlist_export_plan: () => {
    throw new Error("Apple Music export is in the desktop app");
  },
  playlist_export_apple: () => {
    throw new Error("Apple Music export is in the desktop app");
  },
  playlist_get_apple_songs: () => ({ appleId: null, addedTitles: [] }),
  playlist_import: () => {
    throw new Error("Import is in the desktop app");
  },
  apple_playlist_add: () => {
    throw new Error("Adding to an Apple Music playlist is in the desktop app");
  },

  // Radio
  radio_live: () => cat.stations,
  radio_my_station: () => cat.myStation,
  radio_discovery: () => cat.discovery,
  radio_genres: () => cat.genres,
  radio_genre_stations: (a) => cat.genreStations(String(a?.id ?? "")),
  radio_seed_station: (a) => {
    const t = cat.trackById(a?.id) ?? cat.tracks[0];
    return { id: `ra.demo-seed-${a?.id}`, name: `${t.title} Station`, isLive: false, tagline: `Songs like ${t.title}`, artwork: t.artwork };
  },

  // Favorites, pins, row order, the queue
  favorites_cached: () => store.loved,
  favorites_known: () => store.known,
  favorite_set: (a) => {
    const id = a?.track?.catalogId ?? a?.track?.libraryId;
    if (!id) return;
    store.loved = store.loved.filter((x) => x !== id);
    if (a.loved) store.loved.push(id);
    if (!store.known.includes(id)) store.known.push(id);
    save();
  },
  favorites_reconcile: (a) => {
    const ids: string[] = a?.ids ?? [];
    return { loved: ids.filter((i) => store.loved.includes(i)), unloved: ids.filter((i) => !store.loved.includes(i)) };
  },
  pins_list: () => store.pins,
  pin_set: (a) => {
    store.pins = store.pins.filter((p) => p.key !== a?.key);
    const row = { key: String(a?.key), kind: String(a?.kind), data: a?.data ?? null, pinnedAt: Date.now(), act: a?.act ?? null };
    store.pins.push(row);
    save();
    return row;
  },
  pin_act: (a) => {
    const p = store.pins.find((x) => x.key === a?.key);
    if (p) p.act = a?.act ?? null;
    save();
    return !!p;
  },
  pin_clear: (a) => {
    const before = store.pins.length;
    store.pins = store.pins.filter((p) => p.key !== a?.key);
    save();
    return store.pins.length !== before;
  },
  pin_play_counts: (a) => (a?.keys ?? []).map((k: string) => [k, 0]),
  row_order_all: () => store.rowOrder,
  row_order_set: (a) => {
    const scope = String(a?.scope);
    store.rowOrder = store.rowOrder.filter((r) => r.scope !== scope);
    (a?.ids ?? []).forEach((id: string, rank: number) => store.rowOrder.push({ scope, id, rank }));
    save();
  },
  row_order_reset: (a) => {
    store.rowOrder = a?.scope == null ? [] : store.rowOrder.filter((r) => r.scope !== a.scope);
    save();
  },
  queue_state_get: () => store.queue,
  queue_state_set: (a) => {
    store.queue = a?.json ?? null;
    save();
  },
  dead_ids_cached: () => [],
  dead_ids_mark: () => [],

  // Plays, history, stats
  record_play: (a) => {
    const id = a?.catalogId ?? a?.libraryId;
    if (!id) return;
    const p = (store.plays[id] ??= { full: 0, partial: 0 });
    if (a?.kind === "full") p.full++;
    else p.partial++;
    save();
  },
  record_event_start: (a) => {
    const id = (store.events[store.events.length - 1]?.id ?? 0) + 1;
    store.events.push({ id, trackId: String(a?.trackId ?? a?.catalogId ?? a?.libraryId ?? ""), startedTs: Date.now(), msListened: null, completed: false, context: a?.context ?? null });
    if (store.events.length > 4000) store.events.splice(0, store.events.length - 4000);
    save();
    return id;
  },
  record_event_end: (a) => {
    const e = store.events.find((x) => x.id === Number(a?.eventId));
    if (e) {
      e.msListened = Number(a?.msListened ?? 0);
      e.completed = !!a?.completed;
    }
    save();
  },
  play_event_count: () => store.events.length,
  play_events_since: (a) => store.events.filter((e) => e.startedTs >= Number(a?.sinceTs ?? 0)).map(({ id: _id, ...e }) => e),
  play_counts: () => Object.entries(store.plays).map(([id, p]) => ({ id, ...p })),
  lastfm_heard: () => false,

  // Credits
  credits_for: (a) => {
    const out: Record<string, unknown> = {};
    for (const id of a?.ids ?? []) out[id] = credit(cat.trackById(id));
    return out;
  },
  credits_fetch: () => 0,
  songs_by_writer: (a) => {
    const name = String(a?.name ?? "");
    return cat.tracks
      .filter((t) => (t.composer ?? "").split(/,\s*/).includes(name))
      .map((t) => ({ catalogId: t.catalogId, title: t.title, artistName: t.artistName, mine: store.loved.includes(t.catalogId!) ? 3 : store.plays[t.catalogId!] ? 2 : 1, track: t }));
  },
  // The album light (WEB-DEMO.md §11): the palette each cover was drawn with, as Apple's
  // bgColor / textColor1 / textColor2 would give it. The NP aurora, the album text, the tray
  // and the Ocean glow and neon all read it through album-color.ts, as in the app.
  album_palette: ({ coverUrl }: { coverUrl: string }) => {
    const a =
      cat.tracks.find((t) => t.artwork?.urlTemplate === coverUrl)?.artwork ??
      cat.albums.find((x) => x.artwork?.urlTemplate === coverUrl)?.artwork ??
      [...cat.stations, cat.myStation, cat.discovery].find((s) => s.artwork?.urlTemplate === coverUrl)?.artwork;
    if (!a?.bgColor) return null;
    const hex = (c?: string) => (c ? `#${c}` : undefined);
    return { bg: hex(a.bgColor), c1: hex(a.textColors?.[0]), c2: hex(a.textColors?.[1]) };
  },

  // The playlist web (PLAYLIST-WEB.md) reads Apple's artist graph: desktop only
  web_seeds: () => [],
  web_build: () => {
    throw new Error("The playlist web is in the desktop app");
  },

  // Sound, loudness, the system
  loudness_all: () => [],
  loudness_save: () => null,
  loudness_forget: () => 0,
  audio_output: () => null,
  airplay_tap: () => null,
  system_volume_get: () => ({ level: 0.6, muted: false }),
  system_volume_set: (a) => ({ level: Number(a?.level ?? 0.6), muted: false }),
  system_volume_mute: () => ({ level: 0.6, muted: false }),
  win_media_now_playing: () => null,

  // AirPlay: no speakers on a web page
  airplay_status: () => ({ connected: null, connecting: null, error: null, lastSpeaker: null, speakers: [], firewallSeeded: true, capture: "app" }),
  airplay_scan: () => [],

  // Accounts and services that stay signed out
  lastfm_status: () => ({ available: true, connected: false, name: null, reconnect: false, waiting: 0 }),
  lastfm_auth_status: () => ({ state: "idle" }),
  friend_me: () => {
    throw new Error("Friends is in the desktop app");
  },
  friend_list: () => [],
  presence_set: () => false,
  outlet_status: () => [],
  picks_list: () => [],
  picks_missed: () => [],
  pick_today: () => new Date().toISOString().slice(0, 10),
  post_log: () => [],

  // Settings the Rust side owns
  settings_get: () => ({ minimizeToTray: false, agentControl: false, agentHistory: false, lastfmScrobble: true, lastfmNowPlaying: true, airplayCapture: "app" }),
  autostart_get: () => false,
  autostart_set: (a) => !!a?.on,
  bridge_info: () => ({ port: null }),
  bridge_log: () => "",
  agent_setup_text: () => "",
  report_list: () => [],
  report_log: () => "",

  // Updates: this is the newest
  update_status: () => ({ state: "idle", current: VERSION, channel: "stable", version: null, notes: null, size: null, got: 0, rollback: false, error: null }),
  update_check: (a, h) => H.update_status(a, h),
  update_versions: () => ({ versions: [] }),

  // The tray panel and the look it copies
  appearance_publish: (a, host) => host.appearance(a),
  np_snapshot: () => null,

  // The Diary, with sample entries (demo/diary.ts, WEB-DEMO.md §12)
  ...diaryHandlers,
};

const warned = new Set<string>();

export async function handle(cmd: string, args: any, host: Host): Promise<unknown> {
  const h = H[cmd];
  if (h) return h(args, host);
  if (cmd.startsWith("plugin:")) return null;
  if (!warned.has(cmd)) {
    warned.add(cmd);
    console.debug("[demo] no handler:", cmd);
  }
  return null;
}
