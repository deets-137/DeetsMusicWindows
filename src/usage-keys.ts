// The usage report's allow-list (USAGE-COUNTS.md §4): which settings the weekly settings report
// may send. ONE list, pure, for two readers: usage.ts builds the report from it, and
// `npm run usage:keys` copies it into DeetsSupport (src/usage-keys.js), whose route drops any
// key not on it. tests/usage-keys.test.ts fails while a toggle or choice spec in
// agent-settings.ts is on neither list, so a new setting is never sent, or skipped, by accident.
//
// His call (2026-10-13): every toggle and choice spec, the account and sharing toggles
// included. Only the value goes, as the option's value (usage-rules.ts `settingValue`).

import { HIDEABLE_CARDS } from "./layout-rules";

/** The guest controls of a room you host: agent-settings.ts makes one spec per name. */
export const ROOM_GUEST_CONTROLS = ["playPause", "skip", "seek", "add", "changeQueue"] as const;

export const REPORTED: readonly string[] = [
  // Theme and skin, and the look schedule
  "theme", "skin", "lookSchedule", "dayTheme", "daySkin", "nightTheme", "nightSkin", "lookHold",
  // The skin rows (his call 2026-10-21: "we should send metal as well, its not privacy invading
  // or identifiable"; built 2026-10-23 with the DeetsSupport copy and deploy, USAGE-COUNTS.md §1.11)
  "metalMaterial", "metalGrain", "metalCoverChange", "metalPeek", "happySky",
  // Window
  "surface", "closeToTray", "trayView", "startWithWindows", "surfaceAutoFlip", "volumeShrink",
  "maxShortWindow", "maxCards", "alwaysOnTop", "cardGrow", "moveSections", "cardGrowOutside",
  "cardGrowPick", "cardDrill", "cardDrillBring", "cardGrowView", "drillGrow", "cardMemoryDisk",
  // Sharing, Discord, Friends (on/off only)
  "shareActivityDiscord", "shareActivityApp", "discordRoomInvite", "friendsListenAlong", "friendsRoomInvite",
  // Menus, hints and notices
  "compassCloseAway", "menuMode", "toasts", "hoverHints", "hoverHintDelay", "hoverSongNames", "goToTarget",
  // Sound (soundEqPreset: a built-in's id, or "user" for one the user named)
  "soundEq", "soundEqPreset", "soundEqMode", "soundEqPreamp", "soundEqPerOutput", "soundAdaptive",
  "soundLoudness", "soundLoudTarget", "soundLoudAlbum", "soundLoudUnmeasured", "soundLowVol",
  "soundLowVolKey", "soundCrossfeed", "soundCrossfeedLevel", "soundReviewDays",
  // Rooms
  ...ROOM_GUEST_CONTROLS.map((c) => `roomGuests.${c}`),
  // Sleep
  "sleepSchedule", "sleepPlayOut", "sleepWind",
  // Motion
  "appearanceMotion", "cardSwapMotion", "fancyScrubber", "backgroundMotion", "graphicsFallback",
  // Skin settings (the choices and toggles; the sliders are not sent)
  "oceanEdges", "glassCanvas", "glassTiles", "glassAuroraColor", "glassFancy",
  "pressVinyl", "pressVinylWhere", "pressVinylSpeed", "pressVinylPlate", "pressVinylFps",
  // Playback
  "streamQuality", "playNowScope", "pinNewAct", "dropPlayQueue", "playerWheelVolume", "previousReach", "restoreQueue",
  "listEndWeb", "shuffleStays", "shuffleOff", "shuffleManual", "historyShowDay", "showListeners",
  "showArtistInfo", "showAlbumInfo", "showSongInfo", "notesSource", "shuffleIdle",
  "suggestSkipStations", "suggestSkipWebs", "suggestSkipQueue",
  // AirPlay, Home, Apple Music
  "airplaySend", "homeApple", "libraryAdd", "addSquareOwned", "playlistExport", "playlistGetNew",
  // Last.fm (on/off only)
  "lastfmScrobble", "lastfmNowPlaying",
  // Playlists and the web
  "playlistEagerCounts", "playlistAutoRefresh", "playlistCreateSummon", "playlistCreateSummonSolo", "nowPlayingCover",
  "newPlaylistCover", "webReach", "webSize", "webMakeMotion", "webSeedFilter", "webPrefer",
  "webTempDays", "webPlayNew", "webPlayMode", "webSkipSeed",
  // Cards: which cards the picker offers
  ...HIDEABLE_CARDS.map((id) => `hiddenCards.${id}`),
  // Rewind, Diary, Song of the Day
  "fullPlayRule", "replayAuto", "replayDay", "replayKeep", "rewindToday", "diaryRescale", "diaryGrow",
  "sotd", "sotdSuggest", "sotdDayStart", "sotdPicksPerDay", "sotdPostMode",
  // Connections (on/off and the mode only), Updates
  "agentControl", "agentSettings", "agentHistory", "agentDiary", "updateMode",
];

/** Toggle and choice specs that are NOT sent, each with its reason. */
export const NOT_REPORTED: Readonly<Record<string, string>> = {
  sunShift: "minutes, close to a time",
  usageReports: "the switch itself: a report leaves only while it is on",
  // Reduce motion (2026-10-20, GRAPHICS-FALLBACK.md §10.4): not sent until he decides (a new key
  // on the allow-list is his call, USAGE-COUNTS.md §2). Metal's and Happy's rows moved to
  // REPORTED on 2026-10-23 (his call of 2026-10-21).
  reduceMotion: "a new Motion row: his call before it is sent",
  npShade: "a new Window row (2026-10-25): his call before it is sent",
  npOffCover: "a new Window row (2026-10-26): his call before it is sent",
  pinView: "the pin panel's last tile (2026-10-26, PIN.md): his call before it is sent",
  rememberArtistFilters: "a new Playback row (2026-10-27, ARTIST-VIEW.md §12): his call before it is sent",
  clearQueueOnLaunch: "a new Playback row (2026-10-29, QUEUE.md § Clear Queue): his call before it is sent",
  whatsNewEveryUpdate: "a new Updates row (2026-10-29, UPDATE-CARD.md §3.10): his call before it is sent",
};
