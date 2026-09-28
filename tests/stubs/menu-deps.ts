// The stub map for media-menu.test.ts (the "stub map in tests/setup.mjs" HANDOFF asked for,
// 2026-09-25; built 2026-09-27). media-menu.ts imports the player, MusicKit, the search
// client and every row module. None of that loads under Node, and none of it is what the
// test is about: the test checks the ORDER and the GROUPS of each media menu (CONTEXT-MENUS.md
// §2), which is media-menu.ts's own rule. So the test's resolve hook points every heavy import
// at this one file, which exports the union of the names media-menu.ts takes from them. Each
// row-making stub returns a row with the real label, so the labels read as the doc's table;
// each verb stub does nothing. A stub that returns null for a missing id mirrors the real
// module's rule (no Copy Link without a catalog id), so the "leaves itself out" cases hold.

type Row = { label: string; run: () => void } | null;
const row = (label: string): Row => ({ label, run: () => {} });
const noop = () => {};
const later = () => Promise.resolve();

// @tauri-apps/api/core
export const invoke = () => Promise.reject(new Error("no Tauri in tests"));

// ./search
export const artistDetail = () => Promise.resolve({ topSongs: [] });
export const catalogRelated = () => Promise.resolve(null);
export const materializeTrack = noop;

// ./track-store
export const addTransientTracks = noop;
export const tracks = () => [];

// ./player
export const playTracks = later;
export const queueTracksNext = later;
export const queueTracksLater = later;
export const playStation = later;
export const queueStationAfter = later;
export const setShuffleMode = noop;

// ./playlists
export const addToPlaylistItem = () => row("Add to Playlist");
export const requestOpenPlaylist = noop;

// ./layout-bus
export const requestDrillCard = noop;
export const requestLibraryDrill = noop;
export const requestDiaryAlbum = noop;

// ./go-to
export const goTo = noop;
export const goToArtistItem = (_kind: string, id?: string, name?: string, lib?: unknown) => (id || lib || name ? row("Go to Artist") : null);
export const goToAlbumItem = (id?: string, name?: string, lib?: unknown) => (id || lib || name ? row("Go to Album") : null);
export const goToAlbumPaneItem = () => row("Go to Album");
export const artistSearch = () => noop;
export const songCreditsItem = (t?: unknown) => (t ? row("Song Credits") : null);
export const requestPlaylistPane = noop;
export const requestArtistPane = noop;

// ./artist-credit
export const creditIndex = () => ({ namesOf: () => [] as string[] });

// ./copy-link
export const copySongLinkItem = (id?: string) => (id ? row("Copy Link") : null);
export const copyAlbumLinkItem = () => row("Copy Link");
export const copyAlbumLinkFromSongItem = (id?: string) => (id ? row("Copy Link") : null);
export const copyArtistLinkItem = (id?: string, resolve?: unknown) => (id || resolve ? row("Copy Link") : null);
export const copyPlaylistLinkItem = () => row("Copy Link");
export const copyStationLinkItem = () => row("Copy Link");

// ./start-station
export const startStationItem = (_kind: string, id?: string) => (id ? row("Start Station") : null);
export const startArtistStationItem = () => row("Start Station");

// ./web
export const startWebItem = (_seed: unknown, can: boolean) => (can ? row("Start a Web") : null);

// ./library-add
export const addSongToLibraryItem = () => row("Add to Library");
export const addAlbumFromSongsItem = () => row("Add to Library");
export const addAlbumToLibraryItem = () => row("Add to Library");
export const addPlaylistToLibraryItem = () => row("Add to Library");

// ./favorites
export const favoriteItem = (t?: unknown) => (t ? row("Favorite") : null);
export const albumFavoriteItem = () => row("Favorite");
export const playlistFavoriteItem = () => row("Favorite");
export const playlistFav = (p: unknown) => p;

// ./sotd
export const markItem = () => row("Mark as Song of the Day");

// ./pins
export const pinRows = () => [row("Pin")];
export const pinItem = () => row("Pin");
export const pinActItem = () => row("On Click");
export const songKey = (t: { catalogId?: string }) => `song:${t.catalogId ?? ""}`;
export const isPinned = () => false;
export const setPin = later;
export const clearPin = later;

// ./rewind
export const albumKey = () => "album-key";
export const pid = () => "playlist-id";
