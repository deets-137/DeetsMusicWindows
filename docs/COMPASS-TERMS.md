---
status: guide
desk_test: none
sources: [src/compass.ts]
updated: 2026-09-20
---
# Compass — everything the bar answers to

> The user-guide list for Ctrl+Space ([COMPASS.md](COMPASS.md)). Written 2026-09-17 from the
> code; keep it in step with `src/compass.ts` (COMPASS.md §9 says when). Words in **bold**
> are what you type; the bar matches the start of any word, ignores case and accents, and
> forgives one typo in a word of four letters or more (two in eight or more).

## 1. Places (type the name)

| Type | Goes to |
|---|---|
| **home**, **library** (lib, songs, music), **queue** (up next), **playlists** (lists), **search** (find, apple music), **history** (recent, plays), **rewind**, **radio** (stations), **settings** (preferences, options, prefs) | The card, on screen |
| **mini**, **player** (the player alone; **np** still finds it — its name until 2026-09-18), **midi**, **max** (window, size) | The window's surface |
| **lilac**, **green**, **sepia**, **moonlight**, **black & yellow**, **black & red** (theme, colors, dark, light) | The theme, with the launch animation |
| **press**, **ocean**, **glass**, **cyber** (skin, look) | The skin |
| **sound** (eq, equalizer) | The Sound panel |
| **sleep timer** (timer, alarm) | The sleep panel |
| **quick settings** | The quick panel under the cog: every setting, by what it is for (2026-09-20) |
| **listening room** (room, together) | The Room panel |
| **friends** (friend, buddies, people, together) | The same panel's Friends half — its own row, because "friends" and "listening room" are two things a person means (FRIENDS.md §16.7) |

### 1a. How a card opens (a shape word before or after its name)

A card row opens the card. Add a shape word to say how much room it takes; the word goes
before the name or after it, so **full settings** and **settings full** are the same.

| Type | The card opens |
|---|---|
| **card**, **normal**, **open**, **plain** | As it is now (the default: no word) |
| **horizontal**, **wide**, **side**, **across**, **half** | Grown sideways over its neighbor |
| **vertical**, **tall**, **upright** | Grown up or down over its neighbor |
| **full**, **fill**, **whole**, **big**, **huge** | Over all four cards (Max) |

Three letters are enough (`hor`, `vert`, `ful`). The highlighted card row also carries a
**pill** of the shapes this window has; **Tab** moves between them. Midi grows sideways only,
so a word it does not have takes the nearest one and the row says so. Mini has no pill: one
card fills the window there. The pick is not remembered — the bar opens on **Card** each
time.

## 1b. Sums (type the sum)

Type a sum and the first row is the answer: **1+1** shows `1 + 1 = 2`. **Enter copies the
answer** and the bar stays open. Nothing is sent anywhere.

| Type | You get |
|---|---|
| **1+1**, **(2+3)*4**, **100/3**, **10 % 3** (or **10 mod 3**, the remainder) | The four operations, brackets, the remainder |
| **2^10**, **2**10**, **sqrt(16)**, **cbrt(27)**, **root(3, 27)**, **5!** | Powers, roots, factorial |
| **log(1000)** (base 10), **ln(e)**, **log2(256)**, **exp(1)** | Logarithms |
| **sin(30)**, **cos(60)**, **tan(45)**, **asin(0.5)**, **atan(1)**, **atan2(1, 1)**, **sinh(1)** | Trigonometry, **in degrees** |
| **rad(180)**, **deg(pi)** | Degrees to radians, and back |
| **round(2.7)**, **floor**, **ceil**, **trunc**, **abs(-3)**, **sign(-3)** | Rounding |
| **min(1, 9)**, **max(1, 9, 4)**, **hypot(3, 4)**, **gcd(12, 18)**, **lcm(4, 6)** | Several numbers |
| **pi**, **π**, **tau**, **e** | The constants (`e` alone is read as a letter; use it in a sum) |

A sum that is not finished (**1+**) or has no real answer (**1/0**, **sqrt(-1)**) shows no
row. A name is never read as a sum, so **Blink-182** still finds the artist. A year
(**1984**) is a search, not a sum.

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
| **pin this song** / **unpin this song** (pin, pinned) | Pins the playing song: a tile on Home's Pinned shelf and the Library's (PINS.md, 2026-09-18) |
| **reset row order** (arrange, rearrange, move, order, sections) | Opens Settings › Reset › Row order — the way back to the built-in order of every section and every pinned item (MOVABLE-ROWS.md, 2026-09-20). Shown only when you have moved something |
| **refresh playlists now** (refresh, stale, update playlists, re-read playlists) | Re-reads the playlists that are DUE — the day-change check, on demand (PLAYLIST-REFRESH.md, 2026-09-20) |
| **start a listening room** (room, listen together, share) | Starts a room from what you play now |
| **leave room** / **end room** (in a room) | Leaves it, or ends it for everyone |
| **stop listening** / **listen again** (in a room) | Stops this app while the room plays on, and re-joins it |
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
| np, nowplaying | player |
| large | max |
| lib, songs, music | library |
| list, lists | playlists |
| find, lookup | search |
| stale, reread | refresh |
| arrange, rearrange, reorder | arrange, move, order |

## 7. Keys in the bar

| Key | Does |
|---|---|
| Ctrl+Space, Ctrl+Shift+Space | Opens the bar (from a text field too); the compass button right of the title does too |
| ↓ ↑, Home, End, PageUp, PageDown | Move the highlight |
| Enter · Ctrl+Enter | The row's action · its second action (Play) |
| Tab · Shift+Tab | The next library kind · the one before; on a row with its own options (a card row's shape, the grow command's), the next option |
| Shift+Enter | On an inline setting: the option before |
| Ctrl+K · Ctrl+Q · Ctrl+L · Ctrl+P · Ctrl+, | The card the row names, in the shape the pill shows; the bar closes |
| Escape | Clears typed text; empty, closes the bar |
| a click outside | Closes the bar (Settings › Window › Compass closes on outside click) |
