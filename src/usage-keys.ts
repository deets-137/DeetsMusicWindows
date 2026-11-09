// The usage report's allow-list (USAGE-COUNTS.md §4): which settings the weekly settings report
// may send. ONE list, pure, for two readers: usage.ts builds the report from it, and
// `npm run usage:keys` copies it into DeetsSupport (src/usage-keys.js), whose route drops any
// key not on it. tests/usage-keys.test.ts fails while a toggle or choice spec in
// agent-settings.ts is on neither list, so a new setting is never sent, or skipped, by accident.
//
// His call (2026-10-13): every toggle and choice spec, the account and sharing toggles
// included. Only the value goes, as the option's value (usage-rules.ts `settingValue`).
// His call (2026-11-05): a new toggle or choice goes on REPORTED as it is built, with no question.
// NOT_REPORTED is only for a value USAGE-COUNTS.md §2 rule 3 keeps off the list.

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
  "maxShortWindow", "maxCards", "maxStageSide", "fpQueueSide","alwaysOnTop", "cardGrow", "moveSections", "cardGrowOutside",
  "cardGrowPick", "cardDrill", "cardDrillBring", "cardGrowView", "drillGrow", "cardMemoryDisk",
  // Sharing, Discord, Friends (on/off only)
  "shareActivityDiscord", "shareActivityApp", "discordRoomInvite", "friendsListenAlong", "friendsRoomInvite",
  // Menus, hints and notices
  "compassCloseAway", "menuMode", "toasts", "hoverHints", "hoverHintDelay", "hoverSongNames", "goToTarget",
  // Sound (soundEqPreset: a built-in's id, or "user" for one the user named)
  "soundEq", "soundEqPreset", "soundEqMode", "soundEqPreamp", "soundEqPerOutput", "soundAdaptive",
  "soundMatch", "soundLoudTarget", "soundLoudAlbum", "soundLowVol",
  "soundLowVolKey", "soundCrossfeed", "soundCrossfeedLevel", "soundReviewDays",
  // Rooms
  ...ROOM_GUEST_CONTROLS.map((c) => `roomGuests.${c}`),
  // Sleep
  "sleepSchedule", "sleepPlayOut", "sleepWind",
  // Motion
  "appearanceMotion", "cardSwapMotion", "fancyScrubber", "backgroundMotion", "graphicsFallback",
  // Skin settings (the choices and toggles; the sliders are not sent)
  "oceanEdges", "glassCanvas", "glassTiles", "glassAuroraColor", "glassFancy",
  "pressVinyl", "pressVinylWhere", "pressVinylSpeed", "pressVinylPlate", "pressVinylFps", "albumWave",
  // Playback
  "streamQuality", "playNowScope", "pinNewAct", "dropPlayQueue", "addToQueueAt", "addToQueueToast", "playerWheelVolume", "previousReach", "restoreQueue",
  "listEndWeb", "shuffleStays", "shuffleOff", "shuffleManual", "historyShowDay", "showListeners", "listenCount",
  "showArtistInfo", "showAlbumInfo", "showSongInfo", "notesSource", "shuffleIdle",
  "suggestSkipStations", "suggestSkipWebs", "suggestSkipQueue",
  // The 1.4 rows (his call 2026-11-05): let go after a pause, the clicks on a collection and a tile
  "releaseAfterPause", "pinNewDouble", "collectionClick", "collectionDouble",
  "tileClick", "tileDouble", "tilePressWait",
  // The rows that had waited for his call (his call 2026-11-05: "Yes, add all 7")
  "reduceMotion", "npShade", "npOffCover", "pinView", "rememberArtistFilters", "clearQueueOnLaunch",
  "afterUpdateShow",
  // AirPlay, Home, Apple Music
  "airplaySend", "homeApple", "libraryAdd", "addSquareOwned", "playlistExport", "playlistGetNew",
  // Last.fm (on/off only)
  "lastfmScrobble", "lastfmNowPlaying",
  // Playlists and the web
  "playlistEagerCounts", "playlistAutoRefresh", "playlistCreateSummon", "playlistCreateSummonSolo", "nowPlayingCover",
  "newPlaylistCover", "webReach", "webSize", "webMakeMotion", "webSeedFilter", "webPrefer",
  "webTempDays", "webPlayNew", "webPlayMode", "webSkipSeed",
  // Listen Later (his call 2026-11-01: "Yes write it up to be sent")
  "laterRemove",
  // Cards: which cards the picker offers
  ...HIDEABLE_CARDS.map((id) => `hiddenCards.${id}`),
  // Rewind, Diary, Song of the Day
  "fullPlayRule", "replayAuto", "replayDay", "replayKeep", "rewindToday", "diaryRescale", "diaryGrow",
  "sotd", "sotdSuggest", "sotdDayStart", "sotdPicksPerDay", "sotdPostMode",
  // Connections (on/off and the mode only), Updates
  "agentControl", "agentSettings", "agentHistory", "agentDiary", "updateMode",
];

/** The feature uses the day count may carry (USAGE-COUNTS.md §18), as counts of one finished UTC
 *  day. `npm run usage:keys` copies this list too; the worker drops any other name. A new name
 *  is his call. */
export const USE_COUNTS = [
  // Listen Later (LISTEN-LATER.md, his call 2026-11-01): saves by where they came from, the
  // songs the setting took out after a full play, and Undo presses.
  "later.save.menu", "later.save.compass", "later.save.agent", "later.auto", "later.skip", "later.undo",
  // Feature reach (USAGE-COUNTS.md §21, his call 2026-11-02: "Build this list"). Panels count when
  // they open (makeDropdown's `use`, the tray panel its own); features where they do their job.
  "panel.sleep", "panel.sound", "panel.playon", "panel.room", "panel.pin", "panel.updates", "panel.rewind",
  "panel.net", "panel.donate", "panel.quick", "panel.web", "panel.cards", "compass.open", "panel.tray",
  "sleep.set", "sleep.fired", "web.made.artist", "web.made.song", "web.made.album",
  "rule.made", "rulezPlaylist.made", "filter.used", "review.saved", "pin.added", "pin.played",
  "station.apple", "room.made", "room.joined", "sotd.picked",
  "present.open", "notes.open", "fullplayer.open", "grow.hand", "drag.drop", "fulllib.chip", "credits.open",
] as const;
export type UseName = (typeof USE_COUNTS)[number];

/** Toggle and choice specs that are NOT sent, each with its reason. */
export const NOT_REPORTED: Readonly<Record<string, string>> = {
  sunShift: "minutes, close to a time",
  usageReports: "the switch itself: a report leaves only while it is on",
};
