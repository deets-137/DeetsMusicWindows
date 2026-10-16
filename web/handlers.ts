// The rooms port's back end (docs/features/WebRooms.md §9.3 C): one answer per Tauri command the
// web build reaches. The catalog commands call Apple for real, with the Radio tab's developer
// token (his call W4); their replies go through web/apple-catalog.ts, the TypeScript twin of
// the Rust normalizers. Everything the desktop keeps (the library, the SQLite cache, playlists,
// AirPlay, Last.fm, Friends) answers empty, so the cards draw as a fresh, signed-in install
// with no library. An unknown command answers `null` and logs once, like the demo.

import {
  SEARCH_TYPES,
  artistDetailFrom,
  collectionTracksFrom,
  relatedFrom,
  searchResultsFrom,
} from "./apple-catalog";

declare global {
  interface Window {
    /** The Radio tab's developer token (../DeetsSolutions/radio/dev-token.js): an origin-locked
     *  ES256 JWT, public by design (WebRooms.md §7.1 W4). */
    RADIO_DEV_TOKEN?: string;
  }
}

type Handler = (args: any) => unknown | Promise<unknown>;

const API = "https://api.music.apple.com";
/** Pages followed on a long playlist, as apple.rs caps it. */
const MAX_PAGES = 10;

/** The configured MusicKit instance, or null before player.ts has configured it. */
function music(): any {
  try {
    return window.MusicKit?.getInstance?.() ?? null;
  } catch {
    return null;
  }
}

function devToken(): string {
  const t = window.RADIO_DEV_TOKEN;
  if (!t) throw new Error("no Apple Music developer token on this page");
  return t;
}

/** The listener's storefront once signed in; the US catalog before (a catalog read needs one). */
const storefront = (): string => music()?.storefrontId || "us";

/** One catalog GET. Catalog reads need only the developer token: no listener's call is spent. */
async function appleGet(pathAndQuery: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}${pathAndQuery}`, { headers: { Authorization: `Bearer ${devToken()}` } });
  const body = res.status === 200 ? await res.json() : null;
  return { status: res.status, body };
}

async function catalogSearch(term: string, types: string[] | null): Promise<unknown> {
  const want = SEARCH_TYPES.filter((t) => !types?.length || types.includes(t));
  if (!want.length) return searchResultsFrom({});
  const q = new URLSearchParams({ term, types: want.join(","), limit: "25" });
  const { status, body } = await appleGet(`/v1/catalog/${storefront()}/search?${q}`);
  if (status !== 200) throw new Error(`catalog/search HTTP ${status}`);
  return searchResultsFrom(body);
}

async function collectionTracks(kind: string, id: string): Promise<unknown> {
  if (kind !== "albums" && kind !== "playlists") throw new Error(`catalog_collection_tracks: bad kind '${kind}'`);
  const { status, body } = await appleGet(`/v1/catalog/${storefront()}/${kind}/${encodeURIComponent(id)}?include=tracks`);
  if (status !== 200) throw new Error(`catalog/${kind}/${id} HTTP ${status}`);
  const rel = body?.data?.[0]?.relationships?.tracks;
  const items: any[] = [...(rel?.data ?? [])];
  let next: string | undefined = rel?.next;
  for (let i = 0; i < MAX_PAGES && next; i++) {
    const page = await appleGet(next);
    if (page.status !== 200) break; // partial is better than an error mid-drill
    items.push(...(page.body?.data ?? []));
    next = page.body?.next;
  }
  return collectionTracksFrom(kind, body, items);
}

async function catalogArtist(id: string): Promise<unknown> {
  const base = `/v1/catalog/${storefront()}/artists/${encodeURIComponent(id)}?views=top-songs,full-albums`;
  let r = await appleGet(`${base},featured-playlists`);
  if (r.status !== 200 && r.status !== 404) r = await appleGet(base); // a view Apple does not know
  if (r.status !== 200) throw new Error(`catalog/artists/${id} HTTP ${r.status}`);
  return artistDetailFrom(r.body);
}

async function catalogRelated(kind: string, id: string, rel: string): Promise<unknown> {
  const { status, body } = await appleGet(`/v1/catalog/${storefront()}/${kind}/${encodeURIComponent(id)}?include=${rel}`);
  if (status === 404) return null;
  if (status !== 200) throw new Error(`${kind}/${id} include=${rel} HTTP ${status}`);
  return relatedFrom(body, rel);
}

const H: Record<string, Handler> = {
  // `getVersion()` (player.ts names the app to MusicKit with it)
  "plugin:app|version": () => "web",

  // Apple: the token from the page, the sign-in from MusicKit itself (web/app.ts)
  apple_developer_token: () => devToken(),
  apple_user_token: () => null, // MusicKit JS keeps its own; player.ts never injects one on the web
  apple_connection_status: () => !!music()?.isAuthorized,
  apple_check: () => ({ app: "ok", signin: music()?.isAuthorized ? "ok" : "none", healed: false }),
  apple_auth_status: () => ({ state: "idle" }),
  apple_remote_config: () => ({}),

  // The catalog, for real
  catalog_search: (a) => catalogSearch(String(a?.term ?? ""), a?.types ?? null),
  catalog_collection_tracks: (a) => collectionTracks(String(a?.kind ?? ""), String(a?.id ?? "")),
  catalog_artist: (a) => catalogArtist(String(a?.id ?? "")),
  catalog_related: (a) => catalogRelated(String(a?.kind ?? ""), String(a?.id ?? ""), String(a?.rel ?? "")),

  // No library and no cache on the web
  library_tracks: () => ({ items: [], total: 0, nextOffset: null }), // a Page<Track>

  library_sync: () => 0,
  library_sync_busy: () => false,
  artist_primaries: () => [],
  song_artists: () => [],
  seen_tracks: () => [],
  materialize_track: () => null,
  catalog_heals: () => ({ healed: [], none: [] }),
  catalog_heal_one: () => null,
  added_at_map: () => [],
  artist_photos: () => [],
  recent_played_tracks: () => [],
  recent_added: () => ({ albums: [], playlists: [] }),
  artist_new_releases: () => [],

  // A dead id is kept for the tab (player.ts adds to its own set as it goes)
  dead_ids_cached: () => [],
  dead_ids_mark: () => [],

  // Plays, favorites, pins, playlists: the desktop's
  record_play: () => null,
  record_event_start: () => null,
  record_event_end: () => null,
  play_event_count: () => 0,
  play_events_since: () => [],
  play_counts: () => [],
  lastfm_heard: () => false,
  favorites_cached: () => [],
  favorites_known: () => [],
  suggest_list: () => [],
  filters_list: () => [], // no saved filters or Rulez Playlists on the web (features/filter-rules.md)
  pins_list: () => [],
  pin_play_counts: () => [],
  row_order_all: () => [],
  playlists_cached: () => [],
  playlists_song_index: () => ({ lists: [], unchecked: [] }),
  playlist_folders_list: () => [],
  playlist_refresh_rows: () => [],
  playlists_expire: () => [],
  queue_state_get: () => null,
  queue_state_set: () => null,
  radio_live: () => [],
  radio_discovery: () => [],
  radio_genres: () => [],
  web_seeds: () => [],
  loudness_all: () => [],
  user_files_list: () => ({ files: [], migrated: null }),

  // Accounts and services that stay off on the web
  lastfm_status: () => ({ available: false, connected: false, name: null, reconnect: false, waiting: 0 }),
  lastfm_auth_status: () => ({ state: "idle" }),
  friend_code: () => null, // no friends on the web (his call W3)
  friend_list: () => [],
  outlet_status: () => [],
  picks_list: () => [],
  picks_missed: () => [],
  post_log: () => [],
  airplay_status: () => ({ connected: null, connecting: null, error: null, lastSpeaker: null, speakers: [], firewallSeeded: true, capture: "app" }),
  airplay_scan: () => [],
  settings_get: () => ({ minimizeToTray: false, agentControl: false, agentHistory: false, lastfmScrobble: false, lastfmNowPlaying: false, airplayCapture: "app" }),
  report_list: () => [],
  update_versions: () => ({ versions: [] }),
};

/**
 * The commands the port's code NAMES but answers with `null` on purpose: writes and reads behind
 * rows the web leaves out (src/platform.ts), or parts that never start on the web. The test
 * tests/web-commands.test.ts reads every command in the port's import closure and fails on
 * one that is in neither this list nor the handlers above, so a new command in a shared file
 * is a decision here, not a quiet `null` on a visitor's page (the demo's gap, WEB-DEMO.md §9.8).
 */
export const NULL_ON_PURPOSE = new Set([
  // AirPlay, the sound output, the album palette from Rust
  "airplay_connect", "airplay_disconnect", "airplay_firewall_prompt", "airplay_tap", "airplay_volume", "audio_output", "album_palette",
  // The desktop sign-in and the library writes
  "apple_add_to_library", "apple_begin_auth", "apple_cancel_auth", "apple_disconnect", "apple_dump_library",
  "library_artist_info", "library_artists_expire",
  // Playlists (Add to Playlist and the Playlists card are desktop)
  "apple_playlist_add", "apple_playlist_counts", "apple_playlist_tracks", "apple_playlists_sync", "local_playlist_tracks",
  "playlist_add_new_tracks", "playlist_add_tracks", "playlist_create", "playlist_delete", "playlist_export_apple", "playlist_export_plan",
  "playlist_folder_assign", "playlist_folder_create", "playlist_folder_delete", "playlist_folder_rename", "playlist_get_apple_songs",
  "playlist_import", "playlist_insert_tracks", "playlist_keep", "playlist_match_apply", "playlist_match_plan", "playlist_match_undo",
  "playlist_refetch", "playlist_refresh_set", "playlist_refresh_stamp", "playlist_remove_positions", "playlist_remove_track",
  "playlist_rename", "playlist_reorder", "playlist_set_cover",
  // ♥, pins, row order, credits
  "favorite_collection_reconcile", "favorite_collection_set", "favorite_set", "favorites_reconcile",
  "suggest_set", "suggest_clear", "suggest_restore", "suggest_push",
  // Filters and Rulez Playlists (desktop only: the store and the read are Rust's)
  "filter_save", "filter_delete", "filter_attach", "filter_set_refresh", "filter_set_lists", "filter_read", "filter_write",
  "pin_act", "pin_clear", "pin_set", "row_order_reset", "row_order_set", "credits_fetch", "credits_for", "songs_by_writer",
  // Friends (none on the web, his call W3), Song of the Day, Last.fm
  "friend_add", "friend_key_export", "friend_key_import", "friend_me", "friend_pin", "friend_remove", "friend_rename", "friend_sign",
  "pick_delete_posts", "pick_mark", "pick_note", "pick_post", "pick_skip", "pick_today", "pick_unmark", "pick_withdraw", "picks_missed_skip",
  "lastfm_album_info", "lastfm_artist_info", "lastfm_listeners",
  // Stations and the playlist web (a station leaves a room)
  "radio_genre_stations", "radio_my_station", "radio_seed_station", "web_build",
  // Your own files, the log file, the launch cover
  "user_files_add", "user_files_colors", "user_files_delete", "user_files_rename", "diag_flush", "log_event", "main_ready",
  // The Diary (desktop only, DIARY.md §10)
  "diary_delete", "diary_export", "diary_file", "diary_folder_create", "diary_folder_delete", "diary_folder_rename",
  "diary_folders", "diary_get", "diary_list", "diary_open", "diary_rescale", "diary_set_done", "diary_song_set", "diary_update",
  // Settings the Rust side owns, the agent bridge, MCP, reports, the log folder (no Settings card on the web)
  "settings_set_agent_control", "settings_set_agent_diary", "settings_set_agent_history", "settings_set_airplay_capture",
  "settings_set_lastfm_now_playing", "settings_set_lastfm_scrobble", "settings_set_minimize_to_tray", "settings_set_sotd",
  "settings_set_sotd_day_start", "settings_set_sotd_picks_per_day", "settings_set_sotd_post_at", "settings_set_sotd_post_mode",
  "autostart_get", "autostart_set", "tray_pin_main", "agent_open_guide", "agent_setup_text", "agent_reply",
  "bridge_info", "bridge_log", "bridge_open_install_page", "log_open_folder", "mcp_connect", "mcp_detect", "mcp_disconnect",
  "outlet_connect", "outlet_disconnect", "outlet_set_on",
  "report_clear", "report_close", "report_log", "report_open", "report_refresh", "report_send",
  // The tray panel and the extension hub, Discord presence, Last.fm sign-in
  "np_publish", "appearance_publish", "presence_clear", "presence_close", "presence_set",
  "lastfm_begin_auth", "lastfm_cancel_auth", "lastfm_disconnect", "lastfm_open_profile",
  // Updates (the site is the update), loudness memory, usage counts (USAGE-COUNTS.md: the app's)
  "update_status", "update_check", "update_download", "update_install", "update_discard", "loudness_forget", "loudness_save",
  "usage_health", "usage_send",
]);

/** Every command with a real answer above. */
export const HANDLED = new Set(Object.keys(H));

const warned = new Set<string>();

export async function handle(cmd: string, args: any): Promise<unknown> {
  const h = H[cmd];
  if (h) return h(args);
  if (cmd.startsWith("plugin:")) return null;
  if (!warned.has(cmd)) {
    warned.add(cmd);
    console.debug("[listen] no handler:", cmd);
  }
  return null;
}
