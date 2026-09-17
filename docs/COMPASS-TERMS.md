# Compass — everything the bar answers to

> The user-guide list for Ctrl+Space ([COMPASS.md](COMPASS.md)). Written 2026-09-17 from the
> code; keep it in step with `src/compass.ts` (COMPASS.md §9 says when). Words in **bold**
> are what you type; the bar matches the start of any word, ignores case and accents, and
> forgives one typo in a word of four letters or more (two in eight or more).

## 1. Places (type the name)

| Type | Goes to |
|---|---|
| **home**, **library** (lib, songs, music), **queue** (up next), **playlists** (lists), **search** (find, apple music), **history** (recent, plays), **rewind**, **radio** (stations), **settings** (preferences, options, prefs) | The card, on screen |
| **mini**, **np** (the player alone), **midi**, **max** (window, size) | The window's surface |
| **lilac**, **green**, **sepia**, **moonlight**, **black & yellow**, **black & red** (theme, colors, dark, light) | The theme, with the launch animation |
| **press**, **ocean**, **glass**, **cyber** (skin, look) | The skin |
| **sound** (eq, equalizer) | The Sound panel |
| **sleep timer** (timer, alarm) | The sleep panel |

## 2. Settings (type any word of the row's name or its section)

Every row of the Settings card. A row whose value the app itself holds (a toggle or a choice
of up to three) shows its control in the bar: Enter flips it or moves to the next option.
Any other row opens the Settings card at that row. Examples: **hover hints**, **notices**,
**stream quality**, **animate**, **tray**, **fancy glass**, **web reach**.

## 3. Actions (type the verb)

| Type | Does |
|---|---|
| **play** / **pause** (resume, stop) | Play or pause; Space does this too |
| **next** (skip, forward) · **previous** (back, prev) | The next or the previous song |
| **shuffle** (random) · **repeat** (loop) · **mute** (silence, quiet) | The transport buttons |
| **sleep in 15 / 30 / 45 / 60** · **sleep at end of song** · **sleep at end of up next** · **sleep timer off** | The sleep timer |
| **eq** (equalizer, sound): **flat**, **night**, … and your own presets | The equalizer preset; the one in force says On |
| a song in **up next** | Jumps there |
| a song played this session (**recent**) | Plays it again |
| a speaker's name (**speaker**, **airplay**, **homepod**, **play on**) | Plays on it. The first such word looks for speakers on your network; **look for speakers again** rescans |

## 4. Your library (type a name)

Songs, albums, artists, genres, playlists, and stations. The bar shows one kind at a time,
the one it thinks you mean; **Tab** moves to the next kind, **Shift+Tab** back, or click a
chip. **Enter** opens the thing where it lives (a song: its album in the Library; a playlist:
the Playlists card; a station plays). **Ctrl+Enter** plays it.

Stations: the ones you played, your station, the Discovery station, Apple's live list, and
"**<genre> stations**" rows: Enter reads that genre's stations (once) and lists them.

The last row is always **Search Apple Music for …**: the Search card opens with your words.

## 5. Commands (type the word first)

| Command | Aliases | What follows | Does |
|---|---|---|---|
| **favorite** | fav, love, heart, like; unfavorite, unlove, dislike | a song's name, or nothing for the playing song | ♥ on Apple Music (Unfavorite when it is loved) |
| **add** | add to library | a song's name, or nothing for the playing song | Adds it to your library. Only a song not in it yet (a station's, a catalog play's) |
| **queue** | — | `[song\|album\|playlist] <name> [N \| next \| end]` | Puts it in Up Next: at position N, next (the default), or at the end |
| **web** | — | `[song\|album\|artist] <seed> [1\|2\|3] [genre, genre]` | Makes a playlist web from the seed at that reach with those genres, and opens it. Reach, size and style you leave out come from Settings › Playlists |
| **grow** | expand, enlarge, big, fill | a card's name | Grows the card over its neighbor (Horizontal, Vertical, Full: Tab picks the shape; the last pick is remembered). Brings the card in first. Nothing to grow in Mini |
| **volume** | vol | a number 0–100 | Sets the level |

`favorite` and `add` write to your Apple Music account. They sit behind Settings › Apple
Music › **Add to Library and ♥**; with that off, the row opens the setting instead.

## 6. Synonyms the bar knows

The same table as `SYNONYMS` in `src/compass.ts`; change both.

| You type | The bar also tries |
|---|---|
| preferences, options, prefs | settings |
| skip, forward | next |
| back, prev | previous |
| loop | repeat |
| random | shuffle |
| silence, quiet | mute |
| vol, loud | volume |
| eq, equalizer | eq, equalizer |
| speaker, airplay, homepod | speakers, play on |
| timer, alarm | sleep |
| fav, love, heart, like, dislike, unlove | favorite |
| up next, upnext | queue |
| recent, recents | recently played, history |
| station, stations | radio |
| expand, enlarge, big, fill | grow |
| look, colors, colour, dark, light | theme, skin |
| window, size | surface |
| small | mini |
| large | max |
| lib, songs, music | library |
| list, lists | playlists |
| find, lookup | search |

## 7. Keys in the bar

| Key | Does |
|---|---|
| Ctrl+Space, Ctrl+Shift+Space | Opens the bar (from a text field too); the compass button right of the title does too |
| ↓ ↑, Home, End, PageUp, PageDown | Move the highlight |
| Enter · Ctrl+Enter | The row's action · its second action (Play) |
| Tab · Shift+Tab | The next library kind · the one before; on a row with its own options, the next option |
| Shift+Enter | On an inline setting: the option before |
| Escape | Clears typed text; empty, closes the bar |
| a click outside | Closes the bar (Settings › Window › Compass closes on outside click) |
